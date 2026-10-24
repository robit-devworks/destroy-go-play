// デストロイルール（HP バトル）の計算。画面とは独立させ、テストやコンピューター同士の試合でも使う。
//  ・相手の石を取ると相手の HP が減る（まとめて取るほど 1 子あたりのダメージが大きい）
//  ・クリティカル（碁盤ごとの子数以上）は最初の最大 HP の半分のダメージ、さらに多く取ると即 KO
//  ・ため撃ち MAX はダメージ 1.5 倍、自分の HP が 4 分の 1 以下なら「背水」で 1.2 倍
//  ・反動：ため撃ち MAX で増えた分と同じだけ、自分の HP も減る（HP は 1 で止まる。相手を KO したときは受けない）。
//    相手との HP の差は溜めなくても同じなので、溜めるのはとどめを刺すときと、わざと背水に入るときだけ得になる
//  ・2 眼ができて取られなくなった石 HEAL_STONES 子ごとに 1 回復。最大 HP を超えた分は最大 HP も増やす（最初の 2 倍まで）
//  ・カウンター：相手が石を取った直後に、その取りに来た石（相手が直前に打った石）ごと取り返すと 1.5 倍
//    （うってがえしなどの返り討ち。別の場所の石を取り返すだけならカウンターにしない＝先に取った側が損をしないように）
//  ・コンボ：自分の手番で続けて取ると、2 連続 1.2 倍・3 連続 1.4 倍…（2 倍まで）。取れなかった手やパスで途切れる
//  ・ラストスパート：盤の 7 割が石で埋まるか、2 人の残り時間の合計が試合時間（1 人分の持ち時間）の 3 分の 2 以下になったら（2 人の合計時間の 3 分の 1 が残ったら）、2 人とも 1.5 倍。一度入ったら最後まで
//  ・倍率は全部掛け合わせるが、合計 2.5 倍までにする（重なりすぎて一撃で終わらないように）
//  ・HP ハンデ：弱い側の最初の HP を増やせる（+25%・+50%・+100%）
//  ・HP が 0 で KO 負け。パスで終局したら、お互いに地 1 目につき相手に 1 ダメージを同時に与える。
//    HP が 0 以下になった側の KO 負け（両方なら残りのマイナスが大きいほう）。両方残ったら残り HP の多いほうの勝ち
//  シンプル版（advanced = false）は、HP・ダメージ・クリティカル・即 KO・終局だけ。
//  ため撃ちは演出だけになり、倍率（ため撃ち・背水・カウンター・コンボ・ラストスパート）・反動・2 眼の回復はなし
(function (root) {
  'use strict';
  const BLACK = 1, WHITE = 2, EMPTY = 0;

  // 碁盤ごとの数字（white は白の最初の HP の上乗せ＝先手の黒との差を埋める）。
  // コンピューター同士の試合では、上乗せなしでも黒が勝ち越す傾向は見えなかったので、上乗せは少しだけにしている
  const CONFIG = {
    9: { hp: 40, crit: 6, ko: 10, white: 1 },
    13: { hp: 70, crit: 9, ko: 15, white: 2 },
    19: { hp: 100, crit: 12, ko: 20, white: 3 },
  };
  // シンプル版（回復なし）は倍率がなくて KO まで行きにくいので、最初の HP を上級の 7 割にする。
  // 白の上乗せはコンピューター同士の試合で黒白の勝ち数がそろうように決めた（19 路は HP が少ないと黒が勝ち越しやすい）
  const CONFIG_SIMPLE = {
    9: { hp: 28, crit: 6, ko: 10, white: 1 },
    13: { hp: 50, crit: 9, ko: 15, white: 0 },
    19: { hp: 70, crit: 12, ko: 20, white: 12 },
  };
  const conf = (size, advanced = true) => { const t = advanced ? CONFIG : CONFIG_SIMPLE; return t[size] || t[19]; };
  // 回復：取られなくなった石この数ごとに HP 1（コンピューター同士の試合で、1 子 1 回復だと回復がダメージを大きく上回ったため）
  const HEAL_STONES = 4;

  function perStone(n) { return n <= 3 ? 2 : n <= 6 ? 3 : 4; }

  const MAX_MULT = 2.5;
  const comboMult = (combo) => (combo >= 2 ? Math.min(2, 1 + 0.2 * (combo - 1)) : 1);
  // 一度に n 子取ったときのダメージ。{ amount, kind: 'normal' | 'critical' | 'ko', tags: 付いた倍率の名前 }
  // 画面で計算式を出せるように、内訳も返す：base（倍率をかける前）、per（1 子あたり。クリティカルは null）、
  // parts（[{ name, mult }] 付いた倍率）、mult（掛け合わせた倍率。上限 MAX_MULT で止めたもの）、capped（上限で止めたか）
  function damage(n, size, { advanced = true, maxCharge = false, desperate = false, counter = false, combo = 0, spurt = false } = {}) {
    const c = conf(size, advanced);
    if (n <= 0) return { amount: 0, kind: 'none', tags: [], parts: [] };
    if (n >= c.ko) return { amount: Infinity, kind: 'ko', tags: [], parts: [] };
    const crit = n >= c.crit, per = crit ? null : perStone(n), base = crit ? c.hp / 2 : n * per;
    const tags = [], parts = [];
    const add = (tag, name, mult) => { tags.push(tag); parts.push({ name, mult }); };
    if (maxCharge) add('ため撃ち', 'ため撃ち', 1.5);
    if (desperate) add('背水', '背水', 1.2);
    if (counter) add('COUNTER!!', 'カウンター', 1.5);
    if (combo >= 2) add(`${combo} COMBO!`, `${combo}コンボ`, comboMult(combo));
    if (spurt) add('LAST SPURT', 'ラストスパート', 1.5);
    const raw = parts.reduce((m, p) => m * p.mult, 1), mult = Math.min(MAX_MULT, raw);
    return { amount: Math.round(base * mult), kind: crit ? 'critical' : 'normal', tags, base, per, parts, mult, capped: raw > MAX_MULT };
  }

  // ---------- 2 眼で取られない石（ベンソンのアルゴリズム） ----------
  // 相手が何手続けて打っても取られない石を探す。判定は厳しめ（実戦で生きている石でも、
  // 眼がはっきり 2 つできるまでは取られない石として数えない）
  function aliveStones(board, size, color) {
    const N = size * size, nb = [];
    for (let p = 0; p < N; p++) {
      const x = p % size, y = (p - x) / size, l = [];
      if (x > 0) l.push(p - 1); if (x < size - 1) l.push(p + 1);
      if (y > 0) l.push(p - size); if (y < size - 1) l.push(p + size);
      nb.push(l);
    }
    // 自分の石のかたまり
    const chainOf = new Int32Array(N).fill(-1), chains = [];
    for (let p = 0; p < N; p++) {
      if (board[p] !== color || chainOf[p] >= 0) continue;
      const id = chains.length, stones = [p]; chainOf[p] = id;
      for (let k = 0; k < stones.length; k++) for (const r of nb[stones[k]]) if (board[r] === color && chainOf[r] < 0) { chainOf[r] = id; stones.push(r); }
      chains.push({ stones, libs: new Set() });
      for (const s of stones) for (const r of nb[s]) if (board[r] === EMPTY) chains[id].libs.add(r);
    }
    // 自分の石以外（空点と相手の石）のつながった場所
    const regionOf = new Int32Array(N).fill(-1), regions = [];
    for (let p = 0; p < N; p++) {
      if (board[p] === color || regionOf[p] >= 0) continue;
      const id = regions.length, pts = [p]; regionOf[p] = id;
      for (let k = 0; k < pts.length; k++) for (const r of nb[pts[k]]) if (board[r] !== color && regionOf[r] < 0) { regionOf[r] = id; pts.push(r); }
      const around = new Set();
      for (const q of pts) for (const r of nb[q]) if (board[r] === color) around.add(chainOf[r]);
      regions.push({ pts, empties: pts.filter((q) => board[q] === EMPTY), around });
    }
    const liveChain = new Set(chains.map((_, i) => i)), liveRegion = new Set(regions.map((_, i) => i));
    // その場所の空点が全部、かたまり ch の呼吸点なら「ch にとっての眼になりうる場所」
    const vital = (ri, ch) => regions[ri].empties.length > 0 && regions[ri].empties.every((q) => chains[ch].libs.has(q));
    let changed = true;
    while (changed) {
      changed = false;
      for (const ch of [...liveChain]) {
        let v = 0;
        for (const ri of liveRegion) if (regions[ri].around.has(ch) && vital(ri, ch)) v++;
        if (v < 2) { liveChain.delete(ch); changed = true; }
      }
      for (const ri of [...liveRegion]) {
        for (const ch of regions[ri].around) if (!liveChain.has(ch)) { liveRegion.delete(ri); changed = true; break; }
      }
    }
    const out = new Set();
    for (const ch of liveChain) for (const s of chains[ch].stones) out.add(s);
    return out;
  }

  // ---------- 対局の HP の状態 ----------
  class DestroyState {
    // bonus: HP ハンデ { color, rate }（rate は 0.25 なら最初の HP の 25% を足す）。advanced: 上級版か
    constructor(size, bonus = null, advanced = true) {
      const c = conf(size, advanced);
      this.size = size;
      this.advanced = advanced;
      this.start = { [BLACK]: c.hp, [WHITE]: c.hp + c.white };
      if (bonus && bonus.rate > 0) this.start[bonus.color] += Math.round(c.hp * bonus.rate);
      this.combo = { [BLACK]: 0, [WHITE]: 0 }; // 続けて取った回数
      this.last = null; // 直前の手 { mover, captured, point }（カウンターの判定用）
      this.hp = { ...this.start };
      this.max = { ...this.start };
      this.credited = { [BLACK]: new Set(), [WHITE]: new Set() }; // 回復済みの石
      this.carry = { [BLACK]: 0, [WHITE]: 0 }; // 回復 1 に満たない端数（取られなくなった石の数）
      this.ko = 0; // KO された側（0 はまだ）
      this.spurtOn = false; // ラストスパートに入ったか（一度入ったら最後まで）
    }
    snapshot() {
      return { hp: { ...this.hp }, max: { ...this.max }, carry: { ...this.carry }, combo: { ...this.combo }, last: this.last, credited: { [BLACK]: new Set(this.credited[BLACK]), [WHITE]: new Set(this.credited[WHITE]) }, ko: this.ko, spurtOn: this.spurtOn };
    }
    restore(s) { this.hp = { ...s.hp }; this.max = { ...s.max }; this.carry = { ...s.carry }; this.combo = { ...s.combo }; this.last = s.last; this.credited = { [BLACK]: new Set(s.credited[BLACK]), [WHITE]: new Set(s.credited[WHITE]) }; this.ko = s.ko; this.spurtOn = !!s.spurtOn; }
    desperate(color) { return this.advanced && this.hp[color] <= this.max[color] / 4; }
    // mover が point に打って n 子取った（0 子でも呼ぶ：コンボとカウンターの記録のため）。
    // stones は取った石の位置。ダメージを相手に与えて結果を返す
    hit(mover, n, { maxCharge = false, spurt = false, point = -1, stones = [] } = {}) {
      const victim = 3 - mover;
      if (!this.advanced) maxCharge = spurt = false;
      const l = this.last;
      const counter = this.advanced && n > 0 && !!l && l.mover === victim && l.captured > 0 && l.point >= 0 && stones.includes(l.point);
      this.combo[mover] = n > 0 ? this.combo[mover] + 1 : 0;
      this.last = { mover, captured: n, point };
      const opts = { advanced: this.advanced, desperate: this.desperate(mover), counter, combo: this.advanced ? this.combo[mover] : 0, spurt };
      const d = damage(n, this.size, { ...opts, maxCharge });
      if (d.kind === 'none') return d;
      this.hp[victim] = Math.max(0, this.hp[victim] - d.amount);
      if (this.hp[victim] <= 0) this.ko = victim;
      // 反動：ため撃ちで増えた分（plain は溜めなかったときのダメージ。画面で計算式を出すのに使う）
      let recoil = 0, plain = d.amount;
      if (maxCharge && !this.ko) {
        plain = damage(n, this.size, opts).amount;
        recoil = Math.min(d.amount - plain, this.hp[mover] - 1);
        this.hp[mover] -= recoil;
      }
      return { ...d, victim, hp: this.hp[victim], recoil, plain };
    }
    // 盤面を見て、新しく取られなくなった石の分だけ回復する。{ [色]: 回復量 } を返す
    heal(board) {
      const out = { [BLACK]: 0, [WHITE]: 0 };
      if (!this.advanced) return out;
      for (const c of [BLACK, WHITE]) {
        if (this.ko) break;
        const alive = aliveStones(board, this.size, c);
        let fresh = 0;
        for (const s of alive) if (!this.credited[c].has(s)) { this.credited[c].add(s); fresh++; }
        this.carry[c] += fresh;
        const gain = Math.floor(this.carry[c] / HEAL_STONES);
        this.carry[c] -= gain * HEAL_STONES;
        if (!gain) continue;
        this.hp[c] += gain;
        this.max[c] = Math.min(this.start[c] * 2, Math.max(this.max[c], this.hp[c]));
        this.hp[c] = Math.min(this.hp[c], this.max[c]);
        out[c] = gain;
      }
      return out;
    }
    pass(mover) { this.combo[mover] = 0; this.last = { mover, captured: 0, point: -1 }; }
    // パスで終局したときの「地の総攻撃」：地 1 目につき相手に 1 ダメージを同時に与える（territory は { [色]: 地の目数 }）。
    // 同時なので順番による有利不利はなく、「HP＋自分の地」が多いほうの勝ちと同じになる。
    // { left: 攻撃を受けたあとの HP（マイナスもある）, winner: 勝った色（同じなら 0）, ko: KO された色（0 は判定） }
    finalAttack(territory = {}) {
      const left = { [BLACK]: this.hp[BLACK] - (territory[WHITE] || 0), [WHITE]: this.hp[WHITE] - (territory[BLACK] || 0) };
      const winner = left[BLACK] === left[WHITE] ? 0 : left[BLACK] > left[WHITE] ? BLACK : WHITE;
      const ko = winner && left[3 - winner] <= 0 ? 3 - winner : 0;
      return { left, winner, ko };
    }
    winnerByHp(territory = {}) { return this.finalAttack(territory).winner; }
  }

  const api = { CONFIG, CONFIG_SIMPLE, config: conf, HEAL_STONES, MAX_MULT, damage, aliveStones, DestroyState, SPURT_FILL: 0.7, SPURT_TIME: 2 / 3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DestroyRule = api;
})(this);
