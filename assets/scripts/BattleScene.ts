import {
  _decorator, Component, Node, Graphics, Label, LabelOutline,
  UITransform, UIOpacity, Color, tween, Vec3,
  input, Input, EventKeyboard, KeyCode,
  Sprite, SpriteFrame, Texture2D, Rect, resources,
} from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { AudioMgr } from './AudioMgr';
import { hLine, hArc } from './HandDraw';
const { ccclass, property } = _decorator;

type Pose = 'walk' | 'idle' | 'attack' | 'dead';
type ZoneState = 'fight' | 'cleared' | 'scroll';

interface Stick {
  x: number; lane: number; scale: number; dir: number;   // x = 世界坐标
  color: Color; state: Pose;
  phase: number; swing: number;
  deadT: number; fallSign: number;
  weapon: boolean; horns: boolean;
  hitT: number;
  atkType: number;      // 0 下劈 / 1 上挑 / 2 跳劈（怪固定 0=出拳）
  jumpY: number; jumpVy: number;   // 跳劈用的垂直高度/速度（怪恒 0）
  slamProg: number;     // 跳劈姿态进度 0→1（举刀→劈下）
  crouch: number;       // 蹲姿 -0.3~0.7（正=屈膝下蹲，负=踮脚起身）
  scaleBoost: number;   // 整体放大倍数（1=常态，下劈瞬间放大）
}

interface Monster extends Stick {
  hp: number; hpMax: number;
  atkCd: number; vx: number;
  attacking: boolean;   // 是否正在挥击（起手→命中→收招）
  struck: boolean;      // 本次挥击是否已结算伤害
  kind: string;         // foot/shield/archer/elite
  atk: number;          // 对主角伤害
  speed: number;        // 移动速度
  ranged: boolean;      // 远程（弓手）
  coin: number;         // 死亡掉金币数
  slamState?: 'none' | 'windup' | 'strike';   // Boss 预警重击阶段
  slamT?: number;       // 当前阶段剩余时间
  slamCd?: number;      // 距下次重击
  slamX?: number;       // 重击落点（蓄力时锁定）
  raged?: boolean;      // Boss 二阶段（血≤50% 狂暴）
  dashT?: number;       // Boss 横冲剩余时间
  dashCd?: number;      // Boss 距下次横冲
}

interface Arrow { x: number; y: number; vx: number; vy: number; life: number; }   // 敌方箭
interface Drop { x: number; y: number; vy: number; life: number; flying: boolean; sx: number; sy: number; }  // 金币掉落
interface DmgNum { n: Node; life: number; max: number; x: number; y: number; }    // 伤害数字

interface Spark { x: number; y: number; life: number; max: number; }
interface Blood { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; shade: number; }
interface Wave { x: number; y: number; dir: number; life: number; max: number; hit: Set<Monster>; }   // 剑气波

interface Theme { name: string; sky: number[]; hill: number[]; ground: number[]; prop: string; }

// 出征打怪（横版闯关）：操控主角在横向卷动的地图上砍怪。
// 每关锁镜头 → 清光小怪 → 出现「前进 →」→ 走到右侧卷屏进入下一关（不同场景）。
// 纯 Graphics 手绘，无需美术资源。A/← D/→ 移动，空格/J 攻击。
@ccclass('BattleScene')
export class BattleScene extends Component {
  static instance: BattleScene | null = null;

  @property groundFy = 0.6;
  @property heroSpeed = 320;
  @property attackRange = 135;
  @property attackDmg = 40;
  @property maxMonsters = 6;

  private readonly ZONE_SPAN = 720;   // 每关卷动一屏
  private readonly SCROLL_SPEED = 600;   // 卷屏匀速（px/s，约 1.2s 走完一屏）
  private readonly SWING_DUR = 0.15;
  private readonly HERO_ATK_COOLDOWN = 0.08;
  private readonly HIT_DUR = 0.3;
  private readonly COMBO_WINDOW = 0.55;   // 这么久内再点算连招
  private readonly SPECIAL_CD = 1.2;      // 剑气波冷却
  private readonly PREJUMP_DUR = 0.14;    // 起跳前的蓄力下蹲时长
  private readonly JUMP_PRE = 0.1;        // 普通跳跃：起跳前下蹲蓄力时长
  private readonly JUMP_MOVE_VY = 900;    // 普通跳跃：起跳速度
  private readonly GRAVITY_MOVE = 2500;   // 普通跳跃：重力
  private readonly JUMP_LAND = 0.18;      // 普通跳跃：落地缓冲下蹲时长
  private readonly JUMP_VY = 980;         // 跳劈起跳速度
  private readonly GRAVITY_J = 2800;      // 跳劈重力
  private readonly LAND_DUR = 0.7;        // 落地深蹲→起身时长（越大起身越慢）
  // Boss 预警重击
  private readonly BOSS_SLAM_WINDUP = 0.95;  // 蓄力→砸下的预警时长（红圈亮起）
  private readonly BOSS_SLAM_CD = 3.4;       // 两次重击间隔
  private readonly BOSS_SLAM_R = 150;        // 命中半径（红圈半径）
  private readonly BOSS_SLAM_DMG = 34;       // 重击伤害

  // 背景组：每 5 关一个场景，Boss 单独一个场景（缺图会自动沿用上一组，不报错）。
  // near 没有专属图就复用 bg-near-grass。最后一组固定给 Boss 关。
  // 第 1-5 关=青原，第 6-9 关=密林，第 10 关(Boss)=焦土。
  private readonly BIOMES = [
    { name: '密林', far: 'bg-far-forest', mid: 'bg-mid-forest', near: 'bg-near-forest' },   // 第 1-5 关
    { name: '青原', far: 'bg-far-mtn',    mid: 'bg-mid-hills',  near: 'bg-near-grass' },     // 第 6-9 关
    { name: '焦土', far: 'bg-far-ruins',  mid: 'bg-mid-ruins',  near: 'bg-near-ruins' },     // 第 10 关 Boss 专属
  ];

  // 场景只两种（一套素材通用）；主要靠时段变化出氛围
  private readonly THEMES: Theme[] = [
    { name: '草原', sky: [120, 178, 150], hill: [72, 128, 95], ground: [96, 140, 80], prop: 'bush' },
    { name: '密林', sky: [70, 108, 90], hill: [40, 78, 58], ground: [54, 92, 60], prop: 'tree' },
  ];

  // 时段：驱动天空色 + 全屏色调滤镜 + 夜晚压暗。真背景图叠上它就有清晨/黄昏/夜的感觉
  private readonly TIMES = [
    { name: '清晨', sky: [255, 224, 188], grade: [210, 150, 95, 30], dark: 0.0 },
    { name: '正午', sky: [150, 196, 226], grade: [185, 195, 175, 16], dark: 0.0 },
    { name: '黄昏', sky: [255, 150, 92], grade: [214, 108, 58, 46], dark: 0.05 },
    { name: '夜晚', sky: [42, 56, 96], grade: [40, 58, 112, 58], dark: 0.4 },
  ];

  // 主角赵云精灵
  private readonly HERO_ROW = 1;          // 骑马赵云：侧面攻击行
  private readonly SPRITE_SCALE = 1.8;    // 64px 帧放大倍数
  private heroNode!: Node;
  private headNode!: Node;
  private heroSp!: Sprite;          // 上半身（骑马赵云，带攻击）
  private heroOp!: UIOpacity;
  private legsNode!: Node;
  private legsSp!: Sprite;          // 下半身腿（步战赵云）
  private upperFrames: SpriteFrame[] = [];
  private legsFrames: SpriteFrame[] = [];
  private footNode!: Node;          // 步战赵云完整身体（走路/待机用，不拼接）
  private footSp!: Sprite;
  private footFullFrames: SpriteFrame[] = [];
  // 敌人精灵（轻步兵）：像 Boss 一样用精灵节点，替代纯代码像素兵
  private infantryFrames: SpriteFrame[] = [];   // foot 兜底帧（兼做加载就绪判定）
  private kindFrames: Record<string, SpriteFrame[]> = {};       // 各兵种帧：foot/shield/elite/archer
  private kindDisp: Record<string, [number, number]> = {};      // 各兵种显示尺寸
  private monPool: { node: Node; sp: Sprite; op: UIOpacity }[] = [];
  private readonly INF_SCALE = 1.5;      // 轻步兵精灵放大
  private readonly DISMOUNT = false;   // 下马实验：只用骑士上半身 + 程序火柴腿（false=骑马版）
  private readonly LEG_LEN = 40;
  private torsoFrames: SpriteFrame[] = [];
  // Boss 精灵（许褚）
  private readonly BOSS_ROW = 1;
  private readonly BOSS_SCALE = 3.4;
  private bossFrames: SpriteFrame[] = [];
  private bossNode!: Node;
  private bossHeadNode!: Node;
  private bossSp!: Sprite;
  private bossOp!: UIOpacity;
  private zyFrames: SpriteFrame[] = [];    // 赵云侧面 4 帧

  private bgG!: Graphics;
  private stageG!: Graphics;
  private fgG!: Graphics;   // 前景层（主角之上、暗角之下）
  private bossPropRoot!: Node;   // Boss 关近景道具容器（角色之下）
  private bossProps: { node: Node; wx: number; dy: number; res: string }[] = [];
  private bossGlowG!: Graphics;  // 道具垫底层：接地影 + 火盆暖光晕（在道具贴图之下）
  private readonly PROPS_ARENA_ZONE = 9;   // 道具所在关：Boss 关（第 10 关）
  private layers: { tiles: Node[]; w: number; par: number; baseY: number; dispH: number }[] = [];   // 视差背景层（远→近）
  private bgCache: Record<string, SpriteFrame> = {};   // 背景图缓存（换关不重复加载）
  private curBiome = -1;   // 当前已应用的背景组，-1=未设
  // 卷屏走路换景：老场景左滑出、新场景右滑入
  private transActive = false;
  private transP = 0;        // 换景进度 0→1
  private transFrom = 0;
  private transTo = 0;
  private scoreLbl!: Label;
  private zoneLbl!: Label;
  private hintLbl!: Label;
  private arrow!: Node;
  private banner!: Node;
  private bannerLbl!: Label;
  private restartBtn!: Node;

  private groundY = 0;

  private hero!: Stick & { hp: number; hpMax: number; invuln: number; atkTimer: number; attacking: boolean; hitApplied: boolean; kx: number; combo: number; specialCd: number; landT: number; preJump: number; jumping: boolean; jmpPre: number; jmpLand: number };
  private monsters: Monster[] = [];
  private sparks: Spark[] = [];
  private bloods: Blood[] = [];
  private waves: Wave[] = [];
  private arrows: Arrow[] = [];
  private drops: Drop[] = [];
  private flashes: { x: number; y: number; life: number; max: number }[] = [];   // 冲击白光
  private dmgNums: DmgNum[] = [];
  private dmgPoolFree: Node[] = [];
  private dmgLayer!: Node;         // 伤害数字容器
  private zoneIntroLbl!: Label;    // 关卡开场大字
  private zoneIntroOp!: UIOpacity;
  private zoneIntroT = 0;
  private readonly ZONE_INTRO_DUR = 1.6;
  private slowMoT = 0;             // 胜利慢动作剩余时间
  private dusts: { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }[] = [];
  private walkDustT = 0;           // 跑动扬尘节流
  private stepSndT = 0;            // 脚步声节流
  private bossGhosts: { node: Node; sp: Sprite; op: UIOpacity }[] = [];   // Boss 冲刺残影池
  private ghostIdx = 0;
  private ghostT = 0;
  private decorFrames: SpriteFrame[] = [];   // 地面装饰贴图（找到几张用几张）
  private decorPool: { node: Node; sp: Sprite }[] = [];
  private coins = 0;
  private comboCount = 0;
  private comboT = 0;
  private comboX = 0;   // 连击提示位置（最近命中点，世界坐标）
  private comboY = 0;
  private coinLbl!: Label;
  private comboLbl!: Label;

  // 局内成长
  private heroLevel = 1;
  private xp = 0;
  private xpNext = 30;
  private pendingLevels = 0;
  private choosing = false;
  private killHeal = 0;
  private specialCdCur = 1.2;
  private baseAtk = 40;
  private baseSpeed = 320;
  private levelLbl!: Label;
  private upgradePanel!: Node;
  private cardTitle: Label[] = [];
  private cardDesc: Label[] = [];
  private cardApply: (() => void)[] = [];
  private bossSpawned = false;

  private readonly UPGRADES: { name: string; desc: string; apply: () => void }[] = [
    { name: '力大无穷', desc: '攻击 +25%', apply: () => { this.attackDmg *= 1.25; } },
    { name: '铁骨', desc: '最大生命+30 并回满', apply: () => { this.hero.hpMax += 30; this.hero.hp = this.hero.hpMax; } },
    { name: '疾风步', desc: '移速 +15%', apply: () => { this.heroSpeed *= 1.15; } },
    { name: '剑气奔涌', desc: '剑气冷却 -25%', apply: () => { this.specialCdCur *= 0.75; } },
    { name: '嗜血', desc: '击杀回血 +8', apply: () => { this.killHeal += 8; } },
    { name: '疗伤', desc: '立即回满血', apply: () => { this.hero.hp = this.hero.hpMax; } },
  ];

  // 兵种：hp倍率/体型/速度/伤害/颜色/远程/金币
  private readonly KINDS: Record<string, { hpMul: number; scaleMul: number; speed: number; dmg: number; color: number[]; ranged: boolean; coin: number; w: number }> = {
    foot: { hpMul: 1.0, scaleMul: 1.0, speed: 95, dmg: 9, color: [178, 54, 48], ranged: false, coin: 1, w: 5 },   // 步兵 红
    shield: { hpMul: 1.9, scaleMul: 1.25, speed: 52, dmg: 13, color: [86, 108, 150], ranged: false, coin: 2, w: 2 }, // 盾兵 蓝厚慢
    archer: { hpMul: 0.65, scaleMul: 0.95, speed: 72, dmg: 7, color: [92, 150, 92], ranged: true, coin: 2, w: 2 }, // 弓手 绿远程
    elite: { hpMul: 2.5, scaleMul: 1.4, speed: 108, dmg: 17, color: [150, 66, 156], ranged: false, coin: 4, w: 1 }, // 精英 紫大
  };

  // 10 关节奏表（下标=zone）：count 总怪数 / pool 兵种权重池 / openers 开场必刷 /
  // interval 刷怪间隔秒(缺省用公式) / bothSides 双侧夹击 / night 强制夜战 / lootMul 掉落倍率
  private readonly ZONE_PLAN: {
    count: number; pool: [string, number][]; openers?: string[];
    interval?: number; bothSides?: boolean; night?: boolean; lootMul?: number;
  }[] = [
    { count: 4, pool: [['foot', 1]] },                                                                  // 第1关 教学：纯步兵
    { count: 5, pool: [['foot', 3], ['shield', 2]] },                                                   // 第2关 盾兵首见
    { count: 7, pool: [['foot', 4], ['shield', 2]] },                                                   // 第3关 量变多
    { count: 7, pool: [['foot', 3], ['shield', 1], ['archer', 2]] },                                    // 第4关 弓手首见
    { count: 3, pool: [['foot', 1]], interval: 1.6, lootMul: 2 },                                       // 第5关 喘息：怪少掉落翻倍
    { count: 8, pool: [['foot', 3], ['shield', 2], ['archer', 2]], night: true },                       // 第6关 夜战
    { count: 9, pool: [['foot', 4], ['shield', 2], ['archer', 2]], bothSides: true, interval: 0.75 },   // 第7关 双侧夹击
    { count: 8, pool: [['foot', 3], ['shield', 2], ['archer', 1]], openers: ['elite', 'elite'] },       // 第8关 双精英开场
    { count: 11, pool: [['foot', 4], ['shield', 2], ['archer', 2], ['elite', 1]], openers: ['elite', 'elite'], interval: 0.7 }, // 第9关 大波冲刺
    { count: 0, pool: [['foot', 1]] },                                                                  // 第10关 Boss（spawnBoss 接管）
  ];
  private zonePlan() { return this.ZONE_PLAN[Math.min(this.zone, this.ZONE_PLAN.length - 1)]; }

  // 氛围浮尘粒子（柳絮/萤火/飘雪，随场景变）
  private motes: { x: number; y: number; vx: number; vy: number; ph: number; r: number }[] = [];

  private leftHeld = false;
  private rightHeld = false;

  private score = 0;
  private spawnT = 0;
  private animT = 0;   // 全局动画时钟（飘带/呼吸等环境动效）
  private over = false;
  private arrowT = 0;
  private hitStop = 0;      // 顿帧：>0 时全场定格
  private shakeT = 0;       // 屏幕震动剩余时长
  private shakeMag = 0;     // 震动幅度

  // 镜头 / 关卡
  private camX = 0;
  private zone = 0;
  private zoneState: ZoneState = 'fight';
  private targetCam = 0;
  private waveRemaining = 0;

  onLoad() {
    BattleScene.instance = this;
    const W = DESIGN_W, H = DESIGN_H;
    this.groundY = (0.5 - this.groundFy) * H;
    this.baseAtk = this.attackDmg; this.baseSpeed = this.heroSpeed; this.specialCdCur = this.SPECIAL_CD;

    const rootUI = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    rootUI.setContentSize(W, H);
    rootUI.setAnchorPoint(0.5, 0.5);
    this.node.on(Node.EventType.TOUCH_END, () => {}, this);

    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);

    this.bgG = this.child('bg').addComponent(Graphics);      // 天空/地面每帧重画

    // 视差背景层（真图，无缝滚动）：远→近，在天空之上、角色之下
    // 远山画高些（峰顶自然高过中景）、底边压回地平线藏住 → 无空隙
    this.makeScrollLayer('bg-far-mtn', 380, 0.25, 0);     // 远山（高）
    this.makeScrollLayer('bg-mid-hills', 300, 0.5, 0);    // 中景丘陵 + 山河牌坊
    this.makeScrollLayer('bg-near-grass', 180, 0.7, -30); // 近景草坡（角色身后）
    // 地面石块切面：草皮唇边对齐地面线（原尺寸 1:1），主角就站在唇边上 → 与草地融为一体
    this.makeScrollLayer('bg-fg-stone', 524, 1.0, -494);

    // 地面装饰散布：资源存在几张用几张（decor-*.png 丢进 resources 即生效）
    const decorRoot = this.child('grounddecor');
    for (let i = 0; i < 16; i++) {
      const n = new Node('decor' + i); n.layer = this.node.layer; n.parent = decorRoot;
      n.addComponent(UITransform).setAnchorPoint(0.5, 0);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.color = new Color(205, 208, 198, 255);   // 略压暗融入环境
      n.active = false;
      this.decorPool.push({ node: n, sp });
    }
    for (const res of ['decor-mushroom', 'decor-fern', 'decor-stump', 'decor-log',
                       'decor-stone', 'decor-flower', 'decor-root', 'decor-grass']) {
      resources.load(res + '/spriteFrame', SpriteFrame, (e, sf) => {
        if (!e && sf) { (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST); this.decorFrames.push(sf); }
      });
    }

    // Boss 关近景道具（AI 贴图：曹军大旗/青铜火盆/断枪/破盾/拒马；垫在角色之下）
    this.bossPropRoot = this.child('bossprops');
    {
      const arenaX = this.PROPS_ARENA_ZONE * this.ZONE_SPAN;
      // 垫底层（先建=画在道具贴图后面）：接地影 + 火盆光晕
      const glowN = new Node('propglow'); glowN.layer = this.node.layer; glowN.parent = this.bossPropRoot;
      glowN.addComponent(UITransform);
      this.bossGlowG = glowN.addComponent(Graphics);
      const mk = (res: string, wx: number, w: number, h: number, flip = false, dy = 0) => {
        const n = new Node(res); n.layer = this.node.layer; n.parent = this.bossPropRoot;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0);   // 锚在脚底，落地即贴地
        const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        n.getComponent(UITransform)!.setContentSize(w, h);
        if (flip) n.setScale(-1, 1, 1);
        resources.load(res + '/spriteFrame', SpriteFrame, (e, sf) => { if (!e && sf) sp.spriteFrame = sf; });
        this.bossProps.push({ node: n, wx, dy, res });
      };
      // 旗/枪/盾/拒马放大一倍增强存在感；火盆保持
      mk('boss-flag', arenaX + 245, 116, 226, true);    // 曹旗（右侧，镜像）
      mk('boss-brazier', arenaX + 158, 53, 38);         // 火盆（右侧）
      mk('boss-spear', arenaX - 60, 50, 82);            // 断枪插地
      mk('boss-shield', arenaX + 70, 58, 38);           // 破盾倒地
      mk('boss-barricade', arenaX + 320, 188, 84);      // 拒马
      this.bossPropRoot.active = false;
    }

    this.stageG = this.child('stage').addComponent(Graphics);

    // 敌人精灵池（轻步兵）：预建若干精灵节点，逐帧分配给活着的小怪
    const enemyLayer = this.child('enemies');
    for (let i = 0; i < 10; i++) {
      const n = new Node('enemy' + i); n.layer = this.node.layer; n.parent = enemyLayer;
      const u = n.addComponent(UITransform); u.setContentSize(40, 46); u.setAnchorPoint(0.5, 0);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      const op = n.addComponent(UIOpacity);
      n.active = false;
      this.monPool.push({ node: n, sp, op });
    }
    // 各兵种精灵表（同一素材规范：4×4 图集，行 1=侧面行走）
    // foot/archer=48×64 小图格；shield/elite=64×64 大图格
    const loadKind = (kind: string, res: string, cellW: number, pad: [number, number, number, number], disp: [number, number]) => {
      resources.load(res + '/spriteFrame', SpriteFrame, (e, base) => {
        if (e || !base) { console.warn(kind + ' 贴图加载失败：', e); return; }
        const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
        const ROW = 1;   // 侧面行走行
        const arr: SpriteFrame[] = [];
        for (let c = 0; c < 4; c++) {
          const sf = new SpriteFrame(); sf.texture = tex;
          sf.rect = new Rect(c * cellW + pad[0], ROW * 64 + pad[1], pad[2], pad[3]);
          arr.push(sf);
        }
        this.kindFrames[kind] = arr;
        this.kindDisp[kind] = disp;
        if (kind === 'foot') this.infantryFrames = arr;   // 兜底 + 就绪判定
      });
    };
    loadKind('foot', 'enemy-infantry', 48, [4, 10, 40, 46], [40, 46]);   // 轻步兵 红
    loadKind('shield', 'enemy-guard', 64, [8, 6, 48, 54], [44, 50]);    // 盾兵 = 近卫兵 蓝甲带盾
    loadKind('elite', 'enemy-heavy', 64, [8, 6, 48, 54], [44, 50]);     // 精英 = 重步兵 红橙重甲
    loadKind('archer', 'enemy-archer', 48, [4, 10, 40, 46], [40, 46]);  // 弓手 弓兵

    // Boss 精灵（许褚，大刀上劈）：在角色层，默认隐藏
    for (let i = 0; i < 6; i++) {   // Boss 冲刺残影池（先建=画在 Boss 身后）
      const n = this.child('bossghost' + i);
      const u2 = n.getComponent(UITransform)!; u2.setContentSize(64, 64); u2.setAnchorPoint(0.5, 0.156);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      const op = n.addComponent(UIOpacity);
      n.active = false;
      this.bossGhosts.push({ node: n, sp, op });
    }
    this.bossNode = this.child('boss');
    this.bossNode.getComponent(UITransform)!.setContentSize(64, 64);
    this.bossNode.getComponent(UITransform)!.setAnchorPoint(0.5, 0.156);   // 锚点在脚（帧底上方10px）→ 对齐地平线
    this.bossSp = this.bossNode.addComponent(Sprite);
    this.bossSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.bossOp = this.bossNode.addComponent(UIOpacity);
    this.bossNode.active = false;
    resources.load('enemy-xuchu/spriteFrame', SpriteFrame, (e, base) => {
      if (e || !base) { console.warn('许褚贴图加载失败：', e); return; }
      const tex = base.texture as Texture2D;
      tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 4; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 64, this.BOSS_ROW * 64, 64, 64);
        this.bossFrames.push(sf);
      }
      // 切头做子节点 → 挨揍时单独放大
      const hSf = new SpriteFrame(); hSf.texture = tex;
      hSf.rect = new Rect(3 * 64 + 18, this.BOSS_ROW * 64 + 10, 27, 20);   // 待机帧内头部
      this.bossHeadNode = new Node('bosshead');
      this.bossHeadNode.layer = this.node.layer; this.bossHeadNode.parent = this.bossNode;
      const bhu = this.bossHeadNode.addComponent(UITransform); bhu.setContentSize(27, 20); bhu.setAnchorPoint(0.5, 0.5);
      const bhsp = this.bossHeadNode.addComponent(Sprite); bhsp.sizeMode = Sprite.SizeMode.CUSTOM; bhsp.spriteFrame = hSf;
      this.bossHeadNode.setPosition(-1, 34, 0);
    });

    // 主角 = 骑马赵云上半身(带刺枪攻击) + 步战赵云腿（拼接的下马赵云）
    this.heroNode = this.child('hero');
    this.heroNode.getComponent(UITransform)!.setAnchorPoint(0.5, 0);
    this.heroOp = this.heroNode.addComponent(UIOpacity);
    this.heroNode.active = false;
    // 下半身（步战腿）
    this.legsNode = new Node('herolegs'); this.legsNode.layer = this.node.layer; this.legsNode.parent = this.heroNode;
    const lu = this.legsNode.addComponent(UITransform); lu.setContentSize(32, 28); lu.setAnchorPoint(0.5, 0);
    this.legsSp = this.legsNode.addComponent(Sprite); this.legsSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.legsNode.setPosition(0, 0, 0);
    // 上半身（骑马赵云，带攻击）—— 盖在腿上、腰部对接
    const upperNode = new Node('heroupper'); upperNode.layer = this.node.layer; upperNode.parent = this.heroNode;
    const uu = upperNode.addComponent(UITransform); uu.setContentSize(52, 22); uu.setAnchorPoint(0.5, 0);
    this.heroSp = upperNode.addComponent(Sprite); this.heroSp.sizeMode = Sprite.SizeMode.CUSTOM;
    upperNode.setPosition(-6, 26, 0);   // x-6:躯干对到腿上; y26:腰(裁剪底=y22)压到腿顶(28)、略重叠对接
    // 步战赵云完整身体（走路/待机用；不拼接）
    this.footNode = new Node('herofoot'); this.footNode.layer = this.node.layer; this.footNode.parent = this.heroNode;
    const fu = this.footNode.addComponent(UITransform); fu.setContentSize(40, 44); fu.setAnchorPoint(0.5, 0);
    this.footSp = this.footNode.addComponent(Sprite); this.footSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.footNode.setPosition(1, 0, 0);
    // 骑马赵云上半身帧（第1行，去马；x22~54,y0~34）
    resources.load('zhaoyun-horse/spriteFrame', SpriteFrame, (err, base) => {
      if (err || !base) { console.warn('骑马赵云加载失败：', err); return; }
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 4; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 64 + 2, this.HERO_ROW * 64, 52, 22);   // 宽52含整杆枪; 高22只留头+身+枪,砍掉下面的马
        this.upperFrames.push(sf);
      }
      this.heroSp.spriteFrame = this.upperFrames[3];
    });
    // 步战赵云腿（第1行下半身；x8~40,y30~58）
    resources.load('zhaoyun-foot/spriteFrame', SpriteFrame, (err, base) => {
      if (err || !base) { console.warn('步战赵云加载失败：', err); return; }
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 2; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 48 + 11, this.HERO_ROW * 64 + 30, 32, 28);   // 居中于腿(x27)
        this.legsFrames.push(sf);
      }
      this.legsSp.spriteFrame = this.legsFrames[0];
      // 完整身体 4 帧（x4~44,y13~57；走路循环）
      for (let c = 0; c < 4; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 48 + 4, this.HERO_ROW * 64 + 13, 40, 44);
        this.footFullFrames.push(sf);
      }
      this.footSp.spriteFrame = this.footFullFrames[0];
    });

    // 前景层（主角之上、暗角之下）：每帧重画
    this.fgG = this.child('foreground').addComponent(Graphics);

    // 电影暗角（压暗四周，聚焦中央；盖在角色之上、UI 之下，只画一次）
    const vg = this.child('vignette').addComponent(Graphics);
    const bands = 7, bw = 30;
    for (let i = 0; i < bands; i++) {
      const a = Math.round(11 * (bands - i));   // 越靠边越暗
      vg.fillColor = new Color(0, 0, 0, a);
      vg.rect(-W / 2, H / 2 - (i + 1) * bw, W, bw); vg.fill();          // 顶
      vg.rect(-W / 2, -H / 2 + i * bw, W, bw); vg.fill();              // 底
      vg.rect(-W / 2 + i * bw, -H / 2, bw, H); vg.fill();              // 左
      vg.rect(W / 2 - (i + 1) * bw, -H / 2, bw, H); vg.fill();          // 右
    }

    this.initMotes();

    // 伤害数字容器（在角色之上）
    this.dmgLayer = this.child('dmglayer');

    this.makeLabel('⚔ 闯 关 打 怪 ⚔', 0, H / 2 - 80, 38, new Color(255, 225, 150));
    this.zoneLbl = this.makeLabel('', 0, H / 2 - 130, 30, new Color(255, 235, 190));
    this.scoreLbl = this.makeLabel('', 0, H / 2 - 172, 28, new Color(255, 240, 200));
    this.coinLbl = this.makeLabel('', W / 2 - 90, H / 2 - 130, 30, new Color(250, 210, 90));
    this.comboLbl = this.makeLabel('', 0, H / 2 - 245, 34, new Color(255, 180, 90));
    this.comboLbl.node.active = false;
    this.hintLbl = this.makeLabel('移动 A·D　跳 W/↑　攻击(连按3下→跳劈)　剑气 K', 0, H / 2 - 210, 22, new Color(200, 200, 210));

    // 「前进 →」提示（清关后出现，update 里做缩放呼吸）
    this.arrow = this.makeLabel('前进 →', W / 2 - 130, 70, 42, new Color(255, 240, 150));
    this.arrow.active = false;

    this.banner = this.child('banner');
    this.banner.setPosition(0, 90, 0);
    this.bannerLbl = this.addLabelTo(this.banner, '', 54, new Color(255, 120, 110));
    this.banner.active = false;

    // 关卡开场大字（拍下来再淡出）
    this.zoneIntroLbl = this.makeLabel('', 0, 150, 64, new Color(255, 224, 130));
    this.zoneIntroOp = this.zoneIntroLbl.node.addComponent(UIOpacity);
    this.zoneIntroLbl.node.active = false;

    const by = -H / 2 + 120;
    this.makeHoldButton('◀', -270, by, new Color(70, 80, 110), h => (this.leftHeld = h));
    this.makeHoldButton('▶', -130, by, new Color(70, 80, 110), h => (this.rightHeld = h));
    this.makeTapButton('攻击', 250, by, 180, 92, new Color(150, 60, 55), () => this.heroSwing());
    this.makeTapButton('剑气', 80, by, 150, 84, new Color(55, 105, 140), () => this.heroSpecial());
    this.makeTapButton('跳', -130, by + 108, 120, 84, new Color(80, 110, 80), () => this.heroJump());

    this.makeTapButton('收兵', -300, H / 2 - 60, 130, 66, new Color(90, 70, 66), () => this.close());
    this.restartBtn = this.makeTapButton('再战', 0, 10, 190, 88, new Color(70, 110, 70), () => this.startGame());
    this.restartBtn.active = false;

    this.node.active = false;
  }

  // ---------- 开关 ----------
  open() {
    this.node.active = true;
    this.node.setSiblingIndex(9999);
    this.startGame();
    const op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity)!;
    op.opacity = 0;
    tween(op).to(0.25, { opacity: 255 }).start();
  }

  close() {
    const op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity)!;
    tween(op).to(0.2, { opacity: 0 }).call(() => { this.node.active = false; }).start();
  }

  private startGame() {
    AudioMgr.inst.playBgm('bgm-battle');
    this.scheduleOnce(() => this.showZoneIntro('第 1 关', new Color(255, 224, 130)), 0.1);
    this.camX = 0; this.zone = 0; this.zoneState = 'fight'; this.targetCam = 0;
    this.curBiome = -1; this.transActive = false; this.applyBiome(0);   // 复位背景组到第一组
    this.preloadAllBiomes();   // 预载各组，走路换景才有得滑
    this.waveRemaining = this.waveCount(0);
    this.hero = {
      x: -60, lane: 0, scale: 1.25, dir: 1,
      color: new Color(90, 210, 130), state: 'idle',
      phase: 0, swing: 0, deadT: 0, fallSign: 1,
      weapon: true, horns: false, hitT: 0, atkType: 0, jumpY: 0, jumpVy: 0, slamProg: 0, crouch: 0,
      hp: 100, hpMax: 100, invuln: 0, atkTimer: 99, attacking: false, hitApplied: false, kx: 0,
      combo: 0, specialCd: 0, landT: 0, preJump: 0, scaleBoost: 1,
      jumping: false, jmpPre: 0, jmpLand: 0,
    };
    this.monsters = []; this.sparks = []; this.bloods = []; this.waves = [];
    this.arrows = []; this.drops = []; this.flashes = [];
    this.hitStop = 0; this.shakeT = 0; this.shakeMag = 0; this.node.setPosition(0, 0, 0);
    for (const d of this.dmgNums) { d.n.active = false; this.dmgPoolFree.push(d.n); }
    this.dmgNums = [];
    this.coins = 0; this.comboCount = 0; this.comboT = 0;
    // 成长复位（攻击/移速回到基础值）
    this.heroLevel = 1; this.xp = 0; this.xpNext = 30; this.pendingLevels = 0;
    this.choosing = false; this.killHeal = 0; this.bossSpawned = false;
    this.attackDmg = this.baseAtk; this.heroSpeed = this.baseSpeed; this.specialCdCur = this.SPECIAL_CD;
    if (this.upgradePanel) this.upgradePanel.active = false;
    this.score = 0; this.spawnT = 0; this.over = false;
    this.leftHeld = this.rightHeld = false;
    this.banner.active = false; this.restartBtn.active = false; this.arrow.active = false;
  }

  private waveCount(zone: number): number { return this.ZONE_PLAN[Math.min(zone, this.ZONE_PLAN.length - 1)].count; }
  private theme(): Theme { return this.THEMES[this.zone % this.THEMES.length]; }
  private timeOfDay() { return this.zonePlan().night ? this.TIMES[3] : this.TIMES[this.zone % this.TIMES.length]; }   // 夜战关强制夜晚
  private sX(wx: number): number { return wx - this.camX; }   // 世界→屏幕

  // ---------- 键盘 ----------
  private onKeyDown(e: EventKeyboard) {
    if (!this.node.active) return;
    switch (e.keyCode) {
      case KeyCode.KEY_A: case KeyCode.ARROW_LEFT: this.leftHeld = true; break;
      case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT: this.rightHeld = true; break;
      case KeyCode.SPACE: case KeyCode.KEY_J: this.heroSwing(); break;
      case KeyCode.KEY_K: case KeyCode.KEY_L: this.heroSpecial(); break;
      case KeyCode.KEY_W: case KeyCode.ARROW_UP: this.heroJump(); break;
    }
  }
  private onKeyUp(e: EventKeyboard) {
    switch (e.keyCode) {
      case KeyCode.KEY_A: case KeyCode.ARROW_LEFT: this.leftHeld = false; break;
      case KeyCode.KEY_D: case KeyCode.ARROW_RIGHT: this.rightHeld = false; break;
    }
  }
  onDestroy() {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
  }

  private airborne(): boolean { return this.hero.jumpY > 0 || this.hero.jumpVy !== 0; }

  // 普通跳跃：先蹲蓄力 → 起身拉直腾空 → 下降 → 落地缓冲下蹲
  private heroJump() {
    AudioMgr.inst.play('jump', 0.7);
    if (this.over || this.zoneState === 'scroll' || this.choosing) return;
    const h = this.hero;
    if (h.jumping || h.attacking || h.preJump > 0 || h.landT > 0 || this.airborne()) return;
    h.jumping = true; h.jmpPre = this.JUMP_PRE; h.jmpLand = 0;
  }

  private heroSwing() {
    if (this.over || this.zoneState === 'scroll' || this.choosing) return;
    if (this.airborne() && !this.hero.jumping) return;   // 跳劈滞空中不可再出招
    const h = this.hero;
    if (h.atkTimer < this.SWING_DUR + this.HERO_ATK_COOLDOWN) return;   // 还在挥
    // 空中斩：普通跳跃中可平斩（不进连招、不触发跳劈）
    if (h.jumping) {
      h.combo = 0; h.atkType = 0;
      h.attacking = true; h.atkTimer = 0; h.hitApplied = false;
      AudioMgr.inst.play('swing', 0.9);
      return;
    }
    // 连招：窗口内再点 → 下一段，否则从头
    h.combo = h.atkTimer <= this.COMBO_WINDOW ? (h.combo + 1) % 3 : 0;
    h.atkType = h.combo;
    h.attacking = true; h.atkTimer = 0; h.hitApplied = false;
    AudioMgr.inst.play(h.atkType === 2 ? 'swing2' : 'swing', 0.9);
    if (h.atkType === 2) h.preJump = this.PREJUMP_DUR;   // 第 3 段：先蹲蓄力，蹲完再跃起下劈
  }

  // 招式参数：range 命中距离 / dmg 伤害 / knock 击退 / both 是否两侧 / blood 血量
  private moveParams(type: number) {
    switch (type) {
      case 1: return { range: this.attackRange * 0.95, dmg: this.attackDmg, knock: 110, both: false, blood: 12, launch: 820 };  // 上挑：挑飞
      case 2: return { range: this.attackRange * 1.5, dmg: this.attackDmg * 1.8, knock: 520, both: true, blood: 20, launch: 360 }; // 跳劈落地冲击
      default: return { range: this.attackRange, dmg: this.attackDmg, knock: 300, both: false, blood: 10, launch: 0 };          // 下劈
    }
  }

  private heroSpecial() {
    if (this.over || this.zoneState === 'scroll' || this.airborne() || this.hero.jumping || this.choosing) return;
    const h = this.hero;
    if (h.specialCd > 0) return;
    h.specialCd = this.specialCdCur;
    // 自动朝最近的活敌发射（没敌人时按当前面朝）
    let tdir = h.dir, best = 1e9;
    for (const m of this.monsters) {
      if (m.state === 'dead') continue;
      const d = Math.abs(m.x - h.x);
      if (d < best) { best = d; tdir = m.x >= h.x ? 1 : -1; }
    }
    h.dir = tdir;
    this.waves.push({
      x: h.x + tdir * 40, y: this.groundY + 90, dir: tdir,
      life: 0, max: 1.25, hit: new Set<Monster>(),
    });
    // 顺带摆个挥砍姿势
    if (!h.attacking) { h.attacking = true; h.atkTimer = 0; h.hitApplied = true; h.atkType = 0; }
  }

  // ---------- 主循环 ----------
  update(dt: number) {
    if (!this.node.active) return;
    dt = Math.min(dt, 0.05);
    if (this.slowMoT > 0) { this.slowMoT -= dt; dt *= 0.35; }   // 胜利慢动作
    this.animT += dt;

    // 关卡开场大字：0.22s 从 1.5 倍拍到 1 倍，尾段 0.35s 淡出
    if (this.zoneIntroT > 0) {
      this.zoneIntroT -= dt;
      const t = this.ZONE_INTRO_DUR - this.zoneIntroT;
      const aIn = Math.min(1, t / 0.2);
      const aOut = Math.min(1, Math.max(0, this.zoneIntroT) / 0.35);
      this.zoneIntroOp.opacity = Math.round(255 * Math.min(aIn, aOut));
      const sc = 1.5 - 0.5 * Math.min(1, t / 0.22);
      this.zoneIntroLbl.node.setScale(sc, sc, 1);
      if (this.zoneIntroT <= 0) this.zoneIntroLbl.node.active = false;
    }
    this.stepMotes(dt);

    // 屏幕震动（整块偏移，短促衰减）
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeMag * Math.max(0, this.shakeT / 0.18);
      this.node.setPosition((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2, 0);
      if (this.shakeT <= 0) { this.shakeMag = 0; this.node.setPosition(0, 0, 0); }
    }

    // 顿帧：命中瞬间全场定格几帧（打击感灵魂）
    if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); this.draw(); return; }

    if (!this.over) {
      this.stepZone(dt);
      if (this.zoneState !== 'scroll') {
        this.stepHero(dt);
        this.stepMonsters(dt);
        this.stepArrows(dt);
        this.stepDrops(dt);
      }
    } else {
      this.hero.deadT += dt;
      for (const m of this.monsters) if (m.state === 'dead') m.deadT += dt;
    }
    if (!this.over && this.zoneState !== 'scroll') this.stepWaves(dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.comboCount = 0; }
    this.cullMonsters();
    this.stepSparks(dt);
    this.stepBloods(dt);
    this.stepDusts(dt);
    this.stepBossGhosts(dt);
    this.stepFlashes(dt);
    this.stepDmgNums(dt);
    this.draw();

    const t = this.theme();
    this.zoneLbl.string = `第 ${this.zone + 1} 关 · ${t.name} · ${this.timeOfDay().name}`;
    this.scoreLbl.string = `得分 ${this.score}　❤ ${Math.max(0, Math.ceil(this.hero.hp))}`;
    this.coinLbl.string = `金 ${this.coins}`;
    this.comboLbl.node.active = false;   // 连击提示已关闭
    if (this.comboCount >= 2) {
      this.comboLbl.string = `连击 x${this.comboCount}`;
      this.comboLbl.node.setPosition(this.sX(this.comboX), this.comboY + 100, 0);   // 显示在被打的敌人上方
    }
    this.arrow.active = false;   // 「前进 →」提示已关闭
    if (this.arrow.active) {
      this.arrowT += dt;
      const s = 1 + 0.14 * Math.abs(Math.sin(this.arrowT * 3));
      this.arrow.setScale(s, s, 1);
    }
  }

  // 关卡节奏：刷怪 / 清关判定 / 卷屏换场
  private stepZone(dt: number) {
    if (this.zoneState === 'scroll') {
      this.camX = Math.min(this.targetCam, this.camX + this.SCROLL_SPEED * dt);   // 匀速卷屏
      const h = this.hero;
      h.x = this.camX + 130; h.dir = 1; h.state = 'walk'; h.phase += dt * 15;
      this.transP = Math.min(1, Math.max(0, 1 - (this.targetCam - this.camX) / this.ZONE_SPAN));   // 走路换景进度
      if (this.targetCam - this.camX < 4) {
        this.camX = this.targetCam;
        this.zone++;
        this.zoneState = 'fight';
        this.waveRemaining = this.waveCount(this.zone);
        this.spawnT = 0;
        this.bossSpawned = false;
        this.applyBiome(this.zone);   // 落定新关背景组
        this.transActive = false;
        this.preloadAllBiomes();      // 确保后续关卡背景已就绪
      }
      return;
    }
    if (this.zoneState === 'fight') {
      if (this.isBossZone()) {
        // Boss 关 = 终极 Boss：打死即通关胜利，游戏结束
        if (!this.bossSpawned) { this.spawnBoss(); this.bossSpawned = true; }
        else if (this.aliveCount() === 0) this.gameWin();
        return;
      }
      this.spawnT += dt;
      const alive = this.aliveCount();
      const interval = this.zonePlan().interval ?? Math.max(0.5, 1.1 - this.zone * 0.05);
      if (this.waveRemaining > 0 && this.spawnT >= interval && alive < this.maxMonsters) {
        this.spawnT = 0;
        this.spawnMonster();
        this.waveRemaining--;
      }
      if (this.waveRemaining === 0 && alive === 0) { this.zoneState = 'cleared'; AudioMgr.inst.play('clear'); }
    }
    // cleared：推进判定在 stepHero 里
  }

  private readonly BOSS_ZONE = 9;   // 终极 Boss 在第 10 关（前 9 关小怪，之后见 Boss）
  private isBossZone(): boolean { return this.zone >= this.BOSS_ZONE; }

  private spawnBoss(): void {
    this.showZoneIntro('虎痴 · 许褚', new Color(255, 96, 84));
    AudioMgr.inst.play('roar');
    this.addShake(16); this.addHitStop(0.1);
    const W = DESIGN_W;
    const hp = 320 + this.zone * 70;
    this.monsters.push({
      x: this.camX + W / 2 - 70, lane: 0, scale: 2.9, dir: -1,
      color: new Color(150, 40, 62), state: 'walk',
      phase: 0, swing: 0, deadT: 0, fallSign: 1,
      weapon: false, horns: true, hitT: 0, atkType: 0, jumpY: 0, jumpVy: 0, slamProg: 0, crouch: 0, scaleBoost: 1,
      hp, hpMax: hp, atkCd: 1.2, vx: 0, attacking: false, struck: false,
      kind: 'boss', atk: 18 + this.zone * 2, speed: 58, ranged: false, coin: 20,
      slamState: 'none', slamT: 0, slamCd: this.BOSS_SLAM_CD * 0.6, slamX: 0,
    });
  }

  private aliveCount(): number {
    let n = 0; for (const m of this.monsters) if (m.state !== 'dead') n++; return n;
  }

  private pickKind(): string {
    const plan = this.zonePlan();
    // 开场必刷（如第8/9关的双精英）：按本关已刷个数取 openers
    const spawned = this.waveCount(this.zone) - this.waveRemaining;
    if (plan.openers && spawned < plan.openers.length) return plan.openers[spawned];
    const pool: string[] = [];
    for (const [k, w] of plan.pool) for (let i = 0; i < w; i++) pool.push(k);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private spawnMonster() {
    const W = DESIGN_W;
    const kind = this.pickKind();
    const d = this.KINDS[kind];
    const fromLeft = Math.random() < (this.zonePlan().bothSides ? 0.5 : 0.35);   // 夹击关左右对半，平时多数从右来
    const scale = (0.9 + Math.random() * 0.25) * d.scaleMul * 1.2;
    // 步兵/弓手一刀秒；盾兵约 3 刀（耐打有"破盾"感）；精英最肉，随关卡涨
    const hpMax = kind === 'elite' ? (220 + this.zone * 30)
      : kind === 'shield' ? (95 + this.zone * 10)
      : 34;
    this.monsters.push({
      x: this.camX + (fromLeft ? -W / 2 - 30 : W / 2 + 30),
      lane: (Math.random() - 0.5) * 12,   // 几乎同一条线（只留极小错位防重叠）
      scale, dir: fromLeft ? 1 : -1,
      color: new Color(d.color[0], d.color[1], d.color[2]), state: 'walk',
      phase: Math.random() * 6.28, swing: 0, deadT: 0, fallSign: 1,
      weapon: false, horns: true, hitT: 0, atkType: 0, jumpY: 0, jumpVy: 0, slamProg: 0, crouch: 0, scaleBoost: 1,
      hp: hpMax, hpMax, atkCd: Math.random() * 0.6, vx: 0, attacking: false, struck: false,
      kind, atk: d.dmg + this.zone, speed: d.speed, ranged: d.ranged, coin: d.coin,
    });
  }

  private stepHero(dt: number) {
    const W = DESIGN_W;
    const h = this.hero;
    if (h.invuln > 0) h.invuln -= dt;
    if (h.hitT > 0) h.hitT -= dt;
    if (h.specialCd > 0) h.specialCd -= dt;
    if (Math.abs(h.kx) > 1) { h.x += h.kx * dt; h.kx *= 0.84; }

    const mv = (this.rightHeld ? 1 : 0) + (this.leftHeld ? -1 : 0);
    if (mv !== 0) {
      h.dir = mv;
      h.x += mv * this.heroSpeed * dt;
      h.phase += dt * 15;
      // 跑动扬尘：贴地时脚后跟出小尘
      this.walkDustT -= dt;
      if (h.jumpY <= 0 && this.walkDustT <= 0) {
        this.walkDustT = 0.16;
        this.spawnDust(h.x - h.dir * 12, this.groundY + 4, 1, 50);
      }
      // 脚步声：贴地行走按步频响
      this.stepSndT -= dt;
      if (h.jumpY <= 0 && !h.jumping && this.stepSndT <= 0) {
        this.stepSndT = 0.3;
        AudioMgr.inst.play('step', 0.35);
      }
    }

    // 关卡边界
    const leftWall = this.camX - W / 2 + 60;
    const rightWall = this.zoneState === 'fight' ? this.camX + W / 2 - 90 : this.camX + W / 2 + 40;
    h.x = Math.max(leftWall, Math.min(rightWall, h.x));

    // 清关后：镜头双向跟随主角（可前进也可后退），走到关底右侧进入下一关
    if (this.zoneState === 'cleared') {
      const bound = (this.zone + 1) * this.ZONE_SPAN;   // 右界=下一关关口
      const margin = 140;                                // 跟随窗口：超出就推镜头
      if (h.x > this.camX + margin) this.camX = h.x - margin;
      else if (h.x < this.camX - margin) this.camX = h.x + margin;
      this.camX = Math.max(0, Math.min(bound, this.camX));   // 左不出世界起点，右不越关口
      // 回走/前进时按镜头所在区域切背景组（applyBiome 同组时零开销）
      this.applyBiome(Math.max(0, Math.min(this.zone, Math.round(this.camX / this.ZONE_SPAN))));
      // 镜头顶到关口后继续向右走 → 直接开下一关
      if (this.camX >= bound - 0.5 && h.x > this.camX + 130) {
        this.camX = bound;
        this.zone++;
        this.zoneState = 'fight';
        this.waveRemaining = this.waveCount(this.zone);
        this.spawnT = 0;
        this.bossSpawned = false;
        this.applyBiome(this.zone);
        this.preloadAllBiomes();
        if (!this.isBossZone()) this.showZoneIntro(`第 ${this.zone + 1} 关`, new Color(255, 224, 130));   // Boss 关由登场演出接管
      }
    }

    if (h.landT > 0) h.landT -= dt;

    // 跳劈起跳前的蓄力下蹲：蹲完瞬间给起跳速度
    if (h.preJump > 0) {
      h.preJump -= dt;
      if (h.preJump <= 0) { h.preJump = 0; h.jumpVy = this.JUMP_VY; }
    }

    // 普通跳跃：蓄力下蹲 → 腾空(拉直→下降) → 落地缓冲下蹲
    if (h.jumping) {
      if (h.jmpPre > 0) {                          // 起跳前下蹲蓄力
        h.jmpPre -= dt;
        if (h.jmpPre <= 0) { h.jmpPre = 0; h.jumpVy = this.JUMP_MOVE_VY; h.jumpY = 0.01; }
      } else if (h.jmpLand > 0) {                  // 落地缓冲
        h.jmpLand -= dt;
        if (h.jmpLand <= 0) { h.jmpLand = 0; h.jumping = false; }
      } else {                                     // 腾空物理
        h.jumpY += h.jumpVy * dt;
        h.jumpVy -= this.GRAVITY_MOVE * dt;
        if (h.jumpY <= 0) {
          h.jumpY = 0; h.jumpVy = 0; h.jmpLand = this.JUMP_LAND;
          AudioMgr.inst.play('land', 0.6);
          this.spawnDust(h.x, this.groundY + 4, 6, 190);   // 落地尘圈
          this.sparks.push({ x: h.x, y: this.groundY + 8, life: 0, max: 0.16 });   // 落地小尘星
        }
      }
    }

    // 跳劈物理（第 3 段）—— 普通跳跃时不走这条，避免重复处理
    if (!h.jumping && (h.jumpY > 0 || h.jumpVy !== 0)) {
      h.jumpY += h.jumpVy * dt;
      h.jumpVy -= this.GRAVITY_J * dt;
      if (h.jumpY <= 0) {                 // 落地
        h.jumpY = 0; h.jumpVy = 0;
        if (h.attacking && h.atkType === 2) {
          if (!h.hitApplied) { h.hitApplied = true; this.slamHit(); }
          h.attacking = false;
          h.landT = this.LAND_DUR;        // 落地深蹲→起身
        }
      }
    }

    // 攻击行程
    h.atkTimer += dt;
    if (h.attacking) {
      const dur = h.atkType === 2 ? 0.7 : this.SWING_DUR;
      h.swing = Math.min(1, h.atkTimer / dur);
      // 跳劈的伤害在落地时结算，其余招式挥到一半结算
      if (h.atkType !== 2 && !h.hitApplied && h.swing >= 0.5) {
        h.hitApplied = true;
        const mp = this.moveParams(h.atkType);
        for (const m of this.monsters) {
          if (m.state === 'dead') continue;
          const dx = m.x - h.x;
          const inFront = mp.both || dx * h.dir > -30;
          if (Math.abs(dx) <= mp.range + 34 * m.scale && inFront) {   // 含敌人体型/武器 → 碰到就算
            const kdir = mp.both ? (dx >= 0 ? 1 : -1) : h.dir;
            this.hitMonster(m, mp.dmg, kdir, mp.knock, mp.launch, mp.blood, (h.x + m.x) / 2, this.groundY + 80 * m.scale);
          }
        }
      }
      if (h.atkType !== 2 && h.swing >= 1) h.attacking = false;
      h.state = 'attack';
    } else {
      h.state = mv !== 0 ? 'walk' : 'idle';
    }
    if (h.jumping && !h.attacking) h.state = 'idle';   // 跳跃站姿；空中出招时保留攻击态

    // 跳劈姿态：起跳前下蹲蓄力 → 升起举刀 → 下落劈砍 → 落地保持劈下（用 slamProg 驱动，动作看得清）
    if (h.atkType === 2 && (h.attacking || h.landT > 0)) {
      if (h.preJump > 0) h.slamProg = 0.05;                                      // 蓄力下蹲：刀还未举起
      else if (h.jumpVy > 20) h.slamProg = 0.15;                                 // 上升：举刀蓄力
      else if (h.jumpY > 1) h.slamProg = 0.15 + 0.7 * Math.min(1, -h.jumpVy / this.JUMP_VY); // 下落：劈下
      else h.slamProg = 0.95;                                                    // 落地：保持劈下
      if (h.landT > 0 && !h.attacking) h.state = 'attack';                       // 落地后短暂保留劈姿
    } else {
      h.slamProg = 0;
    }

    // 蹲姿（集中计算，drawStick 直接用 h.crouch）
    let cr = 0;
    if (h.state === 'attack') {
      if (h.atkType === 2) {
        if (h.preJump > 0) cr = 0.9 * (1 - h.preJump / this.PREJUMP_DUR);  // 起跳前：屈膝下蹲蓄力（越接近起跳蹲得越深）
        else if (h.landT > 0) cr = 1.0 * (h.landT / this.LAND_DUR);      // 落地：深蹲 → 平滑起身
        else if (h.jumpY > 1 && h.jumpVy < 0) cr = 0.25 * h.slamProg;    // 下落：微屈膝
      } else if (h.atkType === 1) {
        cr = h.swing < 0.5 ? (0.5 - h.swing) / 0.5 * 0.55 : -(h.swing - 0.5) / 0.5 * 0.3; // 上挑：先蹲后踮
      } else {
        cr = h.swing > 0.4 ? (h.swing - 0.4) / 0.6 * 0.6 : 0;            // 下劈：劈下沉身
      }
    }
    h.crouch = Math.max(-0.3, Math.min(1.0, cr));

    // 普通跳跃姿态：蓄力深蹲 → 起身拉直(踮脚) → 下降回中 → 落地缓冲下蹲
    if (h.jumping) {
      let jc: number;
      if (h.jmpPre > 0) jc = 0.85 * (1 - h.jmpPre / this.JUMP_PRE);        // 蓄力：越接近起跳蹲得越深
      else if (h.jmpLand > 0) jc = 0.9 * (h.jmpLand / this.JUMP_LAND);     // 落地缓冲：深蹲 → 起身
      else if (h.jumpVy > 0) jc = -0.3 * (h.jumpVy / this.JUMP_MOVE_VY);   // 上升：身体拉直、踮脚
      else jc = 0;                                                         // 下降：自然站姿
      h.crouch = Math.max(-0.3, Math.min(1.0, jc));
    }

    // 跳劈：随跳跃高度整体放大，最高点约 1.5 倍，落地后恢复
    const maxJumpH = this.JUMP_VY * this.JUMP_VY / (2 * this.GRAVITY_J);
    h.scaleBoost = (h.atkType === 2 && h.jumpY > 0)
      ? 1 + 0.5 * Math.min(1, h.jumpY / maxJumpH)
      : 1;
  }

  // 跳劈落地冲击：以主角为中心两侧 AoE + 冲击波火花
  private slamHit() {
    const h = this.hero;
    const mp = this.moveParams(2);
    for (let k = 0; k < 9; k++) this.sparks.push({ x: h.x + (k - 4) * 22, y: this.groundY + 6, life: 0, max: 0.28 });
    this.addShake(18); this.addHitStop(0.06);   // 跳劈落地：大震 + 顿帧
    this.spawnDust(this.hero.x, this.groundY + 4, 10, 300);   // 跳劈落地大尘圈
    for (const m of this.monsters) {
      if (m.state === 'dead') continue;
      const dx = m.x - h.x;
      if (Math.abs(dx) <= mp.range + 34 * m.scale) {
        const kdir = dx >= 0 ? 1 : -1;
        this.hitMonster(m, mp.dmg, kdir, mp.knock, mp.launch, mp.blood, m.x, this.groundY + 80 * m.scale);
      }
    }
  }

  // 尘土粒子：跑动脚下扬尘 / 落地尘圈
  private spawnDust(x: number, y: number, n: number, spread: number) {
    for (let i = 0; i < n; i++) {
      this.dusts.push({
        x: x + (Math.random() - 0.5) * 14, y: y + Math.random() * 6,
        vx: (Math.random() - 0.5) * spread, vy: 26 + Math.random() * 34,
        r: 4 + Math.random() * 5, life: 0, max: 0.4 + Math.random() * 0.25,
      });
    }
  }

  private stepDusts(dt: number) {
    for (let i = this.dusts.length - 1; i >= 0; i--) {
      const d = this.dusts[i];
      d.life += dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vy *= 0.92; d.vx *= 0.95;
      if (d.life >= d.max) this.dusts.splice(i, 1);
    }
  }

  // Boss 冲刺残影：冲刺中每隔一小段留一个当前帧的淡影
  private stepBossGhosts(dt: number) {
    for (const g of this.bossGhosts) {
      if (!g.node.active) continue;
      g.op.opacity = Math.max(0, g.op.opacity - 620 * dt);
      if (g.op.opacity <= 4) g.node.active = false;
    }
    const b = this.monsters.find(m => m.kind === 'boss');
    if (!b || (b.dashT || 0) <= 0 || !this.bossNode.active) return;
    this.ghostT -= dt;
    if (this.ghostT > 0) return;
    this.ghostT = 0.05;
    const g = this.bossGhosts[this.ghostIdx++ % this.bossGhosts.length];
    if (!g) return;
    g.sp.spriteFrame = this.bossSp.spriteFrame;
    g.node.setPosition(this.bossNode.getPosition());
    g.node.setScale(this.bossNode.getScale());
    g.node.active = true;
    g.op.opacity = 150;
  }

  // 关卡/Boss 开场大字：放大拍下 → 停留 → 淡出
  private showZoneIntro(text: string, color: Color) {
    this.zoneIntroLbl.string = text;
    this.zoneIntroLbl.color = color;
    this.zoneIntroLbl.node.active = true;
    this.zoneIntroT = this.ZONE_INTRO_DUR;
  }

  private addShake(mag: number) { this.shakeT = 0.18; this.shakeMag = Math.max(this.shakeMag, mag); }
  private addHitStop(t: number) { this.hitStop = Math.max(this.hitStop, t); }
  private spawnHitFlash(x: number, y: number) { this.flashes.push({ x, y, life: 0, max: 0.16 }); }

  private stepFlashes(dt: number) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life += dt;
      if (this.flashes[i].life >= this.flashes[i].max) this.flashes.splice(i, 1);
    }
  }

  private drawFlashes(g: Graphics) {
    for (const f of this.flashes) {
      const p = f.life / f.max, a = 1 - p;
      const sx = this.sX(f.x), sy = f.y;
      // 白色迸裂星
      g.strokeColor = new Color(255, 255, 255, Math.round(255 * a));
      g.lineWidth = 5 * (1 - p * 0.5);
      const r = 20 + p * 46;
      for (let k = 0; k < 6; k++) {
        const ang = k * Math.PI / 3;
        g.moveTo(sx + Math.cos(ang) * r * 0.35, sy + Math.sin(ang) * r * 0.35);
        g.lineTo(sx + Math.cos(ang) * r, sy + Math.sin(ang) * r);
      }
      g.stroke();
      // 中心亮核
      g.fillColor = new Color(255, 255, 255, Math.round(230 * a));
      g.circle(sx, sy, 9 * (1 - p)); g.fill();
    }
  }

  // 统一命中怪：扣血 + 击退/挑飞 + 火花/血 + 伤害数字 + 连击 + 死亡掉落
  private hitMonster(m: Monster, dmg: number, kdir: number, knock: number, launch: number, bloodN: number, bx: number, by: number) {
    if (m.state === 'dead') return;
    // 许褚体型大：命中特效(血/白光/数字)按精灵实际身体中部，别按 80*scale 飞到天上
    if (m.kind === 'boss') by = this.groundY + m.lane + 96;
    m.hp -= dmg;
    m.vx = kdir * knock;
    if (launch) m.jumpVy = launch;
    m.hitT = this.HIT_DUR;
    this.sparks.push({ x: bx, y: by, life: 0, max: 0.2 });
    this.spawnHitFlash(bx, by);        // 冲击白光
    this.addDmgNum(bx, by + 40, Math.round(dmg), false);
    this.addCombo();
    this.comboX = bx; this.comboY = by;   // 连击提示跟到命中点
    const killed = m.hp <= 0;
    this.addHitStop(killed ? 0.085 : 0.045);   // 顿帧：击杀更久
    this.addShake(killed ? 13 : 6);            // 震屏：击杀更猛
    if (killed) AudioMgr.inst.play('kill', 0.5); else AudioMgr.inst.play('hit');
    this.spawnBlood(bx, by, kdir, killed ? bloodN + 12 : bloodN);
    if (killed) {
      m.state = 'dead'; m.deadT = 0; m.fallSign = kdir;
      m.jumpVy = Math.max(m.jumpVy, 230 + Math.random() * 150);   // 尸体弹飞
      this.score += 1 + Math.floor(this.comboCount / 5);
      this.spawnDrop(m);
    }
  }

  private gainXP(amt: number) {
    this.xp += amt;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.heroLevel++;
      this.xpNext = Math.round(this.xpNext * 1.35);
      this.pendingLevels++;
    }
    if (this.pendingLevels > 0 && !this.choosing) this.openUpgrade();
  }

  // 打开三选一升级面板（暂停战斗）
  private openUpgrade() {
    this.choosing = true;
    AudioMgr.inst.play('levelup');
    const idx = [...Array(this.UPGRADES.length).keys()];
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let c = 0; c < 3; c++) {
      const up = this.UPGRADES[idx[c]];
      this.cardTitle[c].string = up.name;
      this.cardDesc[c].string = up.desc;
      this.cardApply[c] = up.apply;
    }
    this.upgradePanel.active = true;
    this.upgradePanel.setSiblingIndex(9999);
  }

  private chooseCard(c: number) {
    if (!this.choosing) return;
    this.cardApply[c]();
    this.pendingLevels--;
    if (this.pendingLevels > 0) this.openUpgrade();   // 连升多级继续选
    else { this.choosing = false; this.upgradePanel.active = false; }
  }

  // 主角受伤（近战/箭矢共用）
  private hurtHero(dmg: number, fromX: number) {
    const h = this.hero;
    if (h.invuln > 0 || this.airborne() || this.over) return;   // 无敌帧 + 空中免伤
    h.hp -= dmg;
    h.invuln = 0.7;
    AudioMgr.inst.play('hurt');
    h.hitT = this.HIT_DUR;
    const away = h.x >= fromX ? 1 : -1;
    h.kx = away * 360;
    const by = this.groundY + 90;
    this.sparks.push({ x: h.x, y: by, life: 0, max: 0.22 });
    this.spawnHitFlash(h.x, by);
    this.spawnBlood(h.x, by, away, 14);
    this.addDmgNum(h.x, by + 50, Math.round(dmg), true);   // 红字
    this.addHitStop(0.06); this.addShake(10);              // 挨打也顿帧+震屏
    this.comboCount = 0;                                    // 挨打断连击
    if (h.hp <= 0) { this.spawnBlood(h.x, by, away, 26); this.gameOver(); }
  }

  private shootArrow(m: Monster) {
    const h = this.hero;
    const sy = this.groundY + m.lane + 70 * m.scale;
    const dxv = h.x - m.x, dyv = (this.groundY + 80) - sy, L = Math.hypot(dxv, dyv) || 1;
    const sp = 300;   // 箭速（放慢，更好躲）
    this.arrows.push({ x: m.x, y: sy, vx: dxv / L * sp, vy: dyv / L * sp, life: 0 });
    AudioMgr.inst.play('arrow', 0.7);
  }

  private stepArrows(dt: number) {
    const h = this.hero;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life += dt; a.x += a.vx * dt; a.y += a.vy * dt;
      const hy = this.groundY + 80 + h.jumpY;
      if (Math.abs(a.x - h.x) < 30 && Math.abs(a.y - hy) < 60) {
        this.hurtHero(6 + Math.floor(this.zone * 0.5), a.x);
        this.arrows.splice(i, 1); continue;
      }
      if (a.life > 3.5 || a.y < this.groundY - 60) this.arrows.splice(i, 1);
    }
  }

  private addCombo() { this.comboCount++; this.comboT = 2.0; }

  private spawnDrop(m: Monster) {
    const n = Math.round(m.coin * (this.zonePlan().lootMul ?? 1));   // 喘息关掉落翻倍
    for (let i = 0; i < n; i++)
      this.drops.push({ x: m.x + (Math.random() - 0.5) * 40, y: this.groundY + 45, vy: 140 + Math.random() * 110, life: 0, flying: false, sx: 0, sy: 0 });
  }

  private stepDrops(dt: number) {
    const h = this.hero;
    const px = DESIGN_W / 2 - 90, py = DESIGN_H / 2 - 130;   // 口袋（金币计数处）
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life += dt;
      if (d.flying) {
        // 飞入口袋：向目标加速插值
        const k = Math.min(1, dt * 11);
        d.sx += (px - d.sx) * k; d.sy += (py - d.sy) * k;
        if (Math.hypot(px - d.sx, py - d.sy) < 26) { this.coins++; AudioMgr.inst.play('coin', 0.5); this.drops.splice(i, 1); continue; }
      } else {
        d.vy -= 640 * dt; d.y += d.vy * dt;
        if (d.y < this.groundY) { d.y = this.groundY; d.vy = 0; }
        if (Math.abs(d.x - h.x) < 100 && Math.abs(d.y - (this.groundY + 20)) < 130) {   // 靠近 → 起飞
          d.flying = true; d.sx = this.sX(d.x); d.sy = d.y + 14;
        }
        if (d.life > 10) this.drops.splice(i, 1);
      }
    }
  }

  private addDmgNum(x: number, y: number, val: number, hurt: boolean) {
    let node = this.dmgPoolFree.pop();
    if (!node) {
      node = new Node('dmg'); node.layer = this.node.layer; node.parent = this.dmgLayer;
      node.addComponent(UITransform);
      const lb = node.addComponent(Label); lb.lineHeight = 34;
      const ol = node.addComponent(LabelOutline); ol.color = new Color(20, 12, 10, 255); ol.width = 4;
    }
    node.active = true;
    const lbl = node.getComponent(Label)!;
    lbl.string = '' + val;
    lbl.fontSize = hurt ? 34 : 30;
    lbl.color = hurt ? new Color(255, 90, 80, 255) : new Color(255, 240, 170, 255);
    this.dmgNums.push({ n: node, life: 0, max: 0.8, x, y });
  }

  private stepDmgNums(dt: number) {
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      d.life += dt; d.y += 66 * dt;
      d.n.setPosition(this.sX(d.x), d.y, 0);
      const lbl = d.n.getComponent(Label)!, col = lbl.color;
      lbl.color = new Color(col.r, col.g, col.b, Math.round(255 * Math.max(0, 1 - d.life / d.max)));
      if (d.life >= d.max) { d.n.active = false; this.dmgPoolFree.push(d.n); this.dmgNums.splice(i, 1); }
    }
  }

  private drawArrows(g: Graphics) {
    g.strokeColor = new Color(70, 58, 46, 255); g.lineWidth = 3;
    for (const a of this.arrows) {
      const sx = this.sX(a.x), L = Math.hypot(a.vx, a.vy) || 1;
      g.moveTo(sx - a.vx / L * 30, a.y - a.vy / L * 30); g.lineTo(sx, a.y);
    }
    g.stroke();
    g.fillColor = new Color(190, 60, 50, 255);
    for (const a of this.arrows) { g.circle(this.sX(a.x), a.y, 3); g.fill(); }
  }

  private drawDrops(g: Graphics) {
    for (const d of this.drops) {
      let sx: number, sy: number, r = 13;
      if (d.flying) { sx = d.sx; sy = d.sy; r = 11; }
      else { sx = this.sX(d.x); sy = d.y + Math.sin(d.life * 7) * 3 + 15; }
      g.fillColor = new Color(90, 62, 16, 255); g.circle(sx, sy, r + 2); g.fill();        // 暗边
      g.fillColor = new Color(255, 200, 55, 255); g.circle(sx, sy, r); g.fill();          // 金
      g.strokeColor = new Color(160, 108, 20, 255); g.lineWidth = 2;                       // ¥ 竖纹
      g.moveTo(sx, sy - r * 0.5); g.lineTo(sx, sy + r * 0.5); g.stroke();
      g.fillColor = new Color(255, 240, 160, 255); g.circle(sx - r * 0.32, sy - r * 0.32, r * 0.34); g.fill(); // 高光
    }
  }

  private stepMonsters(dt: number) {
    const h = this.hero;
    for (const m of this.monsters) {
      if (m.state === 'dead') {
        m.deadT += dt;
        // 尸体惯性：击退滑行 + 抛物线落地
        if (Math.abs(m.vx) > 1) { m.x += m.vx * dt; m.vx *= 0.9; }
        if (m.jumpY > 0 || m.jumpVy !== 0) {
          m.jumpY += m.jumpVy * dt;
          m.jumpVy -= 2600 * dt;
          if (m.jumpY <= 0) { m.jumpY = 0; m.jumpVy = 0; this.spawnDust(m.x, this.groundY + 4, 3, 120); }
        }
        continue;
      }
      if (m.hitT > 0) m.hitT -= dt;
      if (Math.abs(m.vx) > 1) { m.x += m.vx * dt; m.vx *= 0.82; }

      // 被挑飞：垂直物理，滞空期间不能行动
      if (m.jumpY > 0 || m.jumpVy !== 0) {
        m.jumpY += m.jumpVy * dt;
        m.jumpVy -= 2600 * dt;
        if (m.jumpY <= 0) { m.jumpY = 0; m.jumpVy = 0; }
      }
      if (m.jumpY > 3) { m.state = 'walk'; continue; }   // 空中随惯性飘，不攻击

      if (m.kind === 'boss') { this.stepBoss(m, dt); continue; }

      const dx = h.x - m.x, adx = Math.abs(dx);
      m.dir = dx >= 0 ? 1 : -1;
      m.atkCd -= dt;

      if (m.ranged) {
        // 弓手：保持中距、射箭；太近后退，太远靠近
        const near = 200, far = 350;
        if (adx < near) { m.state = 'walk'; m.phase += dt * 8; m.x -= m.dir * m.speed * dt; }
        else if (adx > far) { m.state = 'walk'; m.phase += dt * 8; m.x += m.dir * m.speed * dt; }
        else {
          m.state = 'attack'; m.swing = Math.min(1, m.swing + dt * 2.5);
          if (m.atkCd <= 0) { m.atkCd = 2.8; m.swing = 0; this.shootArrow(m); }   // 射箭间隔（越大越慢）
        }
      } else if (adx <= (m.kind === 'boss' ? 120 : 56)) {
        m.state = 'attack';
        if (!m.attacking && m.atkCd <= 0) { m.attacking = true; m.struck = false; m.swing = 0; m.atkCd = m.kind === 'boss' ? 1.4 : 1.0; }
        if (m.attacking) {
          m.swing = Math.min(1, m.swing + dt * 3.5);
          if (!m.struck && m.swing >= 0.55) {
            m.struck = true;
            if (adx <= (m.kind === 'boss' ? 130 : 62)) this.hurtHero(m.atk, m.x);
          }
          if (m.swing >= 1) m.attacking = false;
        }
      } else {
        m.state = 'walk';
        m.phase += dt * 8;
        m.x += m.dir * m.speed * dt;
        m.swing = 0;
        m.attacking = false;
      }
    }
  }

  // Boss AI：普通劈砍 + 周期性「预警重击」（蓄力→地面红圈→砸下，翻滚可躲）
  private stepBoss(m: Monster, dt: number) {
    const h = this.hero;
    const dx = h.x - m.x, adx = Math.abs(dx);

    // 横冲进行中：锁定方向猛冲，撞到即伤（跳跃可躲）——放在 dir 更新前，冲刺不拐弯
    if ((m.dashT || 0) > 0) {
      m.dashT! -= dt;
      m.state = 'walk'; m.phase += dt * 22;
      m.x += m.dir * 620 * dt;
      if (Math.abs(h.x - m.x) < 70 && h.invuln <= 0 && !this.airborne() && h.state !== 'dead') {
        this.hurtHero(Math.round(m.atk * 1.1), m.x);
        h.kx = m.dir * 620;
      }
      if (m.dashT! <= 0) m.atkCd = 0.6;   // 冲完短硬直
      return;
    }

    m.dir = dx >= 0 ? 1 : -1;

    // 二阶段：血≤50% 狂暴（一次性）——提速加攻、重击更频、召唤增援
    if (!m.raged && m.hp <= m.hpMax * 0.5) {
      m.raged = true;
      m.speed *= 1.45; m.atk = Math.round(m.atk * 1.2);
      m.slamCd = Math.min(m.slamCd || 0, 0.8);   // 立刻酝酿一次重击
      m.dashCd = 1.6;
      this.addShake(14); this.addHitStop(0.08);
      AudioMgr.inst.play('roar');
      this.spawnHitFlash(this.sX(m.x), this.groundY + 80);
      for (let i = 0; i < 2; i++) this.spawnMonster();   // 增援两个小兵
    }
    const st = m.slamState || 'none';

    // 蓄力中：站定举刀，红圈亮起；时间到 → 砸下结算
    if (st === 'windup') {
      m.state = 'attack'; m.attacking = false; m.swing = 0;
      m.slamT = (m.slamT || 0) - dt;
      if ((m.slamT || 0) <= 0) {
        m.slamState = 'strike'; m.slamT = 0.45;
        const tx = m.slamX || m.x;
        this.addShake(20); this.addHitStop(0.05);
        AudioMgr.inst.play('slam');
        this.spawnHitFlash(this.sX(tx), this.groundY + 26);
        this.spawnHitFlash(this.sX(tx) - 40, this.groundY + 20);
        this.spawnHitFlash(this.sX(tx) + 40, this.groundY + 20);
        for (let k = 0; k < 16; k++) this.sparks.push({ x: tx + (k - 8) * 20, y: this.groundY + 6, life: 0, max: 0.4 });
        // 命中判定：主角在红圈(落点 tx)内且没翻滚/无敌/腾空 → 重伤 + 击飞
        if (Math.abs(h.x - tx) < this.BOSS_SLAM_R && h.invuln <= 0 && !this.airborne() && h.state !== 'dead') {
          this.hurtHero(this.BOSS_SLAM_DMG, tx);
          h.kx = (h.x >= tx ? 1 : -1) * 560;
        }
      }
      return;
    }
    // 砸下后短暂收招
    if (st === 'strike') {
      m.state = 'attack';
      m.slamT = (m.slamT || 0) - dt;
      if ((m.slamT || 0) <= 0) { m.slamState = 'none'; m.slamCd = this.BOSS_SLAM_CD * (m.raged ? 0.5 : 1); }   // 狂暴重击更频
      return;
    }

    // 常态：充能重击 + 近身劈砍 / 追人
    m.slamCd = (m.slamCd || 0) - dt;
    m.atkCd -= dt;
    // 二阶段横冲：拉开距离时发动（先于重击判定）
    if (m.raged) {
      m.dashCd = (m.dashCd ?? 2) - dt;
      if ((m.dashCd || 0) <= 0 && adx > 220) {
        m.dashT = 0.55; m.dashCd = 3.2;
        this.addShake(6);
        return;
      }
    }
    if ((m.slamCd || 0) <= 0 && adx < 360) {   // 起手预警（锁定落点 = 当前主角位置）
      m.slamState = 'windup'; m.slamT = this.BOSS_SLAM_WINDUP; m.slamX = h.x;
      m.attacking = false; m.swing = 0; m.state = 'attack';
      return;
    }
    if (adx <= 120) {
      m.state = 'attack';
      if (!m.attacking && m.atkCd <= 0) { m.attacking = true; m.struck = false; m.swing = 0; m.atkCd = 1.4; }
      if (m.attacking) {
        m.swing = Math.min(1, m.swing + dt * 3.5);
        if (!m.struck && m.swing >= 0.55) { m.struck = true; if (adx <= 130) this.hurtHero(m.atk, m.x); }
        if (m.swing >= 1) m.attacking = false;
      }
    } else {
      m.state = 'walk'; m.phase += dt * 8; m.x += m.dir * m.speed * dt; m.swing = 0; m.attacking = false;
    }
  }

  // Boss 重击预警：地面危险区（分层暗红底 + 立体亮边 + 向心瞄准环 + 警示刻度），砸下时冲击环 + 裂纹
  private drawBossWarning(g: Graphics) {
    const b = this.monsters.find(m => m.kind === 'boss' && m.state !== 'dead');
    if (!b) return;
    const st = b.slamState || 'none';
    const R = this.BOSS_SLAM_R, ky = 0.34;                    // 压扁成地面椭圆
    const cx = this.sX(b.slamX || b.x), cy = this.groundY + b.lane + 2;
    const ell = (r: number) => g.ellipse(cx, cy, r, r * ky);   // 地面椭圆快捷

    if (st === 'windup') {
      const p = 1 - (b.slamT || 0) / this.BOSS_SLAM_WINDUP;   // 0→1 充能
      const pulse = 0.5 + 0.5 * Math.sin(p * 26);             // 呼吸闪
      // ① 分层暗红危险底（外淡→内浓，做出"渐变/凹陷"质感）
      g.fillColor = new Color(60, 8, 6, 60); ell(R); g.fill();
      g.fillColor = new Color(120, 18, 12, 70); ell(R * 0.82); g.fill();
      g.fillColor = new Color(180, 34, 22, 80); ell(R * 0.6); g.fill();
      // ② 内芯蓄能辉光（随充能变亮变大）
      g.fillColor = new Color(255, 110, 60, Math.round((70 + 120 * p) * (0.7 + 0.3 * pulse)));
      ell(R * (0.18 + 0.42 * p)); g.fill();
      // ③ 立体亮边：先粗暗底边，再细亮边压上 → 有厚度
      g.strokeColor = new Color(70, 10, 8, 200); g.lineWidth = 7; ell(R); g.stroke();
      g.strokeColor = new Color(255, 90, 66, Math.round(180 + 60 * pulse)); g.lineWidth = 3; ell(R * 0.985); g.stroke();
      // ④ 向心瞄准环：从外向中心收拢（读秒感），越收越亮
      const rc = R * (1 - 0.86 * p);
      g.strokeColor = new Color(255, 226, 150, Math.round(120 + 130 * p)); g.lineWidth = 3; ell(rc); g.stroke();
      // ⑤ 边缘警示刻度（随充能缓慢旋转）
      const N = 18, rot = p * 1.4;
      g.strokeColor = new Color(255, 150, 90, 210); g.lineWidth = 3;
      for (let i = 0; i < N; i++) {
        const a = rot + i / N * Math.PI * 2;
        const r0 = R * 1.0, r1 = R * 1.09;
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * ky);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * ky);
      }
      g.stroke();
    } else if (st === 'strike') {
      const p = 1 - (b.slamT || 0) / 0.45;   // 0→1 冲击扩散
      const a = 1 - p;
      // 焦痕（砸点残留暗红）
      g.fillColor = new Color(40, 6, 4, Math.round(150 * a)); ell(R * 0.7); g.fill();
      // 冲击环（双环，向外扩散渐隐）
      g.strokeColor = new Color(255, 240, 205, Math.round(235 * a)); g.lineWidth = 8; ell(R * (0.45 + p * 0.95)); g.stroke();
      g.strokeColor = new Color(255, 150, 90, Math.round(200 * a)); g.lineWidth = 4; ell(R * (0.2 + p * 1.25)); g.stroke();
      // 放射裂纹
      g.strokeColor = new Color(30, 8, 6, Math.round(220 * a)); g.lineWidth = 4;
      const cr = R * (0.4 + p * 0.9);
      for (let i = 0; i < 8; i++) {
        const ang = i / 8 * Math.PI * 2 + 0.2;
        g.moveTo(cx + Math.cos(ang) * R * 0.12, cy + Math.sin(ang) * R * 0.12 * ky);
        g.lineTo(cx + Math.cos(ang) * cr, cy + Math.sin(ang) * cr * ky);
      }
      g.stroke();
    }
  }

  private cullMonsters() {
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i].state === 'dead' && this.monsters[i].deadT > 1.3) this.monsters.splice(i, 1);
    }
  }

  private stepSparks(dt: number) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      this.sparks[i].life += dt;
      if (this.sparks[i].life >= this.sparks[i].max) this.sparks.splice(i, 1);
    }
  }

  private spawnBlood(x: number, y: number, dir: number, amount: number) {
    const n = Math.round(amount * 4);     // 小而密
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;      // 从身体向四周放射飞溅
      const sp = 130 + Math.random() * 430;         // 喷得慢一点
      this.bloods.push({
        x, y,
        vx: Math.cos(ang) * sp + dir * 90,          // 放射 + 略偏击退方向
        vy: Math.sin(ang) * sp + 120,               // 放射 + 略上（随后落下）
        life: 0, max: 0.7 + Math.random() * 0.8,
        r: 3 + Math.random() * 6,                    // 血点小
        shade: Math.random(),
      });
    }
  }

  private stepBloods(dt: number) {
    for (let i = this.bloods.length - 1; i >= 0; i--) {
      const b = this.bloods[i];
      b.life += dt;
      b.vy -= 780 * dt;                 // 重力小一点 → 更慢更飘
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life >= b.max || b.y < this.groundY - 30) this.bloods.splice(i, 1);
    }
  }

  private stepWaves(dt: number) {
    const speed = 620;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life += dt;
      w.x += w.dir * speed * dt;
      for (const m of this.monsters) {
        if (m.state === 'dead' || w.hit.has(m)) continue;
        if (Math.abs(m.x - w.x) <= 55 + 24 * m.scale) {   // 碰到即命中（含体型）
          w.hit.add(m);
          this.hitMonster(m, this.attackDmg * 1.2, w.dir, 280, 0, 12, m.x, this.groundY + 80 * m.scale);
        }
      }
      if (w.life >= w.max) this.waves.splice(i, 1);
    }
  }

  // 击败终极 Boss → 通关胜利
  private gameWin() {
    if (this.over) return;
    this.over = true;
    this.zoneState = 'cleared';
    this.slowMoT = 1.0;   // 胜利慢动作
    AudioMgr.inst.play('win');
    this.bannerLbl.color = new Color(255, 224, 130);
    this.bannerLbl.string = `通关！  击败 Boss · 得分 ${this.score}`;
    this.banner.active = true;
    this.restartBtn.active = true;
    this.banner.setScale(0.3, 0.3, 1);
    tween(this.banner).to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private gameOver() {
    this.over = true;
    AudioMgr.inst.play('lose');
    this.bannerLbl.color = new Color(255, 120, 110);
    this.hero.state = 'dead'; this.hero.deadT = 0; this.hero.fallSign = 1;
    this.bannerLbl.string = `阵亡！  第 ${this.zone + 1} 关 · 得分 ${this.score}`;
    this.banner.active = true;
    this.restartBtn.active = true;
    this.banner.setScale(0.3, 0.3, 1);
    tween(this.banner).to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  // ---------- 绘制 ----------
  private draw() {
    this.drawBg();
    this.updateScrollLayers();
    this.updateBossProps();
    this.updateGroundDecor();
    const g = this.stageG;
    g.clear();
    this.drawSceneTint(g);   // 色调/夜晚压暗：在角色之下，只暗背景
    this.drawBossProps(g);   // Boss 关专属近景道具（大旗/火盆/残骸，角色之下）
    for (const d of this.dusts) {   // 尘土（角色之下）
      const a = 1 - d.life / d.max;
      g.fillColor = new Color(168, 152, 128, Math.round(120 * a));
      g.circle(this.sX(d.x), d.y, d.r * (0.7 + 0.9 * (d.life / d.max)));
      g.fill();
    }

    // 阴影垫底（仅像素兵；赵云/许褚精灵自带影子）
    const h = this.hero;
    for (const m of this.monsters) if (m.state !== 'dead' && m.kind !== 'boss') this.drawShadow(g, m.x, m.lane, 26 * m.scale, m.jumpY);

    this.drawBossWarning(g);   // Boss 重击预警红圈（画在地面、角色之下）
    this.drawDrops(g);   // 掉落物（垫在角色后）
    const drawn = [...this.monsters].sort((a, b) => (a.state === 'dead' ? -1 : 1) - (b.state === 'dead' ? -1 : 1) || b.lane - a.lane);
    this.updateEnemySprites(drawn);   // 小怪 = 轻步兵精灵（Boss 单独用精灵）
    this.updateBossSprite();
    const blink = h.state !== 'dead' && h.invuln > 0 && Math.floor(h.invuln * 20) % 2 === 0;
    if (this.DISMOUNT && !blink && h.state !== 'dead') this.drawHeroLegs(g);   // 火柴腿（在上半身之后画=垫腰下）
    this.updateHeroSprite(blink);
    this.drawArrows(g);  // 敌箭（在角色前）

    for (const s of this.sparks) {
      const a = 1 - s.life / s.max;
      g.strokeColor = new Color(255, 230, 120, Math.round(255 * a));
      g.lineWidth = 4;
      const r = 10 + s.life * 90, sx = this.sX(s.x);
      for (let k = 0; k < 5; k++) {
        const ang = k * 1.257 + s.life * 8;
        g.moveTo(sx, s.y);
        g.lineTo(sx + Math.cos(ang) * r, s.y + Math.sin(ang) * r);
      }
      g.stroke();
    }

    for (const b of this.bloods) {
      const a = Math.max(0, 1 - b.life / b.max);
      const cr = 150 + Math.round(b.shade * 90);
      g.fillColor = new Color(cr, 18 + Math.round(b.shade * 22), 24, Math.round(235 * a));
      g.circle(this.sX(b.x), b.y, b.r * (0.5 + 0.5 * a));
      g.fill();
    }

    // 剑气波（青白新月）
    for (const w of this.waves) {
      const a = Math.max(0, 1 - w.life / w.max);
      const cx = this.sX(w.x), cy = w.y, c = w.dir > 0 ? 0 : Math.PI;
      g.strokeColor = new Color(160, 235, 255, Math.round(230 * a));
      g.lineWidth = 7;
      hArc(g, cx, cy, 36, c - 1.25, c + 1.25, 14); g.stroke();
      g.strokeColor = new Color(230, 250, 255, Math.round(200 * a));
      g.lineWidth = 3;
      hArc(g, cx, cy, 24, c - 1.05, c + 1.05, 12); g.stroke();
    }

    this.drawFlashes(g);   // 冲击白光（角色之上）
    this.drawMotes(g);   // 氛围浮尘（在角色之上飘）
    this.drawHeroHp(g);
    this.drawBossHp(g);
    for (const m of this.monsters) if (m.state !== 'dead' && m.hp < m.hpMax && m.kind !== 'boss') this.drawMonsterHp(g, m);

    this.drawFg();       // 前景遮挡 + 统一色调（独立图层）
  }

  // 主角 = 骑马上半身(带攻击) + 步战腿：定位/翻转/选帧
  private updateHeroSprite(blink: boolean) {
    const h = this.hero;
    if (this.upperFrames.length < 4) { this.heroNode.active = false; return; }
    this.heroNode.active = !blink || h.state === 'dead';

    const sx = this.sX(h.x);
    const y = this.groundY + h.jumpY - Math.max(0, h.crouch) * 24;
    const hk = h.state !== 'dead' && h.hitT > 0 ? Math.min(1, h.hitT / this.HIT_DUR) : 0;
    const ang = -h.dir * 42 * hk;      // 挨揍后仰

    const S = this.SPRITE_SCALE * (h.scaleBoost || 1);
    this.heroNode.setPosition(sx, y, 0);
    this.heroNode.setScale(h.dir >= 0 ? -S : S, S, 1);   // 默认朝左，朝右翻转

    // 攻击 → 拼接(骑马上半身+步战腿)；走路/待机 → 步战赵云完整身体
    const attacking = h.state === 'attack';
    this.heroSp.node.active = attacking;
    this.legsSp.node.active = attacking;
    this.footNode.active = !attacking && this.footFullFrames.length >= 4;
    if (attacking) {
      const p = h.atkType === 2 ? h.slamProg : h.swing;
      const idx = Math.max(0, Math.min(3, Math.floor(p * 4)));
      this.heroSp.spriteFrame = this.upperFrames[idx];
      if (this.legsFrames.length >= 2) this.legsSp.spriteFrame = this.legsFrames[0];
    } else if (this.footFullFrames.length >= 4) {
      // 走路循环 4 帧，待机固定帧0
      const fi = h.state === 'walk' ? Math.floor(this.animT * 8) % 4 : 0;
      this.footSp.spriteFrame = this.footFullFrames[fi];
    }

    if (h.state === 'dead') {
      this.heroNode.angle = (h.dir >= 0 ? -1 : 1) * Math.min(80, h.deadT * 170);
      this.heroOp.opacity = Math.max(0, Math.round(255 * (1 - h.deadT / 1.4)));
    } else {
      this.heroNode.angle = ang;
      this.heroOp.opacity = 255;
    }
  }

  // 下马火柴腿（程序画，会走）
  private drawHeroLegs(g: Graphics) {
    const h = this.hero;
    const S = this.SPRITE_SCALE / 1.8;
    const hx = this.sX(h.x);
    const hipY = this.groundY + h.jumpY + this.LEG_LEN - Math.max(0, h.crouch) * 20;
    const footY = this.groundY + h.jumpY;
    const kneeY = (hipY + footY) / 2;
    const sw = h.state === 'walk' ? Math.sin(h.phase) : 0;
    const f1x = hx + (10 + sw * 13) * S;
    const f2x = hx + (-10 - sw * 13) * S;
    const lift1 = Math.max(0, Math.cos(h.phase)) * 6 * S;   // 抬脚
    const lift2 = Math.max(0, -Math.cos(h.phase)) * 6 * S;
    const legBlue = new Color(46, 68, 122, 255), trimY = new Color(230, 206, 66, 255), bootC = new Color(28, 40, 70, 255);
    const k1x = (hx + f1x) / 2 + 3 * S, k2x = (hx + f2x) / 2 - 3 * S;
    g.lineCap = Graphics.LineCap.ROUND; g.lineJoin = Graphics.LineJoin.ROUND;
    // 腿（粗，蓝底）
    g.strokeColor = legBlue; g.lineWidth = 17 * S;
    g.moveTo(hx, hipY); g.lineTo(k1x, kneeY); g.lineTo(f1x, footY + lift1); g.stroke();
    g.moveTo(hx, hipY); g.lineTo(k2x, kneeY); g.lineTo(f2x, footY + lift2); g.stroke();
    // 黄色描边条（配蓝甲黄纹）
    g.strokeColor = trimY; g.lineWidth = 3.5 * S;
    g.moveTo(hx, hipY); g.lineTo(k1x, kneeY); g.lineTo(f1x, footY + lift1); g.stroke();
    g.moveTo(hx, hipY); g.lineTo(k2x, kneeY); g.lineTo(f2x, footY + lift2); g.stroke();
    // 靴（深蓝，粗）
    g.strokeColor = bootC; g.lineWidth = 18 * S;
    g.moveTo(f1x - 6 * S, footY + lift1); g.lineTo(f1x + 8 * S, footY + lift1); g.stroke();
    g.moveTo(f2x - 6 * S, footY + lift2); g.lineTo(f2x + 8 * S, footY + lift2); g.stroke();
  }

  // Boss 精灵（许褚）：定位/翻转/选帧/挨揍反应
  // 小怪 = 轻步兵精灵：从池中取节点，按怪的位置/朝向/状态摆放
  private updateEnemySprites(drawn: Monster[]) {
    const ready = this.infantryFrames.length >= 4;
    let pi = 0;
    if (ready) {
      for (const m of drawn) {
        if (m.kind === 'boss' || pi >= this.monPool.length) continue;
        const e = this.monPool[pi++];
        e.node.active = true;
        const hk = m.hitT > 0 ? Math.min(1, m.hitT / this.HIT_DUR) : 0;
        const lunge = m.state === 'attack' ? Math.sin(Math.min(1, m.swing) * Math.PI) * 14 : 0;   // 攻击前冲
        e.node.setPosition(this.sX(m.x) + m.dir * lunge, this.groundY + m.lane + m.jumpY, 0);
        // 选帧：走路循环 / 攻击定帧 / 待机（按兵种取各自帧库，缺帧回退轻步兵）
        let f = 0;
        if (m.state === 'walk') f = Math.floor(m.phase * 0.6) % 4;
        else if (m.state === 'attack') f = 2;
        const frames = this.kindFrames[m.kind] || this.infantryFrames;
        e.sp.spriteFrame = frames[((f % 4) + 4) % 4];
        const disp = this.kindDisp[m.kind] || [40, 46];
        e.node.getComponent(UITransform)!.setContentSize(disp[0], disp[1]);
        const S = this.INF_SCALE * m.scale * (1 + 0.05 * hk);
        e.node.setScale(m.dir >= 0 ? -S : S, S, 1);   // 精灵默认朝左 → 朝右翻转
        // 挨揍后仰 / 死亡倒地 / 攻击前倾
        let ang = m.dir * 30 * hk, op = 255;
        if (m.state === 'attack') ang = -m.dir * 12 * Math.sin(Math.min(1, m.swing) * Math.PI);
        if (m.state === 'dead') { ang = (m.dir >= 0 ? 1 : -1) * Math.min(85, m.deadT * 160); op = Math.max(0, Math.round(255 * (1 - m.deadT / 1.3))); }
        e.node.angle = ang;
        e.op.opacity = op;
      }
    }
    for (; pi < this.monPool.length; pi++) this.monPool[pi].node.active = false;
  }

  private updateBossSprite() {
    if (this.bossFrames.length < 4) { this.bossNode.active = false; return; }
    const b = this.monsters.find(m => m.kind === 'boss');
    if (!b) { this.bossNode.active = false; return; }
    this.bossNode.active = true;
    // 蓄力重击：先鼓力上抬(锚定)，砸下瞬间下沉 → 强化打击感
    let lift = 0, popX = 0;
    if (b.slamState === 'windup') { const p = 1 - (b.slamT || 0) / this.BOSS_SLAM_WINDUP; lift = 26 * p; popX = 1 + 0.12 * p; }
    else if (b.slamState === 'strike') { const p = 1 - (b.slamT || 0) / 0.45; lift = -8 * (1 - p); popX = 1; }
    this.bossNode.setPosition(this.sX(b.x), this.groundY + b.lane + b.jumpY + lift, 0);

    const hk = b.hitT > 0 ? Math.min(1, b.hitT / this.HIT_DUR) : 0;
    let f = 3;   // 待机/收招
    if (b.slamState === 'windup') f = 0;          // 举刀蓄力
    else if (b.slamState === 'strike') f = 3;     // 劈下
    else if (b.state === 'attack') f = Math.max(0, Math.min(3, Math.floor(b.swing * 4)));   // 举刀→劈下
    this.bossSp.spriteFrame = this.bossFrames[f];
    this.bossSp.color = b.raged ? new Color(255, 118, 105, 255) : Color.WHITE;   // 二阶段狂暴泛红

    const S = this.BOSS_SCALE * (1 + 0.06 * hk) * (popX || 1);   // 精灵默认朝左：朝右翻转
    this.bossNode.setScale(b.dir >= 0 ? -S : S, S, 1);

    let ang = b.dir * 26 * hk, op = 255;           // 挨揍后仰
    if (b.state === 'dead') { ang = (b.dir >= 0 ? 1 : -1) * Math.min(80, b.deadT * 150); op = Math.max(0, Math.round(255 * (1 - b.deadT / 1.3))); }
    this.bossNode.angle = ang;
    this.bossOp.opacity = op;
    if (this.bossHeadNode) this.bossHeadNode.active = false;   // 去掉 Boss 头变大（只用精灵自带的头）
  }

  // 像素方块敌兵（程序画，红甲，配合像素风）
  private drawPixelSoldier(g: Graphics, m: Monster) {
    const sx = this.sX(m.x);
    const gy = this.groundY + m.lane + m.jumpY;
    const u = 7 * m.scale, dir = m.dir;
    let alpha = 255;
    if (m.state === 'dead') alpha = Math.max(0, Math.round(255 * (1 - m.deadT / 1.3)));
    const hit = m.hitT > 0;

    const skin = new Color(233, 190, 150, alpha);
    const armor = hit ? new Color(255, 255, 255, alpha) : new Color(m.color.r, m.color.g, m.color.b, alpha);
    const armorD = new Color(Math.round(m.color.r * 0.62), Math.round(m.color.g * 0.62), Math.round(m.color.b * 0.62), alpha);
    const dark = new Color(42, 34, 40, alpha);
    const steel = new Color(184, 188, 200, alpha);
    const plume = new Color(226, 62, 52, alpha);

    // 挨揍：绕脚旋转整个身体（连腿一起后仰）
    const hk = m.hitT > 0 ? Math.min(1, m.hitT / this.HIT_DUR) : 0;
    const A = dir * 0.6 * hk;   // 后仰角(弧度)
    const ca = Math.cos(A), sa = Math.sin(A);
    // 中心对齐方块：cx=水平偏移, by=底边离地高, w/h=尺寸；整块绕脚(sx,gy)旋转
    const R = (cx: number, by: number, w: number, h: number, c: Color) => {
      g.fillColor = c;
      const pts = [[cx - w / 2, by], [cx + w / 2, by], [cx + w / 2, by + h], [cx - w / 2, by + h]];
      for (let i = 0; i < 4; i++) {
        const lx = pts[i][0], ly = pts[i][1];
        const X = sx + (lx * ca - ly * sa), Y = gy + (lx * sa + ly * ca);
        if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      }
      g.close(); g.fill();
    };
    // 死亡整体压扁下沉
    const dcompress = m.state === 'dead' ? Math.min(1, m.deadT * 2) : 0;
    const sy = 1 - dcompress * 0.7;

    const legSw = m.state === 'walk' ? Math.sin(m.phase) * 1.0 * u : 0.4 * u;
    // 腿
    R(-0.85 * u + legSw, 0, 1.0 * u, 2.3 * u * sy, dark);
    R(0.85 * u - legSw, 0, 1.0 * u, 2.3 * u * sy, dark);
    // 躯干甲
    R(0, 2.1 * u * sy, 3.0 * u, 2.9 * u * sy, armor);
    R(0, 2.1 * u * sy, 3.0 * u, 0.5 * u * sy, armorD);          // 腰带
    R(0, 4.7 * u * sy, 3.4 * u, 0.8 * u * sy, armorD);          // 护肩
    // 头 + 盔（挨揍时整颗头放大，盔/缨随头上移）
    const hg = 1 + 0.9 * hk, hb = 5.3 * u * sy;
    const hUp = (by: number) => hb + (by - hb) * hg;
    R(0, hb, 2.0 * u * hg, 1.9 * u * sy * hg, skin);
    R(0.42 * u * dir * hg, hUp(6.0 * u * sy), 0.42 * u * hg, 0.42 * u * hg, dark);  // 眼
    R(0, hUp(6.7 * u * sy), 2.4 * u * hg, 0.9 * u * hg, armorD);                    // 盔
    R(0, hUp(7.4 * u * sy), 0.6 * u * hg, 0.9 * u * hg, plume);                     // 盔缨
    // 细节点缀：胸甲高光 + 盔前檐 + 怒眉（不那么平）
    const armorL = new Color(Math.min(255, m.color.r + 48), Math.min(255, m.color.g + 48), Math.min(255, m.color.b + 48), alpha);
    R(0, 4.3 * u * sy, 2.6 * u, 0.5 * u * sy, armorL);                              // 胸甲高光条
    R(-0.6 * u, 2.3 * u * sy, 0.55 * u, 2.4 * u * sy, armorD);                      // 侧身暗部
    R(0, hUp(6.42 * u * sy), 2.55 * u * hg, 0.32 * u * hg, dark);                   // 盔前檐
    R(0.42 * u * dir * hg, hUp(6.5 * u * sy), 0.6 * u * hg, 0.2 * u * hg, dark);    // 怒眉
    // 砍刀：举刀 → 从上往下劈（手臂+刀绕肩旋转）；本地点经 P 变换含后仰
    const P = (lx: number, ly: number): [number, number] => [sx + (lx * ca - ly * sa), gy + (lx * sa + ly * ca)];
    const s01 = m.attacking ? m.swing : 0;
    const baDeg = m.attacking ? 140 - 195 * s01 : 58;   // 举高(上) → 劈下(前下)
    const ba = baDeg * Math.PI / 180;
    const pvx = dir * 0.2 * u, pvy = 4.75 * u * sy;      // 肩部支点
    const ux = dir * Math.cos(ba), uy = Math.sin(ba);
    const armLen = 1.5 * u, bladeLen = 2.7 * u;
    const hx = pvx + armLen * ux, hy = pvy + armLen * uy;              // 手
    const tx = pvx + (armLen + bladeLen) * ux, ty = pvy + (armLen + bladeLen) * uy;  // 刀尖
    g.lineCap = Graphics.LineCap.ROUND;
    // 手臂
    const [ax0, ay0] = P(pvx, pvy), [ax1, ay1] = P(hx, hy);
    g.strokeColor = armor; g.lineWidth = 0.85 * u; g.moveTo(ax0, ay0); g.lineTo(ax1, ay1); g.stroke();
    // 刀身（宽砍刀）
    const [bx0, by0] = P(hx, hy), [bx1, by1] = P(tx, ty);
    g.strokeColor = new Color(70, 74, 84, alpha); g.lineWidth = 0.9 * u; g.moveTo(bx0, by0); g.lineTo(bx1, by1); g.stroke();  // 刀背描边
    g.strokeColor = steel; g.lineWidth = 0.6 * u; g.moveTo(bx0, by0); g.lineTo(bx1, by1); g.stroke();                        // 刀刃
    // 握刀的手 + 护手
    g.fillColor = new Color(60, 46, 34, alpha); g.circle(ax1, ay1, 0.5 * u); g.fill();   // 护手
    g.fillColor = skin; g.circle(ax1, ay1, 0.36 * u); g.fill();                          // 手
  }

  // 脚下阴影（把角色"踩"在地上，跳起时缩小变淡）
  private drawShadow(g: Graphics, wx: number, lane: number, w: number, jumpY: number) {
    const sx = this.sX(wx), sy = this.groundY + lane;
    const shrink = 1 - Math.min(0.6, Math.max(0, jumpY) / 320);
    g.fillColor = new Color(0, 0, 0, Math.round(85 * shrink));
    g.ellipse(sx, sy - 2, w * shrink, 7 * shrink); g.fill();
  }

  private initMotes() {
    const W = DESIGN_W, H = DESIGN_H;
    this.motes = [];
    for (let i = 0; i < 26; i++) {
      this.motes.push({
        x: (Math.random() - 0.5) * W,
        y: this.groundY + Math.random() * (H * 0.55),
        vx: (Math.random() - 0.5) * 14,
        vy: 6 + Math.random() * 16,
        ph: Math.random() * 6.28, r: 1.5 + Math.random() * 2.5,
      });
    }
  }

  private stepMotes(dt: number) {
    const W = DESIGN_W, top = DESIGN_H / 2;
    for (const m of this.motes) {
      m.x += m.vx * dt; m.y += m.vy * dt; m.ph += dt * 2;
      if (m.y > top) { m.y = this.groundY - 20; m.x = (Math.random() - 0.5) * W; }
      if (m.x < -W / 2 - 10) m.x = W / 2 + 10;
      else if (m.x > W / 2 + 10) m.x = -W / 2 - 10;
    }
  }

  private drawMotes(g: Graphics) {
    const t = this.timeOfDay().name;
    let col: number[];
    if (t === '夜晚') col = [225, 240, 200];        // 萤火/星
    else if (t === '黄昏') col = [255, 205, 140];   // 暮光尘
    else col = [240, 246, 232];                     // 柳絮/浮尘
    for (const m of this.motes) {
      const a = 0.35 + 0.35 * Math.sin(m.ph);
      g.fillColor = new Color(col[0], col[1], col[2], Math.round(200 * a));
      g.circle(m.x, m.y, m.r); g.fill();
    }
  }

  private sh(c: number[], f: number): Color {
    return new Color(
      Math.max(0, Math.min(255, Math.round(c[0] * f))),
      Math.max(0, Math.min(255, Math.round(c[1] * f))),
      Math.max(0, Math.min(255, Math.round(c[2] * f))), 255);
  }

  private blend(a: number[], b: number[], t: number): number[] {
    return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
  }

  // 一层像素台阶山
  private mtnLayer(col: number[], par: number, amp: number, baseH: number, ph: number, PX: number) {
    const g = this.bgG, W = DESIGN_W, gy = this.groundY;
    g.fillColor = new Color(col[0], col[1], col[2], 255);
    for (let sx = -W / 2; sx < W / 2; sx += PX) {
      const wx = sx + this.camX * par + ph;
      const hRaw = gy + baseH + Math.sin(wx * 0.008) * amp + Math.sin(wx * 0.019) * amp * 0.4;
      const hy = Math.round(hRaw / PX) * PX;
      g.rect(sx, gy, PX + 1, hy - gy); g.fill();
    }
  }

  // 飘云（慢速视差，块状）
  private drawClouds(t: Theme, PX: number) {
    const g = this.bgG, W = DESIGN_W, gy = this.groundY;
    const col = this.sh(this.timeOfDay().sky, 1.16);
    const snap = (v: number) => Math.round(v / PX) * PX;
    const span = W + 280;
    for (let i = 0; i < 5; i++) {
      const speed = 5 + i * 2;
      let bx = (-this.animT * speed - this.camX * 0.12 + i * 267) % span;
      bx = ((bx % span) + span) % span - W / 2 - 140;
      const by = gy + 420 + (i % 3) * 70;   // 抬到远山(顶=gy+380)之上，不被山挡
      const s = 0.85 + (i % 3) * 0.28;
      g.fillColor = col;
      g.rect(snap(bx), snap(by), snap(96 * s), snap(26 * s)); g.fill();
      g.rect(snap(bx + 22 * s), snap(by + 18 * s), snap(60 * s), snap(20 * s)); g.fill();
      g.rect(snap(bx - 16 * s), snap(by + 10 * s), snap(42 * s), snap(18 * s)); g.fill();
    }
  }

  // 前景层：只保留赵云挥砍刀气（罩在角色之上）
  private drawFg() {
    const g = this.fgG;
    g.clear();

    // 赵云挥砍大刀气（罩在精灵前方，让"刀"更大更猛）
    const h = this.hero;
    if (h.attacking && h.state !== 'dead') {
      const s = h.atkType === 2 ? h.slamProg : h.swing;
      const a = 1 - Math.abs(s - 0.4) / 0.6;   // 中段最亮
      if (a > 0.05) {
        const cx = this.sX(h.x) + h.dir * 22, cy = this.groundY + 74 + h.jumpY;
        const R = 74, c0 = h.dir > 0 ? 0 : Math.PI;
        g.strokeColor = new Color(150, 232, 255, Math.round(200 * a)); g.lineWidth = 13;
        hArc(g, cx, cy, R, c0 - 1.3, c0 + 1.3, 16); g.stroke();
        g.strokeColor = new Color(245, 255, 255, Math.round(235 * a)); g.lineWidth = 5;
        hArc(g, cx, cy, R * 0.86, c0 - 1.05, c0 + 1.05, 14); g.stroke();
      }
    }

    // 密林落叶：几片叶子缓缓飘落（确定性动画，无状态）
    {
      const W = DESIGN_W, H = DESIGN_H, t = this.animT;
      for (let i = 0; i < 7; i++) {
        const fall = ((t * (26 + i * 5) + i * 137) % (H + 80));
        const x = (((i * 211.7 + Math.sin(t * 0.6 + i) * 90) % W) + W) % W - W / 2;
        const y = H / 2 + 40 - fall;
        const sway = Math.sin(t * 2 + i * 1.3) * 0.9;
        g.strokeColor = new Color(150, 140, 78, 110);
        g.lineWidth = 3;
        g.moveTo(x, y); g.lineTo(x + 8 * Math.cos(sway), y + 8 * Math.sin(sway) - 3); g.stroke();
      }
      // 夜战：萤火虫（缓慢游走 + 呼吸闪烁）
      if (this.timeOfDay().name === '夜晚') {
        for (let i = 0; i < 10; i++) {
          const fx = ((i * 173.3) % W) - W / 2 + Math.sin(t * 0.7 + i * 2.1) * 70;
          const fy = this.groundY + 60 + (i % 4) * 90 + Math.sin(t * 0.9 + i * 1.7) * 45;
          const pulse = 0.5 + 0.5 * Math.sin(t * 3 + i * 2.4);
          g.fillColor = new Color(190, 255, 140, Math.round(50 + 150 * pulse));
          g.circle(fx, fy, 2.5 + pulse * 1.5); g.fill();
        }
      }
    }

    // Boss 关：漫天火星缓缓上飘（前景，加压迫感；确定性动画无状态）
    if (this.zone >= this.BOSS_ZONE) {
      const W = DESIGN_W, H = DESIGN_H, t = this.animT;
      for (let i = 0; i < 14; i++) {
        const ph = (t * (0.06 + (i % 5) * 0.02) + i * 0.31) % 1;   // 0→1 循环上升
        const x = (((i * 173.3 + Math.sin(t * 0.7 + i) * 60) % W) + W) % W - W / 2;
        const y = -H / 2 + ph * H;
        const a = Math.sin(ph * Math.PI);                          // 两端淡入淡出
        g.fillColor = new Color(255, 150 + (i % 3) * 30, 70, Math.round(120 * a));
        g.circle(x, y, 2 + (i % 3)); g.fill();
      }
    }
  }

  // 待机/走路时手里的枪（骑马图去马后"垂枪"被切掉，这里补回；画在 stageG=角色之后，藏在身后）
  private drawHeroSpear(g: Graphics) {
    const h = this.hero;
    if (h.attacking || h.state === 'dead') return;
    const fwd = h.dir >= 0 ? -1 : 1;          // 面朝方向（枪尖朝前）
    const bob = h.state === 'walk' ? Math.sin(this.animT * 14) * 2 : 0;
    const baseY = this.groundY + h.jumpY - Math.max(0, h.crouch) * 24;
    const hx = this.sX(h.x) + fwd * 6;        // 握把
    const hy = baseY + 52 + bob;
    const tipX = hx + fwd * 48, tipY = hy + 30;   // 枪尖朝前下(持枪待战)
    const buttX = hx - fwd * 26, buttY = hy - 16; // 枪尾朝后上
    // 枪杆（深棕 + 亮棕芯）
    g.strokeColor = new Color(92, 70, 48, 255); g.lineWidth = 5;
    g.moveTo(buttX, buttY); g.lineTo(tipX, tipY); g.stroke();
    g.strokeColor = new Color(170, 138, 100, 255); g.lineWidth = 2;
    g.moveTo(buttX, buttY); g.lineTo(tipX, tipY); g.stroke();
    // 枪尖（银）
    g.strokeColor = new Color(222, 228, 238, 255); g.lineWidth = 5;
    g.moveTo(tipX - fwd * 9, tipY - 6); g.lineTo(tipX, tipY); g.stroke();
    // 红缨（握把处）
    g.fillColor = new Color(198, 42, 42, 255);
    g.circle(hx + fwd * 3, hy + 2, 4); g.fill();
  }

  // 场景色调 + 夜晚压暗：画在角色之下（只暗背景，角色保持明亮）
  private drawSceneTint(g: Graphics) {
    const W = DESIGN_W, H = DESIGN_H;
    const gr = this.gradeColor(this.theme());
    g.fillColor = gr; g.rect(-W / 2, -H / 2, W, H); g.fill();
    const dk = this.timeOfDay().dark;
    if (dk > 0) { g.fillColor = new Color(6, 12, 32, Math.round(dk * 255)); g.rect(-W / 2, -H / 2, W, H); g.fill(); }
  }

  // 地面装饰：世界坐标网格伪随机散布（近大远小、随机镜像、随镜头滚动）
  private updateGroundDecor() {
    if (!this.decorFrames.length) return;
    const W = DESIGN_W, gy = this.groundY, gap = 130;
    const rnd = (n: number, k: number) => { const v = Math.sin(n * 127.1 + k * 269.3) * 43758.5453; return v - Math.floor(v); };
    let pi = 0;
    const startW = Math.floor((this.camX - W / 2 - gap) / gap) * gap;
    for (let wx = startW; wx < this.camX + W / 2 + gap && pi < this.decorPool.length; wx += gap) {
      if (rnd(wx, 11) < 0.3) continue;   // 三成空位，避免整齐
      const sf = this.decorFrames[Math.floor(rnd(wx, 12) * this.decorFrames.length) % this.decorFrames.length];
      const band = rnd(wx, 13);
      const near = 0.7 + band * 0.75;
      const e = this.decorPool[pi++];
      e.node.active = true;
      e.sp.spriteFrame = sf;
      const dh = 36 * near;
      const dw = dh * sf.rect.width / Math.max(1, sf.rect.height);
      e.node.getComponent(UITransform)!.setContentSize(dw, dh);
      e.node.setPosition(this.sX(wx + rnd(wx, 14) * gap * 0.6), gy - 12 - band * 100, 0);
      e.node.setScale(rnd(wx, 15) < 0.5 ? -1 : 1, 1, 1);
    }
    for (; pi < this.decorPool.length; pi++) this.decorPool[pi].node.active = false;
  }

  // Boss 关道具贴图：按世界坐标定位（临近 Boss 关时随镜头自然滑入）
  private updateBossProps() {
    const show = this.zone >= this.PROPS_ARENA_ZONE - 1;
    if (this.bossPropRoot.active !== show) this.bossPropRoot.active = show;
    if (!show) return;
    const g = this.bossGlowG, gy = this.groundY, t = this.animT, W = DESIGN_W;
    g.clear();
    for (const p of this.bossProps) {
      const x = this.sX(p.wx);
      p.node.setPosition(x, gy + p.dy, 0);
      if (x < -W / 2 - 80 || x > W / 2 + 80) continue;
      // 接地影：把道具从密叶里"压"出来，和背景拉开
      const w = p.node.getComponent(UITransform)!.width;
      g.fillColor = new Color(0, 0, 0, 95);
      g.ellipse(x, gy + 3, w * 0.55, 5); g.fill();
      // 火盆暖光晕（随火苗闪动，照亮周围一小片）
      if (p.res === 'boss-brazier') {
        const fl = 0.85 + 0.15 * Math.sin(t * 8 + p.wx);
        for (let i = 3; i >= 1; i--) {
          g.fillColor = new Color(255, 165, 75, Math.round(15 * (4 - i) * fl));
          g.circle(x, gy + 26, (18 + i * 17) * fl); g.fill();
        }
      }
    }
  }

  // Boss 关：火盆火苗/火星（盆身是贴图，火焰用代码叠加在盆口上）
  private drawBossProps(g: Graphics) {
    if (this.zone < this.PROPS_ARENA_ZONE - 1) return;
    const W = DESIGN_W;
    const arenaX = this.PROPS_ARENA_ZONE * this.ZONE_SPAN;
    const gy = this.groundY, t = this.animT;
    const flame = (wx: number, rimY: number, s: number) => {
      const x = this.sX(wx);
      if (x < -W / 2 - 60 || x > W / 2 + 60) return;
      const by = gy + rimY;   // 盆口高度
      const fl = Math.sin(t * 9 + wx) * 0.5 + 0.5, f2 = Math.sin(t * 13 + wx * 2) * 0.5 + 0.5;
      g.fillColor = new Color(232, 116, 40, 205);
      g.circle(x, by + (10 + fl * 7) * s, (13 + f2 * 3) * s); g.fill();
      g.fillColor = new Color(252, 204, 96, 225);
      g.circle(x, by + (8 + f2 * 6) * s, (7 + fl * 2.5) * s); g.fill();
      for (let i = 0; i < 3; i++) {                     // 火星（确定性伪随机，无状态）
        const ph = (t * (0.55 + i * 0.17) + i * 0.37 + wx * 0.001) % 1;
        const ex = x + Math.sin(t * 3 + i * 2.1 + wx) * 9 * s;
        const ey = by + 14 * s + ph * 95 * s;
        g.fillColor = new Color(255, 170, 80, Math.round(200 * (1 - ph)));
        g.circle(ex, ey, 2.2 * s * (1 - ph * 0.5)); g.fill();
      }
    };
    flame(arenaX + 158, 29, 0.5);    // 火盆盆口（右侧，盆高 38px）
  }

  // 全屏色调滤镜：由时段驱动（真背景叠上它 → 清晨/黄昏/夜的氛围）
  private gradeColor(t: Theme): Color {
    const gr = this.timeOfDay().grade;
    return new Color(gr[0], gr[1], gr[2], gr[3]);
  }

  private drawBg() {
    const g = this.bgG, W = DESIGN_W, H = DESIGN_H, gy = this.groundY;
    const t = this.theme();
    const PX = 12;
    g.clear();

    // 天空：平滑竖直渐变（地平线亮 → 天顶暗），无硬分割线
    const sky = this.timeOfDay().sky;
    const skyBot = sky.map(v => Math.min(255, v * 1.06));
    const skyTop = sky.map(v => v * 0.66);
    const skyRegion = H / 2 - gy, sb = 26, sbh = skyRegion / sb;
    for (let i = 0; i < sb; i++) {
      const c = this.blend(skyBot, skyTop, i / (sb - 1));
      g.fillColor = new Color(c[0], c[1], c[2], 255);
      g.rect(-W / 2, gy + i * sbh, W, sbh + 1); g.fill();
    }

    // 飘云
    this.drawClouds(t, PX);

    // 远山改用真图层（updateFarLayer）；这里只保留天空

    // 地面：绿色阶梯渐变（色调贴近近景草，越往下越暗）+ 色阶交界棋盘抖动 → 像素感
    const top = [52, 68, 42];   // 地平线附近 ≈ 草色
    const bot = [12, 18, 10];   // 屏底最暗
    const steps = 6, region = gy + H / 2;
    const stepH = region / steps;
    for (let i = 0; i < steps; i++) {
      const c = this.blend(top, bot, i / (steps - 1));
      const col = new Color(c[0], c[1], c[2], 255);
      const yTop = gy - i * stepH;
      g.fillColor = col;
      g.rect(-W / 2, yTop - stepH - 1, W, stepH + 1); g.fill();
      // 抖动过渡：本阶颜色向上一行咬进上一阶（棋盘格，随镜头滚动不穿帮）
      if (i > 0) {
        g.fillColor = col;
        const shift = ((Math.floor(this.camX / PX) + i) % 2) * PX - (((this.camX % (PX * 2)) + PX * 2) % (PX * 2));
        for (let x = -W / 2 - PX * 2; x < W / 2 + PX * 2; x += PX * 2) {
          g.rect(x + shift, yTop, PX, PX); g.fill();
        }
      }
    }

    // 地面细节：撒草簇/石子/土斑/亮叶，打破大块纯色（世界坐标定点 → 随镜头滚动，近大远小）
    const rnd2 = (n: number, k: number) => { const v = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
    const gap = 46;
    const startW = Math.floor((this.camX - W / 2 - gap) / gap) * gap;
    for (let wxi = startW; wxi < this.camX + W / 2 + gap; wxi += gap) {
      const sx = this.sX(wxi + rnd2(wxi, 1) * gap);
      const band = rnd2(wxi, 2);                       // 0..1 → 离地平线远近
      const y = gy - 14 - band * 112;   // 只撒在可见地面带（下方由暗灌木剪影接管）
      const near = 0.75 + band * 0.75;                 // 越靠屏下越大
      const kind = rnd2(wxi, 3);
      if (kind < 0.4) {
        // 草簇：三笔短草
        g.strokeColor = new Color(62, 86, 52, 200); g.lineWidth = 2.5 * near;
        for (let b2 = -1; b2 <= 1; b2++) {
          g.moveTo(sx + b2 * 4 * near, y);
          g.lineTo(sx + b2 * 7 * near, y + (11 + rnd2(wxi, 4 + b2) * 6) * near);
        }
        g.stroke();
      } else if (kind < 0.6) {
        // 石子（亮面+暗底）
        g.fillColor = new Color(70, 76, 84, 220);
        g.ellipse(sx, y + 3 * near, 7 * near, 4.5 * near); g.fill();
        g.fillColor = new Color(94, 100, 108, 150);
        g.ellipse(sx - 1.5 * near, y + 4.5 * near, 4 * near, 2.5 * near); g.fill();
      } else if (kind < 0.85) {
        // 土斑（暗绿褐横抹，融入绿地）
        g.fillColor = new Color(20, 28, 16, 130);
        g.ellipse(sx, y, 20 * near, 5 * near); g.fill();
      } else {
        // 亮草叶点缀
        g.fillColor = new Color(86, 110, 64, 140);
        g.ellipse(sx, y + 2, 5 * near, 2.5 * near); g.fill();
      }
    }

    // 底部暗植被剪影带：垫在前景大草后面 → 草缝里是深色草影而不是灰板
    const bushTop = gy - 138;
    const dkBush = new Color(13, 21, 16, 255);
    g.fillColor = dkBush;
    g.rect(-W / 2, -H / 2, W, bushTop + H / 2); g.fill();   // 底色块（灌木带主体）
    for (let wxi = startW; wxi < this.camX + W / 2 + gap; wxi += 34) {   // 顶缘波浪丛形
      const r = 14 + rnd2(wxi, 7) * 24;
      const bx = this.sX(wxi + rnd2(wxi, 8) * 30);
      g.fillColor = dkBush;
      g.circle(bx, bushTop + rnd2(wxi, 9) * 10, r); g.fill();
    }
  }

  // 创建一层无缝滚动视差背景（2 块瓦片，镜像图已保证左右无缝）
  private makeScrollLayer(res: string, dispH: number, par: number, baseY: number) {
    const L = { tiles: [] as Node[], w: 0, par, baseY, dispH };
    for (let i = 0; i < 2; i++) {
      const n = new Node('bglayer-' + res + i);
      n.layer = this.node.layer; n.parent = this.node;
      n.addComponent(UITransform).setAnchorPoint(0, 0);
      n.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
      L.tiles.push(n);
    }
    this.layers.push(L);
    this.setLayerImage(this.layers.length - 1, res);
  }

  // 换某一视差层的贴图（带缓存；缺图静默跳过，保留当前图）
  private setLayerImage(idx: number, res: string) {
    const L = this.layers[idx];
    if (!L) return;
    const apply = (sf: SpriteFrame) => {
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      L.w = sf.rect.width * (L.dispH / sf.rect.height);
      for (const n of L.tiles) {
        n.getComponent(Sprite)!.spriteFrame = sf;
        n.getComponent(UITransform)!.setContentSize(L.w, L.dispH);
      }
    };
    if (this.bgCache[res]) { apply(this.bgCache[res]); return; }
    resources.load(res + '/spriteFrame', SpriteFrame, (e, sf) => {
      if (e || !sf) return;   // 缺图静默：保持上一张背景
      this.bgCache[res] = sf;
      apply(sf);
    });
  }

  // 关卡 → 背景组：全部关卡（含 Boss）统一用第一组（密林）
  private biomeIndexFor(zone: number): number {
    return 0;
  }
  // 某层(0远/1中/2近)在某组的资源名
  private layerRes(li: number, bi: number): string {
    const b = this.BIOMES[bi];
    return li === 0 ? b.far : li === 1 ? b.mid : b.near;
  }
  // 预加载所有背景组到缓存（换景要用；缺图静默跳过）
  private preloadAllBiomes() {
    for (let bi = 0; bi < this.BIOMES.length; bi++) {
      for (let li = 0; li < 3; li++) {
        const res = this.layerRes(li, bi);
        if (this.bgCache[res]) continue;
        resources.load(res + '/spriteFrame', SpriteFrame, (e, sf) => { if (!e && sf) this.bgCache[res] = sf; });
      }
    }
  }

  // 直接把背景组套到 3 层（用于开局/换景结束）
  private applyBiome(zone: number) {
    const bi = this.biomeIndexFor(zone);
    if (bi === this.curBiome) return;
    this.curBiome = bi;
    this.setLayerImage(0, this.layerRes(0, bi));
    this.setLayerImage(1, this.layerRes(1, bi));
    this.setLayerImage(2, this.layerRes(2, bi));
  }

  // 所有视差层：各自速度无缝横向滚动；卷屏换景时走"老左滑出/新右滑入"
  private updateScrollLayers() {
    const W = DESIGN_W;
    if (this.transActive) { this.renderTransition(); return; }
    for (const L of this.layers) {
      if (!L.w) continue;
      const off = (((this.camX * L.par) % L.w) + L.w) % L.w;
      for (let i = 0; i < L.tiles.length; i++) {
        L.tiles[i].setPosition(-W / 2 - off + i * L.w, this.groundY + L.baseY, 0);
      }
    }
  }

  // 走路换景：老场景随走路视差缓慢左移(近快远慢)，新场景从右滑入(远景先入、近景后入)
  private renderTransition() {
    const W = DESIGN_W, p = this.transP;
    const delay = [0.0, 0.10, 0.22];   // 远/中/近 入场延迟：走向新区域时远处先出现
    const set = (t: Node, sf: SpriteFrame, x: number, y: number, dispH: number) => {
      t.getComponent(Sprite)!.spriteFrame = sf;
      t.getComponent(UITransform)!.setContentSize(sf.rect.width * (dispH / sf.rect.height), dispH);
      t.setPosition(x, y, 0);
    };
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      const fromSf = this.bgCache[this.layerRes(li, this.transFrom)];
      const toSf = this.bgCache[this.layerRes(li, this.transTo)];
      if (!fromSf || !toSf) continue;
      const y = this.groundY + L.baseY;
      // 老场景：随走路视差左移（近层移得多、远层移得少）
      set(L.tiles[0], fromSf, -W / 2 - p * this.ZONE_SPAN * L.par, y, L.dispH);
      // 新场景：从右滑入盖上来；终点=普通滚动落点(无缝交接，避免结束时再跳一下)
      const wNew = toSf.rect.width * (L.dispH / toSf.rect.height);
      const offEnd = (((this.targetCam * L.par) % wNew) + wNew) % wNew;
      const endX = -W / 2 - offEnd;                                  // 关底普通滚动时该层的落点
      const d = delay[Math.min(li, delay.length - 1)];
      const pn = Math.min(1, Math.max(0, (p - d) / (1 - d)));        // 远景先入、近景后入
      set(L.tiles[1], toSf, endX + (1 - pn) * W, y, L.dispH);        // 从右一屏外滑到落点
    }
  }

  private drawProps(t: Theme, PX: number) {
    const g = this.bgG, W = DESIGN_W, gy = this.groundY, p = 0.85, gap = 250;
    const rnd = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5; return s - Math.floor(s); };
    const snap = (v: number) => Math.round(v / PX) * PX;
    const blk = (cx: number, by: number, w: number, h: number, c: Color) => {
      g.fillColor = c; g.rect(snap(cx - w / 2), gy + snap(by), Math.max(PX, snap(w)), Math.max(PX, snap(h))); g.fill();
    };
    const startW = Math.floor((this.camX - W) / gap) * gap;
    for (let w = startW; w < this.camX + W; w += gap) {
      const sx = (w - this.camX) * p;
      if (sx < -W / 2 - 90 || sx > W / 2 + 90) continue;
      const r = rnd(w), sz = 0.8 + r * 0.6;
      const green = new Color(t.hill[0], t.hill[1], t.hill[2], 255);
      switch (t.prop) {
        case 'bush':
          blk(sx, 0, 60 * sz, 34 * sz, green); blk(sx, 28 * sz, 34 * sz, 20 * sz, green);
          break;
        case 'tree':
          blk(sx, 0, 14, 60 * sz, new Color(84, 56, 36, 255));
          blk(sx, 52 * sz, 72 * sz, 30 * sz, new Color(46, 96, 58, 255));
          blk(sx, 78 * sz, 46 * sz, 26 * sz, new Color(54, 110, 66, 255));
          break;
        case 'pine':
          for (let i = 0; i < 4; i++) blk(sx, i * 22 * sz, (74 - i * 16) * sz, 22 * sz, new Color(52, 98, 72, 255));
          blk(sx, 0, 14, 22, new Color(84, 56, 36, 255));
          break;
        case 'wall':
          blk(sx, 0, 84 * sz, 120 * sz, new Color(100, 94, 92, 255));
          blk(sx - 30 * sz, 120 * sz, 24 * sz, 22, new Color(72, 68, 66, 255));
          blk(sx + 30 * sz, 120 * sz, 24 * sz, 22, new Color(72, 68, 66, 255));
          break;
        case 'tent':
          for (let i = 0; i < 4; i++) blk(sx, i * 22 * sz, (18 + (4 - i) * 22) * sz, 22 * sz, new Color(150, 55, 50, 255));
          break;
      }
    }
  }

  private drawXpBar(g: Graphics) {
    const y = DESIGN_H / 2 - 290, w = 360, x = -w / 2, hh = 9;
    g.fillColor = new Color(0, 0, 0, 150); g.roundRect(x, y, w, hh, 4); g.fill();
    const p = Math.max(0, Math.min(1, this.xp / this.xpNext));
    g.fillColor = new Color(120, 200, 255, 255); g.roundRect(x + 1, y + 1, (w - 2) * p, hh - 2, 3); g.fill();
  }

  private drawBossHp(g: Graphics) {
    const boss = this.monsters.find(m => m.kind === 'boss' && m.state !== 'dead');
    if (!boss) return;
    const y = DESIGN_H / 2 - 322, w = 520, x = -w / 2, hh = 20;
    g.fillColor = new Color(0, 0, 0, 170); g.roundRect(x, y, w, hh, 6); g.fill();
    const p = Math.max(0, boss.hp / boss.hpMax);
    g.fillColor = new Color(212, 52, 62, 255); g.roundRect(x + 2, y + 2, (w - 4) * p, hh - 4, 5); g.fill();
    g.strokeColor = new Color(255, 220, 150, 220); g.lineWidth = 2; g.roundRect(x, y, w, hh, 6); g.stroke();
  }

  private drawHeroHp(g: Graphics) {
    const y = DESIGN_H / 2 - 260, w = 360, x = -w / 2, hh = 22;
    g.fillColor = new Color(0, 0, 0, 160); g.roundRect(x, y, w, hh, 6); g.fill();
    const p = Math.max(0, this.hero.hp / this.hero.hpMax);
    g.fillColor = new Color(90, 210, 110, 255); g.roundRect(x + 2, y + 2, (w - 4) * p, hh - 4, 5); g.fill();
    g.strokeColor = new Color(255, 255, 255, 200); g.lineWidth = 2; g.roundRect(x, y, w, hh, 6); g.stroke();
  }

  private drawMonsterHp(g: Graphics, m: Monster) {
    const w = 46 * m.scale, x = this.sX(m.x) - w / 2, y = this.groundY + m.lane + 155 * m.scale;
    g.fillColor = new Color(0, 0, 0, 150); g.rect(x, y, w, 7); g.fill();
    const p = Math.max(0, m.hp / m.hpMax);
    g.fillColor = new Color(230, 80, 80, 255); g.rect(x + 1, y + 1, (w - 2) * p, 5); g.fill();
  }

  private drawStick(g: Graphics, o: Stick) {
    const u = 22 * o.scale * o.scaleBoost;
    const fx = this.sX(o.x), fy = this.groundY + o.lane + o.jumpY;   // jumpY 抬升（跳劈）
    const dir = o.dir;

    let A = 0, alpha = 255;
    if (o.state === 'dead') {
      A = Math.min(Math.PI * 0.5, o.deadT * 5) * o.fallSign;
      alpha = Math.max(0, Math.round(255 * (1 - o.deadT / 1.3)));
    }
    const k = o.hitT > 0 ? o.hitT / this.HIT_DUR : 0;
    const walking = o.state === 'walk';
    // 挤压拉伸：起跳纵向拉长、快速下落微拉伸、落地横向压扁（以脚底为基准）
    const oh = o as unknown as { landT?: number; jmpLand?: number };
    let sqx = 1, sqy = 1;
    if (o.jumpVy > 120) { sqy = 1.10; sqx = 0.93; }
    else if (o.jumpY > 1 && o.jumpVy < -160) { sqy = 1.05; sqx = 0.96; }
    const landK = Math.max(oh.landT ? oh.landT / this.LAND_DUR : 0, oh.jmpLand ? oh.jmpLand / this.JUMP_LAND : 0);
    if (landK > 0) { sqy = 1 - 0.12 * landK; sqx = 1 + 0.14 * landK; }
    // 前倾：走路微前倾 + 挥砍顺势前压（负=向面朝方向倾）
    const atkLean = o.state === 'attack' && o.atkType !== 1 ? Math.sin(Math.min(1, o.swing) * Math.PI) * 0.30 * u : 0;
    const leanAmt = k * 1.5 * u - (walking ? 0.22 * u : 0) - atkLean;
    const topRef = 4.3 * u;
    const cosA = Math.cos(A), sinA = Math.sin(A);
    const T = (lx: number, ly: number): [number, number] => {
      const X = (lx - leanAmt * (ly / topRef)) * dir * sqx;
      const Y = ly * sqy;
      return [fx + (X * cosA - Y * sinA), fy + (X * sinA + Y * cosA)];
    };

    const sw = Math.sin(o.phase);
    // 走路上下颠（待机不再呼吸起伏，只留飘带动）
    const bob = walking ? Math.abs(sw) * 0.15 * u : 0;

    // 蹲/伸姿态（逻辑层已算好 o.crouch）：正=蹲下屈膝，负=踮脚起身
    const crouch = o.crouch;
    const cp = Math.max(0, crouch);
    // 髋部大幅下沉；躯干长度不变（整体下坐），头也跟着明显变矮
    const HIP = (2.1 - 1.85 * crouch) * u + bob;
    const SHO = HIP + (2.2 - 0.15 * cp) * u;              // 蹲深躯干略前压
    const headCy = SHO + 0.95 * u, headR = 0.62 * u;

    let f1x: number, f2x: number, f1y = 0, f2y = 0, lf1 = 0, lf2 = 0;
    if (o.state === 'walk') {
      const s = 0.6 * u * sw; f1x = s; f2x = -s;
      lf1 = Math.max(0, Math.cos(o.phase));                  // 前摆的脚抬起程度 0~1
      lf2 = Math.max(0, -Math.cos(o.phase));                 // 后蹬的脚
      const lift = 0.1 * u;                                  // 抬脚高度
      f1y = lift * lf1; f2y = lift * lf2;
    } else { const sp = (0.5 + 0.7 * cp) * u; f1x = sp; f2x = -sp; }   // 蹲时双脚张开扎马步

    const isFoe = o.horns;
    const col = new Color(o.color.r, o.color.g, o.color.b, alpha);           // 主色=袍甲
    const outline = new Color(35, 28, 32, alpha);                            // 深色勾线
    const dark = (c: Color, f: number) => new Color(Math.round(c.r * f), Math.round(c.g * f), Math.round(c.b * f), alpha);
    const skinC = isFoe ? col : new Color(240, 206, 170, alpha);             // 肤色（怪用本色）
    const pantsC = dark(col, 0.55);                                          // 裤
    const bootC = new Color(58, 48, 46, alpha);                              // 靴
    const beltC = new Color(122, 82, 52, alpha);                             // 腰带
    const buckleC = new Color(214, 178, 86, alpha);                          // 金扣
    const hairC = new Color(46, 38, 44, alpha);                              // 头发
    const legSegs: [number, number, number, number][] = [];
    const armSegs: [number, number, number, number][] = [];    // 前臂（近侧）
    const armBSegs: [number, number, number, number][] = [];   // 后臂（远侧，藏袍后）
    const segTo = (arr: [number, number, number, number][], ax: number, ay: number, bx: number, by: number) => {
      const [x0, y0] = T(ax, ay), [x1, y1] = T(bx, by);
      arr.push([x0, y0, x1, y1]);
    };

    // 地面投影：固定在地面（不随跳跃抬升），跳越高越小越淡 → 有落地感
    const shGroundY = this.groundY + o.lane;
    const airFade = Math.max(0, 1 - o.jumpY / (4.2 * u));
    const shScale = 0.55 + 0.45 * airFade;
    g.fillColor = new Color(0, 0, 0, Math.round(55 * airFade * (alpha / 255)));
    g.ellipse(fx, shGroundY - 0.05 * u, 1.55 * u * shScale, 0.34 * u * shScale);
    g.fill();

    g.lineCap = Graphics.LineCap.ROUND;      // 圆角线帽/接头 → 四肢圆润
    g.lineJoin = Graphics.LineJoin.ROUND;

    // 腿（带膝盖）：蹲得越深，膝盖越向外顶出 → 明显屈膝
    const kY = HIP * 0.5;
    const kneeFwd = 0.55 * u, kneeUp = 0.28 * u;             // 抬腿时膝盖前顶 + 抬高 → 屈膝
    const k1x = f1x * 0.5 + 0.6 * u * cp + kneeFwd * lf1;    // 前腿膝盖外顶/前弯
    const k1y = kY + kneeUp * lf1;
    const k2x = f2x * 0.5 - 0.6 * u * cp + kneeFwd * lf2;    // 后腿
    const k2y = kY + kneeUp * lf2;
    segTo(legSegs, 0, HIP, k1x, k1y); segTo(legSegs, k1x, k1y, f1x, f1y);
    segTo(legSegs, 0, HIP, k2x, k2y); segTo(legSegs, k2x, k2y, f2x, f2y);

    let backHand: [number, number], frontHand: [number, number], wTip: [number, number] | null = null;
    let bladeLen = 1.6 * u, bladeGrow = 1, bladeAngle = 0, aura = 0;   // 刀长 / 刀粗 / 刀角(度) / 刀气开关
    if (o.state === 'attack') {
      const s = o.swing;
      if (o.weapon) {
        let waDeg: number, fh: [number, number] = [0.7 * u, SHO - 0.5 * u];
        if (o.atkType === 1) { waDeg = -55 + 195 * s; bladeLen = 2.5 * u; }        // 上挑：下→上
        else if (o.atkType === 2) {                                                // 跳劈：高举 → 前下劈
          waDeg = 125 - 180 * o.slamProg; fh = [0.4 * u, SHO - 0.1 * u];
          bladeLen = (2.75 + 0.7 * o.slamProg) * u; bladeGrow = 1 + 0.9 * o.slamProg;
          aura = Math.max(0, 1 - o.slamProg);   // 落下逐渐消失
        } else {                                                                   // 下劈：上→下，刀变大 + 刀气
          waDeg = 130 - 165 * s; bladeLen = (2.4 + 1.3 * s) * u; bladeGrow = 1 + 1.3 * s;
          aura = Math.max(0, 1 - s);            // 落下逐渐消失
        }
        const wa = waDeg * Math.PI / 180;
        bladeAngle = waDeg;
        frontHand = fh;
        wTip = [fh[0] + Math.cos(wa) * bladeLen, fh[1] + Math.sin(wa) * bladeLen];
        backHand = [-0.6 * u, SHO - 1.4 * u];
      } else {
        const reach = (0.6 + 1.3 * s) * u;
        frontHand = [reach, SHO - 0.8 * u];
        backHand = [-0.5 * u, SHO - 1.4 * u];
      }
    } else {
      const a = o.state === 'walk' ? 0.4 * u * sw : 0;
      frontHand = [0.55 * u + a, SHO - 1.4 * u];
      backHand = [-0.55 * u - a, SHO - 1.5 * u];
      if (o.weapon) wTip = [frontHand[0] + 1.6 * u, frontHand[1] + 1.0 * u];
    }
    const armY = SHO - 0.45 * u;   // 手臂根：从袍身肩部伸出（不在脖子根）
    segTo(armBSegs, 0, armY, backHand[0], backHand[1]);
    segTo(armSegs, 0, armY, frontHand[0], frontHand[1]);

    const bw = 6.5 * o.scale;
    const strokeArr = (arr: [number, number, number, number][], w: number, c: Color) => {
      g.strokeColor = c; g.lineWidth = w;
      for (const s of arr) hLine(g, s[0], s[1], s[2], s[3]);
      g.stroke();
    };
    // 本地椭圆（沿方向 d 为长轴）：先深色描边圈，再指定色填充
    const ovalLocal = (cxL: number, cyL: number, rxL: number, ryL: number, dxL: number, dyL: number, fillC: Color) => {
      const px = -dyL, py = dxL, N = 12;
      const build = (rx: number, ry: number) => {
        for (let i = 0; i <= N; i++) {
          const a = i / N * Math.PI * 2, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
          const [X, Y] = T(cxL + dxL * ex + px * ey, cyL + dyL * ex + py * ey);
          if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
        }
      };
      g.fillColor = outline; build(rxL + 1.6 * o.scale, ryL + 1.6 * o.scale); g.fill();
      g.fillColor = fillC; build(rxL, ryL); g.fill();
    };
    // 本地多边形：先勾边再填色
    const fillPolyLocal = (pts: [number, number][], fillC: Color) => {
      const scr = pts.map(p => T(p[0], p[1]));
      const trace = () => { for (let i = 0; i <= scr.length; i++) { const p = scr[i % scr.length]; if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); } };
      trace(); g.strokeColor = outline; g.lineWidth = 4 * o.scale; g.stroke();
      trace(); g.fillColor = fillC; g.fill();
    };

    // 手（掌 + 拇指，指定填色）
    const hand = (hL: [number, number], fromL: [number, number], size: number, fillC: Color) => {
      let dx = hL[0] - fromL[0], dy = hL[1] - fromL[1];
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      ovalLocal(hL[0], hL[1], size * 1.3, size * 0.85, dx, dy, fillC);     // 掌（顺臂拉长）
      const px = -dy, py = dx;                                            // 拇指：掌侧一小块
      const [tx, ty] = T(hL[0] + px * size * 0.9 - dx * size * 0.25, hL[1] + py * size * 0.9 - dy * size * 0.25);
      g.fillColor = outline; g.circle(tx, ty, size * 0.5 + 1.4 * o.scale); g.fill();
      g.fillColor = fillC; g.circle(tx, ty, size * 0.5); g.fill();
    };

    // 1) 腿（深色裤）
    strokeArr(legSegs, bw + 4.5 * o.scale, outline);
    strokeArr(legSegs, bw, pantsC);
    // 2) 靴
    const foot = (fxL: number, fyL: number) => ovalLocal(fxL + 0.12 * u, fyL + 0.02 * u, 0.36 * u, 0.16 * u, 1, 0, bootC);
    foot(f1x, f1y); foot(f2x, f2y);
    // 3) 后臂 + 后手（藏在袍身后，略暗显远）
    strokeArr(armBSegs, bw + 4.5 * o.scale, outline);
    strokeArr(armBSegs, bw, dark(col, 0.78));
    hand(backHand, [0, armY], 0.28 * u, dark(skinC, 0.85));
    // 4) 战袍：平肩直筒微 A 字（无领口、无收腰 → 不会变三角）
    const shW = 0.35 * u, hemW = 0.48 * u;
    const hemSw = walking ? -Math.sin(o.phase) * 0.07 * u : 0;   // 下摆随步伐向后轻摆
    fillPolyLocal([[-shW, SHO + 0.12 * u], [shW, SHO + 0.12 * u], [hemW + hemSw, HIP - 0.3 * u], [-hemW + hemSw, HIP - 0.3 * u]], col);
    // 5) 腰带 + 金扣
    const beltY = HIP + 0.5 * u;
    const [blx, bly] = T(-0.46 * u, beltY), [brx, bry] = T(0.46 * u, beltY + 0.05 * u);
    g.strokeColor = outline; g.lineWidth = 0.34 * u + 3 * o.scale; hLine(g, blx, bly, brx, bry); g.stroke();
    g.strokeColor = beltC; g.lineWidth = 0.34 * u; hLine(g, blx, bly, brx, bry); g.stroke();
    const [bkx, bky] = T(0, beltY + 0.02 * u);
    g.fillColor = outline; g.circle(bkx, bky, 0.17 * u); g.fill();
    g.fillColor = buckleC; g.circle(bkx, bky, 0.12 * u); g.fill();
    // 腰后飘带：两段红绸，走路甩得更开
    if (!isFoe) {
      const rf = Math.sin(this.animT * 4.5 + 0.7) * (walking ? 0.14 : 0.05);
      const r0 = T(-0.42 * u, beltY);
      const r1 = T((-0.62 - rf) * u, beltY - 0.38 * u);
      const r2 = T((-0.74 - rf * 2.2) * u, beltY - 0.72 * u);
      g.strokeColor = new Color(190, 60, 55, alpha); g.lineWidth = 0.10 * u;
      hLine(g, r0[0], r0[1], r1[0], r1[1]); g.stroke();
      hLine(g, r1[0], r1[1], r2[0], r2[1]); g.stroke();
    }
    // 6) 前臂（袍袖，主色，盖在袍身前）+ 前手
    strokeArr(armSegs, bw + 4.5 * o.scale, outline);
    strokeArr(armSegs, bw, col);
    hand(frontHand, [0, armY], 0.30 * u, skinC);

    // 刀气：刀尖扫过的青白拖尾弧，沿长度从刀尖(头)到尾端逐渐消失
    if (o.weapon && o.state === 'attack' && aura > 0.02) {
      const fh2 = frontHand;
      const trailDeg = 66, N = 12;
      // frac: 0=刀尖(头,最亮) → 1=尾端(淡出)
      const pt = (frac: number, rad: number): [number, number] => {
        const a = (bladeAngle + trailDeg * frac) * Math.PI / 180;
        return T(fh2[0] + Math.cos(a) * rad, fh2[1] + Math.sin(a) * rad);
      };
      for (let i = 0; i < N; i++) {
        const f0 = i / N, f1 = (i + 1) / N;
        const b = (1 - (f0 + f1) / 2);          // 该段亮度：越靠头越亮
        const taper = b * b;                    // 头到尾更快变透明
        // 外发光（宽，头粗尾细）
        let [x0, y0] = pt(f0, bladeLen * 1.12), [x1, y1] = pt(f1, bladeLen * 1.12);
        g.strokeColor = new Color(150, 230, 255, Math.round(alpha * 0.42 * aura * taper));
        g.lineWidth = (2 + 12 * b) * o.scale;
        g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        // 内亮线（细，锋利）
        [x0, y0] = pt(f0, bladeLen * 0.97); [x1, y1] = pt(f1, bladeLen * 0.97);
        g.strokeColor = new Color(240, 255, 255, Math.round(alpha * 0.9 * aura * taper));
        g.lineWidth = (1.2 + 3.5 * b) * o.scale;
        g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }

    if (o.weapon && wTip) {
      g.strokeColor = new Color(210, 214, 224, alpha); g.lineWidth = 4 * o.scale * bladeGrow;
      const [hx, hy] = T(frontHand[0], frontHand[1]);
      const [tx, ty] = T(wTip[0], wTip[1]);
      hLine(g, hx, hy, tx, ty); g.stroke();
    }

    const headRk = headR * (1 + 0.95 * k);
    const [hcx, hcy] = T(0, headCy);
    // 脖子（肤色，连接袍领与头）
    {
      const [n0x, n0y] = T(0, SHO + 0.06 * u), [n1x, n1y] = T(0.02 * u, headCy - 0.42 * u);
      g.strokeColor = outline; g.lineWidth = 0.46 * u; hLine(g, n0x, n0y, n1x, n1y); g.stroke();
      g.strokeColor = skinC; g.lineWidth = 0.30 * u; hLine(g, n0x, n0y, n1x, n1y); g.stroke();
    }
    // 发髻（头后上方，非怪）
    if (!isFoe) {
      const [bux, buy] = T(-0.52 * u, headCy + 0.55 * u);
      g.fillColor = outline; g.circle(bux, buy, 0.30 * u); g.fill();
      g.fillColor = hairC; g.circle(bux, buy, 0.24 * u); g.fill();
    }
    // 头（肤色脸 / 怪本色）
    hArc(g, hcx, hcy, headRk, 0, Math.PI * 2, 14); g.fillColor = skinC; g.fill();
    hArc(g, hcx, hcy, headRk, 0, Math.PI * 2, 14);
    g.strokeColor = outline; g.lineWidth = 3.5 * o.scale * (1 + 0.4 * k); g.stroke();
    // 顶发：沿头顶到后脑的一圈头发（非怪）
    if (!isFoe) {
      g.strokeColor = hairC; g.lineWidth = 0.30 * u;
      const N2 = 10;
      for (let i = 0; i <= N2; i++) {
        const ph = (55 + (200 - 55) * i / N2) * Math.PI / 180;
        const [X, Y] = T(Math.cos(ph) * headRk * 0.98, headCy + Math.sin(ph) * headRk * 0.98);
        if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      }
      g.stroke();
    }
    // 眼睛（黑珠 + 高光）
    {
      const [ex2, ey2] = T(0.30 * u, headCy + 0.06 * u);
      g.fillColor = outline; g.circle(ex2, ey2, 0.115 * u); g.fill();
      const [gx2, gy2] = T(0.335 * u, headCy + 0.10 * u);
      g.fillColor = new Color(255, 255, 255, alpha); g.circle(gx2, gy2, 0.045 * u); g.fill();
    }
    // 眉毛：主角平和 / 怪下斜怒眉
    {
      const b0 = isFoe ? T(0.10 * u, headCy + 0.36 * u) : T(0.14 * u, headCy + 0.30 * u);
      const b1 = isFoe ? T(0.46 * u, headCy + 0.20 * u) : T(0.46 * u, headCy + 0.33 * u);
      g.strokeColor = outline; g.lineWidth = 2.8 * o.scale;
      hLine(g, b0[0], b0[1], b1[0], b1[1]); g.stroke();
    }
    // 红额带 + 脑后飘尾（非怪）
    if (!isFoe) {
      const bandC = new Color(190, 60, 55, alpha);
      const [h0x, h0y] = T(-0.60 * u, headCy + 0.26 * u), [h1x, h1y] = T(0.60 * u, headCy + 0.30 * u);
      g.strokeColor = bandC; g.lineWidth = 0.18 * u; hLine(g, h0x, h0y, h1x, h1y); g.stroke();
      g.lineWidth = 0.09 * u;
      const flap = walking ? Math.sin(this.animT * 6 + o.phase) * 0.11 : 0;   // 飘尾仅走路甩动，待机静止
      const [t0x, t0y] = T(-0.58 * u, headCy + 0.28 * u);
      const [t1x, t1y] = T((-0.95 - flap * 0.35) * u, headCy + (0.10 + flap) * u);
      const [t2x, t2y] = T((-0.88 - flap * 0.5) * u, headCy + (-0.08 + flap * 1.5) * u);
      hLine(g, t0x, t0y, t1x, t1y); g.stroke();
      hLine(g, t0x, t0y, t2x, t2y); g.stroke();
    }

    // 刀光弧（仅上挑用轻弧；下劈/跳劈改用刀气拖尾）
    if (o.weapon && o.state === 'attack' && o.atkType === 1) {
      const [ssx, ssy] = T(0, SHO);
      g.strokeColor = new Color(255, 255, 255, Math.round(alpha * 0.55 * (1 - o.swing)));
      g.lineWidth = 5 * o.scale;
      const c = dir > 0 ? 0 : Math.PI;
      hArc(g, ssx, ssy, 2.3 * u, c - 1.2, c + 1.2, 12);
      g.stroke();
    }

    if (o.horns) {
      const [lx1, ly1] = T(-0.5 * u, headCy + headRk * 0.7);
      const [lx2, ly2] = T(-0.9 * u, headCy + headRk * 1.7);
      const [rx1, ry1] = T(0.5 * u, headCy + headRk * 0.7);
      const [rx2, ry2] = T(0.9 * u, headCy + headRk * 1.7);
      g.strokeColor = outline; g.lineWidth = 4 * o.scale + 3 * o.scale;
      hLine(g, lx1, ly1, lx2, ly2); hLine(g, rx1, ry1, rx2, ry2); g.stroke();
      g.strokeColor = col; g.lineWidth = 4 * o.scale;
      hLine(g, lx1, ly1, lx2, ly2); hLine(g, rx1, ry1, rx2, ry2); g.stroke();
    }
  }

  // ---------- 小工具 ----------
  private child(name: string): Node {
    const n = new Node(name);
    n.layer = this.node.layer;
    n.parent = this.node;
    n.addComponent(UITransform);
    return n;
  }

  private child2(parent: Node, x: number, y: number): Node {
    const n = new Node('n');
    n.layer = this.node.layer;
    n.parent = parent;
    n.addComponent(UITransform);
    n.setPosition(x, y, 0);
    return n;
  }

  private makeLabel(text: string, x: number, y: number, size: number, color: Color): Label {
    const n = this.child('lbl');
    n.setPosition(x, y, 0);
    return this.addLabelTo(n, text, size, color);
  }

  private addLabelTo(n: Node, text: string, size: number, color: Color): Label {
    const lbl = n.addComponent(Label);
    lbl.string = text; lbl.fontSize = size; lbl.lineHeight = size + 4;
    lbl.color = color;
    const ol = n.addComponent(LabelOutline);
    ol.color = new Color(20, 15, 12, 255); ol.width = 4;
    return lbl;
  }

  private btnBase(text: string, x: number, y: number, w: number, h: number, bg: Color): Node {
    const n = this.child('btn-' + text);
    n.setPosition(x, y, 0);
    (n.getComponent(UITransform)!).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = bg; g.roundRect(-w / 2, -h / 2, w, h, 14); g.fill();
    g.strokeColor = new Color(255, 255, 255, 180); g.lineWidth = 3;
    g.roundRect(-w / 2, -h / 2, w, h, 14); g.stroke();
    this.addLabelTo(n, text, Math.min(40, h * 0.5), new Color(255, 255, 255));
    return n;
  }

  private makeTapButton(text: string, x: number, y: number, w: number, h: number, bg: Color, cb: () => void): Node {
    const n = this.btnBase(text, x, y, w, h, bg);
    n.on(Node.EventType.TOUCH_END, () => {
      tween(n).to(0.06, { scale: new Vec3(1.1, 1.1, 1) }).to(0.09, { scale: new Vec3(1, 1, 1) }).start();
      cb();
    }, this);
    return n;
  }

  private makeHoldButton(text: string, x: number, y: number, bg: Color, onHold: (held: boolean) => void): Node {
    const n = this.btnBase(text, x, y, 120, 96, bg);
    n.on(Node.EventType.TOUCH_START, () => { onHold(true); n.setScale(0.92, 0.92, 1); }, this);
    const up = () => { onHold(false); n.setScale(1, 1, 1); };
    n.on(Node.EventType.TOUCH_END, up, this);
    n.on(Node.EventType.TOUCH_CANCEL, up, this);
    return n;
  }
}
