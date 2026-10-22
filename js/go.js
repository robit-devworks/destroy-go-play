// 囲碁のルールエンジン（描画・時計からは独立）
(function (root) {
  'use strict';

  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const other = (c) => (c === BLACK ? WHITE : BLACK);

  // 日本ルール：地＋アゲハマ（死に石も含む）／中国ルール：地＋盤上の石
  const RULES = {
    japanese: { label: '日本ルール', komi: 6.5 },
    chinese: { label: '中国ルール', komi: 7.5 },
  };

  // 置き石を置ける最大数（9 路は多すぎると勝負にならないので 5 子まで）
  const MAX_HANDICAP = { 9: 5, 13: 9, 19: 9 };
  function handicapPoints(size, n) {
    n = Math.min(n, MAX_HANDICAP[size] || 9);
    if (n < 2) return [];
    const lo = size >= 13 ? 3 : 2, hi = size - 1 - lo, mid = (size - 1) / 2;
    const UR = [hi, lo], LL = [lo, hi], LR = [hi, hi], UL = [lo, lo], C = [mid, mid];
    const L = [lo, mid], R = [hi, mid], T = [mid, lo], B = [mid, hi];
    const corners = [UR, LL, LR, UL];
    const order = {
      2: [UR, LL], 3: [UR, LL, LR], 4: corners, 5: [...corners, C], 6: [...corners, L, R],
      7: [...corners, L, R, C], 8: [...corners, L, R, T, B], 9: [...corners, L, R, T, B, C],
    };
    return order[n];
  }

  class GoGame {
    constructor(size = 19, rules = 'japanese') {
      this.size = size;
      this.rules = RULES[rules] ? rules : 'japanese';
      this.komi = RULES[this.rules].komi;
      this.board = new Int8Array(size * size);
      this.turn = BLACK;
      this.captures = { [BLACK]: 0, [WHITE]: 0 }; // その色が取った石の数
      this.koPoint = -1;
      this.passes = 0;
      this.lastMove = -1;
      this.moveNumber = 0;
      this.history = [];
    }

    // 置き石：星に黒石を置き、白から打ち始める。コミは 0.5 目（日本の一般的な決まり）。
    // 置く順：2 子は右上と左下、3 子で右下、4 子で四隅、5 子で天元、6 子で左右の辺、7 子で天元、8 子で上下の辺、9 子で全部
    setHandicap(n) {
      const pts = handicapPoints(this.size, n);
      for (const [x, y] of pts) this.board[this.idx(x, y)] = BLACK;
      if (pts.length) { this.turn = WHITE; this.komi = 0.5; }
      return pts.length;
    }

    idx(x, y) { return y * this.size + x; }
    xy(i) { return [i % this.size, Math.floor(i / this.size)]; }

    neighbors(i) {
      const s = this.size, x = i % s, res = [];
      if (x > 0) res.push(i - 1);
      if (x < s - 1) res.push(i + 1);
      if (i >= s) res.push(i - s);
      if (i < s * (s - 1)) res.push(i + s);
      return res;
    }

    group(i, board = this.board) {
      const color = board[i];
      const stones = [i], seen = new Set([i]), libs = new Set();
      for (let k = 0; k < stones.length; k++) {
        for (const n of this.neighbors(stones[k])) {
          if (board[n] === EMPTY) libs.add(n);
          else if (board[n] === color && !seen.has(n)) { seen.add(n); stones.push(n); }
        }
      }
      return { color, stones, libs };
    }

    snapshot() {
      return {
        board: this.board.slice(), turn: this.turn,
        captures: { ...this.captures }, koPoint: this.koPoint,
        passes: this.passes, lastMove: this.lastMove, moveNumber: this.moveNumber,
      };
    }

    restore(s) {
      this.board = s.board.slice(); this.turn = s.turn;
      this.captures = { ...s.captures }; this.koPoint = s.koPoint;
      this.passes = s.passes; this.lastMove = s.lastMove; this.moveNumber = s.moveNumber;
    }

    // 着手できるか・取れる石を計算する（盤面は変更しない）
    tryPlay(i) {
      if (i < 0 || i >= this.board.length) return { ok: false, reason: '盤外です' };
      if (this.board[i] !== EMPTY) return { ok: false, reason: 'そこには石があります' };
      if (i === this.koPoint) return { ok: false, reason: 'コウです（すぐには取り返せません）' };

      const me = this.turn, opp = other(me);
      const board = this.board.slice();
      board[i] = me;

      const captured = [];
      const checked = new Set();
      for (const n of this.neighbors(i)) {
        if (board[n] !== opp || checked.has(n)) continue;
        const g = this.group(n, board);
        g.stones.forEach((s) => checked.add(s));
        if (g.libs.size === 0) captured.push(...g.stones);
      }
      captured.forEach((s) => { board[s] = EMPTY; });

      const mine = this.group(i, board);
      if (mine.libs.size === 0) return { ok: false, reason: '自殺手は打てません' };

      let ko = -1;
      if (captured.length === 1 && mine.stones.length === 1 && mine.libs.size === 1) ko = captured[0];
      return { ok: true, board, captured, ko };
    }

    play(x, y) {
      const i = this.idx(x, y);
      const r = this.tryPlay(i);
      if (!r.ok) return r;
      this.history.push(this.snapshot());
      this.board = r.board;
      this.captures[this.turn] += r.captured.length;
      this.koPoint = r.ko;
      this.passes = 0;
      this.lastMove = i;
      this.moveNumber++;
      this.turn = other(this.turn);
      return { ok: true, captured: r.captured, color: other(this.turn) };
    }

    pass() {
      this.history.push(this.snapshot());
      this.passes++;
      this.koPoint = -1;
      this.lastMove = -1;
      this.moveNumber++;
      this.turn = other(this.turn);
      return { ok: true, ended: this.passes >= 2 };
    }

    undo() {
      if (!this.history.length) return false;
      this.restore(this.history.pop());
      return true;
    }

    // 陣地ヒント用の勢力。空点ごとに、黒が強ければ正、白が強ければ負の値を返す。
    // 石から 2 路ちょっとまで影響し、逃げ道（ダメ）が少ない石ほど影響を弱める
    influence() {
      const n = this.size, v = new Float32Array(this.board.length);
      const libs = new Map();
      for (let i = 0; i < this.board.length; i++) {
        if (this.board[i] === EMPTY || libs.has(i)) continue;
        const g = this.group(i);
        g.stones.forEach((st) => libs.set(st, g.libs.size));
      }
      const R = 2.5;
      for (let i = 0; i < this.board.length; i++) {
        const c = this.board[i];
        if (c === EMPTY) continue;
        const l = libs.get(i), str = l <= 1 ? 0.3 : l === 2 ? 0.6 : 1;
        const [x, y] = this.xy(i), sign = c === BLACK ? 1 : -1;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy, d = Math.hypot(dx, dy);
          if (!d || d > R || nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = this.idx(nx, ny);
          if (this.board[j] === EMPTY) v[j] += sign * str * (1 - d / 3);
        }
      }
      return v;
    }

    // 陣地ヒント用の、同じ色の石のつながり。[a, b, 色, 種類] で返す
    // 一間トビ（間が空点）、コスミ（両脇が両方とも相手の石ではない）、
    // ケイマ（間の 2 点がどちらも空点。片方でも相手に打たれたら切られかけているので出さない）
    links() {
      const out = [];
      for (let i = 0; i < this.board.length; i++) {
        const c = this.board[i];
        if (c === EMPTY) continue;
        const [x, y] = this.xy(i);
        const at = (px, py) => (px < 0 || py < 0 || px >= this.size || py >= this.size ? -1 : this.board[this.idx(px, py)]);
        // 一間トビ：右と下だけ見れば全ペアを 1 回ずつ数えられる
        for (const [dx, dy] of [[2, 0], [0, 2]]) {
          if (at(x + dx, y + dy) === c && at(x + dx / 2, y + dy / 2) === EMPTY) out.push([i, this.idx(x + dx, y + dy), c, 'ikken']);
        }
        // コスミ：右下と左下
        for (const dx of [1, -1]) {
          if (at(x + dx, y + 1) !== c) continue;
          const s1 = at(x + dx, y), s2 = at(x, y + 1);
          if (s1 === c || s2 === c) continue; // すでに隣り合わせでつながっている
          if (s1 === other(c) && s2 === other(c)) continue; // 両脇を相手に押さえられたら切れている
          out.push([i, this.idx(x + dx, y + 1), c, 'kosumi']);
        }
        // ケイマ：下向きの 4 方向だけ見れば全ペアを 1 回ずつ数えられる
        for (const [dx, dy] of [[1, 2], [-1, 2], [2, 1], [-2, 1]]) {
          if (at(x + dx, y + dy) !== c) continue;
          const mids = Math.abs(dx) === 2 ? [[x + dx / 2, y], [x + dx / 2, y + dy]] : [[x, y + dy / 2], [x + dx, y + dy / 2]];
          if (mids.every(([mx, my]) => at(mx, my) === EMPTY)) out.push([i, this.idx(x + dx, y + dy), c, 'keima']);
        }
      }
      return out;
    }

    // 陣地ヒントで表示するつながり。基本は links() と同じだが、
    // 逃げ道（ダメ）が 2 つ以下の相手の塊を包囲しているところは、包囲をなぞる線（種類 'ring'）を足す。
    // 包囲している石のふだんの線（一間・ケイマなど）は残す（包囲の線は途中までのことがあり、消すと網が途切れる）。
    // 地を囲ったところは輪郭だけにして、囲いの石の内側・外側への線は出さない
    hintLinks() {
      const at = (x, y) => (x < 0 || y < 0 || x >= this.size || y >= this.size ? -1 : this.board[this.idx(x, y)]);
      const atari = this.atariStones(); // 次の 1 手で取られる石は、囲いにもつながりにも数えない
      const ring = new Set(); // 取られそうな石を包囲している石（ふだんのつながりの線も残す）
      const territory = new Set(); // 陣地を囲っている石（輪郭だけ出し、内側の線は出さない）
      const ringPairs = new Map(); // "a-b" -> [a, b, 色, 'ring']
      const seen = new Set();
      for (let i = 0; i < this.board.length; i++) {
        if (this.board[i] === EMPTY || seen.has(i)) continue;
        const g = this.group(i);
        g.stones.forEach((st) => seen.add(st));
        if (g.libs.size > 2) continue;
        const c = other(g.color), wall = new Set();
        for (const st of g.stones) {
          const [x, y] = this.xy(st);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (at(x + dx, y + dy) === c && !atari.has(this.idx(x + dx, y + dy))) wall.add(this.idx(x + dx, y + dy));
          }
        }
        if (wall.size < 2) continue;
        wall.forEach((w) => ring.add(w));
        // 囲いの石同士で外周をなぞる線：斜め（間を自分の石が埋めていない）と一間（間が空点）
        const list = [...wall];
        for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
          const [ax, ay] = this.xy(list[a]), [bx, by] = this.xy(list[b]);
          const dx = bx - ax, dy = by - ay;
          let ok = false;
          if (Math.abs(dx) === 1 && Math.abs(dy) === 1) ok = at(ax + dx, ay) !== c && at(ax, ay + dy) !== c;
          else if ((Math.abs(dx) === 2 && dy === 0) || (dx === 0 && Math.abs(dy) === 2)) ok = at(ax + dx / 2, ay + dy / 2) === EMPTY;
          if (!ok) continue;
          const [p, q] = list[a] < list[b] ? [list[a], list[b]] : [list[b], list[a]];
          ringPairs.set(`${p}-${q}`, [p, q, c, 'ring']);
        }
      }
      this.enclosures(atari).forEach(({ color, stones, pairs }) => {
        stones.forEach((st) => territory.add(st));
        for (const [p, q] of pairs) ringPairs.set(`${p}-${q}`, [p, q, color, 'ring']);
      });
      // 包囲の線は途中までしかつながらないこともあるので、包囲している石のふだんの線は消さない
      // （消すと網が途切れて見える）。同じ石同士の重複は pruneLinks で強いほうだけ残る
      const base = this.links().filter(([a, b]) => !territory.has(a) && !territory.has(b));
      // 次の 1 手で取られる石（アタリの石）につながる線は出さない
      const shown = base.concat([...ringPairs.values()]).filter(([a, b]) => !atari.has(a) && !atari.has(b));
      return this.pruneLinks(shown);
    }

    // すでにもっと強くつながっている石同士の、弱い線を間引く。
    // 強さ：同じかたまり ＞ コスミ・囲いの輪郭 ＞ 一間 ＞ ケイマ
    // ・同じかたまり（隣り合ってひと続き）の石同士の線は出さない（囲いの輪郭は除く）
    // ・別の石を経由して、両方ともより強い線でつながっているなら出さない
    // ・1 つのかたまり同士の間には、いちばん強い線を 1 本だけ出す
    pruneLinks(links) {
      const RANK = { ring: 1, kosumi: 1, ikken: 2, keima: 3 };
      const groupOf = new Map();
      for (const [a, b] of links) {
        for (const st of [a, b]) {
          if (groupOf.has(st)) continue;
          const g = this.group(st), id = Math.min(...g.stones);
          g.stones.forEach((x) => groupOf.set(x, id));
        }
      }
      // 石（かたまり単位）同士の、いちばん強いつながりの強さ
      const best = new Map();
      const key = (p, q) => (p < q ? `${p}-${q}` : `${q}-${p}`);
      for (const [a, b, , k] of links) {
        const ga = groupOf.get(a), gb = groupOf.get(b), kk = key(ga, gb);
        best.set(kk, Math.min(best.get(kk) ?? 9, RANK[k]));
      }
      const neighborsOf = new Map();
      for (const kk of best.keys()) {
        const [p, q] = kk.split('-').map(Number);
        if (!neighborsOf.has(p)) neighborsOf.set(p, []);
        if (!neighborsOf.has(q)) neighborsOf.set(q, []);
        neighborsOf.get(p).push(q); neighborsOf.get(q).push(p);
      }
      const kept = new Set(); // 1 つのかたまり同士には、いちばん強い線を 1 本だけ
      const ringPairs = new Set(links.filter(([, , , k]) => k === 'ring').map(([a, b]) => key(groupOf.get(a), groupOf.get(b))));
      const order = links.map((l, i) => [l, i]).sort(([l1, i1], [l2, i2]) => RANK[l1[3]] - RANK[l2[3]] || i1 - i2);
      const ok = new Set();
      for (const [[a, b, , k], i] of order) {
        if (k === 'ring') { ok.add(i); continue; } // 囲いの輪郭は同じかたまりの中でも切らずに見せる
        const ga = groupOf.get(a), gb = groupOf.get(b), r = RANK[k], kk = key(ga, gb);
        if (ga === gb || ringPairs.has(kk) || kept.has(kk)) continue;
        if (r > 1 && (neighborsOf.get(ga) || []).some((m) => m !== gb
          && best.get(key(ga, m)) < r && best.get(key(m, gb)) < r)) continue;
        kept.add(kk); ok.add(i);
      }
      return this.dropChords(links.filter((_, i) => ok.has(i)));
    }

    // 石を結んだ形の内側を横切る線は出さない（外側の形だけ見せる）。
    // 線を辺とした図形の「面」を調べ、線の両側がどちらも内側の面（外の広い面ではない）なら、内側を横切る線とみなす。
    // 例：4 つの石が四角くつながっているときの対角の線。外へ飛び出しているだけの線や囲いの輪郭は消さない
    dropChords(links) {
      const adj = new Map();
      const link = (p, q) => {
        if (p === q) return;
        if (!adj.has(p)) adj.set(p, new Set());
        if (!adj.has(q)) adj.set(q, new Set());
        adj.get(p).add(q); adj.get(q).add(p);
      };
      for (const [a, b] of links) link(a, b);
      // 隣り合った同じ色の石は線がなくてもつながっている
      for (const p of [...adj.keys()]) for (const nb of this.neighbors(p)) if (this.board[nb] === this.board[p]) link(p, nb);
      // 各石から出る辺を角度順に並べる
      const order = new Map();
      for (const [p, set] of adj) {
        const [px, py] = this.xy(p);
        order.set(p, [...set].sort((u, v) => {
          const [ux, uy] = this.xy(u), [vx, vy] = this.xy(v);
          return Math.atan2(uy - py, ux - px) - Math.atan2(vy - py, vx - px);
        }));
      }
      // 辺をたどって面を作る（u→v のあと、v で u の次の角度の辺へ進む）。面ごとに符号付き面積を求める
      const faceOf = new Map(), area = [];
      for (const [u, list] of order) {
        for (const v of list) {
          if (faceOf.has(`${u}>${v}`)) continue;
          const id = area.length;
          let a = 0, p = u, q = v;
          while (!faceOf.has(`${p}>${q}`)) {
            faceOf.set(`${p}>${q}`, id);
            const [px, py] = this.xy(p), [qx, qy] = this.xy(q);
            a += px * qy - qx * py;
            const lq = order.get(q), k = lq.indexOf(p);
            p = q; q = lq[(k + 1) % lq.length];
          }
          area.push(a / 2);
        }
      }
      // 盤の座標（下向きが y）でこのたどり方だと、内側の面は面積が負になる。外の面（と、枝分かれしただけの面）は 0 以上
      const inner = (f) => area[f] < 0;
      return links.filter(([a, b, , k]) => {
        if (k === 'ring') return true;
        const f1 = faceOf.get(`${a}>${b}`), f2 = faceOf.get(`${b}>${a}`);
        return !(f1 !== f2 && inner(f1) && inner(f2));
      });
    }

    // アタリ（ダメが 1 つ）の石の集合
    atariStones() {
      const out = new Set(), seen = new Set();
      for (let i = 0; i < this.board.length; i++) {
        if (this.board[i] === EMPTY || seen.has(i)) continue;
        const g = this.group(i);
        g.stones.forEach((st) => seen.add(st));
        if (g.libs.size <= 1) g.stones.forEach((st) => out.add(st));
      }
      return out;
    }

    // 片方の色だけで囲われた空点の集まり（地になりそうな場所）を探し、囲いの外周をなぞる石のペアを返す。
    // 一間トビの間と盤の端は壁とみなす（コスミは上下左右のつながりだけで塗るとそのまま壁になる）。
    // 外周の石の間が一間・コスミまでならつなぎ、それより空いているところ（抜け道）は切る
    // atari: アタリの石の集合。外周の石として数えない（輪郭はそこで切れる）
    enclosures(atari = this.atariStones()) {
      const n = this.size, out = [];
      const at = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? -1 : this.board[this.idx(x, y)]);
      for (const c of [BLACK, WHITE]) {
        // その色の一間トビの間（左右か上下が自分の石の空点）
        const gap = (x, y) => (at(x - 1, y) === c && at(x + 1, y) === c) || (at(x, y - 1) === c && at(x, y + 1) === c);
        // 1) 一間トビの間を壁として、空点をかたまりに分ける。相手の石に触れていないかたまりは「囲われている」
        const comp = new Int32Array(this.board.length).fill(-1), comps = [];
        const gaps = [];
        for (let i = 0; i < this.board.length; i++) {
          const [ix, iy] = this.xy(i);
          if (this.board[i] !== EMPTY || comp[i] >= 0) continue;
          if (gap(ix, iy)) { gaps.push(i); continue; }
          const id = comps.length, pts = [i];
          let pure = true;
          comp[i] = id;
          for (let k = 0; k < pts.length; k++) {
            for (const nb of this.neighbors(pts[k])) {
              const v = this.board[nb];
              if (v === other(c)) pure = false;
              if (v !== EMPTY || comp[nb] >= 0) continue;
              const [nx, ny] = this.xy(nb);
              if (gap(nx, ny)) continue;
              comp[nb] = id; pts.push(nb);
            }
          }
          comps.push({ pts, pure });
        }
        // 2) 一間トビの間のうち、囲われたかたまりにしか接していないもの（＝地の内側にある間）は、
        //    壁ではなく地の一部として、接しているかたまり同士をまとめる。外とつながる間は壁のまま
        const parent = comps.map((_, k) => k);
        const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
        const isGap = new Set(gaps), gapOwner = new Map();
        const inner = gaps.filter((gp) => this.neighbors(gp).every((nb) => {
          const v = this.board[nb];
          return v === c || isGap.has(nb) || (v === EMPTY && comps[comp[nb]].pure);
        }));
        const innerSet = new Set(inner);
        // 内側の間同士もつながるので、間ごとに代表のかたまりを決めながらまとめる
        for (const gp of inner) {
          const touch = this.neighbors(gp).filter((nb) => comp[nb] >= 0).map((nb) => comp[nb]);
          if (!touch.length) continue;
          touch.forEach((k) => { parent[find(k)] = find(touch[0]); });
          gapOwner.set(gp, touch[0]);
        }
        // かたまりに直接接していない内側の間（間だけが続く場所）は、隣の間の持ち主に合わせる
        let changed = true;
        while (changed) {
          changed = false;
          for (const gp of inner) {
            for (const nb of this.neighbors(gp)) {
              if (!innerSet.has(nb)) continue;
              const a = gapOwner.get(gp), b = gapOwner.get(nb);
              if (a !== undefined && b === undefined) { gapOwner.set(nb, a); changed = true; }
              else if (a !== undefined && b !== undefined && find(a) !== find(b)) { parent[find(b)] = find(a); changed = true; }
            }
          }
        }
        const regions = new Map();
        comps.forEach((cp, k) => {
          const r = find(k);
          if (!regions.has(r)) regions.set(r, { pts: [], pure: true });
          const reg = regions.get(r);
          reg.pts.push(...cp.pts); reg.pure = reg.pure && cp.pure;
        });
        for (const [gp, k] of gapOwner) regions.get(find(k)).pts.push(gp);
        // 空点のかたまりに接していない内側の間（自分の石だけに囲まれた眼など）は、それだけで 1 つの囲い
        const lone = new Set(inner.filter((gp) => !gapOwner.has(gp)));
        for (const gp of lone) {
          const pts = [gp];
          lone.delete(gp);
          for (let k = 0; k < pts.length; k++) {
            for (const nb of this.neighbors(pts[k])) if (lone.has(nb)) { lone.delete(nb); pts.push(nb); }
          }
          regions.set(`lone${gp}`, { pts, pure: true });
        }

        for (const { pts: region, pure } of regions.values()) {
          if (!pure || region.length > n * n * 0.4) continue;
          // 1 点だけの囲い（眼）は、まわりの石がどれもアタリでない（取り返されない）ときだけ
          if (region.length === 1 && this.neighbors(region[0]).some((nb) => atari.has(nb))) continue;
          // 盤の外を回る部分は盤の端に沿わせる（端は壁なので、端に沿った一間もつながる）
          const clamp = (v) => Math.max(0, Math.min(n - 1, v));
          const loop = [];
          for (const [x, y] of this.regionOutline(region)) {
            const v = [clamp(x), clamp(y)], last = loop[loop.length - 1];
            if (!last || last[0] !== v[0] || last[1] !== v[1]) loop.push(v);
          }
          while (loop.length > 1 && loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1]) loop.pop();
          const isStone = (v) => v[0] >= 0 && v[1] >= 0 && v[0] < n && v[1] < n && at(v[0], v[1]) === c && !atari.has(this.idx(v[0], v[1]));
          const marks = loop.map(isStone);
          const first = marks.indexOf(true);
          if (first < 0) continue;
          const stones = new Set(), pairs = [];
          let prev = first, run = 0;
          for (let s = 1; s <= loop.length; s++) {
            const j = (first + s) % loop.length;
            if (!marks[j]) { run++; continue; }
            const a = loop[prev], b = loop[j];
            if (run <= 1 && j !== prev && Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= 2) {
              const p = this.idx(a[0], a[1]), q = this.idx(b[0], b[1]);
              stones.add(p); stones.add(q);
              pairs.push(p < q ? [p, q] : [q, p]);
            }
            prev = j; run = 0;
          }
          if (pairs.length) out.push({ color: c, stones, pairs });
        }
      }
      return out;
    }

    // 空点の集まりを 1 路ずつ太らせた形の外周を、交点の列として 1 周たどる
    regionOutline(region) {
      const key = (x, y) => `${x},${y}`;
      const cells = new Set();
      for (const r of region) {
        const [x, y] = this.xy(r);
        for (const [cx, cy] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) cells.add(key(cx, cy));
      }
      const next = new Map(); // 始点 -> 終点（内側を左に見る向き）
      const add = (x1, y1, x2, y2) => { const k = key(x1, y1); if (!next.has(k)) next.set(k, []); next.get(k).push([x2, y2]); };
      for (const k of cells) {
        const [cx, cy] = k.split(',').map(Number);
        if (!cells.has(key(cx, cy - 1))) add(cx, cy, cx + 1, cy);
        if (!cells.has(key(cx + 1, cy))) add(cx + 1, cy, cx + 1, cy + 1);
        if (!cells.has(key(cx, cy + 1))) add(cx + 1, cy + 1, cx, cy + 1);
        if (!cells.has(key(cx - 1, cy))) add(cx, cy + 1, cx, cy);
      }
      // いちばん長い 1 周を返す（穴があれば内側の周は無視）
      let best = [];
      while (next.size) {
        const startKey = next.keys().next().value;
        const loop = [];
        let k = startKey;
        while (next.has(k)) {
          const list = next.get(k), v = list.pop();
          if (!list.length) next.delete(k);
          loop.push(k.split(',').map(Number));
          k = key(v[0], v[1]);
          if (k === startKey) break;
        }
        if (loop.length > best.length) best = loop;
      }
      return best;
    }

    // dead は死に石として扱う交点の Set。ルールに応じて計算する
    score(dead = new Set()) {
      const board = this.board.slice();
      const deadCount = { [BLACK]: 0, [WHITE]: 0 }; // その色の死に石の数
      dead.forEach((i) => { if (board[i] !== EMPTY) deadCount[board[i]]++; board[i] = EMPTY; });
      const stones = { [BLACK]: 0, [WHITE]: 0 };
      const terr = { [BLACK]: 0, [WHITE]: 0 };
      const territory = new Int8Array(board.length); // 0:未定 1:黒地 2:白地 3:ダメ
      const seen = new Uint8Array(board.length);

      for (let i = 0; i < board.length; i++) {
        if (board[i] !== EMPTY) { stones[board[i]]++; continue; }
        if (seen[i]) continue;
        const region = [i]; seen[i] = 1;
        const borders = new Set();
        for (let k = 0; k < region.length; k++) {
          for (const n of this.neighbors(region[k])) {
            if (board[n] === EMPTY) { if (!seen[n]) { seen[n] = 1; region.push(n); } }
            else borders.add(board[n]);
          }
        }
        const owner = borders.size === 1 ? [...borders][0] : 3;
        region.forEach((r) => { territory[r] = owner; });
        if (owner !== 3) terr[owner] += region.length;
      }

      const detail = {};
      for (const c of [BLACK, WHITE]) {
        const prisoners = this.captures[c] + deadCount[other(c)];
        detail[c] = this.rules === 'chinese'
          ? { territory: terr[c], stones: stones[c], komi: c === WHITE ? this.komi : 0 }
          : { territory: terr[c], prisoners, komi: c === WHITE ? this.komi : 0 };
        detail[c].total = Object.values(detail[c]).reduce((a, v) => a + v, 0);
      }
      const black = detail[BLACK].total, white = detail[WHITE].total;
      return { black, white, detail, territory, rules: this.rules, winner: black > white ? BLACK : WHITE, margin: Math.abs(black - white) };
    }
  }

  const api = { GoGame, RULES, EMPTY, BLACK, WHITE, other, MAX_HANDICAP, handicapPoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Go = api;
})(this);
