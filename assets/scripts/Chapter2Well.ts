import {
  _decorator, Component, Node, Graphics, Label, Color, UITransform,
  input, Input, EventKeyboard, KeyCode, Layers, Sprite, SpriteFrame, Texture2D, Rect, Vec3, tween, EventTouch,
} from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { AssetHub } from './AssetHub';

const { ccclass } = _decorator;

// ─────────────────────────────────────────────────────────────
// 第二章 · 投井（方案A：落水潜水）—— 逐行对齐 underwater.html demo
//   井口正中纵身落下 → 砸破水面 → 水下浮力阻尼潜行；
//   左侧石台（可往左拐落上去，砸石开洞走侧道）。角色/摇杆/按钮复用第一章。
//   世界坐标同 demo：屏 460×760，y 向下；SX/SY 把 demo 坐标缩放贴到 Cocos。
// ─────────────────────────────────────────────────────────────

type P = { x: number; y: number; vx: number; vy: number; life: number; r: number; air?: number };
type Silt = { x: number; wy: number; ph: number; sp: number; r: number };
type Ripple = { x: number; y: number; r: number; life: number };

@ccclass('Chapter2Well')
export class Chapter2Well extends Component {
  private g!: Graphics;
  private depthLabel!: Label;
  private readonly CTRL_ALPHA = 0.5;
  private readonly HERO_ROW = 1;

  // demo→Cocos 缩放（按宽度铺满井筒；demo 宽 460、高 760）
  private readonly SCALE = W / 460;
  private readonly DW = 460;        // demo 宽
  private readonly DH = 760;        // demo 高

  // 图层 / 真图
  private wallRoot!: Node; private decorRoot!: Node; private wallNodes: Node[] = []; private wallAR = 1.8;
  private mouthNode: Node | null = null; private mouthAR = 1.4;
  private ledgeNode: Node | null = null; private ledgeAR = 0.6;
  private heroNode!: Node; private heroSp!: Sprite;
  private footFrames: SpriteFrame[] = []; private jumpFrames: SpriteFrame[] = []; private walkPh = 0;

  // 世界参数（缩短落差：落一下就见水见台；潜水段仍深）
  private readonly SURFACE = 900;
  private readonly GOAL = 3900;
  private readonly LEDGE_Y = 900 - 62;       // 838 · 水面上方一点点
  private readonly LEDGE_L = -14; private readonly LEDGE_R = 178;   // 井台在左
  private readonly PASSAGE_X = 26;           // 破洞后走到此=进洞
  private readonly WALL_X = 58;              // 未破石堆挡住处

  // 玩家（demo 坐标：x 0..460、y 向下）
  private px = 230; private py = -40; private pvx = 0; private pvy = 0;
  private onG = false; private inWater = false; private dir = 1; private ph = 0;
  private camY = -140; private t = 0; private shake = 0;
  private joyY = 0;
  private keys = { left: false, right: false, up: false, down: false };

  private bubbles: P[] = []; private silt: Silt[] = []; private ripples: Ripple[] = []; private debris: P[] = [];
  private rockHP = 5; private rockBroken = false;

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    this.wallRoot = new Node('c2-wall'); this.wallRoot.layer = Layers.Enum.UI_2D; this.wallRoot.parent = this.node;
    this.wallRoot.addComponent(UITransform);
    // 井口/井台放独立容器：固定排在井壁之上、水之下（避免异步加载顺序把它们埋进井壁）
    this.decorRoot = new Node('c2-decor'); this.decorRoot.layer = Layers.Enum.UI_2D; this.decorRoot.parent = this.node;
    this.decorRoot.addComponent(UITransform);
    AssetHub.loadSF('c2-wall', (sf) => { if (sf) this.buildWall(sf); });
    AssetHub.loadSF('c2-mouth', (sf) => { if (sf) this.buildMouth(sf); });
    AssetHub.loadSF('c2-plat-ledge', (sf) => { if (sf) this.buildLedge(sf); });

    const gn = new Node('c2-gfx'); gn.layer = Layers.Enum.UI_2D; gn.parent = this.node;
    gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);

    this.buildHero();

    const ln = new Node('c2-depth'); ln.layer = Layers.Enum.UI_2D; ln.parent = this.node;
    ln.addComponent(UITransform);
    this.depthLabel = ln.addComponent(Label);
    this.depthLabel.fontSize = 30; this.depthLabel.color = new Color(233, 201, 138);
    ln.setPosition(0, H / 2 - 60, 0);

    this.buildButtons();
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    this.reset();
  }
  onDestroy() {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
  }

  // demo 坐标 → Cocos（居中、y 向上）
  private SX(wx: number) { return (wx - this.DW / 2) * this.SCALE; }
  private SY(wy: number) { return (this.DH / 2 - (wy - this.camY)) * this.SCALE; }

  // ── 真图：井壁竖向镜像平铺 / 井口 / 石台 ──
  private buildWall(sf: SpriteFrame) {
    const tex = sf.texture as Texture2D; tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
    this.wallAR = sf.rect.height / sf.rect.width;
    const THc = W * this.wallAR;
    const n = Math.ceil(H / THc) + 3;
    for (let i = 0; i < n; i++) {
      const w = new Node('wall' + i); w.layer = Layers.Enum.UI_2D; w.parent = this.wallRoot;
      const t = w.addComponent(UITransform); t.setContentSize(W, THc); t.setAnchorPoint(0.5, 0.5);
      const s = w.addComponent(Sprite); s.sizeMode = Sprite.SizeMode.CUSTOM; s.type = Sprite.Type.SIMPLE; s.spriteFrame = sf;
      this.wallNodes.push(w);
    }
  }
  private updateWall() {
    if (!this.wallNodes.length) return;
    const DHw = this.DW * this.wallAR;            // 每片覆盖的 demo 世界深度
    const i0 = Math.floor((this.camY - 60) / DHw) - 1;
    for (let k = 0; k < this.wallNodes.length; k++) {
      const i = i0 + k;
      this.wallNodes[k].setPosition(0, this.SY(i * DHw + DHw / 2), 0);
      this.wallNodes[k].setScale(1, (i % 2 ? -1 : 1), 1);   // 奇数片竖向翻转，藏接缝
    }
  }
  private buildMouth(sf: SpriteFrame) {
    this.mouthAR = sf.rect.height / sf.rect.width;
    const n = new Node('c2-mouth-img'); n.layer = Layers.Enum.UI_2D; n.parent = this.decorRoot;
    const ut = n.addComponent(UITransform); ut.setContentSize(W, W * this.mouthAR); ut.setAnchorPoint(0.5, 0.5);
    const s = n.addComponent(Sprite); s.sizeMode = Sprite.SizeMode.CUSTOM; s.type = Sprite.Type.SIMPLE; s.spriteFrame = sf;
    this.mouthNode = n;
  }
  private updateMouth() {
    if (!this.mouthNode) return;
    const half = (this.DW / 2) * this.mouthAR;    // 半高（demo 世界单位）
    this.mouthNode.setPosition(0, this.SY(-160 + half), 0);
  }
  private buildLedge(sf: SpriteFrame) {
    this.ledgeAR = sf.rect.height / sf.rect.width;
    const n = new Node('c2-ledge'); n.layer = Layers.Enum.UI_2D; n.parent = this.decorRoot;
    const w = 192, h = w * this.ledgeAR;
    const ut = n.addComponent(UITransform); ut.setContentSize(w * this.SCALE, h * this.SCALE); ut.setAnchorPoint(0.5, 0.5);
    const s = n.addComponent(Sprite); s.sizeMode = Sprite.SizeMode.CUSTOM; s.type = Sprite.Type.SIMPLE; s.spriteFrame = sf;
    this.ledgeNode = n;
  }
  private updateLedge() {
    if (!this.ledgeNode) return;
    const w = 192, h = w * this.ledgeAR, sf = 0.30;
    // demo: drawImage(img, LEDGE.L, ly - sf*h, w, h) → 图顶 world y = LEDGE_Y - sf*h
    const cx = this.LEDGE_L + w / 2, cy = this.LEDGE_Y - sf * h + h / 2;
    this.ledgeNode.setPosition(this.SX(cx), this.SY(cy), 0);
  }

  // ── 角色（第一章步战赵云）──
  private buildHero() {
    this.heroNode = new Node('c2-hero'); this.heroNode.layer = Layers.Enum.UI_2D; this.heroNode.parent = this.node;
    const ut = this.heroNode.addComponent(UITransform); ut.setContentSize(40, 44); ut.setAnchorPoint(0.5, 0);
    this.heroSp = this.heroNode.addComponent(Sprite); this.heroSp.sizeMode = Sprite.SizeMode.CUSTOM;
    AssetHub.loadSF('zhaoyun-foot', (base) => {
      if (!base) return; const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 48 + 4, this.HERO_ROW * 64 + 13, 40, 44); this.footFrames.push(sf); }
      if (!this.heroSp.spriteFrame) this.heroSp.spriteFrame = this.footFrames[0];
    });
    AssetHub.loadSF('zhaoyun-jump', (base) => {
      if (!base) return; const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 64, 0, 64, 56); this.jumpFrames.push(sf); }
    });
  }
  private readonly SPRITE_SCALE = 1.8;   // 与第一章一致：64px 帧放大倍数
  private updateHero() {
    const S = this.SPRITE_SCALE;
    const ut = this.heroNode.getComponent(UITransform)!;
    this.heroNode.setPosition(this.SX(this.px), this.SY(this.py), 0);
    this.heroNode.setScale(this.dir * S, S, 1);
    const inAir = !this.onG && !this.inWater;
    if (inAir && this.jumpFrames.length >= 3) {
      // 第一章跳跃帧：64×56、锚点(0.5,4/56)；上升伸展(1) / 下落屈腿(2)
      ut.setContentSize(64, 56); ut.setAnchorPoint(0.5, 4 / 56);
      this.heroSp.spriteFrame = this.jumpFrames[this.pvy < 0 ? 1 : 2];
    } else if (this.footFrames.length) {
      // 走路/待机/水里：40×44、锚点(0.5,0)
      ut.setContentSize(40, 44); ut.setAnchorPoint(0.5, 0);
      if (this.inWater) this.heroSp.spriteFrame = this.footFrames[0];
      else { const moving = this.keys.left || this.keys.right; this.heroSp.spriteFrame = this.footFrames[moving ? (Math.floor(this.walkPh) % 4) : 0]; }
    }
  }

  // ── 按钮（第一章摇杆 + 攻击/剑气）──
  private makeCircleBtn(x: number, y: number, r: number, base: [number, number, number], icon: (g: Graphics, r: number) => void): Node {
    const n = new Node('c2cbtn'); n.layer = Layers.Enum.UI_2D; n.parent = this.node;
    const ut = n.addComponent(UITransform); ut.setContentSize(r * 2 + 18, r * 2 + 18); ut.setAnchorPoint(0.5, 0.5);
    n.setPosition(x, y, 0);
    const g = n.addComponent(Graphics); const A = this.CTRL_ALPHA; const a = (v: number) => Math.round(v * A);
    g.fillColor = new Color(0, 0, 0, a(110)); g.circle(0, -4, r + 8); g.fill();
    g.fillColor = new Color(22, 18, 24, a(240)); g.circle(0, 0, r + 7); g.fill();
    g.fillColor = new Color(Math.round(base[0] * 0.55), Math.round(base[1] * 0.55), Math.round(base[2] * 0.55), a(255)); g.circle(0, 0, r); g.fill();
    g.fillColor = new Color(base[0], base[1], base[2], a(255)); g.ellipse(0, r * 0.12, r * 0.94, r * 0.86); g.fill();
    g.fillColor = new Color(255, 255, 255, a(34)); g.ellipse(0, r * 0.42, r * 0.74, r * 0.4); g.fill();
    g.strokeColor = new Color(255, 214, 130, a(210)); g.lineWidth = 3; g.circle(0, 0, r + 7); g.stroke();
    g.strokeColor = new Color(0, 0, 0, a(110)); g.lineWidth = 2; g.circle(0, 0, r + 1); g.stroke();
    icon(g, r);
    return n;
  }
  private tap(n: Node, cb: () => void) {
    n.on(Node.EventType.TOUCH_START, () => n.setScale(0.92, 0.92, 1), this);
    const up = () => tween(n).to(0.05, { scale: new Vec3(1.06, 1.06, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start();
    n.on(Node.EventType.TOUCH_END, () => { up(); cb(); }, this); n.on(Node.EventType.TOUCH_CANCEL, up, this);
  }
  private buildButtons() {
    const by = -H / 2 + 160; const A = this.CTRL_ALPHA; const ia = (v: number) => Math.round(v * A);
    this.setupJoystick(-236, by + 18);
    const atk = this.makeCircleBtn(268, by, 82, [152, 58, 52], (g, r) => {
      g.lineCap = Graphics.LineCap.ROUND;
      g.strokeColor = new Color(238, 243, 250, ia(250)); g.lineWidth = 9; g.moveTo(-r * 0.14, -r * 0.14); g.lineTo(r * 0.44, r * 0.44); g.stroke();
      g.strokeColor = new Color(255, 214, 120, ia(250)); g.lineWidth = 5; g.moveTo(-r * 0.02, -r * 0.32); g.lineTo(-r * 0.32, -r * 0.02); g.stroke();
      g.strokeColor = new Color(96, 62, 40, ia(255)); g.lineWidth = 7; g.moveTo(-r * 0.2, -r * 0.2); g.lineTo(-r * 0.42, -r * 0.42); g.stroke();
    });
    this.tap(atk, () => this.attack());
    const spc = this.makeCircleBtn(132, by + 52, 56, [54, 102, 138], (g, r) => {
      g.strokeColor = new Color(160, 238, 255, ia(255)); g.lineWidth = 6; g.circle(-r * 0.1, 0, r * 0.42); g.stroke();
      g.strokeColor = new Color(240, 252, 255, ia(255)); g.lineWidth = 3; g.circle(-r * 0.1, 0, r * 0.26); g.stroke();
    });
    this.tap(spc, () => { });
  }
  private setupJoystick(cx: number, cy: number) {
    const R = 96, KR = 50, DEAD = 18, HIT = 300; const A = this.CTRL_ALPHA; const a = (v: number) => Math.round(v * A);
    const base = new Node('c2-joybase'); base.layer = Layers.Enum.UI_2D; base.parent = this.node;
    const but = base.addComponent(UITransform); but.setContentSize(HIT, HIT); but.setAnchorPoint(0.5, 0.5); base.setPosition(cx, cy, 0);
    const bg = base.addComponent(Graphics);
    bg.fillColor = new Color(0, 0, 0, a(120)); bg.circle(0, -4, R + 8); bg.fill();
    bg.fillColor = new Color(22, 18, 24, a(255)); bg.circle(0, 0, R + 6); bg.fill();
    bg.fillColor = new Color(38, 40, 54, a(255)); bg.circle(0, 0, R); bg.fill();
    bg.fillColor = new Color(255, 255, 255, a(26)); bg.ellipse(0, R * 0.32, R * 0.8, R * 0.44); bg.fill();
    bg.strokeColor = new Color(255, 214, 130, a(210)); bg.lineWidth = 3; bg.circle(0, 0, R + 6); bg.stroke();
    bg.fillColor = new Color(240, 245, 252, a(150));
    for (const s of [-1, 1]) { bg.moveTo(s * (R - 20), 12); bg.lineTo(s * (R - 4), 0); bg.lineTo(s * (R - 20), -12); bg.close(); bg.fill(); }
    bg.fillColor = new Color(200, 246, 205, a(170)); bg.moveTo(-12, R - 20); bg.lineTo(0, R - 4); bg.lineTo(12, R - 20); bg.close(); bg.fill();
    const knobN = new Node('c2-joyknob'); knobN.layer = Layers.Enum.UI_2D; knobN.parent = base; knobN.addComponent(UITransform); knobN.setPosition(0, 0, 0);
    const kg = knobN.addComponent(Graphics);
    kg.fillColor = new Color(96, 116, 158, a(255)); kg.circle(0, 0, KR); kg.fill();
    kg.fillColor = new Color(140, 162, 205, a(255)); kg.ellipse(0, KR * 0.14, KR * 0.9, KR * 0.82); kg.fill();
    kg.strokeColor = new Color(255, 214, 130, a(200)); kg.lineWidth = 3; kg.circle(0, 0, KR); kg.stroke();
    const JUMP_UP = R * 0.55; let jumpArmed = true;
    const uiT = this.node.getComponent(UITransform)!;
    const move = (e: EventTouch) => {
      const loc = e.getUILocation(); const p = uiT.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
      let dx = p.x - cx, dy = p.y - cy; const mag = Math.hypot(dx, dy);
      if (mag > R) { dx = dx / mag * R; dy = dy / mag * R; }
      knobN.setPosition(dx, dy, 0); this.joyY = dy / R;
      if (dx < -DEAD) { this.keys.left = true; this.keys.right = false; }
      else if (dx > DEAD) { this.keys.right = true; this.keys.left = false; }
      else { this.keys.left = this.keys.right = false; }
      if (dy > JUMP_UP) { if (jumpArmed) { jumpArmed = false; this.jump(); } } else if (dy < JUMP_UP * 0.5) { jumpArmed = true; }
    };
    const reset = () => { this.keys.left = this.keys.right = false; this.joyY = 0; jumpArmed = true; tween(knobN).to(0.08, { position: new Vec3(0, 0, 0) }, { easing: 'quadOut' }).start(); };
    base.on(Node.EventType.TOUCH_START, move, this); base.on(Node.EventType.TOUCH_MOVE, move, this);
    base.on(Node.EventType.TOUCH_END, reset, this); base.on(Node.EventType.TOUCH_CANCEL, reset, this);
  }

  // ── 输入动作 ──
  private onKeyDown(e: EventKeyboard) {
    switch (e.keyCode) {
      case KeyCode.KEY_A: case KeyCode.ARROW_LEFT: this.keys.left = true; break;
      case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT: this.keys.right = true; break;
      case KeyCode.SPACE: case KeyCode.KEY_W: case KeyCode.ARROW_UP: this.keys.up = true; this.jump(); break;
      case KeyCode.KEY_S: case KeyCode.ARROW_DOWN: this.keys.down = true; break;
      case KeyCode.KEY_J: case KeyCode.KEY_K: this.attack(); break;
    }
  }
  private onKeyUp(e: EventKeyboard) {
    switch (e.keyCode) {
      case KeyCode.KEY_A: case KeyCode.ARROW_LEFT: this.keys.left = false; break;
      case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT: this.keys.right = false; break;
      case KeyCode.SPACE: case KeyCode.KEY_W: case KeyCode.ARROW_UP: this.keys.up = false; break;
      case KeyCode.KEY_S: case KeyCode.ARROW_DOWN: this.keys.down = false; break;
    }
  }
  private jump() {
    if (this.onG) { this.pvy = -470; this.onG = false; }
    else if (this.inWater) { this.pvy = Math.min(this.pvy, -580); }
  }
  private attack() {
    if (!this.onG) return; this.dir = -1;
    if (!this.rockBroken && this.px < 110) {
      this.rockHP--; this.shake = 8;
      for (let i = 0; i < 9; i++) this.debris.push({ x: 38 + Math.random() * 26, y: this.LEDGE_Y - 14 - Math.random() * 72, vx: 40 + Math.random() * 150, vy: -60 - Math.random() * 170, life: 0.7, r: 2 + Math.random() * 3.2 });
      if (this.rockHP <= 0) this.rockBroken = true;
    }
  }
  private splash(x: number, y: number) {
    this.ripples.push({ x, y, r: 6, life: 1 }); this.ripples.push({ x, y, r: 2, life: 1.3 });
    for (let i = 0; i < 28; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, s = 90 + Math.random() * 230; this.bubbles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, r: 1.5 + Math.random() * 3, air: 1 }); }
  }
  private bub(x: number, y: number, n: number, spread: number) {
    for (let i = 0; i < n; i++) this.bubbles.push({ x: x + (Math.random() - 0.5) * spread, y, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 40, life: 1.6, r: 1 + Math.random() * 2.4 });
  }

  private reset() {
    this.px = this.DW / 2; this.py = -40; this.pvx = 0; this.pvy = 0;
    this.onG = false; this.inWater = false; this.dir = 1; this.ph = 0;
    this.camY = -140; this.joyY = 0; this.keys.up = this.keys.down = false;
    this.bubbles = []; this.silt = []; this.ripples = []; this.debris = [];
    this.rockHP = 5; this.rockBroken = false;
    for (let i = 0; i < 60; i++) this.silt.push({ x: Math.random() * this.DW, wy: this.SURFACE + Math.random() * this.DH * 3, ph: Math.random() * 6.28, sp: 0.2 + Math.random() * 0.5, r: 0.5 + Math.random() * 1.6 });
  }

  update(dt: number) {
    try { this.tick(dt); }
    catch (e: any) { if (this.depthLabel) this.depthLabel.string = 'ERR: ' + (e && e.message ? e.message : String(e)); }
  }
  private tick(dt: number) {
    dt = Math.min(dt, 0.05); this.t += dt; this.ph += dt * 6;
    const mvx = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    if (mvx) { this.dir = mvx; this.walkPh += dt * 10; }

    if (!this.inWater) {
      if (this.onG) {
        // 站在水面上方左台
        this.px += mvx * 185 * dt; this.py = this.LEDGE_Y;
        const wallX = this.rockBroken ? this.PASSAGE_X : this.WALL_X;
        if (this.px <= wallX) { if (this.rockBroken) { this.reset(); return; } else this.px = wallX; }
        if (this.px > this.LEDGE_R + 2) this.onG = false;         // 走出右缘 → 掉落
      } else {
        // 空中自由下落
        this.pvy += 1200 * dt; this.pvy = Math.min(this.pvy, 900); this.px += mvx * 150 * dt; this.py += this.pvy * dt;
        if (this.pvy > 0) {
          const pf = this.py - this.pvy * dt;
          if (pf <= this.LEDGE_Y && this.py >= this.LEDGE_Y && this.px >= this.LEDGE_L && this.px <= this.LEDGE_R) { this.py = this.LEDGE_Y; this.pvy = 0; this.onG = true; }
        }
        if (!this.onG && this.py >= this.SURFACE) { this.inWater = true; this.splash(this.px, this.SURFACE); this.pvy *= 0.4; }
      }
    } else {
      // 水下浮力阻尼潜行
      const mvy = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0) + (this.joyY > 0.25 ? -1 : this.joyY < -0.25 ? 1 : 0);
      this.pvy += 120 * dt; this.pvy += mvy * 760 * dt; this.pvx += mvx * 520 * dt;
      this.pvx -= this.pvx * 3.4 * dt; this.pvy -= this.pvy * 2.6 * dt;
      this.pvy = Math.max(-640, Math.min(340, this.pvy)); this.pvx = Math.max(-190, Math.min(190, this.pvx));
      this.px += this.pvx * dt; this.py += this.pvy * dt; this.px = Math.max(46, Math.min(this.DW - 46, this.px));
      if (this.py < this.SURFACE) {
        if (this.pvy < -300) { this.inWater = false; this.ripples.push({ x: this.px, y: this.SURFACE, r: 6, life: 0.8 }); }  // 用力上冲才跃出
        else { this.py = this.SURFACE; if (this.pvy < 0) this.pvy = 0; }   // 轻浮到水面 → 贴着漂，不反复进出
      }
      if ((mvx || mvy) && Math.random() < 0.4) this.bub(this.px - Math.sign(this.pvx || 1) * 6, this.py - 6, 1, 8);
      if (Math.random() < 0.02) this.bub(this.px, this.py, 1, 10);
    }

    // 相机
    const tgt = this.py - this.DH * 0.36; this.camY += (tgt - this.camY) * Math.min(1, dt * 5);
    if (this.camY < this.py - this.DH * 0.6) this.camY = this.py - this.DH * 0.6;

    // 环境水泡（自下升起）
    if (this.inWater && Math.random() < 0.5) this.bubbles.push({ x: Math.random() * this.DW, y: this.camY + this.DH + 10, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 36, life: 3, r: 1 + Math.random() * 2 });
    for (const b of this.bubbles) { b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; if (b.air) b.vy += 520 * dt; else { b.vy -= 6 * dt; b.x += Math.sin(this.t * 3 + b.y * 0.05) * 10 * dt; } }
    this.bubbles = this.bubbles.filter(b => b.life > 0);
    for (const r of this.ripples) { r.life -= dt * 1.4; r.r += 160 * dt; } this.ripples = this.ripples.filter(r => r.life > 0);
    for (const s of this.silt) { s.wy += s.sp * 10 * dt; s.ph += dt; }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 32);
    for (const d of this.debris) { d.life -= dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 700 * dt; } this.debris = this.debris.filter(d => d.life > 0);
    if (this.py >= this.GOAL) this.reset();

    this.updateWall(); this.updateMouth(); this.updateLedge(); this.updateHero(); this.redraw();
  }

  private waterCol(d: number): [number, number, number] {
    const t = Math.min(1, Math.max(0, d)), top = [70, 84, 60], bot = [12, 20, 15];
    return [Math.round(top[0] + (bot[0] - top[0]) * t), Math.round(top[1] + (bot[1] - top[1]) * t), Math.round(top[2] + (bot[2] - top[2]) * t)];
  }
  private readonly PILE = [[-8, -52, 24], [22, -46, 26], [52, -50, 22], [8, -84, 24], [40, -86, 24], [-4, -114, 20], [28, -118, 22], [56, -92, 18], [18, -116, 18]];
  private readonly RUBBLE = [[-8, -54, 16], [44, -50, 14], [20, -92, 15]];
  private readonly STPAL = [[138, 128, 114], [115, 106, 92], [92, 84, 72], [70, 63, 52], [51, 45, 36]];  // 暖灰褐石(与井壁同调)
  private hsh(a: number, b: number) { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return ((v % 1) + 1) % 1; }

  // demo bakePile 的像素石堆：4 世界单位一块，调色板明暗 + 边缘描暗 + 贴墙投影
  private drawPixelPile(g: Graphics, circles: number[][], dmg: number) {
    const S = this.SCALE, P = 4;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (const c of circles) { mnx = Math.min(mnx, c[0] - c[2]); mxx = Math.max(mxx, c[0] + c[2]); mny = Math.min(mny, c[1] - c[2]); mxy = Math.max(mxy, c[1] + c[2]); }
    const inLC = (x: number, y: number) => { for (const c of circles) { const dx = x - c[0], dy = y - c[1]; if (dx * dx + dy * dy <= c[2] * c[2]) return true; } return false; };
    const span = Math.max(1, mxy - mny), bw = P * S + 0.6;
    const cell = (wx: number, wy: number, col: number[], al: number) => { g.fillColor = new Color(col[0], col[1], col[2], al); g.rect(this.SX(wx) - bw / 2, this.SY(wy) - bw / 2, bw, bw); g.fill(); };
    // 投影层（贴墙凸出感）
    for (let py = mny; py < mxy; py += P) for (let px = mnx; px < mxx; px += P) { const cx = px + P / 2, cy = py + P / 2; if (inLC(cx, cy)) cell(cx + 7, this.LEDGE_Y + cy + 6, [12, 9, 5], 90); }
    // 像素主体
    for (let py = mny; py < mxy; py += P) for (let px = mnx; px < mxx; px += P) {
      const cx = px + P / 2, cy = py + P / 2; if (!inLC(cx, cy)) continue;
      const edge = !inLC(cx - P, cy) || !inLC(cx + P, cy) || !inLC(cx, cy - P) || !inLC(cx, cy + P);
      const ny = (py - mny) / span;
      const sh = 0.55 - ny * 0.28 + (this.hsh(Math.floor(px / P), Math.floor(py / P)) - 0.5) * 0.55;
      let idx = sh > 0.64 ? 0 : sh > 0.46 ? 1 : sh > 0.28 ? 2 : 3; if (edge) idx = Math.min(4, idx + 1);
      cell(cx, this.LEDGE_Y + cy, this.STPAL[idx], 255);
    }
    // 裂痕（受损）
    for (let i = 0; i < dmg; i++) { const bx = 22 + i * 9; let d = 0; for (let Y = -14; Y > -64; Y -= 4) { cell(bx + d * 0.12, this.LEDGE_Y + Y, [28, 21, 12], 255); d += 4; } }
  }

  private redraw() {
    const g = this.g; g.clear();
    const S = this.SCALE;

    // 台上石堆 / 破洞（石台本体用图片，见 decorRoot；石堆叠在其上）
    const lsy = this.SY(this.LEDGE_Y);
    if (lsy > -H / 2 - 200 && lsy < H / 2 + 200) {
      if (!this.rockBroken) {
        this.drawPixelPile(g, this.PILE, 5 - this.rockHP);   // demo 像素石堆
      } else {
        // 破洞 + 残渣
        g.fillColor = new Color(6, 9, 6, 255); g.ellipse(this.SX(26), this.SY(this.LEDGE_Y - 32), 42 * S, 40 * S); g.fill();
        this.drawPixelPile(g, this.RUBBLE, 0);
      }
    }

    // 水体：透过浑水看见井壁（分带模拟渐变，越深越浑）
    //  潜深后水面在屏上方 → yTop 夹到 H/2，整屏填水（否则水会消失）
    const surfSy = this.SY(this.SURFACE);
    const yTop = Math.min(H / 2, surfSy);
    if (yTop > -H / 2) {
      const bands = 22, span = (yTop - (-H / 2)) / bands;
      for (let i = 0; i < bands; i++) {
        const cyTop = yTop - i * span, cyBot = cyTop - span, cyMid = (cyTop + cyBot) / 2;
        const worldY = this.camY + this.DH / 2 - cyMid / S;
        const d = (worldY - this.SURFACE) / this.GOAL;
        const col = this.waterCol(d); const al = Math.round((0.68 + (0.95 - 0.68) * Math.min(1, Math.max(0, d))) * 255);
        g.fillColor = new Color(col[0], col[1], col[2], al);
        g.rect(-W / 2, cyBot, W, span + 1); g.fill();
      }
      // 悬浮浊物
      for (const s of this.silt) {
        const sy = this.SY(s.wy); if (sy > surfSy || sy > H / 2 + 4 || sy < -H / 2 - 4) continue;
        const al = Math.round((0.15 + 0.2 * (0.5 + 0.5 * Math.sin(this.t * s.sp + s.ph))) * 255);
        g.fillColor = new Color(180, 190, 150, al);
        g.circle(this.SX(s.x + Math.sin(this.t * s.sp + s.ph) * 10), sy, Math.max(1, s.r * S)); g.fill();
      }
    }
    // 波动水面（demo 原版：细波纹亮线）
    if (surfSy > -H / 2 - 6 && surfSy < H / 2 + 6) {
      g.strokeColor = new Color(190, 210, 160, 160); g.lineWidth = 2.5;
      for (let x = -W / 2; x <= W / 2; x += 18) {
        const yy = surfSy - Math.sin((x + W / 2) * 0.05 + this.t * 2) * 4;
        if (x === -W / 2) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }

    // 溅起涟漪
    for (const r of this.ripples) {
      const ry = this.SY(r.y);
      g.strokeColor = new Color(210, 225, 180, Math.round(Math.max(0, r.life * 0.5) * 255)); g.lineWidth = 2;
      g.ellipse(this.SX(r.x), ry, r.r * S, r.r * 0.3 * S); g.stroke();
    }

    // 气泡
    for (const b of this.bubbles) {
      const by = this.SY(b.y); if (by < -H / 2 - 10 || by > H / 2 + 10) continue;
      g.fillColor = b.air ? new Color(220, 230, 200, Math.round(Math.min(1, b.life * 1.6) * 205)) : new Color(200, 220, 190, Math.round(Math.min(1, b.life * 0.7) * 140));
      g.circle(this.SX(b.x), by, Math.max(1, b.r * S)); g.fill();
    }
    // 碎石
    for (const d of this.debris) {
      const dy = this.SY(d.y);
      g.fillColor = new Color(74, 61, 42, Math.round(Math.max(0, Math.min(1, d.life * 1.6)) * 255));
      g.circle(this.SX(d.x), dy, Math.max(1, d.r * S)); g.fill();
    }

    // 角色兜底标记
    if (!this.footFrames.length) {
      g.fillColor = new Color(240, 220, 120, 255); g.circle(this.SX(this.px), this.SY(this.py) + 20, 16); g.fill();
    }

    const zone = !this.inWater ? '落下' : (this.py > this.GOAL * 0.7 ? '黄泉深处' : '浊水中');
    this.depthLabel.string = zone + '  ' + Math.max(0, Math.round(this.py / this.GOAL * 100)) + '%';
  }
}
