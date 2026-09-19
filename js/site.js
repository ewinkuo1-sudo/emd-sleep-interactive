/* site.js — 共用的導覽列、明暗主題切換、頁尾 */
(function () {
  'use strict';

  var PAGES = [
    { href: 'index.html', label: '為什麼需要 EMD' },
    { href: 'emd.html', label: '互動演算法' },
    { href: 'sleep.html', label: '睡眠應用' },
    { href: 'papers.html', label: '論文導讀' },
    { href: 'limits.html', label: 'EMD 的極限' }
  ];

  var STORE = 'emd-site-theme';

  function currentFile() {
    var p = location.pathname.split('/').pop();
    return p === '' ? 'index.html' : p;
  }

  function applyTheme(t) {
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
      var eff = t === 'dark' ? '深色' : t === 'light' ? '淺色' : '跟隨系統';
      btn.textContent = (t === 'dark' ? '🌙 ' : t === 'light' ? '☀️ ' : '🖥 ') + eff;
      btn.setAttribute('aria-label', '主題：' + eff + '（點擊切換）');
    }
    if (window.Plot) setTimeout(window.Plot.redrawAll, 0);
  }

  function buildHeader() {
    var here = currentFile();
    var header = document.createElement('header');
    header.className = 'site-header';
    var nav = document.createElement('nav');
    nav.className = 'nav';
    nav.setAttribute('aria-label', '主要導覽');

    var brand = document.createElement('a');
    brand.className = 'brand';
    brand.href = 'index.html';
    brand.innerHTML = 'EMD × 睡眠訊號 <small>互動演算法教學</small>';
    nav.appendChild(brand);

    PAGES.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'navlink';
      a.href = p.href;
      a.textContent = p.label;
      if (p.href === here) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });

    var btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.type = 'button';
    btn.addEventListener('click', function () {
      var cur = localStorage.getItem(STORE) || 'auto';
      var next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
      localStorage.setItem(STORE, next);
      applyTheme(next);
    });
    nav.appendChild(btn);

    header.appendChild(nav);
    document.body.insertBefore(header, document.body.firstChild);
  }

  function buildFooter() {
    var f = document.createElement('footer');
    f.className = 'site-footer';
    f.innerHTML =
      '<div class="inner">' +
      '<p><strong>本網站由人與 AI 協作完成。</strong>作者：Ewin Kuo（陽明交通大學 生醫光電研究所）。' +
      'EMD／Hilbert 轉換／FFT 的演算法程式碼由 vanilla JavaScript 從頭實作，' +
      '並以成分已知的合成訊號驗證（<code>node test/test-emd.mjs</code> 44 項＋' +
      '<code>node test/test-spindle.mjs</code> 6 項，共 50 項全數通過）。' +
      'AI（Claude）參與了程式碼撰寫、文獻搜尋與文案潤飾；文獻連結皆經實際開啟確認，' +
      '未找到的內容一律標示「未找到」而非臆測。</p>' +
      '<p style="color:var(--text-muted)">課程作業 · 為 2026-09-24 黃鍔院士演講預備 · ' +
      '<a href="https://ewinkuo1-sudo.github.io/emd-sleep-interactive/">線上版（GitHub Pages）</a> · ' +
      '<a href="https://github.com/ewinkuo1-sudo/emd-sleep-interactive">GitHub 原始碼</a></p>' +
      '</div>';
    document.body.appendChild(f);
  }

  // 主題要在第一次繪圖前就定好，避免閃爍
  applyTheme(localStorage.getItem(STORE) || 'auto');

  document.addEventListener('DOMContentLoaded', function () {
    buildHeader();
    buildFooter();
    applyTheme(localStorage.getItem(STORE) || 'auto');
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if ((localStorage.getItem(STORE) || 'auto') === 'auto' && window.Plot) window.Plot.redrawAll();
  });
})();
