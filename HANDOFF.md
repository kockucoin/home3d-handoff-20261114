# 交接：我家 3D 户型 + Home Assistant 智能家居

## 任务目标
在 iPad 上有一个可交互的 3D 户型界面，点 3D 里的灯/电器就能控制真实设备；设备主要是米家生态。
长期方案：Home Assistant（HA）+ Xiaomi Home 集成 + 3D 户型卡片（Floor3D Card 或自制卡片），iPad 当中控屏，Siri/小爱做语音。

## 当前进度（2026-11-14）
| 阶段 | 状态 |
|---|---|
| 户型 3D 模型（按户型图毫米尺寸程序生成） | ✅ 完成：`3D模型/home.obj/.mtl`，10 盏灯 + 电器均按英文名命名 |
| 本地 3D 预览页（three.js，可点灯开关、夜间模式） | ✅ 完成：`3D模型/preview.html`（目前只是模拟，没接真实设备） |
| 酷家乐方案（墙体、门窗、42 件家具） | ✅ 已保存，方案 ID `3FO37IBJG8FL`（详见 `3D模型/说明.md`） |
| HA Core 装在这台 Mac（Python venv） | ✅ 已安装 2026.11.0，预装 Xiaomi Home v0.5.0 + HACS 2.0.5 |
| HA 首次向导（建管理员账号）+ 登录米家 | ❌ 未做（需要用户本人操作） |
| 3D 页面 ↔ HA 实时联动 | ❌ 未做 |
| 语音（Siri via HomeKit Bridge / 小爱 / 小智） | ❌ 未做 |
| 树莓派等常驻服务器 | ❌ 未买，目前 HA 只在 Mac 开着时工作 |

## 关键决定与原因
- **不用 Sweet Home 3D**：用户在里面画户型失败；改为脚本 `build.mjs` 按户型图尺寸直接生成模型，可复现、可改。
- **酷家乐网页设计工具很慢**：用户在美国（PST），访问国内酷家乐首页约 20 秒；与代理无关。酷家乐仅用于出方案，不作为 HA 联动的载体。
- **HA 先装在 Mac 上试**（Core + venv，非 Docker），验证流程后再迁移到树莓派 5 / HA Green。
- **米家服务器区域选「中国大陆」**：设备在国内账号下。
- **3D 联动推荐做成 HA 自定义卡片**：卡片能直接拿到 HA 的 `hass` 对象，不需要处理长期访问令牌；备选是 Floor3D Card + `home.obj`。

## 下一步待办
1. 用户双击 `home-assistant/启动HA.command`，在 http://localhost:8123 建管理员账号
2. 用户添加 Xiaomi Home 集成，登录小米账号，勾选灯具
3. 把 `preview.html` 改写成 HA 自定义 Lovelace 卡片（放 `config/www/`），实体映射按 `3D模型/说明.md` 的对象名表
4. 语音：HA 的 HomeKit Bridge 把灯暴露给苹果「家庭」→ iPhone/iPad Siri 中文控制
5. iPad：Companion App + kiosk-mode 全屏

## 文件地图
| 路径 | 说明 |
|---|---|
| `3D模型/build.mjs` | 生成脚本：墙、门窗、地面、家具、灯具 → `home.obj`/`home.mtl`/`preview.html`。运行 `node build.mjs` |
| `3D模型/home.obj`, `home.mtl` | 3D 模型（cm，Y 向上，Z 向南），给 Floor3D 用 |
| `3D模型/preview.html` | 独立预览页（three.js 0.160，CDN 加载） |
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
- three.js 0.160.0（jsDelivr CDN）

## 未上传的本机文件
- 房间照片：`/Users/pandaking/Desktop/房屋/IMG_9781.HEIC` ~ `IMG_9785.HEIC`（客厅、走廊/餐厅、厨房门、卧室B、卧室A；隐私）
- 酷家乐搜索结果缓存：`3D模型/.kjl-results/`
- HA 运行数据、账号与令牌：`home-assistant/config/.storage`、`secrets.yaml`、`*.db`、日志
