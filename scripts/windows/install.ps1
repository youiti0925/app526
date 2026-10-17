# クラウドワークス巡回を、1行で準備する（Windows・管理者の権限は要らない）。
#
# PowerShell に次の1行を貼って Enter:
#   irm https://raw.githubusercontent.com/youiti0925/app526/claude/auto-side-hustle-app-plz2sh/scripts/windows/install.ps1 | iex
#
# やること: Node.js と Git を入れる → このリポジトリを取ってくる → 部品を入れる →
#           Claude Code を入れてログイン → 巡回の設定（Edgeでクラウドワークスにログイン・Gメール）→ 自動実行の登録
# 2回目以降に実行しても壊れない（入っているものは入れ直さない）。

$ErrorActionPreference = 'Continue'
$Branch = 'claude/auto-side-hustle-app-plz2sh'
$Dir = Join-Path $env:USERPROFILE 'app526'

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Has($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }

Step 'クラウドワークス巡回の準備を始めます（途中で何回か、入力や確認をお願いします）'

if (-not (Has 'winget')) {
  Write-Host 'winget が見つかりません。Microsoft Store で「アプリ インストーラー」を更新してから、もう一度この1行を実行してください。' -ForegroundColor Yellow
  return
}

if (-not (Has 'node')) {
  Step 'Node.js を入れています'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  Refresh-Path
}
if (-not (Has 'git')) {
  Step 'Git を入れています'
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements --silent
  Refresh-Path
}
if (-not (Has 'node') -or -not (Has 'git')) {
  Write-Host '入れたものがまだ見つかりません。PowerShell を一度閉じて開き直し、もう一度この1行を実行してください。' -ForegroundColor Yellow
  return
}

Step 'プログラムを取ってきています'
if (Test-Path (Join-Path $Dir '.git')) {
  git -C $Dir fetch --quiet origin $Branch
  git -C $Dir checkout --quiet $Branch
  git -C $Dir pull --quiet --ff-only
} else {
  git clone --quiet --branch $Branch https://github.com/youiti0925/app526.git $Dir
}
Set-Location $Dir

Step '部品を入れています（数分かかります）'
& npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host '部品を入れられませんでした。上のエラーを、そのまま会話に貼ってください。' -ForegroundColor Yellow; return }

if (-not (Has 'claude')) {
  Step 'Claude Code を入れています（募集の判定と提案文に使います）'
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  Refresh-Path
  $local = Join-Path $env:USERPROFILE '.local\bin'
  if ((Test-Path $local) -and ($env:Path -notlike "*$local*")) { $env:Path = "$env:Path;$local" }
}
if (Has 'claude') {
  & claude auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    Step 'Claude にログインします（ブラウザが開くので、いつものアカウントでログインしてください）'
    & claude auth login
  }
} else {
  Write-Host 'Claude Code を入れられませんでした。やり取りの確認とGメールは動きますが、募集の判定と提案文は出ません。' -ForegroundColor Yellow
}

Step '巡回の設定をします（Edge が開きます）'
& node scripts\cw-patrol.mjs setup --register

# スマホから、このPCで動くClaudeと話すための入口をデスクトップに置く
try {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude（app526）.lnk'))
  $lnk.TargetPath = Join-Path $Dir 'scripts\windows\claude-pc.cmd'
  $lnk.WorkingDirectory = $Dir
  $lnk.Save()
} catch { }

Step '終わりました。このあとはPCをつけている間、自動で巡回して、知らせることがあればGメールに届きます。'
Write-Host 'スマホからこのPCのClaudeと話したいときは、デスクトップの「Claude（app526）」をダブルクリックしてください（窓は開いたままに）。'
