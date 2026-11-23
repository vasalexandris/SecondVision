// Μικρός στατικός server για δοκιμές (σωστά MIME για .wasm/.mjs). Χρήση: node tools/serve.mjs [port]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
  '.bin': 'application/octet-stream', '.gz': 'application/gzip' };
const port = Number(process.argv[2] || 8080);

http.createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(file); if (s.isDirectory()) throw new Error('dir');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': s.size, 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, () => console.log(`http://localhost:${port}`));
