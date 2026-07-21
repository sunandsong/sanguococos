import {
  _decorator, Component, Node, Graphics, Label, Color, UITransform,
  input, Input, EventKeyboard, KeyCode, Layers, Sprite, SpriteFrame, Texture2D, Rect, Vec3, tween, EventTouch, UIOpacity,
} from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { AssetHub } from './AssetHub';
import { HeroRig, HeroMode } from './HeroRig';
import { TouchControls } from './TouchControls';
import { HeroHUD } from './HeroHUD';
import { DeathFx } from './DeathFx';
import { AudioMgr } from './AudioMgr';
import { HeroCombat } from './HeroCombat';
import { Breath } from './Breath';
import { JUMP, tryJump } from './JumpKit';
import { CamZoom } from './CamZoom';
import { Chapter2Cave } from './Chapter2Cave';

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
  private world!: Node; private cam!: CamZoom;   // 世界容器+跳跃镜头套件(腾空/坠落拉远)
  private wallRoot!: Node; private decorRoot!: Node; private wallNodes: Node[] = []; private wallAR = 1.8;
  private mouthNode: Node | null = null; private mouthAR = 1.4;
  private ledgeNode: Node | null = null; private ledgeAR = 0.6;
  private hero!: HeroRig; private walkPh = 0;
  private controls!: TouchControls; private hud!: HeroHUD;
  private hp = 100; private coins = 0;
  private breath = new Breath({ sec: 10, recover: 2.5, drownDps: 8 });   // 共用憋气/溺水套件
  private deathFx!: DeathFx;                // 阵亡演出套件(每章复用)
  private over = false; private deadT = 0;  // 阵亡状态/演出计时
  private exiting = false;                  // 进洞转场中(防重复触发)
  static returnFromCave = false;            // 洞穴回井:下次 onLoad 按「从洞里回来」出生(洞已开、站洞口台上)
  private slamJump = false; private slamLandT = 0;   // 第3段跳劈:腾空中/落地收势(对齐第一章:蹲→跃起→下劈→落地冲击)
  private slideT = 0; private slideCd = 0; private slideDir = 1;   // 滑铲(台上,与第一章同参 0.35/0.55)
  private jumpsUsed = 0;   // 连跳计数(落地/入水清零,全章共用 JumpKit)
  private slamFxX = 0;   // 冲击点世界x(镜头动时把最新屏幕坐标喂给套件特效)
  private fxLayer!: Node;
  private combat!: HeroCombat;   // 共用战斗套件(连招+刀气+剑气)

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
  private hitStop = 0;    // 顿帧(打击感灵魂):命中瞬间全场定格几帧
  private flashT = 0;     // 石堆受击白闪剩余
  private sparks: P[] = [];   // 击石火花(亮黄白,短命)

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    // 世界容器(井壁/装饰/水体/角色/特效进来;label/按钮/HUD/死亡演出在外)
    this.world = new Node('c2-world'); this.world.layer = Layers.Enum.UI_2D; this.world.parent = this.node; this.world.addComponent(UITransform);
    this.cam = new CamZoom(this.world);
    this.wallRoot = new Node('c2-wall'); this.wallRoot.layer = Layers.Enum.UI_2D; this.wallRoot.parent = this.world;
    this.wallRoot.addComponent(UITransform);
    // 井口/井台放独立容器：固定排在井壁之上、水之下（避免异步加载顺序把它们埋进井壁）
    this.decorRoot = new Node('c2-decor'); this.decorRoot.layer = Layers.Enum.UI_2D; this.decorRoot.parent = this.world;
    this.decorRoot.addComponent(UITransform);
    AssetHub.loadSF('c2-wall', (sf) => { if (sf) this.buildWall(sf); });
    AssetHub.loadSF('c2-mouth', (sf) => { if (sf) this.buildMouth(sf); });
    AssetHub.loadSF('c2-plat-ledge', (sf) => { if (sf) this.buildLedge(sf); });

    const gn = new Node('c2-gfx'); gn.layer = Layers.Enum.UI_2D; gn.parent = this.world;
    gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);

    // 特效层（跳劈冲击波/刀气/剑气），排在角色之上
    this.fxLayer = new Node('c2-fx'); this.fxLayer.layer = Layers.Enum.UI_2D; this.fxLayer.parent = this.world; this.fxLayer.addComponent(UITransform);
    this.hero = new HeroRig(this.world, this.fxLayer);   // 角色套件(跳劈冲击波/闪电已内置)
    this.hero.jumpRefVy = JUMP.VY / this.SCALE;         // 井关喂给套件的是 demo 坐标速度,拉伸归一化同步换算
    this.hero.ambient = new Color(228, 240, 242, 255);  // 井下湿冷青环境光(压贴纸感)
    this.combat = new HeroCombat(this.fxLayer, this.hero);   // 共用战斗套件(连招+刀气+剑气)

    const ln = new Node('c2-depth'); ln.layer = Layers.Enum.UI_2D; ln.parent = this.node;
    ln.addComponent(UITransform);
    this.depthLabel = ln.addComponent(Label);
    this.depthLabel.fontSize = 30; this.depthLabel.color = new Color(233, 201, 138);
    ln.setPosition(0, H / 2 - 60, 0);
    ln.active = false;   // 顶部深度黄字已隐藏(报错时 update 的 catch 会重新打开兜底显示)

    CamZoom.edgeFog(this.node, new Color(8, 7, 10, 255), 130);   // 井下:暗色边框兜住拉远后的四缘
    // 操作/HUD 套件(与第一章同款):摇杆+攻击/技能钮、顶部头像血条金币
    this.controls = new TouchControls(this.node, {
      onDir: (d) => { this.keys.left = d < 0; this.keys.right = d > 0; },
      onAxis: (_ax, ay) => { this.joyY = ay; },
      onJump: () => this.jump(),
      onDash: (d) => { this.dir = d as 1 | -1; this.heroSlide(); },   // 双击方向=滑铲(全章统一)
      onAttack: () => this.attack(),
      onSlide: () => this.heroSlide(),   // 滑铲键(气波招数已下架)
    }, { alpha: this.CTRL_ALPHA });   // 布局全局统一(套件内定死):摇杆+跳跃键+攻击+技能;摇杆上推=游泳
    this.hud = new HeroHUD(this.node);
    // 阵亡演出(灰罩+「阵 亡」+「重来」),点重来复活重开
    this.deathFx = new DeathFx(this.node, () => {
      this.deathFx.hide();
      this.over = false; this.deadT = 0; this.hp = 100; this.breath.reset();
      this.reset();
    });
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    this.reset();
    if (Chapter2Well.returnFromCave) {
      // 从洞穴走回来:不再从天上掉,洞保持已破,人站在洞口台上朝右,镜头直接就位
      Chapter2Well.returnFromCave = false;
      this.rockBroken = true; this.rockHP = 0;
      this.px = this.PASSAGE_X + 44; this.py = this.LEDGE_Y;
      this.pvx = 0; this.pvy = 0; this.onG = true; this.inWater = false; this.dir = 1;
      this.camY = this.py - this.DH * 0.36;
    }
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
    const ca = this.combat.anim();
    if (this.slamJump) { mode = 'slam'; p = this.pvy < 0 ? 0.1 : 0.5; }        // 腾空跳劈:上升举枪 / 下落俯冲
    else if (this.slamLandT > 0) { mode = 'slam'; p = 0.95; }                  // 落地砸击收势帧
    else if (ca) { mode = ca.mode; p = ca.p; }                                 // 挥砍/跳劈(共用套件)
    else if (this.slideT > 0) { mode = 'slide'; p = 1 - this.slideT / 0.5; }   // 滑铲三帧
    else if (!this.onG && !this.inWater) mode = 'air';
    else if (this.inWater) {
      // 水性姿势:到水面=踩水(只露头肩);主动下潜=头朝下俯冲(横游帧旋转);有横向分量=横游(斜游倾斜);其余=竖游
      const movingH = Math.abs(this.pvx) > 30;
      if (this.py <= this.SURFACE + 30) mode = 'float';   // 提前量:快到水面就先摆出踩水姿势,升到水线正好衔接
      else if (this.pvy > 70) {
        mode = 'swimH';   // 下潜:头顺着运动方向朝下(直下-90°,斜下按角度;缓慢下沉不算,仍竖游静漂)
        tilt = Math.max(-90, Math.min(-30, Math.atan2(-this.pvy, Math.abs(this.pvx)) * 57.29578));
      } else if (movingH) {
        mode = 'swimH';
        tilt = Math.max(-55, Math.min(55, Math.atan2(-this.pvy, Math.abs(this.pvx)) * 57.29578));   // 抬头角(度)
      } else mode = 'swim';
    }
    else if (this.keys.left || this.keys.right) mode = 'walk';
    else mode = 'idle';
    // 影子:在石台上空(非水中)才有,传台面屏幕 y 给套件(腾空自动缩小)
    const overLedge = !this.inWater && this.px >= this.LEDGE_L - 4 && this.px <= this.LEDGE_R + 4 && this.py <= this.LEDGE_Y + 2;
    if (this.over) {   // 阵亡:套件的倒地/灰化/溶解演出
      this.hero.apply(this.SX(this.px), this.SY(this.py), this.dir, 'dead', this.deadT, this.pvy, 0, 0,
        overLedge ? this.SY(this.LEDGE_Y) : undefined);
      return;
    }
    this.hero.apply(this.SX(this.px), this.SY(this.py), this.dir, mode, p, this.pvy, this.walkPh, tilt,
      overLedge ? this.SY(this.LEDGE_Y) : undefined);
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
      case KeyCode.KEY_K: case KeyCode.KEY_L: this.heroSlide(); break;   // K/L=滑铲
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
    if (this.over) return;
    if (this.inWater) {   // 只有在水面(踩水区)才能鱼跃;深水按跳无效
      if (this.py <= this.SURFACE + 30) this.pvy = Math.min(this.pvy, -580);
      return;
    }
    const j = tryJump(this.onG, this.jumpsUsed);   // 连跳判定全章共用 JumpKit(井关 demo 坐标÷SCALE)
    if (!j) return;
    this.pvy = -j.vy / this.SCALE; this.onG = false; this.jumpsUsed = j.used;
  }
  private attack() {
    if (this.over) return;
    if (this.inWater) return;                                           // 水下不能攻击
    if (this.slamJump) return;                                          // 跳劈腾空中不可出招
    const type = this.combat.tryAttack();                               // 共用套件:连招+起手音效
    if (type < 0) return;                                               // 还在挥、不能接
    // 第 3 段跳劈：地面上真的跃起，冲击在落地时结算（水中/空中退化为原地挥）
    if (type === 2 && this.onG) { this.pvy = -JUMP.SLAM_VY / this.SCALE; this.onG = false; this.slamJump = true; }   // 跳劈起跳,全章共用 JumpKit
    // 在石台上、面朝石堆范围内 → 砸石开洞(顿帧+白闪+火花+音效,打击感三板斧)
    if (this.onG && !this.rockBroken && this.px < 110) {
      this.dir = -1;                          // 面朝石堆
      this.rockHP--;
      this.rockHit(1);
      if (this.rockHP <= 0) this.rockBreak();
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
      this.rockHP -= 2;
      this.rockHit(1.6);   // 跳劈砸石:更狠的顿帧/白闪/火花
      if (this.rockHP <= 0) this.rockBreak();
    }
  }

  // 击石反馈:顿帧+白闪+震屏+碎屑+火花+音效(k=力度系数,跳劈>平砍)
  private rockHit(k: number) {
    this.hitStop = 0.05 * k; this.flashT = 0.12 * k; this.shake = 10 * k;
    AudioMgr.inst.play('hit', Math.min(1, 0.85 * k));
    // 打击不再喷碎石(只留顿帧/白闪/火花/音效;破碎瞬间仍有漫天碎石)
    for (let i = 0; i < Math.round(6 * k); i++) this.sparks.push({ x: 58 + Math.random() * 14, y: this.LEDGE_BASE - 30 - Math.random() * 50, vx: 80 + Math.random() * 260, vy: -(30 + Math.random() * 220), life: 0.2 + Math.random() * 0.12, r: 1.4 + Math.random() * 1.4 });
  }

  // 石堆破碎:大震+闷响(不喷碎石)
  private rockBreak() {
    this.rockBroken = true;
    this.hitStop = 0.09; this.flashT = 0.2; this.shake = 17;
    AudioMgr.inst.play('land', 0.9);
  }

  private heroSlide() {
    if (this.over || this.inWater || !this.onG || this.slideT > 0 || this.slideCd > 0 || this.slamJump) return;
    this.slideT = 0.5; this.slideCd = 0.75; this.slideDir = this.dir;   // 与第一章同参
  }
  private updateFx(dt: number) {
    // 连招计时 + 刀气弧 + 剑气波(共用套件)
    this.combat.update(dt, this.SX(this.px), this.SY(this.py), this.dir);
    // 跳劈落地特效(冲击波+闪电)在角色套件里推进;镜头会动,把冲击点最新屏幕坐标喂进去
    this.hero.updateFx(dt, this.SX(this.slamFxX), this.SY(this.LEDGE_Y));
    // 憋气/溺水(共用套件):没入水面提前量以下=耗气,露头/岸上=回气,气尽掉血,血尽阵亡演出
    const dmg = this.breath.update(dt, this.inWater && this.py > this.SURFACE + 30);
    if (dmg > 0) { this.hp -= dmg; if (this.hp <= 0) { this.hp = 0; this.over = true; this.deadT = 0; this.deathFx.show(); } }
    // (阵亡后的 deadT 推进在 tick 开头的停摆分支里;走到这里必然未阵亡)
    // HUD/技能冷却(套件内部有脏标记,平时零开销)
    this.hud.set(this.hp, 100, this.hp, this.coins, this.breath.air);
    this.controls.setSpecialCd(this.slideCd / 0.75);   // 滑铲冷却环
  }
  private splash(x: number, y: number) {
    this.ripples.push({ x, y, r: 6, life: 1 }); this.ripples.push({ x, y, r: 2, life: 1.3 });
    for (let i = 0; i < 28; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, s = 90 + Math.random() * 230; this.bubbles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, r: 1.5 + Math.random() * 3, air: 1 }); }
  }
  private bub(x: number, y: number, n: number, spread: number) {
    for (let i = 0; i < n; i++) this.bubbles.push({ x: x + (Math.random() - 0.5) * spread, y, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 40, life: 1.6, r: 1 + Math.random() * 2.4 });
  }

  // 砸石开洞后走进洞口 → 黑幕淡入 → 切到「地下坑道」场景 → 淡出
  private exitToCave() {
    if (this.exiting) return; this.exiting = true;
    const parent = this.node.parent!;
    const fade = new Node('c2-fade'); fade.layer = Layers.Enum.UI_2D; fade.parent = parent;
    fade.addComponent(UITransform).setContentSize(W, H);
    const fg = fade.addComponent(Graphics); fg.fillColor = new Color(0, 0, 0, 255); fg.rect(-W / 2, -H / 2, W, H); fg.fill();
    const op = fade.addComponent(UIOpacity); op.opacity = 0;
    tween(op).to(0.45, { opacity: 255 }).call(() => {
      this.node.destroy();                                   // 销毁井关
      const n = new Node('Chapter2Cave'); n.layer = Layers.Enum.UI_2D; n.addComponent(UITransform); n.parent = parent;
      n.addComponent(Chapter2Cave);                          // 起洞穴场景(在黑幕下)
      fade.setSiblingIndex(parent.children.length - 1);      // 黑幕置顶,盖住新场景再淡出
      tween(op).delay(0.1).to(0.45, { opacity: 0 }).call(() => fade.destroy()).start();
    }).start();
  }

  private reset() {
    this.px = this.DW / 2; this.py = -40; this.pvx = 0; this.pvy = 0;
    this.onG = false; this.inWater = false; this.dir = 1; this.ph = 0;
    this.camY = -140; this.joyY = 0; this.keys.up = this.keys.down = false;
    this.bubbles = []; this.silt = []; this.ripples = []; this.debris = [];
    this.rockHP = 5; this.rockBroken = false;
    this.combat.reset();
    this.slamJump = false; this.slamLandT = 0;
    for (let i = 0; i < 60; i++) this.silt.push({ x: Math.random() * this.DW, wy: this.SURFACE + Math.random() * this.DH * 3, ph: Math.random() * 6.28, sp: 0.2 + Math.random() * 0.5, r: 0.5 + Math.random() * 1.6 });
  }

  update(dt: number) {
    try { this.tick(dt); }
    catch (e: any) { if (this.depthLabel) { this.depthLabel.node.active = true; this.depthLabel.string = 'ERR: ' + (e && e.message ? e.message : String(e)); } }
  }
  private tick(dt: number) {
    dt = Math.min(dt, 0.05);
    // 顿帧:命中石头的一瞬全场定格(只刷渲染不走逻辑),打击感的灵魂
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.updateWall(); this.updateMouth(); this.updateLedge(); this.updateHero(); this.redraw();
      return;
    }
    // 阵亡:全场停摆(不再下沉/移动/憋气/到底重置),只走死亡演出
    if (this.over) {
      this.deadT += dt;
      this.updateWall(); this.updateMouth(); this.updateLedge(); this.updateHero(); this.redraw();
      return;
    }
    this.t += dt; this.ph += dt * 6;
    if (this.slamLandT > 0) this.slamLandT -= dt;   // 连招计时归 HeroCombat.update 管
    if (this.slideCd > 0) this.slideCd -= dt;
    if ((!this.onG || this.inWater) && this.slideT > 0) this.slideT = 0;   // 离地/入水即中断滑铲
    const mvx = this.over ? 0 : (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);   // 阵亡后不受操控
    if (mvx) { this.dir = mvx; if (!this.inWater) this.walkPh += dt * 10; }   // 走路相位只在陆上推进(水里由蹬水节奏管)

    if (!this.inWater) {
      if (this.onG) {
        // 站在水面上方左台
        if (this.slideT > 0) { this.slideT -= dt; this.px += this.slideDir * 330 * dt; }   // 滑铲:锁向高速滑行
        else this.px += mvx * 185 * dt;
        this.py = this.LEDGE_Y;
        const wallX = this.rockBroken ? this.PASSAGE_X : this.WALL_X;
        if (this.px <= wallX) { if (this.rockBroken) { this.exitToCave(); return; } else this.px = wallX; }
        if (this.px > this.LEDGE_R + 2) this.onG = false;         // 走出右缘 → 掉落
      } else {
        // 空中自由下落
        this.pvy += JUMP.GRAVITY / this.SCALE * dt; this.pvy = Math.min(this.pvy, JUMP.FALL_CAP / this.SCALE); this.px += mvx * 150 * dt; this.py += this.pvy * dt;   // 跳跃物理全章共用 JumpKit(demo 坐标÷SCALE)
        if (this.pvy > 0) {
          const pf = this.py - this.pvy * dt;
          if (pf <= this.LEDGE_Y && this.py >= this.LEDGE_Y && this.px >= this.LEDGE_L && this.px <= this.LEDGE_R) {
            this.py = this.LEDGE_Y; this.pvy = 0; this.onG = true; this.jumpsUsed = 0;
            if (this.slamJump) this.slamImpact();   // 跳劈落地冲击
          }
        }
        if (!this.onG && this.py >= this.SURFACE) { this.inWater = true; this.splash(this.px, this.SURFACE); this.pvy *= 0.4; this.slamJump = false; this.slamLandT = 0; this.jumpsUsed = 0; }   // 劈进水里=大水花,冲击取消;连跳计数清零
      }
    } else {
      // 水下浮力阻尼潜行
      let mvy = this.over ? 0 : (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0) + (this.joyY > 0.25 ? -1 : this.joyY < -0.25 ? 1 : 0);
      if (this.py <= this.SURFACE + 4 && mvy < 0) mvy = 0;   // 身体到水面就踩水,不能再往上游(出水只靠跳跃鱼跃)
      // 无输入=浮力托着缓缓上浮回水面(不会无声下沉挂机溺死);有输入沿用原手感
      this.pvy += (mvy === 0 ? -140 : 120) * dt; this.pvy += mvy * 330 * dt; this.pvx += mvx * 240 * dt;
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
    if (this.flashT > 0) this.flashT -= dt;
    for (const d of this.debris) {
      d.life -= dt;
      const wasAbove = d.y < this.SURFACE;
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.y >= this.SURFACE) {
        // 入水:小涟漪一圈,然后阻尼下沉
        if (wasAbove && d.vy > 60) this.ripples.push({ x: d.x, y: this.SURFACE, r: 2, life: 0.5 });
        d.vy += 140 * dt; d.vy -= d.vy * 2.8 * dt; d.vx -= d.vx * 2.4 * dt;
      } else {
        d.vy += 700 * dt;
        // 落上石台面:停住躺一会儿再淡出
        if (d.vy > 0 && d.y >= this.LEDGE_Y - 2 && d.y <= this.LEDGE_Y + 12 && d.x >= this.LEDGE_L && d.x <= this.LEDGE_R) {
          d.y = this.LEDGE_Y - 1; d.vy = 0; d.vx *= 0.25;
          d.life = Math.max(d.life, 0.9);
        }
      }
    }
    this.debris = this.debris.filter(d => d.life > 0);
    for (const s of this.sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 500 * dt; } this.sparks = this.sparks.filter(s => s.life > 0);
    if (this.py >= this.GOAL) this.reset();

    this.cam.update(dt, !this.onG && !this.inWater && !this.over, this.SX(this.px), this.SY(this.py));   // 跳跃/坠井镜头(套件)
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
    const fl = Math.max(0, Math.min(1, this.flashT / 0.12)) * 0.85;   // 受击白闪:命中瞬间整堆提亮
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (const c of circles) { mnx = Math.min(mnx, c[0] - c[2]); mxx = Math.max(mxx, c[0] + c[2]); mny = Math.min(mny, c[1] - c[2]); mxy = Math.max(mxy, c[1] + c[2]); }
    const inLC = (x: number, y: number) => { for (const c of circles) { const dx = x - c[0], dy = y - c[1]; if (dx * dx + dy * dy <= c[2] * c[2]) return true; } return false; };
    const span = Math.max(1, mxy - mny), bw = P * S + 0.6;
    const cell = (wx: number, wy: number, col: number[], al: number) => {
      g.fillColor = new Color(
        Math.round(col[0] + (255 - col[0]) * fl),
        Math.round(col[1] + (255 - col[1]) * fl),
        Math.round(col[2] + (255 - col[2]) * fl), al);
      g.rect(this.SX(wx) - bw / 2, this.SY(wy) - bw / 2, bw, bw); g.fill();
    };
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
    // 裂痕:浅色断续细纹(暗棕半透明,随机断点),不再是通黑实线
    for (let i = 0; i < dmg; i++) {
      const bx = 22 + i * 9; let d = 0;
      for (let Y = -30; Y > -80; Y -= 4) {
        if (this.hsh(bx, Y) > 0.32) cell(bx + d * 0.12, this.LEDGE_BASE + Y, [56, 47, 36], 150);
        d += 4;
      }
    }
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
        // 破洞:像素噪声咬边的不规则黑洞(边缘一圈碎岩过渡),不是滑溜溜的椭圆
        {
          // 竖长条裂口(像山缝),噪声咬边;整体比原来靠上
          // 位置/大小对齐原石堆(包围盒中心 x≈21,y≈台座上方80,半径≈50×58)
          const cx0 = 21, cy0 = this.LEDGE_BASE - 80, P = 4, bw = P * S + 0.6;
          for (let oy = -66; oy <= 62; oy += P) for (let ox = -56; ox <= 56; ox += P) {
            const rr = (ox / 46) * (ox / 46) + (oy / 56) * (oy / 56);
            const nz = this.hsh(ox * 3.1, oy * 2.7);
            if (rr < 0.58 + 0.52 * nz) {
              const edge = rr > 0.42 + 0.42 * nz;
              g.fillColor = edge ? new Color(26, 22, 16, 255) : new Color(6, 9, 6, 255);
              g.rect(this.SX(cx0 + ox) - bw / 2, this.SY(cy0 + oy) - bw / 2, bw, bw); g.fill();
            }
          }
        }
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
    // 击石火花(亮黄白,短命,带小拖尾感)
    for (const s2 of this.sparks) {
      const sy2 = this.SY(s2.y);
      const a2 = Math.max(0, Math.min(1, s2.life * 4));
      g.fillColor = new Color(255, 240, 170, Math.round(255 * a2));
      g.circle(this.SX(s2.x), sy2, Math.max(1, s2.r * S)); g.fill();
      g.fillColor = new Color(255, 255, 230, Math.round(200 * a2));
      g.circle(this.SX(s2.x), sy2, Math.max(0.5, s2.r * 0.45 * S)); g.fill();
    }

    // 角色兜底标记（套件未就绪时）
    if (!this.hero || !this.hero.ready) {
      g.fillColor = new Color(240, 220, 120, 255); g.circle(this.SX(this.px), this.SY(this.py) + 20, 16); g.fill();
    }

    const zone = !this.inWater ? '落下' : (this.py > this.GOAL * 0.7 ? '黄泉深处' : '浊水中');
    this.depthLabel.string = zone + '  ' + Math.max(0, Math.round(this.py / this.GOAL * 100)) + '%';
  }
}
