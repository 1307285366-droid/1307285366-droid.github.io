/* 视图层：只负责把状态渲染成 HTML 字符串，不修改状态、不判分 */
(function (global) {
  'use strict';

  var U = global.U;
  var esc = U.escapeHtml;
  var TYPE_LABEL = { single: '单选题', multiple: '多选题', judge: '判断题' };
  var TYPE_ORDER = ['single', 'multiple', 'judge'];

  function isFav(state, bankId, qid) {
    var list = (state.favorites && state.favorites[bankId]) || [];
    return list.indexOf(qid) >= 0;
  }

  function typeBadge(type) {
    var cls = type === 'judge' ? 'judge' : (type === 'multiple' ? 'multiple' : '');
    return '<span class="badge ' + cls + '">' + (TYPE_LABEL[type] || '题目') + '</span>';
  }

  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

  /* 内联 SVG 图标：比 emoji 更统一，颜色跟随 currentColor */
  var ICONS = {
    back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
    star: '<path d="M12 3.4l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.93l-5.3 2.78 1.01-5.9L3.42 9.63l5.93-.86z"/>',
    share: '<path d="M7.5 16.5 16.5 7.5"/><path d="M9.5 7.5h7v7"/>',
    chevron: '<path d="M9 5.5 15.5 12 9 18.5"/>',
    chart: '<path d="M4 19.5h16"/><path d="M7 16.5v-4"/><path d="M12 16.5v-8"/><path d="M17 16.5v-5.5"/>',
    clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3.2 1.9"/>',
    redo: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.2h-4.2"/>',
    target: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
    book: '<path d="M4.5 5.8A2.8 2.8 0 0 1 7.3 3H19v14.8H7.3a2.8 2.8 0 0 0-2.8 2.8z"/><path d="M19 17.8v3.2H7.3a2.8 2.8 0 0 1-2.8-2.8"/>',
    chat: '<path d="M20 11.6c0 4.1-3.6 7.4-8 7.4-1 0-2-.2-2.9-.5L4.5 20l1-3.5A7 7 0 0 1 4 11.6C4 7.5 7.6 4.2 12 4.2s8 3.3 8 7.4z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>',
    settings: '<path d="M4 7.5h6"/><path d="M14 7.5h6"/><circle cx="12" cy="7.5" r="2.2"/><path d="M4 16.5h3"/><path d="M11 16.5h9"/><circle cx="9" cy="16.5" r="2.2"/>',
    check: '<path d="M5 12.5l4.6 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
    warn: '<path d="M12 4.4 20.6 19.6H3.4z"/><path d="M12 9.8v4"/><path d="M12 16.4h.01"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  };

  function ic(name) {
    return '<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
      + ' aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }

  function favCount(state) {
    var n = 0;
    Object.keys(state.favorites || {}).forEach(function (k) { n += (state.favorites[k] || []).length; });
    return n;
  }

  function wrongList(state) { return Quiz.wrongEntries(state.wrong); }

  function typeLine(counts) {
    var parts = [];
    if (counts.single) parts.push('单选 ' + counts.single);
    if (counts.multiple) parts.push('多选 ' + counts.multiple);
    if (counts.judge) parts.push('判断 ' + counts.judge);
    return parts.join(' / ');
  }

  function bar(value, text) {
    return '<div class="bar"><i style="width:' + value + '%"></i></div>'
      + '<div class="bar-num">' + (text || (value + '%')) + '</div>';
  }

  function topbar(title, backView, extra) {
    return ''
      + '<div class="topbar">'
      + (backView ? '<button class="icon-btn" data-action="go" data-view="' + backView + '" title="返回" aria-label="返回">' + ic('back') + '</button>' : '')
      + '<div class="title">' + esc(title) + '</div>'
      + '<span class="spacer"></span>'
      + (extra || '')
      + '</div>';
  }

  function fmtWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    function p(n) { return String(n).padStart(2, '0'); }
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ================= 题库（原来的封面） ================= */
  function bankRow(bank, state) {
    var st = bank.stats;
    var done = Quiz.doneCount(bank, state.done);
    var favs = ((state.favorites || {})[bank.id] || []).length;
    return ''
      + '<button class="bank-row" data-action="open-bank" data-bank="' + bank.id + '">'
      + '  <div class="bank-row-head">'
      + '    <span class="bank-row-title">' + esc(bank.title) + '</span>'
      + '    <span class="bank-row-go">' + ic('chevron') + '</span>'
      + '  </div>'
      + '  <div class="meta-line">'
      + '    <span class="tag">' + st.chapters + ' 章 · ' + st.total + ' 题</span>'
      + '    <span class="tag">' + typeLine(st) + '</span>'
      + (st.invalid ? '<span class="tag warn">' + st.invalid + ' 道不计分</span>' : '')
      + (favs ? '<span class="tag fav">' + ic('star') + ' ' + favs + '</span>' : '')
      + '  </div>'
      + '  <div class="bank-bar"><i style="width:' + pct(done, st.valid) + '%"></i></div>'
      + '</button>';
  }

  function banks(state) {
    var html = '<section class="cover">'
      + '<span class="deco deco-a"></span><span class="deco deco-b"></span>'
      + '<h1 class="cover-title">狂k重点</h1>'
      + '<div class="cover-ornament"></div>'
      + '</section>';

    var s = state.session;
    if (s && !s.finished && s.questionIds.length) {
      var st = Quiz.stats(s);
      html += ''
        + '<section class="card stack" style="margin-top:14px">'
        + '  <div class="row"><h2>继续上次练习</h2><span class="spacer"></span><span class="tag">' + ic('clock') + ' ' + U.fmtDuration(s.elapsedMs) + '</span></div>'
        + '  <div>' + esc(s.title) + (s.scopeLabel ? ' · ' + esc(s.scopeLabel) : '')
        + '     · 进度 ' + (s.index + 1) + '/' + s.questionIds.length + ' · 已答对 ' + st.correct + '</div>'
        + '  <div class="actions">'
        + '    <button class="btn btn-primary" data-action="resume">继续答题</button>'
        + '    <button class="btn" data-action="discard">放弃这次</button>'
        + '  </div>'
        + '</section>';
    }

    var list = Quiz.banks();
    if (!list.length) {
      html += '<div class="empty">没有加载到题库，请确认 data/banks.js 是否存在。</div>';
    } else {
      html += '<div class="list" style="margin-top:16px">' + list.map(function (b) { return bankRow(b, state); }).join('') + '</div>';
    }
    return html;
  }

  /* ================= 题库详情（章节细分） ================= */
  function bankDetail(state) {
    var bank = Quiz.bankById(state.bankId);
    if (!bank) return '<div class="empty">题库不存在</div>';
    var st = bank.stats;
    var done = Quiz.doneCount(bank, state.done);
    var favs = ((state.favorites || {})[bank.id] || []).length;

    var html = topbar(bank.title, 'banks');

    html += ''
      + '<section class="card stack">'
      + '  <div class="meta-line" style="margin-top:0">'
      + '    <span class="tag">' + st.chapters + ' 章 · ' + st.total + ' 题</span>'
      + '    <span class="tag">' + typeLine(st) + '</span>'
      + (st.invalid ? '<span class="tag warn">' + st.invalid + ' 道数据异常，不计分</span>' : '')
      + '  </div>'
      + '  <div class="bank-bar"><i style="width:' + pct(done, st.valid) + '%"></i></div>'
      + '  <div class="actions">'
      + '    <button class="btn btn-primary" data-action="start-all" data-bank="' + bank.id + '">全部练习（' + st.total + '）</button>'
      + '    <button class="btn" data-action="redo-done" data-bank="' + bank.id + '"' + (done ? '' : ' disabled') + '>重刷做过的（' + done + '）</button>'
      + '    <button class="btn" data-action="start-favorites" data-bank="' + bank.id + '"' + (favs ? '' : ' disabled') + '>只练收藏（' + favs + '）</button>'
      + '  </div>'
      + '</section>';

    html += '<h2 class="section-title">章节（点开进入练习）</h2>';
    html += '<div class="list">';
    bank.chapters.forEach(function (c) {
      var counts = Quiz.typeCounts(c.questions);
      var cd = 0;
      c.questions.forEach(function (q) { if (state.done && q.id in state.done) cd += 1; });
      html += ''
        + '<button class="chapter-row" data-action="start-chapter" data-bank="' + bank.id + '" data-chapter="' + c.id + '">'
        + '  <div class="chapter-row-main">'
        + '    <div class="chapter-row-title">' + esc(c.title) + '</div>'
        + '    <div class="muted tiny">' + c.questions.length + ' 题 · ' + typeLine(counts) + ' · 已练 ' + cd + '/' + c.questions.length + '</div>'
        + '  </div>'
        + '  <span class="chapter-row-go">开始' + ic('chevron') + '</span>'
        + '</button>';
    });
    html += '</div>';
    return html;
  }

  /* ================= 答题页 ================= */
  function quiz(state) {
    var s = state.session;
    if (!s || !s.questionIds.length) return '<div class="empty">没有进行中的练习</div>';

    var qid = s.questionIds[s.index];
    var entry = Quiz.questionById(qid);
    if (!entry) return '<div class="empty">题目不存在</div>';

    var q = entry.q;
    var rec = s.answers[qid];
    var submitted = !!(rec && rec.submitted);
    var picked = submitted ? rec.picked : (s.draft[qid] || []);
    var st = Quiz.stats(s);
    var fav = isFav(state, entry.bank.id, qid);
    var isLast = s.index === s.questionIds.length - 1;
    var showTimer = !state.settings || state.settings.showTimer !== false;
    var wrongNow = Quiz.wrongQuestionIds(s).length;   // 本轮已经做错几道

    var html = ''
      + '<div class="topbar">'
      + '  <button class="icon-btn" data-action="quit" title="返回题库" aria-label="返回题库">' + ic('back') + '</button>'
      + '  <div class="title">' + esc(s.title) + (s.scopeLabel ? ' · ' + esc(s.scopeLabel) : '') + '</div>'
      + '  <span class="spacer"></span>'
      + '  <button class="icon-btn' + (fav ? ' active' : '') + '" data-action="star" title="收藏本题" aria-label="收藏本题">' + ic('star') + '</button>'
      + '</div>'
      + '<div class="quiz-head">'
      + '  <span>第 <b>' + (s.index + 1) + '</b> / ' + s.questionIds.length + ' 题</span>'
      + '  <span class="spacer"></span>'
      + '  <span>答对 <b>' + st.correct + '</b></span>'
      + '  <span>· 已作答 ' + st.answered + '</span>'
      + (showTimer ? '<span id="timer">' + ic('clock') + ' ' + U.fmtDuration(s.elapsedMs) + '</span>' : '')
      + (wrongNow ? '<button class="mini-btn" data-action="redo-wrong">错题重做 ' + wrongNow + '</button>' : '')
      + '</div>'
      + '<div class="progress"><i style="width:' + pct(s.index + 1, s.questionIds.length) + '%"></i></div>';

    html += '<div class="q-card card" style="margin-top:14px">';
    html += '<div class="q-head">' + typeBadge(q.type)
      + '<span class="muted tiny">' + esc(entry.bank.title) + ' · 原题号 ' + q.no + '</span>'
      + (s.mode === 'redo' ? '<span class="badge redo">重刷</span>' : '')
      + (s.origin === 'wrong-redo' ? '<span class="badge redo">错题重做</span>' : '')
      + (q.type === 'multiple' ? '<span class="muted tiny">（多选，全部选对才得分）</span>' : '') + '</div>';

    // 一提交就立刻把答案摆到最上面，不用等交卷、也不用往下找
    if (submitted && !q.invalid) {
      html += '<div class="answer-strip ' + (rec.correct ? 'ok' : 'bad') + '">'
        + '<span class="as-label">' + ic(rec.correct ? 'check' : 'x') + (rec.correct ? ' 答对了' : ' 答错了') + '</span>'
        + '<span class="as-main">正确答案 <b>' + q.answer.join('、') + '</b></span>'
        + '<span class="spacer"></span>'
        + '<span class="as-you">你选 ' + (rec.picked.length ? rec.picked.join('、') : '未选') + '</span>'
        + '</div>';
    }

    if (q.invalid) {
      html += '<div class="verdict skip" style="margin:0 0 12px">'
        + '<div class="verdict-title">' + ic('warn') + ' 本题不计分</div>'
        + '<div class="small">' + esc(q.issue) + '。为遵守“不修改题库内容”，此处仅标注异常，原始题干/选项/答案保持原样。</div>'
        + '</div>';
    }

    html += '<div class="q-stem">' + U.renderRich(q.stem) + '</div>';

    html += '<div class="options">';
    if (q.options.length) {
      q.options.forEach(function (opt) {
        var cls = 'opt';
        var dis = '';
        if (submitted) {
          cls += ' locked';
          dis = ' disabled';
          if (q.answer.indexOf(opt.key) >= 0) cls += ' correct';
          else if (picked.indexOf(opt.key) >= 0) cls += ' wrong';
        } else if (picked.indexOf(opt.key) >= 0) {
          cls += ' picked';
        }
        html += '<button class="' + cls + '"' + dis + ' data-action="pick" data-key="' + opt.key + '">'
          + '<span class="key">' + opt.key + '</span>'
          + '<span class="opt-text">' + U.renderRich(opt.text) + '</span></button>';
      });
    } else {
      html += '<div class="muted small">（原题库该题没有提供选项）</div>';
    }
    html += '</div>';

    if (submitted) {
      if (q.invalid) {
        html += '<div class="verdict skip"><div class="verdict-title">已跳过（数据异常，不计分）</div></div>';
      } else if (rec.correct) {
        html += '<div class="verdict ok"><div class="verdict-title">' + ic('check') + ' 回答正确</div>'
          + '<div class="small">正确答案：<b>' + q.answer.join('、') + '</b></div></div>';
      } else {
        html += '<div class="verdict bad"><div class="verdict-title">' + ic('x') + ' 回答错误</div>'
          + '<div class="small">正确答案：<b>' + q.answer.join('、') + '</b>　你的答案：'
          + (rec.picked.length ? rec.picked.join('、') : '未选') + '</div></div>';
      }
      if (q.explanation) {
        html += '<div class="explain"><span class="explain-label">解析：</span>' + U.renderRich(q.explanation) + '</div>';
      }
    }
    html += '</div>';

    var buttons = '<button class="btn" data-action="prev"' + (s.index === 0 ? ' disabled' : '') + '>上一题</button>';
    if (q.invalid) {
      buttons += '<button class="btn btn-primary" data-action="' + (isLast ? 'finish' : 'next') + '">' + (isLast ? '交卷' : '下一题') + '</button>';
    } else if (!submitted) {
      buttons += '<button class="btn btn-primary" data-action="submit"' + (picked.length ? '' : ' disabled') + '>提交</button>';
      buttons += isLast
        ? '<button class="btn" data-action="finish"' + (st.answered ? '' : ' disabled') + '>交卷</button>'
        : '<button class="btn" data-action="next">下一题</button>';
    } else {
      buttons += '<button class="btn btn-primary" data-action="' + (isLast ? 'finish' : 'next') + '">' + (isLast ? '交卷' : '下一题') + '</button>';
    }
    html += '<div class="quiz-foot">' + buttons + '</div>';
    return html;
  }

  /* ================= 结果页 ================= */
  function reviewItem(q, rec) {
    return ''
      + '<div class="review-item">'
      + '  <div class="row" style="gap:8px">' + typeBadge(q.type) + '<span class="muted tiny">原题号 ' + q.no + '</span></div>'
      + '  <div class="review-stem" style="margin-top:6px">' + U.renderRich(q.stem) + '</div>'
      + '  <div class="answer-line">正确答案：<span class="right">' + q.answer.join('、') + '</span>'
      + '　你的答案：<span class="you">' + (rec.picked.length ? rec.picked.join('、') : '未选') + '</span></div>'
      + (q.explanation ? '<div class="explain"><span class="explain-label">解析：</span>' + U.renderRich(q.explanation) + '</div>' : '')
      + '</div>';
  }

  function result(state) {
    var s = state.session;
    if (!s) return '<div class="empty">还没有成绩</div>';
    var st = Quiz.stats(s);

    var wrong = [];
    var invalid = [];
    s.questionIds.forEach(function (id) {
      var entry = Quiz.questionById(id);
      if (!entry) return;
      var rec = s.answers[id];
      if (entry.q.invalid) invalid.push({ q: entry.q, rec: rec });
      else if (rec && rec.submitted && !rec.correct) wrong.push({ q: entry.q, rec: rec });
    });

    var html = topbar('本次成绩', 'banks',
      '<button class="icon-btn" data-action="share" title="分享成绩" aria-label="分享成绩">' + ic('share') + '</button>')
      + '<section class="card center">'
      + '  <div class="score-ring" style="--p:' + st.accuracy + '">'
      + '    <div class="score-num">' + st.accuracy + '%</div>'
      + '    <div class="score-label">正确率</div>'
      + '  </div>'
      + '  <div style="font-weight:700">' + esc(s.title) + (s.scopeLabel ? ' · ' + esc(s.scopeLabel) : '') + '</div>'
      + '  <div class="muted small">共 ' + st.total + ' 题（有效 ' + st.valid + '）· 用时 ' + U.fmtDuration(s.elapsedMs) + '</div>'
      + '  <div class="stat-grid">'
      + '    <div class="stat"><div class="num ok">' + st.correct + '</div><div class="lbl">答对</div></div>'
      + '    <div class="stat"><div class="num bad">' + st.wrong + '</div><div class="lbl">答错</div></div>'
      + '    <div class="stat"><div class="num muted">' + st.unanswered + '</div><div class="lbl">未作答</div></div>'
      + '    <div class="stat"><div class="num muted">' + st.invalid + '</div><div class="lbl">无效题</div></div>'
      + '  </div>'
      + '  <div class="actions" style="justify-content:center">'
      + (wrong.length ? '<button class="btn btn-primary" data-action="redo-wrong">错题重做（' + wrong.length + ' 题）</button>' : '')
      + '    <button class="btn" data-action="retry-all">重刷本次（覆盖记录）</button>'
      + (s.parentId ? '<button class="btn btn-ghost" data-action="open-round" data-round="' + s.parentId + '">回到上一轮</button>' : '')
      + '    <button class="btn btn-ghost" data-action="finish-to-wrong">看错题本</button>'
      + '  </div>'
      + '  <div class="round-note">错题重做会另开一轮独立的练习，这一轮原样存档：'
      + '随时能从「我的 → 测试记录」点回来，成绩与每题记录都不会变。</div>'
      + '</section>';

    /* ---- 简单分析 ---- */
    var an = Quiz.analyze(s);
    html += '<section class="card analysis" style="margin-top:14px">'
      + '<h2>简单分析</h2>'
      + '<div class="analysis-comment">' + esc(an.comment) + '</div>';

    TYPE_ORDER.forEach(function (t) {
      var item = an.byType[t];
      if (!item || !item.answered) return;
      html += '<div class="bar-row">'
        + '<div class="bar-head"><span>' + TYPE_LABEL[t] + '</span>'
        + '<span class="muted tiny">对 ' + item.correct + ' · 错 ' + item.wrong + '</span></div>'
        + bar(pct(item.correct, item.answered))
        + '</div>';
    });

    if (an.weak.length) {
      html += '<div class="weak">'
        + '<div class="muted small">薄弱点（错得最多的章节）</div>'
        + '<div class="meta-line">'
        + an.weak.map(function (w) {
            return '<span class="tag bad">' + esc(w.chapter) + ' · 错 ' + w.wrong + '</span>';
          }).join('')
        + '</div></div>';
    }
    html += '</section>';

    html += '<section class="card" style="margin-top:14px">'
      + '<h2>错题回顾（' + wrong.length + '）</h2>'
      + (wrong.length
        ? wrong.map(function (it) { return reviewItem(it.q, it.rec); }).join('')
        : '<div class="empty">没有错题，漂亮 🎉</div>')
      + '</section>';

    if (invalid.length) {
      html += '<details class="card" style="margin-top:14px">'
        + '<summary style="cursor:pointer;font-weight:700">原题库数据异常题（' + invalid.length + '，未计分）</summary>'
        + invalid.map(function (it) {
            return '<div class="review-item"><div class="row" style="gap:8px">' + typeBadge(it.q.type)
              + '<span class="muted tiny">原题号 ' + it.q.no + '</span></div>'
              + '<div class="review-stem" style="margin-top:6px">' + U.renderRich(it.q.stem) + '</div>'
              + '<div class="answer-line muted tiny">' + esc(it.q.issue) + '</div></div>';
          }).join('')
        + '</details>';
    }
    return html;
  }

  /* ================= 错题本 ================= */
  function wrongItem(it) {
    return ''
      + '<div class="review-item">'
      + '  <div class="row" style="gap:8px">' + typeBadge(it.q.type)
      + '<span class="muted tiny">' + esc(it.bank.title) + ' · 原题号 ' + it.q.no + '</span>'
      + '<span class="spacer"></span>'
      + (it.right ? '<span class="tag ok">已答对 ' + it.right + '/2</span>' : '')
      + (it.times > 1 ? '<span class="tag bad">错 ' + it.times + ' 次</span>' : '')
      + '</div>'
      + '  <div class="review-stem" style="margin-top:6px">' + U.renderRich(it.q.stem) + '</div>'
      + '  <div class="answer-line">正确答案：<span class="right">' + it.q.answer.join('、') + '</span></div>'
      + (it.q.explanation ? '<div class="explain"><span class="explain-label">解析：</span>' + U.renderRich(it.q.explanation) + '</div>' : '')
      + '  <div class="actions">'
      + '    <button class="btn small" data-action="remove-wrong" data-qid="' + it.q.id + '">已掌握，移出</button>'
      + '  </div>'
      + '</div>';
  }

  function wrongBook(state) {
    var groups = Quiz.wrongByType(state.wrong);
    var total = groups.single.length + groups.multiple.length + groups.judge.length;

    var html = topbar('错题本', 'banks',
      total ? '<button class="btn small" data-action="clear-wrong">清空</button>' : '');

    // 错题规则提示：固定在页面顶部，空错题本时也显示
    html += '<div class="wrong-tip">' + ic('bulb')
      + '<span>同一道题<b>累计答对 2 次</b>就会自动移出错题本，答错不会清零已答对的次数；移出后仍可在「我的 → 测试记录」里打开那一轮回看错题。</span>'
      + '</div>';

    if (!total) {
      return html + '<div class="empty">还没有错题 🎉<br><span class="tiny">做错的题会自动收进这里，可以按题型重练。</span></div>';
    }

    html += '<section class="card">'
      + '<div class="row"><h2>共 ' + total + ' 道错题</h2><span class="spacer"></span></div>'
      + '<div class="actions">'
      + TYPE_ORDER.filter(function (t) { return groups[t].length; }).map(function (t) {
          return '<button class="btn btn-ghost" data-action="start-wrong-type" data-type="' + t + '">练' + TYPE_LABEL[t] + '（' + groups[t].length + '）</button>';
        }).join('')
      + '</div>'
      + '</section>';

    TYPE_ORDER.forEach(function (t) {
      var items = groups[t];
      if (!items.length) return;
      html += '<section class="card" style="margin-top:14px">'
        + '<div class="row"><h2>' + TYPE_LABEL[t] + '</h2><span class="spacer"></span><span class="tag">' + items.length + ' 道</span></div>'
        + '<div class="actions"><button class="btn btn-primary" data-action="start-wrong-type" data-type="' + t + '">练习这 ' + items.length + ' 道</button></div>'
        + items.map(wrongItem).join('')
        + '</section>';
    });
    return html;
  }

  /* ================= 收藏 ================= */
  function favorites(state) {
    var list = Quiz.banks();
    var total = favCount(state);
    var html = topbar('我的收藏', 'me');

    if (!total) {
      return html + '<div class="empty">收藏夹是空的。<br><span class="tiny">答题时点右上角 ☆ 就能把重点题收进来。</span></div>';
    }

    list.forEach(function (bank) {
      var ids = (state.favorites || {})[bank.id] || [];
      if (!ids.length) return;
      html += '<section class="card stack" style="margin-top:14px">'
        + '<div class="row"><h2>' + esc(bank.title) + '</h2><span class="spacer"></span><span class="tag fav">' + ids.length + ' 题</span></div>'
        + '<div class="actions">'
        + '<button class="btn btn-primary" data-action="start-favorites" data-bank="' + bank.id + '">练这一套收藏</button>'
        + '</div>';
      ids.forEach(function (id) {
        var entry = Quiz.questionById(id);
        if (!entry) return;
        html += '<div class="review-item">'
          + '<div class="row" style="gap:8px">' + typeBadge(entry.q.type) + '<span class="muted tiny">原题号 ' + entry.q.no + '</span></div>'
          + '<div class="review-stem" style="margin-top:6px">' + U.renderRich(entry.q.stem) + '</div>'
          + '<div class="actions"><button class="btn small" data-action="unstar" data-bank="' + bank.id + '" data-qid="' + id + '">取消收藏</button></div>'
          + '</div>';
      });
      html += '</section>';
    });
    return html;
  }

  /* ================= 我的 ================= */
  function me(state, me_) {
    var user = me_ || { isGuest: true, nickname: '游客' };
    var doneN = Object.keys(state.done || {}).length;
    var stats = Quiz.doneStats(Quiz.banks().reduce(function (acc, b) { return acc.concat(Quiz.allQuestions(b)); }, []), state.done);
    var wrongN = wrongList(state).length;
    var favN = favCount(state);
    var histN = (state.history || []).length;
    var roundN = (state.rounds || []).length;
    var curWrong = state.session ? Quiz.wrongQuestionIds(state.session).length : 0;
    var redoMeta = state.session
      ? (curWrong ? '本轮 ' + curWrong + ' 题' : '本轮没错题')
      : (roundN ? '从最近一轮抽' : '');

    var html = topbar('我的', 'banks');

    html += '<section class="card center">'
      + '<div class="avatar">' + (user.isGuest ? '游' : esc(String(user.nickname).slice(0, 1))) + '</div>'
      + '<div class="user-name">' + esc(user.isGuest ? '游客' : user.nickname) + '</div>'
      + (user.isGuest
          ? '<div class="actions" style="justify-content:center">'
            + '<button class="btn btn-primary" data-action="go" data-view="auth">登录 / 注册</button></div>'
          : '<div class="muted small">' + esc(global.Auth ? global.Auth.maskPhone(user.phone) : '') + '</div>'
            + '<div class="actions" style="justify-content:center">'
            + '<button class="btn small" data-action="logout">退出登录</button></div>')
      + '<div class="stat-grid">'
      + '  <div class="stat"><div class="num">' + doneN + '</div><div class="lbl">已练题</div></div>'
      + '  <div class="stat"><div class="num ok">' + stats.accuracy + '%</div><div class="lbl">累计正确率</div></div>'
      + '  <div class="stat"><div class="num bad">' + wrongN + '</div><div class="lbl">错题</div></div>'
      + '  <div class="stat"><div class="num">' + favN + '</div><div class="lbl">收藏</div></div>'
      + '</div>'
      + '</section>';

    html += '<div class="list" style="margin-top:14px">'
      + navRow('stats', 'chart', '统计分析', '')
      + navRow('history', 'clock', '测试记录', String(histN))
      + navButton('redo-done', 'redo', '重刷做过的题', doneN)
      + navButton('redo-wrong', 'target', '错题重做', redoMeta)
      + navRow('wrong', 'book', '错题本', String(wrongN))
      + navRow('favorites', 'star', '我的收藏', String(favN))
      + navRow('support', 'chat', '智能客服', '')
      + navRow('settings', 'settings', '设置', '')
      + '</div>';
    return html;
  }

  function navRow(view, icon, label, meta) {
    return '<button class="nav-row" data-action="go" data-view="' + view + '">'
      + '<span class="nav-ic">' + ic(icon) + '</span>'
      + '<span class="nav-label">' + esc(label) + '</span>'
      + '<span class="nav-meta">' + esc(meta || '') + '</span>'
      + '<span class="nav-go">' + ic('chevron') + '</span></button>';
  }

  function navButton(action, icon, label, meta) {
    return '<button class="nav-row" data-action="' + action + '">'
      + '<span class="nav-ic">' + ic(icon) + '</span>'
      + '<span class="nav-label">' + esc(label) + '</span>'
      + '<span class="nav-meta">' + esc(meta || '') + '</span>'
      + '<span class="nav-go">' + ic('chevron') + '</span></button>';
  }

  /* ================= 统计分析 ================= */
  function statsView(state) {
    var banks = Quiz.banks();
    var all = banks.reduce(function (acc, b) { return acc.concat(Quiz.allQuestions(b)); }, []);
    var total = Quiz.doneStats(all, state.done);
    var hist = state.history || [];
    var totalMs = hist.reduce(function (n, h) { return n + (h.elapsedMs || 0); }, 0);

    var html = topbar('统计分析', 'me');

    html += '<section class="card">'
      + '<div class="stat-grid" style="margin-top:0">'
      + '  <div class="stat"><div class="num">' + total.answered + '</div><div class="lbl">已练题</div></div>'
      + '  <div class="stat"><div class="num ok">' + total.accuracy + '%</div><div class="lbl">正确率</div></div>'
      + '  <div class="stat"><div class="num">' + hist.length + '</div><div class="lbl">测试次数</div></div>'
      + '  <div class="stat"><div class="num">' + U.fmtDuration(totalMs) + '</div><div class="lbl">累计用时</div></div>'
      + '</div>'
      + '<div class="muted small" style="margin-top:12px">共 ' + all.length + ' 题，已练 ' + total.answered
      + ' 题（答对 ' + total.correct + ' / 答错 ' + total.wrong + '）</div>'
      + '</section>';

    /* 按题库 */
    html += '<section class="card" style="margin-top:14px"><h2>按题库</h2>';
    banks.forEach(function (b) {
      var qs = Quiz.allQuestions(b);
      var st = Quiz.doneStats(qs, state.done);
      html += '<div class="bar-row">'
        + '<div class="bar-head"><span>' + esc(b.title) + '</span>'
        + '<span class="muted tiny">' + st.answered + '/' + qs.length + ' 题</span></div>'
        + bar(st.accuracy)
        + '</div>';
    });
    html += '</section>';

    /* 按题型 */
    html += '<section class="card" style="margin-top:14px"><h2>按题型</h2>';
    TYPE_ORDER.forEach(function (t) {
      var qs = all.filter(function (q) { return q.type === t; });
      if (!qs.length) return;
      var st = Quiz.doneStats(qs, state.done);
      html += '<div class="bar-row">'
        + '<div class="bar-head"><span>' + TYPE_LABEL[t] + '</span>'
        + '<span class="muted tiny">' + st.answered + '/' + qs.length + ' 题</span></div>'
        + bar(st.accuracy)
        + '</div>';
    });
    html += '</section>';

    /* 按章节 */
    html += '<section class="card" style="margin-top:14px"><h2>按章节</h2>';
    banks.forEach(function (b) {
      if (b.chapters.length < 2) return;
      html += '<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">' + esc(b.title) + '</summary>';
      b.chapters.forEach(function (c) {
        var st = Quiz.doneStats(c.questions, state.done);
        html += '<div class="bar-row">'
          + '<div class="bar-head"><span>' + esc(c.title) + '</span>'
          + '<span class="muted tiny">' + st.answered + '/' + c.questions.length + ' 题</span></div>'
          + bar(st.accuracy)
          + '</div>';
      });
      html += '</details>';
    });
    html += '</section>';
    return html;
  }

  /* ================= 测试记录 ================= */
  function historyView(state) {
    var hist = state.history || [];
    var html = topbar('测试记录', 'me',
      hist.length ? '<button class="btn small" data-action="clear-history">清空</button>' : '');

    if (!hist.length) return html + '<div class="empty">还没有测试记录。<br><span class="tiny">答一题就会记一笔，没做完也算；每一轮都能点回去看。</span></div>';

    html += '<div class="list" style="margin-top:14px">';
    hist.forEach(function (h) {
      var tone = h.accuracy >= 80 ? 'ok' : (h.accuracy >= 60 ? '' : 'bad');
      html += '<div class="card hist-row">'
        + '  <div class="row"><b>' + esc(h.title) + (h.scopeLabel ? ' · ' + esc(h.scopeLabel) : '') + '</b>'
        + '<span class="spacer"></span>'
        + (h.answered
            ? '<span class="hist-score ' + tone + '">' + h.accuracy + '%</span>'
            : '<span class="hist-score muted">未作答</span>')
        + '</div>'
        + '  <div class="meta-line">'
        + (h.finished ? '<span class="tag ok">已交卷</span>' : '<span class="tag warn">未完成</span>')
        + (h.origin === 'wrong-redo' ? '<span class="tag">错题重做</span>' : '')
        + (h.mode === 'redo' ? '<span class="tag">重刷</span>' : '')
        + '<span class="tag">对 ' + h.correct + ' · 错 ' + h.wrong + (h.unanswered ? ' · 未答 ' + h.unanswered : '') + '</span>'
        + '<span class="tag">' + h.total + ' 题</span>'
        + '<span class="tag">用时 ' + U.fmtDuration(h.elapsedMs) + '</span>'
        + '<span class="tag">' + fmtWhen(h.at) + '</span>'
        + '  </div>'
        + '  <div class="actions">'
        + '    <button class="btn small" data-action="open-round" data-round="' + h.id + '">'
        + (h.finished ? '打开这一轮' : '继续这一轮') + '</button>'
        + (h.wrong ? '<button class="btn small" data-action="redo-wrong" data-round="' + h.id + '">错题重做（' + h.wrong + '）</button>' : '')
        + '  </div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ================= 智能客服 ================= */
  function supportView(log) {
    var html = topbar('智能客服', 'me');
    var messages = log || [{ role: 'bot', text: '你好，我是狂k重点的客服助手。常见问题点下面，或者直接把问题打出来。' }];

    html += '<section class="card chat">'
      + messages.map(function (m) {
          return '<div class="msg ' + (m.role === 'me' ? 'me' : 'bot') + '">' + U.renderRich(m.text) + '</div>';
        }).join('')
      + '</section>';

    html += '<div class="chips" style="margin-top:12px">'
      + (global.Support ? global.Support.common : []).map(function (q) {
          return '<button class="chip" data-action="ask-faq" data-q="' + esc(q) + '">' + esc(q) + '</button>';
        }).join('')
      + '</div>';

    html += '<div class="chat-input">'
      + '<input id="askInput" type="text" placeholder="输入你的问题…" autocomplete="off">'
      + '<button class="btn btn-primary" data-action="ask-send">发送</button>'
      + '</div>';
    return html;
  }

  /* ================= 设置 ================= */
  function switchRow(key, title, on) {
    return '<div class="nav-row" style="cursor:default">'
      + '<span class="nav-label">' + esc(title) + '</span>'
      + '<span class="spacer"></span>'
      + '<button class="switch' + (on ? ' on' : '') + '" data-action="toggle-setting" data-key="' + key + '"'
      + ' role="switch" aria-checked="' + (on ? 'true' : 'false') + '"><i></i></button>'
      + '</div>';
  }

  function settingsView(state, me_) {
    var user = me_ || { isGuest: true };
    var s = state.settings || { showTimer: true, bigFont: false };

    var html = topbar('设置', 'me');

    html += '<section class="card stack">'
      + '<h2>账号</h2>'
      + '<div class="row"><span>' + (user.isGuest ? '游客（未注册）' : esc(user.nickname) + ' · ' + esc(global.Auth ? global.Auth.maskPhone(user.phone) : '')) + '</span>'
      + '<span class="spacer"></span>'
      + (user.isGuest
          ? '<button class="btn small btn-primary" data-action="go" data-view="auth">登录 / 注册</button>'
          : '<button class="btn small" data-action="logout">退出登录</button>')
      + '</div>'
      + '<div class="muted small">' + (user.isGuest
          ? '游客也能正常刷题，数据只存在这台设备上。注册后可以把进度挂到账号下。'
          : '数据存在这台设备的浏览器里，和游客身份分开保存。') + '</div>'
      + '</section>';

    html += '<section class="card stack" style="margin-top:14px">'
      + '<h2>显示</h2>'
      + switchRow('showTimer', '答题时显示计时', s.showTimer !== false)
      + switchRow('bigFont', '大字号模式', s.bigFont === true)
      + '</section>';

    html += '<section class="card stack" style="margin-top:14px">'
      + '<h2>数据</h2>'
      + '<div class="muted small">清空后收藏、错题本、已练记录、测试记录都会没（只影响当前身份）。</div>'
      + '<div><button class="btn btn-ghost" data-action="reset-all">清空本地数据</button></div>'
      + '</section>';

    html += '<section class="card stack" style="margin-top:14px">'
      + '<h2>关于</h2>'
      + '<div class="kv"><span>版本</span><b>1.0.0</b></div>'
      + '<div class="kv"><span>题库</span><b>Web 120 + Java 219 + 原型示例 7</b></div>'
      + '<div class="kv"><span>运行方式</span><b>纯静态，双击 index.html</b></div>'
      + '<div class="kv"><span>数据存放</span><b>浏览器 localStorage</b></div>'
      + '<div class="muted small">题库来自考核附件，题目内容未做任何修改；5 道结构异常的题已标注为不计分。</div>'
      + '</section>';
    return html;
  }

  /* ================= 登录 / 注册 ================= */
  function authView(mode) {
    var isRegister = mode !== 'login';
    var html = topbar(isRegister ? '注册' : '登录', 'me');

    html += '<section class="card stack">'
      + '<div class="seg">'
      + '  <button class="' + (isRegister ? 'on' : '') + '" data-action="auth-mode" data-mode="register">注册</button>'
      + '  <button class="' + (!isRegister ? 'on' : '') + '" data-action="auth-mode" data-mode="login">登录</button>'
      + '</div>';

    html += '<label class="field"><span>手机号</span>'
      + '<input id="authPhone" type="tel" inputmode="numeric" maxlength="11" placeholder="11 位手机号" autocomplete="tel"></label>';

    if (isRegister) {
      html += '<label class="field"><span>验证码</span>'
        + '<div class="field-row">'
        + '<input id="authCode" type="tel" inputmode="numeric" maxlength="6" placeholder="6 位数字">'
        + '<button class="btn small" data-action="send-code">获取验证码</button>'
        + '</div></label>'
        + '<div id="codeHint" class="hint"></div>';
    }

    html += '<label class="field"><span>密码</span>'
      + '<input id="authPass" type="password" placeholder="' + (isRegister ? '至少 6 位' : '注册时的密码') + '" autocomplete="' + (isRegister ? 'new-password' : 'current-password') + '"></label>';

    if (isRegister) {
      html += '<label class="field"><span>昵称（可选）</span>'
        + '<input id="authNick" type="text" maxlength="12" placeholder="不填就自动生成"></label>';
    }

    html += '<div id="authError" class="error"></div>'
      + '<div class="actions">'
      + '<button class="btn btn-primary btn-block" data-action="' + (isRegister ? 'do-register' : 'do-login') + '">'
      + (isRegister ? '注册并登录' : '登录') + '</button>'
      + '</div>'
      + '<div class="hint">这是纯静态网站，没有后端：验证码会直接显示在页面上，账号只保存在这台设备的浏览器里。请不要使用你在其它网站的真实密码。</div>'
      + '<div class="actions"><button class="btn btn-ghost" data-action="go" data-view="banks">先以游客身份逛逛</button></div>'
      + '</section>';
    return html;
  }

  /* ================= 底部标签栏 ================= */
  var TABS = [
    { key: 'banks', view: 'banks', label: '题库' },
    { key: 'wrong', view: 'wrong', label: '错题' },
    { key: 'favorites', view: 'favorites', label: '收藏' },
    { key: 'me', view: 'me', label: '我的' },
  ];

  function tabKey(view) {
    if (view === 'wrong') return 'wrong';
    if (view === 'favorites') return 'favorites';
    if (view === 'me' || view === 'stats' || view === 'history' || view === 'support' || view === 'settings' || view === 'auth') return 'me';
    return 'banks';
  }

  function tabbar(state) {
    var on = tabKey(state.view);
    var wrongN = wrongList(state).length;
    var favN = favCount(state);
    return '<nav class="tabbar">' + TABS.map(function (tab) {
      var badge = tab.key === 'wrong' ? wrongN : (tab.key === 'favorites' ? favN : 0);
      var text = badge > 99 ? '99+' : String(badge || '');
      return '<button class="' + (on === tab.key ? 'on' : '') + '" data-action="go" data-view="' + tab.view + '">'
        + '<span class="tab-label">' + tab.label + '</span>'
        + (text ? '<i class="dot">' + text + '</i>' : '') + '</button>';
    }).join('') + '</nav>';
  }

  global.UI = {
    banks: banks,
    bankDetail: bankDetail,
    quiz: quiz,
    result: result,
    wrongBook: wrongBook,
    favorites: favorites,
    me: me,
    statsView: statsView,
    historyView: historyView,
    supportView: supportView,
    settingsView: settingsView,
    authView: authView,
    tabbar: tabbar,
    isFav: isFav,
  };
})(window);
