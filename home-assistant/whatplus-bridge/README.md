# WhatPlus 1916 Pro 唱片机接入 Home Assistant

```
手机 HA App → Home Assistant → whatplus-bridge（HTTP，带令牌）→ Mac 蓝牙 BLE → 唱片机
```

`whatplus-bridge` 是一个只依赖 macOS 系统框架的小程序（Swift + CoreBluetooth + Network），
把唱片机的私有 BLE 协议包装成 HTTP 接口。HA 用 `rest_command` / `rest` 调用它，
配置在 `../config/packages/whatplus.yaml`。

## 能控制什么（2026-11-16 实测）

| 功能 | 状态 |
|---|---|
| 开灯 / 关灯 | ✅ 经桥接实测，肉眼确认灯灭、灯亮 |
| 灯效 6 种 | ✅ 逐个肉眼确认：0 冷白常亮、1 暖白呼吸、2 红橙呼吸、3 浅蓝呼吸、4 深蓝呼吸、5 紫色呼吸；**只在「灯效模式」下可见**，选灯效时会自动切过去 |
| 常规模式 / 灯效模式 | ✅ 设备确认；常规模式的具体样子以实物为准 |
| 播放 / 暂停 | ⚠️ 实验性：设备确认过一次暂停，但见下方「已知限制」 |
| 上一首 / 下一首 / 音量（经手机） | ❌ 抓包里 App 没有为它们发 BLE 指令；改用 Mac 当音源可以做到，见下节 |

## 用这台 Mac 当音源放音乐（推荐）

桥接所在的 Mac 通过蓝牙把唱片机当音箱放歌时，HA 里的「唱片机音乐」可以控制 Mac 上的播放器
（2026-11-16 用 QQ 音乐实测，Apple Music / Spotify 同理）：

| 功能 | 方式 | 状态 |
|---|---|---|
| 播放 / 暂停 | 系统“正在播放”媒体命令 | ✅ 实测，无需额外权限 |
| 上一首 / 下一首 | 模拟键盘 ⏮/⏭ 媒体键（QQ 音乐不响应上面的命令） | ✅ 都已实测；需**辅助功能权限** |
| 音量 | Mac 输出音量（输出到唱片机即唱片机音量） | ✅ 实测 |
| 切到唱片机 | 「唱片机 用 Mac 放音乐」按钮：连上蓝牙音频并设为默认输出 | ⚠️ 已在输出的情况下验证；从断开状态自动连接未实测 |
| 歌名 / 播放状态 | macOS 不允许普通程序读取 | ❌ 只显示音量和最近一次命令 |

**辅助功能权限**：系统设置 → 隐私与安全性 → 辅助功能 → 打开 WhatPlusBridge。
注意要给 `install.sh` 装好的那份（`~/Applications/WhatPlusBridge.app`）；每次重新编译后签名会变，
如果上一首/下一首又报“需要辅助功能权限”，把列表里的 WhatPlusBridge 删掉再用「+」重新加一次，然后重启桥接：
`launchctl kickstart -k gui/$UID/local.home3d.whatplus-bridge`。

Mac 当音源时，控灯和放音乐可以同时进行（实测，先连哪个都行）。

## 已知限制（重要）

- **iPhone 连着唱片机时，桥接扫不到它的 BLE**（推测是 iPhone 占着 BLE 连接）——这时 HA 既控不了灯，也控不了音乐。
  手机断开蓝牙后恢复。所以经手机的播放/暂停按钮实际上很难用上，先保留为实验功能。
- **改用 Mac 当音源则没有这个问题（已实测）**：Mac 通过蓝牙把唱片机当音箱放歌的同时，桥接可正常控灯，
  先连音频或先连 BLE 都可以。唱片机的 BLE（灯光控制）和经典蓝牙（音箱）是两个不同的蓝牙地址。
- BLE 同一时间只能连一台：iPhone 上开着 WhatPlus App 时桥接也连不上。桥接每次执行完空闲 45 秒会主动断开，
  让 App 可以连。
- 状态是“设备最近一次确认的值”，`live: false` 表示是缓存。HA 每 30 秒只读缓存，不会为轮询占用蓝牙；
  点「唱片机 刷新状态」才去读设备。

## 装在哪台 Mac

装在**离唱片机近（同一房间，BLE 约 5–10 米）、有蓝牙**的 Mac 上。

- **就装在 HA 那台 Mac（推荐，若距离够）**：`./install.sh`，只监听 `127.0.0.1`。
  桥接是独立进程、带自己的蓝牙权限，不会像 HA 自带蓝牙集成那样让 HA 被系统结束；HA 里也**不用**开蓝牙集成。
- **装在另一台 Mac**：`./install.sh --lan`，监听局域网，HA 用令牌访问。

## 安装

```bash
cd home-assistant/whatplus-bridge
./install.sh            # 或 ./install.sh --lan
```

1. 第一次运行会弹出「WhatPlusBridge 想使用蓝牙」→ 允许。
   如果没弹：系统设置 → 隐私与安全性 → 蓝牙，打开 WhatPlusBridge。
2. 把脚本最后打印的七行 `whatplus_*` 加进 HA 的 `config/secrets.yaml`（该文件不进 Git）。
3. 重启 HA。会出现：`唱片机灯`、`唱片机灯光模式`、`唱片机音乐`（媒体播放器）、`唱片机 用 Mac 放音乐`、
   `唱片机 播放 / 暂停 / 刷新状态`、`唱片机桥接`、`唱片机音源 Mac`。
   在手机 HA App 里把它们加到仪表盘即可。

卸载：`./uninstall.sh`。日志：`~/Library/Logs/whatplus-bridge.log`。

## HTTP 接口

除 `/health` 外都要 `Authorization: Bearer <令牌>`（令牌在 `~/.config/whatplus-bridge/token`）。

| 请求 | 说明 |
|---|---|
| `GET /health` | 存活检查 |
| `GET /v1/state` | 缓存状态；`?refresh=1` 去设备读一次 |
| `POST /v1/light` | `{"power":"on"}` / `{"power":"off"}` / `{"effect":0-5}` / `{"mode":0或1}` |
| `POST /v1/music` | `{"action":"play"}` / `pause` / `toggle`（实验性） |
| `GET /v1/mac/state` | 这台 Mac 的输出设备、音量、最近命令 |
| `POST /v1/mac/music` | `{"action": play / pause / toggle / next / previous / volume_up / volume_down / output}`，或 `{"action":"volume","value":0-100}` |

命令全部串行执行，只有设备回显确认后才返回 200；失败返回 503 和原因。

```bash
T=$(cat ~/.config/whatplus-bridge/token)
curl -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
     -d '{"power":"off"}' http://127.0.0.1:8765/v1/light
```

## 协议笔记

- GATT：服务 `FF77`，写 `FF88`（write with response），通知 `FF99`。设备名 `WhatPlus 1916 Pro`。
- 帧：`FE <cmd> 00 00 <len> <值> <CRC16 大端>`，CRC-16/CCITT-FALSE（init `FFFF`，poly `1021`），覆盖 `FE`…值。
  `len=0` 为查询，设备回 `len=1` 的同 cmd 帧；写入帧被原样回显。
- 命令：`09` 灯电源（`00` 关）；`0C` 灯光模式 `00` 常规 / `01` 灯效（写入即开灯，App 的“开灯”就是重写当前模式）；
  `0D` 灯效 `00`–`05`；`08` 播放 `01` / 暂停 `00`（唱片机再经经典蓝牙 AVRCP 发给手机）；
  `05` 当前音量档（只读）；`12` App 里有个滑块会写它（`04`/`05`），含义未验证，未开放。
- 灯关着时设备不回复 `0D` 查询，桥接把状态查询当作“尽力而为”。
- 抓包方式：iPhone 装 Apple 的 Bluetooth Logging 描述文件 + Mac 上 PacketLogger（Additional Tools for Xcode）。
  原始抓包含设备地址，不放进仓库。
