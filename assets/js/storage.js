/* 本地持久化：按身份（游客 / 各账号）分开存，互不干扰。
   每个身份一份数据：收藏、错题本、已练记录、测试记录、设置、进行中的会话。 */
(function (global) {
  'use strict';

  var PREFIX = 'quizmvp.v1';
  var LEGACY_KEY = 'quizmvp.v1';   // 早期版本只有一个全局 key，做一次迁移
  var VERSION = 3;

  function dataKey(owner) { return PREFIX + '.' + (owner || 'guest'); }

  function defaults() {
    return {
      version: VERSION,
      view: 'banks',      // 由 app.js 的路由维护
      bankId: null,       // 当前打开的题库
      favorites: {},      // { [bankId]: string[] }
      wrong: {},          // 错题本 { [qid]: { times, at } }
      done: {},           // 做过的题 { [qid]: 1 答对 / 0 答错 }（最后一次结果）
      totals: { answered: 0, correct: 0 }, // 累计提交次数 / 答对次数
      history: [],        // 测试记录（最近的在前）
      settings: { showTimer: true, bigFont: false },
      session: null,      // 进行中 / 刚结束的会话
      lastResult: null,
    };
  }

  function normalize(state) {
    var out = Object.assign(defaults(), state || {});
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
    dataKey: dataKey,
    defaults: defaults,
    normalize: normalize,
    has: has,
    load: load,
    save: save,
    clear: clear,
    copy: copy,
  };
})(window);
