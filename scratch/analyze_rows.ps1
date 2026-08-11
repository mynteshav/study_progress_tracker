Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile("d:\study tracker app\build\icon.png")

Write-Host "Bitmap dimensions: $($bmp.Width) x $($bmp.Height)"

$step = [Math]::Max(1, [Math]::Floor($bmp.Height / 20))

for ($y = 0; $y -lt $bmp.Height; $y += $step) {
    $rowBrightness = 0
    $nonDarkPixels = 0
    for ($x = 0; $x -lt $bmp.Width; $x += 10) {
        $pixel = $bmp.GetPixel($x, $y)
        if ($pixel.R -gt 20 -or $pixel.G -gt 20 -or $pixel.B -gt 20) {
            $nonDarkPixels++
        }
    }
    Write-Host "Row y=$y : $nonDarkPixels non-dark pixels (out of $($bmp.Width / 10))"
}

$bmp.Dispose()
