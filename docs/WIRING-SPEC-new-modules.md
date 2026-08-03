# WIRING SPEC — cắm 4 module core mới vào sản phẩm (apply khi file nóng sạch)

> Áp dụng KHI `WorkflowExecutor.js` (+ sidebar.html/editor) đã sạch (tiến trình song song commit xong).
> 4 module (untracked, đã test) cần wire: `TextOverlay.js`, `TextIntegrity.js`, `MemoryStore.js`, `MotionRecipes.js`.
> Nguyên tắc: chèn tối thiểu, mirror pattern có sẵn (merge node), verify sau mỗi bước.

---

## BƯỚC 1 — Load 4 script vào sidebar.html (an toàn, thêm dòng)
`pages/sidebar.html` ~ dòng 1697 (ngay SAU `<script src="../src/core/WatermarkRemover.js"></script>`) thêm:
```html
<script src="../src/core/TextOverlay.js"></script>
<script src="../src/core/TextIntegrity.js"></script>
<script src="../src/core/MemoryStore.js"></script>
<script src="../src/core/MotionRecipes.js"></script>
```
Cũng thêm vào `config/page-scripts.json` (nếu check:html enforce) + workflow-editor.html nếu node executor chạy trong editor context.

## BƯỚC 2 — Node `text_overlay` trong NodeTemplates.js
(a) Icon (~dòng 44, cạnh `text_template`):
```js
text_overlay: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h6M7 11h10"/></svg>`,
```
(b) Config (~dòng 233, sau `text_template` config). Node nhận 1 ẢNH + 1 TEXT upstream, xuất ẢNH:
```js
text_overlay: {
  name: t('node.textOverlayName', 'Text Overlay'),
  description: t('node.textOverlayDesc', 'Overlay chữ VECTOR thật lên ảnh (chống rớt-chữ/sai-dấu) — chọn vùng, font, canh lề'),
  icon: 'text_overlay', color: 'text', inputs: 2, outputs: 1, portType: 'any',
  ports: {
    in: [
      { name: 'image', type: 'image', required: true, multiple: false, label: t('node.portImageIn', 'Ảnh nền') },
      { name: 'text', type: 'text', required: false, multiple: false, label: t('node.portTextIn', 'Chữ overlay') },
    ],
    out: [{ name: 'image', type: 'image', label: t('node.portImageOut', 'Ảnh + chữ') }],
  },
  // fields config (editor settings panel): text, zone{x,y,w,h} hoặc preset position, font, size, color, align, mode(body/heading), maxCharsPerLine, pairs
},
```
+ i18n keys mới (vi/en parity): node.textOverlayName/Desc, node.portImageIn/TextIn/ImageOut.

## BƯỚC 3 — Handler executor (WorkflowExecutor.js) — mirror `_executeMergeNode`
(a) Dispatch (~dòng 4225, cạnh case `merge`):
```js
if (node.node_type === 'text_overlay') { return this._executeTextOverlayNode(node, workflow, nodeLog); }
```
(b) Method (cạnh `_executeMergeNode`):
```js
async _executeTextOverlayNode(node, workflow, emitLog) {
  const log = (m, t='info') => emitLog(m, t);
  // 1) ảnh upstream: lấy result_file_ids/thumbnail của node ảnh nối vào (port 'image')
  const baseImg = this._resolveUpstreamImage(node, workflow); // dataURL/URL/tileId→thumbnail
  // 2) text: node.text || _combineUpstreamTexts (port 'text')
  let text = node.text || '';
  if (!text) { try { const c = this._combineUpstreamTexts(node, workflow); text = (c&&c.text)||''; } catch(_){} }
  if (!baseImg) { log('Text Overlay: thiếu ảnh nền upstream', 'warn'); throw new Error('TEXT_OVERLAY_NO_IMAGE'); }
  // 3) render bằng TextOverlay (canvas) → dataURL
  const items = [{ text, zone: node.zone || null, font: node.font, size: node.size, color: node.color,
                   align: node.align||'center', mode: node.text_mode||'body', maxCharsPerLine: node.max_chars, pairs: node.pairs }];
  const dataUrl = await self.TextOverlay.render(baseImg, items, {});
  // 4) đăng ký ảnh KẾT QUẢ (⚠️ OPEN — xem dưới) + result_thumbnails
  const fid = await this._registerLocalImage(dataUrl, node); // TODO: hàm này CẦN LÀM/verify
  node.result_file_ids = fid; node.result_thumbnails = { [fid]: { url: dataUrl, type:'image' } };
  node.result_source = 'text_overlay';
  log(`Text Overlay: overlay "${(text||'').slice(0,20)}" → 1 ảnh.`, 'info');
  return { success: true };
}
```

### ⚠️ CÂU HỎI MỞ (verify trước khi apply bước 3): ảnh cục bộ → result
Node `generate` xuất **tile-id** (ảnh từ web-UI). `text_overlay` tạo ảnh CỤC BỘ (canvas dataURL), KHÔNG phải tile. Cần:
- `_resolveUpstreamImage(node, workflow)`: đọc `result_file_ids`/`result_thumbnails`/`result_provider_urls` của node ảnh upstream → dataURL nạp được vào canvas (CORS: dùng thumbnail dataURL nếu có; URL ngoài có thể vướng CORS khi drawImage → cần proxy/fetch-blob).
- `_registerLocalImage(dataUrl, node)`: **CHƯA CÓ** — cần cơ chế lưu ảnh cục bộ thành 1 "file id" mà node **download** tiêu thụ được. Kiểm: download node xử lý `result_thumbnails[fid].url` (dataURL) trực tiếp không? Nếu có → chỉ cần set thumbnails như trên + 1 synthetic fid (`'local_'+ts`). Nếu không → cần mở rộng download node đọc dataURL. **VERIFY: đọc `_executeDownloadNode` / cách download tiêu thụ result_file_ids trước khi làm.**

## BƯỚC 4 — text_qa node (tuỳ chọn, dùng TextIntegrity)
Node `text_qa`: nhận ảnh + expected text → gọi vision/OCR (qua MessageBridge tới ChatGPT/Gemini, prompt `img_text_qa`) → parse ocr_text → `self.TextIntegrity.compare(expected, ocr, {expectNoDiacritics})` → verdict. Fail → gắn cờ để loop regenerate/overlay. (Cần MessageBridge OCR call — làm sau text_overlay.)

## BƯỚC 5 — MemoryStore → WorkflowAgent + MCP
- `WorkflowAgent.js`: TRƯỚC khi build workflow từ mô tả → `const mem = await self.MemoryStore.search(userGoal, {limit:5});` chèn vào context prompt ("Ngữ cảnh đã biết: ..."). SAU khi tạo xong → `self.MemoryStore.remember('Tạo workflow: '+name, ['workflow', ...tags])`.
- `local-mcp-bridge.js` (hoặc McpExecutor): expose tool `memory_search`/`memory_add` gọi MemoryStore → agent runtime dùng được. (VERIFY: bridge register-tool pattern.)
- Seed profile 1 lần: brand=#3d6ff5, provider mặc định, phong cách — `MemoryStore.setProfile('brand_color','#3d6ff5',['brand'])`.

## BƯỚC 6 — MotionRecipes → UI (thấp)
- Prompt-assist/editor: nút "Chèn motion" → `MotionRecipes.find(intent, {context})` → chèn `MotionRecipes.css(id)` vào output HTML/landing node. Hoặc expose trong node landing-page. (Không gấp — recipe đã sẵn sàng, chỉ thiếu điểm gọi UI.)

---

## THỨ TỰ APPLY (khi file nóng sạch)
1. Bước 1 (script load) — an toàn, verify check:static.
2. VERIFY câu hỏi mở bước 3 (đọc download node) → chốt `_registerLocalImage`.
3. Bước 2+3 (node + handler) → test 1 workflow: generate(reserve zone) → text_overlay → download. Verify ảnh có chữ đúng.
4. Bước 5 (memory→agent) — độc lập, làm song song được.
5. Bước 4 (text_qa) + Bước 6 (motion UI) — sau.

**Verify mỗi bước:** node --check + check:static + test:unit + (bước 3) thử workflow thật trong extension.
