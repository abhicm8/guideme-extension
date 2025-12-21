// Simple PNG generator for extension icons
// Run with: node generate-icons.js

const fs = require('fs');
const { createCanvas } = require('canvas');

const sizes = [16, 32, 48, 128];

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Gradient background
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#4F46E5');
  gradient.addColorStop(1, '#7C3AED');

  // Rounded rectangle
  const radius = size * 0.1875;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, radius);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Target circle
  ctx.strokeStyle = 'white';
  ctx.lineWidth = size * 0.047;
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.41, size * 0.22, 0, Math.PI * 2);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.41, size * 0.0625, 0, Math.PI * 2);
  ctx.fill();

  // Bottom line
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.625);
  ctx.lineTo(size * 0.5, size * 0.82);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// Check if canvas module is available
try {
  sizes.forEach(size => {
    const buffer = generateIcon(size);
    fs.writeFileSync(`icon${size}.png`, buffer);
    console.log(`Generated icon${size}.png`);
  });
  console.log('All icons generated successfully!');
} catch (error) {
  console.log('Canvas module not available. Using fallback method.');
  console.log('Please install: npm install canvas');
  console.log('Or use an online SVG to PNG converter with icon.svg');
}
