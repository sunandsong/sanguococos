import { Node, Graphics, Color, UITransform, UIOpacity, Label, Layers, Vec3, tween } from 'cc';
import { DESIGN_W as W, DESIGN_H as H } from './Constants';
import { AudioMgr } from './AudioMgr';

// ─────────────────────────────────────────────────────────────
// 阵亡演出套件(从第一章 BattleScene 提取,节奏/视觉逐参数一致):
//   灰化遮罩+电影暗角缓缓浮现(2s) → 「阵 亡」大字淡入弹正(1.2s后) → 「重来」链接浮现(2.8s后)
//   音乐:战斗乐淡出,2s 后伤感乐淡入。角色倒地动画在 HeroRig 的 'dead' 模式里。
// ─────────────────────────────────────────────────────────────
export class DeathFx {
  private overlay: Node; private overlayOp: UIOpacity;
  private banner: Node; private bannerOp: UIOpacity; private bannerLbl: Label;
  private restart: Node; private restartOp: UIOpacity;
  private loseTimer: ReturnType<typeof setTimeout> | null = null;
  active = false;

  constructor(parent: Node, onRestart: () => void) {
    // 灰化遮罩(整体压灰) + 电影暗角(四边细带,边缘最深向内淡出)
    this.overlay = new Node('death-overlay'); this.overlay.layer = Layers.Enum.UI_2D; this.overlay.parent = parent;
    this.overlay.addComponent(UITransform);
    const dg = this.overlay.addComponent(Graphics);
    dg.fillColor = new Color(120, 120, 126, 120); dg.rect(-W / 2, -H / 2, W, H); dg.fill();
    const bands = 14, dx = W * 0.26 / bands, dy = H * 0.20 / bands;
    for (let i = 0; i < bands; i++) {
      const a = Math.round(85 * ((bands - i) / bands));
      dg.fillColor = new Color(24, 9, 11, a);
      dg.rect(-W / 2 + i * dx, -H / 2, dx + 1, H); dg.fill();
      dg.rect(W / 2 - (i + 1) * dx, -H / 2, dx + 1, H); dg.fill();
      dg.rect(-W / 2, -H / 2 + i * dy, W, dy + 1); dg.fill();
      dg.rect(-W / 2, H / 2 - (i + 1) * dy, W, dy + 1); dg.fill();
    }
    this.overlayOp = this.overlay.addComponent(UIOpacity);
    this.overlay.active = false;

    // 「阵 亡」大字
    this.banner = new Node('death-banner'); this.banner.layer = Layers.Enum.UI_2D; this.banner.parent = parent;
    this.banner.addComponent(UITransform);
    this.banner.setPosition(0, 90, 0);
    const ln = new Node('lbl'); ln.layer = Layers.Enum.UI_2D; ln.parent = this.banner;
    ln.addComponent(UITransform);
    this.bannerLbl = ln.addComponent(Label);
    this.bannerLbl.fontSize = 96; this.bannerLbl.lineHeight = 100;
    this.bannerLbl.color = new Color(225, 66, 58);
    this.bannerLbl.string = '阵 亡';
    this.bannerOp = this.banner.addComponent(UIOpacity);
    this.banner.active = false;

    // 「重来」超链接式文字(下划线),点击重开
    this.restart = new Node('death-restart'); this.restart.layer = Layers.Enum.UI_2D; this.restart.parent = parent;
    this.restart.setPosition(0, -20, 0);
    this.restart.addComponent(UITransform).setContentSize(220, 90);
    const rl = new Node('lbl'); rl.layer = Layers.Enum.UI_2D; rl.parent = this.restart;
    rl.addComponent(UITransform);
    const rlb = rl.addComponent(Label); rlb.fontSize = 46; rlb.color = new Color(150, 200, 255); rlb.string = '重来';
    const un = new Node('underline'); un.layer = Layers.Enum.UI_2D; un.parent = this.restart;
    un.addComponent(UITransform);
    const ug = un.addComponent(Graphics);
    ug.strokeColor = new Color(150, 200, 255, 220); ug.lineWidth = 3;
    ug.moveTo(-50, -30); ug.lineTo(50, -30); ug.stroke();
    this.restartOp = this.restart.addComponent(UIOpacity);
    this.restart.on(Node.EventType.TOUCH_START, () => this.restart.setScale(0.9, 0.9, 1));
    this.restart.on(Node.EventType.TOUCH_END, () => {
      tween(this.restart).to(0.05, { scale: new Vec3(1.08, 1.08, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start();
      onRestart();
    });
    this.restart.on(Node.EventType.TOUCH_CANCEL, () => this.restart.setScale(1, 1, 1));
    this.restart.active = false;
  }

  /** 触发阵亡演出(重复调用无效) */
  show() {
    if (this.active) return;
    this.active = true;
    AudioMgr.inst.fadeOutBgm(1.6); AudioMgr.inst.stopAmb();
    this.loseTimer = setTimeout(() => { if (this.active) AudioMgr.inst.playStinger('lose', 0.8, 1.2); }, 800);   // 紧跟阵亡画面,不要隔太久凭空响
    this.overlay.active = true;
    this.overlayOp.opacity = 0;
    tween(this.overlayOp).to(2.0, { opacity: 255 }).start();
    this.banner.active = true;
    this.bannerOp.opacity = 0;
    tween(this.bannerOp).delay(1.2).to(1.4, { opacity: 255 }).start();
    this.banner.setScale(0.86, 0.86, 1);
    tween(this.banner).delay(1.2).to(1.4, { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' }).start();
    this.restart.active = true;
    this.restartOp.opacity = 0;
    tween(this.restartOp).delay(2.8).to(0.6, { opacity: 255 }).start();
  }

  /** 收起演出(重开时调) */
  hide() {
    this.active = false;
    if (this.loseTimer) { clearTimeout(this.loseTimer); this.loseTimer = null; }
    this.overlay.active = false; this.banner.active = false; this.restart.active = false;
  }

  destroy() {
    this.hide();
    for (const n of [this.overlay, this.banner, this.restart]) if (n && n.isValid) n.destroy();
  }
}
