# scripts/run_scheduled_sync.ps1
# Temporary scheduled sync runner for LIVE -> LOCAL Supabase incremental synchronization
# Invoked every 30 minutes by Windows Task Scheduler (KOB_Live_To_Local_Sync)

$ErrorActionPreference = "Continue"

$ProjectDir = "D:\Shero Home Food\kob-unity-spark (2)"
Set-Location $ProjectDir

$NodeExe = "C:\Program Files\nodejs\node.exe"
$SyncScript = Join-Path $ProjectDir "scripts\sync_live_to_local.mjs"
$LogDir = Join-Path $ProjectDir "logs\sync"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$LatestLog = Join-Path $LogDir "latest_sync.log"

# Run Node sync script and redirect all output streams to latest_sync.log
& $NodeExe $SyncScript 2>&1 | Out-File -FilePath $LatestLog -Encoding utf8
