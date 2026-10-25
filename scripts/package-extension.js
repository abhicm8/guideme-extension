// scripts/package-extension.js
// Automated, zero-dependency packaging script for Chrome Web Store distribution.
// Creates a clean, verified zip file ready for Chrome Web Store upload.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

// Calculate CRC32 checksum for zip specification
function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ (-1)) >>> 0;
}

// Convert Date to DOS date/time format for zip header
function getDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate, dosTime };
}

// Build a spec-compliant zip buffer from entries
function buildZip(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let offset = 0;
  const { dosDate, dosTime } = getDosDateTime();

  for (const entry of entries) {
    const normalizedName = entry.zipPath.replace(/\\/g, '/');
    const nameBuffer = Buffer.from(normalizedName, 'utf8');
    const content = fs.readFileSync(entry.absPath);
    const compressed = zlib.deflateRawSync(content);
    const checksum = crc32(content);

    // Local file header (30 bytes + name + compressed)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed (2.0)
    localHeader.writeUInt16LE(0, 6);          // general purpose bit flag
    localHeader.writeUInt16LE(8, 8);          // compression: 8 = DEFLATE
    localHeader.writeUInt16LE(dosTime, 10);    // last mod time
    localHeader.writeUInt16LE(dosDate, 12);    // last mod date
    localHeader.writeUInt32LE(checksum, 14);   // crc-32
    localHeader.writeUInt32LE(compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(content.length, 22);    // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28);                 // extra field length

    const localRecord = Buffer.concat([localHeader, nameBuffer, compressed]);
    fileRecords.push(localRecord);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4);         // version made by
    centralHeader.writeUInt16LE(20, 6);         // version needed
    centralHeader.writeUInt16LE(0, 8);          // bit flag
    centralHeader.writeUInt16LE(8, 10);         // compression: DEFLATE
    centralHeader.writeUInt16LE(dosTime, 12);   // last mod time
    centralHeader.writeUInt16LE(dosDate, 14);   // last mod date
    centralHeader.writeUInt32LE(checksum, 16);  // crc-32
    centralHeader.writeUInt32LE(compressed.length, 20); // compressed size
    centralHeader.writeUInt32LE(content.length, 24);    // uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28); // file name length
    centralHeader.writeUInt16LE(0, 30);                 // extra field length
    centralHeader.writeUInt16LE(0, 32);                 // file comment length
    centralHeader.writeUInt16LE(0, 34);                 // disk number start
    centralHeader.writeUInt16LE(0, 36);                 // internal file attributes
    centralHeader.writeUInt32LE(0, 38);                 // external file attributes
    centralHeader.writeUInt32LE(offset, 42);            // relative offset of local header

    const centralRecord = Buffer.concat([centralHeader, nameBuffer]);
    centralRecords.push(centralRecord);

    offset += localRecord.length;
  }

  const centralDir = Buffer.concat(centralRecords);

  // End of central directory record (22 bytes)
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);     // signature
  endRecord.writeUInt16LE(0, 4);              // number of this disk
  endRecord.writeUInt16LE(0, 6);              // disk where central directory starts
  endRecord.writeUInt16LE(entries.length, 8); // number of central directory records on this disk
  endRecord.writeUInt16LE(entries.length, 10);// total number of central directory records
  endRecord.writeUInt32LE(centralDir.length, 12); // size of central directory
  endRecord.writeUInt32LE(offset, 16);        // offset of start of central directory
  endRecord.writeUInt16LE(0, 20);             // comment length

  return Buffer.concat([...fileRecords, centralDir, endRecord]);
}

function collectDirectoryFiles(dirRelPath, filterFn = () => true) {
  const dirAbsPath = path.join(ROOT_DIR, dirRelPath);
  if (!fs.existsSync(dirAbsPath)) return [];

  const results = [];
  function walk(currentAbs, currentRel) {
    const items = fs.readdirSync(currentAbs);
    for (const item of items) {
      const itemAbs = path.join(currentAbs, item);
      const itemRel = path.join(currentRel, item).replace(/\\/g, '/');
      const stat = fs.statSync(itemAbs);
      if (stat.isDirectory()) {
        walk(itemAbs, itemRel);
      } else if (stat.isFile() && filterFn(itemRel, item)) {
        results.push({ zipPath: itemRel, absPath: itemAbs, size: stat.size });
      }
    }
  }
  walk(dirAbsPath, dirRelPath);
  return results;
}

function packageExtension() {
  console.log('🚀 Packaging GuideMe Extension for Chrome Web Store...\n');

  // 1. Verify manifest.json
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ manifest.json not found at workspace root!');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`📦 Extension: ${manifest.name}`);
  console.log(`🏷️  Version:   ${manifest.version}`);
  console.log(`📑 Manifest:  v${manifest.manifest_version}\n`);

  // 2. Validate essential files referenced by manifest
  const referencedFiles = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...(manifest.icons ? Object.values(manifest.icons) : []),
    ...(manifest.action?.default_icon ? Object.values(manifest.action.default_icon) : []),
    ...(manifest.content_scripts || []).flatMap(cs => [...(cs.js || []), ...(cs.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(war => war.resources || [])
  ].filter(Boolean);

  let missingFiles = 0;
  for (const ref of referencedFiles) {
    const full = path.join(ROOT_DIR, ref);
    if (!fs.existsSync(full)) {
      console.error(`❌ Missing manifest referenced file: ${ref}`);
      missingFiles++;
    }
  }
  if (missingFiles > 0) {
    console.error(`\n❌ Packaging aborted: ${missingFiles} referenced file(s) missing.`);
    process.exit(1);
  }

  // 3. Assemble package entries (runtime only, no test/git/markdown clutter)
  const entries = [];

  // Root files
  entries.push({ zipPath: 'manifest.json', absPath: manifestPath, size: fs.statSync(manifestPath).size });
  const licensePath = path.join(ROOT_DIR, 'LICENSE');
  if (fs.existsSync(licensePath)) {
    entries.push({ zipPath: 'LICENSE', absPath: licensePath, size: fs.statSync(licensePath).size });
  }

  // Runtime directories
  entries.push(...collectDirectoryFiles('background', (rel, name) => !name.endsWith('.test.js')));
  entries.push(...collectDirectoryFiles('content', (rel, name) => !name.endsWith('.test.js')));
  entries.push(...collectDirectoryFiles('lib', (rel, name) => !name.endsWith('.test.js')));
  entries.push(...collectDirectoryFiles('popup', (rel, name) => !name.endsWith('.test.js')));
  entries.push(...collectDirectoryFiles('icons', (rel, name) => {
    // Only bundle icons used by extension / web store
    return name.endsWith('.png') || name.endsWith('.webp');
  }));

  // Sort entries for reproducible zip builds
  entries.sort((a, b) => a.zipPath.localeCompare(b.zipPath));

  // Print manifest files
  console.log('Included files:');
  let totalRawBytes = 0;
  for (const e of entries) {
    totalRawBytes += e.size;
    const kb = (e.size / 1024).toFixed(1);
    console.log(`  ✓ ${e.zipPath.padEnd(38)} (${kb.padStart(6)} KB)`);
  }

  // 4. Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // 5. Generate zip
  const zipBuffer = buildZip(entries);
  const versionedZipName = `guideme-extension-v${manifest.version}.zip`;
  const latestZipName = 'guideme-extension.zip';

  const versionedPath = path.join(DIST_DIR, versionedZipName);
  const latestPath = path.join(DIST_DIR, latestZipName);

  fs.writeFileSync(versionedPath, zipBuffer);
  fs.writeFileSync(latestPath, zipBuffer);

  const zipKb = (zipBuffer.length / 1024).toFixed(1);
  const rawKb = (totalRawBytes / 1024).toFixed(1);

  console.log('\n========================================');
  console.log(`🎉 Build complete! Package ready for Chrome Web Store.`);
  console.log(`📁 Files:       ${entries.length}`);
  console.log(`📊 Raw size:    ${rawKb} KB`);
  console.log(`🗜️  Zip size:    ${zipKb} KB`);
  console.log(`📦 Output:      dist/${versionedZipName}`);
  console.log(`📦 Output:      dist/${latestZipName}`);
  console.log('========================================\n');
  console.log('Next Steps for Chrome Web Store:');
  console.log('1. Go to https://chrome.google.com/webstore/devconsole');
  console.log(`2. Click "New Item" and upload dist/${versionedZipName}`);
  console.log('3. Fill in description, category, and screenshots');
  console.log('4. Submit for review!\n');
}

packageExtension();
