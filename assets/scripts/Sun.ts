import { _decorator, Component, Graphics, Color, view, Node, UITransform } from 'cc';
import { GameState } from './GameState';
const { ccclass } = _decorator;

// 太阳：随昼夜走天空弧线、夜里淡出、点击弹一下（占位“说话”）。
// 挂在一个 Sun 节点上（自带 Graphics）。
@ccclass('Sun')
export class Sun extends Component {
  g!: Graphics;
  r = 54;
  pop = 0;

  onLoad() {
    this.g = this.getComponent(Graphics) || this.addComponent(Graphics)!;
    // 给节点一个尺寸，点击才命中
    const ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    ui.setContentSize(140, 140);
    ui.setAnchorPoint(0.5, 0.5);
    this.node.on(Node.EventType.TOUCH_END, () => { this.pop = 1; }, this);
  }

  update(dt: number) {
    if (this.pop > 0) this.pop = Math.max(0, this.pop - dt * 3);
    const gs = GameState.i;
    const { width: W, height: H } = view.getVisibleSize();

    // 拂晓东升 → 正午最高 → 黄昏落下
    const up = Math.max(0, Math.min(1, (gs.dayPhase - 0.05) / 0.50));
    const fx = 0.15 + 0.70 * up;
    const fy = 0.40 - 0.26 * Math.sin(up * Math.PI);
    this.node.setPosition((fx - 0.5) * W, (0.5 - fy) * H, 0);

    this.draw(Math.max(0, 1 - gs.nightLevel));   // 夜里淡出
  }

  draw(alpha: number) {
    const g = this.g;
    g.clear();
    if (alpha <= 0.01) return;
    const r = this.r * (1 + this.pop * 0.25);
    const A = Math.round(alpha * 255);

    // 本体
    g.fillColor = new Color(252, 211, 77, A);
    g.circle(0, 0, r);
    g.fill();
    g.strokeColor = new Color(217, 119, 6, A);
    g.lineWidth = 5;
    g.circle(0, 0, r);
    g.stroke();

    // 光芒
    g.strokeColor = new Color(245, 158, 11, A);
    g.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const len = i % 2 ? 12 : 20;
      g.moveTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
      g.lineTo(Math.cos(a) * (r + 8 + len), Math.sin(a) * (r + 8 + len));
    }
    g.stroke();

    // 笑脸（注意 Cocos y 向上，嘴在下方用负 y）
    g.fillColor = new Color(122, 62, 0, A);
    g.circle(-r * 0.34, r * 0.1, r * 0.11);
    g.fill();
    g.circle(r * 0.34, r * 0.1, r * 0.11);
    g.fill();
    g.strokeColor = new Color(122, 62, 0, A);
    g.lineWidth = 3;
    const mw = r * 0.42, mb = -r * 0.16;          // 嘴在眼睛下方
    g.moveTo(-mw, mb);
    g.quadraticCurveTo(0, mb - r * 0.26, mw, mb); // 控制点更下 → 笑脸 ‿
    g.stroke();
  }
}
