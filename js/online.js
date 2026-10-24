// オンライン対戦の通信（合言葉の部屋に 2 人が入り、打った手を順番に送り合う）
//  ・ふだんは Firebase Realtime Database を使う（設定は edition.js の firebase）。「オンライン対戦」を押したときだけ読み込んでつなぐ
//  ・URL に ?online=local を付けると、同じブラウザの別タブどうしでつなぐ（Firebase なしで試す・自動テスト用）
// 部屋のデータ：rooms/{合言葉} = { host, guest, created, settings, moves: { 送った順: { u: 送った人, ...中身 } }, on: { 人: true } }
// ランダムマッチ・ランクマッチ：match/{種類}/lobby に待っている 1 人（{ u, t }）を置く。来た人はその人を取り出して部屋を作り、
// 合言葉を match/pairs/{待っていた人} に送る。待っていた人はそれを見て部屋に入る。match/{種類}/seek/{人} は探している人の数を出すため
// レート：ratings/{人} = { r: レート, n: 対局数, name: 名前, t: 更新した時刻 }（自分の分だけ書ける）
(function (root) {
  'use strict';
  const FB_VER = '10.12.2';
  const SDK = ['app', 'auth', 'database'].map((m) => `https://cdn.jsdelivr.net/npm/firebase@${FB_VER}/firebase-${m}-compat.js`);
  const ROOM_TTL = 24 * 60 * 60 * 1000; // 1 日たった部屋の合言葉は使い回してよい
  const ed = root.EDITION || {};
  const useLocal = /[?&]online=local\b/.test(location.search);

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('通信の部品を読み込めませんでした'));
      document.head.appendChild(s);
    });
  }
  const randomCode = () => String(Math.floor(1000 + Math.random() * 9000));
  const LOBBY_TTL = 60000, HEARTBEAT = 20000; // 待っている人は 20 秒ごとに時刻を更新する。1 分更新がなければいないものとする
  // 決まった時間で返ってこなければあきらめる（無料プランの同時接続の上限を超えると、つながらずに待ち続けるため）
  const BUSY = 'いま混み合っていて、つながりませんでした。少ししてからもう一度試してください';
  function withTimeout(p, ms, onTimeout) {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => { if (onTimeout) onTimeout(); rej(new Error(BUSY)); }, ms); })])
      .finally(() => clearTimeout(t));
  }

  // ---------- 同じブラウザの別タブどうし（テスト用） ----------
  function localTransport() {
    const me = 'u' + Math.random().toString(36).slice(2, 10);
    const KEY = 'destroy-go-online-local';
    const rooms = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
    const save = (r) => localStorage.setItem(KEY, JSON.stringify(r));
    let bc = null, code = null;
    const listen = (h) => {
      bc = new BroadcastChannel('destroy-go-online-' + code);
      bc.onmessage = (e) => {
        const m = e.data;
        if (m.k === 'move') h.onMove(m.v);
        else if (m.k === 'peer') h.onPeer(m.v);
      };
    };
    return {
      me,
      async create(settings, h) {
        const all = rooms();
        do code = randomCode(); while (all[code] && Date.now() - all[code].created < ROOM_TTL);
        all[code] = { host: me, created: Date.now(), settings }; save(all);
        listen(h);
        return code;
      },
      async join(c, h) {
        const all = rooms(), r = all[c];
        if (!r || Date.now() - r.created > ROOM_TTL) throw new Error('その合言葉の部屋が見つかりません');
        if (r.guest) throw new Error('その部屋はもう2人そろっています');
        r.guest = me; save(all); code = c;
        listen(h);
        bc.postMessage({ k: 'peer', v: { joined: me } });
        return r.settings;
      },
      send(v) { const m = { ...v, u: me }; bc.postMessage({ k: 'move', v: m }); return m; },
      leave() { if (bc) { bc.postMessage({ k: 'peer', v: { left: me } }); bc.close(); bc = null; } },
      seek(onMatch, onCount, queue = 'random') {
        const LKEY = 'destroy-go-online-lobby-' + queue, pb = new BroadcastChannel('destroy-go-online-pairs');
        let done = false, hb = 0;
        const get = () => { try { return JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch (e) { return null; } };
        const finish = (r) => { done = true; clearInterval(hb); pb.close(); onMatch(r); };
        const cur = get();
        if (cur && cur.u !== me && Date.now() - cur.t < LOBBY_TTL) {
          localStorage.removeItem(LKEY);
          setTimeout(() => finish({ host: true, partner: cur.u }), 0);
        } else {
          localStorage.setItem(LKEY, JSON.stringify({ u: me, t: Date.now() }));
          hb = setInterval(() => { const c = get(); if (c && c.u === me) localStorage.setItem(LKEY, JSON.stringify({ u: me, t: Date.now() })); }, HEARTBEAT);
          pb.onmessage = (e) => { if (!done && e.data.to === me) finish({ host: false, code: e.data.code }); };
        }
        if (onCount) onCount(1);
        return () => { if (done) return; done = true; clearInterval(hb); const c = get(); if (c && c.u === me) localStorage.removeItem(LKEY); pb.close(); };
      },
      pair(partner, code) { const pb = new BroadcastChannel('destroy-go-online-pairs'); pb.postMessage({ to: partner, code }); pb.close(); },
      // テストではタブごとに別の人になるので、レートは sessionStorage に置き、ランキングは localStorage にまとめる
      async getRating() { try { return JSON.parse(sessionStorage.getItem('destroy-go-local-rating') || 'null'); } catch (e) { return null; } },
      async setRating(v) {
        sessionStorage.setItem('destroy-go-local-rating', JSON.stringify(v));
        const all = JSON.parse(localStorage.getItem('destroy-go-local-ratings') || '{}'); all[me] = v; localStorage.setItem('destroy-go-local-ratings', JSON.stringify(all));
      },
      async topRatings(n) { const all = JSON.parse(localStorage.getItem('destroy-go-local-ratings') || '{}'); return Object.entries(all).map(([u, v]) => ({ u, ...v })).sort((a, b) => b.r - a.r).slice(0, n); },
    };
  }

  // ---------- Firebase ----------
  async function firebaseTransport() {
    if (!root.firebase) for (const s of SDK) await loadScript(s);
    const fb = root.firebase;
    const app = fb.apps.length ? fb.app() : fb.initializeApp(ed.firebase);
    const cred = await app.auth().signInAnonymously();
    const me = cred.user.uid, db = app.database();
    let offset = 0; // サーバーとの時計のずれ（待っている人がまだいるかの判定に使う）
    db.ref('.info/serverTimeOffset').on('value', (s) => { offset = s.val() || 0; });
    let ref = null, offs = [];
    const listen = (h) => {
      const moves = ref.child('moves'), on = ref.child('on'), guest = ref.child('guest');
      const add = (s) => h.onMove(s.val());
      moves.on('child_added', add); offs.push(() => moves.off('child_added', add));
      const g = (s) => { if (s.val() && s.val() !== me) h.onPeer({ joined: s.val() }); };
      guest.on('value', g); offs.push(() => guest.off('value', g));
      const pres = (s) => { const v = s.val() || {}; for (const u of Object.keys(v)) if (u !== me) h.onPeer(v[u] ? { back: u } : { left: u }); };
      on.on('value', pres); offs.push(() => on.off('value', pres));
      // 接続が切れたら、相手の画面に「切れた」と出す
      on.child(me).onDisconnect().set(false);
      on.child(me).set(true);
    };
    // 部屋から抜けたら接続そのものも切る（開いたままだと、同時接続の枠を使い続けてしまう）
    let epoch = 0; // あきらめたあとに遅れて返ってきた結果は使わない
    const offline = () => { epoch++; try { db.goOffline(); } catch (e) { /* 無視 */ } };
    return {
      me,
      offline,
      async create(settings, h) {
        db.goOnline();
        const my = epoch;
        for (let tries = 0; tries < 20 && my === epoch; tries++) {
          const code = randomCode(), r = db.ref('rooms/' + code);
          try {
            await r.update({ host: me, created: fb.database.ServerValue.TIMESTAMP, settings });
          } catch (e) { // 使われている合言葉。古い部屋なら消して使い直す
            const old = (await r.child('created').get()).val();
            if (old && Date.now() - old > ROOM_TTL) { try { await r.remove(); } catch (err) { /* 別の合言葉で */ } }
            continue;
          }
          if (my !== epoch) break;
          ref = r; listen(h);
          return code;
        }
        throw new Error('部屋を作れませんでした。少ししてからもう一度試してください');
      },
      async join(code, h) {
        db.goOnline();
        const my = epoch;
        const r = db.ref('rooms/' + code);
        const snap = await r.get();
        const v = snap.val();
        if (!v || !v.host || Date.now() - (v.created || 0) > ROOM_TTL) throw new Error('その合言葉の部屋が見つかりません');
        if (v.guest && v.guest !== me) throw new Error('その部屋はもう2人そろっています');
        if (!v.guest) await r.child('guest').set(me);
        if (my !== epoch) throw new Error(BUSY);
        ref = r; listen(h);
        return v.settings;
      },
      send(v) { const m = { ...v, u: me }; if (ref) ref.child('moves').push(m); return m; },
      // ランダムマッチの相手を探す。見つかったら onMatch({ host: true, partner }) か onMatch({ host: false, code })。やめるときは戻り値を呼ぶ
      seek(onMatch, onCount, queue = 'random') {
        db.goOnline();
        const q = 'match/' + queue;
        const lobby = db.ref(q + '/lobby'), mine = db.ref('match/pairs/' + me), seekRef = db.ref(q + '/seek/' + me), seekAll = db.ref(q + '/seek');
        let done = false, hb = 0, taken = null;
        const now = () => Date.now() + offset;
        mine.remove(); // 前に届いて読まれなかった合言葉が残っていると、新しいものを受け取れないので消しておく
        seekRef.onDisconnect().remove(); seekRef.set(true);
        const cnt = (snap) => { if (onCount) onCount(snap.numChildren()); };
        seekAll.on('value', cnt);
        const stop = () => { clearInterval(hb); seekAll.off('value', cnt); mine.off('value', got); seekRef.onDisconnect().cancel(); seekRef.remove(); };
        const got = (snap) => {
          const v = snap.val();
          if (done || !v || !v.code) return;
          done = true; stop(); mine.remove(); onMatch({ host: false, code: v.code });
        };
        lobby.transaction((cur) => {
          taken = null;
          if (cur && cur.u !== me && now() - cur.t < LOBBY_TTL) { taken = cur.u; return null; } // 待っている人を取り出す
          return { u: me, t: now() };
        }, (err, committed) => {
          if (done) return;
          if (err || !committed) { done = true; stop(); onMatch({ error: true }); return; }
          if (taken) { done = true; stop(); onMatch({ host: true, partner: taken }); return; }
          mine.on('value', got); // 自分が待つ側になった。相手から合言葉が届くのを待つ
          hb = setInterval(() => lobby.transaction((cur) => (cur && cur.u === me ? { u: me, t: now() } : undefined)), HEARTBEAT);
        }, false);
        return () => {
          if (done) return;
          done = true; stop();
          lobby.transaction((cur) => (cur && cur.u === me ? null : undefined));
        };
      },
      pair(partner, code) { return db.ref('match/pairs/' + partner).set({ code, t: fb.database.ServerValue.TIMESTAMP }); },
      async getRating() { db.goOnline(); return (await db.ref('ratings/' + me).get()).val(); },
      async setRating(v) { db.goOnline(); return db.ref('ratings/' + me).set({ ...v, t: fb.database.ServerValue.TIMESTAMP }); },
      async topRatings(n) {
        db.goOnline();
        const snap = await db.ref('ratings').orderByChild('r').limitToLast(n).get();
        const out = []; snap.forEach((c) => { out.push({ u: c.key, ...c.val() }); });
        return out.reverse();
      },
      leave() {
        offs.forEach((f) => f()); offs = [];
        if (ref) {
          ref.child('on/' + me).onDisconnect().cancel();
          // 「抜けた」を書き込んでから切る（書き込みが届かなくても、切れたときの設定で相手には伝わる）
          const done = ref.child('on/' + me).set(false);
          withTimeout(done, 3000).catch(() => {}).finally(offline);
          ref = null;
        } else offline();
      },
    };
  }

  // ---------- 外から使う形 ----------
  // Online.create(settings, { onMove, onPeer }) → 合言葉 / Online.join(合言葉, ハンドラ) → 部屋の設定
  // Online.send(中身) / Online.leave()。onMove は自分が送った手も届く（u で見分ける）
  let tp = null;
  async function transport() {
    if (!tp) tp = useLocal ? localTransport() : await firebaseTransport();
    return tp;
  }
  const LIMIT = 12000; // 部品の読み込み・ログイン・部屋を作る／入るまでを、これだけ待つ
  const giveUp = () => { if (tp && tp.offline) tp.offline(); };
  const Online = {
    available: () => useLocal || !!(ed.firebase && ed.firebase.databaseURL),
    me: () => (tp ? tp.me : null),
    async create(settings, h) { return withTimeout(transport().then((t) => t.create(settings, h)), LIMIT, giveUp); },
    async join(code, h) { return withTimeout(transport().then((t) => t.join(code, h)), LIMIT, giveUp); },
    send(v) { return tp ? tp.send(v) : null; },
    leave() { if (tp) tp.leave(); },
    // ランダムマッチ：相手を探す（戻り値の Promise は、やめるための関数を返す）／見つけた側が合言葉を相手に送る
    async seek(onMatch, onCount, queue) { return withTimeout(transport().then((t) => t.seek(onMatch, onCount, queue)), LIMIT, giveUp); },
    pair(partner, code) { return tp ? tp.pair(partner, code) : null; },
    // レートとランキング（ランクマッチ）
    async getRating() { return withTimeout(transport().then((t) => t.getRating()), LIMIT); },
    async setRating(v) { return (await transport()).setRating(v); },
    async topRatings(n = 50) { return withTimeout(transport().then((t) => t.topRatings(n)), LIMIT); },
  };
  root.Online = Online;
})(this);
