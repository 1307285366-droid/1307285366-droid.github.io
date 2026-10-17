#!/usr/bin/env node
/**
 * 渲染 / 交互测试：用一个极简 DOM 桩，在 Node 里真正执行 ui.js + app.js。
 * 覆盖的规则：
 *   - 每题提交后立刻判分、立刻出答案（不用等交卷）
 *   - 没做完也计入错题本 / 答题记录；交卷后记录标记为已完成
 *   - 重复提交同一题，成绩不变
 *   - 交卷后能看到对几道错几道 + 简单分析
 *   - 重刷做过的题：新结果覆盖旧结果，但错题本不动
 *   - 错题重做：把一轮里做错的题抽出来另开一轮，原轮原样保留、可回看
 *   - 错题本只增不减，只能手动移出
 * 用法：node tools/render-test.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'render-test.log');
let failures = 0;
let assertions = 0;
let logBuffer = '';
const originalLog = console.log.bind(console);
console.log = (...args) => { const line = args.join(' '); logBuffer += line + '\n'; originalLog(line); };
process.on('exit', () => { try { fs.writeFileSync(LOG, logBuffer, 'utf8'); } catch { /* ignore */ } });

function check(name, ok, extra = '') {
  assertions += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

/* ---- 极简 DOM 桩 ---- */
const mem = new Map();
const listeners = {};
const elements = new Map();

function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', className: '', disabled: false,
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, appendChild() {}, removeChild() {}, select() {}, remove() {},
    scrollIntoView() {},
  };
}
function el(id) {
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
}

const documentStub = {
  readyState: 'complete',
  hidden: false,
  getElementById: (id) => el(id),
  querySelector: () => null,
  addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  createElement: () => makeEl('tmp'),
  body: { appendChild() {}, removeChild() {}, scrollHeight: 0 },
  execCommand: () => true,
};

const sandbox = {
  console,
  setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  confirm: () => true,
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
  document: documentStub,
  navigator: {},
  location: { hash: '' },
  addEventListener: (type, fn) => { (listeners['window:' + type] = listeners['window:' + type] || []).push(fn); },
  removeEventListener: () => {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

for (const file of [
  'data/banks.js', 'assets/js/util.js', 'assets/js/auth.js', 'assets/js/storage.js',
  'assets/js/quiz.js', 'assets/js/support.js', 'assets/js/ui.js', 'assets/js/app.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

function click(attrs) {
  const target = {
    getAttribute: (k) => {
      const key = k.indexOf('data-') === 0 ? k.slice(5) : k;
      return key in attrs ? attrs[key] : null;
    },
  };
  target.closest = () => target;
  (listeners.click || []).forEach((fn) => fn({ target }));
}
const html = () => el('app').innerHTML;
const appClass = () => el('app').className;
const data = (owner) => JSON.parse(mem.get('quizmvp.v1.' + owner) || 'null');
// 多轮次：当前这一轮 / 指定某一轮（都从磁盘上的真实数据里取）
const curRound = () => { const d = data('guest'); return (d.rounds || []).find((r) => r.id === d.currentRoundId); };
const findRound = (id) => (data('guest').rounds || []).find((r) => r.id === id);
const Quiz = ctx.Quiz;
const WEB = Quiz.bankById('web');
const CH0 = WEB.chapters[0];
const Q1 = Quiz.questionById(CH0.questions[0].id).q;
const BAD_KEY = Q1.options.map((o) => o.key).filter((k) => Q1.answer.indexOf(k) < 0)[0];

/* ================= 题库页 ================= */
check('题库页显示「狂k重点」', html().includes('狂k重点') && html().includes('cover-title'));
check('题库页就是列表页（不是直接答题）', html().includes('data-action="open-bank"') && !html().includes('提交'));
check('题库页列出三个题库', ['Web前端题库', 'Java程序设计题库', '原型示例题库'].every((t) => html().includes(t)));
check('底部导航为 题库 / 错题 / 收藏 / 我的', (function () {
  const m = html().match(/data-view="(banks|wrong|favorites|me)"/g) || [];
  return ['banks', 'wrong', 'favorites', 'me'].every((v) => m.some((s) => s.includes('"' + v + '"')));
})());

/* ================= 题库详情 → 章节 ================= */
click({ action: 'open-bank', bank: 'web' });
check('点开题库进入题库详情（仍是章节列表）', html().includes('章节（点开进入练习）') && !html().includes('提交'));
check('题库详情列出全部 6 个章节', WEB.chapters.every((c) => html().includes(c.title)));
check('没做过题时“重刷做过的”是禁用的', html().includes('重刷做过的（0）') && html().includes('disabled'));

click({ action: 'start-chapter', bank: 'web', chapter: CH0.id });
check('从章节进入答题页', html().includes('第 <b>1</b>') && html().includes('提交'));
check('会话题目数等于该章题量', curRound().questionIds.length === CH0.questions.length);

/* ================= 每题即时判分 ================= */
click({ action: 'pick', key: BAD_KEY });
check('提交前不显示答案', !html().includes('answer-strip'));
click({ action: 'submit' });
check('一提交就立刻判分（不用等交卷）', html().includes('answer-strip') && html().includes('答错了'));
check('答案条里直接给出正确答案', html().includes('正确答案 <b>' + Q1.answer.join('、') + '</b>'));
check('题干下方同时给出解析', html().includes('解析：'));
check('未交卷也已经计入错题记录', Object.keys(data('guest').wrong).length === 1);
check('未交卷也已经计入答题记录', (data('guest').history || []).length === 1);
check('未交卷的答题记录标记为“未完成”', data('guest').history[0].finished === false);
check('已练记录写入最后一题的结果', data('guest').done[Q1.id] === 0);

/* ================= 幂等 ================= */
const before = JSON.stringify(curRound().answers);
const beforeWrong = JSON.stringify(data('guest').wrong);
const beforeHistory = JSON.stringify(data('guest').history);
click({ action: 'submit' });
click({ action: 'submit' });
check('重复提交不改答题记录', JSON.stringify(curRound().answers) === before);
check('重复提交不改正确率（统计不变）', JSON.stringify(data('guest').history) === beforeHistory);
check('重复提交不重复累加错题次数', JSON.stringify(data('guest').wrong) === beforeWrong);

click({ action: 'star' });
check('收藏写入本身份数据', (data('guest').favorites.web || []).length === 1);
click({ action: 'next' });
check('下一题生效', html().includes('第 <b>2</b>'));
click({ action: 'prev' });
check('上一题生效', html().includes('第 <b>1</b>'));

/* ================= 交卷 + 分析 ================= */
const total = curRound().questionIds.length;
for (let i = 0; i < total + 2; i++) {
  if (curRound().index >= total - 1) break;
  click({ action: 'next' });
}
click({ action: 'finish' });
check('交卷后记录标记为已交卷', data('guest').history[0].finished === true);
check('交卷后看到对几道错几道', html().includes('答对') && html().includes('答错') && html().includes('未作答'));
check('结果页给出简单分析', html().includes('简单分析') && html().includes('薄弱点'));
check('分析里按题型拆了对错', html().includes('单选题') && html().includes('对 '));
check('只有一个会话时记录也只有一条', data('guest').history.length === 1);

// 把“原来那一轮”完整快照下来，后面用逐字节对比证明它没被动过
const origRoundId = data('guest').currentRoundId;
const origSnapshot = JSON.stringify(findRound(origRoundId));
const origStats = JSON.stringify(Quiz.stats(findRound(origRoundId)));
const origWrongIds = Quiz.wrongQuestionIds(findRound(origRoundId)).join(',');
const origIndex = findRound(origRoundId).index;

/* ================= 重刷做过的题 ================= */
click({ action: 'go', view: 'banks' });
click({ action: 'open-bank', bank: 'web' });
check('做过题后“重刷做过的”可用', html().includes('重刷做过的（1）') && !html().includes('重刷做过的（0）'));
click({ action: 'redo-done', bank: 'web' });
check('进入重刷模式', curRound().mode === 'redo' && html().includes('badge redo'));
const wrongBookBefore = JSON.stringify(data('guest').wrong);
const wrongTimesBefore = data('guest').wrong[Q1.id].times;
for (const k of Q1.answer) click({ action: 'pick', key: k });
click({ action: 'submit' });
check('重刷答对后，已练记录被新结果覆盖', data('guest').done[Q1.id] === 1);
check('重刷时错题本内容不变', JSON.stringify(data('guest').wrong) === wrongBookBefore);
check('重刷时错题次数也不变', data('guest').wrong[Q1.id].times === wrongTimesBefore);
check('重刷会新增一条独立记录，原来那条还在', (function () {
  const h = data('guest').history;
  return h.length === 2 && h[0].mode === 'redo' && h[0].correct === 1 && h[1].id === origRoundId;
})());
check('重刷也是一轮独立存档', data('guest').rounds.length === 2);

/* ================= 错题重做：另开一轮，原轮原样保留 ================= */
const roundsBefore = data('guest').rounds.length;
const histBefore = data('guest').history.length;

click({ action: 'go', view: 'history' });
check('测试记录里每一轮都能打开', html().includes('打开这一轮') && html().includes('继续这一轮'));
check('每一轮都对应一条记录（轮次与记录一一对应）', (function () {
  const d = data('guest');
  return d.rounds.length === d.history.length
    && d.rounds.every((r) => d.history.some((h) => h.id === r.id));
})());
click({ action: 'open-round', round: origRoundId });
check('能打开以前那一轮（回到当时的成绩页）',
  data('guest').currentRoundId === origRoundId && html().includes('本次成绩'));
check('打开旧轮次时，成绩与每题记录与当初一模一样',
  JSON.stringify(findRound(origRoundId)) === origSnapshot);
check('结果页有「错题重做」入口',
  html().includes('data-action="redo-wrong"') && html().includes('错题重做（'));

click({ action: 'redo-wrong' });
const newRound = curRound();
check('错题重做另开了一轮（原来那轮还在）', data('guest').rounds.length === roundsBefore + 1
  && newRound.id !== origRoundId && Boolean(findRound(origRoundId)));
check('刚开的这一轮立刻就能在测试记录里找到（哪怕还没答）', (function () {
  const h = data('guest').history.find((x) => x.id === newRound.id);
  return Boolean(h) && h.answered === 0 && h.finished === false;
})());
check('新一轮的题目 = 原来那一轮没做对的题',
  newRound.questionIds.join(',') === origWrongIds && newRound.questionIds.length > 0);
check('新一轮是一份独立的记录',
  data('guest').history.length === histBefore + 1 && data('guest').history[0].id === newRound.id);
check('新一轮记得自己是从哪一轮抽出来的',
  newRound.origin === 'wrong-redo' && newRound.parentId === origRoundId);
check('错题重做后，原轮次的每题记录一个字都没变',
  JSON.stringify(findRound(origRoundId)) === origSnapshot);
check('错题重做后，原轮次的成绩没变',
  JSON.stringify(Quiz.stats(findRound(origRoundId))) === origStats);
check('错题重做后，原轮次的进度也保留着', findRound(origRoundId).index === origIndex);
check('原轮次仍然在测试记录里', data('guest').history.some((h) => h.id === origRoundId));

for (const k of Q1.answer) click({ action: 'pick', key: k });
click({ action: 'submit' });
check('在新一轮答对后，原轮次依旧不变',
  JSON.stringify(findRound(origRoundId)) === origSnapshot);
check('在新一轮答对，也不会把题从错题本里移走', Boolean(data('guest').wrong[Q1.id]));
check('新一轮自己记下了这次作答', curRound().answers[Q1.id].correct === true);
check('错题重做会把「最新掌握情况」更新为答对', data('guest').done[Q1.id] === 1);
click({ action: 'finish' });
check('新一轮交卷后有「回到上一轮」', html().includes('回到上一轮'));
check('从新一轮能一键回到上一轮，内容依旧不变', (function () {
  click({ action: 'open-round', round: origRoundId });
  return data('guest').currentRoundId === origRoundId
    && html().includes('本次成绩')
    && JSON.stringify(findRound(origRoundId)) === origSnapshot;
})());

/* ================= 错题本：只增不减 ================= */
click({ action: 'go', view: 'wrong' });
check('错题页打开且按题型分组', html().includes('道错题') && html().includes('单选题'));
const wrongQid = Object.keys(data('guest').wrong)[0];
const wrongQ = Quiz.questionById(wrongQid).q;
click({ action: 'start-wrong-type', type: wrongQ.type });
check('从错题页可以直接开练', curRound().questionIds.length === 1);
for (const k of wrongQ.answer) click({ action: 'pick', key: k });
click({ action: 'submit' });
check('在错题本里答对也不会自动移出', Boolean(data('guest').wrong[wrongQid]));
click({ action: 'go', view: 'wrong' });
click({ action: 'remove-wrong', qid: wrongQid });
check('手动“已掌握，移出”才真的移出', !data('guest').wrong[wrongQid]);

/* ================= 收藏 / 我的 ================= */
click({ action: 'go', view: 'favorites' });
check('收藏页保留为独立页面', html().includes('我的收藏') && html().includes('练这一套收藏'));

click({ action: 'go', view: 'me' });
check('「我的」显示游客身份', html().includes('游客') && html().includes('登录 / 注册'));
check('「我的」有七个入口', ['统计分析', '测试记录', '重刷做过的题', '错题重做', '错题本', '我的收藏', '智能客服', '设置'].every((t) => html().includes(t)));

/* ================= 统计分析 / 测试记录 ================= */
click({ action: 'go', view: 'stats' });
check('统计分析打开并渲染正确率条', html().includes('按题库') && html().includes('按题型') && html().includes('按章节') && html().includes('class="bar"'));
click({ action: 'go', view: 'history' });
check('测试记录打开', html().includes('测试记录') && html().includes('已交卷'));
check('测试记录里有重刷标记', html().includes('重刷'));
check('测试记录里有错题重做标记', html().includes('错题重做'));

/* ================= 智能客服 ================= */
click({ action: 'go', view: 'support' });
click({ action: 'ask-faq', q: '错题本怎么用？' });
check('点常见问题得到回答', html().includes('msg bot'));
el('askInput').value = '今天天气怎么样';
click({ action: 'ask-send' });
check('答不上来时会明确告知', html().includes('答不上来'));

/* ================= 设置 ================= */
click({ action: 'go', view: 'settings' });
click({ action: 'toggle-setting', key: 'showTimer' });
check('关闭计时后进入答题不显示计时', (function () {
  click({ action: 'go', view: 'banks' });
  click({ action: 'open-bank', bank: 'proto' });
  click({ action: 'start-all', bank: 'proto' });
  const ok = !html().includes('id="timer"');
  click({ action: 'quit' });
  return ok;
})());
click({ action: 'go', view: 'settings' });
click({ action: 'toggle-setting', key: 'bigFont' });
check('打开大字号模式后 app 带 big-font 类', appClass().includes('big-font'));

/* ================= 注册 / 登录 ================= */
click({ action: 'go', view: 'auth' });
el('authPhone').value = '13800138000';
click({ action: 'send-code' });
const code = (el('codeHint').textContent.match(/\d{6}/) || [])[0];
check('演示验证码会显示在页面上', Boolean(code));
el('authCode').value = code;
el('authPass').value = 'abc123456';
el('authNick').value = '小明';
click({ action: 'do-register' });
check('注册成功后进入「我的」', html().includes('小明') && html().includes('138****8000'));
check('注册后数据挂在账号下', Boolean(data('u_13800138000')));
check('游客已有的进度被带了过来', (data('u_13800138000').favorites.web || []).length === 1);
check('游客数据仍然独立存在', Boolean(data('guest')) && data('guest').favorites.web.length === 1);
check('账号表里存了手机号与哈希密码', (function () {
  const acc = JSON.parse(mem.get('quizmvp.accounts'))['13800138000'];
  return Boolean(acc) && acc.pass !== 'abc123456' && Boolean(acc.salt);
})());

click({ action: 'logout' });
check('退出登录后回到游客身份', html().includes('游客') && html().includes('登录 / 注册'));
click({ action: 'go', view: 'auth' });
click({ action: 'auth-mode', mode: 'login' });
el('authPhone').value = '13800138000';
el('authPass').value = 'wrongpass';
click({ action: 'do-login' });
check('密码错误会提示', el('authError').textContent.includes('密码不对'));
el('authPass').value = 'abc123456';
click({ action: 'do-login' });
check('登录成功后回到原账号', html().includes('小明'));

console.log(`\n共 ${assertions} 项断言，失败 ${failures} 项`);
console.log(failures === 0 ? '✅ 渲染/交互全部通过' : '❌ 有失败项');
process.exit(failures === 0 ? 0 : 1);
