import {
  _decorator, Component, Node, Graphics, Label, LabelOutline, UITransform, UIOpacity,
  Color, tween, Layers, input, Input, EventKeyboard, KeyCode, Sprite, SpriteFrame, Texture2D,
} from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { AudioMgr } from './AudioMgr';
import { AssetHub } from './AssetHub';
import { HeroRig, HeroMode } from './HeroRig';
import { HeroCombat } from './HeroCombat';
import { HeroHUD } from './HeroHUD';
import { DeathFx } from './DeathFx';
import { CamZoom } from './CamZoom';
import { TouchControls } from './TouchControls';
import { Chapter2Arena } from './Chapter2Arena';
const { ccclass } = _decorator;

// ─────────────────────────────────────────────────────────────
// 第二章·夜行列车:空城街尾上车,车顶一路打怪开进机务段(接铁心兽 Boss)。
//   火车静在屏中,城景高速倒退=开车;5 节车厢顶可跑跳,车距豁口会掉下去(掉血弹回)。
//   怪:纸妖(飘来俯冲)/瓦罐妖(跳车厢逼近)/炮妖(前车固定,点射直弹)。
//   里程倒数到 0 → 列车进站减速 → 转场铁心兽竞技场。全代码画,图位后补。
// ─────────────────────────────────────────────────────────────

interface Paper { x: number; y: number; vx: number; vy: number; ph: number; hp: number; dive: number; dead: number }
interface Pot { x: number; y: number; vy: number; onG: boolean; hp: number; hopT: number; dead: number; dir: number }
interface Bullet { x: number; y: number; vx: number }

@ccclass('Chapter2Train')
export class Chapter2Train extends Component {
  // ── 布局 ──
  private readonly CAR_W = 380; private readonly GAP = 78; private readonly NCAR = 5;
  private readonly PITCH = this.CAR_W + this.GAP;               // 458
  private readonly ROOF = -140;                                  // 车顶脚线
  private readonly LEN = this.NCAR * this.PITCH;                 // 机车左脸 x=2290
  private readonly HERO_SX = -W * 0.18;
  private readonly SPEED = 560;                                  // 城景倒退速度(px/s)
  private readonly DIST0 = 1500;                                 // 里程(米)

  private world!: Node; private g!: Graphics; private bgBleed!: Graphics;
  private ovG!: Graphics;                                        // 屏幕层(速度线/色罩,不缩放)
  private hero!: HeroRig; private combat!: HeroCombat; private hud!: HeroHUD;
  private deathFx!: DeathFx; private cam!: CamZoom;
  private distLbl!: Label; private banner!: Label; private bannerOp!: UIOpacity;
  private layers: { tiles: Node[]; w: number; par: number; y: number; h: number }[] = [];

  private t = 0; private shake = 0; private camX = 0;
  private px = 60; private py = this.ROOF; private vy = 0; private onG = true;
  private dir: 1 | -1 = 1; private walkPh = 0;
  private keys = { left: false, right: false };
  private hp = 100; private lagHp = 100; private inv = 0; private over = false; private deadT = 0;
  private slideT = 0; private fallT = 0; private stunT = 0;
  private slamJump = false; private kills = 0;
  private dist = this.DIST0; private speedK = 1;                 // 进站减速系数
  private arriving = false; private exiting = false;

  private papers: Paper[] = []; private pots: Pot[] = []; private bullets: Bullet[] = [];
  private turretHp = 8; private turretT = 0; private turretBurst = 0;
  private spawnT = 3; private potT = 9;
  private parts: { x: number; y: number; vx: number; vy: number; t: number; c: Color; r: number }[] = [];

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    this.world = new Node('train-world'); this.world.layer = Layers.Enum.UI_2D; this.world.parent = this.node; this.world.addComponent(UITransform);
    this.cam = new CamZoom(this.world);

    // 出血底(拉远不露黑):上灰薄荷天,下暗地
    const bl = new Node('t-bleed'); bl.layer = Layers.Enum.UI_2D; bl.parent = this.world; bl.addComponent(UITransform);
    this.bgBleed = bl.addComponent(Graphics);
    this.bgBleed.fillColor = new Color(164, 173, 182, 255);
    this.bgBleed.rect(-W * 0.75, -H * 0.3, W * 1.5, H * 1.05); this.bgBleed.fill();
    this.bgBleed.fillColor = new Color(30, 24, 44, 255);
    this.bgBleed.rect(-W * 0.75, -H * 0.75, W * 1.5, H * 0.45); this.bgBleed.fill();

    // 城景两层(复用空城图):倒退飞驰
    this.makeLayer('bg-far-city', 845, 0.22, -H * 0.16);
    this.makeLayer('bg-mid-city', 400, 0.55, -H * 0.16);

    const gn = new Node('t-main'); gn.layer = Layers.Enum.UI_2D; gn.parent = this.world; gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);

    const fx = new Node('t-fx'); fx.layer = Layers.Enum.UI_2D; fx.parent = this.world; fx.addComponent(UITransform);
    this.hero = new HeroRig(this.world, fx);
    this.combat = new HeroCombat(fx, this.hero);

    // 屏幕层:速度线/暮紫罩
    const ov = new Node('t-ov'); ov.layer = Layers.Enum.UI_2D; ov.parent = this.node; ov.addComponent(UITransform);
    this.ovG = ov.addComponent(Graphics);

    this.hud = new HeroHUD(this.node);
    // 里程牌
    const dn = new Node('t-dist'); dn.layer = Layers.Enum.UI_2D; dn.parent = this.node; dn.addComponent(UITransform);
    this.distLbl = dn.addComponent(Label); this.distLbl.fontSize = 22; this.distLbl.lineHeight = 26;
    this.distLbl.color = new Color(216, 204, 232);
    const dol = dn.addComponent(LabelOutline); dol.color = new Color(20, 14, 34, 255); dol.width = 3;
    dn.setPosition(0, H / 2 - 132, 0);
    // 到站横幅
    const bn = new Node('t-banner'); bn.layer = Layers.Enum.UI_2D; bn.parent = this.node; bn.addComponent(UITransform);
    this.banner = bn.addComponent(Label); this.banner.fontSize = 46; this.banner.lineHeight = 58;
    this.banner.color = new Color(255, 224, 130);
    const bol = bn.addComponent(LabelOutline); bol.color = new Color(30, 18, 10, 255); bol.width = 4;
    bn.setPosition(0, 120, 0);
    this.bannerOp = bn.addComponent(UIOpacity); this.bannerOp.opacity = 0;

    this.deathFx = new DeathFx(this.node, () => { this.deathFx.hide(); this.resetAll(); });

    new TouchControls(this.node, {
      onAxis: () => { },
      onJump: () => this.jump(),
      onDash: (d) => { this.dir = d as 1 | -1; this.slide(); },
      onAttack: () => this.attack(),
      onSlide: () => this.slide(),
    }, { alpha: 0.5 });

    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    AudioMgr.inst.play('roar', 0.25);
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

  private makeLayer(res: string, dispH: number, par: number, bottomY: number) {
    const L = { tiles: [] as Node[], w: 0, par, y: bottomY, h: dispH };
    for (let i = 0; i < 4; i++) {
      const n = new Node('tl-' + res + i); n.layer = Layers.Enum.UI_2D; n.parent = this.world;
      n.addComponent(UITransform).setAnchorPoint(0, 0);
      n.addComponent(Sprite).sizeMode = Sprite.SizeMode.CUSTOM;
      L.tiles.push(n);
    }
    this.layers.push(L);
    AssetHub.loadSF(res, (sf) => {
      if (!sf) return;
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
      L.w = sf.rect.width * (dispH / sf.rect.height);
      for (const t of L.tiles) { t.getComponent(Sprite)!.spriteFrame = sf; t.getComponent(UITransform)!.setContentSize(L.w, dispH); }
    });
  }
  private placeLayers() {
    for (const L of this.layers) {
      if (!L.w) continue;
      const scroll = this.t * this.SPEED * this.speedK * L.par * 0.55 + this.camX * L.par;
      const off = ((scroll % L.w) + L.w) % L.w;
      for (let i = 0; i < L.tiles.length; i++) L.tiles[i].setPosition(-W / 2 - 64 - off + i * L.w, L.y, 0);
    }
  }

  private resetAll() {
    this.over = false; this.deadT = 0; this.hp = 100; this.lagHp = 100; this.inv = 0;
    this.px = 60; this.py = this.ROOF; this.vy = 0; this.onG = true; this.dir = 1;
    this.slideT = 0; this.fallT = 0; this.stunT = 0; this.slamJump = false;
    this.papers.length = 0; this.pots.length = 0; this.bullets.length = 0; this.parts.length = 0;
    this.turretHp = 8; this.turretT = 0; this.turretBurst = 0;
    this.spawnT = 3; this.potT = 9; this.kills = 0;
    this.dist = this.DIST0; this.speedK = 1; this.arriving = false; this.exiting = false;
    this.bannerOp.opacity = 0;
    this.combat.reset(); this.cam.reset();
  }

  // ── 操作 ──
  private jump() {
    if (this.over || this.fallT > 0) return;
    if (this.onG) { this.vy = 780; this.onG = false; AudioMgr.inst.play('swing', 0.25); }
  }
  private slide() {
    if (this.over || !this.onG || this.slideT > 0 || this.fallT > 0) return;
    this.slideT = 0.42; AudioMgr.inst.play('swing', 0.35);
  }
  private attack() {
    if (this.over || this.slamJump || this.fallT > 0) return;
    const type = this.combat.tryAttack();
    if (type < 0) return;
    if (type === 2 && this.onG) { this.vy = 620; this.onG = false; this.slamJump = true; }
    const reach = type === 2 ? 170 : 135;
    const hy = this.py + 46;
    // 纸妖
    for (const p of this.papers) {
      if (p.dead > 0 || p.hp <= 0) continue;
      const dx = p.x - this.px;
      if (dx * this.dir > -30 && Math.abs(dx) < reach && Math.abs(p.y - hy) < 95) {
        p.hp--; if (p.hp <= 0) { p.dead = 0.01; this.kills++; this.burst(p.x, p.y, new Color(226, 218, 200, 255), 10); AudioMgr.inst.play('hit', 0.6); }
      }
    }
    // 瓦罐妖
    for (const o of this.pots) {
      if (o.dead > 0 || o.hp <= 0) continue;
      const dx = o.x - this.px;
      if (dx * this.dir > -30 && Math.abs(dx) < reach && Math.abs(o.y - this.py) < 90) {
        o.hp--; this.burst(o.x, o.y + 40, new Color(196, 150, 110, 255), 6); AudioMgr.inst.play('hit', 0.7);
        if (o.hp <= 0) { o.dead = 0.01; this.kills++; this.burst(o.x, o.y + 40, new Color(210, 160, 116, 255), 16); }
      }
    }
    // 炮妖
    if (this.turretHp > 0) {
      const tx = this.turretX(), ty = this.ROOF;
      if ((tx - this.px) * this.dir > -30 && Math.abs(tx - this.px) < reach && Math.abs(ty - this.py) < 90) {
        this.turretHp--; this.burst(tx, ty + 34, new Color(150, 140, 170, 255), 7); AudioMgr.inst.play('hit', 0.7);
        if (this.turretHp <= 0) { this.kills++; this.burst(tx, ty + 40, new Color(170, 160, 190, 255), 20); this.addShake(8); }
      }
    }
  }
  private hurt(dmg: number, fromX?: number) {
    if (this.inv > 0 || this.over || this.slideT > 0.06) return;
    this.hp -= dmg; this.inv = 1.0; this.addShake(7);
    if (fromX !== undefined) this.px += (this.px < fromX ? -1 : 1) * 26;
    AudioMgr.inst.play('hit', 0.8);
    if (this.hp <= 0) { this.hp = 0; this.over = true; this.deadT = 0; this.deathFx.show(); }
  }
  private addShake(v: number) { this.shake = Math.max(this.shake, v); }
  private burst(x: number, y: number, c: Color, n: number) {
    for (let i = 0; i < n; i++)
      this.parts.push({ x, y, vx: (Math.random() - 0.5) * 360, vy: 60 + Math.random() * 300, t: 0.5 + Math.random() * 0.3, c, r: 2 + Math.random() * 3.5 });
  }

  // ── 车厢几何 ──
  private carIndexAt(x: number): number {       // 在第几节车顶上;-1=豁口/车外
    if (x < 0 || x > this.LEN) return -1;
    const k = Math.floor(x / this.PITCH);
    return (x - k * this.PITCH) <= this.CAR_W ? k : -1;
  }
  private carBob(i: number) { return Math.sin(this.t * 4.2 + i * 1.35) * 3; }
  private turretX() { return 3 * this.PITCH + this.CAR_W - 52; }   // 第4节车前缘
  private sx(wx: number) { return wx - this.camX; }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 42);
      this.node.setPosition((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0);
      if (this.shake <= 0) this.node.setPosition(0, 0, 0);
    }
    if (this.inv > 0) this.inv -= dt;
    if (this.lagHp > this.hp) this.lagHp = Math.max(this.hp, this.lagHp - dt * 55);
    this.hud.set(this.hp, 100, this.lagHp, this.kills);

    if (this.over) { this.deadT += dt; this.drawAll(); this.applyHero(); return; }

    // 里程 & 到站
    if (!this.arriving) {
      this.dist -= dt * 11;
      if (this.dist <= 0) { this.dist = 0; this.arriving = true; this.banner.string = '机务段 · 铁心兽之巢'; }
      this.distLbl.string = `距机务段  ${Math.max(0, Math.ceil(this.dist))} 米`;
    } else {
      this.speedK = Math.max(0, this.speedK - dt * 0.35);
      this.bannerOp.opacity = Math.min(255, this.bannerOp.opacity + dt * 320);
      this.distLbl.string = '';
      if (this.speedK <= 0 && !this.exiting) { this.exitToArena(); return; }
    }

    // 主角移动/跳/滑
    const mx = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    if (this.stunT > 0) this.stunT -= dt;
    if (this.slideT > 0) { this.slideT -= dt; this.px += this.dir * 430 * dt; }
    else if (mx && this.fallT <= 0) { this.dir = mx as 1 | -1; this.px += mx * 250 * dt; this.walkPh += dt * 9; }
    this.px = Math.max(24, Math.min(this.NCAR * this.PITCH - this.GAP - 26, this.px));
    if (!this.onG) {
      this.vy -= 2100 * dt; this.py += this.vy * dt;
      if (this.py <= this.ROOF && this.vy <= 0) {
        const ci = this.carIndexAt(this.px);
        if (ci >= 0) {
          this.py = this.ROOF; this.vy = 0; this.onG = true;
          if (this.slamJump) {
            this.slamJump = false;
            this.hero.slamImpactFx(this.sx(this.px), this.py, H / 2); this.addShake(10);
            // 落地大招:全屏轻扫(纸妖直接碎)
            for (const p of this.papers) if (p.dead <= 0 && Math.abs(p.x - this.px) < 230) { p.hp = 0; p.dead = 0.01; this.kills++; this.burst(p.x, p.y, new Color(226, 218, 200, 255), 10); }
          } else AudioMgr.inst.play('land', 0.35);
        }
      }
      if (this.py < this.ROOF - 300) { // 掉进豁口深处
        this.fallInGap();
      }
    } else if (this.carIndexAt(this.px) < 0 && this.fallT <= 0) {
      this.onG = false; this.vy = -60;   // 走进豁口开始掉
    }
    if (this.fallT > 0) {
      this.fallT -= dt;
      if (this.fallT <= 0) { // 弹回最近车顶
        const k = Math.round(this.px / this.PITCH);
        this.px = Math.max(24, Math.min(this.NCAR * this.PITCH - this.GAP - 26, k * this.PITCH + (this.px > k * this.PITCH + this.CAR_W / 2 ? this.CAR_W - 50 : 50)));
        this.py = this.ROOF; this.vy = 0; this.onG = true; this.inv = Math.max(this.inv, 1.2);
      }
    }

    // 刷怪(未到站才刷)
    if (!this.arriving) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = 4.2 + Math.random() * 2.5 - Math.min(2, (1 - this.dist / this.DIST0) * 2.4);
        const n = this.dist < this.DIST0 * 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++)
          this.papers.push({ x: this.camX + W / 2 + 80 + i * 130, y: this.ROOF + 190 + Math.random() * 220, vx: -(150 + Math.random() * 90), vy: 0, ph: Math.random() * 6.28, hp: 1, dive: 0, dead: 0 });
      }
      this.potT -= dt;
      if (this.potT <= 0) {
        this.potT = 10 + Math.random() * 5;
        const side = Math.random() < 0.6 ? 1 : -1;
        const spawnX = side > 0 ? Math.min(this.LEN - 60, this.camX + W / 2 + 60) : Math.max(30, this.camX - W / 2 - 60);
        this.pots.push({ x: spawnX, y: this.ROOF, vy: 0, onG: true, hp: 3, hopT: 0.6, dead: 0, dir: (side > 0 ? -1 : 1) });
      }
    }

    // 纸妖:飘近→锁定俯冲
    for (let i = this.papers.length - 1; i >= 0; i--) {
      const p = this.papers[i];
      if (p.dead > 0) { p.dead += dt; if (p.dead > 0.3) this.papers.splice(i, 1); continue; }
      p.ph += dt * 5;
      if (p.dive <= 0) {
        p.x += p.vx * dt; p.y += Math.sin(p.ph) * 46 * dt;
        if (Math.abs(p.x - this.px) < 190 && Math.random() < 0.02) p.dive = 1;   // 进入俯冲
      } else {
        const hy = this.py + 46;
        p.x += (this.px - p.x) * dt * 3.2; p.y += (hy - p.y) * dt * 3.4;
      }
      if (Math.abs(p.x - this.px) < 34 && Math.abs(p.y - (this.py + 46)) < 46) { this.hurt(6, p.x); p.dead = 0.01; this.burst(p.x, p.y, new Color(226, 218, 200, 255), 8); }
      if (p.x < this.camX - W / 2 - 140) this.papers.splice(i, 1);
    }
    // 瓦罐妖:跳跳逼近
    for (let i = this.pots.length - 1; i >= 0; i--) {
      const o = this.pots[i];
      if (o.dead > 0) { o.dead += dt; if (o.dead > 0.3) this.pots.splice(i, 1); continue; }
      o.dir = this.px < o.x ? -1 : 1;
      if (o.onG) {
        o.hopT -= dt;
        if (o.hopT <= 0) { o.hopT = 0.55 + Math.random() * 0.4; o.vy = 430; o.onG = false; }
      } else {
        o.vy -= 1900 * dt; o.y += o.vy * dt; o.x += o.dir * 190 * dt;
        if (o.y <= this.ROOF && o.vy <= 0) {
          if (this.carIndexAt(o.x) >= 0) { o.y = this.ROOF; o.onG = true; }
          else if (o.y < this.ROOF - 260) { this.pots.splice(i, 1); continue; }   // 自己掉豁口
        }
      }
      if (Math.abs(o.x - this.px) < 42 && Math.abs(o.y - this.py) < 60) this.hurt(10, o.x);
    }
    // 炮妖点射
    if (this.turretHp > 0 && !this.arriving && Math.abs(this.turretX() - this.px) > 60) {
      this.turretT -= dt;
      if (this.turretT <= 0) {
        if (this.turretBurst <= 0 && Math.abs(this.sx(this.turretX())) < W / 2 + 40) this.turretBurst = 3;
        if (this.turretBurst > 0) {
          this.turretBurst--;
          this.turretT = this.turretBurst > 0 ? 0.16 : 2.6 + Math.random();
          const dirB = this.px < this.turretX() ? -1 : 1;
          this.bullets.push({ x: this.turretX() + dirB * 30, y: this.ROOF + 44, vx: dirB * 640 });
          AudioMgr.inst.play('hit', 0.15);
        } else this.turretT = 1;
      }
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; b.x += b.vx * dt;
      const duck = this.slideT > 0;   // 滑铲躲子弹
      if (!duck && Math.abs(b.x - this.px) < 24 && Math.abs(b.y - (this.py + 44)) < 40) { this.hurt(7, b.x); this.bullets.splice(i, 1); continue; }
      if (Math.abs(b.x - this.camX) > W) this.bullets.splice(i, 1);
    }
    // 碎片
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i]; q.t -= dt; q.x += q.vx * dt; q.vy -= 900 * dt; q.y += q.vy * dt;
      if (q.t <= 0) this.parts.splice(i, 1);
    }

    // 相机
    const tc = Math.max(0, Math.min(this.LEN - 140, this.px - this.HERO_SX));
    this.camX += (tc - this.camX) * Math.min(1, dt * 7);
    this.cam.update(dt, !this.onG || this.fallT > 0, this.sx(this.px), -H / 2);

    this.combat.update(dt, this.sx(this.px), this.py + (this.onG ? this.carBob(this.carIndexAt(this.px)) : 0), this.dir);
    this.drawAll(); this.applyHero();
  }

  private applyHero() {
    const ci = this.carIndexAt(this.px);
    const bob = this.onG && ci >= 0 ? this.carBob(ci) : 0;
    let mode: HeroMode = 'idle'; let p = 0;
    if (this.over) { this.hero.apply(this.sx(this.px), this.py, this.dir, 'dead', this.deadT, 0, 0, 0, this.ROOF); return; }
    const a = this.combat.anim();
    if (this.fallT > 0) { mode = 'air'; p = 0.5; }
    else if (a) { mode = a.mode; p = a.p; }
    else if (this.slideT > 0) { mode = 'slide'; p = 1 - this.slideT / 0.42; }
    else if (!this.onG) { mode = 'air'; p = 0.5 - this.vy / 1600; }
    else if (Math.abs((this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0)) > 0) mode = 'walk';
    this.hero.apply(this.sx(this.px), this.py + bob, this.dir, mode, p, this.vy, this.walkPh, 0, this.ROOF + bob);
  }

  private fallInGap() {
    if (this.fallT > 0) return;
    this.fallT = 0.55; this.onG = false; this.vy = 0; this.py = this.ROOF - 320;
    this.hurt(8);
    this.addShake(6);
  }

  // ── 绘制 ──
  private drawAll() {
    this.placeLayers();
    const g = this.g; g.clear();
    const t = this.t, roofY = this.ROOF;
    const bodyTop = roofY, bodyH = 186, bodyBot = bodyTop - bodyH;   // 车体
    const railY = bodyBot - 44;

    // 夜幕暮紫罩在城景上(拉开列车前后景深)
    g.fillColor = new Color(64, 50, 96, 40);
    g.rect(this.camX - W * 0.75, -H * 0.75, W * 1.5, H * 1.5 - 0); g.fill();

    // 路基飞驰:枕木+碎石(全速视差)
    const scroll = (this.t * this.SPEED * this.speedK) % 64;
    g.fillColor = new Color(34, 27, 48, 255);
    g.rect(this.camX - W * 0.75, -H * 0.75, W * 1.5, railY + H * 0.75 - 8); g.fill();
    g.fillColor = new Color(58, 48, 74, 255);
    for (let x = this.camX - W * 0.75 - scroll; x < this.camX + W * 0.75; x += 64) {
      g.rect(x, railY - 26, 34, 10); g.fill();
    }
    g.fillColor = new Color(96, 86, 112, 255);
    g.rect(this.camX - W * 0.75, railY - 12, W * 1.5, 6); g.fill();

    // ── 车厢 × 5 ──
    for (let i = 0; i < this.NCAR; i++) {
      const x0 = i * this.PITCH, bob = this.carBob(i);
      const bt = bodyTop + bob, bb = bodyBot + bob;
      // 车影
      g.fillColor = new Color(10, 8, 20, 120); g.ellipse(x0 + this.CAR_W / 2, railY - 16, this.CAR_W * 0.52, 12); g.fill();
      // 车体
      g.fillColor = new Color(74, 62, 88, 255); g.rect(x0, bb, this.CAR_W, bodyH); g.fill();
      g.fillColor = new Color(92, 78, 106, 255); g.rect(x0, bt - 44, this.CAR_W, 44); g.fill();   // 上沿板
      g.fillColor = new Color(56, 46, 70, 255); g.rect(x0, bb, this.CAR_W, 36); g.fill();          // 底裙
      // 铆钉
      g.fillColor = new Color(126, 110, 138, 255);
      for (let k = 0; k < 8; k++) { g.circle(x0 + 28 + k * 46, bb + 52, 3); g.fill(); g.circle(x0 + 28 + k * 46, bt - 22, 3); g.fill(); }
      // 侧窗(空城式亮窗,零星亮)
      for (let k = 0; k < 4; k++) {
        const lit = (i * 4 + k) % 3 === 1;
        g.fillColor = lit ? new Color(255, 214, 130, 210) : new Color(38, 30, 54, 255);
        g.rect(x0 + 40 + k * 84, bb + 74, 44, 52); g.fill();
      }
      // 车顶板 + 边唇
      g.fillColor = new Color(108, 94, 120, 255); g.rect(x0 - 8, bt - 8, this.CAR_W + 16, 12); g.fill();
      g.fillColor = new Color(130, 114, 142, 255); g.rect(x0 - 8, bt - 2, this.CAR_W + 16, 4); g.fill();
      // 轮子(转)
      g.fillColor = new Color(30, 24, 42, 255);
      for (const wx of [x0 + 62, x0 + 118, x0 + this.CAR_W - 118, x0 + this.CAR_W - 62]) {
        g.circle(wx, railY - 6 + bob * 0.3, 26); g.fill();
      }
      g.strokeColor = new Color(150, 134, 160, 255); g.lineWidth = 4;
      for (const wx of [x0 + 62, x0 + 118, x0 + this.CAR_W - 118, x0 + this.CAR_W - 62]) {
        const a = -t * this.speedK * 9 + wx;
        g.moveTo(wx - Math.cos(a) * 18, railY - 6 + bob * 0.3 - Math.sin(a) * 18);
        g.lineTo(wx + Math.cos(a) * 18, railY - 6 + bob * 0.3 + Math.sin(a) * 18); g.stroke();
      }
      // 挂钩(和下一节相连)
      if (i < this.NCAR - 1) {
        g.strokeColor = new Color(96, 84, 110, 255); g.lineWidth = 9;
        g.moveTo(x0 + this.CAR_W - 4, bb + 26); g.lineTo(x0 + this.PITCH + 4, bb + 26 + this.carBob(i + 1) - bob); g.stroke();
      }
    }

    // ── 机车头(最前,不可上) ──
    {
      const x0 = this.LEN + 6, bob = this.carBob(this.NCAR);
      const bt = bodyTop + 66 + bob;
      g.fillColor = new Color(58, 48, 72, 255); g.rect(x0, bodyBot + bob, 150, bodyH + 66); g.fill();          // 驾驶室
      g.fillColor = new Color(255, 214, 130, 190); g.rect(x0 + 28, bodyBot + bob + 150, 62, 54); g.fill();     // 驾驶室亮窗
      g.fillColor = new Color(70, 58, 86, 255); g.rect(x0 + 150, bodyBot + bob, 240, 150); g.fill();           // 锅炉
      g.fillColor = new Color(50, 42, 64, 255); g.rect(x0 + 150, bodyBot + bob + 150, 240, 22); g.fill();
      g.fillColor = new Color(44, 36, 58, 255); g.rect(x0 + 300, bodyBot + bob + 172, 44, 66); g.fill();       // 烟囱
      // 烟(往后飘)
      for (let k = 0; k < 5; k++) {
        const sk = (t * 0.9 + k * 0.2) % 1;
        g.fillColor = new Color(200, 196, 210, Math.round(90 * (1 - sk)));
        g.circle(x0 + 322 - sk * (280 + this.SPEED * 0.22), bodyBot + bob + 250 + sk * 90, 10 + sk * 26); g.fill();
      }
      // 车头脸(呆火车同款:闭眼)
      g.fillColor = new Color(240, 232, 224, 255); g.circle(x0 + 390, bodyBot + bob + 96, 13); g.fill();
      g.strokeColor = new Color(40, 32, 50, 255); g.lineWidth = 3;
      g.moveTo(x0 + 384, bodyBot + bob + 94); g.quadraticCurveTo(x0 + 390, bodyBot + bob + 88, x0 + 396, bodyBot + bob + 94); g.stroke();
      g.fillColor = new Color(30, 24, 42, 255);
      for (const wx of [x0 + 80, x0 + 190, x0 + 300]) { g.circle(wx, railY - 2 + bob * 0.3, 30); g.fill(); }
      // 前挡(拦住玩家)
      g.fillColor = new Color(96, 84, 110, 255); g.rect(x0 - 10, bodyTop + bob - 10, 12, 76); g.fill();
    }

    // ── 炮妖(第4节车前缘的搭载炮) ──
    if (this.turretHp > 0) {
      const tx = this.turretX(), bob = this.carBob(3);
      const ty = roofY + bob;
      g.fillColor = new Color(52, 44, 66, 255); g.rect(tx - 26, ty, 52, 30); g.fill();
      g.fillColor = new Color(84, 72, 100, 255); g.circle(tx, ty + 34, 22); g.fill();
      const dirB = this.px < tx ? -1 : 1;
      g.strokeColor = new Color(40, 34, 54, 255); g.lineWidth = 10;
      g.moveTo(tx, ty + 36); g.lineTo(tx + dirB * 34, ty + 40); g.stroke();
      // 独眼
      g.fillColor = new Color(255, 120, 90, 255); g.circle(tx + dirB * 6, ty + 38, 5.5); g.fill();
      // 血环
      g.strokeColor = new Color(255, 110, 90, 200); g.lineWidth = 3;
      g.arc(tx, ty + 34, 27, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this.turretHp / 8), false); g.stroke();
    }

    // 子弹
    for (const b of this.bullets) {
      g.strokeColor = new Color(255, 216, 140, 230); g.lineWidth = 3.5;
      g.moveTo(b.x - Math.sign(b.vx) * 16, b.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // 纸妖(飘舞纸片,俯冲时前倾)
    for (const p of this.papers) {
      const flap = Math.sin(p.ph * 2.4) * 8;
      const al = p.dead > 0 ? Math.round(255 * (1 - p.dead / 0.3)) : 255;
      g.fillColor = new Color(228, 220, 202, al);
      const tl = p.dive > 0 ? 10 : 0;
      g.moveTo(p.x - 20, p.y + flap - tl); g.lineTo(p.x + 20, p.y - flap * 0.6);
      g.lineTo(p.x + 14, p.y - 26 - flap * 0.3); g.lineTo(p.x - 14, p.y - 24 + flap * 0.4); g.close(); g.fill();
      // 墨点眼
      g.fillColor = new Color(40, 34, 40, al); g.circle(p.x - 4, p.y - 10, 2.6); g.fill(); g.circle(p.x + 5, p.y - 11, 2.6); g.fill();
    }
    // 瓦罐妖
    for (const o of this.pots) {
      const al = o.dead > 0 ? Math.round(255 * (1 - o.dead / 0.3)) : 255;
      g.fillColor = new Color(150, 108, 76, al);
      g.ellipse(o.x, o.y + 40, 26, 32); g.fill();
      g.fillColor = new Color(120, 84, 58, al); g.ellipse(o.x, o.y + 66, 16, 8); g.fill();   // 罐口
      g.fillColor = new Color(255, 214, 130, al);                                            // 罐里妖火
      g.circle(o.x, o.y + 64, 4 + Math.sin(t * 8 + o.x) * 1.5); g.fill();
      g.fillColor = new Color(40, 32, 40, al); g.circle(o.x - 8, o.y + 44, 3); g.fill(); g.circle(o.x + 8, o.y + 44, 3); g.fill();
      g.strokeColor = new Color(90, 62, 44, al); g.lineWidth = 4;                            // 小短腿
      g.moveTo(o.x - 10, o.y + 10); g.lineTo(o.x - 12, o.y); g.stroke();
      g.moveTo(o.x + 10, o.y + 10); g.lineTo(o.x + 12, o.y); g.stroke();
    }
    // 碎片
    for (const q of this.parts) {
      g.fillColor = new Color(q.c.r, q.c.g, q.c.b, Math.round(255 * Math.min(1, q.t * 2.5)));
      g.circle(q.x, q.y, q.r); g.fill();
    }

    // 到站:站台从右滑入
    if (this.arriving) {
      const k = 1 - this.speedK;
      const gateX = this.LEN + 700 - k * 340;
      g.fillColor = new Color(44, 36, 58, 255); g.rect(gateX, railY - 20, 900, H); g.fill();
      g.fillColor = new Color(255, 196, 116, Math.round(120 + 60 * Math.sin(t * 3)));
      g.circle(gateX + 60, roofY + 160, 14); g.fill();
    }

    // 主图形层用世界坐标画,整层随相机平移
    this.g.node.setPosition(-this.camX, 0, 0);

    // 屏幕层:速度线+暮紫罩(不随缩放)
    const og = this.ovG; og.clear();
    og.fillColor = new Color(96, 74, 140, 18); og.rect(-W / 2, -H / 2, W, H); og.fill();
    if (this.speedK > 0.25) {
      og.strokeColor = new Color(230, 226, 244, Math.round(46 * this.speedK)); og.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const yy = -H / 2 + ((i * 197) % H);
        const xx = W / 2 - ((t * (900 + i * 130)) % (W + 260)) + 130;
        og.moveTo(xx, yy); og.lineTo(xx + 90 + i * 14, yy); og.stroke();
      }
    }
  }

  // 到站 → 铁心兽竞技场
  private exitToArena() {
    if (this.exiting) return; this.exiting = true;
    const parent = this.node.parent!;
    const fade = new Node('train-fade'); fade.layer = Layers.Enum.UI_2D; fade.parent = parent;
    fade.addComponent(UITransform).setContentSize(W, H);
    const fg = fade.addComponent(Graphics); fg.fillColor = new Color(0, 0, 0, 255); fg.rect(-W / 2, -H / 2, W, H); fg.fill();
    const op = fade.addComponent(UIOpacity); op.opacity = 0;
    tween(op).delay(1.2).to(0.6, { opacity: 255 }).call(() => {
      this.node.destroy();
      const n = new Node('Chapter2Arena'); n.layer = Layers.Enum.UI_2D; n.addComponent(UITransform); n.parent = parent;
      n.addComponent(Chapter2Arena);
      fade.setSiblingIndex(parent.children.length - 1);
      tween(op).delay(0.1).to(0.45, { opacity: 0 }).call(() => fade.destroy()).start();
    }).start();
  }
}
