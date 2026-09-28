# 默认要求先手动关闭客户端；可显式传入 --close-app 和 --install-dir。
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'localization_engine.js') --huifu @args
if ($LASTEXITCODE -ne 0) {
    Write-Host '恢复已停止；正式 app.asar 与备份请勿手动覆盖或删除。' -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host '已从验证过的备份恢复，备份仍保留。'
