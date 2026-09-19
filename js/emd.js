/* emd.js — Empirical Mode Decomposition（經驗模態分解）核心實作
 *
 * 完全從頭實作，不依賴任何外部數學函式庫。演算法依據：
 *   Huang, N.E. et al. (1998) "The empirical mode decomposition and the Hilbert
 *   spectrum for nonlinear and non-stationary time series analysis",
 *   Proc. R. Soc. Lond. A 454:903–995.
 *
 * 端點處理採 Rilling, Flandrin & Gonçalvès (2003) 的鏡像對稱延伸
 *   ("On empirical mode decomposition and its algorithms", IEEE-EURASIP NSIP-03)
 *   的作法（boundary_conditions，nbsym 個極值鏡射）。
 *
 * 可在瀏覽器（global EMD）與 Node（module.exports）使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EMD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 工具

  function toArray(x) {
    return x instanceof Float64Array ? x : Float64Array.from(x);
  }

  /** MATLAB 風格 1-based inclusive 切片，轉成 JS。a、b 為 1-based。 */
  function mslice(arr, a, b) {
    if (b < a) return [];
    return arr.slice(a - 1, b);
  }

  /** 找出局部極大與極小的索引。平台（連續相等值）取中間點。 */
  function findExtrema(x) {
    var n = x.length;
    var maxIdx = [], minIdx = [];
    var i = 1;
    while (i < n - 1) {
      if (x[i] > x[i - 1] && x[i] > x[i + 1]) { maxIdx.push(i); i++; continue; }
      if (x[i] < x[i - 1] && x[i] < x[i + 1]) { minIdx.push(i); i++; continue; }
      if (x[i] === x[i + 1]) {
        // 平台：往前找到尾端，判斷是高原還是低谷
        var j = i;
        while (j < n - 1 && x[j] === x[j + 1]) j++;
        if (j < n - 1) {
          var mid = Math.floor((i + j) / 2);
          if (x[i] > x[i - 1] && x[j] > x[j + 1]) maxIdx.push(mid);
          else if (x[i] < x[i - 1] && x[j] < x[j + 1]) minIdx.push(mid);
        }
        i = j + 1;
        continue;
      }
      i++;
    }
    return { maxIdx: maxIdx, minIdx: minIdx };
  }

  function countZeroCrossings(x) {
    var c = 0;
    for (var i = 1; i < x.length; i++) {
      if ((x[i - 1] < 0 && x[i] > 0) || (x[i - 1] > 0 && x[i] < 0)) c++;
      else if (x[i] === 0 && x[i - 1] !== 0) c++;
    }
    return c;
  }

  // ------------------------------------------------- 自然三次樣條 (natural cubic spline)

  /**
   * 建立通過 (xs, ys) 的自然三次樣條，回傳可在任意 t 求值的函式。
   * 自然邊界條件：兩端二階導數為 0。
   */
  function cubicSpline(xs, ys) {
    var n = xs.length;
    if (n === 0) return function () { return 0; };
    if (n === 1) return function () { return ys[0]; };
    if (n === 2) {
      var slope = (ys[1] - ys[0]) / (xs[1] - xs[0]);
      return function (t) { return ys[0] + slope * (t - xs[0]); };
    }

    var h = new Float64Array(n - 1);
    for (var i = 0; i < n - 1; i++) {
      h[i] = xs[i + 1] - xs[i];
      if (h[i] === 0) h[i] = 1e-12;   // 防呆：重複節點
    }

    var alpha = new Float64Array(n);
    for (var i2 = 1; i2 < n - 1; i2++) {
      alpha[i2] = 3 * ((ys[i2 + 1] - ys[i2]) / h[i2] - (ys[i2] - ys[i2 - 1]) / h[i2 - 1]);
    }

    var l = new Float64Array(n), mu = new Float64Array(n), z = new Float64Array(n);
    l[0] = 1; mu[0] = 0; z[0] = 0;
    for (var i3 = 1; i3 < n - 1; i3++) {
      l[i3] = 2 * (xs[i3 + 1] - xs[i3 - 1]) - h[i3 - 1] * mu[i3 - 1];
      mu[i3] = h[i3] / l[i3];
      z[i3] = (alpha[i3] - h[i3 - 1] * z[i3 - 1]) / l[i3];
    }
    l[n - 1] = 1; z[n - 1] = 0;

    var c = new Float64Array(n), b = new Float64Array(n - 1), d = new Float64Array(n - 1);
    c[n - 1] = 0;
    for (var j = n - 2; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1];
      b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
      d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }

    return function (t) {
      // 二分搜尋所屬區段（外插時夾到最近的端段）
      var lo = 0, hi = n - 2;
      if (t <= xs[0]) lo = 0;
      else if (t >= xs[n - 1]) lo = n - 2;
      else {
        while (lo < hi) {
          var mid = (lo + hi + 1) >> 1;
          if (xs[mid] <= t) lo = mid; else hi = mid - 1;
        }
      }
      var dt = t - xs[lo];
      return ys[lo] + b[lo] * dt + c[lo] * dt * dt + d[lo] * dt * dt * dt;
    };
  }

  // ------------------------------------------------- 端點鏡像延伸

  /**
   * Rilling et al. 的 boundary_conditions：把最靠近兩端的 nbsym 個極值
   * 鏡射到訊號之外，讓樣條在端點附近不會因缺乏支撐而亂飛。
   * t 直接用樣本索引 0..n-1。
   * 回傳 null 表示極值總數 < 3，無法內插。
   */
  function boundaryConditions(minIdx, maxIdx, x, nbsym) {
    nbsym = nbsym || 2;
    var n = x.length;
    var lastIdx = n - 1;
    if (minIdx.length + maxIdx.length < 3) return null;

    var nmin = minIdx.length, nmax = maxIdx.length;
    var lmax, lmin, lsym, rmax, rmin, rsym;

    // ---- 左端
    if (maxIdx[0] < minIdx[0]) {
      if (x[0] > x[minIdx[0]]) {
        lmax = mslice(maxIdx, 2, Math.min(nmax, nbsym + 1)).slice().reverse();
        lmin = mslice(minIdx, 1, Math.min(nmin, nbsym)).slice().reverse();
        lsym = maxIdx[0];
      } else {
        lmax = mslice(maxIdx, 1, Math.min(nmax, nbsym)).slice().reverse();
        lmin = mslice(minIdx, 1, Math.min(nmin, nbsym - 1)).slice().reverse().concat([0]);
        lsym = 0;
      }
    } else {
      if (x[0] < x[maxIdx[0]]) {
        lmax = mslice(maxIdx, 1, Math.min(nmax, nbsym)).slice().reverse();
        lmin = mslice(minIdx, 2, Math.min(nmin, nbsym + 1)).slice().reverse();
        lsym = minIdx[0];
      } else {
        lmax = mslice(maxIdx, 1, Math.min(nmax, nbsym - 1)).slice().reverse().concat([0]);
        lmin = mslice(minIdx, 1, Math.min(nmin, nbsym)).slice().reverse();
        lsym = 0;
      }
    }

    // ---- 右端
    if (maxIdx[nmax - 1] < minIdx[nmin - 1]) {
      if (x[lastIdx] < x[maxIdx[nmax - 1]]) {
        rmax = mslice(maxIdx, Math.max(nmax - nbsym + 1, 1), nmax).slice().reverse();
        rmin = mslice(minIdx, Math.max(nmin - nbsym, 1), nmin - 1).slice().reverse();
        rsym = minIdx[nmin - 1];
      } else {
        rmax = [lastIdx].concat(mslice(maxIdx, Math.max(nmax - nbsym + 2, 1), nmax).slice().reverse());
        rmin = mslice(minIdx, Math.max(nmin - nbsym + 1, 1), nmin).slice().reverse();
        rsym = lastIdx;
      }
    } else {
      if (x[lastIdx] > x[minIdx[nmin - 1]]) {
        rmax = mslice(maxIdx, Math.max(nmax - nbsym, 1), nmax - 1).slice().reverse();
        rmin = mslice(minIdx, Math.max(nmin - nbsym + 1, 1), nmin).slice().reverse();
        rsym = maxIdx[nmax - 1];
      } else {
        rmax = mslice(maxIdx, Math.max(nmax - nbsym + 1, 1), nmax).slice().reverse();
        rmin = [lastIdx].concat(mslice(minIdx, Math.max(nmin - nbsym + 2, 1), nmin).slice().reverse());
        rsym = lastIdx;
      }
    }

    var tlmin = lmin.map(function (i) { return 2 * lsym - i; });
    var tlmax = lmax.map(function (i) { return 2 * lsym - i; });
    var trmin = rmin.map(function (i) { return 2 * rsym - i; });
    var trmax = rmax.map(function (i) { return 2 * rsym - i; });

    // 鏡射後仍未蓋過端點 → 改用端點本身當鏡射中心
    if ((tlmin.length && tlmin[0] > 0) || (tlmax.length && tlmax[0] > 0)) {
      if (lsym === maxIdx[0]) lmax = mslice(maxIdx, 1, Math.min(nmax, nbsym)).slice().reverse();
      else lmin = mslice(minIdx, 1, Math.min(nmin, nbsym)).slice().reverse();
      lsym = 0;
      tlmin = lmin.map(function (i) { return 2 * lsym - i; });
      tlmax = lmax.map(function (i) { return 2 * lsym - i; });
    }
    if ((trmin.length && trmin[trmin.length - 1] < lastIdx) ||
        (trmax.length && trmax[trmax.length - 1] < lastIdx)) {
      if (rsym === maxIdx[nmax - 1]) rmax = mslice(maxIdx, Math.max(nmax - nbsym + 1, 1), nmax).slice().reverse();
      else rmin = mslice(minIdx, Math.max(nmin - nbsym + 1, 1), nmin).slice().reverse();
      rsym = lastIdx;
      trmin = rmin.map(function (i) { return 2 * rsym - i; });
      trmax = rmax.map(function (i) { return 2 * rsym - i; });
    }

    var tmin = tlmin.concat(minIdx, trmin);
    var tmax = tlmax.concat(maxIdx, trmax);
    var zmin = lmin.map(function (i) { return x[i]; })
      .concat(minIdx.map(function (i) { return x[i]; }))
      .concat(rmin.map(function (i) { return x[i]; }));
    var zmax = lmax.map(function (i) { return x[i]; })
      .concat(maxIdx.map(function (i) { return x[i]; }))
      .concat(rmax.map(function (i) { return x[i]; }));

    return { tmin: tmin, zmin: zmin, tmax: tmax, zmax: zmax };
  }

  // ------------------------------------------------- 包絡線與均值

  /**
   * 計算上下包絡線與其均值。
   * 回傳 null 表示極值不足（此時該序列已是單調或近單調，屬於殘餘）。
   */
  function envelopes(x, nbsym) {
    x = toArray(x);
    var n = x.length;
    var ex = findExtrema(x);
    var bc = boundaryConditions(ex.minIdx, ex.maxIdx, x, nbsym === undefined ? 2 : nbsym);
    if (!bc) return null;

    var su = cubicSpline(bc.tmax, bc.zmax);
    var sl = cubicSpline(bc.tmin, bc.zmin);
    var upper = new Float64Array(n), lower = new Float64Array(n), mean = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      upper[i] = su(i);
      lower[i] = sl(i);
      mean[i] = (upper[i] + lower[i]) / 2;
    }
    return {
      upper: upper, lower: lower, mean: mean,
      maxIdx: ex.maxIdx, minIdx: ex.minIdx,
      nExtrema: ex.maxIdx.length + ex.minIdx.length
    };
  }

  // ------------------------------------------------- Sifting

  /**
   * 單次 sifting：h1 = h - mean(envelopes(h))
   * 回傳 null 代表無法再 sift（極值不足）。
   */
  function siftOnce(h, nbsym) {
    var env = envelopes(h, nbsym);
    if (!env) return null;
    var n = h.length;
    var h1 = new Float64Array(n);
    for (var i = 0; i < n; i++) h1[i] = h[i] - env.mean[i];

    // Huang(1998) 的停止準則 SD。原文逐點相除，此處用和的比值（數值上穩定得多，
    // 是目前絕大多數實作的作法）。
    var num = 0, den = 0;
    for (var j = 0; j < n; j++) {
      var d = h[j] - h1[j];
      num += d * d;
      den += h[j] * h[j];
    }
    var sd = den > 0 ? num / den : 0;

    return { h1: h1, sd: sd, env: env };
  }

  /**
   * 抽取一層 IMF。
   * opts: { sdThreshold=0.2, maxIter=100, nbsym=2, keepSteps=false }
   * 回傳 { imf, iterations, sd, converged, steps }
   * steps（keepSteps 時）供逐步動畫使用，每步含 h / upper / lower / mean / h1 / sd。
   */
  function sift(x, opts) {
    opts = opts || {};
    var sdThreshold = opts.sdThreshold === undefined ? 0.2 : opts.sdThreshold;
    var maxIter = opts.maxIter === undefined ? 100 : opts.maxIter;
    var nbsym = opts.nbsym === undefined ? 2 : opts.nbsym;
    var keepSteps = !!opts.keepSteps;

    var h = toArray(x).slice();
    var steps = [];
    var iterations = 0, lastSd = NaN, converged = false;

    for (var k = 0; k < maxIter; k++) {
      var r = siftOnce(h, nbsym);
      if (!r) break;                       // 極值不足，停
      iterations++;
      lastSd = r.sd;
      if (keepSteps) {
        steps.push({
          h: h.slice(),
          upper: r.env.upper, lower: r.env.lower, mean: r.env.mean,
          maxIdx: r.env.maxIdx, minIdx: r.env.minIdx,
          h1: r.h1.slice(), sd: r.sd
        });
      }
      h = r.h1;
      if (r.sd < sdThreshold) { converged = true; break; }
    }

    return {
      imf: h,
      iterations: iterations,
      sd: lastSd,
      converged: converged,
      steps: steps,
      nExtrema: (function () { var e = findExtrema(h); return e.maxIdx.length + e.minIdx.length; })(),
      nZeroCrossings: countZeroCrossings(h)
    };
  }

  // ------------------------------------------------- 完整 EMD

  /**
   * 對訊號做完整 EMD。
   * opts: { maxImf=10, sdThreshold=0.2, maxIter=100, nbsym=2,
   *         keepSteps=false, energyRatioStop=1e-10 }
   * 回傳 { imfs:[Float64Array], residue:Float64Array, details:[...] }
   */
  function emd(x, opts) {
    opts = opts || {};
    var maxImf = opts.maxImf === undefined ? 10 : opts.maxImf;
    var energyStop = opts.energyRatioStop === undefined ? 1e-10 : opts.energyRatioStop;

    var sig = toArray(x);
    var n = sig.length;
    var totalEnergy = 0;
    for (var i = 0; i < n; i++) totalEnergy += sig[i] * sig[i];

    var residue = sig.slice();
    var imfs = [], details = [];

    while (imfs.length < maxImf) {
      var ex = findExtrema(residue);
      // 殘餘為單調函數（極值 < 3）→ 結束
      if (ex.maxIdx.length + ex.minIdx.length < 3) break;

      var resEnergy = 0;
      for (var j = 0; j < n; j++) resEnergy += residue[j] * residue[j];
      if (totalEnergy > 0 && resEnergy / totalEnergy < energyStop) break;

      var r = sift(residue, opts);
      if (!r.iterations) break;            // 一步都 sift 不動，代表已是殘餘

      imfs.push(r.imf);
      details.push({
        iterations: r.iterations, sd: r.sd, converged: r.converged,
        steps: r.steps, nExtrema: r.nExtrema, nZeroCrossings: r.nZeroCrossings
      });

      var next = new Float64Array(n);
      for (var k = 0; k < n; k++) next[k] = residue[k] - r.imf[k];
      residue = next;
    }

    return { imfs: imfs, residue: residue, details: details };
  }

  // ------------------------------------------------- EEMD（mode mixing 的補丁）

  function gaussian(rngState) {
    // Box–Muller，配 mulberry32 以便可重現
    var u = 0, v = 0;
    while (u === 0) u = rngState();
    while (v === 0) v = rngState();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Ensemble EMD (Wu & Huang 2009)：加入白雜訊做多次 EMD 後平均，
   * 讓各次的 mode mixing 互相抵銷。
   * opts 額外支援 { ensembleSize=50, noiseAmplitude=0.2（相對訊號標準差）, seed=42 }
   */
  function eemd(x, opts) {
    opts = opts || {};
    var ensembleSize = opts.ensembleSize === undefined ? 50 : opts.ensembleSize;
    var noiseAmp = opts.noiseAmplitude === undefined ? 0.2 : opts.noiseAmplitude;
    var maxImf = opts.maxImf === undefined ? 10 : opts.maxImf;
    var rng = mulberry32(opts.seed === undefined ? 42 : opts.seed);

    var sig = toArray(x);
    var n = sig.length;
    var mean = 0;
    for (var i = 0; i < n; i++) mean += sig[i];
    mean /= n;
    var sd = 0;
    for (var i2 = 0; i2 < n; i2++) sd += (sig[i2] - mean) * (sig[i2] - mean);
    sd = Math.sqrt(sd / n);
    var amp = noiseAmp * (sd || 1);

    var acc = [];
    for (var m = 0; m < maxImf; m++) acc.push(new Float64Array(n));
    var counts = new Array(maxImf).fill(0);
    var resAcc = new Float64Array(n);

    for (var e = 0; e < ensembleSize; e++) {
      var noisy = new Float64Array(n);
      for (var k = 0; k < n; k++) noisy[k] = sig[k] + amp * gaussian(rng);
      var r = emd(noisy, Object.assign({}, opts, { keepSteps: false }));
      for (var q = 0; q < r.imfs.length && q < maxImf; q++) {
        counts[q]++;
        for (var t = 0; t < n; t++) acc[q][t] += r.imfs[q][t];
      }
      for (var t2 = 0; t2 < n; t2++) resAcc[t2] += r.residue[t2];
    }

    var imfs = [];
    for (var q2 = 0; q2 < maxImf; q2++) {
      if (!counts[q2]) break;
      var out = new Float64Array(n);
      for (var t3 = 0; t3 < n; t3++) out[t3] = acc[q2][t3] / ensembleSize;
      imfs.push(out);
    }
    var residue = new Float64Array(n);
    for (var t4 = 0; t4 < n; t4++) residue[t4] = resAcc[t4] / ensembleSize;

    return { imfs: imfs, residue: residue, details: [] };
  }

  return {
    findExtrema: findExtrema,
    countZeroCrossings: countZeroCrossings,
    cubicSpline: cubicSpline,
    boundaryConditions: boundaryConditions,
    envelopes: envelopes,
    siftOnce: siftOnce,
    sift: sift,
    emd: emd,
    eemd: eemd,
    mulberry32: mulberry32
  };
});
