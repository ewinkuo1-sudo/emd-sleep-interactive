/* page-sleep.js — 睡眠應用頁 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function arr(a) { return Array.prototype.slice.call(a); }
  function energy(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * a[i]; return s; }

  // 標準 EEG 頻段（AASM／睡眠文獻常用），注意 sigma 與 alpha 本來就重疊
  var BANDS = [
    { key: 'delta', label: 'Delta δ', lo: 0.5, hi: 4, note: 'N3 深睡的判讀依據' },
    { key: 'theta', label: 'Theta θ', lo: 4, hi: 8, note: 'N1、REM 的主頻' },
    { key: 'alpha', label: 'Alpha α', lo: 8, hi: 13, note: '清醒閉眼的枕區節律' },
    { key: 'sigma', label: 'Sigma σ（紡錘波）', lo: 11, hi: 16, note: 'N2 的紡錘波帶，與 alpha 重疊' },
    { key: 'beta', label: 'Beta β', lo: 16, hi: 30, note: '清醒、警覺、藥物效應' }
  ];

  function bandOf(f) {
    var hits = BANDS.filter(function (b) { return f >= b.lo && f < b.hi; });
    if (!hits.length) return f >= 30 ? 'gamma / 雜訊 (>30 Hz)' : '低於 delta（趨勢）';
    return hits.map(function (b) { return b.label; }).join(' + ');
  }

  var state = { stage: 'N2', view: 'both', sig: null, emdRes: null };

  /** 紡錘波真值直接從訊號產生器帶出來（signals.js 的 events），不在這裡手抄一份。 */
  function truthOf(sig) { return sig.events || []; }

  // ---------------------------------------------------------------- 主流程
  function load() {
    var sig = Signals.sleepEEG(state.stage, { fs: 100, n: 1000 });
    state.sig = sig;
    var t = arr(sig.t);

    var bands = truthOf(sig).map(function (g) {
      return { x0: g.t0, x1: g.t1, color: '--series-2', alpha: 0.13, label: '紡錘波（真值）' };
    });

    Plot.line(el('rawCv'), {
      height: 200,
      title: sig.label,
      xLabel: '時間 (s)', yLabel: 'µV', xUnit: 's', yUnit: ' µV',
      series: [{ x: t, y: arr(sig.x), color: '--series-1', label: 'EEG' }],
      bands: bands
    });
    el('rawCap').innerHTML =
      '取樣率 ' + sig.fs + ' Hz，10 秒。合成成分：' + sig.notes.join('；') + '。' +
      '<strong>模擬訊號，非真實 PSG 紀錄。</strong>';

    renderFilterBank();
    renderEmd();
    renderMapTable();
    renderTimeFreq();
    renderSpindle();
  }

  // ---------------------------------------------------------------- 固定濾波器組
  function renderFilterBank() {
    var sig = state.sig, t = arr(sig.t);
    var host = el('filtStack');
    host.innerHTML = '';
    var totE = energy(sig.x) || 1;

    BANDS.forEach(function (b, i) {
      var y = DSP.bandpass(sig.x, sig.fs, b.lo, b.hi, 401);
      var wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      wrap.style.marginBottom = '6px';
      var cv = document.createElement('canvas');
      cv.setAttribute('aria-label', b.label + ' 頻帶濾波結果');
      wrap.appendChild(cv);
      host.appendChild(wrap);

      Plot.line(cv, {
        height: 88,
        title: b.label + '  ' + b.lo + '–' + b.hi + ' Hz',
        cornerNote: '能量 ' + (energy(y) / totE * 100).toFixed(1) + '%',
        hideXAxis: i < BANDS.length - 1,
        xLabel: i === BANDS.length - 1 ? '時間 (s)' : null,
        xUnit: 's', yUnit: ' µV',
        padLeft: 48,
        series: [{ x: t, y: arr(y), color: '--series-2', label: b.label }],
        ySymmetric: true
      });
    });
  }

  // ---------------------------------------------------------------- EMD
  function renderEmd() {
    var sig = state.sig, t = arr(sig.t);
    var res = EMD.emd(sig.x, { maxImf: 8, sdThreshold: 0.2, maxIter: 100 });
    state.emdRes = res;
    var totE = energy(sig.x) || 1;

    var host = el('emdStack');
    host.innerHTML = '';
    var panels = res.imfs.map(function (m, i) { return { y: m, name: 'IMF ' + (i + 1), isImf: true }; });
    panels.push({ y: res.residue, name: '殘餘 residue', isImf: false });
    // 只顯示前 6 層，避免右欄比左欄長太多
    if (panels.length > 6) panels = panels.slice(0, 5).concat([panels[panels.length - 1]]);

    panels.forEach(function (p, i) {
      var wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      wrap.style.marginBottom = '6px';
      var cv = document.createElement('canvas');
      cv.setAttribute('aria-label', p.name + ' 波形');
      wrap.appendChild(cv);
      host.appendChild(wrap);

      var note = p.isImf
        ? DSP.meanInstFreq(p.y, sig.fs).toFixed(1) + ' Hz · 能量 ' + (energy(p.y) / totE * 100).toFixed(1) + '%'
        : '能量 ' + (energy(p.y) / totE * 100).toFixed(1) + '%';

      Plot.line(cv, {
        height: 88,
        title: p.name,
        cornerNote: note,
        hideXAxis: i < panels.length - 1,
        xLabel: i === panels.length - 1 ? '時間 (s)' : null,
        xUnit: 's', yUnit: ' µV',
        padLeft: 48,
        series: [{ x: t, y: arr(p.y), color: p.isImf ? '--series-1' : '--series-3', label: p.name }],
        ySymmetric: p.isImf
      });
    });
    if (res.imfs.length > 5) {
      var n = document.createElement('p');
      n.style.cssText = 'font-size:0.82rem;color:var(--text-muted);margin:0.3rem 0 0';
      n.textContent = '（共 ' + res.imfs.length + ' 層 IMF，此處只畫前 5 層與殘餘；完整清單見下方對應表。）';
      host.appendChild(n);
    }
  }

  // ---------------------------------------------------------------- 對應表
  function renderMapTable() {
    var sig = state.sig, res = state.emdRes;
    var totE = energy(sig.x) || 1;
    var rows = res.imfs.map(function (m, i) {
      var f = DSP.meanInstFreq(m, sig.fs);
      var fz = DSP.zeroCrossingFreq(m, sig.fs);
      return '<tr><td>IMF ' + (i + 1) + '</td>' +
        '<td class="num">' + f.toFixed(2) + '</td>' +
        '<td class="num">' + fz.toFixed(2) + '</td>' +
        '<td class="num">' + (energy(m) / totE * 100).toFixed(1) + '%</td>' +
        '<td>' + bandOf(f) + '</td></tr>';
    }).join('');

    el('mapTable').innerHTML =
      '<caption class="sr-only">各層 IMF 對應到的標準 EEG 頻段</caption>' +
      '<thead><tr><th>層</th><th class="num">平均瞬時頻率 (Hz)</th>' +
      '<th class="num">零交越估頻 (Hz)</th><th class="num">能量佔比</th>' +
      '<th>落在哪個標準頻段</th></tr></thead><tbody>' + rows +
      '<tr><td>殘餘</td><td class="num">—</td><td class="num">—</td><td class="num">' +
      (energy(res.residue) / totE * 100).toFixed(1) + '%</td><td>DC 趨勢（基線漂移）</td></tr>' +
      '</tbody>';
  }

  // ---------------------------------------------------------------- 時頻對照
  function renderTimeFreq() {
    var sig = state.sig, t = arr(sig.t);
    var fMax = 30;
    var winLen = 128, hop = 8;
    var S = DSP.stft(sig.x, sig.fs, winLen, hop);

    // 裁掉 fMax 以上的頻率格
    var nfKeep = Math.min(S.nf, Math.ceil(fMax / (S.fMax / (S.nf - 1))) + 1);
    var grid = new Float64Array(S.nt * nfKeep);
    for (var s = 0; s < S.nt; s++)
      for (var b = 0; b < nfKeep; b++) grid[s * nfKeep + b] = S.power[s * S.nf + b];

    var t0 = (winLen / 2) / sig.fs;
    var t1 = (winLen / 2 + (S.nt - 1) * hop) / sig.fs;

    Plot.hilbert(el('stftCv'), {
      height: 280,
      title: 'STFT 時頻圖（Hann 窗 ' + (winLen / sig.fs).toFixed(2) + ' s）',
      xLabel: '時間 (s)', yLabel: '頻率 (Hz)',
      grid: grid, nt: S.nt, nf: nfKeep,
      fMax: (nfKeep - 1) * (S.fMax / (S.nf - 1)),
      tRange: [t0, t1]
    });
    el('stftCap').innerHTML =
      '短時傅立葉轉換，窗長 ' + (winLen / sig.fs).toFixed(2) + ' 秒。' +
      '頻率解析度被窗長鎖死在 ' + (sig.fs / winLen).toFixed(2) + ' Hz，' +
      '時間解析度也不可能比 ' + (winLen / sig.fs).toFixed(2) + ' 秒更好——' +
      '<strong>兩者的乘積有下限，這是測不準原理，不是實作問題。</strong>';

    var res = state.emdRes;
    var tracks = res.imfs.map(function (m) {
      var h = DSP.hilbertSpectrum(m, sig.fs);
      return { t: t, f: arr(h.frequency), a: arr(h.amplitude) };
    });
    Plot.hilbert(el('hhtCv'), {
      height: 280,
      title: 'Hilbert-Huang 時頻譜',
      xLabel: '時間 (s)', yLabel: '瞬時頻率 (Hz)',
      fMax: fMax,
      tRange: [t[0], t[t.length - 1]],
      tracks: tracks
    });
  }

  // ---------------------------------------------------------------- 紡錘波偵測
  function spOpts() {
    return {
      thresholdK: parseFloat(el('spK').value),
      minDur: parseFloat(el('spMin').value),
      band: [parseFloat(el('spB0').value), parseFloat(el('spB1').value)]
    };
  }

  function renderSpindle() {
    var sig = state.sig, t = arr(sig.t);
    var o = spOpts();
    el('spKv').textContent = o.thresholdK.toFixed(1);
    el('spMinv').textContent = o.minDur.toFixed(2);
    el('spB0v').textContent = o.band[0].toFixed(1);
    el('spB1v').textContent = o.band[1].toFixed(1);

    // renderEmd() 已經對同一段訊號做過 EMD，直接共用，不再重算一次
    o.decomposition = state.emdRes;
    var r = Spindle.detect(sig.x, sig.fs, o);
    var truth = truthOf(sig);

    function overlaps(e, g) { return e.t1 > g.t0 - 0.35 && e.t0 < g.t1 + 0.35; }
    var tp = truth.filter(function (g) { return r.events.some(function (e) { return overlaps(e, g); }); });
    var fp = r.events.filter(function (e) { return !truth.some(function (g) { return overlaps(e, g); }); });
    var fn = truth.filter(function (g) { return !r.events.some(function (e) { return overlaps(e, g); }); });

    // ---- 結果卡
    var evRows = r.events.length ? r.events.map(function (e, i) {
      var isFp = fp.indexOf(e) >= 0;
      return '<tr><td>事件 ' + (i + 1) + '</td>' +
        '<td class="num">' + e.t0.toFixed(2) + ' – ' + e.t1.toFixed(2) + '</td>' +
        '<td class="num">' + e.dur.toFixed(2) + '</td>' +
        '<td class="num">' + e.meanFreq.toFixed(2) + '</td>' +
        '<td class="num">' + e.peakAmp.toFixed(1) + '</td>' +
        '<td>' + (isFp ? '<span class="tag bad">誤判 FP</span>' : '<span class="tag ok">命中 TP</span>') + '</td></tr>';
    }).join('') : '<tr><td colspan="6">沒有偵測到任何事件。</td></tr>';

    var verdict;
    if (!truth.length) {
      verdict = fp.length === 0
        ? '<span class="tag ok">正確</span> ' + state.stage + ' 期本來就不該有紡錘波，偵測器也沒有報警。'
        : '<span class="tag bad">誤判 ' + fp.length + ' 次</span> ' + state.stage +
          ' 期沒有放紡錘波，但偵測器報了 ' + fp.length + ' 個事件。試著把門檻係數 K 調高。';
    } else {
      verdict = '真值 ' + truth.length + ' 個 · 命中 ' + tp.length +
        ' · 漏掉 ' + fn.length + ' · 誤判 ' + fp.length + '。' +
        (fn.length === 0 && fp.length === 0
          ? ' <span class="tag ok">全數正確</span>'
          : (fn.length ? ' <span class="tag warn">有漏偵測</span>' : '') +
            (fp.length ? ' <span class="tag bad">有誤判</span>' : ''));
    }

    el('spResult').innerHTML =
      '<h3 style="margin-top:0">偵測結果</h3>' +
      '<div class="stat-row">' +
      '<div class="stat"><span class="v">IMF ' + (r.imfIndex + 1) + '</span><span class="l">被選中的層（帶內能量最大）</span></div>' +
      '<div class="stat"><span class="v">' + (isFinite(r.threshold) ? r.threshold.toFixed(1) : '—') + '</span><span class="l">振幅門檻 (µV)</span></div>' +
      '<div class="stat"><span class="v">' + r.events.length + '</span><span class="l">偵測到的事件數</span></div>' +
      '<div class="stat"><span class="v">' + truth.length + '</span><span class="l">合成時放入的真值數</span></div>' +
      '</div>' +
      '<p>' + verdict + '</p>' +
      '<div class="table-scroll"><table class="data">' +
      '<caption class="sr-only">偵測到的紡錘波事件清單</caption>' +
      '<thead><tr><th>#</th><th class="num">時間 (s)</th><th class="num">長度 (s)</th>' +
      '<th class="num">平均頻率 (Hz)</th><th class="num">峰值振幅 (µV)</th><th>判定</th></tr></thead>' +
      '<tbody>' + evRows + '</tbody></table></div>' +
      '<div class="table-scroll"><table class="data">' +
      '<caption class="sr-only">各層 IMF 在紡錘波頻帶內的能量</caption>' +
      '<thead><tr><th>層</th><th class="num">' + o.band[0] + '–' + o.band[1] + ' Hz 能量佔該層</th>' +
      '<th class="num">帶內平均頻率 (Hz)</th></tr></thead><tbody>' +
      r.imfScores.map(function (s) {
        return '<tr' + (s.index === r.imfIndex ? ' style="font-weight:600"' : '') + '>' +
          '<td>IMF ' + (s.index + 1) + (s.index === r.imfIndex ? ' ←' : '') + '</td>' +
          '<td class="num">' + (s.bandFraction * 100).toFixed(1) + '%</td>' +
          '<td class="num">' + (isFinite(s.meanFreqInBand) ? s.meanFreqInBand.toFixed(2) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    // ---- 訊號圖 + 標註
    var bands = truth.map(function (g) {
      return { x0: g.t0, x1: g.t1, color: '--series-3', alpha: 0.16, label: '真值 ' + g.f + ' Hz' };
    }).concat(r.events.map(function (e) {
      return { x0: e.t0, x1: e.t1, color: '--series-2', alpha: 0.16 };
    }));

    Plot.line(el('spSig'), {
      height: 190,
      title: '原訊號與偵測結果',
      xLabel: '時間 (s)', yLabel: 'µV', xUnit: 's', yUnit: ' µV',
      series: [{ x: t, y: arr(sig.x), color: '--series-1', label: 'EEG' }],
      bands: bands
    });
    Plot.legend(el('spSigLegend'), [
      { color: '--series-1', label: '原始 EEG' },
      { color: '--series-3', label: '真值區間（合成時放入的紡錘波）' },
      { color: '--series-2', label: '偵測到的事件' }
    ]);

    if (r.imfIndex < 0) {
      // 沒有任何 IMF 的能量落在帶內：把下面兩張圖清成「無資料」，不能留上一個分期的舊圖
      var empty = { x: t, y: t.map(function () { return NaN; }), color: '--series-1', label: '—' };
      Plot.line(el('spEnv'), {
        height: 180, title: '沒有 IMF 的能量落在 ' + o.band[0] + '–' + o.band[1] + ' Hz 帶內',
        xLabel: '時間 (s)', yLabel: 'µV', xUnit: 's', series: [empty], yRange: [0, 1]
      });
      Plot.line(el('spFreq'), {
        height: 180, title: '（無可顯示的瞬時頻率）',
        xLabel: '時間 (s)', yLabel: 'Hz', xUnit: 's', series: [empty], yRange: [0, 40]
      });
      Plot.legend(el('spEnvLegend'), []);
      Plot.legend(el('spFreqLegend'), []);
      return;
    }

    // ---- 包絡與門檻
    Plot.line(el('spEnv'), {
      height: 180,
      title: 'IMF ' + (r.imfIndex + 1) + ' 的瞬時振幅包絡',
      xLabel: '時間 (s)', yLabel: 'µV', xUnit: 's', yUnit: ' µV',
      series: [
        { x: t, y: arr(r.amplitude), color: '--series-1', label: '瞬時振幅 A(t)', alpha: 0.35, width: 1.5 },
        { x: t, y: arr(r.amplitudeSmoothed), color: '--series-2', label: '平滑後（0.25 s）' }
      ],
      hlines: [{ y: r.threshold, color: '--series-3', label: '門檻 ' + r.threshold.toFixed(1) + ' µV' }],
      bands: bands,
      yRange: [0, Math.max.apply(null, arr(r.amplitude)) * 1.08]   // 振幅非負，底線固定在 0
    });
    Plot.legend(el('spEnvLegend'), [
      { color: '--series-2', label: '平滑瞬時振幅（判定用）' },
      { color: '--series-1', label: '原始瞬時振幅 A(t)' },
      { color: '--series-3', kind: 'dash', label: '門檻 = 中位數 + ' + o.thresholdK.toFixed(1) + ' × 標準差' }
    ]);

    // ---- 頻率
    Plot.line(el('spFreq'), {
      height: 180,
      title: 'IMF ' + (r.imfIndex + 1) + ' 的平滑瞬時頻率',
      xLabel: '時間 (s)', yLabel: 'Hz', xUnit: 's', yUnit: ' Hz',
      series: [{ x: t, y: arr(r.frequencySmoothed), color: '--series-1', label: '平滑瞬時頻率' }],
      hlines: [
        { y: o.band[0], color: '--series-3', label: '帶下限 ' + o.band[0] + ' Hz' },
        { y: o.band[1], color: '--series-3', label: '帶上限 ' + o.band[1] + ' Hz' }
      ],
      bands: bands,
      yRange: [0, 40]
    });
    Plot.legend(el('spFreqLegend'), [
      { color: '--series-1', label: '平滑瞬時頻率（振幅平方加權）' },
      { color: '--series-3', kind: 'dash', label: '紡錘波頻帶邊界' }
    ]);
  }

  // ---------------------------------------------------------------- 綁定
  el('stageSel').addEventListener('change', function () {
    state.stage = this.value;
    load();
  });

  el('viewSel').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    state.view = b.dataset.v;
    arr(this.querySelectorAll('button')).forEach(function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.v === state.view));
    });
    el('filtCol').hidden = (state.view === 'emd');
    el('emdCol').hidden = (state.view === 'filt');
    el('compareGrid').style.gridTemplateColumns = (state.view === 'both') ? '' : '1fr';
    setTimeout(Plot.redrawAll, 0);
  });

  ['spK', 'spMin', 'spB0', 'spB1'].forEach(function (id) {
    el(id).addEventListener('input', renderSpindle);
  });

  load();
})();
