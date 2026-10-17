/* 答题核心逻辑：题库索引、组卷、判分、统计、错题本。
   这是全站唯一“判分/成绩”来源，页面只负责展示，避免同一规则写两遍。

   设计要点：会话（session）里只存“题目 id 列表”，不绑定某一个题库。
   这样“错题本”就可以把 Web / Java / 原型 三个题库的错题混在一起练。 */
(function (global) {
  'use strict';

  var U = global.U;
  var index = null; // questionId -> { q, bank, chapter }

  function payload() {
    return global.__BANKS__ || { banks: [] };
  }

  function banks() {
    return payload().banks || [];
  }

  function bankById(id) {
    return banks().filter(function (b) { return b.id === id; })[0] || null;
  }

  function buildIndex() {
    index = {};
    banks().forEach(function (bank) {
      bank.chapters.forEach(function (chapter) {
        chapter.questions.forEach(function (q) {
          index[q.id] = { q: q, bank: bank, chapter: chapter };
        });
      });
    });
  }

  function questionById(id) {
    if (!index) buildIndex();
    return index[id] || null;
  }

  function allQuestions(bank) {
    var out = [];
    if (!bank) return out;
    bank.chapters.forEach(function (c) { out = out.concat(c.questions); });
    return out;
  }

  function chapterById(bank, chapterId) {
    if (!bank) return null;
    return bank.chapters.filter(function (c) { return c.id === chapterId; })[0] || null;
  }

  function idsOf(list) {
    return list.map(function (q) { return q.id; });
  }

  /** 把若干题目 id 换成 {q, bank, chapter}，保持传入顺序，跳过不存在的 id */
  function entriesByIds(ids) {
    return (ids || []).map(function (id) { return questionById(id); }).filter(Boolean);
  }

  /** 某个题库里被做过（提交过）的题目数量，用于题库进度 / 重刷入口
      注意：done[qid] 是 1（答对）或 0（答错），答错也算做过，
      所以必须用 `in` 判断，不能用真假值。 */
  function doneCount(bank, done) {
    var n = 0;
    if (!done) return 0;
    allQuestions(bank).forEach(function (q) { if (q.id in done) n += 1; });
    return n;
  }

  /** 题型分布，用于章节 / 题库列表展示 */
  function typeCounts(questions) {
    var out = { single: 0, multiple: 0, judge: 0 };
    (questions || []).forEach(function (q) { out[q.type] = (out[q.type] || 0) + 1; });
    return out;
  }

  /**
   * 已练统计：done 是 { [qid]: 1 答对 / 0 答错 }（只记最后一次）。
   * 用于「统计分析」的按题库 / 按题型 / 按章节正确率。
   */
  function doneStats(questions, done) {
    var out = { total: (questions || []).length, answered: 0, correct: 0, wrong: 0, accuracy: 0 };
    (questions || []).forEach(function (q) {
      if (!done || !(q.id in done)) return;
      out.answered += 1;
      if (done[q.id]) out.correct += 1; else out.wrong += 1;
    });
    out.accuracy = out.answered ? Math.round((out.correct / out.answered) * 100) : 0;
    return out;
  }

  /* ---------------- 组卷 ---------------- */

  /**
   * 组卷范围 -> 题目 id 列表（保持原题库顺序，不改变题库内容）
   * scope 形如：
   *   { type: 'all' }
   *   { type: 'chapter', chapterId }
   *   { type: 'chapters', chapterIds: [] }
   *   { type: 'favorites', favoriteIds: [] }
   *   { type: 'ids', ids: [] }
   */
  function collectIds(bank, scope) {
    scope = scope || { type: 'all' };
    if (scope.type === 'ids') return (scope.ids || []).slice();
    if (scope.type === 'chapter') {
      var one = chapterById(bank, scope.chapterId);
      return one ? idsOf(one.questions) : [];
    }
    if (scope.type === 'chapters') {
      var wanted = {};
      (scope.chapterIds || []).forEach(function (id) { wanted[id] = true; });
      return idsOf(bank.chapters
        .filter(function (c) { return wanted[c.id]; })
        .reduce(function (acc, c) { return acc.concat(c.questions); }, []));
    }
    if (scope.type === 'favorites') {
      var fav = {};
      (scope.favoriteIds || []).forEach(function (id) { fav[id] = true; });
      return idsOf(allQuestions(bank).filter(function (q) { return fav[q.id]; }));
    }
    return idsOf(allQuestions(bank));
  }

  /** 组卷：把题目 id 快照进会话，之后即使题库变化也不影响本次作答 */
  function createSession(opts) {
    opts = opts || {};
    return {
      id: U.uid(),
      title: opts.title || '练习',
      scopeLabel: opts.scopeLabel || '',
      scopeType: opts.scopeType || 'all',
      // practice = 普通练习（做错会进错题本）
      // redo    = 重刷做过的题（新结果覆盖旧的，但不动错题本）
      mode: opts.mode === 'redo' ? 'redo' : 'practice',
      bankId: opts.bankId || null,
      chapterIds: opts.chapterIds || [],
      questionIds: (opts.questionIds || []).slice(),
      index: 0,
      answers: {},   // qid -> { picked, submitted, correct, at }
      draft: {},     // qid -> [key...]  未提交时暂存的勾选
      startedAt: Date.now(),
      elapsedMs: 0,
      finished: false,
      finishedAt: null,
    };
  }

  /**
   * 提交答案 —— 成绩幂等的关键：
   * 同一题一旦提交过，后续任何提交请求都被忽略，直接返回第一次的记录，
   * 所以手抖连点“提交”不会让正确率跳变。
   */
  function submit(session, qid, picked) {
    var existing = session.answers[qid];
    if (existing && existing.submitted) return existing;

    var entry = questionById(qid);
    if (!entry) return null;

    var record = {
      picked: Array.from(new Set(picked || [])).sort(),
      submitted: true,
      // 原题库数据异常的题不计对错（correct = null），从统计中剔除
      correct: entry.q.invalid ? null : U.sameSet(picked, entry.q.answer),
      at: Date.now(),
    };
    session.answers[qid] = record;
    return record;
  }

  function answeredCount(session) {
    return session.questionIds.filter(function (id) {
      var r = session.answers[id];
      return r && r.submitted;
    }).length;
  }

  /** 统一统计口径：仅在“有效题”上计算正确率 */
  function stats(session) {
    var out = { total: session.questionIds.length, valid: 0, invalid: 0, answered: 0, correct: 0, wrong: 0, unanswered: 0, accuracy: 0 };
    session.questionIds.forEach(function (id) {
      var entry = questionById(id);
      if (!entry) return;
      if (entry.q.invalid) { out.invalid += 1; return; }
      out.valid += 1;
      var r = session.answers[id];
      if (r && r.submitted) {
        out.answered += 1;
        if (r.correct) out.correct += 1; else out.wrong += 1;
      }
    });
    out.unanswered = out.valid - out.answered;
    out.accuracy = out.answered ? Math.round((out.correct / out.answered) * 100) : 0;
    return out;
  }

  /** 错题 id（用于“只练错题”），保持原顺序 */
  function wrongQuestionIds(session) {
    return session.questionIds.filter(function (id) {
      var r = session.answers[id];
      return r && r.submitted && r.correct === false;
    });
  }

  function optionKeys(question) {
    return question.options.map(function (o) { return o.key; });
  }

  /* ---------------- 交卷分析 ---------------- */

  /**
   * 对一次会话做“简单分析”：
   *   - 按题型拆对错
   *   - 找出错得最多的章节（薄弱点）
   *   - 给一句人话结论
   * 只统计有效题，且只在“已作答”的题上算正确率，口径与 stats() 一致。
   */
  function analyze(session) {
    var byType = {};
    var chapters = {};

    session.questionIds.forEach(function (id) {
      var entry = questionById(id);
      if (!entry) return;
      var q = entry.q;
      var rec = session.answers[id];
      var answered = !q.invalid && rec && rec.submitted;

      if (!byType[q.type]) byType[q.type] = { total: 0, answered: 0, correct: 0, wrong: 0 };
      byType[q.type].total += 1;
      if (answered) {
        byType[q.type].answered += 1;
        if (rec.correct) byType[q.type].correct += 1; else byType[q.type].wrong += 1;
      }

      if (answered && !rec.correct) {
        var key = entry.bank.id + '|' + entry.chapter.id;
        if (!chapters[key]) {
          chapters[key] = {
            bank: entry.bank.title,
            chapter: entry.chapter.title,
            wrong: 0,
            total: entry.chapter.questions.length,
          };
        }
        chapters[key].wrong += 1;
      }
    });

    var weak = Object.keys(chapters)
      .map(function (k) { return chapters[k]; })
      .sort(function (a, b) { return b.wrong - a.wrong; })
      .slice(0, 3);

    // 最薄弱题型：错得最多、且确实作答过的类型
    var weakestType = null;
    var worst = 0;
    Object.keys(byType).forEach(function (t) {
      var item = byType[t];
      if (item.wrong > worst) { worst = item.wrong; weakestType = t; }
    });

    var st = stats(session);
    var comment;
    if (st.answered === 0) comment = '这次还没作答，先从第一题开始吧。';
    else if (st.accuracy >= 90) comment = '掌握得很好，可以换一章继续了。';
    else if (st.accuracy >= 70) comment = '基本掌握了，把下面几道错题再过一遍就更稳。';
    else if (st.accuracy >= 50) comment = '刚过半，建议先按题型把错题重练一轮，再回来做整套。';
    else comment = '这一块还比较生，先看一遍解析，再用错题本练两轮。';

    return { byType: byType, weak: weak, weakestType: weakestType, comment: comment, stats: st };
  }

  /** 会话 -> 测试记录（未交卷也算，交卷后把 finished 置为 true） */
  function recordOf(session, finished) {
    var st = stats(session);
    return {
      id: session.id,
      title: session.title,
      scopeLabel: session.scopeLabel,
      mode: session.mode || 'practice',
      accuracy: st.accuracy,
      correct: st.correct,
      wrong: st.wrong,
      answered: st.answered,
      unanswered: st.unanswered,
      valid: st.valid,
      invalid: st.invalid,
      total: st.total,
      elapsedMs: session.elapsedMs,
      finished: Boolean(finished),
      at: Date.now(),
    };
  }

  /* ---------------- 错题本 ---------------- */

  /** 题库在首页的展示顺序，用于错题排序（不用字母序，保证和封面一致） */
  function bankOrder(id) {
    var list = banks();
    for (var i = 0; i < list.length; i += 1) { if (list[i].id === id) return i; }
    return 99;
  }

  /**
   * 错题本：{ [qid]: { times, at } }，跨会话累积。
   * 返回按“题库展示顺序 → 原题号”排序的 {q, bank, chapter, times, at} 列表。
   */
  function wrongEntries(book) {
    return Object.keys(book || {})
      .map(function (id) {
        var entry = questionById(id);
        if (!entry || entry.q.invalid) return null;
        var meta = book[id] || {};
        return {
          q: entry.q,
          bank: entry.bank,
          chapter: entry.chapter,
          times: meta.times || 1,
          at: meta.at || 0,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        var d = bankOrder(a.bank.id) - bankOrder(b.bank.id);
        return d !== 0 ? d : a.q.no - b.q.no;
      });
  }

  /** 把错题本按题型分组：{ single: [...], multiple: [...], judge: [...] } */
  function wrongByType(book) {
    var groups = { single: [], multiple: [], judge: [] };
    wrongEntries(book).forEach(function (item) {
      (groups[item.q.type] || (groups[item.q.type] = [])).push(item);
    });
    return groups;
  }

  global.Quiz = {
    banks: banks,
    bankById: bankById,
    questionById: questionById,
    allQuestions: allQuestions,
    chapterById: chapterById,
    entriesByIds: entriesByIds,
    doneCount: doneCount,
    typeCounts: typeCounts,
    doneStats: doneStats,
    bankOrder: bankOrder,
    collectIds: collectIds,
    createSession: createSession,
    submit: submit,
    stats: stats,
    answeredCount: answeredCount,
    wrongQuestionIds: wrongQuestionIds,
    wrongEntries: wrongEntries,
    wrongByType: wrongByType,
    analyze: analyze,
    recordOf: recordOf,
    optionKeys: optionKeys,
  };
})(window);
