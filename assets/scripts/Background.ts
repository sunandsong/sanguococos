import { _decorator, Component, Sprite, SpriteFrame, resources, view, UITransform } from 'cc';
const { ccclass } = _decorator;

// 全屏背景图：加载 resources/bg.png 并铺满屏幕。
// 挂在 Canvas 最底层一个节点上（自带 Sprite，或脚本自动加）。
@ccclass('Background')
export class Background extends Component {
  onLoad() {
    const sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    const ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    sp.type = Sprite.Type.SIMPLE;
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    resources.load('bg/spriteFrame', SpriteFrame, (err, sf) => {
      if (err) { console.warn('背景图 bg 加载失败：', err); return; }
      sp.spriteFrame = sf;
      const { width, height } = view.getVisibleSize();
      ui.setContentSize(width, height);   // 拉伸铺满
    });
  }
}
