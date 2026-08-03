# PLAN — Rebuild Footer + Notification + Popup/Panel (Local-First)

> Ngày: 2026-07-23 · Nguồn: audit 3-agent (footer / notification / popup-panel).
> Nguyên tắc: SEOSONA Flow = 100% LOCAL, không account/backend. **Xoá dead-weight
> monetization/auth, giữ + nâng cấp các control local thật sự hữu ích.** Brand xanh
> `#3d6ff5` (KHÔNG magenta/gold). Giữ `authManager` stub (514 ref), `window.showNotification`,
> `NotificationManager`, pipeline-footer runtime.

---

## 0. TL;DR — 3 phát hiện lớn

1. **Có HAI footer.** `#appFooter` (account/plan, Download/Retry = **đèn báo read-only** + quota) bị
   ẩn **3 tầng** (inline `sidebar.html:1499` + `.footer{display:none!important}` `sidebar.css:5802`
   + monetization CSS `12051-12108`). Riêng `.seosonaflow-pipeline-footer` (progress lúc gen) là
   **runtime, sống tốt, GIỮ**.
2. **Download/Retry không mất.** Auto-download có toggle thật ở Settings (`#autoDownloadToggle`
   settings.html:374) + toolbar Gen (`#genTabAutoDownload` sidebar.html:781), chạy end-to-end,
   **không bị gate** (local mode `featureGate.canUse` luôn true). **Auto-retry KHÔNG có control global**
   — chỉ còn code chết `els.execRetries` (settings-page.js:1381) + `WorkflowExecutor.retryOnFail`.
   → phải **TẠO MỚI**.
3. **Rác monetization/auth khắp nơi** — agent khuyến nghị **xoá hẳn** (đều dead trong local mode):
   `openUpgradeModal`+payment block (app.js:9014-9165), `loginOverlay`/`upgradeOverlay` (DOM đã mất,
   handler null-guard), `tipOverlay`/`conversionToast` (0 ref JS), `premiumBenefitsOverlay`,
   `usageStatsPremiumTeaser`, FeatureGate upsell/crown/trial, monetization CSS + i18n keys chết.

---

## 1. Findings đầy đủ

### 1.1 Footer
- **`#appFooter`** (sidebar.html:1499-1629): 3 state loại trừ nhau `#footerFree` / `#footerPremium` /
  `#footerGuest`. Mỗi state = cụm feature (Download/Retry indicator ✓/✗) + cụm quota (Gen/Tasks/Workflows)
  + pro-label. Local mode **luôn** rơi nhánh premium (`isPremium` hard-true app.js:6403) → quota `∞` giả;
  nhánh free/guest chết; `updateFooterUsageBars`/`updateTrialFooterBars` (đọc `af_daily_stats` thật) không
  bao giờ chạy. Có `setInterval` (app.js:8397) chạy phí cho footer đã ẩn.
- **CSS**: `.footer*` ~290 dòng/55 rule `sidebar.css:5802-6096` (+ premium modal magenta/gold 6146-6156).
- **Pipeline footer**: `.seosonaflow-pipeline-footer*` `sidebar.css:5594-5800`, do
  `PipelineFooter.js`+`ExecutionTracker.js`. GIỮ.

### 1.2 Notification / toast / tracker
- **Toast** `window.showNotification` (app.js:78-124): CSS trong sidebar.css (không mất khi xoá
  notification.css), ~315 ref/40 file, XSS-safe, 1 toast/lần, dedup 3s, hover-pause. Không có action button.
- **Browser notif** `NotificationManager` (chrome.notifications): trigger `generation/task/workflow:complete`;
  mute qua Settings `#notifyOnComplete` (459) / `#notifySound` (463); webhook/Telegram chết local.
- **Header bell 🔕**: **KHÔNG còn trong source** (NotificationBell.js đã xoá) → icon trong ảnh = **build cũ/cache**.
- **Tracker**: "Đang khởi tạo 0/5 0:12" = `FloatingTracker` chèn **trên trang Flow** (content.js:1473+), KHÔNG phải
  header sidebar. 3 bản gần trùng: content.js FloatingTracker + floating-tracker-rich.js (ChatGPT/Grok) +
  QueueMonitor (tab Logs). Accent **xanh-lá `#19d07b`**, chưa phải xanh SEOSONA.
- **Bug**: `window.showToast` chưa từng định nghĩa → mọi nhánh `typeof window.showToast==='function'` là code chết.

### 1.3 Popup / modal / panel
- **LIVE** cần giữ: settingsDropdown, project-indicator-dropdown, multiTabBanner, utilitiesDropdownMenu,
  addonPromptPopup, wfCreateDropdown, confirmRunOverlay, taskConfirmRunOverlay, usageStatsOverlay (strip),
  onboardingOverlay, queuePanelContainer, + modal JS: AlbumCreate/ImagePicker/VoiceSelect/CharacterSelect/
  StyleSelect/TaskModal/PromptAssistant/WorkflowAgent/SnippetsPanel/QueuePanel, dialog chung **CustomDialog**.
- **DEAD (0 ref JS)**: `tipOverlay` (127-184), `conversionToast` (1856-1868).
- **DORMANT/DOM-dead**: `upgradeOverlay`+`openUpgradeModal`+payment (app.js:9014-9165), `loginOverlay` (mọi
  caller null), `premiumBenefitsOverlay`, `usageStatsPremiumTeaser`, ShareWorkflowModal/SaveTemplateModal/
  WorkflowMediaModal (backend/admin).
- **Cơ chế ẩn**: RuntimeMode.js:80-94 add body class `hide-upgrade-ui`+`seosona-hide-monetization` →
  CSS `sidebar.css:12051-12108` + `settings.css:1513-1532` ẩn toàn bộ upgrade/login/plan/crown.
- **Vấn đề cấu trúc**: KHÔNG có BaseModal chung (mỗi modal tự dựng overlay/backdrop/close); **z-index loạn**
  (9999 → 2147483647, max-int ×2); 2 mount root (`#flow-auto-sidebar-root` vs body) → hack re-parent;
  `.hidden` xung đột `display:none!important` → "mở mà vô hình".

---

## 2. Bug/Issue registry

| # | Mức | Vấn đề | Vị trí |
|---|---|---|---|
| B1 | High | Auto-retry không có control global (chỉ code chết) | settings-page.js:1381; WorkflowExecutor |
| B2 | Med | `window.showToast` không tồn tại → fallback chết, toast có thể mất | MessageBridge:609, PromptQueue:560, WorkflowExecutor:2937, … |
| B3 | Med | Footer ẩn 3 tầng redundant; state-machine luôn premium giả (∞) | sidebar.html:1499, sidebar.css:5802, app.js:6396-6828 |
| B4 | Med | `setInterval` chạy cho footer đã ẩn (phí) | app.js:8397 |
| B5 | Med | ~30 site `openUpgradeModal` + payment providers = dead code | app.js:9014-9165 + guards nhiều file |
| B6 | Low | tipOverlay / conversionToast DOM mồ côi | sidebar.html:127, 1856 |
| B7 | Low | z-index loạn, không token; 2 mount root | toàn bộ modal |
| B8 | Low | Tracker accent xanh-lá, 3 bản trùng | content.js, floating-tracker-rich.js, QueueMonitor |
| B9 | Low | i18n keys + comment chết (notification.bell.*, changelog.*) | en.js/vi.js, 3 comment |
| B10 | Low | Header bell build cũ (source đã sạch) | — (reload extension) |

---

## 3. Kiến trúc đích (local-first)

- **Footer mới** = 1 thanh "Quick controls" gọn: toggle **Auto-download** thật (bind `af_settings.autoDownload`)
  + toggle **Auto-retry** thật (bind `af_settings.retryOnFail`) [+ tuỳ chọn: counter local hôm nay
  gen/tasks/wf từ `af_daily_stats`, dạng thông tin trung tính — KHÔNG quota/∞]. Xoá plan/quota/upgrade.
- **Notification** = 2 primitive: `showNotification` (toast) + `NotificationManager` (OS notif, gate Settings).
  Alias `showToast→showNotification`. Tuỳ chọn nút mute nhanh.
- **Tracker** = 1 renderer chung (rút từ floating-tracker-rich.js), accent `#3d6ff5`.
- **Modal** = 1 `BaseModal` (backdrop + focus-trap + ESC + mount tại body) + thang z-index token; confirm/alert
  chuẩn hoá về `CustomDialog`.
- **Xoá** toàn bộ monetization/auth DOM+JS+CSS thay vì ẩn.

---

## 4. Phases & Tasks

### Phase 1 — Purge dead monetization/auth (nền)
- P1.1 Xoá DOM chết: tipOverlay (127-184), conversionToast (1856-1868), premiumBenefitsOverlay (1820-1836),
  usageStatsPremiumTeaser (1794), sseNotif/rateLimitNotif (202/215).
- P1.2 Xoá JS chết: `openUpgradeModal`+`renderUpgradeModal`+payment block (app.js:9014-9165); mọi nhánh
  `loginOverlay`; ~30 guard `typeof window.openUpgradeModal`; genAllLocked login/upgrade CTA.
- P1.3 FeatureGate: bỏ upsell/crown/trial/quota machinery; `canUse` local→true tường minh; bỏ
  `showModuleBlockedDialog` nhánh upgrade/login. GIỮ stub interface (514 ref).
- P1.4 Xoá CSS monetization (sidebar.css:12051-12108, settings.css:1513-1532) + i18n keys chết + 3 comment.
- ✅ Verify: 0 dangling ref; check:static/architecture/budgets xanh.

### Phase 2 — Footer rebuild (headline)
- P2.1 Xoá `#appFooter` 3-state + quota + proLabel; gỡ **cả 3** cơ chế ẩn.
- P2.2 Gộp state-machine footer (updateFooterUI/…/updatePremiumBadge app.js:6396-6828) → bỏ hoặc còn 1 hàm nhỏ;
  xoá setInterval 8397.
- P2.3 Dựng footer mới "Quick controls" (SEOSONA blue): toggle Auto-download + Auto-retry [+ counter local].
- P2.4 CSS mới `.footer*` (thay ~290 dòng cũ). GIỮ pipeline-footer.

### Phase 3 — Auto-retry feature (mới)
- P3.1 Model: thêm `af_settings.retryOnFail` (default off) + `maxRetries` (default 2).
- P3.2 Settings UI toggle + wire (settings-page.js); xoá `els.execRetries` chết.
- P3.3 Wire WorkflowExecutor đọc `af_settings.retryOnFail` làm default (đã honor `this.settings.retryOnFail`).
- P3.4 Footer toggle (P2.3) bind cùng key. Đồng bộ 2 chiều.

### Phase 4 — Notification/toast hardening
- P4.1 Alias `window.showToast = window.showNotification` (1 chỗ) → kill nhánh chết B2.
- P4.2 (Tuỳ chọn) Toast nâng cấp: hàng đợi nhiều toast + nút action.
- P4.3 (Tuỳ chọn) Nút mute nhanh (header/footer) bind `af_settings.notifyOnComplete`.

### Phase 5 — Tracker unification + rebrand
- P5.1 Rút 1 renderer chung từ floating-tracker-rich.js; content.js + provider script tiêu thụ.
- P5.2 Recolor accent `#19d07b`→`#3d6ff5`. Verify widget "Đang khởi tạo 0/5" trên Flow/ChatGPT/Grok.

### Phase 6 — Modal/overlay consolidation
- P6.1 `BaseModal`/`BaseOverlay` primitive (backdrop + focus-trap + ESC + mount body).
- P6.2 Thang z-index token (`--z-overlay/modal/toast/critical`), xoá max-int ad-hoc.
- P6.3 Port Voice/Character/Style/Image → BaseModal trước; rồi TaskModal/Album/PromptAssistant/WorkflowAgent.
- P6.4 Chuẩn hoá confirm/alert về CustomDialog; recolor magenta/gold còn sót.

### Phase 7 — Verify & commit
- P7.1 check:static/architecture/budgets + tests. Regenerate baselines (theo thứ tự contracts→inventory).
- P7.2 Live-verify: reload extension → footer toggle, toast, tracker, modal z-order, dark/light.
- P7.3 Commit (chọn lọc, đừng `git add -A`).

---

## 5. Quyết định — ĐÃ CHỐT (2026-07-23)
- **Q1 Purge = XOÁ HẲN TOÀN BỘ** monetization/auth (Phase 1 đầy đủ). Giữ authManager/featureGate stub interface.
- **Q2 Footer mới = toggle Auto-download + Auto-retry (thật) + counter local** (gen/tasks/wf hôm nay, info trung tính).
- **Q3 usageStatsOverlay = GIỮ, strip thành counter local thật** (gen/tasks/workflows hôm nay + tổng), bỏ premium/quota-server.
- **Q4 Modal refactor = LÀM NGAY** — BaseModal chung + z-index token scale trong đợt này (Phase 6).
