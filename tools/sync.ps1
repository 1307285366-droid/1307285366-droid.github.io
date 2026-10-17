# sync.ps1 - copy the project from the dev folder to the deliverable folder.
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools\sync.ps1
#
# Notes:
#   * The source is derived from this script's own location (..\ ), so it always
#     syncs whatever project it sits in.
#   * The target path is built from char codes on purpose, so this file stays
#     pure ASCII and is read correctly by Windows PowerShell 5.1 (which would
#     otherwise mis-decode non-ASCII bytes in a BOM-less .ps1).
#   * robocopy runs WITHOUT /MIR, so nothing in the target is ever deleted.
#     (That keeps the original exam files in the target folder intact.)

$ErrorActionPreference = 'Stop'

$Source = Split-Path -Parent $PSScriptRoot
$Target = 'D:\' + [char]0x8003 + [char]0x6838   # D:\kaohe

if (-not (Test-Path $Target)) {
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
}

$stamp = Get-Date -Format 'HH:mm:ss'

# /E    copy subdirectories including empty ones
# /XF   never copy log files
# /XD   never copy these directories
# /NFL /NDL /NJH /NJS /NP  quiet output
robocopy $Source $Target /E /XF *.log /XD .git node_modules /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
$code = $LASTEXITCODE

# robocopy: 0 = nothing to do, 1..7 = copied fine, >= 8 = failure
if ($code -ge 8) {
  Write-Output "[sync $stamp] FAILED (robocopy exit $code)"
  exit 1
}

Write-Output "[sync $stamp] OK -> $Target"
exit 0
