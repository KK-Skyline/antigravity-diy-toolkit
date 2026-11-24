@chcp 65001 >nul
@echo off
title Antigravity 换肤工具 - 联动 Wallpaper Engine 壁纸引擎
cls

echo ========================================================
echo   Antigravity 换肤工具：联动 Wallpaper Engine 壁纸
echo ========================================================
echo.
echo [1/2] 正在读取 Wallpaper Engine 壁纸配置并注入失重亚克力主题...
node "%~dp0localization_engine.js" --wallpaper %*

if %errorlevel% neq 0 (
    echo.
    echo [错误] 注入失败！请检查上方提示信息。
    echo 提示：
    echo  - 请先完全退出 Antigravity（含系统托盘），或追加 --close-app 参数；
    echo  - 首次安装或客户端升级后，核对来源无误可追加 --confirm-unverified-baseline 参数。
    pause
    exit /b 1
)

echo.
echo [2/2] 部署成功！
echo ========================================================
echo  [√] Wallpaper Engine 动态壁纸与失重亚克力主题已注入完成！
echo  - 适配 Antigravity 2.34+ Shell/Sheet 与悬浮岛毛玻璃设计
echo  - 支持视频壁纸原画播放、场景壁纸合成与亮度自适应
echo  - 配置文件: %~dp0wallpaper_config.json（可通过壁纸选择库调整）
echo ========================================================
echo.
echo 请【完全关闭并重新启动 Antigravity 客户端】以加载最新壁纸与汉化！
echo.
echo 窗口将在 5 秒后自动关闭...
timeout /t 5 >nul
