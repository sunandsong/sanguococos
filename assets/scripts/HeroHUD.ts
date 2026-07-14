import { Node, Sprite, UITransform, Texture2D, Layers, Graphics, Color, Label } from 'cc';
import { DESIGN_H as H } from './Constants';
import { AssetHub } from './AssetHub';

// ─────────────────────────────────────────────────────────────
// 顶部 HUD 套件：主角头像(金框) + 心形图标 + 血条(掉血残影/变色/刻度) + 金币徽章。
//   从第一章 BattleScene 抽出的可复用模块,位置/视觉与第一章一致。
//   脏标记:血量/残影/金币量化成 key,变了才重画(平时零开销)。
// ─────────────────────────────────────────────────────────────
export class HeroHUD {
  private root: Node;
  private g: Graphics;
  private coinLbl: Label;
  private key = -1;

  constructor(parent: Node, avatarRes = 'avatar-zhaoyun') {
    this.root = new Node('hero-hud'); this.root.layer = Layers.Enum.UI_2D; this.root.parent = parent;
    this.root.addComponent(UITransform);
    const gn = new Node('hud-g'); gn.layer = Layers.Enum.UI_2D; gn.parent = this.root;
    gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);
    // 头像(方形金框画在血条层里)
    const avN = new Node('hud-avatar'); avN.layer = Layers.Enum.UI_2D; avN.parent = this.root;
    const au = avN.addComponent(UITransform); au.setAnchorPoint(0.5, 0.5); au.setContentSize(52, 52);
    const asp = avN.addComponent(Sprite); asp.sizeMode = Sprite.SizeMode.CUSTOM;
    avN.setPosition(-267, H / 2 - 69, 0);
    AssetHub.loadSF(avatarRes, (sf) => {
      if (!sf || !avN.isValid) return;
      (sf.texture as Texture2D).setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      asp.spriteFrame = sf;
    });
    // 金币数字(徽章底座画在血条层里)
    const ln = new Node('hud-coin'); ln.layer = Layers.Enum.UI_2D; ln.parent = this.root;
    ln.addComponent(UITransform);
    this.coinLbl = ln.addComponent(Label);
    this.coinLbl.fontSize = 24; this.coinLbl.lineHeight = 28;
    this.coinLbl.color = new Color(255, 224, 120);
    ln.setPosition(241, H / 2 - 71, 0);
  }

  /** 每帧调用:hp/hpMax 血量,lagHp 掉血残影(不传=hp),coins 金币 */
  set(hp: number, hpMax: number, lagHp?: number, coins = 0) {
    const p = Math.max(0, hp / hpMax);
    const lag = Math.max(p, (lagHp ?? hp) / hpMax);
    const key = (Math.round(p * 336) * 337 + Math.round(lag * 336)) * 100000 + coins;
    if (key === this.key) return;
    this.key = key;
    this.coinLbl.string = `${coins}`;
    const g = this.g;
    g.clear();
    const w = 340, hh = 26, x = -197, y = H / 2 - 84;   // 整条 HUD 居中:头像→心→血条→金币
    // 底槽(外圈深边 + 内槽)
    g.fillColor = new Color(10, 8, 12, 210); g.roundRect(x - 3, y - 3, w + 6, hh + 6, 10); g.fill();
    g.fillColor = new Color(44, 36, 42, 255); g.roundRect(x, y, w, hh, 7); g.fill();
    // 掉血残影(亮橙,缓慢被追上)
    if (lag > p + 0.003) {
      g.fillColor = new Color(255, 168, 84, 230);
      g.roundRect(x + 2, y + 2, (w - 4) * lag, hh - 4, 5); g.fill();
    }
    // 血量填充:绿 → 黄 → 红
    const col = p > 0.5 ? new Color(88, 208, 108, 255) : p > 0.25 ? new Color(235, 195, 70, 255) : new Color(228, 70, 58, 255);
    g.fillColor = col;
    if (p > 0.003) { g.roundRect(x + 2, y + 2, (w - 4) * p, hh - 4, 5); g.fill(); }
    // 顶部高光条
    if (p > 0.02) {
      g.fillColor = new Color(255, 255, 255, 48);
      g.roundRect(x + 5, y + hh * 0.56, (w - 10) * p, hh * 0.3, 4); g.fill();
    }
    // 25% 刻度
    g.strokeColor = new Color(0, 0, 0, 90); g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { const tx = x + w * i / 4; g.moveTo(tx, y + 3); g.lineTo(tx, y + hh - 3); }
    g.stroke();
    // 金描边
    g.strokeColor = new Color(255, 232, 190, 130); g.lineWidth = 2; g.roundRect(x, y, w, hh, 7); g.stroke();
    // 头像底板 + 方形金框
    const ax = -267, ay = y + hh / 2 + 2, ar = 29;
    g.fillColor = new Color(14, 12, 18, 230); g.roundRect(ax - ar, ay - ar, ar * 2, ar * 2, 8); g.fill();
    g.strokeColor = new Color(255, 214, 120, 210); g.lineWidth = 3; g.roundRect(ax - ar, ay - ar, ar * 2, ar * 2, 8); g.stroke();
    g.strokeColor = new Color(120, 88, 30, 220); g.lineWidth = 1.5; g.roundRect(ax - ar + 3, ay - ar + 3, ar * 2 - 6, ar * 2 - 6, 6); g.stroke();
    // 心形图标
    const hx = x - 22, hy = y + hh / 2;
    g.fillColor = new Color(16, 10, 12, 200); g.circle(hx, hy, 17); g.fill();
    g.fillColor = new Color(232, 62, 58, 255);
    g.circle(hx - 5, hy + 3, 6.5); g.fill(); g.circle(hx + 5, hy + 3, 6.5); g.fill();
    g.moveTo(hx - 10.5, hy + 0.5); g.lineTo(hx, hy - 12); g.lineTo(hx + 10.5, hy + 0.5); g.close(); g.fill();
    g.fillColor = new Color(255, 190, 190, 220); g.circle(hx - 4, hy + 5, 2.2); g.fill();
    // 金币徽章(数字 Label 盖在上面)
    const bx = x + w + 20, cy = y + hh / 2;
    g.fillColor = new Color(10, 8, 12, 200); g.roundRect(bx, y - 3, 132, hh + 6, 15); g.fill();
    g.strokeColor = new Color(255, 214, 120, 90); g.lineWidth = 2; g.roundRect(bx, y - 3, 132, hh + 6, 15); g.stroke();
    const cx = bx + 24;
    g.fillColor = new Color(120, 82, 20, 255); g.circle(cx, cy, 12); g.fill();
    g.fillColor = new Color(255, 202, 58, 255); g.circle(cx, cy, 10); g.fill();
    g.strokeColor = new Color(168, 112, 22, 255); g.lineWidth = 2;
    g.moveTo(cx, cy - 5); g.lineTo(cx, cy + 5); g.stroke();
    g.fillColor = new Color(255, 240, 168, 255); g.circle(cx - 3.2, cy + 3.2, 3); g.fill();
  }

  destroy() { if (this.root && this.root.isValid) this.root.destroy(); }
}
