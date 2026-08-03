# Thiết kế: Gộp 4 tracker → 1 CORE + adapter per-context

> Mục tiêu (user): 4 tracker (Flow / ChatGPT-Grok-Gemini-Claude / sidePanel) đang **chồng chéo,
> copy-paste, dễ nhầm**. Gộp về **1 core dùng chung** + mỗi context 1 "bộ mặt" riêng (màu/tên/logo/
> action). Build **thật chắc, ranh giới rõ, không nhầm nhau**.

## 1. Nguyên tắc phân tầng (chống chồng chéo)

```
┌─────────────────────────────────────────────────────────────┐
│  TrackerCore  (1 module DUY NHẤT — logic tracking thuần)      │
│  • data model chuẩn hoá  • tính %/counts/elapsed             │
│  • render KHUNG (header, hàng job, thanh %, nút)             │
│  • state machine: hidden→visible→completing→hidden           │
│  • KHÔNG biết mình đang ở context nào                        │
└───────────────▲──────────────▲───────────────▲──────────────┘
                │ config        │ config        │ config
      ┌─────────┴───┐  ┌────────┴────┐  ┌───────┴──────────┐
      │ FlowAdapter │  │ ChatAdapter │  │ SidePanelAdapter │
      │ trang Flow  │  │ chat pages  │  │ footer extension │
      └─────────────┘  └─────────────┘  └──────────────────┘
```

**CORE không chứa gì đặc thù context.** Mọi khác biệt → adapter khai báo tường minh qua `config`.

## 2. ProviderRegistry (tên + logo + màu)

Tái dùng `ProviderMeta` (đã có `getName` + `_FALLBACK_ICONS` cho flow/chatgpt/grok/gemini/claude) +
THÊM bảng **màu per-provider** (hiện chưa có — màu cũ theo owner-type prompts/task/workflow):

| slug | name (ProviderMeta) | logo (ProviderMeta) | màu (THÊM) |
|---|---|---|---|
| flow | Google Flow | ✓ (SVG gradient) | `#3186FF` |
| chatgpt | ChatGPT | ✓ | `#10a37f` |
| grok | Grok | ✓ | `#e5e7eb` (mono) |
| gemini | Gemini | ✓ | `#4285F4` |
| claude | Claude | ✓ | `#D97757` |

API: `ProviderRegistry.get(slug) → { name, icon, color }`. 1 nguồn sự thật cho identity → hết drift màu/label.

## 3. TrackerCore — API + data model

**Data model chuẩn hoá** (adapter chuyển data nguồn về shape này):
```
{
  provider: 'flow'|'chatgpt'|'grok'|'gemini'|'claude'|'pipeline'|'workflow',
  isRunning: bool,
  overall: { completed, total, submitted?, elapsedMs },
  jobs: [ { id, label, state, completed, total, startedAt, nodeProgress? } ],
  pipeline?: { sent, active, waiting, done, failed }   // hàng pipeline (tuỳ)
}
```

**API:**
```
const t = TrackerCore.create(config)   // tạo instance
t.update(data)   // nhận data model chuẩn → render/show/hide theo state machine
t.hide()         // ẩn + dọn listener (KHÔNG leak)
t.destroy()      // gỡ hẳn
```

**config (adapter khai báo — ĐÂY là ranh giới per-context):**
```
{
  mount:      () => HTMLElement,          // nơi gắn (Flow page / chat page / footer)
  provider:   'flow' | ...  | fn(data),   // provider để lấy name/logo/màu từ Registry
  actions:    { stop?, pause?, resume?, cancel? },  // nút nào + làm gì (khác nhau mỗi context)
  dataEvents: ['pq:trackerUpdate'|'queue:state_changed'|'execution:tracker_update'],
  toDataModel: (raw) => ({...}),          // map data nguồn → data model chuẩn
  features:   { nodeProgressScrape?: bool, drag?: bool, autoHideMs?: 3000 }
}
```

## 4. Phân định 3 adapter (khác biệt PHẢI giữ)

| | FlowAdapter | ChatAdapter | SidePanelAdapter |
|---|---|---|---|
| **Mount** | trang Flow (fixed) | trang ChatGPT/Grok/Gemini | footer sidePanel |
| **Provider** | flow | detect theo tab | pipeline/workflow |
| **Actions** | run/pause/**cancel** (pq:stopAll/stopJob/pause/resume) | pause/cancel (pq) | **STOP NẶNG**: workflowExecutor+ExecutionGate.cancelAll+abort chat+PromptQueue.stopAll+ExecutionLock.stopCurrent+`execution:force_stopped` |
| **Data** | pq:trackerUpdate | pq:trackerUpdate | queue:state_changed / execution:tracker_update(legacy) |
| **Đặc thù** | **cào node-% từ DOM Flow mỗi 2s** | — | mode ON↔OFF (Pipeline vs legacy) |

→ SidePanel action Stop **cố ý nặng hơn** (dừng toàn hệ) — KHÔNG được đánh đồng với pq:stopAll của Flow.

## 5. Luồng data (giữ nguyên, chỉ đổi renderer)

```
PromptQueue._buildSnapshot()
   ├─ queue:state_changed (local eventBus) ──→ SidePanelAdapter.toDataModel → Core.update
   ├─ pq:trackerUpdate (→ tab Flow)        ──→ FlowAdapter.toDataModel → Core.update
   └─ pq:trackerUpdate (→ tab chat)        ──→ ChatAdapter.toDataModel → Core.update
Legacy (Pipeline OFF): ExecutionLock.broadcastTracker → execution:tracker_update → SidePanelAdapter
```
Cross-context relay (chrome.runtime.sendMessage → background fan-out → onMessage → eventBus) **giữ nguyên**.

## 6. Migration (từng bước, commit riêng, smoke-test mỗi context)

1. **ProviderRegistry** — thêm màu per-provider vào ProviderMeta (additive, an toàn). ✅ verify preview.
2. **TrackerCore** — module mới, chưa ai dùng (an toàn). Unit-test render bằng data model giả.
3. **FlowAdapter** → chuyển `FloatingTracker` (content.js) sang Core. **Smoke-test: chạy workflow trên Flow.**
4. **ChatAdapter** → chuyển `floating-tracker-rich`. **Smoke-test: chạy trên ChatGPT/Grok.**
5. **SidePanelAdapter** → chuyển `ExecutionTracker`+`PipelineFooter` (gộp 2 bar sidePanel làm 1). **Smoke-test: chạy workflow, xem footer.**
6. Xoá code cũ sau khi từng adapter chạy OK.

⚠️ Mỗi bước 3-5 là JS chạy lúc execution thật → **tôi không runtime-verify được**, cần user smoke-test đúng context đó rồi mới sang bước kế. Lỗi → revert đúng 1 bước.

## Ràng buộc
- KHÔNG đổi luồng event/relay (chỉ đổi renderer).
- Giữ 3 khác biệt: action Stop sidePanel (nặng), Flow DOM-scrape, provider identity.
- Giữ 2-kênh error + brand màu.
