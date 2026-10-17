#!/usr/bin/env node
/**
 * 题库转换脚本：data/raw/*.md  ->  data/banks.js
 *
 * 设计约定：
 *  1. 只做“格式转换”，绝不修改题干 / 选项 / 答案 / 解析的文本内容；
 *  2. 原始 Markdown 里确实存在的结构性缺陷（缺选项、缺答案、答案超出选项范围、
 *     答案与解析互相矛盾）只做“标注”，把该题标记为 invalid，从计分中剔除，不擅自改写；
 *  3. 输出为 `window.__BANKS__ = {...}` 的 JS 文件，双击 index.html 即可加载，
 *     不依赖 fetch / 构建 / 服务器（file:// 协议下 fetch 会被浏览器拦截）。
 *
 * 用法：node tools/convert.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RAW_DIR = join(ROOT, 'data', 'raw');
const OUT_FILE = join(ROOT, 'data', 'banks.js');

/** 题库文件 -> 该题库的元信息（顺序即首页展示顺序） */
const BANK_FILES = [
  { file: 'Web题库.md', id: 'web', title: 'Web前端题库' },
  { file: 'Java题库.md', id: 'java', title: 'Java程序设计题库' },
  // 来自考核附件「原型/index.html」里的示例数据，仅用于对照参考原型，不是正式题库
  { file: '原型示例.md', id: 'proto', title: '原型示例题库（附件原型中的示例数据）' },
];

const TYPE_MAP = { 单选题: 'single', 多选题: 'multiple', 判断题: 'judge' };
const TYPE_LABEL = { single: '单选题', multiple: '多选题', judge: '判断题' };

/**
 * 已知的“非结构性”数据异常（答案与解析互相矛盾）。
 * 这些题结构完整，但答案标注与解析结论不一致，无法判定谁对，故不计分。
 * 键为 `${bankId}-${题号}`。
 */
const CONFLICTS = {
  'java-108': '答案标注为 A，但解析结论为 D，二者矛盾，不计分',
  'java-174': '答案标注为 A，但解析结论为 D，二者矛盾，不计分',
};

/** ---------- 1. Markdown 解析 ---------- */

/**
 * 把一份题库 Markdown 解析成章节数组。
 * @returns {{title: string, questions: object[]}[]}
 */
function parseMarkdown(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters = [];

  let chapter = null;
  let cur = null;   // 当前题目
  let mode = 'stem'; // stem | option | answer | exp
  let fence = false; // 是否处于 ``` 代码块内

  const pushLine = (line) => {
    if (!cur) return;
    if (mode === 'stem') cur.stem.push(line);
    else if (mode === 'option') {
      const last = cur.options[cur.options.length - 1];
      if (last) last.lines.push(line);
    } else if (mode === 'exp') cur.exp.push(line);
  };

  const flushQuestion = () => {
    if (cur && chapter) chapter.questions.push(cur);
    cur = null;
    mode = 'stem';
  };

  const flushChapter = () => {
    flushQuestion();
    if (chapter) chapters.push(chapter);
    chapter = null;
  };

  for (const line of lines) {
    // 代码块围栏：内部内容一律原样归属当前块，绝不当作选项/答案行
    if (/^\s*```/.test(line)) {
      fence = !fence;
      pushLine(line);
      continue;
    }
    if (fence) {
      pushLine(line);
      continue;
    }

    const mChapter = /^##\s+(.+?)\s*$/.exec(line);
    if (mChapter) {
      flushChapter();
      chapter = { title: mChapter[1], questions: [] };
      continue;
    }

    const mQuestion = /^###\s*(\d+)\s*[.、]\s*(单选题|多选题|判断题)\s*$/.exec(line);
    if (mQuestion) {
      flushQuestion();
      if (!chapter) chapter = { title: '未分章', questions: [] };
      cur = {
        no: Number(mQuestion[1]),
        type: TYPE_MAP[mQuestion[2]],
        stem: [],
        options: [],
        answer: '',
        exp: [],
      };
      mode = 'stem';
      continue;
    }

    if (!cur) continue;

    const mAnswer = /^\*\*答案\*\*\s*[：:]\s*(.*)$/.exec(line);
    if (mAnswer) {
      cur.answer = mAnswer[1].trim();
      mode = 'answer';
      continue;
    }

    const mExp = /^\*\*解析\*\*\s*[：:]\s*(.*)$/.exec(line);
    if (mExp) {
      cur.exp.push(mExp[1]);
      mode = 'exp';
      continue;
    }

    if (mode === 'stem' || mode === 'option') {
      const mOption = /^-\s+([A-E])\s*[.、]\s?(.*)$/.exec(line);
      if (mOption) {
        cur.options.push({ key: mOption[1], lines: [mOption[2]] });
        mode = 'option';
        continue;
      }
    }

    pushLine(line);
  }

  flushChapter();
  return chapters;
}

/** ---------- 2. 归一化 + 标注 ---------- */

function trimBlock(lines) {
  return lines.join('\n').replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
}

function normalizeQuestion(raw, bankId) {
  const id = `${bankId}-${raw.no}`;
  const options = raw.options.map((o) => ({ key: o.key, text: trimBlock(o.lines) }));
  const keys = new Set(options.map((o) => o.key));
  const answer = [...new Set((raw.answer.match(/[A-Ea-e]/g) || []).map((c) => c.toUpperCase()))];

  let issue = '';
  if (options.length === 0) issue = '原题库该题缺少选项';
  else if (answer.length === 0) issue = '原题库该题缺少答案';
  else if (answer.some((a) => !keys.has(a))) issue = `答案 ${answer.join('、')} 不在选项 A–${[...keys].sort().pop()} 范围内`;
  else if (CONFLICTS[id]) issue = CONFLICTS[id];

  return {
    id,
    no: raw.no,
    type: raw.type,
    stem: trimBlock(raw.stem),
    options,
    answer,
    answerRaw: raw.answer,
    explanation: trimBlock(raw.exp),
    invalid: Boolean(issue),
    issue,
  };
}

function buildBank(meta, markdown) {
  const chapters = parseMarkdown(markdown).map((c, i) => ({
    id: `${meta.id}-c${i + 1}`,
    title: c.title,
    questions: c.questions.map((q) => normalizeQuestion(q, meta.id)),
  }));

  const all = chapters.flatMap((c) => c.questions);
  const counts = { single: 0, multiple: 0, judge: 0 };
  for (const q of all) counts[q.type] = (counts[q.type] || 0) + 1;

  return {
    id: meta.id,
    title: meta.title,
    source: meta.file,
    stats: {
      total: all.length,
      valid: all.filter((q) => !q.invalid).length,
      invalid: all.filter((q) => q.invalid).length,
      chapters: chapters.length,
      single: counts.single,
      multiple: counts.multiple,
      judge: counts.judge,
    },
    chapters,
  };
}

/** ---------- 3. 输出 ---------- */

function main() {
  if (!existsSync(RAW_DIR)) {
    console.error(`[convert] 找不到原始题库目录：${RAW_DIR}`);
    process.exit(1);
  }

  const banks = [];
  const problems = [];

  for (const meta of BANK_FILES) {
    const file = join(RAW_DIR, meta.file);
    if (!existsSync(file)) {
      console.error(`[convert] 缺少题库文件：${file}`);
      process.exit(1);
    }
    const bank = buildBank(meta, readFileSync(file, 'utf8'));
    banks.push(bank);
    for (const chapter of bank.chapters) {
      for (const q of chapter.questions) {
        if (q.invalid) problems.push({ bank: bank.title, chapter: chapter.title, no: q.no, issue: q.issue });
      }
    }
    console.log(
      `[convert] ${bank.title}：共 ${bank.stats.total} 题（有效 ${bank.stats.valid}，异常 ${bank.stats.invalid}）` +
        ` / ${bank.stats.chapters} 章 / 单选 ${bank.stats.single} 多选 ${bank.stats.multiple} 判断 ${bank.stats.judge}`,
    );
  }

  if (problems.length) {
    console.log(`[convert] 因原题库数据异常而标记为“不计分”的题目（${problems.length} 道）：`);
    for (const p of problems) console.log(`  - ${p.bank} 第 ${p.no} 题：${p.issue}`);
  }

  const payload = { generatedAt: new Date().toISOString(), generator: 'tools/convert.mjs', banks };
  const banner = '/* 该文件由 tools/convert.mjs 从 data/raw/*.md 自动生成，请勿手工修改。 */\n';
  writeFileSync(OUT_FILE, `${banner}window.__BANKS__ = ${JSON.stringify(payload)};\n`, 'utf8');
  console.log(`[convert] 已写出 ${OUT_FILE}（${(Buffer.byteLength(readFileSync(OUT_FILE)) / 1024).toFixed(1)} KB）`);
}

main();
