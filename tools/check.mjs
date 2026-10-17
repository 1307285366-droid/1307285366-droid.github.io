#!/usr/bin/env node
/**
 * 一键自检：node tools/check.mjs
 *
 * 检查四件事：
 *   1. 纯静态保证：页面只引用本地文件，没有外部 URL、没有 fetch / XHR / 动态 import
 *   2. index.html 里引用的每个文件都真实存在（双击能跑的前提）
 *   3. 题库数据能加载、id 全局唯一、三个题库齐全
 *   4. 跑冒烟测试 + 渲染/交互测试
 *
 * 结果同时写到 check.log（UTF-8），退出码 0 = 全过。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'check.log');

const lines = [];
let failures = 0;

function check(name, ok, extra = '') {
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures += 1;
}

function flush() {
  const text = lines.join('\n');
  console.log(text);
  try { fs.writeFileSync(LOG, text + '\n', 'utf8'); } catch { /* ignore */ }
}
process.on('exit', flush);

/* ---------- 1. 引用的本地资源都存在 ---------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
check('index.html 只有一个页面 + 本地资源', refs.length >= 7, refs.length + ' 个引用');
refs.forEach((rel) => {
  check('引用的文件存在: ' + rel, fs.existsSync(path.join(ROOT, rel)));
});

/* ---------- 2. 纯静态：没有外部依赖、没有网络请求 ---------- */
const scanned = ['index.html', 'assets/css/app.css',
  ...fs.readdirSync(path.join(ROOT, 'assets', 'js')).map((f) => 'assets/js/' + f)];

const externals = [];
scanned.forEach((rel) => {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  (text.match(/https?:\/\/[^\s'"()<>]+/g) || []).forEach((u) => externals.push(rel + ' -> ' + u));
  if (/\bfetch\s*\(/.test(text)) externals.push(rel + ' -> fetch(');
  if (/XMLHttpRequest/.test(text)) externals.push(rel + ' -> XMLHttpRequest');
  if (/\bimport\s*\(/.test(text)) externals.push(rel + ' -> 动态 import(');
});
check('没有任何外部 URL / 网络请求（纯静态，可离线双击运行）',
  externals.length === 0, externals.join('; '));

/* ---------- 3. 题库数据 ---------- */
const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data', 'banks.js'), 'utf8'), sandbox, { filename: 'data/banks.js' });

const payload = sandbox.__BANKS__;
check('data/banks.js 能加载（window.__BANKS__）', Boolean(payload && Array.isArray(payload.banks)));

if (payload && Array.isArray(payload.banks)) {
  const banks = payload.banks;
  check('三个题库都在', banks.length === 3, banks.map((b) => b.id).join(' / '));
  check('题库 id 分别为 web / java / proto',
    ['web', 'java', 'proto'].every((id) => banks.some((b) => b.id === id)));

  const questions = banks.reduce((acc, b) => acc.concat(b.chapters.reduce((x, c) => x.concat(c.questions), [])), []);
  const ids = questions.map((q) => q.id);
  check('题目 id 全局唯一', new Set(ids).size === ids.length, questions.length + ' 题');
  check('每题都有题干', questions.every((q) => typeof q.stem === 'string' && q.stem.length > 0));
  check('异常题都有说明', questions.filter((q) => q.invalid).every((q) => Boolean(q.issue)));
  check('有效题的答案都在选项里', questions.filter((q) => !q.invalid).every((q) => {
    const keys = q.options.map((o) => o.key);
    return q.answer.length > 0 && q.answer.every((a) => keys.includes(a));
  }));
}

/* ---------- 4. 跑两个测试脚本 ---------- */
['tools/smoke-test.mjs', 'tools/render-test.mjs'].forEach((rel) => {
  try {
    execFileSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, stdio: 'pipe' });
    check('通过：' + rel, true);
  } catch (err) {
    const status = typeof err.status === 'number' ? err.status : '?';
    check('通过：' + rel, false, '退出码 ' + status);
  }
});

lines.push('');
lines.push(failures === 0 ? '✅ 自检全部通过' : `❌ 自检有 ${failures} 项失败`);
flush();
process.exit(failures === 0 ? 0 : 1);
