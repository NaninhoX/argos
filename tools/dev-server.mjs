// Servidor local de desenvolvimento: serve web/ e executa as funções de api/ com a mesma interface
// (req.query, req.body, res.status().json()) que a Vercel oferece. Não é usado em produção.
// Uso: npm run dev  [PORT=3000]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildWeb } from './build-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
buildWeb(); // motor e dados do navegador sempre em dia com engine/ e data/
const webDir = path.join(root, 'web');
const apiDir = path.join(root, 'api');
const port = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

// .env local (fora do Git): CHAVE=valor por linha
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 2e6) { reject(new Error('corpo grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function runApi(req, res, url) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const file = path.join(apiDir, name + '.js');
  if (!/^[a-z0-9\-/]+$/i.test(name) || !file.startsWith(apiDir) || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': TYPES['.json'] }); return res.end('{"error":{"code":"nao_encontrado"}}'); }
  req.query = Object.fromEntries(url.searchParams);
  const raw = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
  try { req.body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : raw || undefined; } catch { req.body = undefined; }
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { if (!res.getHeader('content-type')) res.setHeader('content-type', TYPES['.json']); res.end(JSON.stringify(obj)); return res; };
  res.send = (x) => { if (typeof x === 'object' && x !== null && !Buffer.isBuffer(x)) return res.json(x); res.end(x); return res; };
  const mod = await import(pathToFileURL(file).href);
  await mod.default(req, res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await runApi(req, res, url);
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.join(webDir, rel);
    if (!file.startsWith(webDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': TYPES['.json'] });
    res.end('{"error":{"code":"erro_interno"}}');
  }
});

server.listen(port, () => console.log(`Argos local em http://localhost:${port}  (web/ + api/)`));
