import { _decorator, Component, Node, Sprite, SpriteFrame, UITransform, UIOpacity, resources } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

interface Meteor {
  n: Node;
  sp: Sprite;
  op: UIOpacity;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  maxLife: number;
}

// 流星：夜里偶尔划过；用 meteor.png（一张水平带渐变拖尾的图）旋转到飞行方向。
@ccclass('Meteors')
export class Meteors extends Component {
  @property minGap = 8;
  @property maxGap = 23;
  @property speed = 260;
  @property maxLife = 2.0;
  @property spriteScale = 0.4;   // PNG 缩放（400x60 原图缩到 0.4 = 160x24 屏幕像素）
  @property maxYFrac = 0.22;     // 流星能飞到的最低 y 比例

  private list: Meteor[] = [];
  private nextSpawn = 0;
  private t = 0;
  private meteorSF: SpriteFrame | null = null;

  onLoad() {
    this.node.addComponent(UITransform);
    resources.load('meteor/spriteFrame', SpriteFrame, (e, sf) => {
      if (!e) {
        this.meteorSF = sf;
        for (const m of this.list) if (!m.sp.spriteFrame) m.sp.spriteFrame = sf;
      }
    });
    this.nextSpawn = this.minGap;
  }

  private spawn() {
    const W = DESIGN_W, H = DESIGN_H;
    const startX = (Math.random() - 0.5) * W * 0.9;
    const startY = H * (0.38 + Math.random() * 0.08);   // 顶部 4-12%
    const dirX = Math.random() < 0.5 ? -1 : 1;
    const angle = Math.PI / 12 + Math.random() * Math.PI / 12;  // 15~30°
    const vx = dirX * this.speed * Math.cos(angle);
    const vy = -this.speed * Math.sin(angle);   // 向下

    const n = new Node('meteor'); n.layer = this.node.layer; n.parent = this.node;
    const ui = n.addComponent(UITransform);
    ui.setAnchorPoint(1, 0.5);    // 锚点在右端（头）
    ui.setContentSize(400, 40);   // 跟 meteor.png 实际尺寸一致
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    if (this.meteorSF) sp.spriteFrame = this.meteorSF;
    const op = n.addComponent(UIOpacity);
    n.setScale(this.spriteScale, this.spriteScale, 1);
    // 旋转到飞行方向（图的"头"是右端 = 0°；飞行方向角度从水平 +x 算）
    const ang = Math.atan2(-vy, vx) * 180 / Math.PI;   // cocos 角度逆时针为正
    n.angle = -ang;   // 设负是因为 cocos 显示角度是顺时针

    this.list.push({ n, sp, op, x: startX, y: startY, vx, vy, life: 0, maxLife: this.maxLife });
  }

  update(dt: number) {
    this.t += dt;
    const isNight = GameState.i.nightLevel > 0.5;

    if (isNight && this.t >= this.nextSpawn) {
      this.spawn();
      this.nextSpawn = this.t + this.minGap + Math.random() * (this.maxGap - this.minGap);
    }

    const minSkyY = DESIGN_H * (0.5 - this.maxYFrac);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.life += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.n.setPosition(m.x, m.y, 0);
      // 平滑渐隐：sin 曲线 → 0 (start) → 1 (mid) → 0 (end)
      // 比线性更柔，看上去像"突然闪现 → 渐淡消失"
      const p = Math.min(1, m.life / m.maxLife);
      const alpha = Math.sin(p * Math.PI);   // 0→1→0 平滑
      m.op.opacity = Math.round(220 * alpha);   // 峰值 220 而非 255，整体更淡
      if (p >= 1 || Math.abs(m.x) > DESIGN_W || m.y < minSkyY) {
        m.n.destroy();
        this.list.splice(i, 1);
      }
    }
  }
}
