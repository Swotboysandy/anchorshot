$ErrorActionPreference = 'Stop'
# A small CPU vision environment on the system drive; no neural weights or paid APIs.
$visionRoot = Join-Path $env:LOCALAPPDATA 'AnchorShot/vision'
$visionPython = Join-Path $visionRoot 'Scripts/python.exe'
if (!(Test-Path -LiteralPath $visionPython)) {
    python -m venv $visionRoot
    if ($LASTEXITCODE -ne 0) { throw 'Vision environment creation failed.' }
}
& $visionPython -m pip install --no-cache-dir --disable-pip-version-check 'numpy==1.26.4' 'Pillow==11.3.0' 'opencv-python-headless==4.11.0.86'
if ($LASTEXITCODE -ne 0) { throw 'Vision dependency installation failed.' }
& $visionPython -c "import cv2; print('OpenCV', cv2.__version__)"
if ($LASTEXITCODE -ne 0) { throw 'OpenCV could not load.' }
Write-Output "Tracking Python: $visionPython"
