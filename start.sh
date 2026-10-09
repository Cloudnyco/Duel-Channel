#!/bin/sh
# Duel Channel - one-step hosting on Linux / macOS: dependencies, asset check, build when needed, server.
# Arguments go to tools/host.mjs, e.g.  ./start.sh --lan   (see docs/DEPLOY.md)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node.js 22 或更新的版本：https://nodejs.org/ （或用发行版的包管理器、nvm）"
  exit 1
fi
exec node tools/host.mjs "$@"
