import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.dirname(fileURLToPath(import.meta.url));
const pagesPreview = process.argv.includes('--pages');
const base = pagesPreview ? path.join(project, 'dist') : project;
const mount = pagesPreview ? '/blue-harbour' : '';
const port = Number(process.env.HARBOUR_PORT || (pagesPreview ? 4174 : 4173));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.webm': 'video/webm', '.svg': 'image/svg+xml',
};
const entries = new Set(['/index.html','/walk.js','/style.css']);

const server = http.createServer(async (req, res) => {
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (mount && url.pathname === mount) {
      res.writeHead(308, { Location: `${mount}/${url.search}` }).end();
      return;
    }
    if (!url.pathname.startsWith(`${mount}/`)) {
      res.writeHead(404).end();
      return;
    }
    const pathname = url.pathname.slice(mount.length);
    const target = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    if (!entries.has(target) && !target.startsWith('/assets/') && !target.startsWith('/node_modules/three/')) {
      res.writeHead(404).end();
      return;
    }
    const relative = target.slice(1);
    if (relative.includes('\\') || relative.split('/').some(segment => segment === '..' || segment.startsWith('.'))) {
      res.writeHead(400).end();
      return;
    }
    const file = path.resolve(base, relative);
    const ext = path.extname(file);
    const info = await stat(file);
    if (!info.isFile() || !types[ext]) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[ext], 'Content-Length': info.size,
      'Cache-Control': relative.startsWith('node_modules/') ? 'max-age=3600' : 'no-cache',
      ...(!pagesPreview && {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      }),
      'X-Content-Type-Options': 'nosniff',
    });
    if (method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 400).end();
    else res.destroy();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Harbour walk available at http://127.0.0.1:${port}${mount}/`));
