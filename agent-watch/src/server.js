import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { Monitor } from './monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = Number(portArg?.split('=')[1] ?? process.env.PORT ?? 4317);
const monitor = new Monitor();
const clients = new Set();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function serveStatic(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.resolve(publicDir, `.${decodeURIComponent(requested)}`);
  if (target !== publicDir && !target.startsWith(`${publicDir}${path.sep}`)) return sendJson(response, 403, { error: 'Forbidden' });
  try {
    const data = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(data);
  } catch {
    sendJson(response, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/api/snapshot') return sendJson(response, 200, monitor.getSnapshot());
  if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true, updatedAt: monitor.getSnapshot().updatedAt });
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    response.write(`data: ${JSON.stringify(monitor.getSnapshot())}\n\n`);
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings') {
    try {
      const settings = monitor.updateSettings(await readBody(request));
      return sendJson(response, 200, { ok: true, settings });
    } catch (error) {
      return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/clear') {
    monitor.clearEvents();
    return sendJson(response, 200, { ok: true, message: 'In-memory display records cleared; source session files were not changed.' });
  }
  if (request.method === 'GET') return serveStatic(request, response);
  return sendJson(response, 405, { error: 'Method not allowed' });
});

monitor.on('snapshot', (snapshot) => {
  const message = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of clients) client.write(message);
});

server.listen(port, '127.0.0.1', () => {
  monitor.start();
  const url = `http://127.0.0.1:${port}`;
  console.log(`Agent Watch is running at ${url}`);
  console.log('Local-only mode: no data is uploaded by Agent Watch.');
  if (process.argv.includes('--open')) {
    const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(command, { windowsHide: true });
  }
});

function shutdown() {
  monitor.stop();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
