import { _decorator, Component, Sprite, SpriteFrame, resources, Node, UIOpacity, UITransform, tween, Vec3 } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 月牙（带脸）：夜里出现在左上天空，随夜色淡入淡出，轻微浮动。
// 点击月亮 → 弹大 1.4 倍再缩回（跟太阳同款手感）。
@ccclass('Moon')
export class Moon extends Component {
  @property
  moonScale = 0.33;      // 月亮基础大小
  @property
  moonFx = 0.2;          // 横向位置
  @property
  moonFy = 0.15;         // 高度
  @property
  popScale = 1.45;       // 点击放大倍数（相对 moonScale）
  @property
  popOutDur = 0.10;      // 弹大时长（秒）
  @property
  popBackDur = 0.18;     // 缩回时长（秒）

  private op!: UIOpacity;
  private baseY = 0;
  private t = 0;

  onLoad() {
    const W = DESIGN_W, H = DESIGN_H;
    this.op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity)!;
    const sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    const ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    ui.setAnchorPoint(0.5, 0.5);
    sp.sizeMode = Sprite.SizeMode.TRIMMED;
    this.node.setScale(this.moonScale, this.moonScale, 1);
    this.baseY = (0.5 - this.moonFy) * H;
    this.node.setPosition((this.moonFx - 0.5) * W, this.baseY, 0);
    resources.load('moon/spriteFrame', SpriteFrame, (err, sf) => {
      if (!err) sp.spriteFrame = sf; else console.warn('moon 加载失败：', err);
    });
    // 点击月亮弹一下
    this.node.on(Node.EventType.TOUCH_END, this.onTap, this);
  }

  private onTap() {
    // 月亮不可见时不响应
    if (this.op.opacity < 30) return;
    const base = this.moonScale;
    const big = base * this.popScale;
    tween(this.node)
      .to(this.popOutDur, { scale: new Vec3(big, big, 1) })
      .to(this.popBackDur, { scale: new Vec3(base, base, 1) })
      .start();
  }

  update(dt: number) {
    this.t += dt;
    // 月亮 = 1 − 太阳可见度：太阳淡出月亮淡入，太阳一露头月亮就消失
    this.op.opacity = Math.round((1 - GameState.i.sunVis) * 255);
    this.node.setPosition(this.node.position.x, this.baseY + Math.sin(this.t * 0.6) * 5, 0);
  }
}
