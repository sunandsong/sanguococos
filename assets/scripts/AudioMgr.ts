import { Node, AudioSource, AudioClip, resources, director, tween } from 'cc';

// 极简音频管理：懒加载 + 缓存 + 缺文件静默跳过（音效没下齐也不报错）
// 约定：所有音频放 resources/audio/ 下，用文件名（不含扩展名）播放。
export class AudioMgr {
  private static _inst: AudioMgr | null = null;
  static get inst(): AudioMgr {
    if (!this._inst) this._inst = new AudioMgr();
    return this._inst;
  }

  private source: AudioSource;      // 音效（playOneShot 可叠加）
  private bgmSource: AudioSource;   // BGM（循环独占）
  private ambSource: AudioSource;   // 环境音（循环独占：雨声等）
  private stingerSource: AudioSource;   // 结局乐（胜利/阵亡，单次，可淡入）
  private cache: Record<string, AudioClip> = {};
  private missing: Record<string, boolean> = {};   // 已知缺失，不再重试
  sfxVolume = 1.0;
  bgmVolume = 0.55;

  private constructor() {
    const n = new Node('__audio__');
    director.getScene()!.addChild(n);
    director.addPersistRootNode(n);   // 跨场景常驻
    this.source = n.addComponent(AudioSource);
    this.bgmSource = n.addComponent(AudioSource);
    this.bgmSource.loop = true;
    this.ambSource = n.addComponent(AudioSource);
    this.ambSource.loop = true;
    this.stingerSource = n.addComponent(AudioSource);
  }

  private load(name: string, cb: (clip: AudioClip | null) => void) {
    if (this.cache[name]) { cb(this.cache[name]); return; }
    if (this.missing[name]) { cb(null); return; }
    resources.load('audio/' + name, AudioClip, (err, clip) => {
      if (err || !clip) { this.missing[name] = true; cb(null); return; }
      this.cache[name] = clip;
      cb(clip);
    });
  }

  /** 播放一次音效（可并发叠加）。vol 相对音量 0~1 */
  play(name: string, vol = 1) {
    this.load(name, clip => { if (clip) this.source.playOneShot(clip, vol * this.sfxVolume); });
  }

  /** 循环播放 BGM（重复调用同名不重启） */
  playBgm(name: string) {
    if ((this.bgmSource as unknown as { _bgmName?: string })._bgmName === name && this.bgmSource.playing) return;
    this.load(name, clip => {
      if (!clip) return;
      (this.bgmSource as unknown as { _bgmName?: string })._bgmName = name;
      this.bgmSource.stop();
      this.bgmSource.clip = clip;
      this.bgmSource.volume = this.bgmVolume;
      this.bgmSource.play();
    });
  }

  stopBgm() { this.bgmSource.stop(); }

  /** BGM 淡出后停止（默认 1.2s） */
  fadeOutBgm(sec = 1.2) {
    const src = this.bgmSource;
    if (!src.playing) return;
    tween(src).to(sec, { volume: 0 }).call(() => { src.stop(); src.volume = this.bgmVolume; }).start();
  }

  /** 播放结局乐（单次，从 0 淡入）：与战斗乐交叉过渡 */
  playStinger(name: string, vol = 0.8, fadeIn = 0.9) {
    const src = this.stingerSource;
    this.load(name, clip => {
      if (!clip) return;
      src.stop();
      src.clip = clip;
      src.volume = 0;
      src.play();
      tween(src).to(fadeIn, { volume: vol }).start();
    });
  }

  /** 循环播放环境音（雨声等；同名重复调用不重启） */
  playAmb(name: string, vol = 0.5) {
    if ((this.ambSource as unknown as { _ambName?: string })._ambName === name && this.ambSource.playing) return;
    this.load(name, clip => {
      if (!clip) return;
      (this.ambSource as unknown as { _ambName?: string })._ambName = name;
      this.ambSource.stop();
      this.ambSource.clip = clip;
      this.ambSource.volume = vol;
      this.ambSource.play();
    });
  }

  stopAmb() {
    (this.ambSource as unknown as { _ambName?: string })._ambName = '';
    this.ambSource.stop();
  }
}
