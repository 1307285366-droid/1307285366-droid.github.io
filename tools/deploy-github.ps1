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
  # stderr 也一起收下来。PowerShell 会把原生程序写到 stderr 的内容包装成
  # NativeCommandError，直接 2>&1 会渲染成一大块红色"报错"，
  # 其实里面常常只是 git 的 warning。这里统一转成普通文本再打印。
  $out = & $exe @argv 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ }
  } | Out-String
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
# 1a. 本地已经绑过 origin，且该仓库在 GitHub 上确实存在 → 直接沿用。
#      （上次发布已经建好了仓库，这次只需要把新代码推上去，链接不能变）
if (-not $Repo) {
  $remote = (git remote get-url origin 2>$null | Out-String).Trim()
  if ($remote) {
    $owner = ($remote -split '/')[-2]
    $tail = ($remote -split '/')[-1] -replace '\.git$', ''
    if ($tail -and $owner -eq $User) {
      gh repo view "$User/$tail" 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $Repo = $tail
        Say "沿用本地已绑的远端：$User/$Repo（链接不变）"
      } else {
        Say "本地 origin 指向 $User/$tail，但那边没有这个仓库，重新挑一个"
      }
    }
  }
}

# 1b. 还没有定下仓库名：优先用户站点（链接最短）。
#      注意：用户站点「有东西」不代表被别的项目占用，
#      要先看它的 README 是不是本项目，否则会把已经跑起来的站点认成别人的。
if (-not $Repo) {
  $userSite = "$User.github.io"
  gh repo view "$User/$userSite" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $Repo = $userSite
    Say "用户站点仓库还不存在，建一个（链接最短）"
  } else {
    $isOurs = $false
    $raw = (gh api "repos/$User/$userSite/readme" --jq '.content' 2>$null | Out-String)
    if ($raw.Trim()) {
      try {
        $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($raw -replace '\s', '')))
        if ($text -match '狂k重点') { $isOurs = $true }
      } catch { }
    }
    if ($isOurs) {
      $Repo = $userSite
      Say "用户站点仓库 $userSite 里就是本项目，继续用它（链接最短）"
    } else {
      $contents = gh api "repos/$User/$userSite/contents" 2>$null | Out-String
      if ($contents -match '^\s*\[\s*\]\s*$') {
        $Repo = $userSite
        Say "已有空的用户站点仓库，直接用它（链接最短）"
      } else {
        $Repo = 'kuangk-zhongdian'
        Say "用户站点仓库 $userSite 被别的项目占用了，改用项目仓库 $Repo"
      }
    }
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
  # 只建空仓库，不加 --remote/--push：避免本地已有 origin 时 gh 报
  # “Unable to add remote origin” 而把后面的推送整段跳过。
  Say '远端不存在，先在 GitHub 上建仓库…'
  Run 'gh' @('repo', 'create', "$User/$Repo", '--public') | Out-Null
}
Say "把 origin 指向 $User/$Repo 并推送…"
git remote remove origin 2>$null | Out-Null
Run 'git' @('remote', 'add', 'origin', "https://github.com/$User/$Repo.git") | Out-Null
Run 'git' @('push', '-u', 'origin', 'main') | Out-Null
if ($LASTEXITCODE -ne 0) {
  Say '❌ 推送失败，分支没上去，后面几步都不会生效，先停下。'
  exit 1
}

# ---------- 4. 开启 Pages ----------
Say '== 4/5 开启 GitHub Pages =='
$rc = Run 'gh' @('api', '-X', 'POST', "repos/$User/$Repo/pages", '-f', 'source[branch]=main', '-f', 'source[path]=/')
if ($rc -ne 0) {
  # 已经开过 Pages 就会 409/422，这里用 PUT 把源覆盖成 main，重复跑也没事。
  Say '（POST 失败，改成 PUT 覆盖设置）'
  Run 'gh' @('api', '-X', 'PUT', "repos/$User/$Repo/pages", '-f', 'source[branch]=main', '-f', 'source[path]=/') | Out-Null
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
if ($built) {
  # Pages 报 built 不等于真能打开，再实际 GET 一下。
  $http = '没测出来'
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    $http = "HTTP $($resp.StatusCode)"
  } catch { $http = "打不开（$($_.Exception.Message)）" }
  Say "✅ 发布成功（$http）"
} else { Say '⚠️ 还没跑完，稍等一两分钟再刷新' }
Say "链接: $url"
Say "仓库: https://github.com/$User/$Repo"
Say '========================================='
Say ''
Say '提示：GitHub Pages 首次生效通常需要 1-3 分钟。'
Say '      在国内 *.github.io 有时访问不稳，如果打不开可以用 4G/5G 试，'
Say '      或告诉我，我给你换 Gitee Pages / Cloudflare Pages 的方案。'
