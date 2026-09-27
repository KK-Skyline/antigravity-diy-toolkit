# Antigravity 官方原版一键急救/彻底还原脚本 (PowerShell 版)
$ErrorActionPreference = "Stop"
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "       Antigravity 官方原版一键急救 / 彻底回滚还原" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. 安全关闭进程
Write-Host "`n[1/4] 正在关闭 Antigravity 进程..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -like "*Antigravity*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 2. 定位路径与备份
$resDir = Join-Path $env:LOCALAPPDATA "Programs\antigravity\resources"
$target = Join-Path $resDir "app.asar"
$permBak = Join-Path $resDir "app.asar.official_backup"
$tempBak = Join-Path $resDir "app.asar.bak"

Write-Host "[2/4] 正在检测备份文件..." -ForegroundColor Yellow
if (Test-Path $permBak) {
    Copy-Item $permBak $target -Force
    Write-Host "[还原] 成功用永久官方备份恢复: $target" -ForegroundColor Green
} elseif (Test-Path $tempBak) {
    Copy-Item $tempBak $target -Force
    Write-Host "[还原] 成功用临时备份恢复: $target" -ForegroundColor Green
} else {
    Write-Host "[错误] 未找到任何官方备份文件！" -ForegroundColor Red
    pause
    exit 1
}

# 3. 清理缓存
Write-Host "[3/4] 正在清理缓存以避免新旧字节码冲突..." -ForegroundColor Yellow
$cacheDir = Join-Path $env:APPDATA "Antigravity"
$cacheFolders = @("Cache", "Code Cache", "GPUCache", "DawnWebGPUCache", "DawnGraphiteCache")
foreach ($folder in $cacheFolders) {
    $p = Join-Path $cacheDir $folder
    if (Test-Path $p) {
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " [√] 成功！Antigravity 已彻底恢复为 100% 官方英文纯净版。" -ForegroundColor Green
Write-Host " 备份文件依然安全保留，随时可再次汉化或还原。" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Cyan
Write-Host "按任意键退出..."
[Console]::ReadKey($true) | Out-Null
