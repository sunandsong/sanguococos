import {
  _decorator, Component, Node, Graphics, Color, UITransform, Layers, Label,
  input, Input, EventKeyboard, KeyCode, UIOpacity, tween,
} from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { HeroRig, HeroMode } from './HeroRig';
import { HeroCombat } from './HeroCombat';
import { TouchControls } from './TouchControls';
import { HeroHUD } from './HeroHUD';
import { DeathFx } from './DeathFx';
import { CamZoom } from './CamZoom';
import { AudioMgr } from './AudioMgr';
import { AssetHub } from './AssetHub';
import { Sprite, SpriteFrame, Rect, Texture2D } from 'cc';
import { Chapter2Well } from './Chapter2Well';

const { ccclass } = _decorator;

// ─────────────────────────────────────────────────────────────
// 第二章 · 雾中竞技场(铁心兽 Boss 战)
//   空城街尾走进浓雾 → 到这;圆形广场,纵深带走位(摇杆上下=换深度线)。
//   铁心兽:锅炉身+独立旋转机枪臂+烟囱弹舱;锁线扫射/扇扫/炸弹红圈/冲撞自晕/三阶段核心。
//   打赢 → 雾散老井显形 → 走到井边跳井 → 接井关。套件全复用。
// ─────────────────────────────────────────────────────────────

type Bullet = { x: number; d: number; vx: number; y0?: number; t?: number };
type Bomb = { st: 'fly' | 'back'; x: number; y: number; tx: number; td: number; vx: number; vy: number; t: number; T: number };
type Zone = { x: number; d: number; life: number; max: number };
type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; col: Color };

@ccclass('Chapter2Arena')
export class Chapter2Arena extends Component {
  private world!: Node; private cam!: CamZoom;
  private bgG!: Graphics;      // 背景+地面(每帧重画,含动效)
  private bossG!: Graphics;    // Boss 本体(独立节点,参与与主角的前后排序)
  private bossFrames: SpriteFrame[] = [];   // 铁心兽2帧:闭嘴待机/张嘴吼
  private bossSp: Sprite | null = null;
  private bossOK = false;
  private _bwalk = 0; private _lastBx = 0;   // Boss走动摇摆相位
  private readonly BOSS_H = 240;   // Boss显示高(帧712等比缩)
  private bossAsp = 1;                        // 帧宽高比(烟囱定位用)
  private bossTrackFrames: SpriteFrame[] = []; // 履带条(残影用)
  private trackGhosts: Sprite[] = [];          // 履带运动残影
  private smoke: { x: number; y: number; vx: number; r0: number; t: number; max: number; dark: boolean }[] = [];
  private smokeT = 0; private smokeCi = 0;
  private dustFrames: SpriteFrame[] = [];      // 履带尘雾3帧
  private dustPool: Sprite[] = [];
  private dusts: { x: number; y: number; t: number; max: number; sc: number; fl: number; dir: number }[] = [];
  private dustT = 0; private _dustLastBx = 0;
  private boomFrames: SpriteFrame[] = [];      // 爆炸4帧
  private boomPool: Sprite[] = [];
  private booms: { x: number; y: number; t: number; max: number; sc: number }[] = [];
  private _dieBoomT = 0; private _dieBigDone = false;
  private bombSF: SpriteFrame | null = null;   // 炸弹真图
  private bombPool: Sprite[] = [];
  private _bhitT = 0;   // Boss受击闪白/弹缩
  private gunSp: Sprite | null = null;   // 机枪臂(独立旋转真图)
  private gunAsp = 1; private _muzzT = 0;
  private discOK = false;             // (弃)新石盘
  private yardOK = false;             // 机车库整景图已就位:代码只画动效
  private cartN: Node | null = null;  // 左上角小推车(空城图复用)
  private readonly GUN_FX = 0.76;   // 枪座:帧内横向比例
  private readonly GUN_FY = 0.56;   // 枪座:高度比例(自底)
  private readonly GUN_SC = 0.88;   // 枪臂缩放
  /** 爆炸一响(x/y 世界坐标,sc 大小倍率) */
  private boomAt(x: number, y: number, sc: number) {
    if (this.booms.length >= 8) this.booms.shift();
    this.booms.push({ x, y, t: 0, max: 0.42, sc });
  }

  /** 出膛:从枪口发射,保证起点在玩家来路一侧(贴脸时不穿到身后) */
  private fireBullet(d: number) {
    const mp = this.muzzlePos();
    const bdir = this.px < this.bx ? -1 : 1;
    let sx2 = mp.x;
    if (bdir < 0) sx2 = Math.max(sx2, this.px + 50);
    else sx2 = Math.min(sx2, this.px - 50);
    this.bullets.push({ x: sx2, d, vx: 760 * bdir, y0: mp.y, t: 0 });
    this._muzzT = 0.07;
  }

  /** 枪口世界坐标(随瞄准角) */
  private muzzlePos() {
    const s = this.dsc(this.bd) * 1.05, face = this.px < this.bx ? 1 : -1;
    const BW = this.BOSS_H * this.bossAsp;
    const gx = this.bx + (this.GUN_FX - 0.5) * BW * s * face;
    const gy = this.dy(this.bd) - 10 + this.GUN_FY * this.BOSS_H * s;
    const ml = 100 * this.gunAsp * (this.GUN_SC * s) * 0.80;
    return { x: gx + Math.cos(this.gunA) * ml, y: gy + Math.sin(this.gunA) * ml };
  }
  // 烟囱口位置(帧内比例:x, 距顶y)——图默认朝左,烟囱在右侧
  private readonly CHIM: [number, number][] = [[0.66, 0.13], [0.76, 0.115], [0.86, 0.18]];
  private heroWrap!: Node;     // 主角容器(按深度缩放/定位,HeroRig 挂里面)
  private fxG!: Graphics;      // 子弹/炸弹/火区/粒子/白光(最上层)
  private hero!: HeroRig; private combat!: HeroCombat;
  private controls!: TouchControls; private hud!: HeroHUD; private deathFx!: DeathFx;
  private bossLbl!: Label;
  private propsG!: Graphics;           // 道具层(栏杆/灯柱/废件/井/掩体):压在地板图之上、角色之下
  private plazaOK = false;             // 广场真图已就位(arena-floor):跳过程序画的地面
  private cityBgOK = false;           // 空城三层背景图已就位:跳过程序画的城影/钟楼/电线
  private skyOK = false;              // 天空整图已就位:跳过代码天色/星/齿轮月
  private frontOK = false;            // 前景框图已就位:跳过代码瓦砾剪影带
  private wallOK = false;             // 围墙真图已就位(arena-wall-back/front):跳过代码画的石墙圈
  private covers: { x: number; d: number; hp: number }[] = [];   // 石墩掩体:挡机枪子弹,打3下碎,冲撞直接碾碎

  // 纵深带:d 0=近(下/大) 1=远(上/小);椭圆压斜(比例≈0.73,跟地板图原生透视一致)
  private readonly SCENE_A = true;  // 场景:机车库车间(整景图 arena-yard)
  private readonly CY = this.SCENE_A ? -174 : -H * 0.14;            // 场心(=图中轨道中线)
  private readonly RXV = 348; private readonly RYV = 170;          // 视觉椭圆=围墙基线(台基/城影/兜底都对齐它)
  private readonly RXW = 262; private readonly RYW = 128;           // 行走椭圆(内收留墙距,半身量谁也贴不到墙)
  private readonly NEAR_Y = this.SCENE_A ? -510 : this.CY - this.RYW * 0.92;   // 近沿=岩浆壳上
  private readonly FAR_Y = this.SCENE_A ? 78 : this.CY + this.RYW * 0.92;     // 远沿=墙脚
  private dy(d: number) { return this.NEAR_Y + (this.FAR_Y - this.NEAR_Y) * d; }
  /** 深度 d 处的行走半宽(椭圆边界):圆形场地,越靠上下沿越窄 */
  private maxX(d: number) { if (this.SCENE_A) return 288; const yy = this.dy(d) - this.CY; const k = 1 - (yy / this.RYW) * (yy / this.RYW); return k > 0 ? this.RXW * Math.sqrt(k) : 0; }
  private dsc(d: number) { return (1 - d * 0.05) * 0.74; }   // 近大远小仅差5%
  private rnd(s: number) { return ((Math.sin(s * 127.1) * 43758.5) % 1 + 1) % 1; }
  // 围墙+圆盘合成图共用画布几何(圆盘已直接烘进 arena-floor,前半圈墙单独一张同画布遮挡)
  private readonly WALL_W = 700;
  private readonly WALL_H = 700 * 1765 / 1444;                          // 台基砖壁一路砌到屏幕底(墙加高·内容感知拉伸)
  private readonly WALL_Y = this.CY - (700 * 1765 / 1444) / 2 + 564 * (700 / 1444);   // 墙基椭圆中心(图内y=564)对齐场心

  // 主角
  private px = 0; private pd = 0.5; private ph2 = 0; private pvh = 0; private dir = 1;
  private hp = 100; private inv = 0; private walkPh = 0; private over = false; private deadT = 0;
  private axisY = 0; private coins = 0;
  private slamJump = false; private slamLandT = 0;
  private keys = { left: false, right: false, up: false, down: false };

  // Boss
  private bx = 0; private bd = 0.5; private bhp = 600; private readonly BHP = 600;
  private bst = 'intro'; private bstT = 1.4; private aimD = 0.5; private fanD = 0; private sweepDir = 1;
  private stun = 0; private bph = 0; private gunA = Math.PI; private fireT = 0; private bombN = 1;
  private charging = false; private chDir = -1; private coreOpen = false;
  private bDead = false; private bDeadT = 0;

  private bullets: Bullet[] = []; private bombs: Bomb[] = []; private zones: Zone[] = [];
  private parts: Part[] = []; private flashes: { x: number; y: number; life: number; max: number }[] = [];
  private t = 0; private shake = 0; private hitStop = 0; private slow = 0;
  private win = false; private exiting = false;

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    this.world = new Node('ar-world'); this.world.layer = Layers.Enum.UI_2D; this.world.parent = this.node; this.world.addComponent(UITransform);
    this.cam = new CamZoom(this.world);

    const bgN = new Node('ar-bg'); bgN.layer = Layers.Enum.UI_2D; bgN.parent = this.world; bgN.addComponent(UITransform);
    this.bgG = bgN.addComponent(Graphics);

    // 机车库整景图(方案A):墙+铁地+岩浆一张全包
    AssetHub.loadSF('arena-yard', (sf) => {
      if (!sf || !this.SCENE_A) return;
      const n = new Node('ar-yard'); n.layer = Layers.Enum.UI_2D; n.parent = this.world;
      const u = n.addComponent(UITransform); u.setAnchorPoint(0.5, 0.5);
      u.setContentSize(1000, 1000 * sf.rect.height / sf.rect.width);   // 含140px出血,中央720区=设计屏
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
      n.setPosition(0, 0, 0);
      n.setSiblingIndex(bgN.getSiblingIndex() + 1);
      this.yardOK = true;
    });
    // 左上角小推车(复用空城的图,场景点缀)
    AssetHub.loadSF('city-cart', (sf) => {
      if (!sf || !this.SCENE_A) return;
      const n = new Node('ar-cart'); n.layer = Layers.Enum.UI_2D; n.parent = this.world;
      const u = n.addComponent(UITransform); u.setAnchorPoint(0.5, 0);
      const dw = 150;
      u.setContentSize(dw, dw * sf.rect.height / sf.rect.width);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
      sp.color = new Color(235, 230, 242, 255);   // 夜色微调(轻)
      n.setPosition(240, 86, 0);                  // 右上角,墙脚边
      n.setSiblingIndex(bgN.getSiblingIndex() + 2);
      this.cartN = n;
    });
    // 天空整图槽位(arena-sky,可选):有图就盖掉代码画的天色/星/齿轮月
    const bgNRef = bgN;
    AssetHub.loadSF('arena-sky', (sf) => {
      if (!sf || this.SCENE_A) return;
      const n = new Node('ar-sky'); n.layer = Layers.Enum.UI_2D; n.parent = this.world;
      const u = n.addComponent(UITransform); u.setAnchorPoint(0.5, 0.5); u.setContentSize(W + 40, H + 40);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
      n.setPosition(0, 0, 0);
      n.setSiblingIndex(bgNRef.getSiblingIndex() + 1);
      this.skyOK = true;
    });
    // 前景框槽位(arena-front,可选):瓦砾/栏杆/杂草的近景暗框,压在世界最前
    AssetHub.loadSF('arena-front', (sf) => {
      if (!sf || this.SCENE_A) return;
      const n = new Node('ar-front'); n.layer = Layers.Enum.UI_2D; n.parent = this.world;
      const u = n.addComponent(UITransform); u.setAnchorPoint(0.5, 0); u.setContentSize(W + 40, (W + 40) * sf.rect.height / sf.rect.width);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
      n.setPosition(0, -H / 2 - 6, 0);
      this.frontOK = true;   // 追加在 world 末尾=最前
    });
    // 背景=空城本身:复用空城三层城景图(far/mid/near),锁场静置,风格与跑酷段无缝衔接
    const cityN = new Node('ar-citybg'); cityN.layer = Layers.Enum.UI_2D; cityN.parent = this.world; cityN.addComponent(UITransform);
    const RIM_TOP = this.CY + this.RYV;   // 广场远沿:城影踩在沿上
    const layers: [string, number, number][] = [['bg-far-city', 0.62, 150], ['bg-mid-city', 0.78, 128], ['bg-near-city', 0.95, 100]];
    for (const [res, k, by] of layers) {
      AssetHub.loadSF(res, (sf) => {
        if (!sf || this.SCENE_A) return;
        const n = new Node('ar-' + res); n.layer = Layers.Enum.UI_2D; n.parent = cityN;
        const u = n.addComponent(UITransform); u.setAnchorPoint(0.5, 0);
        const dw = W + 100, dh = dw * sf.rect.height / sf.rect.width * k;
        u.setContentSize(dw, dh);
        const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
        n.setPosition(0, RIM_TOP - by, 0);
        this.cityBgOK = true;
      });
    }
    // 广场地板真图(AI 生成,椭圆已抠透明):插在城景之上、道具之下
    AssetHub.loadSF('arena-floor', (sf) => {
      if (!sf || this.SCENE_A) return;
      const n = new Node('ar-floor'); n.layer = Layers.Enum.UI_2D; n.parent = this.world;
      const u = n.addComponent(UITransform); u.setAnchorPoint(0.5, 0.5);
      u.setContentSize(this.WALL_W, this.WALL_H);   // 圆盘+后半圈墙已合成一张,同画布几何
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = sf;
      n.setPosition(0, this.WALL_Y, 0);
      n.setSiblingIndex(cityN.getSiblingIndex() + 1);   // 城景图之后、道具之前(动态取,不怕加载顺序)
      this.plazaOK = true; this.wallOK = true;          // 围墙整圈已烘在图里
    });
    const propsN = new Node('ar-props'); propsN.layer = Layers.Enum.UI_2D; propsN.parent = this.world; propsN.addComponent(UITransform);
    this.propsG = propsN.addComponent(Graphics);
    const bossN = new Node('ar-boss'); bossN.layer = Layers.Enum.UI_2D; bossN.parent = this.world; bossN.addComponent(UITransform);
    this.bossG = bossN.addComponent(Graphics);
    // Boss 本体真图:切2帧,精灵挂 bossN(与阴影同节点→深度排序一致)
    AssetHub.loadSF('arena-boss', (sf) => {
      if (!sf) return;
      const tex = sf.texture as Texture2D; tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      const cw = Math.round(tex.width / 2), ch = tex.height;
      for (let i = 0; i < 2; i++) { const f = new SpriteFrame(); f.texture = tex; f.rect = new Rect(i * cw, 0, cw, ch); this.bossFrames.push(f); }
      const n = new Node('ar-boss-sp'); n.layer = Layers.Enum.UI_2D; n.parent = bossN;
      const u = n.addComponent(UITransform); u.setContentSize(this.BOSS_H * cw / ch, this.BOSS_H); u.setAnchorPoint(0.5, 0.02);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM; sp.spriteFrame = this.bossFrames[0];
      this.bossAsp = cw / ch;
      // 履带条(底部24%)切两帧,做运动残影
      for (let i = 0; i < 2; i++) {
        const f = new SpriteFrame(); f.texture = tex;
        f.rect = new Rect(i * cw, Math.round(ch * 0.76), cw, Math.round(ch * 0.24));
        this.bossTrackFrames.push(f);
      }
      for (let k = 0; k < 2; k++) {
        const gn = new Node('trk-ghost' + k); gn.layer = Layers.Enum.UI_2D; gn.parent = n;
        const gu = gn.addComponent(UITransform); gu.setAnchorPoint(0.5, 0);
        gu.setContentSize(this.BOSS_H * cw / ch, this.BOSS_H * 0.24);
        const gs = gn.addComponent(Sprite); gs.sizeMode = Sprite.SizeMode.CUSTOM; gs.spriteFrame = this.bossTrackFrames[0];
        gn.active = false; this.trackGhosts.push(gs);
      }
      this.bossSp = sp; this.bossOK = true;
      if (this.gunSp) this.gunSp.node.setSiblingIndex(bossN.children.length - 1);           // 枪压在本体前
      for (const ds of this.dustPool) ds.node.setSiblingIndex(bossN.children.length - 1);   // 尘雾压最上
    });
    // 机枪臂真图:肩盘(图内18%,50%)为旋转轴,实时追瞄玩家
    AssetHub.loadSF('arena-gun', (sf) => {
      if (!sf) return;
      const tex = sf.texture as Texture2D; tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      this.gunAsp = tex.width / tex.height;
      const gn = new Node('ar-boss-gun'); gn.layer = Layers.Enum.UI_2D; gn.parent = bossN;
      const gu = gn.addComponent(UITransform); gu.setAnchorPoint(0.18, 0.5);
      gu.setContentSize(100 * this.gunAsp, 100);
      const gs = gn.addComponent(Sprite); gs.sizeMode = Sprite.SizeMode.CUSTOM; gs.spriteFrame = sf;
      gn.active = false; this.gunSp = gs;
      gn.setSiblingIndex(bossN.children.length - 1);                                        // 枪压在本体前
      for (const ds of this.dustPool) ds.node.setSiblingIndex(bossN.children.length - 1);   // 尘雾保持最上
    });
    // 履带尘雾3帧(移动时在履带后方冒,遮住轮子=滚动感)
    AssetHub.loadSF('arena-dust', (sf) => {
      if (!sf) return;
      const tex = sf.texture as Texture2D; tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      const cw = Math.round(tex.width / 3), ch = tex.height;
      for (let i = 0; i < 3; i++) { const f = new SpriteFrame(); f.texture = tex; f.rect = new Rect(i * cw, 0, cw, ch); this.dustFrames.push(f); }
      for (let k = 0; k < 12; k++) {
        const dn = new Node('dust' + k); dn.layer = Layers.Enum.UI_2D; dn.parent = bossN;
        const du = dn.addComponent(UITransform); du.setAnchorPoint(0.5, 0.22); du.setContentSize(120, 120);
        const dsp = dn.addComponent(Sprite); dsp.sizeMode = Sprite.SizeMode.CUSTOM; dsp.spriteFrame = this.dustFrames[0];
        dn.active = false; this.dustPool.push(dsp);
      }
    });

    this.heroWrap = new Node('ar-herowrap'); this.heroWrap.layer = Layers.Enum.UI_2D; this.heroWrap.parent = this.world; this.heroWrap.addComponent(UITransform);
    const fxLayer = new Node('ar-fx'); fxLayer.layer = Layers.Enum.UI_2D; fxLayer.parent = this.world; fxLayer.addComponent(UITransform);
    this.hero = new HeroRig(this.heroWrap, fxLayer);
    this.hero.ambient = new Color(232, 226, 244, 255);   // 暮紫环境光
    this.combat = new HeroCombat(fxLayer, this.hero);

    const fxN = new Node('ar-fx2'); fxN.layer = Layers.Enum.UI_2D; fxN.parent = this.world; fxN.addComponent(UITransform);
    this.fxG = fxN.addComponent(Graphics);
    // 爆炸4帧(白闪→火球→炸开→烟圈)+精灵池
    AssetHub.loadSF('arena-boom', (sf) => {
      if (!sf) return;
      const tex = sf.texture as Texture2D; tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      const cw = Math.round(tex.width / 4), ch = tex.height;
      for (let i = 0; i < 4; i++) { const f = new SpriteFrame(); f.texture = tex; f.rect = new Rect(i * cw, 0, cw, ch); this.boomFrames.push(f); }
      for (let k = 0; k < 8; k++) {
        const bn = new Node('boom' + k); bn.layer = Layers.Enum.UI_2D; bn.parent = fxN;
        const bu = bn.addComponent(UITransform); bu.setAnchorPoint(0.5, 0.5); bu.setContentSize(110, 110);
        const bs2 = bn.addComponent(Sprite); bs2.sizeMode = Sprite.SizeMode.CUSTOM; bs2.spriteFrame = this.boomFrames[0];
        bn.active = false; this.boomPool.push(bs2);
      }
    });
    // 炸弹真图(骷髅铁球)+精灵池
    AssetHub.loadSF('arena-bomb', (sf) => {
      if (!sf) return;
      this.bombSF = sf;
      for (let k = 0; k < 6; k++) {
        const bn = new Node('bomb' + k); bn.layer = Layers.Enum.UI_2D; bn.parent = fxN;
        const bu = bn.addComponent(UITransform); bu.setAnchorPoint(0.5, 0.5); bu.setContentSize(30, 30);
        const bs2 = bn.addComponent(Sprite); bs2.sizeMode = Sprite.SizeMode.CUSTOM; bs2.spriteFrame = sf;
        bn.active = false; this.bombPool.push(bs2);
      }
    });


    this.controls = new TouchControls(this.node, {
      onDir: (d) => { this.keys.left = d < 0; this.keys.right = d > 0; },
      onAxis: (_ax, ay) => { this.axisY = ay; },
      onJump: () => this.jump(),
      onDash: (d) => { this.dir = d as 1 | -1; },
      onAttack: () => this.attack(),
      onSlide: () => this.attack(),
    }, { alpha: 0.5 });
    this.hud = new HeroHUD(this.node);
    this.deathFx = new DeathFx(this.node, () => { this.deathFx.hide(); this.resetAll(); });

    const ln = new Node('ar-bosslbl'); ln.layer = Layers.Enum.UI_2D; ln.parent = this.node; ln.addComponent(UITransform);
    this.bossLbl = ln.addComponent(Label); this.bossLbl.fontSize = 24; this.bossLbl.color = new Color(216, 204, 232);
    ln.setPosition(0, H / 2 - 96, 0);

    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    this.resetAll();
  }
  onDestroy() {
    input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
  }
  private onKey(e: EventKeyboard) {
    if (e.keyCode === KeyCode.KEY_A || e.keyCode === KeyCode.ARROW_LEFT) this.keys.left = true;
    else if (e.keyCode === KeyCode.KEY_D || e.keyCode === KeyCode.ARROW_RIGHT) this.keys.right = true;
    else if (e.keyCode === KeyCode.KEY_W || e.keyCode === KeyCode.ARROW_UP) this.keys.up = true;
    else if (e.keyCode === KeyCode.KEY_S || e.keyCode === KeyCode.ARROW_DOWN) this.keys.down = true;
    else if (e.keyCode === KeyCode.SPACE) this.jump();
    else if (e.keyCode === KeyCode.KEY_J) this.attack();
  }
  private onKeyUp(e: EventKeyboard) {
    if (e.keyCode === KeyCode.KEY_A || e.keyCode === KeyCode.ARROW_LEFT) this.keys.left = false;
    else if (e.keyCode === KeyCode.KEY_D || e.keyCode === KeyCode.ARROW_RIGHT) this.keys.right = false;
    else if (e.keyCode === KeyCode.KEY_W || e.keyCode === KeyCode.ARROW_UP) this.keys.up = false;
    else if (e.keyCode === KeyCode.KEY_S || e.keyCode === KeyCode.ARROW_DOWN) this.keys.down = false;
  }

  private resetAll() {
    this.px = -250; this.pd = 0.5; this.ph2 = 0; this.pvh = 0; this.dir = 1;
    this.hp = 100; this.inv = 0; this.over = false; this.deadT = 0; this.win = false; this.exiting = false;
    this.bx = W / 2 - 140; this.bd = 0.5; this.bhp = this.BHP; this.bst = 'intro'; this.bstT = 1.2;
    this.stun = 0; this.charging = false; this.coreOpen = false; this.bDead = false; this.bDeadT = 0;
    this.bullets = []; this.bombs = []; this.zones = []; this.parts = []; this.flashes = [];
    this.slamJump = false; this.slamLandT = 0;
    this.covers = [];   // 石墩掩体下架(要恢复:[{x:-210,d:0.28,hp:3},{x:40,d:0.85,hp:3},{x:190,d:0.15,hp:3}])
    this.combat.reset(); this.cam.reset();
  }

  private phase() { return this.bhp <= this.BHP * 0.25 ? 3 : this.bhp <= this.BHP * 0.6 ? 2 : 1; }
  private addShake(m: number) { this.shake = Math.max(this.shake, m); }
  private addStop(s: number) { this.hitStop = Math.max(this.hitStop, s); }
  private spark(x: number, y: number, col: Color, n: number, pw = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, s = (60 + Math.random() * 200) * pw;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 80, life: 0, max: 0.4 + Math.random() * 0.3, r: 1.5 + Math.random() * 2.5, col });
    }
    if (this.parts.length > 90) this.parts.splice(0, this.parts.length - 90);
  }
  private flash(x: number, y: number) { this.flashes.push({ x, y, life: 0, max: 0.16 }); }

  private jump() { if (this.over || this.win) return; if (this.ph2 <= 0) { this.pvh = 760; this.ph2 = 1; } }
  private attack() {
    if (this.over || this.slamJump) return;
    const type = this.combat.tryAttack();
    if (type < 0) return;
    if (type === 2 && this.ph2 <= 0) { this.pvh = 620; this.ph2 = 1; this.slamJump = true; }
    // 命中 Boss:身前一刀 + 深度接近
    if (!this.bDead && Math.abs(this.px + this.dir * 55 - this.bx) < 100 && Math.abs(this.pd - this.bd) < 0.22) {
      const dmg = this.coreOpen ? 24 : 12;
      this.bhp -= dmg; this._bhitT = 0.14; this.addStop(0.05); this.addShake(7);
      this.flash(this.bx - 40 * Math.sign(this.bx - this.px), this.dy(this.bd) + 90 * this.dsc(this.bd));
      this.spark(this.bx - 30, this.dy(this.bd) + 80, new Color(255, 216, 144, 255), 8, 1.2);
      AudioMgr.inst.play('hit', 0.7);
      if (this.bhp <= 0) this.killBoss();
    }
    // 打回空中炸弹
    for (const bo of this.bombs) {
      if (bo.st === 'fly' && Math.abs(bo.x - (this.px + this.dir * 80)) < 80 && Math.abs(bo.y - (this.dy(this.pd) + 50)) < 90) {
        bo.st = 'back'; bo.vx = this.dir * 460; bo.vy = 180; this.addStop(0.06); this.addShake(9); this.flash(bo.x, bo.y);
      }
    }
  }
  private killBoss() {
    this.bhp = 0; this.bDead = true; this.bDeadT = 0; this.slow = 1.2;
    this._dieBoomT = 0; this._dieBigDone = false;
    this.boomAt(this.bx, this.dy(this.bd) + 80, 1.5);
    AudioMgr.inst.play('kill', 0.8);
  }
  private hurt(dmg: number, fx?: number) {
    if (this.inv > 0 || this.over || this.win) return;
    this.hp -= dmg; this.inv = 0.9; this.addShake(8);
    this.hero.hurtFx(); AudioMgr.inst.play('hurt', 0.8);
    this.spark(fx ?? this.px, this.dy(this.pd) + 46, new Color(206, 44, 38, 255), 10, 1.2);
    if (this.hp <= 0) { this.hp = 0; this.over = true; this.deadT = 0; this.deathFx.show(); }
  }

  // ── Boss 状态机(移植 demo)──
  private bossStep(dt: number) {
    if (this.bDead) return;
    this.bph += dt;
    const ph = this.phase();
    if (!this.coreOpen && ph === 3) {
      this.coreOpen = true; this.bst = 'idle'; this.bstT = 0.8; this.addShake(10);
      this.spark(this.bx, this.dy(this.bd) + 90, new Color(255, 176, 96, 255), 20, 1.6);
    }
    if (this.stun > 0) { this.stun -= dt; return; }
    this.bstT -= dt;
    if (this.bst === 'idle') { this.bd += Math.sign(this.pd - this.bd) * dt * 0.16; this.bx += Math.sign(W / 2 - 200 - this.bx) * dt * 18; }
    // 边界钳制:Boss 平时出不了椭圆(留 40 身位墙距);冲撞状态除外=专门去撞墙
    this.bd = Math.max(0.12, Math.min(0.88, this.bd));
    if (this.bst !== 'charge') { const bm = Math.max(0, this.maxX(this.bd) - 40); this.bx = Math.max(-bm, Math.min(bm, this.bx)); }
    if (this.bstT > 0) return;
    switch (this.bst) {
      case 'intro': this.bst = 'idle'; this.bstT = 0.8; break;
      case 'idle': {
        const r = Math.random(), p3 = ph === 3;
        if (r < 0.34) { this.bst = 'aim'; this.bstT = p3 ? 0.4 : 0.62; this.aimD = this.pd; }
        else if (r < 0.62) { this.bst = 'bomb'; this.bstT = 0.5; this.bombN = ph >= 2 ? 3 : 1; }
        else if (r < 0.8 && ph >= 2) { this.bst = 'fan'; this.bstT = 0.5; this.sweepDir = Math.random() < 0.5 ? 1 : -1; this.fanD = this.sweepDir > 0 ? 0 : 1; }
        else { this.bst = 'chargePre'; this.bstT = 0.7; this.chDir = this.px < this.bx ? -1 : 1; }
        break;
      }
      case 'aim': this.bst = 'fire'; this.bstT = 0.55; this.fireT = 0; break;
      case 'fire': this.bst = 'idle'; this.bstT = ph === 3 ? 0.5 : 1.1; break;
      case 'fan': this.bst = 'fanFire'; this.bstT = 0.9; break;
      case 'fanFire': this.bst = 'idle'; this.bstT = 1.1; break;
      case 'bomb': {
        for (let i = 0; i < this.bombN; i++) {
          const td = this.phase() >= 2 ? Math.min(1, Math.max(0, this.pd + (Math.random() - 0.5) * 0.7)) : this.pd;
          const mxT = Math.max(60, this.maxX(td) - 40);
          const tx = Math.max(-mxT, Math.min(mxT, this.px + (Math.random() - 0.5) * (i ? 260 : 40)));
          this.bombs.push({ st: 'fly', x: this.bx - 20, y: this.dy(this.bd) + 150, tx, td, vx: 0, vy: 0, t: 0, T: 0.9 + i * 0.22 });
        }
        this.bst = 'idle'; this.bstT = ph === 3 ? 0.9 : 1.6; break;
      }
      case 'chargePre': this.bst = 'charge'; this.charging = true; this.bstT = 2.2; break;
      case 'charge': this.bst = 'idle'; this.charging = false; this.bstT = 1.2; break;
    }
  }
  private bossAct(dt: number) {
    if (this.bDead) return;
    if (this.bst === 'fire') { this.fireT -= dt; if (this.fireT <= 0) { this.fireT = 0.09; this.fireBullet(this.aimD); AudioMgr.inst.play('hit', 0.2); } }
    if (this.bst === 'fanFire') {
      this.fanD += this.sweepDir * dt / 0.9; this.fireT -= dt;
      if (this.fireT <= 0) { this.fireT = 0.07; this.fireBullet(Math.min(1, Math.max(0, this.fanD))); }
    }
    if (this.bst === 'charge') {
      this.bx += this.chDir * 640 * dt;
      for (const c of this.covers) {   // 冲撞碾碎路上的石墩
        if (c.hp > 0 && Math.abs(this.bx - c.x) < 70 && Math.abs(this.bd - c.d) < 0.2) {
          c.hp = 0; this.addShake(9);
          this.spark(c.x, this.dy(c.d) + 26, new Color(176, 158, 148, 255), 16, 1.7);
        }
      } this.bd += Math.sign(this.pd - this.bd) * dt * 0.06;
      if (Math.abs(this.px - this.bx) < 70 && Math.abs(this.pd - this.bd) < 0.2 && this.ph2 < 40) this.hurt(20, this.bx);
      const mxB = this.maxX(this.bd) + 46;
      if (this.bx < -mxB || this.bx > mxB) {
        this.bx = Math.max(-mxB, Math.min(mxB, this.bx));
        this.bst = 'idle'; this.bstT = 2.6; this.stun = 2.6; this.charging = false;
        this.addShake(13); this.spark(this.bx, this.dy(this.bd) + 60, new Color(200, 204, 216, 255), 16, 1.5);
        AudioMgr.inst.play('land', 0.8);
      }
    }
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    if (this.slow > 0) { this.slow -= dt; dt *= 0.4; }
    if (this.hitStop > 0) { this.hitStop -= dt; return; }
    this.t += dt;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 40);
      this.node.setPosition((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0);
      if (this.shake <= 0) this.node.setPosition(0, 0, 0);
    }
    if (this.inv > 0) this.inv -= dt;
    if (this.slamLandT > 0) this.slamLandT -= dt;
    if (this.over) { this.deadT += dt; this.drawHero(); return; }

    // 主角移动(左右 + 摇杆/WS 换深度线 + 跳)
    const mx = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const md = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0) + this.axisY;
    if (mx) { this.dir = mx; this.walkPh += dt * 9; }
    this.px += mx * 230 * dt;
    // 深度速度换算成屏幕速度≈200px/s,和横向一致(1.5 会快出近4倍)
    this.pd = Math.max(0, Math.min(1, this.pd + md * (200 / (this.FAR_Y - this.NEAR_Y)) * dt));
    const mxH = this.maxX(this.pd);   // 圆形场地:走不出椭圆边界
    this.px = Math.max(-mxH, Math.min(mxH, this.px));
    if (this.ph2 > 0 || this.pvh !== 0) {
      this.pvh -= 2200 * dt; this.ph2 += this.pvh * dt;
      if (this.ph2 <= 0) { this.ph2 = 0; this.pvh = 0; if (this.slamJump) { this.slamJump = false; this.slamLandT = 0.22; this.hero.slamImpactFx(this.px, this.dy(this.pd), H / 2); this.addShake(10); } }
    }

    this.bossStep(dt); this.bossAct(dt);

    // 子弹
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; b.x += b.vx * dt; if (b.t !== undefined) b.t += dt;
      // 石墩掩体挡子弹(打3下碎)
      let blocked = false;
      for (const c of this.covers) {
        if (c.hp > 0 && Math.abs(b.x - c.x) < 30 && Math.abs(b.d - c.d) < 0.13) {
          c.hp--; blocked = true;
          this.spark(c.x, this.dy(c.d) + 30, new Color(196, 178, 168, 255), 6, 1);
          if (c.hp <= 0) { this.addShake(6); this.spark(c.x, this.dy(c.d) + 26, new Color(176, 158, 148, 255), 14, 1.5); }
          break;
        }
      }
      if (blocked) { this.bullets.splice(i, 1); continue; }
      const bx0 = b.x - b.vx * dt;
      const crossed = (bx0 - this.px) * (b.x - this.px) <= 0;
      if ((crossed || Math.abs(b.x - this.px) < 26) && Math.abs(b.d - this.pd) < 0.16 && this.ph2 < 46) {
        this.hurt(7, b.x); this.bullets.splice(i, 1); continue;
      }
      if (b.x < -W / 2 - 40 || b.x > W / 2 + 40) this.bullets.splice(i, 1);
    }
    // 炸弹
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bo = this.bombs[i];
      if (bo.st === 'fly') {
        bo.t += dt; const k = Math.min(1, bo.t / bo.T);
        const x0 = this.bx - 20, y0 = this.dy(this.bd) + 150, ty = this.dy(bo.td) + 6;
        bo.x = x0 + (bo.tx - x0) * k; bo.y = y0 + (ty - y0) * k + Math.sin(k * Math.PI) * 170;
        if (k >= 1) {
          this.zones.push({ x: bo.tx, d: bo.td, life: 0, max: 2 });
          this.boomAt(bo.tx, ty + 34, 1.7);
          this.addShake(9); this.spark(bo.tx, ty + 8, new Color(255, 176, 96, 255), 16, 1.6);
          AudioMgr.inst.play('land', 0.6);
          if (Math.abs(this.px - bo.tx) < 70 && Math.abs(this.pd - bo.td) < 0.18 && this.ph2 < 50) this.hurt(16, bo.tx);
          this.bombs.splice(i, 1);
        }
      } else {
        bo.x += bo.vx * dt; bo.vy -= 900 * dt; bo.y += bo.vy * dt;
        if (!this.bDead && Math.abs(bo.x - this.bx) < 90 && Math.abs(bo.y - (this.dy(this.bd) + 80)) < 100) {
          this.bhp -= 40; this._bhitT = 0.2; this.addStop(0.08); this.addShake(12); this.flash(bo.x, bo.y);
          this.spark(bo.x, bo.y, new Color(255, 176, 96, 255), 18, 1.7);
          this.boomAt(bo.x, bo.y, 1.5);
          if (this.bhp <= 0) this.killBoss();
          this.bombs.splice(i, 1);
        } else if (bo.x > W / 2 + 60 || bo.y < -H / 2) this.bombs.splice(i, 1);
      }
    }
    // 火焰区
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]; z.life += dt;
      if (Math.abs(this.px - z.x) < 52 && Math.abs(this.pd - z.d) < 0.14 && this.ph2 < 24) this.hurt(9 * dt * 4, z.x);
      if (z.life >= z.max) this.zones.splice(i, 1);
    }
    // 粒子/白光
    for (let i = this.parts.length - 1; i >= 0; i--) { const p = this.parts[i]; p.life += dt; p.vy -= 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.life >= p.max) this.parts.splice(i, 1); }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].life += dt; if (this.flashes[i].life >= this.flashes[i].max) this.flashes.splice(i, 1); }
    // Boss 死亡演出 → 胜利
    if (this.bDead) {
      this.bDeadT += dt;
      if (this.bDeadT < 1.6 && Math.random() < 0.3) this.spark(this.bx + (Math.random() - 0.5) * 140, this.dy(this.bd) + 40 + Math.random() * 140, new Color(255, 176, 96, 255), 8, 1.4);
      if (this.bDeadT >= 1.6 && !this.win) { this.win = true; this.addShake(16); this.spark(this.bx, this.dy(this.bd) + 80, new Color(255, 216, 144, 255), 40, 2.4); }
    }
    // 胜利:走到右侧井边 → 跳井接井关
    if (this.win && !this.exiting && this.px > 0 && this.px > this.maxX(this.pd) - 70) { this.exitToWell(); return; }

    this.cam.update(dt, this.ph2 > 0, this.px, this.dy(this.pd) + 60);
    this.combat.scale = this.dsc(this.pd);
    this.hero.fxScale = this.dsc(this.pd);
    this.combat.update(dt, this.px, this.dy(this.pd) + this.ph2, this.dir);
    this.hero.updateFx(dt, this.px, this.dy(this.pd));
    this.stepSmoke(dt);
    this.drawBg(); this.drawProps(); this.drawBoss(); this.drawHero(); this.drawFx();
    // 深度排序:远的在后(heroWrap/bossG 兄弟序)
    const heroFar = this.pd > this.bd;
    const ia = this.bossG.node.getSiblingIndex(), ib = this.heroWrap.getSiblingIndex();
    const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    if (heroFar) { this.heroWrap.setSiblingIndex(lo); this.bossG.node.setSiblingIndex(hi); }
    else { this.bossG.node.setSiblingIndex(lo); this.heroWrap.setSiblingIndex(hi); }
    this.hud.set(this.hp, 100, this.hp, this.coins, 1);
    this.controls.setSpecialCd(0);
    this.bossLbl.string = this.bDead ? (this.win ? '雾散了…走到井边(→)跳井' : '') :
      '铁心兽 ' + Math.max(0, Math.ceil(this.bhp / this.BHP * 100)) + '%' + (this.phase() === 3 ? ' · 过热!' : this.phase() === 2 ? ' · 恼了' : '');
  }

  // 胜利跳井 → 井关(与空城跳井同款转场)
  private exitToWell() {
    if (this.exiting) return; this.exiting = true;
    const parent = this.node.parent!;
    const fade = new Node('ar-fade'); fade.layer = Layers.Enum.UI_2D; fade.parent = parent;
    fade.addComponent(UITransform).setContentSize(W, H);
    const fg = fade.addComponent(Graphics); fg.fillColor = new Color(0, 0, 0, 255); fg.rect(-W / 2, -H / 2, W, H); fg.fill();
    const op = fade.addComponent(UIOpacity); op.opacity = 0;
    tween(op).to(0.45, { opacity: 255 }).call(() => {
      this.node.destroy();
      const n = new Node('Chapter2'); n.layer = Layers.Enum.UI_2D; n.addComponent(UITransform); n.parent = parent;
      n.addComponent(Chapter2Well);
      fade.setSiblingIndex(parent.children.length - 1);
      tween(op).delay(0.1).to(0.45, { opacity: 0 }).call(() => fade.destroy()).start();
    }).start();
  }

  // ── 绘制 ──
  // 矮石围墙的一段(沿行走椭圆外圈):a0→a1 弧段,h=墙高(近高远矮由深度自带)
  private wallArc(g: Graphics, a0: number, a1: number, base: Color, top: Color) {
    const RXB = this.RXW + 24, RYB = this.RYW + 20, cy = this.CY;
    const seg = Math.max(6, Math.round((a1 - a0) / 0.14));
    const pt = (a: number) => ({ x: Math.cos(a) * RXB, y: cy + Math.sin(a) * RYB });
    const hAt = (a: number) => 30 + (1 - (Math.sin(a) + 1) / 2) * 16;   // 近沿墙更高
    // 墙身
    g.fillColor = base;
    for (let i = 0; i < seg; i++) {
      const p1 = pt(a0 + (a1 - a0) * i / seg), p2 = pt(a0 + (a1 - a0) * (i + 1) / seg);
      const h1 = hAt(a0 + (a1 - a0) * i / seg), h2 = hAt(a0 + (a1 - a0) * (i + 1) / seg);
      g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(p2.x, p2.y + h2); g.lineTo(p1.x, p1.y + h1); g.close(); g.fill();
    }
    // 压顶亮线
    g.strokeColor = top; g.lineWidth = 4;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * i / seg, pp = pt(a);
      if (i === 0) g.moveTo(pp.x, pp.y + hAt(a)); else g.lineTo(pp.x, pp.y + hAt(a));
    }
    g.stroke();
    // 立柱(隔段一根,缺几根=破)
    g.fillColor = new Color(base.r - 14, base.g - 12, base.b - 14, 255);
    for (let i = 0; i <= seg; i += 2) {
      const a = a0 + (a1 - a0) * i / seg;
      if (this.rnd(i * 7.1) < 0.15) continue;
      const pp = pt(a), h = hAt(a) + 10;
      g.rect(pp.x - 5, pp.y, 10, h); g.fill();
    }
  }

  // ── 方案A:机车库·火车转盘(纯代码预览) ──
  private drawYard(g: Graphics) {
    if (this.yardOK) return;   // 整景图自带天空+140px出血


    const cy = this.CY, RX = this.RXV, RY = this.RYV, t = this.t;
    // 夜空(暮紫烟霾)
    g.fillColor = new Color(20, 17, 30, 255); g.rect(-W / 2 - 20, -H / 2 - 20, W + 40, H + 40); g.fill();
    g.fillColor = new Color(52, 38, 46, 130); g.rect(-W / 2 - 20, cy + RY + 60, W + 40, 240); g.fill();
    for (let i = 0; i < 14; i++) {
      const sx2 = (this.rnd(i * 3.3) - 0.5) * W, sy2 = cy + RY + 130 + this.rnd(i * 7.7) * 320;
      g.fillColor = new Color(220, 214, 236, Math.round(70 + 90 * this.rnd(i)));
      g.circle(sx2, sy2, 1.6); g.fill();
    }
    // 远景:水塔+条纹烟囱+屋脊
    const RIM = cy + RY;
    g.fillColor = new Color(34, 28, 42, 255);
    g.rect(-W / 2 - 20, RIM + 76, W + 40, 90); g.fill();   // 屋脊带
    // 水塔
    g.fillColor = new Color(40, 33, 48, 255);
    g.rect(-286, RIM + 130, 12, 120); g.fill(); g.rect(-226, RIM + 130, 12, 120); g.fill();
    g.ellipse(-250, RIM + 268, 58, 40); g.fill();
    g.fillColor = new Color(52, 42, 58, 255); g.ellipse(-250, RIM + 296, 60, 18); g.fill();
    // 烟囱(条纹)+慢烟
    g.fillColor = new Color(44, 34, 46, 255); g.rect(214, RIM + 120, 40, 190); g.fill();
    g.fillColor = new Color(120, 62, 58, 255); g.rect(214, RIM + 200, 40, 22); g.fill(); g.rect(214, RIM + 254, 40, 22); g.fill();
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.24 + i * 0.33) % 1;
      g.fillColor = new Color(120, 110, 126, Math.round(56 * (1 - k)));
      g.circle(234 + k * 46 + Math.sin(t + i) * 6, RIM + 320 + k * 90, 10 + k * 20); g.fill();
    }
    // 机车库砖墙+拱门排(远侧边界:墙挡住)
    {
      const WY2 = cy + this.RYW + 34;   // 墙脚(远侧行走沿外)
      g.fillColor = new Color(40, 31, 40, 255);
      g.rect(-W / 2 - 20, WY2, W + 40, 168); g.fill();
      g.strokeColor = new Color(30, 23, 32, 255); g.lineWidth = 2.5;
      for (let yy = WY2 + 24; yy < WY2 + 168; yy += 24) { g.moveTo(-W / 2 - 20, yy); g.lineTo(W / 2 + 20, yy); g.stroke(); }
      g.fillColor = new Color(58, 46, 54, 255);
      g.rect(-W / 2 - 20, WY2, W + 40, 10); g.fill();   // 墙脚亮线
      for (let i = 0; i < 7; i++) {
        const ax = -W / 2 + 60 + i * (W - 120) / 6;
        const wid = 84, hgt = 118;
        g.fillColor = new Color(24, 18, 28, 255);   // 门洞
        g.rect(ax - wid / 2, WY2 + 10, wid, hgt); g.fill();
        g.ellipse(ax, WY2 + 10 + hgt, wid / 2, wid * 0.4); g.fill();
        g.strokeColor = new Color(64, 52, 60, 255); g.lineWidth = 5;   // 拱边
        g.ellipse(ax, WY2 + 10 + hgt, wid / 2 + 3, wid * 0.4 + 3); g.stroke();
        if (i === 2 || i === 5) {   // 探头的呆火车
          g.fillColor = new Color(66, 54, 70, 255);
          g.ellipse(ax, WY2 + 52, wid * 0.32, 40); g.fill();
          const blink = Math.sin(t * 1.4 + i) > -0.85 ? 1 : 0.12;
          g.fillColor = new Color(255, 196, 116, Math.round(220 * blink));
          g.circle(ax - 12, WY2 + 62, 6); g.fill();
          g.circle(ax + 12, WY2 + 60, 4.6); g.fill();
          g.strokeColor = new Color(30, 24, 34, 255); g.lineWidth = 2.5;
          g.moveTo(ax - 13, WY2 + 40); g.quadraticCurveTo(ax, WY2 + 34, ax + 13, WY2 + 40); g.stroke();
        }
        if (i % 3 === 1) {   // 信号灯
          const on = Math.sin(t * 2.6 + i * 2) > 0.2;
          g.strokeColor = new Color(40, 32, 46, 255); g.lineWidth = 4;
          g.moveTo(ax + wid / 2 + 14, WY2 + 10); g.lineTo(ax + wid / 2 + 14, WY2 + 66); g.stroke();
          g.fillColor = on ? new Color(255, 150, 80, 235) : new Color(70, 50, 44, 235);
          g.circle(ax + wid / 2 + 14, WY2 + 72, 5.5); g.fill();
          if (on) { g.fillColor = new Color(255, 150, 80, 44); g.circle(ax + wid / 2 + 14, WY2 + 72, 14); g.fill(); }
        }
      }
    }
    // ── 铁板车间路面(整面铺满,远密近疏伪透视) ──
    {
      const FY0 = cy + RY + 46;   // 地面远沿(拱门脚下)
      g.fillColor = new Color(63, 55, 71, 255);
      g.rect(-W / 2 - 20, -H / 2 - 20, W + 40, FY0 + H / 2 + 20); g.fill();
      // 远处压暗(纵深)
      for (let i = 0; i < 4; i++) {
        g.fillColor = new Color(36, 30, 46, 72 - 16 * i);
        g.rect(-W / 2 - 20, FY0 - 20 - i * 24, W + 40, 24); g.fill();
      }
      // 铁板行:横缝+错位竖缝+稀疏铆钉
      let ry3 = FY0, rh = 24, rowI = 0;
      while (ry3 > -H / 2 - 40) {
        const y2 = ry3 - rh;
        g.strokeColor = new Color(46, 40, 56, 255); g.lineWidth = 3;
        g.moveTo(-W / 2 - 20, y2); g.lineTo(W / 2 + 20, y2); g.stroke();
        const pw = 92 + rowI * 12, off = (rowI % 2) * pw * 0.5;
        g.lineWidth = 2.5;
        for (let x = -W / 2 - 20 + off % pw; x < W / 2 + 30; x += pw) {
          g.moveTo(x, ry3); g.lineTo(x, y2); g.stroke();
        }
        if (rowI % 2 === 0) {
          g.fillColor = new Color(90, 76, 66, 235);
          for (let x = -W / 2 - 20 + off % pw; x < W / 2 + 30; x += pw) {
            g.circle(x + 8, ry3 - 6, 2.6); g.fill();
            g.circle(x + pw - 8, y2 + 6, 2.6); g.fill();
          }
        }
        ry3 = y2; rh *= 1.17; rowI++;
      }
      // 双轨横贯(全宽)+枕木
      for (const ry2 of [cy + 13, cy - 13]) {
        g.strokeColor = new Color(34, 28, 42, 255); g.lineWidth = 7;
        g.moveTo(-W / 2 - 20, ry2); g.lineTo(W / 2 + 20, ry2); g.stroke();
        g.strokeColor = new Color(150, 116, 88, 190); g.lineWidth = 2;
        g.moveTo(-W / 2 - 20, ry2 + 2); g.lineTo(W / 2 + 20, ry2 + 2); g.stroke();
      }
      g.strokeColor = new Color(42, 34, 50, 220); g.lineWidth = 5;
      for (let x = -W / 2 + 8; x < W / 2; x += 38) { g.moveTo(x, cy - 21); g.lineTo(x, cy + 21); g.stroke(); }
      // 行走边界:左右两条竖向黄黑警戒线(磨损虚线)
      for (const side of [-1, 1]) {
        const lxb = side * 322, yTop = cy + this.RYW + 26, yBot = cy - this.RYW - 34;
        g.lineWidth = 9;
        const segs = 14;
        for (let k = 0; k < segs; k++) {
          if (this.rnd(k * 5.3 + side) < 0.12) continue;
          const y0 = yBot + (yTop - yBot) * k / segs, y1 = yBot + (yTop - yBot) * (k + 0.62) / segs;
          g.strokeColor = k % 2 ? new Color(196, 166, 66, 175) : new Color(38, 32, 40, 185);
          g.moveTo(lxb, y0); g.lineTo(lxb, y1); g.stroke();
        }
      }
      // 缓冲止挡×2(左右撞停点,红头垫)
      for (const side of [-1, 1]) {
        const bx = side * 356;
        g.fillColor = new Color(44, 37, 53, 255);
        g.moveTo(bx + side * 26, cy - 6); g.lineTo(bx - side * 12, cy + 30);
        g.lineTo(bx - side * 12, cy - 40); g.close(); g.fill();
        g.fillColor = new Color(52, 44, 60, 255); g.rect(bx - side * 16 - 8, cy - 46, 16, 12); g.fill();
        g.fillColor = new Color(170, 66, 58, 255);
        g.rect(bx - side * 12 - (side > 0 ? 10 : 0), cy - 24, 10, 30); g.fill();
      }
      // 吊灯光池(暖光落在地上)
      for (const lx of [-206, 30, 238]) {
        g.fillColor = new Color(255, 196, 116, 22);
        g.ellipse(lx, cy + 30, 96, 28); g.fill();
      }
      // 油渍
      for (let i = 0; i < 5; i++) {
        g.fillColor = new Color(26, 22, 34, 56);
        g.ellipse((this.rnd(i * 8.3) - 0.5) * W * 0.8, cy + (this.rnd(i * 3.9) - 0.5) * 300, 34 + this.rnd(i) * 30, 11); g.fill();
      }
    }
    // ── 岩浆槽(近侧边界:铁水沟挡路) ──
    {
      const LY = cy - this.RYW - 38;   // 沟沿
      // 铁水面
      g.fillColor = new Color(188, 70, 30, 255);
      g.rect(-W / 2 - 20, -H / 2 - 20, W + 40, LY - 16 + H / 2 + 20); g.fill();
      // 亮流(缓慢漂移)
      for (let i = 0; i < 6; i++) {
        const lx = ((i * 233 + t * 34) % (W + 120)) - W / 2 - 60;
        const ly = LY - 44 - (i * 71) % 130;
        g.fillColor = new Color(255, 156, 62, 150);
        g.ellipse(lx, ly, 48 + (i % 3) * 16, 8); g.fill();
      }
      // 泡泡(冒起来破掉)
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.7 + i * 0.31) % 1;
        const bx2 = ((i * 197) % (W - 60)) - W / 2 + 30;
        g.fillColor = new Color(255, 196, 96, Math.round(190 * (1 - k)));
        g.circle(bx2, LY - 40 - (i * 53) % 100, 3 + k * 5); g.fill();
      }
      // 沟沿黑壳(锯齿崩边)
      g.fillColor = new Color(36, 28, 38, 255);
      g.rect(-W / 2 - 20, LY - 18, W + 40, 20); g.fill();
      g.fillColor = new Color(36, 28, 38, 255);
      for (let x = -W / 2; x < W / 2; x += 46) {
        const dp = 8 + this.rnd(x * 0.13) * 12;
        g.moveTo(x, LY - 18); g.lineTo(x + 23, LY - 18 - dp); g.lineTo(x + 46, LY - 18); g.close(); g.fill();
      }
      // 岩浆光晕照亮地板近沿
      g.fillColor = new Color(255, 120, 50, 26);
      g.rect(-W / 2 - 20, LY, W + 40, 48); g.fill();
      g.fillColor = new Color(255, 120, 50, Math.round(14 + 8 * Math.sin(t * 3)));
      g.rect(-W / 2 - 20, LY - 16, W + 40, 16); g.fill();
    }
  }

  // 方案A顶层:桁架+吊链工灯(画进 fxG,压在场上)
  private drawYardFx(g: Graphics) {
    const t = this.t;
    // 暮紫色罩:把整景拉回空城的暮紫空气(统一章节色调)
    g.fillColor = new Color(96, 74, 140, 22);
    g.rect(-W * 0.8, -H * 0.8, W * 1.6, H * 1.6); g.fill();
    // 飞舞的纸片(从空城飘进来的)
    for (let i = 0; i < 6; i++) {
      const k = (t * 0.11 + i * 0.19) % 1;
      const px2 = -W / 2 - 30 + k * (W + 60);
      const py2 = -60 + ((i * 173) % 420) + Math.sin(t * 1.8 + i * 2) * 34;
      const rot = t * 2 + i * 1.4;
      g.fillColor = new Color(224, 216, 198, Math.round(150 * (0.5 + 0.5 * Math.sin(k * Math.PI))));
      const c2 = Math.cos(rot) * 9, s2 = Math.sin(rot) * 6;
      g.moveTo(px2 - c2, py2 - s2); g.lineTo(px2 + s2, py2 - c2 * 0.6);
      g.lineTo(px2 + c2, py2 + s2); g.lineTo(px2 - s2, py2 + c2 * 0.6); g.close(); g.fill();
    }
    // 岩浆动效(叠在整景图的岩浆带上)
    if (this.yardOK) {
      for (let i = 0; i < 6; i++) {
        const lx = ((i * 233 + t * 30) % (W + 120)) - W / 2 - 60;
        const ly = -H / 2 + 26 + (i * 37) % 78;
        g.fillColor = new Color(255, 170, 72, 88);
        g.ellipse(lx, ly, 44 + (i % 3) * 14, 7); g.fill();
      }
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.7 + i * 0.31) % 1;
        const bx2 = ((i * 197) % (W - 60)) - W / 2 + 30;
        g.fillColor = new Color(255, 200, 100, Math.round(170 * (1 - k)));
        g.circle(bx2, -H / 2 + 30 + (i * 53) % 70 + k * 14, 2.5 + k * 4); g.fill();
      }
      g.fillColor = new Color(255, 140, 60, Math.round(12 + 8 * Math.sin(t * 3)));
      g.rect(-W / 2 - 10, -H / 2 + 120, W + 20, 30); g.fill();
    }
    const yb = H / 2 - 168;
    g.fillColor = new Color(30, 26, 38, 255); g.rect(-W / 2 - 20, yb, W + 40, 11); g.fill();
    g.fillColor = new Color(26, 22, 34, 255); g.rect(-W / 2 - 20, yb + 42, W + 40, 9); g.fill();
    g.strokeColor = new Color(34, 29, 42, 255); g.lineWidth = 4;
    for (let x = -W / 2; x < W / 2; x += 56) {
      g.moveTo(x, yb + 11); g.lineTo(x + 28, yb + 42); g.stroke();
      g.moveTo(x + 56, yb + 11); g.lineTo(x + 28, yb + 42); g.stroke();
    }
    // 吊链+工灯(震屏时晃更凶)
    for (let i = 0; i < 3; i++) {
      const lx = [-206, 30, 238][i], L = 96 + i * 22;
      const sway = Math.sin(t * 0.8 + i * 2.1) * 5 + this.shake * Math.sin(t * 26 + i) * 1.6;
      const ex = lx + Math.sin(sway * 0.024) * L, ey = yb - Math.cos(sway * 0.024) * L;
      g.strokeColor = new Color(58, 50, 66, 255); g.lineWidth = 3;
      for (let m = 0; m < 6; m++) {
        const k0 = m / 6, k1 = (m + 0.62) / 6;
        g.moveTo(lx + (ex - lx) * k0, yb + (ey - yb) * k0);
        g.lineTo(lx + (ex - lx) * k1, yb + (ey - yb) * k1); g.stroke();
      }
      g.fillColor = new Color(62, 52, 70, 255);
      g.moveTo(ex - 13, ey); g.lineTo(ex + 13, ey); g.lineTo(ex + 5, ey - 14); g.lineTo(ex - 5, ey - 14); g.close(); g.fill();
      const gl = 0.72 + 0.28 * Math.sin(t * 2.4 + i * 3);
      g.fillColor = new Color(255, 196, 116, Math.round(215 * gl)); g.circle(ex, ey - 4, 5.5); g.fill();
      g.fillColor = new Color(255, 196, 116, Math.round(36 * gl)); g.circle(ex, ey - 4, 30); g.fill();
    }
  }

  private drawBg() {
    const g = this.bgG; g.clear();
    if (this.SCENE_A) { this.drawYard(g); return; }
    const NY = this.NEAR_Y, FY = this.FAR_Y;
    if (!this.skyOK) {
    // 暮紫天(分带)
    const bands = [[46, 40, 64], [58, 48, 74], [70, 58, 84], [52, 44, 66]];
    for (let i = 0; i < bands.length; i++) {
      const c = bands[i];
      g.fillColor = new Color(c[0], c[1], c[2], 255);
      g.rect(-W / 2, H / 2 - (i + 1) * (H / bands.length), W, H / bands.length + 1); g.fill();
    }
    // 星子
    for (let i = 0; i < 14; i++) {
      const tw = 0.4 + 0.6 * Math.sin(this.t * 1.4 + i * 2.3);
      g.fillColor = new Color(230, 225, 250, Math.round(70 * tw));
      g.circle(-W / 2 + this.rnd(i * 3.1) * W, H / 2 - 30 - this.rnd(i * 7.7) * 150, 1 + this.rnd(i) * 1.2); g.fill();
    }
    // 齿轮月(缓转)
    const mx = -90, my = H / 2 - 150, ma = this.t * 0.05;
    g.fillColor = new Color(232, 220, 200, 40);
    g.circle(mx, my, 58); g.fill();
    for (let i = 0; i < 12; i++) {
      const a = ma + i / 12 * 6.28, cx2 = mx + Math.cos(a) * 62, cy2 = my + Math.sin(a) * 62;
      g.rect(cx2 - 7, cy2 - 8, 14, 16); g.fill();
    }
    g.fillColor = new Color(50, 44, 68, 235); g.circle(mx, my, 20); g.fill();
    }
    if (!this.cityBgOK) {
    // 钟楼 + 双层城影
    g.fillColor = new Color(38, 30, 54, 235); g.rect(112, H / 2 - 300, 54, 208); g.fill();
    g.moveTo(112, H / 2 - 300); g.lineTo(139, H / 2 - 330); g.lineTo(166, H / 2 - 300); g.close(); g.fill();
    g.fillColor = new Color(240, 230, 200, 60); g.circle(139, H / 2 - 256, 17); g.fill();
    g.strokeColor = new Color(30, 24, 44, 230); g.lineWidth = 2.5;
    g.moveTo(139, H / 2 - 256); g.lineTo(139, H / 2 - 268); g.moveTo(139, H / 2 - 256); g.lineTo(148, H / 2 - 250); g.stroke();
    g.fillColor = new Color(52, 44, 70, 140);
    for (let i = 0; i < 9; i++) { const bx2 = -W / 2 + i * 60 - 15, bh = 60 + this.rnd(i + 30) * 80; g.rect(bx2, H / 2 - 500 + (120 - bh), 46, bh); g.fill(); }
    g.fillColor = new Color(30, 24, 44, 216);
    for (let i = 0; i < 7; i++) { const bx2 = -W / 2 + i * 78 - 10, bh = 90 + this.rnd(i) * 110; g.rect(bx2, H / 2 - 500 - 20, 58, bh * 0.01 + 0); }
    for (let i = 0; i < 7; i++) { const bx2 = -W / 2 + i * 78 - 10, bh = 90 + this.rnd(i) * 110; g.rect(bx2, H / 2 - 380 - bh, 58, bh); g.fill(); }
    g.fillColor = new Color(255, 214, 120, 36);
    for (let i = 0; i < 10; i++) { g.rect(-W / 2 + 20 + this.rnd(i * 7) * 430, H / 2 - 420 - this.rnd(i * 3) * 130, 7, 10); g.fill(); }
    // 电线+纸符
    g.strokeColor = new Color(20, 16, 32, 180); g.lineWidth = 2;
    g.moveTo(-W / 2 - 10, H / 2 - 416); g.quadraticCurveTo(0, H / 2 - 448, W / 2 + 10, H / 2 - 410); g.stroke();
    for (let i = 0; i < 5; i++) {
      const px2 = -W / 2 + 50 + i * 95, py2 = H / 2 - 430 + Math.sin(px2 * 0.013) * 14;
      g.fillColor = new Color(230, 222, 206, 128);
      const sw2 = Math.sin(this.t * 1.4 + i) * 3;
      g.moveTo(px2 - 5 + sw2, py2); g.lineTo(px2 + 5 + sw2, py2); g.lineTo(px2 + 5 - sw2, py2 - 15); g.lineTo(px2 - 5 - sw2, py2 - 15); g.close(); g.fill();
    }
    }
    // 台基侧壁:广场是凸起的石台,下沿往下是砌砖侧面(真图台基就位后只留压黑带)
    if (!this.plazaOK) {
      const cy = this.CY, RXB2 = this.RXV, RYB2 = this.RYV, DEPTH = 84;
      g.fillColor = new Color(64, 56, 78, 255);
      const seg2 = 26;
      for (let i = 0; i < seg2; i++) {
        const a1 = Math.PI + i / seg2 * Math.PI, a2 = Math.PI + (i + 1) / seg2 * Math.PI;
        const x1 = Math.cos(a1) * RXB2, y1 = cy + Math.sin(a1) * RYB2;
        const x2 = Math.cos(a2) * RXB2, y2 = cy + Math.sin(a2) * RYB2;
        g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2, y2 - DEPTH); g.lineTo(x1, y1 - DEPTH); g.close(); g.fill();
      }
      // 砖缝两道(顺着弧)
      g.strokeColor = new Color(40, 34, 54, 200); g.lineWidth = 2.5;
      for (const off of [30, 58]) {
        for (let i = 0; i <= seg2; i++) {
          const a = Math.PI + i / seg2 * Math.PI;
          const x = Math.cos(a) * RXB2, y = cy + Math.sin(a) * RYB2 - off;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    // 台基下:渐暗(两条压黑带,始终画)
    {
      const cy = this.CY, RYB2 = this.RYV, DEPTH = 84;
      g.fillColor = new Color(20, 15, 32, 190); g.rect(-W / 2 - 20, cy - RYB2 - DEPTH - 60, W + 40, 70); g.fill();
      g.fillColor = new Color(12, 9, 22, 235); g.rect(-W / 2 - 20, -H / 2 - 20, W + 40, (cy - RYB2 - DEPTH - 50) + H / 2 + 20); g.fill();
    }
    // 圆形广场:真图(arena-floor)就位后跳过程序画,只留兜底
    if (!this.plazaOK) {
      const cy = this.CY, RX = this.RXV, RY = this.RYV;
      g.fillColor = new Color(106, 98, 128, 255); g.ellipse(0, cy, RX, RY); g.fill();
      g.fillColor = new Color(90, 82, 112, 255); g.ellipse(0, cy - 14, RX * 0.94, RY * 0.86); g.fill();
      g.strokeColor = new Color(200, 190, 220, 82); g.lineWidth = 5; g.ellipse(0, cy, RX - 5, RY - 5); g.stroke();
      g.strokeColor = new Color(40, 32, 56, 128); g.lineWidth = 3;
      for (let r = 1; r <= 3; r++) { g.ellipse(0, cy, RX * r / 3.6, RY * r / 3.6); g.stroke(); }
      g.fillColor = new Color(40, 32, 56, 110); g.ellipse(0, cy, 22, 18); g.fill();
    }
  }

  // 道具层(压在地板真图上、角色之下):破栏杆圈/灯柱/废件堆/石墩掩体/胜利老井
  private drawProps() {
    const g = this.propsG; g.clear();
    const cy = this.CY, RX = this.RXV, RY = this.RYV, NY = this.NEAR_Y, FY = this.FAR_Y;
    // 围墙·远半圈(角色身后):Boss 冲撞撞的就是它(有真图就不画)
    if (!this.wallOK && !this.SCENE_A) this.wallArc(g, Math.PI * 0.04, Math.PI * 0.96, new Color(84, 76, 100, 255), new Color(140, 128, 158, 235));
    // 石墩掩体(挡子弹,3 下碎;裂纹随血量加深)
    for (const c of this.covers) {
      if (c.hp <= 0) continue;
      const sc = this.dsc(c.d), gx = c.x, gy2 = this.dy(c.d);
      g.fillColor = new Color(20, 14, 30, 90); g.ellipse(gx, gy2 - 4, 34 * sc, 8 * sc); g.fill();
      g.fillColor = new Color(148, 132, 128, 255); g.roundRect(gx - 30 * sc, gy2, 60 * sc, 52 * sc, 10 * sc); g.fill();
      g.fillColor = new Color(178, 160, 152, 255); g.roundRect(gx - 30 * sc, gy2 + 34 * sc, 60 * sc, 18 * sc, 8 * sc); g.fill();
      g.strokeColor = new Color(96, 82, 84, 255); g.lineWidth = 2; g.roundRect(gx - 30 * sc, gy2, 60 * sc, 52 * sc, 10 * sc); g.stroke();
      if (c.hp <= 2) { g.strokeColor = new Color(60, 48, 52, 230); g.lineWidth = 2.5; g.moveTo(gx - 12 * sc, gy2 + 46 * sc); g.lineTo(gx - 2 * sc, gy2 + 26 * sc); g.lineTo(gx - 10 * sc, gy2 + 12 * sc); g.stroke(); }
      if (c.hp <= 1) { g.strokeColor = new Color(60, 48, 52, 230); g.moveTo(gx + 16 * sc, gy2 + 48 * sc); g.lineTo(gx + 6 * sc, gy2 + 30 * sc); g.lineTo(gx + 16 * sc, gy2 + 10 * sc); g.stroke(); }
    }
    // 胜利:老井显形
    if (this.win) {
      const wx2 = this.RXW - 46, wy2 = this.CY - 30;
      g.fillColor = new Color(106, 102, 120, 255); g.rect(wx2 - 36, wy2, 72, 44); g.fill();
      g.fillColor = new Color(82, 78, 96, 255); g.rect(wx2 - 42, wy2 - 10, 84, 10); g.fill();
      const gl2 = 0.6 + 0.4 * Math.sin(this.t * 2.4);
      g.fillColor = new Color(150, 230, 210, Math.round(120 * gl2)); g.ellipse(wx2, wy2 + 18, 26, 10); g.fill();
    }
  }
  // 烟囱冒烟:代码帧动画(蓄力/过热时更急更黑)
  private stepSmoke(dt: number) {
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i]; p.t += dt;
      if (p.t > p.max) { this.smoke.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += (34 + 18 * (p.t / p.max)) * dt;
    }
    // 履带尘雾:按移动速度连环冒
    const dx2 = this.bx - this._dustLastBx; this._dustLastBx = this.bx;
    const spd = Math.abs(dx2) / Math.max(dt, 1e-4);
    for (let i = this.dusts.length - 1; i >= 0; i--) {
      const d = this.dusts[i]; d.t += dt;
      if (d.t > d.max) { this.dusts.splice(i, 1); continue; }
      d.x -= d.dir * 34 * dt; d.y += 24 * dt;
    }
    if (this.bossOK && !this.bDead && spd > 50 && this.dusts.length < 12) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = Math.max(0.06, 0.2 - spd * 0.00012);
        const S = this.dsc(this.bd) * 1.05;
        this.dusts.push({
          x: this.bx - Math.sign(dx2) * (26 + Math.random() * 52) * S,
          y: this.dy(this.bd) + 2 + Math.random() * 8,
          t: 0, max: 0.5 + Math.random() * 0.2,
          sc: (0.4 + Math.random() * 0.28) * S,
          fl: Math.random() < 0.5 ? -1 : 1,
          dir: Math.sign(dx2) || 1,
        });
      }
    }
    // 爆炸帧老化
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const bm = this.booms[i]; bm.t += dt;
      if (bm.t > bm.max) this.booms.splice(i, 1);
    }
    // Boss 死亡:连环小爆→终场大爆
    if (this.bDead) {
      if (this.bDeadT < 1.4) {
        this._dieBoomT -= dt;
        if (this._dieBoomT <= 0) {
          this._dieBoomT = 0.16;
          this.boomAt(this.bx + (Math.random() - 0.5) * 170, this.dy(this.bd) + 20 + Math.random() * 130, 0.6 + Math.random() * 0.5);
        }
      } else if (!this._dieBigDone) {
        this._dieBigDone = true;
        this.boomAt(this.bx, this.dy(this.bd) + 80, 2.3);
        this.addShake(14);
      }
    }
    if (!this.bossOK || this.bDead) return;
    this.smokeT -= dt;
    const rush = this.charging || this.coreOpen || this.phase() === 3;
    if (this.smokeT > 0) return;
    this.smokeT = rush ? 0.12 : 0.32;
    const S = this.dsc(this.bd) * 1.05;
    const face = this.px < this.bx ? 1 : -1;
    const BW = this.BOSS_H * this.bossAsp;
    this.smokeCi = (this.smokeCi + 1) % this.CHIM.length;
    const [fx, fyTop] = this.CHIM[this.smokeCi];
    const tx = this.bx + (fx - 0.5) * BW * S * face;
    const ty = this.dy(this.bd) - 10 + ((1 - fyTop) - 0.02) * this.BOSS_H * S;
    this.smoke.push({ x: tx, y: ty, vx: face * 4 + (Math.random() - 0.5) * 14, r0: (5 + Math.random() * 2) * S, t: 0, max: rush ? 0.8 : 1.15, dark: rush });
  }

  private drawBoss() {
    const g = this.bossG; g.clear();
    if (this.bDead && this.bDeadT > 1.7) { if (this.bossSp) this.bossSp.node.active = false; return; }
    const s = this.dsc(this.bd) * 1.05, x = this.bx, gy = this.dy(this.bd);
    const fade = this.bDead ? Math.max(0, 1 - Math.max(0, this.bDeadT - 1.2) / 0.5) : 1;
    const A = (v: number) => Math.round(v * fade);
    if (this.bossOK && this.bossSp) {
      if (this._bhitT > 0) this._bhitT -= 1 / 60;
      // 背光轮廓(把剪影从暗底里托出来=在场景里被月光照着)
      g.fillColor = new Color(196, 184, 228, A(20)); g.ellipse(x, gy + 100 * s, 122 * s, 108 * s); g.fill();
      g.fillColor = new Color(196, 184, 228, A(12)); g.ellipse(x, gy + 100 * s, 148 * s, 130 * s); g.fill();
      const br = 1 + Math.sin(this.bph * 2.2) * 0.02 + (this.charging ? Math.sin(this.t * 40) * 0.02 : 0);
      const S = s * br;
      const n = this.bossSp.node; n.active = true;
      const face = this.px < this.bx ? 1 : -1;   // 朝玩家(图默认朝左)
      const dx = x - this._lastBx; this._lastBx = x;
      const moving = Math.abs(dx) > 0.4 && !this.charging;
      this._bwalk += Math.abs(dx) * 0.05;
      const tilt = moving ? Math.sin(this._bwalk) * 3.5 : 0;              // 履带碾地=左右摇摆
      const bob = moving ? Math.abs(Math.sin(this._bwalk)) * 7 * S : 0;   // 一颠一颠往前挪
      // 双层影:半影+本影,颠起来影子略缩(接地感)
      const shk = 1 - bob * 0.012;
      g.fillColor = new Color(20, 14, 30, A(80)); g.ellipse(x, gy - 2, 122 * s * shk, 25 * s * shk); g.fill();
      g.fillColor = new Color(14, 9, 22, A(160)); g.ellipse(x, gy - 2, 92 * s * shk, 17 * s * shk); g.fill();
      // 呼吸=轻微压扁拉伸(不只缩放);受击=弹缩一下
      const bsq = Math.sin(this.bph * 2.2) * 0.012;
      const pop = this._bhitT > 0 ? 1 + this._bhitT * 0.5 : 1;
      n.setScale(face * S * (1 + bsq) * pop, S * (1 - bsq) * (2 - pop), 1);
      n.setPosition(x, gy + bob - 10, 0); n.angle = tilt;   // -10=履带踩实地面
      this.bossSp.spriteFrame = this.bossFrames[this.charging ? 1 : 0];   // 蓄力冲撞=张嘴吼
      const hot = this.phase() === 3 || this.charging || this.coreOpen;   // 过热/蓄力/核心开=染红
      this.bossSp.color = this._bhitT > 0 ? new Color(255, 244, 238, A(255))
        : hot ? new Color(255, 150, 138, A(255))
        : new Color(236, 228, 248, A(255));   // 暮紫环境染色,不再纯白直贴
      // 履带残影:移动时拖两层半透明履带条(反方向),像在转
      const spdPx = Math.abs(dx);
      const blur = Math.min(15, spdPx * 2.0);
      for (let k = 0; k < this.trackGhosts.length; k++) {
        const gsp = this.trackGhosts[k];
        const on = this.charging && spdPx > 0.8 && !this.bDead;   // 残影只在冲撞时,平时交给尘雾
        gsp.node.active = on;
        if (on) {
          gsp.spriteFrame = this.bossTrackFrames[this.charging ? 1 : 0];
          const offL = -(k + 1) * blur * Math.sign(dx) * face;   // local×face=屏幕方向,拖影在运动反向
          gsp.node.setPosition(offL, -0.02 * this.BOSS_H, 0);
          gsp.color = new Color(255, 255, 255, A(k === 0 ? 92 : 46));
        }
      }
      // 机枪臂:挂肩盘,追瞄玩家(俯仰),开火枪口白闪
      if (this.gunSp) {
        const gn2 = this.gunSp.node;
        gn2.active = !this.bDead || this.bDeadT < 1.2;
        if (gn2.active) {
          const BW2 = this.BOSS_H * this.bossAsp;
          const gx2 = x + (this.GUN_FX - 0.5) * BW2 * S * face;
          const gy2 = (gy + bob - 10) + this.GUN_FY * this.BOSS_H * S;
          const tx2 = this.px, ty2 = this.dy(this.pd) + 46 + this.ph2;
          const ta2 = Math.atan2(ty2 - gy2, tx2 - gx2);
          let dA = ta2 - this.gunA;
          while (dA > Math.PI) dA -= Math.PI * 2;
          while (dA < -Math.PI) dA += Math.PI * 2;
          this.gunA += dA * 0.12;
          gn2.setPosition(gx2, gy2, 0);
          gn2.angle = this.gunA * 180 / Math.PI;
          const GS = this.GUN_SC * S;
          gn2.setScale(GS, (Math.abs(this.gunA) > Math.PI / 2 ? -1 : 1) * GS, 1);   // 弹鼓朝下
          this.gunSp.color = this._bhitT > 0 ? new Color(255, 244, 238, A(255))
            : hot ? new Color(255, 160, 148, A(255)) : new Color(236, 228, 248, A(255));
          if (this._muzzT > 0) {
            this._muzzT -= 1 / 60;
            const ml = 100 * this.gunAsp * GS * 0.80;
            const mx2 = gx2 + Math.cos(this.gunA) * ml, my2 = gy2 + Math.sin(this.gunA) * ml;
            g.fillColor = new Color(255, 240, 190, A(200)); g.circle(mx2, my2, 12 * S); g.fill();
            g.fillColor = new Color(255, 200, 120, A(120)); g.circle(mx2, my2, 20 * S); g.fill();
          }
        }
      }
      // 履带尘雾(3帧图:小→中→大,后方拖着冒)
      for (let i = 0; i < this.dustPool.length; i++) {
        const sp2 = this.dustPool[i], d = this.dusts[i];
        if (!d || !this.dustFrames.length) { sp2.node.active = false; continue; }
        const k2 = d.t / d.max;
        sp2.node.active = true;
        sp2.spriteFrame = this.dustFrames[Math.min(2, (k2 * 3) | 0)];
        sp2.node.setPosition(d.x, d.y, 0);
        sp2.node.setScale(d.sc * d.fl * (1 + k2 * 0.25), d.sc * (1 + k2 * 0.25), 1);
        sp2.color = new Color(255, 255, 255, A(Math.round(235 * (1 - k2 * 0.85))));
      }
      // 烟囱烟(帧动画感:三档半径的双瓣卡通云)
      for (const p of this.smoke) {
        const k = p.t / p.max;
        const stg = k < 0.34 ? 0 : k < 0.67 ? 1 : 2;
        const r = p.r0 * (1 + stg * 0.75);
        const al = A(Math.round((p.dark ? 120 : 88) * (1 - k)));
        g.fillColor = p.dark ? new Color(96, 86, 100, al) : new Color(214, 208, 222, al);
        g.circle(p.x, p.y, r); g.fill();
        g.circle(p.x + r * 0.55, p.y - r * 0.35, r * 0.6); g.fill();
      }
      return;
    }
    // 影
    g.fillColor = new Color(20, 14, 30, A(115)); g.ellipse(x, gy - 6, 86 * s, 16 * s); g.fill();
    const br = 1 + Math.sin(this.bph * 2.2) * 0.02 + (this.charging ? Math.sin(this.t * 40) * 0.02 : 0);
    const S = s * br;
    // 履带
    g.fillColor = new Color(42, 36, 48, A(255)); g.rect(x - 70 * S, gy, 140 * S, 26 * S); g.fill();
    g.fillColor = new Color(72, 64, 80, A(255));
    for (let i = 0; i < 6; i++) { g.circle(x - 55 * S + i * 22 * S, gy + 13 * S, 8 * S); g.fill(); }
    // 锅炉大肚(过热泛红)
    const heat = this.coreOpen ? 0.35 + 0.15 * Math.sin(this.t * 6) : 0;
    g.fillColor = new Color(Math.round(104 + heat * 120), Math.round(88 - heat * 30), Math.round(96 - heat * 30), A(255));
    g.ellipse(x, gy + 96 * S, 84 * S, 74 * S); g.fill();
    g.fillColor = new Color(255, 240, 220, A(36)); g.ellipse(x - 24 * S, gy + 118 * S, 40 * S, 26 * S); g.fill();
    // 铆钉圈
    g.fillColor = new Color(90, 74, 84, A(255));
    for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28; g.circle(x + Math.cos(a) * 70 * S, gy + 96 * S + Math.sin(a) * 60 * S, 3.4 * S); g.fill(); }
    // 核心
    if (this.coreOpen) {
      const gl = 0.6 + 0.4 * Math.sin(this.t * 5);
      g.fillColor = new Color(36, 26, 32, A(255)); g.ellipse(x, gy + 92 * S, 30 * S, 34 * S); g.fill();
      g.fillColor = new Color(255, 150, 80, A(Math.round(255 * gl))); g.circle(x, gy + 92 * S, 18 * S); g.fill();
      g.fillColor = new Color(255, 230, 180, A(Math.round(255 * gl))); g.circle(x, gy + 92 * S, 9 * S); g.fill();
    }
    // 一大一小眼 + 豁牙嘴
    g.fillColor = new Color(240, 232, 224, A(255));
    g.circle(x - 30 * S, gy + 138 * S, 15 * S); g.fill(); g.circle(x + 6 * S, gy + 142 * S, 8 * S); g.fill();
    g.fillColor = new Color(36, 26, 36, A(255));
    g.circle(x - 33 * S, gy + 137 * S, 6 * S); g.fill(); g.circle(x + 4 * S, gy + 141 * S, 3.4 * S); g.fill();
    g.strokeColor = new Color(36, 26, 36, A(255)); g.lineWidth = 3 * S;
    g.moveTo(x - 40 * S, gy + 112 * S); g.quadraticCurveTo(x - 16 * S, gy + 100 * S, x + 8 * S, gy + 110 * S); g.stroke();
    g.fillColor = new Color(240, 232, 224, A(255)); g.rect(x - 30 * S, gy + 106 * S, 7 * S, 6 * S); g.fill(); g.rect(x - 12 * S, gy + 102 * S, 7 * S, 6 * S); g.fill();
    // 三烟囱 + 烟
    g.fillColor = new Color(58, 50, 64, A(255));
    for (let i = 0; i < 3; i++) g.rect(x + (6 + i * 20) * S, gy + (148 + i * 6) * S, 13 * S, 42 * S), g.fill();
    for (let i = 0; i < 3; i++) {
      const sm = (this.t * 0.7 + i * 0.4) % 1;
      g.fillColor = new Color(200, 196, 210, A(Math.round(60 * (1 - sm))));
      g.circle(x + (12 + i * 20) * S + sm * 10, gy + (196 + sm * 40) * S, (6 + sm * 10) * S); g.fill();
    }
    // 机枪臂(独立旋转,朝主角)
    if (!this.bDead) {
      const ax = x - 60 * s, ay = gy + 90 * s;
      const ta = Math.atan2((this.dy(this.pd) + 40 + this.ph2) - ay, this.px - ax);
      this.gunA += (ta - this.gunA) * 0.15;
      const ca = Math.cos(this.gunA), sa = Math.sin(this.gunA);
      g.strokeColor = new Color(74, 66, 84, 255); g.lineWidth = 17 * s; (g as any).lineCap = Graphics.LineCap.ROUND;
      g.moveTo(ax, ay); g.lineTo(ax + ca * 74 * s, ay + sa * 74 * s); g.stroke();
      g.strokeColor = new Color(36, 31, 44, 255); g.lineWidth = 9 * s;
      g.moveTo(ax + ca * 66 * s, ay + sa * 66 * s); g.lineTo(ax + ca * 92 * s, ay + sa * 92 * s); g.stroke();
      g.fillColor = new Color(90, 80, 100, 255); g.circle(ax + ca * 14 * s - sa * 12 * s, ay + sa * 14 * s + ca * 12 * s, 13 * s); g.fill();   // 弹鼓
      g.fillColor = new Color(58, 50, 64, 255); g.circle(ax, ay, 12 * s); g.fill();   // 肩关节
      if ((this.bst === 'fire' || this.bst === 'fanFire') && Math.floor(this.t * 30) % 2 === 0) {
        g.fillColor = new Color(255, 216, 144, 255); g.circle(ax + ca * 96 * s, ay + sa * 96 * s, 7 * s); g.fill();
      }
      // 瞄准预警(虚线用短段拼)
      if (this.bst === 'aim') {
        const ly = this.dy(this.aimD) + 40 * this.dsc(this.aimD);
        g.strokeColor = new Color(255, 80, 70, Math.round(120 + 100 * Math.sin(this.t * 18))); g.lineWidth = 2.5;
        for (let sx2 = ax - 20; sx2 > -this.maxX(this.aimD) - 40; sx2 -= 22) { g.moveTo(sx2, ly); g.lineTo(sx2 - 12, ly); }
        g.stroke();
      }
      if (this.bst === 'chargePre') {
        g.fillColor = new Color(255, 90, 70, Math.round(60 + 40 * Math.sin(this.t * 20)));
        g.ellipse(x, gy - 2, 96 * s, 18 * s); g.fill();
      }
      // 晕圈
      if (this.stun > 0) {
        for (let i = 0; i < 3; i++) {
          const a = this.t * 4 + i * 2.1;
          g.fillColor = new Color(255, 230, 150, 220);
          g.circle(x + Math.cos(a) * 40 * s, gy + 196 * s + Math.sin(a) * 10 * s, 4 * s); g.fill();
        }
      }
    }
  }
  private drawHero() {
    const s = this.dsc(this.pd);
    this.heroWrap.setPosition(this.px, this.dy(this.pd), 0);
    this.heroWrap.setScale(s, s, 1);
    let mode: HeroMode = 'idle'; let p = 0;
    const a = this.combat.anim();
    if (this.over) { this.hero.apply(0, 0, this.dir, 'dead', this.deadT, 0, 0, 0, 0); return; }
    if (this.slamJump) { mode = 'slam'; p = this.pvh > 0 ? 0.1 : 0.5; }
    else if (this.slamLandT > 0) { mode = 'slam'; p = 0.95; }
    else if (a) { mode = a.mode; p = a.p; }
    else if (this.ph2 > 0) mode = 'air';
    else if (this.keys.left || this.keys.right) mode = 'walk';
    this.hero.apply(0, this.ph2, this.dir, mode, p, -this.pvh, this.walkPh, 0, 0);
  }
  private drawFx() {
    this.fxG.clear();
    if (this.SCENE_A) this.drawYardFx(this.fxG);
    // Boss 入场景质感:履带底压一条接地暗带(假AO)+ 过热时腹部暖光(注:必须在 clear 之后画)
    if (this.bossOK && !(this.bDead && this.bDeadT > 1.7)) {
      const g0 = this.fxG;
      const s0 = this.dsc(this.bd) * 1.05, bx0 = this.bx, by0 = this.dy(this.bd);
      const fade0 = this.bDead ? Math.max(0, 1 - Math.max(0, this.bDeadT - 1.2) / 0.5) : 1;
      g0.fillColor = new Color(12, 8, 20, Math.round(70 * fade0));
      g0.ellipse(bx0, by0 + 6, 96 * s0, 12 * s0); g0.fill();
      const hot0 = this.phase() === 3 || this.charging || this.coreOpen;
      if (hot0 && !this.bDead) {
        const gl0 = 0.5 + 0.5 * Math.sin(this.t * 7);
        g0.fillColor = new Color(255, 150, 70, Math.round((26 + gl0 * 26) * fade0));
        g0.ellipse(bx0, by0 + 72 * s0, 52 * s0, 40 * s0); g0.fill();
        if (Math.random() < 0.25) this.spark(bx0 + (Math.random() - 0.5) * 60 * s0, by0 + 60 * s0, new Color(255, 170, 90, 200), 1, 0.5);
      }
    }
    const g = this.fxG;
    // 落点红圈
    for (const bo of this.bombs) {
      if (bo.st !== 'fly') continue;
      const s = this.dsc(bo.td), k = Math.min(1, bo.t / bo.T);
      g.strokeColor = new Color(255, 80, 70, Math.round(120 + 100 * Math.sin(this.t * 14))); g.lineWidth = 3;
      g.ellipse(bo.tx, this.dy(bo.td), 56 * s * (1.3 - k * 0.3), 15 * s * (1.3 - k * 0.3)); g.stroke();
    }
    // 火焰区
    for (const z of this.zones) {
      const s = this.dsc(z.d), a = 1 - z.life / z.max;
      g.fillColor = new Color(255, 120, 50, Math.round(76 * a)); g.ellipse(z.x, this.dy(z.d), 52 * s, 14 * s); g.fill();
      for (let i = 0; i < 4; i++) {
        const fx2 = z.x + (this.rnd(i + z.x) - 0.5) * 80 * s;
        const fh = (14 + this.rnd(i * 3 + z.x) * 18) * (0.6 + 0.4 * Math.sin(this.t * 9 + i)) * s;
        g.fillColor = new Color(255, Math.round(140 + this.rnd(i) * 60), 60, Math.round(140 * a));
        g.ellipse(fx2, this.dy(z.d) + fh / 2, 5 * s, fh); g.fill();
      }
    }
    // 子弹曳光
    for (const b of this.bullets) {
      const s = this.dsc(b.d);
      const y = b.y0 !== undefined ? b.y0 : this.dy(b.d) + 40 * s;   // 从枪口那条线直飞
      g.strokeColor = new Color(255, 216, 140, 230); g.lineWidth = 3 * s;
      g.moveTo(b.x + 16, y); g.lineTo(b.x - 10, y); g.stroke();
      g.fillColor = new Color(255, 246, 214, 255); g.circle(b.x - 10, y, 2.4 * s); g.fill();
    }
    // 空中炸弹(真图:旋转铁球+代码引线火花;无图退回圆球)
    if (this.bombSF) {
      for (let i = 0; i < this.bombPool.length; i++) {
        const sp2 = this.bombPool[i], bo = this.bombs[i];
        if (!bo) { sp2.node.active = false; continue; }
        sp2.node.active = true;
        const bs = this.dsc(bo.td) * 1.1;
        sp2.node.setPosition(bo.x, bo.y, 0);
        sp2.node.setScale(bs, bs, 1);
        sp2.node.angle = (bo.st === 'fly' ? -1 : 1.6) * this.t * 300 % 360;
        // 引线火花(顶上一闪一闪)
        g.fillColor = new Color(255, 200, 90, Math.round(150 + 100 * Math.sin(this.t * 22 + i)));
        g.circle(bo.x + Math.sin(this.t * 3 + i) * 2, bo.y + 19 * bs, 3.4 * bs); g.fill();
        g.fillColor = new Color(255, 240, 190, Math.round(120 + 90 * Math.sin(this.t * 26 + i)));
        g.circle(bo.x, bo.y + 19 * bs, 1.8 * bs); g.fill();
      }
    } else {
      for (const bo of this.bombs) {
        g.fillColor = new Color(44, 38, 50, 255); g.circle(bo.x, bo.y, 11); g.fill();
        g.fillColor = new Color(74, 66, 84, 255); g.rect(bo.x - 3, bo.y + 9, 6, 6); g.fill();
        g.fillColor = new Color(255, 180, 80, Math.round(128 + 127 * Math.sin(this.t * 20)));
        g.circle(bo.x, bo.y + 17, 3); g.fill();
      }
    }
    // 爆炸帧(池)
    for (let i = 0; i < this.boomPool.length; i++) {
      const sp2 = this.boomPool[i], bm = this.booms[i];
      if (!bm || !this.boomFrames.length) { sp2.node.active = false; continue; }
      const k = bm.t / bm.max;
      sp2.node.active = true;
      sp2.spriteFrame = this.boomFrames[Math.min(3, (k * 4) | 0)];
      sp2.node.setPosition(bm.x, bm.y, 0);
      const bsc = bm.sc * (0.72 + k * 0.55);
      sp2.node.setScale(bsc, bsc, 1);
      sp2.color = new Color(255, 255, 255, Math.round(k > 0.75 ? 255 * (1 - (k - 0.75) / 0.25) : 255));
    }
    // 粒子
    for (const p of this.parts) {
      const a = 1 - p.life / p.max;
      g.fillColor = new Color(p.col.r, p.col.g, p.col.b, Math.round(235 * a));
      g.circle(p.x, p.y, p.r); g.fill();
    }
    // 白光
    for (const f of this.flashes) {
      const k = f.life / f.max, a = 1 - k;
      g.fillColor = new Color(255, 255, 255, Math.round(205 * a)); g.circle(f.x, f.y, 8 + 30 * k); g.fill();
      g.strokeColor = new Color(255, 250, 230, Math.round(230 * a)); g.lineWidth = 3; g.circle(f.x, f.y, 14 + 52 * k); g.stroke();
    }
    // 围墙·近半圈(压在角色前,遮脚=圆形围场的包裹感;有真图就不画)
    if (!this.wallOK && !this.SCENE_A) this.wallArc(g, Math.PI * 1.06, Math.PI * 1.94, new Color(96, 86, 112, 255), new Color(156, 142, 174, 240));
    if (!this.frontOK && !this.SCENE_A) {
    // ── 前景遮挡带(圆场四周的城市残骸剪影,压在最前=框景) ──
    // 下缘:瓦砾/箱子/车轮/杂草 暗剪影
    g.fillColor = new Color(24, 18, 36, 255);
    g.moveTo(-W / 2 - 20, -H / 2 - 20);
    let fy2 = -H / 2 + 118;
    g.lineTo(-W / 2 - 20, fy2);
    for (let i = 0; i <= 12; i++) {
      const fx3 = -W / 2 + i / 12 * W;
      g.lineTo(fx3, fy2 - 26 + this.rnd(i * 7.3) * 52 + Math.sin(i * 2.2) * 10);
    }
    g.lineTo(W / 2 + 20, -H / 2 - 20); g.close(); g.fill();
    // 破木箱(左下)
    g.fillColor = new Color(30, 23, 42, 255);
    g.rect(-W / 2 + 24, -H / 2 + 60, 86, 78); g.fill();
    g.strokeColor = new Color(44, 34, 58, 255); g.lineWidth = 4;
    g.moveTo(-W / 2 + 24, -H / 2 + 60); g.lineTo(-W / 2 + 110, -H / 2 + 138);
    g.moveTo(-W / 2 + 110, -H / 2 + 60); g.lineTo(-W / 2 + 24, -H / 2 + 138); g.stroke();
    // 破车轮(右下,斜倚)
    g.strokeColor = new Color(30, 23, 42, 255); g.lineWidth = 9;
    g.circle(W / 2 - 74, -H / 2 + 108, 52); g.stroke();
    g.lineWidth = 4;
    for (let i = 0; i < 4; i++) { const a2 = 0.4 + i * 0.785; g.moveTo(W / 2 - 74 - Math.cos(a2) * 48, -H / 2 + 108 - Math.sin(a2) * 48); g.lineTo(W / 2 - 74 + Math.cos(a2) * 48, -H / 2 + 108 + Math.sin(a2) * 48); }
    g.stroke();
    // 杂草丛(几撮,轻摆)
    g.strokeColor = new Color(38, 34, 30, 255); g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const gx2 = -W / 2 + 40 + this.rnd(i * 11.7) * (W - 80);
      const gy3 = -H / 2 + 96 + this.rnd(i * 5.1) * 40;
      const sw2 = Math.sin(this.t * 1.6 + i) * 4;
      for (let b2 = -1; b2 <= 1; b2++) { g.moveTo(gx2 + b2 * 4, gy3); g.quadraticCurveTo(gx2 + b2 * 6 + sw2, gy3 + 16, gx2 + b2 * 9 + sw2 * 1.6, gy3 + 27 + this.rnd(i + b2) * 8); }
    }
    g.stroke();
    // 左右下角:断墙残垣一角(暗)
    g.fillColor = new Color(27, 21, 39, 255);
    g.moveTo(-W / 2 - 10, -H / 2 + 210); g.lineTo(-W / 2 + 54, -H / 2 + 196); g.lineTo(-W / 2 + 64, -H / 2 + 120); g.lineTo(-W / 2 - 10, -H / 2 + 110); g.close(); g.fill();
    g.moveTo(W / 2 + 10, -H / 2 + 196); g.lineTo(W / 2 - 48, -H / 2 + 184); g.lineTo(W / 2 - 58, -H / 2 + 116); g.lineTo(W / 2 + 10, -H / 2 + 108); g.close(); g.fill();
    }
    // Boss 血条(世界上方,画在 fx 层顶部)
    if (!this.bDead) {
      g.fillColor = new Color(10, 8, 16, 180); g.rect(-200, H / 2 - 76, 400, 16); g.fill();
      const hpw = 396 * this.bhp / this.BHP;
      g.fillColor = this.phase() === 3 ? new Color(224, 90, 72, 255) : new Color(176, 106, 224, 255);
      g.rect(-198, H / 2 - 74, Math.max(0, hpw), 12); g.fill();
      g.strokeColor = new Color(230, 220, 250, 128); g.lineWidth = 2; g.rect(-200, H / 2 - 76, 400, 16); g.stroke();
    }
  }
}
