@chcp 65001 >nul
@echo off
title Antigravity 换肤工具 - 联动 Wallpaper Engine 壁纸引擎
cls

echo ========================================================
echo   Antigravity 换肤工具：联动 Wallpaper Engine 壁纸
echo ========================================================
echo.
echo [1/2] 正在读取 Wallpaper Engine 激活壁纸并注入动态亚克力背景...
node "%~dp0localization_engine.js" --wallpaper %*

if %errorlevel% neq 0 (
    echo.
    echo [错误] 注入失败！请检查上方提示信息。
    pause
    exit /b 1
)

echo.
echo [2/2] 部署成功！
echo ========================================================
echo  [√] Wallpaper Engine 实时壁纸联动皮肤已注入完成！
echo  - 目标壁纸: 进击的巨人·兵长利威尔 (preview.gif 动态帧)
echo  - 磨砂亚克力微透设计，代码与聊天文字保持极佳对比度
echo  - 开启实时监听：在壁纸引擎中切换壁纸，客户端自动无缝换肤！
echo  - 配置文件: D:\antigravity2-cn\wallpaper_config.json 可随时微调
echo ========================================================
echo.
echo 请【完全关闭并重新启动 Antigravity 客户端】以加载最新壁纸与汉化！
echo.
echo 窗口将在 5 秒后自动关闭...
timeout /t 5 >nul
