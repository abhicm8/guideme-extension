// Simple PNG generator for extension icons from the GuideMe logo
// Run with: node generate-icons.js

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sizes = [16, 32, 48, 128];
const sourceLogo = path.join(__dirname, 'logo-icon.webp');
const fallbackLogo = path.join(__dirname, 'GuideMe Cursor Logo 1.webp');
const logoFile = fs.existsSync(sourceLogo) ? sourceLogo : fallbackLogo;

console.log('Generating extension PNG icons from:', path.basename(logoFile));

try {
  const pyCode = `
import sys
from PIL import Image

src = Image.open(sys.argv[1]).convert('RGBA')
bbox = src.getbbox()
cropped = src.crop(bbox)
w, h = cropped.size
max_dim = max(w, h)
pad = int(max_dim * 0.08)
canvas_size = max_dim + 2 * pad
sq = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
sq.paste(cropped, ((canvas_size - w) // 2, (canvas_size - h) // 2))

out_dir = sys.argv[2]
for size in [16, 32, 48, 128]:
    resized = sq.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(f'{out_dir}/icon{size}.png')
    print(f'[OK] Generated icon{size}.png ({size}x{size})')
`;
  execFileSync('python', ['-c', pyCode, logoFile, __dirname], { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  console.log('All icons generated successfully!');
} catch (error) {
  console.error('Python/PIL generator failed:', error.message);
}
