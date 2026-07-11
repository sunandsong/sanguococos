import {
  _decorator, Component, Node, Graphics, Label, LabelOutline,
  UITransform, UIOpacity, Color, tween, Vec3, Vec2, EventTouch,
  input, Input, EventKeyboard, KeyCode,
  Sprite, SpriteFrame, Texture2D, Rect, resources, gfx, director, profiler, Mask,
} from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { AudioMgr } from './AudioMgr';
import { AssetHub } from './AssetHub';
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
  private readonly JUMP_LAND = 0.3;       // 普通跳跃：落地缓冲下蹲时长（长一点看得清弹性）
  private readonly JUMP_VY = 980;         // 跳劈起跳速度
  private readonly GRAVITY_J = 2800;      // 跳劈重力
  private readonly LAND_DUR = 0.7;        // 落地深蹲→起身时长（越大起身越慢）
  // Boss 预警重击
  private readonly BOSS_SLAM_WINDUP = 0.95;  // 蓄力→砸下的预警时长（红圈亮起）
  private readonly BOSS_SLAM_CD = 3.4;       // 两次重击间隔
  private readonly BOSS_SLAM_R = 150;        // 命中半径（红圈半径）
  private readonly BOSS_SLAM_DMG = 34;       // 重击伤害

  // 背景组：每 5 关一个场景，Boss 单独一个场景（缺图会自动沿用上一组，不报错）。
  // 背景组：far/mid/near/fg 四层视差贴图。
  // 第 1-5 关=青原，第 6-9 关=密林，第 10 关(Boss)=焦土。
  private readonly BIOMES = [
    { name: '密林', far: 'bg-far-forest', mid: 'bg-mid-forest', near: 'bg-near-forest', fg: 'bg-fg-forest' },   // 第一章全部关卡
    // 青原/焦土组已删（图早已清理，biomeIndexFor 恒 0 从未用到）；第二章地府/天庭走 REALMS 染色方案
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

  private bgG!: Graphics;         // 天空/地面（静态，缓存：只在镜头移动或换时段时重画）
  private cloudG!: Graphics;      // 云（每帧重画，云要飘）
  private bgKey = '';             // bgG 当前内容的标识（时段），相同则跳过重画
  private cloudKey = -1;          // 云层脏标记（吸附位置+时段的数字哈希）：云挪过一格才重画
  private hudG!: Graphics;        // HUD 层（血条/Boss条/图标底座）：血量变了才重画
  private hudKey = -1;            // HUD 脏标记（血量/残影/Boss血的数字哈希）
  private groundFxG!: Graphics;   // 地面残留层（雪面/血渍/脚印/插地箭）：低频重画
  private groundFxT = 0;
  private groundFxCam = -99999;
  private spcCdKey = -1;          // 技能冷却环脏标记（48 级量化）
  private ambiOdd = false;        // 氛围动画隔帧开关（叶/草/小动物 30Hz 更新）
  private stageG!: Graphics;
  private fgG!: Graphics;   // 前景层（主角之上、暗角之下）
  private glowG!: Graphics;   // 辉光层（加法混合，亮元素发光）
  private fgSilG!: Graphics;  // 前景剪影层（最前，暗色草木框景）
  private bossPropRoot!: Node;   // Boss 关近景道具容器（角色之下）
  private bossProps: { node: Node; wx: number; dy: number; res: string }[] = [];
  private bossGlowG!: Graphics;  // 道具垫底层：接地影 + 火盆暖光晕（在道具贴图之下）
  private readonly PROPS_ARENA_ZONE = 9;   // 道具所在关：Boss 关（第 10 关）
  private layers: { tiles: Node[]; w: number; par: number; baseY: number; dispH: number }[] = [];   // 视差背景层（远→近）
  private bgTintRef: readonly number[] | null = null;   // 背景层当前界色数组引用（变了才重刷）
  private readonly _drawnScratch: Monster[] = [];        // 每帧绘制排序复用数组
  private readonly _cloudBxs: number[] = [];             // 云位置计算复用数组
  private static readonly _drawOrder = (a: Monster, b: Monster) =>
    (a.state === 'dead' ? -1 : 1) - (b.state === 'dead' ? -1 : 1) || b.lane - a.lane;
  private readonly _charTintC = new Color(255, 255, 255, 255);   // charTint 缓存（按关）
  private _charTintZone = -1;
  private bgCache: Record<string, SpriteFrame> = {};   // 背景图缓存（换关不重复加载）
  private curBiome = -1;   // 当前已应用的背景组，-1=未设
  private fgLayerIdx = -1;   // 图片前景层在 this.layers 里的真实索引（石头层在它之前）
  private heroVx = 0;        // 主角平滑水平速度（披风/盔缨滞后拖拽用）
  private prevHeroX = 0;
  // 战场残留：血渍/脚印（地面贴花）+ 插在地上的箭
  private stains: { x: number; y: number; r: number; life: number; max: number; kind: string }[] = [];
  private stuckArrows: { x: number; y: number; ang: number; life: number; max: number }[] = [];
  private stepT = 0;         // 脚步节拍（雪脚印/雨水花）
  private stepPar = 1;       // 左右脚交替
  private hpLag = 100;   // 掉血残影（血条上缓慢追上的亮橙段）
  private deadOverlay!: Node;   // 阵亡灰化遮罩
  private spcCdG: Graphics | null = null;   // 剑气按钮冷却扇形遮罩
  private deadOverlayOp!: UIOpacity;
  private bannerOp!: UIOpacity;
  private restartOp!: UIOpacity;
  private lastDt = 0.016;   // 本帧 dt（供 draw 阶段的粒子推进用）
  // 小动物（氛围点缀：蝴蝶飘/小鸟啄食/兔子窜屏，会被主角惊扰）
  private critters: { n: Node; sp: Sprite; op: UIOpacity; kind: number; state: number; x: number; y: number; vx: number; vy: number; ph: number; wait: number }[] = [];
  private birdStandSF: SpriteFrame | null = null;
  private birdFlySF: SpriteFrame | null = null;
  // 草屑（跳劈落地掀飞的碎草叶）
  private grassBits: { x: number; y: number; vx: number; vy: number; ang: number; va: number; life: number; max: number }[] = [];
  // 近景草丛（独立草株：风摆 + 主角走过拨开回弹；前后两排夹住角色）
  private nearGrass: { n: Node; op: UIOpacity; sp: Sprite; loaded: boolean; lx: number; by: number; ph: number; ang: number; vel: number; par: number; fly: number; fx: number; fy: number; fvx: number; fvy: number; spin: number; regrow: number; sc: number }[] = [];
  // 前景叶片（独立元件，绕叶柄弹簧摆；雨天被雨滴敲击 → 下压回弹 + 水花）
  private fgLeaves: { n: Node; lx: number; by: number; ph: number; ang: number; vel: number; hitCd: number }[] = [];
  private leafFxG!: Graphics;   // 叶面水花层（在叶片之上）
  private leafSplashes: { x: number; y: number; life: number; max: number; seed: number }[] = [];
  // 曹旗旗面切条（横条随 sin 相位摆动 → 垂旗飘动；杆/横杆静止）
  private flagStrips: { n: Node; bx: number; amp: number; ph: number }[] = [];
  // Boss 法术贴图特效：法阵(双层反向旋转) + 冲击波环（加法混合，黑底自动消失）
  private fxRune: { n: Node; c: Node; op: UIOpacity }[] = [];   // n=压扁的地面透视父节点, c=旋转的贴图子节点
  private fxShock: { n: Node; c: Node; op: UIOpacity } | null = null;
  private fxReady = false;
  private shockT = 0;        // 冲击波剩余时间
  private shockX = 0;        // 冲击波世界 x
  // 击杀慢动作 + 攻击残影
  private slowMo = 0;        // 慢动作剩余时间（击杀触发，全场 0.3 倍速 + 微推近）
  private ghosts: { n: Node; foot: Sprite; upper: Sprite; legs: Sprite; op: UIOpacity; life: number }[] = [];
  private ghostCd = 0;
  private readonly GHOST_LIFE = 0.22;
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
  private deadRedT = 0;            // 阵亡红闪剩余
  private deadT2 = 0;              // 阵亡计时(不受慢动作缩放，用于演出)
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
  private readonly ARROW_GAP = 1.3;   // 全局任意两箭最小间隔(s)，留出跳跃空档
  private arrowGap = 0;
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

  // 天气系统：每关一种天气（晴/雨/雪/落叶/余烬），雨天带雷电
  private readonly ZONE_WEATHER = ['落叶', '晴', '雨', '晴', '晴', '雨', '晴', '雪', '晴', '余烬'];

  // ── 三界（《碧落黄泉》）：一套底图靠染色变出三种氛围，省掉 2/3 的背景美术 ──
  // bg=背景层染色  char=角色/敌人染色  grade=全屏色调罩(RGBA)
  private readonly REALMS: Record<string, { name: string; bg: number[]; char: number[]; grade: number[] }> = {
    human:      { name: '人间', bg: [255, 255, 255], char: [255, 255, 255], grade: [0, 0, 0, 0] },
    underworld: { name: '地府', bg: [128, 156, 168], char: [176, 196, 202], grade: [26, 46, 58, 54] },   // 青灰、幽冥
    heaven:     { name: '天庭', bg: [255, 238, 190], char: [255, 246, 214], grade: [255, 214, 120, 40] }, // 鎏金、云光
  };
  // 每关所属界。【第一章：十关全在人间，不染色，画面与现在完全一致】
  // 第二章(地府)、第三章(天庭) 再把对应关卡改成 'underworld' / 'heaven' 即可。
  private readonly ZONE_REALM = ['human', 'human', 'human', 'human', 'human',
                                 'human', 'human', 'human', 'human', 'human'];
  private realmOf(zone: number) { return this.REALMS[this.ZONE_REALM[Math.min(zone, this.ZONE_REALM.length - 1)]]; }
  private weather = '晴';
  private snowAcc = 0;   // 地面积雪厚度 0→1（下雪时间越久越厚，换天气后消融）
  private stormK = 0;    // 乌云浓度 0→1（雨天聚拢，雨停消散）
  // 天气贴图层：雨/雪/落叶/浮尘全部用无缝平铺贴图斜向滚动（每层每帧只改 1 个坐标，成本与粒子数无关）
  private rainNodes: { n: Node; sp: Sprite; op: UIOpacity | null; kind: string; vx: number; vy: number; sway: number; ph: number; ox: number; oy: number; tw: number; th: number; by: number }[] = [];
  private rainSplashT = 0;             // 地面溅落定时器（雨水花/雪堆/叶片，原来由每滴落地触发，现在定时随机补）

  // ── 特效精灵化：血滴/尘土用同一张圆点贴图的精灵池；刀气/剑气波用新月贴图 ──
  // 同贴图的精灵自动合批 → 全部粒子 1 个 draw call；每帧只是挪节点，不再重建几何
  private fxDotSF: SpriteFrame | null = null;
  private fxCreSF: SpriteFrame | null = null;
  private dotLayer!: Node;
  private dotPool: { n: Node; sp: Sprite }[] = [];
  private dotUsed = 0;
  private wavePool: { n: Node; sp: Sprite }[] = [];
  private waveLayer!: Node;
  private slashN: Node | null = null;
  private slashSp: Sprite | null = null;
  // 主角序列帧（AI 生成）：跳劈 + 地面攻击；跳跃/受击/死亡保持原始程序动画
  private slamFrames: SpriteFrame[] = [];     // 跳劈 4 帧
  private atkFrames: SpriteFrame[] = [];      // 地面攻击 4 帧
  private jumpFrames: SpriteFrame[] = [];     // 跳跃 3 帧（只用 0=蹲 和 2=屈腿；上升用站立帧+程序拉伸）
  // 跳劈落地冲击波（AI 生成 4 帧序列：爆点→炸开→光环→消散）
  private readonly SLAM_FX_DUR = 0.34;
  private slamFxFrames: SpriteFrame[] = [];
  private slamFxN: Node | null = null;
  private slamFxSp: Sprite | null = null;
  private slamFxT = 0;
  private slamFxX = 0;

  private dotBegin() { this.dotUsed = 0; }
  /** 画一个圆点粒子（精灵池版 circle+fill）：r=半径，颜色+alpha 直接染到精灵上 */
  private dotDraw(x: number, y: number, r: number, cr: number, cg: number, cb: number, a: number) {
    if (a <= 1 || !this.fxDotSF) return;
    let d = this.dotPool[this.dotUsed];
    if (!d) {
      if (this.dotPool.length >= 140) return;   // 池上限（血 90 + 尘土余量）
      const n = new Node('dot' + this.dotPool.length);
      n.layer = this.node.layer; n.parent = this.dotLayer;
      n.addComponent(UITransform).setContentSize(14, 14);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = this.fxDotSF;
      d = { n, sp }; this.dotPool.push(d);
    }
    d.n.active = true;
    d.n.setPosition(x, y, 0);
    const s = (r * 2) / 14;
    d.n.setScale(s, s, 1);
    this._scratchC.set(cr, cg, cb, a);
    d.sp.color = this._scratchC;
    this.dotUsed++;
  }
  private dotEnd() {
    for (let i = this.dotUsed; i < this.dotPool.length; i++) {
      if (this.dotPool[i].n.active) this.dotPool[i].n.active = false;
    }
  }
  /** 取第 i 个剑气波精灵（懒建，上限 4） */
  private waveFx(i: number): { n: Node; sp: Sprite } | null {
    if (this.wavePool[i]) return this.wavePool[i];
    if (!this.fxCreSF || i >= 4) return null;
    const n = new Node('wavefx' + i);
    n.layer = this.node.layer; n.parent = this.waveLayer;
    n.addComponent(UITransform).setContentSize(128, 128);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = this.fxCreSF;
    const rec = { n, sp }; this.wavePool.push(rec);
    return rec;
  }

  /** 当前天气对应的贴图层 kind（'' = 无贴图层天气） */
  private weatherKind(): string {
    return this.weather === '雨' ? 'rain' : this.weather === '雪' ? 'snow' : this.weather === '落叶' ? 'leaf' : '';
  }

  /** 浮尘层按时段染色（夜=萤火青、黄昏=暮光橙、白天=柳絮白） */
  private tintMoteLayers() {
    const tod = this.timeOfDay().name;
    const c = tod === '夜晚' ? [225, 240, 200] : tod === '黄昏' ? [255, 205, 140] : [240, 246, 232];
    for (const r of this.rainNodes) if (r.kind === 'mote') r.sp.color = new Color(c[0], c[1], c[2], 255);
  }

  /** 天气贴图层滚动 + 横摆 + 浮尘呼吸（每帧每层 1 次 setPosition，晴天只有浮尘层在动） */
  private updateWeatherLayers(dt: number) {
    for (const r of this.rainNodes) {
      if (!r.n.active) continue;
      r.ox = (((r.ox + r.vx * dt) % r.tw) + r.tw) % r.tw;
      r.oy = (((r.oy + r.vy * dt) % r.th) + r.th) % r.th;
      const sx = r.sway ? Math.sin(this.animT * 0.85 + r.ph) * r.sway : 0;
      r.n.setPosition(r.ox - r.tw / 2 + sx, r.by + r.oy - r.th / 2, 0);
      if (r.op) r.op.opacity = Math.round(150 + 70 * Math.sin(this.animT * 0.9 + r.ph));
    }
  }
  private readonly CTRL_ALPHA = 0.5;   // 操控按钮透明度 0~1（UIOpacity 对 Graphics 无效，直接乘进颜色）
  private readonly RENDER_SCALE = 0.6; // 渲染分辨率缩放 0~1（省填充率救掉帧；1=原生，像素风建议 0.5~0.7）
  private readonly _scratchC = new Color(255, 255, 255, 255);   // 复用色对象（热循环里避免 new Color 触发 GC）
  private readonly SHOW_FPS = true;    // 屏上显示实时 FPS + 敌人数（性能调试用，发布前改 false）
  private fpsLbl: Label | null = null;
  private fpsAcc = 0;                   // 半秒采样累计
  private fpsFrames = 0;
  private lastRealDt = 0.016;           // 真实帧间隔（未 clamp/未慢动作缩放）
  private readonly RAIN_PX = 3;
  private wparts: { x: number; y: number; vx: number; vy: number; ph: number; len: number; sz: number; c: number; d: number }[] = [];
  private wimpacts: { x: number; y: number; life: number; max: number; t: string; sz: number; c: number; d: number }[] = [];   // 落地溅落
  private lightT = 0;    // 闪电亮度 0..1
  private lightCd = 0;   // 下次闪电倒计时
  private bolt: number[][] = [];          // 闪电主干折线点
  private boltBranches: number[][][] = [];// 分叉
  private flickN = 0;    // 剩余抖闪次数
  private flickT = 0;    // 距下次抖闪
  private slamBolt: number[][] = [];   // 跳劈落地闪电折线
  private slamBoltT = 0;               // 剩余显示时间

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
    // 降渲染分辨率：手机视网膜(2~3倍)下大量半透明叠加把 GPU 填充率打满 → 掉帧。
    // 像素风降到 0.6 分辨率几乎看不出，填充率省 ~64%。发布前可微调 RENDER_SCALE。
    try {
      const pipe = director.root?.pipeline as unknown as { shadingScale?: number };
      if (pipe && 'shadingScale' in pipe) pipe.shadingScale = this.RENDER_SCALE;
    } catch (e) { console.warn('[Perf] shadingScale 设置失败', e); }
    // 引擎自带性能面板：显示 Draw call / 逻辑(CPU)ms / 渲染ms / GFX —— 一眼看出 CPU 还是 GPU 瓶颈
    if (this.SHOW_FPS) { try { profiler.showStats(); } catch (e) { /* ignore */ } }
    const W = DESIGN_W, H = DESIGN_H;
    this.groundY = (0.5 - this.groundFy) * H;
    this.baseAtk = this.attackDmg; this.baseSpeed = this.heroSpeed; this.specialCdCur = this.SPECIAL_CD;

    const rootUI = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    rootUI.setContentSize(W, H);
    rootUI.setAnchorPoint(0.5, 0.5);
    this.node.on(Node.EventType.TOUCH_END, () => {}, this);

    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);

    this.bgG = this.child('bg').addComponent(Graphics);      // 天空/地面（缓存，静态时不重画）
    this.cloudG = this.child('bgcloud').addComponent(Graphics);   // 云（单独层，每帧画）——建在 bg 之后=盖在天空上、山之下

    // 视差背景层（真图，无缝滚动）：远→近，在天空之上、角色之下
    // 远山画高些（峰顶自然高过中景）、底边压回地平线藏住 → 无空隙
    // 前三层贴图由 applyBiome 统一设置（不预载初始图 → 避免开局两图竞速闪现）
    this.makeScrollLayer('far', 380, 0.25, 0, false);     // 远景层
    this.makeScrollLayer('mid', 300, 0.5, 0, false);      // 中景层
    this.makeScrollLayer('near', 180, 0.7, -30, false);   // 近景层（角色身后）
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
      AssetHub.loadSF(res, (sf) => {
        if (sf) { (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST); this.decorFrames.push(sf); }
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
        AssetHub.loadSF(res, (sf) => { if (sf) sp.spriteFrame = sf; });
        this.bossProps.push({ node: n, wx, dy, res });
      };
      // 旗/枪/盾/拒马放大一倍增强存在感；火盆保持
      // 曹旗：杆/横杆静止 + 旗面切 8 条随风飘（切条波浪）
      {
        const n = new Node('boss-flag'); n.layer = this.node.layer; n.parent = this.bossPropRoot;
        const nu = n.addComponent(UITransform); nu.setAnchorPoint(0.5, 0); nu.setContentSize(116, 226);
        n.setScale(-1, 1, 1);   // 镜像（与原版一致）
        this.bossProps.push({ node: n, wx: arenaX + 245, dy: 0, res: 'boss-flag' });
        AssetHub.loadSF('boss-flag', (base) => {
          if (!base) return;
          const tex = base.texture as Texture2D;
          const TW = tex.width, TH = tex.height;
          const sx = 116 / TW, sy = 226 / TH;
          const piece = (rx: number, ry: number, rw: number, rh: number, name: string) => {
            const c = new Node(name); c.layer = this.node.layer; c.parent = n;
            const u = c.addComponent(UITransform); u.setAnchorPoint(0, 1);
            u.setContentSize(rw * sx, rh * sy);
            const sp = c.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
            const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(rx, ry, rw, rh);
            sp.spriteFrame = sf;
            c.setPosition((rx - TW / 2) * sx, (TH - ry) * sy, 0);
            return c;
          };
          const poleW = Math.round(TW * 0.36);
          piece(0, 0, poleW, TH, 'pole');                       // 杆+矛头（静止）
          const clothX = poleW, clothW = TW - poleW;
          const topH = Math.round(TH * 0.26);
          piece(clothX, 0, clothW, topH, 'top');                // 横杆+旗面顶部（静止=固定端）
          const clothY = topH, clothH = Math.round(TH * 0.64);
          const N = 8, rh = Math.ceil(clothH / N);
          this.flagStrips = [];
          for (let i = 0; i < N; i++) {
            const ry = clothY + i * rh;
            const c = piece(clothX, ry, clothW, Math.min(rh + 2, TH - ry), 'strip' + i);   // +2 重叠遮缝
            this.flagStrips.push({ n: c, bx: (clothX - TW / 2) * sx, amp: 6.5 * Math.pow((i + 1) / N, 1.25), ph: i * 0.55 });
          }
        });
      }
      mk('boss-brazier', arenaX + 158, 53, 38);         // 火盆（右侧）
      mk('boss-spear', arenaX - 60, 50, 82);            // 断枪插地
      mk('boss-shield', arenaX + 70, 58, 38);           // 破盾倒地
      mk('boss-barricade', arenaX + 320, 188, 84);      // 拒马
      this.bossPropRoot.active = false;
    }

    this.groundFxG = this.child('groundfx').addComponent(Graphics);   // 地面残留缓存层（雪面/血渍/脚印/箭，低频重画，垫在 stage 下）
    this.stageG = this.child('stage').addComponent(Graphics);
    // 粒子精灵池图层（血滴/尘土）+ 剑气波精灵图层：紧跟 stage → 与原 Graphics 绘制层级一致
    this.dotLayer = this.child('fxdots');
    this.waveLayer = this.child('fxwaves');
    this.hudG = this.child('hud').addComponent(Graphics);             // HUD 缓存层（血量变了才重画）
    AssetHub.loadSF('fx-dot', (sf) => {
      if (!sf) return;
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      this.fxDotSF = sf;
    });
    AssetHub.loadSF('fx-crescent', (sf) => {
      if (!sf) return;
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      this.fxCreSF = sf;
      if (this.slashSp) this.slashSp.spriteFrame = sf;
    });
    // 跳劈落地冲击波：640×136 横排 4 帧，切成 160×136 的帧序列
    AssetHub.loadSF('fx-slam-impact', (base) => {
      if (!base) return;
      const tex = base.texture as Texture2D;
      tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let i = 0; i < 4; i++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(i * 160, 0, 160, 136);
        this.slamFxFrames.push(sf);
      }
    });

    // 小动物节点（3蝴蝶+1鸟+1兔）
    {
      const mkC = (name: string, w: number, hh: number, kind: number, ph: number, wait: number) => {
        const n = new Node(name); n.layer = this.node.layer; n.parent = this.node;
        const u = n.addComponent(UITransform); u.setContentSize(w, hh); u.setAnchorPoint(0.5, 0.5);
        const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const op = n.addComponent(UIOpacity); n.active = false;
        this.critters.push({ n, sp, op, kind, state: 0, x: 0, y: 0, vx: 0, vy: 0, ph, wait });
        return sp;
      };
      const loadSF = (res: string, cb: (sf: SpriteFrame) => void) => {
        AssetHub.loadSF(res, (sf) => {
          if (!sf) return;
          (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
          cb(sf);
        });
      };
      const bSps: Sprite[] = [];
      for (let i = 0; i < 3; i++) bSps.push(mkC('butterfly' + i, 33, 28, 0, i * 2.1, 2 + i * 3));
      loadSF('critter-butterfly', sf => { for (const sp of bSps) sp.spriteFrame = sf; });
      const birdSp = mkC('bird', 38, 18, 1, 0, 3);   // 小鸟缩小（原 62×30 太大）
      loadSF('critter-bird-stand', sf => { this.birdStandSF = sf; birdSp.spriteFrame = sf; });
      loadSF('critter-bird-fly', sf => { this.birdFlySF = sf; });
      mkC('rabbit', 66, 33, 2, 0, 10);
      loadSF('critter-rabbit', sf => { const r = this.critters.find(c => c.kind === 2); if (r) r.sp.spriteFrame = sf; });
    }

    // Boss 法术特效节点（法阵×2 + 冲击波）：父节点压扁做地面透视，子节点旋转贴图 → 盘面旋转
    const mkFx = (name: string) => {
      const n = new Node(name); n.layer = this.node.layer; n.parent = this.node;
      n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
      const op = n.addComponent(UIOpacity);
      const c = new Node(name + '-tex'); c.layer = this.node.layer; c.parent = n;
      const cu = c.addComponent(UITransform); cu.setAnchorPoint(0.5, 0.5); cu.setContentSize(512, 512);
      const sp = c.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      // 贴图已做"亮度→alpha"处理（黑底=透明、亮部=发光色），标准透明混合即可
      n.active = false;
      return { n, c, op, sp };
    };
    const r0 = mkFx('fxrune0'), r1 = mkFx('fxrune1'), sh = mkFx('fxshock');
    this.fxRune = [r0, r1]; this.fxShock = sh;
    AssetHub.loadSF('fx-rune-circle', (sf) => {
      if (!sf) { console.warn('法阵贴图加载失败'); return; }
      r0.sp.spriteFrame = sf; r1.sp.spriteFrame = sf; this.fxReady = true;
    });
    AssetHub.loadSF('fx-shockwave', (sf) => {
      if (!sf) return; sh.sp.spriteFrame = sf;
    });

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
      AssetHub.loadSF(res, (base) => {
        if (!base) { console.warn(kind + ' 贴图加载失败'); return; }
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
    loadKind('shield', 'enemy-guard', 64, [8, 6, 48, 51], [44, 47]);    // 盾兵 = 近卫兵 蓝甲带盾（裁剪底对到脚，不悬空）
    loadKind('elite', 'enemy-heavy', 64, [8, 6, 48, 51], [44, 47]);     // 精英 = 重步兵 红橙重甲
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
    AssetHub.loadSF('enemy-xuchu', (base) => {
      if (!base) { console.warn('许褚贴图加载失败'); return; }
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

    // 攻击残影池：结构镜像主角(全身/上半身/腿)，建在主角之前=渲染在身后
    for (let i = 0; i < 4; i++) {
      const n = new Node('ghost' + i); n.layer = this.node.layer; n.parent = this.node;
      n.addComponent(UITransform).setAnchorPoint(0.5, 0);
      const op = n.addComponent(UIOpacity);
      const mk = (name: string, w: number, hh: number, x: number, y: number) => {
        const c = new Node(name); c.layer = this.node.layer; c.parent = n;
        const u = c.addComponent(UITransform); u.setContentSize(w, hh); u.setAnchorPoint(0.5, 0);
        const sp = c.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.color = new Color(140, 210, 255, 255);   // 冷青残影色
        c.setPosition(x, y, 0);
        return sp;
      };
      const legs = mk('l', 32, 28, 0, 0), upper = mk('u', 52, 22, -6, 26), foot = mk('f', 40, 44, 1, 0);
      n.active = false;
      this.ghosts.push({ n, foot, upper, legs, op, life: 0 });
    }

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
    AssetHub.loadSF('zhaoyun-horse', (base) => {
      if (!base) { console.warn('骑马赵云加载失败'); return; }
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 4; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 64 + 2, this.HERO_ROW * 64, 52, 22);   // 宽52含整杆枪; 高22只留头+身+枪,砍掉下面的马
        this.upperFrames.push(sf);
      }
      this.heroSp.spriteFrame = this.upperFrames[3];
    });
    // 跳跃序列帧（AI 生成 3 帧，只用 0=蹲、2=屈腿下落；192×56，每帧 64×56）
    AssetHub.loadSF('zhaoyun-jump', (base) => {
      if (!base) return;
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 3; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 64, 0, 64, 56);
        this.jumpFrames.push(sf);
      }
    });
    // 攻击序列帧（AI 生成 4 帧：举刀预备→横斩拖影→前刺→收势；256×56，每帧 64×56）
    AssetHub.loadSF('zhaoyun-attack', (base) => {
      if (!base) return;
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 4; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 64, 0, 64, 56);
        this.atkFrames.push(sf);
      }
    });
    // 跳劈序列帧（AI 生成 4 帧：腾空举枪→俯冲下刺→砸地扬尘→蹲姿收势；288×72，每帧 72×72）
    AssetHub.loadSF('zhaoyun-slam', (base) => {
      if (!base) return;
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      for (let c = 0; c < 4; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 72, 0, 72, 72);
        this.slamFrames.push(sf);
      }
    });
    // 步战赵云腿（第1行下半身；x8~40,y30~58）
    AssetHub.loadSF('zhaoyun-foot', (base) => {
      if (!base) { console.warn('步战赵云加载失败'); return; }
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
    // 地面小草株（脚面高，角色同平面，可拨动）
    this.makeGrassRow(this.node, 28, 0.07, 0.14, -8, 6, 1.0);   // 40→28：草更省 draw call/overdraw，密度基本不变

    this.fgG = this.child('foreground').addComponent(Graphics);
    // 刀气精灵（新月贴图，随挥砍旋转/淡出）：替代每帧 hArc 描边
    {
      const n = this.child('fxslash');
      n.getComponent(UITransform)!.setContentSize(128, 128);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      if (this.fxCreSF) sp.spriteFrame = this.fxCreSF;
      n.active = false;
      this.slashN = n; this.slashSp = sp;
    }
    // 跳劈落地冲击波节点（锚点 0.34 ≈ 画面里的地面线：光环沉在地上、光柱向上喷）
    {
      const n = this.child('fxslamimpact');
      const ui = n.getComponent(UITransform)!;
      ui.setContentSize(160, 136);
      ui.setAnchorPoint(0.5, 0.34);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      n.active = false;
      this.slamFxN = n; this.slamFxSp = sp;
    }
    // 天气粒子贴图化：雨/雪/落叶/浮尘全部用无缝平铺贴图层斜向滚动（每层每帧只改 1 个坐标）。
    // 外面套一层 Mask 裁切：粒子只落到地面线为止，不穿透地面。
    {
      const topH = H / 2 - this.groundY;            // 地面线以上的可见区域高
      const clip = this.child('rainclip');
      const cui = clip.getComponent(UITransform)!;
      cui.setContentSize(W, topH);
      cui.setAnchorPoint(0.5, 0.5);
      clip.setPosition(0, this.groundY + topH / 2, 0);
      clip.addComponent(Graphics);                  // Mask 的 stencil 载体
      const mask = clip.addComponent(Mask);
      mask.type = Mask.Type.GRAPHICS_RECT;
      const baseY = -(this.groundY + topH / 2);     // 世界(0,0) 在 clip 坐标系中的 y
      // kind: rain/snow/leaf 跟天气开关；mote(氛围浮尘) 全天常开、按时段染色
      // tw/th = 贴图周期：越大重复越不明显（雪/叶/尘用 384×512 大周期，避免排成行）
      const defs = [
        { kind: 'rain', res: 'fx-rain-far', vx: -267, vy: -930, sway: 0, tw: 192, th: 384 },
        { kind: 'rain', res: 'fx-rain-near', vx: -452, vy: -1575, sway: 0, tw: 192, th: 384 },
        { kind: 'snow', res: 'fx-snow-far', vx: -10, vy: -70, sway: 22, tw: 384, th: 512 },
        { kind: 'snow', res: 'fx-snow-near', vx: -20, vy: -130, sway: 34, tw: 384, th: 512 },
        { kind: 'leaf', res: 'fx-leaf-fall-far', vx: -30, vy: -48, sway: 26, tw: 384, th: 512 },
        { kind: 'leaf', res: 'fx-leaf-fall-near', vx: -55, vy: -85, sway: 34, tw: 384, th: 512 },
        { kind: 'mote', res: 'fx-mote', vx: -7, vy: -5, sway: 18, tw: 384, th: 512 },
      ];
      let ph = 0;
      for (const d of defs) {
        const n = new Node('wx-' + d.res);
        n.layer = this.node.layer; n.parent = clip;
        const ui = n.addComponent(UITransform);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.TILED;
        const op = d.kind === 'mote' ? n.addComponent(UIOpacity) : null;   // 浮尘全局呼吸
        n.active = false;
        const rec = { n, sp, op, kind: d.kind, vx: d.vx, vy: d.vy, sway: d.sway, ph: (ph += 2.1), ox: 0, oy: 0, tw: d.tw, th: d.th, by: baseY };
        AssetHub.loadSF(d.res, (sf) => {
          if (!sf) return;
          (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
          sp.spriteFrame = sf;
          ui.setContentSize(DESIGN_W + rec.tw * 2, DESIGN_H + rec.th * 2);   // 比屏大一圈，滚动取模不露边
          if (rec.kind === 'mote') { n.active = true; this.tintMoteLayers(); }
          else if (this.weatherKind() === rec.kind) n.active = true;
        });
        this.rainNodes.push(rec);
      }
    }
    // 辉光层：加法混合，让亮元素(刀气/剑气/金币/火)真正发光
    this.glowG = this.child('glow').addComponent(Graphics);
    (this.glowG as any).srcBlendFactor = gfx.BlendFactor.SRC_ALPHA;
    (this.glowG as any).dstBlendFactor = gfx.BlendFactor.ONE;
    // 前景剪影层（保留空节点）
    this.fgSilG = this.child('fgsil').addComponent(Graphics);
    // 底部前景带 = 会动的叶片元件（替代静态前景图）：密排成带、绕叶柄摆、雨天被雨滴敲击
    {
      const leafSizes: [number, number][] = [[223, 340], [349, 340], [291, 340]];
      const LEAF_N = 9;                          // 叶片数（原 15→9）：大贴图 overdraw，减到 9
      const leafSpan = DESIGN_W + 320;           // 与 updateFgLeaves 的 span 一致
      for (let i = 0; i < LEAF_N; i++) {
        const n = new Node('fgleaf' + i); n.layer = this.node.layer; n.parent = this.node;
        const kind = i % 3;
        const u = n.addComponent(UITransform);
        u.setContentSize(leafSizes[kind][0], leafSizes[kind][1]);
        u.setAnchorPoint(0.5, 0.04);   // 锚在叶柄根部 → 绕柄旋转
        const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const sc = (1.15 + ((i * 37) % 60) / 100) * (i % 2 ? -1 : 1);   // 随机大小+镜像，密排成带
        n.setScale(sc, Math.abs(sc), 1);
        n.active = false;
        const kk = kind;
        AssetHub.loadSF(`fg-leaf-${kk}`, (sf) => {
          if (!sf) return; sp.spriteFrame = sf; n.active = true;
        });
        this.fgLeaves.push({
          n, lx: i * (leafSpan / LEAF_N) + ((i * 53) % 46),   // 间距随数量自适应 → 少了也铺满整条
          by: -DESIGN_H / 2 - 30 - ((i * 41) % 46),   // 贴屏幕底边，叶冠向上探出
          ph: i * 1.7, ang: 0, vel: 0, hitCd: Math.random() * 2,
        });
      }
      // 叶面水花层（建在叶片之后 = 画在叶片之上）
      const lfx = new Node('leaffx'); lfx.layer = this.node.layer; lfx.parent = this.node;
      lfx.addComponent(UITransform);
      this.leafFxG = lfx.addComponent(Graphics);
    }

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

    // 性能调试：屏上实时 FPS + 存活敌人数（发布前把 SHOW_FPS 改回 false）
    if (this.SHOW_FPS) {
      this.fpsLbl = this.makeLabel('FPS --', -W / 2 + 90, H / 2 - 150, 28, new Color(120, 255, 140));
    }

    this.zoneLbl = this.makeLabel('', 0, H / 2 - 130, 30, new Color(255, 235, 190));
    this.zoneLbl.node.active = false;   // 关数提示已隐藏（换关横幅仍会报关数）
    this.scoreLbl = this.makeLabel('', 0, H / 2 - 172, 28, new Color(255, 240, 200));
    this.scoreLbl.node.active = false;   // 得分/血量文字已隐藏（血条仍在头顶）
    this.coinLbl = this.makeLabel('', 241, H / 2 - 71, 24, new Color(255, 224, 120));   // 顶部金币徽章上的数字

    // 主角头像（AI 像素画方形头像，血条左端；方形金框画在 drawHeroHp 里）
    {
      const avN = new Node('avatar'); avN.layer = this.node.layer; avN.parent = this.node;
      const au = avN.addComponent(UITransform); au.setAnchorPoint(0.5, 0.5); au.setContentSize(52, 52);
      const asp = avN.addComponent(Sprite); asp.sizeMode = Sprite.SizeMode.CUSTOM;
      avN.setPosition(-267, H / 2 - 69, 0);
      AssetHub.loadSF('avatar-zhaoyun', (sf) => {
        if (!sf) return;
        (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
        asp.spriteFrame = sf;
      });
    }
    this.comboLbl = this.makeLabel('', 0, H / 2 - 245, 34, new Color(255, 180, 90));
    this.comboLbl.node.active = false;
    this.hintLbl = this.makeLabel('', 0, H / 2 - 210, 22, new Color(200, 200, 210));
    this.hintLbl.node.active = false;   // 操作提示已隐藏

    // 「前进 →」提示（清关后出现，update 里做缩放呼吸）
    this.arrow = this.makeLabel('前进 →', W / 2 - 130, 70, 42, new Color(255, 240, 150)).node;   // 取 node 才能真正显隐
    this.arrow.active = false;

    // 阵亡灰化遮罩（盖住战场与 HUD；banner/按钮在其上）
    this.deadOverlay = this.child('deadover');
    {
      const dg = this.deadOverlay.addComponent(Graphics);
      dg.fillColor = new Color(120, 120, 126, 120); dg.rect(-W / 2, -H / 2, W, H); dg.fill();   // 整体压灰(去色感)
      // 电影暗角：四边各画若干细带，边缘最深 → 向内淡出为 0（各边深度均小于半屏，绝不过中线重叠）
      const bands = 14, dx = W * 0.26 / bands, dy = H * 0.20 / bands;
      for (let i = 0; i < bands; i++) {
        const a = Math.round(85 * ((bands - i) / bands));   // 越靠边(i小)越深
        dg.fillColor = new Color(24, 9, 11, a);
        dg.rect(-W / 2 + i * dx, -H / 2, dx + 1, H); dg.fill();            // 左
        dg.rect(W / 2 - (i + 1) * dx, -H / 2, dx + 1, H); dg.fill();       // 右
        dg.rect(-W / 2, -H / 2 + i * dy, W, dy + 1); dg.fill();            // 底
        dg.rect(-W / 2, H / 2 - (i + 1) * dy, W, dy + 1); dg.fill();       // 顶
      }
      this.deadOverlayOp = this.deadOverlay.addComponent(UIOpacity);
      this.deadOverlay.active = false;
    }

    this.banner = this.child('banner');
    this.banner.setPosition(0, 90, 0);
    this.bannerLbl = this.addLabelTo(this.banner, '', 54, new Color(255, 120, 110));
    this.bannerOp = this.banner.addComponent(UIOpacity);
    this.banner.active = false;

    // 关卡开场大字（拍下来再淡出）
    this.zoneIntroLbl = this.makeLabel('', 0, 150, 64, new Color(255, 224, 130));
    this.zoneIntroOp = this.zoneIntroLbl.node.addComponent(UIOpacity);
    this.zoneIntroLbl.node.active = false;

    const by = -H / 2 + 120;
    // —— 圆形操控钮（左：前进/跳；右：攻击大钮 + 剑气小钮）——
    const tapFx = (n: Node, cb: () => void) => {
      n.on(Node.EventType.TOUCH_START, () => n.setScale(0.9, 0.9, 1), this);
      const up = () => { tween(n).to(0.05, { scale: new Vec3(1.08, 1.08, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start(); };
      n.on(Node.EventType.TOUCH_END, () => { up(); cb(); }, this);
      n.on(Node.EventType.TOUCH_CANCEL, up, this);
    };
    // 图标透明度：与按钮主体同步（乘进颜色 alpha）
    const ia = (v: number) => Math.round(v * this.CTRL_ALPHA);

    // —— 左手：虚拟摇杆（手机常用：按住左侧任意处拖动，左右滑动控制前进/后退）——
    this.setupJoystick(-236, by + 18);

    // —— 右手：攻击大钮 + 技能扇形（剑气/跳环绕）——
    const atk = this.makeCircleBtn('atk', 268, by, 82, [152, 58, 52], (g, r) => {
      g.lineCap = Graphics.LineCap.ROUND;
      g.strokeColor = new Color(238, 243, 250, ia(250)); g.lineWidth = 9;     // 刀刃
      g.moveTo(-r * 0.14, -r * 0.14); g.lineTo(r * 0.44, r * 0.44); g.stroke();
      g.strokeColor = new Color(255, 214, 120, ia(250)); g.lineWidth = 5;     // 护手
      g.moveTo(-r * 0.02, -r * 0.32); g.lineTo(-r * 0.32, -r * 0.02); g.stroke();
      g.strokeColor = new Color(96, 62, 40, ia(255)); g.lineWidth = 7;        // 刀柄
      g.moveTo(-r * 0.2, -r * 0.2); g.lineTo(-r * 0.42, -r * 0.42); g.stroke();
    });
    tapFx(atk, () => this.heroSwing());
    // 剑气（攻击左侧偏上）：青白新月波
    const spc = this.makeCircleBtn('spc', 132, by + 52, 56, [54, 102, 138], (g, r) => {
      g.strokeColor = new Color(160, 238, 255, ia(255)); g.lineWidth = 6;
      hArc(g, -r * 0.1, 0, r * 0.42, -1.15, 1.15, 12); g.stroke();
      g.strokeColor = new Color(240, 252, 255, ia(255)); g.lineWidth = 3;
      hArc(g, -r * 0.1, 0, r * 0.26, -0.95, 0.95, 10); g.stroke();
    });
    tapFx(spc, () => this.heroSpecial());
    // 剑气冷却扇形遮罩（子节点，每帧重画）
    {
      const cdN = new Node('spccd'); cdN.layer = this.node.layer; cdN.parent = spc;
      cdN.addComponent(UITransform);
      this.spcCdG = cdN.addComponent(Graphics);
    }
    // 跳：不再单独设键 —— 摇杆上推即起跳（见 setupJoystick）

    // 「重来」：超链接式文字（下划线），点击重开
    {
      const n = this.child('btn-restart');
      n.setPosition(0, -20, 0);   // 紧跟「阵亡」大字下方
      n.getComponent(UITransform)!.setContentSize(220, 90);   // 点击热区比文字大
      this.addLabelTo(n, '重来', 46, new Color(150, 200, 255));
      // 下划线（单独子节点画，避免和 Label 同节点冲突）
      const un = new Node('underline'); un.layer = this.node.layer; un.parent = n;
      un.addComponent(UITransform);
      const ug = un.addComponent(Graphics);
      ug.strokeColor = new Color(150, 200, 255, 220); ug.lineWidth = 3;
      ug.moveTo(-50, -30); ug.lineTo(50, -30); ug.stroke();
      this.restartOp = n.addComponent(UIOpacity);
      tapFx(n, () => this.startGame());
      this.restartBtn = n;
    }
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
    // this.scheduleOnce(() => this.showZoneIntro('第 1 关', new Color(255, 224, 130)), 0.1);   // 关数大字已关闭
    this.camX = 0; this.zone = 0; this.zoneState = 'fight'; this.targetCam = 0;
    this.curBiome = -1; this.transActive = false; this.applyBiome(0);   // 复位背景组到第一组
    this.preloadAllBiomes();   // 预载各组，走路换景才有得滑
    this.setWeather(this.weatherFor(0));   // 开局天气
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
    this.stains = []; this.stuckArrows = []; this.stepT = 0;   // 清战场残留
    this.shockT = 0; this.slowMo = 0; this.node.setScale(1, 1, 1);   // 复位特效/慢动作
    this.snowAcc = 0; this.stormK = 0;   // 积雪/乌云清零
    this.hpLag = 100;   // 血条残影复位
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
    this.deadOverlay.active = false;   // 撤掉阵亡灰化
    this.deadRedT = 0; this.deadT2 = 0; this.slowMoT = 0;   // 复位阵亡演出
  }

  private waveCount(zone: number): number { return this.ZONE_PLAN[Math.min(zone, this.ZONE_PLAN.length - 1)].count; }
  private theme(): Theme { return this.THEMES[this.zone % this.THEMES.length]; }
  private timeOfDay() { return this.zonePlan().night ? this.TIMES[3] : this.TIMES[this.zone % this.TIMES.length]; }   // 夜战关强制夜晚
  private sX(wx: number): number { return wx - this.camX; }   // 世界→屏幕

  // 角色环境光色：清晨偏暖金、黄昏偏橙（夜晚保持原色，不压暗角色）
  // 按关缓存：时段/界色都由 zone 决定，同一关内直接返回缓存对象（每帧零分配）
  private charTint(): Color {
    if (this._charTintZone === this.zone) return this._charTintC;
    this._charTintZone = this.zone;
    let r = 255, g = 255, b = 255;
    switch (this.timeOfDay().name) {
      case '清晨': r = 255; g = 246; b = 226; break;
      case '黄昏': r = 255; g = 226; b = 200; break;
    }
    const rc = this.realmOf(this.zone).char;   // 叠加界色（地府发青 / 天庭鎏金）
    this._charTintC.set(Math.round(r * rc[0] / 255), Math.round(g * rc[1] / 255), Math.round(b * rc[2] / 255), 255);
    return this._charTintC;
  }

  /** 背景视差层的界染色（每帧套到 4 层瓦片上；人间=纯白不改色） */
  private applyRealmBgTint() {
    const rb = this.realmOf(this.zone).bg;
    if (this.bgTintRef === rb) return;   // 引用比较（数组来自 REALMS 常量，不再每帧 join 字符串）
    this.bgTintRef = rb;
    const c = new Color(rb[0], rb[1], rb[2], 255);
    for (const L of this.layers) for (const n of L.tiles) {
      const sp = n.getComponent(Sprite); if (sp) sp.color = c;
    }
  }

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
    this.lastRealDt = dt;   // 真实帧间隔（未 clamp/未慢动作缩放）——给 FPS 统计用
    dt = Math.min(dt, 0.05);
    if (this.deadRedT > 0) this.deadRedT -= dt;
    if (this.over && this.hero.state === 'dead') this.deadT2 += dt;
    if (this.slowMoT > 0) { this.slowMoT -= dt; dt *= 0.35; }   // 慢动作(胜利/坠落)
    this.animT += dt;

    // 性能显示：每 0.5s 刷新一次 FPS + 存活敌人数（用真实帧间隔，未受慢动作缩放）
    if (this.fpsLbl) {
      this.fpsAcc += this.lastRealDt; this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        const fps = Math.round(this.fpsFrames / this.fpsAcc);
        let alive = 0; for (const m of this.monsters) if (m.state !== 'dead') alive++;
        this.fpsLbl.string = `FPS ${fps}  敌 ${alive}`;
        this.fpsLbl.color = new Color(fps >= 50 ? 120 : 255, fps >= 50 ? 255 : fps >= 30 ? 200 : 90, fps >= 50 ? 140 : 90, 255);
        this.fpsAcc = 0; this.fpsFrames = 0;
      }
    }

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
    this.lastDt = dt;
    // stepMotes 已停用：浮尘改为 fx-mote 贴图层（updateWeatherLayers 里滚动+呼吸）
    this.stepWeather(dt);
    this.updateWeatherLayers(dt);   // 天气贴图层滚动（雨移动快，保持满帧才顺滑；本身只有几次赋值）
    // 降频更新：纯氛围动画隔帧跑（30Hz，dt×2 补偿时间步长）——视觉无感，这一组 CPU 直接砍半
    this.ambiOdd = !this.ambiOdd;
    if (this.ambiOdd) {
      const dt2 = dt * 2;
      this.updateFgLeaves(dt2);     // 前景叶片（摇曳/雨打）
      this.updateNearGrass(dt2);    // 地面小草株（风摆/拨草）
      this.stepCritters(dt2);       // 小动物（蝴蝶/小鸟/兔子）
      this.drawLeafSplashes(dt2);   // 叶面大水花（自带图层，跳帧时保留上一帧画面）
    }
    if (this.slamBoltT > 0) this.slamBoltT -= dt;   // 跳劈闪电衰减
    if (this.slamFxT > 0) this.slamFxT -= dt;       // 落地冲击波序列帧计时
    if (this.shockT > 0) this.shockT -= dt;         // Boss 冲击波衰减
    // 掉血残影缓慢追上当前血量
    const hpN = Math.max(0, this.hero ? this.hero.hp : 0);
    this.hpLag = this.hpLag > hpN ? Math.max(hpN, this.hpLag - dt * 42) : hpN;
    this.updateSkillCd();   // 剑气冷却环

    // 主角平滑速度（披风/盔缨滞后拖拽）
    if (this.hero) {
      const hvx = (this.hero.x - this.prevHeroX) / Math.max(dt, 1e-4);
      this.prevHeroX = this.hero.x;
      this.heroVx += (hvx - this.heroVx) * Math.min(1, dt * 8);
    }

    // 屏幕震动（整块偏移，短促衰减）
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeMag * Math.max(0, this.shakeT / 0.18);
      this.node.setPosition((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2, 0);
      if (this.shakeT <= 0) { this.shakeMag = 0; this.node.setPosition(0, 0, 0); }
    }

    // 顿帧：命中瞬间全场定格几帧（打击感灵魂）
    if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); this.draw(); return; }

    // 击杀慢动作（仅 Boss）：0.3 倍速 + 镜头微推近；末段速度平滑升回 1，不突兀
    if (this.slowMo > 0) {
      this.slowMo -= dt;
      const k = this.slowMo > 0.25 ? 0.3 : 0.3 + 0.7 * (1 - Math.max(0, this.slowMo) / 0.25);
      dt *= k;
      const z = 1 + 0.05 * Math.min(1, this.slowMo / 0.3);
      this.node.setScale(z, z, 1);
      if (this.slowMo <= 0) this.node.setScale(1, 1, 1);
    }

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
    this.stepGhosts(dt);
    this.stepStains(dt);
    this.stepFlashes(dt);
    this.stepDmgNums(dt);
    this.draw();

    const t = this.theme();
    this.zoneLbl.string = `第 ${this.zone + 1} 关 · ${t.name} · ${this.timeOfDay().name}`;
    this.scoreLbl.string = `得分 ${this.score}　❤ ${Math.max(0, Math.ceil(this.hero.hp))}`;
    this.coinLbl.string = `${this.coins}`;
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
        this.setWeather(this.weatherFor(this.zone));   // 新关天气
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
      if (this.waveRemaining === 0 && alive === 0) this.zoneState = 'cleared';   // 过关音效已去掉
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

    // 落地缓冲期间锁移动（蹲帧不滑步）
    const mv = h.jmpLand > 0 ? 0 : (this.rightHeld ? 1 : 0) + (this.leftHeld ? -1 : 0);
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
      // 天气联动脚步：雪天留脚印、雨天踩水花
      if (h.jumpY <= 0 && !h.jumping) {
        this.stepT -= dt;
        if (this.stepT <= 0) {
          this.stepT = 0.17; this.stepPar = -this.stepPar;
          if (this.weather === '雪') this.addStain(h.x - mv * 8, this.groundY + this.stepPar * 4, 5, 'foot');
          else if (this.weather === '雨') this.spawnWImpact(this.sX(h.x) + (Math.random() - 0.5) * 14, this.groundY, '雨', 0, 0, 1);
        }
      } else this.stepT = 0;
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
        this.setWeather(this.weatherFor(this.zone));   // 新关天气
        this.preloadAllBiomes();
        // 关数大字已关闭（Boss 关仍有登场演出）
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
        // 兔子也能打：一刀带走，掉 2 金币（彩蛋小奖励）
        for (const c of this.critters) {
          if (c.kind !== 2 || c.state === 0 || c.y > 70) continue;
          const dxc = c.x - h.x;
          if (Math.abs(dxc) <= mp.range + 20 && (mp.both || dxc * h.dir > -30)) {
            this.spawnHitFlash(this.sX(c.x), this.groundY + 24);
            this.spawnDust(c.x, this.groundY + 8, 4, 150);
            this.spawnBlood(c.x, this.groundY + 26, dxc >= 0 ? 1 : -1, 6);
            for (let k = 0; k < 2; k++) this.drops.push({ x: c.x + (Math.random() - 0.5) * 30, y: this.groundY + 40, vy: 150 + Math.random() * 90, life: 0, flying: false, sx: 0, sy: 0 });
            AudioMgr.inst.play('hit');
            c.state = 0; c.n.active = false; c.wait = 18 + Math.random() * 16;   // 一段时间后再来一只
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

    // 跳劈/普通跳跃：随跳跃高度整体放大，最高点约 1.5 倍，落地后恢复（按各自最大高度归一）
    if (h.jumpY > 0 && (h.jumping || h.atkType === 2)) {
      const maxH = h.jumping
        ? this.JUMP_MOVE_VY * this.JUMP_MOVE_VY / (2 * this.GRAVITY_MOVE)
        : this.JUMP_VY * this.JUMP_VY / (2 * this.GRAVITY_J);
      h.scaleBoost = 1 + 0.5 * Math.min(1, h.jumpY / maxH);
    } else h.scaleBoost = 1;
  }

  // 跳劈落地冲击：以主角为中心两侧 AoE + 冲击波火花
  private slamHit() {
    const h = this.hero;
    const mp = this.moveParams(2);
    for (let k = 0; k < 9; k++) this.sparks.push({ x: h.x + (k - 4) * 22, y: this.groundY + 6, life: 0, max: 0.28 });
    this.addShake(18); this.addHitStop(0.06);   // 跳劈落地：大震 + 顿帧
    this.spawnDust(this.hero.x, this.groundY + 4, 10, 300);   // 跳劈落地大尘圈
    this.genSlamBolt(this.sX(h.x), this.groundY + 6);   // 天降一道闪电劈在落点
    this.slamFxT = this.SLAM_FX_DUR; this.slamFxX = h.x;   // 落地冲击波序列帧开播
    // 冲击波掀草：范围内草株向外猛压（弹簧会自己甩回震荡），并溅起草屑
    {
      const hx = this.sX(h.x);
      const span = DESIGN_W + 260;
      for (const G of this.nearGrass) {
        if (G.fly !== 0) continue;
        const gx = (((G.lx - this.camX * G.par) % span) + span) % span - span / 2;
        const d = gx - hx;
        if (Math.abs(d) < 180) {   // 近处：整株连根掀飞 → 消失
          G.fly = 1;
          G.fvx = (d >= 0 ? 1 : -1) * (160 + Math.random() * 220);
          G.fvy = 460 + Math.random() * 300;
          G.spin = (d >= 0 ? 1 : -1) * (260 + Math.random() * 240);
        } else if (Math.abs(d) < 280) {   // 远处：压弯震荡
          const k = 1 - Math.abs(d) / 280;
          G.vel += (d >= 0 ? 1 : -1) * (280 + Math.random() * 140) * k;
        }
      }
      for (let i = 0; i < 12; i++) {
        const dir = i % 2 ? 1 : -1;
        this.grassBits.push({
          x: h.x + dir * (20 + Math.random() * 90), y: this.groundY + 4,
          vx: dir * (120 + Math.random() * 260), vy: 260 + Math.random() * 320,
          ang: Math.random() * 6.28, va: (Math.random() - 0.5) * 18,
          life: 0, max: 0.55 + Math.random() * 0.3,
        });
      }
    }
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
  // 主角攻击残影：挥砍/跳劈期间每隔几帧留一个冷青虚影，快速渐隐
  private stepGhosts(dt: number) {
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dt;
      g.op.opacity = Math.max(0, Math.round(130 * (g.life / this.GHOST_LIFE)));
      if (g.life <= 0) g.n.active = false;
    }
    const h = this.hero;
    const active = h.state !== 'dead' && (h.attacking
      || (h.jumping && h.jumpY > 2)                                                             // 普通跳跃腾空残影
      || (h.atkType === 2 && !h.jumping && (h.jumpY > 2 || h.landT > this.LAND_DUR * 0.6)));    // 跳劈残影
    if (!active || !this.heroNode.active) { this.ghostCd = 0; return; }
    this.ghostCd -= dt;
    if (this.ghostCd > 0) return;
    this.ghostCd = 0.055;
    const g = this.ghosts.find(x => x.life <= 0);
    if (!g) return;
    g.life = this.GHOST_LIFE;
    g.n.active = true;
    g.n.setPosition(this.heroNode.position);
    g.n.setScale(this.heroNode.scale);
    g.n.angle = this.heroNode.angle;
    g.op.opacity = 130;
    // 镜像当前可见的部件与帧
    g.foot.node.active = this.footNode.active;
    if (this.footNode.active) g.foot.spriteFrame = this.footSp.spriteFrame;
    g.upper.node.active = this.heroSp.node.active;
    if (this.heroSp.node.active) g.upper.spriteFrame = this.heroSp.spriteFrame;
    g.legs.node.active = this.legsSp.node.active;
    if (this.legsSp.node.active) g.legs.spriteFrame = this.legsSp.spriteFrame;
  }

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
      g.strokeColor = this._scratchC.set(255, 255, 255, Math.round(255 * a));
      g.lineWidth = 5 * (1 - p * 0.5);
      const r = 20 + p * 46;
      for (let k = 0; k < 6; k++) {
        const ang = k * Math.PI / 3;
        g.moveTo(sx + Math.cos(ang) * r * 0.35, sy + Math.sin(ang) * r * 0.35);
        g.lineTo(sx + Math.cos(ang) * r, sy + Math.sin(ang) * r);
      }
      g.stroke();
      // 中心亮核
      g.fillColor = this._scratchC.set(255, 255, 255, Math.round(230 * a));
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
      // 击杀慢动作：只在击杀 Boss 时演出（普通清波太频繁太短，读起来像卡顿，已去掉）
      if (m.kind === 'boss') this.slowMo = 0.75;
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
    const sy = this.groundY + m.lane + 48 * m.scale;
    const dxv = h.x - m.x, dyv = (this.groundY + 50) - sy, L = Math.hypot(dxv, dyv) || 1;   // 瞄主角胸膛
    const sp = 300;   // 箭速（放慢，更好躲）
    this.arrows.push({ x: m.x, y: sy, vx: dxv / L * sp, vy: dyv / L * sp, life: 0 });
    AudioMgr.inst.play('arrow', 0.7);
  }

  private stepArrows(dt: number) {
    const h = this.hero;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life += dt; a.x += a.vx * dt; a.y += a.vy * dt;
      a.vy -= 70 * dt;   // 更轻微的下坠 → 飞得更远才插地
      const hy = this.groundY + 50 + h.jumpY;   // 胸膛高度
      if (Math.abs(a.x - h.x) < 30 && Math.abs(a.y - hy) < 55) {
        this.hurtHero(6 + Math.floor(this.zone * 0.5), a.x);
        this.arrows.splice(i, 1); continue;
      }
      if (a.y <= this.groundY + 2 && a.vy < 0) {   // 落地 → 插在地上（战场残留）
        this.stuckArrows.push({ x: a.x, y: this.groundY + 2, ang: Math.atan2(a.vy, a.vx), life: 0, max: 8 });
        if (this.stuckArrows.length > 24) this.stuckArrows.shift();
        this.arrows.splice(i, 1); continue;
      }
      if (a.life > 4.5) this.arrows.splice(i, 1);
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
      lbl.color = this._scratchC.set(col.r, col.g, col.b, Math.round(255 * Math.max(0, 1 - d.life / d.max)));
      if (d.life >= d.max) { d.n.active = false; this.dmgPoolFree.push(d.n); this.dmgNums.splice(i, 1); }
    }
  }

  private drawArrows(g: Graphics) {
    for (const a of this.arrows) {
      const sx = this.sX(a.x), sy = a.y, L = Math.hypot(a.vx, a.vy) || 1;
      const ux = a.vx / L, uy = a.vy / L, px = -uy, py = ux;   // 方向 + 垂直
      const len = 32, bx = sx - ux * len, by = sy - uy * len;  // 箭尾
      // 运动拖尾（暖黄亮streak）
      g.strokeColor = this._scratchC.set(255, 205, 110, 95); g.lineWidth = 8;
      g.moveTo(sx - ux * 66, sy - uy * 66); g.lineTo(sx, sy); g.stroke();
      // 深色描边（衬托，任何背景都清楚）
      g.strokeColor = this._scratchC.set(38, 28, 18, 255); g.lineWidth = 6;
      g.moveTo(bx, by); g.lineTo(sx, sy); g.stroke();
      // 亮木色杆
      g.strokeColor = this._scratchC.set(228, 192, 122, 255); g.lineWidth = 3;
      g.moveTo(bx, by); g.lineTo(sx, sy); g.stroke();
      // 银白箭头三角
      g.fillColor = this._scratchC.set(236, 242, 252, 255);
      g.moveTo(sx, sy);
      g.lineTo(sx - ux * 13 + px * 6.5, sy - uy * 13 + py * 6.5);
      g.lineTo(sx - ux * 13 - px * 6.5, sy - uy * 13 - py * 6.5);
      g.close(); g.fill();
      // 红色尾羽
      g.strokeColor = this._scratchC.set(214, 62, 50, 255); g.lineWidth = 3;
      g.moveTo(bx, by); g.lineTo(bx + ux * 9 + px * 7, by + uy * 9 + py * 7);
      g.moveTo(bx, by); g.lineTo(bx + ux * 9 - px * 7, by + uy * 9 - py * 7);
      g.stroke();
    }
  }

  private drawDrops(g: Graphics) {
    for (const d of this.drops) {
      let sx: number, sy: number, r = 13;
      if (d.flying) { sx = d.sx; sy = d.sy; r = 11; }
      else { sx = this.sX(d.x); sy = d.y + Math.sin(d.life * 7) * 3 + 15; }
      g.fillColor = this._scratchC.set(90, 62, 16, 255); g.circle(sx, sy, r + 2); g.fill();        // 暗边
      g.fillColor = this._scratchC.set(255, 200, 55, 255); g.circle(sx, sy, r); g.fill();          // 金
      g.strokeColor = this._scratchC.set(160, 108, 20, 255); g.lineWidth = 2;                       // ¥ 竖纹
      g.moveTo(sx, sy - r * 0.5); g.lineTo(sx, sy + r * 0.5); g.stroke();
      g.fillColor = this._scratchC.set(255, 240, 160, 255); g.circle(sx - r * 0.32, sy - r * 0.32, r * 0.34); g.fill(); // 高光
    }
  }

  private stepMonsters(dt: number) {
    const h = this.hero;
    if (this.arrowGap > 0) this.arrowGap -= dt;   // 全局箭间隔倒计时
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
          // 自身冷却到 + 全局箭间隔到 → 才放箭（多弓手也不会同时糊脸，留出跳跃空档）
          if (m.atkCd <= 0 && this.arrowGap <= 0) { m.atkCd = 2.8; m.swing = 0; this.shootArrow(m); this.arrowGap = this.ARROW_GAP; }
        }
      } else if (adx <= (m.kind === 'boss' ? 120 : 56)) {
        m.state = 'attack';
        if (!m.attacking && m.atkCd <= 0) { m.attacking = true; m.struck = false; m.swing = 0; m.atkCd = m.kind === 'boss' ? 1.4 : 1.0; }
        if (m.attacking) {
          m.swing = Math.min(1, m.swing + dt * 2.6);   // 起手稍慢 → 预警感叹号看得清、来得及应对
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
        this.shockT = 0.38; this.shockX = tx;   // 冲击波环贴图炸开
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

  // Boss 法术贴图编排：法阵双层反向旋转+充能渐强+临爆闪烁；冲击波环炸开放大淡出
  private updateBossFx() {
    const b = this.monsters.find(m => m.kind === 'boss' && m.state !== 'dead');
    const st = b ? (b.slamState || 'none') : 'none';
    const R = this.BOSS_SLAM_R;
    // 法阵（蓄力）
    if (this.fxReady && b && st === 'windup') {
      const p = 1 - (b.slamT || 0) / this.BOSS_SLAM_WINDUP;   // 0→1 充能
      const cx = this.sX(b.slamX || b.x), cy = this.groundY + b.lane + 2;
      const grow = 0.5 + 0.5 * p;                              // 随充能变大
      const pulse = 1 + 0.04 * Math.sin(this.animT * 7);       // 呼吸
      const flick = p > 0.78 ? (Math.sin(this.animT * 46) > 0 ? 1 : 0.5) : 1;   // 临爆高频闪
      const base = (R * 2.6) / 512;
      const cfg = [
        { s: 1.0, rot: this.animT * 40 },      // 外层 顺时针
        { s: 0.58, rot: -this.animT * 64 },    // 内层 逆时针（交错流动感）
      ];
      for (let i = 0; i < 2; i++) {
        const r = this.fxRune[i];
        r.n.active = true;
        r.n.setPosition(cx, cy, 0);
        const s = base * grow * pulse * cfg[i].s;
        r.n.setScale(s, s * 0.18, 1);          // 父节点压得更扁=平铺地面透视
        r.c.angle = cfg[i].rot;                // 子节点旋转=盘面自转
        r.op.opacity = Math.round((110 + 145 * p) * flick);
      }
    } else {
      for (const r of this.fxRune) r.n.active = false;
    }
    // 冲击波环（砸下）
    if (this.fxShock) {
      if (this.shockT > 0 && this.fxShock.c.getComponent(Sprite)!.spriteFrame) {
        const q = 1 - this.shockT / 0.38;      // 0→1 扩散
        const s = ((R * 3.0) / 512) * (0.3 + 1.7 * q);
        this.fxShock.n.active = true;
        this.fxShock.n.setPosition(this.sX(this.shockX), this.groundY + 2, 0);
        this.fxShock.n.setScale(s, s * 0.18, 1);
        this.fxShock.op.opacity = Math.round(255 * (1 - q) * (1 - q));   // 快速淡出
      } else this.fxShock.n.active = false;
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
      if (this.fxReady) {
        // 贴图法阵接管视觉（updateBossFx）；这里只垫一层淡淡的危险红底，保证可读性
        g.fillColor = this._scratchC.set(90, 12, 8, Math.round(36 + 30 * p)); ell(R); g.fill();
        return;
      }
      const pulse = 0.5 + 0.5 * Math.sin(p * 26);             // 呼吸闪
      // ① 分层暗红危险底（外淡→内浓，做出"渐变/凹陷"质感）
      g.fillColor = this._scratchC.set(60, 8, 6, 60); ell(R); g.fill();
      g.fillColor = this._scratchC.set(120, 18, 12, 70); ell(R * 0.82); g.fill();
      g.fillColor = this._scratchC.set(180, 34, 22, 80); ell(R * 0.6); g.fill();
      // ② 内芯蓄能辉光（随充能变亮变大）
      g.fillColor = this._scratchC.set(255, 110, 60, Math.round((70 + 120 * p) * (0.7 + 0.3 * pulse)));
      ell(R * (0.18 + 0.42 * p)); g.fill();
      // ③ 立体亮边：先粗暗底边，再细亮边压上 → 有厚度
      g.strokeColor = this._scratchC.set(70, 10, 8, 200); g.lineWidth = 7; ell(R); g.stroke();
      g.strokeColor = this._scratchC.set(255, 90, 66, Math.round(180 + 60 * pulse)); g.lineWidth = 3; ell(R * 0.985); g.stroke();
      // ④ 向心瞄准环：从外向中心收拢（读秒感），越收越亮
      const rc = R * (1 - 0.86 * p);
      g.strokeColor = this._scratchC.set(255, 226, 150, Math.round(120 + 130 * p)); g.lineWidth = 3; ell(rc); g.stroke();
      // ⑤ 边缘警示刻度（随充能缓慢旋转）
      const N = 18, rot = p * 1.4;
      g.strokeColor = this._scratchC.set(255, 150, 90, 210); g.lineWidth = 3;
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
      g.fillColor = this._scratchC.set(40, 6, 4, Math.round(150 * a)); ell(R * 0.7); g.fill();
      // 冲击环（双环，向外扩散渐隐）
      g.strokeColor = this._scratchC.set(255, 240, 205, Math.round(235 * a)); g.lineWidth = 8; ell(R * (0.45 + p * 0.95)); g.stroke();
      g.strokeColor = this._scratchC.set(255, 150, 90, Math.round(200 * a)); g.lineWidth = 4; ell(R * (0.2 + p * 1.25)); g.stroke();
      // 放射裂纹
      g.strokeColor = this._scratchC.set(30, 8, 6, Math.round(220 * a)); g.lineWidth = 4;
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

  private readonly BLOOD_MAX = 90;        // 血滴总量上限（防暴血时几百滴一起画卡帧）
  private spawnBlood(x: number, y: number, dir: number, amount: number) {
    const n = Math.round(amount * 1.8);   // 小而密（原 ×4 → ×1.8：视觉仍够，量再少一截省 CPU）
    // 超上限就丢最老的血滴腾位置（先进先出），保证同屏血滴总数封顶
    const over = this.bloods.length + n - this.BLOOD_MAX;
    if (over > 0) this.bloods.splice(0, over);
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

  // ---------- 战场残留（血渍/脚印/插地箭） ----------
  private addStain(x: number, y: number, r: number, kind: string) {
    this.stains.push({ x, y, r, life: 0, max: kind === 'blood' ? 4 : 5, kind });
    if (this.stains.length > 40) this.stains.shift();   // 上限，先进先出
  }

  private stepStains(dt: number) {
    for (let i = this.stains.length - 1; i >= 0; i--) {
      const s = this.stains[i]; s.life += dt;
      if (s.life >= s.max) this.stains.splice(i, 1);
    }
    for (let i = this.stuckArrows.length - 1; i >= 0; i--) {
      const a = this.stuckArrows[i]; a.life += dt;
      if (a.life >= a.max) this.stuckArrows.splice(i, 1);
    }
  }

  // 地面积雪层：起伏雪线随积雪厚度长高（画在贴花/角色之下）
  private drawSnowGround(g: Graphics) {
    if (this.snowAcc <= 0.02) return;
    const W = DESIGN_W, gy = this.groundY, k = this.snowAcc;
    const hMax = 13 * k;
    // 雪面（顶缘起伏，随世界坐标固定 → 卷屏时雪包跟着地走）
    g.fillColor = new Color(238, 244, 252, Math.round(215 * Math.min(1, k * 1.6)));
    g.moveTo(-W / 2, gy - 26);
    for (let x = -W / 2; x <= W / 2 + 24; x += 24) {
      const wx = x + this.camX;
      const bump = 0.65 + 0.35 * Math.sin(wx * 0.045) + 0.18 * Math.sin(wx * 0.11 + 2.3);
      g.lineTo(x, gy + hMax * bump);
    }
    g.lineTo(W / 2, gy - 26); g.close(); g.fill();
    // 顶缘亮边（雪的高光）
    g.strokeColor = new Color(255, 255, 255, Math.round(160 * k)); g.lineWidth = 2;
    let first = true;
    for (let x = -W / 2; x <= W / 2 + 24; x += 24) {
      const wx = x + this.camX;
      const bump = 0.65 + 0.35 * Math.sin(wx * 0.045) + 0.18 * Math.sin(wx * 0.11 + 2.3);
      if (first) { g.moveTo(x, gy + hMax * bump); first = false; } else g.lineTo(x, gy + hMax * bump);
    }
    g.stroke();
  }

  // 地面贴花：血渍暗红、雪脚印压痕（画在角色/影子之下）
  // 地面残留缓存层：站立时最多 ~8Hz 重画；卷屏时按 6px 步进跟进（血渍/箭要跟世界坐标滚）
  private drawGroundFx() {
    this.groundFxT -= this.lastDt;
    const camStep = Math.floor(this.camX / 6);
    if (this.groundFxT > 0 && camStep === this.groundFxCam) return;
    this.groundFxT = 0.12; this.groundFxCam = camStep;
    const g = this.groundFxG;
    g.clear();
    if (this.stains.length === 0 && this.stuckArrows.length === 0 && this.snowAcc <= 0.02) return;
    this.drawSnowGround(g);
    this.drawStains(g);
  }

  // HUD 缓存层：血量/残影/Boss血按 1px 量化，变了才重画（平时零开销）
  private drawHud() {
    const p = Math.max(0, this.hero.hp / this.hero.hpMax);
    const lag = Math.max(p, this.hpLag / this.hero.hpMax);
    const boss = this.monsters.find(m => m.kind === 'boss' && m.state !== 'dead');
    // 数字哈希（血量/残影 337 级 + Boss血 517 级），不拼字符串 → 每帧零分配
    const key = (Math.round(p * 336) * 337 + Math.round(lag * 336)) * 520 + (boss ? Math.round(boss.hp / boss.hpMax * 516) : -1) + 2;
    if (key === this.hudKey) return;
    this.hudKey = key;
    const g = this.hudG;
    g.clear();
    this.drawHeroHp(g);
    this.drawBossHp(g);
  }

  private drawStains(g: Graphics) {
    for (const s of this.stains) {
      const fade = Math.min(1, (s.max - s.life) / (s.max * 0.35));   // 末段渐隐
      if (s.kind === 'blood') {
        g.fillColor = new Color(118, 22, 18, Math.round(150 * fade));
        g.ellipse(this.sX(s.x), s.y - 2, s.r * 1.6, s.r * 0.5); g.fill();
      } else {   // 雪地脚印
        g.fillColor = new Color(52, 58, 74, Math.round(90 * fade));
        g.ellipse(this.sX(s.x), s.y - 2, 6, 2.6); g.fill();
      }
    }
    // 插在地上的箭（斜插，杆+尾羽）
    for (const a of this.stuckArrows) {
      const fade = Math.min(1, (a.max - a.life) / 1.2);
      const sx = this.sX(a.x), ca = Math.cos(a.ang), sa = Math.sin(a.ang), L = 30;
      g.strokeColor = new Color(38, 28, 18, Math.round(255 * fade)); g.lineWidth = 5;
      g.moveTo(sx, a.y); g.lineTo(sx - ca * L, a.y - sa * L); g.stroke();
      g.strokeColor = new Color(228, 192, 122, Math.round(255 * fade)); g.lineWidth = 2.5;
      g.moveTo(sx, a.y); g.lineTo(sx - ca * L, a.y - sa * L); g.stroke();
      g.strokeColor = new Color(214, 62, 50, Math.round(255 * fade)); g.lineWidth = 2.5;
      const tx = sx - ca * L, ty = a.y - sa * L;
      g.moveTo(tx, ty); g.lineTo(tx + ca * 8 + sa * 6, ty + sa * 8 - ca * 6);
      g.moveTo(tx, ty); g.lineTo(tx + ca * 8 - sa * 6, ty + sa * 8 + ca * 6); g.stroke();
    }
  }

  private stepBloods(dt: number) {
    for (let i = this.bloods.length - 1; i >= 0; i--) {
      const b = this.bloods[i];
      b.life += dt;
      b.vy -= 780 * dt;                 // 重力小一点 → 更慢更飘
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y <= this.groundY && b.vy < 0) {   // 落地 → 少量留血渍（战场残留）
        if (Math.random() < 0.35) this.addStain(b.x, this.groundY + (Math.random() - 0.5) * 8, b.r * (1.1 + Math.random() * 0.9), 'blood');
        this.bloods.splice(i, 1); continue;
      }
      if (b.life >= b.max) this.bloods.splice(i, 1);
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
    AudioMgr.inst.fadeOutBgm(1.4); AudioMgr.inst.stopAmb();   // 战斗乐淡出
    AudioMgr.inst.playStinger('win', 0.85, 0.8);   // 庆祝乐淡入
    this.bannerLbl.color = new Color(255, 224, 130);
    this.bannerLbl.fontSize = 54; this.bannerLbl.lineHeight = 58;   // 恢复常规字号
    this.bannerLbl.string = `通关！  击败 Boss · 得分 ${this.score}`;
    this.banner.active = true;
    this.bannerOp.opacity = 255;
    this.restartBtn.active = true;
    this.restartOp.opacity = 255;
    this.banner.setScale(0.3, 0.3, 1);
    tween(this.banner).to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
  }

  private gameOver() {
    this.over = true;
    AudioMgr.inst.fadeOutBgm(1.6); AudioMgr.inst.stopAmb();   // 战斗乐淡出
    this.scheduleOnce(() => AudioMgr.inst.playStinger('lose', 0.8, 1.2), 2.0);   // 伤感乐延后 2s 淡入
    this.hero.state = 'dead'; this.hero.deadT = 0; this.hero.fallSign = 1;
    this.slowMoT = 2.4;               // 坠落慢动作(更久)
    this.deadRedT = 0.55;             // 受创红闪
    this.deadT2 = 0;
    this.addShake(15);
    for (let i = 0; i < 14; i++) this.spawnDust(this.hero.x + (Math.random() - 0.5) * 30, this.groundY + 6, 1, 220);   // 倒地扬尘
    // 画面变灰(渐显) + 「阵亡」大字淡入 + 「重来」延迟浮现
    this.deadOverlay.active = true;
    this.deadOverlayOp.opacity = 0;
    tween(this.deadOverlayOp).to(2.0, { opacity: 255 }).start();   // 灰罩缓缓浮现
    this.bannerLbl.color = new Color(225, 66, 58);
    this.bannerLbl.fontSize = 96; this.bannerLbl.lineHeight = 100;
    this.bannerLbl.string = '阵 亡';
    this.banner.active = true;
    this.bannerOp.opacity = 0;
    tween(this.bannerOp).delay(1.2).to(1.4, { opacity: 255 }).start();
    this.banner.setScale(0.86, 0.86, 1);
    tween(this.banner).delay(1.2).to(1.4, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
    this.restartBtn.active = true;
    this.restartOp.opacity = 0;
    tween(this.restartOp).delay(2.8).to(0.6, { opacity: 255 }).start();
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
    this.dotBegin();   // 圆点粒子精灵池开帧（尘土+血滴共用，帧末 dotEnd 关掉多余节点）
    for (const d of this.dusts) {   // 尘土（精灵池粒子）
      const a = 1 - d.life / d.max;
      this.dotDraw(this.sX(d.x), d.y, d.r * (0.7 + 0.9 * (d.life / d.max)), 168, 152, 128, Math.round(120 * a));
    }

    this.drawGroundFx();      // 地面残留缓存层：雪面/血渍/脚印/插地箭（低频重画，垫在 stage 下）
    this.drawNightLight(g);   // 夜晚：角色脚下暖光地面光斑（在角色之下）
    this.drawBacklight(g);    // 低日时段：角色背光描边（在角色之下、边缘露出）

    // 阴影垫底
    const h = this.hero;
    if (h.state !== 'dead') this.drawShadow(g, h.x, h.lane, 14, h.jumpY);   // 主角影子（步战赵云，窄）
    for (const m of this.monsters) if (m.state !== 'dead' && m.kind !== 'boss') this.drawShadow(g, m.x, m.lane, 14 * m.scale, m.jumpY);

    this.drawBossWarning(g);   // Boss 重击预警红圈（画在地面、角色之下）
    this.drawDrops(g);   // 掉落物（垫在角色后）
    // 绘制排序：复用同一个数组 + 常驻比较器（不再每帧展开新数组/新建闭包）
    const drawn = this._drawnScratch;
    drawn.length = 0;
    for (const m of this.monsters) drawn.push(m);
    drawn.sort(BattleScene._drawOrder);
    this.updateEnemySprites(drawn);   // 小怪 = 轻步兵精灵（Boss 单独用精灵）
    this.updateBossSprite();
    this.updateBossFx();              // Boss 法术贴图特效（法阵/冲击波）
    const blink = h.state !== 'dead' && h.invuln > 0 && Math.floor(h.invuln * 20) % 2 === 0;
    if (this.DISMOUNT && !blink && h.state !== 'dead') this.drawHeroLegs(g);   // 火柴腿（在上半身之后画=垫腰下）
    this.updateHeroSprite(blink);
    this.drawArrows(g);  // 敌箭（在角色前）

    // 命中火花已去掉（生成处照旧 push，但不再绘制；stepSparks 仍会清理，不会堆积）

    for (const b of this.bloods) {   // 血滴（精灵池粒子，同贴图合批 = 1 个 draw call）
      const a = Math.max(0, 1 - b.life / b.max);
      const cr = 150 + Math.round(b.shade * 90);
      this.dotDraw(this.sX(b.x), b.y, b.r * (0.5 + 0.5 * a), cr, 18 + Math.round(b.shade * 22), 24, Math.round(235 * a));
    }
    this.dotEnd();   // 关掉本帧没用到的池节点

    // 剑气波（新月贴图精灵：颜色烘进贴图，白色 tint 只控 alpha 淡出）
    let wi = 0;
    for (const w of this.waves) {
      const fx = this.waveFx(wi);
      if (!fx) break;
      wi++;
      const a = Math.max(0, 1 - w.life / w.max);
      fx.n.active = true;
      fx.n.setPosition(this.sX(w.x), w.y, 0);
      fx.n.angle = w.dir > 0 ? 0 : 180;
      fx.n.setScale(0.85, 0.85, 1);
      this._scratchC.set(255, 255, 255, Math.round(240 * a));
      fx.sp.color = this._scratchC;
    }
    for (; wi < this.wavePool.length; wi++) this.wavePool[wi].n.active = false;

    this.drawFlashes(g);   // 冲击白光（角色之上）
    // 氛围浮尘已改为 fx-mote 贴图层（常开、随时段染色），不再逐粒画
    this.drawHud();   // HUD 缓存层：血量/Boss血变了才重画（原每帧 ~25 图元 + ~25 new Color）
    // 敌人头顶血条已去掉（省每帧每敌 2 个 rect + 视觉更干净）

    this.drawFg();       // 前景遮挡 + 统一色调（独立图层）
    this.stepGrassBits(this.lastDt, this.fgG);   // 草屑（跳劈掀飞）
    this.drawSunSide(this.fgG);   // 太阳侧入光（清晨/黄昏的镜头感）
    this.drawWeather(this.fgG);   // 天气（雨/雪/落叶/余烬/闪电）叠在最前
    this.drawSlamBolt(this.fgG);  // 跳劈落地闪电
    this.updateSlamFx();          // 落地冲击波序列帧（贴图精灵，4 帧 0.34s 播完）
    this.drawGlow();              // Bloom 辉光（加法层，亮元素发光）
  }

  // 次级动作：披风 + 盔缨（画在角色身后）。核心=滞后拖拽(速度反向) + sin 抖动 → 布料感
  private drawHeroTrim(g: Graphics) {
    const h = this.hero;
    if (h.state === 'dead') return;
    const t = this.animT;
    const hx = this.sX(h.x);
    const y = this.groundY + Math.max(0, h.jumpY - Math.max(0, h.crouch) * 24);
    const back = -h.dir;                                              // 背向
    const lag = Math.max(-24, Math.min(24, -this.heroVx * 0.045));    // 移动越快拖得越开
    const amp = 1 + Math.min(1.4, Math.abs(this.heroVx) / 300);       // 跑动时抖得更欢
    const fl = (Math.sin(t * 5.3) * 3 + Math.sin(t * 8.9) * 1.6) * amp;

    // 披风（深红布片，肩部锚定、下摆飘）
    const capeD = new Color(140, 34, 36, 235), capeL = new Color(186, 58, 52, 235);
    const sx0 = hx + back * 3, sy0 = y + 63;                          // 肩
    g.fillColor = capeD;
    g.moveTo(sx0, sy0);
    g.lineTo(hx + back * 15 + lag * 0.5, y + 44 + fl * 0.5);
    g.lineTo(hx + back * 21 + lag, y + 20 + fl);
    g.lineTo(hx + back * 7 + lag * 0.6, y + 18 + fl * 0.6);
    g.close(); g.fill();
    g.strokeColor = capeL; g.lineWidth = 2;                            // 内侧亮边（体积感）
    g.moveTo(sx0, sy0 - 2);
    g.lineTo(hx + back * 12 + lag * 0.55, y + 40 + fl * 0.55);
    g.lineTo(hx + back * 17 + lag * 0.9, y + 22 + fl * 0.9); g.stroke();

    // 盔缨（头顶红缨往后飘）
    g.strokeColor = new Color(212, 50, 46, 255); g.lineWidth = 4;
    g.moveTo(hx + h.dir * 1, y + 82);
    g.lineTo(hx + back * 7 + lag * 0.4, y + 88 + fl * 0.4);
    g.lineTo(hx + back * 13 + lag * 0.7, y + 83 + fl * 0.8); g.stroke();
    g.strokeColor = new Color(238, 92, 70, 255); g.lineWidth = 2;      // 缨梢亮色
    g.moveTo(hx + back * 10 + lag * 0.55, y + 86 + fl * 0.6);
    g.lineTo(hx + back * 16 + lag * 0.85, y + 82 + fl * 0.95); g.stroke();
  }

  // 主角 = 骑马上半身(带攻击) + 步战腿：定位/翻转/选帧
  private updateHeroSprite(blink: boolean) {
    const h = this.hero;
    if (this.upperFrames.length < 4) { this.heroNode.active = false; return; }
    this.heroNode.active = !blink || h.state === 'dead';

    const sx = this.sX(h.x);
    const y = this.groundY + Math.max(0, h.jumpY - Math.max(0, h.crouch) * 24);   // 蹲姿不把脚沉到地面以下
    const hk = h.state !== 'dead' && h.hitT > 0 ? Math.min(1, h.hitT / this.HIT_DUR) : 0;
    const ang = -h.dir * 42 * hk;      // 挨揍后仰

    const S = this.SPRITE_SCALE * (h.scaleBoost || 1);
    // 次级动作：走路微颠（小弹跳），让身体"活"起来
    const bob = h.state === 'walk' && !h.jumping ? Math.abs(Math.sin(this.animT * 9)) * 2.5 : 0;
    this.heroNode.setPosition(sx, y + bob, 0);
    // 蹲姿(squash)：绕脚底压身高，竖压则横宽；踮脚则拉高。
    // 跳跃(stretch)：腾空垂直速度越大越拉长，到顶点速度归零→缩回原位。
    const squashY = 1 - h.crouch * 0.34;   // 蹲/踮（含起跳蓄力、落地深蹲、攻击）
    let cy = squashY, cx = 1 + (1 - squashY) * 0.5;
    // 普通跳跃腾空：上升拉长 → 顶点缩短 → 下落回正
    if (h.jumping && h.jmpPre <= 0 && h.jmpLand <= 0) {
      const vn = h.jumpVy / this.JUMP_MOVE_VY;   // >0上升 <0下落
      cy = h.jumpVy > 0
        ? 0.72 + Math.min(1, vn) * 0.68          // 起跳最长(1.40) → 顶点蹲低(0.72)
        : 0.72 + Math.min(1, -vn) * 0.28;        // 顶点蹲低(0.72) → 下落回正(~1.0)
      cx = 1 - (cy - 1) * 0.6;
    }
    // 落地回弹：压扁后段略微拉高再归位（弹性过冲）
    if (h.jmpLand > 0) {
      const l = h.jmpLand / this.JUMP_LAND;                          // 1→0
      const overshoot = l < 0.45 ? Math.sin((0.45 - l) / 0.45 * Math.PI) * 0.13 : 0;
      cy *= 1 + overshoot; cx *= 1 - overshoot * 0.5;
    }
    // 跳跃帧方案：蓄力/落地用蹲帧(0)、上升用伸展帧(1)、下落用屈腿帧(2)
    const useJumpSheet = h.jumping && h.state !== 'attack' && this.jumpFrames.length >= 3;
    if (useJumpSheet) { cy = 1 + (cy - 1) * 0.4; cx = 1 + (cx - 1) * 0.4; }   // 蹲姿画在帧里，程序挤压只留40%
    cy = Math.max(0.6, Math.min(1.45, cy)); cx = Math.max(0.7, cx);
    this.heroNode.setScale((h.dir >= 0 ? -S : S) * cx, S * cy, 1);   // 默认朝左，朝右翻转

    // 时段环境光色（清晨暖金/黄昏橙；夜晚不变）
    const tint = this.charTint();
    this.footSp.color = tint; this.heroSp.color = tint; this.legsSp.color = tint;

    // 地面攻击/跳劈 → AI 序列帧（缺图时兜底拼接）；走路/待机 → 步战全身
    const attacking = h.state === 'attack';
    const useAtkSheet = attacking && h.atkType !== 2 && this.atkFrames.length >= 4;
    const useSlamSheet = attacking && h.atkType === 2 && this.slamFrames.length >= 4;
    const useSheet = useAtkSheet || useSlamSheet;
    this.heroSp.node.active = attacking && !useSheet;
    this.legsSp.node.active = attacking && !useSheet;
    this.footNode.active = (!attacking || useSheet) && this.footFullFrames.length >= 4;
    const fu2 = this.footNode.getComponent(UITransform)!;
    if (useAtkSheet) {
      fu2.setContentSize(64, 56); fu2.setAnchorPoint(0.5, 4 / 56);
      // 非均匀节奏：预备慢(0~0.32) → 斩击快(0.32~0.5) → 前刺(0.5~0.75) → 收势
      const p = h.swing;
      const idx = p < 0.32 ? 0 : p < 0.5 ? 1 : p < 0.75 ? 2 : 3;
      this.footSp.spriteFrame = this.atkFrames[idx];
    } else if (useSlamSheet) {
      fu2.setContentSize(72, 72); fu2.setAnchorPoint(0.5, 4 / 72);
      // 按跳劈物理选帧：上升举枪 → 下落俯冲 → 砸地(与冲击波同步) → 收势
      const p = h.slamProg;
      const idx = p <= 0.15 ? 0 : p < 0.9 ? 1 : (this.slamFxT > this.SLAM_FX_DUR * 0.45 ? 2 : 3);
      this.footSp.spriteFrame = this.slamFrames[idx];
    } else if (attacking) {
      const p = h.atkType === 2 ? h.slamProg : h.swing;
      const idx = Math.max(0, Math.min(3, Math.floor(p * 4)));
      this.heroSp.spriteFrame = this.upperFrames[idx];
      if (this.legsFrames.length >= 2) this.legsSp.spriteFrame = this.legsFrames[0];
    } else if (useJumpSheet) {
      // 蓄力/落地 → 蹲帧(0)；上升到顶点 → 伸展帧(1)；过顶点稍落一点(降到78%高度) → 屈腿帧(2)
      fu2.setContentSize(64, 56); fu2.setAnchorPoint(0.5, 4 / 56);
      const airborne = h.jumpY > 0 && h.jmpLand <= 0 && h.jmpPre <= 0;
      const maxJH = this.JUMP_MOVE_VY * this.JUMP_MOVE_VY / (2 * this.GRAVITY_MOVE);
      const idx = !airborne ? 0 : (h.jumpVy > 0 || h.jumpY > maxJH * 0.78 ? 1 : 2);
      this.footSp.spriteFrame = this.jumpFrames[idx];
    } else if (this.footFullFrames.length >= 4) {
      fu2.setContentSize(40, 44); fu2.setAnchorPoint(0.5, 0);
      // 走路循环 4 帧，待机固定帧0
      const fi = h.state === 'walk' ? Math.floor(this.animT * 8) % 4 : 0;
      this.footSp.spriteFrame = this.footFullFrames[fi];
    }

    if (h.state === 'dead') {
      const d = h.deadT;   // 阵亡演出计时
      this.heroNode.angle = (h.dir >= 0 ? 1 : -1) * Math.min(90, d * 72);          // 缓缓倒地(90°)
      const sink = Math.min(1, d / 1.3) * 14 * this.SPRITE_SCALE;                  // 身体略下沉
      this.heroNode.setPosition(sx, y - sink, 0);
      const gray = Math.min(1, d / 1.8);                                           // 渐渐灰化
      const bt = this.charTint();
      const gv = (bt.r + bt.g + bt.b) / 3;
      this.heroSp.color = this.footSp.color = this.legsSp.color =
        new Color(Math.round(bt.r + (gv - bt.r) * gray), Math.round(bt.g + (gv - bt.g) * gray), Math.round(bt.b + (gv - bt.b) * gray), 255);
      this.heroOp.opacity = Math.max(0, Math.round(255 * (1 - Math.max(0, d - 2.6) / 1.4)));   // 先看倒地 2.6s，再溶解
    } else {
      // 次级动作：走路身体微摆（步频节律的小角度）
      const wob = h.state === 'walk' && hk === 0 && !h.jumping ? Math.sin(this.animT * 9) * 1.8 : 0;
      this.heroNode.angle = ang + wob;
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
    const tint = this.charTint();   // 时段环境光色
    let pi = 0;
    if (ready) {
      for (const m of drawn) {
        if (m.kind === 'boss' || pi >= this.monPool.length) continue;
        const e = this.monPool[pi++];
        e.node.active = true;
        e.sp.color = tint;
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
    this.bossSp.color = b.raged ? new Color(255, 118, 105, 255) : this.charTint();   // 狂暴泛红 > 时段环境光色

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
  // 时段光照方向：影子偏移(ox)、拉长(sx)、浓淡(a)。清晨/黄昏低日=长斜影，正午短，夜晚淡
  private shadowCfg(): { ox: number; sx: number; a: number } {
    switch (this.timeOfDay().name) {
      case '清晨': return { ox: 1.0, sx: 1.9, a: 0.42 };   // 日出偏东 → 影子朝右拉长
      case '黄昏': return { ox: -1.0, sx: 1.9, a: 0.42 };  // 日落偏西 → 影子朝左拉长
      case '夜晚': return { ox: -0.4, sx: 1.2, a: 0.28 };  // 月光淡
      default: return { ox: 0.05, sx: 1.0, a: 0.5 };       // 正午当头 → 短影
    }
  }

  // 夜晚地面暖光斑：角色/Boss 脚下透出一圈光，照亮周围地面（辐射用多层圆叠）
  private drawNightLight(g: Graphics) {
    const dk = this.timeOfDay().dark;
    if (dk < 0.15) return;                          // 只在偏暗时段亮
    const k = Math.min(1, dk / 0.4);               // 越黑越亮
    const pool = (sx: number, sy: number, R: number, col: number[], boost: number) => {
      for (let i = 4; i >= 1; i--) {
        g.fillColor = this._scratchC.set(col[0], col[1], col[2], Math.round(9 * (5 - i) * k * boost));
        g.ellipse(sx, sy, R * (i / 4), R * (i / 4) * 0.42); g.fill();
      }
    };
    const gy = this.groundY;
    // 主角脚下月光银白光斑（跳起时像光源远离地面：光斑变大变淡）
    const h = this.hero;
    const jk = Math.min(1, Math.max(0, h.jumpY) / 200);
    if (h.state !== 'dead') pool(this.sX(h.x), gy - 2, 120 * (1 + jk * 0.3), [200, 205, 220], 1.0 - jk * 0.6);
    // 小怪脚下微光
    for (const m of this.monsters) {
      if (m.state === 'dead') continue;
      pool(this.sX(m.x), gy + m.lane - 2, 70 * m.scale, [190, 196, 212], 0.6);
    }
  }

  // 光柱 / God rays：从上方斜射的暖光束（密林透树冠、黄昏斜射），画在最前层做空气光感
  private drawGodRays(g: Graphics) {
    const tod = this.timeOfDay().name;
    let col: number[], n: number, base: number, slant: number;
    if (tod === '清晨') { col = [255, 236, 180]; n = 5; base = 24; slant = -90; }
    else if (tod === '黄昏') { col = [255, 190, 120]; n = 5; base = 30; slant = 95; }
    else if (tod === '夜晚') { col = [188, 202, 235]; n = 2; base = 10; slant = 45; }
    else { col = [255, 248, 220]; n = 4; base = 14; slant = -34; }
    if (this.curBiome >= 0 && this.BIOMES[this.curBiome].name === '密林') col = this.blend(col, [200, 235, 150], 0.5);   // 密林偏绿
    const W = DESIGN_W, H = DESIGN_H, top = H / 2, bot = this.groundY - 30;
    const drift = Math.sin(this.animT * 0.15) * 44, span = W + 220;
    for (let i = 0; i < n; i++) {
      const topX = -W / 2 - 110 + (i + 0.5) * span / n + drift + (i * 53) % 37;
      const w = 44 + (i * 29) % 40;
      const shimmer = 0.68 + 0.32 * Math.sin(this.animT * 0.8 + i * 1.3);
      g.fillColor = new Color(col[0], col[1], col[2], Math.round(base * shimmer));
      g.moveTo(topX, top); g.lineTo(topX + w, top); g.lineTo(topX + w + slant, bot); g.lineTo(topX + slant, bot);
      g.close(); g.fill();
    }
  }

  // 角色背光描边(rim)：低日时段角色受光侧透出一圈暖光，把人从背景里"立"出来（画在角色之下、边缘露出）
  private drawBacklight(g: Graphics) {
    const tod = this.timeOfDay().name;
    // 只在清晨/黄昏画背光轮廓：正午/白天这层几乎不可见，却要给每个敌人叠圆 → 人多时白白吃填充率
    if (tod !== '清晨' && tod !== '黄昏') return;
    const sun = tod === '黄昏' ? -1 : 1;   // 光来向
    const col = tod === '黄昏' ? [255, 180, 110] : [255, 232, 175];
    const gy = this.groundY;
    const glow = (sx: number, sy: number, r: number, boost: number) => {
      for (let i = 2; i >= 1; i--) {   // 2 层柔边（原 3 层）：单个角色圆填充数 -1/3
        g.fillColor = this._scratchC.set(col[0], col[1], col[2], Math.round(15 * (3 - i) * boost));
        g.circle(sx, sy, r * (i / 2)); g.fill();
      }
    };
    const h = this.hero;
    const hy = gy + 42 + h.jumpY - Math.max(0, h.crouch) * 24;   // 跟随跳跃/蹲姿
    if (h.state !== 'dead') glow(this.sX(h.x) + sun * 16, hy, 48, 1);
    for (const m of this.monsters) {
      if (m.state === 'dead' || m.kind === 'boss') continue;
      glow(this.sX(m.x) + sun * 11, gy + m.lane + m.jumpY + 32 * m.scale, 30 * m.scale, 0.75);
    }
  }

  // 太阳侧入光：清晨从左侧、黄昏从右侧洒入一层暖光渐变 + 天边柔光斑（镜头感）
  private drawSunSide(g: Graphics) {
    const tod = this.timeOfDay().name;
    if (tod !== '清晨' && tod !== '黄昏') return;
    const fromLeft = tod === '清晨';
    const col = fromLeft ? [255, 224, 160] : [255, 160, 95];
    const W = DESIGN_W, H = DESIGN_H, bands = 6, bw = 46;
    for (let i = 0; i < bands; i++) {
      const a = Math.round(11 * (bands - i) / bands) + 2;   // 越靠光源侧越亮
      g.fillColor = this._scratchC.set(col[0], col[1], col[2], a);
      const x = fromLeft ? -W / 2 + i * bw : W / 2 - (i + 1) * bw;
      g.rect(x, -H / 2, bw, H); g.fill();
    }
    // 天边柔光斑（呼吸）
    const sx = fromLeft ? -W / 2 + 76 : W / 2 - 76;
    const br = 1 + 0.06 * Math.sin(this.animT * 0.9);
    for (let i = 3; i >= 1; i--) {
      g.fillColor = this._scratchC.set(col[0], col[1], col[2], 8 * (4 - i));
      g.circle(sx, H / 2 - 170, (44 + i * 46) * br); g.fill();
    }
  }

  private drawShadow(g: Graphics, wx: number, lane: number, w: number, jumpY: number) {
    const sx = this.sX(wx), sy = this.groundY + lane;
    const shrink = 1 - Math.min(0.72, Math.max(0, jumpY) / 200);   // 跳得越高影子缩得越明显
    const c = this.shadowCfg();
    const boost = 1 + (this.weather === '雨' ? this.lightT * 0.9 : 0);   // 闪电瞬间影子变浓
    const halfLen = w * c.sx * shrink;
    const cx = sx + c.ox * (halfLen - w * shrink);   // 一端锚在脚下、朝背光方向拉长
    // 外层软影（方向拉长）
    this._scratchC.set(0, 0, 0, Math.min(255, Math.round(c.a * 150 * shrink * boost)));
    g.fillColor = this._scratchC;
    g.ellipse(cx, sy - 2, halfLen, 7 * shrink); g.fill();
    // 内层接触影核（脚下小而浓 → 踩得更实）
    this._scratchC.set(0, 0, 0, Math.min(255, Math.round(c.a * 235 * shrink * boost)));
    g.fillColor = this._scratchC;
    g.ellipse(sx, sy - 2, w * 0.45 * shrink, 3.6 * shrink); g.fill();
  }

  // Bloom 辉光（加法混合层）：给亮元素叠柔和外发光
  private drawGlow() {
    const g = this.glowG; g.clear();
    const sc = this._scratchC;   // 复用色对象，杀掉这层每帧几十次 new Color 的 GC
    const glow = (x: number, y: number, r: number, col: number[], inten: number) => {
      for (let i = 3; i >= 1; i--) {
        sc.set(col[0], col[1], col[2], Math.round(inten * 24 * (4 - i) / 3));
        g.fillColor = sc;
        g.circle(x, y, r * (i / 3)); g.fill();
      }
    };
    // 金币
    for (const d of this.drops) {
      const x = d.flying ? d.sx : this.sX(d.x), y = d.flying ? d.sy : d.y + Math.sin(d.life * 7) * 3 + 15;
      glow(x, y, 20, [255, 205, 90], 1);
    }
    // 剑气波
    for (const w of this.waves) { const a = Math.max(0, 1 - w.life / w.max); glow(this.sX(w.x), w.y, 34, [150, 235, 255], a * 1.1); }
    // 赵云刀气（挥砍中段最亮）
    const h = this.hero;
    if (h.attacking && h.state !== 'dead') {
      const s = h.atkType === 2 ? h.slamProg : h.swing;
      const a = 1 - Math.abs(s - 0.4) / 0.6;
      if (a > 0.05) glow(this.sX(h.x) + h.dir * 40, this.groundY + 74 + h.jumpY, 52, [170, 240, 255], a * 1.3);
    }
    // 天气：余烬 / 闪电
    if (this.weather === '余烬') for (const p of this.wparts) glow(p.x, p.y, p.sz * 3, [255, 150, 50], 0.5 + 0.5 * Math.sin(p.ph * 3));
    // 闪电辉光：沿路径画一条粗加法描边（1 次 stroke 代替几十个圆填充，省填充率）
    const boltGlow = (pts: number[][], inten: number, col: number[]) => {
      if (pts.length < 2) return;
      g.strokeColor = this._scratchC.set(col[0], col[1], col[2], Math.round(Math.min(1, inten) * 70));
      g.lineWidth = 26;
      g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    };
    if (this.lightT > 0.02) { boltGlow(this.bolt, this.lightT * 0.8, [170, 205, 255]); for (const b of this.boltBranches) boltGlow(b, this.lightT * 0.6, [170, 205, 255]); }
    if (this.slamBoltT > 0) boltGlow(this.slamBolt, (this.slamBoltT / 0.26) * 0.9, [170, 210, 255]);   // 跳劈闪电辉光
    // 敌人受击白闪：加法白光罩在身体上（乘法着色变不了白，加法能"打亮"精灵）
    for (const m of this.monsters) {
      if (m.state === 'dead' || m.hitT <= 0) continue;
      const hk = Math.min(1, m.hitT / this.HIT_DUR);
      const cx = this.sX(m.x), cy = this.groundY + m.lane + m.jumpY;
      const isBoss = m.kind === 'boss';
      const bw = isBoss ? 58 : 22 * m.scale, bh = isBoss ? 105 : 36 * m.scale, byc = isBoss ? 105 : 36 * m.scale;
      for (let i = 2; i >= 1; i--) {
        sc.set(255, 255, 255, Math.round(52 * hk * (3 - i) / 2));
        g.fillColor = sc;
        g.ellipse(cx, cy + byc, bw * (i / 2), bh * (i / 2)); g.fill();
      }
    }
    // 火盆动态火光照亮角色（Boss 关：靠近火盆的人被暖光照到，随火苗闪）
    const gy2 = this.groundY;
    if (this.bossPropRoot && this.bossPropRoot.active) {
      for (const p of this.bossProps) {
        if (p.res !== 'boss-brazier') continue;
        const fl = 0.78 + 0.22 * Math.sin(this.animT * 8 + p.wx);
        const lit = (wx: number, cy: number, r: number, boost: number) => {
          const d = Math.abs(wx - p.wx); if (d > 240) return;
          glow(this.sX(wx), cy, r, [255, 165, 80], (1 - d / 240) * fl * boost);
        };
        if (h.state !== 'dead') lit(h.x, gy2 + 42 + h.jumpY, 46, 0.9);
        for (const m of this.monsters) {
          if (m.state === 'dead') continue;
          lit(m.x, gy2 + m.lane + m.jumpY + (m.kind === 'boss' ? 100 : 34 * m.scale), m.kind === 'boss' ? 72 : 26 * m.scale, 0.7);
        }
      }
    }
    // 闪电反打光：打雷瞬间全场角色被冷白光照亮一帧
    if (this.lightT > 0.05 && this.weather === '雨') {
      const k = this.lightT;
      const lite = (wx: number, cy: number, r: number, boost: number) => glow(this.sX(wx), cy, r, [215, 232, 255], k * boost);
      if (h.state !== 'dead') lite(h.x, gy2 + 44 + h.jumpY, 46, 1.0);
      for (const m of this.monsters) {
        if (m.state === 'dead') continue;
        lite(m.x, gy2 + m.lane + m.jumpY + (m.kind === 'boss' ? 100 : 34 * m.scale), m.kind === 'boss' ? 72 : 26 * m.scale, 0.8);
      }
    }
  }

  // 前景剪影层：最前的暗色草丛(摇曳)，框住画面、拉出纵深
  private drawForeground() {
    const g = this.fgSilG; g.clear();
    const W = DESIGN_W, H = DESIGN_H, t = this.animT, gy = this.groundY;
    const ruins = this.curBiome >= 0 && this.BIOMES[this.curBiome].name === '焦土';
    const dk = ruins ? [22, 13, 9] : [9, 17, 10];
    // 底部暗丘（把草根压在一起、盖住最底apron）
    g.fillColor = new Color(dk[0], dk[1], dk[2], 240);
    g.moveTo(-W / 2, -H / 2);
    for (let x = -W / 2; x <= W / 2; x += 44) {
      const n = Math.sin(x * 0.02 + t * 0.5) * 16 + Math.sin(x * 0.09 + 1.7) * 10;
      g.lineTo(x, gy - 46 + n);
    }
    g.lineTo(W / 2, -H / 2); g.close(); g.fill();
    // 草叶（细，摇曳）：中间矮、两侧高 → 只框边，不挡中央打斗
    for (let i = 0; i < 46; i++) {
      const x = -W / 2 - 20 + i * (W + 40) / 45;
      const edge = Math.min(1, Math.abs(x) / (W / 2));   // 0中央 1边缘
      const rootY = gy - 44 - ((i * 29) % 30);
      const hgt = (42 + ((i * 53) % 46)) * (0.55 + edge * 1.05);
      const sway = Math.sin(t * 1.1 + i * 0.7) * (12 + hgt * 0.07);
      g.strokeColor = new Color(dk[0], dk[1], dk[2], 235); g.lineWidth = 3 + ((i * 17) % 4);
      g.moveTo(x, rootY); g.lineTo(x + sway * 0.5, rootY + hgt * 0.6); g.lineTo(x + sway, rootY + hgt); g.stroke();
    }
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

  // ---------- 天气 ----------
  private weatherFor(zone: number): string {
    return this.ZONE_WEATHER[Math.min(zone, this.ZONE_WEATHER.length - 1)];
  }

  // 切换天气 + 铺满粒子
  private setWeather(type: string) {
    this.weather = type;
    this.bgKey = '';   // 换关/换天气：强制重画一次背景（时段可能变）
    // 天气贴图层开关：rain/snow/leaf 跟天气走，mote 常开（贴图未加载完时由加载回调再开）
    const wk = this.weatherKind();
    for (const r of this.rainNodes) r.n.active = !!r.sp.spriteFrame && (r.kind === 'mote' || r.kind === wk);
    this.tintMoteLayers();   // 浮尘随时段换色
    this.rainSplashT = 0;
    if (type === '雨') AudioMgr.inst.playAmb('rain', 0.45);   // 雨声循环
    else AudioMgr.inst.stopAmb();
    this.wparts = [];
    this.wimpacts = [];
    this.lightT = 0; this.lightCd = 2 + Math.random() * 4;
    const W = DESIGN_W, H = DESIGN_H, gy = this.groundY;
    const rx = () => (Math.random() - 0.5) * (W + 120);
    const ry = () => gy + Math.random() * (H / 2 + 40 - gy);   // 只在地面线以上铺
    // d=景深 0远(小/慢/淡) → 1近(大/快/浓)；sp=速度比例、sc=尺寸比例
    let n = 0; let make = (): typeof this.wparts[0] => ({ x: rx(), y: ry(), vx: 0, vy: 0, ph: Math.random() * 6.28, len: 0, sz: 0, c: 0, d: 1 });
    if (type === '雨' || type === '雪' || type === '落叶') {
      n = 0;   // 雨/雪/落叶已改为平铺贴图层滚动（rainNodes），不再逐粒画 → CPU 固定成本
    } else if (type === '余烬') {
      n = 60; make = () => { const d = Math.random(); return { x: rx(), y: ry(), vx: 12, vy: 60 + Math.random() * 70, ph: Math.random() * 6.28, len: 0, sz: (1.6 + Math.random() * 2.4) * (0.6 + d * 0.7), c: 0, d }; };
    } else if (type === '雾') {
      n = 20; make = () => ({ x: (Math.random() - 0.5) * (W + 400), y: gy - 20 + Math.random() * (H * 0.42), vx: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 20), vy: 0, ph: Math.random() * 6.28, len: 0, sz: 130 + Math.random() * 150, c: 0, d: 1 });
    }
    for (let i = 0; i < n; i++) this.wparts.push(make());
    this.wparts.sort((a, b) => a.d - b.d);   // 远→近排序：近景后画=盖在前
  }

  // 造一排草株：n株，缩放[s0,s1]，地面偏移 baseOff±jit，视差 par
  private makeGrassRow(parent: Node, count: number, s0: number, s1: number, baseOff: number, jit: number, par: number) {
    const sizes: [number, number][] = [[355, 240], [268, 240], [60, 240]];
    for (let i = 0; i < count; i++) {
      const kind = (i * 7 + Math.floor(par * 10)) % 3;
      const n = new Node('grass-' + par + '-' + i); n.layer = this.node.layer; n.parent = parent;
      const u = n.addComponent(UITransform);
      u.setContentSize(sizes[kind][0], sizes[kind][1]);
      u.setAnchorPoint(0.5, 0.03);   // 根部锚点 → 绕根摆
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      let sc = (s0 + ((i * 37) % 100) / 100 * (s1 - s0)) * (i % 2 ? -1 : 1);
      if (i % 9 === 4) sc *= 2.2;   // 偶尔一两株明显大一号
      n.setScale(sc, Math.abs(sc), 1);
      const op = n.addComponent(UIOpacity);
      n.active = false;
      const rec = {
        n, op, sp, loaded: false, lx: i * (DESIGN_W + 260) / count + ((i * 53) % 60),
        by: this.groundY + baseOff + ((i * 41) % (jit * 2)) - jit,
        ph: i * 1.31 + par * 5, ang: 0, vel: 0, par,
        fly: 0, fx: 0, fy: 0, fvx: 0, fvy: 0, spin: 0, regrow: 0, sc,
      };
      AssetHub.loadSF(`grass-${kind}`, (sf) => {
        if (!sf) return; sp.spriteFrame = sf; rec.loaded = true;
      });
      this.nearGrass.push(rec);
    }
  }

  // 近景草丛：风摆 + 主角拨草（靠近时被推向两侧，离开后弹簧回摆）
  private updateNearGrass(dt: number) {
    if (!this.nearGrass.length) return;
    const span = DESIGN_W + 260;
    const heroSx = this.hero && this.hero.state !== 'dead' ? this.sX(this.hero.x) : -99999;
    const gust = 1 + 0.4 * Math.sin(this.animT * 0.6) * Math.sin(this.animT * 1.3);
    const cullX = DESIGN_W / 2 + 80;   // 屏外剔除边界：出了这个范围就不渲染（省 draw call）
    for (const G of this.nearGrass) {
      const sx = (((G.lx - this.camX * G.par) % span) + span) % span - span / 2;
      // 视口剔除：草加载好了才可见；出屏就关掉节点（不进渲染），回屏再开
      const onScreen = G.loaded && Math.abs(sx) < cullX;
      if (G.n.active !== onScreen) G.n.active = onScreen;
      if (!onScreen) continue;
      // 被掀飞：抛物线 + 自旋 + 渐隐 → 消失，几秒后原地长回
      if (G.fly === 1) {
        G.fvy -= 1700 * dt;
        G.fx += G.fvx * dt; G.fy += G.fvy * dt;
        G.n.setPosition(sx + G.fx, G.by + G.fy, 0);
        G.n.angle += G.spin * dt;
        G.op.opacity = Math.max(0, G.op.opacity - 420 * dt);
        if (G.op.opacity <= 4) { G.fly = 2; G.regrow = 7 + Math.random() * 5; G.n.setScale(0.001, 0.001, 1); }
        continue;
      }
      // 消失中：倒计时重生（原地长出来）
      if (G.fly === 2) {
        G.regrow -= dt;
        G.n.setPosition(sx, G.by, 0);
        if (G.regrow <= 0) {
          G.fly = 3; G.fx = 0; G.fy = 0; G.n.angle = 0; G.ang = 0; G.vel = 0;
          G.op.opacity = 255;
        }
        continue;
      }
      // 长回中：缩放 0→原大
      if (G.fly === 3) {
        const cur = G.n.scale.y + Math.abs(G.sc) * dt * 0.8;
        if (cur >= Math.abs(G.sc)) { G.fly = 0; G.n.setScale(G.sc, Math.abs(G.sc), 1); }
        else G.n.setScale(G.sc >= 0 ? cur : -cur, cur, 1);
        G.n.setPosition(sx, G.by, 0);
        continue;
      }
      G.n.setPosition(sx, G.by, 0);
      // 主角拨草：近处的草被推向背离主角的方向
      const dxh = sx - heroSx;
      if (Math.abs(dxh) < 52) {
        const k = 1 - Math.abs(dxh) / 52;
        const target = (dxh >= 0 ? 1 : -1) * 26 * k;
        G.vel += (target - G.ang) * 30 * dt;
      }
      // 弹簧回摆
      G.vel += (-58 * G.ang - 7 * G.vel) * dt;
      G.ang += G.vel * dt;
      G.n.angle = Math.sin(this.animT * 1.4 + G.ph) * 2.4 * gust + G.ang;
    }
  }

  // 前景叶片：视差跟随 + 常时轻摆 + 雨天雨滴敲击（角冲量→弹簧回弹）+ 命中水花
  private updateFgLeaves(dt: number) {
    if (!this.fgLeaves.length) return;
    const W = DESIGN_W, span = W + 320, rain = this.weather === '雨';
    for (const L of this.fgLeaves) {
      // 跟前景层同视差(0.9)循环平铺
      const sx = (((L.lx - this.camX * 0.9) % span) + span) % span - span / 2;
      L.n.setPosition(sx, L.by, 0);
      // 弹簧回弹（被敲后衰减振荡）
      L.vel += (-52 * L.ang - 6.2 * L.vel) * dt;
      L.ang += L.vel * dt;
      // 常时轻摆 + 雨中整体多一点晃
      const sway = Math.sin(this.animT * 1.25 + L.ph) * (rain ? 3.2 : 2.0);
      L.n.angle = sway + L.ang;
      // 雨滴敲击：随机间隔给一记向下的角冲量 + 叶冠处溅小水花
      if (rain) {
        L.hitCd -= dt;
        if (L.hitCd <= 0) {
          L.hitCd = 0.45 + Math.random() * 1.5;
          L.vel += -(26 + Math.random() * 38);
          // 大水花：画在叶片之上的专属层（水环 + 溅飞水珠 + 白闪）
          const s = Math.abs(L.n.scale.y);
          const crownY = L.by + 340 * s * (0.45 + Math.random() * 0.2);   // 只落在叶身中部
          const crownX = sx + (Math.random() - 0.5) * 80 * s;
          this.leafSplashes.push({ x: crownX, y: crownY, life: 0, max: 0.42, seed: Math.random() * 100 });
          if (this.leafSplashes.length > 24) this.leafSplashes.shift();
        }
      }
    }
  }

  // 叶面水花：亮水环扩散 + 水珠抛物线溅飞 + 中心白闪（画在叶片之上）
  private drawLeafSplashes(dt: number) {
    const g = this.leafFxG;
    if (!g) return;
    g.clear();
    for (let i = this.leafSplashes.length - 1; i >= 0; i--) {
      const sp = this.leafSplashes[i];
      sp.life += dt;
      if (sp.life >= sp.max) { this.leafSplashes.splice(i, 1); continue; }
      const p = sp.life / sp.max, a = 1 - p;
      // 亮水环（扩散，更淡更大）
      g.strokeColor = new Color(218, 236, 252, Math.round(105 * a)); g.lineWidth = 2;
      g.ellipse(sp.x, sp.y, 5 + p * 32, (5 + p * 32) * 0.45); g.stroke();
      // 中心白闪（更淡）
      g.fillColor = new Color(255, 255, 255, Math.round(95 * a));
      g.circle(sp.x, sp.y, 3 * (1 - p * 0.6)); g.fill();
      // 水珠溅飞：宽扇形向上弹起(±60°)、略随雨向偏斜，再被重力拉回 —— 像雨点砸在叶面上
      for (let k = 0; k < 5; k++) {
        const fr = ((sp.seed * 13 + k * 29) % 10) / 10;                 // 0..1 确定性随机
        const ang = (Math.PI / 2 - 1.35) + fr * 2.7;                    // 90°±77° 更宽扇形
        const spd = 190 + ((sp.seed * 7 + k * 31) % 120);               // 溅得更远
        const dx = Math.cos(ang) * spd * sp.life - 34 * sp.life;        // 略向左（顺雨向）
        const dy = Math.sin(ang) * spd * 1.25 * sp.life - 500 * sp.life * sp.life;   // 上抛 + 重力
        g.fillColor = new Color(228, 240, 252, Math.round(105 * a));    // 更淡
        g.circle(sp.x + dx, sp.y + dy, 2.4 * (1 - p * 0.4)); g.fill();
      }
    }
  }

  // 草屑：被掀飞的碎草叶（抛物线 + 自旋 + 渐隐）
  private stepGrassBits(dt: number, g: Graphics) {
    for (let i = this.grassBits.length - 1; i >= 0; i--) {
      const b = this.grassBits[i];
      b.life += dt;
      if (b.life >= b.max) { this.grassBits.splice(i, 1); continue; }
      b.vy -= 1500 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.ang += b.va * dt;
      if (b.y < this.groundY - 4) { this.grassBits.splice(i, 1); continue; }
      const a = 1 - b.life / b.max;
      const sx = this.sX(b.x), L = 7;
      g.strokeColor = this._scratchC.set(112, 124, 58, Math.round(235 * a)); g.lineWidth = 2.5;
      g.moveTo(sx - Math.cos(b.ang) * L, b.y - Math.sin(b.ang) * L);
      g.lineTo(sx + Math.cos(b.ang) * L, b.y + Math.sin(b.ang) * L);
      g.stroke();
    }
  }

  // 小动物行为：蝴蝶花间飘(近了惊飞)、小鸟落地啄食(靠近/开打惊飞)、兔子蹦跳窜屏
  private stepCritters(dt: number) {
    if (!this.critters.length || !this.hero) return;
    const W = DESIGN_W, gy = this.groundY, t = this.animT;
    const heroSx = this.sX(this.hero.x);
    const calm = this.timeOfDay().name !== '夜晚' && this.weather !== '雨';
    // 威胁源：主角 + 活着的敌人（鸟和蝴蝶谁近怕谁）
    const threats: number[] = [heroSx];
    for (const m of this.monsters) if (m.state !== 'dead') threats.push(this.sX(m.x));
    const nearThreat = (sx: number) => {
      let d = 1e9, x = heroSx;
      for (const tx of threats) { const dd = Math.abs(sx - tx); if (dd < d) { d = dd; x = tx; } }
      return { d, x };
    };
    for (const c of this.critters) {
      // ---------- 蝴蝶 ----------
      if (c.kind === 0) {
        if (c.state === 0) {           // 隐藏等待
          c.wait -= dt;
          if (c.wait <= 0 && calm) {
            c.x = this.camX + (Math.random() - 0.5) * W * 0.8;
            c.y = gy + 34 + Math.random() * 62;
            c.state = 1; c.op.opacity = 0; c.n.active = true;
          }
          continue;
        }
        const sx = this.sX(c.x);
        if (c.state === 1) {           // 花间飘
          c.op.opacity = Math.min(210, c.op.opacity + 260 * dt);
          const wx = Math.sin(t * 0.55 + c.ph);
          c.x += wx * 30 * dt;
          const yy = c.y + Math.sin(t * 2.2 + c.ph) * 13;
          c.n.setPosition(sx, yy, 0);
          c.n.setScale(wx >= 0 ? -1 : 1, 0.55 + 0.45 * Math.abs(Math.sin(t * 11 + c.ph)), 1);   // 扑翼
          const nt = nearThreat(sx);
          if (nt.d < 85 || !calm) {   // 惊飞（主角或敌人靠近都跑）
            c.state = 2; c.vx = (sx >= nt.x ? 1 : -1) * (150 + Math.random() * 90); c.vy = 190;
          }
        } else {                        // 惊飞逃离
          c.x += c.vx * dt; c.y += c.vy * dt;
          c.n.setPosition(this.sX(c.x), c.y, 0);
          c.n.setScale(c.vx >= 0 ? -1 : 1, 0.5 + 0.5 * Math.abs(Math.sin(t * 16)), 1);
          c.op.opacity = Math.max(0, c.op.opacity - 260 * dt);
          if (c.op.opacity <= 0) { c.state = 0; c.n.active = false; c.wait = 5 + Math.random() * 9; }
        }
        continue;
      }
      // ---------- 小鸟 ----------
      if (c.kind === 1) {
        if (c.state === 0) {
          c.wait -= dt;
          if (c.wait <= 0 && calm) {
            const away = heroSx >= 0 ? -1 : 1;   // 优先落在主角对侧
            c.x = this.camX + away * (120 + Math.random() * 190);
            if (Math.abs(this.sX(c.x) - heroSx) < 130) { c.wait = 2; continue; }   // 别落在主角脚边
            c.state = 1; c.op.opacity = 0; c.n.active = true;
            if (this.birdStandSF) c.sp.spriteFrame = this.birdStandSF;
          }
          continue;
        }
        const sx = this.sX(c.x);
        if (c.state === 1) {           // 啄食
          c.op.opacity = Math.min(255, c.op.opacity + 300 * dt);
          c.n.setPosition(sx, gy + 15, 0);
          const peck = Math.max(0, Math.sin(t * 2.6 + 1)) ** 6;
          c.n.angle = -16 * peck;      // 低头啄
          c.n.setScale(sx >= heroSx ? -1 : 1, 1, 1);   // 面朝主角方向(图朝左)
          const nt = nearThreat(sx);
          if (nt.d < 150 || (this.hero.attacking && Math.abs(sx - heroSx) < 260) || !calm) {   // 惊飞（主角/敌人靠近，或近处挥刀）
            c.state = 2; c.vx = (sx >= nt.x ? 1 : -1) * (230 + Math.random() * 90); c.vy = 300;
            if (this.birdFlySF) c.sp.spriteFrame = this.birdFlySF;
            c.n.angle = 0;
          }
        } else {                        // 惊飞出屏
          c.x += c.vx * dt; c.y = (c.y || gy + 15) + c.vy * dt;
          c.vy += 60 * dt;              // 越飞越快向上
          c.n.setPosition(this.sX(c.x), c.y, 0);
          c.n.setScale((c.vx >= 0 ? -1 : 1) * 1, 0.6 + 0.4 * Math.abs(Math.sin(t * 15)), 1);
          if (c.y > DESIGN_H / 2 + 60 || Math.abs(this.sX(c.x)) > W / 2 + 80) {
            c.state = 0; c.n.active = false; c.y = 0; c.wait = 9 + Math.random() * 14;
          }
        }
        continue;
      }
      // ---------- 兔子 ----------
      if (c.state === 0) {
        c.wait -= dt;
        if (c.wait <= 0) {
          const side = Math.random() < 0.5 ? -1 : 1;
          c.x = this.camX - side * (W / 2 + 70);
          c.vx = side * (300 + Math.random() * 90);
          c.y = 0; c.vy = 330;
          c.state = 1; c.op.opacity = 255; c.n.active = true;
        }
        continue;
      }
      // 窜屏（连续蹦跳）
      c.x += c.vx * dt;
      c.vy -= 1500 * dt;
      c.y += c.vy * dt;
      if (c.y <= 0) { c.y = 0; c.vy = 330; }
      c.n.setPosition(this.sX(c.x), gy + 15 + c.y, 0);
      c.n.setScale(c.vx >= 0 ? -1 : 1, 1, 1);
      c.n.angle = (c.vx >= 0 ? -1 : 1) * Math.max(-18, Math.min(18, c.vy * 0.04));
      if (Math.abs(this.sX(c.x)) > W / 2 + 100) { c.state = 0; c.n.active = false; c.wait = 14 + Math.random() * 22; }
    }
  }

  private stepWeather(dt: number) {
    // 地面积雪：下雪时约 22 秒堆满，换天气后约 5 秒消融
    if (this.weather === '雪') this.snowAcc = Math.min(1, this.snowAcc + dt / 22);
    else if (this.snowAcc > 0) this.snowAcc = Math.max(0, this.snowAcc - dt / 5);
    // 乌云：雨天约 3 秒聚拢压顶，雨停约 2.5 秒散开
    if (this.weather === '雨') this.stormK = Math.min(1, this.stormK + dt / 3);
    else if (this.stormK > 0) this.stormK = Math.max(0, this.stormK - dt / 2.5);
    // 溅落粒子始终推进（即使切晴也让残留播完）
    for (let i = this.wimpacts.length - 1; i >= 0; i--) {
      const s = this.wimpacts[i]; s.life += dt;
      if (s.life >= s.max) this.wimpacts.splice(i, 1);
    }
    if (this.weather === '晴') return;   // 注意：雨的粒子数为 0，但雨层滚动/溅花/闪电仍要跑，不能按 wparts 空来早退
    const W = DESIGN_W, H = DESIGN_H, top = H / 2 + 40, edge = W / 2 + 60, gy = this.groundY;
    const rain = this.weather === '雨', ember = this.weather === '余烬', fog = this.weather === '雾';
    // 地面溅落：定时随机补（原来由每粒落地触发）。层滚动在 updateWeatherLayers（update 里无条件跑）
    if (rain || this.weather === '雪' || this.weather === '落叶') {
      this.rainSplashT -= dt;
      if (this.rainSplashT <= 0 && this.wimpacts.length < 140) {
        const d = 0.4 + Math.random() * 0.6, sx2 = (Math.random() - 0.5) * W;
        if (rain) { this.rainSplashT = 0.05; this.spawnWImpact(sx2, gy, '雨', 0, 0, d); }
        else if (this.weather === '雪') { this.rainSplashT = 0.09; this.spawnWImpact(sx2, gy, '雪', (2 + Math.random() * 2.6) * (0.5 + d * 0.9), 0, d); }
        else { this.rainSplashT = 0.16; this.spawnWImpact(sx2, gy, '落叶', (3.5 + Math.random() * 3) * (0.5 + d * 0.85), Math.floor(Math.random() * 3), d); }
      }
    }
    const fedge = W / 2 + 260;
    const respawnX = () => (Math.random() - 0.5) * (W + 120);
    // 角色身体框：雨雪叶砸到人身上也溅落（余烬/雾不参与）
    const boxes: { cx: number; top: number; feet: number; hw: number }[] = [];
    if (!ember && !fog) {
      const h = this.hero;
      if (h.state !== 'dead') boxes.push({ cx: this.sX(h.x), top: gy + 88, feet: gy, hw: 15 });
      for (const m of this.monsters) {
        if (m.state === 'dead') continue;
        if (m.kind === 'boss') boxes.push({ cx: this.sX(m.x), top: gy + m.lane + 205, feet: gy + m.lane, hw: 52 });
        else boxes.push({ cx: this.sX(m.x), top: gy + m.lane + 64 * m.scale, feet: gy + m.lane, hw: 17 * m.scale });
      }
    }
    for (const p of this.wparts) {
      p.ph += dt * (fog ? 0.5 : 2);
      const sway = rain || ember || fog ? 0 : Math.sin(p.ph) * 34;   // 雪/叶左右飘
      p.x += (p.vx + sway) * dt;
      p.y += p.vy * dt;
      if (fog) {                                                // 雾：只横向飘、不落地
        if (p.x < -fedge) p.x = fedge; else if (p.x > fedge) p.x = -fedge;
        continue;
      }
      if (!ember) {   // 先判是否砸到角色身上
        let onBody = false;
        for (const b of boxes) {
          if (p.x >= b.cx - b.hw && p.x <= b.cx + b.hw && p.y <= b.top && p.y >= b.feet) {
            if (this.wimpacts.length < 140) this.spawnWImpact(p.x, p.y, this.weather, p.sz, p.c, p.d);
            p.y = top; p.x = respawnX(); onBody = true; break;
          }
        }
        if (onBody) continue;
      }
      if (ember) {
        if (p.y > top) { p.y = gy - 10; p.x = respawnX(); }   // 余烬从地面升起、飘到顶重生
      } else {
        // 雨：一律落到地面线（不再挂在半空的山/树上）；雪、叶保留景深落点
        const landY = rain ? gy : gy + (1 - p.d) * 210;
        if (p.y <= landY) {
          if (this.wimpacts.length < 140) this.spawnWImpact(p.x, landY, this.weather, p.sz, p.c, p.d);
          p.y = top; p.x = respawnX();
        }
      }
      if (p.x < -edge) p.x = edge; else if (p.x > edge) p.x = -edge;
    }
    // 雷电：一次强闪 → 快速暗 → 紧跟几次抖闪(re-strike)，白屏与电光一起脉动
    if (rain) {
      if (this.lightT > 0) this.lightT = Math.max(0, this.lightT - dt * 7);   // 更快、更punchy
      if (this.flickN > 0) {
        this.flickT -= dt;
        if (this.flickT <= 0) {   // 抖闪：亮度弹回 + 换一道新电光
          this.lightT = 0.55 + Math.random() * 0.45; this.genBolt();
          this.flickN--; this.flickT = 0.04 + Math.random() * 0.07;
        }
      }
      this.lightCd -= dt;
      if (this.lightCd <= 0) {   // 主闪
        this.lightT = 1; this.genBolt(); this.addShake(5);
        AudioMgr.inst.play('thunder', 0.7);
        this.flickN = 2 + Math.floor(Math.random() * 2); this.flickT = 0.06 + Math.random() * 0.06;
        this.lightCd = 5 + Math.random() * 8;
      }
    }
  }

  // 生成一道天空闪电：锯齿主干 + 1~2 条分叉
  // 跳劈落地闪电：绘制（外发光 + 亮芯，随时间快速衰减 + 抖闪）
  private drawSlamBolt(g: Graphics) {
    if (this.slamBoltT <= 0 || this.slamBolt.length < 2) return;
    const a = (this.slamBoltT / 0.26) * (0.7 + 0.3 * Math.sin(this.animT * 60));   // 快速衰减 + 高频抖闪
    const path = () => { g.moveTo(this.slamBolt[0][0], this.slamBolt[0][1]); for (let i = 1; i < this.slamBolt.length; i++) g.lineTo(this.slamBolt[i][0], this.slamBolt[i][1]); };
    g.strokeColor = this._scratchC.set(150, 195, 255, Math.round(150 * a)); g.lineWidth = 12;   // 外发光
    path(); g.stroke();
    g.strokeColor = this._scratchC.set(250, 252, 255, Math.round(250 * a)); g.lineWidth = 4;    // 亮芯
    path(); g.stroke();
    // 落点电光爆闪
    const tip = this.slamBolt[this.slamBolt.length - 1];
    g.fillColor = this._scratchC.set(210, 230, 255, Math.round(120 * a));
    g.circle(tip[0], tip[1], 26 * (1.4 - a * 0.4)); g.fill();
  }

  // 落地冲击波：按剩余时间选帧（爆点→炸开→光环→消散），跟随落点世界坐标
  private updateSlamFx() {
    const n = this.slamFxN;
    if (!n) return;
    if (this.slamFxT <= 0 || this.slamFxFrames.length < 4) {
      if (n.active) n.active = false;
      return;
    }
    const p = 1 - this.slamFxT / this.SLAM_FX_DUR;          // 0→1 播放进度
    const fi = Math.min(3, Math.floor(p * 4));
    n.active = true;
    n.setPosition(this.sX(this.slamFxX), this.groundY + 2, 0);
    n.setScale(2.5, 1.2, 1);                                 // 横向拉宽、纵向压扁 → 光环贴地的透视感（宽约 400px）
    this.slamFxSp!.spriteFrame = this.slamFxFrames[fi];
    this._scratchC.set(255, 255, 255, fi === 3 ? 200 : 255); // 尾帧稍淡，收得更柔
    this.slamFxSp!.color = this._scratchC;
  }

  // 跳劈落地闪电：从天顶劈到落点的锯齿电光（短暂显示后消失）
  private genSlamBolt(x: number, y: number) {
    const H = DESIGN_H, top = H / 2;
    const steps = 9;
    let sx = x + (Math.random() - 0.5) * 140;   // 起点在天顶、略偏
    const pts: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = sx + (x - sx) * t + (i > 0 && i < steps ? (Math.random() - 0.5) * 52 : 0);
      pts.push([px, top + (y - top) * t]);
    }
    pts[steps] = [x, y];   // 末端钉在落点
    this.slamBolt = pts;
    this.slamBoltT = 0.26;
  }

  private genBolt() {
    const W = DESIGN_W, H = DESIGN_H, top = H / 2;
    const endY = H * (0.21 + Math.random() * 0.10);   // 更长，但仍停在天空(高于中景山/树线)
    let x = (Math.random() - 0.5) * W * 0.8, y = top;
    const steps = 11 + Math.floor(Math.random() * 4), dy = (top - endY) / steps;
    const pts: number[][] = [[x, y]];
    for (let i = 1; i <= steps; i++) { y -= dy; x += (Math.random() - 0.5) * 92; pts.push([x, y]); }
    this.bolt = pts;
    this.boltBranches = [];
    const nb = 1 + Math.floor(Math.random() * 2);
    for (let b = 0; b < nb; b++) {
      const idx = 2 + Math.floor(Math.random() * (steps - 3));
      let bx = pts[idx][0], by = pts[idx][1];
      const bsteps = 3 + Math.floor(Math.random() * 3), dir = Math.random() < 0.5 ? -1 : 1;
      const bp: number[][] = [[bx, by]];
      for (let i = 0; i < bsteps; i++) { by -= dy * 0.9; bx += dir * (18 + Math.random() * 34); bp.push([bx, by]); }
      this.boltBranches.push(bp);
    }
  }

  private spawnWImpact(x: number, y: number, t: string, sz: number, c: number, d: number) {
    const max = t === '雨' ? 0.24 : t === '雪' ? 0.5 : 0.7;   // 雨快、雪叶慢
    this.wimpacts.push({ x, y: y + (Math.random() - 0.5) * 6, life: 0, max, t, sz, c, d });
  }

  // 落地溅落：雨=水花溅起、雪=堆化淡出、叶=落地渐隐
  private drawWImpacts(g: Graphics) {
    for (const s of this.wimpacts) {
      const p = s.life / s.max, a = (1 - p) * (0.5 + s.d * 0.5);   // 远(山上)溅落更淡
      if (s.t === '雨') {
        // 像素水花：左右两瓣「外扩+抬起」的方块，替代抗锯齿水环
        const PX = this.RAIN_PX;
        const snap = (v: number) => Math.round(v / PX) * PX;
        const dx = snap(2 + p * 8), dy = snap(6 * (1 - p) * a);
        g.fillColor = this._scratchC.set(170, 198, 228, Math.round(160 * a));
        g.rect(snap(s.x - dx) - PX, snap(s.y + dy), PX, PX);
        g.rect(snap(s.x + dx), snap(s.y + dy), PX, PX);
        if (p < 0.5) g.rect(snap(s.x) - PX, snap(s.y), PX * 2, PX);   // 落点那一格，前半程可见
        g.fill();
      } else if (s.t === '雪') {
        g.fillColor = this._scratchC.set(248, 250, 255, Math.round(170 * a));   // 堆雪淡出
        g.circle(s.x, s.y, s.sz * (1 + p * 1.4)); g.fill();
      } else {
        const cols = [[196, 148, 52], [150, 120, 40], [120, 150, 60]];
        const c = cols[s.c] || cols[0];
        g.fillColor = this._scratchC.set(c[0], c[1], c[2], Math.round(210 * a));   // 落叶渐隐
        g.circle(s.x, s.y + 2, s.sz * (0.9 - p * 0.3)); g.fill();
      }
    }
  }

  private drawWeather(g: Graphics) {
    if (this.weather === '晴' && this.wimpacts.length === 0) return;
    this.drawWImpacts(g);   // 溅落先画（在落下的粒子之下）
    if (this.weather === '晴') return;
    const W = DESIGN_W, H = DESIGN_H;
    // 闪电全屏白闪 + 天空那道电
    if (this.lightT > 0) {
      const a = this.lightT;
      g.fillColor = this._scratchC.set(210, 224, 255, Math.round(120 * a * a));   // 全屏微闪（比之前淡，主体交给闪电线）
      g.rect(-W / 2, -H / 2, W, H); g.fill();
      if (this.bolt.length > 1) {
        const path = (pts: number[][]) => { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); };
        g.strokeColor = this._scratchC.set(150, 195, 255, Math.round(130 * a)); g.lineWidth = 13;  // 外发光
        path(this.bolt); for (const b of this.boltBranches) path(b); g.stroke();
        g.strokeColor = this._scratchC.set(248, 251, 255, Math.round(248 * a)); g.lineWidth = 4;   // 亮芯
        path(this.bolt); for (const b of this.boltBranches) path(b); g.stroke();
      }
    }
    // 雨/雪/落叶的粒子已改为平铺贴图层滚动（rainNodes），这里不再逐粒画；溅落/闪电照旧
    if (this.weather === '余烬') {
      for (const p of this.wparts) {
        const a = 0.5 + 0.5 * Math.sin(p.ph * 3);
        g.fillColor = this._scratchC.set(255, 150 + Math.round(60 * a), 40, Math.round(200 * a)); g.circle(p.x, p.y, p.sz); g.fill();
      }
    } else if (this.weather === '雾') {
      // 贴地团雾（每团两层做柔边），下方更浓
      for (const p of this.wparts) {
        const a = 0.09 + 0.05 * Math.sin(p.ph);
        g.fillColor = this._scratchC.set(234, 238, 242, Math.round(255 * a));
        g.ellipse(p.x, p.y, p.sz, p.sz * 0.42); g.fill();
        g.fillColor = this._scratchC.set(240, 243, 246, Math.round(255 * a * 0.8));
        g.ellipse(p.x, p.y, p.sz * 0.6, p.sz * 0.28); g.fill();
      }
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

  // 飘云（慢速视差，块状）—— 单独层 cloudG，每帧重画（云要飘）
  private drawClouds(t: Theme, PX: number) {
    const g = this.cloudG, W = DESIGN_W, gy = this.groundY;
    const k = 0;   // 乌云效果已关闭（想恢复改回 this.stormK）
    const snap = (v: number) => Math.round(v / PX) * PX;
    const span = W + 280;
    const n = 5 + Math.round(k * 3);            // 雨天云更多（5 → 8）
    // 脏标记：云位置吸附在 12px 网格，云飘过一格（约 1~2 秒）才真正重画。
    // key 用数字哈希（格序号进制拼合），不拼字符串 → 每帧零分配
    let key = this.TIMES.indexOf(this.timeOfDay()) + 1;
    const bxs = this._cloudBxs;
    bxs.length = 0;
    for (let i = 0; i < n; i++) {
      const speed = (5 + i * 2) * (1 + k * 0.6);   // 乌云滚得快一点
      let bx = (-this.animT * speed - this.camX * 0.12 + i * 267) % span;
      bx = ((bx % span) + span) % span - W / 2 - 140;
      const sx = snap(bx);
      bxs.push(sx);
      key = key * 256 + (sx / PX + 128);   // sx 是 PX 的整数倍，格序号范围远小于 256
    }
    if (key === this.cloudKey) return;
    this.cloudKey = key;
    g.clear();
    // 云色：平时亮云 → 雨天渐变成深灰乌云
    const bright = this.sh(this.timeOfDay().sky, 1.16);
    const col = new Color(
      Math.round(bright.r + (86 - bright.r) * k),
      Math.round(bright.g + (92 - bright.g) * k),
      Math.round(bright.b + (106 - bright.b) * k), 255);
    for (let i = 0; i < n; i++) {
      const bx = bxs[i];
      const by = gy + 420 + (i % 3) * 70 - (i >= 5 ? 36 : 0);   // 增补的云稍低，铺满天空
      const s = (0.85 + (i % 3) * 0.28) * (1 + k * 0.55);       // 乌云更大更厚
      g.fillColor = col;
      g.rect(bx, snap(by), snap(96 * s), snap(26 * s)); g.fill();
      g.rect(snap(bx + 22 * s), snap(by + 18 * s), snap(60 * s), snap(20 * s)); g.fill();
      g.rect(snap(bx - 16 * s), snap(by + 10 * s), snap(42 * s), snap(18 * s)); g.fill();
    }
  }

  // 前景层：只保留赵云挥砍刀气（罩在角色之上）
  private drawFg() {
    const g = this.fgG;
    g.clear();

    // 阵亡红闪：全屏血红罩，快速淡出
    if (this.deadRedT > 0) {
      const a = Math.round(150 * Math.min(1, this.deadRedT / 0.55));
      g.fillColor = new Color(140, 12, 10, a);
      g.rect(-DESIGN_W / 2, -DESIGN_H / 2, DESIGN_W, DESIGN_H); g.fill();
    }

    // 赵云挥砍大刀气（新月贴图精灵：随挥砍进度旋转 + 淡出，不再每帧 hArc 描边）
    const h = this.hero;
    let slashOn = false;
    if (h.attacking && h.state !== 'dead' && this.slashN && this.slashSp && this.slashSp.spriteFrame) {
      const s = h.atkType === 2 ? h.slamProg : h.swing;
      const a = 1 - Math.abs(s - 0.4) / 0.6;   // 中段最亮
      if (a > 0.05) {
        const cx = this.sX(h.x) + h.dir * 34, cy = this.groundY + 74 + h.jumpY;   // 前移到刀上（原 22）
        const c0 = h.dir > 0 ? 0 : Math.PI;
        // 顺刀方向：vert>0 朝下、<0 朝上；随挥砍进度 s 旋转，刀气跟着刀扫
        let vert: number;
        if (h.atkType === 1) vert = 0.9 - 1.9 * s;          // 上挑：由下往上扫
        else if (h.atkType === 2) vert = 0.15 + 0.5 * s;    // 跳劈前冲：斜向前下(不竖直)
        else vert = -0.9 + 1.9 * s;                          // 下劈：由上往下劈
        const ca = c0 - h.dir * vert;                        // 刀气中心角
        this.slashN.active = true;
        this.slashN.setPosition(cx, cy, 0);
        this.slashN.angle = ca * 57.29578;                   // 弧度→角度（贴图开口朝右=0°）
        this.slashN.setScale(1.7, 1.7, 1);                   // 贴图内弧 r≈44 → 44*1.7 ≈ 原 R74
        this._scratchC.set(255, 255, 255, Math.round(230 * a));
        this.slashSp.color = this._scratchC;
        slashOn = true;
      }
    }
    if (!slashOn && this.slashN && this.slashN.active) this.slashN.active = false;

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
    if (dk > 0) { g.fillColor = this._scratchC.set(6, 12, 32, Math.round(dk * 255)); g.rect(-W / 2, -H / 2, W, H); g.fill(); }
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
    // 曹旗飘动：旗面横条按相位摆（阵风起伏 → 时缓时急）
    if (this.flagStrips.length) {
      const gust = 1 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 1.7);   // 阵风强度慢变
      for (const st of this.flagStrips) {
        st.n.setPosition(st.bx + Math.sin(t * 2.6 + st.ph) * st.amp * gust, st.n.position.y, 0);
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
      g.fillColor = this._scratchC.set(232, 116, 40, 205);
      g.circle(x, by + (10 + fl * 7) * s, (13 + f2 * 3) * s); g.fill();
      g.fillColor = this._scratchC.set(252, 204, 96, 225);
      g.circle(x, by + (8 + f2 * 6) * s, (7 + fl * 2.5) * s); g.fill();
      for (let i = 0; i < 3; i++) {                     // 火星（确定性伪随机，无状态）
        const ph = (t * (0.55 + i * 0.17) + i * 0.37 + wx * 0.001) % 1;
        const ex = x + Math.sin(t * 3 + i * 2.1 + wx) * 9 * s;
        const ey = by + 14 * s + ph * 95 * s;
        g.fillColor = this._scratchC.set(255, 170, 80, Math.round(200 * (1 - ph)));
        g.circle(ex, ey, 2.2 * s * (1 - ph * 0.5)); g.fill();
      }
    };
    flame(arenaX + 158, 29, 0.5);    // 火盆盆口（右侧，盆高 38px）
  }

  // 全屏色调滤镜：由时段驱动（真背景叠上它 → 清晨/黄昏/夜的氛围）
  private readonly _gradeC = new Color(0, 0, 0, 0);   // gradeColor 缓存（按关，drawSceneTint 每帧调用）
  private _gradeZone = -1;
  private gradeColor(t: Theme): Color {
    if (this._gradeZone === this.zone) return this._gradeC;
    this._gradeZone = this.zone;
    const gr = this.timeOfDay().grade;
    const rg = this.realmOf(this.zone).grade;   // 叠加界色罩（地府幽冥青 / 天庭鎏金）
    if (rg[3] <= 0) { this._gradeC.set(gr[0], gr[1], gr[2], gr[3]); return this._gradeC; }
    // 两层罩按 alpha 加权混合成一层，避免多画一遍全屏
    const a1 = gr[3] / 255, a2 = rg[3] / 255;
    const a = a1 + a2 * (1 - a1);
    if (a <= 0) { this._gradeC.set(0, 0, 0, 0); return this._gradeC; }
    const mix = (c1: number, c2: number) => Math.round((c1 * a1 + c2 * a2 * (1 - a1)) / a);
    this._gradeC.set(mix(gr[0], rg[0]), mix(gr[1], rg[1]), mix(gr[2], rg[2]), Math.round(a * 255));
    return this._gradeC;
  }

  private drawBg() {
    const W = DESIGN_W, H = DESIGN_H, gy = this.groundY;
    const PX = 12;

    // 云：单独层，每帧重画（云会飘）
    this.drawClouds(this.theme(), PX);

    // 天空+地面全部屏幕固定（不随镜头滚），所以只在换时段时重画一次 → 走路/战斗全程零开销。
    // 这是本帧最肥的一块（~435 图元 + ~90 new Color），缓存后 Game Logic 从 ~20ms 降到 ~5ms。
    const key = this.timeOfDay().name;
    if (key === this.bgKey) return;
    this.bgKey = key;
    const g = this.bgG;
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

    // 云已移到 cloudG 单独层（drawBg 顶部每帧画）
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
      // 抖动过渡：棋盘格（屏幕固定，不随镜头滚 → 背景可长期缓存，走路/战斗都不重画）
      if (i > 0) {
        g.fillColor = col;
        const shift = (i % 2) * PX;
        for (let x = -W / 2 - PX * 2; x < W / 2 + PX * 2; x += PX * 2) {
          g.rect(x + shift, yTop, PX, PX); g.fill();
        }
      }
    }

    // 地面细节：撒草簇/石子/土斑/亮叶，打破大块纯色（屏幕固定点位 → 不随镜头滚，背景可长期缓存）
    const rnd2 = (n: number, k: number) => { const v = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
    const gap = 46;
    const startW = -W / 2 - gap;
    for (let wxi = startW; wxi < W / 2 + gap; wxi += gap) {
      const sx = wxi + rnd2(wxi, 1) * gap;
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
    for (let wxi = startW; wxi < W / 2 + gap; wxi += 34) {   // 顶缘波浪丛形（屏幕固定）
      const r = 14 + rnd2(wxi, 7) * 24;
      const bx = wxi + rnd2(wxi, 8) * 30;
      g.fillColor = dkBush;
      g.circle(bx, bushTop + rnd2(wxi, 9) * 10, r); g.fill();
    }
  }

  // 创建一层无缝滚动视差背景（2 块瓦片，镜像图已保证左右无缝）
  private makeScrollLayer(res: string, dispH: number, par: number, baseY: number, preload = true) {
    const L = { tiles: [] as Node[], w: 0, par, baseY, dispH };
    for (let i = 0; i < 2; i++) {
      const n = new Node('bglayer-' + res + i);
      n.layer = this.node.layer; n.parent = this.node;
      n.addComponent(UITransform).setAnchorPoint(0, 0);
      n.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
      L.tiles.push(n);
    }
    this.layers.push(L);
    // preload=false：贴图交给 applyBiome 统一设置（否则初始图和 biome 图竞速加载，开局会闪一下）
    if (preload) this.setLayerImage(this.layers.length - 1, res);
  }

  // 换某一视差层的贴图（带缓存；缺图静默跳过，保留当前图）
  private setLayerImage(idx: number, res: string) {
    const L = this.layers[idx];
    if (!L) return;
    const apply = (sf: SpriteFrame) => {
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      L.w = sf.rect.width * (L.dispH / sf.rect.height);
      // 设图的同时立即按当前镜头摆位——否则贴图就绪的那一帧会以节点默认位置闪现一下
      const off = (((this.camX * L.par) % L.w) + L.w) % L.w;
      for (let i = 0; i < L.tiles.length; i++) {
        const n = L.tiles[i];
        n.getComponent(Sprite)!.spriteFrame = sf;
        n.getComponent(UITransform)!.setContentSize(L.w, L.dispH);
        n.setPosition(-DESIGN_W / 2 - off + i * L.w, this.groundY + L.baseY, 0);
      }
    };
    if (this.bgCache[res]) { apply(this.bgCache[res]); return; }
    AssetHub.loadSF(res, (sf) => {
      if (!sf) return;   // 缺图静默：保持上一张背景
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
    return li === 0 ? b.far : li === 1 ? b.mid : li === 2 ? b.near : b.fg;   // 3=最前景层
  }
  // 预加载「当前关会用到的」背景组（只载需要的，避免整套背景常驻显存）
  // 以前是全量预载 3 组 ≈ 多占 10MB 显存，且其中两组根本没用上。
  private preloadAllBiomes() {
    const need = new Set<number>([this.biomeIndexFor(this.zone), this.biomeIndexFor(this.zone + 1)]);
    for (const bi of need) {
      for (let li = 0; li < 4; li++) {
        const res = this.layerRes(li, bi);
        if (this.bgCache[res]) continue;
        AssetHub.loadSF(res, (sf) => { if (sf) this.bgCache[res] = sf; });
      }
    }
  }

  // 直接把背景组套到 4 层（远/中/近/前景；用于开局/换景结束）
  private applyBiome(zone: number) {
    const bi = this.biomeIndexFor(zone);
    if (bi === this.curBiome) return;
    this.curBiome = bi;
    this.setLayerImage(0, this.layerRes(0, bi));
    this.setLayerImage(1, this.layerRes(1, bi));
    this.setLayerImage(2, this.layerRes(2, bi));
    if (this.fgLayerIdx >= 0) this.setLayerImage(this.fgLayerIdx, this.layerRes(3, bi));   // 前景层(石头层不动)
  }

  // 所有视差层：各自速度无缝横向滚动；卷屏换景时走"老左滑出/新右滑入"
  private updateScrollLayers() {
    const W = DESIGN_W;
    this.applyRealmBgTint();
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
    this.bgKey = '';   // 过场会占用/改写 bgG → 过场后强制重画一次背景
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

  // 顶部 HUD：血条（心形图标 + 掉血残影 + 变色 + 高光/刻度）+ 金币徽章
  private drawHeroHp(g: Graphics) {
    const w = 340, hh = 26, x = -197, y = DESIGN_H / 2 - 84;   // 整条 HUD 居中：头像→心→血条→金币
    const p = Math.max(0, this.hero.hp / this.hero.hpMax);
    const lag = Math.max(p, this.hpLag / this.hero.hpMax);
    // 底槽（外圈深边 + 内槽）
    g.fillColor = new Color(10, 8, 12, 210); g.roundRect(x - 3, y - 3, w + 6, hh + 6, 10); g.fill();
    g.fillColor = new Color(44, 36, 42, 255); g.roundRect(x, y, w, hh, 7); g.fill();
    // 掉血残影（亮橙，缓慢被追上 → 看清刚掉了多少血）
    if (lag > p + 0.003) {
      g.fillColor = new Color(255, 168, 84, 230);
      g.roundRect(x + 2, y + 2, (w - 4) * lag, hh - 4, 5); g.fill();
    }
    // 血量填充：绿 → 黄 → 红
    const col = p > 0.5 ? new Color(88, 208, 108, 255) : p > 0.25 ? new Color(235, 195, 70, 255) : new Color(228, 70, 58, 255);
    g.fillColor = col;
    if (p > 0.003) { g.roundRect(x + 2, y + 2, (w - 4) * p, hh - 4, 5); g.fill(); }
    // 顶部高光条（体积感）
    if (p > 0.02) {
      g.fillColor = new Color(255, 255, 255, 48);
      g.roundRect(x + 5, y + hh * 0.56, (w - 10) * p, hh * 0.3, 4); g.fill();
    }
    // 25% 刻度
    g.strokeColor = new Color(0, 0, 0, 90); g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { const tx = x + w * i / 4; g.moveTo(tx, y + 3); g.lineTo(tx, y + hh - 3); }
    g.stroke();
    // 金描边
    g.strokeColor = new Color(255, 232, 190, 130); g.lineWidth = 2; g.roundRect(x, y, w, hh, 7); g.stroke();
    // 最左端主角头像底板（头像 Sprite 节点盖在上面）+ 方形金框
    const ax = -267, ay = y + hh / 2 + 2, ar = 29;
    g.fillColor = new Color(14, 12, 18, 230); g.roundRect(ax - ar, ay - ar, ar * 2, ar * 2, 8); g.fill();
    g.strokeColor = new Color(255, 214, 120, 210); g.lineWidth = 3; g.roundRect(ax - ar, ay - ar, ar * 2, ar * 2, 8); g.stroke();
    g.strokeColor = new Color(120, 88, 30, 220); g.lineWidth = 1.5; g.roundRect(ax - ar + 3, ay - ar + 3, ar * 2 - 6, ar * 2 - 6, 6); g.stroke();

    // 左端心形图标
    const hx = x - 22, hy = y + hh / 2;
    g.fillColor = new Color(16, 10, 12, 200); g.circle(hx, hy, 17); g.fill();   // 底盘
    g.fillColor = new Color(232, 62, 58, 255);
    g.circle(hx - 5, hy + 3, 6.5); g.fill(); g.circle(hx + 5, hy + 3, 6.5); g.fill();
    g.moveTo(hx - 10.5, hy + 0.5); g.lineTo(hx, hy - 12); g.lineTo(hx + 10.5, hy + 0.5); g.close(); g.fill();
    g.fillColor = new Color(255, 190, 190, 220); g.circle(hx - 4, hy + 5, 2.2); g.fill();   // 高光
    // 右端金币徽章（数字由 coinLbl 盖在上面）
    const bx = x + w + 20, cy = y + hh / 2;
    g.fillColor = new Color(10, 8, 12, 200); g.roundRect(bx, y - 3, 132, hh + 6, 15); g.fill();
    g.strokeColor = new Color(255, 214, 120, 90); g.lineWidth = 2; g.roundRect(bx, y - 3, 132, hh + 6, 15); g.stroke();
    const cx = bx + 24;
    g.fillColor = new Color(120, 82, 20, 255); g.circle(cx, cy, 12); g.fill();
    g.fillColor = new Color(255, 202, 58, 255); g.circle(cx, cy, 10); g.fill();
    g.strokeColor = new Color(168, 112, 22, 255); g.lineWidth = 2;
    g.moveTo(cx, cy - 5); g.lineTo(cx, cy + 5); g.stroke();
    g.fillColor = new Color(255, 240, 168, 255); g.circle(cx - 3.2, cy + 3.2, 3); g.fill();
  }

  // 剑气冷却：按钮上盖一块顺时针消退的暗色扇形（转完=可用）
  private updateSkillCd() {
    const g = this.spcCdG;
    if (!g) return;
    const cd = this.hero ? this.hero.specialCd : 0;
    const total = this.specialCdCur || this.SPECIAL_CD;
    // 脏标记：冷却比例量化到 48 级，跨级才重画（冷却中 ~10Hz，就绪后零开销）
    const step = cd <= 0 ? 0 : Math.max(1, Math.ceil(Math.min(1, cd / total) * 48));
    if (step === this.spcCdKey) return;
    this.spcCdKey = step;
    g.clear();
    if (step === 0) return;
    const f = step / 48;
    const R = 53;
    g.fillColor = new Color(0, 0, 0, 145);
    g.moveTo(0, 0);
    const seg = 30;
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI / 2 - (i / seg) * f * Math.PI * 2;   // 从12点顺时针
      g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    g.close(); g.fill();
  }

  // 小怪攻击预警：起手到命中前，头顶弹出脉动的红黄感叹号（公平感）
  private drawAttackWarns(g: Graphics) {
    for (const m of this.monsters) {
      if (m.kind === 'boss' || m.state !== 'attack' || !m.attacking || m.struck) continue;
      if (m.swing >= 0.55) continue;   // 已到命中帧
      const x = this.sX(m.x), y = this.groundY + m.lane + m.jumpY + 78 * m.scale;
      const pulse = 0.65 + 0.35 * Math.sin(this.animT * 20);
      const a = Math.round(255 * pulse);
      // 底盘小圆
      g.fillColor = new Color(30, 16, 10, Math.round(170 * pulse));
      g.circle(x, y + 12, 13); g.fill();
      // 感叹号（竖条 + 点）
      g.fillColor = new Color(255, 208, 70, a);
      g.roundRect(x - 3, y + 8, 6, 15, 3); g.fill();
      g.circle(x, y + 2, 3.2); g.fill();
      g.strokeColor = new Color(225, 70, 50, a); g.lineWidth = 1.5;
      g.circle(x, y + 12, 13); g.stroke();
    }
  }

  private drawMonsterHp(g: Graphics, m: Monster) {
    const w = 46 * m.scale, x = this.sX(m.x) - w / 2, y = this.groundY + m.lane + 155 * m.scale;
    const sc = this._scratchC;
    sc.set(0, 0, 0, 150); g.fillColor = sc; g.rect(x, y, w, 7); g.fill();
    const p = Math.max(0, m.hp / m.hpMax);
    sc.set(230, 80, 80, 255); g.fillColor = sc; g.rect(x + 1, y + 1, (w - 2) * p, 5); g.fill();
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

  // 圆形技能钮：底盘投影 + 体积渐变 + 金描边 + 顶部高光 + 图标
  // 虚拟摇杆：固定底盘 + 跟手滑块。左右滑动越过死区 → 前进/后退（手机横版常用手感）。
  // 底盘的触控热区放大到整个左下角区域，手指落在附近就能拖，不必精准点中。
  private setupJoystick(cx: number, cy: number) {
    const R = 96;        // 底盘半径（滑块可移动范围）
    const KR = 50;       // 滑块半径
    const DEAD = 18;     // 死区：横向偏移小于它不触发移动
    const HIT = 300;     // 触控热区边长（比底盘大很多，好按）

    const a = (v: number) => Math.round(v * this.CTRL_ALPHA);   // 透明度乘进颜色（UIOpacity 对 Graphics 无效）

    const base = this.child('joybase');
    base.setPosition(cx, cy, 0);
    base.getComponent(UITransform)!.setContentSize(HIT, HIT);
    const bg = base.addComponent(Graphics);
    bg.fillColor = new Color(0, 0, 0, a(120)); bg.circle(0, -4, R + 8); bg.fill();              // 投影
    bg.fillColor = new Color(22, 18, 24, a(255)); bg.circle(0, 0, R + 6); bg.fill();            // 外环深底
    bg.fillColor = new Color(38, 40, 54, a(255)); bg.circle(0, 0, R); bg.fill();                // 盘面
    bg.fillColor = new Color(255, 255, 255, a(26)); bg.ellipse(0, R * 0.32, R * 0.8, R * 0.44); bg.fill();  // 顶部高光
    bg.strokeColor = new Color(255, 214, 130, a(210)); bg.lineWidth = 3; bg.circle(0, 0, R + 6); bg.stroke();
    bg.strokeColor = new Color(0, 0, 0, a(110)); bg.lineWidth = 2; bg.circle(0, 0, R); bg.stroke();
    // 左右提示箭头
    bg.fillColor = new Color(240, 245, 252, a(150));
    for (const s of [-1, 1]) { bg.moveTo(s * (R - 20), 12); bg.lineTo(s * (R - 4), 0); bg.lineTo(s * (R - 20), -12); bg.close(); bg.fill(); }
    // 上箭头提示（上推=跳）
    bg.fillColor = new Color(200, 246, 205, a(170));
    bg.moveTo(-12, R - 20); bg.lineTo(0, R - 4); bg.lineTo(12, R - 20); bg.close(); bg.fill();

    // 滑块（子节点，跟手移动）
    const knobN = new Node('joyknob'); knobN.layer = this.node.layer; knobN.parent = base;
    knobN.addComponent(UITransform); knobN.setPosition(0, 0, 0);
    const kg = knobN.addComponent(Graphics);
    kg.fillColor = new Color(0, 0, 0, a(90)); kg.circle(0, -3, KR + 4); kg.fill();
    kg.fillColor = new Color(96, 116, 158, a(255)); kg.circle(0, 0, KR); kg.fill();
    kg.fillColor = new Color(140, 162, 205, a(255)); kg.ellipse(0, KR * 0.14, KR * 0.9, KR * 0.82); kg.fill();
    kg.fillColor = new Color(255, 255, 255, a(46)); kg.ellipse(0, KR * 0.4, KR * 0.66, KR * 0.36); kg.fill();
    kg.strokeColor = new Color(255, 214, 130, a(200)); kg.lineWidth = 3; kg.circle(0, 0, KR); kg.stroke();

    const JUMP_UP = R * 0.55;   // 摇杆上推越过此值 → 起跳
    let jumpArmed = true;       // 防连跳：回到中位才重新允许下一跳
    const uiT = this.node.getComponent(UITransform)!;
    const move = (e: EventTouch) => {
      const loc = e.getUILocation();
      const p = uiT.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
      let dx = p.x - cx, dy = p.y - cy;
      const mag = Math.hypot(dx, dy);
      if (mag > R) { dx = dx / mag * R; dy = dy / mag * R; }   // 限制在底盘内
      knobN.setPosition(dx, dy, 0);
      if (dx < -DEAD) { this.leftHeld = true; this.rightHeld = false; }
      else if (dx > DEAD) { this.rightHeld = true; this.leftHeld = false; }
      else { this.leftHeld = this.rightHeld = false; }
      // 上推起跳：越过阈值触发一次，滑块回落到阈值一半以下再解锁
      if (dy > JUMP_UP) { if (jumpArmed) { jumpArmed = false; this.heroJump(); } }
      else if (dy < JUMP_UP * 0.5) { jumpArmed = true; }
    };
    const reset = () => {
      this.leftHeld = this.rightHeld = false;
      jumpArmed = true;
      tween(knobN).to(0.08, { position: new Vec3(0, 0, 0) }, { easing: 'quadOut' }).start();
    };
    base.on(Node.EventType.TOUCH_START, move, this);
    base.on(Node.EventType.TOUCH_MOVE, move, this);
    base.on(Node.EventType.TOUCH_END, reset, this);
    base.on(Node.EventType.TOUCH_CANCEL, reset, this);
    return base;
  }

  private makeCircleBtn(name: string, x: number, y: number, r: number, base: [number, number, number], icon: (g: Graphics, r: number) => void): Node {
    const n = this.child('cbtn-' + name);
    n.setPosition(x, y, 0);
    n.getComponent(UITransform)!.setContentSize(r * 2 + 18, r * 2 + 18);
    const g = n.addComponent(Graphics);
    const A = this.CTRL_ALPHA;   // 半透明系数(直接乘进每个颜色的 alpha，UIOpacity 对 Graphics 无效)
    const a = (v: number) => Math.round(v * A);
    g.fillColor = new Color(0, 0, 0, a(110)); g.circle(0, -4, r + 8); g.fill();       // 底盘投影
    g.fillColor = new Color(22, 18, 24, a(240)); g.circle(0, 0, r + 7); g.fill();     // 外环深底
    g.fillColor = new Color(Math.round(base[0] * 0.55), Math.round(base[1] * 0.55), Math.round(base[2] * 0.55), a(255));
    g.circle(0, 0, r); g.fill();                                                       // 主体深层
    g.fillColor = new Color(base[0], base[1], base[2], a(255));
    g.ellipse(0, r * 0.12, r * 0.94, r * 0.86); g.fill();                              // 主体亮层
    g.fillColor = new Color(255, 255, 255, a(34));
    g.ellipse(0, r * 0.42, r * 0.74, r * 0.4); g.fill();                               // 顶部高光
    g.strokeColor = new Color(255, 214, 130, a(210)); g.lineWidth = 3; g.circle(0, 0, r + 7); g.stroke();   // 金描边
    g.strokeColor = new Color(0, 0, 0, a(110)); g.lineWidth = 2; g.circle(0, 0, r + 1); g.stroke();
    icon(g, r);
    return n;
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
