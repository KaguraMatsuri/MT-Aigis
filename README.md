<a id="top"></a>

# MT-Aigis

千年戦争アイギス（Millennium War Aigis）向けの非公式 macOS クライアントです。

<img width="3456" height="2160" alt="MT-Aigis running Millennium War Aigis on macOS" src="https://github.com/user-attachments/assets/feacd0f6-6de9-4831-be2f-2f18cccdabb4" />


[中文](#中文) | [English](#english) | [下载最新版本 / Download](https://github.com/KaguraMatsuri/MT-Aigis/releases/latest)

---

## 中文

千年战争Aigis client for macOS

为 macOS 26 / 27 定制与适配的 千年战争Aigis游戏客户端.

(同样适配于 macOS 15 *更低版本未经测试 *Intel Mac未经测试)

! - ! 有啥事随时在NGA/贴吧/QQ(1283962190) 叫我就行, 长期在公司摸鱼

### 主要功能

- [适配] 滚动逻辑: 默认, 在 macOS 下, 对游戏进行滚动操作时, 游戏页面会进行高速的多页滚动. MT-Aigis 对此进行了修复, 同时给予可调整的滚动选项.
- [适配] 图标: 为 macOS 26 / 27 进行图标 (深色模式 / 浅色模式 / 透明模式 / 色彩模式) 的适配.
- [适配] 界面: 为 macOS 适配 深色模式 / 浅色模式.
- [适配] 语言: 根据 macOS 语言设置自动切换 中文 / 英文 / 日文.
- [适配] 画面: 可随客户端窗口变化自调整游戏窗口.
- [功能] 关闭游戏音量.
- [功能] 密码库: 侧边栏中, 可手动键入 E-mail 与 Password / TOTP, 并点击自动复制. 更新: 现已支持自动填充 账户 / 密码 / 2FA.
- [功能] 缓存 / Cookies 统计与清理.
- [功能] 监测出口 IP, 提供对不同域名的 Ping 检测功能.
- [功能] 自动检测并提取官方公告.
- [功能] 自定义游戏链接, 可以加载其他版本 Aigis(虽然有适配但因合规原因不建议加载Fanza版哟).
- [规划更新] 自定义代理. 自动点击器. 指针灵敏度. 更现代化的GUI.

### 安装提示

如果提示软件已损坏, 请执行:

```bash
xattr -dr com.apple.quarantine /Applications/MT-Aigis.app
```

[English](#english) | [下载最新版本](https://github.com/KaguraMatsuri/MT-Aigis/releases/latest) | [返回顶部](#top)

---

## English

Millennium War Aigis client for macOS.

A Millennium War Aigis game client customized and adapted for macOS 26 / 27.

(Also adapted for macOS 15. Earlier versions and Intel Macs have not been tested.)

If you need anything, feel free to reach me through NGA, Tieba, or QQ (1283962190). I am usually around while taking it easy at work.

### Main Features

- [Compatibility] Scrolling: By default, scrolling in the game on macOS can move through multiple pages at high speed. MT-Aigis fixes this behavior and provides adjustable scrolling options.
- [Compatibility] Icon: Supports the dark, light, clear, and tinted icon appearances used by macOS 26 / 27.
- [Compatibility] Interface: Supports the macOS dark and light appearances.
- [Compatibility] Language: Automatically switches between Chinese, English, and Japanese according to the macOS language setting.
- [Compatibility] Game View: Automatically adjusts the game view when the client window changes size.
- [Feature] Mute the game.
- [Feature] Vault: Manually enter an E-mail, Password, or TOTP in the sidebar and copy it with one click. Update: Account, password, and 2FA autofill are now supported.
- [Feature] View and clear cache and cookies.
- [Feature] View the public IP address and test the connection to different domains.
- [Feature] Automatically detect and retrieve official announcements.
- [Feature] Load other Aigis versions with a custom game URL. Although adapted, loading the Fanza version is not recommended for compliance reasons.
- [Planned] Custom proxy, auto clicker, pointer sensitivity, and a more modern GUI.

### Installation Note

If macOS reports that the app is damaged, run:

```bash
xattr -dr com.apple.quarantine /Applications/MT-Aigis.app
```

[中文](#中文) | [Download the latest version](https://github.com/KaguraMatsuri/MT-Aigis/releases/latest) | [Back to top](#top)
