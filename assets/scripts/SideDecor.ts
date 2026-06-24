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

// 城池两侧装饰：左右散点小草(speckles.png) + 左侧石头(rock.png) 5 块。全用 Sprite。
@ccclass("SideDecor")
export class SideDecor extends Component {
  @property
  rockScale = 0.3; // 石头整体大小
  @property
  speckleW = 0.7; // 竖直长度（旋转后）
  @property
  speckleH = 0.7; // 横向宽度（旋转后）
  @property
  speckleLX = 0.12; // 左侧散点中心 x
  @property
  speckleRX = 0.88; // 右侧散点中心 x
  @property
  speckleY = 0.50; // 散点中心 y（越大越靠下）
  @property
  speckleAngle = 90; // 整片散点旋转角度（90 = 竖过来）
  @property
  rockDx = 0.08; // 石头整体左右偏移（+右 -左）；往城池(中间)靠
  @property
  rockDy = 0; // 石头整体上下偏移（+下 -上）

  onLoad() {
    const W = DESIGN_W, H = DESIGN_H;
    const px = (fx: number) => (fx - 0.5) * W;
    const py = (fy: number) => (0.5 - fy) * H;

    const place = (
      sf: SpriteFrame,
      fx: number,
      fy: number,
      sx: number,
      sy: number,
      name: string,
      angle = 0,
    ) => {
      const n = new Node(name);
      n.layer = this.node.layer;
      n.parent = this.node;
      const sp = n.addComponent(Sprite);
      sp.spriteFrame = sf;
      sp.sizeMode = Sprite.SizeMode.TRIMMED;
      n.setScale(sx, sy, 1);
      n.setPosition(px(fx), py(fy), 0);
      if (angle) n.angle = angle;
      return n;
    };

    // 散点小草：整片竖过来（旋转 90°），左右各一片
    resources.load("speckles/spriteFrame", SpriteFrame, (err, sf) => {
      if (err) {
        console.warn("speckles 加载失败：", err);
        return;
      }
      const sL = place(
        sf,
        this.speckleLX,
        this.speckleY,
        this.speckleW,
        this.speckleH,
        "speckL",
        this.speckleAngle,
      );
      const sR = place(
        sf,
        this.speckleRX,
        this.speckleY,
        -this.speckleW,
        this.speckleH,
        "speckR",
        this.speckleAngle,
      );
      // 草强制压到底层（不管 speckles 比 rock 先加载还是后加载）
      sL.setSiblingIndex(0);
      sR.setSiblingIndex(0);
    });

    // 石头：照 H5 左侧 5 块
    resources.load("rock/spriteFrame", SpriteFrame, (err, sf) => {
      if (err) {
        console.warn("rock 加载失败：", err);
        return;
      }
      const rocks = [
        [0.08, 0.475, 0.45],
        [0.165, 0.48, 0.6],
        [0.1, 0.495, 1.0],
        [0.04, 0.51, 0.7],
        [0.145, 0.51, 0.5],
      ];
      rocks.forEach((r, i) => {
        const s = r[2] * this.rockScale;
        const n = place(sf, r[0] + this.rockDx, r[1] + this.rockDy, s, s, "rock" + i);
        n.setSiblingIndex(9999);   // 石头置到最前，盖住草
      });
    });
  }
}
