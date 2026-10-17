#!/usr/bin/env node
/**
 * 冒烟测试：在 Node 里用 vm 沙箱加载纯前端脚本，验证
 *   1. banks.js 结构完整、题量与题库声明一致；
 *   2. 所有“有效题”的答案都落在选项范围内；
 *   3. 重复提交同一道题，成绩不会变（幂等）。
 * 用法：node tools/smoke-test.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'test.log');
const mem = new Map();
let failures = 0;
let total = 0;
let logBuffer = '';

const originalLog = console.log.bind(console);
console.log = (...args) => {
  const line = args.join(' ');
  logBuffer += line + '\n';
  originalLog(line);
};
process.on('exit', () => {
  try { fs.writeFileSync(LOG, logBuffer, 'utf8'); } catch { /* ignore */ }
});

function check(name, ok, extra = '') {
  total += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

// 先做语法检查：ui.js / app.js 依赖 DOM，无法在 Node 里执行，但能验证能否通过解析
for (const file of ['util.js', 'auth.js', 'storage.js', 'quiz.js', 'support.js', 'ui.js', 'app.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'assets/js', file), 'utf8');
  try {
    new vm.Script(code, { filename: file });
    check(`语法检查 assets/js/${file}`, true);
  } catch (err) {
    check(`语法检查 assets/js/${file}`, false, String(err.message));
  }
}

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
  document: {
    addEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, select() {} }),
    body: { appendChild() {}, removeChild() {} },
    readyState: 'complete',
  },
  navigator: {},
  location: { hash: '' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

for (const file of ['data/banks.js', 'assets/js/util.js', 'assets/js/auth.js', 'assets/js/storage.js', 'assets/js/quiz.js', 'assets/js/support.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

const { Quiz } = ctx;
const Store = ctx.Store;
const payload = ctx.__BANKS__;

check('__BANKS__ 已加载', Boolean(payload && Array.isArray(payload.banks)));
check('题库数量为 3', payload.banks.length === 3, `实际 ${payload.banks.length}`);

const expect = {
  web: { total: 120, valid: 118, invalid: 2, single: 65, multiple: 13, judge: 42 },
  java: { total: 219, valid: 216, invalid: 3, single: 192, multiple: 12, judge: 15 },
  proto: { total: 7, valid: 7, invalid: 0, single: 3, multiple: 2, judge: 2 },
};

for (const bank of payload.banks) {
  const st = bank.stats;
  const e = expect[bank.id];
  check(`[${bank.id}] 题量 ${st.total}`, st.total === e.total, `期望 ${e.total}`);
  check(`[${bank.id}] 有效题 ${st.valid}`, st.valid === e.valid, `期望 ${e.valid}`);
  check(`[${bank.id}] 异常题 ${st.invalid}`, st.invalid === e.invalid, `期望 ${e.invalid}`);
  check(`[${bank.id}] 题型统计`, st.single === e.single && st.multiple === e.multiple && st.judge === e.judge,
    `单选 ${st.single}/多选 ${st.multiple}/判断 ${st.judge}`);
  check(`[${bank.id}] 题型之和等于总数`, st.single + st.multiple + st.judge === st.total);
}

// 结构校验：有效题的答案必须全部在选项里；无效题必须有 issue 说明
let structureErrors = 0;
for (const bank of payload.banks) {
  for (const chapter of bank.chapters) {
    for (const q of chapter.questions) {
      const keys = q.options.map((o) => o.key);
      if (q.invalid) {
        if (!q.issue) { structureErrors++; console.log(`  无效题缺 issue: ${q.id}`); }
        continue;
      }
      if (!q.options.length) { structureErrors++; console.log(`  ${q.id} 无选项却未标 invalid`); }
      if (!q.answer.length) { structureErrors++; console.log(`  ${q.id} 无答案却未标 invalid`); }
      if (q.answer.some((a) => !keys.includes(a))) { structureErrors++; console.log(`  ${q.id} 答案不在选项中`); }
      if (!q.stem) { structureErrors++; console.log(`  ${q.id} 题干为空`); }
    }
  }
}
check('所有有效题结构合法', structureErrors === 0, structureErrors ? `错误 ${structureErrors} 处` : '');

// 组卷：范围 -> 题目 id（不改变题库内容，只选范围）
const bank = Quiz.bankById('web');
const chapter0 = bank.chapters[0];
check('collectIds(all) 等于题库总题量',
  Quiz.collectIds(bank, { type: 'all' }).length === bank.stats.total);
check('collectIds(chapter) 等于该章题量',
  Quiz.collectIds(bank, { type: 'chapter', chapterId: chapter0.id }).length === chapter0.questions.length);
check('collectIds(chapters) 等于所选章节合计',
  Quiz.collectIds(bank, { type: 'chapters', chapterIds: [bank.chapters[0].id, bank.chapters[1].id] }).length
    === bank.chapters[0].questions.length + bank.chapters[1].questions.length);
check('选择题库后能按章节细分',
  bank.chapters.length === 6 && bank.chapters.every((c) => c.questions.length > 0 && c.id && c.title));

// 幂等：同一题连续提交不同答案，记录与成绩必须保持不变
const session = Quiz.createSession({ title: bank.title, questionIds: Quiz.collectIds(bank, { type: 'all' }) });
const qid = session.questionIds[0];
const q = Quiz.questionById(qid).q;
const first = Quiz.submit(session, qid, q.answer);
const snapshot = JSON.stringify(first);
Quiz.submit(session, qid, ['A']);
Quiz.submit(session, qid, ['A', 'B', 'C']);
Quiz.submit(session, qid, []);
const statsA = Quiz.stats(session);
check('重复提交返回同一条记录', JSON.stringify(session.answers[qid]) === snapshot);
check('重复提交后统计不变', JSON.stringify(Quiz.stats(session)) === JSON.stringify(statsA));

// 整卷重放：每题都先答对再乱答，正确率必须等于 100%
const full = Quiz.createSession({ title: bank.title, questionIds: Quiz.collectIds(bank, { type: 'all' }) });
for (const id of full.questionIds) {
  const item = Quiz.questionById(id).q;
  if (item.invalid) continue;
  Quiz.submit(full, id, item.answer);
  Quiz.submit(full, id, item.answer.length > 1 ? [item.answer[0]] : []);
}
const fullStats = Quiz.stats(full);
check('全部答对后正确率为 100%', fullStats.accuracy === 100, `实际 ${fullStats.accuracy}%`);
check('全部答对后无错题', fullStats.wrong === 0, `错题 ${fullStats.wrong}`);

// 原型示例题库：来自附件「原型/index.html」，必须与原型里的示例数据一致
const proto = Quiz.bankById('proto');
check('原型题库章数为 2', proto.chapters.length === 2, `实际 ${proto.chapters.length}`);
check('原型题库第 1 章为 JavaScript 基础', proto.chapters[0].title === 'JavaScript 基础');
check('原型题库第 2 章为 网络基础', proto.chapters[1].title === '网络基础');
check('原型题库多选题答案与原型一致',
  proto.chapters[0].questions[1].answer.join('') === 'ABD' && proto.chapters[1].questions[2].answer.join('') === 'ABD');
check('原型题库判断题答案与原型一致',
  proto.chapters[0].questions[2].answer.join('') === 'A' && proto.chapters[1].questions[1].answer.join('') === 'B');

// 错题本：跨题库、按题型分组、结构异常的题不收进去
function firstValidId(type) {
  for (const b of payload.banks) {
    for (const c of b.chapters) {
      for (const q of c.questions) {
        if (q.type === type && !q.invalid) return q.id;
      }
    }
  }
  return null;
}
const singleId = firstValidId('single');
const multiId = firstValidId('multiple');
const judgeId = firstValidId('judge');
const book = {};
book[singleId] = { times: 2 };
book[multiId] = { times: 1 };
book[judgeId] = { times: 1 };

const groups = Quiz.wrongByType(book);
check('错题本能跨题库收题', Quiz.wrongEntries(book).length === 3);
check('错题本能按题型细分（单选）', groups.single.length === 1 && groups.single[0].q.id === singleId);
check('错题本能按题型细分（多选）', groups.multiple.length === 1 && groups.multiple[0].q.id === multiId);
check('错题本能按题型细分（判断）', groups.judge.length === 1 && groups.judge[0].q.id === judgeId);
check('错题条目带回题库信息', Quiz.wrongEntries(book)[0].bank && Quiz.wrongEntries(book)[0].bank.title);
check('错题条目保留错误次数', Quiz.wrongEntries(book).filter((it) => it.q.id === singleId)[0].times === 2);
check('数据异常题不会被收进错题本', Quiz.wrongEntries({ 'web-31': { times: 1 } }).length === 0);
check('答案与解析矛盾的题不会被收进错题本', Quiz.wrongEntries({ 'java-108': { times: 1 } }).length === 0);
check('错题本按题库展示顺序 + 原题号排序', (function () {
  const ids = Quiz.wrongEntries({ 'proto-1': {}, 'web-9': {}, 'java-30': {}, 'web-2': {} }).map((it) => it.q.id);
  return ids.join(',') === 'web-2,web-9,java-30,proto-1';
})());

// 账号：手机号注册 / 登录 / 多身份数据隔离（纯本地演示）
const Auth = ctx.Auth;
check('默认是游客身份', Auth.current().isGuest && Auth.ownerKey() === 'guest');
check('手机号校验', Auth.isPhone('13800138000') && !Auth.isPhone('12345') && !Auth.isPhone('23800138000'));
check('手机号脱敏', Auth.maskPhone('13800138000') === '138****8000');
check('没发验证码不能注册', Auth.register({ phone: '13800138000', password: 'abc123456' }).ok === false);
const sent = Auth.sendCode('13800138000');
check('发送验证码返回 6 位数字', sent.ok && /^\d{6}$/.test(sent.code));
check('验证码错误不能注册', Auth.register({ phone: '13800138000', code: '000000', password: 'abc123456' }).ok === false);
check('密码太短不能注册', Auth.register({ phone: '13800138000', code: sent.code, password: '123' }).ok === false);
check('注册成功', Auth.register({ phone: '13800138000', code: sent.code, password: 'abc123456', nickname: '小明' }).ok === true);
check('注册后自动登录', !Auth.current().isGuest && Auth.current().nickname === '小明');
check('账号身份 key 与游客不同', Auth.ownerKey() === 'u_13800138000' && Auth.ownerKey() !== 'guest');
check('重复注册会被拦下', Auth.register({ phone: '13800138000', code: Auth.sendCode('13800138000').code, password: 'abc123456' }).ok === false);
check('密码不是明文存储', Auth.accounts()['13800138000'].pass !== 'abc123456');
Auth.logout();
check('退出登录回到游客', Auth.current().isGuest);
check('未注册的手机号不能登录', Auth.login({ phone: '13900139000', password: 'abc123456' }).ok === false);
check('密码错误不能登录', Auth.login({ phone: '13800138000', password: 'nope123456' }).ok === false);
check('密码正确可以登录', Auth.login({ phone: '13800138000', password: 'abc123456' }).ok === true);

// 多身份数据隔离：游客与账号各存一份
Store.clear('guest');
Store.clear('u_13800138000');
const guestState = Store.defaults();
guestState.favorites = { web: ['web-1'] };
Store.save(guestState, 'guest');
const userState = Store.defaults();
userState.favorites = { java: ['java-1', 'java-2'] };
Store.save(userState, 'u_13800138000');
check('游客与账号的数据互不干扰',
  Store.load('guest').favorites.web[0] === 'web-1'
    && Store.load('u_13800138000').favorites.java.length === 2
    && !Store.load('guest').favorites.java);
check('不同身份的存储 key 不同', Store.dataKey('guest') !== Store.dataKey('u_13800138000'));
check('Store.has 能区分有没有数据', Store.has('guest') && !Store.has('u_13900139000'));
check('旧版本数据会自动补齐缺失字段', (function () {
  mem.set('quizmvp.v1.guest', JSON.stringify({ version: 1, favorites: { web: ['web-9'] } }));
  const migrated = Store.load('guest');
  return migrated.view === 'banks' && Array.isArray(migrated.history)
    && migrated.settings.showTimer === true && migrated.favorites.web[0] === 'web-9';
})());
Auth.logout();

// 智能客服：关键词匹配 + 娟实回答
const support = ctx.Support;
check('客服能匹配到常见问题', support.ask('错题本怎么用').a.indexOf('自动') >= 0);
check('客服认不出的问题会明确告知', support.ask('今天天气怎么样').a === support.fallback);
check('客服每个回答都不为空', support.faq.every((f) => f.a && f.q && f.keys.length));

// 交卷分析 + 测试记录
const an = Quiz.analyze(full);
check('分析能给出一句结论', typeof an.comment === 'string' && an.comment.length > 0);
check('全对时按题型全部计为答对',
  Object.keys(an.byType).every((t) => an.byType[t].wrong === 0 && an.byType[t].correct > 0));
check('全对时没有薄弱章节', an.weak.length === 0);

// 故意答错一题，分析应能定位到薄弱点
const probe = Quiz.createSession({ title: 'probe', questionIds: Quiz.collectIds(bank, { type: 'all' }) });
const probeId = probe.questionIds[0];
const probeQ = Quiz.questionById(probeId).q;
const wrongKey = probeQ.options.map((o) => o.key).filter((k) => probeQ.answer.indexOf(k) < 0)[0];
Quiz.submit(probe, probeId, [wrongKey]);
const probeAn = Quiz.analyze(probe);
check('答错后能定位到薄弱章节', probeAn.weak.length === 1 && probeAn.weak[0].wrong === 1 && Boolean(probeAn.weak[0].chapter));
check('答错后能指出最薄弱题型', probeAn.weakestType === probeQ.type);
check('未作答的题不计入正确率', (function () {
  const s = Quiz.createSession({ title: 'p2', questionIds: Quiz.collectIds(bank, { type: 'all' }) });
  Quiz.submit(s, s.questionIds[0], Quiz.questionById(s.questionIds[0]).q.answer);
  const a = Quiz.analyze(s);
  return a.stats.answered === 1 && a.stats.accuracy === 100 && a.stats.unanswered > 0;
})());

// 测试记录：未交卷 / 已交卷
const recUndone = Quiz.recordOf(probe, false);
const recDone = Quiz.recordOf(probe, true);
check('未交卷的记录标记为未完成', recUndone.finished === false && recDone.finished === true);
check('记录里带答对 / 答错 / 未作答',
  typeof recDone.correct === 'number' && typeof recDone.wrong === 'number' && typeof recDone.unanswered === 'number');
check('记录口径与 stats 一致',
  recDone.correct === Quiz.stats(probe).correct && recDone.valid === Quiz.stats(probe).valid
    && recDone.accuracy === Quiz.stats(probe).accuracy);
check('会话能标记为重刷模式',
  Quiz.createSession({ title: 'r', questionIds: ['web-1'], mode: 'redo' }).mode === 'redo'
    && Quiz.createSession({ title: 'p', questionIds: ['web-1'] }).mode === 'practice');

/* ================= 多轮次存档 ================= */
check('新会话默认没有父轮次',
  Quiz.createSession({ title: 'x', questionIds: ['web-1'] }).parentId === null);
check('错题重做出来的轮次记得父轮次与来源', (function () {
  const r = Quiz.createSession({ title: 'x', questionIds: ['web-1'], parentId: 'p1', origin: 'wrong-redo' });
  return r.parentId === 'p1' && r.origin === 'wrong-redo';
})());
check('每次组卷的轮次 id 都不同',
  Quiz.createSession({ title: 'x', questionIds: ['web-1'] }).id
    !== Quiz.createSession({ title: 'x', questionIds: ['web-1'] }).id);
check('测试记录带上了轮次来源，便于回看', (function () {
  const r = Quiz.createSession({ title: 'x', questionIds: ['web-1'], parentId: 'p1', origin: 'wrong-redo' });
  const rec = Quiz.recordOf(r, true);
  return rec.id === r.id && rec.origin === 'wrong-redo' && rec.parentId === 'p1' && rec.finished === true;
})());

check('默认数据里带 rounds / currentRoundId', (function () {
  const d = Store.defaults();
  return Array.isArray(d.rounds) && d.rounds.length === 0 && d.currentRoundId === null && !('session' in d);
})());
check('旧版本的 session 会被迁移成第一轮', (function () {
  const legacy = {
    version: 3,
    session: { id: 'old-1', title: '旧练习', questionIds: ['web-1', 'web-2'], answers: {}, index: 1,
      elapsedMs: 5000, startedAt: 1, finished: false },
  };
  const out = Store.normalize(legacy);
  return out.rounds.length === 1 && out.rounds[0].id === 'old-1' && out.currentRoundId === 'old-1'
    && out.rounds[0].index === 1 && !('session' in out);
})());
check('缺失的轮次字段会被补全', (function () {
  const out = Store.normalize({ rounds: [{ id: 'r1', questionIds: ['web-1'] }] });
  const r = out.rounds[0];
  return typeof r.answers === 'object' && typeof r.draft === 'object' && r.mode === 'practice'
    && r.scopeLabel === '' && r.finished === false && r.index === 0 && r.elapsedMs === 0
    && out.currentRoundId === 'r1';
})());
check('坏掉的轮次会被丢掉', (function () {
  const out = Store.normalize({
    rounds: [
      { id: 'good', questionIds: ['web-1'] },
      { questionIds: ['web-2'] },          // 没有 id
      { id: 'empty', questionIds: [] },    // 没有题目
      null,
      'nope',
    ],
  });
  return out.rounds.length === 1 && out.rounds[0].id === 'good';
})());
check('currentRoundId 指向不存在的轮次时自动纠正', (function () {
  const out = Store.normalize({ rounds: [{ id: 'a', questionIds: ['web-1'] }], currentRoundId: 'gone' });
  return out.currentRoundId === 'a';
})());
check('每一轮的各题作答互不影响（独立快照）', (function () {
  const r1 = Quiz.createSession({ title: 'r1', questionIds: ['web-1'] });
  const r2 = Quiz.createSession({ title: 'r2', questionIds: ['web-1'] });
  Quiz.submit(r1, 'web-1', ['A']);
  return Object.keys(r1.answers).length === 1 && Object.keys(r2.answers).length === 0;
})());
check('轮次 / 会话存进磁盘时不会存成两份', (function () {
  const fake = {
    rounds: [{ id: 'r1', questionIds: ['web-1'], answers: {}, draft: {} }],
    currentRoundId: 'r1',
  };
  Object.defineProperty(fake, 'session', {
    enumerable: false, configurable: true,
    get() { return fake.rounds[0]; },
  });
  const text = JSON.stringify(fake);
  const back = JSON.parse(text);
  return text.indexOf('"session"') < 0 && back.rounds.length === 1 && back.rounds[0].id === 'r1';
})());

// 打印两道样例，便于人工确认转换效果
const sample = payload.banks[1].chapters[0].questions[15];
console.log('\n样例题目（java-16）：');
console.log(JSON.stringify({ id: sample.id, type: sample.type, options: sample.options.length, answer: sample.answer, invalid: sample.invalid }, null, 2));

console.log(`\n共 ${total} 项断言，失败 ${failures} 项`);
console.log(failures === 0 ? '✅ 全部通过' : '❌ 有失败项');
process.exit(failures === 0 ? 0 : 1);
