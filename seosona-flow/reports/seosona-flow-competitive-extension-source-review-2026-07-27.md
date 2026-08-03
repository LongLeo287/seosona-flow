# SEOSONA Flow Competitive Extension Source Review — 2026-07-27

## 1. Mục tiêu

Report này đánh giá 4 extension đang có trong Chrome profile local:

- Grabbit 3.9.5
- aPix Builder Web Extension 1.4.0
- Ultimate Web Scraper 3.2 / source folder 6.3.4
- external Flow automation reference 1.2.7

Mục tiêu không phải copy source của extension khác, mà là bóc tách mô hình vận hành, UX pattern, data model, permission model và điểm rủi ro để quyết định phần nào nên học hỏi và áp dụng cho SEOSONA Flow.

## 2. Phạm vi và phương pháp kiểm tra

### 2.1. Nguồn kiểm tra

- Source extension đã cài trong Chrome profile local.
- Manifest, content scripts, background scripts, side panel/popup files, bundled scripts, storage/data model strings.
- Source SEOSONA Flow local để đối chiếu manifest, modules hiện có và dấu vết liên quan external Flow automation reference/external bridge reference.

### 2.2. Giới hạn

- Đây là review source local đang có trên máy, không khẳng định là version mới nhất trên Chrome Web Store.
- Một số extension dùng bundle/minified code nên phần đánh giá phải dựa trên manifest, strings, runtime action names và cấu trúc bundle.
- Không thực hiện reverse-engineering vượt quá phạm vi audit kỹ thuật nội bộ.
- Không áp dụng code vào SEOSONA Flow trong report này.

### 2.3. Tiêu chí đánh giá

Mỗi extension được đánh giá theo:

- Chức năng chính.
- Kiến trúc extension.
- Cách vận hành trong browser.
- UX pattern đáng học.
- Data model/storage.
- Permission/security risk.
- Khả năng áp dụng vào SEOSONA Flow.

## 3. Kết luận nhanh

| Extension | Giá trị học hỏi chính | Mức nên áp dụng | Ghi chú |
|---|---:|---:|---|
| aPix Builder Web Extension | Image import/staging, right-click image to template, IndexedDB TTL, MIME validation | Rất cao | Phù hợp trực tiếp với workflow ảnh/video và reference image của SEOSONA Flow |
| Ultimate Web Scraper | Visual element picker, selector tester, automation results table, export layer | Rất cao | Có thể biến SEOSONA Flow thành công cụ workflow + data extraction/review mạnh hơn |
| Grabbit | Drag-select collector, smart-select repeated cards, URL/title export, action repair/migration | Cao | Rất hợp cho batch URL/image/reference collection |
| external Flow automation reference | Bridge/status layer, API adapter, notification center, run window | Cao nhưng phải viết lại sạch | Không được trỏ external Flow automation reference/external bridge reference/external reference domain; chỉ học pattern |

Ưu tiên nâng cấp đề xuất cho SEOSONA Flow:

1. Source Capture & Staging Layer.
2. Visual Element Picker & Extract/Click Node Builder.
3. Workflow Results Table.
4. Drag-select Collector.
5. SEOSONA-owned Bridge/API Adapter Status Layer.
6. Notification & Run Event Center.
7. Permission Hardening.

## 4. Baseline hiện tại của SEOSONA Flow

### 4.1. Version và cấu trúc chính

SEOSONA Flow local hiện là version 1.1.37 theo manifest.

Các điểm đã có:

- Side panel chính.
- Workflow/templates/prompts/tasks/history/albums.
- Content scripts riêng cho Flow, ChatGPT, Gemini, Grok, Claude.
- Image-to-prompt/content capture flow.
- Context menu cho gửi ảnh/trang/selection/link vào SEOSONA Flow.
- Download, queue, workflow execution, local storage, template gallery.
- Một phần kiểm soát selector/health/watermark/credits.

### 4.2. Điểm SEOSONA đang tốt hơn external Flow automation reference local

- Không thấy dấu vết `external reference domain`.
- Không thấy hard reference tới external bridge reference extension ID trong scoped scan.
- Có thêm hỗ trợ Claude.
- Host permissions có xu hướng tách required/optional tốt hơn external Flow automation reference.
- Cấu trúc module content scripts rõ hơn.

### 4.3. Khoảng trống lớn còn thấy

- Chưa thấy một abstraction thật sạch kiểu “pending import package” cho ảnh/link/data từ web vào workflow node.
- Chưa thấy visual element picker đầy đủ kiểu CSS/XPath tester + match count + tạo node extraction/click.
- Chưa thấy results table/workflow dataset workspace cho output sau khi chạy workflow.
- Chưa thấy bridge/status layer độc lập kiểu connector readiness dot + API adapter queue.
- Chưa thấy drag-select collector chuyên cho batch URL/image/reference.

## 5. Extension 1 — aPix Builder Web Extension 1.4.0

### 5.1. Chức năng chính

aPix Builder tập trung vào một flow rất rõ:

1. Người dùng right-click ảnh trên webpage.
2. Extension capture/fetch ảnh đó.
3. Ảnh được đóng gói thành một import package.
4. Side panel mở ra.
5. Người dùng chạy template aPix/Comfy/RunningHub với ảnh đó.

Đây là pattern rất gần với nhu cầu của SEOSONA Flow: lấy ảnh tham chiếu từ web, đưa vào prompt/template/workflow, rồi chạy sinh ảnh/video.

### 5.2. Kiến trúc

Các module đáng chú ý:

- `background.js`
  - Tạo context menu.
  - Mở side panel.
  - Nhận message fetch/capture.
  - Tạo pending import.
  - Có DNR rules để sửa request headers cho một số domain.
- `imageFetch.js`
  - Fetch ảnh theo nhiều attempt.
  - Validate MIME/magic bytes.
  - Fallback DOM capture.
- `imageStaging.js`
  - IndexedDB staging.
  - TTL khoảng 1 giờ.
  - Inline image nếu nhỏ.
  - Store binary nếu lớn.
  - Trả về staging reference.
- `imageImport.js`
  - Build import image package.
- `tabImageCapture.js`
  - Inject script vào tab để tìm/capture ảnh theo URL/candidate.
- `templates/index.json`
  - Built-in template registry.

### 5.3. Data model đáng học

aPix có mô hình pending import khá sạch:

- `requestId`
- `url`
- `pageUrl`
- `tabId`
- `windowId`
- `stagingId`
- `embeddedImage`
- `autoRun`
- `createdAt`

Với SEOSONA Flow, model này có thể mở rộng thành:

- `importId`
- `sourceType`: image, page, selection, link, video, dataset
- `sourceUrl`
- `pageUrl`
- `tabId`
- `windowId`
- `mimeType`
- `byteSize`
- `sha256`
- `inlinePayload`
- `stagingRef`
- `target`: prompt, workflow_node, album, template_preview, reference_image
- `createdAt`
- `expiresAt`

### 5.4. Điểm mạnh

- Flow một bước rất tự nhiên: right-click ảnh rồi chạy template.
- Staging tách rõ small/large payload.
- Có TTL để tránh storage phình vô hạn.
- Có validate ảnh bằng MIME/magic bytes, giảm sai file.
- Có fallback nhiều tầng khi fetch ảnh bị chặn.

### 5.5. Rủi ro

- DNR sửa headers cho domain third-party là vùng nhạy cảm.
- Background fetch proxy nếu mở rộng quá rộng có thể tạo SSRF-like behavior.
- `<all_urls>` host permission khiến phạm vi quá lớn nếu không có gating.
- `unlimitedStorage` cần lifecycle cleanup thật chặt.

### 5.6. Áp dụng vào SEOSONA Flow

Nên áp dụng mạnh, nhưng viết lại theo chuẩn SEOSONA:

- Tạo `SourceCaptureService`.
- Tạo `ImportStagingStore` bằng IndexedDB, TTL mặc định 1-24 giờ tùy loại asset.
- Dùng `seosona-staging://<uuid>` làm reference nội bộ.
- Validate file signature trước khi đưa vào workflow.
- Kết nối thẳng tới workflow node: reference image, input image, inspiration image, page evidence, prompt seed.
- Không dùng DNR header rewrite rộng; chỉ allowlist nếu thật sự cần.

## 6. Extension 2 — Ultimate Web Scraper

### 6.1. Chức năng chính

Ultimate Web Scraper là extension thu thập dữ liệu web qua side panel:

- Extract text.
- Extract images.
- Extract links.
- Extract emails/phones.
- Extract Google Maps data.
- Extract lists.
- Load more/pagination/infinite scroll.
- Pick element trên page.
- Export data ra table/csv/xlsx/json-like outputs.

### 6.2. Kiến trúc

Extension này dùng bundle lớn:

- `background.bundle.js`
- `sidepanel.bundle.js`
- `table.bundle.js`
- `pageElementPicker.bundle.js`

Source không đẹp để học theo cách code, nhưng đáng học về product pattern.

### 6.3. Pattern quan trọng phát hiện được

#### Visual Element Picker

Các strings/action cho thấy có overlay chọn element:

- Pause/resume picking.
- Extract data from selected element.
- Click selected element during run.
- Add element by CSS selector.
- Add element by XPath selector.
- Test selector.
- Trạng thái selector:
  - không match element nào;
  - match duy nhất 1 element;
  - match nhiều element.

Đây là thứ SEOSONA Flow nên có để người dùng không cần tự viết selector.

#### Automation action runner

Các action phát hiện được:

- click
- scroll
- find view
- load more
- pagination
- infinite scroll
- extract list
- extract pages
- extract text/email/phone/image/link

Nếu đem sang SEOSONA Flow, các action này nên trở thành node:

- `Extract Text`
- `Extract Image`
- `Extract Link`
- `Extract List`
- `Click Element`
- `Scroll Page`
- `Wait For Element`
- `Load More`
- `Paginate`
- `Export Results`

#### Result workspace/table

Data model bundle thể hiện:

- `automations`
- `tableData`
- `tableRows`
- `automationId`
- `tableDataId`
- `dataHash`
- `metadata.extractionType`

SEOSONA Flow hiện có workflow/template/history nhưng chưa thấy một “results table workspace” rõ ràng cho mỗi workflow run. Đây là khoảng trống lớn.

### 6.4. Điểm mạnh

- UX rõ: chọn element trực tiếp trên page.
- Có table view để review kết quả.
- Có export layer.
- Có extraction profiles theo loại dữ liệu.
- Permission model nhìn tốt hơn nhiều extension khác vì không inject content script mặc định lên mọi page; dùng `activeTab`, `scripting`, `sidePanel`, optional host permissions.

### 6.5. Rủi ro

- Bundle minified lớn, khó audit sâu.
- `web_accessible_resources` cho nhiều bundle trên `<all_urls>` là bề mặt tấn công cần cẩn trọng.
- Optional `cookies` permission nhạy cảm, SEOSONA Flow nên tránh nếu không có lý do bắt buộc.
- Scraping có thể va vào policy/ToS của website; cần UX cảnh báo.

### 6.6. Áp dụng vào SEOSONA Flow

Nên áp dụng ở tầng product/UX:

- Tạo Visual Picker overlay.
- Tạo Extract/Click/Scroll node builder.
- Tạo Workflow Results Table.
- Tạo export data sau workflow run.
- Tạo selector health/checker cho node tự động.
- Tạo “sample rows preview” trước khi chạy full workflow.

Không nên copy:

- Bundle/minified architecture.
- Cookies permission.
- Global web-accessible bundle exposure.

## 7. Extension 3 — Grabbit 3.9.5

### 7.1. Chức năng chính

Grabbit tập trung vào thao tác nhanh với link:

- Drag để chọn nhiều links.
- Copy URLs/titles theo format.
- Mở nhiều tabs/windows.
- Tạo bookmarks.
- Highlight links đã chọn/đã visit.
- Premium AI product comparison.

### 7.2. Kiến trúc

Các module đáng chú ý:

- `js/grabbit.js`
  - Quản lý drag selection, selection box, highlight, keyboard/mouse state.
- `js/logic.js`
  - Xử lý link selection, filter, nested links, hidden/fixed elements.
- `js/smart-select.js`
  - Heuristic chọn link quan trọng trong card/grid lặp lại.
- `js/background.js`
  - Settings migration/repair, tabs/windows/bookmarks/AI API.
- `popup/popup.js`
  - User action configuration.

### 7.3. UX pattern đáng học

#### Drag-select collector

Người dùng giữ key/mouse combo, kéo một vùng trên page, extension chọn các link nằm trong vùng đó.

Với SEOSONA Flow, pattern này có thể mở rộng thành:

- Chọn nhiều link sản phẩm để tạo batch prompt.
- Chọn nhiều ảnh làm reference set.
- Chọn nhiều video URL để tạo workflow input.
- Chọn nhiều card để extract title/image/price/link.

#### Smart-select repeated cards

Grabbit cố nhận diện nhóm link lặp lại bằng visual/DOM signature:

- tag chính;
- font-size;
- bold;
- visual importance;
- structure type;
- heading/ARIA/child elements.

Đây là cách hay để tránh lấy nhầm nav/footer/ads và ưu tiên title/product/card links.

#### Action repair/migration

Background có logic repair/migrate action settings để đảm bảo saved actions không bị lỗi khi schema thay đổi.

SEOSONA Flow có rất nhiều template/workflow/prompt config, nên cần một migration layer mạnh tương tự.

### 7.4. Điểm mạnh

- Tác vụ rất nhanh, không cần form dài.
- Drag interaction tự nhiên.
- Có dedupe/reverse/order.
- Có nhiều output format: URL, title, markdown, JSON.
- Có smart selection cho danh sách/card grid.
- Có migration/repair saved action.

### 7.5. Rủi ro

- Content scripts chạy trên `<all_urls>` và `all_frames`.
- Có `clipboardRead`, là quyền nhạy cảm.
- `host_permissions` gồm `<all_urls>` và Supabase API.
- Nếu áp dụng vào SEOSONA Flow, nên dùng activeTab/on-demand injection thay vì inject mọi nơi.

### 7.6. Áp dụng vào SEOSONA Flow

Nên tạo `BatchCollector`:

- Drag-select vùng trên page.
- Collector mode:
  - links;
  - images;
  - cards;
  - media;
  - selected text;
  - mixed assets.
- Smart grouping theo DOM/visual signature.
- Dedupe + order preservation.
- Export vào workflow input table hoặc template variables.

Ví dụ workflow SEOSONA:

1. Người dùng mở trang sản phẩm.
2. Kéo chọn 20 card.
3. SEOSONA tự lấy title/image/link/price.
4. Đổ thành table.
5. Chạy workflow tạo video review sản phẩm hàng loạt.

## 8. Extension 4 — external Flow automation reference 1.2.7

### 8.1. Chức năng chính

external Flow automation reference là extension gần SEOSONA Flow nhất:

- Auto Flow / Google Flow.
- ChatGPT/Grok/Gemini automation.
- Batch prompt.
- Smart workflows.
- Auto download 2K/4K.
- Workflow templates.
- Bridge connector.
- Notification UI.

### 8.2. So sánh manifest với SEOSONA Flow

external Flow automation reference local có:

- `sidePanel`
- `scripting`
- `tabs`
- `downloads`
- `notifications`
- `alarms`
- `contextMenus`
- `clipboardWrite`
- `unlimitedStorage`
- host permissions rất rộng, gồm `external reference domain` và `<all_urls>`.

SEOSONA Flow local có:

- Core automation tương tự.
- Thêm Claude support.
- Không thấy `external reference domain`.
- Không thấy hardcoded external bridge reference ID trong scoped scan.
- Optional hosts tách tốt hơn cho các site ngoài core.

### 8.3. Module external Flow automation reference đáng học

#### BridgeClient

external Flow automation reference có bridge client kết nối tới một extension bridge riêng.

Pattern đáng học:

- Bridge readiness ping.
- Status cache.
- Token ready/token age.
- Flow tab open status.
- Streaming request qua port.
- Timeout/error handling.

Không được copy nguyên:

- Hardcoded external bridge reference extension ID.
- Toby domain.
- Token relay design nếu chưa redesign security.

#### FlowBridgeStatusDot

Pattern UX tốt:

- Dot trạng thái hiển thị sẵn trong UI.
- Ready/warn/off.
- Click dot để mở Flow tab hoặc options.
- Poll định kỳ.
- Chỉ hiển thị khi API mode/feature gate bật.

SEOSONA nên có bản riêng:

- `SEOSONA Connector Ready`
- `Token missing`
- `Flow tab closed`
- `Permission missing`
- `Queue busy`
- `Provider degraded`

#### FlowApiAdapter

Pattern đáng học:

- Adapter tách automation web khỏi API/bridge mode.
- Concurrency queue.
- Mapping model/ratio/tier.
- Submit/poll/generate/upscale.
- Fallback nếu bridge không sẵn sàng.

SEOSONA nên có adapter layer:

- `WebAutomationProvider`
- `BridgeProvider`
- `ApiProvider`
- `LocalMockProvider`

#### NotificationBell / NotificationPanel

Pattern đáng học:

- Unread badge.
- Polling fallback.
- SSE/event bus.
- Leader/follower coordination để tránh nhiều tab cùng poll.
- Notification panel riêng.

SEOSONA có thể dùng cho:

- Workflow complete.
- Workflow failed.
- Download ready.
- Template update.
- Credit/usage alert.
- Provider outage.
- Connector disconnected.

### 8.4. Rủi ro

- external Flow automation reference local gắn với `external reference domain`.
- Bridge ID hardcoded.
- OAuth bridge/token relay từ webpage sang extension là vùng rủi ro cao.
- `<all_urls>` trong required host permissions là quá rộng.
- Một số module bridge/notification/API mode có thể làm tăng phức tạp nếu đưa vào SEOSONA khi chưa có architecture boundary rõ.

### 8.5. Áp dụng vào SEOSONA Flow

Chỉ nên học pattern, không copy identity/coupling:

- Viết lại bridge client với namespace SEOSONA.
- Không trỏ external Flow automation reference/external bridge reference/external reference domain.
- Không dùng token từ web page query/message theo kiểu thô.
- Bridge protocol phải có:
  - strict origin allowlist;
  - one-time auth state;
  - nonce;
  - token storage phân tầng;
  - token redaction/log scrubbing;
  - timeout;
  - revoke flow;
  - permission UI rõ.

## 9. Những thứ nên học và đưa vào SEOSONA Flow

### 9.1. P0 — Source Capture & Staging Layer

Nguồn học: aPix.

Mục tiêu:

- Bất kỳ ảnh/link/selection/page nào trên web đều có thể trở thành input của SEOSONA Flow.
- Người dùng không phải download thủ công.
- Workflow node nhận được reference ổn định thay vì raw page state.

Thành phần:

- `SourceCaptureService`
- `ImportStagingStore`
- `PendingImportController`
- `ContextMenuImportActions`
- `ImportTargetResolver`

Data:

- `seosona-staging://<uuid>`
- TTL cleanup.
- Inline threshold.
- MIME/magic-byte validation.
- Hash dedupe.

### 9.2. P0 — Visual Element Picker & Node Builder

Nguồn học: Ultimate Web Scraper.

Mục tiêu:

- Người dùng chọn element bằng mắt.
- SEOSONA tự tạo node extract/click/scroll/wait.
- Không bắt người dùng viết selector.

Thành phần:

- Picker overlay.
- CSS/XPath tester.
- Match count.
- Highlight matched elements.
- Extract preview.
- Convert to workflow node.

Node đề xuất:

- Extract Text.
- Extract Link.
- Extract Image.
- Extract List.
- Click Element.
- Scroll Page.
- Wait For Element.
- Load More.
- Paginate.

### 9.3. P0 — Workflow Results Table

Nguồn học: Ultimate Web Scraper.

Mục tiêu:

- Mỗi workflow run có output table để review, lọc, sửa và export.
- Không chỉ lưu lịch sử dạng text/log.

Data model:

- `runs`
- `datasets`
- `rows`
- `columns`
- `assets`
- `exports`

UX:

- Table tab trong workflow detail.
- Filter/sort/search.
- Preview image/video.
- Export CSV/JSON/XLSX.
- Send selected rows to another workflow.

### 9.4. P1 — Drag-select Batch Collector

Nguồn học: Grabbit.

Mục tiêu:

- Thu batch link/image/card nhanh từ một webpage.
- Tạo input hàng loạt cho workflow.

Mode:

- Link collector.
- Image collector.
- Card collector.
- Text selection collector.
- Mixed asset collector.

UX:

- Kéo vùng chọn.
- Highlight item.
- Counter.
- Dedupe.
- Preview list trước khi import.

### 9.5. P1 — SEOSONA Connector Status Layer

Nguồn học: external Flow automation reference Bridge.

Mục tiêu:

- Nếu SEOSONA có bridge/API/local helper riêng, UI phải cho người dùng biết trạng thái ngay.
- Tránh workflow fail âm thầm.

Status:

- Ready.
- Missing permission.
- Bridge not installed.
- Token missing.
- Token expired.
- Provider tab closed.
- Queue busy.
- Provider degraded.

UX:

- Status dot.
- Tooltip.
- Click-to-fix.
- Open settings/provider tab.

### 9.6. P1 — Provider/API Adapter Queue

Nguồn học: external Flow automation reference.

Mục tiêu:

- Tách workflow executor khỏi từng provider cụ thể.
- Hỗ trợ web automation, API mode, bridge mode và fallback.

Interface đề xuất:

- `submitJob`
- `pollJob`
- `cancelJob`
- `uploadReference`
- `downloadAsset`
- `resolveTier`
- `getCapabilities`
- `getHealth`

### 9.7. P1 — Notification & Run Event Center

Nguồn học: external Flow automation reference.

Mục tiêu:

- Người dùng biết workflow nào xong, lỗi, cần login, cần download.

Event:

- run started;
- run completed;
- run failed;
- asset downloaded;
- provider auth required;
- template updated;
- connector disconnected;
- storage cleanup needed.

### 9.8. P2 — Settings Repair/Migration Layer

Nguồn học: Grabbit.

Mục tiêu:

- Template/workflow/prompt/schema thay đổi nhưng dữ liệu cũ không bị hỏng.
- Có repair pass rõ ràng.

Áp dụng:

- Workflow schema migration.
- Template tag/category migration.
- Prompt gallery migration.
- User settings defaults repair.
- Old imported external Flow automation reference/external bridge reference references cleanup.

## 10. Những thứ không nên copy

### 10.1. Không copy identity/coupling của external Flow automation reference

Tuyệt đối không đưa vào SEOSONA Flow:

- `external reference domain`
- external Flow automation reference naming.
- external bridge reference extension ID.
- Toby-specific OAuth bridge.
- Toby-specific ref bridge.
- Hardcoded external product identity.

Nếu cần bridge, phải là SEOSONA-owned protocol.

### 10.2. Không mở quyền quá rộng theo mặc định

Tránh:

- Required `<all_urls>` nếu chỉ cần optional/on-demand.
- Content script default trên mọi page.
- `clipboardRead` nếu không thật sự cần.
- `cookies` permission nếu không có use case rõ và consent rõ.
- `web_accessible_resources` bundle lớn cho `<all_urls>`.

### 10.3. Không tạo background fetch proxy mở

Nếu có fetch proxy:

- Chỉ allowlist domain.
- Không cho arbitrary URL.
- Không forward cookie/token tự động.
- Validate MIME/size.
- Timeout.
- Redact logs.
- Rate limit.

### 10.4. Không dùng token relay từ webpage kiểu thô

OAuth/token flow cần:

- Strict origin allowlist.
- State/nonce.
- One-time exchange.
- Token never exposed in URL nếu có thể.
- Clear URL after success.
- No token logs.
- Short-lived session.

## 11. Backlog nâng cấp đề xuất

### Phase A — Capture foundation

Deliverables:

- `SourceCaptureService`
- `ImportStagingStore`
- Context menu import actions.
- Import preview modal.
- Basic workflow node binding.

Acceptance:

- Right-click image → dùng trực tiếp làm reference image trong template.
- Large image không làm tràn storage string.
- TTL cleanup chạy được.
- MIME validation reject non-image.

### Phase B — Picker and extraction nodes

Deliverables:

- Visual picker overlay.
- Selector tester.
- Extract Text/Image/Link/List nodes.
- Click/Scroll/Wait nodes.

Acceptance:

- Người dùng chọn element bằng chuột.
- UI báo selector match 0/1/nhiều.
- Preview được data trước khi lưu node.

### Phase C — Results table

Deliverables:

- Run dataset storage.
- Table viewer.
- Export CSV/JSON/XLSX.
- Send selected rows to workflow.

Acceptance:

- Một workflow run tạo được table output.
- Có filter/search/sort.
- Có preview image/video.

### Phase D — Batch collector

Deliverables:

- Drag-select overlay.
- Link/image/card collector.
- Smart repeated card detection.
- Batch import into workflow input table.

Acceptance:

- Kéo chọn nhiều card trên page.
- Dedupe đúng.
- Preview trước khi import.

### Phase E — Connector/adapter/event center

Deliverables:

- SEOSONA connector status dot.
- Provider adapter interface.
- Queue and fallback logic.
- Notification/event center.

Acceptance:

- UI báo trạng thái connector/provider rõ.
- Workflow không fail âm thầm.
- Có fallback web automation nếu API/bridge unavailable.

### Phase F — Permission hardening

Deliverables:

- Permission inventory.
- Optional host permission gating.
- On-demand script injection where possible.
- Fetch proxy allowlist.
- Token/log redaction.

Acceptance:

- Không tăng quyền mặc định nếu chưa cần.
- Người dùng hiểu vì sao extension cần quyền.
- Security scan không phát hiện external Flow automation reference/external bridge reference coupling.

## 12. Bảng quyết định áp dụng

| Ý tưởng | Nguồn học | Áp dụng vào SEOSONA Flow | Ưu tiên |
|---|---|---:|---:|
| Right-click image to workflow/template | aPix | Có | P0 |
| IndexedDB staging + TTL | aPix | Có | P0 |
| MIME/magic-byte validation | aPix | Có | P0 |
| Visual element picker | Ultimate Web Scraper | Có | P0 |
| CSS/XPath tester | Ultimate Web Scraper | Có | P0 |
| Results table/export | Ultimate Web Scraper | Có | P0 |
| Drag-select batch collector | Grabbit | Có | P1 |
| Smart repeated card selection | Grabbit | Có | P1 |
| Settings/action repair migration | Grabbit | Có | P2 |
| Bridge status dot | external Flow automation reference | Có, viết lại SEOSONA-owned | P1 |
| API adapter queue | external Flow automation reference | Có, viết lại SEOSONA-owned | P1 |
| Notification bell/panel | external Flow automation reference | Có | P1 |
| external bridge reference ID/domain | external Flow automation reference | Không | Block |
| OAuth token relay from web page | external Flow automation reference | Không copy; cần redesign | Block |
| Cookies permission | Ultimate Web Scraper | Không mặc định | Avoid |
| ClipboardRead permission | Grabbit | Không mặc định | Avoid |
| Required `<all_urls>` | Nhiều extension | Giảm tối đa | Avoid |

## 13. Kiến trúc đề xuất cho SEOSONA Flow

### 13.1. Capture/input layer

```text
Web page
  -> Context menu / drag select / visual picker
  -> SourceCaptureService
  -> ImportStagingStore
  -> PendingImportController
  -> Workflow input resolver
  -> Template/workflow node
```

### 13.2. Workflow execution layer

```text
WorkflowExecutor
  -> ProviderAdapter
      -> WebAutomationProvider
      -> ApiProvider
      -> BridgeProvider
      -> LocalMockProvider
  -> Queue/Retry/Cancel
  -> EventBus
  -> ResultsTable
```

### 13.3. Review/output layer

```text
Run history
  -> Dataset
  -> Table rows
  -> Assets
  -> Export
  -> Reuse selected rows in next workflow
```

## 14. Security/privacy guardrails

SEOSONA Flow nên coi 4 extension này là nguồn học UX/product, nhưng security baseline phải cao hơn:

- Default-deny host access.
- Optional host permissions by feature.
- ActiveTab/on-demand injection where possible.
- No arbitrary background fetch.
- No raw token in URL/log/storage.
- IndexedDB payload TTL and quota cleanup.
- Explicit user consent for scraping/extraction.
- Clear indicator when page content is being read.
- Per-provider capability boundary.
- No external Flow automation reference/external bridge reference identifiers.

## 15. Đề xuất thứ tự triển khai

Nếu chỉ chọn 3 việc trước:

1. Source Capture & Staging Layer.
2. Visual Element Picker + Extract/Click Nodes.
3. Workflow Results Table.

Lý do:

- Ba phần này mở khóa nhiều workflow mới nhất.
- Tăng khả năng “đưa dữ liệu web vào SEOSONA Flow” thay vì chỉ chạy prompt.
- Tạo nền cho batch video/image automation, web research, ecommerce review, content audit và lead extraction.

Sau đó mới làm:

4. Drag-select Batch Collector.
5. Connector/API Adapter.
6. Notification Center.
7. Permission Hardening sweep toàn extension.

## 16. Verdict cuối

### Grabbit

Học UX drag-select và smart-select. Không học permission model rộng.

### aPix Builder

Học mạnh nhất về image import/staging. Đây là mảnh ghép nên đưa vào SEOSONA Flow sớm.

### Ultimate Web Scraper

Học mạnh nhất về visual picker, extraction node và results table. Đây là hướng mở rộng SEOSONA Flow từ “AI workflow” thành “AI workflow + data capture/review”.

### external Flow automation reference

Học bridge/status/API adapter/notification pattern, nhưng phải viết lại hoàn toàn theo SEOSONA-owned identity. Không được còn bất kỳ liên kết external Flow automation reference/external bridge reference nào.

## 17. Next action đề xuất

Tạo implementation plan riêng cho Phase A + Phase B:

- Phase A: Source Capture & Staging Layer.
- Phase B: Visual Element Picker & Node Builder.

Hai phase này nên đi trước vì tác động trực tiếp tới trải nghiệm template/workflow hiện tại và ít phụ thuộc vào bridge/API architecture hơn.
