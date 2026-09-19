/* page-home.js — 首頁：FFT 夠不夠用的兩個示範 */
(function () {
  'use strict';

  var FS = 200, N = 2048;

  function el(id) { return document.getElementById(id); }
  function arr(a) { return Array.prototype.slice.call(a); }

  // ---------------------------------------------------------------- 示範 1
  var d1 = {
    f1: el('d1f1'), f2: el('d1f2'), a2: el('d1a2'),
    f1v: el('d1f1v'), f2v: el('d1f2v'), a2v: el('d1a2v')
  };

  function renderDemo1() {
    var f1 = parseFloat(d1.f1.value), f2 = parseFloat(d1.f2.value), a2 = parseFloat(d1.a2.value);
    d1.f1v.textContent = f1.toFixed(1);
    d1.f2v.textContent = f2.toFixed(1);
    d1.a2v.textContent = a2.toFixed(2);

    var sig = Signals.twoTone({ fs: FS, n: N, f1: f1, f2: f2, a1: 1.0, a2: a2 });
    var t = arr(sig.t);

    Plot.line(el('d1-sig'), {
      height: 180,
      title: '時域訊號',
      xLabel: '時間 (s)', yLabel: '振幅', xUnit: 's',
      series: [{ x: t, y: arr(sig.x), color: '--series-1', label: '合成訊號' }]
    });
    Plot.legend(el('d1-sig-legend'), [{ color: '--series-1', label: '合成訊號 = sin(2π·' + f1 + '·t) + ' + a2 + '·sin(2π·' + f2 + '·t)' }]);

    var spec = DSP.magnitudeSpectrum(sig.x, FS);
    var keep = 0;
    while (keep < spec.freq.length && spec.freq[keep] <= Math.max(40, f2 * 2)) keep++;
    Plot.line(el('d1-fft'), {
      height: 180,
      title: 'FFT 振幅頻譜',
      xLabel: '頻率 (Hz)', yLabel: '振幅', xUnit: 'Hz', xTipDecimals: 2,
      series: [{ x: arr(spec.freq).slice(0, keep), y: arr(spec.mag).slice(0, keep), color: '--series-1', label: '|X(f)|' }],
      yRange: [0, Math.max(1.15, a2 * 1.3)]
    });
    Plot.legend(el('d1-fft-legend'), [{ color: '--series-1', label: '單邊振幅頻譜 |X(f)|' }]);

    // EMD
    var res = EMD.emd(sig.x, { maxImf: 6, sdThreshold: 0.2, maxIter: 100 });
    var host = el('d1-imfs');
    host.innerHTML = '';

    var panels = res.imfs.map(function (m, i) {
      return { y: m, name: 'IMF ' + (i + 1), color: '--series-1' };
    });
    panels.push({ y: res.residue, name: '殘餘 residue', color: '--series-2' });

    panels.forEach(function (p, i) {
      var wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      wrap.style.marginBottom = '6px';
      var cv = document.createElement('canvas');
      cv.setAttribute('aria-label', p.name + ' 的波形');
      wrap.appendChild(cv);
      host.appendChild(wrap);

      var note = '';
      if (p.name.indexOf('IMF') === 0) {
        var fH = DSP.meanInstFreq(p.y, FS);
        note = '平均瞬時頻率 ' + fH.toFixed(2) + ' Hz';
      } else {
        note = '單調趨勢，不再振盪';
      }

      Plot.line(cv, {
        height: 96,
        title: p.name,
        cornerNote: note,
        hideXAxis: i < panels.length - 1,
        xLabel: i === panels.length - 1 ? '時間 (s)' : null,
        xUnit: 's',
        padLeft: 54,
        series: [{ x: t, y: arr(p.y), color: p.color, label: p.name }],
        ySymmetric: p.name.indexOf('IMF') === 0
      });
    });

    Plot.legend(el('d1-imf-legend'), [
      { color: '--series-1', label: 'IMF（本徵模態函數）' },
      { color: '--series-2', label: '殘餘 residue' }
    ]);

    // 驗證卡片
    var rows = res.imfs.map(function (m, i) {
      var fH = DSP.meanInstFreq(m, FS);
      var fZ = DSP.zeroCrossingFreq(m, FS);
      var rmsV = Math.sqrt(m.reduce(function (s, v) { return s + v * v; }, 0) / m.length);
      return { i: i + 1, fH: fH, fZ: fZ, amp: rmsV * Math.SQRT2 };
    });
    // 重建誤差
    var maxErr = 0;
    for (var k = 0; k < N; k++) {
      var s = res.residue[k];
      for (var q = 0; q < res.imfs.length; q++) s += res.imfs[q][k];
      maxErr = Math.max(maxErr, Math.abs(s - sig.x[k]));
    }

    var target1 = f1, target2 = f2;
    function nearest(target) {
      var best = null;
      rows.forEach(function (r) {
        if (!best || Math.abs(r.fH - target) < Math.abs(best.fH - target)) best = r;
      });
      return best;
    }
    var hit2 = nearest(target2), hit1 = nearest(target1);

    el('d1-verify').innerHTML =
      '<h3 style="margin-top:0">當場驗證：EMD 有沒有算對？</h3>' +
      '<div class="table-scroll"><table class="data">' +
      '<caption class="sr-only">各層 IMF 的估計頻率與振幅</caption>' +
      '<thead><tr><th>層</th><th class="num">Hilbert 平均瞬時頻率</th>' +
      '<th class="num">零交越估頻</th><th class="num">估計振幅</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>IMF ' + r.i + '</td><td class="num">' + r.fH.toFixed(3) + ' Hz</td>' +
          '<td class="num">' + r.fZ.toFixed(3) + ' Hz</td><td class="num">' + r.amp.toFixed(3) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="stat-row">' +
      '<div class="stat"><span class="v">' + hit2.fH.toFixed(2) + '</span>' +
      '<span class="l">最接近 f₂ = ' + target2 + ' Hz 的 IMF（IMF ' + hit2.i + '）</span></div>' +
      '<div class="stat"><span class="v">' + hit1.fH.toFixed(2) + '</span>' +
      '<span class="l">最接近 f₁ = ' + target1 + ' Hz 的 IMF（IMF ' + hit1.i + '）</span></div>' +
      '<div class="stat"><span class="v">' + maxErr.toExponential(1) + '</span>' +
      '<span class="l">重建最大誤差 max|Σ IMF + residue − x|</span></div>' +
      '</div>' +
      '<p style="margin-bottom:0;font-size:0.9rem;color:var(--text-secondary)">' +
      'EMD 是<strong>完全重建</strong>的：所有 IMF 加上殘餘，必須逐點等於原訊號。' +
      '上面的重建誤差是浮點運算的捨入極限（約 10⁻¹⁶ 量級），不是演算法誤差。' +
      '把 f₁ 和 f₂ 拉近（頻率比小於約 2 倍）會看到 EMD 開始分不開——' +
      '這是 EMD 的<a href="limits.html">已知解析度極限</a>，不是 bug。</p>';
  }

  [d1.f1, d1.f2, d1.a2].forEach(function (s) {
    s.addEventListener('input', renderDemo1);
  });

  // ---------------------------------------------------------------- 示範 2
  function renderDemo2() {
    var f0 = 2, f1 = 25;
    var sig = Signals.chirp({ fs: FS, n: N, f0: f0, f1: f1 });
    var t = arr(sig.t);

    Plot.line(el('d2-sig'), {
      height: 170,
      title: 'Chirp 時域波形（2 → 25 Hz）',
      xLabel: '時間 (s)', yLabel: '振幅', xUnit: 's',
      series: [{ x: t, y: arr(sig.x), color: '--series-1', label: 'chirp' }]
    });

    var spec = DSP.magnitudeSpectrum(sig.x, FS);
    var keep = 0;
    while (keep < spec.freq.length && spec.freq[keep] <= 40) keep++;
    Plot.line(el('d2-fft'), {
      height: 170,
      title: 'FFT 振幅頻譜',
      xLabel: '頻率 (Hz)', yLabel: '振幅', xUnit: 'Hz', xTipDecimals: 2,
      series: [{ x: arr(spec.freq).slice(0, keep), y: arr(spec.mag).slice(0, keep), color: '--series-1', label: '|X(f)|' }],
      bands: [{ x0: f0, x1: f1, color: '--series-2', alpha: 0.10, label: '訊號實際掃過的頻率範圍' }]
    });

    var res = EMD.emd(sig.x, { maxImf: 6 });
    if (!res.imfs.length) return;
    var h = DSP.hilbertSpectrum(res.imfs[0], FS);

    Plot.hilbert(el('d2-hht'), {
      height: 260,
      title: 'Hilbert 時頻譜（EMD + Hilbert 轉換）',
      xLabel: '時間 (s)', yLabel: '瞬時頻率 (Hz)',
      fMax: 35,
      tRange: [t[0], t[t.length - 1]],
      tracks: [{ t: t, f: arr(h.frequency), a: arr(h.amplitude) }]
    });

    var dur = N / FS;
    var theo = t.map(function (tt) { return f0 + (f1 - f0) / dur * tt; });
    Plot.line(el('d2-if'), {
      height: 200,
      title: 'IMF 1 的瞬時頻率 vs 理論值',
      xLabel: '時間 (s)', yLabel: '瞬時頻率 (Hz)', xUnit: 's', yUnit: ' Hz',
      series: [
        { x: t, y: theo, color: '--series-3', label: '理論瞬時頻率', dash: [6, 4] },
        { x: t, y: arr(h.frequency), color: '--series-1', label: 'EMD + Hilbert 估計' }
      ],
      yRange: [-5, 40],
      bands: [
        { x0: t[0], x1: t[Math.floor(N * 0.1)], color: '--series-2', alpha: 0.12, label: '端點效應' },
        { x0: t[Math.floor(N * 0.9)], x1: t[N - 1], color: '--series-2', alpha: 0.12 }
      ]
    });
    Plot.legend(el('d2-if-legend'), [
      { color: '--series-1', label: 'EMD + Hilbert 估計的瞬時頻率' },
      { color: '--series-3', kind: 'dash', label: '理論瞬時頻率 f(t) = ' + f0 + ' + ' + ((f1 - f0) / dur).toFixed(2) + '·t' },
      { color: '--series-2', label: '端點效應影響區（前後各 10%）' }
    ]);
  }

  renderDemo1();
  renderDemo2();
})();
