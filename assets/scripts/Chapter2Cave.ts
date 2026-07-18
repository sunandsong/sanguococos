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
import { Chapter2Well } from './Chapter2Well';
import { JUMP } from './JumpKit';

const { ccclass } = _decorator;

// ─────────────────────────────────────────────────────────────
// 第二章 · 地下坑道（潜水砸石开洞 → 进洞往深处走）
//   横版:人工挖凿的土洞,粗糙顶底、厚土层(近/中/远)、发光大虫子照明、偶尔鼠道。
//   角色/摇杆/HUD 复用第一章套件(HeroRig / TouchControls / HeroHUD)。
//   坐标:世界 x 横向,py=脚底 Cocos y(上为正);相机横向跟随,角色固定屏幕左侧。
// ─────────────────────────────────────────────────────────────
@ccclass('Chapter2Cave')
export class Chapter2Cave extends Component {
  private g!: Graphics;         // 背景/中景/结构(角色之下)
  private fg!: Graphics;        // 近景前景层(角色之上)
  private hero!: HeroRig;
  private controls!: TouchControls;
  private hud!: HeroHUD;

  private readonly GROUND = -H * 0.16;      // 脚线 Cocos y
  private readonly CEIL_H = 360;            // 走廊净高
  private readonly HERO_SX = W * 0.16;      // 角色固定屏幕 x(右侧,朝左走)
  private readonly SPEED = 290; private readonly JUMP_VY = JUMP.VY; private readonly GRAV = JUMP.GRAVITY;   // 跳跃物理全章共用 JumpKit
  private readonly DEPTH = 3200;            // 通道往左的深度(px 从 0 走到 -DEPTH)

  private px = 0; private py = 0; private vy = 0; private onG = true; private dir = -1; private walkPh = 0;   // 从右端入,朝左
  private camX = 0; private t = 0;
  private combat!: HeroCombat; private slamJump = false; private slamLandT = 0;   // 跳劈大招:腾空/落地收势
  private slideT = 0; private slideCd = 0; private slideDir = 1;   // 滑铲(与第一章同参 0.35/0.55)
  private deathFx!: DeathFx; private over = false; private deadT = 0;   // 共用阵亡演出
  private exiting = false;   // 回井转场中(防重复触发)
  private hp = 100; private coins = 0;
  private keys = { left: false, right: false };

  onLoad() {
    this.node.layer = Layers.Enum.UI_2D;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(W, H); ut.setAnchorPoint(0.5, 0.5);

    const gn = new Node('cave-gfx'); gn.layer = Layers.Enum.UI_2D; gn.parent = this.node; gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);

    const fx = new Node('cave-fx'); fx.layer = Layers.Enum.UI_2D; fx.parent = this.node; fx.addComponent(UITransform);
    this.hero = new HeroRig(this.node, fx);
    this.hero.ambient = new Color(255, 234, 212, 255);   // 洞内暖火光环境光(压贴纸感)
    this.combat = new HeroCombat(fx, this.hero);   // 共用战斗套件(连招+刀气+剑气)

    // 近景前景层:排在角色/特效之上,画快视差巨柱框景
    const fgn = new Node('cave-fg'); fgn.layer = Layers.Enum.UI_2D; fgn.parent = this.node; fgn.addComponent(UITransform);
    this.fg = fgn.addComponent(Graphics);

    this.controls = new TouchControls(this.node, {
      onDir: (d) => { this.keys.left = d < 0; this.keys.right = d > 0; },
      onAxis: () => { },
      onJump: () => this.jump(),
      onDash: (d) => { this.dir = d as 1 | -1; this.slide(); },   // 双击方向=滑铲(全章统一)
      onAttack: () => this.attack(),
      onSlide: () => this.slide(),   // 滑铲键(气波招数已下架)
    }, { alpha: 0.5 });   // 布局全局统一(套件内定死):摇杆+跳跃键+攻击+技能
    this.hud = new HeroHUD(this.node);
    this.deathFx = new DeathFx(this.node, () => {   // 点重来复活重开
      this.deathFx.hide(); this.over = false; this.deadT = 0; this.hp = 100;
      this.px = 0; this.dir = -1; this.py = this.GROUND; this.vy = 0; this.onG = true; this.combat.reset();
    });

    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    this.py = this.GROUND;
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
    else if (e.keyCode === KeyCode.KEY_K || e.keyCode === KeyCode.KEY_L) this.slide();   // K/L=滑铲
  }
  private onKeyUp(e: EventKeyboard) {
    if (e.keyCode === KeyCode.KEY_A || e.keyCode === KeyCode.ARROW_LEFT) this.keys.left = false;
    else if (e.keyCode === KeyCode.KEY_D || e.keyCode === KeyCode.ARROW_RIGHT) this.keys.right = false;
  }
  private jump() { if (this.over || !this.onG) return; this.vy = this.JUMP_VY; this.onG = false; }
  private attack() {
    if (this.over || this.slamJump) return;
    const type = this.combat.tryAttack();
    if (type === 2 && this.onG) { this.vy = JUMP.SLAM_VY; this.onG = false; this.slamJump = true; }   // 第3段跳劈:真跃起(全章共用 JumpKit),落地结算
  }
  private slide() { if (this.over || !this.onG || this.slideT > 0 || this.slideCd > 0 || this.slamJump) return; this.slideT = 0.5; this.slideCd = 0.75; this.slideDir = this.dir; }   // 滑铲(与第一章同参)
  /** 受伤(供未来陷阱/敌人调用):掉血,血尽 → 阵亡演出 */
  hurt(dmg: number) { if (this.over) return; this.hp -= dmg; if (this.hp <= 0) { this.hp = 0; this.over = true; this.deadT = 0; this.deathFx.show(); } }
  // 跳劈落地:冲击波+闪电(HeroRig 套件) + 收势帧
  private slamImpact() { this.slamJump = false; this.slamLandT = 0.22; this.hero.slamImpactFx(this.HERO_SX, this.GROUND, H / 2); }

  // 石砌走廊:顶/底为直线
  private rnd(s: number) { return ((Math.sin(s * 127.1) * 43758.5) % 1 + 1) % 1; }
  private ceilY() { return this.GROUND + this.CEIL_H; }
  private floorY() { return this.GROUND; }
  private SXx(wx: number) { return wx - this.camX; }   // 世界 x → 屏幕(Cocos)x

  update(dt: number) {
    dt = Math.min(dt, 0.05); this.t += dt;
    if (this.slamLandT > 0) this.slamLandT -= dt;
    if (this.slideCd > 0) this.slideCd -= dt;
    if (this.over) this.deadT += dt;
    const mv = this.over ? 0 : (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    if (mv) { this.dir = mv; this.walkPh += dt * 10; }
    if (this.slideT > 0 && this.onG) { this.slideT -= dt; this.px += this.slideDir * this.SPEED * 1.9 * dt; }   // 滑铲:锁向高速滑行
    else if (this.onG) this.px += mv * this.SPEED * dt;
    else { this.px += mv * this.SPEED * 0.7 * dt; this.vy -= this.GRAV * dt; this.py += this.vy * dt; if (this.py <= this.GROUND) { this.py = this.GROUND; this.vy = 0; this.onG = true; if (this.slamJump) this.slamImpact(); } }
    this.px = Math.max(-this.DEPTH, Math.min(0, this.px));   // 右端(0)→ 左端(-DEPTH)
    if (!this.over && this.onG && this.px >= 0 && mv > 0) { this.exitToWell(); return; }   // 顶着洞口往右走=回井里
    this.camX = this.px - this.HERO_SX;
    this.combat.update(dt, this.HERO_SX, this.py, this.dir);       // 连招计时 + 刀气弧 + 剑气波
    this.hero.updateFx(dt, this.HERO_SX, this.GROUND);              // 跳劈冲击波/闪电
    this.controls.setSpecialCd(this.slideCd / 0.75);   // 滑铲冷却环
    this.updateHero(); this.redraw();
    this.hud.set(this.hp, 100, this.hp, this.coins, 1);
  }

  // 洞口往右顶着走 → 黑幕淡入 → 回井关(石头保持已破,人落在洞口台上) → 淡出
  private exitToWell() {
    if (this.exiting) return; this.exiting = true;
    const parent = this.node.parent!;
    const fade = new Node('cave-fade'); fade.layer = Layers.Enum.UI_2D; fade.parent = parent;
    fade.addComponent(UITransform).setContentSize(W, H);
    const fg = fade.addComponent(Graphics); fg.fillColor = new Color(0, 0, 0, 255); fg.rect(-W / 2, -H / 2, W, H); fg.fill();
    const op = fade.addComponent(UIOpacity); op.opacity = 0;
    tween(op).to(0.45, { opacity: 255 }).call(() => {
      this.node.destroy();                                   // 销毁洞穴
      Chapter2Well.returnFromCave = true;                    // 井关按「从洞里回来」出生:洞已开、站在洞口台上
      const n = new Node('Chapter2'); n.layer = Layers.Enum.UI_2D; n.addComponent(UITransform); n.parent = parent;
      n.addComponent(Chapter2Well);
      fade.setSiblingIndex(parent.children.length - 1);      // 黑幕置顶,盖住新场景再淡出
      tween(op).delay(0.1).to(0.45, { opacity: 0 }).call(() => fade.destroy()).start();
    }).start();
  }

  private updateHero() {
    if (this.over) { this.hero.apply(this.HERO_SX, this.py, this.dir, 'dead', this.deadT, 0, 0, 0, this.GROUND); return; }
    let mode: HeroMode = 'idle'; let p = 0;
    const a = this.combat.anim();
    if (this.slamJump) { mode = 'slam'; p = this.vy > 0 ? 0.1 : 0.5; }   // 腾空跳劈:上升举枪/下落俯冲
    else if (this.slamLandT > 0) { mode = 'slam'; p = 0.95; }            // 落地砸击收势
    else if (a) { mode = a.mode; p = a.p; }
    else if (this.slideT > 0 && this.onG) { mode = 'slide'; p = 1 - this.slideT / 0.5; }   // 滑铲三帧
    else if (!this.onG) mode = 'air';
    else if (this.keys.left || this.keys.right) mode = 'walk';
    this.hero.apply(this.HERO_SX, this.py, this.dir, mode, p, -this.vy, this.walkPh, 0, this.GROUND);
  }

  // 辉光池(同心圈近似)
  private glow(g: Graphics, sx: number, sy: number, r: number, cr: number, cg: number, cb: number, a: number) {
    g.fillColor = new Color(cr, cg, cb, Math.round(a * 0.22)); g.circle(sx, sy, r); g.fill();
    g.fillColor = new Color(cr, cg, cb, Math.round(a * 0.45)); g.circle(sx, sy, r * 0.58); g.fill();
    g.fillColor = new Color(cr, cg, cb, Math.round(a * 0.9)); g.circle(sx, sy, r * 0.28); g.fill();
  }
  // 壁挂火把(暖橙焰 + 光池)
  private torch(g: Graphics, sx: number, sy: number) {
    const fl = 0.82 + 0.18 * Math.sin(this.t * 11 + sx);
    this.glow(g, sx, sy - 6, 100, 255, 180, 90, 90 * fl);
    g.fillColor = new Color(38, 30, 20, 255); g.rect(sx - 3, sy, 6, 16); g.fill();
    const cols = [new Color(230, 110, 40, 230), new Color(255, 180, 70, 240), new Color(255, 240, 190, 255)];
    for (let i = 0; i < 3; i++) { const r = (9 - i * 2.5) * fl; g.fillColor = cols[i]; g.ellipse(sx + Math.sin(this.t * 8 + i) * 1.8, sy - 7 - i * 6, r * 0.62, r); g.fill(); }
  }
  // 墙上幽光符文板(青绿)
  // 远景砖墙(暗、慢视差)—— 拱洞里透出的深墙
  private farWall(g: Graphics, fy: number, cy: number) {
    g.fillColor = new Color(50, 43, 34, 255); g.rect(-W / 2, fy, W, cy - fy); g.fill();
    this.bricks(g, fy, cy, this.camX * 0.35);
    g.fillColor = new Color(0, 0, 0, 125); g.rect(-W / 2, fy, W, cy - fy); g.fill();   // 压暗=退远
    const gap = 220, off = this.camX * 0.35, x0 = Math.floor((off - gap) / gap) * gap;
    for (let wx = x0; wx < off + W + gap; wx += gap) {
      const sx = wx - off, h = (cy - fy) * 0.42, top = fy + h;
      g.fillColor = new Color(6, 5, 4, 255); g.rect(sx - 17, fy, 34, h); g.fill(); g.circle(sx, top, 17); g.fill();
    }
  }
  // 中景拱廊(石柱 + 拱券,亮、中速)—— 柱间拱洞透远墙 = 纵深
  private arcade(g: Graphics, fy: number, cy: number) {
    const off = this.camX * 0.7, gap = 250, colW = 40, spring = fy + (cy - fy) * 0.56;
    const x0 = Math.floor((off - gap) / gap) * gap;
    for (let wx = x0; wx < off + W + gap; wx += gap) {
      const sx = wx - off, lft = sx + colW / 2, rgt = sx + gap - colW / 2, mid = (lft + rgt) / 2, rad = (rgt - lft) / 2;
      // 拱券上方实心 spandrel,下方拱洞留空透远墙
      g.fillColor = new Color(70, 60, 48, 255);
      g.moveTo(lft, cy); g.lineTo(rgt, cy); g.lineTo(rgt, spring);
      for (let a = 0; a <= Math.PI + 0.001; a += 0.22) g.lineTo(mid + Math.cos(a) * rad, spring - Math.sin(a) * rad);
      g.lineTo(lft, cy); g.close(); g.fill();
      // 石柱(受光/暗面/柱头柱基)
      g.fillColor = new Color(76, 65, 51, 255); g.rect(sx - colW / 2, fy, colW, cy - fy); g.fill();
      g.fillColor = new Color(96, 82, 64, 255); g.rect(sx - colW / 2, fy, colW * 0.32, cy - fy); g.fill();
      g.fillColor = new Color(28, 23, 17, 255); g.rect(sx + colW / 2 - 5, fy, 5, cy - fy); g.fill();
      g.fillColor = new Color(40, 33, 25, 255); g.rect(sx - colW / 2 - 5, fy, colW + 10, 11); g.fill(); g.rect(sx - colW / 2 - 5, spring - 7, colW + 10, 9); g.fill();
      if (Math.round(wx / gap) % 2 === 0) this.torch(g, sx, spring + (cy - fy) * 0.18);   // 柱上壁灯
    }
  }

  private redraw() {
    const g = this.g, fg = this.fg; g.clear(); fg.clear();
    const cy = this.ceilY(), fy = this.floorY();
    g.fillColor = new Color(12, 10, 7, 255); g.rect(-W / 2, -H / 2, W, H); g.fill();   // 围岩底
    this.farWall(g, fy, cy);   // 远景砖墙
    this.arcade(g, fy, cy);    // 中景拱廊
    // 顶/底 结构层(1.0)
    g.fillColor = new Color(26, 21, 16, 255); g.rect(-W / 2, cy, W, H / 2 - cy); g.fill();
    g.fillColor = new Color(36, 30, 23, 255); g.rect(-W / 2, -H / 2, W, fy + H / 2); g.fill();
    this.bricks(g, cy, H / 2, this.camX);
    this.bricks(g, -H / 2, fy, this.camX);
    g.fillColor = new Color(130, 95, 55, 75); g.rect(-W / 2, cy - 3, W, 3); g.fill();   // 顶沿暖高光
    g.fillColor = new Color(130, 95, 55, 75); g.rect(-W / 2, fy, W, 3); g.fill();        // 地沿暖高光
    // 地面火光反照(对齐拱廊壁灯)
    const off = this.camX * 0.7, gap = 250;
    for (let wx = Math.floor((off - gap) / gap) * gap; wx < off + W + gap; wx += gap) {
      if (Math.round(wx / gap) % 2 === 0) this.glow(g, wx - off, fy + 6, 100, 255, 170, 80, 48);
    }
    g.fillColor = new Color(0, 0, 0, 80); g.rect(-W / 2, H / 2 - 56, W, 56); g.fill();   // 顶部压暗

    // ── 近景层(在角色之上):快视差巨柱 + 边框暗角 = 立体层次 ──
    const offN = this.camX * 1.4, ngap = 440, colN = 66, n0 = Math.floor((offN - ngap) / ngap) * ngap;
    for (let wx = n0; wx < offN + W + ngap; wx += ngap) {
      const sx = wx - offN;
      fg.fillColor = new Color(5, 4, 3, 255); fg.rect(sx - colN / 2, -H / 2, colN, H); fg.fill();
      fg.fillColor = new Color(24, 17, 11, 255); fg.rect(sx - colN / 2, -H / 2, 7, H); fg.fill(); fg.rect(sx + colN / 2 - 7, -H / 2, 7, H); fg.fill();   // 边缘微光
    }
    fg.fillColor = new Color(0, 0, 0, 120); fg.rect(-W / 2, -H / 2, 34, H); fg.fill(); fg.rect(W / 2 - 34, -H / 2, 34, H); fg.fill();

    if (!this.hero || !this.hero.ready) { g.fillColor = new Color(240, 220, 120, 255); g.circle(this.HERO_SX, this.py + 30, 16); g.fill(); }
  }

  // 砖缝(某竖直区间画横+竖砂浆线,随相机滚)
  private bricks(g: Graphics, y0: number, y1: number, off: number) {
    g.strokeColor = new Color(0, 0, 0, 70); g.lineWidth = 1.5;
    const bh = 30, bw = 56;
    for (let y = Math.ceil(y0 / bh) * bh; y <= y1; y += bh) { g.moveTo(-W / 2, y); g.lineTo(W / 2, y); }
    let row = 0;
    for (let y = Math.floor(y0 / bh) * bh; y < y1; y += bh) {
      const o = (((row % 2) * bw / 2 - (off % bw)) % bw + bw) % bw;
      for (let x = -W / 2 + o; x < W / 2; x += bw) { g.moveTo(x, y); g.lineTo(x, Math.min(y + bh, y1)); }
      row++;
    }
    g.stroke();
  }
}
