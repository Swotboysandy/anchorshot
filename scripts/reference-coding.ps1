[CmdletBinding()]
param(
 [Parameter(Position=0)][ValidateSet('start','status','index','search')][string]$Action='status',
 [ValidateSet('anchorshot','ref-prompt-kit','ref-shadcn-ui','ref-opencut','ref-sam2','ref-motion','ref-beui','all')][string]$Corpus='anchorshot',
 [string]$Query,[switch]$DryRun,
 [string]$Endpoint='http://127.0.0.1:9237'
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$cacheRoot=Join-Path (Split-Path $projectRoot -Parent) 'AnchorShot-reference-coding'
$xerj=Join-Path $env:LOCALAPPDATA 'Programs/xerj/xerj.exe'
$endpoint=$Endpoint
$env:XERJ_DISABLE_FEEDBACK='true'
if (!(Test-Path -LiteralPath $xerj)) { throw 'Install XERJ first; see docs/REFERENCE_CODING.md' }
if ($Action -eq 'start') {
 $listener=Get-NetTCPConnection -State Listen -LocalPort 9237 -ErrorAction SilentlyContinue
 if ($listener) {
  $pidFile=Join-Path $cacheRoot 'node.pid'
  if (!(Test-Path -LiteralPath $pidFile) -or [int](Get-Content $pidFile) -ne $listener[0].OwningProcess) { throw 'Port 9237 belongs to another process; leaving it untouched.' }
  Invoke-RestMethod "$endpoint/_cluster/health" | Select-Object status
  return
 }
 New-Item -ItemType Directory -Force -Path (Join-Path $cacheRoot 'logs') | Out-Null
 $config=Join-Path $cacheRoot 'xerj.toml'
 if (!(Test-Path -LiteralPath $config)) { "[limits]`ndisk_flood_stage_percent = 99`nmax_process_memory_mb = 2048`nmax_query_memory_mb = 128" | Set-Content -LiteralPath $config }
 $node=Start-Process -FilePath $xerj -ArgumentList @('--insecure','--bind','127.0.0.1','--port','9237','--embed-mode','lexical','--disable-feedback','--config',('"'+$config+'"'),'--data-dir',('"'+(Join-Path $cacheRoot 'data')+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cacheRoot 'logs/node.stdout.log') -RedirectStandardError (Join-Path $cacheRoot 'logs/node.stderr.log')
 $node.Id | Set-Content (Join-Path $cacheRoot 'node.pid')
 for ($attempt=0;$attempt -lt 30;$attempt++) {
  try { Invoke-RestMethod "$endpoint/_cluster/health" -TimeoutSec 2 | Select-Object status; return } catch { Start-Sleep -Milliseconds 300 }
 }
 throw 'XERJ did not become healthy; inspect its local logs.'
}
if ($Action -eq 'status') { $indexStatus=Invoke-RestMethod "$endpoint/_cat/indices?format=json"; $indexStatus | Select-Object index,'docs.count','store.size';return }
if ($Action -eq 'search') {
 if (!$Query -or $Corpus -eq 'all') { throw 'Supply a query and one corpus.' }
 & $xerj search --url $endpoint --prefix $Corpus -k 5 --full 1200 $Query
 if ($LASTEXITCODE -ne 0) { throw "Search failed (exit $LASTEXITCODE)" };return
}
$refs=Get-Content (Join-Path $projectRoot 'docs/reference-repositories.json') -Raw | ConvertFrom-Json
$items=@(@{prefix='anchorshot';path=$projectRoot})
foreach($reference in $refs){$items+=@{prefix=('ref-'+$reference.name);path=(Join-Path $cacheRoot ('repos/'+$reference.name))}}
foreach($item in $items){
 if($Corpus -ne 'all' -and $Corpus -ne $item.prefix){continue}
 if(!(Test-Path -LiteralPath $item.path)){throw "Missing checkout $($item.path); see docs/REFERENCE_CODING.md"}
 $indexArgs=@('autoindex',$item.path,'--prefix',$item.prefix,'--url',$endpoint,'--state-dir',(Join-Path $cacheRoot ('state/'+$item.prefix)),'--workers','2','--no-semantic','--no-graph','--code-analyzer','code','--disable-feedback')
 if($DryRun){$indexArgs+='--dry-run'}
 $logPath=Join-Path $cacheRoot ('logs/'+$item.prefix+'-latest.log')
 & $xerj @indexArgs 2>&1 | Tee-Object -FilePath $logPath | ForEach-Object {if("$_" -match 'xerj-bar|xerj-done|error:|estimated index|^ok:'){Write-Output $_}}
 $code=$LASTEXITCODE
 if($code -notin @(0,3)){throw "Index failed ($code). See $logPath"}
 $log=Get-Content $logPath -Raw
 if($log -match 'ok=false|reason=stale-resume-plan|datasets_refused=[1-9]'){throw "Incomplete index. See $logPath"}
}
