# Icon Generation

The extension requires PNG icons in these sizes: 16x16, 32x32, 48x48, 128x128

## Quick Generation (using ImageMagick)

If you have ImageMagick installed:

```bash
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 32x32 icon32.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```

## Online Conversion

1. Go to https://svgtopng.com/
2. Upload `icon.svg`
3. Download PNGs at required sizes

## Temporary Placeholder

For testing, you can use any 128x128 PNG. The extension will work without proper icons, just with a default placeholder.

## Icon Design

The current icon is a target/crosshair design representing:
- 🎯 Precision guidance
- The "aim" to help users find what they need
- Purple gradient matching the extension's color scheme
