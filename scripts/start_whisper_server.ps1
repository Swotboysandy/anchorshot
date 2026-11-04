$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$python = Join-Path $projectRoot '.artifacts/local-ai/venv/python.exe'

if (!(Test-Path -LiteralPath $python)) {
    throw "Local AI virtual environment not found at $python"
}

$model = if ($args[0]) { $args[0] } else { "Systran/faster-whisper-tiny.en" }
$port = if ($args[1]) { $args[1] } else { "8000" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Starting Faster Whisper OpenAI-Compatible Server" -ForegroundColor Green
Write-Host "Model: $model" -ForegroundColor Yellow
Write-Host "Port:  $port" -ForegroundColor Yellow
Write-Host "Endpoint: http://127.0.0.1:$port/v1" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan

& $python -m faster_whisper_server --host 127.0.0.1 --port $port $model
