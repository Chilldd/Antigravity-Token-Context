$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TargetDir = Join-Path $env:USERPROFILE '.gemini\config\plugins\agy-context-panel'

if (Test-Path $TargetDir) {
  $item = Get-Item $TargetDir
  if ($item.LinkType) {
    [System.IO.Directory]::Delete($TargetDir)
  }
}

New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
Copy-Item (Join-Path $RepoRoot 'plugin.json') $TargetDir -Force
Copy-Item (Join-Path $RepoRoot 'README.md') $TargetDir -Force
Copy-Item (Join-Path $RepoRoot 'assets') $TargetDir -Recurse -Force
Copy-Item (Join-Path $RepoRoot 'src\shared') $TargetDir -Recurse -Force
Copy-Item (Join-Path $RepoRoot 'src\statusline') $TargetDir -Recurse -Force
Copy-Item (Join-Path $RepoRoot 'src\sidecars') $TargetDir -Recurse -Force

# Clean up legacy layout files inside sidecars/token-monitor if present
$legacyFiles = @(
  'sidecars\token-monitor\cdp-injector.mjs',
  'sidecars\token-monitor\ls-client.mjs',
  'sidecars\token-monitor\metrics.mjs',
  'sidecars\token-monitor\cdp'
)
foreach ($rel in $legacyFiles) {
  $p = Join-Path $TargetDir $rel
  if (Test-Path $p) {
    Remove-Item $p -Recurse -Force
  }
}

Write-Host "Installed agy-context-panel to $TargetDir"
