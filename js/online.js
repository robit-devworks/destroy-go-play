// オンライン対戦の通信（合言葉の部屋に 2 人が入り、打った手を順番に送り合う）
//  ・ふだんは Firebase Realtime Database を使う（設定は edition.js の firebase）。「オンライン対戦」を押したときだけ読み込んでつなぐ
//  ・URL に ?online=local を付けると、同じブラウザの別タブどうしでつなぐ（Firebase なしで試す・自動テスト用）
// 部屋のデータ：rooms/{合言葉} = { host, guest, created, settings, moves: { 送った順: { u: 送った人, ...中身 } }, on: { 人: true } }
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
    };
  }

  // ---------- Firebase ----------
  async function firebaseTransport() {
    if (!root.firebase) for (const s of SDK) await loadScript(s);
    const fb = root.firebase;
    const app = fb.apps.length ? fb.app() : fb.initializeApp(ed.firebase);
    const cred = await app.auth().signInAnonymously();
    const me = cred.user.uid, db = app.database();
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
    return {
      me,
      async create(settings, h) {
        for (let tries = 0; tries < 20; tries++) {
          const code = randomCode(), r = db.ref('rooms/' + code);
          try {
            await r.update({ host: me, created: fb.database.ServerValue.TIMESTAMP, settings });
          } catch (e) { // 使われている合言葉。古い部屋なら消して使い直す
            const old = (await r.child('created').get()).val();
            if (old && Date.now() - old > ROOM_TTL) { try { await r.remove(); } catch (err) { /* 別の合言葉で */ } }
            continue;
          }
          ref = r; listen(h);
          return code;
        }
        throw new Error('部屋を作れませんでした。少ししてからもう一度試してください');
      },
      async join(code, h) {
        const r = db.ref('rooms/' + code);
        const snap = await r.get();
        const v = snap.val();
        if (!v || !v.host || Date.now() - (v.created || 0) > ROOM_TTL) throw new Error('その合言葉の部屋が見つかりません');
        if (v.guest && v.guest !== me) throw new Error('その部屋はもう2人そろっています');
        if (!v.guest) await r.child('guest').set(me);
        ref = r; listen(h);
        return v.settings;
      },
      send(v) { const m = { ...v, u: me }; if (ref) ref.child('moves').push(m); return m; },
      leave() {
        offs.forEach((f) => f()); offs = [];
        if (ref) { ref.child('on/' + me).onDisconnect().cancel(); ref.child('on/' + me).set(false); ref = null; }
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
  const Online = {
    available: () => useLocal || !!(ed.firebase && ed.firebase.databaseURL),
    me: () => (tp ? tp.me : null),
    async create(settings, h) { return (await transport()).create(settings, h); },
    async join(code, h) { return (await transport()).join(code, h); },
    send(v) { return tp ? tp.send(v) : null; },
    leave() { if (tp) tp.leave(); },
  };
  root.Online = Online;
})(this);
