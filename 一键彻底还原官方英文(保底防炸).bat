@echo off
chcp 65001 >nul
title Antigravity 官方原版一键急救/彻底还原工具
cls

echo ========================================================
echo        Antigravity 官方原版一键急救 / 彻底回滚还原
echo ========================================================
echo.

echo [1/4] 正在安全关闭 Antigravity 进程...
taskkill /f /im Antigravity.exe /t >nul 2>nul
timeout /t 1 /nobreak >nul

set "RES_DIR=%LOCALAPPDATA%\Programs\antigravity\resources"
set "BAK_PERM=%RES_DIR%\app.asar.official_backup"
set "BAK_TEMP=%RES_DIR%\app.asar.bak"
set "TARGET=%RES_DIR%\app.asar"

echo [2/4] 正在检测备份文件...
if exist "%BAK_PERM%" (
    echo [还原] 发现永久官方备份，正在恢复官方 app.asar ...
    copy /y "%BAK_PERM%" "%TARGET%" >nul
    if errorlevel 1 (
        echo [错误] 文件复制失败，请确认是否具有管理员权限！
        pause
        exit /b 1
    )
    echo [还原] 官方原版 app.asar 已成功覆盖恢复！
) else if exist "%BAK_TEMP%" (
    echo [还原] 发现 app.asar.bak 备份，正在恢复官方 app.asar ...
    copy /y "%BAK_TEMP%" "%TARGET%" >nul
    if errorlevel 1 (
        echo [错误] 文件复制失败！
        pause
        exit /b 1
    )
    echo [还原] 官方原版 app.asar 已成功覆盖恢复！
) else (
    echo [错误] 未能找到任何官方备份文件 (%BAK_PERM%)！
    pause
    exit /b 1
)

echo [3/4] 正在清理缓存以避免新旧字节码冲突...
set "CACHE_DIR=%APPDATA%\Antigravity"
if exist "%CACHE_DIR%\Cache" rd /s /q "%CACHE_DIR%\Cache" >nul 2>nul
if exist "%CACHE_DIR%\Code Cache" rd /s /q "%CACHE_DIR%\Code Cache" >nul 2>nul
if exist "%CACHE_DIR%\GPUCache" rd /s /q "%CACHE_DIR%\GPUCache" >nul 2>nul
if exist "%CACHE_DIR%\DawnWebGPUCache" rd /s /q "%CACHE_DIR%\DawnWebGPUCache" >nul 2>nul
if exist "%CACHE_DIR%\DawnGraphiteCache" rd /s /q "%CACHE_DIR%\DawnGraphiteCache" >nul 2>nul

echo [4/4] 还原校验完成！
echo.
echo ========================================================
echo  [√] 成功！Antigravity 已彻底恢复为 100%% 官方英文纯净版。
echo  备份文件仍已妥善保留，随时可再次汉化或再次还原。
echo ========================================================
echo.
pause
