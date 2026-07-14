import { Node, Sprite, SpriteFrame, UITransform, Texture2D, Rect, Layers } from 'cc';
import { AssetHub } from './AssetHub';

// ─────────────────────────────────────────────────────────────
// 步战赵云「角色套件」：从第一章 BattleScene 抽出来的可复用可视模块。
//   走路 / 待机 / 空中(跳跃) / 攻击(横斩) / 跳劈 —— 帧尺寸/锚点/缩放/朝向全部对齐第一章。
//   约定：默认精灵朝左，dir>=0(朝右) 时水平翻转；整体 ×1.8。
// ─────────────────────────────────────────────────────────────
export type HeroMode = 'idle' | 'walk' | 'air' | 'attack' | 'slam';

export class HeroRig {
  readonly node: Node;
  private sp: Sprite;
  private ut: UITransform;
  private foot: SpriteFrame[] = [];   // 走路/待机 4 帧 40×44
  private jump: SpriteFrame[] = [];   // 跳跃 3 帧 64×56（0蹲 1伸展 2屈腿）
  private atk: SpriteFrame[] = [];    // 横斩 4 帧 64×56
  private slam: SpriteFrame[] = [];   // 跳劈 4 帧 72×72
  private readonly HERO_ROW = 1;
  private readonly S = 1.8;           // 与第一章 SPRITE_SCALE 一致
  ready = false;

  constructor(parent: Node) {
    this.node = new Node('hero-rig'); this.node.layer = Layers.Enum.UI_2D; this.node.parent = parent;
    this.ut = this.node.addComponent(UITransform); this.ut.setContentSize(40, 44); this.ut.setAnchorPoint(0.5, 0);
    this.sp = this.node.addComponent(Sprite); this.sp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.load();
  }

  private each(name: string, cb: (tex: Texture2D) => void) {
    AssetHub.loadSF(name, (base) => {
      if (!base) return;
      const tex = base.texture as Texture2D; tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      cb(tex);
    });
  }
  private load() {
    this.each('zhaoyun-foot', (tex) => {
      for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 48 + 4, this.HERO_ROW * 64 + 13, 40, 44); this.foot.push(sf); }
      if (!this.sp.spriteFrame) this.sp.spriteFrame = this.foot[0];
      this.ready = true;
    });
    this.each('zhaoyun-jump', (tex) => { for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 64, 0, 64, 56); this.jump.push(sf); } });
    this.each('zhaoyun-attack', (tex) => { for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 64, 0, 64, 56); this.atk.push(sf); } });
    this.each('zhaoyun-slam', (tex) => { for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 72, 0, 72, 72); this.slam.push(sf); } });
  }

  hasAttack() { return this.atk.length >= 4; }

  /** 每帧调用。x/y = 脚底 Cocos 坐标；dir +1右/-1左；p = 攻击/跳劈进度 0..1；vy 世界竖速(向下为正)；walkPhase 走路相位 */
  apply(x: number, y: number, dir: number, mode: HeroMode, p = 0, vy = 0, walkPhase = 0) {
    this.node.setPosition(x, y, 0);
    this.node.setScale((dir >= 0 ? -this.S : this.S), this.S, 1);   // 默认朝左 → 朝右翻转（对齐第一章）
    if (mode === 'slam' && this.slam.length >= 4) {
      this.ut.setContentSize(72, 72); this.ut.setAnchorPoint(0.5, 4 / 72);
      const idx = p <= 0.15 ? 0 : p < 0.9 ? 1 : 2;
      this.sp.spriteFrame = this.slam[idx];
    } else if (mode === 'attack' && this.atk.length >= 4) {
      this.ut.setContentSize(64, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      const idx = p < 0.32 ? 0 : p < 0.5 ? 1 : p < 0.75 ? 2 : 3;   // 预备→斩→刺→收
      this.sp.spriteFrame = this.atk[idx];
    } else if (mode === 'air' && this.jump.length >= 3) {
      this.ut.setContentSize(64, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      this.sp.spriteFrame = this.jump[vy < 0 ? 1 : 2];             // 上升伸展 / 下落屈腿
    } else if (this.foot.length) {
      this.ut.setContentSize(40, 44); this.ut.setAnchorPoint(0.5, 0);
      const idx = mode === 'walk' ? (Math.floor(walkPhase) % 4) : 0;
      this.sp.spriteFrame = this.foot[idx];
    }
  }

  destroy() { if (this.node && this.node.isValid) this.node.destroy(); }
}
