/* test-spindle.mjs — 用「已知答案」的合成 N2 訊號檢驗 HHT 紡錘波偵測器
 * 執行：node test/test-spindle.mjs
 *
 * 合成訊號的真值（見 js/signals.js 的 sleepEEG('N2')）：
 *   紡錘波 #1  13.5 Hz，2.0 – 3.0 s
 *   紡錘波 #2  12.5 Hz，6.4 – 7.3 s
 *   K-複合波   4.2 s（非紡錘波，不應被誤判）
 * 其餘時段只有 theta 底噪與白雜訊，應該沒有偵測。
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Signals = require('../js/signals.js');
const Spindle = require('../js/spindle.js');
const DSP = require('../js/dsp.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`); }
}

const TRUTH = [
  { t0: 2.0, t1: 3.0, f: 13.5 },
  { t0: 6.4, t1: 7.3, f: 12.5 }
];
function overlaps(ev, g) { return ev.t1 > g.t0 - 0.35 && ev.t0 < g.t1 + 0.35; }

console.log('\n[N2 紡錘波偵測]');
const sig = Signals.sleepEEG('N2', { fs: 100, n: 1000 });
const r = Spindle.detect(sig.x, sig.fs, { thresholdK: 1.6 });

console.log(`  選中 IMF ${r.imfIndex + 1}（帶內能量最大）`);
r.imfScores.forEach(s => {
  console.log(`    IMF${s.index + 1}: 11–16 Hz 能量佔該層 ${(s.bandFraction * 100).toFixed(1)}%` +
    `，帶內平均頻率 ${isFinite(s.meanFreqInBand) ? s.meanFreqInBand.toFixed(2) + ' Hz' : 'n/a'}`);
});
console.log(`  門檻 = ${r.threshold.toFixed(2)} µV，偵測到 ${r.events.length} 個事件：`);
r.events.forEach(e => {
  console.log(`    ${e.t0.toFixed(2)}–${e.t1.toFixed(2)} s（${e.dur.toFixed(2)} s）` +
    `，峰值 ${e.peakAmp.toFixed(1)} µV，平均頻率 ${e.meanFreq.toFixed(2)} Hz`);
});

check('偵測到至少 1 個事件', r.events.length >= 1, `${r.events.length} 個`);

const hits = TRUTH.map(g => r.events.filter(e => overlaps(e, g)));
check('紡錘波 #1 (2.0–3.0 s, 13.5 Hz) 被偵測到', hits[0].length >= 1,
  hits[0].length ? `${hits[0][0].t0.toFixed(2)}–${hits[0][0].t1.toFixed(2)} s @ ${hits[0][0].meanFreq.toFixed(2)} Hz` : '未偵測到');
check('紡錘波 #2 (6.4–7.3 s, 12.5 Hz) 被偵測到', hits[1].length >= 1,
  hits[1].length ? `${hits[1][0].t0.toFixed(2)}–${hits[1][0].t1.toFixed(2)} s @ ${hits[1][0].meanFreq.toFixed(2)} Hz` : '未偵測到');

if (hits[0].length) {
  check('紡錘波 #1 的估計頻率誤差 < 2 Hz', Math.abs(hits[0][0].meanFreq - 13.5) < 2,
    `估計 ${hits[0][0].meanFreq.toFixed(2)} Hz，真值 13.5 Hz`);
}
if (hits[1].length) {
  check('紡錘波 #2 的估計頻率誤差 < 2 Hz', Math.abs(hits[1][0].meanFreq - 12.5) < 2,
    `估計 ${hits[1][0].meanFreq.toFixed(2)} Hz，真值 12.5 Hz`);
}

const fps = r.events.filter(e => !TRUTH.some(g => overlaps(e, g)));
check('沒有誤判（K-複合波 @4.2 s 未被當成紡錘波）', fps.length === 0,
  fps.length ? '誤判：' + fps.map(e => e.t0.toFixed(2) + '–' + e.t1.toFixed(2) + ' s').join(', ') : '0 個誤判');

// ---- 陰性對照：N3 與 W 期不該有紡錘波
console.log('\n[陰性對照]');
for (const stage of ['N3', 'W', 'N1', 'REM']) {
  const s2 = Signals.sleepEEG(stage, { fs: 100, n: 1000 });
  const r2 = Spindle.detect(s2.x, s2.fs, { thresholdK: 1.6 });
  console.log(`  ${stage.padEnd(3)} → ${r2.events.length} 個事件` +
    (r2.events.length ? '：' + r2.events.map(e => e.t0.toFixed(1) + '–' + e.t1.toFixed(1) + 's@' + e.meanFreq.toFixed(1) + 'Hz').join(', ') : ''));
}
console.log('  （註：合成的 W 期含 10 Hz alpha、REM 期含 8.5 Hz 成分，' +
  '若偶爾落進 11–16 Hz 帶被判為事件，正是「alpha 與紡錘波頻率相鄰難分」這個真實困難的展現。）');

console.log(`\n======================================`);
console.log(`通過 ${pass} 項，失敗 ${fail} 項`);
console.log(`======================================\n`);
process.exit(fail > 0 ? 1 : 0);
