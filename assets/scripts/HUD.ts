import { _decorator, Component, Label, Color } from 'cc';
import { GameState } from './GameState';
const { ccclass, property } = _decorator;

// 顶部状态条：等级 / 粮 / 兵 / 昼夜。
@ccclass('HUD')
export class HUD extends Component {
  @property(Label)
  label: Label = null!;

  onLoad() {
    if (!this.label) this.label = this.getComponent(Label) || this.addComponent(Label)!;
    this.label.fontSize = 28;
    this.label.lineHeight = 32;
    this.label.color = new Color(255, 255, 255, 255);
  }

  update() {
    if (!this.label) return;
    const gs = GameState.i;
    const tod = gs.dayPhase < 0.5 ? '白天' : '夜晚';
    this.label.string = `Lv.${gs.level}  粮:${gs.food}  兵:${gs.soldiers}  [${tod}]`;
  }
}
