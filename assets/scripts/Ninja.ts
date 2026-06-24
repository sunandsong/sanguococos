import { _decorator, Component, Sprite, SpriteFrame, resources, Node, UIOpacity, UITransform, Color, tween, Vec3 } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 山上忍者：夜里才出现，沿山脊巡逻、偶尔跳、藏起来探头。
// 点击 → 爆炸消失 → 一段时间后自动复活。
@ccclass('Ninja')
export class Ninja extends Component {
  @property
  ninjaScale = 0.7;
  @property
  ridgeFy = 0.27;
  @property
  ridgeDepth = 0.045;
  @property
  patrolSpeed = 0.10;    // 巡逻速度（之前 0.22；越小越慢）
  @property
  jumpAmp = 0.025;
  @property
  jumpPeriod = 5.0;      // 多少秒一蹦（慢一些）
  @property
  jumpDutyCycle = 0.18;
  @property
  hideCycle = 18;        // 藏起来的完整循环（秒，更慢）
  @property
  hideDepth = 0.06;
  @property
  peekDepth = 0;
  @property
  respawnAfter = 8;      // 爆炸后多少秒复活

  private ridgeR(fx: number): number {
    const peaks = 4;
    const r = (i: number) => Math.sin(i * 1.7 + 1) * 0.7 + 0.7;
    const tt = fx * peaks, i0 = Math.floor(tt), i1 = Math.min(peaks, i0 + 1), f = tt - i0;
    return r(i0) + (r(i1) - r(i0)) * f;
  }

  private sp!: Sprite;
  private op!: UIOpacity;
  private t = 0;
  private exploded = false;
  private explodeUntil = 0;
  private particles: { n: Node; op: UIOpacity; vx: number; vy: number; life: number; maxLife: number; isSpark?: boolean }[] = [];

  onLoad() {
    this.op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity)!;
    this.sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    this.sp.sizeMode = Sprite.SizeMode.TRIMMED;
    const ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    ui.setAnchorPoint(0.5, 0);
    ui.setContentSize(40, 30);   // 给点点击区域
    this.node.setScale(this.ninjaScale, this.ninjaScale, 1);
    resources.load('ninja/spriteFrame', SpriteFrame, (err, sf) => {
      if (!err) this.sp.spriteFrame = sf; else console.warn('ninja 加载失败：', err);
    });
    this.node.on(Node.EventType.TOUCH_END, this.onTap, this);
  }

  private onTap() {
    if (this.exploded || this.op.opacity < 30) return;
    this.exploded = true;
    this.explodeUntil = this.t + this.respawnAfter;
    // 触发爆炸效果
    const cx = this.node.position.x;
    const cy = this.node.position.y + 12;
    // 忍者本体先放大再消失
    tween(this.node)
      .to(0.08, { scale: new Vec3(this.ninjaScale * 1.6, this.ninjaScale * 1.6, 1) })
      .call(() => { this.op.opacity = 0; })
      .start();
    // 爆炸烟团：12 团灰烟，从中心向四周猛喷
    const N = 12;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 110 + Math.random() * 60;   // 快速喷射
      const size = 8 + Math.random() * 6;      // 起步更小
      const n = new Node('smoke'); n.layer = this.node.layer; n.parent = this.node.parent!;
      n.addComponent(UITransform).setContentSize(size, size);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      // 颜色随机：白烟/灰烟/深灰
      const g = 180 + Math.floor(Math.random() * 60);
      sp.color = new Color(g, g, g, 255);
      resources.load('smoke/spriteFrame', SpriteFrame, (e, sf) => { if (!e) sp.spriteFrame = sf; });
      const op = n.addComponent(UIOpacity);
      op.opacity = 140;   // 起步就淡（之前 255）
      n.setPosition(cx + (Math.random() - 0.5) * 6, cy + (Math.random() - 0.5) * 6, 0);
      this.particles.push({
        n, op, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed + 20,
        life: 0, maxLife: 0.6 + Math.random() * 0.3,
      });
    }
    // 火花：6 颗小亮点，快速射出 + 短命（淡淡的）
    const SP = 6;
    for (let i = 0; i < SP; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 120;
      const n = new Node('spark'); n.layer = this.node.layer; n.parent = this.node.parent!;
      n.addComponent(UITransform).setContentSize(4, 4);
      const sp = n.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
      // 橙/黄色火星
      sp.color = i % 2 === 0
        ? new Color(255, 180, 60, 200)
        : new Color(255, 230, 130, 200);
      resources.load('white/spriteFrame', SpriteFrame, (e, sf) => { if (!e) sp.spriteFrame = sf; });
      const op = n.addComponent(UIOpacity);
      op.opacity = 200;
      n.setPosition(cx, cy, 0);
      this.particles.push({
        n, op, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed + 40,
        life: 0, maxLife: 0.25 + Math.random() * 0.15, isSpark: true,
      });
    }
  }

  update(dt: number) {
    this.t += dt;

    // 烟雾粒子：上飘 + 慢慢扩大 + 渐淡
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      // 烟没有重力，反而 vy 不变（已经设置成 +30 整体上飘）
      p.n.setPosition(p.n.position.x + p.vx * dt, p.n.position.y + p.vy * dt, 0);
      // 火花：保持原速 + 重力下落 + 不膨胀；烟：减速 + 膨胀
      if (p.isSpark) {
        p.vy -= 280 * dt;   // 重力（火星往下飞）
      } else {
        p.vx *= 0.93;
        p.vy *= 0.93;
        const k = 1 + p.life * 2.5;
        p.n.setScale(k, k, 1);
      }
      // 渐淡（火花更快淡，烟稍慢）
      const prog = p.life / p.maxLife;
      const peakAlpha = p.isSpark ? 200 : 140;   // 烟峰值 140（淡）
      p.op.opacity = Math.max(0, Math.round(peakAlpha * (1 - prog)));
      if (p.life >= p.maxLife) {
        p.n.destroy();
        this.particles.splice(i, 1);
      }
    }

    // 爆炸冷却中
    if (this.exploded) {
      if (this.t >= this.explodeUntil) {
        this.exploded = false;
        this.op.opacity = 255;
        this.node.setScale(this.ninjaScale, this.ninjaScale, 1);
      } else {
        return;
      }
    }

    const night = GameState.i.nightLevel > 0.5;
    if (!night) { this.op.opacity = 0; return; }    // 只在夜里出现
    this.op.opacity = 255;

    const W = DESIGN_W, H = DESIGN_H;
    const xf = 0.5 + 0.40 * Math.sin(this.t * this.patrolSpeed);
    const ridge = this.ridgeFy + (1.4 - this.ridgeR(xf)) / 1.4 * this.ridgeDepth;

    // 跳跃：每 jumpPeriod 秒一蹦
    const phase = (this.t / this.jumpPeriod) % 1;
    const jumpRaw = phase < this.jumpDutyCycle
      ? Math.sin((phase / this.jumpDutyCycle) * Math.PI) * this.jumpAmp
      : 0;

    // 藏 / 探头循环（按 hideCycle 比例缩放）
    const ph = this.t % this.hideCycle;
    const r = this.hideCycle / 14;   // 跟原 14s 的节奏成比例缩放
    let duck = 0;
    let isPeeking = false;
    if (ph < 7 * r) duck = 0;
    else if (ph < 7.8 * r) duck = ((ph - 7 * r) / (0.8 * r)) * this.hideDepth;
    else if (ph < 10 * r) duck = this.hideDepth;
    else if (ph < 10.5 * r) duck = this.hideDepth + (this.peekDepth - this.hideDepth) * ((ph - 10 * r) / (0.5 * r));
    else if (ph < 12.5 * r) { duck = this.peekDepth; isPeeking = true; }
    else duck = this.peekDepth * (1 - (ph - 12.5 * r) / (1.5 * r));

    const jump = (duck === 0) ? jumpRaw : 0;
    const fy = ridge - jump + duck;
    this.node.setPosition((xf - 0.5) * W, (0.5 - fy) * H, 0);

    let facing: number;
    if (isPeeking) {
      facing = Math.sin((ph - 10.5 * r) * Math.PI * 2 / r) >= 0 ? 1 : -1;
    } else {
      const dir = Math.cos(this.t * this.patrolSpeed);
      facing = Math.sign(dir || 1);
    }
    this.node.setScale(facing * this.ninjaScale, this.ninjaScale, 1);
  }
}
