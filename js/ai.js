// コンピューター（AI）の考える部分。レベル 1〜9。
//  1〜2：ほぼでたらめ（取れる石はときどき取る）
//  3〜4：アタリを逃げる・取れる石を取る・自分から取られに行かない、などの決まりごとで打つ
//  5〜9：候補の手それぞれから最後まで何千局も試し打ち（モンテカルロ法）して、勝ちやすい手を選ぶ。
//        レベルが上がるほど考える時間が長くなる
// 重い計算で画面が止まらないよう、ブラウザでは Web Worker の中で動かす（createWorker）
(function (root) {
  'use strict';

  function factory() {
    const EMPTY = 0, BLACK = 1, WHITE = 2;
    const other = (c) => 3 - c;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // 盤の大きさごとの隣の点の表（毎回計算しないように覚えておく）
    const NB = {};
    function neighbors(n) {
      if (NB[n]) return NB[n];
      const out = [];
      for (let p = 0; p < n * n; p++) {
        const x = p % n, y = (p - x) / n, list = [];
        if (x > 0) list.push(p - 1);
        if (x < n - 1) list.push(p + 1);
        if (y > 0) list.push(p - n);
        if (y < n - 1) list.push(p + n);
        out.push(list);
      }
      return (NB[n] = out);
    }

    // ---------- 速い盤面（試し打ち用） ----------
    class Board {
      constructor(n, cells, ko = -1) {
        this.n = n; this.nb = neighbors(n);
        this.b = Int8Array.from(cells);
        this.ko = ko;
        this.mark = new Int32Array(n * n); this.stamp = 0;
        this.stack = new Int32Array(n * n);
      }
      clone() { const c = new Board(this.n, this.b, this.ko); return c; }
      // p を含むかたまりの石を stones に入れ、呼吸点の数を返す（limit 個見つけたら打ち切り）
      libs(p, stones, limit = 99, libOut) {
        const b = this.b, color = b[p], nb = this.nb;
        const s = ++this.stamp, mark = this.mark, st = this.stack;
        let top = 0, libs = 0;
        st[top++] = p; mark[p] = s;
        if (stones) stones.length = 0;
        while (top) {
          const q = st[--top];
          if (stones) stones.push(q);
          for (const r of nb[q]) {
            if (mark[r] === s) continue;
            mark[r] = s;
            if (b[r] === EMPTY) { libs++; if (libOut) libOut.push(r); if (libs >= limit) return libs; }
            else if (b[r] === color) st[top++] = r;
          }
        }
        return libs;
      }
      // 打つ。取った石の数を返す（打てないときは -1）
      play(p, c) {
        const b = this.b;
        if (b[p] !== EMPTY || p === this.ko) return -1;
        b[p] = c;
        const o = other(c), grp = [];
        let cap = 0, capAt = -1;
        for (const r of this.nb[p]) {
          if (b[r] !== o) continue;
          if (this.libs(r, grp, 1) === 0) {
            for (const s of grp) b[s] = EMPTY;
            cap += grp.length; capAt = grp[0];
          }
        }
        const own = [];
        const libs = this.libs(p, own, 2);
        if (libs === 0) { b[p] = EMPTY; return -1; } // 自殺手
        this.ko = cap === 1 && own.length === 1 && libs === 1 ? capAt : -1;
        return cap;
      }
      // p に c が打つと、自分から取られる形（アタリ）になるか（相手を取れる手は除く）
      selfAtari(p, c) {
        const b = this.b, o = other(c), libs = new Set(), grp = [], ll = [];
        for (const r of this.nb[p]) {
          if (b[r] === EMPTY) libs.add(r);
          else if (b[r] === c) { ll.length = 0; this.libs(r, grp, 4, ll); for (const l of ll) if (l !== p) libs.add(l); }
          else if (b[r] === o) { ll.length = 0; if (this.libs(r, grp, 2, ll) === 1) return false; }
          if (libs.size >= 2) return false;
        }
        return libs.size < 2;
      }
      // c の眼（自分の石で囲まれた 1 点）か
      isEye(p, c) {
        const b = this.b, n = this.n;
        if (b[p] !== EMPTY) return false;
        for (const r of this.nb[p]) if (b[r] !== c) return false;
        const x = p % n, y = (p - x) / n;
        let bad = 0, edge = 0;
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) { edge = 1; continue; }
          if (b[yy * n + xx] === other(c)) bad++;
        }
        return bad + edge < 2;
      }
      // 地（打った石＋囲った空点）で数えた差（黒 − 白 − コミ）
      score(komi) {
        const b = this.b;
        let s = -komi;
        for (let p = 0; p < b.length; p++) {
          if (b[p] === BLACK) s++;
          else if (b[p] === WHITE) s--;
          else {
            let bl = false, wh = false;
            for (const r of this.nb[p]) { if (b[r] === BLACK) bl = true; else if (b[r] === WHITE) wh = true; }
            if (bl && !wh) s++; else if (wh && !bl) s--;
          }
        }
        return s;
      }
    }

    // ---------- 試し打ち（最後まで打ってみる） ----------
    // 軽い打ち方：直前に打たれた石の隣でアタリになった相手を取れるなら取る。あとはでたらめ（自分の眼には打たない）
    function playout(bd, turn, komi, own) {
      const n = bd.n, size = n * n, b = bd.b;
      // 空点の一覧と、各点が一覧の何番目か（打った点をすぐ消せるように）
      const empties = new Int32Array(size), pos = new Int32Array(size);
      let ne = 0;
      const rebuild = () => { ne = 0; for (let p = 0; p < size; p++) if (b[p] === EMPTY) { pos[p] = ne; empties[ne++] = p; } };
      const remove = (p) => { const i = pos[p], q = empties[--ne]; empties[i] = q; pos[q] = i; };
      rebuild();
      let passes = 0, last = -1, moves = 0;
      const grp = [], libList = [];
      const maxMoves = size * 5;
      while (passes < 2 && moves < maxMoves) {
        let played = -1, cap = 0;
        // 取れる石があればたいてい取る
        if (last >= 0 && Math.random() < 0.85) {
          for (const r of bd.nb[last]) {
            if (b[r] !== other(turn)) continue;
            libList.length = 0;
            if (bd.libs(r, grp, 2, libList) === 1) { cap = bd.play(libList[0], turn); if (cap >= 0) { played = libList[0]; break; } }
          }
        }
        if (played < 0) {
          // 空点を順に入れ替えながら、打てる手を 1 つ探す
          let k = ne;
          while (k > 0) {
            const i = Math.floor(Math.random() * k), p = empties[i], q = empties[k - 1];
            empties[i] = q; pos[q] = i; empties[k - 1] = p; pos[p] = k - 1; k--;
            if (bd.isEye(p, turn)) continue;
            if (Math.random() < 0.9 && bd.selfAtari(p, turn)) continue; // 自分から取られに行く手はたいてい打たない
            cap = bd.play(p, turn);
            if (cap >= 0) { played = p; break; }
          }
        }
        if (played < 0) { passes++; bd.ko = -1; }
        else {
          passes = 0;
          if (cap > 0) rebuild(); else remove(played); // 石を取ったときだけ一覧を作り直す
        }
        last = played; turn = other(turn); moves++;
      }
      if (own) for (let p = 0; p < size; p++) {
        let v = b[p];
        if (v === EMPTY) {
          let bl = false, wh = false;
          for (const r of bd.nb[p]) { if (b[r] === BLACK) bl = true; else if (b[r] === WHITE) wh = true; }
          v = bl && !wh ? BLACK : wh && !bl ? WHITE : 0;
        }
        if (v === BLACK) own[p]++; else if (v === WHITE) own[p]--;
      }
      return bd.score(komi);
    }

    // ---------- 決まりごとで手に点数を付ける（レベル 3〜4、5 以上では候補選び） ----------
    function evaluate(bd, p, c, stoneCount) {
      const n = bd.n, b = bd.b, o = other(c);
      if (b[p] !== EMPTY || p === bd.ko || bd.isEye(p, c)) return null;
      const before = [];
      // 隣の自分の石がアタリかどうか（打つ前）
      let saveBonus = 0, ataris = 0;
      for (const r of bd.nb[p]) {
        if (b[r] === c && bd.libs(r, before, 2) === 1) saveBonus += before.length;
      }
      const t = bd.clone();
      const cap = t.play(p, c);
      if (cap < 0) return null;
      const own = [];
      const libs = t.libs(p, own, 4);
      let s = 0;
      if (cap > 0) s += 30 + cap * 12;
      if (saveBonus && libs >= 2) s += 20 + saveBonus * 10;
      if (libs === 1 && cap === 0) s -= 45 + own.length * 8; // 自分から取られに行く手
      for (const r of t.nb[p]) {
        if (t.b[r] === o && t.libs(r, null, 2) === 1) ataris++;
        if (t.b[r] === c) s += 1.5;
        if (t.b[r] === o) s += 1;
      }
      s += ataris * 7;
      // 盤の端からの距離：序盤は 3・4 線を好み、1 線は嫌う
      const x = p % n, y = (p - x) / n, line = Math.min(x, y, n - 1 - x, n - 1 - y);
      if (line === 0) s -= cap || saveBonus ? 0 : 9;
      else if (line === 1) s -= stoneCount < n ? 4 : 1;
      else if ((line === 2 || line === 3) && stoneCount < n * 1.5) s += 5;
      // まわりの空き具合（まだ誰のものでもない広い場所ほど価値がある）
      let room = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const v = b[yy * n + xx];
        if (v === EMPTY) room += 0.3; else if (v === o) room -= 0.2;
      }
      s += room;
      return s;
    }

    function legalMoves(bd, c) {
      const out = [];
      for (let p = 0; p < bd.b.length; p++) {
        if (bd.b[p] !== EMPTY || bd.isEye(p, c) || p === bd.ko) continue;
        const t = bd.clone();
        if (t.play(p, c) >= 0) out.push(p);
      }
      return out;
    }

    function stoneCount(bd) { let k = 0; for (const v of bd.b) if (v) k++; return k; }

    // 石の近く（2 路以内）に絞る。序盤で石が少ないときは星の周りも候補に入れる
    function nearStones(bd, moves) {
      const n = bd.n, b = bd.b;
      if (stoneCount(bd) < 2) {
        const star = n >= 13 ? 3 : 2, c = (n - 1) / 2;
        return moves.filter((p) => {
          const x = p % n, y = (p - x) / n;
          const ok = (v) => v === star || v === n - 1 - star || v === c;
          return ok(x) && ok(y);
        });
      }
      return moves.filter((p) => {
        const x = p % n, y = (p - x) / n;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n && b[yy * n + xx]) return true;
        }
        return false;
      });
    }

    // ---------- 手を選ぶ ----------
    // state: { size, board(配列), turn, ko, komi, opponentPassed }
    // 戻り値: { move: 点の番号 or -1（パス）, rate: 自分の勝ちやすさの目安（0〜1。投了するかどうかに使う） }
    function chooseMove(state, level) {
      const r = pickMove(state, level);
      if (r.rate === undefined) r.rate = quickRate(state);
      return r;
    }
    // 今の盤面から何百局か試し打ちして、手番の側が勝つ割合を見積もる（Lv1〜4 の投了の判断用）
    function quickRate(state) {
      const n = state.size, c = state.turn, bd = new Board(n, state.board, state.ko ?? -1);
      const times = n >= 19 ? 60 : n >= 13 ? 120 : 200, sign = c === BLACK ? 1 : -1;
      let win = 0;
      for (let i = 0; i < times; i++) if (playout(bd.clone(), c, state.komi, null) * sign > 0) win++;
      return win / times;
    }

    function pickMove(state, level) {
      const n = state.size, c = state.turn;
      const bd = new Board(n, state.board, state.ko ?? -1);
      const moves = legalMoves(bd, c);
      if (!moves.length) return { move: -1 };
      const count = stoneCount(bd);

      if (level <= 1) {
        // でたらめ。ただし 1 線は避け、取れる石はときどき取る
        if (Math.random() < 0.35) { const cap = bestCapture(bd, moves, c); if (cap >= 0) return { move: cap }; }
        const pool = moves.filter((p) => { const x = p % n, y = (p - x) / n; return Math.min(x, y, n - 1 - x, n - 1 - y) > 0; });
        if (state.opponentPassed && Math.random() < 0.5) return { move: -1 };
        return { move: (pool.length ? pool : moves)[Math.floor(Math.random() * (pool.length || moves.length))] };
      }

      if (level <= 4) {
        const noise = [0, 0, 40, 16, 6][level];
        let best = -1, bestS = -Infinity;
        for (const p of nearStones(bd, moves).concat(moves.length < 12 ? moves : [])) {
          const s = evaluate(bd, p, c, count);
          if (s === null) continue;
          const v = s + Math.random() * noise;
          if (v > bestS) { bestS = v; best = p; }
        }
        // 相手がパスして、もう打つ価値のある手がないならパス
        if (best < 0 || (state.opponentPassed && bestS < 4)) return { move: -1 };
        return { move: best };
      }

      return monteCarlo(bd, state, level, moves, count);
    }

    // 決着していない空点の数：黒と白の両方に接している空点のかたまり（境界・ダメ）の大きさの合計
    function openPoints(bd) {
      const b = bd.b, seen = new Uint8Array(b.length);
      let open = 0;
      for (let p = 0; p < b.length; p++) {
        if (b[p] !== EMPTY || seen[p]) continue;
        const st = [p]; seen[p] = 1;
        let size = 0, bl = false, wh = false;
        while (st.length) {
          const q = st.pop(); size++;
          for (const r of bd.nb[q]) {
            if (b[r] === BLACK) bl = true; else if (b[r] === WHITE) wh = true;
            else if (!seen[r]) { seen[r] = 1; st.push(r); }
          }
        }
        if (bl && wh) open += size;
      }
      return open;
    }

    function bestCapture(bd, moves, c) {
      let best = -1, most = 0;
      for (const p of moves) { const t = bd.clone(); const k = t.play(p, c); if (k > most) { most = k; best = p; } }
      return best;
    }

    // 候補の手それぞれを、時間いっぱい試し打ちして比べる（よさそうな手ほど多く試す）
    function monteCarlo(bd, state, level, moves, count) {
      const n = bd.n, c = state.turn, komi = state.komi;
      const sizeK = n >= 19 ? 1.6 : n >= 13 ? 1.3 : 1;
      const budget = [0, 0, 0, 0, 0, 300, 700, 1300, 2300, 3600][level] * sizeK;
      const K = n >= 13 ? 36 : 28;
      // 決まりごとの点数で候補を絞る
      const scored = [];
      for (const p of nearStones(bd, moves)) { const s = evaluate(bd, p, c, count); if (s !== null) scored.push([p, s]); }
      if (!scored.length) for (const p of moves) { const s = evaluate(bd, p, c, count); if (s !== null) scored.push([p, s]); }
      if (!scored.length) return { move: -1 };
      scored.sort((a, b) => b[1] - a[1]);
      const cands = scored.slice(0, K).map(([p, s]) => ({ p, s, n: 0, w: 0 }));
      const own = new Float32Array(n * n);
      const sign = c === BLACK ? 1 : -1;
      const t0 = now();
      let total = 0;
      while (now() - t0 < budget || total < cands.length * 2) {
        for (let k = 0; k < 8; k++) {
          // UCB：勝率が高い手と、まだあまり試していない手を優先して試す
          let pick = cands[0], best = -Infinity;
          for (const cd of cands) {
            const v = cd.n === 0 ? 1e9 + cd.s : cd.w / cd.n + 0.9 * Math.sqrt(Math.log(total + 1) / cd.n) + cd.s * 0.002;
            if (v > best) { best = v; pick = cd; }
          }
          const t = bd.clone();
          t.play(pick.p, c);
          const score = playout(t, other(c), komi, own) * sign;
          pick.n++; if (score > 0) pick.w++;
          total++;
        }
        if (total > 200000) break;
      }
      cands.sort((a, b) => b.n - a.n);
      const top = cands[0], rate = top.w / Math.max(1, top.n);
      // 相手がパスしたとき：勝っている、または残りの手がどれも決着済みの場所ならパス
      if (state.opponentPassed) {
        const open = openPoints(bd);
        // まだ決着していない場所が残っているうちは、勝っていても打ち続ける（日本ルールでは決着していない場所は誰の地にもならない）
        if (open === 0 || (rate > 0.5 && open <= Math.floor(n / 3))) return { move: -1, rate };
      }
      // どの手も取られるだけ（自分の地を埋めるだけ）ならパス
      if (rate < 0.02 && count > n * n * 0.6) return { move: -1, rate };
      return { move: top.p, rate };
    }

    // ---------- 終局のときの死に石の推定 ----------
    // 最後まで何百局か試し打ちして、だいたい相手の地になる石を死に石とみなす
    function estimateDead(state) {
      const n = state.size, bd = new Board(n, state.board, -1);
      const own = new Float32Array(n * n);
      const times = n >= 19 ? 300 : n >= 13 ? 500 : 800;
      for (let i = 0; i < times; i++) playout(bd.clone(), i % 2 ? BLACK : WHITE, state.komi, own);
      const dead = [];
      for (let p = 0; p < n * n; p++) {
        const v = own[p] / times;
        if ((bd.b[p] === BLACK && v < -0.3) || (bd.b[p] === WHITE && v > 0.3)) dead.push(p);
      }
      return dead;
    }

    return { chooseMove, estimateDead, Board, playout };
  }

  const api = factory();
  // ブラウザでは別のスレッド（Web Worker）で動かす。作れない環境では null
  api.createWorker = function () {
    try {
      const src = `const AI = (${factory.toString()})();
        onmessage = (e) => {
          const d = e.data;
          const out = d.type === 'dead' ? { dead: AI.estimateDead(d.state) } : AI.chooseMove(d.state, d.level);
          postMessage(Object.assign({ id: d.id }, out));
        };`;
      return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    } catch (e) { return null; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GoAI = api;
})(this);
