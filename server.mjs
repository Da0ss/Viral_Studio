import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const root = process.argv.includes('--preview') ? 'dist' : '.';
const types = { '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.html': 'text/html' };
const portFlag = process.argv.indexOf('--port');
const requestedPort = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 4173;
createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const filename = join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!existsSync(filename)) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream' });
  createReadStream(filename).pipe(response);
}).listen(requestedPort, '0.0.0.0', () => console.log(`Serving ${root} on http://localhost:${requestedPort}`));
