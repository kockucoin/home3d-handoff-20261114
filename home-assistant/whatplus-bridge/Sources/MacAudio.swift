// 让“运行桥接的这台 Mac”当唱片机的蓝牙音源，并控制 Mac 上的播放。
// - 播放/暂停：系统“正在播放”媒体命令，无需额外权限（QQ 音乐实测有效）。
// - 上一首/下一首：QQ 音乐不响应上面的命令，改为模拟键盘媒体键（⏮/⏭），
//   需要在「系统设置 → 隐私与安全性 → 辅助功能」里允许 WhatPlusBridge。
// - macOS 不再允许普通程序读取歌名，所以只能控制、不能显示曲目。
// - 音量：调 Mac 的输出音量（声音输出到唱片机时即唱片机音量）。
// - 输出：经典蓝牙连上唱片机，并把 Mac 默认输出切到它。

import AppKit
import CoreAudio
import Foundation
import IOBluetooth

final class MacAudio {
    let deviceName: String
    private var lastCommand: String?
    private var lastCommandAt: Date?

    init(deviceName: String) { self.deviceName = deviceName }

    // MARK: 媒体命令（MediaRemote 私有框架；仅发送命令，这部分在新系统上仍可用，2026-11-16 实测）
    private typealias SendCommand = @convention(c) (UInt32, CFDictionary?) -> Bool
    private lazy var sendCommand: SendCommand? = {
        guard let h = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW),
              let sym = dlsym(h, "MRMediaRemoteSendCommand") else { return nil }
        return unsafeBitCast(sym, to: SendCommand.self)
    }()

    private static let commands: [String: UInt32] = [
        "play": 0, "pause": 1, "toggle": 2, "next": 4, "previous": 5,
    ]

    func handle(_ body: [String: Any]) -> Error? {
        guard let action = body["action"] as? String else { return BridgeError("缺少 action") }
        if action == "next" || action == "previous" {
            if let e = pressMediaKey(action == "next" ? 17 : 18) { return e }  // NX_KEYTYPE_NEXT / PREVIOUS
        } else if let code = MacAudio.commands[action] {
            guard let send = sendCommand else { return BridgeError("系统媒体控制不可用") }
            guard send(code, nil) else { return BridgeError("系统拒绝了媒体命令 \(action)") }
        } else {
            switch action {
            case "volume":
                guard let v = (body["value"] as? NSNumber)?.intValue, (0...100).contains(v) else {
                    return BridgeError("volume 需要 value 0–100")
                }
                if let e = setVolume(v) { return e }
            case "volume_up", "volume_down":
                let step = (body["value"] as? NSNumber)?.intValue ?? 6
                let cur = volume() ?? 50
                if let e = setVolume(max(0, min(100, cur + (action == "volume_up" ? step : -step)))) { return e }
            case "output":
                if let e = routeToTurntable() { return e }
            default:
                return BridgeError("action 只能是 play/pause/toggle/next/previous/volume/volume_up/volume_down/output")
            }
        }
        lastCommand = action
        lastCommandAt = Date()
        return nil
    }

    func state() -> [String: Any] {
        let out = defaultOutputName()
        var s: [String: Any] = [
            "output_device": out ?? "",
            "output_is_turntable": (out ?? "").contains(deviceName),
            "media_control": sendCommand != nil,
            "media_keys": AXIsProcessTrusted(),
        ]
        if let v = volume() { s["volume"] = v }
        if let m = muted() { s["muted"] = m }
        if let c = lastCommand { s["last_command"] = c }
        if let t = lastCommandAt { s["last_command_at"] = ISO8601DateFormatter().string(from: t) }
        return s
    }

    /// 模拟一次媒体键按下+抬起。没有辅助功能权限时系统会静默丢弃，所以先检查并弹出授权提示
    private func pressMediaKey(_ key: Int32) -> Error? {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(opts) else {
            return BridgeError("上一首/下一首需要辅助功能权限：系统设置 → 隐私与安全性 → 辅助功能 → 打开 WhatPlusBridge")
        }
        for down in [true, false] {
            let flags = NSEvent.ModifierFlags(rawValue: down ? 0xa00 : 0xb00)
            let data1 = Int((key << 16) | ((down ? 0xa : 0xb) << 8))
            guard let e = NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags,
                                             timestamp: 0, windowNumber: 0, context: nil, subtype: 8,
                                             data1: data1, data2: -1)?.cgEvent else {
                return BridgeError("无法生成媒体键事件")
            }
            e.post(tap: .cghidEventTap)
        }
        return nil
    }

    // MARK: 音量（AppleScript 标准附加，不涉及其他 App，无需自动化权限）
    private func script(_ src: String) -> NSAppleEventDescriptor? {
        var err: NSDictionary?
        let r = NSAppleScript(source: src)?.executeAndReturnError(&err)
        if let err { log("AppleScript 出错：\(err)") }
        return r
    }

    func volume() -> Int? {
        guard let d = script("output volume of (get volume settings)") else { return nil }
        let v = Int(d.int32Value)
        return d.descriptorType == typeNull ? nil : v
    }

    func muted() -> Bool? { script("output muted of (get volume settings)").map { $0.booleanValue } }

    private func setVolume(_ v: Int) -> Error? {
        script("set volume output volume \(v) without output muted") == nil ? BridgeError("设置音量失败") : nil
    }

    // MARK: 输出设备
    private func outputDevices() -> [(AudioDeviceID, String)] {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
                                              mScope: kAudioObjectPropertyScopeGlobal,
                                              mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap { id in
            var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams,
                                                     mScope: kAudioObjectPropertyScopeOutput,
                                                     mElement: kAudioObjectPropertyElementMain)
            var ssize: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(id, &streams, 0, nil, &ssize) == noErr, ssize > 0 else { return nil }
            return name(of: id).map { (id, $0) }
        }
    }

    private func name(of id: AudioDeviceID) -> String? {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName,
                                              mScope: kAudioObjectPropertyScopeGlobal,
                                              mElement: kAudioObjectPropertyElementMain)
        var cf: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &cf) == noErr, let cf else { return nil }
        return cf.takeRetainedValue() as String
    }

    private var defaultOutputAddress = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)

    func defaultOutputName() -> String? {
        var id: AudioDeviceID = 0
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &defaultOutputAddress, 0, nil, &size, &id) == noErr else { return nil }
        return name(of: id)
    }

    private func setDefaultOutput(_ id: AudioDeviceID) -> Bool {
        var id = id
        let size = UInt32(MemoryLayout<AudioDeviceID>.size)
        return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &defaultOutputAddress, 0, nil, size, &id) == noErr
    }

    /// 经典蓝牙连上唱片机（需事先在系统设置里配对过），并把默认输出切过去
    func routeToTurntable() -> Error? {
        if let dev = outputDevices().first(where: { $0.1.contains(deviceName) }) {
            return setDefaultOutput(dev.0) ? nil : BridgeError("切换输出设备失败")
        }
        // 唱片机有两个蓝牙身份：BLE（控灯）和经典蓝牙音频，这里只要音频类那个
        let paired = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice]) ?? []
        guard let bt = paired.first(where: {
            ($0.name ?? "").contains(deviceName) && $0.deviceClassMajor == BluetoothDeviceClassMajor(kBluetoothDeviceClassMajorAudio)
        }) else {
            return BridgeError("这台 Mac 没配对过唱片机：系统设置 → 蓝牙 里先连接一次 \(deviceName)")
        }
        if !bt.isConnected() {
            log("经典蓝牙连接 \(bt.name ?? "")")
            let r = bt.openConnection()
            if r != kIOReturnSuccess { return BridgeError("蓝牙音频连接失败（\(r)）") }
        }
        // 等系统出现对应的音频输出设备
        for _ in 0..<40 {
            if let dev = outputDevices().first(where: { $0.1.contains(deviceName) }) {
                return setDefaultOutput(dev.0) ? nil : BridgeError("切换输出设备失败")
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return BridgeError("蓝牙已连上，但 10 秒内没出现音频输出设备")
    }
}
