@echo off
title Antigravity 换肤工具 - 切换黑曜石质感蓝黑主题
cls

echo ========================================================
echo   Antigravity 换肤工具：应用黑曜石质感科技蓝黑皮肤
echo ========================================================
echo.
echo [1/2] 正在注入 Antigravity 官方质感科技蓝黑皮肤与中文补丁...
node "%~dp0localization_engine.js" --dark-blue %*

if %errorlevel% neq 0 (
    echo.
    echo [错误] 换肤注入失败！请检查上方提示信息。
    pause
    exit /b 1
)

echo.
echo [2/2] 换肤成功！
echo ========================================================
echo  [√] 恭喜！Antigravity 专属黑曜石科技蓝黑质感皮肤已部署生效！
echo  重新打开 Antigravity 即可看到全新的高质感界面。
echo ========================================================
echo.
echo 窗口将在 5 秒后自动关闭...
timeout /t 5