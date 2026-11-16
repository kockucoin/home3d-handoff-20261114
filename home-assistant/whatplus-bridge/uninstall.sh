#!/bin/zsh
# 停止并移除 whatplus-bridge 常驻（保留令牌文件，重装后 HA 的 secrets 不用改）
set -euo pipefail
LABEL=local.home3d.whatplus-bridge
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Applications/WhatPlusBridge.app"
echo "已移除。令牌仍在 ~/.config/whatplus-bridge/token，如不再需要可手动删除。"
