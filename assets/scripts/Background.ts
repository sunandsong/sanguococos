import { _decorator, Component, Sprite, SpriteFrame, resources, UITransform, view } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass } = _decorator;

// 背景图始终铺满屏幕（防黑边），其他元素仍按 720×1280 设计坐标定位
@ccclass('Background')
export class Background extends Component {
  private sp!: Sprite;
  private ui!: UITransform;

  onLoad() {
    this.sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    this.ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    this.sp.type = Sprite.Type.SIMPLE;
    this.sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.ui.setAnchorPoint(0.5, 0.5);
    this.node.setPosition(0, 0, 0);
    this.resize();
    resources.load('bg/spriteFrame', SpriteFrame, (err, sf) => {
      if (err) { console.warn('背景图 bg 加载失败：', err); return; }
      this.sp.spriteFrame = sf;
    });
    // 监听屏幕大小变化
    view.on('canvas-resize', this.resize, this);
  }

  onDestroy() {
    view.off('canvas-resize', this.resize, this);
  }

  private resize() {
    // 固定设计尺寸，大屏自然留黑边
    this.ui.setContentSize(DESIGN_W, DESIGN_H);
  }
}
