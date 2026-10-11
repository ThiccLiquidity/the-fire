# Launch a Series (docs/deploy.md, "Launch a Series"): runs ops\series\launch.mjs, first asking for the RPC URL
# (typed hidden, it can hold an API key) if $env:RPC isn't set in this window.
#   .\ops\series\launch.ps1 --recipe contracts\series\recipe-fire-7.json --start "2026-11-01 18:00"
if (-not $env:RPC) {
  $secure = Read-Host "RPC URL" -AsSecureString
  $env:RPC = [System.Net.NetworkCredential]::new("", $secure).Password
}
& node (Join-Path $PSScriptRoot "launch.mjs") @args
exit $LASTEXITCODE
