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
| 灯效 6 种 | ✅ 实测每次切换可见；**只在「灯效模式」下可见**，选灯效时会自动切过去 |
| 常规模式 / 灯效模式 | ✅ 设备确认；常规模式的具体样子以实物为准 |
| 播放 / 暂停 | ⚠️ 实验性：设备确认过一次暂停，但见下方「已知限制」 |
| 上一首 / 下一首 / 音量 | ❌ 抓包里 App 没有为它们发 BLE 指令（由手机自己处理），桥接做不了 |

## 已知限制（重要）

- **手机作为蓝牙音箱连着唱片机时，唱片机不广播 BLE，桥接连不上**——这时 HA 既控不了灯，也控不了音乐。
  手机断开蓝牙后恢复。所以播放/暂停按钮实际上很难用上，先保留为实验功能。
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
2. 把脚本最后打印的五行 `whatplus_*` 加进 HA 的 `config/secrets.yaml`（该文件不进 Git）。
3. 重启 HA。会出现：`唱片机灯`、`唱片机灯光模式`、`唱片机 播放 / 暂停 / 刷新状态`、`唱片机桥接`。
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
