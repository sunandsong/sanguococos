import { _decorator, Component, Node, UITransform, Layers, Mask, Graphics } from 'cc';
import { DESIGN_W, DESIGN_H } from './Constants';
import { Background } from './Background';
import { Mountains } from './Mountains';
import { Clouds } from './Clouds';
import { Geese } from './Geese';
import { Ninja } from './Ninja';
import { SunSprite } from './SunSprite';
import { Moon } from './Moon';
import { Stars } from './Stars';
import { DayNightController } from './DayNightController';
import { City } from './City';
import { House } from './House';
import { SideDecor } from './SideDecor';
import { Hoppers } from './Hoppers';
import { Farms } from './Farms';
import { Soldiers } from './Soldiers';
import { CityEnterers } from './CityEnterers';
import { Meteors } from './Meteors';
import { BottomMenu } from './BottomMenu';
import { BattleScene } from './BattleScene';
import { HUD } from './HUD';
import { TitleScreen } from './TitleScreen';
import { Chapter2Well } from './Chapter2Well';
import { Chapter2Cave } from './Chapter2Cave';
import { Chapter2City } from './Chapter2City';
const { ccclass } = _decorator;

// 临时开关(从上往下,开哪个进哪个):空城 > 洞穴 > 井关 > 正常第一章(全 false = 开机标题→第一章)
const START_CITY = true;       // true = 直接进第二章「空城」跑酷 Demo(街尾跳井接井关)
const START_CAVE = false;      // true = 直接进第三章「地下坑道」场景(开发中)
const START_CHAPTER2 = false;  // true = 直接进第三章「投井下降」关(砸石开洞→转场进洞穴)

// 一键引导：挂在 Canvas 下的一个空节点上，运行时自动创建并配好整页。
// 这样你只需建「一个」节点，省去手动逐个创建。
// 渲染顺序 = 创建顺序（先建在底层）。
@ccclass('GameRoot')
export class GameRoot extends Component {
  onLoad() {
    console.log('🎮 GameRoot 启动了！');
    // 强制 GameRoot 节点是 UI_2D 层
    this.node.layer = Layers.Enum.UI_2D;
    // 强制 GameRoot 居中、跟屏幕一样大、锚点中心
    this.node.setPosition(0, 0, 0);
    const rootUI = this.node.getComponent(UITransform) || this.node.addComponent(UITransform)!;
    rootUI.setContentSize(DESIGN_W, DESIGN_H);
    rootUI.setAnchorPoint(0.5, 0.5);
    // 加 Mask 裁切：所有超出 720×1280 的内容（草、石头、蚂蚱）自动隐藏
    if (!this.node.getComponent(Mask)) {
      // Mask 需要 Graphics 作为 stencil
      if (!this.node.getComponent(Graphics)) this.node.addComponent(Graphics);
      const mask = this.node.addComponent(Mask);
      mask.type = Mask.Type.GRAPHICS_RECT;
    }
    const make = (name: string, comp?: any) => {
      const n = new Node(name);
      n.layer = Layers.Enum.UI_2D;      // 强制 UI 层，Graphics/Sprite 才会渲染
      n.addComponent(UITransform);
      n.parent = this.node;
      if (comp) n.addComponent(comp);
      return n;
    };

    // ── 主城场景已整体去掉（背景/山云/太阳月亮/农田/士兵/昼夜/底部菜单/HUD）──
    //    开机 = 标题画面 → 点击直接出征。需要恢复主城时把下面这段解注即可。
    // make('Background', Background);
    // make('SideDecor', SideDecor);
    // make('Sun', SunSprite);
    // make('Ninja', Ninja);
    // make('Mountains', Mountains);
    // make('Clouds', Clouds);
    // make('Geese', Geese);
    // make('City', City);
    // make('House', House);
    // make('Farms', Farms);
    // make('Hoppers', Hoppers);
    // make('Soldiers', Soldiers);
    // make('CityEnterers', CityEnterers);
    // make('SkyOverlay', DayNightController);
    // make('Stars', Stars);
    // make('Moon', Moon);
    // make('Meteors', Meteors);
    // make('BottomMenu', BottomMenu);
    // const hud = make('HUD', HUD);
    // hud.getComponent(UITransform)!.setAnchorPoint(0, 1);
    // hud.setPosition(-DESIGN_W / 2 + 16, DESIGN_H / 2 - 12, 0);

    if (START_CITY) {
      make('Chapter2City', Chapter2City);  // 第二章「空城」跑酷 Demo
      return;
    }
    if (START_CAVE) {
      make('Chapter2Cave', Chapter2Cave);  // 第二章「地下坑道」场景（开发中）
      return;
    }
    if (START_CHAPTER2) {
      make('Chapter2', Chapter2Well);  // 第二章「投井下降」关（第一阶段程序化原型）
      return;
    }

    // 首页(标题+剧情)独立成场景:开机只建标题页,出征时由 TitleScreen 自己创建战场并销毁自己
    make('Title', TitleScreen);        // 标题画面《我要上天》
  }
}
