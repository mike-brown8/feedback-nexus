#!/bin/bash
set -e

cd "$(dirname "$0")/client"

if [ ! -d "node_modules" ]; then
    echo "[INFO] 检测到首次运行，正在安装前端依赖..."
    npm install
    echo "[INFO] 依赖安装完成"
fi

echo "[INFO] 构建前端..."
npm run build

echo ""
echo "[完成] 前端构建成功！dist 目录下为纯静态文件。"
echo "      使用 nginx 将 client/dist 指向为网站根目录即可。"
echo ""
