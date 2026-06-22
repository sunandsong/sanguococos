import { _decorator, Component, Node, Sprite, SpriteFrame, Label, resources, view, UITransform, Color, Vec3, UIOpacity } from 'cc';
import { GameState } from './GameState';
const { ccclass, property } = _decorator;

// 城墙：4 档立绘。点击 → 建设中（进度条 + 3 个小人抡锤 + 黄色高光 + 冒烟 + 抖动）→ 升级。
@ccclass('City')
export class City extends Component {
  @property
  widthFrac = 0.72;
  @property
  bottomFy = 0.59;
  @property
  buildDur = 3;

  private sp!: Sprite;
  private ui!: UITransform;
  private frames: SpriteFrame[] = [];
  private curTier = -1;
  private W = 0;
  private H = 0;
  private dispW = 0;
  private dispH = 0;

  private building = false;
  private buildT = 0;
  private basePos = new Vec3();
  private barRoot!: Node;
  private barFill!: UITransform;
  private barFullW = 240;

  private glow!: Node;          // 黄色高光模板
  private glowUI!: UITransform;
  private glowOp!: UIOpacity;
  private workers: { hammer: Node, phase: number, x: number, y: number }[] = [];
  private smokeSF: SpriteFrame | null = null;
  private smokes: { n: Node, op: UIOpacity, t: number }[] = [];
  private smokeTimer = 0;
  private hamT = 0;

  onLoad() {
    const sz = view.getVisibleSize();
    this.W = sz.width; this.H = sz.height;
    this.sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    this.ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    this.sp.type = Sprite.Type.SIMPLE;
    this.sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.ui.setAnchorPoint(0.5, 0);
    ['city-thatch', 'city-wood', 'city-stone', 'city-palace'].forEach((nm, i) =>
      resources.load(nm + '/spriteFrame', SpriteFrame, (e, sf) => { if (!e) this.frames[i] = sf; }));
    resources.load('smoke/spriteFrame', SpriteFrame, (e, sf) => { if (!e) this.smokeSF = sf; });
    this.node.on(Node.EventType.TOUCH_END, this.onTap, this);
    this.buildGlow();
    this.buildProgressBar();
    this.buildWorkers();
  }

  private sprNode(parent: Node, asset: string, w: number, h: number, anchor: [number, number], color?: Color): Node {
    const n = new Node('s'); n.layer = this.node.layer; n.parent = parent;
    const ui = n.addComponent(UITransform); ui.setAnchorPoint(anchor[0], anchor[1]); ui.setContentSize(w, h);
    const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
    if (color) sp.color = color;
    resources.load(asset + '/spriteFrame', SpriteFrame, (e, sf) => { if (!e) sp.spriteFrame = sf; });
    return n;
  }

  private buildGlow() {
    this.glow = this.sprNode(this.node, 'white', 100, 100, [0.5, 0], new Color(255, 210, 60, 255));
    this.glowUI = this.glow.getComponent(UITransform)!;
    this.glowOp = this.glow.addComponent(UIOpacity);
    this.glow.active = false;
  }

  private buildProgressBar() {
    this.barRoot = new Node('buildBar'); this.barRoot.layer = this.node.layer; this.barRoot.parent = this.node;
    this.barRoot.addComponent(UITransform);
    const bg = this.sprNode(this.barRoot, 'white', this.barFullW, 24, [0, 0.5], new Color(20, 20, 20, 230));
    bg.setPosition(-this.barFullW / 2, 0, 0);
    const fill = this.sprNode(this.barRoot, 'white', this.barFullW, 20, [0, 0.5], new Color(240, 160, 32, 255));
    fill.setPosition(-this.barFullW / 2, 0, 0);
    this.barFill = fill.getComponent(UITransform)!;
    const lblN = new Node('lbl'); lblN.layer = this.node.layer; lblN.parent = this.barRoot; lblN.addComponent(UITransform);
    const lbl = lblN.addComponent(Label); lbl.fontSize = 18; lbl.color = new Color(255, 255, 255, 255); lbl.string = '建设中…';
    lblN.setPosition(0, 0, 0);
    (this.barRoot as any)._lbl = lbl;
    this.barRoot.active = false;
  }

  private buildWorkers() {
    // 3 个工匠（小人 + 锤），墙头一排
    for (let i = 0; i < 3; i++) {
      const wk = new Node('worker' + i); wk.layer = this.node.layer; wk.parent = this.node;
      wk.addComponent(UITransform);
      this.sprNode(wk, 'worker', 30, 68, [0.5, 0]);
      const hammer = this.sprNode(wk, 'hammer', 24, 56, [0.5, 0]);
      hammer.setPosition(7, 44, 0);
      wk.setScale(0.7, 0.7, 1);
      wk.active = false;
      this.workers.push({ hammer, phase: i * 1.2, x: 0, y: 0, node: wk } as any);
      (this.workers[i] as any).node = wk;
    }
  }

  private apply(idx: number) {
    const sf = this.frames[idx]; if (!sf) return;
    this.sp.spriteFrame = sf;
    const sz = sf.originalSize; const iw = sz.width || 502, ih = sz.height || 227;
    this.dispW = this.W * this.widthFrac;
    this.dispH = this.dispW * ih / iw;
    this.ui.setContentSize(this.dispW, this.dispH);
    this.node.setPosition(0, (0.5 - this.bottomFy) * this.H, 0);
    this.basePos = this.node.position.clone();
    this.curTier = idx;
    // 黄色高光铺满城（略小一圈）
    this.glowUI.setContentSize(this.dispW * 0.96, this.dispH * 0.9);
    this.glow.setPosition(0, this.dispH * 0.05, 0);
    // 工匠摆到墙头一排
    const wy = this.dispH * 0.62;
    [-0.2, 0, 0.2].forEach((fx, i) => (this.workers[i] as any).node.setPosition(fx * this.dispW, wy, 0));
  }

  private onTap() {
    if (this.building || GameState.i.level >= 4) return;
    this.building = true; this.buildT = 0;
    this.barRoot.active = true; this.glow.active = true;
    this.workers.forEach(w => (w as any).node.active = true);
  }

  private spawnSmoke(x: number, y: number) {
    if (!this.smokeSF) return;
    const n = new Node('smoke'); n.layer = this.node.layer; n.parent = this.node;
    n.addComponent(UITransform).setContentSize(40, 40);
    const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = this.smokeSF;
    const op = n.addComponent(UIOpacity);
    n.setPosition(x + (Math.random() - 0.5) * 14, y, 0);
    n.setScale(0.7, 0.7, 1);
    this.smokes.push({ n, op, t: 0 });
  }

  update(dt: number) {
    const idx = Math.max(0, Math.min(3, GameState.i.level - 1));
    if (idx !== this.curTier) this.apply(idx);

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i]; s.t += dt; const p = s.t / 1.1;
      s.n.setPosition(s.n.position.x, s.n.position.y + 40 * dt, 0);
      s.n.setScale(0.7 + p * 1.0, 0.7 + p * 1.0, 1);
      s.op.opacity = Math.max(0, 255 * (1 - p));
      if (p >= 1) { s.n.destroy(); this.smokes.splice(i, 1); }
    }

    if (this.building) {
      this.buildT += dt;
      const p = Math.min(1, this.buildT / this.buildDur);
      this.barFill.setContentSize(this.barFullW * p, 20);
      const lbl = (this.barRoot as any)._lbl as Label;
      if (lbl) lbl.string = `🏗 建设中  ${Math.ceil(this.buildDur - this.buildT)}s`;
      // 黄色高光呼吸
      this.glowOp.opacity = Math.round((0.18 + 0.12 * Math.sin(this.buildT * 6)) * 255);
      // 抖动
      const sh = 3 * (1 - p);
      this.node.setPosition(this.basePos.x + (Math.random() - 0.5) * sh, this.basePos.y + (Math.random() - 0.5) * sh, 0);
      // 3 个工匠各自抡锤
      this.hamT += dt;
      for (const w of this.workers) {
        const swing = Math.sin(this.hamT * 6 + w.phase);
        w.hammer.angle = -(20 - (swing * 0.5 + 0.5) * 80);
      }
      // 冒烟
      this.smokeTimer += dt;
      if (this.smokeTimer > 0.1) {
        this.smokeTimer = 0;
        // 城池四周随机冒烟（沿城宽散开，高度在城身一带）
        const sx = (Math.random() - 0.5) * this.dispW * 0.95;
        const sy = this.dispH * (0.35 + Math.random() * 0.4);
        this.spawnSmoke(sx, sy);
      }

      if (p >= 1) {
        this.building = false;
        this.barRoot.active = false; this.glow.active = false;
        this.workers.forEach(w => (w as any).node.active = false);
        this.node.setPosition(this.basePos);
        const gs = GameState.i; gs.level += 1; gs.food += 100; gs.soldiers += 20;
      }
    }
  }
}
