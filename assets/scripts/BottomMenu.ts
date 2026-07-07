/*
 * @Author: 张松 sunandsong@qq.com
 * @Date: 2026-06-23 20:09:03
 * @LastEditors: 张松 sunandsong@qq.com
 * @LastEditTime: 2026-06-23 20:11:16
 * @FilePath: /sanguococos/assets/scripts/BottomMenu.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import {
  _decorator,
  Component,
  Node,
  Sprite,
  SpriteFrame,
  Label,
  LabelOutline,
  resources,
  view,
  UITransform,
  tween,
  Vec3,
  Color,
} from "cc";
import { DESIGN_W, DESIGN_H } from "./Constants";
import { BattleScene } from "./BattleScene";
const { ccclass, property } = _decorator;

// 底部四个菜单按钮：内政 / 酒馆 / 出征 / 战事（图标 + 文字 + 点击反馈）。
@ccclass("BottomMenu")
export class BottomMenu extends Component {
  @property
  iconScale = 1.15; // 图标大小
  @property
  barFy = 0.93; // 菜单条高度（越大越靠下）
  @property
  btnScale = 0.85; // 整个按钮（图标+文字）缩放，越小越小

  onLoad() {
    const W = DESIGN_W,
      H = DESIGN_H;
    const items = [
      { icon: "icon-farm", label: "内政" },
      { icon: "icon-tavern", label: "酒馆" },
      { icon: "icon-deploy", label: "出征" },
      { icon: "icon-records", label: "战事" },
    ];
    const xs = [0.26, 0.42, 0.58, 0.74];

    items.forEach((it, i) => {
      const btn = new Node("menu-" + it.label);
      btn.layer = this.node.layer;
      btn.parent = this.node;
      const bui = btn.addComponent(UITransform);
      bui.setContentSize(150, 160);
      bui.setAnchorPoint(0.5, 0.5);
      btn.setPosition((xs[i] - 0.5) * W, (0.5 - this.barFy) * H, 0);
      btn.setScale(this.btnScale, this.btnScale, 1);

      // 图标
      const iconNode = new Node("icon");
      iconNode.layer = this.node.layer;
      iconNode.parent = btn;
      iconNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
      const sp = iconNode.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.TRIMMED;
      iconNode.setScale(this.iconScale, this.iconScale, 1);
      iconNode.setPosition(0, 30, 0);
      resources.load(it.icon + "/spriteFrame", SpriteFrame, (e, sf) => {
        if (!e) sp.spriteFrame = sf;
      });

      // 文字
      const lblNode = new Node("label");
      lblNode.layer = this.node.layer;
      lblNode.parent = btn;
      lblNode.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
      const lbl = lblNode.addComponent(Label);
      lbl.string = it.label;
      lbl.fontSize = 28;
      lbl.lineHeight = 32;
      lbl.color = new Color(255, 255, 255, 255);
      // 深色描边，白字在浅背景上也清楚
      const ol = lblNode.addComponent(LabelOutline);
      ol.color = new Color(40, 30, 20, 255);
      ol.width = 3;
      lblNode.setPosition(0, -56, 0);

      // 点击弹一下 + 触发功能
      const s = this.btnScale;
      btn.on(Node.EventType.TOUCH_END, () => {
        tween(btn)
          .to(0.08, { scale: new Vec3(s * 1.15, s * 1.15, 1) })
          .to(0.12, { scale: new Vec3(s, s, 1) })
          .start();
        if (it.label === "出征") BattleScene.instance?.open();
      });
    });
  }
}
