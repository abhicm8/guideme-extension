import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

for (const directory of ['background', 'content', 'lib', 'popup', 'scripts']) {
  for (const file of readdirSync(directory).filter(file => file.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', join(directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
for (const entry of manifest.content_scripts) {
  for (const file of [...entry.js, ...entry.css]) readFileSync(file);
}
console.log('JavaScript syntax and content script paths are valid.');
