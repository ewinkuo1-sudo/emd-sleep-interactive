/* page-limits.js — EMD 的極限：每個弱點都現場跑一次給你看 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function arr(a) { return Array.prototype.slice.call(a); }
  function rms(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }

  var FS = 200, N = 2048;

  /** 把一疊 IMF 畫成小倍數圖。 */
  function drawStack(host, t, imfs, residue, fs, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var panels = imfs.map(function (m, i) { return { y: m, name: 'IMF ' + (i + 1), isImf: true }; });
    if (residue) panels.push({ y: residue, name: '殘餘 residue', isImf: false });
    var limit = opts.limit || 5;
    if (panels.length > limit) {
      panels = panels.slice(0, limit - 1).concat([panels[panels.length - 1]]);
    }
    panels.forEach(function (p, i) {
      var wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      wrap.style.marginBottom = '6px';
      var cv = document.createElement('canvas');
      cv.setAttribute('aria-label', p.name + ' 波形');
      wrap.appendChild(cv);
      host.appendChild(wrap);
      Plot.line(cv, {
        height: opts.height || 88,
        title: p.name,
        cornerNote: p.isImf ? DSP.meanInstFreq(p.y, fs).toFixed(2) + ' Hz' : '',
        hideXAxis: i < panels.length - 1,
        xLabel: i === panels.length - 1 ? '時間 (s)' : null,
        xUnit: 's', padLeft: 50,
        series: [{ x: t, y: arr(p.y), color: p.isImf ? '--series-1' : '--series-3', label: p.name }],
        ySymmetric: p.isImf,
        bands: opts.bands || []
      });
    });
  }

  // ================================================================ 2. Mode mixing
  function renderModeMixing() {
    var amp = parseFloat(el('mmAmp').value);
    var f = parseFloat(el('mmFreq').value);
    var dur = parseFloat(el('mmDur').value);
    el('mmAmpv').textContent = amp.toFixed(2);
    el('mmFreqv').textContent = f.toFixed(0);
    el('mmDurv').textContent = dur.toFixed(2);

    var x = new Float64Array(N);
    var t = arr(Signals.timeAxis(N, FS));
    var total = N / FS;
    var bStart = total * 0.35;
    var bEnd = Math.min(total, bStart + dur);
    for (var i = 0; i < N; i++) {
      var tt = i / FS;
      x[i] = Math.sin(2 * Math.PI * 2 * tt);
      if (tt >= bStart && tt < bEnd) {
        var p = (tt - bStart) / (bEnd - bStart);
        x[i] += amp * 0.5 * (1 - Math.cos(2 * Math.PI * p)) * Math.sin(2 * Math.PI * f * tt);
      }
    }

    var bands = amp > 0 ? [{ x0: bStart, x1: bEnd, color: '--series-2', alpha: 0.15, label: '高頻叢發' }] : [];

    Plot.line(el('mmSig'), {
      height: 175,
      title: '2 Hz 基底 + 間歇 ' + f.toFixed(0) + ' Hz 叢發',
      xLabel: '時間 (s)', yLabel: '振幅', xUnit: 's',
      series: [{ x: t, y: arr(x), color: '--series-1', label: '訊號' }],
      bands: bands
    });

    var res = EMD.emd(x, { maxImf: 6 });
    drawStack(el('mmStack'), t, res.imfs, res.residue, FS, { bands: bands, limit: 5 });

    if (!res.imfs.length) return;
    var h = DSP.hilbertSpectrum(res.imfs[0], FS);
    Plot.line(el('mmIf'), {
      height: 200,
      title: 'IMF 1 的瞬時頻率',
      xLabel: '時間 (s)', yLabel: '瞬時頻率 (Hz)', xUnit: 's', yUnit: ' Hz',
      series: [{ x: t, y: arr(h.frequency), color: '--series-1', label: 'IMF 1 瞬時頻率' }],
      bands: bands,
      yRange: [0, Math.max(60, f * 1.6)]
    });
    Plot.legend(el('mmIfLegend'), [
      { color: '--series-1', label: 'IMF 1 的瞬時頻率' },
      { color: '--series-2', label: '高頻叢發所在的時間區間' }
    ]);
  }

  // ================================================================ 3. 頻率解析度
  function renderResolution() {
    var ratio = parseFloat(el('resRatio').value);
    var aRatio = parseFloat(el('resAmp').value);
    el('resRatiov').textContent = ratio.toFixed(2);
    el('resAmpv').textContent = aRatio.toFixed(2);

    var f1 = 8, f2 = f1 * ratio;
    var a1 = 1, a2 = aRatio;
    var x = new Float64Array(N);
    var t = arr(Signals.timeAxis(N, FS));
    for (var i = 0; i < N; i++) {
      var tt = i / FS;
      x[i] = a1 * Math.sin(2 * Math.PI * f1 * tt) + a2 * Math.sin(2 * Math.PI * f2 * tt);
    }

    Plot.line(el('resSig'), {
      height: 175,
      title: f1.toFixed(1) + ' Hz (振幅 ' + a1.toFixed(2) + ') + ' + f2.toFixed(1) + ' Hz (振幅 ' + a2.toFixed(2) + ')',
      xLabel: '時間 (s)', yLabel: '振幅', xUnit: 's',
      series: [{ x: t, y: arr(x), color: '--series-1', label: '合成訊號' }]
    });

    var res = EMD.emd(x, { maxImf: 6 });
    drawStack(el('resStack'), t, res.imfs, res.residue, FS, { limit: 5 });

    // 判定：有沒有兩層 IMF 分別對到 f1 與 f2
    var freqs = res.imfs.map(function (m) { return DSP.meanInstFreq(m, FS); });
    var tol1 = Math.max(0.6, f1 * 0.15), tol2 = Math.max(0.6, f2 * 0.15);
    var i1 = -1, i2 = -1;
    freqs.forEach(function (fv, i) {
      if (i2 < 0 && Math.abs(fv - f2) < tol2) i2 = i;
    });
    freqs.forEach(function (fv, i) {
      if (i1 < 0 && i !== i2 && Math.abs(fv - f1) < tol1) i1 = i;
    });
    var separated = (i1 >= 0 && i2 >= 0);

    el('resVerdict').innerHTML =
      '<div class="stat-row">' +
      '<div class="stat"><span class="v">' + ratio.toFixed(2) + '×</span><span class="l">頻率比 f₂/f₁</span></div>' +
      '<div class="stat"><span class="v">' + f2.toFixed(1) + '</span><span class="l">f₂ (Hz)，f₁ 固定 8 Hz</span></div>' +
      '<div class="stat"><span class="v">' + res.imfs.length + '</span><span class="l">分解出的 IMF 層數</span></div>' +
      '<div class="stat"><span class="v">' + (separated ? '分得開' : '分不開') + '</span><span class="l">兩個成分有沒有各自成層</span></div>' +
      '</div>' +
      '<p style="margin-bottom:0">' +
      (separated
        ? '<span class="tag ok">成功分離</span> IMF ' + (i2 + 1) + ' ≈ ' + freqs[i2].toFixed(2) +
          ' Hz（對應 f₂），IMF ' + (i1 + 1) + ' ≈ ' + freqs[i1].toFixed(2) + ' Hz（對應 f₁）。'
        : '<span class="tag warn">未能分離</span> 沒有任何兩層 IMF 分別對應到 ' + f1.toFixed(1) + ' Hz 與 ' +
          f2.toFixed(1) + ' Hz。各層頻率為 ' + freqs.map(function (v) { return v.toFixed(2); }).join('、') + ' Hz。' +
          'EMD 把這兩個成分當成<strong>一個調幅訊號</strong>處理了。') +
      '</p>' +
      '<h4 style="margin:1.2rem 0 0.3rem">現場掃描：分離門檻到底在哪？</h4>' +
      '<p style="font-size:0.9rem;color:var(--text-secondary);margin:0 0 0.5rem">' +
      '固定振幅比為目前設定（' + aRatio.toFixed(2) + '），f₁ = 8 Hz，掃過一系列頻率比，' +
      '每一格都是當場跑一次完整 EMD 的結果。</p>' +
      '<div id="resSweep"><p style="color:var(--text-muted)">計算中…</p></div>';

    scheduleSweep(aRatio);
  }

  // 掃描要跑 8 次完整 EMD，拖滑桿時不能每幀都算 → 防抖 + 快取
  var sweepCache = {}, sweepTimer = null;
  function scheduleSweep(aRatio) {
    var key = aRatio.toFixed(2);
    var host = el('resSweep');
    // 不論快取有沒有命中，先前排定的計時器都要取消——否則它稍後醒來，
    // 會把「別的振幅比」的掃描表寫進現在這張卡
    clearTimeout(sweepTimer);
    if (sweepCache[key]) { host.innerHTML = sweepCache[key]; return; }
    sweepTimer = setTimeout(function () {
      var html = sweepTable(aRatio);
      sweepCache[key] = html;
      var h = el('resSweep');
      if (h) h.innerHTML = html;
    }, 260);
  }

  /** 對一系列頻率比各跑一次 EMD，回傳 HTML 表格。 */
  function sweepTable(aRatio) {
    var f1 = 8;
    var ratios = [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 3.0];
    var rows = ratios.map(function (r) {
      var f2 = f1 * r;
      var x = new Float64Array(N);
      for (var i = 0; i < N; i++) {
        var tt = i / FS;
        x[i] = Math.sin(2 * Math.PI * f1 * tt) + aRatio * Math.sin(2 * Math.PI * f2 * tt);
      }
      var res = EMD.emd(x, { maxImf: 6 });
      var fr = res.imfs.map(function (m) { return DSP.meanInstFreq(m, FS); });
      var t1 = Math.max(0.6, f1 * 0.15), t2 = Math.max(0.6, f2 * 0.15);
      var i2 = -1, i1 = -1;
      fr.forEach(function (v, i) { if (i2 < 0 && Math.abs(v - f2) < t2) i2 = i; });
      fr.forEach(function (v, i) { if (i1 < 0 && i !== i2 && Math.abs(v - f1) < t1) i1 = i; });
      var ok = (i1 >= 0 && i2 >= 0);
      var errF2 = i2 >= 0 ? Math.abs(fr[i2] - f2) : NaN;
      return '<tr><td class="num">' + r.toFixed(1) + '×</td>' +
        '<td class="num">' + f2.toFixed(1) + '</td>' +
        '<td class="num">' + fr.slice(0, 3).map(function (v) { return v.toFixed(1); }).join(', ') + '</td>' +
        '<td class="num">' + (isFinite(errF2) ? errF2.toFixed(2) : '—') + '</td>' +
        '<td>' + (ok ? '<span class="tag ok">分開</span>' : '<span class="tag bad">混成一層</span>') + '</td></tr>';
    }).join('');

    return '<div class="table-scroll"><table class="data">' +
      '<caption class="sr-only">不同頻率比下 EMD 的分離能力</caption>' +
      '<thead><tr><th class="num">頻率比</th><th class="num">f₂ (Hz)</th>' +
      '<th class="num">前三層 IMF 頻率 (Hz)</th><th class="num">f₂ 估計誤差 (Hz)</th><th>結果</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:0">' +
      '在等振幅（振幅比 = 1）的情況下，轉折大約落在頻率比 <strong>1.8–2.0</strong> 之間；' +
      '但要到 <strong>2.2 以上</strong>，f₂ 的估計誤差才真正收斂到可以忽略。' +
      '<strong>所以「頻率比 &gt; 2」這個常被引用的門檻，其實是「勉強分得開」而不是「分得準」。</strong>' +
      '把振幅比調離 1，會看到門檻整個往右移——這正是 Rilling &amp; Flandrin (2008) 的核心結論。</p>';
  }

  // ================================================================ 4. 端點效應
  function renderEndpoint() {
    var f0 = 2, f1 = 25, dur = N / FS;
    var sig = Signals.chirp({ fs: FS, n: N, f0: f0, f1: f1 });
    var t = arr(sig.t);
    var res = EMD.emd(sig.x, { maxImf: 6 });
    if (!res.imfs.length) return;
    var h = DSP.hilbertSpectrum(res.imfs[0], FS);
    var k = (f1 - f0) / dur;

    var err = new Float64Array(N);
    for (var i = 0; i < N; i++) err[i] = h.frequency[i] - (f0 + k * t[i]);

    Plot.line(el('epIf'), {
      height: 215,
      title: '瞬時頻率估計誤差（估計值 − 理論值）',
      xLabel: '時間 (s)', yLabel: '誤差 (Hz)', xUnit: 's', yUnit: ' Hz',
      series: [{ x: t, y: arr(err), color: '--series-1', label: '估計誤差' }],
      bands: [
        { x0: t[0], x1: t[Math.floor(N * 0.05)], color: '--series-2', alpha: 0.16, label: '前 5%' },
        { x0: t[Math.floor(N * 0.95)], x1: t[N - 1], color: '--series-2', alpha: 0.16 }
      ],
      yRange: [-8, 8]
    });
    Plot.legend(el('epIfLegend'), [
      { color: '--series-1', label: '瞬時頻率估計誤差' },
      { color: '--series-2', label: '前後各 5% 的區域' }
    ]);

    function rmsRange(a, b) {
      var s = 0, c = 0;
      for (var q = Math.floor(N * a); q < Math.floor(N * b); q++) {
        if (isFinite(err[q])) { s += err[q] * err[q]; c++; }
      }
      return c ? Math.sqrt(s / c) : NaN;
    }
    function maxRange(a, b) {
      var m = 0;
      for (var q = Math.floor(N * a); q < Math.floor(N * b); q++) {
        if (isFinite(err[q])) m = Math.max(m, Math.abs(err[q]));
      }
      return m;
    }

    var e5 = rmsRange(0, 0.05), eMid = rmsRange(0.2, 0.8), eEnd = rmsRange(0.95, 1);
    el('epStats').innerHTML =
      '<h3 style="margin-top:0">量化端點效應（chirp 訊號，理論值已知）</h3>' +
      '<div class="stat-row">' +
      '<div class="stat"><span class="v">' + e5.toFixed(2) + '</span><span class="l">前 5% 的誤差 RMS (Hz)</span></div>' +
      '<div class="stat"><span class="v">' + eMid.toFixed(3) + '</span><span class="l">中段 20–80% 的誤差 RMS (Hz)</span></div>' +
      '<div class="stat"><span class="v">' + eEnd.toFixed(2) + '</span><span class="l">後 5% 的誤差 RMS (Hz)</span></div>' +
      '<div class="stat"><span class="v">' + (eMid > 0 ? (Math.max(e5, eEnd) / eMid).toFixed(0) + '×' : '—') +
      '</span><span class="l">端點誤差是中段的幾倍</span></div>' +
      '</div>' +
      '<p style="margin-bottom:0;font-size:0.92rem">' +
      '中段最大誤差 ' + maxRange(0.2, 0.8).toFixed(2) + ' Hz，兩端最大誤差 ' +
      Math.max(maxRange(0, 0.05), maxRange(0.95, 1)).toFixed(2) + ' Hz。' +
      '已經用了鏡像對稱延伸，端點誤差仍明顯高於中段。' +
      '<strong>這是 EMD 的固有性質，不是實作瑕疵。</strong></p>';
  }

  // ================================================================ 5. 停止準則
  function stopSignal() {
    if (el('sdSignal').value === 'eeg') {
      var s = Signals.sleepEEG('N2', { fs: 100, n: 1000 });
      return { x: s.x, t: arr(s.t), fs: 100, unit: 'µV', name: '模擬 N2 睡眠 EEG' };
    }
    var n = Signals.noisyTwoTone({ fs: FS, n: N, f1: 1, f2: 12, a2: 0.5, noise: 0.25 });
    return { x: n.x, t: arr(n.t), fs: FS, unit: '振幅', name: '雙頻 1 + 12 Hz ＋ 白雜訊' };
  }

  /** IMF 品質指標：IMF 條件的違反程度，以及負瞬時頻率的比例。 */
  function imfQuality(imf, fs) {
    var ex = EMD.findExtrema(imf);
    var nE = ex.maxIdx.length + ex.minIdx.length;
    var nZ = EMD.countZeroCrossings(imf);
    var h = DSP.hilbertSpectrum(imf, fs);
    var neg = 0, cnt = 0;
    var lo = Math.floor(imf.length * 0.05), hi = Math.floor(imf.length * 0.95);
    for (var i = lo; i < hi; i++) {
      cnt++;
      if (h.frequency[i] < 0) neg++;
    }
    return { nE: nE, nZ: nZ, diff: Math.abs(nE - nZ), negFrac: cnt ? neg / cnt : 0, h: h };
  }

  function renderStopping() {
    var sd = parseFloat(el('sdSlider').value);
    el('sdSliderv').textContent = sd.toFixed(3);

    var S = stopSignal();
    var r = EMD.sift(S.x, { sdThreshold: sd, maxIter: 400 });
    var q = imfQuality(r.imf, S.fs);

    var verdict;
    if (q.diff > 20) {
      verdict = '<span class="tag bad">IMF 條件嚴重違反</span> 極值數與零交越數差了 ' + q.diff +
        '（合格標準是 ≤ 1）。這層根本還不能算 IMF——sifting 次數不足。';
    } else if (q.diff > 1) {
      verdict = '<span class="tag warn">IMF 條件未完全滿足</span> 極值數與零交越數差了 ' + q.diff + '。';
    } else {
      verdict = '<span class="tag ok">IMF 條件滿足</span> 極值數與零交越數差 ' + q.diff + ' ≤ 1。';
    }

    el('sdStats').innerHTML =
      '<h3 style="margin-top:0">' + S.name + '　SD 門檻 = ' + sd.toFixed(3) + '</h3>' +
      '<div class="stat-row">' +
      '<div class="stat"><span class="v">' + r.iterations + '</span><span class="l">實際 sifting 次數</span></div>' +
      '<div class="stat"><span class="v">' + (isFinite(r.sd) ? r.sd.toFixed(4) : '—') + '</span><span class="l">最後一次的 SD</span></div>' +
      '<div class="stat"><span class="v">' + q.diff + '</span><span class="l">|極值數 − 零交越數|（越小越好）</span></div>' +
      '<div class="stat"><span class="v">' + (q.negFrac * 100).toFixed(2) + '%</span><span class="l">瞬時頻率為負的比例</span></div>' +
      '</div>' +
      '<p style="margin-bottom:0">' + verdict + '</p>';

    // ---- 波形與包絡
    Plot.line(el('sdImf'), {
      height: 200,
      title: 'IMF 1（迭代 ' + r.iterations + ' 次）',
      xLabel: '時間 (s)', yLabel: S.unit, xUnit: 's',
      series: [
        { x: S.t, y: arr(r.imf), color: '--series-1', label: 'IMF 1', alpha: 0.5, width: 1.5 },
        { x: S.t, y: arr(q.h.amplitude), color: '--series-2', label: '瞬時振幅包絡', width: 2 }
      ],
      ySymmetric: true
    });
    Plot.legend(el('sdImfLegend'), [
      { color: '--series-1', label: 'IMF 1 波形' },
      { color: '--series-2', label: 'IMF 1 的瞬時振幅包絡（Hilbert）' }
    ]);

    // ---- 瞬時頻率（負值是重點）
    var fmax = S.fs / 2;
    Plot.line(el('sdFreq'), {
      height: 200,
      title: 'IMF 1 的瞬時頻率（零線以下 = 沒有物理意義的負頻率，佔 ' + (q.negFrac * 100).toFixed(2) + '%）',
      xLabel: '時間 (s)', yLabel: '瞬時頻率 (Hz)', xUnit: 's', yUnit: ' Hz',
      series: [{ x: S.t, y: arr(q.h.frequency), color: '--series-1', label: '瞬時頻率' }],
      hlines: [{ y: 0, color: '--series-3', label: '零頻率', dash: [5, 4] }],
      yRange: [-fmax * 0.6, fmax * 1.05]
    });
    Plot.legend(el('sdFreqLegend'), [
      { color: '--series-1', label: 'IMF 1 的瞬時頻率' },
      { color: '--series-3', kind: 'dash', label: '零線——以下皆為負頻率' }
    ]);

    scheduleStopSweep();
  }

  var stopSweepCache = {}, stopSweepTimer = null;
  function scheduleStopSweep() {
    var key = el('sdSignal').value;
    var host = el('sdSweep');
    clearTimeout(stopSweepTimer);   // 快取命中也要取消舊計時器，理由同 scheduleSweep
    if (stopSweepCache[key]) { host.innerHTML = stopSweepCache[key]; return; }
    host.innerHTML = '<p style="color:var(--text-muted)">掃描計算中…</p>';
    stopSweepTimer = setTimeout(function () {
      // 只在使用者仍停在同一個訊號時才寫回，且快取 key 用排程當下的值，不重新讀 select
      if (el('sdSignal').value !== key) return;
      var html = stopSweepTable();
      stopSweepCache[key] = html;
      var h = el('sdSweep');
      if (h) h.innerHTML = html;
    }, 200);
  }

  function stopSweepTable() {
    var S = stopSignal();
    var sds = [1.0, 0.5, 0.3, 0.2, 0.1, 0.05, 0.01, 0.002];
    var recs = sds.map(function (sd) {
      var r = EMD.sift(S.x, { sdThreshold: sd, maxIter: 400 });
      var q = imfQuality(r.imf, S.fs);
      // 振幅動態範圍：最大瞬時振幅 / 振幅中位數。若「過度 sifting 磨平振幅」為真，此值應隨迭代增加而下降
      var amps = arr(q.h.amplitude).slice(Math.floor(S.x.length * 0.05), Math.floor(S.x.length * 0.95));
      var sorted = amps.slice().sort(function (a, b) { return a - b; });
      var med = sorted[Math.floor(sorted.length / 2)];
      var mx = sorted[sorted.length - 1];
      return { sd: sd, iter: r.iterations, diff: q.diff, neg: q.negFrac, dyn: med > 0 ? mx / med : NaN };
    });

    var rows = recs.map(function (d) {
      return '<tr><td class="num">' + d.sd.toFixed(3) + '</td>' +
        '<td class="num">' + d.iter + '</td>' +
        '<td class="num">' + d.diff + '</td>' +
        '<td class="num">' + (d.neg * 100).toFixed(2) + '%</td>' +
        '<td class="num">' + (isFinite(d.dyn) ? d.dyn.toFixed(2) : '—') + '</td></tr>';
    }).join('');

    var first = recs[0], last = recs[recs.length - 1];
    // 第一列是「幾乎沒 sifting」的極端，拿它當基線不公平；
    // 判斷趨勢時從第二列開始看。
    var tail = recs.slice(1);
    var dyns = tail.map(function (d) { return d.dyn; });
    var dynMax = Math.max.apply(null, dyns), dynMin = Math.min.apply(null, dyns);
    var monotonicDown = dyns.every(function (v, i) { return i === 0 || v <= dyns[i - 1] + 1e-9; });
    var spread = dynMax > 0 ? (dynMax - dynMin) / dynMax : 0;

    return '<h3 style="margin-top:0">實測掃描：SD 門檻對 IMF 品質的影響</h3>' +
      '<p style="font-size:0.9rem;color:var(--text-secondary);margin-top:0">' +
      '對「' + S.name + '」掃過 8 個 SD 門檻，每格當場跑一次完整 sifting。</p>' +
      '<div class="table-scroll"><table class="data">' +
      '<caption class="sr-only">SD 門檻對 sifting 次數與 IMF 品質的影響</caption>' +
      '<thead><tr><th class="num">SD 門檻</th><th class="num">sifting 次數</th>' +
      '<th class="num">|極值 − 零交越|<br><span style="font-weight:400;color:var(--text-muted)">越小越好，≤1 才合格</span></th>' +
      '<th class="num">負瞬時頻率比例<br><span style="font-weight:400;color:var(--text-muted)">越小越好</span></th>' +
      '<th class="num">振幅動態範圍<br><span style="font-weight:400;color:var(--text-muted)">最大 / 中位數</span></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<h4 style="margin-bottom:0.3rem">這張表說了什麼</h4>' +
      '<p style="font-size:0.94rem"><strong>1. 「門檻太大」的害處是真的，而且可量測。</strong>' +
      'SD = 1.0 時只跑 ' + first.iter + ' 次 sifting，|極值 − 零交越| 高達 <strong>' + first.diff +
      '</strong>（合格標準 ≤ 1），負瞬時頻率佔 <strong>' + (first.neg * 100).toFixed(2) + '%</strong>。' +
      '把門檻降到 0.1 以下，兩個指標都明顯改善。</p>' +
      '<p style="font-size:0.94rem"><strong>2. 「過度 sifting 會磨平振幅」——本站實測' +
      (monotonicDown ? '<span class="tag ok">與說法一致</span>' : '<span class="tag bad">未能重現</span>') +
      '。</strong>' +
      '最右欄的「振幅動態範圍」如果教科書說法成立，應該隨 sifting 次數增加而<em>單調下降</em>。' +
      '（第一列只跑 ' + first.iter + ' 次，屬於「幾乎沒 sifting」的極端，不適合當基線，以下從第二列起看。）' +
      '實測值在 <strong>' + dynMin.toFixed(2) + ' – ' + dynMax.toFixed(2) + '</strong> 之間游走，' +
      '全距只佔最大值的 ' + (spread * 100).toFixed(0) + '%，' +
      '而且<strong>' + (monotonicDown ? '確實單調下降' : '先升後降、不是單調下降') + '</strong>' +
      '（依序為 ' + dyns.map(function (v) { return v.toFixed(2); }).join(' → ') + '）。' +
      (monotonicDown
        ? '與教科書說法一致。'
        : '也就是說，在本站的實作與這個測試訊號上，把門檻從 0.5 壓到 0.002、' +
          'sifting 次數從 ' + tail[0].iter + ' 次增加到 ' + last.iter + ' 次，' +
          '<strong>看不到振幅被系統性磨平的證據</strong>。') + '</p>' +
      '<div class="note warn"><p style="margin-bottom:0">' +
      '<strong>為什麼要把這個否定結果寫出來？</strong>' +
      '「過度 sifting 有害」是 EMD 文獻裡被反覆引用的說法，本站原本也照抄了。' +
      '實際跑出數字後發現在這些訊號上重現不出來，於是改寫成現在這樣。' +
      '<strong>這不代表教科書錯了</strong>——可能是本站的測試訊號太乾淨、' +
      '可能要更極端的迭代次數（本站最多只到 ' + last.iter + ' 次，文獻上討論的過度 sifting 往往是數百次）、' +
      '也可能與 SD 這個特定停止準則的定義有關。' +
      '但在拿到反例之前，<strong>本站不會宣稱一件自己量不出來的事。</strong>' +
      '這正是「EMD 缺乏理論基礎」的實際後果：連「參數該怎麼調」都只能靠各自的實驗，而實驗結果會互相矛盾。' +
      '</p></div>';
  }

  // ================================================================ 6. EEMD
  function runEemd() {
    var btn = el('btnEemd');
    btn.disabled = true;
    btn.textContent = '計算中…';

    setTimeout(function () {
      var n = 1024;
      var sig = Signals.intermittent({ fs: FS, n: n });
      var t = arr(sig.t);

      var t0 = performance.now();
      var a = EMD.emd(sig.x, { maxImf: 7 });
      var tA = performance.now() - t0;

      var t1 = performance.now();
      var b = EMD.eemd(sig.x, { maxImf: 7, ensembleSize: 30, noiseAmplitude: 0.2, seed: 3 });
      var tB = performance.now() - t1;

      function reconErr(res) {
        var m = 0;
        for (var i = 0; i < n; i++) {
          var s = res.residue[i];
          for (var q = 0; q < res.imfs.length; q++) s += res.imfs[q][i];
          m = Math.max(m, Math.abs(s - sig.x[i]));
        }
        return m;
      }
      var errA = reconErr(a), errB = reconErr(b);

      // IMF 1 在叢發之外的殘留能量（越小代表 mode mixing 越輕）
      function outsideBurstRms(imf) {
        var s = 0, c = 0;
        var b0 = sig.burst.i0, b1 = sig.burst.i1;   // 叢發區間由產生器回報，不在這裡手抄
        for (var i = 0; i < n; i++) {
          if (i >= b0 && i < b1) continue;
          s += imf[i] * imf[i]; c++;
        }
        return Math.sqrt(s / c);
      }
      var outA = a.imfs.length ? outsideBurstRms(a.imfs[0]) : NaN;
      var outB = b.imfs.length ? outsideBurstRms(b.imfs[0]) : NaN;

      el('eemdResult').hidden = false;
      el('eemdFig').hidden = false;
      el('eemdResult').innerHTML =
        '<h3 style="margin-top:0">EMD vs EEMD 對照（間歇叢發訊號，' + n + ' 點）</h3>' +
        '<div class="table-scroll"><table class="data">' +
        '<caption class="sr-only">EMD 與 EEMD 的量化比較</caption>' +
        '<thead><tr><th>指標</th><th class="num">EMD</th><th class="num">EEMD (30)</th><th>誰比較好</th></tr></thead><tbody>' +
        '<tr><td>IMF 層數</td><td class="num">' + a.imfs.length + '</td><td class="num">' + b.imfs.length + '</td><td>—</td></tr>' +
        '<tr><td>重建最大誤差</td><td class="num">' + errA.toExponential(2) + '</td><td class="num">' + errB.toExponential(2) + '</td>' +
        '<td><span class="tag ok">EMD</span> 完全重建；EEMD 差了約 ' +
        (errA > 0 ? (errB / errA).toExponential(1) : '很多') + ' 倍</td></tr>' +
        '<tr><td>IMF 1 在叢發區外的 RMS<br><span style="color:var(--text-muted);font-size:0.8rem">越小代表 mode mixing 越輕</span></td>' +
        '<td class="num">' + outA.toFixed(4) + '</td><td class="num">' + outB.toFixed(4) + '</td>' +
        '<td>' + (outB < outA ? '<span class="tag ok">EEMD</span> 較乾淨' : '<span class="tag warn">EMD</span> 本次較乾淨') + '</td></tr>' +
        '<tr><td>計算時間</td><td class="num">' + tA.toFixed(0) + ' ms</td><td class="num">' + tB.toFixed(0) + ' ms</td>' +
        '<td><span class="tag ok">EMD</span> 快 ' + (tA > 0 ? (tB / tA).toFixed(0) : '?') + ' 倍</td></tr>' +
        '</tbody></table></div>' +
        '<p style="margin-bottom:0">' +
        '<strong>這張表就是取捨的全貌：</strong>EEMD 用「失去完全重建性」與「數十倍計算量」' +
        '換「mode mixing 減輕」。沒有哪一邊是免費的。' +
        '真實研究裡要選哪一個，取決於你的結論依賴的是<strong>重建精度</strong>還是<strong>模態純度</strong>。</p>';

      drawStack(el('eemdA'), t, a.imfs, a.residue, FS, { limit: 4, height: 80 });
      drawStack(el('eemdB'), t, b.imfs, b.residue, FS, { limit: 4, height: 80 });

      btn.textContent = '重跑一次';
      btn.disabled = false;
    }, 30);
  }

  // ================================================================ 綁定
  ['mmAmp', 'mmFreq', 'mmDur'].forEach(function (id) {
    el(id).addEventListener('input', renderModeMixing);
  });
  ['resRatio', 'resAmp'].forEach(function (id) {
    el(id).addEventListener('input', renderResolution);
  });
  el('sdSlider').addEventListener('input', renderStopping);
  el('sdSignal').addEventListener('change', renderStopping);
  el('btnEemd').addEventListener('click', runEemd);

  renderModeMixing();
  renderResolution();
  renderEndpoint();
  renderStopping();
})();
