@echo off
chcp 65001 >nul

cd /d "%~dp0client"

if not exist "node_modules\" (
    echo [INFO] 检测到首次运行，正在安装前端依赖...
    call npm install
    if errorlevel 1 (
        echo [ERROR] 依赖安装失败
        pause
        exit /b 1
    )
    echo [INFO] 依赖安装完成
)

echo [INFO] 构建前端...
call npm run build
if errorlevel 1 (
    echo [ERROR] 构建失败
    pause
    exit /b 1
)

echo.
echo [完成] 前端构建成功！dist 目录下为纯静态文件。
echo       使用 nginx 将 client/dist 指向为网站根目录即可。
echo.
pause
