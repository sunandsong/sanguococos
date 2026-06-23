import { _decorator, Component, Sprite, SpriteFrame, resources, view, UIOpacity, UITransform } from 'cc';
import { GameState } from './GameState';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 山上忍者：夜里才出现，在山脊来回巡逻、偶尔跳、定时藏到山后再探头。
// 必须渲染在 Mountains 之前（在山后面），下沉时才会被不透明的山挡住。
@ccclass('Ninja')
export class Ninja extends Component {
  @property
  ninjaScale = 0.7;     // 忍者大小
  @property
  ridgeFy = 0.30;       // 山脊最高点高度（与 Mountains 的 ridgeTop 对齐）
  @property
  ridgeDepth = 0.045;   // 山脊起伏深度（峰到谷）

  // H5 山脊形状（peaks=4），返回 0(谷)~1.4(峰)
  private ridgeR(fx: number): number {
    const peaks = 4;
    const r = (i: number) => Math.sin(i * 1.7 + 1) * 0.7 + 0.7;
    const tt = fx * peaks, i0 = Math.floor(tt), i1 = Math.min(peaks, i0 + 1), f = tt - i0;
    return r(i0) + (r(i1) - r(i0)) * f;
  }

  private sp!: Sprite;
  private op!: UIOpacity;
  private t = 0;

  onLoad() {
    this.op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity)!;
    this.sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    const ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    ui.setAnchorPoint(0.5, 0);          // 以脚为锚
    this.node.setScale(this.ninjaScale, this.ninjaScale, 1);
    resources.load('ninja/spriteFrame', SpriteFrame, (err, sf) => {
      if (!err) this.sp.spriteFrame = sf; else console.warn('ninja 加载失败：', err);
    });
  }

  update(dt: number) {
    this.t += dt;
    const night = GameState.i.nightLevel > 0.5;
    if (!night) { this.op.opacity = 0; return; }   // 白天不出现
    this.op.opacity = 255;

    const W = DESIGN_W, H = DESIGN_H;
    // 横向巡逻（很慢，边到边）
    const xf = 0.5 + 0.40 * Math.sin(this.t * 0.22);
    // 跳跃
    const jump = Math.max(0, Math.sin(this.t * 3)) * 0.025;
    // 藏 / 探头循环（12 秒一轮）
    const ph = this.t % 12;
    let duck = 0;
    if (ph < 6) duck = 0;                                  // 现身巡逻
    else if (ph < 6.8) duck = ((ph - 6) / 0.8) * 0.08;     // 下沉藏到山后
    else if (ph < 9.0) duck = 0.08;                        // 藏着
    else if (ph < 9.4) duck = 0.08 - ((ph - 9) / 0.4) * 0.05; // 探头
    else if (ph < 11.0) duck = 0.03;                       // 张望
    else duck = 0.03 * (1 - (ph - 11) / 1.0);              // 升起来

    // 跟着山脊起伏：峰处=ridgeFy，谷处更低
    const ridge = this.ridgeFy + (1.4 - this.ridgeR(xf)) / 1.4 * this.ridgeDepth;
    const fy = ridge - jump + duck;
    this.node.setPosition((xf - 0.5) * W, (0.5 - fy) * H, 0);
  }
}
