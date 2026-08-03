# SEOSONA Flow — Audit cấu trúc toàn hệ (2026-07-23)

> Audit READ-ONLY toàn bộ side panel: code ownership, routing/lifecycle, UX flows, CSS/design.
> Câu hỏi gốc: *"Các tab / main-tab đã tách bạch chưa (code + UX/UI/design), hay vẫn chồng chéo?"*
> **Trả lời ngắn: CHƯA tách bạch trên MỌI trục.** Việc ẩn/hiện pane (`display`) thì sạch, nhưng phía sau
> mọi thứ quấn quanh 2 hub (`app.js` + `GenTab`), routing bị xé 2 file + 1 hàm chết, UX trùng lặp, CSS
> không scope + hệ token chết.

---

## 0. Bản đồ tab (8 tab)

| Nav hiển thị | pane id thật | Module sở hữu | Vị trí | Init |
|---|---|---|---|---|
| **Gen** | `#tab-gen` | `GenTab` (static global) | nav | **Eager (boot)** |
| **Spaces** | `#tab-workflow` ⚠️ | `WorkflowTab` | nav | Lazy |
| **Prompts** | `#tab-templates` ⚠️ | `BundledPromptGallery` + `MyPromptsTab` | nav | Lazy |
| **Tasks** | `#tab-tasks` | `MultiTaskTab` (vỏ 46 dòng) + **engine trong app.js** | nav | Lazy |
| Photos | `#tab-photos` | `PhotosTab` | ⋮ | Lazy |
| Tools | `#tab-tools` | (chỉ là lưới launcher, không module) | ⋮ | — |
| History | `#tab-history` | `HistoryTab` | ⋮ | Lazy |
| Logs | `#tab-logs` | inline `_setupLogsSubtabs` | ⋮ | mixed |

⚠️ **id ≠ nhãn**: `tab-templates`→"Prompts", `tab-workflow`→"Spaces". Toàn bộ code/CSS vẫn tên cũ.

---

## 1. Bảng điểm mức độ

| Mức | Số | Chủ đề |
|---|---|---|
| 🔴 Critical | 4 | god-object app.js + engine Tasks lạc chỗ · GenTab hub global · tokens.css chết · 1,125+ !important / không scope |
| 🟠 High | 6 | routing xé 2 file + hàm chết · prompt-entry 3 nơi · 3 hệ batch-gen · trùng toolbar/button/empty-state · Tasks logic split+dup · nav bằng synthetic-click |
| 🟡 Medium | 6 | không teardown → leak observer+poller · full-reload mỗi lần switch · pool window-global · hard-code hex (workflow/albums ~50%) · empty-state theme bug · scaffold monetization chết vẫn chạy |
| 🟢 Low | 4 | nợ đặt tên · dup active-tab restore · module-pending tùy hứng · UI ẩn/disabled sót |

---

## 2. CODE — ownership & coupling

### 🔴 C1. `app.js` là god-object; **engine chạy Task ~2000 dòng nằm trong app.js**, không phải trong `MultiTaskTab`
- `MultiTaskTab.js` chỉ là **vỏ 46 dòng** (wire `TaskList` + `window.taskModal`). Toàn bộ logic chạy task nằm ở `app.js`:
  `eventBus.on('task:run')` (3848), `tasks:run_batch` (3969), `_executeTaskViaChatGPT` (4298), `_executeTaskViaGrok` (4793), `executeSingleTask` (5247) → **~dòng 3848-5900**, duplicate theo từng provider.
- app.js còn nắm `setupTabSwitching`, `initializeTab`, `refreshModuleOverlays` (lặp mọi pane), **30+ `eventBus.on`**, và thao tác DOM cả 7 pane (tab-gen ×25, tab-workflow ×23, tab-templates ×17, tab-tasks ×13...).

### 🔴 C2. `GenTab` là singleton `static` global, bị 6 module ghi thẳng vào — hub state trung tâm
- `window.GenTab.thumbnailCache` / `.fileIdsInput` bị mutate trực tiếp bởi: `PhotosTab.js:454-478`, `app.js:7239-7275`, `TemplatesTab.js:577/1076/1174`, `PromptAssistantModal.js:1301`, `WorkflowEditor.js:17034` (gọi cả method `_private`), `AngleExecution.js:63` (đọc DOM node của Gen).
- Tự ghi chú **"150+ references"** tới `GenTab.thumbnailCache[id]`. `thumbnailCache`/`fileNameCache` là getter/setter ủy quyền sang `window.MediaRegistry`.

### 🟠 C3. Chuyển tab bằng **giả lập click** `'.seosonaflow-tab[data-tab="tab-gen"]'`
- ≥3 module tự "với tay" đổi tab (`PhotosTab.js:477`, `app.js:7274`, `TemplatesTab.js:577`) thay vì gọi 1 API routing → điều hướng không có chủ.

### 🟡 C4. Pool window-global chia sẻ lớn
- `window.pendingUploadFiles` (29 chỗ ghi), `_targetFlowTabId` (18, app.js ghi ↔ MessageBridge đọc), `_currentProjectId` (13), `_currentTaskExecutionToken` (9)... Coupling ngầm xuyên tab.
- `window.generationHistory` được Gen/Tasks/Workflow/McpExecutor cùng ghi, HistoryTab đọc.

**Verdict code:** KHÔNG tách bạch — quấn quanh 2 hub `app.js` + `GenTab`. Các tab lazy (Workflow/History/Templates) thì tương đối gọn.

---

## 3. ROUTING & LIFECYCLE

### 🟠 R1. Switch xé **2 file + 1 hàm chết**
1. `SidebarManager._bindCoreEvents` (`SidebarManager.js:104-122`) — **nơi DUY NHẤT** toggle `.active` + lưu `af_active_sidebar_tab`. Đây là switch thật.
2. Handler ẩn trong `app.js:2822-2847` — chỉ gate + `initializeTab`, **không** toggle `.active`.
3. `setupTabSwitching()` (`app.js:3384-3504`, ~120 dòng) — **KHÔNG bao giờ được gọi**, nhưng comment ở `app.js:8045/8049` vẫn tưởng nó chạy. → code chết + gây hiểu nhầm.
- Hệ quả: 1 hành động (click tab) trải 2 file; nếu SidebarManager fail thì content init nhưng pane không đổi.

### 🟡 R2. Không teardown → rò rỉ
- `GenTab` gắn **MutationObserver lên `document.body`** (`GenTab.js:251`, subtree) lúc boot, **không bao giờ disconnect** (`_destroyThumbObserver` có ở :4734 nhưng 0 call-site).
- `AlbumList` **poller 30s** (`AlbumList.js:61`) chạy mãi sau khi mở Photos 1 lần (`destroy()` không được gọi khi switch).

### 🟡 R3. Full re-render mỗi lần vào tab
- tab-tasks `loadTasks()`, tab-workflow `loadWorkflows()+loadSharedWorkflows()`, tab-photos `refresh()` → reset scroll/filter + tốn perf. Templates thì init-once (không reload) → **không nhất quán**.

### 🟢 R4. Restore active-tab trùng 2 nơi
- `SidebarManager._restoreActiveTab` (416) + block trong `app.js:2944-2976` cùng đọc `af_active_sidebar_tab`.

✅ Overflow ⋮ menu (`SidebarManager.js:221-255`) sạch. Không có nguy cơ "2 active"/"none active".

---

## 4. UX / FEATURE OVERLAP

| # | Chồng chéo | Bằng chứng |
|---|---|---|
| U1 | **"Lấy prompt" ở ≥3 nơi**, tất cả đổ vào `#promptsArea`: tab Prompts (`TemplatesTab:539`), modal Prompt Assistant (`PromptAssistantModal:1285`), + 4 nút trong Gen (scan/txt/merge/save) | `sidebar.html:254-282` |
| U2 | **3 hệ batch-gen**: Gen multi-prompt (Song song) · Tasks (job đã lưu, `TaskModal` tự chế lại provider strip) · Spaces `runAllWorkflows` | `TaskModal:41-90` dup `#genProviderTabs` |
| U3 | **My Spaces ≈ Flows** — chỉ khác cờ `flow_kind==='flow'`; cả 2 đều list+run. `data-subtab` còn lệch nhãn: `workflows`→"My Spaces", `mytemplates`→"Flows" | `WorkflowTab.js:307-331,640` |
| U4 | **"Templates" = 2 tab khác nhau**: Prompts→Templates (thư viện prompt) vs Spaces→Templates (workflow) | `sidebar.html:795` vs `WorkflowTab.js:309` |
| U5 | **Xem kết quả ở 3 nơi**: History · Photos→Flow Images · Gen→Failed Prompts | `HistoryTab:60`, `sidebar.html:1032/748` |
| U6 | 2 entry tạo workflow trong Spaces: FAB 3-option + empty-state buttons | `sidebar.html:955/944` |

**Phân cấp main↔sub lệch:** `Tools` chỉ là lưới 4 icon nhưng ở top-level; `Prompts` thực chất là drawer cho Gen; `History/Photos` bị đẩy vào ⋮ trong khi `Tasks` (hẹp hơn) lại ở nav chính; Photos còn có 3 tầng (`data-search-tab`).

**Verdict UX:** chồng chéo & khó hiểu. Chỉ **Gen** có việc rõ ràng. Đề xuất: gộp **Prompts → drawer của Gen**; **Tasks → "job đã lưu"** của Gen; **My Spaces + Flows → 1 list** có toggle run/edit.

---

## 5. CSS / DESIGN

### 🔴 D1. `styles/tokens.css` (tự xưng "single source of truth") **KHÔNG được load ở bất kỳ đâu**
- `grep tokens.css` = rỗng. Token thật là namespace **khác** inline trong `sidebar.css:36-131` (dùng 1,641 lần). 2 hệ **lệch số**: `radius-sm` 4px vs 6px, `space-5` 24 vs 20, accent `#0e4099` vs `#3d6ff5`. Ai theo docs dùng `--sf-*` → CSS chết.

### 🔴 D2. **1,125+ `!important`** (sidebar.css 660, workflow.css 465) — global style đánh nhau vì không scope.

### 🟠 D3. **5/8 pane có 0 selector `#tab-*`** — tab chỉ tránh đụng nhau bằng tiền tố tên (`wf-`/`photos-`/`task-`/`angles-`), không có bảo đảm cấu trúc.

### 🟠 D4. Trùng lặp component:
- **Toolbar** ~12-16 class (`.wf-toolbar`, `.task-toolbar`, `.myprompts-toolbar`, `.seosonaflow-workflow-toolbar` **và** `.seosonaflow-wf-toolbar`...) → nên gộp `.sf-toolbar`.
- **Nút CTA** ≥5 họ (`.btn-generate`, `.angles-generate-btn`, `.wf-create-workflow-btn`, `.gen-type-btn`, `.photos-channel-btn` 69 lần) → CTA mỗi tab một kiểu.
- **Empty-state** 5 bản (generic ×2 định nghĩa cạnh nhau `:6426/:6446` + 4 biến thể tab).
- `.btn-primary` set **nền trắng** `#fff` + `width:100%` (không phải xanh brand).

### 🟡 D5. Hard-code hex: workflow.css ~49%, albums.css ~45% → **không re-theme sạch** (light mode vá bằng 91 `.theme-light`). Empty-state baked `rgb(33 33 33/85%)` → hỏng light.

✅ Rebrand blue ~95% xong (lime/magenta chỉ còn ở comment).

---

## 6. SCAFFOLD CHẾT VẪN CHẠY (dọn an toàn)

- `module-pending` + `checkModuleAccess` + `showModuleBlockedOverlay` + `tabModuleMap` + `storageManager.mode==='api'` migration → chạy mỗi lần switch dù local cho phép tất cả.
- `genAllLockedOverlay` (login/upgrade) `sidebar.html:210`, `optCreateTemplate` (Admin) hidden, toolbar Tasks ship `disabled` (nháy "chết" lúc first-paint), model Gemini/Claude `hidden`.

---

## 7. LỘ TRÌNH TÁI CẤU TRÚC (đề xuất)

### Tier 0 — Quick win, an toàn, giá trị cao (xóa/dọn, ít rủi ro)
1. **Xóa `setupTabSwitching()` chết** (120 dòng) + comment lạc `:8045/8049`.
2. **Quyết 1 nguồn token**: xóa `tokens.css` chết → tài liệu hóa token inline `sidebar.css` là chuẩn (hoặc reconcile rồi load). Chặn cái bẫy.
3. **Vá leak**: gọi `AlbumList.destroy()` / `_destroyThumbObserver()` khi switch-away (hoặc scope observer theo tab).
4. **Bỏ scaffold monetization** khỏi đường switch (module-pending, blocked-overlay, api-migration).

### Tier 1 — Cấu trúc code (rủi ro vừa, giá trị cao)
5. **Tách engine Tasks** khỏi app.js → `TaskEngine`/`MultiTaskTab` (~2000 dòng), gộp path chung 3 provider.
6. **1 `TabRouter` duy nhất** nắm switch + init + **teardown** (interface `init/reload/destroy`), gộp 2 handler + bỏ dup restore.
7. **Thay mutation trực tiếp `window.GenTab.*`** bằng hợp đồng qua `eventBus` hoặc service `MediaRegistry`/ref-image mà GenTab cũng chỉ là consumer.

### Tier 2 — Gộp UX (cần quyết định sản phẩm)
8. Prompts → drawer của Gen. 9. Làm rõ/gộp 3 hệ batch. 10. My Spaces + Flows → 1 list. 11. Đồng bộ nhãn↔id↔class (hoặc ít nhất tài liệu hóa map).

### Tier 3 — Design system
12. 1 token file (được load) · 1 hệ `.btn` (primary = xanh brand) · gộp `.sf-toolbar` + `.empty-state` · scope style theo tab hoặc kỷ luật layer · giảm `!important`.

---

*Nguồn: 4 audit agent song song (code / routing / UX / CSS) + scout routing. Tất cả bằng chứng `file:line` ở trên.*
