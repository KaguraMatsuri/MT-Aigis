# MT-Aigis

千年战争Aigis macOS Client。应用启动后直接打开：

`https://play.games.dmm.com/game/aigisc`

未登录时由 DMM 自行跳转到登录页；登录完成后 Cookie 与游戏缓存会保存在当前 macOS 用户目录。

## 开发启动

```bash
cd /Users/matsuri/Documents/MT-Aigis
npm install
npm start
```

## 当前功能

- 自动隔离并按窗口比例缩放 `960x640` 游戏 iframe。
- 展开或折叠侧栏时自动重新计算游戏画面边界。
- `Back`、`Reload`、`Next`、画面缩放、静音。
- 出口 IP、地区提示与四个站点的手动连接测试。
- 游戏缓存大小、缓存清理和 Cookie 清理。
- macOS 触控板滚动归一化：拦截高频像素滚动，向 H5 游戏发送低频离散滚动。
- 密码页使用圆点遮罩，点击整行复制；密码剪贴板会在 60 秒后清空。
- 自定义代理使用同一游戏会话，网络检测也经过相同代理。
- 检测到新版本后自动下载 DMG，并直接打开安装器。

## 本机数据

运行数据只保存在当前 macOS 用户目录：

```text
~/Library/Application Support/MT-Aigis/
├── Partitions/mt-aigis-view/   # Cookie、LocalStorage、Service Worker、游戏缓存
├── secure/
│   ├── config.enc              # 会话/设置加密配置
│   └── vault.json              # 临时明文密码库，权限 0600
└── logs/
```

密码库目前按需求暂时使用明文 JSON，但不位于项目或应用包中。源码目录的 `.user-data/`、`credentials.json`、`vault.json`、`vault.md`、`config.enc` 与 `master.key` 均被构建配置排除。

## 缓存行为

- “清除游戏缓存”清除 HTTP Cache、Code Cache、Cache Storage、Service Worker 与 Shader Cache。
- 清除游戏缓存会保留 Cookie、LocalStorage、IndexedDB 与游戏存档相关会话数据。
- “清除 Cookies”需要二次点击确认，并会退出 DMM 登录。
- 缓存统计只计算游戏持久分区，不把日志、密码或应用配置算入缓存。

## 图标

`resources/MT-Aigis.icon` 是 macOS 26+ 的主图标输入，使用 Icon Composer 的
`.icon` 包结构，让系统生成 Liquid Glass 反光、边缘和阴影。

图标脚本会同步生成低版本回退资源：

- `resources/icon-layers/foreground-1024.png`
- `resources/icon.png`
- `resources/MT-Aigis.icns`
- `resources/MT-Aigis.xcassets/`

```bash
python3 scripts/build-icons.py
```

打包需要 Xcode 26+ 的 `actool`。`npm run dist:mac` 会默认使用
`/Applications/Xcode.app/Contents/Developer`，并把 Xcode 的 `usr/bin` 放到 PATH 前面。

如果 `.icon` 编译成功，App Bundle 会包含系统生成的 `Assets.car`，并启用
`CFBundleIconName=Icon`。DMG 和低版本 macOS 仍使用兼容 `.icns` 回退。

## 构建

```bash
npm run dist:mac
```

输出 Apple Silicon 的 DMG 和 ZIP。

## GitHub 发布

### 首次准备

1. 在 GitHub 创建公开仓库 `KaguraMatsuri/MT-Aigis`。
2. 本地绑定远程仓库：

```bash
git remote add origin https://github.com/KaguraMatsuri/MT-Aigis.git
git push -u origin main
```

3. 确认仓库启用了 Actions，且 `.github/workflows/release.yml` 已推送到默认分支。

### 每次发新版

1. 修改 `package.json` 里的 `version`。

当前约定：
- `package.json` 的 `version` 例如 `1.0.0`
- 应用显示版本和 `bundleVersion` 例如 `1.0.0.0`
- Git 标签使用 `v1.0.0`

2. 提交版本修改：

```bash
git add .
git commit -m "Release v1.0.0"
```

3. 创建并推送标签：

```bash
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

4. 等待 GitHub Actions 执行完成。

工作流会自动构建并上传：
- `MT-Aigis-<version>-arm64.dmg`
- `MT-Aigis-<version>-arm64.zip`
- `latest-mac.yml`
- 对应的 `.blockmap`

### 自动更新

应用启动后会检查：

`https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/latest-mac.yml`

更新过程如下：

1. 应用读取 `latest-mac.yml`
2. 取得最新版本号和 DMG 文件信息
3. 如果远端版本高于当前版本，则自动下载 DMG 安装包
4. 下载完成后自动打开安装器，并退出当前应用

### 为什么会出现 404

如果自动更新返回 404，通常不是代码坏了，而是以下情况之一：

- GitHub 仓库还不存在
- 仓库不是公开仓库
- 还没有任何 GitHub Release
- Release 里没有 `latest-mac.yml`
- Release 里没有对应 DMG 安装包
- 标签已推送，但 Actions 还没跑完

只要 GitHub Release 页面下列文件齐全，自动更新就会正常工作：

- `latest-mac.yml`
- `MT-Aigis-<version>-arm64.dmg`
- `MT-Aigis-<version>-arm64.dmg.blockmap`
- `MT-Aigis-<version>-arm64.zip`
- `MT-Aigis-<version>-arm64.zip.blockmap`

### 发版自检

发布前建议本地先执行：

```bash
npm install
npm run dist:mac -- --publish never
```

发布后建议检查：

```bash
curl -I https://github.com/KaguraMatsuri/MT-Aigis/releases/latest
curl -I https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/latest-mac.yml
```

如果这两个地址都不是 `404`，自动更新链路通常就是通的。

## 授权

本项目使用 `LICENSE` 中的 `MT-Aigis Personal Use License 1.0`。

简要来说：

- 允许免费下载和使用
- 允许自行修改后私下使用
- 不允许转发、镜像、再分发源码或成品
- 不允许移除作者署名与授权说明
