import { _decorator, Component, Node, UITransform, view, Layers, Mask, Graphics } from 'cc';
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
const { ccclass } = _decorator;

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

    make('Background', Background);     // 背景图（最底）
    make('SideDecor', SideDecor);      // 两侧石头 + 草点（垫在所有元素下面）
    make('Sun', SunSprite);            // 太阳（在山后面）
    make('Ninja', Ninja);              // 山上忍者（在山后面，下沉时被山挡住；夜里才现身）
    make('Mountains', Mountains);      // 山（挡住太阳 + 忍者下沉部分）
    make('Clouds', Clouds);            // 云（在山前飘）
    make('Geese', Geese);              // 小鸟（横飞）
    // make('City', City);                // 城墙（已去掉城池）
    make('House', House);              // 主公府（4 档，随等级切）
    make('Farms', Farms);              // 农田（城前菱形田）
    make('Hoppers', Hoppers);          // 蚂蚱（地面跳）
    make('Soldiers', Soldiers);        // 城外脸谱兵（先黑脸）
    // make('CityEnterers', CityEnterers); // 进城门小人（随城池一并去掉）
    make('SkyOverlay', DayNightController); // 昼夜遮罩（盖在场景上）
    make('Stars', Stars);              // 星星（在遮罩之上，夜空发亮）
    make('Moon', Moon);                // 月亮（在遮罩之上，夜空发亮）
    make('Meteors', Meteors);          // 流星（夜里偶尔划过）
    make('BottomMenu', BottomMenu);    // 底部四个菜单按钮

    // HUD 顶部状态条
    const hud = make('HUD', HUD);
    hud.getComponent(UITransform)!.setAnchorPoint(0, 1);
    hud.setPosition(-DESIGN_W / 2 + 16, DESIGN_H / 2 - 12, 0);

    make('Battle', BattleScene);       // 出征战场覆盖层（最上层，默认隐藏）

    make('Title', TitleScreen);        // 标题画面《我要上天》（开机最上层，点击进入）
  }
}
