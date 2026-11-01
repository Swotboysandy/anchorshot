<#
.SYNOPSIS
  Orca Browser Tracking & Diagnostics Harness
.DESCRIPTION
  Interacts with the running Orca Browser runtime to inspect DOM, query in-browser
  telemetry (window.__ORCA_TRACKER__), report console/network errors, and capture screenshots.
.EXAMPLE
  pwsh -File scripts/orca_track.ps1
  pwsh -File scripts/orca_track.ps1 -DumpErrors
  pwsh -File scripts/orca_track.ps1 -Screenshot
#>
param(
  [switch]$DumpErrors,
  [switch]$Screenshot,
  [switch]$TestVoice,
  [string]$Action
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$nodeArgs = @()
if ($TestVoice) { $nodeArgs += "--test-voice" }

node "$scriptDir/orca_audit.mjs" @nodeArgs
exit $LASTEXITCODE
