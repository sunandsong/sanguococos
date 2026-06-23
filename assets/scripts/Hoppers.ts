import {
  _decorator,
  Component,
  Node,
  Sprite,
  SpriteFrame,
  resources,
  view,
} from "cc";
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 蚂蚱：几只在地面一跳一跳（照 H5 drawHopper 的跳跃节奏）。
@ccclass("Hoppers")
export class Hoppers extends Component {
  @property
  hopScale = 0.3; // 蚂蚱大小
  @property
  frogScale = 0.3; // 青蛙大小
  @property
  frogX = 0.9; // 青蛙位置 x
  @property
  frogY = 0.43; // 青蛙位置 y（越小越靠上/靠近山）

  private hoppers: {
    node: Node;
    shadow: Node;
    bx: number;
    by: number;
    phase: number;
    dir: number;
    base: number;
  }[] = [];
  private frog: Node | null = null;
  private frogShadow: Node | null = null;
  private frogBaseX = 0;
  private frogBaseY = 0;
  private t = 0;

  onLoad() {
    const W = DESIGN_W, H = DESIGN_H;
    const px = (fx: number) => (fx - 0.5) * W;
    const py = (fy: number) => (0.5 - fy) * H;
    // 先加载影子，再加载蚂蚱，成对创建
    resources.load("shadow/spriteFrame", SpriteFrame, (e1, shadowSF) => {
      resources.load("hopper/spriteFrame", SpriteFrame, (err, sf) => {
        if (err) { console.warn("hopper 加载失败：", err); return; }
        // [fx, fy, 朝向(1右 -1左), 大小]
        const defs = [
          [0.06, 0.53, 1, 1.0],
          [0.1, 0.56, -1, 0.85],
          [0.94, 0.53, -1, 1.0],
          [0.9, 0.57, 1, 0.85],
          [0.11, 0.46, 1, 0.7],
        ];
        defs.forEach((d, i) => {
          const s = this.hopScale * d[3];
          const bx = px(d[0]), by = py(d[1]);
          // 影子（先建=在蚂蚱后面，留在地面）
          const sh = new Node("hopShadow" + i);
          sh.layer = this.node.layer;
          sh.parent = this.node;
          const shp = sh.addComponent(Sprite);
          if (shadowSF) shp.spriteFrame = shadowSF;
          shp.sizeMode = Sprite.SizeMode.TRIMMED;
          sh.setScale(s, s, 1);
          sh.setPosition(bx, by - 4, 0);
          // 蚂蚱
          const n = new Node("hop" + i);
          n.layer = this.node.layer;
          n.parent = this.node;
          const sp = n.addComponent(Sprite);
          sp.spriteFrame = sf;
          sp.sizeMode = Sprite.SizeMode.TRIMMED;
          n.setScale(d[2] * s, s, 1);
          n.setPosition(bx, by, 0);
          this.hoppers.push({ node: n, shadow: sh, bx, by, phase: i * 1.3, dir: d[2], base: s });
        });
      });
    });

    // 右边一只青蛙（带影子）
    resources.load("shadow/spriteFrame", SpriteFrame, (e2, shadowSF) => {
      resources.load("frog/spriteFrame", SpriteFrame, (err, sf) => {
        if (err) { console.warn("frog 加载失败：", err); return; }
        this.frogBaseX = px(this.frogX);
        this.frogBaseY = py(this.frogY);
        // 影子（先建=在青蛙后面）
        const sh = new Node("frogShadow");
        sh.layer = this.node.layer;
        sh.parent = this.node;
        const shp = sh.addComponent(Sprite);
        if (shadowSF) shp.spriteFrame = shadowSF;
        shp.sizeMode = Sprite.SizeMode.TRIMMED;
        sh.setScale(this.frogScale * 1.3, this.frogScale, 1);
        sh.setPosition(this.frogBaseX, this.frogBaseY - 6, 0);
        this.frogShadow = sh;
        // 青蛙
        const n = new Node("frog");
        n.layer = this.node.layer;
        n.parent = this.node;
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = sf;
        sp.sizeMode = Sprite.SizeMode.TRIMMED;
        n.setScale(this.frogScale, this.frogScale, 1);
        n.setPosition(this.frogBaseX, this.frogBaseY, 0);
        this.frog = n;
      });
    });
  }

  update(dt: number) {
    this.t += dt;
    for (const h of this.hoppers) {
      const hop = Math.max(0, Math.sin(this.t * 3 + h.phase)); // 0→1 一跳，落地停一会
      const x = h.bx + hop * 16 * h.dir * this.hopScale; // 往前跳
      const y = h.by + hop * 44 * this.hopScale; // 跳起（y 向上）
      h.node.setPosition(x, y, 0);
      // 影子留在地面，蚂蚱跳得越高影子越小
      const ss = h.base * (1 - hop * 0.5);
      h.shadow.setScale(ss, h.base * 0.6, 1);
      h.shadow.setPosition(x, h.by - 4, 0);   // 跟随水平、固定在地面
    }
    // 青蛙：平时呼吸，每隔几秒蹦一下
    if (this.frog) {
      const cyc = this.t % 4.5;                       // 4.5 秒一轮
      let hop = 0;
      if (cyc < 0.55) hop = Math.sin((cyc / 0.55) * Math.PI);  // 半秒跳一下
      const x = this.frogBaseX - hop * 14 * this.frogScale;    // 往左小幅前移
      const y = this.frogBaseY + hop * 34 * this.frogScale;    // 跳起
      this.frog.setPosition(x, y, 0);
      const breathe = hop > 0 ? 0 : Math.sin(this.t * 2) * 0.04;
      this.frog.setScale(this.frogScale, this.frogScale * (1 + breathe), 1);
      // 影子留地面，跳起时变小、跟随水平
      if (this.frogShadow) {
        const ss = this.frogScale * 1.3 * (1 - hop * 0.5);
        this.frogShadow.setScale(ss, this.frogScale, 1);
        this.frogShadow.setPosition(x, this.frogBaseY - 6, 0);
      }
    }
  }
}
