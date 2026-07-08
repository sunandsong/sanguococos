import {
  _decorator, Component, Node, Graphics, Label, LabelOutline,
  UITransform, UIOpacity, Color, tween, Vec3,
  input, Input, EventKeyboard, KeyCode,
  Sprite, SpriteFrame, Texture2D, Rect, resources,
} from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
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
}

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
  @property attackRange = 100;
  @property attackDmg = 40;
  @property maxMonsters = 6;

  private readonly ZONE_SPAN = 720;   // 每关卷动一屏
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

  private readonly THEMES: Theme[] = [
    { name: '草原', sky: [120, 178, 150], hill: [72, 128, 95], ground: [96, 140, 80], prop: 'bush' },
    { name: '密林', sky: [70, 108, 90], hill: [40, 78, 58], ground: [54, 92, 60], prop: 'tree' },
    { name: '雪原', sky: [178, 198, 220], hill: [150, 168, 194], ground: [212, 222, 236], prop: 'pine' },
    { name: '城郊', sky: [112, 112, 132], hill: [80, 80, 100], ground: [122, 116, 110], prop: 'wall' },
    { name: '敌营', sky: [92, 52, 56], hill: [70, 36, 40], ground: [82, 56, 46], prop: 'tent' },
  ];

  // 主角赵云精灵
  private readonly HERO_ROW = 1;          // 用精灵表第几行（侧面朝右那行）
  private readonly SPRITE_SCALE = 1.5;    // 64px 帧放大倍数
  private heroNode!: Node;
  private heroSp!: Sprite;
  private heroOp!: UIOpacity;
  private zyFrames: SpriteFrame[] = [];    // 赵云侧面 4 帧

  private bgG!: Graphics;
  private stageG!: Graphics;
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

  // 氛围浮尘粒子（柳絮/萤火/飘雪，随场景变）
  private motes: { x: number; y: number; vx: number; vy: number; ph: number; r: number }[] = [];

  private leftHeld = false;
  private rightHeld = false;

  private score = 0;
  private spawnT = 0;
  private animT = 0;   // 全局动画时钟（飘带/呼吸等环境动效）
  private over = false;
  private arrowT = 0;

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

    const rootUI = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    rootUI.setContentSize(W, H);
    rootUI.setAnchorPoint(0.5, 0.5);
    this.node.on(Node.EventType.TOUCH_END, () => {}, this);

    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);

    this.bgG = this.child('bg').addComponent(Graphics);      // 背景每帧重画（视差 + 换场景）
    this.stageG = this.child('stage').addComponent(Graphics);

    // 主角赵云精灵节点（在 stage 之上、UI 之下）
    this.heroNode = this.child('hero');
    const hui = this.heroNode.getComponent(UITransform)!;
    hui.setContentSize(64, 64); hui.setAnchorPoint(0.5, 0);
    this.heroSp = this.heroNode.addComponent(Sprite);
    this.heroSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.heroOp = this.heroNode.addComponent(UIOpacity);
    this.heroNode.active = false;
    resources.load('zhaoyun-horse/spriteFrame', SpriteFrame, (err, base) => {
      if (err || !base) { console.warn('赵云贴图加载失败：', err); return; }
      const tex = base.texture as Texture2D;
      tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);   // 像素点采样
      for (let c = 0; c < 4; c++) {
        const sf = new SpriteFrame(); sf.texture = tex;
        sf.rect = new Rect(c * 64, this.HERO_ROW * 64, 64, 64);
        this.zyFrames.push(sf);
      }
      this.heroSp.spriteFrame = this.zyFrames[3];
    });

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

    this.makeLabel('⚔ 闯 关 打 怪 ⚔', 0, H / 2 - 80, 38, new Color(255, 225, 150));
    this.zoneLbl = this.makeLabel('', 0, H / 2 - 130, 30, new Color(255, 235, 190));
    this.scoreLbl = this.makeLabel('', 0, H / 2 - 172, 28, new Color(255, 240, 200));
    this.hintLbl = this.makeLabel('移动 A·D　跳 W/↑　攻击(连按3下→跳劈)　剑气 K', 0, H / 2 - 210, 22, new Color(200, 200, 210));

    // 「前进 →」提示（清关后出现，update 里做缩放呼吸）
    this.arrow = this.makeLabel('前进 →', W / 2 - 130, 70, 42, new Color(255, 240, 150));
    this.arrow.active = false;

    this.banner = this.child('banner');
    this.banner.setPosition(0, 90, 0);
    this.bannerLbl = this.addLabelTo(this.banner, '', 54, new Color(255, 120, 110));
    this.banner.active = false;

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
    this.camX = 0; this.zone = 0; this.zoneState = 'fight'; this.targetCam = 0;
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
    this.score = 0; this.spawnT = 0; this.over = false;
    this.leftHeld = this.rightHeld = false;
    this.banner.active = false; this.restartBtn.active = false; this.arrow.active = false;
  }

  private waveCount(zone: number): number { return Math.min(9, 4 + zone); }
  private theme(): Theme { return this.THEMES[this.zone % this.THEMES.length]; }
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
    if (this.over || this.zoneState === 'scroll') return;
    const h = this.hero;
    if (h.jumping || h.attacking || h.preJump > 0 || h.landT > 0 || this.airborne()) return;
    h.jumping = true; h.jmpPre = this.JUMP_PRE; h.jmpLand = 0;
  }

  private heroSwing() {
    if (this.over || this.zoneState === 'scroll' || this.airborne() || this.hero.jumping) return;
    const h = this.hero;
    if (h.atkTimer < this.SWING_DUR + this.HERO_ATK_COOLDOWN) return;   // 还在挥
    // 连招：窗口内再点 → 下一段，否则从头
    h.combo = h.atkTimer <= this.COMBO_WINDOW ? (h.combo + 1) % 3 : 0;
    h.atkType = h.combo;
    h.attacking = true; h.atkTimer = 0; h.hitApplied = false;
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
    if (this.over || this.zoneState === 'scroll' || this.airborne() || this.hero.jumping) return;
    const h = this.hero;
    if (h.specialCd > 0) return;
    h.specialCd = this.SPECIAL_CD;
    this.waves.push({
      x: h.x + h.dir * 40, y: this.groundY + 90, dir: h.dir,
      life: 0, max: 1.25, hit: new Set<Monster>(),
    });
    // 顺带摆个挥砍姿势
    if (!h.attacking) { h.attacking = true; h.atkTimer = 0; h.hitApplied = true; h.atkType = 0; }
  }

  // ---------- 主循环 ----------
  update(dt: number) {
    if (!this.node.active) return;
    dt = Math.min(dt, 0.05);
    this.animT += dt;
    this.stepMotes(dt);

    if (!this.over) {
      this.stepZone(dt);
      if (this.zoneState !== 'scroll') {
        this.stepHero(dt);
        this.stepMonsters(dt);
      }
    } else {
      this.hero.deadT += dt;
      for (const m of this.monsters) if (m.state === 'dead') m.deadT += dt;
    }
    if (!this.over && this.zoneState !== 'scroll') this.stepWaves(dt);
    this.cullMonsters();
    this.stepSparks(dt);
    this.stepBloods(dt);
    this.draw();

    const t = this.theme();
    this.zoneLbl.string = `第 ${this.zone + 1} 关 · ${t.name}`;
    this.scoreLbl.string = `得分 ${this.score}　❤ ${Math.max(0, Math.ceil(this.hero.hp))}`;
    this.arrow.active = !this.over && this.zoneState === 'cleared';
    if (this.arrow.active) {
      this.arrowT += dt;
      const s = 1 + 0.14 * Math.abs(Math.sin(this.arrowT * 3));
      this.arrow.setScale(s, s, 1);
    }
  }

  // 关卡节奏：刷怪 / 清关判定 / 卷屏换场
  private stepZone(dt: number) {
    if (this.zoneState === 'scroll') {
      this.camX += (this.targetCam - this.camX) * Math.min(1, dt * 3.2);
      const h = this.hero;
      h.x = this.camX + 130; h.dir = 1; h.state = 'walk'; h.phase += dt * 15;
      if (this.targetCam - this.camX < 4) {
        this.camX = this.targetCam;
        this.zone++;
        this.zoneState = 'fight';
        this.waveRemaining = this.waveCount(this.zone);
        this.spawnT = 0;
      }
      return;
    }
    if (this.zoneState === 'fight') {
      this.spawnT += dt;
      const alive = this.aliveCount();
      const interval = Math.max(0.5, 1.1 - this.zone * 0.05);
      if (this.waveRemaining > 0 && this.spawnT >= interval && alive < this.maxMonsters) {
        this.spawnT = 0;
        this.spawnMonster();
        this.waveRemaining--;
      }
      if (this.waveRemaining === 0 && alive === 0) this.zoneState = 'cleared';
    }
    // cleared：推进判定在 stepHero 里
  }

  private aliveCount(): number {
    let n = 0; for (const m of this.monsters) if (m.state !== 'dead') n++; return n;
  }

  private spawnMonster() {
    const W = DESIGN_W;
    const fromLeft = Math.random() < 0.35;   // 多数从前方(右)来
    const scale = 0.85 + Math.random() * 0.4;
    const hpMax = 60 + Math.random() * 40 + this.zone * 12;
    this.monsters.push({
      x: this.camX + (fromLeft ? -W / 2 - 30 : W / 2 + 30),
      lane: (Math.random() - 0.5) * 70,
      scale, dir: fromLeft ? 1 : -1,
      color: new Color(190, 60, 70), state: 'walk',
      phase: Math.random() * 6.28, swing: 0, deadT: 0, fallSign: 1,
      weapon: false, horns: true, hitT: 0, atkType: 0, jumpY: 0, jumpVy: 0, slamProg: 0, crouch: 0, scaleBoost: 1,
      hp: hpMax, hpMax, atkCd: 0, vx: 0, attacking: false, struck: false,
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
    }

    // 关卡边界
    const leftWall = this.camX - W / 2 + 60;
    const rightWall = this.zoneState === 'fight' ? this.camX + W / 2 - 90 : this.camX + W / 2 + 40;
    h.x = Math.max(leftWall, Math.min(rightWall, h.x));

    // 清关后走到右侧 → 触发卷屏
    if (this.zoneState === 'cleared' && h.x > this.camX + 130) {
      this.zoneState = 'scroll';
      this.targetCam = (this.zone + 1) * this.ZONE_SPAN;
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
          if (Math.abs(dx) <= mp.range && inFront) {
            const kdir = mp.both ? (dx >= 0 ? 1 : -1) : h.dir;
            m.hp -= mp.dmg;
            m.vx = kdir * mp.knock;
            if (mp.launch) m.jumpVy = mp.launch;   // 挑飞
            m.hitT = this.HIT_DUR;
            const bx = (h.x + m.x) / 2, by = this.groundY + 80 * m.scale;
            this.sparks.push({ x: bx, y: by, life: 0, max: 0.2 });
            const killed = m.hp <= 0;
            this.spawnBlood(bx, by, kdir, killed ? mp.blood + 12 : mp.blood);
            if (killed) { m.state = 'dead'; m.deadT = 0; m.fallSign = kdir; this.score++; }
          }
        }
      }
      if (h.atkType !== 2 && h.swing >= 1) h.attacking = false;
      h.state = 'attack';
    } else {
      h.state = mv !== 0 ? 'walk' : 'idle';
    }
    if (h.jumping) h.state = 'idle';   // 跳跃时用站姿（腿不做走路摆动），姿态交给 crouch

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
    for (const m of this.monsters) {
      if (m.state === 'dead') continue;
      const dx = m.x - h.x;
      if (Math.abs(dx) <= mp.range) {
        const kdir = dx >= 0 ? 1 : -1;
        m.hp -= mp.dmg;
        m.vx = kdir * mp.knock;
        if (mp.launch) m.jumpVy = mp.launch;
        m.hitT = this.HIT_DUR;
        const by = this.groundY + 80 * m.scale;
        this.sparks.push({ x: m.x, y: by, life: 0, max: 0.2 });
        const killed = m.hp <= 0;
        this.spawnBlood(m.x, by, kdir, killed ? mp.blood + 14 : mp.blood);
        if (killed) { m.state = 'dead'; m.deadT = 0; m.fallSign = kdir; this.score++; }
      }
    }
  }

  private stepMonsters(dt: number) {
    const h = this.hero;
    for (const m of this.monsters) {
      if (m.state === 'dead') { m.deadT += dt; continue; }
      if (m.hitT > 0) m.hitT -= dt;
      if (Math.abs(m.vx) > 1) { m.x += m.vx * dt; m.vx *= 0.82; }

      // 被挑飞：垂直物理，滞空期间不能行动
      if (m.jumpY > 0 || m.jumpVy !== 0) {
        m.jumpY += m.jumpVy * dt;
        m.jumpVy -= 2600 * dt;
        if (m.jumpY <= 0) { m.jumpY = 0; m.jumpVy = 0; }
      }
      if (m.jumpY > 3) { m.state = 'walk'; continue; }   // 空中随惯性飘，不攻击

      const dx = h.x - m.x, adx = Math.abs(dx);
      m.dir = dx >= 0 ? 1 : -1;
      m.atkCd -= dt;

      if (adx <= 56) {
        m.state = 'attack';
        // 起手：冷却好了才开始一次挥击（先摆动作，不立刻掉血）
        if (!m.attacking && m.atkCd <= 0) {
          m.attacking = true; m.struck = false; m.swing = 0; m.atkCd = 1.0;
        }
        if (m.attacking) {
          m.swing = Math.min(1, m.swing + dt * 3.5);
          // 挥到位（0.55）才判定命中：此刻主角仍在攻击范围内才掉血
          if (!m.struck && m.swing >= 0.55) {
            m.struck = true;
            if (adx <= 62 && h.invuln <= 0 && !this.airborne()) {   // 空中(跳劈)免伤
              h.hp -= 9 + Math.random() * 5;
              h.invuln = 0.7;
              h.hitT = this.HIT_DUR;
              const away = h.x >= m.x ? 1 : -1;
              h.kx = away * 360;
              const by = this.groundY + 90;
              this.sparks.push({ x: h.x, y: by, life: 0, max: 0.22 });
              this.spawnBlood(h.x, by, away, 14);
              if (h.hp <= 0) { this.spawnBlood(h.x, by, away, 26); this.gameOver(); }
            }
          }
          if (m.swing >= 1) m.attacking = false;   // 收招
        }
      } else {
        m.state = 'walk';
        m.phase += dt * 8;
        m.x += m.dir * 95 * dt;
        m.swing = 0;
        m.attacking = false;   // 离开攻击范围 → 取消挥击
      }
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
    const n = Math.round(amount * 1.8);   // 血滴更多
    for (let i = 0; i < n; i++) {
      const speed = 220 + Math.random() * 460;
      this.bloods.push({
        x, y,
        vx: dir * (90 + Math.random() * 360) + (Math.random() - 0.5) * 280,
        vy: 140 + Math.random() * speed,
        life: 0, max: 0.55 + Math.random() * 0.6,
        r: 5 + Math.random() * 10,          // 血滴更大
        shade: Math.random(),
      });
    }
  }

  private stepBloods(dt: number) {
    for (let i = this.bloods.length - 1; i >= 0; i--) {
      const b = this.bloods[i];
      b.life += dt;
      b.vy -= 1100 * dt;
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
        if (Math.abs(m.x - w.x) <= 46) {
          w.hit.add(m);
          m.hp -= this.attackDmg * 1.2;
          m.vx = w.dir * 280;
          m.hitT = this.HIT_DUR;
          const by = this.groundY + 80 * m.scale;
          this.sparks.push({ x: m.x, y: by, life: 0, max: 0.2 });
          const killed = m.hp <= 0;
          this.spawnBlood(m.x, by, w.dir, killed ? 22 : 12);
          if (killed) { m.state = 'dead'; m.deadT = 0; m.fallSign = w.dir; this.score++; }
        }
      }
      if (w.life >= w.max) this.waves.splice(i, 1);
    }
  }

  private gameOver() {
    this.over = true;
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
    const g = this.stageG;
    g.clear();

    // 阴影垫底（角色脚下）
    const h = this.hero;
    if (h.state !== 'dead') this.drawShadow(g, h.x, 0, 40, h.jumpY);
    for (const m of this.monsters) if (m.state !== 'dead') this.drawShadow(g, m.x, m.lane, 26 * m.scale, m.jumpY);

    const drawn = [...this.monsters].sort((a, b) => (a.state === 'dead' ? -1 : 1) - (b.state === 'dead' ? -1 : 1) || b.lane - a.lane);
    for (const m of drawn) this.drawPixelSoldier(g, m);
    const blink = h.state !== 'dead' && h.invuln > 0 && Math.floor(h.invuln * 20) % 2 === 0;
    this.updateHeroSprite(blink);

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

    this.drawMotes(g);   // 氛围浮尘（在角色之上飘）
    this.drawHeroHp(g);
    for (const m of this.monsters) if (m.state !== 'dead' && m.hp < m.hpMax) this.drawMonsterHp(g, m);
  }

  // 主角赵云精灵：定位/翻转/选帧（玩法状态 → 精灵帧）
  private updateHeroSprite(blink: boolean) {
    const h = this.hero;
    if (this.zyFrames.length < 4) { this.heroNode.active = false; return; }
    this.heroNode.active = !blink || h.state === 'dead';

    const sx = this.sX(h.x);
    let y = this.groundY + h.jumpY - Math.max(0, h.crouch) * 24;   // 蹲/跳的高度
    let ang = 0;
    if (h.state === 'walk') {          // 无走路帧 → 用骑行颠簸模拟
      const gp = this.animT * 13;
      y += Math.abs(Math.sin(gp)) * 9; // 上下颠
      ang = Math.sin(gp) * 3.5;        // 前后轻摇
    }
    this.heroNode.setPosition(sx, y, 0);

    const S = this.SPRITE_SCALE * (h.scaleBoost || 1);
    // 精灵默认朝左：朝右(dir>=0)时水平翻转
    this.heroNode.setScale(h.dir >= 0 ? -S : S, S, 1);

    // 选帧：攻击→按进度播 0..3（第2帧带枪气），其余→待机/骑行帧
    let idx = 3;
    if (h.state === 'attack') {
      const p = h.atkType === 2 ? h.slamProg : h.swing;
      idx = Math.max(0, Math.min(3, Math.floor(p * 4)));
    }
    this.heroSp.spriteFrame = this.zyFrames[idx];

    // 死亡：倾倒 + 淡出
    if (h.state === 'dead') {
      this.heroNode.angle = (h.dir >= 0 ? -1 : 1) * Math.min(80, h.deadT * 170);
      this.heroOp.opacity = Math.max(0, Math.round(255 * (1 - h.deadT / 1.4)));
    } else {
      this.heroNode.angle = ang;
      this.heroOp.opacity = 255;
    }
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
    const armor = hit ? new Color(255, 255, 255, alpha) : new Color(178, 54, 48, alpha);
    const armorD = new Color(118, 32, 30, alpha);
    const dark = new Color(42, 34, 40, alpha);
    const steel = new Color(184, 188, 200, alpha);
    const plume = new Color(226, 62, 52, alpha);

    // 中心对齐方块：cx=水平偏移, by=底边离地高, w/h=尺寸
    const R = (cx: number, by: number, w: number, h: number, c: Color) => {
      g.fillColor = c; g.rect(sx + cx - w / 2, gy + by, w, h); g.fill();
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
    // 头 + 盔
    R(0, 5.3 * u * sy, 2.0 * u, 1.9 * u * sy, skin);
    R(0.42 * u * dir, 6.0 * u * sy, 0.42 * u, 0.42 * u, dark);  // 眼
    R(0, 6.7 * u * sy, 2.4 * u, 0.9 * u, armorD);               // 盔
    R(0, 7.4 * u * sy, 0.6 * u, 0.9 * u, plume);                // 盔缨
    // 长枪（朝向 dir）：攻击时前刺
    const thrust = m.attacking ? m.swing * 2.4 * u : 0;
    const spLen = 3.4 * u + thrust;
    const spY = gy + 4.1 * u * sy;
    const spX = dir > 0 ? sx + 1.0 * u : sx - 1.0 * u - spLen;
    g.fillColor = steel; g.rect(spX, spY, spLen, 0.36 * u); g.fill();
    g.fillColor = plume; g.rect(dir > 0 ? spX + spLen - 0.5 * u : spX, spY - 0.15 * u, 0.5 * u, 0.66 * u); g.fill();  // 红缨枪头
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
    const name = this.theme().name;
    let col: number[];
    if (name === '密林') col = [200, 240, 150];        // 萤火
    else if (name === '雪原') col = [240, 246, 255];   // 飘雪
    else if (name === '城郊') col = [205, 195, 175];   // 浮尘
    else if (name === '敌营') col = [255, 150, 80];    // 火星
    else col = [238, 246, 232];                        // 柳絮
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

  private drawBg() {
    const g = this.bgG, W = DESIGN_W, H = DESIGN_H, gy = this.groundY;
    const t = this.theme();
    const PX = 12;
    g.clear();

    // 天空 3 段（上暗下亮）
    g.fillColor = this.sh(t.sky, 0.82); g.rect(-W / 2, gy + 340, W, H); g.fill();
    g.fillColor = this.sh(t.sky, 0.92); g.rect(-W / 2, gy + 170, W, 170); g.fill();
    g.fillColor = new Color(t.sky[0], t.sky[1], t.sky[2], 255); g.rect(-W / 2, gy, W, 170); g.fill();

    // 远/近山：量化成像素台阶
    const layer = (par: number, amp: number, baseH: number, fac: number, ph: number) => {
      g.fillColor = this.sh(t.hill, fac);
      for (let sx = -W / 2; sx < W / 2; sx += PX) {
        const wx = sx + this.camX * par + ph;
        const hRaw = gy + baseH + Math.sin(wx * 0.008) * amp + Math.sin(wx * 0.019) * amp * 0.4;
        const hy = Math.round(hRaw / PX) * PX;
        g.rect(sx, gy, PX + 1, hy - gy); g.fill();
      }
    };
    layer(0.35, 55, 150, 0.78, 400);   // 远山（矮、暗）
    layer(0.55, 95, 230, 1.0, 0);      // 近山

    // 地面
    g.fillColor = new Color(t.ground[0], t.ground[1], t.ground[2], 255);
    g.rect(-W / 2, -H / 2, W, gy + H / 2); g.fill();
    // 地表棋盘抖动边（随镜头滚动）
    g.fillColor = this.sh(t.ground, 0.72);
    const step = Math.floor(((this.camX % (PX * 2)) + PX * 2) % (PX * 2) / PX);
    for (let i = 0; i * PX < W + PX; i++) {
      if ((i + step) % 2 === 0) { g.rect(-W / 2 + i * PX, gy - PX, PX, PX); g.fill(); }
    }
    // 地面横向暗纹（几层，营造纵深）
    for (let r = 1; r <= 4; r++) {
      g.fillColor = this.sh(t.ground, 1 - r * 0.05);
      g.rect(-W / 2, gy - PX * 2 - r * PX * 3, W, PX); g.fill();
    }
    this.drawProps(t, PX);
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
