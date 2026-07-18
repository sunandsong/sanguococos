import {
  _decorator, Component, Node, Graphics, Color, UITransform, Layers,
  input, Input, EventKeyboard, KeyCode, UIOpacity, tween,
} from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { HeroRig, HeroMode } from './HeroRig';
import { HeroCombat } from './HeroCombat';
import { TouchControls } from './TouchControls';
import { HeroHUD } from './HeroHUD';
import { DeathFx } from './DeathFx';
import { AudioMgr } from './AudioMgr';
import { JUMP } from './JumpKit';
import { Chapter2Well } from './Chapter2Well';

const { ccclass } = _decorator;

// ─────────────────────────────────────────────────────────────
// 第二章 · 空城(跑酷 Demo,程序化原型)
//   怪诞荒城一条街:歪楼/亮窗/停摆钟楼,障碍四件套(板车=滑铲/砖墙=跳/
//   星空裂缝=跳+踩空掉血/倒浮伞=超级跳),二段跳,街尾老井 → 跳井接井关(第三章)。
//   角色/操控/HUD/阵亡全部复用套件;美术后续按空城概念图换真图。
// ─────────────────────────────────────────────────────────────

type Obst = { x: number; type: 'low' | 'high' | 'gap' | 'tramp'; w?: number };   // w=裂缝自定义宽(宽缝要二段跳/踩伞)

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
  private readonly SPEED = 300;
  private readonly LENGTH = 13000;         // 街长,尽头是井

  private px = 120; private py = this.GROUND; private vy = 0; private onG = true;
  private dir = 1; private walkPh = 0; private camX = 0; private t = 0;
  private jumpsUsed = 0;                   // 二段跳计数(落地清零)
  private slideT = 0; private slideCd = 0; private slideDir = 1;
  private slamJump = false; private slamLandT = 0;
  private stunT = 0;                       // 撞障碍硬直
  private fallT = 0; private fallX = 0;    // 裂缝跌落演出
  private over = false; private deadT = 0;
  private hp = 100; private coins = 0;
  private exiting = false;
  private keys = { left: false, right: false };

  // 障碍布置(按 x 排,十个小节:教学 → 组合渐密 → 终段冲刺)
  private readonly OBST: Obst[] = [
    // ① 教学:四件套各来一次,间隔大
    { x: 700, type: 'low' }, { x: 1150, type: 'high' }, { x: 1600, type: 'gap' }, { x: 2050, type: 'tramp' },
    // ② 连环板车:三连滑铲(一铲滑不完,节奏铲)
    { x: 2500, type: 'low' }, { x: 2760, type: 'low' }, { x: 3020, type: 'low' },
    // ③ 缝墙交替:跳缝落地立刻起跳翻墙
    { x: 3450, type: 'gap' }, { x: 3700, type: 'high' }, { x: 3950, type: 'gap' }, { x: 4200, type: 'high' },
    // ④ 宽缝:单跳过不去,必须二段跳
    { x: 4700, type: 'gap', w: 200 }, { x: 5150, type: 'gap', w: 220 },
    // ⑤ 伞跳星河:踩伞超级跳飞越巨缝
    { x: 5750, type: 'tramp' }, { x: 6050, type: 'gap', w: 260 },
    // ⑥ 墙缝墙:翻墙→跳缝→翻墙一气呵成
    { x: 6600, type: 'high' }, { x: 6800, type: 'gap' }, { x: 7000, type: 'high' },
    // ⑦ 低高交替:铲→跳→铲→跳节奏切换
    { x: 7450, type: 'low' }, { x: 7660, type: 'high' }, { x: 7870, type: 'low' }, { x: 8080, type: 'high' },
    // ⑧ 三连缝:连跳不许停
    { x: 8500, type: 'gap' }, { x: 8760, type: 'gap' }, { x: 9020, type: 'gap' },
    // ⑨ 伞上双墙:踩伞借高度连翻两堵墙
    { x: 9450, type: 'tramp' }, { x: 9700, type: 'high' }, { x: 9850, type: 'high' },
    // ⑩ 终段冲刺:全家桶密集混排,井前最后考验
    { x: 10300, type: 'low' }, { x: 10520, type: 'gap' }, { x: 10780, type: 'low' }, { x: 11000, type: 'high' },
    { x: 11220, type: 'gap', w: 200 }, { x: 11560, type: 'low' }, { x: 11780, type: 'high' },
    { x: 12000, type: 'gap' }, { x: 12260, type: 'low' },
    // 屋内障碍(钻屋路线的代价:低矮房梁下只能滑铲)
    { x: 4420, type: 'low' }, { x: 10080, type: 'low' },
  ];
  private readonly GAP_W = 120; private readonly TRAMP_Y = 128;
  // 检查点(布告旗):阵亡从最近一面旗复活,不用整街重跑
  private readonly CKPT = [120, 3300, 6450, 10050];
  private ckpt = 0;
  // 临街小屋:屋里能穿堂(cutaway 剖面,桌上饭还冒热气),屋顶=单向平台能跳上去跑
  //   双路线:钻屋(有的屋里藏板车,得滑铲)or 翻屋顶(绕开地面障碍+吃金币)
  private readonly HOUSES = [
    { x1: 2150, x2: 2420, h: 170 },   // 教学屋:第一次上屋顶(踩 2050 的伞弹上来也行)
    { x1: 4270, x2: 4560, h: 170 },   // 屋里 4420 藏板车:钻屋滑铲 or 上顶绕过
    { x1: 5250, x2: 5700, h: 190 },   // 屋顶下来正好接 5750 的伞
    { x1: 6250, x2: 6560, h: 170 },   // 屋顶助跑直接飞越 6600 的墙
    { x1: 8150, x2: 8380, h: 170 },   // 三连缝前的歇脚屋
    { x1: 9900, x2: 10250, h: 170 },  // 屋里 10080 藏板车
    { x1: 12360, x2: 12700, h: 170 }, // 井前最后一栋:屋顶跑到头跳向老井
  ];
  private coinsArr: { x: number; y: number }[] = [];
  private got = new Set<number>();

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    const gn = new Node('city-gfx'); gn.layer = Layers.Enum.UI_2D; gn.parent = this.node; gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);

    const fx = new Node('city-fx'); fx.layer = Layers.Enum.UI_2D; fx.parent = this.node; fx.addComponent(UITransform);
    this.hero = new HeroRig(this.node, fx);
    this.hero.ambient = new Color(236, 230, 244, 255);   // 空城淡紫暮色环境光
    this.combat = new HeroCombat(fx, this.hero);

    this.controls = new TouchControls(this.node, {
      onDir: (d) => { this.keys.left = d < 0; this.keys.right = d > 0; },
      onAxis: () => { },
      onJump: () => this.jump(),
      onDash: (d) => { this.dir = d as 1 | -1; this.slide(); },
      onAttack: () => this.attack(),
      onSlide: () => this.slide(),
    }, { alpha: 0.5 });
    this.hud = new HeroHUD(this.node);
    this.deathFx = new DeathFx(this.node, () => {
      this.deathFx.hide(); this.over = false; this.deadT = 0; this.hp = 100;
      this.px = this.CKPT[this.ckpt]; this.py = this.GROUND; this.vy = 0; this.onG = true; this.dir = 1;
      this.slideT = 0; this.stunT = 0; this.fallT = 0; this.combat.reset();
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
    if (this.over || this.fallT > 0 || this.stunT > 0) return;
    if (this.onG) { this.vy = JUMP.VY; this.onG = false; this.jumpsUsed = 1; AudioMgr.inst.play('jump', 0.7); }
    else if (this.jumpsUsed < 2) { this.vy = JUMP.VY * 0.92; this.jumpsUsed = 2; AudioMgr.inst.play('jump', 0.8); }   // 二段跳
  }
  private attack() {
    if (this.over || this.slamJump || this.fallT > 0 || this.stunT > 0) return;
    const type = this.combat.tryAttack();
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
  private slamImpact() { this.slamJump = false; this.slamLandT = 0.22; this.hero.slamImpactFx(this.HERO_SX, this.py, H / 2); }

  // 支撑面:脚下最高的可站面(屋顶=单向平台,只算不高于参考脚高的面)
  private surfaceAt(x: number, yRef: number) {
    let s = this.GROUND;
    for (const hs of this.HOUSES) {
      const top = this.GROUND + hs.h;
      if (x >= hs.x1 - 8 && x <= hs.x2 + 8 && top <= yRef + 2 && top > s) s = top;
    }
    return s;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05); this.t += dt;
    if (this.slamLandT > 0) this.slamLandT -= dt;
    if (this.slideCd > 0) this.slideCd -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.over) { this.deadT += dt; this.updateHero(); this.redraw(); return; }

    // 裂缝跌落演出:掉下去→拉回缝左沿
    if (this.fallT > 0) {
      this.fallT -= dt;
      this.py -= 620 * dt;
      if (this.fallT <= 0) {
        this.px = this.fallX; this.py = this.GROUND; this.vy = 0; this.onG = true; this.jumpsUsed = 0;
        this.hurt(12); AudioMgr.inst.play('hurt', 0.7);
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
      // 弹跳伞:下落中砸到伞面 → 超级跳
      if (this.vy < 0) {
        for (const o of this.OBST) if (o.type === 'tramp') {
          const uy = this.GROUND + this.TRAMP_Y;
          if (Math.abs(this.px - o.x) < 46 && this.py <= uy + 14 && this.py >= uy - 26) {
            this.vy = JUMP.VY * 1.45; this.py = uy + 14; this.jumpsUsed = 1;   // 弹起再送一次二段跳
            AudioMgr.inst.play('jump', 1.0);
            break;
          }
        }
      }
      if (this.vy <= 0) {
        const s = this.surfaceAt(this.px, prevPy);   // 用下落前脚高筛掉头顶上方的面(可从屋里跳穿屋顶)
        if (prevPy >= s && this.py <= s) {
          this.py = s; this.vy = 0; this.onG = true; this.jumpsUsed = 0;
          if (this.slamJump) this.slamImpact();
        }
      }
    }

    // 障碍碰撞
    for (const o of this.OBST) {
      const dx = this.px - o.x;
      if (o.type === 'low') {
        // 板车:半宽46,杆高~56 —— 滑铲/高跳通过,否则撞停+硬直
        if (Math.abs(dx) < 46 && this.slideT <= 0 && this.py < this.GROUND + 56) {
          this.px = o.x + (dx >= 0 ? 46 : -46);
          if (this.stunT <= 0 && Math.abs(prevX - this.px) > 0.1) { this.stunT = 0.28; AudioMgr.inst.play('hit', 0.4); }
        }
      } else if (o.type === 'high') {
        // 砖墙:半宽34,高92 —— 只能跳过
        if (Math.abs(dx) < 34 && this.py < this.GROUND + 92) {
          this.px = o.x + (dx >= 0 ? 34 : -34);
        }
      } else if (o.type === 'gap') {
        // 星空裂缝:走进缝里且在地面 → 跌落(宽缝 w 另定)
        const gw = o.w ?? this.GAP_W;
        if (this.onG && this.py <= this.GROUND + 2 && Math.abs(dx) < gw / 2 - 14) {
          this.fallT = 0.55; this.fallX = o.x - gw / 2 - 34; this.onG = false; this.vy = 0;
          this.slamJump = false;
        }
      }
    }

    // 检查点:跑过布告旗就记档
    while (this.ckpt < this.CKPT.length - 1 && this.px > this.CKPT[this.ckpt + 1]) {
      this.ckpt++; AudioMgr.inst.play('coin', 0.8);
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

    this.camX = this.px - this.HERO_SX;
    this.combat.update(dt, this.HERO_SX, this.py, this.dir);
    this.hero.updateFx(dt, this.HERO_SX, this.surfaceAt(this.px, this.py));
    this.controls.setSpecialCd(this.slideCd / 0.75);
    this.updateHero(); this.redraw();
    this.hud.set(this.hp, 100, this.hp, this.coins, 1);
  }

  private updateHero() {
    const sh = this.surfaceAt(this.px, this.py);   // 影子落在脚下支撑面(屋顶上影子贴屋顶)
    if (this.over) { this.hero.apply(this.HERO_SX, this.py, this.dir, 'dead', this.deadT, 0, 0, 0, sh); return; }
    let mode: HeroMode = 'idle'; let p = 0;
    const a = this.combat.anim();
    if (this.fallT > 0) { mode = 'air'; }
    else if (this.slamJump) { mode = 'slam'; p = this.vy > 0 ? 0.1 : 0.5; }
    else if (this.slamLandT > 0) { mode = 'slam'; p = 0.95; }
    else if (a) { mode = a.mode; p = a.p; }
    else if (this.slideT > 0 && this.onG) { mode = 'slide'; p = 1 - this.slideT / 0.5; }
    else if (!this.onG) mode = 'air';
    else if (this.keys.left || this.keys.right) mode = 'walk';
    this.hero.apply(this.HERO_SX, this.py, this.dir, mode, p, -this.vy, this.walkPh, 0, sh);
  }

  // 稳定伪随机(按种子)
  private rnd(s: number) { return ((Math.sin(s * 127.1) * 43758.5) % 1 + 1) % 1; }
  private sx(wx: number) { return wx - this.camX; }

  private redraw() {
    const g = this.g; g.clear();
    const gy = this.GROUND;
    // 天空:灰紫→淡薄荷渐变
    const top = [186, 172, 208], bot = [206, 226, 214], bands = 8;
    for (let i = 0; i < bands; i++) {
      const k = i / (bands - 1);
      g.fillColor = new Color(
        Math.round(top[0] + (bot[0] - top[0]) * k),
        Math.round(top[1] + (bot[1] - top[1]) * k),
        Math.round(top[2] + (bot[2] - top[2]) * k), 255);
      g.rect(-W / 2, H / 2 - (i + 1) * (H / 2 - gy) / bands, W, (H / 2 - gy) / bands + 1); g.fill();
    }
    // 远景:歪楼剪影(慢视差,朝井方向微倾)
    const farOff = this.camX * 0.3;
    for (let i = 0; i < 26; i++) {
      const bx = i * 340 + this.rnd(i) * 120 - farOff;
      if (bx < -W / 2 - 300 || bx > W / 2 + 300) continue;
      const bw = 130 + this.rnd(i + 9) * 110, bh = 210 + this.rnd(i + 3) * 260;
      const tilt = (this.rnd(i + 5) - 0.35) * 46 + 12;   // 整体略朝右(朝井)倾
      g.fillColor = new Color(112, 96, 132, 255);
      g.moveTo(bx, gy); g.lineTo(bx + bw, gy); g.lineTo(bx + bw + tilt, gy + bh); g.lineTo(bx + tilt, gy + bh * (0.9 + this.rnd(i + 7) * 0.2)); g.close(); g.fill();
      if (i % 4 === 0) {   // 停摆钟楼
        g.fillColor = new Color(96, 82, 116, 255); g.circle(bx + bw / 2 + tilt, gy + bh + 26, 24); g.fill();
        g.strokeColor = new Color(226, 214, 186, 220); g.lineWidth = 3;
        g.circle(bx + bw / 2 + tilt, gy + bh + 26, 17); g.stroke();
        g.moveTo(bx + bw / 2 + tilt, gy + bh + 26); g.lineTo(bx + bw / 2 + tilt + 8, gy + bh + 20); g.stroke();
      }
    }
    // 中景:临街歪楼(亮窗,中速视差)
    const midOff = this.camX * 0.62;
    for (let i = 0; i < 46; i++) {
      const bx = i * 300 + this.rnd(i + 40) * 90 - midOff;
      if (bx < -W / 2 - 320 || bx > W / 2 + 320) continue;
      const bw = 150 + this.rnd(i + 41) * 90, bh = 150 + this.rnd(i + 42) * 170;
      const tilt = (this.rnd(i + 43) - 0.3) * 34 + 8;
      g.fillColor = new Color(140, 124, 150, 255);
      g.moveTo(bx, gy); g.lineTo(bx + bw, gy); g.lineTo(bx + bw + tilt, gy + bh); g.lineTo(bx + tilt, gy + bh); g.close(); g.fill();
      g.fillColor = new Color(108, 94, 122, 255);   // 屋顶歪檐
      g.rect(bx + tilt - 8, gy + bh, bw + 16, 12); g.fill();
      // 亮窗(暖琥珀,无人却亮着=诡)
      for (let wi = 0; wi < 3; wi++) {
        if (this.rnd(i * 7 + wi) < 0.4) continue;
        g.fillColor = new Color(255, 202, 120, 235);
        g.rect(bx + 22 + wi * (bw - 44) / 2 + tilt * 0.5, gy + bh * 0.35 + this.rnd(i + wi) * bh * 0.3, 20, 26); g.fill();
      }
      // 二楼虚空门(怪诞):偶尔一扇门开在半空
      if (this.rnd(i + 44) < 0.22) {
        g.fillColor = new Color(70, 58, 88, 255);
        g.rect(bx + bw * 0.4 + tilt * 0.6, gy + bh * 0.55, 26, 42); g.fill();
      }
    }
    // 街面:扭曲石板路
    g.fillColor = new Color(150, 148, 162, 255);
    g.rect(-W / 2, -H / 2, W, gy + H / 2); g.fill();
    g.strokeColor = new Color(120, 118, 134, 255); g.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const lx = i * 170 + this.rnd(i + 60) * 60 - this.camX;
      if (lx < -W / 2 - 40 || lx > W / 2 + 40) continue;
      g.moveTo(lx, gy); g.lineTo(lx + (this.rnd(i + 61) - 0.5) * 40, gy - 60 - this.rnd(i + 62) * 60); g.stroke();
    }
    // 白草(砖缝里)
    for (let i = 0; i < 60; i++) {
      const lx = i * 110 + this.rnd(i + 70) * 70 - this.camX;
      if (lx < -W / 2 - 20 || lx > W / 2 + 20) continue;
      g.strokeColor = new Color(226, 226, 214, 200); g.lineWidth = 2;
      g.moveTo(lx, gy); g.lineTo(lx + (this.rnd(i + 71) - 0.5) * 8, gy + 10 + this.rnd(i + 72) * 10); g.stroke();
    }
    // 问号路灯(每隔一段)
    for (let i = 0; i < 16; i++) {
      const lx = i * 460 + 150 - this.camX;
      if (lx < -W / 2 - 80 || lx > W / 2 + 80) continue;
      g.strokeColor = new Color(66, 58, 80, 255); g.lineWidth = 6;
      g.moveTo(lx, gy); g.lineTo(lx, gy + 130);
      g.lineTo(lx + 26, gy + 152); g.lineTo(lx + 44, gy + 138); g.stroke();
      g.fillColor = new Color(255, 214, 140, 240); g.circle(lx + 46, gy + 132, 9); g.fill();
    }
    // 临街小屋(剖面):屋里能穿堂,屋顶=可站平台
    for (const hs of this.HOUSES) {
      const x1 = this.sx(hs.x1), x2 = this.sx(hs.x2);
      if (x2 < -W / 2 - 60 || x1 > W / 2 + 60) continue;
      const top = gy + hs.h;
      // 屋内暖墙 + 踢脚线("人刚消失"的暖)
      g.fillColor = new Color(226, 208, 180, 255); g.rect(x1, gy, x2 - x1, hs.h - 12); g.fill();
      g.fillColor = new Color(196, 176, 150, 255); g.rect(x1, gy, x2 - x1, 26); g.fill();
      // 后墙小窗透薄荷天色
      g.fillColor = new Color(198, 224, 210, 255); g.rect((x1 + x2) / 2 - 16, gy + hs.h * 0.45, 32, 30); g.fill();
      // 桌子 + 一碗还冒热气的饭(全城人一夜消失的现场)
      const tx = x1 + (x2 - x1) * 0.32;
      g.fillColor = new Color(150, 112, 76, 255); g.rect(tx - 34, gy + 34, 68, 8); g.fill();
      g.rect(tx - 26, gy, 8, 34); g.fill(); g.rect(tx + 18, gy, 8, 34); g.fill();
      g.fillColor = new Color(240, 238, 230, 255); g.ellipse(tx, gy + 46, 13, 7); g.fill();
      g.strokeColor = new Color(255, 255, 255, 150); g.lineWidth = 2;
      const st = this.t * 2.2;
      for (let k = 0; k < 2; k++) {
        const sxx = tx - 5 + k * 10;
        g.moveTo(sxx + Math.sin(st + k) * 3, gy + 56);
        g.lineTo(sxx + Math.sin(st + k + 1.3) * 4, gy + 68);
        g.lineTo(sxx + Math.sin(st + k + 2.6) * 3, gy + 80); g.stroke();
      }
      // 吊灯暖光
      const lx2 = x1 + (x2 - x1) * 0.68;
      g.strokeColor = new Color(120, 100, 84, 255); g.lineWidth = 3;
      g.moveTo(lx2, top - 12); g.lineTo(lx2, top - 34); g.stroke();
      g.fillColor = new Color(255, 206, 130, 45); g.circle(lx2, top - 40, 26); g.fill();
      g.fillColor = new Color(255, 206, 130, 240); g.circle(lx2, top - 40, 8); g.fill();
      // 两端敞开的门柱(能进能出)
      g.fillColor = new Color(122, 96, 116, 255);
      g.rect(x1 - 6, gy, 14, hs.h - 8); g.fill(); g.rect(x2 - 8, gy, 14, hs.h - 8); g.fill();
      // 屋顶板(=平台面)+ 歪瓦檐
      g.fillColor = new Color(96, 80, 108, 255); g.rect(x1 - 20, top - 14, x2 - x1 + 40, 14); g.fill();
      g.fillColor = new Color(112, 94, 124, 255);
      for (let k = 0; k < Math.floor((x2 - x1 + 40) / 26); k++) { g.rect(x1 - 20 + k * 26, top - 6, 20, 6); g.fill(); }
    }
    // 障碍四件套
    for (const o of this.OBST) {
      const ox = this.sx(o.x);
      if (ox < -W / 2 - 160 || ox > W / 2 + 160) continue;
      if (o.type === 'low') {
        // 翻倒板车:车板+两个轮子
        g.fillColor = new Color(124, 92, 62, 255); g.rect(ox - 46, gy + 26, 92, 16); g.fill();
        g.fillColor = new Color(100, 72, 48, 255); g.rect(ox - 40, gy, 12, 30); g.fill(); g.rect(ox + 28, gy, 12, 30); g.fill();
        g.strokeColor = new Color(70, 52, 36, 255); g.lineWidth = 3;
        g.circle(ox - 22, gy + 50, 14); g.stroke(); g.circle(ox + 20, gy + 50, 14); g.stroke();
      } else if (o.type === 'high') {
        // 塌半截砖墙
        g.fillColor = new Color(158, 128, 118, 255); g.rect(ox - 34, gy, 68, 84); g.fill();
        g.fillColor = new Color(178, 148, 136, 255);
        for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 3; c2++)
          g.rect(ox - 30 + c2 * 22 + (r % 2) * 8, gy + 6 + r * 20, 18, 14), g.fill();
        g.fillColor = new Color(138, 110, 102, 255); g.rect(ox - 34, gy + 84, 40, 8); g.fill();
      } else if (o.type === 'gap') {
        // 星空裂缝:深蓝洞+星星(宽缝更深更多星)
        const gw = o.w ?? this.GAP_W;
        g.fillColor = new Color(24, 22, 52, 255);
        g.moveTo(ox - gw / 2, gy); g.lineTo(ox + gw / 2, gy);
        g.lineTo(ox + gw / 2 - 16, gy - 70 - (gw - 120) * 0.3); g.lineTo(ox - gw / 2 + 12, gy - 60 - (gw - 120) * 0.3); g.close(); g.fill();
        const stars = Math.round(gw / 20);
        for (let s2 = 0; s2 < stars; s2++) {
          const tw = 0.5 + 0.5 * Math.sin(this.t * 3 + s2 * 2.1);
          g.fillColor = new Color(220, 225, 255, Math.round(140 + 100 * tw));
          g.circle(ox - gw / 2 + 18 + s2 * (gw - 36) / Math.max(1, stars - 1), gy - 16 - this.rnd(o.x + s2) * 40, 2 + tw); g.fill();
        }
      } else if (o.type === 'tramp') {
        // 倒浮的伞(微微上下漂)
        const uy = gy + this.TRAMP_Y + Math.sin(this.t * 2 + o.x) * 6;
        g.fillColor = new Color(214, 120, 138, 255);
        g.moveTo(ox - 44, uy + 10);
        for (let k = 0; k <= 10; k++) { const a2 = Math.PI - (k / 10) * Math.PI; g.lineTo(ox + Math.cos(a2) * 44, uy + 10 - Math.sin(a2) * 20); }
        g.close(); g.fill();
        g.strokeColor = new Color(150, 74, 92, 255); g.lineWidth = 3;
        for (let k = 1; k < 4; k++) { g.moveTo(ox - 44 + k * 22, uy + 10); g.lineTo(ox - 44 + k * 22, uy + 2 - Math.sin((k / 4) * Math.PI) * 8); g.stroke(); }
        g.strokeColor = new Color(120, 100, 90, 255); g.lineWidth = 3;
        g.moveTo(ox, uy + 10); g.lineTo(ox, uy + 40); g.stroke();
        g.strokeColor = new Color(255, 255, 255, 60); g.lineWidth = 2; g.circle(ox, uy + 2, 52); g.stroke();   // 微光提示可踩
      }
    }
    // 检查点布告旗:黄泉纸幡样式,已激活的亮薄荷光
    for (let ci = 1; ci < this.CKPT.length; ci++) {
      const fxp = this.sx(this.CKPT[ci]);
      if (fxp < -W / 2 - 60 || fxp > W / 2 + 60) continue;
      const on = this.ckpt >= ci;
      g.strokeColor = new Color(84, 72, 96, 255); g.lineWidth = 5;
      g.moveTo(fxp, gy); g.lineTo(fxp, gy + 150); g.stroke();
      const wav = Math.sin(this.t * 3 + ci) * 6;
      g.fillColor = on ? new Color(160, 235, 205, 250) : new Color(214, 206, 190, 240);
      g.moveTo(fxp, gy + 150); g.lineTo(fxp + 54 + wav, gy + 136); g.lineTo(fxp, gy + 118); g.close(); g.fill();
      if (on) { g.fillColor = new Color(160, 235, 205, 60); g.circle(fxp, gy + 136, 30); g.fill(); }
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
