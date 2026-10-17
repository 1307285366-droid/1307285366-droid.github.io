# watch-sync.ps1 - keep the deliverable folder in sync automatically.
#
# Polls the project folder every 2 seconds; whenever any project file changes,
# it runs sync.ps1 so the deliverable folder (D:\kaohe) is updated immediately.
#
# Start (hidden, detached):
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File tools\watch-sync.ps1
# Stop:
#   Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
#     Where-Object { $_.CommandLine -like '*watch-sync.ps1*' } |
#     ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
#
# Log: %USERPROFILE%\quiz-sync.log

$Source = Split-Path -Parent $PSScriptRoot
$SyncScript = Join-Path $PSScriptRoot 'sync.ps1'
$Log = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'quiz-sync.log'

function Write-Log([string]$Text) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Text" | Add-Content -Path $Log -Encoding UTF8
}

function Get-NewestWriteTime {
  $newest = Get-ChildItem $Source -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -ne '.log' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($newest) { return $newest.LastWriteTime }
  return $null
}

Write-Log "watcher started (pid $PID), watching $Source"

# initial sync
$out = & $SyncScript
Write-Log ($out -join ' ')
$last = Get-NewestWriteTime

while ($true) {
  Start-Sleep -Seconds 2
  $newest = Get-NewestWriteTime
  if ($newest -and $last -and $newest -gt $last) {
    $last = $newest
    Start-Sleep -Milliseconds 900   # let editors finish writing
    $result = & $SyncScript
    Write-Log ($result -join ' ')
  }
}
