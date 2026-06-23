import { _decorator, Component, Node, Sprite, SpriteFrame, resources, UITransform, UIOpacity } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 模仿 H5 demo 的 drawGateEnterers（line 2624）：
// 3 路小灰人（color:'#3a3a3a', weapon:'none', hat:'none', unit:'spear'）从地图两侧 + 中央
// 出发 → 城门下汇集 → 沿中轴上行 → 进城门时透视缩小 + 透明消失。
// 用 enterer-0/enterer-1 两张 PNG（已用 Node canvas 完全照 H5 drawDetailedStickman 画好）。
@ccclass('CityEnterers')
export class CityEnterers extends Component {
  @property gateFx = 0.50;
  @property gateFy = 0.53;    // 城门 Y（越大越往下 = 越靠近地面）
  @property mergeFy = 0.555;  // 城门正下方汇集点
  @property leftFx = 0.16;
  @property rightFx = 0.84;
  @property startFy = 0.58;
  @property cycle = 18;          // 一轮总时长（小=整体快；大=整体慢）
  @property baseScale = 0.1;     // 220×360 → 22×36px（约屏幕 3%）
  @property walkFps = 6;         // 腿摆频率（小=腿慢；大=腿快）
  @property numEnterers = 3;     // 总人数（3 路各 1 人）

  private list: { n: Node; sp: Sprite; op: UIOpacity; offset: number; streamIdx: number }[] = [];
  private frames: (SpriteFrame | null)[] = [null, null];
  private t = 0;

  onLoad() {
    this.node.addComponent(UITransform);
    ['enterer-0', 'enterer-1'].forEach((nm, i) => {
      resources.load(nm + '/spriteFrame', SpriteFrame, (e, sf) => {
        if (!e) {
          this.frames[i] = sf;
          for (const it of this.list) if (!it.sp.spriteFrame) it.sp.spriteFrame = sf;
        }
      });
    });
    const N = this.numEnterers;
    for (let i = 0; i < N; i++) {
      const n = new Node('enterer' + i);
      n.layer = this.node.layer;
      n.parent = this.node;
      const ui = n.addComponent(UITransform);
      ui.setAnchorPoint(0.5, 0);
      ui.setContentSize(220, 360);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      const op = n.addComponent(UIOpacity);
      this.list.push({ n, sp, op, offset: i / N, streamIdx: i % 3 });
    }
  }

  update(dt: number) {
    this.t += dt;
    const W = DESIGN_W, H = DESIGN_H;
    const px = (fx: number) => (fx - 0.5) * W;
    const py = (fy: number) => (0.5 - fy) * H;

    const gateX = px(this.gateFx);
    const gateY = py(this.gateFy);
    const mergeY = py(this.mergeFy);
    const starts: [number, number][] = [
      [px(this.leftFx),  py(this.startFy)],
      [px(0.50),         py(this.startFy + 0.005)],
      [px(this.rightFx), py(this.startFy)],
    ];

    const frameIdx = Math.floor(this.t * this.walkFps) % 2;
    const curFrame = this.frames[frameIdx];

    this.list.forEach((s, i) => {
      const p = (this.t / this.cycle + s.offset) % 1;
      const st = starts[s.streamIdx];
      let x: number, y: number, facing: number;
      // L 形路径：50% 横走 + 48% 慢慢走入城门 + 2% 瞬间消失重生
      if (p < 0.50) {
        // 阶段 1：横向走到 gateX
        const t = p / 0.50;
        x = st[0] + (gateX - st[0]) * t;
        y = st[1];
        facing = gateX >= st[0] ? 1 : (gateX < st[0] ? -1 : 1);
      } else if (p < 0.98) {
        // 阶段 2：慢慢走入城门（48% 时间，约 8.6s，比之前长得多）
        const t = (p - 0.50) / 0.48;
        x = gateX;
        y = st[1] + (gateY - st[1]) * t;
        facing = 1;
      } else {
        // 一进门瞬间消失，立刻准备下一轮（不等）
        x = gateX; y = gateY; facing = 1;
      }
      const sc = this.baseScale * (1 - Math.min(p, 0.98) * 0.45);
      // 一进门（p≥0.98）瞬间消失，几乎不等就重生
      const alpha = p < 0.98 ? 1 : 0;
      s.n.setPosition(x, y, 0);
      s.n.setScale(sc * facing, sc, 1);
      s.op.opacity = Math.round(255 * alpha);
      if (curFrame && s.sp.spriteFrame !== curFrame) s.sp.spriteFrame = curFrame;
    });
  }
}
