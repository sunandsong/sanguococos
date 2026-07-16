import {
  _decorator, Component, Node, Graphics, Color, UITransform, Label, Layers,
  input, Input, EventKeyboard, KeyCode, Sprite, SpriteFrame, Texture2D, Vec3, tween,
} from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { AssetHub } from './AssetHub';

const { ccclass } = _decorator;

// ─────────────────────────────────────────────────────────────
// 横版换装 Demo(纸娃娃):身体底模 + 衣服/头盔/武器 三层贴图叠加。
//   走(A/D)、跳(W/空格)、攻击(J,武器摆动)、1/2/3 循环换装。
//   美术未就绪时用色块占位小人,图放进 resources 后自动换真皮:
//   dd-body / dd-clothes-1..3 / dd-helmet-1..3 / dd-weapon-1..3(128×128,角色同位对齐)
// ─────────────────────────────────────────────────────────────
@ccclass('DressupDemo')
export class DressupDemo extends Component {
  private readonly GROUND_Y = -180;   // 地面(角色落到这个 y)
  private readonly SCALE = 1.8;       // 角色整体放大倍数
  private readonly MOVE = 220;
  private readonly JUMP = 620;
  private readonly GRAVITY = -1800;

  private player!: Node;
  private bodySp!: Sprite; private bodyPh!: Graphics;   // 占位画在 body 节点上,真图加载后清掉
  private clothesSp!: Sprite;                            // 部件衣服层(盖住躯干/上臂)
  private armFSp!: Sprite;                               // 前小臂+手(武器之上:近手包柄)
  private armBSp!: Sprite;                               // 后小臂+手(武器之下:远手被柄半遮)
  private weaponSp!: Sprite;
  private weaponN!: Node;
  private outfitOpt: (SpriteFrame | null)[] = [];        // 整套装扮(dd-body=第0套裸装,dd-outfit-N 依次)
  private clothesOpt: (SpriteFrame | null)[] = [null];   // 部件衣服(第0=不穿),只在裸装底模上叠
  private weaponOpt: (SpriteFrame | null)[] = [null];    // 第0个=空手
  private ci = 0; private ki = 0; private wi = 0;
  private infoLbl!: Label;

  private vy = 0; private grounded = true; private facing = 1;
  private leftKey = false; private rightKey = false;
  private attacking = false; private walkTime = 0;

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    // 背景 + 地面(程序画,换装 demo 不需要讲究)
    const bg = this.mkNode('dd-bg', this.node);
    const bgG = bg.addComponent(Graphics);
    bgG.fillColor = new Color(46, 52, 74, 255); bgG.rect(-W / 2, -H / 2, W, H); bgG.fill();
    bgG.fillColor = new Color(66, 78, 104, 255); bgG.rect(-W / 2, -H / 2, W, H * 0.14); bgG.fill();
    bgG.fillColor = new Color(120, 104, 78, 255); bgG.rect(-W / 2, this.GROUND_Y - 26, W, 14); bgG.fill();   // 地面条

    // ── 纸娃娃:Body / Clothes / Helmet / Weapon 同位置叠层 ──
    this.player = this.mkNode('dd-player', this.node);
    this.player.setPosition(0, this.GROUND_Y, 0);
    this.player.setScale(this.SCALE, this.SCALE, 1);

    const mkLayer = (name: string) => {
      const n = this.mkNode(name, this.player);
      const u = n.addComponent(UITransform); u.setContentSize(128, 128); u.setAnchorPoint(0.5, 0);   // 锚点脚底
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.trim = false;   // 关掉透明裁边:128×128 原画布显示,否则身体被裁出来拉伸=压扁
      n.setPosition(0, 0, 0);
      return { n, sp };
    };
    // 层序(切件纸娃娃):身体(无前小臂) → 衣服 → 前小臂+手 → 武器;整图装扮时只用身体层
    const body = mkLayer('body');
    this.bodySp = body.sp;
    this.bodyPh = body.n.addComponent(Graphics);   // 占位小人(真图到了就 clear)
    this.drawPlaceholder();
    const clothes = mkLayer('clothes'); this.clothesSp = clothes.sp; clothes.n.active = false;
    // 一手在前一手在后:前小臂 → 武器 → 后小臂 的三明治层序(后手包柄在最上)
    const armF = mkLayer('arm-front'); this.armFSp = armF.sp; armF.n.active = false;
    const weapon = mkLayer('weapon');
    this.weaponSp = weapon.sp;
    const pivot = this.mkNode('weapon-pivot', this.player);
    pivot.setPosition(-17, 56, 0);             // 握把点=后拳心(从切分层实测,双手持剑的主握手)
    weapon.n.parent = pivot;
    weapon.n.setPosition(17, -56, 0);          // 子节点回补偏移 → 画布回到和身体层完全重合
    this.weaponN = pivot;                      // 挥剑旋转这个轴心节点
    const armB = mkLayer('arm-back'); this.armBSp = armB.sp; armB.n.active = false;

    // ── 装载:装扮=完整角色图(第0套=裸装底模),部件衣服/前臂/武器各自独立 ──
    this.loadSF('dd-body', (sf) => { this.outfitOpt.unshift(sf); this.bodyPh.clear(); this.applyAll(); });
    this.loadSF('dd-arm-front', (sf) => { this.armFSp.spriteFrame = sf; this.applyAll(); });
    this.loadSF('dd-arm-back', (sf) => { this.armBSp.spriteFrame = sf; this.applyAll(); });
    for (let i = 1; i <= 3; i++) {
      this.loadSF(`dd-outfit-${i}`, (sf) => { this.outfitOpt.push(sf); this.applyAll(); });
      this.loadSF(`dd-clothes-${i}`, (sf) => { this.clothesOpt.push(sf); this.applyAll(); });
      this.loadSF(`dd-weapon-${i}`, (sf) => { this.weaponOpt.push(sf); this.applyAll(); });
    }

    // ── HUD:装备/属性 + 操作提示 ──
    this.infoLbl = this.mkLabel(0, H / 2 - 80, 26, new Color(255, 236, 180));
    this.mkLabel(0, -H / 2 + 60, 22, new Color(180, 190, 210)).string =
      'A/D 走  W/空格 跳  J 攻击   1 整图装扮  2 部件衣服  3 武器';
    this.applyAll();

    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
  }

  onDestroy() {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
  }

  // ── 输入 ──
  private onKeyDown(e: EventKeyboard) {
    switch (e.keyCode) {
      case KeyCode.KEY_A: case KeyCode.ARROW_LEFT: this.leftKey = true; break;
      case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT: this.rightKey = true; break;
      case KeyCode.SPACE: case KeyCode.KEY_W: case KeyCode.ARROW_UP: this.jump(); break;
      case KeyCode.KEY_J: this.attack(); break;
      case KeyCode.DIGIT_1: if (this.outfitOpt.length) { this.ci = (this.ci + 1) % this.outfitOpt.length; this.ki = 0; this.applyAll(); } break;   // 换整图装扮(清掉部件衣服)
      case KeyCode.DIGIT_2: this.ki = (this.ki + 1) % this.clothesOpt.length; this.ci = 0; this.applyAll(); break;   // 换部件衣服(回裸装底模上叠)
      case KeyCode.DIGIT_3: this.wi = (this.wi + 1) % this.weaponOpt.length; this.applyAll(); break;
    }
  }
  private onKeyUp(e: EventKeyboard) {
    switch (e.keyCode) {
      case KeyCode.KEY_A: case KeyCode.ARROW_LEFT: this.leftKey = false; break;
      case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT: this.rightKey = false; break;
    }
  }

  private jump() {
    if (this.grounded) { this.vy = this.JUMP; this.grounded = false; }
  }

  private attack() {
    if (this.attacking) return;
    this.attacking = true;
    // 武器抡一下(占位模式也有动作:整个人前倾)
    const target = this.weaponSp.spriteFrame ? this.weaponN : this.player;
    const swing = this.weaponSp.spriteFrame ? -110 : -16;   // 有武器抡武器,没武器点头顶一下
    tween(target)
      .to(0.08, { angle: swing })
      .to(0.14, { angle: 0 })
      .call(() => { this.attacking = false; })
      .start();
  }

  // ── 换装应用 + 属性汇总 ──
  private applyAll() {
    this.ci = Math.max(0, Math.min(this.ci, this.outfitOpt.length - 1));
    this.ki = Math.max(0, Math.min(this.ki, this.clothesOpt.length - 1));
    this.wi = Math.max(0, Math.min(this.wi, this.weaponOpt.length - 1));
    if (this.outfitOpt.length) this.bodySp.spriteFrame = this.outfitOpt[this.ci];
    // 部件衣服 + 前小臂层:只在裸装底模(第0套)上生效——整图装扮的手臂画在图里,再叠会重影
    const csf = this.ci === 0 ? this.clothesOpt[this.ki] : null;
    this.clothesSp.spriteFrame = csf; this.clothesSp.node.active = !!csf;
    this.armFSp.node.active = this.ci === 0 && !!this.armFSp.spriteFrame;
    this.armBSp.node.active = this.ci === 0 && !!this.armBSp.spriteFrame;
    const wsf = this.weaponOpt[this.wi];
    this.weaponSp.spriteFrame = wsf; this.weaponSp.node.active = !!wsf;
    const atk = 10 + this.wi * 5, def = this.ci * 3 + this.ki * 2;
    const res = `资源: 装扮×${this.outfitOpt.length} 部件衣×${this.clothesOpt.length - 1} 前臂${this.armFSp.spriteFrame ? '√' : '×'} 后臂${this.armBSp.spriteFrame ? '√' : '×'} 武器×${this.weaponOpt.length - 1}`;
    this.infoLbl.string = `装扮#${this.ci}  部件衣#${this.ki}  武器#${this.wi}   ATK ${atk}  DEF ${def}\n${res}`;
  }

  // ── 主循环:走/跳/落地/走路起伏 ──
  update(dt: number) {
    const mv = (this.rightKey ? 1 : 0) - (this.leftKey ? 1 : 0);
    if (mv !== 0) {
      this.facing = mv;
      this.player.setScale(this.facing * this.SCALE, this.SCALE, 1);
    }
    const p = this.player.position;
    let x = Math.max(-W / 2 + 50, Math.min(W / 2 - 50, p.x + mv * this.MOVE * dt));
    this.vy += this.GRAVITY * dt;
    let y = p.y + this.vy * dt;
    if (y <= this.GROUND_Y) { y = this.GROUND_Y; this.vy = 0; this.grounded = true; }
    let bob = 0;
    if (mv !== 0 && this.grounded) { this.walkTime += dt * 12; bob = Math.abs(Math.sin(this.walkTime)) * 6; }
    else this.walkTime = 0;
    this.player.setPosition(x, y + bob, 0);
  }

  // ── 工具 ──
  private mkNode(name: string, parent: Node): Node {
    const n = new Node(name); n.layer = Layers.Enum.UI_2D; n.parent = parent;
    if (!n.getComponent(UITransform)) n.addComponent(UITransform);
    return n;
  }
  private mkLabel(x: number, y: number, size: number, color: Color): Label {
    const n = this.mkNode('dd-lbl', this.node);
    n.setPosition(x, y, 0);
    const l = n.addComponent(Label); l.fontSize = size; l.lineHeight = size + 6; l.color = color;
    return l;
  }
  private loadSF(name: string, cb: (sf: SpriteFrame) => void) {
    AssetHub.loadSF(name, (base) => {
      if (!base || !this.node.isValid) return;   // 图不存在=静默跳过(占位继续用)
      (base.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      cb(base);
    });
  }
  /** 占位小人(色块):美术未就绪时也能走跳攻击换装 */
  private drawPlaceholder() {
    const g = this.bodyPh;
    g.clear();
    g.fillColor = new Color(226, 190, 156, 255); g.circle(0, 96, 18); g.fill();         // 头
    g.fillColor = new Color(90, 130, 200, 255); g.roundRect(-14, 34, 28, 50, 6); g.fill();   // 身
    g.fillColor = new Color(60, 70, 100, 255);
    g.roundRect(-13, 0, 10, 36, 4); g.fill(); g.roundRect(3, 0, 10, 36, 4); g.fill();   // 腿
    g.fillColor = new Color(226, 190, 156, 255);
    g.roundRect(-24, 46, 9, 32, 4); g.fill(); g.roundRect(15, 46, 9, 32, 4); g.fill();  // 手
  }
}
