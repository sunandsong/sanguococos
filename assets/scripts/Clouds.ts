import { _decorator, Component, Node, Sprite, SpriteFrame, resources, view } from 'cc';
const { ccclass, property } = _decorator;

// 云：加载 cloud.png，生成几朵在天上缓慢横向飘动（飘出右边从左边回来）。
// 挂在一个空的 Clouds 节点上（放在 Mountains 之后、Scenery 之前都行）。
@ccclass('Clouds')
export class Clouds extends Component {
  @property
  swayX = 14;     // 左右晃动幅度 px

  private clouds: { node: Node, baseX: number, baseY: number, phase: number }[] = [];
  private W = 0;
  private H = 0;
  private t = 0;

  onLoad() {
    const sz = view.getVisibleSize();
    this.W = sz.width; this.H = sz.height;
    resources.load('cloud/spriteFrame', SpriteFrame, (err, sf) => {
      if (err) { console.warn('cloud 加载失败：', err); return; }
      // 几朵云：位置(分数) + 缩放（调小）
      const defs = [
        { fx: 0.22, fy: 0.10, s: 0.6 },
        { fx: 0.62, fy: 0.14, s: 0.78 },
        { fx: 0.44, fy: 0.20, s: 0.5 },
      ];
      defs.forEach((d, i) => {
        const n = new Node('cloud' + i);
        n.parent = this.node;
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = sf;
        sp.sizeMode = Sprite.SizeMode.TRIMMED;
        n.setScale(d.s, d.s, 1);
        const baseX = (d.fx - 0.5) * this.W;
        const baseY = (0.5 - d.fy) * this.H;
        n.setPosition(baseX, baseY, 0);
        this.clouds.push({ node: n, baseX, baseY, phase: i * 1.7 });
      });
    });
  }

  update(dt: number) {
    this.t += dt;
    for (const c of this.clouds) {
      const x = c.baseX + Math.sin(this.t * 0.4 + c.phase) * this.swayX;   // 仅轻微左右晃
      const y = c.baseY + Math.sin(this.t * 0.3 + c.phase) * 4;            // 轻微上下浮
      c.node.setPosition(x, y, 0);
    }
  }
}
