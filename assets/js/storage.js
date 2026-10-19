/* 本地持久化：按身份（游客 / 各账号）分开存，互不干扰。
   每个身份一份数据：收藏、错题本、已练记录、测试记录、设置，
   以及**每一轮练习的独立存档**（rounds）。
   一轮就是一个独立的记录：新开一轮不会覆盖旧的那一轮，
   旧轮的成绩 / 每题作答 / 进度都原样留着，随时可以回去打开。 */
(function (global) {
  'use strict';

  var PREFIX = 'quizmvp.v1';
  var LEGACY_KEY = 'quizmvp.v1';   // 早期版本只有一个全局 key，做一次迁移
  var VERSION = 4;
  var MAX_ROUNDS = 50;             // 轮次上限，超出丢最旧的（当前这一轮永远保留）

  function dataKey(owner) { return PREFIX + '.' + (owner || 'guest'); }

  function defaults() {
    return {
      version: VERSION,
      view: 'banks',      // 由 app.js 的路由维护
      bankId: null,       // 当前打开的题库
      favorites: {},      // { [bankId]: string[] }
      wrong: {},          // 错题本 { [qid]: { times, at, right } }（right = 累计答对次数，满 2 自动移出）
      done: {},           // 做过的题 { [qid]: 1 答对 / 0 答错 }（最后一次结果）
      totals: { answered: 0, correct: 0 }, // 累计提交次数 / 答对次数
      history: [],        // 测试记录（最近的在前）
      settings: { showTimer: true, bigFont: false },
      rounds: [],         // 每一轮练习的独立存档（按开始时间先后）
      currentRoundId: null, // 当前打开的是哪一轮
      lastResult: null,
    };
  }

  /** 一轮练习的字段补全；坏掉的轮次直接丢掉，不留半截数据 */
  function normalizeRound(r) {
    if (!r || typeof r !== 'object') return null;
    if (typeof r.id !== 'string' || !r.id) return null;
    if (!Array.isArray(r.questionIds) || !r.questionIds.length) return null;
    r.answers = (r.answers && typeof r.answers === 'object') ? r.answers : {};
    r.draft = (r.draft && typeof r.draft === 'object') ? r.draft : {};
    if (typeof r.index !== 'number' || r.index < 0 || r.index >= r.questionIds.length) r.index = 0;
    if (typeof r.elapsedMs !== 'number' || r.elapsedMs < 0) r.elapsedMs = 0;
    if (typeof r.startedAt !== 'number') r.startedAt = Date.now();
    if (typeof r.title !== 'string') r.title = '练习';
    if (typeof r.scopeLabel !== 'string') r.scopeLabel = '';
    if (typeof r.scopeType !== 'string') r.scopeType = 'all';
    if (typeof r.mode !== 'string') r.mode = 'practice';
    if (typeof r.origin !== 'string') r.origin = '';
    if (typeof r.parentId !== 'string') r.parentId = null;
    r.questionIds = r.questionIds.filter(function (id) { return typeof id === 'string'; });
    if (!r.questionIds.length) return null;
    r.finished = Boolean(r.finished);
    return r;
  }

  function normalize(state) {
    var src = state || {};
    var out = Object.assign(defaults(), src);
    if (!out.favorites || typeof out.favorites !== 'object') out.favorites = {};
    if (!out.wrong || typeof out.wrong !== 'object') out.wrong = {};
    if (!out.done || typeof out.done !== 'object') out.done = {};
    if (!Array.isArray(out.history)) out.history = [];
    if (!out.totals || typeof out.totals !== 'object') out.totals = { answered: 0, correct: 0 };
    if (typeof out.totals.answered !== 'number') out.totals.answered = 0;
    if (typeof out.totals.correct !== 'number') out.totals.correct = 0;
    if (!out.settings || typeof out.settings !== 'object') out.settings = { showTimer: true, bigFont: false };
    if (typeof out.settings.showTimer !== 'boolean') out.settings.showTimer = true;
    if (typeof out.settings.bigFont !== 'boolean') out.settings.bigFont = false;
    if (typeof out.view !== 'string' || !out.view) out.view = 'banks';

    if (!Array.isArray(out.rounds)) out.rounds = [];
    out.rounds = out.rounds.map(normalizeRound).filter(Boolean);

    // v3 及以前只有一个 session 字段，迁移成“第一轮”（只迁一次）
    if (src.session && typeof src.session === 'object') {
      var migrated = normalizeRound(src.session);
      if (migrated && !out.rounds.some(function (r) { return r.id === migrated.id; })) {
        out.rounds.push(migrated);
        out.currentRoundId = migrated.id;
      }
    }
    delete out.session;   // 磁盘上只留 rounds 这一份，不把同一轮存两遍

    if (typeof out.currentRoundId !== 'string' ||
        !out.rounds.some(function (r) { return r.id === out.currentRoundId; })) {
      out.currentRoundId = out.rounds.length ? out.rounds[out.rounds.length - 1].id : null;
    }
    return out;
  }

  function has(owner) {
    try { return global.localStorage.getItem(dataKey(owner)) !== null; }
    catch (err) { return false; }
  }

  function load(owner) {
    var key = dataKey(owner);
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw && (owner === 'guest' || !owner)) {
        // 从早期版本的单一 key 迁移过来（只迁一次）
        var legacy = global.localStorage.getItem(LEGACY_KEY);
        if (legacy && LEGACY_KEY !== key) {
          global.localStorage.setItem(key, legacy);
          raw = legacy;
        }
      }
      if (!raw) return defaults();
      return normalize(JSON.parse(raw));
    } catch (err) {
      console.warn('[store] 读取本地进度失败，已重置：', err);
      return defaults();
    }
  }

  function save(state, owner) {
    try { global.localStorage.setItem(dataKey(owner), JSON.stringify(state)); return true; }
    catch (err) { console.warn('[store] 保存本地进度失败：', err); return false; }
  }

  function clear(owner) {
    try { global.localStorage.removeItem(dataKey(owner)); } catch (err) { /* ignore */ }
  }

  /** 把某个身份的数据整体复制给另一个身份（注册时把游客进度带过去） */
  function copy(fromOwner, toOwner) {
    return save(load(fromOwner), toOwner);
  }

  global.Store = {
    PREFIX: PREFIX,
    VERSION: VERSION,
    MAX_ROUNDS: MAX_ROUNDS,
    dataKey: dataKey,
    defaults: defaults,
    normalize: normalize,
    normalizeRound: normalizeRound,
    has: has,
    load: load,
    save: save,
    clear: clear,
    copy: copy,
  };
})(window);
