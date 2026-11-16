#!/bin/zsh
# 编译成 build/WhatPlusBridge.app（带蓝牙权限说明，ad-hoc 签名）
set -euo pipefail
cd "${0:A:h}"
APP=build/WhatPlusBridge.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/whatplus-bridge" Sources/*.swift
codesign --force --sign - "$APP"
echo "已编译：$PWD/$APP"
