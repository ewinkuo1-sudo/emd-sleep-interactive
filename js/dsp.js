/* dsp.js — FFT / Hilbert / 瞬時頻率
 * 純 vanilla JS，無外部相依。可在瀏覽器（global DSP）與 Node（module.exports）使用。
 * FFT：基-2 Cooley-Tukey；非 2 冪長度時自動改用 Bluestein chirp-z，
 *      這樣 Hilbert transform 不需要補零（補零會扭曲解析訊號）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DSP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nextPow2(n) {
    var m = 1;
    while (m < n) m *= 2;
    return m;
  }

  /* 原地基-2 FFT。re/im 長度必須是 2 的冪。inverse=true 時不做 1/N 正規化。 */
  function fftRadix2(re, im, inverse) {
    var n = re.length;
    if (n <= 1) return;
    // bit reversal
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (inverse ? 2 : -2) * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s = 0; s < n; s += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var ur = re[s + k], ui = im[s + k];
          var vr = re[s + k + len / 2] * cr - im[s + k + len / 2] * ci;
          var vi = re[s + k + len / 2] * ci + im[s + k + len / 2] * cr;
          re[s + k] = ur + vr; im[s + k] = ui + vi;
          re[s + k + len / 2] = ur - vr; im[s + k + len / 2] = ui - vi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  /* Bluestein chirp-z：任意長度 DFT。 */
  function fftBluestein(re, im, inverse) {
    var n = re.length;
    var m = nextPow2(2 * n + 1);
    var sign = inverse ? 1 : -1;
    // chirp[i] = exp(j*sign*pi*i^2/n)
    var cosT = new Float64Array(n), sinT = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      // 用 (i*i) mod (2n) 避免大數平方的精度流失
      var j = (i * i) % (2 * n);
      var ang = Math.PI * j / n;
      cosT[i] = Math.cos(ang);
      sinT[i] = sign * Math.sin(ang);
    }
    // a[i] = x[i] * chirp[i]
    var ar = new Float64Array(m), ai = new Float64Array(m);
    for (var i2 = 0; i2 < n; i2++) {
      ar[i2] = re[i2] * cosT[i2] - im[i2] * sinT[i2];
      ai[i2] = re[i2] * sinT[i2] + im[i2] * cosT[i2];
    }
    // b[i] = conj(chirp[i])，並做對稱延伸 b[m-i] = b[i]
    var br = new Float64Array(m), bi = new Float64Array(m);
    br[0] = cosT[0]; bi[0] = -sinT[0];
    for (var i3 = 1; i3 < n; i3++) {
      br[i3] = br[m - i3] = cosT[i3];
      bi[i3] = bi[m - i3] = -sinT[i3];
    }
    fftRadix2(ar, ai, false);
    fftRadix2(br, bi, false);
    for (var i4 = 0; i4 < m; i4++) {
      var tr = ar[i4] * br[i4] - ai[i4] * bi[i4];
      ai[i4] = ar[i4] * bi[i4] + ai[i4] * br[i4];
      ar[i4] = tr;
    }
    fftRadix2(ar, ai, true);
    for (var i5 = 0; i5 < m; i5++) { ar[i5] /= m; ai[i5] /= m; }
    // y[k] = chirp[k] * conv[k]
    for (var i6 = 0; i6 < n; i6++) {
      re[i6] = ar[i6] * cosT[i6] - ai[i6] * sinT[i6];
      im[i6] = ar[i6] * sinT[i6] + ai[i6] * cosT[i6];
    }
  }

  /* 對任意長度做 FFT。回傳新陣列 {re, im}。 */
  function fft(input, imagIn) {
    var n = input.length;
    var re = Float64Array.from(input);
    var im = imagIn ? Float64Array.from(imagIn) : new Float64Array(n);
    if ((n & (n - 1)) === 0) fftRadix2(re, im, false);
    else fftBluestein(re, im, false);
    return { re: re, im: im };
  }

  function ifft(re0, im0) {
    var n = re0.length;
    var re = Float64Array.from(re0);
    var im = Float64Array.from(im0);
    if ((n & (n - 1)) === 0) fftRadix2(re, im, true);
    else fftBluestein(re, im, true);
    for (var i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    return { re: re, im: im };
  }

  /* 單邊振幅頻譜。回傳 {freq, mag}，freq 單位 Hz。 */
  function magnitudeSpectrum(x, fs) {
    var n = x.length;
    var F = fft(x);
    var half = Math.floor(n / 2) + 1;
    var freq = new Float64Array(half);
    var mag = new Float64Array(half);
    for (var k = 0; k < half; k++) {
      freq[k] = k * fs / n;
      var m = Math.sqrt(F.re[k] * F.re[k] + F.im[k] * F.im[k]) / n;
      mag[k] = (k === 0 || (n % 2 === 0 && k === half - 1)) ? m : 2 * m;
    }
    return { freq: freq, mag: mag };
  }

  /* 解析訊號（Hilbert transform）：z = x + i*H{x}
   * 作法：FFT → 正頻率 ×2、負頻率歸零 → IFFT。 */
  function analyticSignal(x) {
    var n = x.length;
    var F = fft(x);
    var re = F.re, im = F.im;
    var half = n % 2 === 0 ? n / 2 : (n - 1) / 2;
    if (n % 2 === 0) {
      for (var k = 1; k < half; k++) { re[k] *= 2; im[k] *= 2; }
      for (var k2 = half + 1; k2 < n; k2++) { re[k2] = 0; im[k2] = 0; }
    } else {
      for (var k3 = 1; k3 <= half; k3++) { re[k3] *= 2; im[k3] *= 2; }
      for (var k4 = half + 1; k4 < n; k4++) { re[k4] = 0; im[k4] = 0; }
    }
    return ifft(re, im);
  }

  function unwrap(phase) {
    var out = new Float64Array(phase.length);
    if (!phase.length) return out;
    out[0] = phase[0];
    var offset = 0;
    for (var i = 1; i < phase.length; i++) {
      var d = phase[i] - phase[i - 1];
      if (d > Math.PI) offset -= 2 * Math.PI;
      else if (d < -Math.PI) offset += 2 * Math.PI;
      out[i] = phase[i] + offset;
    }
    return out;
  }

  /* Hilbert 瞬時振幅、相位、頻率。
   * 頻率用中央差分估計 dφ/dt，單位 Hz。 */
  function hilbertSpectrum(x, fs) {
    var z = analyticSignal(x);
    var n = x.length;
    var amp = new Float64Array(n);
    var ph = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      amp[i] = Math.hypot(z.re[i], z.im[i]);
      ph[i] = Math.atan2(z.im[i], z.re[i]);
    }
    var up = unwrap(ph);
    var freq = new Float64Array(n);
    for (var j = 0; j < n; j++) {
      var d;
      if (j === 0) d = up[1] - up[0];
      else if (j === n - 1) d = up[n - 1] - up[n - 2];
      else d = (up[j + 1] - up[j - 1]) / 2;
      freq[j] = d * fs / (2 * Math.PI);
    }
    return { amplitude: amp, phase: up, frequency: freq };
  }

  /* 依振幅加權的平均瞬時頻率——用來標記某層 IMF 的「主頻」。
   * 只取中間 80% 避免端點效應污染。 */
  function meanInstFreq(x, fs) {
    var h = hilbertSpectrum(x, fs);
    var n = x.length;
    var lo = Math.floor(n * 0.1), hi = Math.ceil(n * 0.9);
    var num = 0, den = 0;
    for (var i = lo; i < hi; i++) {
      var w = h.amplitude[i] * h.amplitude[i];
      if (h.frequency[i] > 0 && isFinite(h.frequency[i])) { num += w * h.frequency[i]; den += w; }
    }
    // 寬頻 / 類雜訊的 IMF 瞬時頻率會頻繁翻負，此時退回零交越估計
    return den > 0 ? num / den : zeroCrossingFreq(x, fs);
  }

  /** 指定時間窗內的振幅加權瞬時頻率——用來在 IMF 裡定位 spindle 這種短暫事件。 */
  function localInstFreq(x, fs, i0, i1) {
    var h = hilbertSpectrum(x, fs);
    var num = 0, den = 0;
    for (var i = Math.max(0, i0); i < Math.min(x.length, i1); i++) {
      var w = h.amplitude[i] * h.amplitude[i];
      if (h.frequency[i] > 0 && isFinite(h.frequency[i])) { num += w * h.frequency[i]; den += w; }
    }
    return { freq: den > 0 ? num / den : NaN, power: den };
  }

  /* 零交越計數估頻——不依賴 Hilbert，用來交叉驗證。 */
  function zeroCrossingFreq(x, fs) {
    var c = 0;
    for (var i = 1; i < x.length; i++) if ((x[i - 1] < 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] < 0)) c++;
    return c * fs / (2 * (x.length - 1));
  }

  /**
   * 短時傅立葉轉換。winLen 為窗長（樣本數），hop 為位移。
   * 回傳 { nt, nf, fMax, power }——power 是 nt×nf 的能量格點（row-major，t 為外層）。
   * 用來跟 Hilbert 時頻譜對照：STFT 的時間解析度被窗長綁死，改不了。
   */
  function stft(x, fs, winLen, hop) {
    winLen = winLen || 128;
    hop = hop || Math.max(1, Math.round(winLen / 16));
    var n = x.length;
    // 訊號比窗短時，把窗縮到訊號長度（偶數），否則會讀到陣列外、整張圖變 NaN
    if (n < winLen) winLen = Math.max(2, n - (n % 2));
    var nt = Math.max(1, Math.floor((n - winLen) / hop) + 1);
    var nf = Math.floor(winLen / 2) + 1;
    var win = new Float64Array(winLen);
    for (var i = 0; i < winLen; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (winLen - 1)));  // Hann
    var out = new Float64Array(nt * nf);
    var seg = new Float64Array(winLen);
    for (var s = 0; s < nt; s++) {
      var off = s * hop;
      for (var k = 0; k < winLen; k++) seg[k] = x[off + k] * win[k];
      var F = fft(seg);
      for (var b = 0; b < nf; b++) out[s * nf + b] = F.re[b] * F.re[b] + F.im[b] * F.im[b];
    }
    return { nt: nt, nf: nf, fMax: fs / 2, power: out, winLen: winLen, hop: hop, fs: fs };
  }

  /* 簡易 FIR band-pass（窗函數法，Hamming）——睡眠頁「固定濾波器組」對照組用。
   * 對稱 FIR 以中心對齊做卷積本身就是零相位（群延遲 = 0），不需要像 IIR 那樣
   * 正反各跑一次；多跑一次只會把頻率響應平方，讓 −6 dB 的帶緣變成 −12 dB。 */
  function bandpass(x, fs, f1, f2, taps) {
    taps = taps || 257;
    if (taps % 2 === 0) taps += 1;
    var h = new Float64Array(taps);
    var mid = (taps - 1) / 2;
    var w1 = 2 * f1 / fs, w2 = 2 * f2 / fs;
    for (var i = 0; i < taps; i++) {
      var m = i - mid;
      var lp2 = m === 0 ? w2 : Math.sin(Math.PI * w2 * m) / (Math.PI * m);
      var lp1 = m === 0 ? w1 : Math.sin(Math.PI * w1 * m) / (Math.PI * m);
      var win = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1));
      h[i] = (lp2 - lp1) * win;
    }
    // 單次中心對齊卷積即為零相位；邊界用鏡像延伸
    return convSym(x, h);
  }

  function convSym(x, h) {
    var n = x.length, m = h.length, mid = (m - 1) / 2;
    var y = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var acc = 0;
      for (var k = 0; k < m; k++) {
        var idx = i + k - mid;
        if (idx < 0) idx = -idx;                       // 鏡像
        if (idx >= n) idx = 2 * n - 2 - idx;
        if (idx < 0) idx = 0;                          // 訊號比濾波器還短時，鏡射一次仍可能出界
        if (idx >= n) idx = n - 1;
        acc += h[k] * x[idx];
      }
      y[i] = acc;
    }
    return y;
  }

  return {
    fft: fft,
    ifft: ifft,
    magnitudeSpectrum: magnitudeSpectrum,
    analyticSignal: analyticSignal,
    hilbertSpectrum: hilbertSpectrum,
    meanInstFreq: meanInstFreq,
    localInstFreq: localInstFreq,
    zeroCrossingFreq: zeroCrossingFreq,
    unwrap: unwrap,
    bandpass: bandpass,
    stft: stft,
    nextPow2: nextPow2
  };
});
