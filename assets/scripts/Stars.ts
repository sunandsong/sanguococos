import { _decorator, Component, Node, Sprite, SpriteFrame, resources, view, UIOpacity, UITransform } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 星星：夜里出现、轻微闪烁（照 H5 的 10 颗位置）。
@ccclass('Stars')
export class Stars extends Component {
  @property
  starScale = 0.3;

  private stars: { op: UIOpacity, phase: number }[] = [];
  private t = 0;

  onLoad() {
    const W = DESIGN_W, H = DESIGN_H;
    const pos = [[0.30,0.10],[0.40,0.07],[0.52,0.12],[0.63,0.06],[0.72,0.10],
                 [0.82,0.08],[0.88,0.15],[0.46,0.05],[0.58,0.17],[0.35,0.16]];
    resources.load('star/spriteFrame', SpriteFrame, (err, sf) => {
      if (err) { console.warn('star 加载失败：', err); return; }
      pos.forEach((p, i) => {
        const n = new Node('star' + i);
        n.layer = this.node.layer;
        n.parent = this.node;
        n.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = sf;
        sp.sizeMode = Sprite.SizeMode.TRIMMED;
        const s = this.starScale * (0.7 + (i % 3) * 0.35);
        n.setScale(s, s, 1);
        n.setPosition((p[0] - 0.5) * W, (0.5 - p[1]) * H, 0);
        const op = n.addComponent(UIOpacity);
        this.stars.push({ op, phase: i * 1.7 });
      });
    });
  }

  update(dt: number) {
    this.t += dt;
    const night = Math.max(0, Math.min(1, (GameState.i.nightLevel - 0.3) / 0.4));
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(this.t * 2.2 + s.phase);   // 闪烁
      s.op.opacity = Math.round(night * (0.25 + 0.75 * tw) * 255);
    }
  }
}
