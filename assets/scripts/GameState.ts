import { director } from 'cc';

// 全局状态单例（不是组件，直接 GameState.i 访问）
// 把原 HTML 里的 STATE / 昼夜曲线搬到这里，后续所有系统都读它。

const SKY_KEYS = [
  { t: 0.00, c: [255, 205, 150], a: 0.10 }, // 拂晓
  { t: 0.16, c: [255, 255, 255], a: 0.00 }, // 上午
  { t: 0.42, c: [255, 255, 255], a: 0.00 }, // 午后
  { t: 0.52, c: [255, 125, 45], a: 0.26 },  // 黄昏
  { t: 0.63, c: [45, 50, 95], a: 0.42 },    // 入夜
  { t: 0.80, c: [12, 18, 46], a: 0.55 },    // 深夜
  { t: 0.92, c: [55, 60, 110], a: 0.40 },   // 凌晨
  { t: 1.00, c: [255, 205, 150], a: 0.10 }, // 回拂晓
];

export class GameState {
  private static _i: GameState;
  static get i(): GameState {
    return this._i || (this._i = new GameState());
  }

  time = 0;        // 累计秒
  dayLen = 90;     // 一整天 90 秒
  level = 1;
  food = 0;
  soldiers = 0;

  private _lastFrame = -1;
  /** 推进时间：任何组件每帧调用都行，每帧只真正加一次（不会重复） */
  tick(dt: number) {
    const f = director.getTotalFrames();
    if (f === this._lastFrame) return;   // 同一帧已加过
    this._lastFrame = f;
    this.time += Math.min(dt, 0.1);      // 防卡顿跳变
  }

  /** 0..1 一天中的进度 */
  get dayPhase(): number {
    return (this.time % this.dayLen) / this.dayLen;
  }

  /** 当前天空叠加色（关键帧插值） */
  skyAt(dp: number): { c: number[]; a: number } {
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      const k0 = SKY_KEYS[i], k1 = SKY_KEYS[i + 1];
      if (dp >= k0.t && dp <= k1.t) {
        const u = (dp - k0.t) / (k1.t - k0.t);
        return {
          a: k0.a + (k1.a - k0.a) * u,
          c: [0, 1, 2].map(j => Math.round(k0.c[j] + (k1.c[j] - k0.c[j]) * u)),
        };
      }
    }
    return { c: [255, 255, 255], a: 0 };
  }

  /** 夜的浓度 0..1（白天=0，深夜≈1） */
  get nightLevel(): number {
    return Math.min(1, this.skyAt(this.dayPhase).a / 0.5);
  }
}
