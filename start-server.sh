#!/bin/bash
set -e

cd "$(dirname "$0")/server"

if [ ! -d "node_modules" ]; then
    echo "[INFO] 检测到首次运行，正在安装服务端依赖..."
    npm install
    echo "[INFO] 依赖安装完成"
fi

echo "[INFO] 启动服务端 (生产模式)..."
NODE_ENV=production node src/index.js
