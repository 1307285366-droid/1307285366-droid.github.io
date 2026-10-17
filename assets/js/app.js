/* 应用层：状态、路由、事件、计时、账号、错题本记账 */
(function (global) {
  'use strict';

  var U = global.U;
  var Store = global.Store;
  var Auth = global.Auth;
  var Quiz = global.Quiz;
  var UI = global.UI;
  var Support = global.Support;

  var state = adoptRounds(Store.load(Auth.ownerKey()));
  var appEl = null;
  var tick = null;
  var suppressHash = false;
  var toastEl = null;
  var toastTimer = null;
  var authMode = 'register';
  var chat = [];

  var VIEWS = ['banks', 'bank', 'quiz', 'result', 'wrong', 'favorites', 'me', 'stats', 'history', 'support', 'settings', 'auth'];

  /* ---------- 多轮次存档 ----------
     一轮练习 = state.rounds 里的一个对象，各有自己的 id、题目快照、每题作答、
     进度（index）和计时。新开一轮只是 push 一个新对象，旧的一轮原地不动，
     所以“原先一轮的成绩 / 每题记录 / 进度”天然就被保留了下来。 */
  function roundIndex(list, id) {
    for (var i = 0; i < list.length; i += 1) { if (list[i].id === id) return i; }
    return -1;
  }

  function findRound(s, id) {
    if (!s || !id) return null;
    var i = roundIndex(s.rounds || [], id);
    return i >= 0 ? s.rounds[i] : null;
  }

  /**
   * 把 state.session 做成一个“活的访问器”：
   *   读 state.session  → 当前这一轮（currentRoundId 指向的那个对象，引用而非拷贝）
   *   写 state.session  → 新开一轮（入册 + 设为当前）
   *
   * 它是 non-enumerable 的，所以 JSON.stringify 不会把它再存一份：
   * 磁盘上永远只有 rounds 这一份数据，不会把同一轮存两遍。
   * 好处是原来满地方写的 state.session 一行都不用改，依旧是对的。
   */
  function adoptRounds(s) {
    var d = Object.getOwnPropertyDescriptor(s, 'session');
    if (d && d.get) return s;
    if (!Array.isArray(s.rounds)) s.rounds = [];
    if (typeof s.currentRoundId !== 'string') s.currentRoundId = null;
    Object.defineProperty(s, 'session', {
      enumerable: false,
      configurable: true,
      get: function () { return findRound(s, s.currentRoundId); },
      set: function (v) {
        if (!v) { s.currentRoundId = null; return; }
        var i = roundIndex(s.rounds, v.id);
        if (i >= 0) s.rounds[i] = v; else s.rounds.push(v);
        s.currentRoundId = v.id;
      },
    });
    return s;
  }

  /** 轮次太多时丢最旧的（当前这一轮永远保留） */
  function pruneRounds() {
    if (state.rounds.length <= Store.MAX_ROUNDS) return;
    var keep = [];
    for (var i = state.rounds.length - 1; i >= 0; i -= 1) {
      var r = state.rounds[i];
      if (r.id === state.currentRoundId || keep.length < Store.MAX_ROUNDS - 1) keep.unshift(r);
    }
    state.rounds = keep;
  }

  /* ---------- 基础 ---------- */
  function save() { pruneRounds(); Store.save(state, Auth.ownerKey()); }

  function setView(view) {
    if (view === 'quiz' && (!state.session || state.session.finished || !state.session.questionIds.length)) view = 'banks';
    if (view === 'result' && !state.session) view = 'banks';
    if (view === 'bank' && !Quiz.bankById(state.bankId)) view = 'banks';
    state.view = view;
    save();
    render();
    if (view === 'quiz') startTimer(); else stopTimer();
  }

  function render() {
    if (!appEl) appEl = U.byId('app');
    var view = state.view;
    var me = Auth.current();
    var body;

    if (view === 'bank') body = UI.bankDetail(state);
    else if (view === 'quiz') body = UI.quiz(state);
    else if (view === 'result') body = UI.result(state);
    else if (view === 'wrong') body = UI.wrongBook(state);
    else if (view === 'favorites') body = UI.favorites(state);
    else if (view === 'me') body = UI.me(state, me);
    else if (view === 'stats') body = UI.statsView(state);
    else if (view === 'history') body = UI.historyView(state);
    else if (view === 'support') body = UI.supportView(chat);
    else if (view === 'settings') body = UI.settingsView(state, me);
    else if (view === 'auth') body = UI.authView(authMode);
    else body = UI.banks(state);

    appEl.className = 'app' + (state.settings && state.settings.bigFont ? ' big-font' : '');
    appEl.innerHTML = body + UI.tabbar(state);
    syncHash();
    updateTimerLabel();
  }

  /* ---------- 计时 ---------- */
  function startTimer() {
    stopTimer();
    tick = setInterval(function () {
      if (state.view !== 'quiz' || !state.session || state.session.finished) return;
      state.session.elapsedMs += 1000;
      updateTimerLabel();
      if (state.session.elapsedMs % 5000 === 0) save();
    }, 1000);
  }
  function stopTimer() { if (tick) { clearInterval(tick); tick = null; } }
  function updateTimerLabel() {
    var el = U.byId('timer');
    if (el && state.session) el.textContent = '⏱ ' + U.fmtDuration(state.session.elapsedMs);
  }

  /* ---------- 会话 ---------- */

  /**
   * 找“要拿去重做的那一轮”，优先级：
   *   1. 调用方指定的轮次（测试记录里点某一轮的「错题重做」）；
   *   2. 当前这一轮；
   *   3. 当前这轮没错题，就往前找最近一轮有错题的。
   */
  function sourceRound(explicitId) {
    if (explicitId) return findRound(state, explicitId);
    var cur = state.session;
    if (cur && Quiz.wrongQuestionIds(cur).length) return cur;
    for (var i = state.rounds.length - 1; i >= 0; i -= 1) {
      if (Quiz.wrongQuestionIds(state.rounds[i]).length) return state.rounds[i];
    }
    return cur;
  }

  /** “这一轮共几题 / 已答几题 / 错几题”，给按钮文案用 */
  function roundWrongCount(round) {
    return round ? Quiz.wrongQuestionIds(round).length : 0;
  }

  function startSession(opts) {
    if (!opts.questionIds || !opts.questionIds.length) { toast('这个范围里没有题目'); return; }
    // 赋给 state.session 就会新开一轮（旧的那一轮原地保留）
    state.session = Quiz.createSession(opts);
    state.view = 'quiz';
    // 建轮次的同时就写一条记录：这样“轮次”和“记录”一一对应，
    // 一开练就能在「测试记录」里看到它（哪怕一道都还没答），不会丢。
    upsertHistory(false);
    save();
    render();
    startTimer();
  }

  function finishSession() {
    var s = state.session;
    if (!s) return;
    s.finished = true;
    s.finishedAt = Date.now();
    upsertHistory(true);
    state.view = 'result';
    stopTimer();
    save();
    render();
  }

  /**
   * 写入 / 更新测试记录。
   * 每答一题就调一次（finished=false），所以**没做完也会计入答题记录**；
   * 交卷时再调一次把 finished 置为 true，同一个会话只占一条记录。
   */
  function upsertHistory(finished) {
    var s = state.session;
    if (!s) return;
    var rec = Quiz.recordOf(s, finished);
    var idx = -1;
    for (var i = 0; i < state.history.length; i += 1) {
      if (state.history[i].id === rec.id) { idx = i; break; }
    }
    if (idx >= 0) state.history.splice(idx, 1);
    state.history.unshift(rec);
    if (state.history.length > 100) state.history.length = 100;
    state.lastResult = rec;
  }

  /**
   * 提交后记账：已练记录 / 累计 / 错题本 / 测试记录。
   * 规则：
   *   - 已练记录（用于正确率）总是被新结果覆盖；
   *   - 错题本**只增不减**，不会因为一次答对就自动消失，只能手动移出；
   *   - 重刷模式（mode === 'redo'）完全不碰错题本。
   */
  function accountAnswer(qid, rec) {
    var entry = Quiz.questionById(qid);
    if (!entry || !rec) return;
    var s = state.session;
    var redo = Boolean(s && s.mode === 'redo');

    if (!entry.q.invalid) {
      state.done[qid] = rec.correct ? 1 : 0;   // 重刷时新结果直接覆盖旧结果
      state.totals.answered += 1;
      if (rec.correct) {
        state.totals.correct += 1;
        if (redo) toast('答对了，已覆盖原来的记录');
        else if (s && s.scopeType === 'wrong') toast('答对了，可点「已掌握，移出」清掉它');
        else toast('答对了');
      } else if (redo) {
        toast('答错了，记录已更新（错题本不变）');
      } else {
        var w = state.wrong[qid] || (state.wrong[qid] = { times: 0, at: 0 });
        w.times += 1;
        w.at = Date.now();
        toast('答错了，已收进错题本');
      }
    }
    upsertHistory(false);
  }

  /* ---------- 账号 ---------- */
  function inputValue(id) {
    var el = U.byId(id);
    return el && typeof el.value === 'string' ? el.value : '';
  }

  function authError(message) {
    var el = U.byId('authError');
    if (el) el.textContent = message || '';
  }

  function enterAccount(owner, message) {
    stopTimer();
    state = adoptRounds(Store.load(owner));
    state.view = 'me';
    save();
    render();
    toast(message || ('已登录：' + Auth.current().nickname));
  }

  function switchToGuest() {
    stopTimer();
    Auth.logout();
    state = adoptRounds(Store.load('guest'));
    state.view = 'me';
    save();
    render();
    toast('已退出登录，当前是游客身份');
  }

  /* ---------- 分享 ---------- */
  function share() {
    var s = state.session;
    if (!s) return;
    var st = Quiz.stats(s);
    say('我在「狂k重点 · ' + s.title + (s.scopeLabel ? ' · ' + s.scopeLabel : '') + '」答对 '
      + st.correct + '/' + st.valid + '，正确率 ' + st.accuracy + '%，用时 ' + U.fmtDuration(s.elapsedMs) + '。');
  }

  function say(text) {
    if (global.navigator && global.navigator.share) {
      global.navigator.share({ title: '狂k重点', text: text }).catch(function () { /* 用户取消 */ });
      return;
    }
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(
        function () { toast('成绩已复制，去黏给室友吧'); },
        function () { fallbackCopy(text); }
      );
      return;
    }
    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      toast('成绩已复制');
    } catch (err) { toast(text); }
  }

  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1900);
  }

  /* ---------- 路由 ---------- */
  function syncHash() {
    var want = '#/' + (state.view || 'banks') + (state.view === 'bank' && state.bankId ? '/' + state.bankId : '');
    if (global.location.hash !== want) {
      suppressHash = true;
      global.location.hash = want;
      setTimeout(function () { suppressHash = false; }, 0);
    }
  }

  function onHashChange() {
    if (suppressHash) return;
    var parts = (global.location.hash || '').replace(/^#\/?/, '').split('/');
    var view = parts[0] || 'banks';
    if (VIEWS.indexOf(view) < 0) view = 'banks';
    if (view === 'bank') {
      if (Quiz.bankById(parts[1])) state.bankId = parts[1];
      else view = 'banks';
    }
    setView(view);
  }

  /* ---------- 智能客服 ---------- */
  function seedChat() {
    chat = [{ role: 'bot', text: '你好，我是狂k重点的客服助手。常见问题点下面，或者直接把问题打出来。' }];
  }
  function pushChat(role, text) { chat.push({ role: role, text: text }); }
  function afterChat() {
    render();
    try {
      var box = document.querySelector('.chat');
      if (box && typeof box.scrollIntoView === 'function') box.scrollIntoView(false);
    } catch (err) { /* ignore */ }
  }

  /* ---------- 事件 ---------- */
  function onClick(event) {
    var el = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    var s = state.session;
    var qid;

    switch (action) {
      case 'go':
        setView(el.getAttribute('data-view'));
        return;

      case 'open-bank':
        state.bankId = el.getAttribute('data-bank');
        setView('bank');
        return;

      case 'quit':
        setView('banks');
        return;

      case 'resume':
        setView('quiz');
        return;

      /* ---- 打开以前某一轮：从测试记录点回来，内容原样保留 ---- */
      case 'open-round': {
        var wantId = el.getAttribute('data-round');
        var round = findRound(state, wantId);
        if (!round) { toast('这一轮的记录已经不在了'); return; }
        state.currentRoundId = round.id;
        save();
        setView(round.finished ? 'result' : 'quiz');
        return;
      }

      case 'discard': {
        // “放弃” = 真的丢掉这一轮（连它占的测试记录一起删），已交卷的历史轮次不受影响
        var dropId = state.currentRoundId;
        if (dropId) {
          state.rounds = state.rounds.filter(function (r) { return r.id !== dropId; });
          state.history = state.history.filter(function (h) { return h.id !== dropId; });
        }
        state.currentRoundId = null;
        save();
        render();
        toast('已放弃这次练习');
        return;
      }

      /* ---- 开练 ---- */
      case 'start-all': {
        var bankA = Quiz.bankById(el.getAttribute('data-bank'));
        if (!bankA) return;
        startSession({
          title: bankA.title,
          scopeLabel: '全部',
          scopeType: 'all',
          bankId: bankA.id,
          questionIds: Quiz.collectIds(bankA, { type: 'all' }),
        });
        return;
      }

      case 'start-chapter': {
        var bankC = Quiz.bankById(el.getAttribute('data-bank'));
        if (!bankC) return;
        var chapterId = el.getAttribute('data-chapter');
        var chapter = Quiz.chapterById(bankC, chapterId);
        if (!chapter) return;
        startSession({
          title: bankC.title,
          scopeLabel: chapter.title,
          scopeType: 'chapter',
          bankId: bankC.id,
          chapterIds: [chapterId],
          questionIds: Quiz.collectIds(bankC, { type: 'chapter', chapterId: chapterId }),
        });
        return;
      }

      case 'start-favorites': {
        var bankF = Quiz.bankById(el.getAttribute('data-bank'));
        if (!bankF) return;
        var favs = (state.favorites[bankF.id] || []).slice();
        if (!favs.length) { toast('收藏夹还是空的'); return; }
        startSession({
          title: bankF.title,
          scopeLabel: '收藏',
          scopeType: 'favorites',
          bankId: bankF.id,
          questionIds: Quiz.collectIds(bankF, { type: 'favorites', favoriteIds: favs }),
        });
        return;
      }

      case 'start-wrong-type': {
        var type = el.getAttribute('data-type');
        var groups = Quiz.wrongByType(state.wrong);
        var items = groups[type] || [];
        if (!items.length) { toast('这一类没有错题了'); return; }
        startSession({
          title: '错题本',
          scopeLabel: { single: '单选题', multiple: '多选题', judge: '判断题' }[type] || '',
          scopeType: 'wrong',
          questionIds: items.map(function (it) { return it.q.id; }),
        });
        return;
      }

      /* ---- 重刷做过的题：新结果覆盖旧的，但不动错题本 ---- */
      case 'redo-done': {
        var bankIdAttr = el.getAttribute('data-bank');
        var bankR = bankIdAttr ? Quiz.bankById(bankIdAttr) : null;
        var pool = bankR
          ? Quiz.allQuestions(bankR)
          : Quiz.banks().reduce(function (acc, b) { return acc.concat(Quiz.allQuestions(b)); }, []);
        var doneIds = pool.filter(function (q) { return state.done && (q.id in state.done); })
          .map(function (q) { return q.id; });
        if (!doneIds.length) { toast('还没有做过的题'); return; }
        startSession({
          title: bankR ? bankR.title : '全部题库',
          scopeLabel: '重刷做过的 ' + doneIds.length + ' 题',
          scopeType: 'ids',
          mode: 'redo',
          origin: 'redo',
          bankId: bankR ? bankR.id : null,
          questionIds: doneIds,
        });
        return;
      }

      /* ---- 错题重做：把“这一轮没做对的题”抽出来，组成一轮全新的练习。
              原轮次原封不动地留在 rounds 里：成绩、每题作答、进度都不变，
              随时能从「测试记录」点回去打开。新的一轮是完全独立的记录。 ---- */
      case 'redo-wrong': {
        var src = sourceRound(el.getAttribute('data-round'));
        if (!src) { toast('还没有可以重做的轮次'); return; }
        var wrongIds = Quiz.wrongQuestionIds(src);
        if (!wrongIds.length) { toast('这一轮里没有做错的题'); return; }
        startSession({
          title: src.title,
          scopeLabel: '错题重做 · ' + wrongIds.length + ' 题',
          scopeType: 'wrong',
          bankId: src.bankId,
          parentId: src.id,
          origin: 'wrong-redo',
          questionIds: wrongIds,
        });
        toast('已抽出 ' + wrongIds.length + ' 道错题，开了一轮新的（原来的那轮还在）');
        return;
      }

      /* ---- 答题 ---- */
      case 'pick': {
        if (!s) return;
        qid = s.questionIds[s.index];
        var rec = s.answers[qid];
        if (rec && rec.submitted) return;
        var entry = Quiz.questionById(qid);
        var key = el.getAttribute('data-key');
        var current = s.draft[qid] || [];
        if (entry.q.type === 'multiple') {
          current = current.indexOf(key) >= 0
            ? current.filter(function (k) { return k !== key; })
            : current.concat(key);
        } else {
          current = [key];
        }
        s.draft[qid] = current;
        save();
        render();
        return;
      }

      case 'submit': {
        if (!s) return;
        qid = s.questionIds[s.index];
        var prev = s.answers[qid];
        if (prev && prev.submitted) { toast('本题已经提交过，成绩不会重复计算'); return; }
        var picked = s.draft[qid] || [];
        if (!picked.length) { toast('先选一个答案再提交'); return; }
        var record = Quiz.submit(s, qid, picked);
        accountAnswer(qid, record);
        save();
        render();
        return;
      }

      case 'prev':
        if (s && s.index > 0) { s.index -= 1; save(); render(); }
        return;

      case 'next':
        if (s && s.index < s.questionIds.length - 1) { s.index += 1; save(); render(); }
        return;

      case 'finish':
        finishSession();
        return;

      case 'finish-to-wrong':
        setView('wrong');
        return;

      case 'star': {
        if (!s) return;
        qid = s.questionIds[s.index];
        var hit = Quiz.questionById(qid);
        if (!hit) return;
        var list = state.favorites[hit.bank.id] || (state.favorites[hit.bank.id] = []);
        var i = list.indexOf(qid);
        if (i >= 0) { list.splice(i, 1); toast('已取消收藏'); } else { list.push(qid); toast('已加入收藏'); }
        save();
        render();
        return;
      }

      case 'unstar': {
        var bId = el.getAttribute('data-bank');
        var target = el.getAttribute('data-qid');
        var favList = state.favorites[bId] || [];
        var idx = favList.indexOf(target);
        if (idx >= 0) favList.splice(idx, 1);
        save();
        render();
        return;
      }

      /* ---- 错题本 ---- */
      case 'remove-wrong': {
        qid = el.getAttribute('data-qid');
        if (state.wrong[qid]) {
          delete state.wrong[qid];
          save();
          render();
          toast('已移出错题本');
        }
        return;
      }

      case 'clear-wrong':
        if (!global.confirm('确定清空整个错题本吗？这个操作不能撤销。')) return;
        state.wrong = {};
        save();
        render();
        toast('错题本已清空');
        return;

      case 'clear-history':
        if (!global.confirm('确定清空测试记录吗？每一轮的详细作答也会一起删掉（当前这一轮会留下）。')) return;
        state.history = [];
        state.rounds = state.rounds.filter(function (r) { return r.id === state.currentRoundId; });
        save();
        render();
        toast('测试记录已清空');
        return;

      /* ---- 结果页 ---- */
      case 'retry-all': {
        if (!s) return;
        startSession({
          title: s.title,
          scopeLabel: '重刷 · ' + s.scopeLabel,
          scopeType: s.scopeType,
          mode: 'redo',
          origin: 'redo',
          parentId: s.id,
          bankId: s.bankId,
          chapterIds: s.chapterIds,
          questionIds: s.questionIds.slice(),
        });
        return;
      }

      /* ---- 账号 ---- */
      case 'auth-mode':
        authMode = el.getAttribute('data-mode') === 'login' ? 'login' : 'register';
        render();
        return;

      case 'send-code': {
        var res = Auth.sendCode(inputValue('authPhone'));
        authError(res.ok ? '' : res.error);
        var hint = U.byId('codeHint');
        if (hint) hint.textContent = res.ok ? ('演示验证码：' + res.code + '（10 分钟内有效）') : '';
        return;
      }

      case 'do-register': {
        var reg = Auth.register({
          phone: inputValue('authPhone'),
          code: inputValue('authCode'),
          password: inputValue('authPass'),
          nickname: inputValue('authNick'),
        });
        if (!reg.ok) { authError(reg.error); return; }
        var newOwner = Auth.ownerKey();
        var migrated = !Store.has(newOwner) && Store.has('guest');
        if (migrated) Store.copy('guest', newOwner);
        enterAccount(newOwner, '注册成功，欢迎 ' + reg.account.nickname + (migrated ? '（游客进度已带过来）' : ''));
        return;
      }

      case 'do-login': {
        var log = Auth.login({ phone: inputValue('authPhone'), password: inputValue('authPass') });
        if (!log.ok) { authError(log.error); return; }
        enterAccount(Auth.ownerKey(), '登录成功，欢迎 ' + log.account.nickname);
        return;
      }

      case 'logout':
        switchToGuest();
        return;

      /* ---- 设置 ---- */
      case 'toggle-setting': {
        var skey = el.getAttribute('data-key');
        if (!state.settings || typeof state.settings[skey] !== 'boolean') return;
        state.settings[skey] = !state.settings[skey];
        save();
        render();
        toast(state.settings[skey] ? '已开启' : '已关闭');
        return;
      }

      case 'reset-all':
        if (!global.confirm('确定清空当前身份的所有本地数据吗？（收藏、错题本、记录、每一轮的进度都会没）')) return;
        Store.clear(Auth.ownerKey());
        state = adoptRounds(Store.defaults());
        save();
        render();
        toast('已清空');
        return;

      /* ---- 智能客服 ---- */
      case 'ask-faq': {
        var question = el.getAttribute('data-q');
        var answer = Support.byQuestion(question);
        pushChat('me', question);
        pushChat('bot', answer.a);
        afterChat();
        return;
      }

      case 'ask-send': {
        var text = inputValue('askInput');
        if (!text.trim()) { toast('先输入一个问题'); return; }
        var reply = Support.ask(text);
        pushChat('me', reply.q);
        pushChat('bot', reply.a);
        var box = U.byId('askInput');
        if (box) box.value = '';
        afterChat();
        return;
      }

      /* ---- 分享 ---- */
      case 'share':
        share();
        return;
    }
  }

  /* ---------- 启动 ---------- */
  function init() {
    appEl = U.byId('app');

    if (!global.__BANKS__ || !(global.__BANKS__.banks || []).length) {
      appEl.innerHTML = '<div class="empty">没有加载到题库。<br>请确认 <code>data/banks.js</code> 与本页面在同一目录下。</div>';
      return;
    }

    var parts = (global.location.hash || '').replace(/^#\/?/, '').split('/');
    var hashView = parts[0];
    if (VIEWS.indexOf(hashView) >= 0) state.view = hashView;
    if (hashView === 'bank' && Quiz.bankById(parts[1])) state.bankId = parts[1];
    if (state.view === 'quiz' && (!state.session || state.session.finished)) state.view = 'banks';
    if (state.view === 'result' && !state.session) state.view = 'banks';
    if (state.view === 'bank' && !Quiz.bankById(state.bankId)) state.view = 'banks';
    if (VIEWS.indexOf(state.view) < 0) state.view = 'banks';

    seedChat();
    document.addEventListener('click', onClick);
    global.addEventListener('hashchange', onHashChange);
    global.addEventListener('beforeunload', function () { if (state.session) save(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && state.session) save(); });

    render();
    if (state.view === 'quiz') startTimer();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
