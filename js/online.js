// オンライン対戦の通信（合言葉の部屋に 2 人が入り、打った手を順番に送り合う）
//  ・ふだんは Firebase Realtime Database を使う（設定は edition.js の firebase）。「オンライン対戦」を押したときだけ読み込んでつなぐ
//  ・URL に ?online=local を付けると、同じブラウザの別タブどうしでつなぐ（Firebase なしで試す・自動テスト用）
// 部屋のデータ：rooms/{合言葉} = { host, guest, created, settings, moves: { 送った順: { u: 送った人, ...中身 } }, on: { 人: true } }
// ランダムマッチ・ランクマッチ：match/{種類}/lobby に待っている 1 人（{ u, t }）を置く。来た人はその人を取り出して部屋を作り、
// 合言葉を match/pairs/{待っていた人} に送る。待っていた人はそれを見て部屋に入る。match/{種類}/seek/{人} は探している人の数を出すため
// レート：ratings/{人} = { r: レート, n: 対局数, name: 名前, t: 更新した時刻 }（自分の分だけ書ける）
// ランクマッチの棋譜：kifus/{人}/{送った順} = 棋譜（新しい 5 局だけ残す。ランキングから誰でも見られる）
// 観戦：対戦中のランダム・ランクマッチは live/{合言葉} = { k: 種類, t: 始めた時刻, size, adv, r: 結果 } に出す（部屋を作った人が書き、抜けたら消える）。
// 見る人は rooms/{合言葉}/moves を読み、rooms/{合言葉}/watch/{人} に自分を置く（対戦している 2 人に観戦の人数を出す）
(function (root) {
  'use strict';
  const FB_VER = '10.12.2';
  const SDK = ['app', 'auth', 'database'].map((m) => `https://cdn.jsdelivr.net/npm/firebase@${FB_VER}/firebase-${m}-compat.js`);
  const ROOM_TTL = 24 * 60 * 60 * 1000; // 1 日たった部屋の合言葉は使い回してよい
  const ed = root.EDITION || {};
  const useLocal = /[?&]online=local\b/.test(location.search);

  // 引き継ぎコード：XXXX-XXXX-XXXX-XXXX（前の 8 文字が ID、うしろの 8 文字がパスワード。読み間違えやすい文字は使わない）
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const randCode = (n) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return Array.from(a, (x) => CODE_CHARS[x % CODE_CHARS.length]).join(''); };
  const codeMail = (id) => `t-${id.toLowerCase()}@destroy-go.invalid`;
  const codeOf = (mail, pass) => (mail.slice(2, 10).toUpperCase() + pass).match(/.{4}/g).join('-');
  function splitCode(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 16) throw Object.assign(new Error('コードは16文字です'), { code: 'bad-code' });
    return { id: c.slice(0, 8), pass: c.slice(8) };
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('通信の部品を読み込めませんでした'));
      document.head.appendChild(s);
    });
  }
  const randomCode = () => String(Math.floor(1000 + Math.random() * 9000));
  const LIVE_MAX = 2 * 60 * 60 * 1000; // 2 時間より前に始まった対局は、観戦の一覧に出さない（消し忘れの分）
  const LOBBY_TTL = 90000, HEARTBEAT = 20000; // 待っている人は 20 秒ごとに時刻を更新する。1 分半更新がなければいないものとする（裏に回したタブはタイマーが 1 分ごとに遅れることがある）
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
    let bc = null, code = null, watchers = 0;
    const LIVE = 'destroy-go-local-live';
    const lives = () => { try { return JSON.parse(localStorage.getItem(LIVE) || '{}'); } catch (e) { return {}; } };
    const listen = (h) => {
      bc = new BroadcastChannel('destroy-go-online-' + code);
      bc.onmessage = (e) => {
        const m = e.data;
        if (m.k === 'move') h.onMove(m.v);
        else if (m.k === 'peer') h.onPeer(m.v);
        else if (m.k === 'watch' && h.onWatch) { watchers = Math.max(0, watchers + m.d); h.onWatch(watchers); }
      };
    };
    const liveSet = (c, v) => { const all = lives(); if (v) all[c] = v; else delete all[c]; localStorage.setItem(LIVE, JSON.stringify(all)); const ch = new BroadcastChannel('destroy-go-online-live-' + c); ch.postMessage(v); ch.close(); };
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
      send(v) {
        const m = { ...v, u: me }; bc.postMessage({ k: 'move', v: m });
        const all = rooms(); if (all[code]) { (all[code].moves = all[code].moves || []).push(m); save(all); } // 観戦の人があとから読めるように
        return m;
      },
      leave() {
        if (bc) { bc.postMessage({ k: 'peer', v: { left: me } }); bc.close(); bc = null; }
        if (code && lives()[code] && rooms()[code] && rooms()[code].host === me) liveSet(code, null);
      },
      livePut(info) { liveSet(code, { ...info, t: Date.now() }); },
      liveEnd(r) { const v = lives()[code]; if (v) liveSet(code, { ...v, r }); },
      async liveList() { return Object.entries(lives()).map(([c, v]) => ({ code: c, ...v })).filter((v) => !v.r).sort((a, b) => b.t - a.t); },
      async peek() {
        const lobby = (q) => { try { const v = JSON.parse(localStorage.getItem('destroy-go-online-lobby-' + q) || 'null'); return v && Date.now() - v.t < LOBBY_TTL ? 1 : 0; } catch (e) { return 0; } };
        const live = Object.values(lives()).filter((v) => !v.r);
        return { random: { wait: lobby('random'), live: live.filter((v) => v.k === 'random').length }, rank: { wait: lobby('rank'), live: live.filter((v) => v.k === 'rank').length } };
      },
      async watch(c, h) {
        const r = rooms()[c];
        if (!r || !r.settings) throw new Error('その対局は終わりました');
        const ch = new BroadcastChannel('destroy-go-online-' + c), lc = new BroadcastChannel('destroy-go-online-live-' + c);
        (r.moves || []).forEach((m) => h.onMove(m));
        ch.onmessage = (e) => { if (e.data.k === 'move') h.onMove(e.data.v); };
        lc.onmessage = (e) => h.onLive(e.data);
        setTimeout(() => h.onLive(lives()[c] || null), 0);
        ch.postMessage({ k: 'watch', d: 1 });
        return { settings: r.settings, host: r.host, stop() { ch.postMessage({ k: 'watch', d: -1 }); ch.close(); lc.close(); } };
      },
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
      async saveKifu(k) { const all = JSON.parse(localStorage.getItem('destroy-go-local-kifus') || '{}'); all[me] = [...(all[me] || []), k].slice(-5); localStorage.setItem('destroy-go-local-kifus', JSON.stringify(all)); },
      async listKifus(u) { const all = JSON.parse(localStorage.getItem('destroy-go-local-kifus') || '{}'); return (all[u] || []).slice().reverse(); },
      account() { return { linked: sessionStorage.getItem('destroy-go-local-linked') === '1', email: 'test@example.com', code: sessionStorage.getItem('destroy-go-local-code') === '1' }; },
      async issueCode() { sessionStorage.setItem('destroy-go-local-code', '1'); return codeOf(codeMail(randCode(8)), randCode(8)); },
      async useCode(code) { splitCode(code); },
      async linkGoogle() { sessionStorage.setItem('destroy-go-local-linked', '1'); return { ok: true }; },
      async switchTo() {},
      async unlinkGoogle() { sessionStorage.removeItem('destroy-go-local-linked'); },
      async saveProfile(v) { const all = JSON.parse(localStorage.getItem('destroy-go-local-users') || '{}'); all[me] = { ...(all[me] || {}), ...v }; localStorage.setItem('destroy-go-local-users', JSON.stringify(all)); },
      async loadProfile() { return JSON.parse(localStorage.getItem('destroy-go-local-users') || '{}')[me] || null; },
      async seasonResults(id) { return JSON.parse(localStorage.getItem('destroy-go-local-season-' + id) || 'null'); },
      async founders() { const v = JSON.parse(localStorage.getItem('destroy-go-local-founders') || '{}'); return { count: v.count || 0, list: v.list || {} }; },
      async claimFounder(max) {
        const v = JSON.parse(localStorage.getItem('destroy-go-local-founders') || '{}'); v.list = v.list || {};
        if (v.list[me]) return v.list[me];
        const n = (v.count || 0) + 1; if (n > max) return 0;
        v.count = n; v.list[me] = n; localStorage.setItem('destroy-go-local-founders', JSON.stringify(v)); return n;
      },
      async pioneers() { const v = JSON.parse(localStorage.getItem('destroy-go-local-pioneers') || '{}'); return { count: v.count || 0, list: v.list || {} }; },
      async claimPioneer(max) {
        const v = JSON.parse(localStorage.getItem('destroy-go-local-pioneers') || '{}'); v.list = v.list || {};
        if (v.list[me]) return v.list[me];
        const n = (v.count || 0) + 1; if (n > max) return 0;
        v.count = n; v.list[me] = n; localStorage.setItem('destroy-go-local-pioneers', JSON.stringify(v)); return n;
      },
    };
  }

  // ---------- Firebase ----------
  async function firebaseTransport() {
    if (!root.firebase) for (const s of SDK) await loadScript(s);
    const fb = root.firebase;
    const app = fb.apps.length ? fb.app() : fb.initializeApp(ed.firebase);
    const auth = app.auth();
    // 前にログインした人（Google と連携した人も）はそのまま使う。いなければ匿名でログイン
    const prev = await new Promise((res) => { const off = auth.onAuthStateChanged((u) => { off(); res(u); }); });
    const user = prev || (await auth.signInAnonymously()).user;
    const me = user.uid, db = app.database();
    let offset = 0; // サーバーとの時計のずれ（待っている人がまだいるかの判定に使う）
    db.ref('.info/serverTimeOffset').on('value', (s) => { offset = s.val() || 0; });
    const now = () => Date.now() + offset;
    let ref = null, offs = [];
    const listen = (h) => {
      const moves = ref.child('moves'), on = ref.child('on'), guest = ref.child('guest');
      const add = (s) => h.onMove(s.val());
      moves.on('child_added', add); offs.push(() => moves.off('child_added', add));
      const g = (s) => { if (s.val() && s.val() !== me) h.onPeer({ joined: s.val() }); };
      guest.on('value', g); offs.push(() => guest.off('value', g));
      const pres = (s) => { const v = s.val() || {}; for (const u of Object.keys(v)) if (u !== me) h.onPeer(v[u] ? { back: u } : { left: u }); };
      on.on('value', pres); offs.push(() => on.off('value', pres));
      const watch = ref.child('watch'), wc = (s) => { if (h.onWatch) h.onWatch(s.numChildren()); };
      watch.on('value', wc); offs.push(() => watch.off('value', wc));
      // 接続が切れたら、相手の画面に「切れた」と出す
      on.child(me).onDisconnect().set(false);
      on.child(me).set(true);
    };
    // 部屋から抜けたら接続そのものも切る（開いたままだと、同時接続の枠を使い続けてしまう）
    let epoch = 0; // あきらめたあとに遅れて返ってきた結果は使わない
    const offline = () => { epoch++; try { db.goOffline(); } catch (e) { /* 無視 */ } };
    // 部屋を作る・入る・相手を探すたびに数える。部屋を抜けて「少しあとで切る」間に次の相手を探し始めたら、その接続は切らない
    let uses = 0, seeking = false, watching = false, liveRef = null;
    const online = () => { uses++; db.goOnline(); };
    // 部屋・相手探し・観戦のどれもしていなければ切る（人数を見に来ただけのとき）
    const idle = (u) => { if (u === uses && !ref && !seeking && !watching) offline(); };
    return {
      me,
      offline,
      async create(settings, h) {
        online();
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
        online();
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
        online();
        const q = 'match/' + queue;
        const lobby = db.ref(q + '/lobby'), mine = db.ref('match/pairs/' + me), seekRef = db.ref(q + '/seek/' + me), seekAll = db.ref(q + '/seek');
        let done = false, hb = 0, taken = null, lost = 0;
        seeking = true;
        mine.remove(); // 前に届いて読まれなかった合言葉が残っていると、新しいものを受け取れないので消しておく
        seekRef.onDisconnect().remove(); seekRef.set(true);
        const cnt = (snap) => { if (onCount) onCount(snap.numChildren()); };
        seekAll.on('value', cnt);
        const stop = () => { seeking = false; clearInterval(hb); seekAll.off('value', cnt); mine.off('value', got); seekRef.onDisconnect().cancel(); seekRef.remove(); };
        const got = (snap) => {
          const v = snap.val();
          if (done || !v || !v.code) return;
          done = true; stop(); mine.remove(); onMatch({ host: false, code: v.code });
        };
        // 待っている人がいれば取り出し、いなければ自分が待つ側になる
        const tryMatch = () => lobby.transaction((cur) => {
          taken = null;
          if (cur && cur.u !== me && now() - cur.t < LOBBY_TTL) { taken = cur.u; return null; } // 待っている人を取り出す
          return { u: me, t: now() };
        }, (err, committed) => {
          if (done) return;
          if (err || !committed) { done = true; stop(); onMatch({ error: true }); return; }
          if (taken) { done = true; stop(); onMatch({ host: true, partner: taken }); return; }
          lost = 0;
          if (!hb) { // 自分が待つ側になった。相手から合言葉が届くのを待つ
            mine.on('value', got);
            hb = setInterval(beat, HEARTBEAT);
          }
        }, false);
        // 20 秒ごとに「まだいる」を書く。裏に回したタブなどで更新が遅れ、待つ場所を別の人に取られていたら（探しているのに
        // 待つ場所にいない状態）、もう一度並び直す。取られた直後は合言葉が届く途中かもしれないので、2 回続いたときだけ
        const beat = () => lobby.transaction((cur) => (cur && cur.u === me ? { u: me, t: now() } : undefined), (err, committed) => {
          if (done || err || committed) { lost = 0; return; }
          if (++lost >= 2) tryMatch();
        }, false);
        tryMatch();
        return () => {
          if (done) return;
          done = true; stop();
          lobby.transaction((cur) => (cur && cur.u === me ? null : undefined));
        };
      },
      pair(partner, code) { return db.ref('match/pairs/' + partner).set({ code, t: fb.database.ServerValue.TIMESTAMP }); },
      // 観戦：対戦が始まったら部屋を作った人が出し、終わったら結果を書く（抜けたら消す）
      livePut(info) {
        if (!ref) return;
        liveRef = db.ref('live/' + ref.key);
        liveRef.onDisconnect().remove();
        liveRef.set({ ...info, t: fb.database.ServerValue.TIMESTAMP }).catch(() => {});
      },
      liveEnd(r) { if (liveRef) liveRef.update({ r }).catch(() => {}); },
      async liveList() {
        online(); const u = uses;
        const snap = await db.ref('live').orderByChild('t').limitToLast(30).get();
        const out = []; snap.forEach((c) => { const v = c.val(); if (v && !v.r && now() - v.t < LIVE_MAX) out.push({ code: c.key, ...v }); });
        idle(u);
        return out.reverse();
      },
      // ランダムマッチ・ランクマッチに今いる人：探している人の数と、対戦中の数
      async peek() {
        online(); const u = uses;
        const [a, b, l] = await Promise.all([db.ref('match/random/seek').get(), db.ref('match/rank/seek').get(),
          db.ref('live').orderByChild('t').limitToLast(50).get().catch(() => null)]); // 観戦のルールを入れる前でも、待っている人の数は出す
        const live = { random: 0, rank: 0 };
        if (l) l.forEach((c) => { const v = c.val(); if (v && !v.r && now() - v.t < LIVE_MAX && live[v.k] !== undefined) live[v.k]++; });
        idle(u);
        return { random: { wait: a.numChildren(), live: live.random }, rank: { wait: b.numChildren(), live: live.rank } };
      },
      // 観戦する：今までの手と、これからの手を onMove に、結果を onLive に届ける
      async watch(code, h) {
        online();
        const r = db.ref('rooms/' + code), v = (await r.child('settings').get()).val(), host = (await r.child('host').get()).val();
        if (!v) throw new Error('その対局は終わりました');
        watching = true;
        const moves = r.child('moves'), live = db.ref('live/' + code), wme = r.child('watch/' + me);
        const add = (s) => h.onMove(s.val()), lv = (s) => h.onLive(s.val());
        moves.on('child_added', add); live.on('value', lv);
        wme.onDisconnect().remove(); wme.set(true).catch(() => {});
        return {
          settings: v, host,
          stop() {
            moves.off('child_added', add); live.off('value', lv);
            wme.onDisconnect().cancel(); watching = false;
            const u = uses;
            withTimeout(wme.remove(), 3000).catch(() => {}).finally(() => idle(u));
          },
        };
      },
      async getRating() { db.goOnline(); return (await db.ref('ratings/' + me).get()).val(); },
      async setRating(v) { db.goOnline(); return db.ref('ratings/' + me).set({ ...v, t: fb.database.ServerValue.TIMESTAMP }); },
      async topRatings(n) {
        db.goOnline();
        const snap = await db.ref('ratings').orderByChild('r').limitToLast(n).get();
        const out = []; snap.forEach((c) => { out.push({ u: c.key, ...c.val() }); });
        return out.reverse();
      },
      // 自分の棋譜を足して、新しい 5 局だけ残す
      async saveKifu(k) {
        db.goOnline();
        const ref = db.ref('kifus/' + me);
        await ref.push({ ...k, t: fb.database.ServerValue.TIMESTAMP });
        const snap = await ref.orderByKey().get();
        const keys = []; snap.forEach((c) => { keys.push(c.key); });
        await Promise.all(keys.slice(0, Math.max(0, keys.length - 5)).map((key) => ref.child(key).remove()));
      },
      async listKifus(u) {
        db.goOnline();
        const snap = await db.ref('kifus/' + u).orderByKey().limitToLast(5).get();
        const out = []; snap.forEach((c) => { out.push(c.val()); });
        return out.reverse(); // 新しい順
      },
      // ---- 記録の引き継ぎ（Google 連携）----
      account() {
        const u = auth.currentUser, pd = (u && u.providerData) || [], g = pd.find((p) => p.providerId === 'google.com');
        return { linked: !!g, email: g ? g.email : '', code: pd.some((p) => p.providerId === 'password') };
      },
      // 引き継ぎコード：個人情報を使わず、ランダムな ID とパスワードで今の記録につなぐ（中身はメール・パスワードのログイン。メールは送らない）
      async issueCode() {
        const u = auth.currentUser, has = u.providerData.some((p) => p.providerId === 'password');
        const pass = randCode(8);
        if (has) { await u.updatePassword(pass); return codeOf(u.providerData.find((p) => p.providerId === 'password').email, pass); }
        const id = randCode(8);
        await u.linkWithCredential(fb.auth.EmailAuthProvider.credential(codeMail(id), pass));
        return codeOf(codeMail(id), pass);
      },
      async useCode(code) { const c = splitCode(code); await auth.signInWithEmailAndPassword(codeMail(c.id), c.pass); },
      // 今の匿名の記録を Google アカウントにつなぐ（ID は変わらない）。
      // その Google アカウントが別の記録とつながっていたら { other: 資格情報 } を返す（切り替えるかは app.js で聞く）
      async linkGoogle() {
        const provider = new fb.auth.GoogleAuthProvider();
        try { await auth.currentUser.linkWithPopup(provider); return { ok: true }; } catch (e) {
          if (e.code === 'auth/credential-already-in-use' && e.credential) return { other: e.credential };
          throw e;
        }
      },
      async unlinkGoogle() { await auth.currentUser.unlink('google.com'); },
      async switchTo(credential) { await auth.signInWithCredential(credential); }, // 前の記録に切り替える（ページを読み直して使う）
      async saveProfile(v) { db.goOnline(); return db.ref('users/' + me).update({ ...v, t: fb.database.ServerValue.TIMESTAMP }); },
      async loadProfile() { db.goOnline(); return (await db.ref('users/' + me).get()).val(); },
      // シーズンの結果（締め切りで GitHub Actions が書く）：{ closed, results: { uid: { rank, name, r } } }。まだなら null
      async seasonResults(id) { db.goOnline(); return (await db.ref('seasons/s' + id).get()).val(); },
      async founders() { db.goOnline(); const v = (await db.ref('founders').get()).val() || {}; return { count: v.count || 0, list: v.list || {} }; },
      // 初代デストロイヤー：番号札（count）を 1 つ進めて、自分の番号を同時に書く。ほかの人と同時だったら読み直してやり直す
      async claimFounder(max) {
        db.goOnline();
        for (let i = 0; i < 6; i++) {
          const v = (await db.ref('founders').get()).val() || {};
          if (v.list && v.list[me]) return v.list[me];
          const n = (v.count || 0) + 1; if (n > max) return 0;
          try { await db.ref('founders').update({ count: n, ['list/' + me]: n }); return n; } catch (e) { /* 同時に取られた。やり直す */ }
        }
        return 0;
      },
      // 深淵の開拓者：破壊の迷宮の深淵層の最深部を最初に突破した先着の人（しくみは初代デストロイヤーと同じ）
      async pioneers() { db.goOnline(); const v = (await db.ref('pioneers').get()).val() || {}; return { count: v.count || 0, list: v.list || {} }; },
      async claimPioneer(max) {
        db.goOnline();
        for (let i = 0; i < 6; i++) {
          const v = (await db.ref('pioneers').get()).val() || {};
          if (v.list && v.list[me]) return v.list[me];
          const n = (v.count || 0) + 1; if (n > max) return 0;
          try { await db.ref('pioneers').update({ count: n, ['list/' + me]: n }); return n; } catch (e) { /* 同時に取られた。やり直す */ }
        }
        return 0;
      },
      leave() {
        offs.forEach((f) => f()); offs = [];
        if (liveRef) { liveRef.onDisconnect().cancel(); liveRef.remove().catch(() => {}); liveRef = null; }
        if (ref) {
          ref.child('on/' + me).onDisconnect().cancel();
          // 「抜けた」を書き込んでから切る（書き込みが届かなくても、切れたときの設定で相手には伝わる）
          const done = ref.child('on/' + me).set(false), u = uses;
          withTimeout(done, 3000).catch(() => {}).finally(() => { if (u === uses) offline(); });
          ref = null;
        } else offline();
      },
    };
  }

  // ---------- 外から使う形 ----------
  // Online.create(settings, { onMove, onPeer }) → 合言葉 / Online.join(合言葉, ハンドラ) → 部屋の設定
  // Online.send(中身) / Online.leave()。onMove は自分が送った手も届く（u で見分ける）
  // 準備（部品の読み込み・ログイン）は 1 回だけ。同時に呼ばれても同じものを待つ（2 回走ると Firebase の初期化がぶつかる）
  let tp = null, tpWait = null;
  async function transport() {
    if (tp) return tp;
    if (!tpWait) tpWait = (useLocal ? Promise.resolve(localTransport()) : firebaseTransport()).catch((e) => { tpWait = null; throw e; });
    tp = await tpWait;
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
    // 観戦：対戦中の一覧・人数・見る（見るのをやめるときは戻り値の stop を呼ぶ）。livePut / liveEnd は部屋を作った人が呼ぶ
    livePut(info) { if (tp) tp.livePut(info); },
    liveEnd(r) { if (tp) tp.liveEnd(r); },
    async liveList() { return withTimeout(transport().then((t) => t.liveList()), LIMIT); },
    async peek() { return withTimeout(transport().then((t) => t.peek()), LIMIT, giveUp); },
    async watch(code, h) { return withTimeout(transport().then((t) => t.watch(code, h)), LIMIT, giveUp); },
    // レートとランキング（ランクマッチ）
    async getRating() { return withTimeout(transport().then((t) => t.getRating()), LIMIT); },
    async setRating(v) { return (await transport()).setRating(v); },
    async topRatings(n = 50) { return withTimeout(transport().then((t) => t.topRatings(n)), LIMIT); },
    async saveKifu(k) { return (await transport()).saveKifu(k); },
    async listKifus(u) { return withTimeout(transport().then((t) => t.listKifus(u)), LIMIT); },
    async seasonResults(id) { return withTimeout(transport().then((t) => t.seasonResults(id)), LIMIT); },
    // 初代デストロイヤー（ランクマッチを最初に終えた先着の人）
    async founders() { return withTimeout(transport().then((t) => t.founders()), LIMIT); },
    async claimFounder(max) { return withTimeout(transport().then((t) => t.claimFounder(max)), LIMIT); },
    async pioneers() { return withTimeout(transport().then((t) => t.pioneers()), LIMIT); },
    async claimPioneer(max) { return withTimeout(transport().then((t) => t.claimPioneer(max)), LIMIT); },
    // 記録の引き継ぎ。ready() で先に準備しておく（Google のログイン画面は、ボタンを押してすぐ開かないと止められる）
    async ready() { return withTimeout(transport(), LIMIT); },
    account() { return tp ? tp.account() : { linked: false, email: '' }; },
    linkGoogle() { return tp.linkGoogle(); },
    async switchTo(c) { return tp.switchTo(c); },
    issueCode() { return tp.issueCode(); },
    unlinkGoogle() { return tp.unlinkGoogle(); },
    useCode(code) { return tp.useCode(code); },
    async saveProfile(v) { return (await transport()).saveProfile(v); },
    async loadProfile() { return withTimeout(transport().then((t) => t.loadProfile()), LIMIT); },
  };
  root.Online = Online;
})(this);
