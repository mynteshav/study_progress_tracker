
Add-Type -AssemblyName System.Drawing
$srcPath = "D:\\study tracker app\\build\\Gemini_Generated_Image_avw5moavw5moavw5.png"
$srcImg = [System.Drawing.Image]::FromFile($srcPath)

# Save 512x512 main PNG to build/icon.png and public/icon.png
$mainBmp = New-Object System.Drawing.Bitmap(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mainG = [System.Drawing.Graphics]::FromImage($mainBmp)
$mainG.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$mainG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$mainG.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$mainG.Clear([System.Drawing.Color]::Transparent)
$mainG.DrawImage($srcImg, 0, 0, 512, 512)
$mainG.Dispose()
$mainBmp.Save("D:\\study tracker app\\build\\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$mainBmp.Save("D:\\study tracker app\\public\\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$mainBmp.Dispose()

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    
    # Draw image with 5% padding so it never touches icon borders
    $pad = [Math]::Max(1, [Math]::Floor($s * 0.05))
    $drawSize = $s - ($pad * 2)
    $g.DrawImage($srcImg, $pad, $pad, $drawSize, $drawSize)
    
    $outPath = Join-Path "D:\\study tracker app\\scratch\\ico_frames" "icon_$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated frame $s x $s"
}
$srcImg.Dispose()
