// WhatPlus 1916 Pro BLE → HTTP 桥接
// 只依赖系统框架：Foundation / CoreBluetooth / Network。
// 运行在离唱片机足够近、带蓝牙的 Mac 上（可以就是 HA 那台）。

import CoreBluetooth
import Foundation
import Network

// MARK: - 配置

struct Config {
    var host = "127.0.0.1"
    var port: UInt16 = 8765
    var token = ""
    var deviceName = "WhatPlus"
    var idleSeconds: Double = 45

    static func load() -> Config {
        var c = Config()
        let env = ProcessInfo.processInfo.environment
        if let v = env["WHATPLUS_HOST"], !v.isEmpty { c.host = v }
        if let v = env["WHATPLUS_PORT"], let p = UInt16(v) { c.port = p }
        if let v = env["WHATPLUS_NAME"], !v.isEmpty { c.deviceName = v }
        if let v = env["WHATPLUS_IDLE_SECONDS"], let s = Double(v) { c.idleSeconds = s }
        if let v = env["WHATPLUS_TOKEN"], !v.isEmpty {
            c.token = v
        } else {
            let path = env["WHATPLUS_TOKEN_FILE"]
                ?? (NSHomeDirectory() + "/.config/whatplus-bridge/token")
            if let t = try? String(contentsOfFile: path, encoding: .utf8) {
                c.token = t.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return c
    }
}

func log(_ s: String) {
    let f = ISO8601DateFormatter()
    f.timeZone = .current
    FileHandle.standardError.write("\(f.string(from: Date())) \(s)\n".data(using: .utf8)!)
}

// MARK: - 协议
// 帧：FE <cmd> 00 00 <len> <payload...> <crc16 大端>
// CRC-16/CCITT-FALSE（init 0xFFFF，poly 0x1021），覆盖 FE 到 payload 末尾。
// 查询帧 len=0；设备以 len=1 的同 cmd 帧回复当前值。写入帧被设备原样回显。

enum Cmd: UInt8 {
    case volume = 0x05       // 只读：设备当前音量档位（由手机端调节）
    case playback = 0x08     // 01 播放 / 00 暂停（设备再经经典蓝牙 AVRCP 发给手机）
    case lightPower = 0x09   // 00 关灯；01 表示灯开着
    case lightMode = 0x0c    // 灯光模式 00 常规 / 01 灯效（灯效只在 01 下可见），写入即开灯
    case lightEffect = 0x0d  // 灯效 0–5
}

enum Protocol {
    static func crc16(_ bytes: [UInt8]) -> UInt16 {
        var c: UInt16 = 0xFFFF
        for b in bytes {
            c ^= UInt16(b) << 8
            for _ in 0..<8 { c = (c & 0x8000) != 0 ? (c << 1) ^ 0x1021 : c << 1 }
        }
        return c
    }

    static func frame(_ cmd: UInt8, _ value: UInt8?) -> Data {
        var b: [UInt8] = [0xFE, cmd, 0x00, 0x00]
        if let v = value { b += [0x01, v] } else { b += [0x00] }
        let crc = crc16(b)
        b += [UInt8(crc >> 8), UInt8(crc & 0xFF)]
        // 官方 App 对 0x0d / 0x12 的查询帧在 CRC 后多补两个 0x00，照抄
        if value == nil && (cmd == 0x0d || cmd == 0x12) { b += [0x00, 0x00] }
        return Data(b)
    }

    /// 解析设备通知，返回 (cmd, value)；CRC 不符返回 nil
    static func parse(_ d: Data) -> (UInt8, UInt8?)? {
        let b = [UInt8](d)
        guard b.count >= 7, b[0] == 0xFE else { return nil }
        let len = Int(b[4])
        guard b.count >= 5 + len + 2 else { return nil }
        let crc = UInt16(b[5 + len]) << 8 | UInt16(b[6 + len])
        guard crc == crc16(Array(b[0..<(5 + len)])) else { return nil }
        return (b[1], len >= 1 ? b[5] : nil)
    }

    static func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
}

// MARK: - 蓝牙

struct BridgeError: Error, CustomStringConvertible {
    let description: String
    init(_ s: String) { description = s }
}

final class Device: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let service = CBUUID(string: "FF77")
    static let writeChar = CBUUID(string: "FF88")
    static let notifyChar = CBUUID(string: "FF99")

    // required=false 的步骤是状态查询：超时只跳过，不算失败（例如关灯时设备不回复灯效查询）
    private struct Step { let frame: Data; let expect: UInt8; let required: Bool }
    private struct Job { let steps: [Step]; let done: (Error?) -> Void }

    let config: Config
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var tx: CBCharacteristic?
    private(set) var ready = false
    private(set) var bluetoothState = "unknown"

    private var waiters: [(Error?) -> Void] = []
    private var connectTimer: DispatchWorkItem?
    private var idleTimer: DispatchWorkItem?

    private var queue: [Job] = []
    private var current: Job?
    private var stepIndex = 0
    private var stepTimer: DispatchWorkItem?

    // 最近一次设备确认的值；断开后保留但标记为非实时
    private(set) var values: [UInt8: UInt8] = [:]
    private(set) var updatedAt: Date?

    init(config: Config) {
        self.config = config
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    // MARK: 对外：排队执行若干帧，全部被设备确认后回调
    func run(_ frames: [(Cmd, UInt8?)], refresh: [Cmd] = [], done: @escaping (Error?) -> Void) {
        let steps = frames.map { Step(frame: Protocol.frame($0.0.rawValue, $0.1), expect: $0.0.rawValue, required: true) }
            + refresh.map { Step(frame: Protocol.frame($0.rawValue, nil), expect: $0.rawValue, required: false) }
        queue.append(Job(steps: steps, done: done))
        pump()
    }

    private func pump() {
        guard current == nil, !queue.isEmpty else { return }
        idleTimer?.cancel()
        ensureReady { [weak self] err in
            guard let self else { return }
            if let err {
                let jobs = self.queue; self.queue.removeAll()
                jobs.forEach { $0.done(err) }
                return
            }
            guard self.current == nil, !self.queue.isEmpty else { return }
            self.current = self.queue.removeFirst()
            self.stepIndex = 0
            self.sendStep()
        }
    }

    private func sendStep() {
        guard let job = current, let p = peripheral, let tx else { return }
        let step = job.steps[stepIndex]
        log("TX \(Protocol.hex(step.frame))")
        p.writeValue(step.frame, for: tx, type: .withResponse)
        let t = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if step.required { self.finishJob(BridgeError("设备 3 秒内没有确认指令")) } else { self.advance() }
        }
        stepTimer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + (step.required ? 3 : 1), execute: t)
    }

    private func stepConfirmed(_ cmd: UInt8) {
        guard let job = current, job.steps[stepIndex].expect == cmd else { return }
        advance()
    }

    private func advance() {
        stepTimer?.cancel()
        guard let job = current else { return }
        stepIndex += 1
        if stepIndex < job.steps.count { sendStep() } else { finishJob(nil) }
    }

    private func finishJob(_ err: Error?) {
        stepTimer?.cancel()
        let job = current
        current = nil
        job?.done(err)
        if queue.isEmpty { scheduleIdle() } else { pump() }
    }

    private func scheduleIdle() {
        idleTimer?.cancel()
        guard config.idleSeconds > 0 else { return }
        // 空闲后主动断开，让 iPhone 上的 WhatPlus App 也能连上
        let t = DispatchWorkItem { [weak self] in
            guard let self, self.current == nil, self.queue.isEmpty, let p = self.peripheral else { return }
            log("空闲 \(Int(self.config.idleSeconds)) 秒，断开蓝牙")
            self.central.cancelPeripheralConnection(p)
        }
        idleTimer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + config.idleSeconds, execute: t)
    }

    // MARK: 连接
    private func ensureReady(_ cb: @escaping (Error?) -> Void) {
        if ready { cb(nil); return }
        waiters.append(cb)
        guard waiters.count == 1 else { return }
        let t = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.central.stopScan()
            if let p = self.peripheral { self.central.cancelPeripheralConnection(p) }
            self.resolveWaiters(BridgeError("30 秒内没连上唱片机（是否被手机占用、距离太远或未通电）"))
        }
        connectTimer = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: t)
        startConnect()
    }

    private func resolveWaiters(_ err: Error?) {
        connectTimer?.cancel()
        let w = waiters; waiters.removeAll()
        w.forEach { $0(err) }
    }

    private func startConnect() {
        guard central.state == .poweredOn else { return }  // 等 didUpdateState
        if let p = central.retrieveConnectedPeripherals(withServices: [Device.service])
            .first(where: { ($0.name ?? "").contains(config.deviceName) }) {
            connect(p); return
        }
        log("扫描 \(config.deviceName)…")
        central.scanForPeripherals(withServices: nil, options: nil)
    }

    private func connect(_ p: CBPeripheral) {
        central.stopScan()
        peripheral = p
        p.delegate = self
        log("连接 \(p.name ?? "?")")
        central.connect(p, options: nil)
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        switch c.state {
        case .poweredOn: bluetoothState = "on"; if !waiters.isEmpty { startConnect() }
        case .unauthorized: bluetoothState = "unauthorized"; resolveWaiters(BridgeError("没有蓝牙权限：系统设置 → 隐私与安全性 → 蓝牙"))
        case .poweredOff: bluetoothState = "off"; resolveWaiters(BridgeError("Mac 蓝牙已关闭"))
        case .unsupported: bluetoothState = "unsupported"; resolveWaiters(BridgeError("这台 Mac 不支持 BLE"))
        default: bluetoothState = "unknown"
        }
        log("蓝牙状态 \(bluetoothState)")
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral,
                        advertisementData ad: [String: Any], rssi: NSNumber) {
        let name = (ad[CBAdvertisementDataLocalNameKey] as? String) ?? p.name ?? ""
        guard name.contains(config.deviceName), peripheral == nil || peripheral == p else { return }
        log("发现 \(name) RSSI \(rssi)")
        connect(p)
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        p.discoverServices([Device.service])
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        resolveWaiters(BridgeError("连接失败：\(error?.localizedDescription ?? "未知")"))
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        log("已断开\(error.map { "：\($0.localizedDescription)" } ?? "")")
        ready = false
        tx = nil
        if current != nil { finishJob(BridgeError("执行中蓝牙断开")) }
        if !waiters.isEmpty { resolveWaiters(BridgeError("连接中途断开")) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard let s = p.services?.first(where: { $0.uuid == Device.service }) else {
            central.cancelPeripheralConnection(p)
            resolveWaiters(BridgeError("没找到 FF77 服务，不是预期的设备"))
            return
        }
        p.discoverCharacteristics([Device.writeChar, Device.notifyChar], for: s)
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        let chars = s.characteristics ?? []
        guard let w = chars.first(where: { $0.uuid == Device.writeChar }),
              let n = chars.first(where: { $0.uuid == Device.notifyChar }) else {
            central.cancelPeripheralConnection(p)
            resolveWaiters(BridgeError("缺少 FF88/FF99 特征"))
            return
        }
        tx = w
        p.setNotifyValue(true, for: n)
    }

    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor ch: CBCharacteristic, error: Error?) {
        guard ch.uuid == Device.notifyChar else { return }
        if let error { resolveWaiters(BridgeError("订阅通知失败：\(error.localizedDescription)")); return }
        log("已就绪")
        ready = true
        resolveWaiters(nil)
    }

    func peripheral(_ p: CBPeripheral, didWriteValueFor ch: CBCharacteristic, error: Error?) {
        if let error { finishJob(BridgeError("写入失败：\(error.localizedDescription)")) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let d = ch.value else { return }
        guard let (cmd, value) = Protocol.parse(d) else { log("RX ? \(Protocol.hex(d))"); return }
        log("RX \(Protocol.hex(d))")
        if let value { values[cmd] = value; updatedAt = Date() }
        stepConfirmed(cmd)
    }
}

// MARK: - 业务指令

final class Bridge {
    let device: Device
    init(device: Device) { self.device = device }

    static let effectCount: UInt8 = 6
    private static let refresh: [Cmd] = [.lightPower, .lightMode, .lightEffect, .playback, .volume]

    func state(live: Bool) -> [String: Any] {
        let v = device.values
        var light: [String: Any] = [:]
        if let p = v[Cmd.lightPower.rawValue] { light["on"] = p != 0 }
        if let m = v[Cmd.lightMode.rawValue] { light["mode"] = Int(m) }
        if let e = v[Cmd.lightEffect.rawValue] { light["effect"] = Int(e) }
        var music: [String: Any] = [:]
        if let p = v[Cmd.playback.rawValue] { music["playing"] = p != 0 }
        if let vol = v[Cmd.volume.rawValue] { music["volume_level"] = Int(vol) }
        var s: [String: Any] = [
            "connected": device.ready,
            "bluetooth": device.bluetoothState,
            "live": live,
            "light": light,
            "music": music,
        ]
        if let t = device.updatedAt { s["updated_at"] = ISO8601DateFormatter().string(from: t) }
        return s
    }

    /// 读一次设备真实状态
    func refresh(done: @escaping (Error?) -> Void) { device.run([], refresh: Bridge.refresh, done: done) }

    func light(_ body: [String: Any], done: @escaping (Error?) -> Void) {
        var frames: [(Cmd, UInt8?)] = []
        if let m = body["mode"] as? Int {
            guard m == 0 || m == 1 else { return done(BridgeError("mode 只能是 0 或 1")) }
            frames.append((.lightMode, UInt8(m)))
        }
        if let e = body["effect"] as? Int {
            guard e >= 0, e < Int(Bridge.effectCount) else { return done(BridgeError("effect 范围 0–5")) }
            // 实测：灯效只在模式 01 下可见；没指定模式时先切到 01
            if !frames.contains(where: { $0.0 == .lightMode }) { frames.append((.lightMode, 1)) }
            frames.append((.lightEffect, UInt8(e)))
        }
        switch body["power"] as? String {
        case "off"?:
            guard frames.isEmpty else { return done(BridgeError("关灯时不要同时设置 mode/effect")) }
            frames.append((.lightPower, 0))
        case "on"?:
            // 官方 App 的“开灯”就是重新写入当前灯光模式
            if !frames.contains(where: { $0.0 == .lightMode }) {
                frames.insert((.lightMode, device.values[Cmd.lightMode.rawValue] ?? 0), at: 0)
            }
        case nil: break
        default: return done(BridgeError("power 只能是 on 或 off"))
        }
        guard !frames.isEmpty else { return done(BridgeError("需要 power / mode / effect 至少一个")) }
        device.run(frames, refresh: Bridge.refresh, done: done)
    }

    func music(_ body: [String: Any], done: @escaping (Error?) -> Void) {
        let action = body["action"] as? String
        let v: UInt8
        switch action {
        case "play"?: v = 1
        case "pause"?: v = 0
        case "toggle"?: v = (device.values[Cmd.playback.rawValue] ?? 0) == 0 ? 1 : 0
        default: return done(BridgeError("action 只能是 play / pause / toggle"))
        }
        device.run([(.playback, v)], refresh: Bridge.refresh, done: done)
    }
}

// MARK: - HTTP

final class HTTPServer {
    let config: Config
    let bridge: Bridge
    let mac: MacAudio
    private var listener: NWListener!

    init(config: Config, bridge: Bridge, mac: MacAudio) throws {
        self.config = config
        self.bridge = bridge
        self.mac = mac
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(config.host),
                                                 port: NWEndpoint.Port(rawValue: config.port)!)
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)
        listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
        listener.stateUpdateHandler = { s in
            if case .failed(let e) = s { log("HTTP 监听失败：\(e)"); exit(1) }
            if case .ready = s { log("HTTP 监听 \(config.host):\(config.port)") }
        }
        listener.start(queue: .main)
    }

    private func accept(_ c: NWConnection) {
        c.start(queue: .main)
        read(c, Data())
    }

    private func read(_ c: NWConnection, _ buf: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, eof, err in
            guard let self else { return }
            var buf = buf
            if let data { buf.append(data) }
            if buf.count > 65536 || err != nil { c.cancel(); return }
            if let req = Request(buf) { self.handle(req, c); return }
            if eof { c.cancel(); return }
            self.read(c, buf)
        }
    }

    private func respond(_ c: NWConnection, _ code: Int, _ obj: Any) {
        let body = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
        let reason = [200: "OK", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found", 503: "Service Unavailable"][code] ?? "OK"
        var head = "HTTP/1.1 \(code) \(reason)\r\nContent-Type: application/json; charset=utf-8\r\n"
        head += "Content-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        c.send(content: head.data(using: .utf8)! + body, completion: .contentProcessed { _ in c.cancel() })
    }

    private func handle(_ r: Request, _ c: NWConnection) {
        if r.path == "/health" { return respond(c, 200, ["ok": true]) }
        guard !config.token.isEmpty, r.headers["authorization"] == "Bearer \(config.token)" else {
            return respond(c, 401, ["error": "unauthorized"])
        }
        let finish: (Error?) -> Void = { [weak self] err in
            guard let self else { return }
            if let err { self.respond(c, 503, ["error": "\(err)", "state": self.bridge.state(live: false)]) }
            else { self.respond(c, 200, self.bridge.state(live: true)) }
        }
        let body = (try? JSONSerialization.jsonObject(with: r.body)) as? [String: Any] ?? [:]
        switch (r.method, r.path) {
        case ("GET", "/v1/state"):
            // 默认只返回缓存，不为轮询去占用蓝牙；?refresh=1 才去读设备
            if r.query.contains("refresh=1") { bridge.refresh(done: finish) }
            else { respond(c, 200, bridge.state(live: false)) }
        case ("POST", "/v1/light"): bridge.light(body, done: finish)
        case ("POST", "/v1/music"): bridge.music(body, done: finish)
        // 这台 Mac 当音源时的播放控制（不经过唱片机 BLE）
        case ("GET", "/v1/mac/state"): respond(c, 200, mac.state())
        case ("POST", "/v1/mac/music"):
            if let err = mac.handle(body) { respond(c, 400, ["error": "\(err)", "state": mac.state()]) }
            else { respond(c, 200, mac.state()) }
        default: respond(c, 404, ["error": "not found"])
        }
    }
}

struct Request {
    let method: String, path: String, query: String
    let headers: [String: String]
    let body: Data

    init?(_ buf: Data) {
        guard let end = buf.range(of: Data("\r\n\r\n".utf8)),
              let head = String(data: buf[..<end.lowerBound], encoding: .utf8) else { return nil }
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines[0].split(separator: " ")
        guard parts.count >= 2 else { return nil }
        var h: [String: String] = [:]
        for l in lines.dropFirst() {
            if let i = l.firstIndex(of: ":") {
                h[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
            }
        }
        let len = Int(h["content-length"] ?? "0") ?? 0
        let bodyStart = end.upperBound
        guard buf.count - bodyStart >= len else { return nil }
        method = String(parts[0])
        let target = String(parts[1])
        if let q = target.firstIndex(of: "?") {
            path = String(target[..<q]); query = String(target[target.index(after: q)...])
        } else { path = target; query = "" }
        headers = h
        body = buf.subdata(in: bodyStart..<(bodyStart + len))
    }
}

// MARK: - 启动

let config = Config.load()
let loopback = ["127.0.0.1", "localhost", "::1"].contains(config.host)
if config.token.isEmpty && !loopback {
    log("监听非本机地址时必须设置令牌（WHATPLUS_TOKEN 或 ~/.config/whatplus-bridge/token）")
    exit(2)
}
if config.token.isEmpty { log("警告：未设置令牌，除 /health 外所有请求都会被拒绝") }

let device = Device(config: config)
let bridge = Bridge(device: device)
let server: HTTPServer
let mac = MacAudio(deviceName: config.deviceName)
do { server = try HTTPServer(config: config, bridge: bridge, mac: mac) } catch { log("启动失败：\(error)"); exit(1) }
signal(SIGTERM) { _ in exit(0) }
RunLoop.main.run()
