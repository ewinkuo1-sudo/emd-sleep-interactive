/* page-emd.js — 互動 EMD 核心頁
 * 狀態機：
 *   sig      目前訊號
 *   residue  已扣掉前幾層 IMF 後的殘餘（本層 sifting 的起點）
 *   h        本層 sifting 的工作序列
 *   iter     本層已跑的迭代次數
 *   imfs     已定案的 IMF
 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function arr(a) { return Array.prototype.slice.call(a); }
  function rms(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }
  function energy(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * a[i]; return s; }

  var N = 1024;
  var state = {
    sig: null, residue: null, h: null, iter: 0, imfs: [],
    lastSift: null, done: false, playing: null, drawPoints: []
  };

  var ui = {
    sigSel: el('sigSel'), sdT: el('sdT'), maxIt: el('maxIt'), maxImf: el('maxImf'),
    sdTv: el('sdTv'), maxItv: el('maxItv'), maxImfv: el('maxImfv')
  };

  function opts() {
    return {
      sdThreshold: parseFloat(ui.sdT.value),
      maxIter: parseInt(ui.maxIt.value, 10),
      maxImf: parseInt(ui.maxImf.value, 10)
    };
  }

  // ---------------------------------------------------------------- 訊號
  function buildSignal(key) {
    switch (key) {
      case 'two': return Signals.twoTone({ fs: 200, n: N, f1: 1, f2: 12, a1: 1, a2: 0.5 });
      case 'two-close': return Signals.twoTone({ fs: 200, n: N, f1: 8, f2: 12, a1: 1, a2: 1 });
      case 'three': {
        var fs = 200, x = new Float64Array(N);
        for (var i = 0; i < N; i++) {
          var t = i / fs;
          x[i] = 1.5 * Math.sin(2 * Math.PI * 1.5 * t) + 0.8 * Math.sin(2 * Math.PI * 8 * t)
            + 0.4 * Math.sin(2 * Math.PI * 30 * t);
        }
        return { x: x, t: Signals.timeAxis(N, fs), fs: fs, label: '三頻合成 1.5 + 8 + 30 Hz' };
      }
      case 'chirp': return Signals.chirp({ fs: 200, n: N, f0: 2, f1: 25 });
      case 'noisy': return Signals.noisyTwoTone({ fs: 200, n: N, f1: 1, f2: 12, a2: 0.5, noise: 0.15 });
      case 'intermittent': return Signals.intermittent({ fs: 200, n: N });
      case 'draw': return Signals.fromPoints(state.drawPoints, N, 100);
      default:
        if (key.indexOf('eeg-') === 0) return Signals.sleepEEG(key.slice(4), { fs: 100, n: 1000 });
        return Signals.twoTone({ fs: 200, n: N });
    }
  }

  function loadSignal() {
    var key = ui.sigSel.value;
    el('drawPanel').hidden = (key !== 'draw');
    var sig = buildSignal(key);
    state.sig = sig;
    resetSifting();

    Plot.line(el('srcCv'), {
      height: 190,
      title: sig.label,
      xLabel: '時間 (s)', yLabel: sig.unit || '振幅', xUnit: 's',
      yUnit: sig.unit ? ' ' + sig.unit : '',
      series: [{ x: arr(sig.t), y: arr(sig.x), color: '--series-1', label: '原訊號 x(t)' }]
    });

    var cap = '取樣率 ' + sig.fs + ' Hz，' + sig.x.length + ' 點，長度 ' +
      (sig.x.length / sig.fs).toFixed(2) + ' 秒。Nyquist 頻率 ' + (sig.fs / 2) + ' Hz。';
    if (sig.notes && sig.notes.length) {
      cap += '<br>合成成分：' + sig.notes.join('；') + '。' +
        '<strong>這是教學用的合成訊號，不是真實 PSG 紀錄。</strong>';
    }
    el('srcCap').innerHTML = cap;

    renderFull();
  }

  // ---------------------------------------------------------------- sifting 狀態機
  function resetSifting() {
    stopPlay();
    state.residue = state.sig.x.slice();
    state.h = state.residue.slice();
    state.iter = 0;
    state.imfs = [];
    state.lastSift = null;
    state.done = false;
    renderSift();
  }

  function stepOnce() {
    if (state.done) return false;
    var o = opts();
    var r = EMD.siftOnce(state.h, 2);
    if (!r) {                      // 極值不足 → 這層拆不出來，整個分解結束
      state.done = true;
      state.lastSift = null;
      renderSift();
      return false;
    }
    state.lastSift = { before: state.h, res: r };
    state.h = r.h1;
    state.iter++;
    renderSift();
    return !(r.sd < o.sdThreshold || state.iter >= o.maxIter);
  }

  function finishImf() {
    stopPlay();
    var guard = 0;
    while (stepOnce() && guard++ < 500) { /* 跑到收斂或碰到上限 */ }
  }

  function nextImf() {
    stopPlay();
    if (state.done) return;
    var o = opts();
    if (state.imfs.length >= o.maxImf) return;
    state.imfs.push(state.h.slice());
    var next = new Float64Array(state.residue.length);
    for (var i = 0; i < next.length; i++) next[i] = state.residue[i] - state.h[i];
    state.residue = next;
    state.h = next.slice();
    state.iter = 0;
    state.lastSift = null;
    var ex = EMD.findExtrema(state.residue);
    if (ex.maxIdx.length + ex.minIdx.length < 3 || state.imfs.length >= o.maxImf) state.done = true;
    renderSift();
  }

  function stopPlay() {
    if (state.playing) { clearInterval(state.playing); state.playing = null; }
    var b = el('btnPlay');
    if (b) b.textContent = '自動播放 ⏵⏵';
  }

  function togglePlay() {
    if (state.playing) { stopPlay(); return; }
    el('btnPlay').textContent = '暫停 ⏸';
    state.playing = setInterval(function () {
      if (!stepOnce()) stopPlay();
    }, 450);
  }

  // ---------------------------------------------------------------- 顯示時間窗
  /** 回傳 [t0, t1]；winW 滑桿為 0~100（100 = 全長）。 */
  function viewWindow() {
    var sig = state.sig;
    var dur = sig.x.length / sig.fs;
    var frac = parseFloat(el('winW').value) / 100;
    var w = Math.max(0.15, Math.pow(frac, 2) * dur);   // 平方讓小視窗端更好控
    if (frac >= 1) w = dur;
    var s = Math.min(parseFloat(el('winS').value) / 100 * dur, Math.max(0, dur - w));
    el('winWv').textContent = (frac >= 1) ? '全部' : w.toFixed(2) + ' s';
    el('winSv').textContent = s.toFixed(2) + ' s';
    el('winS').disabled = (frac >= 1);
    return [s, s + w];
  }

  /** 視窗內所有序列的對稱 y 範圍（縮放到安靜區段時才不會變成一條直線）。 */
  function winYRange(win, arrays) {
    var sig = state.sig;
    var i0 = Math.max(0, Math.floor(win[0] * sig.fs));
    var i1 = Math.min(sig.x.length, Math.ceil(win[1] * sig.fs));
    var m = 0;
    arrays.forEach(function (a) {
      if (!a) return;
      for (var i = i0; i < i1; i++) if (isFinite(a[i])) m = Math.max(m, Math.abs(a[i]));
    });
    if (!(m > 0)) m = 1;
    return [-m * 1.12, m * 1.12];
  }

  // ---------------------------------------------------------------- 繪製 sifting
  function renderSift() {
    var sig = state.sig;
    var t = arr(sig.t);
    var o = opts();
    var win = viewWindow();

    // ---- 主圖：h + 包絡 + 均值 + 極值點
    var series = [{ x: t, y: arr(state.h), color: '--series-1', label: '目前序列 h' }];
    var points = [];
    var envOk = false;
    var markerNote = '';

    var env = EMD.envelopes(state.h, 2);
    if (env) {
      envOk = true;
      series = [
        { x: t, y: arr(env.upper), color: '--series-2', label: '上包絡 e_max', width: 2 },
        { x: t, y: arr(env.lower), color: '--series-3', label: '下包絡 e_min', width: 2 },
        { x: t, y: arr(env.mean), color: '--text-primary', label: '均值 m = (e_max+e_min)/2', width: 2, dash: [6, 4] },
        { x: t, y: arr(state.h), color: '--series-1', label: '目前序列 h' }
      ];
      // 只計算落在顯示窗內的極值；太密就不畫標記，免得糊成一片
      var inWin = function (i) { return t[i] >= win[0] && t[i] <= win[1]; };
      var vMax = env.maxIdx.filter(inWin), vMin = env.minIdx.filter(inWin);
      if (vMax.length + vMin.length <= 150) {
        points = [
          { x: vMax.map(function (i) { return t[i]; }), y: vMax.map(function (i) { return state.h[i]; }), color: '--series-2', r: 4 },
          { x: vMin.map(function (i) { return t[i]; }), y: vMin.map(function (i) { return state.h[i]; }), color: '--series-3', r: 4 }
        ];
      } else {
        markerNote = '視窗內 ' + (vMax.length + vMin.length) + ' 個極值，標記已隱藏';
      }
    }

    Plot.line(el('siftMain'), {
      height: 260,
      title: '第 ' + (state.imfs.length + 1) + ' 層 IMF · 第 ' + state.iter + ' 次迭代後的序列 h',
      cornerNote: markerNote,
      xLabel: '時間 (s)', yLabel: sig.unit || '振幅', xUnit: 's',
      xRange: win,
      yRange: env ? winYRange(win, [state.h, env.upper, env.lower]) : winYRange(win, [state.h]),
      series: series, points: points
    });

    Plot.legend(el('siftLegend'), [
      { color: '--series-1', label: '目前序列 h' },
      { color: '--series-2', label: '上包絡 e_max（穿過局部極大）' },
      { color: '--series-2', kind: 'dot', label: '局部極大點' },
      { color: '--series-3', label: '下包絡 e_min（穿過局部極小）' },
      { color: '--series-3', kind: 'dot', label: '局部極小點' },
      { color: '--text-primary', kind: 'dash', label: '均值 m(t)' }
    ]);

    // ---- 結果圖
    if (env) {
      var h1 = new Float64Array(state.h.length);
      for (var i = 0; i < h1.length; i++) h1[i] = state.h[i] - env.mean[i];
      Plot.line(el('siftResult'), {
        height: 180,
        title: '相減結果 h − m（下一次迭代的輸入）',
        xLabel: '時間 (s)', yLabel: sig.unit || '振幅', xUnit: 's',
        xRange: win,
        yRange: winYRange(win, [state.h, h1]),
        series: [
          { x: t, y: arr(state.h), color: '--series-1', label: '目前 h', alpha: 0.30, width: 2 },
          { x: t, y: arr(h1), color: '--series-3', label: 'h − m' }
        ]
      });
      Plot.legend(el('siftResLegend'), [
        { color: '--series-3', label: 'h − m（相減結果）' },
        { color: '--series-1', label: '目前 h（淡色對照）' }
      ]);
    }

    // ---- 狀態卡
    var exn = EMD.findExtrema(state.h);
    var nE = exn.maxIdx.length + exn.minIdx.length;
    var nZ = EMD.countZeroCrossings(state.h);
    var sd = state.lastSift ? state.lastSift.res.sd : null;
    var converged = sd !== null && sd < o.sdThreshold;
    var hitMax = state.iter >= o.maxIter;

    var verdict;
    if (state.done) verdict = '<span class="tag warn">分解結束</span> 殘餘已是單調函數（極值 &lt; 3），或已達 IMF 數量上限。';
    else if (!envOk) verdict = '<span class="tag warn">無法再 sift</span> 這個序列的極值少於 3 個，沒辦法做包絡內插。';
    else if (converged) verdict = '<span class="tag ok">已收斂</span> SD &lt; 門檻 ' + o.sdThreshold.toFixed(2) + '，這層 IMF 可以定案了。按「扣掉，換下一層」。';
    else if (hitMax) verdict = '<span class="tag warn">達迭代上限</span> 已跑 ' + state.iter + ' 次仍未收斂，被 maxIter 強制中止。';
    else if (sd === null) verdict = '<span class="tag">尚未開始</span> 按「單步 sifting」跑第一次迭代。';
    else verdict = '<span class="tag">進行中</span> SD 還沒低於門檻，繼續 sifting。';

    el('siftStatus').innerHTML =
      '<div class="stat-row">' +
      '<div class="stat"><span class="v">' + (state.imfs.length + 1) + '</span><span class="l">正在抽取第幾層 IMF</span></div>' +
      '<div class="stat"><span class="v">' + state.iter + '</span><span class="l">本層已迭代次數</span></div>' +
      '<div class="stat"><span class="v">' + (sd === null ? '—' : sd.toFixed(4)) + '</span><span class="l">最近一次的 SD（門檻 ' + o.sdThreshold.toFixed(2) + '）</span></div>' +
      '<div class="stat"><span class="v">' + nE + '</span><span class="l">目前極值點數</span></div>' +
      '<div class="stat"><span class="v">' + nZ + '</span><span class="l">目前零交越數</span></div>' +
      '<div class="stat"><span class="v">' + (Math.abs(nE - nZ) <= 1 ? '滿足' : '未滿足') + '</span><span class="l">IMF 條件 |極值−零交越| ≤ 1</span></div>' +
      '</div>' +
      '<p style="margin-bottom:0">' + verdict + '</p>';

    el('btnStep').disabled = state.done || !envOk;
    el('btnPlay').disabled = state.done || !envOk;
    el('btnFinish').disabled = state.done || !envOk;
    el('btnNextImf').disabled = state.done || state.iter === 0;
  }

  // ---------------------------------------------------------------- 完整分解
  function renderFull() {
    var sig = state.sig, t = arr(sig.t), fs = sig.fs;
    var o = opts();
    var res = EMD.emd(sig.x, o);

    var totE = energy(sig.x) || 1;
    var host = el('imfStack');
    host.innerHTML = '';

    var panels = res.imfs.map(function (m, i) { return { y: m, name: 'IMF ' + (i + 1), color: '--series-1', isImf: true }; });
    panels.push({ y: res.residue, name: '殘餘 residue', color: '--series-2', isImf: false });

    panels.forEach(function (p, i) {
      var wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      wrap.style.marginBottom = '6px';
      var cv = document.createElement('canvas');
      cv.setAttribute('aria-label', p.name + ' 波形');
      wrap.appendChild(cv);
      host.appendChild(wrap);

      var note;
      if (p.isImf) {
        note = DSP.meanInstFreq(p.y, fs).toFixed(2) + ' Hz · 能量 ' +
          (energy(p.y) / totE * 100).toFixed(1) + '%';
      } else {
        note = '能量 ' + (energy(p.y) / totE * 100).toFixed(1) + '%';
      }

      Plot.line(cv, {
        height: 92,
        title: p.name,
        cornerNote: note,
        hideXAxis: i < panels.length - 1,
        xLabel: i === panels.length - 1 ? '時間 (s)' : null,
        xUnit: 's',
        yUnit: sig.unit ? ' ' + sig.unit : '',
        series: [{ x: t, y: arr(p.y), color: p.color, label: p.name }],
        ySymmetric: p.isImf
      });
    });

    Plot.legend(el('imfLegend'), [
      { color: '--series-1', label: 'IMF（本徵模態函數）' },
      { color: '--series-2', label: '殘餘 residue（單調趨勢）' }
    ]);

    // ---- 表格
    var rowsHtml = res.imfs.map(function (m, i) {
      var d = res.details[i] || {};
      var ex = EMD.findExtrema(m);
      var nE = ex.maxIdx.length + ex.minIdx.length;
      var nZ = EMD.countZeroCrossings(m);
      var ok = Math.abs(nE - nZ) <= 1;
      return '<tr>' +
        '<td>IMF ' + (i + 1) + '</td>' +
        '<td class="num">' + DSP.meanInstFreq(m, fs).toFixed(3) + '</td>' +
        '<td class="num">' + DSP.zeroCrossingFreq(m, fs).toFixed(3) + '</td>' +
        '<td class="num">' + rms(m).toFixed(4) + '</td>' +
        '<td class="num">' + (energy(m) / totE * 100).toFixed(2) + '%</td>' +
        '<td class="num">' + (d.iterations === undefined ? '—' : d.iterations) + '</td>' +
        '<td class="num">' + (d.sd === undefined || !isFinite(d.sd) ? '—' : d.sd.toFixed(4)) + '</td>' +
        '<td>' + (ok ? '<span class="tag ok">滿足</span>' : '<span class="tag warn">未滿足</span>') +
        ' <span style="color:var(--text-muted);font-size:0.78rem">' + nE + '/' + nZ + '</span></td>' +
        '</tr>';
    }).join('');

    el('imfTable').innerHTML =
      '<caption class="sr-only">各層 IMF 的頻率、振幅、能量與 IMF 條件檢查</caption>' +
      '<thead><tr><th>層</th><th class="num">平均瞬時頻率 (Hz)</th><th class="num">零交越估頻 (Hz)</th>' +
      '<th class="num">RMS</th><th class="num">能量佔比</th><th class="num">sifting 次數</th>' +
      '<th class="num">收斂 SD</th><th>IMF 條件（極值/零交越）</th></tr></thead>' +
      '<tbody>' + (rowsHtml || '<tr><td colspan="8">這個訊號分不出 IMF（可能已是單調函數）。</td></tr>') +
      '<tr><td>殘餘</td><td class="num">—</td><td class="num">—</td><td class="num">' +
      rms(res.residue).toFixed(4) + '</td><td class="num">' +
      (energy(res.residue) / totE * 100).toFixed(2) + '%</td><td class="num">—</td><td class="num">—</td><td>—</td></tr>' +
      '</tbody>';

    // ---- Hilbert 時頻譜
    var tracks = res.imfs.map(function (m) {
      var h = DSP.hilbertSpectrum(m, fs);
      return { t: t, f: arr(h.frequency), a: arr(h.amplitude) };
    });
    Plot.hilbert(el('hhtCv'), {
      height: 300,
      title: 'Hilbert 時頻譜：' + res.imfs.length + ' 層 IMF 疊加',
      xLabel: '時間 (s)', yLabel: '瞬時頻率 (Hz)',
      fMax: Math.min(fs / 2, 45),
      tRange: [t[0], t[t.length - 1]],
      tracks: tracks
    });

    // ---- 重建誤差
    var recon = new Float64Array(sig.x.length);
    for (var q = 0; q < res.imfs.length; q++)
      for (var k = 0; k < recon.length; k++) recon[k] += res.imfs[q][k];
    for (var k2 = 0; k2 < recon.length; k2++) recon[k2] += res.residue[k2];
    var err = new Float64Array(recon.length);
    var maxErr = 0;
    for (var k3 = 0; k3 < recon.length; k3++) {
      err[k3] = recon[k3] - sig.x[k3];
      maxErr = Math.max(maxErr, Math.abs(err[k3]));
    }

    Plot.line(el('reconCv'), {
      height: 150,
      title: '重建誤差 Σ IMF + residue − x(t)',
      xLabel: '時間 (s)', yLabel: '誤差', xUnit: 's',
      series: [{ x: t, y: arr(err), color: '--series-2', label: '重建誤差' }],
      yRange: [-Math.max(1e-16, maxErr * 1.3), Math.max(1e-16, maxErr * 1.3)]
    });
    Plot.legend(el('reconLegend'), [{ color: '--series-2', label: '重建誤差（逐點）' }]);
    el('reconCap').innerHTML =
      'EMD 在定義上就是<strong>完全可逆</strong>的——每一層都是「減出來」的，加回去必然等於原訊號。' +
      '本次最大絕對誤差 <strong>' + maxErr.toExponential(2) + '</strong>，' +
      '這是 IEEE 754 雙精度浮點的捨入極限（≈ 10⁻¹⁶ × 訊號量級），不是演算法誤差。' +
      '（相較之下，EEMD 為了抑制 mode mixing 加了雜訊再平均，<strong>會犧牲這個完全重建性</strong>。）';
  }

  // ---------------------------------------------------------------- 手繪
  function setupDraw() {
    var cv = el('drawCv');
    var drawing = false;

    function redraw() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = cv.clientWidth || 600, h = 200;
      cv.style.height = h + 'px';
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      var g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = Plot.cssVar('--grid'); g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.fillStyle = Plot.cssVar('--text-muted');
      g.font = '12px system-ui, sans-serif';
      if (!state.drawPoints.length) g.fillText('在這裡按住拖曳畫出波形', 12, 20);
      if (state.drawPoints.length > 1) {
        g.strokeStyle = Plot.cssVar('--series-1'); g.lineWidth = 2;
        g.lineJoin = 'round'; g.lineCap = 'round';
        g.beginPath();
        state.drawPoints.forEach(function (p, i) {
          var x = p.x * w, y = h / 2 - p.y * (h / 2 - 8);
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.stroke();
      }
    }

    function add(ev) {
      var r = cv.getBoundingClientRect();
      var cx = (ev.clientX - r.left) / r.width;
      var cy = (ev.clientY - r.top) / r.height;
      if (cx < 0 || cx > 1) return;
      var y = (0.5 - cy) * 2;
      // 同一 x 只留最後一筆，讓來回塗改也不會出現多值
      var pts = state.drawPoints;
      if (pts.length && Math.abs(pts[pts.length - 1].x - cx) < 0.002) pts[pts.length - 1].y = y;
      else pts.push({ x: cx, y: Math.max(-1, Math.min(1, y)) });
      redraw();
    }

    cv.addEventListener('pointerdown', function (e) {
      drawing = true; cv.setPointerCapture(e.pointerId); add(e); e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) { if (drawing) add(e); });
    cv.addEventListener('pointerup', function () {
      drawing = false;
      if (state.drawPoints.length > 3) loadSignal();
    });
    el('drawClear').addEventListener('click', function () {
      state.drawPoints = []; redraw();
      if (ui.sigSel.value === 'draw') loadSignal();
    });
    window.addEventListener('resize', function () { setTimeout(redraw, 130); });
    redraw();
    state.redrawDraw = redraw;
  }

  // ---------------------------------------------------------------- 綁定
  ui.sigSel.addEventListener('change', loadSignal);
  [['sdT', 'sdTv', 2], ['maxIt', 'maxItv', 0], ['maxImf', 'maxImfv', 0]].forEach(function (p) {
    ui[p[0]].addEventListener('input', function () {
      ui[p[1]].textContent = parseFloat(ui[p[0]].value).toFixed(p[2]);
      renderSift();
      renderFull();
    });
  });

  ['winW', 'winS'].forEach(function (id) {
    el(id).addEventListener('input', renderSift);
  });

  el('btnStep').addEventListener('click', function () { stopPlay(); stepOnce(); });
  el('btnPlay').addEventListener('click', togglePlay);
  el('btnFinish').addEventListener('click', finishImf);
  el('btnNextImf').addEventListener('click', nextImf);
  el('btnReset').addEventListener('click', resetSifting);

  setupDraw();
  loadSignal();
})();
