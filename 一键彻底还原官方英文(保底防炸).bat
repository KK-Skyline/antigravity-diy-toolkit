@echo off
chcp 65001 >nul
title Antigravity 官方备份验证与恢复

rem 默认要求先手动关闭客户端；可显式传入 --close-app 和 --install-dir。
node "%~dp0localization_engine.js" --huifu %*
set "RESTORE_EXIT=%ERRORLEVEL%"
if not "%RESTORE_EXIT%"=="0" (
    echo [错误] 恢复已停止；正式 app.asar 与备份请勿手动覆盖或删除。
    pause
    exit /b %RESTORE_EXIT%
)
echo [完成] 已从验证过的备份恢复，备份仍保留。
pause
