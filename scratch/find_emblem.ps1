Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile("d:\study tracker app\build\icon.png")

$minX = $bmp.Width
$maxX = 0
$minY = $bmp.Height
$maxY = 0

for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
        $p = $bmp.GetPixel($x, $y)
        # Check if pixel is part of the blue emblem (blue channel > 80 and noticeably brighter than background)
        if ($p.B -gt 80 -and ($p.B - $p.R) -gt 20) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}

Write-Host "Emblem bounding box:"
Write-Host "X: $minX to $maxX (width = $($maxX - $minX))"
Write-Host "Y: $minY to $maxY (height = $($maxY - $minY))"
Write-Host "Total Image Height: $($bmp.Height)"

$bmp.Dispose()
