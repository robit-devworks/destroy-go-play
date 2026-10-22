// 石を取ったときのド派手演出（取った数でレベルが上がり、テーマごとに見た目が変わる）
(function (root) {
  'use strict';

  // 取った数 → 演出レベル。hold は次の手番の時計を止めておく時間（ms）
  const TIERS = [
    { min: 1,  hold: 0,    shake: 0,  flash: 0,    parts: 40,  rings: 1 },
    { min: 2,  hold: 400,  shake: 4,  flash: 0.2,  parts: 70,  rings: 1 },
    { min: 3,  hold: 600,  shake: 7,  flash: 0.3,  parts: 90,  rings: 2 },
    { min: 4,  hold: 1100, shake: 12, flash: 0.5,  parts: 140, rings: 3 },
    { min: 7,  hold: 1700, shake: 18, flash: 0.7,  parts: 220, rings: 4 },
    { min: 12, hold: 2700, shake: 26, flash: 0.85, parts: 320, rings: 6 },
    { min: 20, hold: 3900, shake: 36, flash: 1,    parts: 450, rings: 9 },
  ];
  const ULTRA = 5, GOD = 6;
  const COMMON_NAMES = ['GET!', 'DOUBLE!!', 'TRIPLE!!'];
  const tierIndex = (n) => { let t = -1; TIERS.forEach((x, i) => { if (n >= x.min) t = i; }); return t; };

  // names / subs は レベル 3〜6（DESTROY 以上）の表示
  const THEMES = {
    default: {
      label: 'デストロイ', mark: '破', color: '#ff4b1f', shield: '#8a8f98', // 盾マークは炎と区別がつくよう灰色
      tierColors: ['#ffd84a', '#ffb02e', '#ff8a1f', '#ff4b1f', '#ff1f6d', '#ff3b3b', '#ffffff'],
      names: ['DESTROY!!!', 'MEGA DESTROY!!!', 'ULTRA DESTROY!!!!', '破壊神降臨'],
      subs: ['デストロイ', 'メガ・デストロイ', 'ウルトラ・デストロイ', 'GOD OF DESTRUCTION'],
      flash: ['#ffffff', '#e0e2ea', '#ff2a3a', '#140008'], vignette: 'meteor',
    },
    fire: {
      label: '炎', mark: '炎', color: '#ff6a00', palette: ['#ffdd55', '#ff9a1f', '#ff5a00', '#ff2a00'],
      names: ['BURN!!!', 'MEGA INFERNO!!!', 'ULTRA INFERNO!!!!', '炎神降臨'],
      subs: ['焼き尽くせ', 'メガ・インフェルノ', 'ウルトラ・インフェルノ', 'GOD OF FLAME'],
      flash: ['#fff2c0', '#ff9a1f', '#ff3300', '#7a0000'], vignette: 'fire',
    },
    ice: {
      label: '氷', mark: '氷', color: '#5ad8ff', palette: ['#ffffff', '#bff3ff', '#5ad8ff', '#2a8cff'],
      names: ['FREEZE!!!', 'MEGA BLIZZARD!!!', 'ULTRA BLIZZARD!!!!', '氷神降臨'],
      subs: ['凍てつけ', 'メガ・ブリザード', 'ウルトラ・ブリザード', 'GOD OF ICE'],
      flash: ['#ffffff', '#bff3ff', '#5ad8ff', '#0a2a6a'], vignette: 'ice',
    },
    thunder: {
      label: '雷', mark: '雷', color: '#ffe94a', palette: ['#ffffff', '#fff59a', '#ffe94a', '#7ad7ff'],
      names: ['SHOCK!!!', 'MEGA THUNDER!!!', 'ULTRA THUNDER!!!!', '雷神降臨'],
      subs: ['痺れろ', 'メガ・サンダー', 'ウルトラ・サンダー', 'GOD OF THUNDER'],
      flash: ['#ffffff', '#fff59a', '#7ad7ff', '#10103a'], vignette: 'storm',
    },
    dark: {
      label: '闇', mark: '闇', color: '#b066ff', palette: ['#e0c8ff', '#b066ff', '#7a2cff', '#ff66e0'],
      names: ['VOID!!!', 'MEGA VOID!!!', 'ULTRA VOID!!!!', '闇神降臨'],
      subs: ['呑み込め', 'メガ・ヴォイド', 'ウルトラ・ヴォイド', 'GOD OF DARKNESS'],
      flash: ['#e0c8ff', '#7a2cff', '#2a0050', '#000000'], vignette: 'void',
    },
    light: {
      label: '光', mark: '光', color: '#ffe7a3', palette: ['#ffffff', '#fff6d8', '#ffe7a3', '#ffd36a', '#bfe8ff'],
      names: ['HOLY!!!', 'MEGA HOLY!!!', 'ULTRA HOLY!!!!', '光神降臨'],
      subs: ['昇天せよ', 'メガ・ホーリー', 'ウルトラ・ホーリー', 'GOD OF LIGHT'],
      flash: ['#ffffff', '#fff6d8', '#ffe7a3', '#fff0c0'], vignette: 'holy',
    },
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const frames = (ms) => Math.max(1, Math.round(ms / 16.67));
  let generation = 0; // clear() で増やし、それより前に予約された演出は出さない
  const timers = new Set(); // 予約中の演出（まだ画面に出ていないもの）
  // ため撃ち（長押し）の勢い。演出中に出る破片・火花などの飛ぶ速さに掛ける。予約した演出にも引き継ぐ
  let boostNow = 1;
  const BOOSTED = new Set(['stone', 'chunk', 'dust', 'shard', 'spark', 'dot', 'star']);
  const later = (ms, fn) => {
    if (ms <= 0) return fn();
    const gen = generation, boost = boostNow;
    const id = setTimeout(() => {
      timers.delete(id);
      if (gen !== generation) return;
      const prev = boostNow; boostNow = boost;
      try { fn(); } finally { boostNow = prev; }
      kick();
    }, ms);
    timers.add(id);
  };

  // ---------- サウンド（WebAudio で合成、音源ファイル不要） ----------
  let ctx = null, muted = false, volume = 1;
  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      // 重低音を重ねても音割れしないよう、全体をコンプレッサーに通す
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 8;
      comp.attack.value = 0.002; comp.release.value = 0.25;
      // 効果音の音量（設定で変える）。録音もコンプレッサーのあとも、すべてここを通す
      ctx.master = ctx.createGain(); ctx.master.gain.value = volume;
      ctx.master.connect(ctx.destination);
      comp.connect(ctx.master);
      ctx.out = comp;
    }
    if (ctx.state === 'suspended') ctx.resume();
    unmuteIOS();
    return ctx;
  }
  // iPhone は消音スイッチ（マナーモード）がオンだと WebAudio の音が鳴らない。
  // 音声の種類を「再生」にし（Safari 17 以降）、古い iOS 向けに無音の <audio> を流し続けると、消音スイッチ中でも鳴る
  let iosAudio = null;
  function unmuteIOS() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 未対応 */ }
    if (iosAudio) { if (iosAudio.paused) iosAudio.play().catch(() => {}); return; }
    const rate = 8000, n = rate / 2, buf = new Uint8Array(44 + n); // 0.5 秒の無音 WAV（8bit モノラル）
    const dv = new DataView(buf.buffer), str = (o, t) => [...t].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate, true);
    dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); str(36, 'data'); dv.setUint32(40, n, true);
    buf.fill(128, 44);
    let bin = ''; buf.forEach((v) => { bin += String.fromCharCode(v); });
    iosAudio = document.createElement('audio');
    iosAudio.src = 'data:audio/wav;base64,' + btoa(bin);
    iosAudio.loop = true; iosAudio.setAttribute('playsinline', ''); iosAudio.setAttribute('x-webkit-airplay', 'deny');
    iosAudio.play().catch(() => {});
  }
  function noiseBuffer(a, sec, density = 1) {
    const b = a.createBuffer(1, Math.max(1, a.sampleRate * sec), a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() < density ? Math.random() * 2 - 1 : 0;
    return b;
  }
  // フィルタ付きノイズを鳴らす共通処理
  function noiseHit(a, t, { dur, type = 'lowpass', f0, f1 = f0, q = 1, vol, density = 1 }) {
    const src = a.createBufferSource(); src.buffer = noiseBuffer(a, dur, density);
    const f = a.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(a.out); src.start(t);
  }
  function tone(a, t, { type = 'sine', f0, f1 = f0, dur, vol }) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.out); o.start(t); o.stop(t + dur);
  }
  // 録音した効果音（js/sounds.js に埋め込み）。
  // 最初のタップを待たずにページを開いた時点で読み込みを始める（読み込み用の OfflineAudioContext は
  // ユーザー操作なしで作れ、できた AudioBuffer は再生用の AudioContext でもそのまま使える）
  const samples = {}, decoding = {};
  (function loadSamples() {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    let dec;
    try { dec = new Ctx(2, 44100, 44100); } catch (e) { return; }
    for (const [key, b64] of Object.entries(root.GAME_SOUNDS || {})) {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      decoding[key] = new Promise((resolve) => {
        dec.decodeAudioData(bytes.buffer, (buf) => { samples[key] = buf; resolve(buf); }, () => resolve(null));
      });
    }
  })();
  // 録音はコンプレッサーを通さず、そのままの音で鳴らす。読み込み中なら終わるのを待って鳴らす
  const playing = new Set();
  function playSample(key, delay = 0) {
    const start = (buf, d) => sfx((a, t) => {
      const src = a.createBufferSource(); src.buffer = buf;
      src.connect(a.master); src.start(t);
      playing.add(src); src.onended = () => playing.delete(src);
    }, d);
    if (samples[key]) { start(samples[key], delay); return; }
    if (!decoding[key]) return;
    const gen = generation, t0 = performance.now();
    decoding[key].then((buf) => {
      if (buf && gen === generation) start(buf, Math.max(0, delay - (performance.now() - t0) / 1000));
    });
  }
  // デストロイの録音：段階ごとに 1 つずつ。その段階の音声ファイルがなければ、ひとつ下の段階の音を使う
  const DESTROY_SAMPLE = ['destroy-get', 'destroy-double', 'destroy-triple', 'destroy-destroy', 'destroy-mega', 'destroy-ultra', 'destroy-god'];
  function destroySample(ti) {
    for (let i = ti; i >= 0; i--) if (decoding[DESTROY_SAMPLE[i]]) return DESTROY_SAMPLE[i];
    return null;
  }
  const hasDestroySample = (ti) => !!destroySample(ti);

  function sfx(fn, delay = 0) { const a = ac(); if (!a || muted) return; fn(a, a.currentTime + delay); }

  function boom(power, delay = 0) { // power 0..1
    sfx((a, t) => {
      const dur = 0.4 + power * 2.2;
      noiseHit(a, t, { dur, f0: 800 + power * 4000, f1: 60, vol: 0.25 + power * 0.5 });
      tone(a, t, { f0: 90 + power * 40, f1: 28, dur: dur * 0.8, vol: 0.3 + power * 0.6 });
    }, delay);
  }
  // 歪ませた波形（打撃音に芯を出す）
  function distCurve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    return curve;
  }
  // 殴った音：パシッという破裂音＋ドゴッという短い打撃音。余韻は残さない
  function punch(power, delay = 0) {
    sfx((a, t) => {
      noiseHit(a, t, { dur: 0.018, type: 'highpass', f0: 2500, vol: 0.8 });
      noiseHit(a, t, { dur: 0.07 + power * 0.04, type: 'bandpass', f0: 1300, f1: 380, q: 1.2, vol: 1 });
      const dur = 0.13 + power * 0.12;
      const o = a.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(190 + power * 30, t);
      o.frequency.exponentialRampToValueAtTime(52, t + dur);
      const sh = a.createWaveShaper(); sh.curve = distCurve(4 + power * 10);
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(sh).connect(g).connect(a.out); o.start(t); o.stop(t + dur);
    }, delay);
  }
  // 石が砕ける音：低めのバキッ＋破片が散る音
  function crush(power, delay = 0) {
    sfx((a, t) => {
      noiseHit(a, t, { dur: 0.22 + power * 0.3, type: 'bandpass', f0: 700, f1: 180, q: 0.9, vol: 0.95 });
      tone(a, t, { type: 'triangle', f0: 120, f1: 45, dur: 0.18, vol: 0.6 });
      noiseHit(a, t + 0.04, { dur: 0.45 + power * 0.8, type: 'bandpass', f0: 1600, f1: 500, q: 0.6, vol: 0.7, density: 0.05 });
    }, delay);
  }
  function crackle(power, delay = 0) {
    sfx((a, t) => noiseHit(a, t, { dur: 0.6 + power * 1.6, type: 'bandpass', f0: 2500, f1: 900, q: 0.7, vol: 0.9, density: 0.03 }), delay);
  }
  function whoosh(power, delay = 0) {
    sfx((a, t) => {
      const dur = 0.5 + power * 1.2;
      const src = a.createBufferSource(); src.buffer = noiseBuffer(a, dur);
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.4);
      f.frequency.exponentialRampToValueAtTime(300, t + dur);
      const g = a.createGain();
      g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.5 + power * 0.4, t + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g).connect(a.out); src.start(t);
    }, delay);
  }
  function shatter(power, delay = 0) {
    sfx((a, t) => {
      noiseHit(a, t, { dur: 0.25 + power * 0.3, type: 'highpass', f0: 3500, f1: 6000, vol: 0.45 });
      const pings = 3 + Math.floor(power * 9);
      for (let i = 0; i < pings; i++) tone(a, t + rnd(0, 0.35), { f0: rnd(2200, 6500), dur: rnd(0.08, 0.25), vol: 0.05 });
    }, delay);
  }
  function crack(power, delay = 0) {
    sfx((a, t) => {
      noiseHit(a, t, { dur: 0.12, type: 'highpass', f0: 1500, vol: 0.8 });
      noiseHit(a, t + 0.05, { dur: 1 + power * 2.2, f0: 400, f1: 40, vol: 0.4 + power * 0.4 });
    }, delay);
  }
  // 闇：渦に吸い込まれていく音（高い音から低い音へ落ちていくノイズ）と低いうなり
  function suck(power, delay = 0) {
    sfx((a, t) => {
      const dur = 0.7 + power * 1.6;
      const src = a.createBufferSource(); src.buffer = noiseBuffer(a, dur);
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(90, t + dur);
      const g = a.createGain();
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.7, t + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g).connect(a.out); src.start(t);
      const o = a.createOscillator(), og = a.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(32, t + dur);
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      og.gain.setValueAtTime(0.001, t); og.gain.exponentialRampToValueAtTime(0.45 + power * 0.3, t + dur * 0.6);
      og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(lp).connect(og).connect(a.out); o.start(t); o.stop(t + dur);
    }, delay);
  }
  // 光：鐘のような和音（長三和音を何オクターブか重ねる）と、ふわっと広がる高い音
  function chime(power, delay = 0) {
    sfx((a, t) => {
      const base = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      const n = 3 + Math.round(power * 3);
      base.slice(0, n).forEach((f, i) => {
        tone(a, t + i * 0.05, { f0: f, dur: 1.2 + power * 1.5, vol: 0.07 });
        tone(a, t + i * 0.05, { f0: f * 2.01, dur: 0.6 + power, vol: 0.025 }); // 鐘らしい倍音
      });
      noiseHit(a, t, { dur: 1 + power * 1.5, type: 'highpass', f0: 5000, f1: 9000, vol: 0.12 + power * 0.1 });
    }, delay);
  }
  // 地鳴りのようにうなり続ける炎の音（音量が細かく揺れる）
  function roar(delay = 0, dur = 3) {
    sfx((a, t) => {
      const src = a.createBufferSource(); src.buffer = noiseBuffer(a, dur);
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280; f.Q.value = 1.2;
      const g = a.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.75, t + 0.4); g.gain.linearRampToValueAtTime(0.5, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.001, t + dur);
      const lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = 7; lg.gain.value = 0.25;
      lfo.connect(lg).connect(g.gain); lfo.start(t); lfo.stop(t + dur);
      src.connect(f).connect(g).connect(a.out); src.start(t);
    }, delay);
  }
  function blip(freq, len = 0.08, type = 'square', vol = 0.12, delay = 0) {
    sfx((a, t) => tone(a, t, { type, f0: freq, dur: len, vol }), delay);
  }
  // 対局開始の合図：ドンッという打撃音だけ
  function gameStart() {
    punch(0.7);
  }
  // デストロイルールで HP が回復したとき：短く「キラン」と光る音（音程を並べて鳴らす「ピロピロ」にはしない）
  function heal() {
    sfx((a, t) => {
      tone(a, t, { f0: 1568, f1: 1760, dur: 0.35, vol: 0.09 });
      tone(a, t, { f0: 3136, f1: 3520, dur: 0.22, vol: 0.035 });
      noiseHit(a, t, { dur: 0.25, type: 'highpass', f0: 6000, f1: 9000, vol: 0.06 });
    });
  }
  function stoneClick() {
    sfx((a, t) => noiseHit(a, t, { dur: 0.05, type: 'bandpass', f0: 2400, q: 3, vol: 0.6 }));
  }

  // テーマ別の大技（ULTRA 以上）の音。g が true なら神降臨（より長く強く）
  const THEME_BIG_SOUND = {
    fire(g) { // 炎の轟音が長く続き、パチパチと燃える。炎神降臨は、うなる炎の音と溶岩のはぜる音を足す
      sfx((a, t) => noiseHit(a, t, { dur: g ? 3.2 : 2.2, f0: 700, f1: 120, q: 0.8, vol: g ? 0.8 : 0.6 }), 0.3);
      whoosh(1, 0.4); crackle(1, 0.6);
      if (!g) return;
      roar(0.5, 3.2);
      [1.0, 1.5, 2.0, 2.6].forEach((d) => crackle(1, d));
      [1.2, 2.1].forEach((d) => whoosh(1, d));
      sfx((a, t) => { // 溶岩がはぜるポンポンという細かい音
        for (let i = 0; i < 40; i++) noiseHit(a, t + rnd(0, 3), { dur: rnd(0.02, 0.06), type: 'bandpass', f0: rnd(300, 1400), q: 3, vol: rnd(0.2, 0.45) });
      }, 0.5);
    },
    ice(g) { // ガラスが連続して割れ落ち、吹雪の風が吹き抜ける
      [0.45, 0.75, 1.05, 1.35].concat(g ? [1.65, 1.95, 2.25] : []).forEach((d, i) => shatter(0.5 + i * 0.08, d));
      sfx((a, t) => {
        const dur = g ? 3 : 2.2, src = a.createBufferSource(); src.buffer = noiseBuffer(a, dur);
        const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
        f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(1800, t + dur * 0.5); f.frequency.linearRampToValueAtTime(700, t + dur);
        const gn = a.createGain(); gn.gain.setValueAtTime(0.001, t); gn.gain.linearRampToValueAtTime(0.35, t + dur * 0.4); gn.gain.linearRampToValueAtTime(0.001, t + dur);
        src.connect(f).connect(gn).connect(a.out); src.start(t);
      }, 0.3);
    },
    thunder(g) { // 落雷のバリバリッと、長く響く遠雷
      crack(1, 0.55); crack(0.8, g ? 1.0 : 1.3); if (g) crack(1, 1.6);
      sfx((a, t) => noiseHit(a, t, { dur: g ? 3.8 : 2.8, f0: 320, f1: 35, q: 0.6, vol: 0.55 }), 0.8);
    },
    dark() {}, // 闇は渦が潰れるときに専用の音（implode）を鳴らす
    light(g) { // 天使の合唱のような和音と、高く昇っていくきらめき
      sfx((a, t) => {
        const dur = g ? 3.4 : 2.4;
        [261.63, 329.63, 392, 523.25, 659.25].forEach((f) => {
          const o = a.createOscillator(), gn = a.createGain();
          o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.detune.setValueAtTime(rnd(-8, 8), t);
          gn.gain.setValueAtTime(0.001, t); gn.gain.linearRampToValueAtTime(0.07, t + dur * 0.35); gn.gain.linearRampToValueAtTime(0.001, t + dur);
          o.connect(gn).connect(a.out); o.start(t); o.stop(t + dur);
        });
        tone(a, t + 0.3, { f0: 800, f1: 3200, dur: dur * 0.8, vol: 0.05 });
      }, 0.4);
      if (g) chime(1, 1.4);
    },
  };
  // 闇の渦が潰れる音：吸い込みの最後に、内側へ「ズゥン」と潰れる
  function implode(power, delay = 0) {
    sfx((a, t) => {
      tone(a, t, { f0: 160, f1: 28, dur: 0.5 + power * 0.4, vol: 0.85 });
      noiseHit(a, t, { dur: 0.35, type: 'bandpass', f0: 300, f1: 60, q: 1.2, vol: 0.6 });
      tone(a, t + 0.05, { type: 'sine', f0: 1200, f1: 200, dur: 0.25, vol: 0.06 });
    }, delay);
  }

  // テーマ別の「取った瞬間」の音
  const THEME_SOUND = {
    default(p, ti) { // 石が砕けるタイミング（ひびが入った後）に合わせて鳴らす
      const d = ti >= ULTRA ? 0 : 0.16;
      if (hasDestroySample(ti)) { playSample(destroySample(ti), d); return; }
      punch(Math.max(0.4, p), d); crush(p, d);
      // 何個も取ったときは連打して、最後に重い一撃
      const combo = Math.min(ti + 1, 6);
      for (let i = 1; i < combo; i++) punch(0.35, d + i * 0.075);
      if (ti >= 3) punch(1, d + combo * 0.075 + 0.08);
    },
    fire(p, ti) { whoosh(p); crackle(p, 0.1); if (ti >= 3) crackle(p, 0.5); },
    ice(p, ti) { shatter(p); if (ti >= 3) shatter(p, 0.3); },
    thunder(p, ti) { crack(p); if (ti >= 3) crack(p, 0.35); },
    dark(p, ti) { suck(p); if (ti >= 3) suck(p * 0.7, 0.3); },
    light(p, ti) { chime(p, 0.15); if (ti >= 3) chime(Math.min(1, p + 0.3), 0.6); },
  };

  // ---------- 描画レイヤー ----------
  const canvas = document.getElementById('fx');
  const c2 = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize); resize();

  let parts = [], rings = [], bolts = [], emitters = [], running = false;
  const MAX_PARTS = 3000;

  function spawn(p) {
    if (parts.length >= MAX_PARTS && !p.onDeath) return;
    const q = Object.assign({ t: 0, rot: 0, vr: 0, g: 0, drag: 1, vx: 0, vy: 0 }, p);
    if (boostNow !== 1 && BOOSTED.has(q.kind) && !q.static && !q.onDeath) { q.vx *= boostNow; q.vy *= boostNow; q.vr *= boostNow; }
    parts.push(q);
  }
  // 一定フレームの間、毎フレーム fn(t) を呼ぶ
  function emit(life, fn) { emitters.push({ t: 0, life, fn }); }
  function ring(x, y, r1, color, { w = 12, life = 40, delay = 0, r0 = 4 } = {}) {
    rings.push({ x, y, r0, r1, w, t: -delay, life, color });
  }
  function boltBetween(x1, y1, x2, y2, color, { life = 18, width = 3, jag = 30 } = {}) {
    const pts = [], steps = Math.max(6, Math.round(Math.hypot(x2 - x1, y2 - y1) / 40));
    for (let i = 0; i <= steps; i++) {
      const k = i / steps, j = i === 0 || i === steps ? 0 : jag;
      pts.push([x1 + (x2 - x1) * k + rnd(-j, j), y1 + (y2 - y1) * k + rnd(-j, j) * 0.3]);
    }
    bolts.push({ pts, t: 0, life, color, width });
    // 枝分かれ
    if (width > 2 && Math.random() < 0.7) {
      const s = pts[Math.floor(rnd(1, pts.length - 1))];
      boltBetween(s[0], s[1], s[0] + rnd(-120, 120), s[1] + rnd(40, 140), color, { life, width: width * 0.5, jag: jag * 0.6 });
    }
  }
  const lightning = (x, y, color, opt) => boltBetween(x + rnd(-W, W) * 0.3, -20, x, y, color, opt);

  function drawStoneSprite(p, alpha) {
    c2.globalCompositeOperation = 'source-over';
    c2.globalAlpha = alpha;
    c2.save(); c2.translate(p.x, p.y); c2.rotate(p.rot);
    let s = p.size * (p.static || p.attract ? 1 : 1 + (p.t / p.life) * 0.6);
    if (p.burning) s *= 1 - 0.75 * Math.max(0, (p.t / p.life - 0.35) / 0.65); // 燃えながら縮んでいく
    const grd = c2.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s);
    if (p.white) { grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#b9b4a8'); }
    else { grd.addColorStop(0, '#666'); grd.addColorStop(1, '#050505'); }
    c2.fillStyle = grd; c2.beginPath(); c2.ellipse(0, 0, s, s * (p.static ? 1 : 0.85), 0, 0, Math.PI * 2); c2.fill();
    if (p.burning) { // 燃えている石：だんだん焦げて赤く光る
      const k = Math.min(1, p.t / (p.life * 0.6));
      c2.fillStyle = `rgba(40,10,0,${0.7 * k})`;
      c2.beginPath(); c2.arc(0, 0, s, 0, Math.PI * 2); c2.fill();
      c2.globalCompositeOperation = 'lighter';
      const glow = c2.createRadialGradient(0, 0, s * 0.3, 0, 0, s * 1.6);
      glow.addColorStop(0, `rgba(255,120,20,${0.5 * k})`); glow.addColorStop(1, 'rgba(255,60,0,0)');
      c2.fillStyle = glow; c2.beginPath(); c2.arc(0, 0, s * 1.6, 0, Math.PI * 2); c2.fill();
      c2.globalCompositeOperation = 'source-over';
    }
    if (p.frozen) { // 凍った石：氷のコーティング
      const k = Math.min(1, p.t / 12);
      c2.fillStyle = `rgba(170,235,255,${0.55 * k})`;
      c2.beginPath(); c2.arc(0, 0, s * 1.15, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = `rgba(255,255,255,${0.9 * k})`; c2.lineWidth = 1.5;
      c2.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c2.moveTo(0, 0); c2.lineTo(Math.cos(a) * s * 1.1, Math.sin(a) * s * 1.1); }
      c2.stroke();
    }
    if (p.holy) { // 光に包まれて、だんだん光そのものになっていく石
      const k = Math.min(1, p.t / (p.life * 0.6));
      c2.globalCompositeOperation = 'lighter';
      c2.fillStyle = `rgba(255,248,220,${0.25 + 0.6 * k})`;
      c2.beginPath(); c2.arc(0, 0, s * 1.05, 0, Math.PI * 2); c2.fill();
      const halo = c2.createRadialGradient(0, 0, s, 0, 0, s * 2.2);
      halo.addColorStop(0, 'rgba(255,230,150,0.6)'); halo.addColorStop(1, 'rgba(255,230,150,0)');
      c2.fillStyle = halo; c2.beginPath(); c2.arc(0, 0, s * 2.2, 0, Math.PI * 2); c2.fill();
      c2.globalCompositeOperation = 'source-over';
    }
    if (p.cracks) { // ひびが入っていく石
      const k = Math.min(1, p.t / (p.life * 0.8));
      c2.strokeStyle = p.white ? 'rgba(60,50,40,0.9)' : 'rgba(220,220,220,0.85)'; c2.lineWidth = 1.4;
      c2.beginPath();
      for (const cr of p.cracks) {
        c2.moveTo(0, 0);
        const m = Math.max(1, Math.ceil(cr.length * k));
        for (let i = 0; i < m; i++) c2.lineTo(cr[i][0] * s, cr[i][1] * s);
      }
      c2.stroke();
    }
    if (p.charged && Math.random() < 0.6) { // 帯電した石
      c2.strokeStyle = pick(['#fff59a', '#7ad7ff', '#ffffff']); c2.lineWidth = 2;
      c2.beginPath(); c2.arc(0, 0, s * rnd(1.05, 1.4), rnd(0, 6), rnd(0, 6) + 2); c2.stroke();
    }
    c2.restore();
  }

  function drawParticle(p) {
    const k = p.t / p.life, a = Math.max(0, 1 - k);
    switch (p.kind) {
      case 'stone': drawStoneSprite(p, p.static ? 1 : Math.min(1, a * 1.5)); return;
      case 'beam': { // 空から降りる光の柱
        const k = p.t / p.life, grow = Math.min(1, p.t / 8), a = Math.max(0, 1 - k);
        const w = p.size * (0.6 + 0.4 * grow);
        c2.globalCompositeOperation = 'lighter';
        c2.globalAlpha = a;
        const grd = c2.createLinearGradient(p.x - w, 0, p.x + w, 0);
        grd.addColorStop(0, 'rgba(255,230,150,0)'); grd.addColorStop(0.35, 'rgba(255,236,170,0.55)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.65, 'rgba(255,236,170,0.55)'); grd.addColorStop(1, 'rgba(255,230,150,0)');
        c2.fillStyle = grd;
        c2.fillRect(p.x - w, -10, w * 2, (p.y + 10) * grow + 10);
        return;
      }
      case 'star': { // 4 方向に光るきらめき
        const k = p.t / p.life, a = Math.sin(Math.min(1, k) * Math.PI), r = p.size * (0.6 + a * 0.6);
        c2.globalCompositeOperation = 'lighter';
        c2.globalAlpha = a;
        c2.fillStyle = p.color || '#fff';
        c2.beginPath();
        c2.moveTo(p.x, p.y - r * 2); c2.lineTo(p.x + r * 0.35, p.y - r * 0.35); c2.lineTo(p.x + r * 2, p.y);
        c2.lineTo(p.x + r * 0.35, p.y + r * 0.35); c2.lineTo(p.x, p.y + r * 2); c2.lineTo(p.x - r * 0.35, p.y + r * 0.35);
        c2.lineTo(p.x - r * 2, p.y); c2.lineTo(p.x - r * 0.35, p.y - r * 0.35); c2.closePath(); c2.fill();
        return;
      }
      case 'rays': { // 後光：回転する光の筋
        const k = p.t / p.life, a = Math.min(1, p.t / 15) * Math.min(1, (p.life - p.t) / 25);
        c2.globalCompositeOperation = 'lighter';
        c2.globalAlpha = a * 0.85;
        const n = p.count || 16, rot = p.t * (p.spin || 0.01);
        for (let i = 0; i < n; i++) {
          const ang = rot + (i * Math.PI * 2) / n, half = Math.PI / n * 0.45;
          const grd = c2.createRadialGradient(p.x, p.y, p.size * 0.1, p.x, p.y, p.size);
          grd.addColorStop(0, 'rgba(255,255,240,0.9)'); grd.addColorStop(0.5, 'rgba(255,230,160,0.35)'); grd.addColorStop(1, 'rgba(255,220,140,0)');
          c2.fillStyle = grd;
          c2.beginPath(); c2.moveTo(p.x, p.y);
          c2.arc(p.x, p.y, p.size * (0.85 + 0.15 * Math.sin(i * 1.7 + k * 6)), ang - half, ang + half);
          c2.closePath(); c2.fill();
        }
        return;
      }
      case 'hole': { // 闇の渦：黒い穴と、まわりを回る紫の光
        const grow = Math.min(1, p.t / 18), shrink = Math.min(1, (p.life - p.t) / 10);
        const r = p.size * grow * shrink;
        if (r <= 0.5) return;
        c2.globalCompositeOperation = 'lighter';
        c2.globalAlpha = 1;
        const glow = c2.createRadialGradient(p.x, p.y, r * 0.8, p.x, p.y, r * 2.6);
        glow.addColorStop(0, 'rgba(190,100,255,0.9)'); glow.addColorStop(0.4, 'rgba(120,40,220,0.45)'); glow.addColorStop(1, 'rgba(60,0,120,0)');
        c2.fillStyle = glow; c2.beginPath(); c2.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2); c2.fill();
        c2.lineWidth = Math.max(1.5, r * 0.08); c2.lineCap = 'round';
        for (let i = 0; i < 5; i++) { // 回転する光の筋
          const a0 = p.t * 0.12 + (i * Math.PI * 2) / 5, rr = r * (1.15 + i * 0.12);
          c2.strokeStyle = i % 2 ? 'rgba(255,120,240,0.8)' : 'rgba(200,150,255,0.85)';
          c2.beginPath(); c2.arc(p.x, p.y, rr, a0, a0 + 1.6); c2.stroke();
        }
        c2.globalCompositeOperation = 'source-over';
        const core = c2.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        core.addColorStop(0, '#000000'); core.addColorStop(0.75, '#05000c'); core.addColorStop(1, 'rgba(40,0,70,0.9)');
        c2.fillStyle = core; c2.beginPath(); c2.arc(p.x, p.y, r, 0, Math.PI * 2); c2.fill();
        return;
      }
      case 'volcano': { // 画面下からせり上がる火山
        const rise = 1 - Math.pow(1 - Math.min(1, p.t / 28), 3);
        const fade = Math.min(1, (p.life - p.t) / 30);
        const top = H - p.h * rise, half = p.w / 2, crater = p.w * 0.11;
        c2.globalCompositeOperation = 'source-over';
        c2.globalAlpha = fade;
        const body = c2.createLinearGradient(0, top, 0, H);
        body.addColorStop(0, '#6a2410'); body.addColorStop(0.45, '#3a140a'); body.addColorStop(1, '#160806');
        c2.fillStyle = body;
        // 頂上は真ん中がくぼんだ火口にする（噴き出しがそこから出ているように見せる）
        const dip = top + crater * 0.45;
        const outline = () => { c2.moveTo(p.x - half, H + 5); c2.lineTo(p.x - crater, top); c2.quadraticCurveTo(p.x, dip + crater * 0.25, p.x + crater, top); c2.lineTo(p.x + half, H + 5); };
        c2.beginPath(); outline(); c2.closePath(); c2.fill();
        // 赤く光る稜線と、斜面を流れる溶岩
        c2.globalCompositeOperation = 'lighter';
        c2.globalAlpha = fade * (0.75 + 0.25 * Math.sin(p.t * 0.3));
        c2.shadowColor = '#ff2a00'; c2.shadowBlur = 18;
        c2.strokeStyle = '#ff5a1a'; c2.lineWidth = 3;
        c2.beginPath(); outline(); c2.stroke();
        // 火口の中で煮えたぎる溶岩
        const pool = c2.createRadialGradient(p.x, top + crater * 0.2, 0, p.x, top + crater * 0.2, crater);
        pool.addColorStop(0, 'rgba(255,240,170,1)'); pool.addColorStop(0.5, 'rgba(255,120,20,0.95)'); pool.addColorStop(1, 'rgba(255,40,0,0)');
        c2.fillStyle = pool; c2.beginPath(); c2.ellipse(p.x, top + crater * 0.18, crater * 0.95, crater * 0.32, 0, 0, Math.PI * 2); c2.fill();
        c2.strokeStyle = '#ff4a10'; c2.lineWidth = 7;
        for (const lava of p.lava) {
          c2.beginPath();
          lava.forEach(([fx, fy], i) => { const x = p.x + fx * half, y = top + fy * (H - top); if (i) c2.lineTo(x, y); else c2.moveTo(x, y); });
          c2.stroke();
        }
        c2.shadowBlur = 0;
        const glow = c2.createRadialGradient(p.x, top, 0, p.x, top, p.w * 0.22);
        glow.addColorStop(0, 'rgba(255,220,120,0.95)'); glow.addColorStop(0.3, 'rgba(255,80,10,0.7)'); glow.addColorStop(1, 'rgba(255,30,0,0)');
        c2.fillStyle = glow; c2.beginPath(); c2.arc(p.x, top, p.w * 0.22, 0, Math.PI * 2); c2.fill();
        p.top = top;
        return;
      }
      case 'smoke':
        c2.globalCompositeOperation = 'source-over';
        c2.globalAlpha = a * (p.alpha || 0.45);
        c2.fillStyle = p.color || '#3c3632';
        c2.beginPath(); c2.arc(p.x, p.y, p.size * (1 + k * 2.2), 0, Math.PI * 2); c2.fill();
        return;
      case 'chunk': { // 粉砕された石のかけら（不規則な多角形）
        c2.globalCompositeOperation = 'source-over';
        c2.globalAlpha = Math.min(1, a * 2);
        c2.save(); c2.translate(p.x, p.y); c2.rotate(p.rot);
        c2.fillStyle = p.color;
        c2.beginPath();
        p.verts.forEach(([ang, r], i) => { const x = Math.cos(ang) * r * p.size, y = Math.sin(ang) * r * p.size; if (i) c2.lineTo(x, y); else c2.moveTo(x, y); });
        c2.closePath(); c2.fill();
        c2.strokeStyle = p.edge; c2.lineWidth = 0.8; c2.stroke();
        c2.restore();
        return;
      }
      case 'dust':
        c2.globalCompositeOperation = 'source-over';
        c2.globalAlpha = a * 0.8; c2.fillStyle = p.color;
        c2.fillRect(p.x, p.y, p.size, p.size);
        return;
      case 'shard': {
        c2.globalCompositeOperation = 'source-over';
        c2.globalAlpha = Math.min(1, a * 1.4);
        c2.save(); c2.translate(p.x, p.y); c2.rotate(p.rot);
        const s = p.size;
        c2.fillStyle = p.color; c2.strokeStyle = 'rgba(255,255,255,0.9)'; c2.lineWidth = 1;
        c2.beginPath(); c2.moveTo(0, -s); c2.lineTo(s * 0.6, s * 0.7); c2.lineTo(-s * 0.5, s * 0.4); c2.closePath();
        c2.fill(); c2.stroke(); c2.restore();
        return;
      }
    }
    c2.globalCompositeOperation = 'lighter';
    switch (p.kind) {
      case 'spark':
        c2.globalAlpha = a; c2.strokeStyle = p.color; c2.lineWidth = p.size;
        c2.beginPath(); c2.moveTo(p.x, p.y); c2.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); c2.stroke();
        break;
      case 'flame': {
        c2.globalAlpha = a * 0.85;
        c2.fillStyle = p.blue ? `hsl(${185 + 35 * k},100%,${88 - 38 * k}%)` : `hsl(${50 - 50 * k},100%,${62 - 30 * k}%)`;
        c2.beginPath(); c2.arc(p.x, p.y, p.size * (1 - k * 0.7), 0, Math.PI * 2); c2.fill();
        break;
      }
      case 'snow':
        c2.globalAlpha = a; c2.fillStyle = '#fff';
        c2.beginPath(); c2.arc(p.x + Math.sin(p.t * 0.15 + p.rot) * 2, p.y, p.size, 0, Math.PI * 2); c2.fill();
        break;
      case 'orb': { // 火球・閃光の玉
        const r = p.size * (0.25 + 0.75 * (1 - Math.pow(1 - k, 3)));
        const grd = c2.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.3, p.color); grd.addColorStop(1, 'rgba(0,0,0,0)');
        c2.globalAlpha = a; c2.fillStyle = grd;
        c2.beginPath(); c2.arc(p.x, p.y, r, 0, Math.PI * 2); c2.fill();
        break;
      }
      case 'meteor': case 'icicle': { // 落下物：尾を引いて目標に向かう
        const len = Math.hypot(p.vx, p.vy) * (p.rock ? 16 : p.kind === 'meteor' ? 9 : 5);
        const ang = Math.atan2(p.vy, p.vx);
        c2.globalAlpha = 1;
        c2.save(); c2.translate(p.x, p.y); c2.rotate(ang);
        const tail = c2.createLinearGradient(-len, 0, 0, 0);
        tail.addColorStop(0, 'rgba(0,0,0,0)'); tail.addColorStop(1, p.color);
        c2.fillStyle = tail;
        const tw = p.rock ? p.size * 1.5 : p.size;
        c2.beginPath(); c2.moveTo(0, -tw); c2.lineTo(-len, 0); c2.lineTo(0, tw); c2.closePath(); c2.fill();
        if (p.rock && !p.shock) { // 尾の芯（白っぽく光る筋）
          const core = c2.createLinearGradient(-len * 0.6, 0, 0, 0);
          core.addColorStop(0, 'rgba(255,240,200,0)'); core.addColorStop(1, 'rgba(255,240,200,0.95)');
          c2.fillStyle = core;
          c2.beginPath(); c2.moveTo(0, -p.size * 0.6); c2.lineTo(-len * 0.6, 0); c2.lineTo(0, p.size * 0.6); c2.closePath(); c2.fill();
        }
        if (p.kind === 'meteor' && p.rock && p.shock) { // 衝撃波をまとった岩：進む向きの前に弓なりの衝撃波、岩肌は灰色
          const tint = p.shock === 'god' ? '255,60,80' : '235,238,248';
          for (let k = 0; k < 3; k++) {
            const R = p.size * (1.5 + k * 0.75), wob = 0.08 * Math.sin(p.t * 0.9 + k);
            c2.strokeStyle = `rgba(${k === 0 ? '255,255,255' : tint},${0.85 - k * 0.22})`;
            c2.lineWidth = Math.max(1.5, p.size * (0.35 - k * 0.08));
            c2.beginPath(); c2.arc(-p.size * 0.2 * k, 0, R, -1.15 - wob, 1.15 + wob); c2.stroke();
          }
          c2.globalCompositeOperation = 'source-over';
          c2.rotate(p.t * 0.15);
          const rock = c2.createRadialGradient(p.size * 0.4, -p.size * 0.3, 0, 0, 0, p.size);
          rock.addColorStop(0, '#e8e8ee'); rock.addColorStop(0.35, '#5a5a62'); rock.addColorStop(1, '#141418');
          c2.fillStyle = rock;
          c2.beginPath();
          p.rock.forEach(([a, r], i) => { const x = Math.cos(a) * r * p.size, y = Math.sin(a) * r * p.size; if (i) c2.lineTo(x, y); else c2.moveTo(x, y); });
          c2.closePath(); c2.fill();
        } else if (p.kind === 'meteor' && p.rock) { // 赤熱した岩：オレンジに光る外側＋黒い岩肌
          const glow = c2.createRadialGradient(0, 0, p.size * 0.6, 0, 0, p.size * 2.4);
          if (p.blue) { glow.addColorStop(0, 'rgba(230,250,255,0.95)'); glow.addColorStop(0.4, 'rgba(70,200,255,0.65)'); glow.addColorStop(1, 'rgba(20,90,255,0)'); }
          else { glow.addColorStop(0, 'rgba(255,190,90,0.95)'); glow.addColorStop(0.4, 'rgba(255,90,10,0.6)'); glow.addColorStop(1, 'rgba(255,40,0,0)'); }
          c2.fillStyle = glow; c2.beginPath(); c2.arc(0, 0, p.size * 2.4, 0, Math.PI * 2); c2.fill();
          c2.globalCompositeOperation = 'source-over';
          c2.rotate(p.t * 0.15);
          const rock = c2.createRadialGradient(p.size * 0.4, -p.size * 0.3, 0, 0, 0, p.size);
          if (p.blue) { rock.addColorStop(0, '#e0f8ff'); rock.addColorStop(0.35, '#2a4a6a'); rock.addColorStop(1, '#0c121c'); }
          else { rock.addColorStop(0, '#ffcf7a'); rock.addColorStop(0.35, '#7a3a18'); rock.addColorStop(1, '#1c120c'); }
          c2.fillStyle = rock;
          c2.beginPath();
          p.rock.forEach(([a, r], i) => { const x = Math.cos(a) * r * p.size, y = Math.sin(a) * r * p.size; if (i) c2.lineTo(x, y); else c2.moveTo(x, y); });
          c2.closePath(); c2.fill();
        } else if (p.kind === 'meteor') {
          const grd = c2.createRadialGradient(0, 0, 0, 0, 0, p.size * 1.6);
          grd.addColorStop(0, '#fff'); grd.addColorStop(0.4, p.shock ? '#e6e8f0' : '#ffd27a'); grd.addColorStop(1, p.shock ? 'rgba(200,200,220,0)' : 'rgba(255,80,0,0)');
          c2.fillStyle = grd; c2.beginPath(); c2.arc(0, 0, p.size * 1.6, 0, Math.PI * 2); c2.fill();
        } else {
          c2.globalCompositeOperation = 'source-over';
          c2.fillStyle = '#e8fbff'; c2.strokeStyle = '#5ad8ff'; c2.lineWidth = 1.5;
          c2.beginPath(); c2.moveTo(p.size * 1.8, 0); c2.lineTo(-p.size * 2.5, -p.size * 0.6); c2.lineTo(-p.size * 2.5, p.size * 0.6); c2.closePath();
          c2.fill(); c2.stroke();
        }
        c2.restore();
        break;
      }
      default: // dot
        c2.globalAlpha = a; c2.fillStyle = p.color;
        c2.beginPath(); c2.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2); c2.fill();
    }
  }

  function loop() {
    c2.clearRect(0, 0, W, H);

    for (const e of emitters) { e.fn(e.t); e.t++; }
    emitters = emitters.filter((e) => e.t < e.life);

    c2.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      r.t += 1;
      if (r.t <= 0) continue; // 遅れて広がるリングはまだ描かない
      const k = r.t / r.life;
      c2.strokeStyle = r.color; c2.globalAlpha = Math.max(0, 1 - k);
      c2.lineWidth = r.w * (1 - k) + 1;
      c2.beginPath(); c2.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 3)), 0, Math.PI * 2); c2.stroke();
    }
    rings = rings.filter((r) => r.t < r.life);

    for (const b of bolts) {
      b.t += 1;
      c2.globalCompositeOperation = 'lighter';
      c2.globalAlpha = Math.max(0, 1 - b.t / b.life) * (Math.random() > 0.3 ? 1 : 0.3);
      c2.strokeStyle = b.color; c2.lineWidth = b.width; c2.shadowColor = b.color; c2.shadowBlur = 20;
      c2.beginPath(); c2.moveTo(b.pts[0][0], b.pts[0][1]);
      for (const p of b.pts) c2.lineTo(p[0], p[1]);
      c2.stroke();
      c2.strokeStyle = '#fff'; c2.lineWidth = Math.max(1, b.width * 0.35); c2.shadowBlur = 0; c2.stroke();
    }
    bolts = bolts.filter((b) => b.t < b.life);

    const dying = [];
    for (const p of parts) {
      p.t += 1;
      if (p.attract) { // 渦に向かってらせんを描きながら吸い込まれる
        const A = p.attract, dx = A.x - p.x, dy = A.y - p.y, d = Math.hypot(dx, dy) || 1;
        p.vx = p.vx * 0.9 + (dx / d) * A.pull - (dy / d) * A.swirl;
        p.vy = p.vy * 0.9 + (dy / d) * A.pull + (dx / d) * A.swirl;
        if (p.size0) p.size = p.size0 * Math.max(0.12, Math.min(1, d / (p.d0 || d)));
        if (d < A.eat) p.t = p.life;
      }
      if (!p.static) { p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; }
      if (p.trail) p.trail(p);
      drawParticle(p);
      if (p.t >= p.life && p.onDeath) dying.push(p);
    }
    parts = parts.filter((p) => p.t < p.life && p.y < H + 150 && p.y > -H * 1.5);
    c2.globalAlpha = 1; c2.globalCompositeOperation = 'source-over';
    dying.forEach((p) => p.onDeath(p));

    if (parts.length || rings.length || bolts.length || emitters.length) requestAnimationFrame(loop);
    else { running = false; c2.clearRect(0, 0, W, H); }
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }

  // ---------- 共通パーツ ----------
  function color(c) {
    const th = c.theme;
    if (th.palette) return pick(th.palette);
    // 隕石は炎ではなく衝撃波をまとうので、白・銀に赤を差す（破壊神は真紅を強めに）
    if (c.ti >= GOD) return pick(['#ffffff', '#d8dbe4', '#ff2a3a', '#ff2a3a']);
    if (c.ti >= ULTRA) return pick(['#ffffff', '#c8ccd6', '#ff3b3b', '#8a8f9c']);
    return Math.random() < 0.3 ? '#fff' : th.tierColors[c.ti];
  }

  // 取られた石を吹っ飛ばす
  function launchStone(p, c, mul = 1, ang) {
    const a = ang !== undefined ? ang : Math.atan2(p.y - c.cy, p.x - c.cx) + rnd(-0.6, 0.6);
    const sp = (rnd(4, 9) + c.power * 14) * mul * (c.n === 1 ? 0.6 : 1);
    spawn({
      kind: 'stone', white: c.white, x: p.x, y: p.y, size: c.stone / 2, life: 120,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rnd(4, 9) - c.power * 8, g: 0.45, drag: 0.99, vr: rnd(-0.3, 0.3),
      trail: c.stoneTrail,
    });
  }
  // 取られた石を粉砕する：かけら・細かい粉・粉塵
  function pulverize(p, c, scale = 1) {
    const cols = c.white ? ['#f6f2e8', '#e2dccd', '#c9c1b0', '#ffffff'] : ['#0c0c0c', '#262626', '#3d3d3d', '#555555'];
    const edge = c.white ? 'rgba(120,110,95,0.7)' : 'rgba(150,150,150,0.5)';
    const r = c.stone * 0.45;
    const chunks = Math.ceil((10 + c.power * 14) * scale);
    for (let i = 0; i < chunks; i++) {
      const ang = Math.random() * Math.PI * 2, sp = rnd(2, 7 + c.power * 10) * scale;
      const nv = 3 + Math.floor(rnd(0, 3));
      spawn({
        kind: 'chunk', x: p.x + Math.cos(ang) * rnd(0, r), y: p.y + Math.sin(ang) * rnd(0, r),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rnd(2, 6), g: 0.4, drag: 0.985,
        size: c.stone * rnd(0.07, 0.2) * Math.min(1.6, scale), life: rnd(55, 95), rot: rnd(0, 6), vr: rnd(-0.35, 0.35),
        verts: Array.from({ length: nv }, (_, k) => [(k / nv) * Math.PI * 2 + rnd(-0.3, 0.3), rnd(0.6, 1.1)]),
        color: pick(cols), edge,
      });
    }
    for (let i = 0; i < Math.ceil(26 * scale); i++) {
      const ang = Math.random() * Math.PI * 2, sp = rnd(1, 9) * scale;
      spawn({ kind: 'dust', x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1, g: 0.15, drag: 0.94,
        size: rnd(1, 2.5), life: rnd(30, 60), color: pick(cols) });
    }
    smoke(p.x, p.y, Math.ceil(4 * scale), c.stone * 0.7 * scale, 0.8, c.white ? '#cfc8b8' : '#5a5650', 0.55);
    ring(p.x, p.y, c.stone * 1.8 * scale, 'rgba(255,255,255,0.8)', { w: 5, life: 16 });
  }
  // 石にひびが入るときの線（石の半径を 1 とした座標）
  function stoneCracks() {
    return Array.from({ length: 4 + Math.floor(rnd(0, 3)) }, () => {
      let x = 0, y = 0, a = rnd(0, Math.PI * 2);
      return Array.from({ length: 4 }, () => { a += rnd(-0.6, 0.6); x += Math.cos(a) * 0.28; y += Math.sin(a) * 0.28; return [x, y]; });
    });
  }

  // 石を盤上に残したまま（凍る・帯電など）待たせてから onHit
  function holdStone(p, c, ms, onHit, extra = {}) {
    spawn(Object.assign({ kind: 'stone', static: true, white: c.white, x: p.x, y: p.y, size: c.stone / 2, life: frames(ms), onDeath: onHit }, extra));
  }
  function sparks(x, y, c, count, speed, kinds = ['spark', 'dot']) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2, sp = rnd(2, speed);
      spawn({
        kind: pick(kinds), x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.12, drag: 0.96,
        size: rnd(1.5, 3.5 + c.power * 3), life: rnd(30, 60 + c.power * 50), color: color(c),
      });
    }
  }
  function flames(x, y, count, size = 10, rise = 2, spread = 2, blue = false) {
    for (let i = 0; i < count; i++) {
      spawn({ kind: 'flame', x: x + rnd(-spread * 3, spread * 3), y, vx: rnd(-spread, spread), vy: -rnd(rise * 0.5, rise * 1.6),
        g: -0.05, drag: 0.97, size: rnd(size * 0.5, size), life: rnd(25, 55), blue });
    }
  }
  function smoke(x, y, count, size = 14, rise = 1, color, alpha) {
    for (let i = 0; i < count; i++) {
      spawn({ kind: 'smoke', x: x + rnd(-10, 10), y: y + rnd(-10, 10), vx: rnd(-1.5, 1.5), vy: -rnd(0.2, rise),
        drag: 0.98, size: rnd(size * 0.5, size), life: rnd(50, 110), color, alpha });
    }
  }
  function shards(x, y, c, count, speed) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2, sp = rnd(2, speed);
      spawn({ kind: 'shard', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, g: 0.3, drag: 0.98,
        size: rnd(3, 7 + c.power * 6), life: rnd(40, 80), vr: rnd(-0.4, 0.4), rot: rnd(0, 6),
        color: Math.random() < 0.35 ? (c.white ? 'rgba(240,236,228,0.95)' : 'rgba(30,30,30,0.95)') : pick(['rgba(190,240,255,0.85)', 'rgba(120,210,255,0.8)', 'rgba(255,255,255,0.9)']) });
    }
  }
  function snow(x, y, count, spread = 30) {
    for (let i = 0; i < count; i++) {
      spawn({ kind: 'snow', x: x + rnd(-spread, spread), y: y + rnd(-spread, spread), vx: rnd(-1.5, 1.5), vy: rnd(-2, 1),
        g: 0.03, size: rnd(1, 3), life: rnd(50, 110), rot: rnd(0, 6) });
    }
  }
  // 上空から目標に向かって落ちてくる物体（隕石・つらら）
  const rockShape = () => Array.from({ length: 9 }, (_, i) => [(i / 9) * Math.PI * 2 + rnd(-0.2, 0.2), rnd(0.75, 1.05)]);
  function fallTo(x, y, ms, kind, onHit, { size = 10, color = '#ff9a1f', trail, side, rock, blue, shock } = {}) {
    const f = frames(ms), dist = y + 150 + rnd(0, 120);
    const dir = side || (Math.random() < 0.5 ? 1 : -1);
    const sx = x + dist * (side ? rnd(0.5, 0.65) : rnd(0.35, 0.7)) * dir, sy = y - dist;
    spawn({ kind, x: sx, y: sy, vx: (x - sx) / f, vy: (y - sy) / f, size, color, life: f, onDeath: onHit, trail, rock: rock ? rockShape() : null, blue, shock });
  }
  // 連鎖的にずらす遅延
  const stagger = (i, n, total = 900) => (n >= 4 ? i * Math.min(60, total / n) : 0);
  // 1 回の演出で鳴らす着弾音の数を制限
  function limitedSound(c, fn) { if (!c.quiet && c.sounds-- > 0) fn(); }

  // ---------- テーマ別の演出 ----------
  const RUN = {};

  // デフォルト：石にひびが入り、粉砕される。ULTRA 以上は隕石が降ってきて石を粉砕する
  RUN.default = (c) => {
    const { points, ti } = c;
    if (ti < ULTRA) {
      const crackMs = 160;
      points.forEach((p, i) => holdStone(p, c, crackMs + stagger(i, c.n, 700), () => {
        pulverize(p, c, 1 + c.power);
        sparks(p.x, p.y, c, Math.ceil(c.partsPer / 4), 6 + c.power * 10, ['spark']);
        if (i > 0 && i % 3 === 0) limitedSound(c, () => crush(0.3));
      }, { cracks: stoneCracks() }));
      // 衝撃波
      if (ti >= 3) later(crackMs, () => {
        for (let i = 0; i < ti - 1; i++) ring(c.cx, c.cy, 90 + i * 70 + c.power * W * 0.5, i % 2 ? '#ffffff' : '#ff4b1f', { w: 24, life: 36, delay: i * 4 });
      });
      return;
    }
    // 隕石：右上から岩が衝撃波をまとって降ってきて、着弾で石を粉砕する（炎は出さない。炎テーマと見分けるため）。
    // 破壊神は数が増え、衝撃波が真紅になる
    const god = ti >= GOD;
    const shockCol = god ? 'rgba(255,70,90,0.95)' : 'rgba(235,238,248,0.95)';
    const rockCols = ['#2a2a30', '#4a4a52', '#6b6b74', '#1a1a1e', '#8a8a94'];
    const impact = (p, strong) => {
      const k = strong ? 1 : 0.6;
      spawn({ kind: 'orb', x: p.x, y: p.y, size: c.stone * (god ? 4 : 3.2) * k, life: 14, color: god ? '#ff2a3a' : '#c8ccd6' });
      for (let i = 0; i < Math.ceil(14 * k); i++) { // 岩の破片
        const ang = -Math.PI / 2 + rnd(-1.3, 1.3), sp = rnd(3, 10) * k;
        spawn({ kind: 'chunk', x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.45, drag: 0.985,
          size: c.stone * rnd(0.1, 0.28), life: rnd(50, 80), rot: rnd(0, 6), vr: rnd(-0.3, 0.3),
          verts: rockShape().slice(0, 5 + Math.floor(rnd(0, 3))), color: pick(rockCols), edge: 'rgba(230,230,240,0.6)' });
      }
      smoke(p.x, p.y, Math.ceil(6 * k), c.stone * 1.3 * k, 1.2, pick(['#5a5650', '#4a4640', '#6a6660']), 0.6); // 土煙
      for (let i = 0; i < Math.ceil(10 * k); i++) { // 砕けた粒
        const ang = Math.random() * Math.PI * 2, sp = rnd(2, 8);
        spawn({ kind: 'spark', x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, g: 0.2, drag: 0.95,
          size: rnd(1.5, 3), life: rnd(20, 40), color: pick(god ? ['#ffffff', '#ff2a3a', '#d8dbe4'] : ['#ffffff', '#c8ccd6', '#ff3b3b']) });
      }
      // 着弾の衝撃波（二重の輪）
      ring(p.x, p.y, c.stone * (god ? 7 : 5) * k, shockCol, { w: 10 * k, life: 22 });
      ring(p.x, p.y, c.stone * (god ? 4.5 : 3.2) * k, 'rgba(255,255,255,0.9)', { w: 5 * k, life: 16, delay: 3 });
      limitedSound(c, () => punch(0.6));
    };
    const trail = (m) => { // 通ったあとに小さな衝撃波の輪を残す
      if (m.t % 5 === 0) ring(m.x, m.y, m.size * 3.2, god ? 'rgba(255,90,110,0.55)' : 'rgba(235,238,248,0.5)', { w: 2, life: 12, r0: m.size * 1.2 });
      if (m.t % 6 === 0) smoke(m.x, m.y, 1, m.size * 0.6, 0.2, '#6a6a72', 0.18);
    };
    const start = god ? 600 : 500;
    const meteor = { side: 1, rock: true, shock: god ? 'god' : 'ultra', color: god ? 'rgba(255,120,140,0.7)' : 'rgba(225,228,240,0.7)', trail };
    points.forEach((p, i) => {
      const ms = start + stagger(i, c.n, 1200);
      holdStone(p, c, ms, () => { pulverize(p, c, 2); impact(p, true); }, { cracks: stoneCracks() });
      fallTo(p.x, p.y, ms, 'meteor', () => {}, { ...meteor, size: c.stone * (god ? 0.7 : 0.55) });
    });
    // 盤面のあちこちにも落ちる
    const extra = god ? 26 : 8;
    for (let i = 0; i < extra; i++) {
      const x = c.cx + rnd(-W * 0.5, W * 0.5), y = c.cy + rnd(-H * 0.3, H * 0.3), ms = rnd(start - 150, c.hold - 600);
      fallTo(x, y, ms, 'meteor', () => impact({ x, y }, false), { ...meteor, size: rnd(6, god ? 16 : 12) });
    }
    // 最後の大きな衝撃波
    later(start + 900, () => {
      ring(c.cx, c.cy, Math.max(W, H) * 0.9, 'rgba(255,255,255,0.95)', { w: god ? 60 : 40, life: 50 });
      ring(c.cx, c.cy, Math.max(W, H) * 0.7, shockCol, { w: 30, life: 50, delay: 6 });
      if (god) spawn({ kind: 'orb', x: c.cx, y: c.cy, size: Math.max(W, H) * 0.6, life: 40, color: '#ff2a3a' });
      else smoke(c.cx, c.cy, 14, c.stone * 2.5, 1.5, '#4a4a50', 0.5);
    });
  };

  // 火山：画面下からせり上がり、溶岩・火山弾・噴煙を噴き上げる
  function volcano(c) {
    const w = Math.min(W * 1.3, 900), h = H * 0.42, x = W / 2;
    const lava = Array.from({ length: 5 }, () => {
      let fx = rnd(-0.08, 0.08), fy = 0;
      return Array.from({ length: 7 }, () => { const pt = [fx, fy]; fx += rnd(-0.12, 0.12) + Math.sign(fx || 1) * 0.06; fy += rnd(0.12, 0.18); return pt; });
    });
    const v = { kind: 'volcano', x, y: H, w, h, lava, static: true, life: frames(c.hold + 300), top: H }; // y は画面外判定で消されないため
    spawn(v);
    shake(18, 500);
    later(450, () => {
      shake(40, c.hold - 450);
      const crater = w * 0.11;
      emit(frames(2200), (t) => {
        // 火口のくぼみの中から、ほぼ真上に噴き上げる（広がりは高く上がってから）
        const top = v.top + crater * 0.15, n = t < 40 ? 16 : 9;
        for (let i = 0; i < n; i++) { // 溶岩の噴き上げ
          spawn({ kind: 'flame', x: x + rnd(-crater * 0.55, crater * 0.55), y: top, vx: rnd(-2.6, 2.6), vy: -rnd(11, 23), g: 0.32, drag: 0.99,
            size: rnd(9, 22), life: rnd(45, 80) });
        }
        if (t % 2 === 0) { // 火山弾
          const ang = -Math.PI / 2 + rnd(-0.5, 0.5), sp = rnd(10, 20);
          spawn({ kind: 'chunk', x: x + rnd(-crater * 0.4, crater * 0.4), y: top, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.35, drag: 0.995,
            size: rnd(6, 14), life: 120, rot: rnd(0, 6), vr: rnd(-0.2, 0.2), verts: rockShape(), color: '#2a1208', edge: 'rgba(255,90,20,0.9)',
            trail: (b) => flames(b.x, b.y, 1, 12, 0.3, 0.5) });
        }
        if (t % 2 === 0) smoke(x + rnd(-crater * 0.5, crater * 0.5), top - 10, 1, rnd(26, 50), rnd(3, 6), pick(['#2a201c', '#3a2c26', '#1a1412']), 0.7); // 噴煙
      });
      spawn({ kind: 'orb', x, y: v.top, size: w * 0.8, life: 40, color: '#ff4a10' });
      ring(x, v.top, Math.max(W, H), '#ff6a20', { w: 40, life: 45 });
    });
  }

  // 炎：火柱が上がり、燃えながら石が吹き飛ぶ。ULTRA 以上は画面下から炎の壁
  RUN.fire = (c) => {
    const { points, ti } = c;
    c.stoneTrail = (s) => { if (s.t % 2 === 0 && s.t < 60) flames(s.x, s.y, 1, s.size * 0.9, 0.8, 0.6); };
    const pillars = ti >= 3 ? Math.min(points.length, 14) : 0;
    points.forEach((p, i) => later(stagger(i, c.n), () => {
      launchStone(p, c, 1, -Math.PI / 2 + rnd(-0.9, 0.9));
      flames(p.x, p.y, c.partsPer, c.stone * 0.7, 3 + c.power * 4, 2.5);
      sparks(p.x, p.y, c, Math.ceil(c.partsPer / 3), 8 + c.power * 8);
      if (i < pillars) emit(30 + ti * 6, () => flames(p.x, p.y, 3, c.stone * 0.8, 6 + c.power * 5, 1));
    }));
    ring(c.cx, c.cy, 80 + c.power * W * 0.5, '#ff5a00', { w: 20 });
    if (ti >= GOD) volcano(c); // 炎神降臨では火山が噴火する
    if (ti >= ULTRA) {
      const dur = ti >= GOD ? 180 : 120;
      emit(dur, (t) => {
        // 炎神降臨は火山が主役なので、下からの炎の壁は控えめにして火山を隠さない
        const god = ti >= GOD, n = god ? 4 : 9;
        for (let i = 0; i < n; i++) {
          spawn({ kind: 'flame', x: rnd(0, W), y: H + 10, vx: rnd(-1, 1), vy: -rnd(6, 13 + t * 0.06), g: -0.04, drag: 0.99,
            size: god ? rnd(12, 26) : rnd(18, 44), life: rnd(40, 80) });
        }
      });
      for (let i = 0; i < (ti >= GOD ? 10 : 6); i++) later(250 + i * 250, () => { ring(c.cx, c.cy, Math.max(W, H) * 0.8, pick(['#ff9a1f', '#ff3300', '#ffdd55']), { w: 30, life: 45 }); crackle(0.5); });
      // 炎神降臨：画面のあちこちから火柱が噴き上がり続ける
      if (ti >= GOD) {
        later(500, () => emit(frames(2600), (t) => {
          if (t % 5) return;
          const x = rnd(W * 0.05, W * 0.95), y = rnd(H * 0.25, H * 0.95);
          for (let i = 0; i < 10; i++) {
            spawn({ kind: 'flame', x: x + rnd(-10, 10), y, vx: rnd(-1.2, 1.2), vy: -rnd(9, 20), g: -0.02, drag: 0.98, size: rnd(14, 32), life: rnd(30, 55) });
          }
          spawn({ kind: 'orb', x, y, size: 90, life: 14, color: '#ff5a00' });
        }));
      }
      // 火の玉が降ってくる
      for (let i = 0; i < (ti >= GOD ? 45 : 12); i++) {
        const x = c.cx + rnd(-W * 0.5, W * 0.5), y = c.cy + rnd(-H * 0.3, H * 0.3);
        fallTo(x, y, rnd(300, c.hold - 700), 'meteor', () => { flames(x, y, 18, 14, 5, 3); spawn({ kind: 'orb', x, y, size: 70, life: 20, color: '#ff5a00' }); },
          { size: rnd(5, 10), color: '#ff3300', trail: (m) => flames(m.x, m.y, 1, m.size * 1.2, 0.3, 0.5) });
      }
    }
  };

  // 氷：石が凍りつき、砕け散る。ULTRA 以上はつららが降り注ぎ、吹雪が画面を横切る
  RUN.ice = (c) => {
    const { points, ti } = c;
    const freezeMs = ti >= 3 ? 380 : 220;
    const smash = (p, mul = 1) => {
      shards(p.x, p.y, c, Math.ceil(c.partsPer * 0.6 * mul), 6 + c.power * 10);
      snow(p.x, p.y, Math.ceil(c.partsPer * 0.4), c.stone);
      sparks(p.x, p.y, c, 6, 6);
      ring(p.x, p.y, c.stone * 2.5 * mul, '#bff3ff', { w: 4, life: 20 });
    };
    if (ti < ULTRA) {
      points.forEach((p, i) => holdStone(p, c, freezeMs + stagger(i, c.n, 700), () => {
        smash(p);
        limitedSound(c, () => shatter(0.2));
      }, { frozen: true }));
      if (ti >= 3) later(freezeMs, () => { ring(c.cx, c.cy, 120 + c.power * W * 0.6, '#5ad8ff', { w: 18 }); ring(c.cx, c.cy, 90 + c.power * W * 0.4, '#fff', { w: 10, delay: 6 }); });
      return;
    }
    points.forEach((p, i) => {
      const ms = 500 + stagger(i, c.n, 1200);
      holdStone(p, c, ms, () => { smash(p, 1.5); launchStone(p, c, 0.5); limitedSound(c, () => shatter(0.4)); }, { frozen: true });
      fallTo(p.x, p.y, ms, 'icicle', () => {}, { size: c.stone * 0.35, color: '#bff3ff', trail: (m) => { if (m.t % 3 === 0) snow(m.x, m.y, 1, 3); } });
    });
    for (let i = 0; i < (ti >= GOD ? 30 : 12); i++) {
      const x = c.cx + rnd(-W * 0.5, W * 0.5), y = c.cy + rnd(-H * 0.3, H * 0.3);
      fallTo(x, y, rnd(300, c.hold - 700), 'icicle', () => { shards(x, y, c, 10, 8); snow(x, y, 8); }, { size: rnd(4, 8), color: '#bff3ff' });
    }
    // 吹雪
    emit(ti >= GOD ? 200 : 150, () => {
      for (let i = 0; i < (ti >= GOD ? 14 : 9); i++) {
        spawn({ kind: 'snow', x: -10, y: rnd(0, H), vx: rnd(10, 22), vy: rnd(-1, 2), size: rnd(1, 3.5), life: 90, rot: rnd(0, 6) });
      }
    });
    for (let i = 0; i < 4; i++) later(500 + i * 300, () => ring(c.cx, c.cy, Math.max(W, H) * 0.8, pick(['#ffffff', '#5ad8ff', '#bff3ff']), { w: 26, life: 45 }));
  };

  // 雷：落雷が石を撃ち抜く。3 子以上は石同士を電撃がつなぐ。ULTRA 以上は雷雨
  RUN.thunder = (c) => {
    const { points, ti } = c;
    const strike = (p, mul = 1) => {
      lightning(p.x, p.y, pick(['#fff59a', '#7ad7ff']), { width: 3 + mul * 2, life: 16 });
      spawn({ kind: 'orb', x: p.x, y: p.y, size: c.stone * 2.5 * mul, life: 14, color: '#7ad7ff' });
      sparks(p.x, p.y, c, Math.ceil(c.partsPer * 0.7), 10 + c.power * 12, ['spark']);
      launchStone(p, c, 1.1 * mul);
    };
    const chargeMs = ti >= ULTRA ? 450 : ti >= 3 ? 300 : 120;
    points.forEach((p, i) => holdStone(p, c, chargeMs + stagger(i, c.n, ti >= ULTRA ? 1300 : 800), () => {
      strike(p, ti >= ULTRA ? 1.5 : 1);
      limitedSound(c, () => crack(0.15));
    }, { charged: true }));
    if (ti >= 3) {
      const pts = points.slice(0, 30);
      emit(frames(chargeMs + 300), (t) => {
        if (t % 4) return;
        for (let i = 0; i + 1 < pts.length; i++) boltBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, pick(['#fff59a', '#7ad7ff']), { life: 6, width: 2, jag: 10 });
      });
    }
    if (ti >= ULTRA) {
      emit(ti >= GOD ? 200 : 140, (t) => {
        if (t % (ti >= GOD ? 3 : 5)) return;
        lightning(rnd(0, W), rnd(H * 0.3, H), pick(['#ffffff', '#fff59a', '#7ad7ff']), { width: rnd(2, 5), life: 12 });
        if (t % 15 === 0) crack(0.3);
      });
      for (let i = 0; i < 3; i++) later(600 + i * 450, () => {
        boltBetween(c.cx + rnd(-40, 40), -20, c.cx, c.cy, '#ffffff', { width: 12, life: 24, jag: 50 });
        spawn({ kind: 'orb', x: c.cx, y: c.cy, size: Math.max(W, H) * 0.5, life: 25, color: '#7ad7ff' });
        ring(c.cx, c.cy, Math.max(W, H) * 0.8, '#fff59a', { w: 30, life: 40 });
      });
    }
  };

  // 闇：闇の渦が現れ、取った石がひび割れたあと、らせんを描いて吸い込まれる。最後に渦が潰れて紫の光がはじける。
  // ULTRA 以上は画面中の破片を吸い込み、紫の稲妻が走る。神降臨は画面ごと呑み込んで、光が爆発する
  RUN.dark = (c) => {
    const { points, ti } = c;
    const god = ti >= GOD, ultra = ti >= ULTRA;
    const R = c.stone * (god ? 3.6 : ultra ? 2.8 : ti >= 3 ? 1.8 : 1.1) * (1 + c.power * 0.3);
    const durMs = god ? 3300 : ultra ? 2300 : ti >= 3 ? 1300 : 900;
    const cx = c.cx, cy = c.cy;
    const attract = { x: cx, y: cy, pull: 1.3 + c.power * 1.2, swirl: 1.1 + c.power, eat: R * 0.35 };
    const collapse = () => {
      parts.forEach((q) => { if (q.attract === attract) q.t = q.life; });
      const k = god ? 3 : ultra ? 2 : 1;
      spawn({ kind: 'orb', x: cx, y: cy, size: R * 4 * k, life: 26, color: god ? '#ffffff' : '#b066ff' });
      ring(cx, cy, R * 6 * k, '#e0c8ff', { w: 16 * k, life: 34 });
      ring(cx, cy, R * 4 * k, '#7a2cff', { w: 24 * k, life: 30, delay: 4 });
      sparks(cx, cy, c, 40 * k, 8 + 6 * k);
      if (god) { // 光の爆発：星が四方に飛び散る
        for (let i = 0; i < 260; i++) {
          const a = Math.random() * Math.PI * 2, sp = rnd(4, 22);
          spawn({ kind: 'spark', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.97, size: rnd(1.5, 3.5), life: rnd(50, 110),
            color: pick(['#ffffff', '#e0c8ff', '#ff66e0', '#9fd0ff']) });
        }
      }
      limitedSound(c, () => implode(0.4 + c.power * 0.6));
    };
    spawn({ kind: 'hole', x: cx, y: cy, size: R, static: true, life: frames(durMs), onDeath: collapse });
    // 取った石：ひびが入ってから吸い込まれる
    points.forEach((p, i) => holdStone(p, c, 200 + stagger(i, c.n, Math.min(900, durMs * 0.4)), () => {
      spawn({ kind: 'stone', white: c.white, x: p.x, y: p.y, size: c.stone / 2, size0: c.stone / 2, d0: Math.hypot(p.x - cx, p.y - cy),
        life: frames(durMs), drag: 1, vr: rnd(0.15, 0.35), attract });
      sparks(p.x, p.y, c, 6, 4, ['dot']);
    }, { cracks: stoneCracks() }));
    // まわりの紫の塵が吸い込まれる
    const reach = ultra ? Math.max(W, H) * 0.7 : R * 5;
    emit(frames(durMs - 250), () => {
      for (let i = 0; i < (god ? 10 : ultra ? 6 : 2); i++) {
        const a = Math.random() * Math.PI * 2, d = rnd(R * 2, reach);
        spawn({ kind: Math.random() < 0.5 ? 'dot' : 'spark', x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: 0, vy: 0, drag: 1,
          size: rnd(1.2, 2.8), life: 160, color: color(c), attract });
      }
    });
    // 内側へ縮む輪
    for (let i = 0; i < Math.min(ti + 2, 6); i++) ring(cx, cy, R * 0.6, i % 2 ? '#e0c8ff' : '#7a2cff', { r0: R * (4 + i) + (ultra ? W * 0.3 : 0), w: 6 + c.power * 10, life: 32, delay: i * 9 });
    if (ultra) { // 紫の稲妻が渦に落ちる
      emit(frames(durMs - 300), (t) => {
        if (t % (god ? 4 : 7)) return;
        const a = Math.random() * Math.PI * 2, d = rnd(R * 2.5, R * 6);
        boltBetween(cx + Math.cos(a) * d, cy + Math.sin(a) * d, cx + Math.cos(a) * R, cy + Math.sin(a) * R, pick(['#b066ff', '#ff66e0', '#e0c8ff']), { life: 10, width: 2.5, jag: 18 });
      });
      // 画面の外から破片（石のかけら）も吸い込まれる
      emit(frames(durMs * 0.7), (t) => {
        if (t % 3) return;
        const a = Math.random() * Math.PI * 2, d = Math.max(W, H) * 0.75;
        spawn({ kind: 'chunk', x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: 0, vy: 0, drag: 1, size: rnd(3, 8), life: 180, rot: rnd(0, 6), vr: rnd(-0.3, 0.3),
          verts: Array.from({ length: 5 }, (_, k) => [(k / 5) * Math.PI * 2 + rnd(-0.3, 0.3), rnd(0.6, 1.1)]), color: pick(['#1a1020', '#2a1a3a', '#3a2450']), edge: 'rgba(190,120,255,0.8)', attract });
      });
    }
  };

  // 光：空から光の柱が降り、石が光に包まれて天へ昇りながら光の粒になって消える。
  // ULTRA 以上は天が開いて後光が回り、光の柱が次々と降りる。神降臨は巨大な後光と虹色のきらめきが降り注ぐ
  RUN.light = (c) => {
    const { points, ti } = c;
    const god = ti >= GOD, ultra = ti >= ULTRA;
    const prism = ['#ffffff', '#ffe7a3', '#ffd36a', '#bfe8ff', '#ffc8f0', '#c8ffd8'];
    const sparkle = (x, y, n, spread, colors = ['#ffffff', '#fff6d8', '#ffe7a3']) => {
      for (let i = 0; i < n; i++) {
        spawn({ kind: 'star', x: x + rnd(-spread, spread), y: y + rnd(-spread, spread), vx: rnd(-0.6, 0.6), vy: -rnd(0.5, 2.2),
          size: rnd(1.5, 3.5), life: rnd(30, 70), color: pick(colors) });
      }
    };
    points.forEach((p, i) => {
      const ms = (ultra ? 350 : 120) + stagger(i, c.n, ultra ? 1400 : 800);
      later(Math.max(0, ms - 120), () => spawn({ kind: 'beam', x: p.x, y: p.y, size: c.stone * (ultra ? 0.9 : 0.7), life: 40 }));
      holdStone(p, c, ms, () => {
        // 光に包まれて昇天する
        spawn({ kind: 'stone', holy: true, white: c.white, x: p.x, y: p.y, size: c.stone / 2, life: 70, vx: rnd(-0.3, 0.3), vy: -1, g: -0.06, drag: 1, vr: 0,
          onDeath: (q) => { sparkle(q.x, q.y, 10, c.stone * 0.4); spawn({ kind: 'orb', x: q.x, y: q.y, size: c.stone * 1.6, life: 16, color: '#fff6d8' }); } });
        sparkle(p.x, p.y, 8 + Math.round(c.power * 8), c.stone * 0.5);
        ring(p.x, p.y, c.stone * 2.2, 'rgba(255,230,150,0.9)', { w: 3, life: 22 });
      });
    });
    if (ti >= 3) ring(c.cx, c.cy, 90 + c.power * W * 0.5, '#fff6d8', { w: 6, life: 40 }); // 細い光の輪
    if (ultra) {
      // 天が開く：画面上から後光
      spawn({ kind: 'rays', x: W / 2, y: -H * 0.05, size: Math.max(W, H) * 1.1, count: god ? 22 : 16, spin: 0.004, static: true, life: frames(c.hold + 400) });
      emit(frames(c.hold - 600), (t) => {
        if (t % (god ? 5 : 9)) return;
        spawn({ kind: 'beam', x: rnd(0, W), y: rnd(H * 0.3, H), size: rnd(10, 26), life: 36 });
      });
    }
    if (god) { // 巨大な後光の輪と、虹色のきらめきの雨
      spawn({ kind: 'rays', x: c.cx, y: c.cy, size: Math.max(W, H) * 0.7, count: 28, spin: -0.012, static: true, life: frames(c.hold) });
      ring(c.cx, c.cy, Math.max(W, H) * 0.35, '#ffe7a3', { w: 10, life: 60, delay: 20 });
      ring(c.cx, c.cy, Math.max(W, H) * 0.5, '#ffffff', { w: 6, life: 70, delay: 30 });
      emit(frames(c.hold - 400), () => {
        for (let i = 0; i < 6; i++) spawn({ kind: 'star', x: rnd(0, W), y: rnd(-20, H * 0.6), vx: rnd(-0.4, 0.4), vy: rnd(1, 3), size: rnd(1.5, 4), life: rnd(50, 90), color: pick(prism) });
      });
    }
  };

  // 神レベル共通：画面全体に降り注ぐ
  function godRain(c) {
    const key = c.themeKey;
    for (let i = 0; i < 300; i++) {
      const x = rnd(0, W);
      if (key === 'fire') spawn({ kind: 'flame', x, y: H + rnd(0, H), vx: rnd(-1, 1), vy: -rnd(4, 12), size: rnd(4, 9), life: rnd(80, 160) });
      else if (key === 'ice') spawn({ kind: 'snow', x, y: rnd(-H, 0), vx: rnd(-1, 1), vy: rnd(2, 6), size: rnd(1.5, 4), life: rnd(100, 180), rot: rnd(0, 6) });
      else if (key !== 'default' && key !== 'dark' && key !== 'light') spawn({ kind: 'dot', x, y: rnd(-H, 0), vx: rnd(-1, 1), vy: rnd(4, 12), g: 0.05, size: rnd(2, 5), life: rnd(80, 160), color: color(c) });
    }
    if (key === 'default') { // 空を横切る流星群
      for (let i = 0; i < 40; i++) {
        later(rnd(0, 2500), () => {
          const sp = rnd(10, 18), x = rnd(W * 0.2, W * 1.3), y = rnd(-H * 0.4, H * 0.2);
          spawn({ kind: 'meteor', x, y, vx: -sp * 0.6, vy: sp, size: rnd(2, 4), color: 'rgba(230,232,245,0.8)', shock: true, life: 90 });
        });
      }
    }
  }

  // ---------- DOM 演出 ----------
  const stage = document.getElementById('stage');
  const flashEl = document.getElementById('flash');
  const banner = document.getElementById('banner');
  const vignette = document.getElementById('vignette');

  function shake(px, ms) {
    if (!px) return;
    stage.style.setProperty('--shake', px + 'px');
    stage.classList.remove('shaking'); void stage.offsetWidth;
    stage.classList.add('shaking');
    clearTimeout(shake._t);
    shake._t = setTimeout(() => stage.classList.remove('shaking'), ms);
  }

  function flash(alpha, cls, theme) {
    if (!alpha) return;
    flashEl.className = '';
    void flashEl.offsetWidth;
    flashEl.style.setProperty('--alpha', alpha);
    theme.flash.forEach((col, i) => flashEl.style.setProperty('--c' + i, col));
    flashEl.className = cls;
  }

  function showVignette(name, ms) {
    vignette.className = '';
    void vignette.offsetWidth;
    vignette.style.setProperty('--dur', ms + 'ms');
    vignette.className = 'show ' + name;
  }

  function showBanner(c) {
    const { ti, theme } = c;
    const name = ti < 3 ? COMMON_NAMES[ti] : theme.names[ti - 3];
    const sub = ti < 3 ? '' : theme.subs[ti - 3];
    const col = theme.tierColors ? theme.tierColors[ti] : theme.color;
    const dur = Math.max(1200, c.hold + 600);
    banner.innerHTML = '';
    banner.className = '';
    void banner.offsetWidth;
    const main = document.createElement('div');
    main.className = 'b-main'; main.textContent = name;
    main.style.setProperty('--c', col);
    banner.appendChild(main);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'b-sub'; s.textContent = sub; s.style.setProperty('--c', col);
      banner.appendChild(s);
    }
    const count = document.createElement('div');
    count.className = 'b-count'; count.textContent = `${c.white ? '白' : '黒'}石 ${c.n}子 撃破！`;
    banner.appendChild(count);
    banner.className = `show t${ti} th-${c.themeKey}`;
    banner.style.setProperty('--dur', dur + 'ms');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => { banner.className = ''; }, dur);
  }

  // points: 取られた石の画面座標 [{x,y}], capturedColor: 取られた石の色(1黒 2白)
  // charge: ため撃ちの段階（0 なし／1 小／2 中／3 MAX）。石が勢いよく飛び、画面がよく揺れる
  function capture(points, capturedColor, stoneSize, themeKey = 'default', charge = 0) {
    const n = points.length;
    const ti = tierIndex(n);
    if (ti < 0) return 0;
    if (!THEMES[themeKey]) themeKey = 'default';
    const theme = THEMES[themeKey], tier = TIERS[ti];
    const c = {
      points, n, ti, tier, theme, themeKey, hold: tier.hold, white: capturedColor === 2, stone: stoneSize,
      power: Math.min(1, n / 20), sounds: 10,
      cx: points.reduce((s, p) => s + p.x, 0) / n,
      cy: points.reduce((s, p) => s + p.y, 0) / n,
      partsPer: Math.ceil(tier.parts / Math.max(1, Math.sqrt(n))),
      charge,
    };
    boostNow = 1 + charge * 0.45;
    try { runCapture(c); } finally { boostNow = 1; }
    return tier.hold;
  }

  function runCapture(c) {
    const { ti, tier, theme, themeKey, charge } = c;

    // デストロイの録音を鳴らすときは、合成音を重ねない
    c.quiet = themeKey === 'default' && hasDestroySample(ti);
    RUN[themeKey](c);
    // 闇は外へ広がる衝撃波を出さず、渦が潰れたときの衝撃波だけにする
    for (let i = 0; i < (themeKey === 'dark' ? 0 : tier.rings); i++) {
      // 隕石は着弾してから衝撃波を出す
      const wait = themeKey === 'default' && ti >= ULTRA ? 30 : 0;
      ring(c.cx, c.cy, 60 + i * 50 + c.power * Math.max(W, H) * 0.6, i % 2 ? '#fff' : color(c), { w: 10 + c.power * 30, life: 40 + i * 6, delay: wait + i * 6 });
    }
    if (ti >= GOD) godRain(c);
    kick();

    if (charge) chargeBurst(c);
    shake(tier.shake * (1 + charge * 0.5) + charge * 6, Math.max(300 + charge * 200, tier.hold));
    const flashCls = ti >= GOD && themeKey !== 'default' ? 'god' : themeKey === 'thunder' && ti >= 3 ? 'strobe'
      : ti >= 4 ? 'multi' : 'on';
    const destroyGod = themeKey === 'default' && ti >= GOD, fireGod = themeKey === 'fire' && ti >= GOD;
    flash(Math.min(1, tier.flash + charge * 0.12), flashCls, destroyGod ? { flash: ['#ffffff', '#e0e2ea', '#d4001a', '#200000'] } : theme);
    if (ti >= 4) showVignette(fireGod ? 'volcano' : destroyGod ? 'meteor-god' : ti >= ULTRA ? theme.vignette : theme.vignette + ' soft', Math.max(1200, tier.hold + 400));
    showBanner(c);

    THEME_SOUND[themeKey](c.power, ti);
    if (charge) punch(0.4 + charge * 0.2);
    if (!c.quiet) {
      // 大技の音はテーマごと（以前は全テーマ共通で爆発音を 2 発鳴らしていた）
      if (ti >= ULTRA) (THEME_BIG_SOUND[themeKey] || (() => {}))(ti >= GOD);
      [523, 659, 784, 1047, 1319, 1568, 2093].slice(0, ti + 1).forEach((f, i) => blip(f, 0.1, 'square', 0.08, i * 0.06));
    }
  }

  // ため撃ちの上乗せ：取った場所から火花と衝撃波を追加で出す
  function chargeBurst(c) {
    const { cx, cy, charge } = c;
    sparks(cx, cy, c, 20 + charge * 25, 10 + charge * 6);
    for (let i = 0; i < charge; i++) {
      ring(cx, cy, c.stone * (3 + i * 2.5) + charge * 40, i % 2 ? '#fff' : color(c), { w: 8 + charge * 4, life: 26 + i * 6, delay: i * 5 });
    }
  }

  // ため中の音：石がカタカタ鳴る音（level が上がるほど強く高く）と、段階が上がった合図
  function rattle(level) {
    sfx((a, t) => noiseHit(a, t, { dur: 0.03, type: 'bandpass', f0: 1800 + level * 500 + rnd(-200, 200), q: 4, vol: 0.25 + level * 0.15 }));
  }
  function chargeUp(level) {
    const base = [0, 392, 523, 784][level] || 784;
    blip(base, 0.12, 'square', 0.09); blip(base * 1.5, 0.16, 'square', 0.08, 0.07);
    if (level >= 3) { blip(base * 2, 0.3, 'sawtooth', 0.08, 0.14); punch(0.3, 0.02); }
  }

  // タイトルロゴを叩いたとき：level 1〜4 はひびが入るだけ、5 で粉々に砕け散る
  const LOGO_COLORS = ['#fff6c8', '#ffcc33', '#ff5a1f', '#b3001b'];
  function logoHit(x, y, level, size = 60) {
    const c = { power: level / 5, ti: 0, theme: { palette: LOGO_COLORS }, white: false, stone: size };
    if (level < 5) {
      punch(0.3 + level * 0.15);
      crush(0.06 * level, 0.03);
      sparks(x, y, c, 10 + level * 5, 6 + level * 2);
      for (let i = 0; i < 6 + level * 3; i++) {
        const ang = rnd(-Math.PI, 0), sp = rnd(2, 6);
        spawn({ kind: 'dust', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.25, drag: 0.96,
          size: rnd(1.5, 3), life: rnd(30, 60), color: pick(LOGO_COLORS) });
      }
      shake(4 + level * 3, 220);
    } else {
      punch(1); crush(1, 0.02); boom(0.5, 0.05); shatter(0.6, 0.1);
      smoke(x, y, 8, size * 0.9, 0.8, '#5a2a18', 0.5);
      sparks(x, y, c, 70, 18);
      ring(x, y, Math.max(W, H) * 0.5, '#ffcc33', { w: 18, life: 34 });
      ring(x, y, Math.max(W, H) * 0.35, '#fff', { w: 8, life: 28, delay: 4 });
      shake(22, 600);
      flash(0.55, 'on', { flash: ['#ffffff', '#ffcc33', '#ff5a1f', '#b3001b'] });
    }
    kick();
  }
  // 砕けたロゴの 1 文字ぶんのかけらを飛ばす（rect は文字の画面上の位置）
  function logoChunks(rect, n = 10) {
    for (let i = 0; i < n; i++) {
      const x = rnd(rect.left, rect.right), y = rnd(rect.top, rect.bottom), ang = rnd(0, Math.PI * 2), sp = rnd(3, 12);
      const nv = 3 + Math.floor(rnd(0, 3));
      spawn({ kind: 'chunk', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rnd(3, 8), g: 0.45, drag: 0.985,
        size: rnd(4, 12), life: rnd(60, 100), rot: rnd(0, 6), vr: rnd(-0.35, 0.35),
        verts: Array.from({ length: nv }, (_, k) => [(k / nv) * Math.PI * 2 + rnd(-0.3, 0.3), rnd(0.6, 1.1)]),
        color: pick(LOGO_COLORS), edge: 'rgba(80,0,10,0.8)' });
    }
    kick();
  }

  // 勝敗が決まったとき：勝った側の演出で、負けた側の石を全部消す。
  // デストロイ＝ひびが入って割れる／炎＝燃え尽きる／氷＝凍ってから割れる／雷＝感電してから砕ける／闇＝渦に呑み込まれる／光＝天に召される。
  // 石は中心から外へ波のように順番に消える。かかる時間（ms）を返す
  function victory(points, loserColor, stoneSize, themeKey = 'default', center) {
    const n = points.length;
    if (!n) return 0;
    if (!THEMES[themeKey]) themeKey = 'default';
    const cx = center ? center.x : points.reduce((a, p) => a + p.x, 0) / n;
    const cy = center ? center.y : points.reduce((a, p) => a + p.y, 0) / n;
    // 石が多いほど 1 子あたりの粒を減らす（重くならないように）
    const k = n > 60 ? 0.35 : n > 25 ? 0.55 : n > 10 ? 0.8 : 1;
    const c = { points, n, ti: 3, tier: TIERS[3], theme: THEMES[themeKey], themeKey, white: loserColor === 2, stone: stoneSize,
      power: 0.3, sounds: 14, cx, cy, partsPer: Math.ceil(30 * k), charge: 0 };
    const order = points.map((p) => ({ p, d: Math.hypot(p.x - cx, p.y - cy) })).sort((a, b) => a.d - b.d).map((o) => o.p);
    const span = Math.min(2200, 600 + n * 25);
    const at = (i) => 250 + (n > 1 ? (i / (n - 1)) * span : 0);
    const end = at(n - 1);
    const soundEvery = Math.max(1, Math.ceil(n / 12));
    const snd = (i, fn) => { if (i % soundEvery === 0) fn(); };
    if (themeKey === 'default') {
      order.forEach((p, i) => holdStone(p, c, 350 + at(i), () => {
        pulverize(p, c, 0.9 * k + 0.2);
        snd(i, () => crush(0.3));
      }, { cracks: stoneCracks() }));
    } else if (themeKey === 'fire') {
      order.forEach((p, i) => later(at(i), () => {
        const life = 900;
        holdStone(p, c, life, () => {
          smoke(p.x, p.y, Math.ceil(3 * k) + 1, c.stone * 0.8, 1.5, '#3a302a', 0.6); // 灰の煙
          for (let j = 0; j < Math.ceil(8 * k) + 2; j++) { // 舞い上がる火の粉
            spawn({ kind: 'spark', x: p.x + rnd(-5, 5), y: p.y, vx: rnd(-1, 1), vy: -rnd(1, 4), g: -0.02, drag: 0.97, size: rnd(1, 2.5), life: rnd(30, 70), color: pick(['#ffdd55', '#ff9a1f', '#ff5a00']) });
          }
        }, { burning: true });
        emit(frames(life * 0.9), (t) => { if (t % 3 === 0) flames(p.x, p.y + c.stone * 0.2, 1, c.stone * 0.7, 2.5, 1.2); });
        snd(i, () => crackle(0.25));
      }));
    } else if (themeKey === 'ice') {
      // まず全部凍らせてから、順番に割る
      order.forEach((p, i) => holdStone(p, c, 700 + at(i), () => {
        shards(p.x, p.y, c, Math.ceil(10 * k) + 2, 7);
        snow(p.x, p.y, Math.ceil(6 * k) + 1, c.stone);
        ring(p.x, p.y, c.stone * 1.8, '#bff3ff', { w: 3, life: 18 });
        snd(i, () => shatter(0.25));
      }, { frozen: true }));
      later(200, () => ring(cx, cy, Math.max(W, H) * 0.8, '#bff3ff', { w: 20, life: 40 }));
    } else if (themeKey === 'thunder') {
      // 全部が帯電して電撃でつながり、ひびが入ってから順番に砕ける
      order.forEach((p, i) => holdStone(p, c, 800 + at(i), () => {
        lightning(p.x, p.y, pick(['#fff59a', '#7ad7ff']), { width: 3, life: 12 });
        pulverize(p, c, 0.8 * k + 0.2);
        spawn({ kind: 'orb', x: p.x, y: p.y, size: c.stone * 2, life: 12, color: '#7ad7ff' });
        snd(i, () => crack(0.2));
      }, { charged: true, cracks: stoneCracks() }));
      const pts = order.slice(0, 40);
      emit(frames(800 + end), (t) => {
        if (t % 4) return;
        for (let i = 0; i + 1 < pts.length; i++) if (Math.random() < 0.5) boltBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, pick(['#fff59a', '#7ad7ff']), { life: 6, width: 2, jag: 10 });
      });
      later(0, () => crack(0.4));
    } else if (themeKey === 'dark') {
      // 盤の真ん中に闇の渦。石はひびが入ってから、らせんを描いて吸い込まれる
      const R = stoneSize * 1.5, durMs = 1400 + end;
      const attract = { x: cx, y: cy, pull: 1.6, swirl: 1.4, eat: R * 0.35 };
      spawn({ kind: 'hole', x: cx, y: cy, size: R, static: true, life: frames(durMs), onDeath: () => {
        parts.forEach((q) => { if (q.attract === attract) q.t = q.life; });
        spawn({ kind: 'orb', x: cx, y: cy, size: R * 6, life: 26, color: '#b066ff' });
        ring(cx, cy, R * 10, '#e0c8ff', { w: 24, life: 34 });
        implode(0.8);
      } });
      order.forEach((p, i) => holdStone(p, c, 300 + at(i) * 0.6, () => {
        spawn({ kind: 'stone', white: c.white, x: p.x, y: p.y, size: c.stone / 2, size0: c.stone / 2, d0: Math.hypot(p.x - cx, p.y - cy),
          life: frames(durMs), drag: 1, vr: rnd(0.15, 0.35), attract });
      }, { cracks: stoneCracks() }));
      for (let i = 0; i < 5; i++) ring(cx, cy, R * 0.6, i % 2 ? '#e0c8ff' : '#7a2cff', { r0: Math.max(W, H) * 0.6, w: 10, life: 40, delay: i * 12 });
    } else if (themeKey === 'light') {
      spawn({ kind: 'rays', x: W / 2, y: -H * 0.05, size: Math.max(W, H) * 1.1, count: 16, spin: 0.004, static: true, life: frames(end + 1800) });
      order.forEach((p, i) => {
        const ms = 300 + at(i);
        later(Math.max(0, ms - 150), () => spawn({ kind: 'beam', x: p.x, y: p.y, size: c.stone * 0.7, life: 40 }));
        holdStone(p, c, ms, () => {
          spawn({ kind: 'stone', holy: true, white: c.white, x: p.x, y: p.y, size: c.stone / 2, life: 80, vx: rnd(-0.3, 0.3), vy: -1, g: -0.06, drag: 1, vr: 0 });
          for (let j = 0; j < Math.ceil(6 * k) + 1; j++) spawn({ kind: 'star', x: p.x + rnd(-8, 8), y: p.y + rnd(-8, 8), vx: rnd(-0.5, 0.5), vy: -rnd(0.5, 2), size: rnd(1.5, 3), life: rnd(30, 60), color: pick(['#ffffff', '#fff6d8', '#ffe7a3']) });
          snd(i, () => blip(1200 + rnd(0, 600), 0.25, 'sine', 0.05));
        });
      });
    }
    shake(6, 600);
    kick();
    return themeKey === 'dark' ? 1700 + end : end + 1500; // 闇は渦が潰れるのを待つ
  }

  // 地の総攻撃：地の点から光の弾が飛び出し、相手の HP バー（target）に降り注ぐ。全部が当たり終わるまでの時間（ms）を返す
  function volley(points, target, themeKey = 'default') {
    const th = THEMES[themeKey] || THEMES.default;
    const cols = themeKey === 'default' ? ['#ffffff', '#ffd84a', '#ff8a1f', '#ff4b1f'] : th.palette;
    const n = points.length;
    if (!n) return 0;
    const span = Math.min(900, 200 + n * 12);
    const attract = { x: target.x, y: target.y, pull: 2.6, swirl: 0, eat: 18 };
    let hits = 0;
    points.forEach((p, i) => later((i / Math.max(1, n - 1)) * span, () => {
      const col = pick(cols);
      spawn({ kind: 'spark', x: p.x, y: p.y, vx: rnd(-5, 5), vy: -rnd(6, 12), drag: 1, size: rnd(4, 6), life: 160, color: col, attract,
        trail: (q) => { // 光の尾
          if (q.t % 2 === 0) spawn({ kind: 'orb', x: q.x, y: q.y, size: 14, life: 10, color: col });
          spawn({ kind: 'dot', x: q.x, y: q.y, vx: 0, vy: 0, drag: 1, size: rnd(1, 2.2), life: 18, color: col });
        },
        onDeath: (q) => {
          if (Math.hypot(q.x - target.x, q.y - target.y) > 40) return;
          spawn({ kind: 'orb', x: target.x + rnd(-30, 30), y: target.y + rnd(-6, 6), size: 26, life: 12, color: col });
          if (hits++ % Math.max(1, Math.ceil(n / 10)) === 0) blip(300 + rnd(0, 200), 0.06, 'square', 0.05);
        } });
      spawn({ kind: 'orb', x: p.x, y: p.y, size: 20, life: 10, color: col });
    }));
    kick();
    return span + 700;
  }

  // 流れている演出をすべて止める（プレビューを途中でやめたときなど）
  // 画面上に演出が残っているか（予約中の演出・文字も含む）。碁盤に残るひびや跡は含まない
  function busy() {
    return parts.length > 0 || rings.length > 0 || bolts.length > 0 || emitters.length > 0 || timers.size > 0 || banner.classList.contains('show');
  }

  function clear() {
    generation++;
    timers.forEach((id) => clearTimeout(id)); timers.clear();
    parts = []; rings = []; bolts = []; emitters = [];
    c2.clearRect(0, 0, W, H);
    banner.className = ''; flashEl.className = ''; vignette.className = '';
    stage.classList.remove('shaking');
    playing.forEach((src) => { try { src.stop(); } catch (e) { /* 再生前なら無視 */ } });
    playing.clear();
  }

  root.FX = {
    capture, victory, volley, stoneClick, gameStart, heal, blip, boom, tierIndex, clear, busy, logoHit, logoChunks, rattle, chargeUp,
    themes: Object.keys(THEMES).map((key) => ({ key, label: THEMES[key].label, mark: THEMES[key].mark, color: THEMES[key].color, shield: THEMES[key].shield })),
    setMuted(m) { muted = m; }, isMuted: () => muted,
    setVolume(v) { volume = v; if (ctx) ctx.master.gain.value = v; },
    unlock: ac,
  };
})(this);
