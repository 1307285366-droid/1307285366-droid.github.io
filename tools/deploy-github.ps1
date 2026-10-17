# 一键把「狂k重点」发布到 GitHub Pages，拿到一个永久公网链接。
#
#   powershell -ExecutionPolicy Bypass -File tools\deploy-github.ps1
#
# 需要：已装 git + gh，且 gh 已登录（gh auth login）。
# 可选参数：
#   -User   GitHub 用户名（默认自动取 gh 当前登录账号）
#   -Repo   仓库名（默认优先用 <User>.github.io，链接最短）
#
# 链接形如：
#   用户站点   https://<User>.github.io/
#   项目站点   https://<User>.github.io/<Repo>/

param(
  [string]$User = '',
  [string]$Repo = ''
)

$logFile = Join-Path $env:USERPROFILE 'gh-deploy.log'
Remove-Item $logFile -ErrorAction SilentlyContinue

function Say($msg) {
  Write-Host $msg
  Add-Content -Path $logFile -Value $msg -Encoding UTF8
}

function Run($exe, $argv) {
  $out = & $exe @argv 2>&1 | Out-String
  if ($out.Trim()) { Say $out.Trim() }
  return $LASTEXITCODE
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Say "工作目录: $root"

# ---------- 0. 确认 gh 已登录 ----------
if (-not $User) {
  $User = (gh api user --jq '.login' 2>$null | Out-String).Trim()
}
if (-not $User) { Say '❌ 拿不到 gh 登录账号，请先执行 gh auth login'; exit 1 }
Say "GitHub 账号: $User"

# ---------- 1. 选仓库名 ----------
if (-not $Repo) {
  $userSite = "$User.github.io"
  gh repo view "$User/$userSite" 2>$null | Out-Null
  $exists = ($LASTEXITCODE -eq 0)
  if ($exists) {
    # 仓库存在，但如果是空的，仍然可以用（链接最短）
    $contents = gh api "repos/$User/$userSite/contents" 2>$null | Out-String
    if ($contents -match '^\s*\[\s*\]\s*$') {
      $Repo = $userSite
      Say "已有空的用户站点仓库，直接用它（链接最短）"
    } else {
      $Repo = 'kuangk-zhongdian'
      Say "用户站点仓库 $userSite 里已经有东西了，改用项目仓库 $Repo"
    }
  } else {
    $Repo = $userSite
    Say "用户站点仓库还不存在，建一个（链接最短）"
  }
}
Say "仓库: $User/$Repo"

# ---------- 2. 本地仓库 + 提交 ----------
Say '== 1/5 初始化本地仓库 =='
if (-not (Test-Path (Join-Path $root '.git'))) {
  Run 'git' @('init', '-b', 'main') | Out-Null
} else {
  Say '已存在 .git，跳过 init'
}
Run 'git' @('config', 'user.name', $User) | Out-Null
Run 'git' @('config', 'user.email', "$User@users.noreply.github.com") | Out-Null

Say '== 2/5 暂存并提交 =='
Run 'git' @('add', '-A') | Out-Null
$status = git status --porcelain | Out-String
if ($status.Trim()) {
  Run 'git' @('commit', '-m', '狂k重点：纯静态刷题 MVP（题库转换 / 即时判分 / 错题本 / 重刷）') | Out-Null
} else {
  Say '没有新改动，跳过提交'
}

# ---------- 3. 远端 ----------
Say '== 3/5 推送 =='
gh repo view "$User/$Repo" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Say "远端不存在，创建并推送…"
  Run 'gh' @('repo', 'create', $Repo, '--public', '--source=.', '--remote=origin', '--push') | Out-Null
} else {
  Say '远端已存在，设置 origin 并推送…'
  git remote remove origin 2>$null | Out-Null
  Run 'git' @('remote', 'add', 'origin', "https://github.com/$User/$Repo.git") | Out-Null
  Run 'git' @('push', '-u', 'origin', 'main') | Out-Null
}

# ---------- 4. 开启 Pages ----------
Say '== 4/5 开启 GitHub Pages =='
$pagesBody = @('api', '-X', 'POST', "repos/$User/$Repo/pages", '-f', 'source[branch]=main', '-f', 'source[path]=/')
& gh @pagesBody 2>&1 | Out-String | ForEach-Object { if ($_.Trim()) { Say $_.Trim() } }
if ($LASTEXITCODE -ne 0) {
  Say '（POST 失败，改成 PUT 覆盖设置）'
  & gh api -X PUT "repos/$User/$Repo/pages" -f 'source[branch]=main' -f 'source[path]=/' 2>&1 |
    Out-String | ForEach-Object { if ($_.Trim()) { Say $_.Trim() } }
}

# ---------- 5. 等构建完成 ----------
Say '== 5/5 等构建 =='
$url = if ($Repo -eq "$User.github.io") { "https://$User.github.io/" } else { "https://$User.github.io/$Repo/" }
$built = $false
for ($i = 1; $i -le 25; $i++) {
  Start-Sleep -Seconds 6
  $json = (gh api "repos/$User/$Repo/pages" 2>$null | Out-String)
  if ($json -match '"status"\s*:\s*"built"') { $built = $true; Say "第 $i 次检查：built ✅"; break }
  Say "第 $i 次检查：还没好…"
}

Say ''
Say '========================================='
if ($built) { Say '✅ 发布成功' } else { Say '⚠️ 还没跑完，稍等一两分钟再刷新' }
Say "链接: $url"
Say "仓库: https://github.com/$User/$Repo"
Say '========================================='
Say ''
Say '提示：GitHub Pages 首次生效通常需要 1-3 分钟。'
Say '      在国内 *.github.io 有时访问不稳，如果打不开可以用 4G/5G 试，'
Say '      或告诉我，我给你换 Gitee Pages / Cloudflare Pages 的方案。'
