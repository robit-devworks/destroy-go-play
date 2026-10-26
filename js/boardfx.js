// 碁盤そのものが凍る・燃える・帯電する・えぐれる演出（盤の上に重ねるレイヤー）
(function (root) {
  'use strict';

  const cv = document.getElementById('board-fx');
  const g = cv.getContext('2d');
  const wrap = document.getElementById('board-wrap');
  // 黒用・白用のレイヤー。陣地ヒント（にじみ・つながり）と、取った場所に残す跡を描く
  const own = { 1: document.getElementById('own-1'), 2: document.getElementById('own-2') };
  const og = { 1: own[1].getContext('2d'), 2: own[2].getContext('2d') };
  const TRACE_ALPHA = 0.45;
  const TRACE_ALPHA_BY = { fire: 0.7, light: 0.95 }; // 焼け跡は薄いと茶色いしみに見えるので濃いめに残す。光の星もはっきり残す
  let traces = [], layerKey = '';
  let traceComp = null, traceCompKey = ''; // 跡を重ね合わせた画像（黒・白それぞれ）。跡が増減したときだけ作り直す

  // レベル（effects.js の TIERS の番号）ごとの持続時間。0 のレベルでは何もしない
  const DURATION = {
    default: [3000, 3500, 4000, 5000, 6500, 9000, 11000], // デストロイは 1 子からひびが入る
    clear: [3000, 3500, 4000, 5000, 6500, 9000, 11000], // 消滅も 1 子から盤がえぐれる
    other: [0, 0, 0, 3500, 5000, 7500, 9500],
  };
  const FULL_FROM = 5; // ULTRA 以上は盤全体

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let S = 0, dpr = 1, cur = null, running = false;
  let stoneSource = () => []; // 盤上の石の座標と半径 {x, y, r} を返す（ひびや跡を石の下に隠すため）

  function resize(size) {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    S = size;
    cv.width = size * dpr; cv.height = size * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of [1, 2]) { own[c].width = size * dpr; own[c].height = size * dpr; og[c].setTransform(dpr, 0, 0, dpr, 0, 0); }
    layerKey = '';
    if (cur) build(cur);
  }

  function layer() {
    const c = document.createElement('canvas');
    c.width = S * dpr; c.height = S * dpr;
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [c, x];
  }

  // 局所演出のときは、取った石の周りだけ見せるマスクをかける
  function maskTo(c, e) {
    if (e.full) return;
    const [m, mx] = layer();
    // 取った石ごとの範囲に加えて、1 つの大きな模様（闇の渦）を描くテーマはその範囲も見せる
    const areas = e.pts.map((p) => ({ x: p.x, y: p.y, r: e.R }));
    if (e.maskCircle) areas.push(e.maskCircle);
    for (const p of areas) {
      const R = p.r;
      const grd = mx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.65, 'rgba(0,0,0,0.9)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      mx.fillStyle = grd; mx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
    }
    const x = c.getContext('2d');
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(m, 0, 0);
    x.restore();
    return m;
  }

  // ギザギザのひび（折れ線）を作る
  function crackPath(x, y, ang, len, seg, jit = 0.5) {
    const pts = [[x, y]];
    let a = ang;
    for (let d = 0; d < len; d += seg) {
      a += rnd(-jit, jit);
      x += Math.cos(a) * seg; y += Math.sin(a) * seg;
      pts.push([x, y]);
    }
    return pts;
  }
  // 先に行くほど細くなるひび（溝の影＋縁の明るい線で深さを出す）
  function strokeCracks(x, paths, width) {
    x.lineJoin = 'round'; x.lineCap = 'round';
    for (const p of paths) {
      const w0 = width * (p.w || 1);
      for (let i = 1; i < p.length; i++) {
        const w = Math.max(0.8, w0 * (1 - 0.75 * i / p.length));
        x.strokeStyle = 'rgba(255,235,190,0.45)'; x.lineWidth = w * 0.5;
        x.beginPath(); x.moveTo(p[i - 1][0] + w * 0.45, p[i - 1][1] + w * 0.45); x.lineTo(p[i][0] + w * 0.45, p[i][1] + w * 0.45); x.stroke();
        x.strokeStyle = 'rgba(28,12,4,0.92)'; x.lineWidth = w;
        x.beginPath(); x.moveTo(p[i - 1][0], p[i - 1][1]); x.lineTo(p[i][0], p[i][1]); x.stroke();
      }
    }
  }
  // 枝分かれしながら伸びるひび
  function crackTree(out, x, y, ang, len, seg, depth, w = 1) {
    // 木の割れ目らしく、ほぼまっすぐ進んでときどき折れ曲がる
    const path = crackPath(x, y, ang, len, seg, 0.22);
    path.w = w;
    out.push(path);
    if (depth <= 0) return;
    for (let i = 2; i < path.length - 1; i++) {
      if (Math.random() < 0.16) crackTree(out, path[i][0], path[i][1], ang + rnd(0.5, 1) * (Math.random() < 0.5 ? 1 : -1), len * rnd(0.25, 0.45), seg * 0.8, depth - 1, w * 0.55);
    }
  }
  function strokePaths(x, paths, width, color) {
    x.strokeStyle = color; x.lineWidth = width; x.lineJoin = 'round'; x.lineCap = 'round';
    for (const p of paths) {
      x.beginPath(); x.moveTo(p[0][0], p[0][1]);
      for (const q of p) x.lineTo(q[0], q[1]);
      x.stroke();
    }
  }
  function crater(x, cx, cy, r) {
    const soot = x.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4);
    soot.addColorStop(0, 'rgba(20,10,5,0.55)'); soot.addColorStop(1, 'rgba(20,10,5,0)');
    x.fillStyle = soot; x.beginPath(); x.arc(cx, cy, r * 2.4, 0, Math.PI * 2); x.fill();
    const hole = x.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
    hole.addColorStop(0, 'rgba(10,5,2,0.95)'); hole.addColorStop(0.7, 'rgba(45,25,10,0.9)'); hole.addColorStop(1, 'rgba(120,80,40,0.6)');
    x.fillStyle = hole; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(230,190,120,0.55)'; x.lineWidth = r * 0.18;
    x.beginPath(); x.arc(cx, cy, r * 1.05, Math.PI * 0.9, Math.PI * 1.9); x.stroke();
  }

  // 炎の焼け跡：木が焼け焦げた跡。ふちがでこぼこした焦げ（薄茶 → こげ茶 → 炭の黒）と、
  // 炭化した中心の細かいひび割れ、ひびの奥に少しだけ残るくすぶり
  function burnMark(x, p, cell) {
    const n = 16, base = cell * rnd(0.78, 0.92), noise = Array.from({ length: n }, () => rnd(0.75, 1.15));
    const blob = (scale, color) => {
      x.fillStyle = color;
      x.beginPath();
      for (let i = 0; i <= n; i++) {
        const k = i % n, ang = (k / n) * Math.PI * 2, rr = base * scale * noise[k];
        const px = p.x + Math.cos(ang) * rr, py = p.y + Math.sin(ang) * rr;
        if (i) x.lineTo(px, py); else x.moveTo(px, py);
      }
      x.closePath(); x.fill();
    };
    blob(1, 'rgba(110,55,20,0.55)'); // 外側の薄い焦げ
    blob(0.8, 'rgba(60,25,8,0.8)'); // こげ茶
    blob(0.58, 'rgba(18,10,6,0.95)'); // 炭化した中心
    // 炭のひび割れ（炭化した木の表面のように、短いひびが網目状に入る）
    x.lineCap = 'round'; x.lineJoin = 'round';
    const cracks = [];
    for (let i = 0; i < 7; i++) {
      const ang = rnd(0, Math.PI * 2), d = rnd(0, base * 0.3);
      cracks.push(crackPath(p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, rnd(0, Math.PI * 2), base * rnd(0.25, 0.45), cell * 0.08, 0.6));
    }
    x.strokeStyle = 'rgba(120,95,80,0.75)'; x.lineWidth = 1;
    for (const c of cracks) { x.beginPath(); c.forEach(([px, py], k) => (k ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke(); }
    // ひびの奥のくすぶり
    for (let i = 0; i < 3; i++) {
      const c = pick(cracks), [ex, ey] = c[Math.floor(rnd(0, c.length))], r = cell * rnd(0.025, 0.045);
      x.fillStyle = 'rgba(255,80,10,0.9)'; x.beginPath(); x.arc(ex, ey, r, 0, Math.PI * 2); x.fill();
    }
  }
  // 闇の刻印：取ったときに現れた闇の渦（黒い穴と、まわりを回る紫の光の筋）が小さく残ったもの
  function voidMark(x, p, r) {
    const glow = x.createRadialGradient(p.x, p.y, r * 0.8, p.x, p.y, r * 2.4);
    glow.addColorStop(0, 'rgba(190,100,255,0.85)'); glow.addColorStop(0.45, 'rgba(120,40,220,0.45)'); glow.addColorStop(1, 'rgba(60,0,120,0)');
    x.fillStyle = glow; x.beginPath(); x.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2); x.fill();
    x.lineCap = 'round'; x.lineWidth = Math.max(1.5, r * 0.16);
    for (let i = 0; i < 5; i++) { // 回る光の筋（止まった一瞬の形）
      const a0 = p.rot * Math.PI * 2 + (i * Math.PI * 2) / 5, rr = r * (1.2 + i * 0.14);
      x.strokeStyle = i % 2 ? 'rgba(255,120,240,0.85)' : 'rgba(200,150,255,0.9)';
      x.beginPath(); x.arc(p.x, p.y, rr, a0, a0 + 1.6); x.stroke();
    }
    const core = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    core.addColorStop(0, '#000000'); core.addColorStop(0.75, '#05000c'); core.addColorStop(1, 'rgba(40,0,70,0.9)');
    x.fillStyle = core; x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill();
  }

  // 霜の結晶（枝分かれする線）
  function frost(x, cx, cy, ang, len, depth) {
    const ex = cx + Math.cos(ang) * len, ey = cy + Math.sin(ang) * len;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(ex, ey); x.stroke();
    if (depth <= 0) return;
    for (let i = 1; i <= 3; i++) {
      const k = i / 4, bx = cx + (ex - cx) * k, by = cy + (ey - cy) * k;
      frost(x, bx, by, ang + 0.9, len * 0.35, depth - 1);
      frost(x, bx, by, ang - 0.9, len * 0.35, depth - 1);
    }
  }

  // ---------- テーマ別：動かない層（stat）と脈打つ層（glow）を作る ----------
  // 消滅：盤がえぐれたくぼみ。ふちはでこぼこ、左上の内側は影、右下の内側は削れた明るい木肌、外側に盛り上がった縁
  function gouge(x, cx, cy, r, rough = 0.12, lip = r * 0.14) {
    const n = Math.max(20, Math.round(r / 2)), f1 = rnd(0, 6.3), f2 = rnd(0, 6.3);
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2, k = 1 + rough * (Math.sin(a * 3 + f1) * 0.5 + Math.sin(a * 7 + f2) * 0.3 + rnd(-0.25, 0.25));
      return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
    });
    const path = () => { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); };
    x.save();
    path(); x.strokeStyle = 'rgba(255,236,200,0.5)'; x.lineWidth = lip; x.lineJoin = 'round'; x.stroke(); // 外側の盛り上がった縁
    path();
    const deep = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r); // 左上は影、右下は削れた明るい木肌
    deep.addColorStop(0, 'rgba(18,8,2,0.95)'); deep.addColorStop(0.5, 'rgba(70,40,16,0.9)'); deep.addColorStop(1, 'rgba(160,110,60,0.85)');
    x.fillStyle = deep; x.fill();
    x.clip();
    path(); x.shadowColor = 'rgba(0,0,0,0.85)'; x.shadowBlur = r * 0.3; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = Math.max(2, r * 0.1); x.stroke(); // 内側のふちの影
    x.shadowBlur = 0;
    x.strokeStyle = 'rgba(30,14,4,0.3)'; x.lineWidth = Math.max(1, r * 0.03); // 削った跡の筋
    for (let i = 0; i < 6; i++) { const a = rnd(0, Math.PI * 2); x.beginPath(); x.arc(cx, cy, r * rnd(0.25, 0.85), a, a + rnd(0.5, 1.3)); x.stroke(); }
    x.restore();
  }
  const BUILD = {
    clear(e, x, gx) {
      for (const p of e.seeds) {
        if (p.extra) continue;
        const r = e.cell * (p.main ? 0.62 : 0.55);
        gouge(x, p.x, p.y, r);
        for (let i = 0; i < 4; i++) { const a = rnd(0, 6.3), d = r * rnd(1.15, 1.6); x.fillStyle = 'rgba(40,20,6,0.5)'; x.beginPath(); x.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, e.cell * rnd(0.03, 0.06), 0, Math.PI * 2); x.fill(); } // 飛んだ木くず
        if (e.full) continue; // 大技は真ん中の大きなくぼみに光を集める
        const glow = gx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.3);
        glow.addColorStop(0, 'rgba(255,255,255,0.4)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
        gx.fillStyle = glow; gx.beginPath(); gx.arc(p.x, p.y, r * 1.3, 0, Math.PI * 2); gx.fill();
      }
      if (e.full) { // 盤の真ん中が大きくえぐり取られ、まわりにえぐった筋が走る
        const cx = e.center.x, cy = e.center.y, R = S * (e.ti >= 6 ? 0.3 : 0.22);
        gouge(x, cx, cy, R, 0.07, e.cell * 0.2);
        const glow = gx.createRadialGradient(cx, cy, 0, cx, cy, R);
        glow.addColorStop(0, 'rgba(255,255,255,0.3)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
        gx.fillStyle = glow; gx.fillRect(0, 0, S, S);
      }
    },
    ice(e, x, gx) {
      x.fillStyle = 'rgba(215,245,255,0.32)'; x.fillRect(0, 0, S, S);
      x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 1.1;
      for (const p of e.seeds) for (let i = 0; i < 6; i++) frost(x, p.x, p.y, i * Math.PI / 3 + p.rot, e.cell * rnd(1.6, 2.6), 2);
      if (e.full) { // 盤の縁から霜が伸びる
        for (let d = 0; d < S; d += e.cell * 1.5) {
          frost(x, d, 0, Math.PI / 2 + rnd(-0.4, 0.4), e.cell * rnd(1.5, 3), 2);
          frost(x, d, S, -Math.PI / 2 + rnd(-0.4, 0.4), e.cell * rnd(1.5, 3), 2);
          frost(x, 0, d, rnd(-0.4, 0.4), e.cell * rnd(1.5, 3), 2);
          frost(x, S, d, Math.PI + rnd(-0.4, 0.4), e.cell * rnd(1.5, 3), 2);
        }
        const edge = x.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
        edge.addColorStop(0, 'rgba(255,255,255,0)'); edge.addColorStop(1, 'rgba(235,250,255,0.75)');
        x.fillStyle = edge; x.fillRect(0, 0, S, S);
      }
      // 氷の光沢
      x.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 3; i++) {
        const o = rnd(-S * 0.3, S * 0.6);
        x.beginPath(); x.moveTo(o, 0); x.lineTo(o + S * 0.12, 0); x.lineTo(o - S * 0.25, S); x.lineTo(o - S * 0.37, S); x.fill();
      }
      gx.fillStyle = 'rgba(160,230,255,0.18)'; gx.fillRect(0, 0, S, S);
    },
    fire(e, x, gx) {
      for (const p of e.seeds) {
        const r = e.cell * rnd(1.2, 1.9);
        const grd = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grd.addColorStop(0, 'rgba(15,5,0,0.9)'); grd.addColorStop(0.55, 'rgba(60,20,0,0.6)'); grd.addColorStop(1, 'rgba(60,20,0,0)');
        x.fillStyle = grd; x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill();
        const glow = gx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.4);
        glow.addColorStop(0, 'rgba(255,140,0,0.65)'); glow.addColorStop(1, 'rgba(255,60,0,0)');
        gx.fillStyle = glow; gx.beginPath(); gx.arc(p.x, p.y, r * 1.4, 0, Math.PI * 2); gx.fill();
        burnMark(x, p, e.cell);
      }
      if (e.full) { // 焦げた縁と、全体の赤熱
        const burn = x.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.75);
        burn.addColorStop(0, 'rgba(40,10,0,0.1)'); burn.addColorStop(1, 'rgba(25,5,0,0.85)');
        x.fillStyle = burn; x.fillRect(0, 0, S, S);
        const hot = gx.createLinearGradient(0, S, 0, 0);
        hot.addColorStop(0, 'rgba(255,90,0,0.55)'); hot.addColorStop(0.5, 'rgba(255,60,0,0.15)'); hot.addColorStop(1, 'rgba(255,60,0,0.05)');
        gx.fillStyle = hot; gx.fillRect(0, 0, S, S);
      }
    },
    thunder(e, x, gx) {
      x.fillStyle = e.full ? 'rgba(20,30,80,0.35)' : 'rgba(60,90,200,0.2)'; x.fillRect(0, 0, S, S);
      for (const p of e.seeds) {
        const grd = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, e.cell * 0.8);
        grd.addColorStop(0, 'rgba(10,10,20,0.85)'); grd.addColorStop(1, 'rgba(10,10,20,0)');
        x.fillStyle = grd; x.beginPath(); x.arc(p.x, p.y, e.cell * 0.8, 0, Math.PI * 2); x.fill();
        strokePaths(x, Array.from({ length: 5 }, () => crackPath(p.x, p.y, rnd(0, 6.3), e.cell * rnd(0.8, 1.6), e.cell * 0.25)), 1, 'rgba(10,10,30,0.7)');
        const glow = gx.createRadialGradient(p.x, p.y, 0, p.x, p.y, e.cell * 2);
        glow.addColorStop(0, 'rgba(140,210,255,0.55)'); glow.addColorStop(1, 'rgba(140,210,255,0)');
        gx.fillStyle = glow; gx.beginPath(); gx.arc(p.x, p.y, e.cell * 2, 0, Math.PI * 2); gx.fill();
      }
    },
    light(e, x, gx) { // 金色に輝く光だまりと、放射状の光の筋
      if (e.full) { x.fillStyle = 'rgba(255,245,215,0.3)'; x.fillRect(0, 0, S, S); }
      for (const p of e.seeds) {
        const r = e.cell * rnd(1.1, 1.6) * (p.main ? 1.2 : 0.9);
        const pool = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        pool.addColorStop(0, 'rgba(255,255,245,0.85)'); pool.addColorStop(0.5, 'rgba(255,230,160,0.45)'); pool.addColorStop(1, 'rgba(255,220,140,0)');
        x.fillStyle = pool; x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill();
        gx.lineCap = 'round';
        for (let i = 0; i < 8; i++) { // 光の筋
          const ang = p.rot * 6 + (i * Math.PI) / 4, l = r * (i % 2 ? 0.9 : 1.4);
          gx.strokeStyle = 'rgba(255,240,190,0.75)'; gx.lineWidth = i % 2 ? 1 : 2;
          gx.beginPath(); gx.moveTo(p.x + Math.cos(ang) * r * 0.2, p.y + Math.sin(ang) * r * 0.2); gx.lineTo(p.x + Math.cos(ang) * l, p.y + Math.sin(ang) * l); gx.stroke();
        }
      }
    },
    dark(e, x, gx) { // 取った石の真ん中に大きな闇の渦を 1 つ（石ごとに小さな渦を並べない）
      if (e.full) { x.fillStyle = 'rgba(20,0,40,0.35)'; x.fillRect(0, 0, S, S); }
      const pts = e.pts.length ? e.pts : e.seeds;
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const spread = Math.max(0, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
      const r = Math.min(e.cell * 1.6, e.cell * 0.35 + spread * 0.4); // 渦の穴の大きさ
      const stainR = spread + e.cell * 1.1;
      const stain = x.createRadialGradient(cx, cy, 0, cx, cy, stainR);
      stain.addColorStop(0, 'rgba(8,0,18,0.85)'); stain.addColorStop(0.55, 'rgba(50,10,90,0.5)'); stain.addColorStop(1, 'rgba(50,10,90,0)');
      x.fillStyle = stain; x.beginPath(); x.arc(cx, cy, stainR, 0, Math.PI * 2); x.fill();
      voidMark(x, { x: cx, y: cy, rot: e.seeds[0].rot }, r);
      gx.lineCap = 'round';
      for (let i = 0; i < 4; i++) { // 渦の筋（光る層）
        const a0 = e.seeds[0].rot * 6 + (i * Math.PI) / 2, rr = r * (1.7 + i * 0.25);
        gx.strokeStyle = i % 2 ? 'rgba(255,110,230,0.7)' : 'rgba(180,110,255,0.8)'; gx.lineWidth = Math.max(1.6, r * 0.1);
        gx.beginPath(); gx.arc(cx, cy, rr, a0, a0 + 1.9); gx.stroke();
      }
      e.maskCircle = { x: cx, y: cy, r: Math.max(stainR, r * 3) };
    },
    default(e, x) { // 石が粉砕された跡から、碁盤にひびが走る
      if (e.full) { x.fillStyle = 'rgba(30,15,8,0.22)'; x.fillRect(0, 0, S, S); }
      const cracks = [];
      const len = e.cell * (1.5 + Math.min(e.ti, 4) * 0.6);
      for (const p of e.seeds) {
        // 石があった場所のへこみ
        const r = e.cell * (p.extra ? 0.3 : 0.42);
        const dent = x.createRadialGradient(p.x - r * 0.2, p.y - r * 0.2, 0, p.x, p.y, r);
        dent.addColorStop(0, 'rgba(25,12,5,0.8)'); dent.addColorStop(0.7, 'rgba(60,30,10,0.45)'); dent.addColorStop(1, 'rgba(60,30,10,0)');
        x.fillStyle = dent; x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill();
        const n = p.extra ? 3 : 3 + Math.min(e.ti, 3);
        for (let i = 0; i < n; i++) {
          crackTree(cracks, p.x, p.y, (i / n) * Math.PI * 2 + rnd(-0.4, 0.4), len * rnd(0.7, 1.2) * (p.extra ? 0.7 : 1), e.cell * 0.3, e.ti >= 3 ? 2 : 1);
        }
      }
      if (e.full) { // 盤を割る大きな亀裂
        const n = e.ti >= 6 ? 9 : 6;
        for (let i = 0; i < n; i++) {
          crackTree(cracks, e.center.x, e.center.y, (i / n) * Math.PI * 2 + rnd(-0.3, 0.3), S * rnd(0.6, 0.9), e.cell * 0.45, 2, 2.2);
        }
      }
      strokeCracks(x, cracks, Math.max(2.8, e.cell * (e.full ? 0.16 : 0.15)));
    },
  };

  function build(e) {
    const [stat, sx] = layer(), [glow, gx] = layer();
    BUILD[e.key](e, sx, gx);
    maskTo(stat, e); maskTo(glow, e);
    e.stat = stat; e.glow = glow;
  }

  // ---------- テーマ別：毎フレーム動く部分 ----------
  function seedNear(e) { const p = pick(e.seeds); return { x: p.x + rnd(-e.cell, e.cell), y: p.y + rnd(-e.cell, e.cell) }; }
  function edgePoint() {
    const d = rnd(0, S);
    return pick([{ x: d, y: S }, { x: d, y: S }, { x: 0, y: d }, { x: S, y: d }, { x: d, y: 0 }]);
  }

  const ANIM = {
    clear(e) { // くぼみから、白い光の粒がゆっくり昇る
      if (Math.random() < (e.full ? 0.7 : 0.35)) {
        const p = seedNear(e);
        e.parts.push({ kind: 'ember', color: pick(['#ffffff', '#dddddd', '#ffffff']), x: p.x, y: p.y, vx: rnd(-0.15, 0.15), vy: -rnd(0.3, 0.9), t: 0, life: rnd(40, 80), size: rnd(0.8, 1.8) });
      }
    },
    ice(e) {
      if (Math.random() < (e.full ? 0.8 : 0.4)) {
        const p = e.full ? { x: rnd(0, S), y: rnd(0, S) } : seedNear(e);
        e.parts.push({ kind: 'sparkle', x: p.x, y: p.y, t: 0, life: 30, size: rnd(2, 5) });
      }
    },
    fire(e) {
      // 盤全体のときは縁を中心に燃やし、盤面の中央は見えるようにしておく
      const n = e.full ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const edge = e.full && Math.random() < 0.8;
        const p = edge ? edgePoint() : seedNear(e);
        e.parts.push({ kind: 'flame', x: p.x, y: p.y, vx: rnd(-0.4, 0.4), vy: -rnd(0.6, 1.8), t: 0, life: rnd(20, edge ? 40 : 30),
          size: e.cell * (edge ? rnd(0.4, 0.8) : rnd(0.25, 0.5)) });
      }
      if (Math.random() < 0.5) {
        const p = seedNear(e);
        e.parts.push({ kind: 'ember', x: p.x, y: p.y, vx: rnd(-0.6, 0.6), vy: -rnd(0.8, 2), t: 0, life: rnd(40, 80), size: rnd(1, 2) });
      }
    },
    thunder(e) {
      // 線に沿って走る電流
      const want = e.full ? 26 : Math.min(16, e.seeds.length * 3);
      while (e.walkers.length < want) {
        const p = e.full && Math.random() < 0.5 ? { x: rnd(0, S), y: rnd(0, S) } : pick(e.seeds);
        const gx = Math.round((p.x - e.margin) / e.cell), gy = Math.round((p.y - e.margin) / e.cell);
        e.walkers.push({ gx, gy, dir: Math.floor(rnd(0, 4)), path: [[gx, gy]], steps: 0, life: Math.floor(rnd(8, 22)) });
      }
      if (e.frame % 2 === 0) {
        for (const w of e.walkers) {
          if (Math.random() < 0.35) w.dir = (w.dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
          const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][w.dir];
          w.gx = Math.max(0, Math.min(e.size - 1, w.gx + dx)); w.gy = Math.max(0, Math.min(e.size - 1, w.gy + dy));
          w.path.push([w.gx, w.gy]); if (w.path.length > 6) w.path.shift();
          w.steps++;
        }
        e.walkers = e.walkers.filter((w) => w.steps < w.life);
      }
      if (e.full && Math.random() < 0.025) e.flicker = 4;
    },
    light(e) { // 光の粒が立ちのぼる
      if (Math.random() < (e.full ? 0.8 : 0.45)) {
        const p = seedNear(e);
        e.parts.push({ kind: 'ember', color: pick(['#ffffff', '#fff6d8', '#ffe7a3']), x: p.x, y: p.y, vx: rnd(-0.2, 0.2), vy: -rnd(0.4, 1.1), t: 0, life: rnd(40, 80), size: rnd(1, 2.2) });
      }
    },
    dark(e) { // 紫の粒が、闇のしみに吸い込まれていく
      if (Math.random() < (e.full ? 0.8 : 0.4)) {
        const p = pick(e.seeds), ang = Math.random() * Math.PI * 2, d = e.cell * rnd(1.4, 2.4), life = rnd(30, 50);
        e.parts.push({ kind: 'ember', color: pick(['#b066ff', '#ff66e0', '#e0c8ff']), x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d,
          vx: -Math.cos(ang) * d / life, vy: -Math.sin(ang) * d / life, t: 0, life, size: rnd(1, 2) });
      }
    },
    default(e) { // 木くずのような粉塵がたつ
      if (e.frame < 40 && Math.random() < (e.full ? 0.7 : 0.35)) {
        const p = seedNear(e);
        e.parts.push({ kind: 'smoke', x: p.x, y: p.y, vx: rnd(-0.4, 0.4), vy: -rnd(0.2, 0.6), t: 0, life: rnd(50, 90),
          size: e.cell * rnd(0.3, 0.6), color: '#8a6a40' });
      }
    },
  };

  function drawParts(e, A) {
    for (const p of e.parts) {
      p.t++;
      if (p.vx !== undefined) { p.x += p.vx; p.y += p.vy; }
      const k = p.t / p.life, a = Math.max(0, 1 - k) * A;
      if (p.kind === 'smoke') {
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = a * 0.35; g.fillStyle = e.variant === 'shimetsu' ? '#6a3a9a' : p.color || '#3a3230';
        g.beginPath(); g.arc(p.x, p.y, p.size * (1 + k * 1.5), 0, Math.PI * 2); g.fill();
        continue;
      }
      g.globalCompositeOperation = 'lighter';
      if (p.kind === 'flame') {
        g.globalAlpha = a * 0.6; g.fillStyle = e.variant === 'aoen' ? `hsl(${195 + 25 * k},100%,${75 - 30 * k}%)` : `hsl(${50 - 50 * k},100%,${60 - 25 * k}%)`;
        g.beginPath(); g.arc(p.x, p.y, p.size * (1 - k * 0.7), 0, Math.PI * 2); g.fill();
      } else if (p.kind === 'ember') {
        g.globalAlpha = a; g.fillStyle = p.color || (e.variant === 'aoen' ? '#8ae0ff' : '#ffc34a');
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill();
      } else if (p.kind === 'sparkle') {
        const s = p.size * Math.sin(k * Math.PI);
        g.globalAlpha = A; g.strokeStyle = '#ffffff'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(p.x - s, p.y); g.lineTo(p.x + s, p.y); g.moveTo(p.x, p.y - s); g.lineTo(p.x, p.y + s); g.stroke();
      }
    }
    e.parts = e.parts.filter((p) => p.t < p.life);
  }

  function drawWalkers(e, A) {
    g.globalCompositeOperation = 'lighter';
    g.shadowBlur = 12;
    for (const w of e.walkers) {
      if (w.path.length < 2) continue;
      const crimson = e.variant === 'crimson';
      const col = crimson ? pick(['#ff2a3a', '#c0001a', '#ff5a5a']) : pick(['#bfe9ff', '#7ad7ff', '#fff59a']);
      g.strokeStyle = col; g.shadowColor = col; g.lineWidth = crimson ? 3 : 2;
      g.globalAlpha = A * (Math.random() < 0.2 ? 0.3 : 0.9);
      g.beginPath();
      w.path.forEach(([gx, gy], i) => {
        const x = e.margin + gx * e.cell, y = e.margin + gy * e.cell;
        if (i === 0) g.moveTo(x, y);
        else {
          const [px, py] = w.path[i - 1];
          const mx = e.margin + (px + gx) / 2 * e.cell + rnd(-3, 3), my = e.margin + (py + gy) / 2 * e.cell + rnd(-3, 3);
          g.lineTo(mx, my); g.lineTo(x, y);
        }
      });
      g.stroke();
      if (crimson) { // 紅雷：芯が黒い電流
        g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.strokeStyle = '#0a0002'; g.lineWidth = 1.2; g.stroke();
        g.globalCompositeOperation = 'lighter'; g.shadowBlur = 12;
      }
    }
    g.shadowBlur = 0;
  }

  function frame(now) {
    const e = cur;
    if (!e) { running = false; return; }
    // rAF の時刻は apply 時の performance.now() よりわずかに前のことがある
    if (now < e.start) { requestAnimationFrame(frame); return; } // 隕石の着弾待ち
    if (!e.started) { e.started = true; wrap.dataset.bfx = e.full ? e.key : ''; wrap.dataset.bfxv = e.full && e.variant ? e.variant : ''; }
    const age = Math.max(0, now - e.start), k = age / e.dur;
    if (k >= 1) { clear(); running = false; return; }
    const A = Math.min(1, age / 350) * (k > 0.65 ? (1 - k) / 0.35 : 1);
    e.frame++;
    if (k > 0.65 && wrap.dataset.bfx) wrap.dataset.bfx = wrap.dataset.bfxv = ''; // 盤の色は先に戻し始める

    g.clearRect(0, 0, S, S);
    const grow = Math.min(1, age / 320);
    if (grow < 1) { // 取った場所から広がっていく
      const rr = e.revealR * (1 - Math.pow(1 - grow, 2));
      g.save(); g.beginPath();
      for (const p of e.seeds.concat(e.center)) { g.moveTo(p.x + rr, p.y); g.arc(p.x, p.y, rr, 0, Math.PI * 2); }
      g.clip();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = A; g.drawImage(e.stat, 0, 0, S, S);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = A * (0.55 + 0.45 * Math.sin(age / 160));
    g.drawImage(e.glow, 0, 0, S, S);
    if (grow < 1) g.restore();
    if (e.key === 'default' || e.key === 'clear') { // ひび・くぼみは碁盤に入るもの。石の上には描かない
      g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.fillStyle = '#000';
      g.beginPath();
      for (const p of stoneSource()) { g.moveTo(p.x + p.r, p.y); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); }
      g.fill();
    }

    ANIM[e.key](e);
    drawParts(e, A);
    if (e.walkers.length) drawWalkers(e, A);
    if (e.flicker > 0) {
      e.flicker--;
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = A * 0.3; g.fillStyle = e.variant === 'crimson' ? '#ff2a3a' : '#9fc8ff'; g.fillRect(0, 0, S, S);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  }

  // key: テーマ, ti: 演出レベル, pts: 取った石の盤上座標(CSS px), geo: {cell, margin}
  // 色違いの演出（紅雷など）は、碁盤の上では元の演出（雷など）として描いてから、色を付け替える
  const baseKey = (k) => (root.FX && root.FX.baseOf ? root.FX.baseOf(k) : k);
  // 色相・彩度・明るさ（0〜360・0〜1・0〜1）を付け替える
  const VARIANT = {
    crimson: (h, s, l) => (s < 0.08 ? [h, s, l * 0.7] : [355, 1, Math.min(l * 0.75, 0.42)]), // 紅雷：赤黒く
    // 蒼炎：火力が強すぎて青くなった炎。焦げ跡はほぼ黒（ほんのり青。くすんだ青だとカビに見える）、燃えている間の光は鮮やかな青
    aoen: (h, s, l, a) => (s < 0.08 || (h > 75 && h < 330) ? [h, s, l] : l < 0.3 ? [228, 0.5, l * 0.22] : [205, 1, Math.max(0.65, l), a * 0.28]), // 青い光を木の黄色に重ねると緑っぽく濁るので、薄く・白っぽく
    // 紫滅：ひび（濃い線）だけ紫に。盤全体のうすい影は元のまま
    shimetsu: (h, s, l, a) => (a < 0.55 || s < 0.05 || (h > 60 && h < 330) ? [h, s, l] : [285, Math.max(s, 0.75), Math.max(l, 0.24)]),
    // 黄金：金継ぎ風。ひびの芯（暗いところ）は黒く残し、明るい筋を金色にする（ふちの金の光は kintsugi で足す）
    // 虹滅：ひびの芯は黒く残し、筋を虹色に（場所で色が変わる）
    kometsu: (h, s, l, a, x, y) => (a < 0.4 ? [h, s, l] : l < 0.5 ? [h, Math.min(s, 0.3), l * 0.5] : s < 0.3 ? [((x + y) * 1.6) % 360, 1, Math.min(0.7, Math.max(0.6, l))] : [h, s, l]),
    // （木の色に近い明るい部分は元のまま。白っぽい筋だけを金にする）
    ougon: (h, s, l, a) => (a < 0.4 ? [h, s, l] : l < 0.1 ? [30, 0.3, l * 0.5] : l < 0.5 ? [42, 0.8, 0.2 + l * 0.55] : s < 0.3 ? [46, 1, Math.min(0.8, Math.max(0.6, l))] : [h, s, l]),
  };
  function hsl2rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function recolor(cv, variant, mapOverride) {
    const map = mapOverride || VARIANT[variant];
    if (!map) return;
    const x = cv.getContext('2d'), img = x.getImageData(0, 0, cv.width, cv.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const r = d[i] / 255, g2 = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), l = (mx + mn) / 2, dd = mx - mn;
      const s2 = dd ? dd / (1 - Math.abs(2 * l - 1) || 1) : 0;
      let h = 0;
      if (dd) h = mx === r ? 60 * (((g2 - b) / dd) % 6) : mx === g2 ? 60 * ((b - r) / dd + 2) : 60 * ((r - g2) / dd + 4);
      if (h < 0) h += 360;
      const px = (i >> 2) % cv.width, py = ((i >> 2) / cv.width) | 0; // 場所で色を変える演出（虹滅）用
      const [h3, s3, l3, a3] = map(h, Math.min(1, s2), l, d[i + 3] / 255, px, py), [R, G, B] = hsl2rgb(h3 % 360, s3, l3);
      d[i] = R; d[i + 1] = G; d[i + 2] = B; if (a3 !== undefined) d[i + 3] = a3 * 255;
    }
    x.putImageData(img, 0, 0);
  }
  // 金継ぎ風：ひびの形をした金色を、ひびの後ろにぼかして置く（黒いひびのふちが金色に光って見える）
  function kintsugi(cv) {
    const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height;
    const tx = t.getContext('2d');
    tx.drawImage(cv, 0, 0);
    // 濃い線だけを金色の形にする（うすい影まで光らせると、盤全体が黄色くかすむ）
    const img = tx.getImageData(0, 0, t.width, t.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 170) { d[i + 3] = 0; continue; }
      d[i] = 255; d[i + 1] = 207; d[i + 2] = 58;
    }
    tx.putImageData(img, 0, 0);
    const x = cv.getContext('2d');
    x.save(); x.globalCompositeOperation = 'destination-over';
    // 影だけを描く（形そのものは画面の外に置き、ぼかした影だけをひびの位置に戻す）。うすいひびの後ろが金で塗りつぶされないように
    x.shadowColor = 'rgba(255,205,60,1)'; x.shadowBlur = Math.max(3, cv.width / 180); x.shadowOffsetX = cv.width * 2;
    for (let k = 0; k < 3; k++) x.drawImage(t, -cv.width * 2, 0);
    x.restore();
  }
  function apply(key, ti, pts, geo) {
    const variant = VARIANT[key] ? key : null;
    key = baseKey(key);
    const dur = (DURATION[key] || DURATION.other)[ti];
    if (!dur || !pts.length || !S || !BUILD[key]) return;
    const full = ti >= FULL_FROM;
    const seeds = pts.map((p, i) => ({ x: p.x, y: p.y, rot: rnd(0, 1), main: i === 0 }));
    if (full) {
      const extra = ti >= 6 ? 14 : 8;
      for (let i = 0; i < extra; i++) seeds.push({ x: rnd(0, S), y: rnd(0, S), rot: rnd(0, 1), main: false, extra: true });
    }
    const center = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    // 局所演出の見える範囲。デストロイのひびは取った数に応じて伸びる
    const R = key === 'default' ? geo.cell * (2.4 + Math.min(ti, 4) * 0.8) : geo.cell * (ti >= 4 ? 3.4 : 2.4);
    cur = {
      key, ti, full, pts, seeds, center, cell: geo.cell, margin: geo.margin, size: geo.size,
      // デストロイの ULTRA 以上は、隕石が着弾してからひびが入る（破壊神は噴火の後）
      R, revealR: full ? S * 1.2 : R * 1.2, start: performance.now() + (key === 'default' && full ? (ti >= 6 ? 1100 : 500) : 0), dur,
      parts: [], walkers: [], frame: 0, flicker: 0, variant,
    };
    build(cur);
    // 黄金は、燃えている間の光（glow）は元の色のまま（金色に塗ると盤が黄色くかすむ）
    if (variant) { recolor(cur.stat, variant); if (variant !== 'ougon' && variant !== 'kometsu') recolor(cur.glow, variant); if (variant === 'ougon') kintsugi(cur.stat); }
    wrap.dataset.bfx = '';
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  function clear() {
    cur = null;
    g.clearRect(0, 0, S, S);
    wrap.dataset.bfx = wrap.dataset.bfxv = '';
  }

  // 光の跡：黄色い星。shape 'spiky' は長い光 8 本と短い光 8 本、'diamond' はダイヤのようなきらめき（長い光 4 本と短い光 4 本）
  // big が true なら、たくさん取ったとき（BIG_STAR 子以上）に 1 つの大きな星にする
  const LIGHT_STAR = Object.assign({ shape: 'diamond', big: true }, root.__lightStar || {}); // __lightStar は見比べ用
  const BIG_STAR = 5;
  function lightStar(x, cx, cy, r, shape = LIGHT_STAR.shape) {
    x.save(); x.translate(cx, cy);
    x.fillStyle = '#f5d22e'; x.shadowColor = 'rgba(255,220,80,0.8)'; x.shadowBlur = r * 0.15;
    x.beginPath();
    const diamond = shape === 'diamond';
    const n = diamond ? 8 : 16, inner = r * (diamond ? 0.16 : 0.2);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const len = diamond ? (i % 2 === 0 ? r : r * 0.42) // 上下左右が長い 4 本の光
        : i % 4 === 0 ? r : i % 2 === 0 ? r * 0.82 : r * 0.58; // 上下左右がいちばん長い
      const b = a + Math.PI / n;
      x.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      x.lineTo(Math.cos(b) * inner, Math.sin(b) * inner);
    }
    x.closePath(); x.fill();
    x.beginPath(); x.arc(0, 0, r * (diamond ? 0.2 : 0.26), 0, Math.PI * 2); x.fill();
    x.restore();
  }
  function lightStars(x, pts, cell) {
    if (LIGHT_STAR.big && pts.length >= BIG_STAR) { // 取った石の真ん中に、取った数に合わせた大きな星を 1 つ
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      lightStar(x, cx, cy, cell * Math.min(4, 0.85 * Math.sqrt(pts.length) * 1.1));
    } else for (const p of pts) lightStar(x, p.x, p.y, cell * 0.85);
  }

  // 取った場所に跡を残す。盤全体に広がる演出でも、跡は取った場所のまわりだけにする
  // owner: 取った側の色（1 黒 / 2 白）。move: その手の手数（待ったで消すため）
  function addTrace(key, ti, pts, geo, owner, move) {
    const variant = VARIANT[key] ? key : null;
    key = baseKey(key);
    if (!pts.length || !S || !BUILD[key]) return;
    const seeds = pts.map((p, i) => ({ x: p.x, y: p.y, rot: rnd(0, 1), main: i === 0 }));
    const e = {
      key, ti: Math.min(ti, 2), full: false, pts, seeds, center: seeds[0], cell: geo.cell, margin: geo.margin, size: geo.size,
      R: geo.cell * 1.05, parts: [], walkers: [],
    };
    const [img, x] = layer(), [glow, gx] = layer();
    // 取った側の色をうっすら乗せる
    for (const p of pts) {
      const tint = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, geo.cell * 0.75);
      const c = owner === 1 ? '10,10,10' : '255,255,255';
      tint.addColorStop(0, `rgba(${c},${owner === 1 ? 0.45 : 0.6})`); tint.addColorStop(1, `rgba(${c},0)`);
      x.fillStyle = tint; x.beginPath(); x.arc(p.x, p.y, geo.cell * 0.75, 0, Math.PI * 2); x.fill();
    }
    BUILD[key](e, x, gx);
    if (variant) recolor(img, variant);
    if (variant === 'ougon') kintsugi(img);
    if (key === 'light') lightStars(x, pts, geo.cell); // 光は木の盤だと見えにくいので、黄色い星の形を残す
    // 跡の範囲（mask）は、あとで同じ場所に新しい跡ができたときに古い跡を消すのに使う
    const mask = maskTo(img, e);
    traces.push({ img, mask, move, owner, alpha: TRACE_ALPHA_BY[key] || TRACE_ALPHA });
    layerKey = '';
  }

  // ---------- 陣地ヒント ----------
  // にじみの色（木の盤の上で見える色）
  const HINT_COLOR = { default: '25,15,15', fire: '255,90,0', ice: '40,170,255', thunder: '255,225,0', dark: '130,50,220', light: '255,255,255', clear: '200,200,200' };
  const AURA_BOOST = { thunder: 0.8 }; // 黄色は主張が強いので控えめにする
  const AURA_EDGE = { thunder: '60,35,0' }; // 暗い縁
  // 色違いの演出（シーズン報酬）のにじみ。青や紫は木の黄色と混ざると濁るので、暗い縁を先に敷く
  Object.assign(HINT_COLOR, { crimson: '200,0,30', shimetsu: '140,50,230', aoen: '30,80,255', ougon: '255,200,40', kometsu: '255,90,210' });
  Object.assign(AURA_EDGE, { crimson: '40,0,6', shimetsu: '25,0,45', aoen: '0,6,30', ougon: '45,30,0', kometsu: '30,0,35' });
  // つながりの線の色の付け替え（蒼炎は焦げ跡と違い、線はあざやかな青い炎にする）
  const LINK_VARIANT = { aoen: (h, s, l) => (s < 0.08 || (h > 75 && h < 330) ? [h, s, l] : [210, 1, Math.max(0.35, l)]) };
  // 同じ座標のペアでは毎回同じ形になるよう、座標から決まる乱数を使う
  function seeded(seed) {
    let t = seed >>> 0;
    return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  }
  function jagged(x1, y1, x2, y2, amp, steps, rand) {
    const pts = [[x1, y1]], nx = -(y2 - y1), ny = x2 - x1, len = Math.hypot(nx, ny) || 1;
    for (let i = 1; i < steps; i++) {
      const k = i / steps, o = (rand() * 2 - 1) * amp;
      pts.push([x1 + (x2 - x1) * k + (nx / len) * o, y1 + (y2 - y1) * k + (ny / len) * o]);
    }
    pts.push([x2, y2]);
    return pts;
  }
  function polyline(x, pts) { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke(); }
  // テーマごとのつながりの線
  const LINK = {
    clear(x, a, b, cell) { // 彫った溝：濃い線の下側に、削れた明るい縁
      x.lineCap = 'round';
      x.strokeStyle = 'rgba(255,236,200,0.55)'; x.lineWidth = cell * 0.07; x.save(); x.translate(cell * 0.025, cell * 0.025); polyline(x, [a, b]); x.restore();
      x.strokeStyle = 'rgba(45,24,8,0.85)'; x.lineWidth = cell * 0.06; polyline(x, [a, b]);
      x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = cell * 0.015; polyline(x, [a, b]);
    },
    default(x, a, b, cell, rand) { // 木のひび
      const pts = jagged(a[0], a[1], b[0], b[1], cell * 0.12, 7, rand);
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.strokeStyle = 'rgba(255,235,190,0.5)'; x.lineWidth = cell * 0.05; x.save(); x.translate(cell * 0.03, cell * 0.03); polyline(x, pts); x.restore();
      x.strokeStyle = 'rgba(30,12,4,0.9)'; x.lineWidth = cell * 0.08; polyline(x, pts);
    },
    fire(x, a, b, cell, rand) { // 炎の帯：ゆるく波打つ燃えさしの線と、上へ立ちのぼる炎の舌
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
      const wave = cell * 0.05, phase = rand() * Math.PI * 2, steps = 16;
      const at = (k) => {
        const o = Math.sin(k * Math.PI * 2 + phase) * wave * Math.sin(k * Math.PI);
        return [a[0] + dx * k + nx * o, a[1] + dy * k + ny * o];
      };
      const curve = () => { x.beginPath(); for (let i = 0; i <= steps; i++) { const [px, py] = at(i / steps); if (i) x.lineTo(px, py); else x.moveTo(px, py); } x.stroke(); };
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.shadowColor = '#ff3a00'; x.shadowBlur = cell * 0.3;
      x.strokeStyle = 'rgba(200,40,0,0.85)'; x.lineWidth = cell * 0.13; curve();
      x.shadowBlur = 0;
      x.strokeStyle = 'rgba(255,150,30,0.95)'; x.lineWidth = cell * 0.07; curve();
      // 炎の舌：線に沿って並べ、どれも上向きに立ちのぼる
      const count = Math.max(2, Math.round(len / (cell * 0.36)));
      for (let i = 1; i < count; i++) {
        const [fx, fy] = at(i / count), h = cell * (0.3 + rand() * 0.18), w = h * 0.36, lean = (rand() - 0.5) * w * 1.6;
        const grd = x.createLinearGradient(fx, fy, fx, fy - h);
        grd.addColorStop(0, 'rgba(255,240,150,0.95)'); grd.addColorStop(0.45, 'rgba(255,130,20,0.9)'); grd.addColorStop(1, 'rgba(220,30,0,0)');
        x.fillStyle = grd;
        x.beginPath();
        x.moveTo(fx - w, fy);
        x.quadraticCurveTo(fx - w * 0.9, fy - h * 0.55, fx + lean, fy - h);
        x.quadraticCurveTo(fx + w * 0.9, fy - h * 0.55, fx + w, fy);
        x.closePath(); x.fill();
      }
    },
    ice(x, a, b, cell, rand) { // 氷の結晶：両端のとがった細長い六角柱と、斜めに突き出る霜のトゲ
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), w = cell * 0.12, tip = Math.min(len * 0.2, cell * 0.25);
      x.save();
      x.translate(a[0], a[1]); x.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
      x.shadowColor = 'rgba(120,220,255,0.9)'; x.shadowBlur = cell * 0.2;
      // 本体：上の面は明るく、下の面は青く
      const body = x.createLinearGradient(0, -w, 0, w);
      body.addColorStop(0, 'rgba(255,255,255,0.95)'); body.addColorStop(0.45, 'rgba(190,240,255,0.9)');
      body.addColorStop(0.55, 'rgba(110,200,245,0.9)'); body.addColorStop(1, 'rgba(60,150,220,0.9)');
      x.fillStyle = body;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(tip, -w); x.lineTo(len - tip, -w); x.lineTo(len, 0); x.lineTo(len - tip, w); x.lineTo(tip, w); x.closePath(); x.fill();
      x.shadowBlur = 0;
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = Math.max(0.8, cell * 0.015); x.stroke();
      x.beginPath(); x.moveTo(tip * 0.5, 0); x.lineTo(len - tip * 0.5, 0); x.stroke(); // 面の境目の稜線
      // 霜のトゲ：結晶のところどころから斜めに突き出す
      const spikes = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < spikes; i++) {
        const at = len * (0.25 + rand() * 0.5), side = rand() < 0.5 ? -1 : 1, l = cell * (0.2 + rand() * 0.14), lean = (rand() < 0.5 ? -1 : 1) * l * 0.6;
        x.fillStyle = 'rgba(210,245,255,0.95)';
        x.beginPath(); x.moveTo(at - w * 0.6, side * w * 0.8); x.lineTo(at + lean, side * (w + l)); x.lineTo(at + w * 0.6, side * w * 0.8); x.closePath(); x.fill();
        x.stroke();
      }
      // 冷たいきらめき
      const sx = len * (0.3 + rand() * 0.4), r = cell * 0.05;
      x.fillStyle = 'rgba(255,255,255,1)';
      x.beginPath(); x.moveTo(sx, -r * 2.2); x.lineTo(sx + r * 0.4, -r * 0.4); x.lineTo(sx + r * 2.2, 0); x.lineTo(sx + r * 0.4, r * 0.4);
      x.lineTo(sx, r * 2.2); x.lineTo(sx - r * 0.4, r * 0.4); x.lineTo(sx - r * 2.2, 0); x.lineTo(sx - r * 0.4, -r * 0.4); x.closePath(); x.fill();
      x.restore();
    },
    thunder(x, a, b, cell, rand) { // 電流：黒っぽい縁取りに黄色の稲妻（木の盤の上でも見えるように）
      const pts = jagged(a[0], a[1], b[0], b[1], cell * 0.18, 8, rand);
      x.lineJoin = 'miter';
      x.strokeStyle = 'rgba(40,25,0,0.85)'; x.lineWidth = cell * 0.13; polyline(x, pts);
      x.shadowColor = '#ffd000'; x.shadowBlur = cell * 0.25;
      x.strokeStyle = 'rgba(255,215,0,1)'; x.lineWidth = cell * 0.07; polyline(x, pts);
      x.shadowBlur = 0; x.strokeStyle = 'rgba(255,255,210,1)'; x.lineWidth = cell * 0.025; polyline(x, pts);
    },
    light(x, a, b, cell, rand) { // 光の帯：白い芯の金色の光と、ところどころのきらめき
      x.lineCap = 'round';
      x.shadowColor = '#ffd36a'; x.shadowBlur = cell * 0.35;
      x.strokeStyle = 'rgba(255,200,80,0.75)'; x.lineWidth = cell * 0.12; polyline(x, [a, b]);
      x.shadowBlur = cell * 0.15; x.shadowColor = '#ffffff';
      x.strokeStyle = 'rgba(255,255,250,0.98)'; x.lineWidth = cell * 0.045; polyline(x, [a, b]);
      x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,0.95)';
      for (let i = 0; i < 2; i++) { // 4 方向に光るきらめき
        const k = 0.25 + rand() * 0.5, px = a[0] + (b[0] - a[0]) * k, py = a[1] + (b[1] - a[1]) * k, r = cell * (0.06 + rand() * 0.04);
        x.beginPath();
        x.moveTo(px, py - r * 2); x.lineTo(px + r * 0.4, py - r * 0.4); x.lineTo(px + r * 2, py); x.lineTo(px + r * 0.4, py + r * 0.4);
        x.lineTo(px, py + r * 2); x.lineTo(px - r * 0.4, py + r * 0.4); x.lineTo(px - r * 2, py); x.lineTo(px - r * 0.4, py - r * 0.4); x.closePath(); x.fill();
      }
    },
    dark(x, a, b, cell, rand) { // 闇のすじ：黒紫の帯に、紫の光る芯
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
      const wave = cell * 0.06, phase = rand() * Math.PI * 2, steps = 16;
      const curve = () => {
        x.beginPath();
        for (let i = 0; i <= steps; i++) {
          const k = i / steps, o = Math.sin(k * Math.PI * 3 + phase) * wave * Math.sin(k * Math.PI);
          const px = a[0] + dx * k + nx * o, py = a[1] + dy * k + ny * o;
          if (i) x.lineTo(px, py); else x.moveTo(px, py);
        }
        x.stroke();
      };
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.shadowColor = '#a040ff'; x.shadowBlur = cell * 0.3;
      x.strokeStyle = 'rgba(40,0,80,0.85)'; x.lineWidth = cell * 0.15; curve();
      x.shadowBlur = 0; x.strokeStyle = 'rgba(200,140,255,0.95)'; x.lineWidth = cell * 0.035; curve();
    },
  };

  // つながりの強さで線の濃さ・太さを変える（囲いの輪郭 ＞ コスミ ＞ 一間 ＞ ケイマ）
  const LINK_LOOK = {
    ring: { alpha: 1, scale: 1.7 },
    kosumi: { alpha: 0.95, scale: 1 },
    ikken: { alpha: 0.7, scale: 0.85 },
    keima: { alpha: 0.4, scale: 0.7 },
  };

  // st: { board, size, cell, margin, influence(), links(), themes: {1, 2}, hint: 'both'|'aura'|'links'|'none' }
  // 盤面などが変わったときだけ描き直す（influence / links もそのときだけ計算する）
  function renderLayers(st) {
    const key = [st.board.join(''), st.hint, st.themes[1], st.themes[2], S, traces.length].join('|');
    if (key === layerKey) return;
    layerKey = key;
    const pos = (i) => [st.margin + (i % st.size) * st.cell, st.margin + Math.floor(i / st.size) * st.cell];
    for (const c of [1, 2]) { og[c].globalCompositeOperation = 'source-over'; og[c].globalAlpha = 1; og[c].clearRect(0, 0, S, S); }

    if (st.hint === 'both' || st.hint === 'aura') { // にじみ：片方の勢力がはっきり強い空点だけ色を付ける
      const inf = st.influence();
      const spots = [];
      for (let i = 0; i < inf.length; i++) {
        const v = inf[i];
        if (Math.abs(v) < 0.3) continue;
        const owner = v > 0 ? 1 : 2, vkey = st.themes[owner], key = HINT_COLOR[vkey] ? vkey : baseKey(vkey);
        spots.push({ owner, key, pos: pos(i), a: Math.min(0.42, (Math.abs(v) - 0.3) * 0.35 + 0.12) * (AURA_BOOST[baseKey(vkey)] || 1) });
      }
      // 盤の木の色に近い色（雷の黄色）は、先に暗い縁を敷いてから重ねて浮かび上がらせる。
      // 縁を全部描いてから色を描く（1 点ずつ描くと隣の縁が色の上に乗ってしまう）
      for (const { owner, key, pos: [px, py], a } of spots) {
        if (!AURA_EDGE[key]) continue;
        const x = og[owner], r = st.cell * 0.75;
        const grd = x.createRadialGradient(px, py, st.cell * 0.3, px, py, r);
        grd.addColorStop(0, `rgba(${AURA_EDGE[key]},${a * 0.35})`); grd.addColorStop(1, `rgba(${AURA_EDGE[key]},0)`);
        x.fillStyle = grd; x.fillRect(px - r, py - r, r * 2, r * 2);
      }
      for (const { owner, key, pos: [px, py], a } of spots) {
        const x = og[owner], r = st.cell * 0.62, col = HINT_COLOR[key];
        const grd = x.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, `rgba(${col},${Math.min(0.9, a)})`); grd.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = grd; x.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
    if (st.hint === 'both' || st.hint === 'links') { // つながりの線
      // 色違いの演出の人の線は、別の紙に描いてから色を付け替えて重ねる
      const tmp = {};
      for (const c of [1, 2]) if (VARIANT[st.themes[c]]) tmp[c] = layer();
      for (const [a, b, c, kind] of st.links()) {
        // 隣り合った石同士は見ればつながっているとわかるので、線を描かない
        // （ギザギザの線が石の外にはみ出して、離れた石とつながって見えるのを防ぐ）
        if (Math.abs((a % st.size) - (b % st.size)) + Math.abs(Math.floor(a / st.size) - Math.floor(b / st.size)) === 1) continue;
        const x = tmp[c] ? tmp[c][1] : og[c], look = LINK_LOOK[kind] || LINK_LOOK.ikken;
        x.save(); x.globalAlpha = look.alpha;
        LINK[baseKey(st.themes[c])](x, pos(a), pos(b), st.cell * look.scale, seeded(a * 1000 + b));
        x.restore();
      }
      for (const c of [1, 2]) {
        if (!tmp[c]) continue;
        recolor(tmp[c][0], st.themes[c], LINK_VARIANT[st.themes[c]]);
        og[c].drawImage(tmp[c][0], 0, 0, S, S);
      }
    }
    // 取った場所の跡
    const comp = composeTraces();
    for (const c of [1, 2]) og[c].drawImage(comp[c], 0, 0, S, S);
    // 石の上には描かない
    for (const c of [1, 2]) {
      const x = og[c];
      // くり抜きは塗りの不透明度で効くので、直前に使った半透明の色やグラデーションを使わない
      x.globalCompositeOperation = 'destination-out'; x.globalAlpha = 1; x.fillStyle = '#000';
      x.beginPath();
      for (const p of stoneSource()) { x.moveTo(p.x + p.r, p.y); x.arc(p.x, p.y, p.r, 0, Math.PI * 2); }
      x.fill();
      x.globalCompositeOperation = 'source-over';
    }
  }
  // 跡を古い順に重ねる。新しい跡の範囲では、それより前の跡（黒白どちらのものも）を消して上書きする。
  // 跡の元の画像は残しておくので、待ったで新しい跡が消えれば古い跡がまた見える
  function composeTraces() {
    const key = traces.length + '|' + S + '|' + traces.map((t) => t.move).join(',');
    if (traceComp && key === traceCompKey) return traceComp;
    traceCompKey = key;
    const [c1, x1] = layer(), [c2, x2] = layer();
    const xs = { 1: x1, 2: x2 };
    for (const t of traces) {
      if (t.mask) {
        for (const c of [1, 2]) {
          const x = xs[c];
          x.globalCompositeOperation = 'destination-out'; x.drawImage(t.mask, 0, 0, S, S);
          x.globalCompositeOperation = 'source-over';
        }
      }
      const x = xs[t.owner || 1];
      x.globalAlpha = t.alpha || TRACE_ALPHA; x.drawImage(t.img, 0, 0, S, S); x.globalAlpha = 1;
    }
    traceComp = { 1: c1, 2: c2 };
    return traceComp;
  }
  function dropTraces(move) { traces = traces.filter((t) => t.move <= move); layerKey = ''; }
  function resetTraces() { traces = []; layerKey = ''; for (const c of [1, 2]) og[c].clearRect(0, 0, S, S); }

  root.BoardFX = { resize, apply, clear, addTrace, renderLayers, dropTraces, resetTraces, setStoneSource(fn) { stoneSource = fn; } };
})(this);
