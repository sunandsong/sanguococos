import { _decorator, Component, Node, Sprite, SpriteFrame, Label, LabelOutline, resources, view, UITransform, tween, Vec3, Color } from 'cc';
const { ccclass, property } = _decorator;

// 底部四个菜单按钮：内政 / 酒馆 / 出征 / 战事（图标 + 文字 + 点击反馈）。
@ccclass('BottomMenu')
export class BottomMenu extends Component {
  @property
  iconScale = 1.15;    // 图标大小
  @property
  barFy = 0.88;        // 菜单条高度（越大越靠下）

  onLoad() {
    const { width: W, height: H } = view.getVisibleSize();
    const items = [
      { icon: 'icon-farm', label: '内政' },
      { icon: 'icon-tavern', label: '酒馆' },
      { icon: 'icon-deploy', label: '出征' },
      { icon: 'icon-records', label: '战事' },
    ];
    const xs = [0.14, 0.38, 0.62, 0.86];

    items.forEach((it, i) => {
      const btn = new Node('menu-' + it.label);
      btn.layer = this.node.layer;
      btn.parent = this.node;
      const bui = btn.addComponent(UITransform);
      bui.setContentSize(150, 160);
      bui.setAnchorPoint(0.5, 0.5);
      btn.setPosition((xs[i] - 0.5) * W, (0.5 - this.barFy) * H, 0);

      // 图标
      const iconNode = new Node('icon');
      iconNode.layer = this.node.layer;
      iconNode.parent = btn;
      iconNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
      const sp = iconNode.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.TRIMMED;
      iconNode.setScale(this.iconScale, this.iconScale, 1);
      iconNode.setPosition(0, 30, 0);
      resources.load(it.icon + '/spriteFrame', SpriteFrame, (e, sf) => { if (!e) sp.spriteFrame = sf; });

      // 文字
      const lblNode = new Node('label');
      lblNode.layer = this.node.layer;
      lblNode.parent = btn;
      lblNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
      const lbl = lblNode.addComponent(Label);
      lbl.string = it.label;
      lbl.fontSize = 28;
      lbl.lineHeight = 32;
      lbl.color = new Color(255, 255, 255, 255);
      // 深色描边，白字在浅背景上也清楚
      const ol = lblNode.addComponent(LabelOutline);
      ol.color = new Color(40, 30, 20, 255);
      ol.width = 3;
      lblNode.setPosition(0, -56, 0);

      // 点击弹一下
      btn.on(Node.EventType.TOUCH_END, () => {
        tween(btn).to(0.08, { scale: new Vec3(1.15, 1.15, 1) }).to(0.12, { scale: new Vec3(1, 1, 1) }).start();
      });
    });
  }
}
