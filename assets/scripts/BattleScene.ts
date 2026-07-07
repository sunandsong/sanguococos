import {
  _decorator, Component, Node, Graphics, Label, LabelOutline,
  UITransform, UIOpacity, Color, tween, Vec3,
  input, Input, EventKeyboard, KeyCode,
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
}

interface Monster extends Stick {
  hp: number; hpMax: number;
  atkCd: number; vx: number;
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

  private hero!: Stick & { hp: number; hpMax: number; invuln: number; atkTimer: number; attacking: boolean; hitApplied: boolean; kx: number; combo: number; specialCd: number; landT: number };
  private monsters: Monster[] = [];
  private sparks: Spark[] = [];
  private bloods: Blood[] = [];
  private waves: Wave[] = [];

  private leftHeld = false;
  private rightHeld = false;

  private score = 0;
  private spawnT = 0;
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

    this.makeLabel('⚔ 闯 关 打 怪 ⚔', 0, H / 2 - 80, 38, new Color(255, 225, 150));
    this.zoneLbl = this.makeLabel('', 0, H / 2 - 130, 30, new Color(255, 235, 190));
    this.scoreLbl = this.makeLabel('', 0, H / 2 - 172, 28, new Color(255, 240, 200));
    this.hintLbl = this.makeLabel('移动 A·D　连按3下→跳劈　剑气 K', 0, H / 2 - 210, 22, new Color(200, 200, 210));

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
      combo: 0, specialCd: 0, landT: 0,
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

  private heroSwing() {
    if (this.over || this.zoneState === 'scroll' || this.airborne()) return;
    const h = this.hero;
    if (h.atkTimer < this.SWING_DUR + this.HERO_ATK_COOLDOWN) return;   // 还在挥
    // 连招：窗口内再点 → 下一段，否则从头
    h.combo = h.atkTimer <= this.COMBO_WINDOW ? (h.combo + 1) % 3 : 0;
    h.atkType = h.combo;
    h.attacking = true; h.atkTimer = 0; h.hitApplied = false;
    if (h.atkType === 2) h.jumpVy = this.JUMP_VY;   // 第 3 段：跃起，落地下劈
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
    if (this.over || this.zoneState === 'scroll' || this.airborne()) return;
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
      h.x = this.camX + 130; h.dir = 1; h.state = 'walk'; h.phase += dt * 10;
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
      weapon: false, horns: true, hitT: 0, atkType: 0, jumpY: 0, jumpVy: 0, slamProg: 0, crouch: 0,
      hp: hpMax, hpMax, atkCd: 0, vx: 0,
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
      h.phase += dt * 10;
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

    // 跳劈物理（第 3 段）
    if (h.jumpY > 0 || h.jumpVy !== 0) {
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

    // 跳劈姿态：升起举刀 → 下落劈砍 → 落地保持劈下（用 slamProg 驱动，动作看得清）
    if (h.atkType === 2 && (h.attacking || h.landT > 0)) {
      if (h.jumpVy > 20) h.slamProg = 0.15;                                      // 上升：举刀蓄力
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
        if (h.landT > 0) cr = 1.0 * (h.landT / this.LAND_DUR);           // 落地：深蹲 → 平滑起身
        else if (h.jumpY > 1 && h.jumpVy < 0) cr = 0.25 * h.slamProg;    // 下落：微屈膝
      } else if (h.atkType === 1) {
        cr = h.swing < 0.5 ? (0.5 - h.swing) / 0.5 * 0.55 : -(h.swing - 0.5) / 0.5 * 0.3; // 上挑：先蹲后踮
      } else {
        cr = h.swing > 0.4 ? (h.swing - 0.4) / 0.6 * 0.6 : 0;            // 下劈：劈下沉身
      }
    }
    h.crouch = Math.max(-0.3, Math.min(1.0, cr));
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
        m.swing = Math.min(1, m.swing + dt * 3.5);
        if (m.atkCd <= 0) {
          m.atkCd = 1.0; m.swing = 0;
          if (h.invuln <= 0 && !this.airborne()) {   // 空中(跳劈)免伤
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
      } else {
        m.state = 'walk';
        m.phase += dt * 8;
        m.x += m.dir * 95 * dt;
        m.swing = 0;
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
    for (let i = 0; i < amount; i++) {
      const speed = 140 + Math.random() * 320;
      this.bloods.push({
        x, y,
        vx: dir * (60 + Math.random() * 240) + (Math.random() - 0.5) * 180,
        vy: 90 + Math.random() * speed,
        life: 0, max: 0.5 + Math.random() * 0.5,
        r: 3 + Math.random() * 6,
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

    const drawn = [...this.monsters].sort((a, b) => (a.state === 'dead' ? -1 : 1) - (b.state === 'dead' ? -1 : 1) || b.lane - a.lane);
    for (const m of drawn) this.drawStick(g, m);
    const h = this.hero;
    const blink = h.state !== 'dead' && h.invuln > 0 && Math.floor(h.invuln * 20) % 2 === 0;
    if (!blink) this.drawStick(g, h);

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

    this.drawHeroHp(g);
    for (const m of this.monsters) if (m.state !== 'dead' && m.hp < m.hpMax) this.drawMonsterHp(g, m);
  }

  private drawBg() {
    const g = this.bgG, W = DESIGN_W, H = DESIGN_H, gy = this.groundY;
    const t = this.theme();
    g.clear();
    // 天
    g.fillColor = new Color(t.sky[0], t.sky[1], t.sky[2], 255);
    g.rect(-W / 2, -H / 2, W, H); g.fill();
    // 远山（视差 0.4）
    g.fillColor = new Color(t.hill[0], t.hill[1], t.hill[2], 255);
    const base = gy + 210;
    g.moveTo(-W / 2, gy);
    for (let sx = -W / 2; sx <= W / 2; sx += 24) {
      const y = base + Math.sin((sx + this.camX * 0.4) * 0.008) * 70 + Math.sin((sx + this.camX * 0.4) * 0.021) * 26;
      g.lineTo(sx, y);
    }
    g.lineTo(W / 2, gy); g.close(); g.fill();
    // 地
    g.fillColor = new Color(t.ground[0], t.ground[1], t.ground[2], 255);
    g.rect(-W / 2, -H / 2, W, gy + H / 2); g.fill();
    g.strokeColor = new Color(0, 0, 0, 90); g.lineWidth = 5;
    g.moveTo(-W / 2, gy); g.lineTo(W / 2, gy); g.stroke();
    // 地面纹（全速滚动，制造前进感）
    g.strokeColor = new Color(0, 0, 0, 55); g.lineWidth = 3;
    const off = ((this.camX % 90) + 90) % 90;
    for (let sx = -W / 2 - off; sx <= W / 2; sx += 90) {
      g.moveTo(sx, gy - 8); g.lineTo(sx + 26, gy - 30);
    }
    g.stroke();
    // 场景道具（视差 0.85）
    this.drawProps(t);
  }

  private drawProps(t: Theme) {
    const g = this.bgG, W = DESIGN_W, gy = this.groundY, p = 0.85, gap = 250;
    const rnd = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5; return s - Math.floor(s); };
    const startW = Math.floor((this.camX - W) / gap) * gap;
    for (let w = startW; w < this.camX + W; w += gap) {
      const sx = (w - this.camX) * p;
      if (sx < -W / 2 - 80 || sx > W / 2 + 80) continue;
      const r = rnd(w), sz = 0.7 + r * 0.7;
      switch (t.prop) {
        case 'bush':
          g.fillColor = new Color(t.hill[0], t.hill[1], t.hill[2], 255);
          g.circle(sx, gy + 6, 22 * sz); g.fill();
          g.circle(sx - 18 * sz, gy, 15 * sz); g.fill();
          g.circle(sx + 18 * sz, gy, 15 * sz); g.fill();
          break;
        case 'tree':
          g.fillColor = new Color(80, 55, 35, 255);
          g.rect(sx - 5, gy, 10, 70 * sz); g.fill();
          g.fillColor = new Color(40, 90, 55, 255);
          g.circle(sx, gy + 80 * sz, 34 * sz); g.fill();
          break;
        case 'pine':
          g.fillColor = new Color(50, 95, 70, 255);
          g.moveTo(sx, gy + 95 * sz); g.lineTo(sx - 28 * sz, gy); g.lineTo(sx + 28 * sz, gy); g.close(); g.fill();
          g.fillColor = new Color(240, 245, 250, 255);
          g.moveTo(sx, gy + 95 * sz); g.lineTo(sx - 12 * sz, gy + 55 * sz); g.lineTo(sx + 12 * sz, gy + 55 * sz); g.close(); g.fill();
          break;
        case 'wall':
          g.fillColor = new Color(95, 90, 88, 255);
          g.rect(sx - 40 * sz, gy, 80 * sz, 110 * sz); g.fill();
          g.fillColor = new Color(70, 66, 64, 255);
          g.rect(sx - 40 * sz, gy + 110 * sz, 22 * sz, 20); g.fill();
          g.rect(sx + 18 * sz, gy + 110 * sz, 22 * sz, 20); g.fill();
          break;
        case 'tent':
          g.fillColor = new Color(150, 55, 50, 255);
          g.moveTo(sx, gy + 80 * sz); g.lineTo(sx - 46 * sz, gy); g.lineTo(sx + 46 * sz, gy); g.close(); g.fill();
          g.strokeColor = new Color(40, 20, 20, 255); g.lineWidth = 3;
          g.moveTo(sx, gy + 80 * sz); g.lineTo(sx, gy); g.stroke();
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
    const u = 22 * o.scale;
    const fx = this.sX(o.x), fy = this.groundY + o.lane + o.jumpY;   // jumpY 抬升（跳劈）
    const dir = o.dir;

    let A = 0, alpha = 255;
    if (o.state === 'dead') {
      A = Math.min(Math.PI * 0.5, o.deadT * 5) * o.fallSign;
      alpha = Math.max(0, Math.round(255 * (1 - o.deadT / 1.3)));
    }
    const k = o.hitT > 0 ? o.hitT / this.HIT_DUR : 0;
    const leanAmt = k * 1.5 * u;
    const topRef = 4.3 * u;
    const cosA = Math.cos(A), sinA = Math.sin(A);
    const T = (lx: number, ly: number): [number, number] => {
      const X = (lx - leanAmt * (ly / topRef)) * dir;
      return [fx + (X * cosA - ly * sinA), fy + (X * sinA + ly * cosA)];
    };

    const sw = Math.sin(o.phase);
    const bob = o.state === 'walk' ? Math.abs(sw) * 0.15 * u : 0;

    // 蹲/伸姿态（逻辑层已算好 o.crouch）：正=蹲下屈膝，负=踮脚起身
    const crouch = o.crouch;
    const cp = Math.max(0, crouch);
    // 髋部大幅下沉；躯干长度不变（整体下坐），头也跟着明显变矮
    const HIP = (2.1 - 1.85 * crouch) * u + bob;
    const SHO = HIP + (2.2 - 0.15 * cp) * u;              // 蹲深躯干略前压
    const headCy = SHO + 1.15 * u, headR = 0.62 * u;

    let f1x: number, f2x: number;
    if (o.state === 'walk') { const s = 0.6 * u * sw; f1x = s; f2x = -s; }
    else { const sp = (0.5 + 0.7 * cp) * u; f1x = sp; f2x = -sp; }   // 蹲时双脚张开扎马步

    const col = new Color(o.color.r, o.color.g, o.color.b, alpha);
    g.strokeColor = col; g.lineWidth = 5.5 * o.scale;
    const seg = (ax: number, ay: number, bx: number, by: number) => {
      const [x0, y0] = T(ax, ay), [x1, y1] = T(bx, by);
      hLine(g, x0, y0, x1, y1);
    };

    // 腿（带膝盖）：蹲得越深，膝盖越向外顶出 → 明显屈膝
    const kY = HIP * 0.5;
    const k1x = f1x * 0.5 + 0.6 * u * cp;   // 前腿膝盖外顶
    const k2x = f2x * 0.5 - 0.6 * u * cp;   // 后腿膝盖外顶
    seg(0, HIP, k1x, kY); seg(k1x, kY, f1x, 0);
    seg(0, HIP, k2x, kY); seg(k2x, kY, f2x, 0);
    seg(0, HIP, 0, SHO);

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
    seg(0, SHO, backHand[0], backHand[1]);
    seg(0, SHO, frontHand[0], frontHand[1]);
    g.stroke();

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
    g.strokeColor = col; g.lineWidth = 5 * o.scale * (1 + 0.4 * k);
    const [hcx, hcy] = T(0, headCy);
    hArc(g, hcx, hcy, headRk, 0, Math.PI * 2, 14); g.stroke();

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
      g.strokeColor = col; g.lineWidth = 4 * o.scale;
      const [lx1, ly1] = T(-0.5 * u, headCy + headRk * 0.7);
      const [lx2, ly2] = T(-0.9 * u, headCy + headRk * 1.7);
      const [rx1, ry1] = T(0.5 * u, headCy + headRk * 0.7);
      const [rx2, ry2] = T(0.9 * u, headCy + headRk * 1.7);
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
