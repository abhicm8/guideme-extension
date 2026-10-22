import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const fixture = readFileSync(new URL('./dynamic-page.html', import.meta.url));
const assets = new Map(['popup.html', 'popup.css', 'theme.js', 'panel-ui.js', 'provider-settings.js', 'popup.js'].map(file => [
  `/extension/popup/${file}`, readFileSync(new URL(`../../popup/${file}`, import.meta.url))
]));
assets.set('/extension/lib/ai-config.js', readFileSync(new URL('../../lib/ai-config.js', import.meta.url)));
createServer((request, response) => {
  const asset = assets.get(request.url);
  const type = request.url.endsWith('.css') ? 'text/css' : request.url.endsWith('.js') ? 'text/javascript' : 'text/html';
  response.writeHead(200, { 'Content-Type': asset ? type : 'text/html' });
  response.end(asset || fixture);
}).listen(4317, '127.0.0.1');
