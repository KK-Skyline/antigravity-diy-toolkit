@echo off
title Antigravity 换肤工具 - Wallpaper Engine + 黑曜石质感蓝
cls

echo ========================================================
echo   Antigravity 换肤工具：Wallpaper Engine + 黑曜石质感蓝
echo ========================================================
echo.
echo [1/2] 正在注入科技蓝黑专属质感 + Wallpaper Engine 动态背景...
node "%~dp0localization_engine.js" --dark-blue --wallpaper %*

if %errorlevel% neq 0 (
    echo.
    echo [错误] 注入失败！请检查上方提示信息。
    pause
    exit /b 1
)

echo.
echo [2/2] 部署成功！
echo ========================================================
echo  [√] Wallpaper Engine 动态壁纸背景 + 科技蓝黑主题已应用！
echo  - 兼具壁纸引擎的高帧率背景与黑曜石极简科技质感
echo  - 重新打开 Antigravity 即可尽享双重换肤体验！
echo ========================================================
echo.
echo 窗口将在 5 秒后自动关闭...
timeout /t 5