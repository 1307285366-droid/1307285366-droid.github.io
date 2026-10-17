/* 通用工具：转义、轻量富文本、格式化、集合比较 */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * 轻量富文本渲染：先把整段文本转义（题目里含 <a>、<div> 等原始标签，必须当纯文本），
   * 再把 ``` 代码块与 `行内代码` 还原成标签，其余换行转 <br>。
   * 这样既不会执行题目里的 HTML，又能把 Java 代码块显示好看。
   */
  function renderRich(source) {
    var blocks = [];
    var text = escapeHtml(source);
    text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, function (m, code) {
      blocks.push(code.replace(/\n+$/, ''));
      return '\u0000' + (blocks.length - 1) + '\u0000';
    });
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    text = text.replace(/\n/g, '<br>');
    text = text.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      return '<pre class="code"><code>' + blocks[Number(i)] + '</code></pre>';
    });
    return text;
  }

  function fmtDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function pad(n) { return String(n).padStart(2, '0'); }
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  /** 判断两个选项集合是否完全相同（多选判分用，忽略顺序、忽略重复） */
  function sameSet(a, b) {
    var x = Array.from(new Set(a || [])).sort();
    var y = Array.from(new Set(b || [])).sort();
    return x.length === y.length && x.every(function (v, i) { return v === y[i]; });
  }

  function byId(id) { return document.getElementById(id); }

  function uid() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  }

  global.U = {
    escapeHtml: escapeHtml,
    renderRich: renderRich,
    fmtDuration: fmtDuration,
    sameSet: sameSet,
    byId: byId,
    uid: uid,
  };
})(window);
