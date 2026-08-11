const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const sourcePng = path.join(__dirname, '..', 'build', 'Gemini_Generated_Image_avw5moavw5moavw5.png');
const destPng = path.join(__dirname, '..', 'build', 'icon.png');
const publicPng = path.join(__dirname, '..', 'public', 'icon.png');
const tempDir = path.join(__dirname, 'ico_frames');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// 1. Generate resized PNG frames for each resolution using PowerShell System.Drawing
const psScript = `
Add-Type -AssemblyName System.Drawing
$srcPath = "${sourcePng.replace(/\\/g, '\\\\')}"
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
$mainBmp.Save("${destPng.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
$mainBmp.Save("${publicPng.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
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
    
    $outPath = Join-Path "${tempDir.replace(/\\/g, '\\\\')}" "icon_$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated frame $s x $s"
}
$srcImg.Dispose()
`;

const psPath = path.join(__dirname, 'gen_frames.ps1');
fs.writeFileSync(psPath, psScript, 'utf8');

execSync(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { stdio: 'inherit' });

// 2. Combine PNG frames into a single multi-resolution ICO file
function createIcoFromPngs(pngPaths, outputPath) {
  const pngBuffers = pngPaths.map(p => fs.readFileSync(p));
  const count = pngBuffers.length;
  
  // Header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type (1 = ICO)
  header.writeUInt16LE(count, 4); // Number of images

  let currentOffset = 6 + (count * 16);
  const dirEntries = [];

  for (let i = 0; i < count; i++) {
    const buf = pngBuffers[i];
    const entry = Buffer.alloc(16);
    const size = sizes[i];

    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height
    entry.writeUInt8(0, 2); // Color palette count
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buf.length, 8); // Size of PNG data
    entry.writeUInt32LE(currentOffset, 12); // Offset in file

    dirEntries.push(entry);
    currentOffset += buf.length;
  }

  const finalBuffer = Buffer.concat([header, ...dirEntries, ...pngBuffers]);
  fs.writeFileSync(outputPath, finalBuffer);
  console.log(`Successfully created multi-resolution ICO file: ${outputPath} (${finalBuffer.length} bytes)`);
}

const pngFiles = sizes.map(s => path.join(tempDir, `icon_${s}.png`));
const outputIco = path.join(__dirname, '..', 'build', 'icon.ico');
createIcoFromPngs(pngFiles, outputIco);
