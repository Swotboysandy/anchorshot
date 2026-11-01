param([switch]$SkipModels)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $projectRoot '.artifacts/local-ai'
New-Item -ItemType Directory -Force (Join-Path $runtimeRoot 'temp'),(Join-Path $runtimeRoot 'cache') | Out-Null
$env:TEMP = Join-Path $runtimeRoot 'temp'
$env:TMP = $env:TEMP
$pythonPath = if (Test-Path -LiteralPath (Join-Path $runtimeRoot 'venv/python.exe')) { Join-Path $runtimeRoot 'venv/python.exe' } else { Join-Path $runtimeRoot 'venv/Scripts/python.exe' }
if (!(Test-Path -LiteralPath $pythonPath)) {
    python -m venv (Join-Path $runtimeRoot 'venv')
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed' }
}
$wheelPath = Join-Path $runtimeRoot 'torch-2.5.1+cu124-cp310-cp310-win_amd64.whl'
$expectedHash = '6f99d8459369cfd6661c2aee14787592fe50156a33faf9ef643ba04e42d6543f'
if (!(Test-Path -LiteralPath $wheelPath) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $wheelPath).Hash.ToLower() -ne $expectedHash) {
    curl.exe --location --fail --retry 8 --retry-all-errors --connect-timeout 30 --speed-limit 1024 --speed-time 60 --continue-at - --output $wheelPath 'https://download-r2.pytorch.org/whl/cu124/torch-2.5.1%2Bcu124-cp310-cp310-win_amd64.whl'
    if ($LASTEXITCODE -ne 0) { throw 'PyTorch download failed; rerun to resume' }
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $wheelPath).Hash.ToLower() -ne $expectedHash) { throw 'PyTorch checksum mismatch' }
& $pythonPath -m pip install --no-cache-dir --timeout 120 $wheelPath
if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed' }
& $pythonPath -m pip install --no-cache-dir --timeout 120 -r (Join-Path $PSScriptRoot 'requirements-local-ai.txt')
if ($LASTEXITCODE -ne 0) { throw 'Inference dependency installation failed' }
& $pythonPath -c "import torch; print(torch.__version__, torch.cuda.is_available()); assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw 'CUDA check failed' }
if (!$SkipModels) {
    & $pythonPath (Join-Path $PSScriptRoot 'download_local_ai.py')
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed; rerun to resume' }
}
