@echo off
chcp 65001 >nul
title feedback-nexus Server

cd /d "%~dp0server"

if not exist "node_modules\" (
    echo [INFO] 检测到首次运行，正在安装服务端依赖...
    call npm install
    if errorlevel 1 (
        echo [ERROR] 依赖安装失败
        pause
        exit /b 1
    )
    echo [INFO] 依赖安装完成
)

echo [INFO] 启动服务端 (生产模式)...
set NODE_ENV=production
node src/index.js
if errorlevel 1 (
    echo [ERROR] 服务端启动失败
    pause
    exit /b 1
)

pause
