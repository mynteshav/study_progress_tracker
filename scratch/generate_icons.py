import os
from PIL import Image

os.makedirs('public/icons', exist_ok=True)

# Load existing base icon
base_img = Image.open('public/icon.png').convert('RGBA')

# 1. Standard 512x512 icon
icon_512 = base_img.resize((512, 512), Image.Resampling.LANCZOS)
icon_512.save('public/icons/icon-512.png', 'PNG')

# 2. Standard 192x192 icon
icon_192 = base_img.resize((192, 192), Image.Resampling.LANCZOS)
icon_192.save('public/icons/icon-192.png', 'PNG')

# 3. Maskable 512x512 icon (with safe zone padding inside #111827 background)
maskable_512 = Image.new('RGBA', (512, 512), (17, 24, 39, 255)) # #111827
# Scale base image down to 80% (safe inner circle of maskable icon is 80% diameter)
inner_size_512 = int(512 * 0.8)
scaled_512 = base_img.resize((inner_size_512, inner_size_512), Image.Resampling.LANCZOS)
offset_512 = (512 - inner_size_512) // 2
maskable_512.paste(scaled_512, (offset_512, offset_512), scaled_512)
maskable_512.save('public/icons/icon-512-maskable.png', 'PNG')

# 4. Maskable 192x192 icon
maskable_192 = Image.new('RGBA', (192, 192), (17, 24, 39, 255))
inner_size_192 = int(192 * 0.8)
scaled_192 = base_img.resize((inner_size_192, inner_size_192), Image.Resampling.LANCZOS)
offset_192 = (192 - inner_size_192) // 2
maskable_192.paste(scaled_192, (offset_192, offset_192), scaled_192)
maskable_192.save('public/icons/icon-192-maskable.png', 'PNG')

print("PWA icons generated successfully in public/icons/")
