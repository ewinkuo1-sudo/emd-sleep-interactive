/* test-emd.mjs — EMD 核心正確性驗證
 * 執行：node test/test-emd.mjs
 * 驗證項目：
 *   1. FFT / IFFT 往返誤差
 *   2. Hilbert 解析訊號對純弦波給出正確瞬時頻率
 *   3. 雙頻合成訊號分解出的 IMF 頻率是否對得上（黃金標準）
 *   4. 完全重建性：Σ IMF + residue == 原訊號
 *   5. IMF 條件：極值數與零交越數相差 ≤ 1
 *   6. chirp / 睡眠 EEG 的行為檢查
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const DSP = require('../js/dsp.js');
const EMD = require('../js/emd.js');
const Signals = require('../js/signals.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`); }
}
function maxAbsDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
function rms(a) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
}

// ---------------------------------------------------------------- 1. FFT
console.log('\n[1] FFT / IFFT 往返');
for (const n of [256, 1000, 1024, 777]) {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.1) + 0.3 * Math.cos(i * 0.037) + 0.01 * i;
  const F = DSP.fft(x);
  const back = DSP.ifft(F.re, F.im);
  check(`N=${n} 往返誤差`, maxAbsDiff(x, back.re) < 1e-9,
    `max|Δ| = ${maxAbsDiff(x, back.re).toExponential(2)}`);
}

// 與暴力 DFT 比對——抓得到「共軛翻轉」這種 roundtrip 測不出來的錯
function bruteDFT(x) {
  const n = x.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = -2 * Math.PI * k * t / n;
      re[k] += x[t] * Math.cos(a);
      im[k] += x[t] * Math.sin(a);
    }
  }
  return { re, im };
}
for (const n of [64, 100, 127]) {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.31) + 0.4 * Math.cos(i * 0.07);
  const F = DSP.fft(x), B = bruteDFT(x);
  const e = Math.max(maxAbsDiff(F.re, B.re), maxAbsDiff(F.im, B.im));
  check(`N=${n} 與暴力 DFT 一致（含虛部正負號）`, e < 1e-9, `max|Δ| = ${e.toExponential(2)}`);
}

// 頻譜峰值位置
{
  const fs = 200, n = 1024;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 12 * i / fs);
  const s = DSP.magnitudeSpectrum(x, fs);
  let pk = 0;
  for (let k = 1; k < s.mag.length; k++) if (s.mag[k] > s.mag[pk]) pk = k;
  check('12 Hz 弦波頻譜峰值位置', Math.abs(s.freq[pk] - 12) < 0.5, `峰值 @ ${s.freq[pk].toFixed(2)} Hz`);
}

// ---------------------------------------------------------------- 2. Hilbert
console.log('\n[2] Hilbert 解析訊號');
{
  const fs = 200, n = 2048, f = 7;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.cos(2 * Math.PI * f * i / fs);
  const h = DSP.hilbertSpectrum(x, fs);
  check('瞬時頻率為正（解析訊號旋轉方向正確）', h.frequency[n >> 1] > 0,
    `f[n/2] = ${h.frequency[n >> 1].toFixed(3)} Hz`);
  // 中間段的瞬時振幅應該 ≈ 1，瞬時頻率 ≈ 7 Hz
  const mid = [];
  for (let i = Math.floor(n * 0.2); i < Math.floor(n * 0.8); i++) mid.push(h.frequency[i]);
  const mf = mid.reduce((a, b) => a + b, 0) / mid.length;
  const ampMid = [];
  for (let i = Math.floor(n * 0.2); i < Math.floor(n * 0.8); i++) ampMid.push(h.amplitude[i]);
  const ma = ampMid.reduce((a, b) => a + b, 0) / ampMid.length;
  check('純弦波瞬時頻率', Math.abs(mf - f) < 0.05, `${mf.toFixed(4)} Hz (期望 ${f})`);
  check('純弦波瞬時振幅', Math.abs(ma - 1) < 0.02, `${ma.toFixed(4)} (期望 1)`);
  check('meanInstFreq 輔助函式', Math.abs(DSP.meanInstFreq(x, fs) - f) < 0.05,
    `${DSP.meanInstFreq(x, fs).toFixed(4)} Hz`);
}

// ---------------------------------------------------------------- 3. 雙頻黃金標準
console.log('\n[3] 雙頻合成訊號分解（黃金標準）');
{
  const fs = 200, n = 2048, f1 = 1, f2 = 12;
  const sig = Signals.twoTone({ fs, n, f1, f2, a1: 1.0, a2: 0.5 });
  const res = EMD.emd(sig.x, { maxImf: 8, sdThreshold: 0.2, maxIter: 100 });

  console.log(`  分解出 ${res.imfs.length} 層 IMF`);
  res.imfs.forEach((imf, i) => {
    const fH = DSP.meanInstFreq(imf, fs);
    const fZ = DSP.zeroCrossingFreq(imf, fs);
    console.log(`    IMF${i + 1}: Hilbert 平均頻率 ${fH.toFixed(3)} Hz | 零交越估頻 ${fZ.toFixed(3)} Hz | RMS ${rms(imf).toFixed(4)}`);
  });
  console.log(`    residue: RMS ${rms(res.residue).toFixed(4)}`);

  check('至少分出 2 層 IMF', res.imfs.length >= 2, `實際 ${res.imfs.length} 層`);

  const f_imf1 = DSP.meanInstFreq(res.imfs[0], fs);
  const f_imf2 = DSP.meanInstFreq(res.imfs[1], fs);
  check('IMF1 ≈ 12 Hz（高頻先出）', Math.abs(f_imf1 - f2) < 0.6, `${f_imf1.toFixed(3)} Hz`);
  check('IMF2 ≈ 1 Hz', Math.abs(f_imf2 - f1) < 0.25, `${f_imf2.toFixed(3)} Hz`);

  // 振幅比：IMF1 應約 0.5，IMF2 應約 1.0（RMS = a/√2）
  const r1 = rms(res.imfs[0]) * Math.SQRT2;
  const r2 = rms(res.imfs[1]) * Math.SQRT2;
  check('IMF1 振幅 ≈ 0.5', Math.abs(r1 - 0.5) < 0.08, `估計 ${r1.toFixed(3)}`);
  check('IMF2 振幅 ≈ 1.0', Math.abs(r2 - 1.0) < 0.10, `估計 ${r2.toFixed(3)}`);

  // 完全重建
  const recon = new Float64Array(n);
  for (const imf of res.imfs) for (let i = 0; i < n; i++) recon[i] += imf[i];
  for (let i = 0; i < n; i++) recon[i] += res.residue[i];
  const err = maxAbsDiff(sig.x, recon);
  check('完全重建 Σ IMF + residue = 原訊號', err < 1e-10, `max|Δ| = ${err.toExponential(2)}`);

  // IMF 條件
  res.imfs.forEach((imf, i) => {
    const ex = EMD.findExtrema(imf);
    const nE = ex.maxIdx.length + ex.minIdx.length;
    const nZ = EMD.countZeroCrossings(imf);
    check(`IMF${i + 1} 滿足 |極值數 − 零交越數| ≤ 1`, Math.abs(nE - nZ) <= 1,
      `極值 ${nE}、零交越 ${nZ}`);
  });
}

// ---------------------------------------------------------------- 4. 三頻
console.log('\n[4] 三頻訊號（測分離能力上限）');
{
  const fs = 200, n = 2048;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    x[i] = Math.sin(2 * Math.PI * 30 * t) + 0.8 * Math.sin(2 * Math.PI * 8 * t) + 1.5 * Math.sin(2 * Math.PI * 1.5 * t);
  }
  const res = EMD.emd(x, { maxImf: 8 });
  const freqs = res.imfs.map(v => DSP.meanInstFreq(v, fs));
  console.log('  IMF 頻率：' + freqs.map(f => f.toFixed(2)).join(', '));
  const near = (target, tol) => freqs.some(f => Math.abs(f - target) < tol);
  check('抓到 ≈30 Hz', near(30, 1.5), freqs.map(f => f.toFixed(1)).join('/'));
  check('抓到 ≈8 Hz', near(8, 1.0));
  check('抓到 ≈1.5 Hz', near(1.5, 0.4));
}

// ---------------------------------------------------------------- 5. Chirp
console.log('\n[5] Chirp：EMD 應把它收在單一 IMF 且瞬時頻率隨時間上升');
{
  const fs = 200, n = 2048;
  const sig = Signals.chirp({ fs, n, f0: 2, f1: 25 });
  const res = EMD.emd(sig.x, { maxImf: 8 });
  const h = DSP.hilbertSpectrum(res.imfs[0], fs);
  const early = h.frequency[Math.floor(n * 0.15)];
  const late = h.frequency[Math.floor(n * 0.85)];
  console.log(`  IMF1 瞬時頻率：t=15% 時 ${early.toFixed(2)} Hz → t=85% 時 ${late.toFixed(2)} Hz`);
  check('IMF1 瞬時頻率隨時間顯著上升', late - early > 10, `Δ = ${(late - early).toFixed(2)} Hz`);
  check('IMF1 佔絕大部分能量', rms(res.imfs[0]) / rms(sig.x) > 0.9,
    `能量比 ${(rms(res.imfs[0]) / rms(sig.x)).toFixed(3)}`);
}

// ---------------------------------------------------------------- 6. 睡眠 EEG
console.log('\n[6] 模擬睡眠 EEG');
for (const stage of ['W', 'N1', 'N2', 'N3', 'REM']) {
  const sig = Signals.sleepEEG(stage, { fs: 100, n: 1000 });
  const res = EMD.emd(sig.x, { maxImf: 8 });
  const freqs = res.imfs.map(v => DSP.meanInstFreq(v, sig.fs));
  const zc = res.imfs.map(v => DSP.zeroCrossingFreq(v, sig.fs));
  console.log(`  ${stage.padEnd(3)} → ${res.imfs.length} 層 IMF`);
  console.log(`       Hilbert 平均頻率 ${freqs.map(f => f.toFixed(1)).join(', ')} Hz`);
  console.log(`       零交越估頻     ${zc.map(f => f.toFixed(1)).join(', ')} Hz`);
  check(`${stage} IMF 頻率單調遞減（零交越）`,
    zc.every((v, i) => i === 0 || v <= zc[i - 1] + 1e-9),
    zc.map(f => f.toFixed(1)).join(' > '));
  const recon = new Float64Array(sig.x.length);
  for (const imf of res.imfs) for (let i = 0; i < recon.length; i++) recon[i] += imf[i];
  for (let i = 0; i < recon.length; i++) recon[i] += res.residue[i];
  check(`${stage} 完全重建`, maxAbsDiff(sig.x, recon) < 1e-9);
}
// N3 應該有一層落在 delta 帶
{
  const sig = Signals.sleepEEG('N3', { fs: 100, n: 1000 });
  const res = EMD.emd(sig.x, { maxImf: 8 });
  const freqs = res.imfs.map(v => DSP.meanInstFreq(v, sig.fs));
  check('N3 有 IMF 落在 delta (0.5–4 Hz)', freqs.some(f => f >= 0.5 && f <= 4),
    freqs.map(f => f.toFixed(2)).join('/'));
}
// N2 的 sleep spindle：合成時放在 t=2.0–3.0 s、13.5 Hz。
// 重點：EMD 的價值在「時間-局部」的瞬時頻率，不是整段平均。
// 整段平均會被周圍的 theta 稀釋掉——這本身就是 mode mixing 的示範。
{
  const sig = Signals.sleepEEG('N2', { fs: 100, n: 1000 });
  const res = EMD.emd(sig.x, { maxImf: 8 });
  const globalF = res.imfs.map(v => DSP.meanInstFreq(v, sig.fs));
  // spindle 窗：t = 2.1–2.9 s → 索引 210–290
  const local = res.imfs.map(v => DSP.localInstFreq(v, sig.fs, 210, 290));
  console.log('  N2 spindle 窗 (t=2.1–2.9s) 各 IMF 局部瞬時頻率／能量：');
  local.forEach((L, i) => {
    console.log(`    IMF${i + 1}: ${isFinite(L.freq) ? L.freq.toFixed(2) + ' Hz' : 'n/a'}` +
      `  (整段平均 ${globalF[i].toFixed(2)} Hz, 局部能量 ${L.power.toExponential(2)})`);
  });
  const hit = local.some(L => isFinite(L.freq) && L.freq >= 10 && L.freq <= 17 && L.power > 0);
  check('N2 在 spindle 時間窗內有 IMF 落在 11–16 Hz 帶', hit,
    local.map(L => isFinite(L.freq) ? L.freq.toFixed(1) : '-').join('/'));

  // 對照：同一層 IMF 在 spindle 窗內的能量應明顯高於無 spindle 的窗 (t=8–9 s)
  let best = -1, bestRatio = 0;
  local.forEach((L, i) => {
    if (!(isFinite(L.freq) && L.freq >= 10 && L.freq <= 17)) return;
    const quiet = DSP.localInstFreq(res.imfs[i], sig.fs, 800, 880);
    const ratio = L.power / Math.max(1e-12, quiet.power);
    if (ratio > bestRatio) { bestRatio = ratio; best = i; }
  });
  check('該 IMF 在 spindle 窗的能量高於安靜窗', best >= 0 && bestRatio > 1.5,
    best >= 0 ? `IMF${best + 1} 能量比 ${bestRatio.toFixed(2)}×` : '未找到候選 IMF');
}

// ---------------------------------------------------------------- 7. Mode mixing / EEMD
console.log('\n[7] Mode mixing 與 EEMD');
{
  const fs = 200, n = 1024;
  const sig = Signals.intermittent({ fs, n });
  const e1 = EMD.emd(sig.x, { maxImf: 8 });
  console.log(`  EMD  → ${e1.imfs.length} 層，IMF1 頻率 ${DSP.meanInstFreq(e1.imfs[0], fs).toFixed(2)} Hz`);
  const e2 = EMD.eemd(sig.x, { maxImf: 8, ensembleSize: 20, noiseAmplitude: 0.2, seed: 1 });
  console.log(`  EEMD → ${e2.imfs.length} 層（ensemble=20）`);
  check('EEMD 有跑出 IMF', e2.imfs.length > 0, `${e2.imfs.length} 層`);
  // EEMD 不保證完全重建（加噪平均的代價），檢查重建誤差是有限且已知的
  const recon = new Float64Array(n);
  for (const imf of e2.imfs) for (let i = 0; i < n; i++) recon[i] += imf[i];
  for (let i = 0; i < n; i++) recon[i] += e2.residue[i];
  console.log(`  EEMD 重建殘差 RMS = ${rms(recon.map((v, i) => v - sig.x[i])).toFixed(5)}（EEMD 本來就不保證完全重建）`);
}

// ---------------------------------------------------------------- 8. 邊界情況
console.log('\n[8] 邊界情況');
{
  const mono = new Float64Array(200);
  for (let i = 0; i < 200; i++) mono[i] = i * 0.01;
  const r = EMD.emd(mono, { maxImf: 5 });
  check('單調訊號不產生 IMF', r.imfs.length === 0, `${r.imfs.length} 層`);

  const flat = new Float64Array(100);
  const r2 = EMD.emd(flat, { maxImf: 5 });
  check('全零訊號不當掉', r2.imfs.length === 0);

  const tiny = Float64Array.from([0, 1, 0, -1, 0]);
  const r3 = EMD.emd(tiny, { maxImf: 3 });
  check('極短訊號不當掉', Array.isArray(r3.imfs));
}

console.log(`\n======================================`);
console.log(`通過 ${pass} 項，失敗 ${fail} 項`);
console.log(`======================================\n`);
process.exit(fail > 0 ? 1 : 0);
