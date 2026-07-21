import {
  _decorator, Component, Node, Graphics, Color, UITransform, Layers,
  input, Input, EventKeyboard, KeyCode, UIOpacity, tween, Sprite, Texture2D, Rect, SpriteFrame,
} from 'cc';
import { AssetHub } from './AssetHub';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { HeroRig, HeroMode } from './HeroRig';
import { HeroCombat } from './HeroCombat';
import { TouchControls } from './TouchControls';
import { HeroHUD } from './HeroHUD';
import { DeathFx } from './DeathFx';
import { AudioMgr } from './AudioMgr';
import { JUMP, tryJump } from './JumpKit';
import { Chapter2Well } from './Chapter2Well';

const { ccclass } = _decorator;

// ─────────────────────────────────────────────────────────────
// 第二章 · 空城(跑酷 Demo,程序化原型)
//   怪诞荒城一条街:歪楼/亮窗/停摆钟楼,障碍四件套(板车=滑铲/砖墙=跳/
//   星空裂缝=跳+踩空掉血),二段跳,街尾老井 → 跳井接井关(第三章)。
//   角色/操控/HUD/阵亡全部复用套件;美术后续按空城概念图换真图。
// ─────────────────────────────────────────────────────────────

type Obst = { x: number; type: 'low' | 'high' | 'gap'; w?: number };   // w=裂缝自定义宽(宽缝要二段跳)
// 跑酷式敌人:瓦罐小妖(地面巡逻→扑人)/纸鸢妖(檐口巡航→俯冲)/檐上枪妖(屋顶掷枪);
//   x0/y0/tx/ty=纸鸢俯冲起点/目标
type Foe = {
  kind: 'pot' | 'kite' | 'guard';
  x: number; y: number; anchor: number; dir: number; t: number;
  alive: boolean; state: number; cd: number; hitSw: number;
  x0: number; y0: number; tx: number; ty: number;
  hp: number; flash: number;   // hp=砍击血(瓦罐2刀);flash=受击弹缩计时
  sp?: Sprite;   // 有真图的怪(瓦罐走路帧)用精灵节点显示,无图的仍程序画
};

@ccclass('Chapter2City')
export class Chapter2City extends Component {
  private g!: Graphics;
  private hero!: HeroRig;
  private combat!: HeroCombat;
  private controls!: TouchControls;
  private hud!: HeroHUD;
  private deathFx!: DeathFx;

  private readonly GROUND = -H * 0.16;     // 脚线 Cocos y
  private readonly HERO_SX = -W * 0.18;    // 角色固定屏幕 x(偏左,朝右跑)
  private readonly HERO_DY = -12;          // 角色视觉下沉(踩实石板唇;只影响显示,物理不动)
  private readonly SPEED = 300;
  private readonly LENGTH = 13000;         // 街长,尽头是井

  private px = 120; private py = this.GROUND; private vy = 0; private onG = true;
  private dir = 1; private walkPh = 0; private camX = 0; private t = 0;
  private jumpsUsed = 0;                   // 二段跳计数(落地清零)
  private slideT = 0; private slideCd = 0; private slideDir = 1;
  private slamJump = false; private slamLandT = 0;
  private stunT = 0;                       // 撞障碍硬直
  private fallT = 0;    // 裂缝跌落演出(掉进星空=直接死)
  private over = false; private deadT = 0;
  private hp = 100; private coins = 0;
  private exiting = false;
  private keys = { left: false, right: false };

  // 障碍布置(按 x 排,十个小节:教学 → 组合渐密 → 终段冲刺)
  private readonly OBST: Obst[] = [
    // ① 教学:三件套各来一次,间隔大
    { x: 700, type: 'low' }, { x: 1150, type: 'high' }, { x: 1600, type: 'gap' },
    // ② 连环板车:三连滑铲(一铲滑不完,节奏铲)
    { x: 2580, type: 'low' }, { x: 2760, type: 'low' }, { x: 3020, type: 'low' },
    // ③ 缝墙交替:跳缝落地立刻起跳翻墙
    { x: 3450, type: 'gap' }, { x: 3700, type: 'high' }, { x: 3950, type: 'gap' }, { x: 4160, type: 'high' },
    // ④ 宽缝:单跳过不去,必须二段跳
    { x: 4760, type: 'gap', w: 200 }, { x: 5100, type: 'gap', w: 220 },
    // ⑤ 星河巨缝:纯二段跳极限跨越(高手考题)
    { x: 6050, type: 'gap', w: 260 },
    // ⑥ 墙缝墙:翻墙→跳缝→翻墙一气呵成(墙变宽后间距拉开)
    { x: 6780, type: 'high' }, { x: 6980, type: 'gap' }, { x: 7280, type: 'high' },
    // ⑦ 低高交替:铲→跳→铲(第四拍=紧接着的歇脚房,二段跳收尾)
    { x: 7420, type: 'low' }, { x: 7700, type: 'high' }, { x: 7980, type: 'low' },
    // ⑧ 三连缝:连跳不许停
    { x: 8560, type: 'gap' }, { x: 8820, type: 'gap' }, { x: 9080, type: 'gap' },
    // ⑨ 双墙连翻:二段跳过第一堵,墙间落脚再二段跳
    { x: 9640, type: 'high' }, { x: 9980, type: 'high' },
    // ⑩ 终段冲刺:全家桶密集混排,井前最后考验
    { x: 10520, type: 'gap' }, { x: 10780, type: 'low' }, { x: 11000, type: 'high' },
    { x: 11290, type: 'gap', w: 200 }, { x: 11560, type: 'low' }, { x: 11780, type: 'high' },
    { x: 12000, type: 'gap' }, { x: 12260, type: 'low' },
  ];
  private readonly GAP_W = 120;
  private readonly CART_TOP = 47;    // 板车顶面高(显示高85-下沉38);顶=可站单向面
  private readonly RUIN_TOP = 200;   // 断墙顶面高(高200必须二段跳);顶=可站单向面
  // 临街塔楼(city-house 贴图):实心路障,不能从屋前穿过——必须二段跳上屋顶(单向平台)翻过去
  //   一层小房贴图:宽高比 1.436、顶沿在图高 83.1%,h=170 → 显示 229 高 329 宽;h=190 → 253/363
  //   平台 170/190:单跳(162)上不去,必须二段跳——房=强制二段跳关卡
  private readonly HOUSES = [
    { x1: 2121, x2: 2449, h: 170 },   // 教学房:第一次逼二段跳上房顶
    { x1: 4276, x2: 4604, h: 170 },
    { x1: 5294, x2: 5656, h: 190 },
    { x1: 6241, x2: 6569, h: 170 },   // 房顶助跑接空中一跳飞越 6700 的墙
    { x1: 8156, x2: 8484, h: 170 },   // 三连缝前的歇脚房
    { x1: 10096, x2: 10424, h: 170 },   // 中心 10260(避开⑨双墙)
    { x1: 12366, x2: 12694, h: 170 }, // 井前最后一栋:房顶跳向老井
  ];
  private coinsArr: { x: number; y: number }[] = [];
  private got = new Set<number>();
  private gapNodes: { n: Node; x: number }[] = [];   // 裂缝贴图节点
  private obstHalf = new Map<number, number>();      // 障碍x → 碰撞半宽(=贴图半宽×0.95,严丝合缝)
  private cartNodes: { n: Node; x: number; v: number }[] = [];  // 板车贴图节点(v=变体号)
  // 板车贴图变体(六辆轮换,辆辆不重样),宽高比接图时实测,显示高统一 85
  private readonly CART_VARIANTS = [
    { res: 'city-cart', ar: 2.238 },
    { res: 'city-cart2', ar: 1.799 },
    { res: 'city-cart3', ar: 1.713 },
    { res: 'city-cart4', ar: 1.817 },
    { res: 'city-cart5', ar: 2.187 },
    { res: 'city-cart6', ar: 2.445 },
    { res: 'city-cart7', ar: 2.2 },
  ];
  private ruinNodes: { n: Node; x: number; v: number }[] = [];  // 断墙贴图节点(v=变体号)
  // 断墙贴图变体(九堵轮换免单调),宽高比接图时实测,显示高统一 240
  private readonly RUIN_VARIANTS = [
    { res: 'city-ruin', ar: 0.751 },
    { res: 'city-ruin2', ar: 0.662 },
    { res: 'city-ruin3', ar: 0.743 },
    { res: 'city-ruin4', ar: 0.872 },
    { res: 'city-ruin5', ar: 0.823 },
    { res: 'city-ruin6', ar: 0.767 },
  ];
  private houseNodes: { n: Node; x: number; v: number }[] = []; // 小房贴图节点(v=变体号)
  // 小房贴图变体(七栋轮换免单调):各自的宽高比/顶沿占比接图时实测
  private readonly HOUSE_VARIANTS = [
    { res: 'city-house', ar: 1.436, roof: 0.831 },
    { res: 'city-house2', ar: 1.292, roof: 0.776 },
    { res: 'city-house3', ar: 1.495, roof: 0.727 },
    { res: 'city-house4', ar: 1.693, roof: 0.769 },
    { res: 'city-house5', ar: 1.190, roof: 0.745 },
  ];
  private fgG!: Graphics;   // 顶层氛围层(飘尘/暗角/前景雾)
  private fogMid!: Graphics;   // 中层雾幕(远中景与近景之间)

  // ── 敌人(家什成精,跑酷式):瓦罐小妖=地面缠斗,纸鸢妖=檐口俯冲,石狮滚球=终段移动障碍 ──
  private foeG!: Graphics;   // 敌人层(障碍贴图之上、角色之下)
  private potRoot!: Node;    // 瓦罐走路帧精灵容器(压在 foeG 之上)
  private potFrames: SpriteFrame[] = [];   // 瓦罐走路 8 帧(city-pot-walk 横排切格)
  private readonly POT_DISP_H = 104;       // 瓦罐显示高(帧 268 等比缩)
  private guardFrames: SpriteFrame[] = [];   // 机枪妖4姿态帧
  private readonly GUARD_DISP_H = 132;
  private kiteFrame: SpriteFrame | null = null;
  private readonly KITE_DISP_H = 120;
  private foes: Foe[] = [];
  // 敌人布点:全避开障碍与小房(战斗段与跑酷段交替,不混叠——设计文档节奏原则)
  private readonly FOE_SPOTS: { kind: 'pot' | 'kite'; x: number }[] = [
    { kind: 'pot', x: 1380 },                            // 教学:第一只瓦罐,开阔地单挑
    { kind: 'pot', x: 1870 }, { kind: 'pot', x: 1990 },  // 双罐小群
    { kind: 'kite', x: 3250 },                           // 教学:第一只纸鸢(三连板车后抬头)
    { kind: 'pot', x: 5680 }, { kind: 'pot', x: 5800 },  // 星河巨缝前夹道
    { kind: 'kite', x: 6630 },                           // ⑥墙阵前俯冲扰跳
    { kind: 'pot', x: 9180 }, { kind: 'pot', x: 9300 },  // ⑧⑨之间开阔地:三罐一鸢混战
    { kind: 'pot', x: 9420 }, { kind: 'kite', x: 9380 },
  ];
  // 石狮滚球:终段冲刺(⑩)的移动障碍,无敌只能跳;到触发点从前方滚来
  private lions: { x: number; y: number; vy: number; onG: boolean; rot: number }[] = [];
  private readonly LION_TRIGGERS = [{ x: 10440, done: false }, { x: 11520, done: false }];
  // 檐上机枪妖射出的曳光弹(直线飞,落街皮扬尘消失)
  private bullets: { x: number; y: number; vx: number; vy: number }[] = [];
  private swingId = 0;      // 挥砍编号:一刀对一敌只结算一次
  private invulnT = 0;      // 受击无敌帧
  private parts: { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; col: Color }[] = [];

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    // 五层 AI 背景图(空城概念:歪楼/亮窗/石板街),视差滚动;垫在 Graphics 结构层之下
    const bgRoot = new Node('city-bgimg'); bgRoot.layer = Layers.Enum.UI_2D; bgRoot.parent = this.node; bgRoot.addComponent(UITransform);
    this.makeLayer('bg-far-city', 845, 0.25, this.GROUND, bgRoot);    // 远景:灰紫薄荷天+停摆钟楼天际线
    this.makeLayer('bg-mid-city', 400, 0.62, this.GROUND, bgRoot);    // 中景:亮窗歪楼一条街
    // 中层雾幕(寂静岭氛围):压在远/中景上、近景下,楼影半隐半现
    // 静态渐变雾幕只画一次(不进每帧重绘,省顶点重建)
    const fogS = new Node('city-fog-static'); fogS.layer = Layers.Enum.UI_2D; fogS.parent = bgRoot; fogS.addComponent(UITransform);
    const fsg = fogS.addComponent(Graphics);
    fsg.fillColor = new Color(212, 211, 222, 62); fsg.rect(-W / 2, this.GROUND, W, H / 2 - this.GROUND); fsg.fill();
    fsg.fillColor = new Color(212, 211, 222, 66); fsg.rect(-W / 2, this.GROUND, W, 300); fsg.fill();
    fsg.fillColor = new Color(212, 211, 222, 78); fsg.rect(-W / 2, this.GROUND, W, 140); fsg.fill();
    const fogN = new Node('city-fog-mid'); fogN.layer = Layers.Enum.UI_2D; fogN.parent = bgRoot; fogN.addComponent(UITransform);
    this.fogMid = fogN.addComponent(Graphics);
    this.makeLayer('bg-near-city', 300, 0.85, this.GROUND, bgRoot);   // 近景:路灯/倒浮伞/家什堆
    this.makeLayer('bg-ground-city', 470, 1.0, -H / 2, bgRoot);       // 地面横截面:图内街皮线在 7.4% 处,470*(1-0.074)≈435=脚线到屏底,石板面正好对齐脚线

    // 星空裂缝贴图:每条缝一个节点,从街皮插到屏底(闪星在 Graphics 层继续叠)
    const gapRoot = new Node('city-gaps'); gapRoot.layer = Layers.Enum.UI_2D; gapRoot.parent = this.node; gapRoot.addComponent(UITransform);
    for (const o of this.OBST) {
      if (o.type !== 'gap') continue;
      const gw = o.w ?? this.GAP_W;
      const n = new Node('gap' + o.x); n.layer = Layers.Enum.UI_2D; n.parent = gapRoot;
      n.addComponent(UITransform).setAnchorPoint(0.5, 1);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      // 图=纯星空口(345×262,洞口占宽 44%,下段敞开):整图等比拉伸免变形,洞口对齐判定缝
      n.getComponent(UITransform)!.setContentSize((gw + 30) * 1.9, this.GROUND + H / 2 + 18);
      this.gapNodes.push({ n, x: o.x });
    }
    AssetHub.loadSF('city-gap', (sf) => {
      if (!sf) return;
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      for (const gp of this.gapNodes) gp.n.getComponent(Sprite)!.spriteFrame = sf;
    });

    const gn = new Node('city-gfx'); gn.layer = Layers.Enum.UI_2D; gn.parent = this.node; gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);

    // 障碍贴图层(板车等):压在 Graphics 之上、角色之下——电线杆/小屋内墙都在它后面
    const obstRoot = new Node('city-obst'); obstRoot.layer = Layers.Enum.UI_2D; obstRoot.parent = this.node; obstRoot.addComponent(UITransform);
    let cartIdx = 0;
    for (const o of this.OBST) {
      if (o.type !== 'low') continue;
      const v = cartIdx++ % this.CART_VARIANTS.length;   // 变体轮换
      const n = new Node('cart' + o.x); n.layer = Layers.Enum.UI_2D; n.parent = obstRoot;
      n.addComponent(UITransform).setAnchorPoint(0.5, 0);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      n.getComponent(UITransform)!.setContentSize(85 * this.CART_VARIANTS[v].ar, 85);
      this.obstHalf.set(o.x, 85 * this.CART_VARIANTS[v].ar / 2 * 0.95);   // 碰撞=贴图宽,严丝合缝
      this.cartNodes.push({ n, x: o.x, v });
    }
    this.CART_VARIANTS.forEach((va, k) => {
      AssetHub.loadSF(va.res, (sf) => {
        if (!sf) return;
        (sf.texture as Texture2D).setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        for (const cn of this.cartNodes) if (cn.v === k) cn.n.getComponent(Sprite)!.spriteFrame = sf;
      });
    });
    let ruinIdx = 0;
    for (const o of this.OBST) {
      if (o.type !== 'high') continue;
      const v = ruinIdx++ % this.RUIN_VARIANTS.length;   // 变体轮换
      const n = new Node('ruin' + o.x); n.layer = Layers.Enum.UI_2D; n.parent = obstRoot;
      n.addComponent(UITransform).setAnchorPoint(0.5, 0);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      n.getComponent(UITransform)!.setContentSize(240 * this.RUIN_VARIANTS[v].ar, 240);   // 高200必须二段跳
      this.obstHalf.set(o.x, 240 * this.RUIN_VARIANTS[v].ar / 2 * 0.95);   // 碰撞=贴图宽,严丝合缝
      this.ruinNodes.push({ n, x: o.x, v });
    }
    this.RUIN_VARIANTS.forEach((va, k) => {
      AssetHub.loadSF(va.res, (sf) => {
        if (!sf) return;
        (sf.texture as Texture2D).setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        for (const rn of this.ruinNodes) if (rn.v === k) rn.n.getComponent(Sprite)!.spriteFrame = sf;
      });
    });
    this.HOUSES.forEach((hs, i) => {
      const v = i % this.HOUSE_VARIANTS.length;   // 变体轮换
      const va = this.HOUSE_VARIANTS[v];
      const n = new Node('house' + hs.x1); n.layer = Layers.Enum.UI_2D; n.parent = obstRoot;
      n.addComponent(UITransform).setAnchorPoint(0.5, 0);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      // 碰撞/平台宽运行时按贴图实测宽重写(严丝合缝):表里的 x1/x2 只定中心
      const cx = (hs.x1 + hs.x2) / 2;
      const dispH = (hs.h + 40) / va.roof;   // 各变体顶沿对齐平台高,下沉 40 贴到路边
      const hw = dispH * va.ar / 2 * 0.95;
      hs.x1 = cx - hw; hs.x2 = cx + hw;
      n.getComponent(UITransform)!.setContentSize(dispH * va.ar, dispH);
      this.houseNodes.push({ n, x: cx, v });
    });
    this.HOUSE_VARIANTS.forEach((va, k) => {
      AssetHub.loadSF(va.res, (sf) => {
        if (!sf) return;
        (sf.texture as Texture2D).setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        for (const hn of this.houseNodes) if (hn.v === k) hn.n.getComponent(Sprite)!.spriteFrame = sf;
      });
    });

    // 敌人层:压在障碍贴图之上、角色之下(瓦罐在板车/断墙前跑动不穿帮)
    const foeGn = new Node('city-foes'); foeGn.layer = Layers.Enum.UI_2D; foeGn.parent = this.node; foeGn.addComponent(UITransform);
    this.foeG = foeGn.addComponent(Graphics);
    const potRootN = new Node('city-pots'); potRootN.layer = Layers.Enum.UI_2D; potRootN.parent = this.node; potRootN.addComponent(UITransform);
    this.potRoot = potRootN;
    // 瓦罐走路帧:横排 8 格(201×268/格)切成序列帧
    AssetHub.loadSF('city-pot-walk', (sf) => {
      if (!sf) return;
      const tex = sf.texture as Texture2D; tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      const cw = Math.round(tex.width / 8), ch = tex.height;   // 按整图切,不受导入 trim 影响
      for (let c = 0; c < 8; c++) { const f = new SpriteFrame(); f.texture = tex; f.rect = new Rect(c * cw, 0, cw, ch); this.potFrames.push(f); }
      for (const e of this.foes) if (e.kind === 'pot' && e.sp) e.sp.spriteFrame = this.potFrames[0];   // 已建节点补首帧
    });
    // 机枪妖4姿态帧:横排4格
    AssetHub.loadSF('city-guard', (sf) => {
      if (!sf) return;
      const tex = sf.texture as Texture2D; tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      const cw = Math.round(tex.width / 4), ch = tex.height;
      for (let k = 0; k < 4; k++) { const f = new SpriteFrame(); f.texture = tex; f.rect = new Rect(k * cw, 0, cw, ch); this.guardFrames.push(f); }
      for (const e of this.foes) if (e.kind === 'guard' && e.sp) e.sp.spriteFrame = this.guardFrames[0];
    });
    // 纸鸢妖单帧
    AssetHub.loadSF('city-kite', (sf) => {
      if (!sf) return;
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      this.kiteFrame = sf;
      for (const e of this.foes) if (e.kind === 'kite' && e.sp) e.sp.spriteFrame = sf;
    });
    this.initFoes();

    const fx = new Node('city-fx'); fx.layer = Layers.Enum.UI_2D; fx.parent = this.node; fx.addComponent(UITransform);
    this.hero = new HeroRig(this.node, fx);
    this.hero.ambient = new Color(236, 230, 244, 255);   // 空城淡紫暮色环境光
    this.combat = new HeroCombat(fx, this.hero);

    // 前景野草布条层:压在角色之上、按键之下
    const fgRoot = new Node('city-fgimg'); fgRoot.layer = Layers.Enum.UI_2D; fgRoot.parent = this.node; fgRoot.addComponent(UITransform);
    this.makeLayer('bg-fg-city', 330, 1.15, -H / 2, fgRoot);
    // 顶层氛围 Graphics(角色之上):飘尘/纸片/暗角
    const fgGn = new Node('city-atmo'); fgGn.layer = Layers.Enum.UI_2D; fgGn.parent = this.node; fgGn.addComponent(UITransform);
    this.fgG = fgGn.addComponent(Graphics);

    this.controls = new TouchControls(this.node, {
      onDir: (d) => { this.keys.left = d < 0; this.keys.right = d > 0; },
      onAxis: () => { },
      onJump: () => this.jump(),
      onDash: (d) => { this.dir = d as 1 | -1; this.slide(); },
      onAttack: () => this.attack(),
      onSlide: () => this.slide(),
    }, { alpha: 0.5 });
    this.hud = new HeroHUD(this.node);
    this.deathFx = new DeathFx(this.node, () => {   // 死亡=整关重来(从街头起跑,金币也重置)
      this.deathFx.hide(); this.over = false; this.deadT = 0; this.hp = 100;
      this.px = 120; this.py = this.GROUND; this.vy = 0; this.onG = true; this.dir = 1;
      this.slideT = 0; this.stunT = 0; this.fallT = 0; this.combat.reset();
      this.coins = 0; this.got.clear();
      this.invulnT = 0; this.lions.length = 0; this.parts.length = 0; this.bullets.length = 0;
      for (const lt of this.LION_TRIGGERS) lt.done = false;
      this.initFoes();   // 敌人满血复位(整关重来)
    });
    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    // 屋顶金币:每栋 3 枚,奖励走上层路线
    for (const hs of this.HOUSES) for (let i = 0; i < 3; i++)
      this.coinsArr.push({ x: hs.x1 + (hs.x2 - hs.x1) * (0.25 + 0.25 * i), y: this.GROUND + hs.h + 46 });
  }
  onDestroy() {
    input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
  }
  private onKey(e: EventKeyboard) {
    if (e.keyCode === KeyCode.KEY_A || e.keyCode === KeyCode.ARROW_LEFT) this.keys.left = true;
    else if (e.keyCode === KeyCode.KEY_D || e.keyCode === KeyCode.ARROW_RIGHT) this.keys.right = true;
    else if (e.keyCode === KeyCode.SPACE || e.keyCode === KeyCode.KEY_W || e.keyCode === KeyCode.ARROW_UP) this.jump();
    else if (e.keyCode === KeyCode.KEY_J) this.attack();
    else if (e.keyCode === KeyCode.KEY_K || e.keyCode === KeyCode.KEY_L) this.slide();
  }
  private onKeyUp(e: EventKeyboard) {
    if (e.keyCode === KeyCode.KEY_A || e.keyCode === KeyCode.ARROW_LEFT) this.keys.left = false;
    else if (e.keyCode === KeyCode.KEY_D || e.keyCode === KeyCode.ARROW_RIGHT) this.keys.right = false;
  }

  private jump() {
    if (this.over || this.fallT > 0) return;   // 硬直不锁跳:跳跃永远是逃生阀,防夹缝卡死
    const j = tryJump(this.onG, this.jumpsUsed);   // 连跳判定全章共用 JumpKit
    if (!j) return;
    AudioMgr.inst.play('jump', this.onG ? 0.7 : 0.8);
    this.vy = j.vy; this.onG = false; this.jumpsUsed = j.used;
  }
  private attack() {
    if (this.over || this.slamJump || this.fallT > 0 || this.stunT > 0) return;
    const type = this.combat.tryAttack();
    if (type >= 0) this.swingId++;   // 新的一刀:每敌重新允许结算一次
    if (type === 2 && this.onG) { this.vy = JUMP.SLAM_VY; this.onG = false; this.slamJump = true; }
  }
  private slide() {
    if (this.over || !this.onG || this.slideT > 0 || this.slideCd > 0 || this.slamJump || this.fallT > 0 || this.stunT > 0) return;
    this.slideT = 0.5; this.slideCd = 0.75; this.slideDir = this.dir;
  }
  private hurt(dmg: number) {
    if (this.over) return;
    this.hp -= dmg;
    if (this.hp <= 0) { this.hp = 0; this.over = true; this.deadT = 0; this.deathFx.show(); }
  }
  private slamImpact() {
    this.slamJump = false; this.slamLandT = 0.22; this.hero.slamImpactFx(this.HERO_SX, this.py + this.HERO_DY, H / 2);
    for (const e of this.foes)   // 跳劈冲击波:附近敌人清场(纸鸢妖=跳劈靶子)
      if (e.alive && Math.abs(e.x - this.px) < 170 && e.y - this.py < 190) this.killFoe(e);
  }

  // 支撑面:脚下最高的可站面(屋顶/板车顶/断墙顶=单向平台,只算不高于参考脚高的面)
  private surfaceAt(x: number, yRef: number) {
    let s = this.GROUND;
    for (const hs of this.HOUSES) {
      const top = this.GROUND + hs.h;
      if (x >= hs.x1 - 8 && x <= hs.x2 + 8 && top <= yRef + 2 && top > s) s = top;
    }
    for (const o of this.OBST) {
      if (o.type === 'gap') continue;
      const top = this.GROUND + (o.type === 'low' ? this.CART_TOP : this.RUIN_TOP);
      const half = this.obstHalf.get(o.x) ?? 0;
      if (Math.abs(x - o.x) <= half && top <= yRef + 2 && top > s) s = top;
    }
    return s;
  }

  // ── 敌人:初始化/受击/死亡/每帧行为 ──
  private initFoes() {
    if (this.potRoot) this.potRoot.removeAllChildren();   // reset 复用:清上一批瓦罐节点
    this.foes = this.FOE_SPOTS.map(sp => ({
      kind: sp.kind, x: sp.x, y: sp.kind === 'pot' ? this.GROUND + 24 : this.GROUND + 215,
      anchor: sp.x, dir: -1, t: this.rnd(sp.x) * 6, alive: true, state: 0,
      cd: this.rnd(sp.x * 7) * 2, hitSw: -1, x0: 0, y0: 0, tx: 0, ty: 0,
      hp: sp.kind === 'pot' ? 2 : 1, flash: 0,   // 瓦罐砍 2 刀才碎
    }));
    // 檐上机枪妖:小房屋顶站岗(稻草假兵成精,守屋顶金币);y=身体中心
    for (const hs of this.HOUSES) {
      const cx = (hs.x1 + hs.x2) / 2;
      // 紧挨宽缝的两栋不设岗:跳缝滞空挨扫射=冤死(试玩阵亡点)
      if (cx === 5475) continue;   // 5294-5656,挨 5100 宽缝
      if (cx === 6405) continue;   // 6241-6569,挨 6050 星河巨缝
      this.foes.push({
        kind: 'guard', x: cx, y: this.GROUND + hs.h + 28, anchor: cx, dir: -1,
        t: this.rnd(cx) * 4, alive: true, state: 0, cd: 0.8 + this.rnd(cx * 3),
        hitSw: -1, x0: 0, y0: 0, tx: 0, ty: 0, hp: 1, flash: 0,
      });
    }
    // 瓦罐走路帧节点(每只一个 Sprite,朝向靠翻转,帧靠 t 推进)
    const dw = this.POT_DISP_H * 201 / 268;
    for (const e of this.foes) {
      if (e.kind !== 'pot') continue;
      const n = new Node('pot' + e.x); n.layer = Layers.Enum.UI_2D; n.parent = this.potRoot;
      const ut = n.addComponent(UITransform); ut.setContentSize(dw, this.POT_DISP_H); ut.setAnchorPoint(0.5, 0.08);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (this.potFrames.length) sp.spriteFrame = this.potFrames[0];
      e.sp = sp;
    }
    const gdw = this.GUARD_DISP_H * 272 / 334;
    for (const e of this.foes) {
      if (e.kind !== 'guard') continue;
      const n = new Node('guard' + e.x); n.layer = Layers.Enum.UI_2D; n.parent = this.potRoot;
      const ut = n.addComponent(UITransform); ut.setContentSize(gdw, this.GUARD_DISP_H); ut.setAnchorPoint(0.5, 0.05);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (this.guardFrames.length) sp.spriteFrame = this.guardFrames[0];
      n.active = false;   // guard未上屏先隐藏
      e.sp = sp;
    }
    const kdw = this.KITE_DISP_H * 640 / 672;
    for (const e of this.foes) {
      if (e.kind !== 'kite') continue;
      const n = new Node('kite' + e.x); n.layer = Layers.Enum.UI_2D; n.parent = this.potRoot;
      const ut = n.addComponent(UITransform); ut.setContentSize(kdw, this.KITE_DISP_H); ut.setAnchorPoint(0.5, 0.5);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (this.kiteFrame) sp.spriteFrame = this.kiteFrame;
      n.active = false;
      e.sp = sp;
    }
  }

  // 砍击(瓦罐要 2 刀):扣血,未死=受击反馈(震+喷+退),血尽=碎;非瓦罐一刀碎
  private slashFoe(e: Foe) {
    if (e.kind !== 'pot') { this.killFoe(e); return; }
    e.hp--;
    if (e.hp <= 0) { this.killFoe(e); return; }
    e.flash = 0.16;                       // 弹缩一下
    e.x += this.dir * 20;                 // 被砍击退
    e.x = Math.max(e.anchor - 120, Math.min(e.anchor + 120, e.x));
    AudioMgr.inst.play('hit', 0.55);
    this.spark(e.x + this.dir * 10, e.y + 12, new Color(210, 150, 100, 255), 5, this.dir, 1.1);   // 顺挥向喷一撮陶片
  }

  private killFoe(e: Foe) {
    e.alive = false;
    if (e.sp) e.sp.node.active = false;   // 瓦罐碎了:走路精灵收起
    this.coins += e.kind === 'pot' ? 1 : 2;   // 瓦罐=存钱罐碎铜钱;纸鸢掉双币
    AudioMgr.inst.play('hit', 0.75); AudioMgr.inst.play('coin', 0.5);
    const body = e.kind === 'pot' ? new Color(198, 138, 92, 255)
      : e.kind === 'kite' ? new Color(236, 224, 200, 255) : new Color(222, 192, 122, 255);
    const heavy = e.kind === 'pot';       // 瓦罐=陶罐炸裂,喷得猛
    this.spark(e.x, e.y + 14, body, heavy ? 16 : 7, 0, heavy ? 2.0 : 1);   // 陶片/纸屑/草屑,朝四外上炸
    if (heavy) this.spark(e.x, e.y + 14, new Color(232, 210, 176, 255), 8, 0, 1.6);   // 浅色内胎碎块
    this.spark(e.x, e.y + 10, new Color(226, 214, 255, 255), heavy ? 10 : 6, 0, heavy ? 1.5 : 1);   // 星屑(打击感统一)
  }

  // dirBias!=0 时整体偏挥砍方向喷(定向溅射);power 放大初速与上抛
  private spark(wx: number, wy: number, col: Color, n: number, dirBias = 0, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd(wx + i) * 1.2, sp = (120 + this.rnd(wy + i * 3) * 220) * power;
      this.parts.push({
        x: wx, y: wy, vx: Math.cos(a) * sp + dirBias * 140 * power, vy: Math.abs(Math.sin(a)) * sp * 0.5 + 200 * power,
        life: 0, max: 0.45 + this.rnd(i * 7 + wx) * 0.35, r: 2 + this.rnd(i * 3 + wy) * 2.6, col,
      });
    }
    if (this.parts.length > 80) this.parts.splice(0, this.parts.length - 80);
  }

  private hurtFrom(dmg: number, fromX: number) {
    if (this.over || this.invulnT > 0 || this.slideT > 0 || this.fallT > 0) return;   // 滑铲无敌(与第一章一致)
    this.invulnT = 1.1; this.stunT = Math.max(this.stunT, 0.2);
    this.px += this.px < fromX ? -56 : 56;   // 击退
    AudioMgr.inst.play('hurt', 0.8);
    this.spark(this.px, this.py + 60, new Color(255, 130, 110, 255), 6);
    this.hurt(dmg);
  }

  private stepFoes(dt: number) {
    // 挥砍命中窗(挥到中段才有锋);swingId 保证一刀一敌只结算一次
    const at = this.combat.atkTimer, ad = this.combat.atkDur;
    const s = at > 0 ? 1 - at / ad : -1;
    const canSlash = s >= 0.2 && s <= 0.8;
    for (const e of this.foes) {
      if (!e.alive) continue;
      if (e.flash > 0) e.flash -= dt;
      if (e.kind === 'pot') {
        // 瓦罐小妖:小步巡逻;见人倒腾短腿扑上来(拴在锚点附近,不追出格)
        if (Math.abs(e.x - e.anchor) > 100) e.dir = e.x > e.anchor ? -1 : 1;
        e.x += e.dir * 55 * dt; e.t += dt;   // 只巡逻,不追角色
        e.x = Math.max(e.anchor - 120, Math.min(e.anchor + 120, e.x));
        // 不踏空裂缝、不钻进房子:撞坑沿/墙沿就停外侧(留半身)并掉头返回
        const MG = 42;
        for (const o of this.OBST) {
          if (o.type !== 'gap') continue;
          const gh = (o.w ?? this.GAP_W) / 2 + MG;
          if (e.x > o.x - gh && e.x < o.x + gh) { e.x = e.dir > 0 ? o.x - gh : o.x + gh; e.dir = e.dir > 0 ? -1 : 1; }
        }
        for (const hs of this.HOUSES) {
          if (e.x > hs.x1 - MG && e.x < hs.x2 + MG) { e.x = e.dir > 0 ? hs.x1 - MG : hs.x2 + MG; e.dir = e.dir > 0 ? -1 : 1; }
        }
        if (this.slideT > 0 && Math.abs(e.x - this.px) < 54) { this.killFoe(e); continue; }   // 滑铲铲翻
        // 踩头:下落中脚踩罐顶 → 踩碎+弹起(马里奥式;踩弹后还留一段空中跳可接)
        if (!this.onG && this.vy < 0 && Math.abs(e.x - this.px) < 46 && this.py > this.GROUND + 8 && this.py < this.GROUND + 62) {
          this.killFoe(e);
          if (!this.slamJump) { this.vy = 640; this.jumpsUsed = 1; AudioMgr.inst.play('jump', 0.5); }
          continue;
        }
      } else if (e.kind === 'guard') {
        // 檐上机枪妖:原地守屋顶,人进射程就瞄准(枪口红点=躲闪预告)→一梭子点射;
        //   枪管上竖着刺刀,踩上去=挨扎,只能砍/跳劈
        e.dir = this.px < e.x ? -1 : 1; e.t += dt;
        if (e.state === 0) {
          if (e.cd > 0) e.cd -= dt;
          else if (Math.abs(this.px - e.x) < 520) { e.state = 1; e.t = 0; }
        } else if (e.state === 1) {   // 瞄准 0.5s,枪口红点渐亮
          if (e.t >= 0.5) { e.state = 2; e.t = 0; e.ty = 0; }
        } else {   // 点射 0.55s:朝面向前下方喷一梭子(不逐帧追玩家,免得随跳动乱扫)
          if (e.t >= e.ty) {
            e.ty += 0.11;
            const mx = e.x + e.dir * 30, my = e.y + 6;   // 枪口≈新帧枪管
            const ang = -0.35 + (this.rnd(e.x + e.ty * 51) - 0.5) * 0.14;   // 前下~20°,小散布
            this.bullets.push({ x: mx, y: my, vx: e.dir * Math.cos(ang) * 720, vy: Math.sin(ang) * 720 });
            AudioMgr.inst.play('hit', 0.22);
          }
          if (e.t >= 0.55) { e.state = 0; e.cd = 2.2; }
        }
      } else {
        // 纸鸢妖:檐口打转;人进圈就俯冲一口,再慢慢爬回檐口高度
        if (e.state === 0) {
          e.t += dt; if (e.cd > 0) e.cd -= dt;
          e.x += Math.sin(e.t * 0.8 + e.anchor) * 28 * dt;
          e.y = this.GROUND + 215 + Math.sin(e.t * 2.1) * 12;
          if (e.cd <= 0 && Math.abs(e.x - this.px) < 320) {
            e.state = 1; e.t = 0; e.x0 = e.x; e.y0 = e.y;
            e.tx = this.px + this.dir * 110; e.ty = this.GROUND + 46;   // 咬向人前方一个身位
          }
        } else if (e.state === 1) {   // 俯冲 0.5s(加速入)
          e.t += dt; const k = Math.min(1, e.t / 0.5), kk = k * k;
          e.x = e.x0 + (e.tx - e.x0) * kk; e.y = e.y0 + (e.ty - e.y0) * kk;
          if (k >= 1) { e.state = 2; e.t = 0; e.x0 = e.x; e.y0 = e.y; }
        } else {                      // 爬升 0.8s(减速出)
          e.t += dt; const k = Math.min(1, e.t / 0.8), kk = 1 - (1 - k) * (1 - k);
          e.x = e.x0 + 60 * kk; e.y = e.y0 + (this.GROUND + 215 - e.y0) * kk;
          if (k >= 1) { e.state = 0; e.t = this.rnd(e.x) * 5; e.cd = 2.4; }
        }
      }
      // 挥砍命中:身前一刀的弧内(纸鸢巡航高度要跳起来够,俯冲时地面就能斩)
      if (canSlash && e.hitSw !== this.swingId) {
        const fdx = (e.x - this.px) * this.dir;
        if (fdx > -30 && fdx < 140 && Math.abs(e.y - (this.py + 64)) < 100) { e.hitSw = this.swingId; this.slashFoe(e); continue; }
      }
      // 碰到掉血(滑铲/无敌帧在 hurtFrom 里免)
      if (Math.abs(e.x - this.px) < (e.kind === 'pot' ? 42 : 44) && Math.abs(e.y - (this.py + 50)) < 74)
        this.hurtFrom(e.kind === 'pot' ? 12 : 16, e.x);
    }

    // 石狮滚球:到触发点从前方滚来,遇障碍/裂缝自己蹦过去(它也懂跑酷);无敌,只能跳
    for (const lt of this.LION_TRIGGERS)
      if (!lt.done && this.px > lt.x) { lt.done = true; this.lions.push({ x: this.px + 1280, y: this.GROUND, vy: 0, onG: true, rot: 0 }); }
    for (let i = this.lions.length - 1; i >= 0; i--) {
      const li = this.lions[i];
      li.x -= 430 * dt; li.rot += 430 * dt / 34;
      if (li.onG) {
        for (const o of this.OBST) {
          const d = li.x - o.x;
          if (d > 40 && d < 175) { li.vy = o.type === 'high' ? 1040 : 720; li.onG = false; break; }
        }
      } else {
        li.vy -= JUMP.GRAVITY * dt; li.y += li.vy * dt;
        if (li.y <= this.GROUND && li.vy <= 0) { li.y = this.GROUND; li.vy = 0; li.onG = true; this.spark(li.x, this.GROUND + 6, new Color(180, 176, 168, 255), 4); }
      }
      if (Math.abs(li.x - this.px) < 54 && Math.abs(li.y + 34 - (this.py + 50)) < 76) this.hurtFrom(18, li.x);
      if (li.x < this.px - 720) this.lions.splice(i, 1);
    }

    // 曳光弹:直线飞;命中掉血;撞墙/障碍被挡(不穿墙);落街皮扬小尘
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (Math.abs(b.x - this.px) < 30 && Math.abs(b.y - (this.py + 50)) < 52) { this.hurtFrom(10, b.x); this.bullets.splice(i, 1); continue; }
      // 撞小房实心墙体(屋顶以下)或障碍(断墙/板车)→ 打在墙上,不穿过
      let blocked = false;
      for (const hs of this.HOUSES) if (b.x > hs.x1 - 4 && b.x < hs.x2 + 4 && b.y < this.GROUND + hs.h) { blocked = true; break; }
      if (!blocked) for (const o of this.OBST) {
        if (o.type === 'gap') continue;
        const half = this.obstHalf.get(o.x) ?? 60;
        const top = this.GROUND + (o.type === 'low' ? this.CART_TOP : this.RUIN_TOP);
        if (Math.abs(b.x - o.x) < half && b.y < top) { blocked = true; break; }
      }
      if (blocked) { this.spark(b.x, b.y, new Color(214, 210, 220, 255), 2); this.bullets.splice(i, 1); continue; }
      if (b.y <= this.GROUND + 2) { this.spark(b.x, this.GROUND + 4, new Color(208, 198, 172, 255), 2); this.bullets.splice(i, 1); continue; }
      if (Math.abs(b.x - this.px) > 1500 || b.y > H) this.bullets.splice(i, 1);
    }

    // 命中碎片/星屑
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt; p.vy -= 1400 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life >= p.max) this.parts.splice(i, 1);
    }
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05); this.t += dt;
    if (this.slamLandT > 0) this.slamLandT -= dt;
    if (this.slideCd > 0) this.slideCd -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.over) { this.deadT += dt; this.updateHero(); this.redraw(); return; }

    // 裂缝跌落演出:掉进星空 → 直接死(从暗检查点复活)
    if (this.fallT > 0) {
      this.fallT -= dt;
      this.py -= 620 * dt;
      if (this.fallT <= 0) {
        AudioMgr.inst.play('hurt', 0.7);
        this.hurt(9999);
      }
      this.updateHero(); this.redraw(); return;
    }

    const mv = this.stunT > 0 ? 0 : (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    if (mv) { this.dir = mv as 1 | -1; if (this.onG && this.slideT <= 0) this.walkPh += dt * 10; }
    const prevX = this.px;
    if (this.slideT > 0 && this.onG) { this.slideT -= dt; this.px += this.slideDir * this.SPEED * 1.9 * dt; }
    else this.px += mv * this.SPEED * (this.onG ? 1 : 0.85) * dt;
    this.px = Math.max(40, Math.min(this.LENGTH - 20, this.px));

    // 站着时走出屋檐 → 掉下去(屋顶=单向平台)
    if (this.onG) {
      const s = this.surfaceAt(this.px, this.py);
      if (s < this.py - 2) { this.onG = false; this.vy = 0; }
      else this.py = s;
    }
    // 重力/落地(地面或屋顶,取脚下最高支撑面)
    if (!this.onG) {
      const prevPy = this.py;
      this.vy -= JUMP.GRAVITY * dt; this.py += this.vy * dt;
      if (this.vy <= 0) {
        const s = this.surfaceAt(this.px, prevPy);   // 用下落前脚高筛掉头顶上方的面(可从屋里跳穿屋顶)
        if (prevPy >= s && this.py <= s) {
          this.py = s; this.vy = 0; this.onG = true; this.jumpsUsed = 0;
          if (this.slamJump) this.slamImpact();
        }
      }
    }

    // 小屋=实心路障:低于屋顶就被墙挡住,不能从屋前穿过(站上屋顶不受影响)
    for (const hs of this.HOUSES) {
      const top = this.GROUND + hs.h;
      if (this.px > hs.x1 - 8 && this.px < hs.x2 + 8 && this.py < top - 2) {
        this.px = this.px < (hs.x1 + hs.x2) / 2 ? hs.x1 - 8 : hs.x2 + 8;
      }
    }

    // 障碍碰撞:板车/断墙顶=可站单向面(surfaceAt 已含),擦顶=落上面跑过去;
    //   侧面=实心挡,按来向推出(绝不吸附到对侧横穿瞬移——那就是过墙一颤的元凶)
    for (const o of this.OBST) {
      const dx = this.px - o.x;
      if (o.type === 'gap') {
        // 星空裂缝:走进缝里且在地面 → 跌落(宽缝 w 另定)
        const gw = o.w ?? this.GAP_W;
        if (this.onG && this.py <= this.GROUND + 2 && Math.abs(dx) < gw / 2 - 14) {
          this.fallT = 0.55; this.onG = false; this.vy = 0;
          this.slamJump = false;
        }
        continue;
      }
      if (o.type === 'low' && this.slideT > 0) continue;   // 滑铲穿板车
      const half = this.obstHalf.get(o.x) ?? 60;
      const top = this.GROUND + (o.type === 'low' ? this.CART_TOP : this.RUIN_TOP);
      if (Math.abs(dx) < half && this.py < top - 2) {
        const side = (prevX - o.x) || dx;   // 从哪边来推回哪边
        this.px = o.x + (side >= 0 ? half : -half);
        if (o.type === 'low' && this.onG && this.stunT <= 0 && Math.abs(prevX - this.px) > 0.1) { this.stunT = 0.28; }   // 碰板车不发声(撞停硬直保留)
      }
    }

    // 街尾老井:走到井边 → 跳井转场接井关(第三章)
    if (this.px > this.LENGTH - 140 && !this.exiting) { this.exitToWell(); return; }

    // 屋顶金币拾取
    for (let i = 0; i < this.coinsArr.length; i++) {
      if (this.got.has(i)) continue;
      const c = this.coinsArr[i];
      if (Math.abs(this.px - c.x) < 32 && Math.abs(this.py + 40 - c.y) < 52) {
        this.got.add(i); this.coins++; AudioMgr.inst.play('coin', 0.6);
      }
    }

    this.stepFoes(dt);

    this.camX = this.px - this.HERO_SX;
    for (const L of this.layers) this.placeLayer(L);   // 视差贴图层跟随镜头
    for (const gp of this.gapNodes) gp.n.setPosition(this.sx(gp.x), this.GROUND + 18, 0);   // 裂缝贴图随世界滚动(口沿略高出街皮)
    for (const cn of this.cartNodes) cn.n.setPosition(this.sx(cn.x), this.GROUND - 38, 0);   // 板车贴图(沉进路中,与角色同基准)
    for (const rn of this.ruinNodes) rn.n.setPosition(this.sx(rn.x), this.GROUND - 34, 0);   // 竖立断墙贴图(沉进路中)
    for (const hn of this.houseNodes) hn.n.setPosition(this.sx(hn.x), this.GROUND - 40, 0);  // 小房贴图(沉到路边)
    this.combat.update(dt, this.HERO_SX, this.py + this.HERO_DY, this.dir);
    this.hero.updateFx(dt, this.HERO_SX, this.surfaceAt(this.px, this.py) + this.HERO_DY);
    this.controls.setSpecialCd(this.slideCd / 0.75);
    this.updateHero(); this.redraw();
    this.hud.set(this.hp, 100, this.hp, this.coins, 1);
  }

  private updateHero() {
    const sh = this.surfaceAt(this.px, this.py) + this.HERO_DY;   // 影子落在脚下支撑面(屋顶上影子贴屋顶)
    if (this.over) { this.hero.apply(this.HERO_SX, this.py + this.HERO_DY, this.dir, 'dead', this.deadT, 0, 0, 0, sh); return; }
    let mode: HeroMode = 'idle'; let p = 0;
    const a = this.combat.anim();
    if (this.fallT > 0) { mode = 'air'; }
    else if (this.slamJump) { mode = 'slam'; p = this.vy > 0 ? 0.1 : 0.5; }
    else if (this.slamLandT > 0) { mode = 'slam'; p = 0.95; }
    else if (a) { mode = a.mode; p = a.p; }
    else if (this.slideT > 0 && this.onG) { mode = 'slide'; p = 1 - this.slideT / 0.5; }
    else if (!this.onG) mode = 'air';
    else if (this.keys.left || this.keys.right) mode = 'walk';
    this.hero.apply(this.HERO_SX, this.py + this.HERO_DY, this.dir, mode, p, -this.vy, this.walkPh, 0, sh);
  }

  // ── 视差贴图层(同第一章 makeScrollLayer 套路:三瓦片循环;平滑图用 LINEAR)──
  private layers: { tiles: Node[]; w: number; par: number; y: number; h: number }[] = [];
  private makeLayer(res: string, dispH: number, par: number, bottomY: number, parent: Node) {
    const L = { tiles: [] as Node[], w: 0, par, y: bottomY, h: dispH };
    for (let i = 0; i < 3; i++) {
      const n = new Node('bg-' + res + i); n.layer = Layers.Enum.UI_2D; n.parent = parent;
      n.addComponent(UITransform).setAnchorPoint(0, 0);
      n.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
      L.tiles.push(n);
    }
    this.layers.push(L);
    AssetHub.loadSF(res, (sf) => {
      if (!sf) return;   // 缺图静默:程序化背景已删,只会是暂时黑,图进 resources 即好
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      L.w = sf.rect.width * (dispH / sf.rect.height);
      for (const t of L.tiles) { t.getComponent(Sprite)!.spriteFrame = sf; t.getComponent(UITransform)!.setContentSize(L.w, dispH); }
      this.placeLayer(L);
    });
  }
  private placeLayer(L: { tiles: Node[]; w: number; par: number; y: number }) {
    if (!L.w) return;
    const off = (((this.camX * L.par) % L.w) + L.w) % L.w;
    for (let i = 0; i < L.tiles.length; i++) L.tiles[i].setPosition(-W / 2 - off + i * L.w, L.y, 0);
  }

  // 棉絮雾团:底晕一层 + 4 圆错落呼吸(轻量版:5 次填充/团,原 12 次)
  private fogBank(g: Graphics, cx: number, cy: number, s: number, a: number, seed: number) {
    g.fillColor = new Color(215, 214, 226, Math.round(a * 0.5));
    g.ellipse(cx, cy - s * 0.08, s * 1.4, s * 0.5); g.fill();
    for (let k = 0; k < 4; k++) {
      const kr = this.rnd(seed + k * 13);
      const px = cx + (k - 1.5) * s * 0.55 + Math.sin(this.t * 0.5 + seed + k * 1.9) * s * 0.09;
      const py = cy + (this.rnd(seed + k * 7) - 0.5) * s * 0.3 + Math.sin(this.t * 0.7 + seed * 2 + k) * s * 0.07;
      g.fillColor = new Color(215, 214, 226, a); g.circle(px, py, s * (0.32 + kr * 0.26)); g.fill();
    }
  }

  // 稳定伪随机(按种子)
  private rnd(s: number) { return ((Math.sin(s * 127.1) * 43758.5) % 1 + 1) % 1; }
  private sx(wx: number) { return wx - this.camX; }

  private redraw() {
    const g = this.g; g.clear();
    const gy = this.GROUND;
    // 天空/远景/中景/近景/地面/前景 = 五层 AI 贴图(makeLayer),程序化版已退役

    // 大雾(寂静岭)之一——中层漂流雾团(静态雾幕在专属层,只画一次)
    const fm = this.fogMid; fm.clear();
    for (let i = 0; i < 4; i++) {   // 视差 0.5,统一往左飘
      const sd = this.rnd(i + 700);
      const span = W + 1100;
      const cx = span / 2 - ((i * 1450 + this.t * (16 + sd * 12) + this.camX * 0.5) % span + span) % span;
      this.fogBank(fm, cx, gy + 70 + sd * 230, 190 + sd * 130, 30, i + 700);
    }
    for (let i = 0; i < 3; i++) {   // 长条雾丝(拉出流动方向感)
      const sd = this.rnd(i + 720);
      const span = W + 900;
      const cx = span / 2 - ((i * 1200 + this.t * (26 + sd * 14) + this.camX * 0.5) % span + span) % span;
      fm.fillColor = new Color(216, 215, 227, 26);
      fm.ellipse(cx, gy + 120 + sd * 200, 420 + sd * 200, 22 + sd * 14); fm.fill();
    }

    // 大雾之二——街面雾:漫过街皮压到路面,贴地翻涌
    g.fillColor = new Color(213, 213, 223, 48); g.rect(-W / 2, gy - 44, W, 210); g.fill();
    for (let i = 0; i < 3; i++) {
      const sd = this.rnd(i + 730);
      const span = W + 800;
      const cx = span / 2 - ((i * 1050 + this.t * (22 + sd * 14) + this.camX) % span + span) % span;
      this.fogBank(g, cx, gy - 4 + Math.sin(this.t * 0.5 + i * 2) * 12, 130 + sd * 90, 30, i + 730);
    }

    // 电线杆 + 垂坠电线(怪诞:歪杆、松弛的线,偶尔挂一盏小灯笼)
    const POLE_GAP = 520;
    const poleN = Math.ceil(this.LENGTH / POLE_GAP) + 1;
    const poleX = (i: number) => i * POLE_GAP + 240;
    const poleTilt = (i: number) => (this.rnd(i + 300) - 0.5) * 34;
    const poleTop = (i: number) => gy + 430 + this.rnd(i + 301) * 60;
    const inHouse = (wx: number) => this.HOUSES.some(hs => wx > hs.x1 - 40 && wx < hs.x2 + 40);
    for (let i = 0; i < poleN; i++) {
      const wx = poleX(i); const ox = this.sx(wx);
      if (ox < -W / 2 - 80 || ox > W / 2 + 80 || inHouse(wx)) continue;
      const tp = poleTop(i), tl = poleTilt(i);
      g.fillColor = new Color(28, 20, 42, 60); g.ellipse(ox, gy - 2, 16, 5); g.fill();   // 杆脚影
      g.strokeColor = new Color(52, 44, 64, 255); g.lineWidth = 7;
      g.moveTo(ox, gy); g.lineTo(ox + tl, tp); g.stroke();
      g.lineWidth = 4;   // 两根歪横担
      g.moveTo(ox + tl - 34, tp - 16); g.lineTo(ox + tl + 34, tp - 10); g.stroke();
      g.moveTo(ox + tl - 26, tp - 46); g.lineTo(ox + tl + 26, tp - 42); g.stroke();
    }
    for (let i = 0; i + 1 < poleN; i++) {
      const x1 = this.sx(poleX(i)) + poleTilt(i), x2 = this.sx(poleX(i + 1)) + poleTilt(i + 1);
      if (Math.max(x1, x2) < -W / 2 - 40 || Math.min(x1, x2) > W / 2 + 40) continue;
      const y1b = poleTop(i), y2b = poleTop(i + 1);
      for (let k = 0; k < 3; k++) {
        const y1 = y1b - 12 - k * 16, y2 = y2b - 12 - k * 16;
        const sag = 60 + k * 16 + this.rnd(i * 3 + k) * 20 + Math.sin(this.t * 0.9 + i + k) * 3;
        g.strokeColor = new Color(46, 40, 58, 235); g.lineWidth = 2;
        g.moveTo(x1, y1);
        g.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - sag, x2, y2);
        g.stroke();
      }
    }
    // 临街塔楼:本体=city-house 贴图节点,这里只画接触影(剖面小屋程序绘制已退役)
    for (const hs of this.HOUSES) {
      const x1 = this.sx(hs.x1), x2 = this.sx(hs.x2);
      if (x2 < -W / 2 - 60 || x1 > W / 2 + 60) continue;
      g.fillColor = new Color(28, 20, 42, 70); g.ellipse((x1 + x2) / 2, gy - 41, (x2 - x1) / 2 + 30, 9); g.fill();
    }
    // 障碍四件套
    for (const o of this.OBST) {
      const ox = this.sx(o.x);
      if (ox < -W / 2 - 160 || ox > W / 2 + 160) continue;
      if (o.type === 'low') {
        // 翻倒板车:本体=city-cart 贴图节点,这里只画接触影
        g.fillColor = new Color(28, 20, 42, 78); g.ellipse(ox, gy - 39, 78, 9); g.fill();
      } else if (o.type === 'high') {
        // 竖立断墙:本体=city-ruin 贴图节点,这里只画接触影
        g.fillColor = new Color(28, 20, 42, 78); g.ellipse(ox, gy - 35, 68, 8); g.fill();
      } else if (o.type === 'gap') {
        // 星空裂缝:洞体=city-gap 贴图节点,这里只叠程序闪星(贴图是静的,闪要靠代码)
        const gw = o.w ?? this.GAP_W;
        const stars = Math.round(gw / 14);
        for (let s2 = 0; s2 < stars; s2++) {
          const tw = 0.5 + 0.5 * Math.sin(this.t * 3 + s2 * 2.1 + o.x);
          const sxx = ox - gw / 2 + 20 + this.rnd(o.x + s2 * 7) * (gw - 40);
          const syy = gy - 24 - this.rnd(o.x * 3 + s2) * 340;   // 一直闪到深处
          g.fillColor = new Color(220, 225, 255, Math.round(120 + 120 * tw));
          g.circle(sxx, syy, 1.5 + tw * 1.5); g.fill();
        }
      }
    }
    // 屋顶金币(吃过的不画)
    for (let i = 0; i < this.coinsArr.length; i++) {
      if (this.got.has(i)) continue;
      const c = this.coinsArr[i];
      const cx = this.sx(c.x);
      if (cx < -W / 2 - 20 || cx > W / 2 + 20) continue;
      const bob = Math.sin(this.t * 3 + i) * 4;
      g.fillColor = new Color(255, 214, 96, 255); g.circle(cx, c.y + bob, 10); g.fill();
      g.fillColor = new Color(255, 245, 200, 255); g.circle(cx - 3, c.y + bob + 3, 3.5); g.fill();
    }
    // 街尾老井(第三章入口)
    {
      const wx = this.sx(this.LENGTH - 40);
      if (wx > -W / 2 - 200 && wx < W / 2 + 200) {
        g.fillColor = new Color(28, 20, 42, 78); g.ellipse(wx, gy - 2, 64, 10); g.fill();   // 井座影
        g.fillColor = new Color(112, 108, 124, 255); g.rect(wx - 52, gy, 104, 54); g.fill();
        g.fillColor = new Color(88, 84, 100, 255); g.rect(wx - 58, gy + 54, 116, 10); g.fill();
        g.strokeColor = new Color(72, 68, 84, 255); g.lineWidth = 3;
        for (let k = 0; k < 4; k++) { g.moveTo(wx - 52 + k * 30, gy); g.lineTo(wx - 52 + k * 30, gy + 54); g.stroke(); }
        // 井口幽光
        const gl = 0.6 + 0.4 * Math.sin(this.t * 2.4);
        g.fillColor = new Color(150, 230, 210, Math.round(70 * gl));
        g.ellipse(wx, gy + 70, 46, 18); g.fill();
        g.fillColor = new Color(150, 230, 210, Math.round(40 * gl));
        g.ellipse(wx, gy + 84, 30, 26); g.fill();
      }
    }
    this.drawFoes();
    this.drawAtmo();
  }

  // ── 敌人绘制(程序化占位,后续换 AI 帧图):怪诞锚=歪、一大一小眼 ──
  private drawFoes() {
    const g = this.foeG; g.clear();
    const gy = this.GROUND;
    for (const e of this.foes) {
      if (!e.alive) continue;
      const ox = this.sx(e.x);
      if (e.kind === 'pot') {
        // 瓦罐小妖:AI 走路帧(city-pot-walk)——精灵节点显示,朝向翻转,扑人时帧速加快
        const sp = e.sp;
        if (sp) {
          const on = ox > -W / 2 - 90 && ox < W / 2 + 90;
          sp.node.active = on;
          if (on) {
g.fillColor = new Color(28, 20, 42, 60); g.ellipse(ox, gy - 2, 22, 6); g.fill();
            sp.node.setPosition(ox, gy, 0);
            const k = e.flash > 0 ? 1 + e.flash * 1.1 : 1;   // 受击弹缩(打击感)
            sp.node.setScale(e.dir * k, k, 1);   // dir=-1 朝左=水平翻
            const fr = Math.floor(e.t * 8) % 8;   // 帧速固定,不随玩家
            if (this.potFrames.length) sp.spriteFrame = this.potFrames[fr];
          }
        }
        continue;
      }
      if (e.kind === 'guard') {
        // 檐上机枪妖:AI帧(city-guard 4姿态),屏外隐藏,红点/火舌程序叠枪口
        const sp = e.sp;
        const on = ox > -W / 2 - 90 && ox < W / 2 + 90;
        if (sp) sp.node.active = on;
        if (!on) continue;
        const fy = e.y - 28;
        if (sp) {
g.fillColor = new Color(28, 20, 42, 58); g.ellipse(ox, fy - 2, 20, 6); g.fill();
          sp.node.setPosition(ox, fy, 0);
          sp.node.setScale(e.dir, 1, 1);
          if (this.guardFrames.length) {
            const gf = e.state === 2 ? 1 + Math.floor(this.t * 12) % 3 : 0;
            sp.spriteFrame = this.guardFrames[Math.min(gf, this.guardFrames.length - 1)];
          }
        }
        const mx = ox + e.dir * 30, my = fy + 34;   // 枪口≈新帧枪管
        if (e.state === 1) {
          const k = Math.min(1, e.t / 0.5);
          g.fillColor = new Color(255, 90, 70, Math.round(90 + 165 * k)); g.circle(mx, my, 2.5 + k * 2); g.fill();
        } else if (e.state === 2) {
          const fl = 0.6 + 0.4 * Math.sin(this.t * 60);
          g.fillColor = new Color(255, 210, 120, 230); g.circle(mx + e.dir * 4, my, 5 + fl * 3); g.fill();
          g.fillColor = new Color(255, 245, 200, 255); g.circle(mx, my, 3 + fl * 2); g.fill();
        }
        continue;
      }
      {
        // 纸鸢妖:AI帧(city-kite),屏外隐藏,俯冲前倾,朝向翻转
        const sp = e.sp;
        const on = ox > -W / 2 - 90 && ox < W / 2 + 90;
        if (sp) sp.node.active = on;
        if (!on) continue;
        if (sp) {
g.fillColor = new Color(28, 20, 42, 40); g.ellipse(ox, e.y - this.KITE_DISP_H * 0.44, 15, 5); g.fill();
          sp.node.setPosition(ox, e.y, 0);
          const face = this.px < e.x ? -1 : 1;
          const tilt = e.state === 1 ? face * 32 : Math.sin(this.t * 3 + e.anchor) * 6;
          sp.node.setScale(-face, 1, 1);   // 朝向翻转(图默认反向)
          sp.node.angle = tilt;
        }
      }
    }
    // 石狮滚球:石球+一圈石鬃(随滚动转)+凶脸朝滚向
    for (const li of this.lions) {
      const ox = this.sx(li.x);
      if (ox < -W / 2 - 90 || ox > W / 2 + 90) continue;
      const cy = li.y + 34;
      g.fillColor = new Color(28, 20, 42, 66); g.ellipse(ox, gy - 2, 30, 6); g.fill();   // 影留地面
      g.fillColor = new Color(148, 148, 158, 255); g.circle(ox, cy, 34); g.fill();
      g.fillColor = new Color(124, 124, 136, 255);
      for (let k = 0; k < 8; k++) { const a = li.rot * 0.9 + k * Math.PI / 4; g.circle(ox + Math.cos(a) * 29, cy + Math.sin(a) * 29, 6.5); }
      g.fill();
      g.fillColor = new Color(245, 242, 235, 255);
      g.circle(ox - 13, cy + 6, 6); g.circle(ox - 1, cy + 9, 4); g.fill();
      g.fillColor = new Color(30, 24, 40, 255);
      g.circle(ox - 15, cy + 6, 2.6); g.circle(ox - 2, cy + 9, 1.8); g.fill();
      g.strokeColor = new Color(96, 96, 108, 255); g.lineWidth = 3;   // 眉+咧嘴
      g.moveTo(ox - 20, cy + 14); g.lineTo(ox - 9, cy + 11); g.stroke();
      g.moveTo(ox - 22, cy - 4); g.quadraticCurveTo(ox - 12, cy - 12, ox - 2, cy - 6); g.stroke();
      g.fillColor = new Color(245, 242, 235, 255);   // 小獠牙
      g.moveTo(ox - 18, cy - 7); g.lineTo(ox - 15, cy - 13); g.lineTo(ox - 12, cy - 7); g.close(); g.fill();
    }
    // 曳光弹:亮头拖尾,沿速度方向摆
    for (const b of this.bullets) {
      const ox = this.sx(b.x);
      if (ox < -W / 2 - 60 || ox > W / 2 + 60) continue;
      const d = Math.max(1, Math.hypot(b.vx, b.vy));
      const nx = b.vx / d, ny = b.vy / d;
      g.strokeColor = new Color(255, 216, 140, 235); g.lineWidth = 3;
      g.moveTo(ox - nx * 12, b.y - ny * 12); g.lineTo(ox + nx * 6, b.y + ny * 6); g.stroke();
      g.fillColor = new Color(255, 246, 214, 255); g.circle(ox + nx * 6, b.y + ny * 6, 2.2); g.fill();
    }

    // 命中碎片/星屑
    for (const p of this.parts) {
      const ox = this.sx(p.x);
      if (ox < -W / 2 - 20 || ox > W / 2 + 20) continue;
      const a = 1 - p.life / p.max;
      g.fillColor = new Color(p.col.r, p.col.g, p.col.b, Math.round(235 * a));
      g.circle(ox, p.y, p.r * (0.6 + a * 0.5)); g.fill();
    }
  }

  // 顶层氛围(角色之上):前景雾团 + 飘尘微光 + 打旋纸片 + 冷紫暗角
  private drawAtmo() {
    const g = this.fgG; g.clear();
    // 大雾之三——前景雾团:从角色面前擦过(寂静岭"人在雾里走"),棉絮团簇+雾丝
    for (let i = 0; i < 3; i++) {
      const sd = this.rnd(i + 760);
      const span = W + 1500;
      const cx = span / 2 - ((i * 1750 + this.t * (30 + sd * 18) + this.camX * 1.1) % span + span) % span;
      const cy = -H / 2 + 170 + sd * H * 0.58 + Math.sin(this.t * 0.4 + i * 2.2) * 30;
      this.fogBank(g, cx, cy, 200 + sd * 150, 22, i + 760);
    }
    for (let i = 0; i < 3; i++) {
      const sd = this.rnd(i + 780);
      const span = W + 1100;
      const cx = span / 2 - ((i * 1300 + this.t * (40 + sd * 20) + this.camX * 1.1) % span + span) % span;
      g.fillColor = new Color(218, 217, 228, 18);
      g.ellipse(cx, -H / 2 + 240 + sd * H * 0.5, 480 + sd * 240, 26 + sd * 16); g.fill();
    }
    const SPAN = W + 160;
    for (let i = 0; i < 22; i++) {   // 飘尘:缓慢横漂的微光尘
      const sd = this.rnd(i + 500);
      const px = ((i * 613 + this.t * (8 + sd * 16) - this.camX * 1.05) % SPAN + SPAN) % SPAN - SPAN / 2;
      const py = -H / 2 + 100 + this.rnd(i + 501) * H * 0.72 + Math.sin(this.t * 0.7 + i) * 14;
      const tw = 0.5 + 0.5 * Math.sin(this.t * (0.6 + sd) + i * 1.7);
      g.fillColor = new Color(238, 232, 248, Math.round(26 + 58 * tw));
      g.circle(px, py, 1.4 + sd * 1.8); g.fill();
    }
    for (let i = 0; i < 6; i++) {   // 纸片:打着旋往下飘(全城人消失时没来得及收的纸)
      const sd = this.rnd(i + 540);
      const fy = H / 2 - ((this.t * (30 + sd * 26) + sd * 900) % (H + 240)) + 120;
      const fx2 = ((i * 1160 + sd * 500 - this.camX * 1.05) % SPAN + SPAN) % SPAN - SPAN / 2 + Math.sin(this.t * 1.1 + i * 2) * 34;
      const rot = this.t * (1.2 + sd) + i, cs = Math.cos(rot), sn = Math.sin(rot);
      const pw = 5 + sd * 3, ph2 = 7 + sd * 3;
      g.fillColor = new Color(236, 230, 214, 130);
      g.moveTo(fx2 + cs * pw - sn * ph2, fy + sn * pw + cs * ph2);
      g.lineTo(fx2 - cs * pw - sn * ph2, fy - sn * pw + cs * ph2);
      g.lineTo(fx2 - cs * pw + sn * ph2, fy - sn * pw - cs * ph2);
      g.lineTo(fx2 + cs * pw + sn * ph2, fy + sn * pw - cs * ph2);
      g.close(); g.fill();
    }
    // 冷紫暗角:顶压一档、底压一档、左右轻收(电影感)
    g.fillColor = new Color(40, 32, 64, 26); g.rect(-W / 2, H / 2 - H * 0.12, W, H * 0.12); g.fill();
    g.fillColor = new Color(40, 32, 64, 14); g.rect(-W / 2, H / 2 - H * 0.22, W, H * 0.22); g.fill();
    g.fillColor = new Color(20, 16, 36, 30); g.rect(-W / 2, -H / 2, W, H * 0.09); g.fill();
    g.fillColor = new Color(30, 24, 52, 18); g.rect(-W / 2, -H / 2, W * 0.06, H); g.fill();
    g.fillColor = new Color(30, 24, 52, 18); g.rect(W / 2 - W * 0.06, -H / 2, W * 0.06, H); g.fill();
  }

  // 跳井 → 黑幕 → 井关(第三章,现成的投井开场)
  private exitToWell() {
    if (this.exiting) return; this.exiting = true;
    const parent = this.node.parent!;
    const fade = new Node('city-fade'); fade.layer = Layers.Enum.UI_2D; fade.parent = parent;
    fade.addComponent(UITransform).setContentSize(W, H);
    const fg = fade.addComponent(Graphics); fg.fillColor = new Color(0, 0, 0, 255); fg.rect(-W / 2, -H / 2, W, H); fg.fill();
    const op = fade.addComponent(UIOpacity); op.opacity = 0;
    tween(op).to(0.5, { opacity: 255 }).call(() => {
      this.node.destroy();
      const n = new Node('Chapter2'); n.layer = Layers.Enum.UI_2D; n.addComponent(UITransform); n.parent = parent;
      n.addComponent(Chapter2Well);
      fade.setSiblingIndex(parent.children.length - 1);
      tween(op).delay(0.1).to(0.45, { opacity: 0 }).call(() => fade.destroy()).start();
    }).start();
  }
}
