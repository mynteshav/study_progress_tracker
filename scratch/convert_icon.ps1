Add-Type -AssemblyName System.Drawing

$inputPath = "d:\study tracker app\build\icon.png"
$outputPathPng = "d:\study tracker app\build\icon_fixed.png"
$outputIcoPath = "d:\study tracker app\build\icon.ico"

$img = [System.Drawing.Image]::FromFile($inputPath)

# Check pixels at top, center, bottom
$bmpInput = New-Object System.Drawing.Bitmap($img)
$topPixel = $bmpInput.GetPixel(512, 200)
$midPixel = $bmpInput.GetPixel(512, 512)
$botPixel = $bmpInput.GetPixel(512, 850)

Write-Host "Top pixel: R=$($topPixel.R), G=$($topPixel.G), B=$($topPixel.B)"
Write-Host "Mid pixel: R=$($midPixel.R), G=$($midPixel.G), B=$($midPixel.B)"
Write-Host "Bot pixel: R=$($botPixel.R), G=$($botPixel.G), B=$($botPixel.B)"

# Create a clean 512x512 PNG with proper alpha & antialiasing
$targetSize = 512
$bmpTarget = New-Object System.Drawing.Bitmap($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmpTarget)

$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$g.Clear([System.Drawing.Color]::Transparent)

# Draw image
$g.DrawImage($img, 0, 0, $targetSize, $targetSize)

$g.Dispose()
$img.Dispose()
$bmpInput.Dispose()

# Save as PNG
$bmpTarget.Save($outputPathPng, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Saved real PNG to $outputPathPng"

$bmpTarget.Dispose()
