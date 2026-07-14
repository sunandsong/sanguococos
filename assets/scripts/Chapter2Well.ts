import {
  _decorator, Component, Node, Graphics, Label, Color, UITransform,
  input, Input, EventKeyboard, KeyCode, Layers, Sprite, SpriteFrame, Texture2D, Rect, Vec3, tween, EventTouch,
} from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { AssetHub } from './AssetHub';
import { HeroRig, HeroMode } from './HeroRig';
import { TouchControls } from './TouchControls';
import { HeroHUD } from './HeroHUD';

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

  // demo→Cocos 缩放（按宽度铺满井筒；demo 宽 460、高 760）
  private readonly SCALE = W / 460;
  private readonly DW = 460;        // demo 宽
  private readonly DH = 760;        // demo 高

  // 图层 / 真图
  private wallRoot!: Node; private decorRoot!: Node; private wallNodes: Node[] = []; private wallAR = 1.8;
  private mouthNode: Node | null = null; private mouthAR = 1.4;
  private ledgeNode: Node | null = null; private ledgeAR = 0.6;
  private hero!: HeroRig; private walkPh = 0;
  private controls!: TouchControls; private hud!: HeroHUD;
  private hp = 100; private coins = 0;   // 井下暂无战斗损耗,先接通 HUD 显示
  private atkTimer = 0; private atkDur = 0.42; private readonly ATK_DUR = 0.42;   // 一刀时长
  private atkType = 0; private comboT = 0; private readonly COMBO_WINDOW = 0.5;    // 三段连击
  private slamJump = false; private slamLandT = 0;   // 第3段跳劈:腾空中/落地收势(对齐第一章:蹲→跃起→下劈→落地冲击)
  private slamFxX = 0;   // 冲击点世界x(镜头动时把最新屏幕坐标喂给套件特效)
  private specialCd = 0; private readonly SPECIAL_CD = 1.0;                        // 剑气冷却
  private fxCre: SpriteFrame | null = null;                                         // 新月贴图（刀气/剑气）
  private fxLayer!: Node; private slashN: Node | null = null; private slashSp: Sprite | null = null;
  private wavePool: { n: Node; sp: Sprite }[] = [];
  private waves: { x: number; y: number; dir: number; life: number; max: number }[] = [];

  // 世界参数（缩短落差：落一下就见水见台；潜水段仍深）
  private readonly SURFACE = 900;
  private readonly GOAL = 3900;
  private readonly LEDGE_Y = 900 - 32 - 20;  // 848 · 角色站立脚线(台子整体下移30,跳得上去)
  private readonly LEDGE_BASE = 900 - 32;    // 868 · 台座/石堆/破洞的基准(贴图和石头不随脚线动)
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

    // 特效层（刀气/剑气新月/跳劈特效），排在角色之上
    this.fxLayer = new Node('c2-fx'); this.fxLayer.layer = Layers.Enum.UI_2D; this.fxLayer.parent = this.node; this.fxLayer.addComponent(UITransform);
    this.hero = new HeroRig(this.node, this.fxLayer);   // 角色套件(跳劈冲击波/闪电已内置在套件里)
    this.slashN = new Node('c2-slash'); this.slashN.layer = Layers.Enum.UI_2D; this.slashN.parent = this.fxLayer;
    this.slashN.addComponent(UITransform).setContentSize(128, 128);
    this.slashSp = this.slashN.addComponent(Sprite); this.slashSp.sizeMode = Sprite.SizeMode.CUSTOM; this.slashN.active = false;
    AssetHub.loadSF('fx-crescent', (sf) => { if (!sf) return; this.fxCre = sf; if (this.slashSp) this.slashSp.spriteFrame = sf; });

    const ln = new Node('c2-depth'); ln.layer = Layers.Enum.UI_2D; ln.parent = this.node;
    ln.addComponent(UITransform);
    this.depthLabel = ln.addComponent(Label);
    this.depthLabel.fontSize = 30; this.depthLabel.color = new Color(233, 201, 138);
    ln.setPosition(0, H / 2 - 60, 0);

    // 操作/HUD 套件(与第一章同款):摇杆+攻击/技能钮、顶部头像血条金币
    this.controls = new TouchControls(this.node, {
      onDir: (d) => { this.keys.left = d < 0; this.keys.right = d > 0; },
      onAxis: (_ax, ay) => { this.joyY = ay; },
      onJump: () => this.jump(),
      onAttack: () => this.attack(),
      onSpecial: () => this.heroSpecial(),
    }, { alpha: this.CTRL_ALPHA, jumpButton: true, upJump: false });   // 井下:独立跳跃键,摇杆上推只管游泳
    this.hud = new HeroHUD(this.node);
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
    // demo: drawImage(img, LEDGE.L, ly - sf*h, w, h) → 图顶 world y = 838 - sf*h(脚线上移了13,这里+13补偿,贴图不动)
    const cx = this.LEDGE_L + w / 2, cy = this.LEDGE_BASE - sf * h + h / 2;
    this.ledgeNode.setPosition(this.SX(cx), this.SY(cy), 0);
  }

  // ── 角色（第一章步战赵云套件 HeroRig）──
  private updateHero() {
    // 选姿势：攻击 > 空中 > 走 > 待机；水里保持待机直立
    let mode: HeroMode; let p = 0; let tilt = 0;
    if (this.slamJump) { mode = 'slam'; p = this.pvy < 0 ? 0.1 : 0.5; }        // 腾空跳劈:上升举枪 / 下落俯冲
    else if (this.slamLandT > 0) { mode = 'slam'; p = 0.95; }                  // 落地砸击收势帧
    else if (this.atkTimer > 0) { mode = this.atkType === 2 ? 'slam' : 'attack'; p = 1 - this.atkTimer / this.atkDur; }
    else if (!this.onG && !this.inWater) mode = 'air';
    else if (this.inWater) {
      // 水性三态:到水面一律踩水(只露头肩);水下有横向分量=横游(斜游身体倾斜);纯竖直=竖游
      const movingH = Math.abs(this.pvx) > 30;
      if (this.py <= this.SURFACE + 30) mode = 'float';   // 提前量:快到水面就先摆出踩水姿势,升到水线正好衔接
      else if (movingH) {
        mode = 'swimH';
        tilt = Math.max(-55, Math.min(55, Math.atan2(-this.pvy, Math.abs(this.pvx)) * 57.29578));   // 抬头角(度)
      } else mode = 'swim';
    }
    else if (this.keys.left || this.keys.right) mode = 'walk';
    else mode = 'idle';
    this.hero.apply(this.SX(this.px), this.SY(this.py), this.dir, mode, p, this.pvy, this.walkPh, tilt);
  }

  // ── 按钮（第一章摇杆 + 攻击/剑气）──

  // ── 输入动作 ──
  private onKeyDown(e: EventKeyboard) {
    switch (e.keyCode) {
      case KeyCode.KEY_A: case KeyCode.ARROW_LEFT: this.keys.left = true; break;
      case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT: this.keys.right = true; break;
      case KeyCode.KEY_W: case KeyCode.ARROW_UP: this.keys.up = true; break;   // 上=游泳/无跳跃
      case KeyCode.SPACE: this.jump(); break;                                  // 空格=专职跳跃(水中=出水鱼跃)
      case KeyCode.KEY_S: case KeyCode.ARROW_DOWN: this.keys.down = true; break;
      case KeyCode.KEY_J: this.attack(); break;
      case KeyCode.KEY_K: case KeyCode.KEY_L: this.heroSpecial(); break;
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
    if (this.slamJump) return;                                          // 跳劈腾空中不可出招
    if (this.atkTimer > this.atkDur * 0.45) return;                     // 挥到后半段才能接下一刀（连点更顺）
    this.atkType = this.comboT > 0 ? (this.atkType + 1) % 3 : 0;        // 连招窗口内 → 下一段
    const dur = this.atkType === 2 ? this.ATK_DUR * 1.5 : this.ATK_DUR; // 跳劈稍长
    this.atkTimer = dur; this.atkDur = dur; this.comboT = dur + this.COMBO_WINDOW;
    this.hero.sndSwing(this.atkType);   // 起手音效(套件自带,与第一章一致)
    // 第 3 段跳劈：地面上真的跃起，冲击在落地时结算（水中/空中退化为原地挥）
    if (this.atkType === 2 && this.onG) { this.pvy = -430; this.onG = false; this.slamJump = true; }
    // 在石台上、面朝石堆范围内 → 砸石开洞
    if (this.onG && !this.rockBroken && this.px < 110) {
      this.dir = -1;                          // 面朝石堆
      this.rockHP--; this.shake = 8;
      for (let i = 0; i < 9; i++) this.debris.push({ x: 38 + Math.random() * 26, y: this.LEDGE_BASE - 14 - Math.random() * 72, vx: 40 + Math.random() * 150, vy: -60 - Math.random() * 170, life: 0.7, r: 2 + Math.random() * 3.2 });
      if (this.rockHP <= 0) this.rockBroken = true;
    }
  }
  // 跳劈落地冲击：震屏 + 两侧碎屑;砸在石堆附近 → 双倍碎石(跳劈开洞更快)
  private slamImpact() {
    this.slamJump = false; this.slamLandT = 0.22; this.shake = 11;
    this.slamFxX = this.px;
    this.hero.slamImpactFx(this.SX(this.px), this.SY(this.LEDGE_Y), H / 2);   // 套件特效:冲击波+闪电
    for (let i = 0; i < 14; i++) {
      const d = i % 2 ? 1 : -1;
      this.debris.push({ x: this.px + d * (6 + Math.random() * 40), y: this.LEDGE_Y - 2, vx: d * (50 + Math.random() * 160), vy: -40 - Math.random() * 190, life: 0.6, r: 1.5 + Math.random() * 2.6 });
    }
    if (!this.rockBroken && this.px < 140) {
      this.rockHP -= 2; this.shake = 13;
      for (let i = 0; i < 12; i++) this.debris.push({ x: 38 + Math.random() * 26, y: this.LEDGE_BASE - 14 - Math.random() * 72, vx: 40 + Math.random() * 150, vy: -60 - Math.random() * 170, life: 0.7, r: 2 + Math.random() * 3.2 });
      if (this.rockHP <= 0) this.rockBroken = true;
    }
  }

  private heroSpecial() {
    if (this.specialCd > 0) return;
    this.specialCd = this.SPECIAL_CD;
    const dir = this.dir;
    this.waves.push({ x: this.px + dir * 20, y: this.py - 30, dir, life: 0, max: 1.25 });   // 剑气波
    if (this.atkTimer <= 0) { this.atkType = 0; this.atkDur = this.ATK_DUR; this.atkTimer = this.ATK_DUR; }  // 顺带摆挥砍姿势
  }
  private waveFx(i: number): { n: Node; sp: Sprite } | null {
    if (this.wavePool[i]) return this.wavePool[i];
    if (!this.fxCre || i >= 4) return null;
    const n = new Node('c2-wave' + i); n.layer = Layers.Enum.UI_2D; n.parent = this.fxLayer;
    n.addComponent(UITransform).setContentSize(128, 128);
    const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = this.fxCre;
    const rec = { n, sp }; this.wavePool.push(rec); return rec;
  }
  private updateFx(dt: number) {
    if (this.specialCd > 0) this.specialCd -= dt;
    if (this.comboT > 0) this.comboT -= dt;
    // 挥砍刀气弧（新月随挥砍进度旋转 + 中段最亮）
    let slashOn = false;
    if (this.atkTimer > 0 && this.slashN && this.slashSp && this.slashSp.spriteFrame) {
      const s = 1 - this.atkTimer / this.atkDur, a = 1 - Math.abs(s - 0.4) / 0.6;
      if (a > 0.05) {
        const cx = this.SX(this.px) + this.dir * 34, cy = this.SY(this.py) + 74;
        const c0 = this.dir > 0 ? 0 : Math.PI;
        const vert = this.atkType === 1 ? 0.9 - 1.9 * s : this.atkType === 2 ? 0.15 + 0.5 * s : -0.9 + 1.9 * s;
        this.slashN.active = true;
        this.slashN.setPosition(cx, cy, 0);
        this.slashN.angle = (c0 - this.dir * vert) * 57.29578;
        this.slashN.setScale(1.7, 1.7, 1);
        this.slashSp.color = new Color(255, 245, 210, Math.round(230 * a));
        slashOn = true;
      }
    }
    if (!slashOn && this.slashN && this.slashN.active) this.slashN.active = false;
    // 剑气波：飞行 + 淡出
    const speed = 600;
    for (let i = this.waves.length - 1; i >= 0; i--) { const w = this.waves[i]; w.life += dt; w.x += w.dir * speed * dt; if (w.life >= w.max) this.waves.splice(i, 1); }
    let wi = 0;
    for (const w of this.waves) {
      const fx = this.waveFx(wi); if (!fx) break; wi++;
      const a = Math.max(0, 1 - w.life / w.max);
      fx.n.active = true; fx.n.setPosition(this.SX(w.x), this.SY(w.y), 0);
      fx.n.angle = w.dir > 0 ? 0 : 180; fx.n.setScale(0.95, 0.95, 1);
      fx.sp.color = new Color(150, 235, 255, Math.round(240 * a));   // 青白剑气
    }
    for (; wi < this.wavePool.length; wi++) this.wavePool[wi].n.active = false;
    // 跳劈落地特效(冲击波+闪电)在角色套件里推进;镜头会动,把冲击点最新屏幕坐标喂进去
    this.hero.updateFx(dt, this.SX(this.slamFxX), this.SY(this.LEDGE_Y));
    // HUD/技能冷却(套件内部有脏标记,平时零开销)
    this.hud.set(this.hp, 100, this.hp, this.coins);
    this.controls.setSpecialCd(this.specialCd / this.SPECIAL_CD);
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
    this.atkTimer = 0; this.atkType = 0; this.comboT = 0; this.specialCd = 0; this.waves = [];
    this.slamJump = false; this.slamLandT = 0;
    for (let i = 0; i < 60; i++) this.silt.push({ x: Math.random() * this.DW, wy: this.SURFACE + Math.random() * this.DH * 3, ph: Math.random() * 6.28, sp: 0.2 + Math.random() * 0.5, r: 0.5 + Math.random() * 1.6 });
  }

  update(dt: number) {
    try { this.tick(dt); }
    catch (e: any) { if (this.depthLabel) this.depthLabel.string = 'ERR: ' + (e && e.message ? e.message : String(e)); }
  }
  private tick(dt: number) {
    dt = Math.min(dt, 0.05); this.t += dt; this.ph += dt * 6;
    if (this.atkTimer > 0) this.atkTimer -= dt;
    if (this.slamLandT > 0) this.slamLandT -= dt;
    const mvx = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    if (mvx) { this.dir = mvx; if (!this.inWater) this.walkPh += dt * 10; }   // 走路相位只在陆上推进(水里由蹬水节奏管)

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
          if (pf <= this.LEDGE_Y && this.py >= this.LEDGE_Y && this.px >= this.LEDGE_L && this.px <= this.LEDGE_R) {
            this.py = this.LEDGE_Y; this.pvy = 0; this.onG = true;
            if (this.slamJump) this.slamImpact();   // 跳劈落地冲击
          }
        }
        if (!this.onG && this.py >= this.SURFACE) { this.inWater = true; this.splash(this.px, this.SURFACE); this.pvy *= 0.4; this.slamJump = false; this.slamLandT = 0; }   // 劈进水里=大水花,冲击取消
      }
    } else {
      // 水下浮力阻尼潜行
      let mvy = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0) + (this.joyY > 0.25 ? -1 : this.joyY < -0.25 ? 1 : 0);
      if (this.py <= this.SURFACE + 4 && mvy < 0) mvy = 0;   // 身体到水面就踩水,不能再往上游(出水只靠跳跃鱼跃)
      this.pvy += 120 * dt; this.pvy += mvy * 330 * dt; this.pvx += mvx * 240 * dt;
      this.pvx -= this.pvx * 3.4 * dt; this.pvy -= this.pvy * 2.6 * dt;
      this.pvy = Math.max(-350, Math.min(200, this.pvy)); this.pvx = Math.max(-100, Math.min(100, this.pvx));
      this.px += this.pvx * dt; this.py += this.pvy * dt; this.px = Math.max(46, Math.min(this.DW - 46, this.px));
      if (this.py < this.SURFACE) {
        if (this.pvy < -300) { this.inWater = false; this.pvy = Math.min(this.pvy, -540); this.ripples.push({ x: this.px, y: this.SURFACE, r: 6, life: 0.8 }); }  // 用力上冲才跃出;出水鱼跃补偿(水中限速不吃掉跳跃冲量)
        else { this.py = this.SURFACE; if (this.pvy < 0) this.pvy = 0; }   // 轻浮到水面 → 贴着漂，不反复进出
      }
      // 蹬水节奏:水面踩水固定慢拍;水下游动才划水,松手把这一循环划完,定格收腿静漂
      if (this.py <= this.SURFACE + 30) this.walkPh += dt * 1.8;   // 踩水:双臂开合约0.55秒一换
      else if (mvx || mvy) this.walkPh += dt * 4.2;
      else if (this.walkPh % 3 > 0.08) this.walkPh += dt * 4.2;
      else this.walkPh = 0;
      // 身上冒泡只在潜水时(水面踩水头已出水,不冒)
      if (this.py > this.SURFACE + 30) {
        if ((mvx || mvy) && Math.random() < 0.4) this.bub(this.px - Math.sign(this.pvx || 1) * 6, this.py - 6, 1, 8);
        if (Math.random() < 0.02) this.bub(this.px, this.py, 1, 10);
      }
    }

    // 相机
    const tgt = this.py - this.DH * 0.36; this.camY += (tgt - this.camY) * Math.min(1, dt * 5);
    if (this.camY < this.py - this.DH * 0.6) this.camY = this.py - this.DH * 0.6;

    // 环境水泡（自下升起）
    if (this.inWater && Math.random() < 0.5) this.bubbles.push({ x: Math.random() * this.DW, y: this.camY + this.DH + 10, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 36, life: 3, r: 1 + Math.random() * 2 });
    for (const b of this.bubbles) {
      b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.air) b.vy += 520 * dt;
      else {
        b.vy -= 6 * dt; b.x += Math.sin(this.t * 3 + b.y * 0.05) * 10 * dt;
        if (b.y <= this.SURFACE + 1) b.life = 0;   // 水下气泡升到水面即破,不会飘到空气里
      }
    }
    this.bubbles = this.bubbles.filter(b => b.life > 0);
    for (const r of this.ripples) { r.life -= dt * 1.4; r.r += 160 * dt; } this.ripples = this.ripples.filter(r => r.life > 0);
    for (const s of this.silt) { s.wy += s.sp * 10 * dt; s.ph += dt; }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 32);
    for (const d of this.debris) { d.life -= dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 700 * dt; } this.debris = this.debris.filter(d => d.life > 0);
    if (this.py >= this.GOAL) this.reset();

    this.updateFx(dt);
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
    for (let py = mny; py < mxy; py += P) for (let px = mnx; px < mxx; px += P) { const cx = px + P / 2, cy = py + P / 2; if (inLC(cx, cy)) cell(cx + 7, this.LEDGE_BASE + cy + 6, [12, 9, 5], 90); }
    // 像素主体
    for (let py = mny; py < mxy; py += P) for (let px = mnx; px < mxx; px += P) {
      const cx = px + P / 2, cy = py + P / 2; if (!inLC(cx, cy)) continue;
      const edge = !inLC(cx - P, cy) || !inLC(cx + P, cy) || !inLC(cx, cy - P) || !inLC(cx, cy + P);
      const ny = (py - mny) / span;
      const sh = 0.55 - ny * 0.28 + (this.hsh(Math.floor(px / P), Math.floor(py / P)) - 0.5) * 0.55;
      let idx = sh > 0.64 ? 0 : sh > 0.46 ? 1 : sh > 0.28 ? 2 : 3; if (edge) idx = Math.min(4, idx + 1);
      cell(cx, this.LEDGE_BASE + cy, this.STPAL[idx], 255);
    }
    // 裂痕（受损）
    for (let i = 0; i < dmg; i++) { const bx = 22 + i * 9; let d = 0; for (let Y = -14; Y > -64; Y -= 4) { cell(bx + d * 0.12, this.LEDGE_BASE + Y, [28, 21, 12], 255); d += 4; } }
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
        g.fillColor = new Color(6, 9, 6, 255); g.ellipse(this.SX(26), this.SY(this.LEDGE_BASE - 32), 42 * S, 40 * S); g.fill();
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

    // 角色兜底标记（套件未就绪时）
    if (!this.hero || !this.hero.ready) {
      g.fillColor = new Color(240, 220, 120, 255); g.circle(this.SX(this.px), this.SY(this.py) + 20, 16); g.fill();
    }

    const zone = !this.inWater ? '落下' : (this.py > this.GOAL * 0.7 ? '黄泉深处' : '浊水中');
    this.depthLabel.string = zone + '  ' + Math.max(0, Math.round(this.py / this.GOAL * 100)) + '%';
  }
}
