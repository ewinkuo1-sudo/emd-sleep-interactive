/* signals.js — 內建測試訊號產生器
 * 所有合成睡眠 EEG 皆為「示範用模擬訊號」，不是真實人體紀錄。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Signals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNoise(seed) {
    var r = mulberry32(seed);
    return function () {
      var u = 0, v = 0;
      while (u === 0) u = r();
      while (v === 0) v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
  }

  function timeAxis(n, fs) {
    var t = new Float64Array(n);
    for (var i = 0; i < n; i++) t[i] = i / fs;
    return t;
  }

  /** 雙頻合成：驗證 EMD 正確性的黃金標準。IMF1 應為 f2、IMF2 應為 f1。 */
  function twoTone(opts) {
    opts = opts || {};
    var fs = opts.fs || 200, n = opts.n || 1024;
    var f1 = opts.f1 === undefined ? 1 : opts.f1;
    var f2 = opts.f2 === undefined ? 12 : opts.f2;
    var a1 = opts.a1 === undefined ? 1.0 : opts.a1;
    var a2 = opts.a2 === undefined ? 0.5 : opts.a2;
    var x = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var t = i / fs;
      x[i] = a1 * Math.sin(2 * Math.PI * f1 * t) + a2 * Math.sin(2 * Math.PI * f2 * t);
    }
    return { x: x, t: timeAxis(n, fs), fs: fs, label: '雙頻合成 ' + f1 + ' Hz + ' + f2 + ' Hz' };
  }

  /** 線性 chirp：頻率隨時間線性上升。FFT 只會看到一坨糊掉的寬頻。 */
  function chirp(opts) {
    opts = opts || {};
    var fs = opts.fs || 200, n = opts.n || 1024;
    var f0 = opts.f0 === undefined ? 2 : opts.f0;
    var f1 = opts.f1 === undefined ? 25 : opts.f1;
    var dur = n / fs;
    var k = (f1 - f0) / dur;
    var x = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var t = i / fs;
      x[i] = Math.sin(2 * Math.PI * (f0 * t + 0.5 * k * t * t));
    }
    return { x: x, t: timeAxis(n, fs), fs: fs, label: 'Chirp ' + f0 + '→' + f1 + ' Hz' };
  }

  /** 雙頻 + 白雜訊。 */
  function noisyTwoTone(opts) {
    opts = opts || {};
    var base = twoTone(opts);
    var nz = makeNoise(opts.seed === undefined ? 7 : opts.seed);
    var amp = opts.noise === undefined ? 0.15 : opts.noise;
    var x = new Float64Array(base.x.length);
    for (var i = 0; i < x.length; i++) x[i] = base.x[i] + amp * nz();
    return { x: x, t: base.t, fs: base.fs, label: base.label + ' + 雜訊(σ=' + amp + ')' };
  }

  /** 間歇性高頻叢發 —— 經典的 mode mixing 製造機。 */
  function intermittent(opts) {
    opts = opts || {};
    var fs = opts.fs || 200, n = opts.n || 1024;
    var x = new Float64Array(n);
    var burstStart = Math.floor(n * 0.35), burstEnd = Math.floor(n * 0.45);
    for (var i = 0; i < n; i++) {
      var t = i / fs;
      x[i] = Math.sin(2 * Math.PI * 2 * t);
      if (i >= burstStart && i < burstEnd) {
        // 加 Hann 包絡讓叢發平滑進出
        var p = (i - burstStart) / (burstEnd - burstStart);
        x[i] += 0.4 * 0.5 * (1 - Math.cos(2 * Math.PI * p)) * Math.sin(2 * Math.PI * 30 * t);
      }
    }
    return { x: x, t: timeAxis(n, fs), fs: fs, label: '間歇叢發（示範 mode mixing）' };
  }

  /**
   * 模擬睡眠 EEG 片段。fs 預設 100 Hz（一般 PSG 常見取樣率）。
   * stage: 'W' | 'N1' | 'N2' | 'N3' | 'REM'
   * 各期依 AASM 判讀特徵合成：
   *   W   — alpha 為主（閉眼枕區 8–13 Hz）+ 高頻 beta
   *   N1  — alpha 消退、theta（4–8 Hz）為主
   *   N2  — theta 底噪 + sleep spindle（11–16 Hz 叢發）+ K-complex（尖銳慢波）
   *   N3  — delta（0.5–4 Hz）大振幅慢波為主
   *   REM — 低振幅混合頻率，接近 N1 但帶鋸齒波
   * ⚠️ 這是教學用的合成訊號，形態上像但不是真實 PSG 資料。
   */
  function sleepEEG(stage, opts) {
    opts = opts || {};
    var fs = opts.fs || 100;
    var n = opts.n || 1000;              // 10 秒
    var nz = makeNoise(opts.seed === undefined ? 11 : opts.seed);
    var x = new Float64Array(n);
    var notes = [];

    function addSine(f, a, phase) {
      for (var i = 0; i < n; i++) x[i] += a * Math.sin(2 * Math.PI * f * i / fs + (phase || 0));
    }
    function addNoise(a) { for (var i = 0; i < n; i++) x[i] += a * nz(); }
    // 叢發包絡用 Tukey 窗（兩端餘弦漸變、中間持平），不是 Hann。
    // 真實紡錘波的振幅是「起來 → 維持 → 收掉」，用 Hann 會讓一個 1 秒的叢發
    // 實際上只有約 0.5 秒維持在高振幅，比 AASM 的 ≥0.5 秒判讀標準還短。
    function addBurst(fCenter, amp, tStart, dur, taperSec) {
      var s = Math.floor(tStart * fs), e = Math.min(n, s + Math.floor(dur * fs));
      var len = e - s;
      var ramp = Math.max(1, Math.floor((taperSec === undefined ? 0.2 : taperSec) * fs));
      for (var i = s; i < e; i++) {
        var k = i - s, win;
        if (k < ramp) win = 0.5 * (1 - Math.cos(Math.PI * k / ramp));
        else if (k > len - ramp) win = 0.5 * (1 - Math.cos(Math.PI * (len - k) / ramp));
        else win = 1;
        x[i] += amp * win * Math.sin(2 * Math.PI * fCenter * k / fs);
      }
    }
    function addKComplex(tStart) {
      // K-complex：先一個明顯的負向尖峰，再一個較寬的正向反彈，約 0.7 s
      var s = Math.floor(tStart * fs), len = Math.floor(0.7 * fs);
      for (var i = 0; i < len && s + i < n; i++) {
        var p = i / len;
        x[s + i] += -60 * Math.exp(-Math.pow((p - 0.25) / 0.10, 2))
                    + 45 * Math.exp(-Math.pow((p - 0.60) / 0.16, 2));
      }
    }

    switch (stage) {
      case 'W':
        addSine(10, 25); addSine(9.3, 12, 1.1);
        addSine(20, 6, 0.4); addSine(26, 4, 2.0);
        addNoise(5);
        notes = ['alpha 10 Hz 為主（清醒閉眼）', 'beta 20–26 Hz 低振幅'];
        break;
      case 'N1':
        addSine(6, 22); addSine(4.6, 14, 0.8);
        addSine(10, 6, 1.5);
        addNoise(5);
        notes = ['theta 4–8 Hz 為主', 'alpha 已明顯消退'];
        break;
      case 'N2':
        addSine(5.5, 14); addSine(2.5, 18, 0.5);
        addBurst(13.5, 30, 2.0, 1.0);     // sleep spindle #1
        addBurst(12.5, 26, 6.4, 0.9);     // sleep spindle #2
        addKComplex(4.2);
        addNoise(5);
        notes = ['theta 底噪', 'sleep spindle 13.5 Hz @2.0 s、12.5 Hz @6.4 s', 'K-complex @4.2 s'];
        break;
      case 'N3':
        addSine(1.0, 60); addSine(2.2, 34, 1.2); addSine(0.6, 40, 0.3);
        addSine(6, 6, 2.2);
        addNoise(5);
        notes = ['delta 0.5–4 Hz 高振幅慢波為主（>75 µV）'];
        break;
      case 'REM':
        addSine(6.5, 16); addSine(8.5, 10, 0.9);
        addSine(17, 5, 2.4);
        // 鋸齒波（sawtooth waves）：2–6 Hz 的三角形叢發
        (function () {
          var s = Math.floor(3.0 * fs), len = Math.floor(1.6 * fs);
          for (var i = 0; i < len && s + i < n; i++) {
            var ph = (i / fs) * 3.0 % 1;
            x[s + i] += 14 * (2 * Math.abs(2 * ph - 1) - 1);
          }
        })();
        addNoise(6);
        notes = ['低振幅混合頻率（theta 為主）', 'sawtooth waves @3.0–4.6 s'];
        break;
      default:
        addNoise(10);
    }

    return {
      x: x, t: timeAxis(n, fs), fs: fs,
      label: '模擬睡眠 EEG — ' + stage + ' 期',
      stage: stage, notes: notes, unit: 'µV'
    };
  }

  /** 使用者手繪訊號：把稀疏控制點重新取樣成 n 點（線性內插）。 */
  function fromPoints(points, n, fs) {
    var out = new Float64Array(n);
    if (!points.length) return { x: out, t: timeAxis(n, fs), fs: fs, label: '手繪訊號' };
    var pts = points.slice().sort(function (a, b) { return a.x - b.x; });
    for (var i = 0; i < n; i++) {
      var u = i / (n - 1);
      if (u <= pts[0].x) { out[i] = pts[0].y; continue; }
      if (u >= pts[pts.length - 1].x) { out[i] = pts[pts.length - 1].y; continue; }
      for (var k = 1; k < pts.length; k++) {
        if (pts[k].x >= u) {
          var f = (u - pts[k - 1].x) / Math.max(1e-9, pts[k].x - pts[k - 1].x);
          out[i] = pts[k - 1].y + f * (pts[k].y - pts[k - 1].y);
          break;
        }
      }
    }
    return { x: out, t: timeAxis(n, fs), fs: fs, label: '手繪訊號' };
  }

  return {
    twoTone: twoTone,
    chirp: chirp,
    noisyTwoTone: noisyTwoTone,
    intermittent: intermittent,
    sleepEEG: sleepEEG,
    fromPoints: fromPoints,
    timeAxis: timeAxis
  };
});
