import { _decorator, Component, Node, Sprite, SpriteFrame, resources, UITransform, UIOpacity } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { GameState } from './GameState';
const { ccclass, property } = _decorator;

// 模仿 H5 demo 的 drawGateEnterers + drawNightGuards：
// 白天：3 路小灰人不停从地图边走入城门 → 进门消失 → 重生。
// 夜里：不再生成新人；当前在路上的人走完最后一段就停（不再循环）；
//       所有人全部进城后，城门口出现 2 个守卫。
@ccclass('CityEnterers')
export class CityEnterers extends Component {
  @property gateFx = 0.50;
  @property gateFy = 0.53;
  @property mergeFy = 0.555;
  @property leftFx = 0.16;
  @property rightFx = 0.84;
  @property startFy = 0.58;
  @property cycle = 18;
  @property baseScale = 0.1;
  @property walkFps = 6;
  @property numEnterers = 3;
  @property nightSpeedup = 2.5;    // 夜里走路速度倍率（赶紧回家睡觉）
  @property guardScale = 0.08;     // 守卫大小（小一点：0.12 → 0.08）
  @property guardOffsetFx = 0.04;  // 守卫离城门中心的横向距离（越小越靠近门）
  @property guardFy = 0.56;        // 守卫站立 Y（越大越往下）

  private list: { n: Node; sp: Sprite; op: UIOpacity; offset: number; streamIdx: number; nightDone: boolean }[] = [];
  private frames: (SpriteFrame | null)[] = [null, null];
  private guardFrame: SpriteFrame | null = null;   // 守卫专用图（头比 enterer 小）
  private t = 0;

  // 2 个夜里守卫
  private guards: { n: Node; sp: Sprite; op: UIOpacity }[] = [];

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
    // 守卫专用图（头小一半）
    resources.load('guard/spriteFrame', SpriteFrame, (e, sf) => {
      if (!e) {
        this.guardFrame = sf;
        for (const g of this.guards) g.sp.spriteFrame = sf;
      }
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
      this.list.push({ n, sp, op, offset: i / N, streamIdx: i % 3, nightDone: false });
    }
    // 2 个夜里守卫（左右各一个，面向中央对峙）
    for (let i = 0; i < 2; i++) {
      const n = new Node('guard' + i);
      n.layer = this.node.layer;
      n.parent = this.node;
      const ui = n.addComponent(UITransform);
      ui.setAnchorPoint(0.5, 0);
      ui.setContentSize(220, 400);   // guard.png 220×400（含枪头高度）
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      const op = n.addComponent(UIOpacity);
      op.opacity = 0;   // 默认看不见
      this.guards.push({ n, sp, op });
    }
  }

  update(dt: number) {
    const isNightNow = GameState.i.nightLevel > 0.5;
    this.t += dt * (isNightNow ? this.nightSpeedup : 1);   // 夜里时间加快
    const W = DESIGN_W, H = DESIGN_H;
    const px = (fx: number) => (fx - 0.5) * W;
    const py = (fy: number) => (0.5 - fy) * H;

    const gateX = px(this.gateFx);
    const gateY = py(this.gateFy);
    const starts: [number, number][] = [
      [px(this.leftFx),  py(this.startFy)],
      [px(0.50),         py(this.startFy + 0.005)],
      [px(this.rightFx), py(this.startFy)],
    ];

    const isNight = GameState.i.nightLevel > 0.5;
    const frameIdx = Math.floor(this.t * this.walkFps) % 2;
    const curFrame = this.frames[frameIdx];

    let allEntered = true;   // 所有进城兵都进城了吗？

    this.list.forEach((s) => {
      const rawP = (this.t / this.cycle + s.offset) % 1;
      // 夜里：一旦进城（rawP 包括过 0 重生），打 nightDone 标记，永久隐身
      if (isNight && rawP < 0.1 && s.nightDone === false) {
        // 等价于已经过一次完整 cycle 在夜里 → 标记完成
        // 但只在重生那一刻打标（前一帧还没标 nightDone 但 rawP 接近 0 = 刚wrap）
        s.nightDone = true;
      }
      // 白天恢复
      if (!isNight) s.nightDone = false;

      const p = rawP;
      const st = starts[s.streamIdx];
      let x: number, y: number, facing: number;
      if (p < 0.50) {
        const t = p / 0.50;
        x = st[0] + (gateX - st[0]) * t;
        y = st[1];
        facing = gateX >= st[0] ? 1 : (gateX < st[0] ? -1 : 1);
      } else if (p < 0.98) {
        const t = (p - 0.50) / 0.48;
        x = gateX;
        y = st[1] + (gateY - st[1]) * t;
        facing = 1;
      } else {
        x = gateX; y = gateY; facing = 1;
      }
      const sc = this.baseScale * (1 - Math.min(p, 0.98) * 0.45);
      // 夜里 nightDone 的人永久不可见；其他人按原规则
      const alpha = s.nightDone ? 0 : (p < 0.98 ? 1 : 0);
      s.n.setPosition(x, y, 0);
      s.n.setScale(sc * facing, sc, 1);
      s.op.opacity = Math.round(255 * alpha);
      if (curFrame && s.sp.spriteFrame !== curFrame) s.sp.spriteFrame = curFrame;
      // 还有人在路上（在屏幕上可见）
      if (alpha > 0) allEntered = false;
    });

    // 守卫：夜里 + 所有人都进城了 → 出现；白天 → 隐藏
    const showGuards = isNight && allEntered;
    this.guards.forEach((g, i) => {
      g.op.opacity = showGuards ? 255 : 0;
      if (this.guardFrame && g.sp.spriteFrame !== this.guardFrame) g.sp.spriteFrame = this.guardFrame;
      const sign = i === 0 ? -1 : 1;
      const gx = px(this.gateFx + sign * this.guardOffsetFx);
      const gy = py(this.guardFy);
      g.n.setPosition(gx, gy, 0);
      // 左守卫面右(facing=1)，右守卫面左(facing=-1)，相向而立
      g.n.setScale(this.guardScale * -sign, this.guardScale, 1);
    });

    // Y 排序：下方的人 → 后渲染 = 显示在最上层
    const sorted = this.list.slice().sort((a, b) => b.n.position.y - a.n.position.y);
    sorted.forEach((s, i) => s.n.setSiblingIndex(i));
  }
}
