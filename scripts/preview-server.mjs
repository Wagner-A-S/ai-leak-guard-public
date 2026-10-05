import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
http
  .createServer(async (req, res) => {
    try {
      const rawPath = new URL(req.url, 'http://127.0.0.1').pathname;
      if (['/', '/admin.html', '/workspace.html'].includes(rawPath)) {
        res.writeHead(302, {
          location: '/src/ui/' + (rawPath === '/workspace.html' ? 'workspace.html' : 'admin.html'),
        });
        return res.end();
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname),
        target = path.resolve(root, '.' + (pathname === '/' ? '/admin.html' : pathname));
      if (!target.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      if (!(await stat(target)).isFile()) {
        res.writeHead(404);
        return res.end();
      }
      const data = await readFile(target);
      res.writeHead(200, {
        'content-type': types[path.extname(target)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  })
  .listen(8767, '127.0.0.1', () =>
    console.log('Private local preview: http://127.0.0.1:8767/admin.html'),
  );
