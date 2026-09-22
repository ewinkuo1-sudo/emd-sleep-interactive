/* spindle.js — 基於 Hilbert-Huang 轉換的睡眠紡錘波偵測（教學用簡化版）
 *
 * 作法沿用 HHT 系列文獻的共同骨架（見 papers.html 的 Chen et al. 2006 與 Li et al. 2010）：
 *   1. EMD 把 EEG 拆成 IMF
 *   2. 對每層 IMF 做 Hilbert 轉換，得到瞬時振幅 A(t) 與瞬時頻率 f(t)
 *   3. 選出瞬時頻率主要落在紡錘波帶（11–16 Hz）的那層 IMF
 *   4. 在該層上找「振幅超過門檻、頻率在帶內、持續 ≥ 0.5 秒」的區段
 *
 * ⚠️ 這是示範用的最小實作，不是臨床可用的偵測器。真實 PSG 還需要處理
 *    肌電雜訊、眼動假影、參考電極選擇、個體間頻率差異與多通道一致性。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dsp.js'), require('./emd.js'));
  else root.Spindle = factory(root.DSP, root.EMD);
})(typeof self !== 'undefined' ? self : this, function (DSP, EMD) {
  'use strict';

  /** 移動平均平滑，winSec 秒。 */
  function smooth(x, fs, winSec) {
    var w = Math.max(1, Math.round(winSec * fs));
    var out = new Float64Array(x.length);
    var half = Math.floor(w / 2);
    var acc = 0, cnt = 0;
    for (var i = 0; i < x.length; i++) {
      var lo = Math.max(0, i - half), hi = Math.min(x.length - 1, i + half);
      if (i === 0) {
        acc = 0; cnt = 0;
        for (var k = lo; k <= hi; k++) { acc += x[k]; cnt++; }
      } else {
        var prevLo = Math.max(0, i - 1 - half), prevHi = Math.min(x.length - 1, i - 1 + half);
        if (lo > prevLo) { acc -= x[prevLo]; cnt--; }
        if (hi > prevHi) { acc += x[hi]; cnt++; }
      }
      out[i] = acc / cnt;
    }
    return out;
  }

  function median(a) {
    var s = Array.prototype.slice.call(a).sort(function (p, q) { return p - q; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * detect(signal, fs, opts)
   * opts: { band=[11,16], minDur=0.5, maxDur=3.0, thresholdK=1.5,
   *         smoothSec=0.25, gapSec=0.15, maxImf=8,
   *         decomposition }   ← 已算好的 EMD.emd() 結果；有給就不重算
   * 回傳 {
   *   imfIndex, imf, amplitude, frequency, threshold,
   *   events:[{ t0, t1, dur, peakAmp, meanFreq }],
   *   imfScores:[{ index, bandFraction, meanFreqInBand }]
   * }
   * imfIndex = -1 表示沒有任何 IMF 的能量主要落在紡錘波帶。
   */
  function detect(signal, fs, opts) {
    opts = opts || {};
    var band = opts.band || [11, 16];
    var minDur = opts.minDur === undefined ? 0.5 : opts.minDur;
    var maxDur = opts.maxDur === undefined ? 3.0 : opts.maxDur;
    var K = opts.thresholdK === undefined ? 1.5 : opts.thresholdK;
    var smoothSec = opts.smoothSec === undefined ? 0.25 : opts.smoothSec;

    var res = opts.decomposition ||
      EMD.emd(signal, { maxImf: opts.maxImf || 8, sdThreshold: 0.2, maxIter: 100 });
    var n = signal.length;

    // ---- 挑選紡錘波所在的 IMF：算「瞬時頻率落在帶內的能量佔該層總能量的比例」
    var scores = [];
    var cache = [];
    res.imfs.forEach(function (m, idx) {
      var h = DSP.hilbertSpectrum(m, fs);
      cache.push(h);
      var inBand = 0, total = 0, wf = 0;
      var lo = Math.floor(n * 0.05), hi = Math.ceil(n * 0.95);   // 去掉端點效應區
      for (var i = lo; i < hi; i++) {
        var w = h.amplitude[i] * h.amplitude[i];
        if (!isFinite(w)) continue;
        total += w;
        if (h.frequency[i] >= band[0] && h.frequency[i] <= band[1]) { inBand += w; wf += w * h.frequency[i]; }
      }
      scores.push({
        index: idx,
        bandFraction: total > 0 ? inBand / total : 0,
        bandEnergy: inBand,
        meanFreqInBand: inBand > 0 ? wf / inBand : NaN
      });
    });

    // 取帶內能量絕對值最大的那層（而非比例最大），避免挑到能量極小的高層
    var best = -1, bestE = 0;
    scores.forEach(function (s) {
      if (s.bandEnergy > bestE) { bestE = s.bandEnergy; best = s.index; }
    });

    if (best < 0) {
      return { imfIndex: -1, events: [], imfScores: scores, decomposition: res };
    }

    var h = cache[best];
    var ampS = smooth(h.amplitude, fs, smoothSec);

    // 瞬時頻率在含雜訊的 IMF 上會逐點劇烈跳動，直接拿來當門檻會讓任何區段
    // 都撐不過 0.5 秒。改用「振幅平方加權後平滑」的頻率——等於問
    //「這 0.2 秒裡，能量主要集中在哪個頻率」。
    var wNum = new Float64Array(n), wDen = new Float64Array(n);
    for (var i1 = 0; i1 < n; i1++) {
      var w1 = h.amplitude[i1] * h.amplitude[i1];
      var f1 = h.frequency[i1];
      if (isFinite(f1) && f1 > 0 && isFinite(w1)) { wNum[i1] = w1 * f1; wDen[i1] = w1; }
    }
    var sNum = smooth(wNum, fs, 0.2), sDen = smooth(wDen, fs, 0.2);
    var freqS = new Float64Array(n);
    for (var i9 = 0; i9 < n; i9++) freqS[i9] = sDen[i9] > 0 ? sNum[i9] / sDen[i9] : NaN;

    // ---- 門檻：中位數 + K × 標準差（用中位數比用平均穩健，紡錘波本身會拉高平均）
    var med = median(ampS);
    var sd = 0;
    for (var i2 = 0; i2 < n; i2++) sd += (ampS[i2] - med) * (ampS[i2] - med);
    sd = Math.sqrt(sd / n);
    var thr = med + K * sd;

    // ---- 找連續超過門檻、且（平滑後的）頻率在帶內的區段
    var guardLo = Math.floor(n * 0.03), guardHi = Math.ceil(n * 0.97);
    var mask = new Uint8Array(n);
    for (var i3 = 0; i3 < n; i3++) {
      mask[i3] = (i3 >= guardLo && i3 < guardHi &&
        ampS[i3] > thr &&
        freqS[i3] >= band[0] - 1.5 && freqS[i3] <= band[1] + 1.5) ? 1 : 0;
    }
    // 補洞：振幅在紡錘波中途短暫跌破門檻是常態，小於 gapSec 的空隙直接接起來
    var gap = Math.round((opts.gapSec === undefined ? 0.15 : opts.gapSec) * fs);
    for (var a = 0; a < n; a++) {
      if (mask[a]) continue;
      var b = a;
      while (b < n && !mask[b]) b++;
      if (a > 0 && b < n && (b - a) <= gap) for (var c = a; c < b; c++) mask[c] = 1;
      a = b - 1;
    }

    var events = [];
    var start = -1;
    for (var i4 = 0; i4 < n; i4++) {
      var ok = !!mask[i4];
      if (ok && start < 0) start = i4;
      if ((!ok || i4 === n - 1) && start >= 0) {
        var end = ok ? i4 : i4 - 1;
        var dur = (end - start + 1) / fs;
        if (dur >= minDur && dur <= maxDur) {
          var peak = 0, fsum = 0, fw = 0;
          for (var k2 = start; k2 <= end; k2++) {
            peak = Math.max(peak, h.amplitude[k2]);
            var w2 = h.amplitude[k2] * h.amplitude[k2];
            if (isFinite(h.frequency[k2])) { fsum += w2 * h.frequency[k2]; fw += w2; }
          }
          events.push({
            t0: start / fs, t1: (end + 1) / fs, dur: dur,
            peakAmp: peak, meanFreq: fw > 0 ? fsum / fw : NaN
          });
        }
        start = -1;
      }
    }

    return {
      imfIndex: best,
      imf: res.imfs[best],
      amplitude: h.amplitude,
      amplitudeSmoothed: ampS,
      frequency: h.frequency,
      frequencySmoothed: freqS,
      threshold: thr,
      events: events,
      imfScores: scores,
      decomposition: res
    };
  }

  return { detect: detect, smooth: smooth };
});
