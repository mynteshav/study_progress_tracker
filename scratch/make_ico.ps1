Add-Type -AssemblyName System.Drawing

$pngPath = "d:\study tracker app\build\icon_fixed.png"
$destPng = "d:\study tracker app\build\icon.png"
$destIco = "d:\study tracker app\build\icon.ico"
$publicPng = "d:\study tracker app\public\icon.png"

# Overwrite build/icon.png with genuine PNG
Copy-Item -Path $pngPath -Destination $destPng -Force

if (-not (Test-Path "d:\study tracker app\public")) {
    New-Item -ItemType Directory -Path "d:\study tracker app\public" -Force
}
Copy-Item -Path $pngPath -Destination $publicPng -Force

# Create icon.ico from Bitmap
$img = [System.Drawing.Bitmap]::FromFile($destPng)
$hIcon = $img.GetHicon()
$ico = [System.Drawing.Icon]::FromHandle($hIcon)

$fs = [System.IO.File]::OpenWrite($destIco)
$ico.Save($fs)
$fs.Close()

$img.Dispose()

Write-Host "Created valid PNG and ICO files at $destPng and $destIco"
