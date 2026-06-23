import { director } from 'cc';

// 全局状态单例（不是组件，直接 GameState.i 访问）
// 把原 HTML 里的 STATE / 昼夜曲线搬到这里，后续所有系统都读它。

// 长白天 + 长黑夜 + 极短过渡。入夜推迟到太阳真正沉到底（fy≈0.33）才全黑
const SKY_KEYS = [
  { t: 0.00, c: [255, 255, 255], a: 0.00 }, // 大白天
  { t: 0.46, c: [255, 255, 255], a: 0.00 }, // 白天结束（太阳此刻才开始往下落）
  { t: 0.48, c: [255, 125, 45], a: 0.30 },  // 黄昏（一闪而过）
  { t: 0.50, c: [12, 18, 46], a: 0.60 },    // 入夜（太阳已落到底 → 月亮亮起）
  { t: 0.85, c: [12, 18, 46], a: 0.60 },    // 深夜（一整段全黑）
  { t: 0.87, c: [255, 150, 70], a: 0.30 },  // 拂晓（一闪而过）
  { t: 0.90, c: [255, 255, 255], a: 0.00 }, // 天亮（太阳露头）
  { t: 1.00, c: [255, 255, 255], a: 0.00 }, // 回到大白天
];

export class GameState {
  private static _i: GameState;
  static get i(): GameState {
    return this._i || (this._i = new GameState());
  }

  dayLen = 60;            // 一整天 60 秒
  startPhase = 0.18;      // 游戏开局时 dayPhase 从哪里开始（0.18 = 太阳已经升起一点点，不用等）
  time = this.dayLen * this.startPhase;   // 累计秒（初始 = 开局相位 × dayLen）
  level = 1;
  food = 0;
  soldiers = 0;
  sunFy = 1;             // 太阳当前高度（fy，越小越高）；由 SunSprite 每帧写入
  sunVis = 0;            // 太阳可见度 0~1；月亮取 1−sunVis（互补接力）

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
