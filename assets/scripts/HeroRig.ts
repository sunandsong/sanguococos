import { Node, Sprite, SpriteFrame, UITransform, Texture2D, Rect, Layers, Graphics, Color } from 'cc';
import { AssetHub } from './AssetHub';
import { AudioMgr } from './AudioMgr';

// ─────────────────────────────────────────────────────────────
// 步战赵云「角色套件」：从第一章 BattleScene 抽出来的可复用可视模块。
//   走路 / 待机 / 空中(跳跃) / 攻击(横斩) / 跳劈 —— 帧尺寸/锚点/缩放/朝向全部对齐第一章。
//   约定：默认精灵朝左，dir>=0(朝右) 时水平翻转；整体 ×1.8。
// ─────────────────────────────────────────────────────────────
export type HeroMode = 'idle' | 'walk' | 'air' | 'attack' | 'slam' | 'swim' | 'swimH' | 'float';

export class HeroRig {
  readonly node: Node;
  private sp: Sprite;
  private ut: UITransform;
  private foot: SpriteFrame[] = [];   // 走路/待机 4 帧 40×44
  private jump: SpriteFrame[] = [];   // 跳跃 3 帧 64×56（0蹲 1伸展 2屈腿）
  private atk: SpriteFrame[] = [];    // 横斩 4 帧 64×56
  private slam: SpriteFrame[] = [];   // 跳劈 4 帧 72×72
  private swim: SpriteFrame[] = [];   // 竖游 3 帧 40×72(收腿→蹬腿→滑行,竖直向上)
  private swimH: SpriteFrame[] = [];  // 横游 3 帧 72×40(收腿→蹬腿→滑行,头朝左)
  private float: SpriteFrame[] = [];  // 水面踩水 2 帧 56×56(双臂开合)
  private readonly HERO_ROW = 1;
  private readonly S = 1.8;           // 与第一章 SPRITE_SCALE 一致
  ready = false;

  // ── 跳劈落地特效(套件自带):贴地冲击波序列帧 + 天降闪电,参数与第一章一致 ──
  private fxSlamN: Node | null = null; private fxSlamSp: Sprite | null = null; private fxSlamFrames: SpriteFrame[] = [];
  private boltG: Graphics | null = null;
  private slamFxT = 0; private readonly SLAM_FX_DUR = 0.34;
  private bolt: number[][] = [];      // 相对冲击点的偏移折线
  private boltT = 0; private fxX = 0; private fxY = 0; private fxClock = 0;

  constructor(parent: Node, fxParent?: Node) {
    this.node = new Node('hero-rig'); this.node.layer = Layers.Enum.UI_2D; this.node.parent = parent;
    this.ut = this.node.addComponent(UITransform); this.ut.setContentSize(40, 44); this.ut.setAnchorPoint(0.5, 0);
    this.sp = this.node.addComponent(Sprite); this.sp.sizeMode = Sprite.SizeMode.CUSTOM;
    // 跳劈特效节点(冲击波精灵 + 闪电画布),挂在特效层(默认与角色同层)
    const fxP = fxParent ?? parent;
    this.fxSlamN = new Node('rig-slamfx'); this.fxSlamN.layer = Layers.Enum.UI_2D; this.fxSlamN.parent = fxP;
    const su = this.fxSlamN.addComponent(UITransform); su.setContentSize(160, 136); su.setAnchorPoint(0.5, 0.34);   // 锚点0.34=地面线
    this.fxSlamSp = this.fxSlamN.addComponent(Sprite); this.fxSlamSp.sizeMode = Sprite.SizeMode.CUSTOM;
    this.fxSlamN.active = false;
    const bn = new Node('rig-slambolt'); bn.layer = Layers.Enum.UI_2D; bn.parent = fxP;
    bn.addComponent(UITransform);
    this.boltG = bn.addComponent(Graphics);
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
    this.each('fx-slam-impact', (tex) => { for (let c = 0; c < 4; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 160, 0, 160, 136); this.fxSlamFrames.push(sf); } });
    this.each('zhaoyun-swim', (tex) => { for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 40, 0, 40, 72); this.swim.push(sf); } });
    this.each('zhaoyun-swim-h', (tex) => { for (let c = 0; c < 3; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 72, 0, 72, 40); this.swimH.push(sf); } });
    this.each('zhaoyun-float', (tex) => { for (let c = 0; c < 2; c++) { const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(c * 56, 0, 56, 56); this.float.push(sf); } });
  }

  hasAttack() { return this.atk.length >= 4; }

  /** 攻击起手音效(与第一章一致):type 2=跳劈 swing2,其余=平斩 swing */
  sndSwing(type: number) { AudioMgr.inst.play(type === 2 ? 'swing2' : 'swing', 0.9); }

  /** 跳劈落地特效(屏幕坐标触发):x/y=冲击点,topY=闪电起点高度(一般传画面顶);自带落地闷响 */
  slamImpactFx(x: number, y: number, topY: number) {
    AudioMgr.inst.play('land', 0.7);
    this.slamFxT = this.SLAM_FX_DUR; this.fxX = x; this.fxY = y;
    const steps = 9, sx = (Math.random() - 0.5) * 140, top = topY - y;
    const pts: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push([sx * (1 - t) + (i > 0 && i < steps ? (Math.random() - 0.5) * 52 : 0), top * (1 - t)]);
    }
    pts[steps] = [0, 0];   // 末端钉在冲击点
    this.bolt = pts; this.boltT = 0.26;
  }

  /** 每帧推进跳劈特效;镜头会动的场景把冲击点的最新屏幕坐标传进来(不传则用触发时坐标) */
  updateFx(dt: number, x?: number, y?: number) {
    this.fxClock += dt;
    if (x !== undefined) this.fxX = x;
    if (y !== undefined) this.fxY = y;
    // 冲击波:计时选帧,横宽纵扁贴地
    if (this.fxSlamN && this.fxSlamSp) {
      if (this.slamFxT <= 0 || this.fxSlamFrames.length < 4) {
        if (this.fxSlamN.active) this.fxSlamN.active = false;
      } else {
        this.slamFxT -= dt;
        const p = 1 - Math.max(0, this.slamFxT) / this.SLAM_FX_DUR;
        const fi = Math.min(3, Math.floor(p * 4));
        this.fxSlamN.active = true;
        this.fxSlamN.setPosition(this.fxX, this.fxY + 2, 0);
        this.fxSlamN.setScale(2.5, 1.2, 1);
        this.fxSlamSp.spriteFrame = this.fxSlamFrames[fi];
        this.fxSlamSp.color = new Color(255, 255, 255, fi === 3 ? 200 : 255);
      }
    }
    // 闪电:外发光粗线+亮芯细线,快速衰减+高频抖闪
    const g = this.boltG;
    if (g) {
      g.clear();
      if (this.boltT > 0 && this.bolt.length > 1) {
        this.boltT -= dt;
        const a = Math.max(0, this.boltT / 0.26) * (0.7 + 0.3 * Math.sin(this.fxClock * 60));
        const path = () => {
          g.moveTo(this.fxX + this.bolt[0][0], this.fxY + this.bolt[0][1]);
          for (let i = 1; i < this.bolt.length; i++) g.lineTo(this.fxX + this.bolt[i][0], this.fxY + this.bolt[i][1]);
        };
        g.strokeColor = new Color(150, 195, 255, Math.round(130 * a)); g.lineWidth = 13; path(); g.stroke();
        g.strokeColor = new Color(248, 251, 255, Math.round(248 * a)); g.lineWidth = 4; path(); g.stroke();
      }
    }
  }

  /** 每帧调用。x/y = 脚底 Cocos 坐标；dir +1右/-1左；p = 攻击/跳劈进度 0..1；vy 世界竖速(向下为正)；walkPhase 走路相位；tilt 抬头倾角(度,斜游用) */
  apply(x: number, y: number, dir: number, mode: HeroMode, p = 0, vy = 0, walkPhase = 0, tilt = 0) {
    this.node.setPosition(x, y, 0);
    this.node.setScale((dir >= 0 ? -this.S : this.S), this.S, 1);   // 默认朝左 → 朝右翻转（对齐第一章）
    this.node.angle = tilt === 0 ? 0 : (dir >= 0 ? tilt : -tilt);   // 抬头为正(斜游身体顺着运动方向倾)
    if (mode === 'slam' && this.slam.length >= 4) {
      this.ut.setContentSize(72, 72); this.ut.setAnchorPoint(0.5, 4 / 72);
      const idx = p <= 0.15 ? 0 : p < 0.9 ? 1 : 2;
      this.sp.spriteFrame = this.slam[idx];
    } else if (mode === 'attack' && this.atk.length >= 4) {
      this.ut.setContentSize(64, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      const idx = p < 0.32 ? 0 : p < 0.5 ? 1 : p < 0.75 ? 2 : 3;   // 预备→斩→刺→收
      this.sp.spriteFrame = this.atk[idx];
    } else if (mode === 'swim' && this.swim.length >= 3) {
      this.ut.setContentSize(40, 72); this.ut.setAnchorPoint(0.5, 0.5);   // 水下泳姿锚在身体中心:浮近水面时身体渐露,不会整个蹦到水线上
      const c = walkPhase % 3;
      this.sp.spriteFrame = this.swim[c < 0.8 ? 0 : c < 1.7 ? 1 : 2];   // 收腿短拍 → 蹬腿 → 滑行长拍
    } else if (mode === 'swimH' && this.swimH.length >= 3) {
      this.ut.setContentSize(72, 40); this.ut.setAnchorPoint(0.5, 0.5);
      const c = walkPhase % 3;
      this.sp.spriteFrame = this.swimH[c < 0.8 ? 0 : c < 1.7 ? 1 : 2];  // 横游同节奏
    } else if (mode === 'float' && this.float.length >= 2) {
      this.ut.setContentSize(56, 56); this.ut.setAnchorPoint(0.5, 0.62);   // 锚点在胸口:定位点=水面线时露出整个头+肩,身体沉在水下
      this.sp.spriteFrame = this.float[Math.floor(walkPhase) % 2];      // 踩水:双臂开合慢循环
    } else if (mode === 'air' && this.jump.length >= 3) {
      this.ut.setContentSize(64, 56); this.ut.setAnchorPoint(0.5, 4 / 56);
      this.sp.spriteFrame = this.jump[vy < 0 ? 1 : 2];             // 上升伸展 / 下落屈腿
    } else if (this.foot.length) {
      this.ut.setContentSize(40, 44); this.ut.setAnchorPoint(0.5, 0);
      const idx = mode === 'walk' ? (Math.floor(walkPhase) % 4) : 0;
      this.sp.spriteFrame = this.foot[idx];
    }
  }

  destroy() {
    if (this.node && this.node.isValid) this.node.destroy();
    if (this.fxSlamN && this.fxSlamN.isValid) this.fxSlamN.destroy();
    if (this.boltG && this.boltG.node.isValid) this.boltG.node.destroy();
  }
}
