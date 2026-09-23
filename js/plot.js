/* plot.js — 輕量 Canvas 繪圖層（無外部相依）
 * 色彩一律從 CSS custom property 取，所以明暗模式切換時圖會跟著換。
 * 線寬 2px、標記 ≥8px、格線與座標軸用弱化的 ink，符合可讀性規範。
 */
(function (root) {
  'use strict';

  var registry = [];           // 所有已建立的圖，主題切換時重繪

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback || '#888';
  }

  function resolveColor(c) {
    if (!c) return cssVar('--series-1');
    return c.charAt(0) === '-' ? cssVar(c) : c;
  }

  function niceStep(range, targetTicks) {
    if (!(range > 0)) return 1;
    var raw = range / Math.max(1, targetTicks);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step;
    if (norm <= 1) step = 1;
    else if (norm <= 2) step = 2;
    else if (norm <= 2.5) step = 2.5;
    else if (norm <= 5) step = 5;
    else step = 10;
    return step * mag;
  }

  function fmtNum(v, step) {
    var dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(step || 1)) + (String(step).indexOf('.') >= 0 ? 1 : 0)));
    if (Math.abs(v) >= 10000 || (v !== 0 && Math.abs(v) < 0.001)) return v.toExponential(1);
    var s = v.toFixed(dec);
    // 只在有小數點時去掉尾端的零，否則 "10" 會被砍成 "1"
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : (s || '0');
  }

  function extent(arrays) {
    var lo = Infinity, hi = -Infinity;
    for (var a = 0; a < arrays.length; a++) {
      var arr = arrays[a];
      if (!arr) continue;
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (!isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    return [lo, hi];
  }

  // ------------------------------------------------------------- 主繪圖

  function draw(cv, spec) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = cv.clientWidth || 600;
    var cssH = spec.height || 200;
    cv.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    var ink = cssVar('--text-primary');
    var muted = cssVar('--text-muted');
    var gridC = cssVar('--grid');
    var axisC = cssVar('--axis');

    var padL = spec.padLeft === undefined ? (spec.yLabel ? 54 : 44) : spec.padLeft;
    var padR = spec.padRight === undefined ? 12 : spec.padRight;
    var padT = spec.title ? 22 : 10;
    var padB = spec.xLabel ? 34 : (spec.hideXAxis ? 8 : 24);

    var W = cssW - padL - padR;
    var H = cssH - padT - padB;
    if (W <= 10 || H <= 10) return null;

    // ---- 範圍
    var xs = [], ys = [];
    (spec.series || []).forEach(function (s) { xs.push(s.x); ys.push(s.y); });
    (spec.points || []).forEach(function (s) { xs.push(s.x); ys.push(s.y); });
    var xr = spec.xRange || extent(xs);
    var yr = spec.yRange;
    if (!yr) {
      yr = extent(ys);
      var pad = (yr[1] - yr[0]) * 0.08;
      yr = [yr[0] - pad, yr[1] + pad];
    }
    if (spec.ySymmetric) {
      var m = Math.max(Math.abs(yr[0]), Math.abs(yr[1]));
      yr = [-m, m];
    }

    var sx = function (v) { return padL + (v - xr[0]) / (xr[1] - xr[0]) * W; };
    var sy = function (v) { return padT + H - (v - yr[0]) / (yr[1] - yr[0]) * H; };

    // ---- 底色區塊（時間帶）
    (spec.bands || []).forEach(function (b) {
      g.fillStyle = resolveColor(b.color);
      g.globalAlpha = b.alpha === undefined ? 0.13 : b.alpha;
      var x0 = Math.max(padL, sx(b.x0)), x1 = Math.min(padL + W, sx(b.x1));
      g.fillRect(x0, padT, Math.max(1, x1 - x0), H);
      g.globalAlpha = 1;
      if (b.label) {
        g.fillStyle = muted;
        g.font = '11px ' + cssVar('--sans', 'sans-serif');
        g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillText(b.label, x0 + 4, padT + 3);
      }
    });

    // ---- 格線（弱化）
    g.save();
    g.strokeStyle = gridC; g.lineWidth = 1;
    // 矮面板（IMF 堆疊）若標籤會重疊（每個約 14px），逐步減少刻度數
    var yStep, yTicks;
    for (var yTarget = spec.yTicks || 4; yTarget >= 2; yTarget--) {
      yStep = niceStep(yr[1] - yr[0], yTarget);
      yTicks = [];
      for (var yv = Math.ceil(yr[0] / yStep) * yStep; yv <= yr[1] + 1e-9; yv += yStep) yTicks.push(yv);
      if (yTicks.length * 14 <= H || yTicks.length <= 2) break;
    }
    yTicks.forEach(function (v) {
      var y = Math.round(sy(v)) + 0.5;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + W, y); g.stroke();
    });
    var xStep = niceStep(xr[1] - xr[0], spec.xTicks || 6);
    var xTicks = [];
    for (var xv = Math.ceil(xr[0] / xStep) * xStep; xv <= xr[1] + 1e-9; xv += xStep) xTicks.push(xv);
    if (!spec.hideXAxis) {
      xTicks.forEach(function (v) {
        var x = Math.round(sx(v)) + 0.5;
        g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + H); g.stroke();
      });
    }
    g.restore();

    // ---- 零線
    if (yr[0] < 0 && yr[1] > 0) {
      g.strokeStyle = axisC; g.lineWidth = 1;
      var yz = Math.round(sy(0)) + 0.5;
      g.beginPath(); g.moveTo(padL, yz); g.lineTo(padL + W, yz); g.stroke();
    }

    // ---- 水平參考線
    (spec.hlines || []).forEach(function (h) {
      g.save();
      g.strokeStyle = resolveColor(h.color || '--text-muted');
      g.lineWidth = 1.5;
      g.setLineDash(h.dash || [5, 4]);
      var y = sy(h.y);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(padL + W, y); g.stroke();
      g.restore();
      if (h.label) {
        g.fillStyle = resolveColor(h.color || '--text-muted');
        g.font = '11px ' + cssVar('--sans', 'sans-serif');
        g.textAlign = 'right'; g.textBaseline = 'bottom';
        g.fillText(h.label, padL + W - 3, y - 2);
      }
    });

    // ---- 垂直參考線
    (spec.vlines || []).forEach(function (v) {
      g.save();
      g.strokeStyle = resolveColor(v.color || '--text-muted');
      g.lineWidth = 1.5;
      g.setLineDash(v.dash || [5, 4]);
      var x = sx(v.x);
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + H); g.stroke();
      g.restore();
    });

    // ---- 線段
    g.save();
    g.beginPath();
    g.rect(padL - 1, padT - 1, W + 2, H + 2);
    g.clip();
    (spec.series || []).forEach(function (s) {
      if (!s.x || !s.y || !s.x.length) return;
      g.strokeStyle = resolveColor(s.color);
      g.lineWidth = s.width || 2;
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.globalAlpha = s.alpha === undefined ? 1 : s.alpha;
      g.setLineDash(s.dash || []);
      g.beginPath();
      var n = s.x.length;
      // 降採樣：每個像素最多畫 2 點（min/max 保留波形外觀）
      var ppx = n / W;
      if (ppx > 2) {
        var bucket = Math.floor(ppx);
        var started = false;
        for (var i = 0; i < n; i += bucket) {
          var lo = Infinity, hi = -Infinity, loI = i, hiI = i;
          for (var k = i; k < Math.min(n, i + bucket); k++) {
            if (s.y[k] < lo) { lo = s.y[k]; loI = k; }
            if (s.y[k] > hi) { hi = s.y[k]; hiI = k; }
          }
          var first = Math.min(loI, hiI), second = Math.max(loI, hiI);
          [first, second].forEach(function (idx) {
            var px = sx(s.x[idx]), py = sy(s.y[idx]);
            if (!started) { g.moveTo(px, py); started = true; }
            else g.lineTo(px, py);
          });
        }
      } else {
        for (var j = 0; j < n; j++) {
          var px2 = sx(s.x[j]), py2 = sy(s.y[j]);
          if (j === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
        }
      }
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    });

    // ---- 標記點（外圈用底色做 2px 環，避免與線重疊糊成一團）
    (spec.points || []).forEach(function (s) {
      if (!s.x || !s.x.length) return;
      var r = s.r || 4;
      var col = resolveColor(s.color);
      for (var i = 0; i < s.x.length; i++) {
        var px = sx(s.x[i]), py = sy(s.y[i]);
        if (px < padL - 6 || px > padL + W + 6) continue;
        g.beginPath(); g.arc(px, py, r + 1.5, 0, 6.2832);
        g.fillStyle = cssVar('--surface-1'); g.fill();
        g.beginPath(); g.arc(px, py, r, 0, 6.2832);
        g.fillStyle = col; g.fill();
      }
    });
    g.restore();

    // ---- 座標軸
    g.strokeStyle = axisC; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padL + 0.5, padT); g.lineTo(padL + 0.5, padT + H);
    g.lineTo(padL + W, padT + H + 0.5);
    g.stroke();

    g.fillStyle = muted;
    g.font = '11px ' + cssVar('--sans', 'sans-serif');
    g.textAlign = 'right'; g.textBaseline = 'middle';
    yTicks.forEach(function (v) { g.fillText(fmtNum(v, yStep), padL - 6, sy(v)); });
    if (!spec.hideXAxis) {
      g.textAlign = 'center'; g.textBaseline = 'top';
      xTicks.forEach(function (v) { g.fillText(fmtNum(v, xStep), sx(v), padT + H + 5); });
    }

    if (spec.xLabel) {
      g.fillStyle = cssVar('--text-secondary');
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText(spec.xLabel, padL + W / 2, cssH - 2);
    }
    if (spec.yLabel) {
      g.save();
      g.fillStyle = cssVar('--text-secondary');
      g.translate(11, padT + H / 2);
      g.rotate(-Math.PI / 2);
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(spec.yLabel, 0, 0);
      g.restore();
    }
    if (spec.title) {
      g.fillStyle = ink;
      g.font = '600 12.5px ' + cssVar('--sans', 'sans-serif');
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(spec.title, padL, 3);
    }
    if (spec.cornerNote) {
      g.fillStyle = muted;
      g.font = '11px ' + cssVar('--sans', 'sans-serif');
      g.textAlign = 'right'; g.textBaseline = 'top';
      g.fillText(spec.cornerNote, padL + W, 3);
    }

    return { sx: sx, sy: sy, xr: xr, yr: yr, padL: padL, padT: padT, W: W, H: H };
  }

  // ------------------------------------------------------------- 熱圖

  function seqColor(t) {
    // 0..1 → 連續藍色階（7 級線性內插）
    var steps = ['--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600', '--seq-700']
      .map(function (v) { return cssVar(v); });
    t = Math.max(0, Math.min(1, t));
    var f = t * (steps.length - 1);
    var i = Math.floor(f), frac = f - i;
    if (i >= steps.length - 1) return steps[steps.length - 1];
    return mixHex(steps[i], steps[i + 1], frac);
  }

  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mixHex(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' +
      Math.round(A[1] + (B[1] - A[1]) * t) + ',' +
      Math.round(A[2] + (B[2] - A[2]) * t) + ')';
  }

  /**
   * Hilbert 時頻圖。
   * spec: { tracks:[{t:[], f:[], a:[]}], fMax, tRange, nf, height, xLabel, yLabel, title }
   * 把每個 (t, f) 樣本的振幅累加進格點，再以連續色階上色。
   */
  function drawHilbert(cv, spec) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = cv.clientWidth || 600;
    var cssH = spec.height || 240;
    cv.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    var padL = 54, padR = 60, padT = spec.title ? 22 : 10, padB = 34;
    var W = cssW - padL - padR, H = cssH - padT - padB;
    if (W <= 10 || H <= 10) return null;

    var fMax = spec.fMax || 50;
    var tr = spec.tRange || [0, 1];
    var nf, nt, grid;

    if (spec.grid) {
      // 已經算好的格點（例如 STFT）
      nt = spec.nt; nf = spec.nf; grid = spec.grid;
    } else {
      nf = spec.nf || 90;
      nt = Math.max(60, Math.min(400, Math.round(W)));
      grid = new Float64Array(nt * nf);
      (spec.tracks || []).forEach(function (tk) {
        for (var i = 0; i < tk.t.length; i++) {
          var f = tk.f[i], a = tk.a[i];
          if (!isFinite(f) || f <= 0 || f > fMax || !isFinite(a)) continue;
          var ti = Math.floor((tk.t[i] - tr[0]) / (tr[1] - tr[0]) * nt);
          var fi = Math.floor(f / fMax * nf);
          if (ti < 0 || ti >= nt || fi < 0 || fi >= nf) continue;
          grid[ti * nf + fi] += a * a;
        }
      });
    }

    var mx = 0;
    for (var q = 0; q < grid.length; q++) if (grid[q] > mx) mx = grid[q];
    // 用對數壓縮，否則慢波的能量會把其他全部吃掉
    var logMax = Math.log10(1 + mx);

    var cw = W / nt, ch = H / nf;
    for (var ti2 = 0; ti2 < nt; ti2++) {
      for (var fi2 = 0; fi2 < nf; fi2++) {
        var v = grid[ti2 * nf + fi2];
        var t01 = logMax > 0 ? Math.log10(1 + v) / logMax : 0;
        if (t01 <= 0.012) continue;                 // 近零留白，讓底色呼吸
        g.fillStyle = seqColor(t01);
        g.fillRect(padL + ti2 * cw, padT + H - (fi2 + 1) * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
      }
    }

    // 座標軸
    var muted = cssVar('--text-muted'), axisC = cssVar('--axis');
    g.strokeStyle = axisC; g.lineWidth = 1;
    g.strokeRect(padL + 0.5, padT + 0.5, W, H);
    g.fillStyle = muted;
    g.font = '11px ' + cssVar('--sans', 'sans-serif');

    var fStep = niceStep(fMax, 5);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (var fv = 0; fv <= fMax + 1e-9; fv += fStep) {
      g.fillText(fmtNum(fv, fStep), padL - 6, padT + H - fv / fMax * H);
    }
    var tStep = niceStep(tr[1] - tr[0], 6);
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (var tv = Math.ceil(tr[0] / tStep) * tStep; tv <= tr[1] + 1e-9; tv += tStep) {
      g.fillText(fmtNum(tv, tStep), padL + (tv - tr[0]) / (tr[1] - tr[0]) * W, padT + H + 5);
    }

    // 色階圖例
    var lbW = 12, lbX = padL + W + 14, lbH = H;
    for (var s = 0; s < lbH; s++) {
      g.fillStyle = seqColor(s / lbH);
      g.fillRect(lbX, padT + lbH - s - 1, lbW, 1.5);
    }
    g.strokeStyle = axisC; g.strokeRect(lbX + 0.5, padT + 0.5, lbW, lbH);
    g.fillStyle = muted;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('高', lbX + lbW + 4, padT + 6);
    g.fillText('低', lbX + lbW + 4, padT + lbH - 6);

    g.fillStyle = cssVar('--text-secondary');
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    if (spec.xLabel) g.fillText(spec.xLabel, padL + W / 2, cssH - 2);
    if (spec.yLabel) {
      g.save();
      g.translate(11, padT + H / 2); g.rotate(-Math.PI / 2);
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(spec.yLabel, 0, 0);
      g.restore();
    }
    if (spec.title) {
      g.fillStyle = cssVar('--text-primary');
      g.font = '600 12.5px ' + cssVar('--sans', 'sans-serif');
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(spec.title, padL, 3);
    }
    return { padL: padL, padT: padT, W: W, H: H, tRange: tr, fMax: fMax };
  }

  // ------------------------------------------------------------- 對外 API

  /** 建立 / 更新一張線圖。回傳 handle，可 handle.update(newSpec)。 */
  function line(cv, spec) {
    var rec = cv.__plot;
    if (!rec) {
      rec = { cv: cv, kind: 'line', spec: spec, geom: null, tip: null };
      cv.__plot = rec;
      registry.push(rec);
      attachHover(rec);
    }
    rec.kind = 'line';
    rec.spec = spec;
    rec.geom = draw(cv, spec);
    return rec;
  }

  function hilbert(cv, spec) {
    var rec = cv.__plot;
    if (!rec) {
      rec = { cv: cv, kind: 'hilbert', spec: spec, geom: null, tip: null };
      cv.__plot = rec;
      registry.push(rec);
    }
    rec.kind = 'hilbert';
    rec.spec = spec;
    rec.geom = drawHilbert(cv, spec);
    return rec;
  }

  /** 十字準星 + tooltip。線圖預設開啟。 */
  function attachHover(rec) {
    var cv = rec.cv;
    var wrap = cv.parentElement;
    if (!wrap) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    var tip = document.createElement('div');
    tip.className = 'tooltip';
    wrap.appendChild(tip);
    rec.tip = tip;

    var overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    wrap.appendChild(overlay);
    rec.overlay = overlay;

    function sizeOverlay() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      overlay.style.left = cv.offsetLeft + 'px';
      overlay.style.top = cv.offsetTop + 'px';
      overlay.style.width = cv.clientWidth + 'px';
      overlay.style.height = cv.clientHeight + 'px';
      overlay.width = Math.round(cv.clientWidth * dpr);
      overlay.height = Math.round(cv.clientHeight * dpr);
      var og = overlay.getContext('2d');
      og.setTransform(dpr, 0, 0, dpr, 0, 0);
      return og;
    }

    function onMove(ev) {
      if (rec.kind !== 'line' || !rec.geom) return;
      var r = cv.getBoundingClientRect();
      var px = ev.clientX - r.left;
      var G = rec.geom, S = rec.spec;
      if (px < G.padL || px > G.padL + G.W) { onLeave(); return; }
      var xVal = G.xr[0] + (px - G.padL) / G.W * (G.xr[1] - G.xr[0]);

      var og = sizeOverlay();
      og.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
      og.strokeStyle = cssVar('--axis');
      og.lineWidth = 1;
      og.beginPath(); og.moveTo(px, G.padT); og.lineTo(px, G.padT + G.H); og.stroke();

      var rows = [];
      (S.series || []).forEach(function (s) {
        if (!s.label || !s.x || !s.x.length) return;
        var idx = nearestIndex(s.x, xVal);
        if (idx < 0) return;
        rows.push({ label: s.label, v: s.y[idx], color: resolveColor(s.color) });
        var cx = G.sx(s.x[idx]), cy = G.sy(s.y[idx]);
        og.beginPath(); og.arc(cx, cy, 5, 0, 6.2832);
        og.fillStyle = cssVar('--surface-1'); og.fill();
        og.lineWidth = 2; og.strokeStyle = resolveColor(s.color); og.stroke();
      });

      var unit = S.yUnit || '';
      var html = '<div style="color:var(--text-secondary)">' +
        (S.xLabel ? S.xLabel.replace(/\s*\(.*\)/, '') : 'x') + ' ' +
        xVal.toFixed(S.xTipDecimals === undefined ? 3 : S.xTipDecimals) +
        (S.xUnit ? ' ' + S.xUnit : '') + '</div>';
      rows.forEach(function (r2) {
        html += '<div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;' +
          'background:' + r2.color + ';margin-right:5px"></span>' + r2.label + ' ' +
          (Math.abs(r2.v) >= 1000 ? r2.v.toExponential(2) : r2.v.toFixed(3)) + unit + '</div>';
      });
      tip.innerHTML = html;
      tip.classList.add('on');
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = px + 12;
      if (left + tw > cv.clientWidth) left = px - tw - 12;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = Math.max(0, Math.min(cv.clientHeight - th, ev.clientY - r.top - th - 8)) + 'px';
    }

    function onLeave() {
      tip.classList.remove('on');
      if (overlay.width) {
        var og = overlay.getContext('2d');
        og.setTransform(1, 0, 0, 1, 0, 0);
        og.clearRect(0, 0, overlay.width, overlay.height);
      }
    }

    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mouseleave', onLeave);
    cv.addEventListener('touchmove', function (e) {
      if (e.touches[0]) onMove(e.touches[0]);
    }, { passive: true });
    cv.addEventListener('touchend', onLeave);
  }

  function nearestIndex(arr, v) {
    var n = arr.length;
    if (!n) return -1;
    // 假設遞增（時間軸），二分搜尋
    var lo = 0, hi = n - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(arr[lo - 1] - v) < Math.abs(arr[lo] - v)) return lo - 1;
    return lo;
  }

  /** 重繪所有已註冊的圖（主題切換、視窗縮放時呼叫）。 */
  function redrawAll() {
    registry.forEach(function (rec) {
      if (!rec.cv.isConnected) return;
      if (rec.kind === 'line') rec.geom = draw(rec.cv, rec.spec);
      else rec.geom = drawHilbert(rec.cv, rec.spec);
    });
  }

  /** 在指定容器渲染 HTML 圖例（色彩之外一定有文字標籤）。 */
  function legend(el, items) {
    el.innerHTML = items.map(function (it) {
      var cls = it.kind === 'dot' ? 'swatch dot' : (it.kind === 'dash' ? 'swatch dash' : 'swatch');
      return '<span class="item" style="color:' + resolveColor(it.color) + '">' +
        '<span class="' + cls + '"></span>' +
        '<span style="color:var(--text-secondary)">' + it.label + '</span></span>';
    }).join('');
  }

  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(redrawAll, 120);
  });

  root.Plot = {
    line: line,
    hilbert: hilbert,
    legend: legend,
    redrawAll: redrawAll,
    cssVar: cssVar,
    seqColor: seqColor
  };
})(window);
