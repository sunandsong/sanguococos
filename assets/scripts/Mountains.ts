import { _decorator, Component, Sprite, SpriteFrame, resources, view, UITransform } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 山：直接用 H5 导出的 mountains.png，铺满宽度、对齐到山脊位置。
// 挂在 Background 之上、城墙(Scenery)之下的一个节点。
@ccclass('Mountains')
export class Mountains extends Component {
  @property
  ridgeTop = 0.26;       // 山脊顶所在屏幕高度分数（从上往下，0=顶 1=底）
  @property
  heightScale = 2.2;     // 山的高度倍数（图本身很扁，调大让山更高）

  onLoad() {
    const sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    const ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    sp.type = Sprite.Type.SIMPLE;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load('mountains/spriteFrame', SpriteFrame, (err, sf) => {
      if (err) { console.warn('mountains 加载失败：', err); return; }
      sp.spriteFrame = sf;
      const W = DESIGN_W;   // Constants 已自动按屏幕缩放
      const H = DESIGN_H;
      const sz = sf.originalSize;
      const iw = (sz && sz.width) || 1440;
      const ih = (sz && sz.height) || 152;
      const h = W * ih / iw * this.heightScale;
      ui.setContentSize(W, h);
      ui.setAnchorPoint(0.5, 1);
      this.node.setPosition(0, (0.5 - this.ridgeTop) * H, 0);
    });
  }
}
