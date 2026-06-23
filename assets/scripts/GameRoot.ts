import { _decorator, Component, Node, UITransform, view, Layers } from 'cc';
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
import { BottomMenu } from './BottomMenu';
import { HUD } from './HUD';
const { ccclass } = _decorator;

// 一键引导：挂在 Canvas 下的一个空节点上，运行时自动创建并配好整页。
// 这样你只需建「一个」节点，省去手动逐个创建。
// 渲染顺序 = 创建顺序（先建在底层）。
@ccclass('GameRoot')
export class GameRoot extends Component {
  onLoad() {
    // 强制 GameRoot 节点自己也是 UI_2D 层（避免编辑器里设置成 DEFAULT 导致黑屏）
    this.node.layer = Layers.Enum.UI_2D;
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
    make('Mountains', Mountains);      // 山（挡住太阳）
    make('Clouds', Clouds);            // 云（在山前飘）
    make('Geese', Geese);              // 小鸟（横飞）
    make('City', City);                // 城墙（4 档，点击升级）
    make('House', House);              // 主公府（4 档，随等级切）
    make('Farms', Farms);              // 农田（城前菱形田）
    make('Hoppers', Hoppers);          // 蚂蚱（地面跳）
    make('Soldiers', Soldiers);        // 城外脸谱兵（先黑脸）
    make('SkyOverlay', DayNightController); // 昼夜遮罩（盖在场景上）
    make('Stars', Stars);              // 星星（在遮罩之上，夜空发亮）
    make('Moon', Moon);                // 月亮（在遮罩之上，夜空发亮）
    make('BottomMenu', BottomMenu);    // 底部四个菜单按钮

    // HUD 顶部状态条
    const hud = make('HUD', HUD);
    const { width: W, height: H } = view.getVisibleSize();
    hud.getComponent(UITransform)!.setAnchorPoint(0, 1);
    hud.setPosition(-W / 2 + 16, H / 2 - 12, 0);
  }
}
