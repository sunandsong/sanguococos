// ─────────────────────────────────────────────────────────────
// 憋气 / 溺水套件：潜水耗气、露头回气、气尽掉血。可复用于任何有水的场景。
//   场景每帧调 update(dt, 头是否没入水中) → 返回本帧应扣的血量(未溺水=0)。
//   air(0..1) 直接读来喂 HUD 的憋气条。
// ─────────────────────────────────────────────────────────────
export class Breath {
  air = 1;                            // 0..1
  private readonly sec: number;       // 满气可潜秒数
  private readonly recover: number;   // 露头回满秒数
  private readonly drownDps: number;  // 气尽每秒掉血

  constructor(opts?: { sec?: number; recover?: number; drownDps?: number }) {
    this.sec = opts?.sec ?? 10;
    this.recover = opts?.recover ?? 2.5;
    this.drownDps = opts?.drownDps ?? 8;
  }

  /** 每帧推进。submerged=头是否没入水中。返回本帧应扣的血量(未溺水=0) */
  update(dt: number, submerged: boolean): number {
    if (submerged) this.air = Math.max(0, this.air - dt / this.sec);
    else this.air = Math.min(1, this.air + dt / this.recover);
    return this.air <= 0 ? this.drownDps * dt : 0;
  }

  reset() { this.air = 1; }
}
