/**
 * 生成AIの呼び出し回数の配分。
 *
 * 無料枠は上限が保証されていないので、1回の実行で使える回数を先に決めて
 * 工程ごとに配分する。使い切ったら例外にせず「AIなしで続行」に縮退させる。
 * エージェントが枠を食い潰して、人間が手で使えなくなる状態を作らないため。
 */
export class CallBudget {
  private used = 0;

  constructor(private readonly total: number) {}

  get remaining(): number {
    return Math.max(0, this.total - this.used);
  }

  get spent(): number {
    return this.used;
  }

  /** 使えるなら true を返して1回ぶん消費する。 */
  take(n = 1): boolean {
    if (this.used + n > this.total) return false;
    this.used += n;
    return true;
  }

  /** この工程に割ける回数（残りの割合で頭打ちにする）。 */
  allocate(share: number): number {
    return Math.max(0, Math.floor(this.remaining * share));
  }
}
