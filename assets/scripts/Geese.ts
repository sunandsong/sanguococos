import { _decorator, Component, Graphics, Color, view } from 'cc';
const { ccclass, property } = _decorator;

// 小鸟（照搬 H5 drawBirds）：3 只在不同高度连续横飞、翅膀扇动、循环掠过。
// 挂在天空层一个节点上（自带 Graphics，或脚本自动加）。
@ccclass('Geese')
export class Geese extends Component {
  @property
  speed = 30;        // 横飞速度 px/s
  @property
  skyFy = 0.18;      // 飞行高度（屏幕分数，越小越高）

  private g!: Graphics;
  private t = 0;

  onLoad() {
    this.g = this.getComponent(Graphics) || this.addComponent(Graphics)!;
  }

  update(dt: number) {
    this.t += dt;
    const g = this.g;
    g.clear();
    const { width: W, height: H } = view.getVisibleSize();
    const range = W + 60;
    g.strokeColor = new Color(51, 51, 51, 255);
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = ((this.t * this.speed + i * 200) % range) - 30 - W / 2;
      const fy = this.skyFy + i * 0.02;                        // 三只略错开高度
      const y = (0.5 - fy) * H + Math.sin(this.t * 2 + i) * 10; // 上下起伏
      const w = 17;                                            // 翼展
      const flap = Math.sin(this.t * 8 + i) * 4;               // 翅膀扇动
      // 平滑双峰 ⌒⌒：中点抬高到翼尖之上，两翼又无中间下凸
      g.moveTo(x - w, y - flap);
      g.quadraticCurveTo(x - w * 0.5, y + 13, x, y + 6);
      g.quadraticCurveTo(x + w * 0.5, y + 13, x + w, y - flap);
    }
    g.stroke();
  }
}
