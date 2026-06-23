/*
 * @Author: 张松 sunandsong@qq.com
 * @Date: 2026-06-21 18:57:36
 * @LastEditors: 张松 sunandsong@qq.com
 * @LastEditTime: 2026-06-21 19:04:55
 * @FilePath: /sanguococos/assets/scripts/House.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import {
  _decorator,
  Component,
  Sprite,
  SpriteFrame,
  resources,
  view,
  UITransform,
} from "cc";
import { GameState } from "./GameState";
import { DESIGN_W, DESIGN_H } from './Constants';
const { ccclass, property } = _decorator;

// 主公府：按等级切换 4 档立绘（茅草/木/石/宫），叠在城里上方。
@ccclass("House")
export class House extends Component {
  // 每档单独配置：[占屏宽, 底部高度fy(越小越上), 左右fx(0=中,+右-左)]
  //                茅草            木             石             宫
  private cfg = [
    [0.15, 0.45, 0],
    [0.16, 0.45, 0],
    [0.17, 0.45, 0],
    [0.2, 0.43, 0], // ← 第4档(宫殿) 改这一行
  ];

  private sp!: Sprite;
  private ui!: UITransform;
  private frames: SpriteFrame[] = [];
  private curTier = -1;
  private W = 0;
  private H = 0;

  onLoad() {
    const sz = { width: DESIGN_W, height: DESIGN_H };
    this.W = sz.width;
    this.H = sz.height;
    this.sp = this.getComponent(Sprite) || this.addComponent(Sprite)!;
    this.ui = this.getComponent(UITransform) || this.addComponent(UITransform)!;
    this.sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.ui.setAnchorPoint(0.5, 0);
    const names = ["house-thatch", "house-wood", "house-stone", "house-palace"];
    this.frames = new Array(4);
    names.forEach((nm, i) => {
      resources.load(nm + "/spriteFrame", SpriteFrame, (err, sf) => {
        if (!err) this.frames[i] = sf;
      });
    });
  }

  private apply(idx: number) {
    const sf = this.frames[idx];
    if (!sf) return;
    this.sp.spriteFrame = sf;
    const sz = sf.originalSize;
    const iw = sz.width || 300,
      ih = sz.height || 220;
    const c = this.cfg[idx];
    const w = this.W * c[0];
    this.ui.setContentSize(w, (w * ih) / iw);
    this.node.setPosition(c[2] * this.W, (0.5 - c[1]) * this.H, 0);
    this.curTier = idx;
  }

  update() {
    const idx = Math.max(0, Math.min(3, GameState.i.level - 1));
    if (idx !== this.curTier) this.apply(idx);
  }
}
