# EMD × 睡眠訊號分析 — 互動演算法教學網站

> 為 2026-09-24 **黃鍔（Norden E. Huang）院士演講**預備的課堂作業。
> 主題：經驗模態分解（Empirical Mode Decomposition, EMD）與它在睡眠訊號分析上的意義。

**線上版：** _（Zeabur 部署完成後填入網址）_
**原始碼：** <https://github.com/ewinkuo1-sudo/emd-sleep-interactive>

---

## 這個網站在做什麼

一句話：**用可以當場操作的演算法，解釋為什麼傅立葉轉換不適合分析睡眠腦波，而 EMD 適合——以及 EMD 自己有哪些做不到的事。**

網站上每一張圖都是瀏覽器**即時算出來的**，不是預錄動畫或截圖。
EMD、Hilbert 轉換、FFT、三次樣條、紡錘波偵測全部以 vanilla JavaScript **從頭實作**，沒有引用任何外部數學函式庫。

### 五個頁面

| 頁面 | 內容 |
|---|---|
| **[為什麼需要 EMD](index.html)** | 用 chirp 掃頻訊號當場示範 FFT 糊成一片高原、EMD + Hilbert 給出一條乾淨斜線 |
| **[互動演算法](emd.html)** | **逐步執行 sifting 迭代**：看極值點、上下包絡、均值曲線、相減結果怎麼互動。可調 SD 停止門檻、迭代上限、IMF 數量上限。支援滑鼠手繪自訂訊號 |
| **[睡眠應用](sleep.html)** | 睡眠分期（W/N1/N2/N3/REM）的 EEG 頻段對應到 IMF 層級；**固定頻帶濾波 vs EMD 自適應分解**並排對照；STFT vs Hilbert-Huang 時頻圖；**用 HHT 實作的紡錘波偵測器**（可調參數看敏感度／特異度怎麼互換） |
| **[論文導讀](papers.html)** | 16 篇文獻，每篇寫「解決什麼問題、結論是什麼」，全部附**實際開啟確認過**的連結 |
| **[EMD 的極限](limits.html)** | mode mixing、頻率解析度下限、端點效應、停止準則、EEMD/CEEMDAN 的代價——**每一項都有現場跑出來的量化證據** |

---

## 一個誠實的前提

這份作業的題目是「EMD 在睡眠上的研究」。實際查證之後，必須先報告一個發現：

> **黃鍔院士本人的著作清單裡，找不到任何以睡眠為主題的論文。**

查核方式（2026-09-19）：

- [Google Scholar 個人頁](https://scholar.google.com/citations?user=ohK5A7EAAAAJ&hl=en)（總引用數 97,043；1998 年 EMD 原始論文 34,102 次引用）——列出的著作中**沒有**標題含 sleep、spindle、polysomnography、insomnia、apnea 的論文
- [陽明交大學術資源網個人頁](https://scholar.nycu.edu.tw/en/persons/norden-e-huang/)（職稱：腦科學研究所 Contract Research Fellow）——同樣沒有睡眠主題著作
- 多組關鍵字搜尋「Huang + sleep + EMD」，回來的睡眠論文**全部**是其他團隊的著作，只是引用了 Huang 1998

**所以本站的主軸不是「硬找一篇睡眠論文充數」，而是回答更根本的問題：為什麼一個為海洋波浪與地球物理訊號發展出來的方法，會被睡眠研究界大量採用？**
答案在訊號的性質。他做的是**方法學**，睡眠是**下游應用**——而這個分工本身正是理解 EMD 意義的關鍵。

查得到的最直接證據鏈在 [Hou et al. 2018](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2018.00809/full)：該篇用 EEMD 量化睡眠慢波活動，方法段寫著「The MATLAB code for EEMD was shared by RCADA」——RCADA 正是黃鍔在中央大學創立的資料分析研究中心。**方法是透過釋出的程式碼流進睡眠研究的，不是透過他掛名論文。**

（`rcada.ncu.edu.tw` 該站 2026-09-19 實測已離線，但 [Internet Archive 的 2019-01-29 存檔](https://web.archive.org/web/20190129064758/http://rcada.ncu.edu.tw/research1.htm)還在，頁面上確實列著「HHT MATLAB program」與「Fast EMD/EEMD Code」的下載連結。）

---

## 演算法實作

### 核心模組（皆為 UMD，瀏覽器與 Node 通用）

| 檔案 | 內容 |
|---|---|
| `js/emd.js` | EMD 核心：極值偵測、**自然三次樣條**、**Rilling 端點鏡像延伸**、sifting 迭代、IMF 抽取、EEMD |
| `js/dsp.js` | FFT（基-2 Cooley–Tukey + **Bluestein chirp-z** 處理任意長度）、Hilbert 轉換、瞬時頻率、STFT、零相位 FIR 帶通濾波 |
| `js/signals.js` | 測試訊號產生器（雙頻、chirp、間歇叢發、**依 AASM 特徵合成的五期睡眠 EEG**） |
| `js/spindle.js` | 基於 Hilbert-Huang 轉換的睡眠紡錘波偵測器 |
| `js/plot.js` | Canvas 繪圖層（時間序列、IMF 堆疊、時頻熱圖、十字準星 tooltip） |

### 實作上的幾個決定

- **端點處理用 Rilling et al. (2003) 的鏡像對稱延伸**（`boundaryConditions`），不是簡單的重複或補零。三次樣條在端點缺乏極值支撐時會發散，這是 EMD 最常見的實作瑕疵來源。
- **停止準則 SD 用「和的比值」而非原文的逐點相除**：`SD = Σ(h_k − h_{k+1})² / Σ h_k²`。原文的逐點形式在 `h_k(t) ≈ 0` 處會爆炸，目前絕大多數實作都改用這個版本。
- **FFT 用 Bluestein 處理非 2 冪長度**。睡眠 EEG 常見的取樣點數（例如 100 Hz × 10 s = 1000 點）不是 2 的冪，補零會扭曲 Hilbert 解析訊號、讓瞬時頻率失真。
- **色彩通過色盲可辨識度檢查**：藍／橘／青三色在明暗兩模式下，all-pairs CVD ΔE ≥ 8、一般視覺 ΔE ≥ 15。均值曲線刻意用虛線 ink 而非第四個色相，避免落入不安全的配色組合。圖例一律顯示，色彩不單獨承載意義。

---

## 驗證

演算法正確性用**成分已知的合成訊號**驗證，可自行重跑（不需安裝任何套件）：

```bash
node test/test-emd.mjs       # 44 項檢查
node test/test-spindle.mjs   #  6 項檢查
```

### `test-emd.mjs` 驗了什麼

| 項目 | 結果 |
|---|---|
| FFT/IFFT 往返（N = 256/777/1000/1024） | max\|Δ\| < 1e-12 |
| **與暴力 DFT 逐項比對（含虛部正負號）** | max\|Δ\| < 1e-9 |
| 純弦波的 Hilbert 瞬時頻率／振幅 | 7.0000 Hz / 1.0000（期望 7 / 1） |
| **雙頻 1 Hz + 12 Hz 分解** | IMF1 = **11.999 Hz**、IMF2 = **0.998 Hz**；振幅估計 0.500 / 0.988（真值 0.5 / 1.0） |
| **完全重建 Σ IMF + residue = x** | max\|Δ\| = **2.2e-16**（浮點捨入極限） |
| IMF 條件 \|極值數 − 零交越數\| ≤ 1 | 每層皆滿足 |
| 三頻 1.5 / 8 / 30 Hz 分離 | 29.98、8.00、1.50 Hz |
| Chirp 瞬時頻率追蹤 | 5.43 → 21.50 Hz，能量 100% 落在 IMF1 |
| 五個睡眠期的分解與完全重建 | 全數通過，IMF 頻率單調遞減 |
| 邊界情況（單調、全零、極短訊號） | 不當掉、不產生假 IMF |

### `test-spindle.mjs` 驗了什麼

合成 N2 訊號放入兩個已知紡錘波（13.5 Hz @ 2.0–3.0 s、12.5 Hz @ 6.4–7.3 s）與一個 K-複合波（@4.2 s）：

```
選中 IMF 1（11–16 Hz 帶內能量佔該層 56.6%）
偵測到 2 個事件：
  2.12–2.90 s（0.78 s），峰值 43.3 µV，平均頻率 13.76 Hz
  6.55–7.17 s（0.62 s），峰值 41.8 µV，平均頻率 11.82 Hz
真值 2 個 · 命中 2 · 漏掉 0 · 誤判 0
陰性對照 N3 / W / N1 / REM → 各 0 個事件
```

頻率估計誤差 < 2 Hz，K-複合波沒有被誤判成紡錘波。

> **這能證明什麼、不能證明什麼**
> 能證明的：程式碼本身沒寫錯，HHT 流程在成分已知的訊號上能把事先放進去的事件找回來。
> **不能證明的：在真實 PSG 上的表現。** 真實紀錄有肌電雜訊、眼動假影、個體間頻率差異，而且人類判讀者對紡錘波的一致性本身也只有 Cohen's κ ≈ 0.5–0.6。要宣稱臨床效能，必須在 MASS 或 DREAMS 這類有專家標註的公開資料集上評估——**本作業沒有做到這一步，網站上也明確寫了。**

---

## 開發過程中發現並修掉的兩個真實 bug

這兩個都是測試抓出來的，記錄下來因為它們很典型：

1. **Bluestein FFT 算出的是共軛 DFT。**
   FFT/IFFT 往返測試會通過（正反兩邊符號一致就抵銷了），振幅頻譜也正常（只取模長），
   但 **Hilbert 解析訊號的旋轉方向反了，所有瞬時頻率變成負值**。
   加上「與暴力 DFT 逐項比對（含虛部正負號）」這項測試才抓到。
   教訓：往返測試無法偵測共軛翻轉，必須跟獨立實作對比。

2. **合成紡錘波用了 Hann 包絡，導致「0.9 秒的紡錘波」實際上只有約 0.45 秒維持高振幅**，
   比 AASM 判讀標準的 ≥ 0.5 秒還短，偵測器怎麼調參數都抓不到。
   問題出在**測試訊號不符合生理現實**，不是偵測器。改用 Tukey 窗（兩端漸變、中間持平）後正常。

另外，[EMD 的極限](limits.html)頁面記錄了一個**誠實的否定結果**：文獻上常說「過度 sifting 會磨平 IMF 的振幅變化」，本站實際掃描 SD 門檻從 1.0 到 0.002，**在測試訊號上量不出這個趨勢**（振幅動態範圍先升後降、全距僅 14%）。網站上照實寫，沒有照抄教科書說法。

---

## 本地執行

純靜態網站，**沒有 build step、沒有相依套件**。任何靜態伺服器都可以：

```bash
git clone https://github.com/ewinkuo1-sudo/emd-sleep-interactive.git
cd emd-sleep-interactive

# 方法一：Python（大多數系統內建）
python3 -m http.server 8000

# 方法二：Node
npx serve .
```

然後開 <http://localhost:8000>。

> 直接用 `file://` 開 `index.html` 也能看，但部分瀏覽器會擋 `file://` 的跨檔案載入，**建議還是起一個本機伺服器**。

---

## 部署到 Zeabur

本 repo 已備妥 Zeabur 純靜態部署所需的一切：

- `index.html` 在**根目錄**（Zeabur 的靜態偵測依據）
- `zbpack.json` 內含 `{"output_dir": "."}`，**明確指定**以根目錄作為靜態輸出，不做任何 build
- **刻意不放 `package.json`** — 有 `package.json` 會讓 zbpack 判定為 Node.js 專案並嘗試 build，破壞靜態部署

### 手動步驟

1. 開 <https://zeabur.com>，用 **GitHub 帳號登入**並授權
2. **Create Project** → 選一個區域（建議 `Hong Kong` 或 `Tokyo`，離台灣近）
3. 專案內點 **Add Service** → **Git** → **GitHub**
4. 若是第一次使用，點 **Configure GitHub App**，把 `ewinkuo1-sudo/emd-sleep-interactive` 加進授權的 repo 清單
5. 在 repo 清單選 **`emd-sleep-interactive`**，分支選 `main`
6. Zeabur 會自動判定為 **Static** 服務並開始部署（約 30 秒～1 分鐘）
7. 部署完成後進該服務的 **Networking** 分頁 → **Generate Domain**，輸入一個子網域名稱（例如 `emd-sleep`），
   取得 `https://<你取的名字>.zeabur.app`
8. 開那個網址確認五個頁面都能跑，圖表有正常繪出
9. 把網址填回本 README 最上方的「線上版」欄位，commit 並 push

> **如果 Zeabur 誤判成別的類型**（例如偵測到 Node）：
> 進服務的 **Settings**，確認 Build Command 與 Start Command 都是空的；
> 或確認 `zbpack.json` 有正確 push 上去。
> 也可以在服務設定裡把 **Plan Type** 手動改成 `static`。

---

## 引用的關鍵文獻

完整清單（16 篇，含每篇的問題／結論摘要）在 **[論文導讀頁](papers.html)**。核心三篇：

1. **Huang, N. E. et al. (1998).** The empirical mode decomposition and the Hilbert spectrum for nonlinear and non-stationary time series analysis. *Proc. R. Soc. Lond. A*, 454(1971), 903–995. [doi:10.1098/rspa.1998.0193](https://doi.org/10.1098/rspa.1998.0193) — EMD 原始論文，本站所有演算法的依據
2. **Wu, Z., & Huang, N. E. (2009).** Ensemble empirical mode decomposition: a noise-assisted data analysis method. *Advances in Adaptive Data Analysis*, 1(1), 1–41. [doi:10.1142/S1793536909000047](https://doi.org/10.1142/S1793536909000047) — EEMD，解 mode mixing
3. **Huang, N. E. et al. (2016).** On Holo-Hilbert spectral analysis: a full informational spectral representation for nonlinear and non-stationary data. *Phil. Trans. R. Soc. A*, 374(2065), 20150206. [doi:10.1098/rsta.2015.0206](https://doi.org/10.1098/rsta.2015.0206) · [PMC4792412](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4792412/) — HHSA，處理跨頻率耦合

實作參照：

- **Rilling, G., Flandrin, P., & Gonçalvès, P. (2003).** On empirical mode decomposition and its algorithms. *IEEE-EURASIP NSIP-03*. [PDF](https://perso.ens-lyon.fr/patrick.flandrin/NSIP03.pdf) — 端點鏡像延伸的作法出處
- **Rilling, G., & Flandrin, P. (2008).** One or Two Frequencies? The Empirical Mode Decomposition Answers. *IEEE Trans. Signal Processing*, 56(1), 85–95. [PDF](https://perso.ens-lyon.fr/patrick.flandrin/04359551.pdf) — 頻率解析度下限

---

## AI 協作聲明

**本專案由人與 AI（Claude）協作完成。**

AI 實際參與的部分：

- **程式碼撰寫**：EMD／Hilbert／FFT／樣條／繪圖／紡錘波偵測的實作
- **測試設計與除錯**：上面記錄的兩個 bug 都是在 AI 設計的測試中被抓出來並修正的
- **文獻搜尋與查核**：每個連結都實際抓取過內容，作者與結論取自抓到的頁面
- **文案撰寫與繁體中文潤飾**

刻意維持的原則：

- **不編造文獻。** 查不到就寫「未找到」——[論文導讀頁](papers.html)有專門一節記錄「找過但沒找到」的項目，包含黃鍔的睡眠論文、演講講題、以及三篇取不到全文的論文。
- **不宣稱沒驗證過的事。** 演算法的每個數字都來自可重跑的測試；連「教科書說法重現不出來」這種否定結果也照實寫。
- **清楚區分合成資料與真實資料。** 網站上所有睡眠 EEG 都是合成的，每一頁都標明這一點，不用它宣稱任何關於真實人類睡眠的結論。

---

## 授權

[MIT](LICENSE) © 2026 Ewin Kuo

陽明交通大學 生醫光電研究所
