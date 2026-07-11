#!/bin/bash
# 每次 Cocos 构建微信小游戏后，双击运行本脚本：
#  1. game.json 加 iOS 高性能模式（JS 获得 JIT，性能提升 2~10 倍）
#  2. project.config.json 关掉拖慢编译/上传的选项
#  3. 校验 AppID 是否正确
cd "$(dirname "$0")"
python3 - << 'PY'
import json, sys, os

ROOT = 'build/wechatgame'
if not os.path.isdir(ROOT):
    print('❌ 找不到 build/wechatgame，请先在 Cocos 里构建'); sys.exit(1)

# 1) game.json：iOS 高性能模式
p = f'{ROOT}/game.json'
d = json.load(open(p))
d['iOSHighPerformance'] = True
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=2)
print('✅ game.json  iOSHighPerformance = true')

# 2) project.config.json：编译提速选项 + AppID
p = f'{ROOT}/project.config.json'
d = json.load(open(p))
d['setting'].update({
    'minified': False, 'enhance': False, 'es6': False,
    'postcss': False, 'useIsolateContext': False, 'urlCheck': False,
    'ignoreDevUnusedFiles': True, 'uploadWithSourceMap': False,
})
appid = d.get('appid')
if appid != 'wx0e9bbb8a04a32af1':
    d['appid'] = 'wx0e9bbb8a04a32af1'
    print(f'⚠️  AppID 由 {appid} 改回 wx0e9bbb8a04a32af1（请在 Cocos 构建面板里填好，避免每次被冲掉）')
else:
    print('✅ AppID 正确')
json.dump(d, open(p, 'w'), ensure_ascii=False)
print('✅ project.config.json 编译提速选项已设置')
print()
print('完成！微信开发者工具里关掉项目重开，再预览/上传。')
PY
read -p "按回车关闭..."
