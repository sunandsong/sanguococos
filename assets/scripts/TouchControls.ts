import { Node, Graphics, Color, UITransform, Layers, Vec3, tween, EventTouch } from 'cc';
import { DESIGN_H as H } from './Constants';

// ─────────────────────────────────────────────────────────────
// 触控操作套件：左手虚拟摇杆(左右移动/双击方向滑铲) + 右手攻击大钮/跳跃键/滑铲小钮(带冷却扇形)。
//   布局全局唯一,场景只提供回调;摇杆纵轴通过 onAxis 透出(潜水等场景用)。
// ─────────────────────────────────────────────────────────────
export type ControlEvents = {
  onDir?: (d: -1 | 0 | 1) => void;          // 过死区后的左右方向(松手回 0)
  onAxis?: (ax: number, ay: number) => void; // 摇杆归一化偏移 -1..1(松手回 0,0)
  onJump?: () => void;                       // 上推起跳(回中解锁,防连跳)
  onDash?: (dir: number) => void;            // 同方向快速双击(0.28s 内)
  onAttack?: () => void;
  onSlide?: () => void;                     // 滑铲键(带冷却环)
};

export type ControlOpts = {
  alpha?: number;        // 按钮透明度(乘进颜色)
};

// 布局全局唯一:摇杆(纯移动) + 跳跃键 + 攻击大钮 + 技能小钮。没有场景专用按钮,改布局=改这里,所有章一起变。
export class TouchControls {
  private nodes: Node[] = [];
  private spcCdG: Graphics | null = null;
  private spcCdKey = -1;
  private readonly alpha: number;

  constructor(private host: Node, private ev: ControlEvents, opts: ControlOpts = {}) {
    this.alpha = opts.alpha ?? 0.5;
    const by = -H / 2 + 120;
    this.joystick(-236, by + 18);
    // 跳跃键(白描上箭头):在攻击钮上方偏左 —— 全章统一,跳跃只走这个键
    const jmp = this.circleBtn(218, by + 150, 56, (g, r, ia) => {
      g.lineCap = Graphics.LineCap.ROUND;
      g.strokeColor = new Color(255, 255, 255, ia(235)); g.lineWidth = 6;
      g.moveTo(-r * 0.3, 0); g.lineTo(0, r * 0.34); g.lineTo(r * 0.3, 0); g.stroke();   // 箭头朝上
      g.moveTo(0, r * 0.34); g.lineTo(0, -r * 0.34); g.stroke();                        // 箭杆
    });
    this.tap(jmp, () => this.ev.onJump && this.ev.onJump());
    // 攻击大钮(白描刀)
    const atk = this.circleBtn(268, by, 82, (g, r, ia) => {
      g.lineCap = Graphics.LineCap.ROUND;
      g.strokeColor = new Color(255, 255, 255, ia(235)); g.lineWidth = 8;
      g.moveTo(-r * 0.14, -r * 0.14); g.lineTo(r * 0.44, r * 0.44); g.stroke();   // 刀刃
      g.lineWidth = 5;
      g.moveTo(-r * 0.02, -r * 0.32); g.lineTo(-r * 0.32, -r * 0.02); g.stroke(); // 护手
      g.moveTo(-r * 0.2, -r * 0.2); g.lineTo(-r * 0.42, -r * 0.42); g.stroke();   // 刀柄
    });
    this.tap(atk, () => this.ev.onAttack && this.ev.onAttack());
    // 滑铲小钮(白描加速箭头+滑行线) + 冷却扇形遮罩
    const spc = this.circleBtn(132, by + 52, 56, (g, r, ia) => {
      g.lineCap = Graphics.LineCap.ROUND;
      g.strokeColor = new Color(255, 255, 255, ia(235)); g.lineWidth = 6;
      g.moveTo(-r * 0.42, r * 0.24); g.lineTo(-r * 0.12, 0); g.lineTo(-r * 0.42, -r * 0.24); g.stroke();
      g.moveTo(-r * 0.04, r * 0.24); g.lineTo(r * 0.26, 0); g.lineTo(-r * 0.04, -r * 0.24); g.stroke();
      g.lineWidth = 4;
      g.moveTo(-r * 0.3, -r * 0.42); g.lineTo(r * 0.36, -r * 0.42); g.stroke();
    });
    this.tap(spc, () => this.ev.onSlide && this.ev.onSlide());
    const cdN = new Node('tc-spccd'); cdN.layer = Layers.Enum.UI_2D; cdN.parent = spc;
    cdN.addComponent(UITransform);
    this.spcCdG = cdN.addComponent(Graphics);
  }

  /** 技能冷却扇形:frac=剩余比例 0..1(0=就绪);48 级量化,跨级才重画 */
  setSpecialCd(frac: number) {
    const g = this.spcCdG;
    if (!g) return;
    const step = frac <= 0 ? 0 : Math.max(1, Math.ceil(Math.min(1, frac) * 48));
    if (step === this.spcCdKey) return;
    this.spcCdKey = step;
    g.clear();
    if (step === 0) return;
    const f = step / 48, R = 53, seg = 30;
    g.fillColor = new Color(0, 0, 0, 145);
    g.moveTo(0, 0);
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI / 2 - (i / seg) * f * Math.PI * 2;   // 从12点顺时针
      g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    g.close(); g.fill();
  }

  destroy() { for (const n of this.nodes) if (n.isValid) n.destroy(); this.nodes = []; }

  // ── 内部 ──
  private arc(g: Graphics, x: number, y: number, r: number, a0: number, a1: number, seg = 12) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * i / seg;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
  }

  private tap(n: Node, cb: () => void) {
    n.on(Node.EventType.TOUCH_START, () => n.setScale(0.9, 0.9, 1));
    const up = () => { tween(n).to(0.05, { scale: new Vec3(1.08, 1.08, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start(); };
    n.on(Node.EventType.TOUCH_END, () => { up(); cb(); });
    n.on(Node.EventType.TOUCH_CANCEL, up);
  }

  private circleBtn(x: number, y: number, r: number, icon: (g: Graphics, r: number, ia: (v: number) => number) => void): Node {
    const n = new Node('tc-btn'); n.layer = Layers.Enum.UI_2D; n.parent = this.host; this.nodes.push(n);
    const ut = n.addComponent(UITransform); ut.setContentSize(r * 2 + 18, r * 2 + 18); ut.setAnchorPoint(0.5, 0.5);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics);
    const a = (v: number) => Math.round(v * this.alpha);
    // 毛玻璃+立体:底投影→磨砂底→上半反光→斜高光→下缘内阴影→亮顶弧/暗底弧双色圈
    g.fillColor = new Color(20, 24, 34, a(70)); g.ellipse(0, -r * 0.1 - 4, r * 0.96, r * 0.9); g.fill(); // 底投影(往下错位)
    g.fillColor = new Color(255, 255, 255, a(56)); g.circle(0, 0, r); g.fill();                          // 磨砂底
    g.fillColor = new Color(255, 255, 255, a(48)); g.ellipse(0, r * 0.42, r * 0.82, r * 0.5); g.fill();  // 上半玻璃反光
    g.lineCap = Graphics.LineCap.ROUND;
    g.strokeColor = new Color(255, 255, 255, a(120)); g.lineWidth = Math.max(4, r * 0.1);
    g.moveTo(-r * 0.55, r * 0.28); g.lineTo(-r * 0.2, r * 0.62); g.stroke();                             // 斜高光条
    g.strokeColor = new Color(30, 36, 50, a(70)); g.lineWidth = 5;
    this.arc(g, 0, 0, r - 4, Math.PI * 1.15, Math.PI * 1.85, 16); g.stroke();                            // 下缘内阴影(立体凹)
    g.strokeColor = new Color(255, 255, 255, a(90)); g.lineWidth = 3;
    this.arc(g, 0, 0, r, Math.PI * 1.15, Math.PI * 1.85, 16); g.stroke();                                // 底圈弱
    g.strokeColor = new Color(255, 255, 255, a(235)); g.lineWidth = 3;
    this.arc(g, 0, 0, r, Math.PI * 0.1, Math.PI * 0.9, 16); g.stroke();                                  // 顶圈亮(受光)
    g.strokeColor = new Color(255, 255, 255, a(150)); g.lineWidth = 3;
    this.arc(g, 0, 0, r, Math.PI * 0.9, Math.PI * 1.15, 8); g.stroke();
    this.arc(g, 0, 0, r, Math.PI * 1.85, Math.PI * 2.1, 8); g.stroke();                                  // 两侧过渡
    icon(g, r, a);
    return n;
  }

  private joystick(cx: number, cy: number) {
    const R = 96, KR = 50, DEAD = 18, HIT = 300;
    const a = (v: number) => Math.round(v * this.alpha);
    const base = new Node('tc-joybase'); base.layer = Layers.Enum.UI_2D; base.parent = this.host; this.nodes.push(base);
    const bu = base.addComponent(UITransform); bu.setContentSize(HIT, HIT); bu.setAnchorPoint(0.5, 0.5);
    base.setPosition(cx, cy, 0);
    const bg = base.addComponent(Graphics);
    // 毛玻璃+立体:底投影→磨砂底→上半反光→下缘内阴影→亮顶弧/暗底弧
    bg.fillColor = new Color(20, 24, 34, a(60)); bg.ellipse(0, -R * 0.08 - 4, R * 0.98, R * 0.92); bg.fill();
    bg.fillColor = new Color(255, 255, 255, a(48)); bg.circle(0, 0, R); bg.fill();
    bg.fillColor = new Color(255, 255, 255, a(40)); bg.ellipse(0, R * 0.42, R * 0.82, R * 0.5); bg.fill();
    bg.strokeColor = new Color(30, 36, 50, a(60)); bg.lineWidth = 5;
    this.arc(bg, 0, 0, R - 5, Math.PI * 1.15, Math.PI * 1.85, 18); bg.stroke();
    bg.strokeColor = new Color(255, 255, 255, a(90)); bg.lineWidth = 3;
    this.arc(bg, 0, 0, R, Math.PI * 1.1, Math.PI * 1.9, 18); bg.stroke();
    bg.strokeColor = new Color(255, 255, 255, a(235)); bg.lineWidth = 3;
    this.arc(bg, 0, 0, R, Math.PI * 0.08, Math.PI * 0.92, 18); bg.stroke();
    bg.strokeColor = new Color(255, 255, 255, a(150)); bg.lineWidth = 3;
    this.arc(bg, 0, 0, R, Math.PI * 0.92, Math.PI * 1.1, 8); bg.stroke();
    this.arc(bg, 0, 0, R, Math.PI * 1.9, Math.PI * 2.08, 8); bg.stroke();
    bg.fillColor = new Color(255, 255, 255, a(170));
    for (const s of [-1, 1]) { bg.moveTo(s * (R - 20), 12); bg.lineTo(s * (R - 4), 0); bg.lineTo(s * (R - 20), -12); bg.close(); bg.fill(); }
    // 滑块
    const knobN = new Node('tc-joyknob'); knobN.layer = Layers.Enum.UI_2D; knobN.parent = base;
    knobN.addComponent(UITransform); knobN.setPosition(0, 0, 0);
    const kg = knobN.addComponent(Graphics);
    // 滑块:毛玻璃小圆+立体(底投影+反光+亮顶弧)
    kg.fillColor = new Color(20, 24, 34, a(70)); kg.ellipse(0, -3, KR * 0.96, KR * 0.9); kg.fill();
    kg.fillColor = new Color(255, 255, 255, a(70)); kg.circle(0, 0, KR); kg.fill();
    kg.fillColor = new Color(255, 255, 255, a(55)); kg.ellipse(0, KR * 0.35, KR * 0.75, KR * 0.45); kg.fill();
    kg.strokeColor = new Color(30, 36, 50, a(60)); kg.lineWidth = 4;
    this.arc(kg, 0, 0, KR - 3, Math.PI * 1.15, Math.PI * 1.85, 12); kg.stroke();
    kg.strokeColor = new Color(255, 255, 255, a(235)); kg.lineWidth = 3;
    this.arc(kg, 0, 0, KR, Math.PI * 0.1, Math.PI * 0.9, 12); kg.stroke();
    kg.strokeColor = new Color(255, 255, 255, a(130)); kg.lineWidth = 3;
    this.arc(kg, 0, 0, KR, Math.PI * 0.9, Math.PI * 2.1, 16); kg.stroke();

    let tapDir = 0, tapT = -9;   // 双击方向 → 冲刺
    const uiT = this.host.getComponent(UITransform)!;
    const emitDir = (d: -1 | 0 | 1) => { if (this.ev.onDir) this.ev.onDir(d); };
    const move = (e: EventTouch) => {
      const loc = e.getUILocation();
      const p = uiT.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
      let dx = p.x - cx, dy = p.y - cy;
      const mag = Math.hypot(dx, dy);
      if (mag > R) { dx = dx / mag * R; dy = dy / mag * R; }
      knobN.setPosition(dx, dy, 0);
      if (this.ev.onAxis) this.ev.onAxis(dx / R, dy / R);
      emitDir(dx < -DEAD ? -1 : dx > DEAD ? 1 : 0);
    };
    const start = (e: EventTouch) => {
      move(e);
      const loc = e.getUILocation();
      const p = uiT.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
      const dx = p.x - cx;
      const dir = dx < -DEAD ? -1 : dx > DEAD ? 1 : 0;
      if (dir !== 0) {
        const now = Date.now() / 1000;
        if (dir === tapDir && now - tapT < 0.28) { tapT = -9; this.ev.onDash && this.ev.onDash(dir); }
        else { tapDir = dir; tapT = now; }
      }
    };
    const reset = () => {
      emitDir(0);
      if (this.ev.onAxis) this.ev.onAxis(0, 0);
      tween(knobN).to(0.08, { position: new Vec3(0, 0, 0) }, { easing: 'quadOut' }).start();
    };
    base.on(Node.EventType.TOUCH_START, start);
    base.on(Node.EventType.TOUCH_MOVE, move);
    base.on(Node.EventType.TOUCH_END, reset);
    base.on(Node.EventType.TOUCH_CANCEL, reset);
  }
}
