# 交接：我家 3D 户型 + Home Assistant 智能家居

## 任务目标
在 iPad 上有一个可交互的 3D 户型界面，点 3D 里的灯/电器就能控制真实设备；设备主要是米家生态。
长期方案：Home Assistant（HA）+ Xiaomi Home 集成 + 3D 户型卡片（Floor3D Card 或自制卡片），iPad 当中控屏，Siri/小爱做语音。

## 当前进度（2026-11-15 第三次存档）
| 阶段 | 状态 |
|---|---|
| 户型 3D 模型（按户型图毫米尺寸程序生成） | ✅ 完成：`3D模型/home.obj/.mtl`，10 盏灯 + 电器均按英文名命名 |
| 3D 中控页（仿小红书 iPad 效果，可旋转） | ✅ 完成：`3D模型/preview.html` 单文件 / `3D模型/app/`。精细家具、按房间限定的灯光、图标+控制卡片、场景、矮墙。**模拟模式**，未接真实设备 |
| 米家现状（2026-11-14 用 adb 查看手机 REDMI K80） | 只有 1 个设备：客厅「润盛 LED 智能灯泡 Mesh2.0」，蓝牙 Mesh，**离线**；家里网络 192.168.10.x 上扫不到任何 Wi-Fi 智能设备 |
| 酷家乐方案（墙体、门窗、42 件家具） | ✅ 已保存，方案 ID `3FO37IBJG8FL`（详见 `3D模型/说明.md`） |
| HA Core 装在这台 Mac（Python venv） | ✅ 已安装 2026.11.0，预装 Xiaomi Home v0.5.0 + HACS 2.0.5 |
| HA 首次向导（建管理员账号）+ 登录米家 | ❌ 未做（需要用户本人操作） |
| 3D 页面 ↔ HA 实时联动 | ❌ 未做 |
| 语音（Siri via HomeKit Bridge / 小爱 / 小智） | ❌ 未做 |
| 树莓派等常驻服务器 | ❌ 未买，目前 HA 只在 Mac 开着时工作 |


## 2026-11-15 更新：手机中转初版（点 3D 里的灯 → 真实灯开/关）
- 背景：3 盏灯（润盛 Mesh2.0、V8 色温灯 ×2）都是蓝牙 Mesh，家里**没有 Mesh 网关**，小米云 / HA 里一直离线（`miot_devices` 缓存 online=False）。米家 App 能控是因为手机在旁边用蓝牙直连。
- 初版方案：`3D模型/relay/server.mjs`（Node，无依赖，端口 8795）通过 adb 操作手机上的米家 App：打开灯页面 → 读「关闭/开启、关灯/开灯」按钮判断状态 → 点电源按钮。3D 页面 `3D模型/relay.html`（由中转服务在 `/` 提供，three.js 由 `/vendor` 本地提供，手机访问不了 jsDelivr）。
- 实测：同一盏灯再次开关 ≈0.6 秒（Mac 上点）/ ≈2.2 秒（手机浏览器里点，米家会闪一下再切回）；换另一盏灯 ≈15–20 秒（米家要重新蓝牙连接）。
- 关键坑：读屏 `uiautomator dump` 一次 ≈2.3 秒；蓝牙刚连上时页面先显示占位状态 → 需连续两次读到相同状态才算数；V8 开着显示「关闭」、关着显示「开启」+标题「已关闭」；8791 端口被别的 Python 进程占用 → 改 8795；HA 在 Mac 上开蓝牙会被 macOS 结束 → configuration.yaml 去掉了 bluetooth。
- HA 侧也已打通：`home3d-card`（`config/www/home3d/`，经 `loader.js` 免缓存加载）+「3D 中控」仪表盘，实体已绑定；等装了 Mesh 网关就能直接用，不需要手机中转。
- 2026-11-15 追加：米家切后台或闲置几秒就会断开灯的蓝牙（页面出现「未连接/重连」，整页下移）→ 中转每次操作前先确认连接、必要时点「重连」，并用同一次读屏里的按钮位置。手机浏览器里点开/关现在可靠但慢（约 8–22 秒）。
- 亮度/色温滑条：模拟拖动不可靠（会过冲、卡在 100%），情景模式按钮结果也不稳定 → 3D 页面初版只开放开/关；`setLevel`/`setScene` 代码保留在 relay/server.mjs 里但页面未启用。精确调节等网关（小爱音箱 Pro 带蓝牙 Mesh 网关即可）后走 HA。
- 下一步候选：买小米中枢网关 / 多模网关 2（推荐）；或做 Android App（无障碍服务操作米家，免数据线、读屏更快）。


## 2026-11-15 晚：小爱音箱 Pro 网关上线，HA 直接控制已通
- 小爱音箱 Pro（米家名「Xiaomi 智能音箱 Pro」）需在 米家→音箱→设置→更多设置→蓝牙网关 里打开「蓝牙Mesh网关」（默认关）；打开后 3 盏灯在线。HA 里需要「重新加载 Xiaomi Home 集成」才刷新在线状态。
- 实测对应（已改 home3d-dashboard.yaml）：客厅灯笼 ← V8 智能色温灯（Mesh），餐厅吊灯 ← 润盛灯泡，卧室B ← V8 2。
- 手机：已装 HA 官方 Android App（2026.11.1 minimal，GitHub 官方 release，SHA-256 与 GitHub digest 一致，签名 O=Home Assistant）。旧的手机中转（relay，8795）已停用。
- 3D 卡片（简洁模式默认开，`simple: false` 恢复完整）：只显示已接入设备；点灯/点房间开关；按住灯或房间 → 底部卡片（亮度、色温、4 个预设：明亮/阅读/温馨/夜灯），画面自动上移不被遮挡；顶栏仿参考视频的胶囊样式；白天/夜晚跟随 sun.sun。
- kiosk-mode v15.0.0（用户同意）放在 config/www/home3d/，由卡片自己 import（loader.js 会被缓存 31 天，所以不靠它）；dashboard yaml 的 kiosk_mode 在 ≤900px 宽隐藏 HA 顶栏/侧边栏。用户手机上是否生效待确认。
- 安卓工具：~/Library/Android/Android-Dev-Mac-AppleSilicon（只解压了 jbr/android-35/build-tools 35/platform-tools，0.46GB；放「文稿」会触发隐私弹窗，已移出）。

## 关键决定与原因
- **不用 Sweet Home 3D**：用户在里面画户型失败；改为脚本 `build.mjs` 按户型图尺寸直接生成模型，可复现、可改。
- **酷家乐网页设计工具很慢**：用户在美国（PST），访问国内酷家乐首页约 20 秒；与代理无关。酷家乐仅用于出方案，不作为 HA 联动的载体。
- **HA 先装在 Mac 上试**（Core + venv，非 Docker），验证流程后再迁移到树莓派 5 / HA Green。
- **米家服务器区域选「中国大陆」**：设备在国内账号下。
- **3D 联动推荐做成 HA 自定义卡片**：卡片能直接拿到 HA 的 `hass` 对象，不需要处理长期访问令牌；备选是 Floor3D Card + `home.obj`。
- **3D 页面用 three.js 代码生成家具，不下载模型**：网络很慢（npm 15MB 要十几分钟），所以纹理（木地板、花砖、布料、藤编）也用 canvas 现场生成。
- **灯光只照亮本房间**：每盏主灯开点光源阴影；阴影图只在状态变化时重算（`shadowMap.autoUpdate=false`），iPad 省电。墙压低显示时用看不见的全高"影子墙"继续挡光。
- **去掉了 GTAO 环境光遮蔽**：在背景上产生暗块伪影，且 iPad 本来就不开。
- **酷家乐不做联动载体**：CLI 没有导出模型/渲染效果图的工具，只能在它网站里看；适合出好看的鸟瞰效果图。

## 下一步待办
1. 用户双击 `home-assistant/启动HA.command`，在 http://localhost:8123 建管理员账号
2. 用户添加 Xiaomi Home 集成，登录小米账号，勾选灯具
3. 买蓝牙 Mesh 网关（小米中枢网关/带网关的小爱音箱），让润盛灯泡在线；或换 Wi-Fi 灯（易来）
4. 把 `app/home3d.js` 包成 HA 自定义 Lovelace 卡片（`createHome3D` 已留 `onCommand` / `setState` 接口），实体映射按 `3D模型/说明.md` 的对象名表
5. 语音：HA 的 HomeKit Bridge 把灯暴露给苹果「家庭」→ iPhone/iPad Siri 中文控制
6. iPad：Companion App + kiosk-mode 全屏

## 文件地图
| 路径 | 说明 |
|---|---|
| `3D模型/build.mjs` | 生成脚本：墙、门窗、地面、灯具、设备、家具布局（`layout`）→ `home.obj`/`home.mtl`/`app/house.json`/`preview.html`。运行 `node build.mjs` |
| `3D模型/home.obj`, `home.mtl` | 3D 模型（cm，Y 向上，Z 向南），给 Floor3D 用 |
| `3D模型/preview.html` | 3D 中控页单文件（build.mjs 把 app/home3d.js + 数据内联生成；three.js 0.170 走 CDN） |
| `3D模型/app/home3d.js` | 3D 中控页源码：家具/灯具生成器、灯光、墙体压低、图标、控制卡片、场景、镜头 |
| `3D模型/app/index.html`, `app/house.json` | 拆分版页面 + build.mjs 导出的户型/布局/设备数据 |
| `3D模型/说明.md` | 可控制对象名对照表、Floor3D 配置示例、酷家乐方案记录 |
| `3D模型/酷家乐平面图.jpg` | 酷家乐方案的 2D 平面截图 |
| `3D模型/.kjl/*.json`, `picks.txt` | 酷家乐 CLI 用到的墙体/门窗/家具参数与选品 ID |
| `room.jpg` | 原始户型图（带毫米尺寸，建模依据） |
| `home-assistant/启动HA.command`, `停止HA.command` | 启停 HA（后台运行，日志 `ha.log`） |
| `home-assistant/使用说明.md` | HA 安装方式与首次使用步骤 |
| `home-assistant/config/*.yaml` | HA 配置（不含 secrets.yaml） |

## 外部依赖
- 酷家乐：`@manycore/kjl-cli` 0.2.25（npm 全局），skill 在 `~/.claude/skills/kujiale`，专用浏览器配置 `~/.kjl/chrome-profile`
- Home Assistant Core 2026.11.0，Python 3.14 venv：`home-assistant/.venv`（未上传，按 `使用说明.md` 重建）
- 自定义集成（未上传）：Xiaomi Home v0.5.0（GitHub `XiaoMi/ha_xiaomi_home`）、HACS 2.0.5
- three.js 0.170.0（jsDelivr CDN）
- adb（Android platform-tools，装在 `~/Library/Android/platform-tools`，链接到 `~/.local/bin/adb`），用于查看小米手机上的米家 App

## 未上传的本机文件
- 房间照片：`/Users/pandaking/Desktop/房屋/IMG_9781.HEIC` ~ `IMG_9785.HEIC`（客厅、走廊/餐厅、厨房门、卧室B、卧室A；隐私）
- 新房间照片（2026-11-14）：`/Users/pandaking/Downloads/IMG_9958.HEIC` ~ `IMG_9961.HEIC`（餐厅、客厅夜景、卧室B、餐厅看客厅）
- 参考效果视频：`/Users/pandaking/Downloads/ScreenRecording_11-14-2026 20-35-16_1.MP4`（小红书「Jessie的新家」iPad 3D 中控）
- 酷家乐搜索结果缓存：`3D模型/.kjl-results/`
- HA 运行数据、账号与令牌：`home-assistant/config/.storage`、`secrets.yaml`、`*.db`、日志
