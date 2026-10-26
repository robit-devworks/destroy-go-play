// 持ち時間ルール：
//  ・各自 7 分スタート（上限も 7 分）
//  ・1 手 5 秒までは持ち時間が減らない。5 秒を超えた分だけ減る
//  ・5 秒以内に打てば余った秒数を加算（上限 7 分）
//  ・持ち時間が 0 になったら負け
(function (root) {
  'use strict';

  class GoClock {
    // unlimited：持ち時間なし（CPU 戦などで時計を使わない）。残り時間は減らず、時間切れにもならない
    constructor({ base = 7 * 60 * 1000, grace = 5000, now = () => performance.now(), unlimited = false } = {}) {
      this.base = base;
      this.unlimited = unlimited;
      this.grace = grace;
      this.now = now;
      this.remain = { 1: base, 2: base };
      this.turn = 1;
      this.turnStart = 0;
      this.pausedAt = null;
      this.running = false;
    }

    start(turn, delay = 0) {
      this.turn = turn;
      this.turnStart = this.now() + delay;
      this.running = true;
      this.pausedAt = null;
    }

    // 今の手番で経過した時間（演出中などで開始前なら 0）
    elapsed() {
      if (!this.running) return 0;
      const t = this.pausedAt !== null ? this.pausedAt : this.now();
      return Math.max(0, t - this.turnStart);
    }

    graceLeft() { return this.unlimited ? this.grace : Math.max(0, this.grace - this.elapsed()); }

    // 表示用の残り時間
    remaining(color) {
      if (this.unlimited || !this.running || color !== this.turn) return this.remain[color];
      return Math.max(0, this.remain[color] - Math.max(0, this.elapsed() - this.grace));
    }

    isTimeUp() { return this.running && this.remaining(this.turn) <= 0; }

    // 着手（パス含む）で手番終了。加減算した量（ms）を返す
    endTurn(nextTurn, delay = 0) {
      if (this.unlimited) { this.start(nextTurn, delay); return 0; }
      const e = this.elapsed();
      const before = this.remain[this.turn];
      const delta = e <= this.grace ? this.grace - e : -(e - this.grace);
      this.remain[this.turn] = Math.max(0, Math.min(this.base, before + delta));
      const applied = this.remain[this.turn] - before;
      this.start(nextTurn, delay);
      return applied;
    }

    // 演出中など、今の手番の時計を動かさずに止めておく（呼んでいる間は経過時間が 0 のまま）
    holdNow() {
      if (this.running && this.pausedAt === null) this.turnStart = Math.max(this.turnStart, this.now());
    }

    pause() { if (this.running && this.pausedAt === null) this.pausedAt = this.now(); }

    resume() {
      if (this.pausedAt === null) return;
      this.turnStart += this.now() - this.pausedAt;
      this.pausedAt = null;
    }

    stop() { this.pause(); this.running = false; }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { GoClock };
  else root.GoClock = GoClock;
})(this);
