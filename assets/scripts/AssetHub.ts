import { Asset, AssetManager, assetManager, resources, SpriteFrame } from 'cc';

/**
 * 资源中枢：为「按界分包 + 按需加载/释放」做准备。
 *
 * 用法（对调用方完全透明）：
 *   AssetHub.loadSF('bg-far-forest', sf => {...});
 *
 * 查找顺序：当前界的 Bundle → resources（兜底）。
 * 所以现在所有图还在 resources 里也照常工作；
 * 等你把地府/天庭的图放进 assets/bundles/realm-underworld/ 并标记为 Bundle，
 * 它们会被自动优先命中，切界时旧界的显存会被释放。
 *
 * 切界：
 *   await AssetHub.enterRealm('underworld');   // 加载新界包，释放旧界包
 */
export class AssetHub {
  private static curRealm = '';
  private static curBundle: AssetManager.Bundle | null = null;

  /** 当前界名（'' = 只用 resources） */
  static get realm(): string { return this.curRealm; }

  /**
   * 进入某界：加载 `realm-<name>` Bundle，并释放上一个界的 Bundle（显存立刻回收）。
   * 该 Bundle 不存在时静默降级到 resources，不报错。
   */
  static enterRealm(name: string): Promise<void> {
    if (name === this.curRealm) return Promise.resolve();
    const prev = this.curBundle;
    const prevName = this.curRealm;
    this.curRealm = name;
    this.curBundle = null;

    return new Promise(resolve => {
      assetManager.loadBundle('realm-' + name, (err, bundle) => {
        if (!err && bundle) this.curBundle = bundle;
        else console.warn(`[AssetHub] 界包 realm-${name} 不存在，降级用 resources`);
        // 释放旧界（放在新界加载完之后，避免切界瞬间白屏）
        if (prev) {
          prev.releaseAll();
          assetManager.removeBundle(prev);
          console.log(`[AssetHub] 已释放界包 realm-${prevName}`);
        }
        resolve();
      });
    });
  }

  /** 加载 SpriteFrame：先当前界包，后 resources。缺图静默（cb 收到 null）。 */
  static loadSF(name: string, cb: (sf: SpriteFrame | null) => void) {
    this.load(name + '/spriteFrame', SpriteFrame, cb as (a: Asset | null) => void);
  }

  /** 通用加载：先当前界包，后 resources。 */
  static load<T extends Asset>(path: string, type: new () => T, cb: (asset: T | null) => void) {
    const fromResources = () => {
      resources.load(path, type, (e, a) => cb(e || !a ? null : a));
    };
    const b = this.curBundle;
    if (!b) { fromResources(); return; }
    // 界包里没有就回落 resources（getInfoWithPath 判断，避免多余的失败日志）
    if (!b.getInfoWithPath(path, type)) { fromResources(); return; }
    b.load(path, type, (e, a) => { if (e || !a) fromResources(); else cb(a); });
  }
}
