import { _decorator, Component, Sprite, SpriteFrame, resources, view, UIOpacity, UITransform } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 月牙（带脸）：夜里出现在左上天空，随夜色淡入淡出，轻微浮动。
@ccclass('Moon')
export class Moon extends Component {
  @property
  moonScale = 0.33;    // 月亮大小
  @property
  moonFx = 0.2;        // 横向位置
  @property
  moonFy = 0.15;       // 高度

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
  }

  update(dt: number) {
    this.t += dt;
    // 月亮 = 1 − 太阳可见度：太阳淡出月亮淡入，太阳一露头月亮就消失
    this.op.opacity = Math.round((1 - GameState.i.sunVis) * 255);
    this.node.setPosition(this.node.position.x, this.baseY + Math.sin(this.t * 0.6) * 5, 0);
  }
}
