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

1. 在 GitHub 创建仓库 `KaguraMatsuri/MT-Aigis`。
2. 本地执行 `git remote add origin https://github.com/KaguraMatsuri/MT-Aigis.git`。
3. 执行 `git push -u origin main`。
4. 发布新版时修改 `package.json` 版本号，创建并推送标签，例如 `git tag v1.0.0 && git push origin v1.0.0`。

仓库内的 GitHub Actions 会在标签发布时生成 DMG、ZIP 与更新清单。
