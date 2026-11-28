# Antigravity 繁體中文漢化與換膚工具

> 使用邊界：本工具會修改 Google Antigravity 的 `app.asar`；[Google 通用條款](https://policies.google.com/terms)禁止修改其軟體。私人倉庫不改變此條款；詳見 [Google Antigravity 附加條款](https://antigravity.google/terms)。

[簡體中文版說明 (README.md)](README.md)

> **支援系統**：Windows & macOS（均附一鍵指令碼）  
> **匹配版本**：已實測適配至 **Antigravity 2.35.0**（支援 2.34+ Shell/Sheet 佈局、內建瀏覽器三層視圖、BaseWindow 系統匣與開發人員工具、WSL 選單漢化）；其他版本以實際測試為準。  
> **執行環境**：Node.js >=22.12.0；首次使用前執行 `npm ci --omit=dev` 安裝鎖定依賴。桌布素材處理的部分功能還需 Python 與 Wallpaper Engine。  
> **中文化範圍**：軟體介面（含自動化、遠端/WSL、內建瀏覽器、擴充功能與底部終端機）、頂部系統功能表、工作列右鍵選單（含動態 WSL 項目）、設定面板與更新彈窗（2.34+ 載入頁為純圖示，自動跳過文字替換）。  
> **注入原理**：記憶體增量改寫 `app.asar` 注入 `preload.js` 與主程序補丁（約 2 秒完成）；安裝前保留帶 SHA-256 校驗的版本化基線備份，恢復前會驗證備份。pointer 的元資料摘要可發現不一致，但不能證明官方簽章，也不能抵抗可同時改寫本地檔案的攻擊者。

> [!WARNING]
> **關於聊天歷史記錄/對話方塊內容被中文化的已知問題及匹配機制說明（開發者必讀）**：
> - **現象**：當你在聊天或對話方塊中發送了某些與軟體介面 UI 完全相同的英文關鍵詞或句子時，該對話氣泡在介面上可能會被翻譯引擎中文化顯示。
> - **核心匹配機制**：
>   - **短詞（長度 <= 15 字元，如 `Knowledge`）**：通常以精準匹配觸發；聊天內容仍有被誤譯的可能，請勿依賴引號作為可靠的隔離方式。
>   - **長句（長度 > 15 字元，如 `Enable Antigravity to deploy apps...`）**：子串匹配可能改變聊天文字的顯示；遇到誤譯時請以原文資料為準。
> - **說明**：目前尚未以端到端測試證明誤譯不會影響送出的內容；重要提示詞請自行核對。
> - **歡迎提 PR**：聊天內容隔離仍待完善，歡迎提供可重現案例與修正。

## 📸 中文化效果展示

以下是部分功能板塊的實際中文化效果展示，涵蓋登入引導頁、主編輯器介面與詳細設定面板：

### 1. 歡迎頁與登入新手引導
![歡迎頁與登入新手引導](./showimg/showlogin_tw.png)

### 2. 主編輯器介面與選單
![主編輯器介面與選單](./showimg/showmain_tw.png)

### 3. 詳細參數設定面板
![詳細參數設定面板](./showimg/showmenu_tw.png)

---

## 📂 專案檔案結構
- **`双击安装繁体中文.bat`** / **`.command`**：Windows / macOS 一鍵繁體中文化執行入口。
- **`双击卸载还原官方英文.bat`** / **`.command`**：Windows / macOS 從已保存基線恢復英文；檔名不代表已驗證官方來源。
- **`localization_engine.js`**：核心中文化邏輯，負責 app.asar 的解包、程式碼注入、重新打包以及 macOS 下的自動深度重新簽名。
- **`dicts_tw/`**：中文化字典資料夾，內含按模組分類 of JSON 對照翻譯字典。

---

## 🚀 極速使用指南

### 1. 取得中文化包程式碼（二選一）

* **方法 A：直接下載 ZIP 壓縮包（最便捷 📦）**
  1. 點擊頁面右上角綠色的 **`Code`** 按鈕。
  2. 在下拉選單中選擇 **`Download ZIP`** 並下載。
  3. 將下載好的壓縮包**解壓到您電腦本機的任意目錄**（例如您的 `Downloads` 資料夾）。

* **方法 B：透過 Git 命令列複製（開發者推薦 💻）**
  如果您本機安裝了 Git，可以直接在終端機執行複製命令：
  ```bash
  git clone https://github.com/KK-Skyline/antigravity-diy-toolkit.git
  cd antigravity-diy-toolkit
  npm ci --omit=dev
  ```

---

### 2. 一鍵安裝中文化
1. **完全退出** Antigravity 編程軟體。
2. 首次安裝或軟體更新後，先自行核對目前 `app.asar` 的來源與雜湊；確認接受其來源後，在本專案資料夾執行 `node localization_engine.js --tw --confirm-unverified-baseline`。此命令會建立版本化基線並**同時完成本次繁體安裝**，不是僅備份；工具不會驗證官方簽章。
3. 後續可進入您解壓或複製出來的 `antigravity-diy-toolkit` 資料夾：
   - **Windows**：雙擊執行 **`双击安装繁体中文.bat`**。
   - **macOS**：雙擊執行 **`双击安装繁体中文.command`**。
4. 依提示選擇左上角品牌顯示方式：顯示英文 Antigravity（預設推薦）、不顯示品牌名稱、或顯示繁體中文品牌名。
5. 執行完成後，重新啟動 Antigravity。

維運邊界：鎖檔僅以 PID 判斷程序存活；PID 重用時可能保守地拒絕安裝。請先確認沒有安裝器程序，再核對鎖、待恢復標記及基線備份，不要直接刪除。最後的程序檢查與寫入之間仍有競態。macOS 權限、簽章及斷電復原，Windows 檔案鎖與磁碟故障，仍須在目標機器上驗證；合成回歸不能取代實機測試。

### 品牌顯示命令列參數

如果您透過命令列執行 `localization_engine.js`，可使用 `--brand-title` 控制左上角品牌名：

```bash
# 預設推薦：左上角顯示 Antigravity
node localization_engine.js --tw --brand-title english

# 隱藏左上角品牌名
node localization_engine.js --tw --brand-title hidden

# 顯示繁體中文品牌名
node localization_engine.js --tw --brand-title translated
```

---

### 2.5 啟動桌布選擇庫網頁 (Wallpaper Hub)

> **前置條件**：
> 1. 已在專案根目錄執行過 `npm ci --omit=dev`；
> 2. **首次安裝或 Antigravity 升級新版本後**，請先完全退出 Antigravity 並執行一次帶基線確認的命令列安裝（Wallpaper Hub 不會自動建立新版本基線）：
>    ```powershell
>    node localization_engine.js --tw --wallpaper --confirm-unverified-baseline
>    ```
>    （若只需要桌布換膚、不需要中文化，可改加 `--only-skin`）。

**啟動網頁**
- **用戶端入口（Antigravity 2.x）**：以 `--wallpaper` 安裝後，點選左上角頂欄「視窗」右側的「桌布」按鈕，或在「檔案」選單選擇「桌布選擇庫」。快速鍵為 Windows 的 `Ctrl+Alt+W` 或 macOS 的 `Cmd+Alt+W`。入口會按需啟動 Hub，並在系統瀏覽器開啟 `http://127.0.0.1:3210`。
- **Windows 雙擊啟動**
  - 在倉庫資料夾直接雙擊 **`双击打开-壁纸选择库.bat`**，將自動啟動本機服務並以預設瀏覽器開啟 `http://localhost:3210`。
- **命令列啟動（通用）**
  - 在專案根目錄開啟終端機執行：
    ```powershell
    node wallpaper_hub_server.js
    ```
  - 服務就緒後，手動於瀏覽器開啟 **`http://localhost:3210`**（或 `http://127.0.0.1:3210`）。

**操作與常見排查**：
- 點擊任意已訂閱的 Wallpaper Engine 桌布卡片可展開右側抽屜微調透明度、模糊與亮度並一鍵套用；
- 網頁套用沿用 Hub 的自動安裝目錄尋找和預設安裝選項。從純換膚模式進入後，套用可能重新啟用中文化，也可能重設 `--tw` 和臨時外掛開關。如果安裝只能透過 `--install-dir` 找到，網頁套用會失敗。
- 若雙擊 `.bat` 後瀏覽器開啟過快顯示無法連線，等待 1 秒按 **F5** 重新整理即可；若提示連接埠 `3210` 已被佔用，請先確認監聽該連接埠的服務，再處理衝突。
- 從終端機或批次檔啟動時，關閉終端機或按 `Ctrl+C` 可結束服務。從用戶端啟動時，Hub 在背景執行，用戶端重新啟動後仍可存取。

---

### 3. 一鍵卸載還原
1. **完全退出** Antigravity 編程軟體。
2. 已確認的基線可在當前資料夾下執行：
   - **Windows**：雙擊執行 **`双击卸载还原官方英文.bat`**。
   - **macOS**：雙擊執行 **`双击卸载还原官方英文.command`**。
3. 若舊版基線 pointer 缺少確認標誌或元資料摘要，先自行核對備份來源，再執行 `node localization_engine.js --huifu --confirm-unverified-baseline`；未確認時會停止且不更動 ASAR。恢復目標是**已保存基線**，不是工具可證明的官方原版。

---

## 🔌 代理自動注入已停用

舊版的 `proxy_config/` 自動複製與卸載刪除沒有檔案歸屬記錄，可能覆蓋或刪除宿主檔案。本版不會自動注入或清理 `version.dll`、`dbghelp.dll`、`config.json`。若舊版曾注入代理，請先核對來源與雜湊，再人工處理；不要直接刪除同名檔案。

---

## 🛠️ 中文化原理說明

本引擎採用 **ASAR 包注入模式**，專為 **Antigravity 2.0+** 的 Electron 架構量身定制：
1. **運行狀態檢查**：預設在 Antigravity 仍運行時停止；只有明確使用 `--close-app` 才嘗試關閉後操作。
2. **版本化備份**：經使用者顯式確認來源後，操作前保存帶 SHA-256 元資料的基線包，恢復後仍保留備份。舊版 `.bak` 只有在兩份舊備份一致、可解析且使用者顯式確認後才會導入；這不保證官方來源。
3. **精準注入**：
   - 注入 `preload.js`：採用 WeakSet 記錄與 Shadow DOM 穿透，啟動高效的 `MutationObserver` 引擎，動態監測並將渲染層文字翻譯為繁體中文。
   - 注入 `menu.js`：深度補丁系統級標題列選單。
   - 注入 `tray.js`：中文化系統匣與右鍵通知狀態選單。
   - 注入 `loadingOverlay.js`：注入極具極客風格的趣味載入語：「反重力引擎已啟動，正在努力擺脫地心引力...」。

---

## 💡 如何透過 AI 助手自動補充或修改中文化？

如果在使用過程中，您發現了漏譯的英文，或者覺得某些繁體中文翻譯不夠道地，**您可以直接在對話視窗中命令您的 AI 編程助手（即 Antigravity）來幫您更新詞庫**！無論是直接發送螢幕截圖還是描述文字，AI 都會自動幫您把對照詞條寫入詞典。

> [!IMPORTANT]
> **⚠️ AI 助手如何定位您的中文化詞庫檔案？**
> 
> 1. **推薦做法（最省心）**：
>    In Antigravity 軟體中，點擊 **“開啟資料夾 (Open Folder)”**，直接將本中文化包目錄（即包含當前 `README_TW.md` 的資料夾）作為**專案/工作區**開啟，然後在此工作區下與 AI 對話。此時 AI 能夠直接感知並讀寫當前專案，您不需要提供任何路徑，直接發送翻譯要求，AI 就能在背景自動幫您改好詞典！
> 
> 2. **免開專案做法（提示詞中需指定中文化目錄）**：
>    如果您當前正在開發別的專案，沒有把中文化目錄作為專案開啟，那麼您在對 AI 發起中文化命令時，**必須在提示詞裡明確告訴 AI 您的中文化包所在路徑**，否則 AI 無法得知要修改您電腦上的哪個資料夾。
>    * **提示詞範例**：
>      > **“我的中文化包目錄在 `C:\Users\您的電腦使用者名稱\Downloads\antigravity_chinese`（請替換為您本機的實際路徑），請幫我把下面這張截圖裡漏譯的內容補全到詞典裡。”**

### 📋 常用提示詞（Prompt）模板

#### 1. 方式一：直接在對話中傳送截圖（推薦 📸）
如果您不方便打字，可以直接將未中文化乾淨的介面截圖貼上傳送給 AI，並附帶以下指令：
> **“幫我把這張截圖裡所有未中文化的英文選項和面板內容補全到繁體中文詞典中。”**
*(AI 會自動透過視覺識別截圖中的全部英文，並精準寫入字典。)*

#### 2. 方式二：直接在對話中傳送文字描述（極速 ✍️）
如果您只想修改或增加某一個特定詞彙，可以直接傳送文字描述給 AI：
> **“幫我把漏譯的英文 'Allow agent to view and edit files outside of the current workspace automatically' 翻譯為 '允許代理自動檢視並編輯當前工作區之外的檔案'。”**
*(AI 會立即找到對應的詞典並精準修改或追加該詞條。)*

---

### 🔄 更新生效流程
1. **命令 AI 更新**：在對話中透過截圖或文字告訴 AI 您的中文化需求，AI 會自動更新 `dicts_tw/` 下的字典檔案。
2. **退出軟體**：**完全退出**您的 Antigravity 軟體。
3. **重新注入**：在當前資料夾中**再次雙擊執行 `双击安装繁体中文.bat` / `.command`** 重新部署中文化。
4. **重啟軟體**：重新開啟 Antigravity，檢查改動是否生效。

---

## 📝 詞典自訂指南 (供極客手動使用)

如果您想手動修改翻譯，可以直接開啟 `dicts_tw/` 目錄下的 JSON 檔案：
- **`common.json`**：公共基礎詞彙、側邊栏概覽、登入頁、常用按鈕等。
- **`page_settings.json`**：包含極其豐富的詳細設定面板、權限二級選單對照。
- **`menu_nav.json`**：系統及選單列翻譯。

在 JSON 中新增一行，格式如下即可（注意英文逗號）：
```json
"Original English Text": "您的繁體中文翻譯"
```
儲存後，雙擊執行 **`双击安装繁体中文.bat` / `.command`** 重新部署中文化即可。

---

## 常見問題解答 (FAQ)

### 1）提示缺少 Node.js 或 ASAR 依賴
* **原因**：中文化引擎需要獨立安裝的 Node.js >=22.12.0 及倉庫鎖定的 `@electron/asar`。
* **解決**：安裝符合版本的 Node.js，在專案目錄執行 `npm ci --omit=dev`；之後打包與還原不會在執行時下載依賴。

### 2）提示「權限不足」或 macOS 提示「無法開啟」
* **解決**：
  - **Windows**：請右鍵點擊 `双击安装繁体中文.bat`，選擇 **“以系統管理員身分執行”**。
  - **macOS**：若雙擊執行 `.command` 提示無法開啟或沒有執行權限，可在終端機中執行 `chmod +x *.command` 來授權。工具會嘗試 Ad-hoc 重新簽名；實際權限、簽章和啟動結果仍須在目標機器驗證。

### 3）軟體官方更新後，中文化失效了怎麼辦？
* 軟體升級可能覆蓋 `app.asar`。完全退出後，先核對新版 `app.asar` 的來源與雜湊，再執行 `node localization_engine.js --tw --confirm-unverified-baseline` 建立新版基線並同時安裝；未確認時不得直接雙擊重裝。

---

## 🤝 致謝
- 本專案衍生自 [qqxpee/antigravity2-cn](https://github.com/qqxpee/antigravity2-cn)；原專案及貢獻者保有其權利。上游尚無授權檔案，本倉庫整體再發布與授權範圍待確認。
- 本倉庫未包含 Google Antigravity 或 Wallpaper Engine 的安裝檔案。問題回報請使用本倉庫的 [Issues](https://github.com/KK-Skyline/antigravity-diy-toolkit/issues)。
- 感謝所有參與測試與回饋的貢獻者！
- 舊版曾參考 [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy)；目前自動注入功能已停用。

---

## 🧩 外掛化架構與純換膚模式

本專案已將繁簡中文化、DevTools、黑曜石藍、Wallpaper Engine、失重壓克力主題及雨滴特效拆分為 `plugins/*` 下的獨立外掛，由 `core/plugin_loader.js` 與 `core/injector.js` 統一編排：
- **純換膚（不裝漢化）**：`node localization_engine.js --wallpaper --no-i18n`（或 `--only-skin`），僅注入桌布與主題，不注入中文翻譯；
- **按外掛開關**：支援 `--enable <id,...>` / `--disable <id,...>`（可用外掛：`i18n-zh`、`devtools`、`theme-obsidian-blue`、`wallpaper-engine`、`theme-acrylic`、`fx-rain`、`wallpaper-hub-launcher`）；
- **持久化外掛設定**：複製 `plugins.config.example.json` 為 `plugins.config.json`（已被 `.gitignore` 忽略），依需求修改各外掛開關與參數後，直接執行 `node localization_engine.js` 即可生效。命令列開關優先於設定檔：使用 `--wallpaper` 時會自動啟用 `wallpaper-hub-launcher`（如需關閉請加上 `--disable wallpaper-hub-launcher`）；不使用 `--wallpaper` 時可在 `plugins.config.json` 中單獨設為 `true` 啟用。
- **桌布選擇庫入口**：`--wallpaper --only-skin`（`--no-i18n`）同樣會啟用入口，並在頂欄 `Window` 右側顯示英文 `Wallpaper` 按鈕及 `File` 下的 `Wallpaper Hub...` 選單項目；如需完全隱藏入口並保持 `dist/menu.js` 零更動，請加上 `--disable wallpaper-hub-launcher`。可在外掛設定中分別控制 `showTopLeftButton` 和 `showMenuItem`，或將 `openMode` 設為 `"window"` 在用戶端內開啟（若希望重新啟動用戶端後繼續保留網頁，請保持預設的 `"browser"` 系統瀏覽器模式）。
