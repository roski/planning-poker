// Development preview only. The deployed application has no server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.env.PORT || 4173);
http.createServer(async (req, res) => {
  if (req.url?.split('?')[0] !== '/' && req.url?.split('?')[0] !== '/index.html') { res.writeHead(404); return res.end(); }
  try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(await readFile('index.html')); }
  catch { res.writeHead(500); res.end('Run npm run build first.'); }
}).listen(port, '127.0.0.1', () => console.log(`Open Poker: http://localhost:${port}`));
