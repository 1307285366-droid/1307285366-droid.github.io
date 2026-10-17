#!/usr/bin/env node
/**
 * 本地静态服务器（零依赖）：把项目跑在 http://0.0.0.0:8000
 * 手机连同一个 Wi-Fi 就能用局域网地址打开。
 *
 * 用法：node tools/serve.mjs [端口]
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 越界访问');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 找不到 ' + rel);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) out.push({ name, address: net.address });
    });
  });
  return out;
}

let port = PORT;
let tries = 0;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && tries < 10) {
    tries += 1;
    port += 1;
    console.log(`端口 ${port - 1} 被占用，换 ${port} 试试…`);
    server.listen(port, '0.0.0.0');
    return;
  }
  console.error('启动失败：' + err.message);
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  console.log('=========================================');
  console.log('  狂k重点 · 本地服务已启动');
  console.log('=========================================');
  console.log('本机打开：      http://localhost:' + port + '/');
  lanAddresses().forEach((net) => {
    console.log('手机同 Wi-Fi：  http://' + net.address + ':' + port + '/    （' + net.name + '）');
  });
  console.log('');
  console.log('停止：Ctrl + C');
  console.log('提示：如果手机打不开，多半是 Windows 防火墙拦了。');
  console.log('      用管理员 PowerShell 执行一次即可放行：');
  console.log('      netsh advfirewall firewall add rule name="quiz-mvp 8000" dir=in action=allow protocol=TCP localport=' + port);
});
