/**
 * WorkflowEditorNodeForm — tách từ WorkflowEditor.js (file 22k dòng, 320 method).
 *
 * Gom 3 method LỚN NHẤT cùng một nhiệm vụ "form cấu hình node": render → bind → apply.
 * Augment prototype nên hành vi KHÔNG đổi (class không có private field #, `this` giữ nguyên).
 * PHẢI nạp SAU WorkflowEditor.js.
 */
(function (root) {
  'use strict';
  var WE = root.WorkflowEditor;
  if (!WE || !WE.prototype) {
    console.error('[WorkflowEditorNodeForm] WorkflowEditor chưa nạp — phải đặt script này SAU WorkflowEditor.js');
    return;
  }
  Object.assign(WE.prototype, {
  _renderNodeFormByType(nodeType, data, nodeId) {
    // Phase 1 — Node Reference System: Slug field for mentionable nodes (inline edit design)
    const slugValue = data.slug || '';
    const slugPlaceholder = this._normalizeToSlug(data.node_name || nodeType);
    const slugIsAuto = data.slug_auto !== false;
    const slugDisplayValue = slugValue || slugPlaceholder;
    const slugStateClass = slugIsAuto ? 'slug-auto' : 'slug-manual';
    const _nameIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
    const _nameLabel = window.I18n?.t('workflow.nodeName') || 'Tên';
    const _nameInput = `
        <div class="node-nameslug-pane active" data-nspane="name">
          <div class="input-group">
            <input type="text" id="nodeName" value="${this.escapeAttr(data.node_name || nodeType)}" />
          </div>
        </div>`;
    // 2026-06-25 UI: gộp Tên + Slug thành 2 sub-tab (gọn sidebar). Node KHÔNG mentionable → chỉ Tên.
    const nameField = this._isMentionableNodeType(nodeType) ? `
      <div class="form-group node-nameslug-group">
        <div class="node-form-tabs node-nameslug-tabs" id="nodeNameSlugTabs">
          <button type="button" class="node-form-tab active" data-nstab="name">${_nameIcon}${_nameLabel}</button>
          <button type="button" class="node-form-tab" data-nstab="slug">@${window.I18n?.t('workflow.nodeSlug') || 'Slug'}</button>
        </div>
        ${_nameInput}
        <div class="node-nameslug-pane" data-nspane="slug">
          <div class="slug-inline-wrapper">
            <div class="slug-inline-display ${slugStateClass}" id="slugInlineDisplay" title="${window.I18n?.t('workflow.clickToEditSlug') || 'Click to edit'}">
              <span class="slug-at">@</span><span class="slug-value">${this.escapeHtml(slugDisplayValue)}</span>
              <svg class="slug-edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </div>
            <div class="slug-inline-edit hidden" id="slugInlineEdit">
              <span class="slug-input-prefix">@</span>
              <input type="text" id="nodeSlug" value="${this.escapeAttr(slugValue)}" placeholder="${this.escapeAttr(slugPlaceholder)}" maxlength="${WorkflowEditor.SLUG_MAX_LENGTH}" pattern="[a-z][a-z0-9_]*" />
              <button type="button" class="slug-confirm-btn" id="slugConfirmBtn" title="${window.I18n?.t('common.confirm') || 'Confirm'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
            <input type="hidden" id="nodeSlugAuto" value="${slugIsAuto ? 'true' : 'false'}" />
          </div>
          <p class="form-error hidden" id="slugError"></p>
        </div>
      </div>` : `
      <div class="form-group node-nameslug-group">
        <label for="nodeName">${_nameIcon}${window.I18n?.t('workflow.nodeName') || 'Tên Node'}</label>
        ${_nameInput}
      </div>`;
    // Slug đã gộp vào nameField (2-tab) → slugField rỗng (giữ biến cho mọi call site cũ).
    const slugField = '';
    // Phase: enabled toggle moved to node-form-header (icon button) — keep hidden input
    // để save logic + sync trạng thái khi save/load form data.
    const enabledField = `
      <input type="checkbox" id="nodeEnabled" ${data.enabled !== false ? 'checked' : ''} style="display:none;" />`;

    if (nodeType === 'style_anchor') {
      const _p = data.anchor_position || 'prepend';
      const o = (v, cur, lbl) => `<option value="${v}"${v === cur ? ' selected' : ''}>${lbl}</option>`;
      return `${nameField}${enabledField}
        <div class="form-group"><label for="nodeAnchorBlock">Khối phong cách (áp cho MỌI prompt đi qua)</label>
          <textarea id="nodeAnchorBlock" style="height:96px;" placeholder="VD:&#10;ảnh thật 35mm, hạt phim nhẹ&#10;bảng màu đất: nâu, cam cháy, kem&#10;ánh sáng cửa sổ mềm, bóng đổ dài">${this.escapeHtml(data.anchor_block || '')}</textarea>
          <small style="color:var(--muted-foreground,#9a9aa2)">Mỗi dòng 1 đặc điểm. Dùng danh từ/chất liệu/ống kính cụ thể — tránh "đẹp/8k/cinematic".</small></div>
        <div class="form-group"><label for="nodeAnchorLabel">Nhãn khối</label>
          <input type="text" id="nodeAnchorLabel" value="${this.escapeHtml(data.anchor_label || 'STYLE')}" placeholder="STYLE"></div>
        <div class="form-group"><label for="nodeAnchorPos">Vị trí chèn</label>
          <select id="nodeAnchorPos">${o('prepend', _p, 'Đầu prompt (khuyên dùng)')}${o('append', _p, 'Cuối prompt')}</select></div>`;
    }

    if (nodeType === 'entity_ref') {
      // Nhập dạng "Tên | loại | mô tả" mỗi dòng — EntitySheet.parse nhận cả JSON lẫn dạng này.
      // Không bắt người dùng viết JSON cho một việc thường xuyên như khai dàn nhân vật.
      const ph = 'Pippip | character | mèo vàng, tạp dề xanh, mắt to&#10;Chợ Cá | location | bến cảng lúc sớm, sương mờ&#10;Giỏ mây | prop | giỏ tre cũ, quai da';
      return `${nameField}${enabledField}
        <div class="form-group"><label for="nodeEntities">Dàn thực thể (mỗi dòng một)</label>
          <textarea id="nodeEntities" style="height:120px;font-family:ui-monospace,monospace;font-size:12px;" placeholder="${ph}">${this.escapeHtml(data.entities || '')}</textarea>
          <small style="color:var(--muted-foreground,#9a9aa2)">Cú pháp: <b>Tên | loại | mô tả</b>. Loại: character · creature · location · prop.<br>
          Mỗi thực thể cần <b>1 ảnh gốc</b> nối vào cổng vào, <b>đúng thứ tự</b> các dòng trên.</small></div>
        <div class="form-group"><label for="nodeEntityLabel">Nhãn khối CAST</label>
          <input type="text" id="nodeEntityLabel" value="${this.escapeHtml(data.entity_label || 'CAST')}" placeholder="CAST">
          <small style="color:var(--muted-foreground,#9a9aa2)">Khối này đi ra cổng text, nối vào node prompt. Nó chỉ liệt kê <b>tên</b> — cố tình không kèm ngoại hình, vì ảnh gốc đã quy định phần đó; tả lại bằng chữ là đá nhau và làm nhân vật trôi.</small></div>`;
    }

    if (nodeType === 'image_composite') {
      const _m = data.composite_mode || 'center';
      const o = (v, cur, lbl) => `<option value="${v}"${v === cur ? ' selected' : ''}>${lbl}</option>`;
      return `${nameField}${enabledField}
        <div class="form-group"><label for="nodeCompMode">Cách đặt ảnh gốc</label>
          <select id="nodeCompMode">${o('center', _m, 'Giữa khung, GIỮ NGUYÊN kích thước (khuyên dùng)')}${o('center-scale', _m, 'Giữa khung, thu nhỏ cho vừa')}</select>
          <small style="color:var(--muted-foreground,#9a9aa2)">Chọn "thu nhỏ" là ảnh gốc bị nội suy — <b>mất</b> đúng cái pixel mà bước này sinh ra để giữ.</small></div>
        <div class="form-group"><label for="nodeCompFeather">Làm mềm mép dán (px)</label>
          <input type="number" id="nodeCompFeather" min="0" max="64" step="1" value="${data.composite_feather != null ? data.composite_feather : 0}">
          <small style="color:var(--muted-foreground,#9a9aa2)">Mặc định 0. Chỉ tăng khi thấy đường chỉ ở mép — mỗi px làm mềm là một px không còn nguyên bản.</small></div>
        <div class="form-group">
          <small style="color:var(--muted-foreground,#9a9aa2)">Nối <b>ảnh đã outpaint</b> vào cổng "Ảnh nền" và <b>ảnh gốc</b> vào cổng "Ảnh gốc". Nối ngược là dán ngược.</small></div>`;
    }

    if (nodeType === 'quality_gate') {
      const _th = data.qa_threshold != null ? data.qa_threshold : 7.5;
      const _mode = data.qa_sampling || 'light';
      const o = (v, cur, lbl) => `<option value="${v}"${v === cur ? ' selected' : ''}>${lbl}</option>`;
      return `${nameField}${enabledField}
        <div class="form-group"><label for="nodeQaThreshold">Điểm tối thiểu để ĐẠT</label>
          <input type="number" id="nodeQaThreshold" min="0" max="10" step="0.1" value="${_th}">
          <small style="color:var(--muted-foreground,#9a9aa2)">Thang 0–10. 7,5 = "tốt, dùng được". Dưới 6,0 nên gen lại <b>ảnh</b> chứ không phải gen lại video.</small></div>
        <div class="form-group"><label for="nodeQaSampling">Độ kỹ khi chấm video</label>
          <select id="nodeQaSampling">${o('light', _mode, 'Nhanh — 4 khung/giây')}${o('deep', _mode, 'Kỹ — 8 khung/giây (bắt lỗi tinh)')}</select></div>
        <div class="form-group"><label for="nodeQaFocus">Lưu ý riêng khi chấm (tuỳ chọn)</label>
          <textarea id="nodeQaFocus" style="height:60px;" placeholder="VD: soi kỹ bàn tay và chữ trên biển hiệu">${this.escapeHtml(data.qa_focus || '')}</textarea>
          <small style="color:var(--muted-foreground,#9a9aa2)">Lỗi mức <b>nghiêm trọng</b> luôn là trượt, bất kể điểm — điểm trung bình che mất lỗi chí mạng.</small></div>`;
    }

    if (nodeType === 'text_overlay') {
      const _pos = data.overlay_pos || 'center', _mode = data.overlay_mode || 'heading', _align = data.overlay_align || 'center';
      const opt = (v, cur, lbl) => `<option value="${v}"${v === cur ? ' selected' : ''}>${lbl}</option>`;
      return `${nameField}${enabledField}
        <div class="form-group"><label for="nodeOverlayText">Chữ overlay (bỏ trống = lấy từ node Text nối vào)</label>
          <textarea id="nodeOverlayText" style="height:60px;" placeholder="VD: GIẢM GIÁ 50%">${this.escapeHtml(data.overlay_text || '')}</textarea></div>
        <div class="form-group"><label for="nodeOverlayPos">Vị trí</label>
          <select id="nodeOverlayPos">${opt('center', _pos, 'Giữa')}${opt('top', _pos, 'Trên')}${opt('bottom', _pos, 'Dưới')}</select></div>
        <div class="form-group"><label for="nodeOverlayMode">Kiểu</label>
          <select id="nodeOverlayMode">${opt('heading', _mode, 'Heading (cân dòng)')}${opt('body', _mode, 'Body (chống runt)')}</select></div>
        <div class="form-group"><label for="nodeOverlayAlign">Canh</label>
          <select id="nodeOverlayAlign">${opt('center', _align, 'Giữa')}${opt('left', _align, 'Trái')}${opt('right', _align, 'Phải')}</select></div>
        <div class="form-group"><label for="nodeOverlayColor">Màu chữ</label>
          <input type="color" id="nodeOverlayColor" value="${this.escapeAttr(data.overlay_color || '#ffffff')}" /></div>
        <div class="form-group"><label for="nodeOverlaySize">Cỡ chữ (px, bỏ trống = tự tính)</label>
          <input type="number" id="nodeOverlaySize" value="${this.escapeAttr(data.overlay_size || '')}" placeholder="auto" min="8" max="400" /></div>
        <div class="form-group"><label><input type="checkbox" id="nodeOverlayDownload" ${data.overlay_download !== false ? 'checked' : ''} /> Tự lưu file kết quả</label></div>`;
    }
    if (nodeType === 'text_qa') {
      const _prov = data.qa_provider || 'chatgpt';
      const opt = (v, cur, lbl) => `<option value="${v}"${v === cur ? ' selected' : ''}>${lbl}</option>`;
      return `${nameField}${enabledField}
        <div class="form-group"><label for="nodeQaExpected">Chuỗi mong đợi (để đối chiếu OCR)</label>
          <input type="text" id="nodeQaExpected" value="${this.escapeAttr(data.expected_text || '')}" placeholder="VD: SALE" /></div>
        <div class="form-group"><label for="nodeQaProvider">Provider OCR</label>
          <select id="nodeQaProvider">${opt('chatgpt', _prov, 'ChatGPT')}${opt('gemini', _prov, 'Gemini')}${opt('grok', _prov, 'Grok')}</select></div>
        <div class="form-group"><label><input type="checkbox" id="nodeQaNoDiacritics" ${data.qa_no_diacritics === true ? 'checked' : ''} /> Cảnh báo nếu ảnh có dấu (expected không dấu)</label></div>`;
    }
    if (nodeType === 'note') {
      return `${nameField}
        <div class="form-group">
          <label for="nodeNoteText">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
            ${window.I18n?.t('workflow.noteNodeLabel') || 'Ghi chú'}
          </label>
          <textarea id="nodeNoteText" style="height: 120px;" placeholder="${window.I18n?.t('workflow.notePlaceholder') || 'Nhập ghi chú...'}">${this.escapeHtml(data.note_text || '')}</textarea>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.noteColor') || 'Màu khung'}</label>
          <div class="wf-note-swatches" id="nodeNoteSwatches">
            ${(() => {
              const NOTE_COLORS = ['#ef4444', '#f97316', '#eab308', '#19d07b', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
              const cur = /^#[0-9a-fA-F]{3,8}$/.test(String(data.note_color || '')) ? data.note_color : '#3b82f6';
              return NOTE_COLORS.map(c => `<button type="button" class="wf-note-swatch${cur.toLowerCase() === c ? ' active' : ''}" data-color="${c}" title="${c}" style="background:${c};"></button>`).join('');
            })()}
          </div>
          <input type="hidden" id="nodeNoteColor" value="${/^#[0-9a-fA-F]{3,8}$/.test(String(data.note_color || '')) ? data.note_color : '#3b82f6'}" />
        </div>
        <div class="form-group">
          <label for="nodeNoteFontSize">${window.I18n?.t('workflow.noteFontSize') || 'Cỡ chữ'}</label>
          <select id="nodeNoteFontSize">
            ${[12,14,16,20,24,32,40,48,64,80,96,120].map(sz => `<option value="${sz}"${Number(data.note_font_size || 14) === sz ? ' selected' : ''}>${sz}px</option>`).join('')}
          </select>
        </div>`;
    }
    if (nodeType === 'delay') {
      return `${nameField}
        <div class="form-group">
          <label for="nodeDelaySeconds">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ${window.I18n?.t('workflow.delaySeconds') || 'Thời gian chờ (giây)'}
          </label>
          <div class="input-group">
            <input type="number" id="nodeDelaySeconds" min="1" max="300" value="${data.delay_seconds || 3}" />
          </div>
        </div>
        ${enabledField}`;
    }
    if (nodeType === 'image') {
      // EWT-9.1: Kiểm tra template mode hoặc template preview để render UI phù hợp
      const isTemplateCtx = this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview;
      if (isTemplateCtx) {
        // Template mode/preview: hiển thị ref images từ URLs
        const refField = this._renderRefImagesFieldForTemplate(data, 'imageNodeRefPreview', 'imageNodeRefImgUrls', 'imageNodePickBtn', 10);
        return `${nameField}${slugField}${refField}${enabledField}`;
      }
      // Normal mode: chọn ảnh từ Flow
      return `${nameField}${slugField}
        <div class="form-group" id="nodeRefImagesGroup">
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            ${window.I18n?.t('workflow.refImages') || 'Reference images'}
          </label>
          <button class="node-ref-btn" id="imageNodePickBtn">
            <svg class="node-ref-btn__icon ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"></path><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path><path d="M19 22v-6"></path><path d="M22 19l-3 -3l-3 3"></path></svg>
            <span class="node-ref-btn__text">${window.I18n?.t('workflow.selectRefImages') || 'Select / Upload image'}</span>
          </button>
          <div class="ref-images-preview" id="imageNodeRefPreview"></div>
          <input type="hidden" id="nodeRefFileIds" value="${this.escapeAttr(data.ref_file_ids || '')}" />
        </div>
        ${enabledField}`;
    }
    // Phase 1 — Node Reference System: Text node form
    // Text Export — ghi text upstream ra file (manifest/kịch bản/danh sách prompt).
    if (nodeType === 'text_export') {
      const fname = data.export_file_name || '';
      const fmt = (data.export_format || 'json').toLowerCase();
      const opt = (v, label) => `<option value="${v}"${fmt === v ? ' selected' : ''}>${label}</option>`;
      return `${nameField}
        <div class="form-group">
          <label for="exportFileName">${window.I18n?.t('workflow.exportFileName') || 'Tên file'}</label>
          <input type="text" id="exportFileName" value="${this.escapeHtml(fname)}" placeholder="script_manifest" />
          <p style="font-size:11px;color:var(--muted-foreground);margin-top:4px;">
            ${window.I18n?.t('workflow.exportFileHint') || 'Bỏ trống → lấy tên node. File lưu vào thư mục "SEOSONA Flow".'}
          </p>
        </div>
        <div class="form-group">
          <label for="exportFormat">${window.I18n?.t('workflow.exportFormat') || 'Định dạng'}</label>
          <div class="input-group select-group compact-select">
            <select id="exportFormat">
              ${opt('json', 'JSON (.json) — tự format nếu hợp lệ')}
              ${opt('txt', 'Text (.txt)')}
              ${opt('md', 'Markdown (.md)')}
              ${opt('csv', 'CSV (.csv)')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        ${enabledField}`;
    }

    if (nodeType === 'text') {
      const textContent = data.prompt || data.note_text || '';
      return `${nameField}${slugField}
        <div class="form-group">
          <label for="textNodeContent">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            ${window.I18n?.t('workflow.textContent') || 'Nội dung Text'}
          </label>
          <textarea id="textNodeContent" style="height: 150px;" placeholder="${window.I18n?.t('workflow.textNodePlaceholder') || 'VD: cinematic lighting, 8k UHD, professional photography'}">${this.escapeHtml(textContent)}</textarea>${this._promptCharCountHtml(textContent)}
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.textNodeHint') || 'Dùng @slug trong prompt của node khác để chèn nội dung này.'}</p>
        </div>
        ${enabledField}`;
    }

    // Text Template Node — mẫu ghép text upstream. Dùng chung field #textNodeContent (lưu data.prompt).
    if (nodeType === 'text_template') {
      const templateContent = data.prompt || '';
      return `${nameField}${slugField}
        <div class="form-group">
          <label for="textNodeContent">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M7 4H6a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1"/><path d="M17 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1"/></svg>
            ${window.I18n?.t('workflow.textTemplateContent') || 'Mẫu (Template)'}
          </label>
          <textarea id="textNodeContent" style="height: 150px;" placeholder="${window.I18n?.t('workflow.textTemplatePlaceholder') || 'VD: Ảnh chân dung {{input}}, ánh sáng điện ảnh, 8k'}">${this.escapeHtml(templateContent)}</textarea>${this._promptCharCountHtml(templateContent)}
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.textTemplateHint') || 'Placeholder: {{input}} = gộp toàn bộ text upstream; {{input1}}, {{input2}}… = từng node upstream theo thứ tự. Không có placeholder → nối toàn bộ upstream.'}</p>
        </div>
        ${enabledField}`;
    }

    // Phase 3: Prompt Sequence / Scene Splitter — tách blob nhiều scene → danh sách prompt.
    // Loop / Batch — form tối thiểu (giới hạn item).
    if (nodeType === 'loop') {
      const maxItems = data.max_items || 0;
      const lpCount = Array.isArray(data.result_items) ? data.result_items.length : 0;
      return `${nameField}
        <div class="form-group">
          <label for="nodeLoopMax">${window.I18n?.t('workflow.loopMax') || 'Giới hạn số item (0 = tất cả)'}</label>
          <input type="number" id="nodeLoopMax" min="0" max="200" value="${maxItems}">
        </div>
        ${lpCount ? `<p style="font-size:11px;color:var(--muted-foreground);margin-top:-6px;">Đang có ${lpCount} item.</p>` : ''}
        <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.loopHint') || 'Nối node Prompt Sequence (hoặc danh sách text) phía trước → Loop tách thành từng item để feed Generate tạo hàng loạt. (Việc chạy gen từng item kích hoạt khi gen hoạt động.)'}</p>
        ${enabledField}`;
    }

    if (nodeType === 'prompt_sequence') {
      const splitMode = data.split_mode || 'auto';
      const separator = data.split_separator || '---';
      const maxScenes = data.max_scenes || 0;
      const scenePrefix = data.scene_prefix || '';
      const sceneSuffix = data.scene_suffix || '';
      const optM = (v, label) => `<option value="${v}" ${splitMode === v ? 'selected' : ''}>${label}</option>`;
      return `${nameField}
        <div class="form-group">
          <label for="nodePsMode">${window.I18n?.t('workflow.psMode') || 'Cách tách scene'}</label>
          <div class="input-group select-group compact-select">
            <select id="nodePsMode">
              ${optM('auto', window.I18n?.t('workflow.psModeAuto') || 'Tự động (thông minh)')}
              ${optM('numbered', window.I18n?.t('workflow.psModeNumbered') || 'Theo đánh số (1. 2. / Scene 1)')}
              ${optM('separator', window.I18n?.t('workflow.psModeSeparator') || 'Theo dấu ngăn (---)')}
              ${optM('lines', window.I18n?.t('workflow.psModeLines') || 'Mỗi dòng 1 scene')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group" id="nodePsSeparatorGroup" style="${splitMode === 'separator' ? '' : 'display:none;'}">
          <label for="nodePsSeparator">${window.I18n?.t('workflow.psSeparator') || 'Dấu ngăn'}</label>
          <input type="text" id="nodePsSeparator" value="${this.escapeAttr(separator)}" placeholder="---">
        </div>
        <div class="form-group">
          <label for="nodePsMax">${window.I18n?.t('workflow.psMax') || 'Giới hạn số scene (0 = không giới hạn)'}</label>
          <input type="number" id="nodePsMax" min="0" max="100" value="${maxScenes}">
        </div>
        <div class="form-group">
          <label for="nodePsPrefix">${window.I18n?.t('workflow.psPrefix') || 'Prefix chèn TRƯỚC mỗi scene (tuỳ chọn)'}</label>
          <textarea id="nodePsPrefix" style="height: 48px;" placeholder="vd: cinematic, 8k, ">${this.escapeHtml(scenePrefix)}</textarea>
        </div>
        <div class="form-group">
          <label for="nodePsSuffix">${window.I18n?.t('workflow.psSuffix') || 'Suffix chèn SAU mỗi scene (tuỳ chọn)'}</label>
          <textarea id="nodePsSuffix" style="height: 48px;" placeholder="vd: , aspect ratio 9:16">${this.escapeHtml(sceneSuffix)}</textarea>
        </div>
        <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.psHint') || 'Nối 1 node AI Agent phía trước (sinh nhiều scene) hoặc paste khối text. Node tách thành danh sách prompt đánh số → feed node Generate/loop để tạo hàng loạt.'}</p>
        ${enabledField}`;
    }

    if (nodeType === 'variant_expand') {
      const vePreset = data.variant_preset || 'ratios';
      const veVariants = data.variants || '';
      const veMax = data.max_variants || 0;
      const veJoiner = typeof data.variant_joiner === 'string' ? data.variant_joiner : ', ';
      const optP = (v, label) => `<option value="${v}" ${vePreset === v ? 'selected' : ''}>${label}</option>`;
      return `${nameField}
        <div class="form-group">
          <label for="nodeVePreset">${window.I18n?.t('workflow.vePreset') || 'Bộ biến thể có sẵn'}</label>
          <div class="input-group select-group compact-select">
            <select id="nodeVePreset">
              ${optP('ratios', window.I18n?.t('workflow.vePresetRatios') || 'Tỉ lệ (1:1, 4:5, 9:16, 16:9)')}
              ${optP('styles', window.I18n?.t('workflow.vePresetStyles') || 'Phong cách (photo, cinematic, minimal, editorial)')}
              ${optP('angles', window.I18n?.t('workflow.vePresetAngles') || 'Góc máy (front, side, top-down, macro)')}
              ${optP('lighting', window.I18n?.t('workflow.vePresetLighting') || 'Ánh sáng (daylight, rim, golden, studio)')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label for="nodeVeVariants">${window.I18n?.t('workflow.veVariants') || 'HOẶC danh sách tự nhập (mỗi dòng 1 biến thể — ghi đè preset)'}</label>
          <textarea id="nodeVeVariants" style="height: 72px;" placeholder="aspect ratio 9:16&#10;aspect ratio 1:1&#10;cinematic film still">${this.escapeHtml(veVariants)}</textarea>
        </div>
        <div class="form-group">
          <label for="nodeVeJoiner">${window.I18n?.t('workflow.veJoiner') || 'Cách nối vào prompt gốc'}</label>
          <input type="text" id="nodeVeJoiner" value="${this.escapeAttr(veJoiner)}" placeholder=", ">
        </div>
        <div class="form-group">
          <label for="nodeVeMax">${window.I18n?.t('workflow.veMax') || 'Giới hạn số biến thể (0 = không giới hạn)'}</label>
          <input type="number" id="nodeVeMax" min="0" max="100" value="${veMax}">
        </div>
        <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.veHint') || 'Nối 1 node Prompt/Text (prompt gốc) phía trước. Node nhân prompt gốc × mỗi biến thể → danh sách prompt → feed node Generate/loop để tạo hàng loạt. VD: "1 concept → 4 tỉ lệ".'}</p>
        ${enabledField}`;
    }

    // Build: Condition/Switch — rẽ nhánh workflow theo điều kiện trên input.
    if (nodeType === 'condition') {
      const op = data.condition_op || 'has_text';
      const val = data.condition_value || '';
      const opt = (v, label) => `<option value="${v}" ${op === v ? 'selected' : ''}>${label}</option>`;
      return `${nameField}
        <div class="form-group">
          <label for="nodeConditionOp">${window.I18n?.t('workflow.conditionOp') || 'Điều kiện (nếu ĐÚNG → nhánh TRUE)'}</label>
          <div class="input-group select-group compact-select">
            <select id="nodeConditionOp">
              ${opt('has_text', 'Input CÓ text')}
              ${opt('no_text', 'Input RỖNG')}
              ${opt('contains', 'Text CHỨA...')}
              ${opt('regex', 'Text KHỚP regex...')}
              ${opt('has_result', 'Upstream CÓ kết quả (ảnh/file)')}
            </select>
          </div>
        </div>
        <div class="form-group" id="nodeConditionValueGroup" style="${(op === 'contains' || op === 'regex') ? '' : 'display:none;'}">
          <label for="nodeConditionValue">${window.I18n?.t('workflow.conditionValue') || 'Giá trị (chuỗi chứa / pattern regex)'}</label>
          <input type="text" id="nodeConditionValue" value="${this.escapeAttr(val)}" placeholder="vd: dog  hoặc  ^https?://">
        </div>
        <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.conditionHint') || 'Node phía sau port TRUE chỉ chạy khi điều kiện đúng; phía sau FALSE chỉ chạy khi sai. Nhánh không chọn bị bỏ qua.'}</p>
        ${enabledField}`;
    }

    // Build: Switch — rẽ NHIỀU nhánh theo giá trị khớp (case1/2/3 + mặc định).
    if (nodeType === 'switch') {
      const smode = data.switch_mode || 'contains';
      const sopt = (v, label) => `<option value="${v}" ${smode === v ? 'selected' : ''}>${label}</option>`;
      const c1 = data.switch_case1 || '', c2 = data.switch_case2 || '', c3 = data.switch_case3 || '';
      return `${nameField}
        <div class="form-group">
          <label for="nodeSwitchMode">${window.I18n?.t('workflow.switchMode') || 'Cách khớp giá trị input với các case'}</label>
          <div class="input-group select-group compact-select">
            <select id="nodeSwitchMode">
              ${sopt('contains', 'Input CHỨA giá trị case')}
              ${sopt('equals', 'Input BẰNG giá trị case')}
              ${sopt('regex', 'Input KHỚP regex case')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="nodeSwitchCase1">${window.I18n?.t('workflow.switchCase1') || 'Case 1 → port Case 1'}</label>
          <input type="text" id="nodeSwitchCase1" value="${this.escapeAttr(c1)}" placeholder="vd: dog">
        </div>
        <div class="form-group">
          <label for="nodeSwitchCase2">${window.I18n?.t('workflow.switchCase2') || 'Case 2 → port Case 2'}</label>
          <input type="text" id="nodeSwitchCase2" value="${this.escapeAttr(c2)}" placeholder="vd: cat">
        </div>
        <div class="form-group">
          <label for="nodeSwitchCase3">${window.I18n?.t('workflow.switchCase3') || 'Case 3 → port Case 3'}</label>
          <input type="text" id="nodeSwitchCase3" value="${this.escapeAttr(c3)}" placeholder="(tuỳ chọn)">
        </div>
        <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.switchHint') || 'Xét lần lượt Case 1→2→3; khớp cái nào thì đi port đó. Không khớp → port Mặc định. Chỉ nhánh khớp chạy, các nhánh khác bị bỏ qua.'}</p>
        ${enabledField}`;
    }

    // Text Extract Node (2026-05-29): form 6 fields cho regex/JSON parse config
    if (nodeType === 'text_extract') {
      const mode = data.extract_mode || 'marker';
      const marker = data.extract_marker || '';
      const customRegex = data.extract_regex || '';
      const strict = data.extract_strict === true;
      const multiMatch = data.extract_multi_match || 'first';
      const onFail = data.extract_on_fail || 'skip_downstream';
      const isRegexMode = mode === 'regex';
      return `${nameField}${slugField}
        <div class="form-group">
          <label for="nodeExtractMode">${window.I18n?.t('workflow.extractMode') || 'Mode'}</label>
          <div class="input-group select-group compact-select">
            <select id="nodeExtractMode">
              <option value="marker" ${mode === 'marker' ? 'selected' : ''}>${window.I18n?.t('workflow.extractModeMarker') || 'Marker [name]'}</option>
              <option value="json" ${mode === 'json' ? 'selected' : ''}>${window.I18n?.t('workflow.extractModeJson') || 'JSON key'}</option>
              <option value="regex" ${mode === 'regex' ? 'selected' : ''}>${window.I18n?.t('workflow.extractModeRegex') || 'Custom regex'}</option>
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>

        <div class="form-group ${isRegexMode ? 'hidden' : ''}" id="nodeExtractMarkerGroup">
          <label for="nodeExtractMarker">${window.I18n?.t('workflow.extractMarker') || 'Tên marker / JSON key'}</label>
          <input id="nodeExtractMarker" type="text" placeholder="image_prompt_1" value="${this.escapeAttr(marker)}" />
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 6px; line-height: 1.4;">${window.I18n?.t('workflow.extractMarkerHint') || 'Auto match [name]:value (marker mode) hoặc JSON {"name": "value"} (json mode)'}</p>
        </div>

        <div class="form-group ${isRegexMode ? '' : 'hidden'}" id="nodeExtractRegexGroup">
          <label for="nodeExtractRegex">${window.I18n?.t('workflow.extractRegex') || 'Custom regex pattern'}</label>
          <input id="nodeExtractRegex" type="text" placeholder="\\[image_prompt_(\\d+)\\]:?\\s*(.+?)(?=\\[|$)" value="${this.escapeAttr(customRegex)}" />
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 6px; line-height: 1.4;">${window.I18n?.t('workflow.extractRegexHint') || 'Group 1 (hoặc group cuối) = text output. Flags gi auto.'}</p>
        </div>

        <div class="form-group">
          <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" id="nodeExtractStrictWrap">
            <label class="toggle-switch-compact" style="margin:0;">
              <input type="checkbox" id="nodeExtractStrict" ${strict ? 'checked' : ''}>
              <span class="toggle-slider-compact"></span>
            </label>
            <label for="nodeExtractStrict" style="font-size:12px;color:var(--foreground);cursor:pointer;margin:0;">
              ${window.I18n?.t('workflow.extractStrict') || 'Strict mode (case-sensitive)'}
            </label>
          </div>
        </div>

        <div class="form-group form-grid-2col">
          <div>
            <label for="nodeExtractMultiMatch">${window.I18n?.t('workflow.extractMultiMatch') || 'Nhiều match'}</label>
            <div class="input-group select-group compact-select">
              <select id="nodeExtractMultiMatch">
                <option value="first" ${multiMatch === 'first' ? 'selected' : ''}>${window.I18n?.t('common.first') || 'First'}</option>
                <option value="last" ${multiMatch === 'last' ? 'selected' : ''}>${window.I18n?.t('common.last') || 'Last'}</option>
                <option value="concat" ${multiMatch === 'concat' ? 'selected' : ''}>${window.I18n?.t('workflow.extractConcat') || 'Concat all'}</option>
                <option value="error" ${multiMatch === 'error' ? 'selected' : ''}>${window.I18n?.t('common.error') || 'Error'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
          <div>
            <label for="nodeExtractOnFail">${window.I18n?.t('workflow.extractOnFail') || 'Khi extract fail'}</label>
            <div class="input-group select-group compact-select">
              <select id="nodeExtractOnFail">
                <option value="empty" ${onFail === 'empty' ? 'selected' : ''}>${window.I18n?.t('workflow.extractFailEmpty') || 'Pass text rỗng'}</option>
                <option value="skip_downstream" ${onFail === 'skip_downstream' ? 'selected' : ''}>${window.I18n?.t('workflow.extractFailSkip') || 'Skip downstream'}</option>
                <option value="fail_workflow" ${onFail === 'fail_workflow' ? 'selected' : ''}>${window.I18n?.t('workflow.extractFailWorkflow') || 'Fail workflow'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
        </div>
        ${enabledField}`;
    }
    if (nodeType === 'download') {
      const folderName = data.download_folder || '';
      const fileTemplate = data.download_file_template || '';
      const downloadRes = data.download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.image || '1k');
      // Bug 39 fix (2026-05-19): Download node nhận input từ upstream — có thể image
      // hoặc video. Runtime (WorkflowExecutor:3237-3240) auto-detect upstream type +
      // pick `video_download_resolution` cho video, `download_resolution` cho image.
      // Trước fix UI chỉ render 1 dropdown image → user không chọn được video resolution
      // → runtime luôn fallback '720p' (không thể 1080p/4K).
      const videoDownloadRes = data.video_download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.video || '720p');
      const collectAll = data.download_collect_all === true || data.download_collect_all === '1' || data.download_collect_all === 1;
      const canUseDownload = window.featureGate?.canUse('auto_download') ?? false;
      return `${nameField}
        <div class="form-group">
          <p style="font-size: 12px; color: var(--muted-foreground);">${window.I18n?.t('workflow.downloadNodeDesc') || 'Tải xuống kết quả từ node trước đó'}</p>
        </div>
        <div class="form-group node-download-gate${canUseDownload ? ' hidden' : ''}" id="nodeDownloadGate">
          <div style="display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25); border-radius: 6px;">
            <svg class="node-download-crown" width="14" height="14" viewBox="0 0 24 24" fill="#eab308"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"></path></svg>
            <span style="font-size: 12px; color: var(--muted-foreground);">${window.I18n?.t('workflow.downloadGateMsg') || 'Tính năng tải xuống yêu cầu gói Premium. Nâng cấp để sử dụng.'} <a href="#" class="node-download-upgrade-link" style="color: #eab308; text-decoration: underline;">${window.I18n?.t('common.upgrade') || 'Upgrade'}</a></span>
          </div>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.downloadNodeResolution') || 'Image resolution'}</label>
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: -2px; margin-bottom: 6px;">${window.I18n?.t('workflow.downloadNodeImageResHint') || 'Chỉ áp dụng cho ảnh Flow (1K/2K/4K). ChatGPT/Grok dùng CDN trực tiếp, không có menu resolution.'}</p>
          <div class="input-group select-group compact-select">
            <select id="downloadResolution">
              ${(window.ProviderConfigManager?.getDownloadResolutionsSync('flow', 'image') || [
                { value: '1k', label: '1K' },
                { value: '2k', label: '2K' },
                { value: '4k', label: '4K (Ultra)' },
              ]).map(r => `<option value="${r.value}" ${downloadRes === r.value ? 'selected' : ''}>${r.label || r.menu_label || r.value}</option>`).join('')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.downloadNodeVideoResolution') || 'Video resolution'}</label>
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: -2px; margin-bottom: 6px;">${window.I18n?.t('workflow.downloadNodeVideoResHint') || 'Chỉ áp dụng cho video Flow (720p/1080p/4K). Grok video tải trực tiếp từ CDN, không có menu resolution.'}</p>
          <div class="input-group select-group compact-select">
            <select id="downloadVideoResolution">
              ${(window.ProviderConfigManager?.getDownloadResolutionsSync('flow', 'video') || [
                { value: '720p', label: '720p' },
                { value: '1080p', label: '1080p' },
                { value: '4k', label: '4K (Ultra)' },
              ]).map(r => `<option value="${r.value}" ${videoDownloadRes === r.value ? 'selected' : ''}>${r.label || r.menu_label || r.value}</option>`).join('')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <div class="node-collect-toggle">
            <label class="toggle-switch-compact">
              <input type="checkbox" id="downloadCollectAll" ${collectAll ? 'checked' : ''}>
              <span class="toggle-slider-compact"></span>
            </label>
            <div class="node-collect-info">
              <span class="node-collect-label">${window.I18n?.t('workflow.collectAll') || 'Thu thập toàn bộ'}</span>
              <span class="node-collect-desc">${window.I18n?.t('workflow.collectAllDesc') || 'Lấy file từ tất cả nodes'}</span>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.folderName') || 'Tên thư mục'}</label>
          <input type="text" id="downloadFolder" class="form-input" value="${folderName}" placeholder="${window.I18n?.t('workflow.leaveEmpty') || 'Leave empty = default'}">
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.folderVars') || 'Biến: {workflow}, {date}, {time}'}</p>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.fileName') || 'Tên file'}</label>
          <input type="text" id="downloadFileTemplate" class="form-input" value="${fileTemplate}" placeholder="{node}_{prompt}_{date}_{time}_{index}">
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.fileVars') || 'Biến: {prompt}, {node}, {index}, {date}, {time}'}</p>
        </div>
        ${enabledField}`;
    }
    if (nodeType === 'telegram') {
      const chatId = data.telegram_chat_id || '';
      const telegramMsg = data.telegram_message || '';
      const sendMode = data.telegram_send_mode || 'single';
      const canUseTelegram = (window.featureGate?.canUse('telegram_enabled') ?? false) &&
        (window.featureGate?.canUse('telegram_workflow') ?? false);
      return `${nameField}
        <div class="form-group">
          <p style="font-size: 12px; color: var(--muted-foreground);">${window.I18n?.t('workflow.telegramNodeDesc') || 'Gửi ảnh kết quả từ các node nguồn qua Telegram.'}</p>
        </div>
        <div class="form-group node-telegram-gate${canUseTelegram ? ' hidden' : ''}" id="nodeTelegramGate">
          <div style="display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25); border-radius: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#eab308"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"></path></svg>
            <span style="font-size: 12px; color: var(--muted-foreground);">${window.I18n?.t('workflow.telegramGateMsg') || 'Tính năng Telegram yêu cầu gói Premium. Nâng cấp để sử dụng.'} <a href="#" class="node-telegram-upgrade-link" style="color: #eab308; text-decoration: underline;">${window.I18n?.t('common.upgrade') || 'Upgrade'}</a></span>
          </div>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.telegramChatId') || 'Chat ID'}</label>
          <input type="text" id="telegramChatId" class="form-input" value="${chatId}" placeholder="${window.I18n?.t('workflow.telegramChatIdPlaceholder') || 'E.g.: 123456789'}">
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;" id="telegramLinkStatus">${window.I18n?.t('workflow.checkingLink') || 'Checking link...'}</p>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.telegramSendMode') || 'Send images'}</label>
          <div class="input-group select-group compact-select">
            <select id="telegramSendMode">
              <option value="single" ${sendMode === 'single' ? 'selected' : ''}>${window.I18n?.t('workflow.telegramSendSingle') || 'Individual (multiple messages)'}</option>
              <option value="group" ${sendMode === 'group' ? 'selected' : ''}>${window.I18n?.t('workflow.telegramSendGroup') || 'Group (1 message)'}</option>
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>${window.I18n?.t('workflow.telegramCaption') || 'Caption'}</label>
          <textarea id="telegramMessage" class="form-input" rows="2" placeholder="${window.I18n?.t('workflow.telegramCaptionPlaceholder') || 'E.g.: Workflow results...'}">${telegramMsg}</textarea>
        </div>
        ${enabledField}`;
    }
    // === AI AGENT NODE (Phase CG-8 + AI Agent rename 2026-05-30) ===
    // Form: textarea prompt + toggle Use AI + (conditional) provider dropdown + timeout
    if (nodeType === 'prompt') {
      const promptText = data.prompt || '';
      const enhance = !!data.use_ai;   // var name `enhance` giữ vì template HTML below dùng nhiều
      const provider = data.provider || 'chatgpt';
      const timeoutSec = data.timeout_sec || 60;
      // Feature gates — canUseAiAgent() check key 'ai_agent_enabled' duy nhất.
      const canEnhance = !!(window.featureGate?.canUseAiAgent?.());
      const canChatGPT = !!(window.featureGate?.canUse('chatgpt_enabled'));
      const canGemini = !!(window.featureGate?.canUse('gemini_enabled'));
      // Provider names from ProviderMeta
      const chatgptName = window.ProviderMeta?.getName?.('chatgpt') || 'ChatGPT';
      const geminiName = window.ProviderMeta?.getName?.('gemini') || 'Gemini';
      const providerName = provider === 'chatgpt' ? chatgptName : geminiName;
      // SVG lock icon (thay cho emoji 🔒)
      // AI Agent 2026-05-30: Crown icon thay lock — user-friendly hơn (premium thay vì "khóa").
      const crownIconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align: -2px; margin-right: 3px;"><path d="M5 16L3 7l5.5 4L12 4l3.5 7L21 7l-2 9H5zm0 2h14v2H5v-2z"/></svg>`;
      // Provider section hidden by default khi enhance OFF
      const providerHiddenClass = enhance ? '' : ' hidden';
      return `${nameField}${slugField}
        <div class="form-group">
          <label for="promptNodeText">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M12 3l2.39 5.26L20 10l-4.5 4.13L17 20l-5-3-5 3 1.5-5.87L4 10l5.61-1.74L12 3z"/></svg>
            ${window.I18n?.t('workflow.promptText') || 'Nội dung Prompt'}
          </label>
          <div class="prompt-mention-wrapper">
            <textarea id="promptNodeText" placeholder="${window.I18n?.t('workflow.promptNodePlaceholder') || 'VD: A cute cat playing with yarn, cinematic lighting'}">${this.escapeHtml(promptText)}</textarea>${this._promptCharCountHtml(promptText)}
          </div>
          <details class="mention-mode-advanced">
            <summary>${window.I18n?.t('workflow.mentionModeAdvanced') || 'Mention Mode (Advanced)'}</summary>
            <div class="mention-mode-row">
              <div class="mention-mode-group">
                <label class="mention-mode-label">${window.I18n?.t('workflow.promptMode') || 'Prompt'}</label>
                <select id="promptNodePromptMode" class="mention-mode-select">
                  <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                  <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                  <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
                </select>
              </div>
              <div class="mention-mode-group">
                <label class="mention-mode-label">${window.I18n?.t('workflow.refMode') || 'Ref'}</label>
                <select id="promptNodeRefMode" class="mention-mode-select">
                  <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                  <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                  <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
                </select>
              </div>
            </div>
          </details>
        </div>
        <div class="form-group">
          <label class="toolbar-toggle${!canEnhance ? ' feature-disabled' : ''}" for="promptNodeUseAi" ${!canEnhance ? `title="${window.I18n?.t('workflow.featureDisabled') || 'Tính năng này yêu cầu gói Premium'}"` : ''}>
            <input type="checkbox" id="promptNodeUseAi" ${enhance ? 'checked' : ''} ${!canEnhance ? 'disabled' : ''} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span class="toggle-label">${window.I18n?.t('workflow.useAi') || 'Dùng AI'}</span>
            ${!canEnhance ? `<span class="premium-crown" style="margin-left:6px;" title="${window.I18n?.t('workflow.useAiPremiumOnly') || 'Chỉ hoạt động với tài khoản Premium'}">${crownIconSvg}${window.I18n?.t('workflow.useAiPremiumOnly') || 'Chỉ hoạt động với tài khoản Premium'}</span>` : ''}
          </label>
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${enhance
            ? (window.I18n?.t('workflow.useAiOnHint') || 'Submit text qua AI (ChatGPT/Gemini) — enhance prompt, analyze, compose, translate, summarize.')
            : (window.I18n?.t('workflow.useAiOffHint') || 'Output = text nguyên văn (không gọi AI, không tốn quota).')}</p>
        </div>
        <!-- AI Agent 2026-05-30: Provider + Timeout 2-col grid layout. Provider status button vẫn ở header
             trên Provider col. Hints + warning render full-width dưới grid. -->
        <div class="form-group prompt-node-provider-section${providerHiddenClass}" id="promptNodeProviderSection">
          <div class="prompt-provider-timeout-row">
            <div class="prompt-provider-col">
              <div class="prompt-provider-header">
                <label for="promptNodeProvider">${window.I18n?.t('workflow.provider') || 'Provider'}</label>
                <button type="button" class="provider-reminder-btn prompt-provider-btn" id="promptProviderStatusBtn" data-provider="${provider}" title="${window.I18n?.t('workflow.checkingStatus') || 'Checking...'}">
                  <span class="provider-status-dot"></span>
                  <span class="provider-btn-text" data-ready-text="${window.I18n?.t('workflow.providerReady') || 'Ready'}" data-not-ready-text="${window.I18n?.t('workflow.openProvider') || 'Open'} ${providerName}">${window.I18n?.t('workflow.openProvider') || 'Open'} ${providerName}</span>
                </button>
              </div>
              <div class="input-group select-group compact-select">
                <select id="promptNodeProvider">
                  <option value="chatgpt" ${provider === 'chatgpt' ? 'selected' : ''} ${!canChatGPT ? 'disabled' : ''}>${chatgptName}${!canChatGPT ? ' (Pro)' : ''}</option>
                  <option value="gemini" ${provider === 'gemini' ? 'selected' : ''} ${!canGemini ? 'disabled' : ''}>${geminiName}${!canGemini ? ' (Pro)' : ''}</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <div class="prompt-timeout-col" id="promptNodeTimeoutSection">
              <label for="promptNodeTimeout">${window.I18n?.t('workflow.promptTimeout') || 'Timeout'}</label>
              <div class="input-group">
                <input type="number" id="promptNodeTimeout" min="10" max="600" value="${timeoutSec}" />
                <span style="font-size: 11px; color: var(--muted-foreground); margin-left: 8px; margin-right: 10px;">s</span>
              </div>
            </div>
          </div>
          <p style="font-size: 11px; color: var(--warning); margin-top: 6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            ${window.I18n?.t('workflow.promptProviderHint') || 'Khuyên dùng ChatGPT. Gemini có thể trả ảnh thay vì text.'}
            <span style="margin-left:8px; color: var(--muted-foreground);">·</span>
            <span style="color: var(--muted-foreground);">${window.I18n?.t('workflow.promptTimeoutHint') || 'Thời gian chờ AI phản hồi (tăng nếu prompt dài)'}</span>
          </p>
        </div>
        ${(this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview)
          // EWT-9.1: Template mode/preview - hiển thị ref images từ URLs
          ? `<div class="form-group prompt-node-provider-section${providerHiddenClass}" id="promptNodeRefsGroup">
              ${this._renderRefImagesFieldForTemplate(data, 'promptNodeRefPreview', 'promptNodeRefImgUrls', 'promptNodePickBtn', 4)}
              <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.promptRefHint') || 'Images sent with prompt to LLM for image context understanding.'}</p>
            </div>`
          // Normal mode - chọn ảnh từ Flow
          : `<div class="form-group prompt-node-provider-section${providerHiddenClass}" id="promptNodeRefsGroup">
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            ${window.I18n?.t('workflow.promptRefImages') || 'Reference images (max 4)'}
          </label>
          <button class="node-ref-btn" id="promptNodePickBtn" type="button">
            <svg class="node-ref-btn__icon ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"></path><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path><path d="M19 22v-6"></path><path d="M22 19l-3 -3l-3 3"></path></svg>
            <span class="node-ref-btn__text">${window.I18n?.t('workflow.selectRefImages') || 'Select / Upload image'}</span>
          </button>
          <div class="ref-images-preview" id="promptNodeRefPreview"></div>
          <input type="hidden" id="promptNodeRefFileIds" value="${this.escapeAttr(data.ref_file_ids || '')}" />
          <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.promptRefHint') || 'Images sent with prompt to LLM for image context understanding.'}</p>
        </div>`}
        <!-- 2026-05-31 UX: Cài đặt nâng cao đặt SAU ref images section (theo user request) —
             để fields chính (provider/timeout/ref) lên trên, advanced collapsible cuối. -->
        <details class="mention-mode-advanced prompt-advanced-settings prompt-node-provider-section${providerHiddenClass}" id="promptNodeAdvancedSection">
          <summary>${window.I18n?.t('workflow.promptAdvancedSettings') || 'Cài đặt nâng cao'}</summary>
          <div class="form-group" id="promptNodeFallbackSection">
            <label class="toolbar-toggle" for="promptNodeFallback">
              <input type="checkbox" id="promptNodeFallback" ${data.ai_fallback !== false ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">${window.I18n?.t('workflow.aiFallback') || 'Fallback plain text nếu AI lỗi'}</span>
            </label>
            <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.aiFallbackHint') || 'Tự động dùng text nguyên văn nếu AI không phản hồi (timeout/lỗi).'}</p>
          </div>
          <div class="form-group" id="promptNodeDeleteAfterSection">
            <label class="toolbar-toggle" for="promptNodeDeleteAfter">
              <input type="checkbox" id="promptNodeDeleteAfter" ${data.ai_delete_after_run !== false ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">${window.I18n?.t('workflow.aiDeleteAfterRun') || 'Xoá conversation sau khi AI run'}</span>
            </label>
            <p style="font-size: 11px; color: var(--muted-foreground); margin-top: 4px;">${window.I18n?.t('workflow.aiDeleteAfterRunHint') || 'Tự động xoá conversation trên ChatGPT/Gemini sau khi nhận kết quả → giữ chat history sạch. Chỉ chạy khi AI run thành công.'}</p>
          </div>
        </details>
        ${enabledField}`;
    }

    // === CHATGPT NODE ===
    if (nodeType === 'chatgpt') {
      const cgPrompt = data.prompt || '';
      const cgRatio = data.ratio || 'story';
      const cgUseFallback = data.use_fallback_prefix || 'auto';
      const cgTimeout = data.timeout_ms || 120000;
      const cgAutoDownload = !!data.auto_download;
      const canUseChatGPT = (window.featureGate?.canUse('chatgpt_enabled') ?? false);
      // Bug 35 fix (2026-05-19): Đọc từ ChatGPTAdapter.capabilities (PCM-backed getter).
      // Admin tweak ratios qua /admin/providers/chatgpt/api-configs → SSE → adapter trả fresh.
      // Fallback inline 5 ratios khi adapter chưa load.
      const _cgAdapter = window.ProviderRegistry?.get?.('chatgpt');
      const _cgSupportedRatios = _cgAdapter?.capabilities?.supportedRatios
        || ['story', 'portrait', 'square', 'landscape', 'widescreen'];
      const _cgRatioUiMap = _cgAdapter?.capabilities?.ratioUiMap
        || { story: '9:16', portrait: '3:4', square: '1:1', landscape: '4:3', widescreen: '16:9' };
      const cgRatioOptions = _cgSupportedRatios.map(key => ({ key, label: _cgRatioUiMap[key] || key }));
      // SVG icon cho mỗi ratio (rectangle với aspect ratio tương ứng — vertical / horizontal / square)
      const cgRatioIcons = {
        story:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="18" rx="1.2"/></svg>',
        portrait:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="4" width="10" height="16" rx="1.2"/></svg>',
        square:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="1.2"/></svg>',
        landscape:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="7" width="16" height="10" rx="1.2"/></svg>',
        widescreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="9" width="18" height="6" rx="1.2"/></svg>'
      };
      const cgRatioPills = cgRatioOptions.map(opt => `
        <button type="button" class="ratio-pill chatgpt-ratio-pill${opt.key === cgRatio ? ' active' : ''}" data-ratio="${opt.key}" title="${opt.label}">${cgRatioIcons[opt.key] || ''}<span>${opt.label}</span></button>
      `).join('');
      const cgPromptSourceHtml = this._renderPromptSourceRadio(data, nodeId);
      const cgLockIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
      const chatgptBrandHeader = `
        <div class="node-brand-header node-brand-header--chatgpt">
          <svg class="node-brand-logo" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
          <span class="node-brand-name" data-provider="chatgpt">${window.ProviderMeta?.getName?.('chatgpt') || 'ChatGPT'}</span>
          ${this._renderProviderLoginReminder('chatgpt')}
        </div>`;
      return `${chatgptBrandHeader}${nameField}${slugField}
        ${cgPromptSourceHtml}
        ${!canUseChatGPT ? `
        <div class="form-group node-chatgpt-gate" id="nodeChatGPTGate">
          <div style="padding:10px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:6px;display:flex;align-items:center;gap:8px;color:#f59e0b;font-size:12px;">
            ${cgLockIconSvg}
            <span>${window.I18n?.t('workflow.chatgptImageLockedHint') || 'ChatGPT Image yêu cầu gói Pro. Node có thể chỉnh nhưng KHÔNG chạy được.'} <a href="#" class="node-chatgpt-upgrade-link" style="color:#f59e0b;text-decoration:underline;">${window.I18n?.t('common.upgrade') || 'Upgrade'}</a></span>
          </div>
        </div>` : ''}
        <div class="form-group" id="chatgptNodePromptGroup">
          <label for="chatgptNodePrompt">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            ${window.I18n?.t('workflow.prompt') || 'Prompt'}
          </label>
          <div class="prompt-mention-wrapper">
            <textarea id="chatgptNodePrompt" placeholder="${window.I18n?.t('workflow.chatgptPromptPlaceholder') || 'VD: A cute cat playing in the garden...'}">${this.escapeHtml(cgPrompt)}</textarea>${this._promptCharCountHtml(cgPrompt)}
          </div>
          <details class="mention-mode-advanced">
            <summary>${window.I18n?.t('workflow.mentionModeAdvanced') || 'Mention Mode (Advanced)'}</summary>
            <div class="mention-mode-row">
              <div class="mention-mode-group">
                <label class="mention-mode-label">${window.I18n?.t('workflow.promptMode') || 'Prompt'}</label>
                <select id="chatgptPromptMode" class="mention-mode-select">
                  <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                  <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                  <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
                </select>
              </div>
              <div class="mention-mode-group">
                <label class="mention-mode-label">${window.I18n?.t('workflow.refMode') || 'Ref'}</label>
                <select id="chatgptRefMode" class="mention-mode-select">
                  <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                  <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                  <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
                </select>
              </div>
            </div>
          </details>
        </div>
        <div class="form-group">
          <div class="node-form-mode-toggle" role="tablist" aria-label="${window.I18n?.t('workflow.modeLabel') || 'Chế độ'}">
            <button type="button" class="node-form-mode-btn active" data-mode="image" data-tooltip="${window.I18n?.t('workflow.genTypeImage') || 'Image'}" aria-label="${window.I18n?.t('workflow.genTypeImage') || 'Image'}" aria-selected="true" role="tab">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
            ${window.I18n?.t('workflow.imageRatio') || 'Tỷ lệ ảnh'}
          </label>
          <div class="ratio-pills-container" id="chatgptImageRatioPills">
            ${cgRatioPills}
          </div>
          <input type="hidden" id="chatgptImageRatio" value="${this.escapeAttr(cgRatio)}" />
        </div>
        ${(this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview)
          // EWT-9.1: Template mode/preview - hiển thị ref images từ URLs
          ? `<div class="form-group" id="chatgptImageRefImagesGroup">
              ${this._renderRefImagesFieldForTemplate(data, 'chatgptImageRefPreview', 'chatgptImageRefImgUrls', 'chatgptImageNodePickBtn', 4)}
            </div>
            ${this._renderResultImageFieldForTemplate(data, 'chatgptResultPreview', 'chatgptResultImgUrl', 'chatgptResultPickBtn')}`
          // Normal mode - chọn ảnh từ Flow
          : `<div class="form-group" id="chatgptImageRefImagesGroup">
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            ${window.I18n?.t('workflow.refImages') || 'Reference images'} <span style="font-size: 11px; color: var(--muted-foreground); font-weight: normal;">(${window.I18n?.t('workflow.chatgptRefMax') || 'max 4'})</span>
          </label>
          <button class="node-ref-btn" id="chatgptImageNodePickBtn">
            <svg class="node-ref-btn__icon ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"></path><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path><path d="M19 22v-6"></path><path d="M22 19l-3 -3l-3 3"></path></svg>
            <span class="node-ref-btn__text">${window.I18n?.t('workflow.selectRefImages') || 'Select / Upload image'}</span>
          </button>
          <div class="ref-images-preview" id="chatgptImageRefPreview"></div>
          <input type="hidden" id="chatgptImageRefFileIds" value="${this.escapeAttr(data.ref_file_ids || '')}" />
        </div>`}
        <div class="form-group">
          <label for="chatgptNodeModel">${window.I18n?.t('node.modelPill') || 'Model'}</label>
          <div class="input-group select-group compact-select">
            <select id="chatgptNodeModel">
              ${(window.ModelRegistry?.safeGetModelsSync('chatgpt', 'image') || [{ value: 'Instant', name: 'Instant' }, { value: 'Thinking', name: 'Thinking' }]).map(m => `<option value="${this.escapeAttr(m.value || m.name)}" ${(data.model || 'Instant') === (m.value || m.name) ? 'selected' : ''}>${this.escapeHtml(m.name || m.value)}</option>`).join('')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <details class="node-form-advanced">
          <summary>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M12 8v4M12 16h.01"></path><circle cx="12" cy="12" r="10"></circle></svg>
            <span>${window.I18n?.t('workflow.advancedSettings') || 'Advanced settings'}</span>
            <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </summary>
          <p class="advanced-hint">${window.I18n?.t('workflow.advancedHint') || 'These rarely need adjustment. Only change when facing errors/timeout.'}</p>
          <div class="form-group">
            <label for="chatgptImageMode">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              ${window.I18n?.t('workflow.chatgptMode') || 'Generation mode'}
            </label>
            <div class="input-group select-group compact-select">
              <select id="chatgptImageMode">
                <option value="auto" ${cgUseFallback === 'auto' ? 'selected' : ''}>${window.I18n?.t('workflow.chatgptModeAuto') || 'Auto (try image mode → fallback)'}</option>
                <option value="always" ${cgUseFallback === 'always' ? 'selected' : ''}>${window.I18n?.t('workflow.chatgptModeAlways') || 'Always use prefix'}</option>
                <option value="never" ${cgUseFallback === 'never' ? 'selected' : ''}>${window.I18n?.t('workflow.chatgptModeNever') || 'Never use prefix'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <p class="form-field-hint">${window.I18n?.t('workflow.chatgptModeHint') || 'Auto: Try image mode (with ratio) → fallback prefix on fail. Always: Always use "Generate an image of:" prefix. Never: Force image mode (fail = error).'}</p>
          </div>
          <div class="form-group">
            <label for="chatgptImageTimeout">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              ${window.I18n?.t('workflow.chatgptTimeout') || 'Timeout (ms)'}
            </label>
            <div class="input-group">
              <input type="number" id="chatgptImageTimeout" min="30000" max="600000" step="10000" value="${cgTimeout}" />
            </div>
            <p class="form-field-hint">${window.I18n?.t('workflow.chatgptTimeoutHint') || 'Max wait time for ChatGPT to return image (default 120000ms = 2 min). Increase if TIMEOUT errors occur.'}</p>
          </div>
        </details>
        <div class="form-group">
          <div class="auto-download-row">
            <label class="toolbar-toggle${!window.featureGate?.canUse('auto_download') ? ' feature-disabled' : ''}" for="chatgptImageAutoDownload" ${!window.featureGate?.canUse('auto_download') ? `title="${window.I18n?.t('workflow.featureDisabled') || 'Tính năng này yêu cầu gói Premium'}"` : ''}>
              <input type="checkbox" id="chatgptImageAutoDownload" ${cgAutoDownload ? 'checked' : ''} ${!window.featureGate?.canUse('auto_download') ? 'disabled' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">${window.I18n?.t('workflow.autoDownload') || 'Tự động tải'}</span>
            </label>
            ${!window.featureGate?.canUse('auto_download') ? window.featureGate.renderCrownSpan('auto_download') : ''}
          </div>
        </div>
        ${enabledField}`;
    }

    // === GROK NODE (Phase G-6) ===
    if (nodeType === 'grok') {
      const grokPrompt = data.prompt || '';
      let grokRatio = data.ratio || 'widescreen';
      const grokMode = data.grok_mode || 'image';
      const grokDuration = data.grok_duration || '6s';
      const grokResolution = data.grok_resolution || '720p';
      // Image quality (Grok update 2026-04): 'speed' | 'quality'
      const grokImageQuality = data.grok_image_quality || 'speed';
      const grokTimeout = data.timeout_ms || 180000;
      const grokAutoDownload = !!data.auto_download;
      const canUseGrok = (window.featureGate?.canUse('grok_enabled') ?? false);

      // Bug 35 fix (2026-05-19): Đọc từ GrokAdapter.capabilities (PCM-backed getter).
      // Admin tweak ratios qua /admin/providers/grok/api-configs → SSE → adapter trả fresh.
      // Grok ratios: 2:3 / 3:2 / 1:1 / 9:16 / 16:9 (KHÔNG dùng 3:4/4:3 như ChatGPT).
      const _grokAdapter = window.ProviderRegistry?.get?.('grok');
      const _grokSupportedRatios = _grokAdapter?.capabilities?.supportedRatios
        || ['story', 'portrait', 'square', 'landscape', 'widescreen'];
      const _grokRatioUiMap = _grokAdapter?.capabilities?.ratioUiMap
        || { story: '9:16', portrait: '2:3', square: '1:1', landscape: '3:2', widescreen: '16:9' };
      const grokRatioOptions = _grokSupportedRatios.map(key => ({ key, label: _grokRatioUiMap[key] || key }));
      // Normalize grokRatio về KEY: data.ratio có thể là dimensional ('16:9') do settings sync từ
      // GenTab (aspectRatioSelect.value) → không match pill data-ratio (=key) → không pill nào active.
      // Nếu grokRatio không nằm trong supported keys → tìm key có uiMap[key] === grokRatio.
      if (!_grokSupportedRatios.includes(grokRatio)) {
        const _k = Object.keys(_grokRatioUiMap).find(k => _grokRatioUiMap[k] === grokRatio);
        if (_k) grokRatio = _k;
      }
      // Grok durations từ config (PCM-backed) — trước fix hardcode 6s/10s → admin thêm '15s' không hiện.
      const _grokDurs = _grokAdapter?.capabilities?.supportedDurations;
      const grokDurationOptions = (Array.isArray(_grokDurs) && _grokDurs.length) ? _grokDurs : ['6s', '10s'];
      const grokRatioIcons = {
        story:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="18" rx="1.2"/></svg>',
        portrait:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="4" width="10" height="16" rx="1.2"/></svg>',
        square:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="1.2"/></svg>',
        landscape:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="7" width="16" height="10" rx="1.2"/></svg>',
        widescreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="9" width="18" height="6" rx="1.2"/></svg>'
      };
      const grokRatioPills = grokRatioOptions.map(opt => `
        <button type="button" class="ratio-pill grok-ratio-pill${opt.key === grokRatio ? ' active' : ''}" data-ratio="${opt.key}" title="${opt.label}">${grokRatioIcons[opt.key] || ''}<span>${opt.label}</span></button>
      `).join('');
      const grokLockIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
      const grokPromptSourceHtml = this._renderPromptSourceRadio(data, nodeId);
      const grokBrandHeader = `
        <div class="node-brand-header node-brand-header--grok">
          <svg class="node-brand-logo" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/></svg>
          <span class="node-brand-name" data-provider="grok">${window.ProviderMeta?.getName?.('grok') || 'Grok'}</span>
          ${this._renderProviderLoginReminder('grok')}
        </div>`;

      return `${grokBrandHeader}${nameField}${slugField}
        ${grokPromptSourceHtml}
        ${!canUseGrok ? `
        <div class="form-group node-grok-gate" id="nodeGrokGate">
          <div style="padding:10px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:6px;display:flex;align-items:center;gap:8px;color:#f59e0b;font-size:12px;">
            ${grokLockIconSvg}
            <span>${window.I18n?.t('workflow.grokLockedHint') || 'Grok yêu cầu gói Pro. Node có thể chỉnh nhưng KHÔNG chạy được.'} <a href="#" class="node-grok-upgrade-link" style="color:#f59e0b;text-decoration:underline;">${window.I18n?.t('common.upgrade') || 'Upgrade'}</a></span>
          </div>
        </div>` : ''}
        <div class="form-group" id="grokNodePromptGroup">
          <label for="grokNodePrompt">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            ${window.I18n?.t('workflow.promptText') || 'Nội dung Prompt'}
          </label>
          <div class="prompt-mention-wrapper">
            <textarea id="grokNodePrompt" placeholder="${window.I18n?.t('workflow.grokNodePlaceholder') || 'VD: A futuristic robot with neon lights, cinematic'}">${this.escapeHtml(grokPrompt)}</textarea>${this._promptCharCountHtml(grokPrompt)}
          </div>
          <details class="mention-mode-advanced">
            <summary>${window.I18n?.t('workflow.mentionModeAdvanced') || 'Mention Mode (Advanced)'}</summary>
            <div class="mention-mode-row">
              <div class="mention-mode-group">
                <label class="mention-mode-label">${window.I18n?.t('workflow.promptMode') || 'Prompt'}</label>
                <select id="grokPromptMode" class="mention-mode-select">
                  <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                  <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                  <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
                </select>
              </div>
              <div class="mention-mode-group">
                <label class="mention-mode-label">${window.I18n?.t('workflow.refMode') || 'Ref'}</label>
                <select id="grokRefMode" class="mention-mode-select">
                  <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                  <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                  <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
                </select>
              </div>
            </div>
          </details>
        </div>
        <div class="form-group">
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            ${window.I18n?.t('workflow.grokMode') || 'Chế độ'}
          </label>
          <div class="node-form-mode-toggle" id="grokNodeModeToggle" role="tablist" aria-label="Grok mode">
            <button type="button" class="node-form-mode-btn${grokMode === 'image' ? ' active' : ''}" data-mode="image" data-tooltip="${window.I18n?.t('workflow.grokModeImage') || 'Tạo ảnh'}" aria-label="${window.I18n?.t('workflow.grokModeImage') || 'Image'}" role="tab">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
            <button type="button" class="node-form-mode-btn${grokMode === 'video' ? ' active' : ''}" data-mode="video" data-tooltip="${window.I18n?.t('workflow.grokModeVideo') || 'Tạo video'}" aria-label="${window.I18n?.t('workflow.grokModeVideo') || 'Video'}" role="tab">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>
            </button>
            <input type="hidden" id="grokNodeMode" value="${this.escapeAttr(grokMode)}" />
          </div>
        </div>
        <div class="form-group">
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
            ${window.I18n?.t('workflow.grokRatio') || 'Tỷ lệ'}
          </label>
          <div class="ratio-pills-container" id="grokRatioPills">${grokRatioPills}</div>
          <input type="hidden" id="grokNodeRatio" value="${this.escapeAttr(grokRatio)}" />
        </div>
        <div class="grok-video-row" id="grokVideoOnlyRow" style="${grokMode === 'video' ? '' : 'display:none;'}">
          <div class="form-group grok-video-only" id="grokDurationGroup">
            <label for="grokNodeDuration">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              ${window.I18n?.t('workflow.grokDuration') || 'Thời lượng'}
            </label>
            <div class="input-group select-group compact-select">
              <select id="grokNodeDuration">
                ${grokDurationOptions.map(d => `<option value="${d}" ${grokDuration === d ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
          <div class="form-group grok-video-only" id="grokResolutionGroup">
            <label for="grokNodeResolution">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              ${window.I18n?.t('workflow.grokResolution') || 'Resolution'}
            </label>
            <div class="input-group select-group compact-select">
              <select id="grokNodeResolution">
                <option value="480p" ${grokResolution === '480p' ? 'selected' : ''}>480p</option>
                <option value="720p" ${grokResolution === '720p' ? 'selected' : ''}>720p</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
        </div>
        <!-- Grok image quality (Grok update 2026-04) — chỉ hiện khi mode=image -->
        <div class="grok-image-row" id="grokImageOnlyRow" style="${grokMode === 'image' ? '' : 'display:none;'}">
          <div class="form-group grok-image-only" id="grokImageQualityGroup">
            <label for="grokNodeImageQuality">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${window.I18n?.t('workflow.grokImageQuality') || 'Chất lượng ảnh'}
            </label>
            <div class="input-group select-group compact-select">
              <select id="grokNodeImageQuality">
                <option value="speed" ${grokImageQuality === 'speed' ? 'selected' : ''}>${window.I18n?.t('workflow.grokImageQualitySpeed') || 'Speed'}</option>
                <option value="quality" ${grokImageQuality === 'quality' ? 'selected' : ''}>${window.I18n?.t('workflow.grokImageQualityQuality') || 'Quality'}</option>
              </select>
              <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
        </div>
        ${(this.isTemplateMode || this.workflow?._is_template_preview || this.workflow?._isPreview)
          // EWT-9.1: Template mode/preview - hiển thị ref images từ URLs
          ? `<div class="form-group" id="grokNodeRefImagesGroup">
              ${this._renderRefImagesFieldForTemplate(data, 'grokNodeRefPreview', 'grokNodeRefImgUrls', 'grokNodePickBtn', 4)}
            </div>
            ${this._renderResultImageFieldForTemplate(data, 'grokNodeResultPreview', 'grokNodeResultImgUrl', 'grokNodeResultPickBtn')}`
          // Normal mode - chọn ảnh từ Flow
          : `<div class="form-group" id="grokNodeRefImagesGroup">
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            ${window.I18n?.t('workflow.refImagesMax4') || 'Reference images (max 4)'}
          </label>
          <button class="node-ref-btn" id="grokNodePickBtn" type="button">
            <svg class="node-ref-btn__icon ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"></path><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path><path d="M19 22v-6"></path><path d="M22 19l-3 -3l-3 3"></path></svg>
            <span class="node-ref-btn__text">${window.I18n?.t('workflow.selectRefImages') || 'Select / Upload image'}</span>
          </button>
          <div class="ref-images-preview" id="grokNodeRefPreview"></div>
          <input type="hidden" id="grokNodeRefFileIds" value="${this.escapeAttr(data.ref_file_ids || '')}" />
        </div>`}
        <div class="form-group">
          <div class="auto-download-row">
            <label class="toolbar-toggle${!window.featureGate?.canUse('auto_download') ? ' feature-disabled' : ''}" for="grokNodeAutoDownload" ${!window.featureGate?.canUse('auto_download') ? `title="${window.I18n?.t('workflow.featureDisabled') || 'Tính năng này yêu cầu gói Premium'}"` : ''}>
              <input type="checkbox" id="grokNodeAutoDownload" ${grokAutoDownload ? 'checked' : ''} ${!window.featureGate?.canUse('auto_download') ? 'disabled' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">${window.I18n?.t('workflow.autoDownload') || 'Tự động tải'}</span>
            </label>
            ${!window.featureGate?.canUse('auto_download') ? window.featureGate.renderCrownSpan('auto_download') : ''}
          </div>
        </div>
        <details class="node-form-advanced">
          <summary>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M12 8v4M12 16h.01"></path><circle cx="12" cy="12" r="10"></circle></svg>
            <span>${window.I18n?.t('workflow.advancedSettings') || 'Advanced settings'}</span>
            <svg class="chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </summary>
          <div class="form-group">
            <label for="grokNodeTimeout">${window.I18n?.t('workflow.timeoutMs') || 'Timeout (ms)'}</label>
            <input type="number" id="grokNodeTimeout" min="30000" max="600000" step="1000" value="${grokTimeout}" />
          </div>
        </details>
        ${enabledField}`;
    }

    // === GENERATE NODE (default) ===
    const connectedNodes = this._getConnectedSourceNodes(nodeId);
    const nodeOptions = connectedNodes.map(cn =>
      `<option value="${this.escapeAttr(cn.node_id)}">${this.escapeHtml(cn.node_name)}</option>`
    ).join('');
    const canUseGenerate = (window.featureGate?.canUse('gen_enabled') ?? false);
    const genLockIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    const genPromptSourceHtml = this._renderPromptSourceRadio(data, nodeId);
    const googleBrandHeader = `
      <div class="node-brand-header node-brand-header--google">
        <svg class="node-brand-logo" width="20" height="20" viewBox="0 0 24 24"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF"/><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#node-flow-grad-0)"/><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#node-flow-grad-1)"/><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#node-flow-grad-2)"/><defs><linearGradient gradientUnits="userSpaceOnUse" id="node-flow-grad-0" x1="7" x2="11" y1="15.5" y2="12"><stop stop-color="#08B962"/><stop offset="1" stop-color="#08B962" stop-opacity="0"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="node-flow-grad-1" x1="8" x2="11.5" y1="5.5" y2="11"><stop stop-color="#F94543"/><stop offset="1" stop-color="#F94543" stop-opacity="0"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="node-flow-grad-2" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stop-color="#FABC12"/><stop offset=".46" stop-color="#FABC12" stop-opacity="0"/></linearGradient></defs></svg>
        <span class="node-brand-name" data-provider="flow">${window.ProviderMeta?.getName?.('flow') || 'Google Flow'}</span>
      </div>`;
    return `${googleBrandHeader}${nameField}${slugField}
      ${genPromptSourceHtml}
      ${!canUseGenerate ? `
      <div class="form-group node-generate-gate" id="nodeGenerateGate">
        <div style="padding:10px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:6px;display:flex;align-items:center;gap:8px;color:#f59e0b;font-size:12px;">
          ${genLockIconSvg}
          <span>${window.I18n?.t('workflow.generateLockedHint') || 'Google Flow yêu cầu gói phù hợp. Node có thể chỉnh nhưng KHÔNG chạy được.'} <a href="#" class="node-generate-upgrade-link" style="color:#f59e0b;text-decoration:underline;">${window.I18n?.t('common.upgrade') || 'Upgrade'}</a></span>
        </div>
      </div>` : ''}
      <div class="form-group" id="nodePromptGroup">
        <label for="nodePrompt">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          ${window.I18n?.t('workflow.prompt') || 'Prompt'}
        </label>
        <div class="prompt-mention-wrapper">
          <textarea id="nodePrompt">${this.escapeHtml(data.prompt || '')}</textarea>${this._promptCharCountHtml(data.prompt || '')}
        </div>
        <details class="mention-mode-advanced">
          <summary>${window.I18n?.t('workflow.mentionModeAdvanced') || 'Mention Mode (Advanced)'}</summary>
          <div class="mention-mode-row">
            <div class="mention-mode-group">
              <label class="mention-mode-label">${window.I18n?.t('workflow.promptMode') || 'Prompt'}</label>
              <select id="nodePromptMode" class="mention-mode-select">
                <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
              </select>
            </div>
            <div class="mention-mode-group">
              <label class="mention-mode-label">${window.I18n?.t('workflow.refMode') || 'Ref'}</label>
              <select id="nodeRefMode" class="mention-mode-select">
                <option value="auto" selected>${window.I18n?.t('workflow.modeAuto') || 'Auto'}</option>
                <option value="all">${window.I18n?.t('workflow.modeAll') || 'All'}</option>
                <option value="mention">${window.I18n?.t('workflow.modeMention') || 'Mention'}</option>
              </select>
            </div>
          </div>
        </details>
      </div>
      <div class="section-header" style="margin-top: 4px; margin-bottom: 4px;"><label><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>${window.I18n?.t('settings.title') || 'Cài đặt'}</label></div>
      <div class="form-group">
        <div class="node-form-mode-toggle" id="nodeMediaTypeToggle" role="tablist" aria-label="${window.I18n?.t('workflow.modeLabel') || 'Chế độ'}">
          <button type="button" class="node-form-mode-btn${(data.media_type || 'Image') === 'Image' ? ' active' : ''}" data-mode="Image" data-tooltip="${window.I18n?.t('workflow.genTypeImage') || 'Image'}" aria-label="${window.I18n?.t('workflow.genTypeImage') || 'Image'}" role="tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
          <button type="button" class="node-form-mode-btn${data.media_type === 'Video' ? ' active' : ''}" data-mode="Video" data-tooltip="${window.I18n?.t('workflow.genTypeVideo') || 'Video'}" aria-label="${window.I18n?.t('workflow.genTypeVideo') || 'Video'}" role="tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>
          </button>
          <input type="hidden" id="nodeMediaType" value="${this.escapeAttr(data.media_type || 'Image')}" />
        </div>
      </div>
      <div class="gen-compact-bar" id="nodeGenCompactBar" data-gen-mode="${data.media_type === 'Video' ? 'video' : 'image'}">
        <div class="gen-compact-item" id="nodeImageModelGroup">
          <div class="input-group select-group compact-select">
            <select id="nodeModel">
              ${(window.ModelRegistry?.safeGetModelsSync('flow', 'image') || []).map(m => `<option value="${this.escapeAttr(m.value)}" ${data.model === m.value ? 'selected' : ''}>${this.escapeHtml(m.name)}</option>`).join('')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="gen-compact-item hidden" id="nodeVideoModelGroup">
          <div class="input-group select-group compact-select">
            <select id="nodeVideoModel">
              ${(window.ModelRegistry?.safeGetModelsSync('flow', 'video') || []).map(m => `<option value="${this.escapeAttr(m.value)}" ${data.model === m.value ? 'selected' : ''}>${this.escapeHtml(m.name.replace(/^Veo 3\.1 - /, 'Veo 3.1 '))}</option>`).join('')}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <!-- Voice + Character moved xuống sau qty (line riêng, đồng bộ GenTab/Task). -->
        <!-- Wrap break — active khi data-gen-mode="video": tất cả setting SAU Model xuống dòng. -->
        <div class="gen-compact-break gen-compact-break--video" aria-hidden="true"></div>
        <div class="gen-compact-item hidden" id="nodeVideoInputTypeGroup">
          <div class="input-group select-group compact-select">
            ${(() => {
              // 2026-05-31 fix: bug user switch Image→Video → UI hiển thị 'Frames' dù user setting
              // defaultVideoInputType='Ingredients'. Trước fix: nếu data.video_input_type empty →
              // không có selected attribute → browser pick first option 'Frames'.
              // Sau fix: compute effectiveVideoInputType từ data → settings default → 'Frames'.
              // Model không support Frames → force 'Ingredients' (unchanged).
              const supportsFrames = window.ProviderRegistry?.get?.('flow')?.supportsFrames?.(data.model) !== false;
              let effective = data.video_input_type || '';
              if (!effective) {
                if (!supportsFrames) {
                  effective = 'Ingredients';
                } else {
                  const settingDefault = window.storageSettings?.get?.('defaultVideoInputType');
                  effective = (settingDefault === 'Ingredients' || settingDefault === 'Frames')
                    ? settingDefault : 'Frames';
                }
              }
              return `
            <select id="nodeVideoInputType" data-effective-default="${this.escapeAttr(effective)}">
              ${supportsFrames ? `<option value="Frames" ${effective === 'Frames' ? 'selected' : ''}>Frames</option>` : ''}
              <option value="Ingredients" ${effective === 'Ingredients' ? 'selected' : ''}>Ingredients</option>
            </select>`;
            })()}
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="gen-compact-item hidden" id="nodeVideoDurationGroup">
          <div class="input-group select-group compact-select">
            <select id="nodeVideoDuration" title="${window.I18n?.t('workflow.videoDuration') || 'Thời lượng video'}">
              ${(() => {
                const currentModel = data.model || '';
                let tier = 'default';
                try {
                  const models = window.ModelRegistry?.safeGetModelsSync?.('flow', 'video') || [];
                  const modelObj = models.find(m => m.value === currentModel || m.name === currentModel);
                  if (modelObj?.config?.duration_tier) tier = modelObj.config.duration_tier;
                } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#sopt', _); }
                const durations = window.ProviderConfigManager?.safeGetVideoDurationsSync?.('flow', tier) || ['4s', '6s', '8s'];
                const currentDuration = data.video_duration || '6s';
                return durations.map(d => `<option value="${d}" ${currentDuration === d ? 'selected' : ''}>${d}</option>`).join('');
              })()}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="gen-compact-item">
          <div class="input-group select-group compact-select">
            <select id="nodeRatio">
              ${(() => {
                // Bug 40 fix (2026-05-19): Source from PCM (admin tweak realtime via SSE).
                // Flow generate ratios — Image: 5 ratios, Video: 2 ratios (Google constraint).
                const _genIsVideo = data.media_type === 'Video';
                const _genRatios = (window.ProviderConfigManager?.safeGetRatiosSync?.('flow', _genIsVideo ? 'video' : 'image'))
                  || (_genIsVideo ? ['16:9', '9:16'] : ['16:9', '4:3', '1:1', '3:4', '9:16']);
                const _genRatioIcon = (v) => {
                  const s = String(v || '').trim();
                  if (s === '16:9') return '▬';
                  if (s === '4:3' || s === '3:2') return '▭';
                  if (s === '1:1') return '□';
                  if (s === '3:4' || s === '2:3') return '▯';
                  if (s === '9:16') return '▮';
                  return '◇';
                };
                // Legacy VN labels backward-compat: 'Ngang'→16:9, 'Dọc'→9:16
                const _genCurrentRatio = data.ratio === 'Ngang' ? '16:9'
                  : data.ratio === 'Dọc' ? '9:16'
                  : (data.ratio || '16:9');
                return _genRatios.map(r => {
                  const v = typeof r === 'string' ? r : r.value;
                  return `<option value="${v}" ${_genCurrentRatio === v ? 'selected' : ''}>${_genRatioIcon(v)} ${v}</option>`;
                }).join('');
              })()}
            </select>
            <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="gen-compact-item">
          <div class="input-group compact-qty">
            <button class="compact-qty-btn" id="nodeQtyMinus" type="button">-</button>
            <input type="number" id="nodeQuantity" min="${window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow')?.min ?? 1}" max="${window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow')?.max ?? 4}" value="${data.quantity || 1}" />
            <button class="compact-qty-btn" id="nodeQtyPlus" type="button">+</button>
          </div>
        </div>
        <!-- Break LUÔN active → Character/Voice xuống 1 line riêng (đồng bộ GenTab/Task) -->
        <div class="gen-compact-break gen-compact-break--always" aria-hidden="true"></div>
        <!-- Flow Character Selector — line riêng (Flow image+video). -->
        <div class="gen-compact-item hidden" id="nodeCharacterPickerGroup">
          <button type="button" class="voice-picker-trigger" id="nodeCharacterTrigger" data-i18n-title="character.pickerTitle" title="Chọn nhân vật">
            <span class="voice-picker-trigger-thumb-svg" id="nodeCharacterTriggerThumb">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"></path>
              </svg>
            </span>
            <span class="voice-picker-label" id="nodeCharacterLabel" data-i18n="character.none">Character</span>
            <svg class="voice-picker-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <input type="hidden" id="nodeCharacterSlug" value="${this.escapeAttr(data.character_slug || '')}" />
          <input type="hidden" id="nodeCharacterSearchValue" value="${this.escapeAttr(data.character_search_value || '')}" />
        </div>
        <!-- Flow Voice Selector — line riêng (Flow + Video + supports_voice). -->
        <div class="gen-compact-item hidden" id="nodeVoicePickerGroup">
          <button type="button" class="voice-picker-trigger" id="nodeVoiceTrigger" data-i18n-title="voice.pickerTitle" title="Choose voice">
            <span class="voice-picker-trigger-thumb-svg" id="nodeVoiceTriggerThumb">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            </span>
            <span class="voice-picker-label" id="nodeVoiceLabel" data-i18n="voice.random">Random voice</span>
            <svg class="voice-picker-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <input type="hidden" id="nodeVoiceSlug" value="${this.escapeAttr(data.voice_slug || '')}" />
          <input type="hidden" id="nodeVoiceSearchValue" value="${this.escapeAttr(data.voice_search_value || '')}" />
        </div>
      </div>
      ${this.isTemplateMode
        ? this._renderRefImagesFieldForTemplate(data, 'generateNodeRefPreview', 'generateNodeRefImgUrls', 'generateNodePickBtn', 10)
        : `<div class="form-group" id="nodeRefImagesGroup">
        <label>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 4px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          ${window.I18n?.t('workflow.refImages') || 'Reference images'}
        </label>
        <button class="node-ref-btn" id="nodeOpenImagePickerBtn">
          <svg class="node-ref-btn__icon ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8h.01"></path><path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path><path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path><path d="M19 22v-6"></path><path d="M22 19l-3 -3l-3 3"></path></svg>
          <span class="node-ref-btn__text">${window.I18n?.t('workflow.selectRefImages') || 'Select / Upload image'}</span>
        </button>
        <div class="ref-images-preview" id="nodeRefImagesPreview"></div>
        <input type="hidden" id="nodeRefFileIds" value="${this.escapeAttr(data.ref_file_ids || '')}" />
      </div>`}
      <div class="form-group hidden" id="nodeFrameConfigGroup">
        <div class="frame-config">
          <div class="frame-slot" id="nodeFrame1Slot">
            <div class="frame-slot-header">
              <svg class="frame-slot-icon" viewBox="0 0 11 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5L8.9 7.5C9.46005 7.5 9.74008 7.5 9.95399 7.39101C10.1422 7.29513 10.2951 7.14215 10.391 6.95399C10.5 6.74008 10.5 6.46005 10.5 5.9V4.1C10.5 3.53995 10.5 3.25992 10.391 3.04601C10.2951 2.85785 10.1422 2.70487 9.95399 2.60899C9.74008 2.5 9.46005 2.5 8.9 2.5L5 2.5M3 7.5H2.1C1.53995 7.5 1.25992 7.5 1.04601 7.39101C0.857847 7.29513 0.704867 7.14215 0.608994 6.95399C0.5 6.74008 0.5 6.46005 0.5 5.9V4.1C0.5 3.53995 0.5 3.25992 0.608994 3.04601C0.704867 2.85785 0.857847 2.70487 1.04601 2.60899C1.25992 2.5 1.53995 2.5 2.1 2.5H3M3 0.5L3 9.5M1.75 9.5L4.25 9.5M1.75 0.499996L4.25 0.5"/></svg>
              <span class="frame-slot-label">${window.I18n?.t('gen.frameStart') || 'Start'}</span>
            </div>
            <div class="frame-slot-body">
              <select id="frame1Source" class="frame-source-select">
                <option value="">-- ${window.I18n?.t('workflow.selectSource') || 'Chọn nguồn'} --</option><option value="manual">${window.I18n?.t('workflow.selectManual') || 'Chọn ảnh thủ công'}</option>${nodeOptions}
              </select>
              <div class="frame-manual hidden" id="frame1Manual">
                <div class="frame-slot-body-inner" id="frame1Body">
                  <div class="frame-dropzone" id="frame1PickBtn">
                    <svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                    <span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span>
                  </div>
                </div>
                <input type="hidden" id="frame1FileId" value="${this.escapeAttr(data.frame_1_file_id || '')}" />
              </div>
              <div class="frame-node-info hidden" id="frame1NodeInfo"><span class="frame-node-badge">${window.I18n?.t('workflow.useOutputFromNode') || 'Sử dụng output từ node đã chọn'}</span></div>
            </div>
          </div>
          <div class="frame-slot" id="nodeFrame2Slot">
            <div class="frame-slot-header">
              <svg class="frame-slot-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H2.6C2.03995 3.5 1.75992 3.5 1.54601 3.60899C1.35785 3.70487 1.20487 3.85785 1.10899 4.04601C1 4.25992 1 4.53995 1 5.1V6.9C1 7.46005 1 7.74008 1.10899 7.95399C1.20487 8.14215 1.35785 8.29513 1.54601 8.39101C1.75992 8.5 2.03995 8.5 2.6 8.5H6.5M8.5 3.5H9.4C9.96005 3.5 10.2401 3.5 10.454 3.60899C10.6422 3.70487 10.7951 3.85785 10.891 4.04601C11 4.25992 11 4.53995 11 5.1V6.9C11 7.46005 11 7.74008 10.891 7.95399C10.7951 8.14215 10.6422 8.29513 10.454 8.39101C10.2401 8.5 9.96005 8.5 9.4 8.5H8.5M8.5 10.5L8.5 1.5M9.75 1.5L7.25 1.5M9.75 10.5L7.25 10.5"/></svg>
              <span class="frame-slot-label">${window.I18n?.t('gen.frameEnd') || 'End'}</span>
            </div>
            <div class="frame-slot-body">
              <select id="frame2Source" class="frame-source-select">
                <option value="">-- ${window.I18n?.t('workflow.selectSource') || 'Chọn nguồn'} --</option><option value="manual">${window.I18n?.t('workflow.selectManual') || 'Chọn ảnh thủ công'}</option>${nodeOptions}
              </select>
              <div class="frame-manual hidden" id="frame2Manual">
                <div class="frame-slot-body-inner" id="frame2Body">
                  <div class="frame-dropzone" id="frame2PickBtn">
                    <svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                    <span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span>
                  </div>
                </div>
                <input type="hidden" id="frame2FileId" value="${this.escapeAttr(data.frame_2_file_id || '')}" />
              </div>
              <div class="frame-node-info hidden" id="frame2NodeInfo"><span class="frame-node-badge">${window.I18n?.t('workflow.useOutputFromNode') || 'Sử dụng output từ node đã chọn'}</span></div>
            </div>
          </div>
        </div>
      </div>
      ${enabledField}
      <div class="form-group">
        <div class="auto-download-row">
          <label class="toolbar-toggle${!window.featureGate?.canUse('auto_download') ? ' feature-disabled' : ''}" for="nodeAutoDownload" ${!window.featureGate?.canUse('auto_download') ? `title="${window.I18n?.t('workflow.featureDisabled') || 'Tính năng này yêu cầu gói Premium'}"` : ''}>
            <input type="checkbox" id="nodeAutoDownload" ${data.auto_download ? 'checked' : ''} ${!window.featureGate?.canUse('auto_download') ? 'disabled' : ''} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span class="toggle-label">${window.I18n?.t('workflow.autoDownload') || 'Tự động tải'}</span>
          </label>
          ${!window.featureGate?.canUse('auto_download') ? window.featureGate.renderCrownSpan('auto_download') : ''}
          <span class="dl-res-select-wrap${!data.auto_download || data.media_type === 'Video' ? ' hidden' : ''}" id="nodeDownloadResWrap">
            <svg class="dl-res-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <select id="nodeDownloadResolution" class="pill-select pill-select-sm" title="${window.I18n?.t('workflow.downloadResolution') || 'Chất lượng ảnh'}">
              ${(window.ProviderConfigManager?.getDownloadResolutionsSync('flow', 'image') || [
                { value: '1k', label: '1K' },
                { value: '2k', label: '2K (Pro)' },
                { value: '4k', label: '4K (Ultra)' },
              ]).map(r => `<option value="${r.value}"${data.download_resolution === r.value ? ' selected' : ''}>${r.label || r.menu_label || r.value}</option>`).join('')}
            </select>
          </span>
          <span class="dl-res-select-wrap${!data.auto_download || data.media_type !== 'Video' ? ' hidden' : ''}" id="nodeVideoDownloadResWrap">
            <svg class="dl-res-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            <select id="nodeVideoDownloadResolution" class="pill-select pill-select-sm" title="${window.I18n?.t('workflow.videoDownloadResolution') || 'Chất lượng video'}">
              ${(window.ProviderConfigManager?.getDownloadResolutionsSync('flow', 'video') || [
                { value: '720p', label: '720p' },
                { value: '1080p', label: '1080p' },
                { value: '4k', label: '4K (Ultra)' },
              ]).map(r => `<option value="${r.value}"${data.video_download_resolution === r.value ? ' selected' : ''}>${r.label || r.menu_label || r.value}</option>`).join('')}
            </select>
          </span>
        </div>
      </div>
      ${this.isTemplateMode ? this._renderResultImageFieldForTemplate(data, 'generateResultPreview', 'generateResultImgUrl', 'generateResultPickBtn') : ''}`;
  },

  _bindNodeFormEvents(nodeType, data, nodeId) {
    // 2026-06-03 (Option A): Auto-save form values vào drawflow + DB mỗi 800ms khi user gõ.
    // Tránh user edit prompt → click Run mà chưa click "Lưu Node" → run dùng prompt cũ.
    // Debounce 800ms để tránh API spam khi user gõ liên tục.
    // Scope: chỉ prompt textareas (nơi user edit content chính). Form fields khác (model,
    // ratio, ...) vẫn cần explicit Save vì side effects (vd model change → port resize).
    const promptTextareas = this.overlay?.querySelectorAll(
      '#promptNodeText, #nodePrompt, #chatgptNodePrompt, #grokNodePrompt, #textNodeContent'
    );
    if (promptTextareas?.length) {
      // BUG FIX 2026-06-05 (Option 3 hybrid): Debounce 800ms → 2500ms + save on blur
      // + guard pile-up. Trước: 800ms gõ chậm pause → mỗi pause trigger save → 11 saves/đoạn
      // text. Sau: 2500ms tránh save khi gõ liên tục + blur cover trường hợp user rời textarea
      // trước 2500ms + _formAutoSaving guard tránh save chồng chéo khi save trước chưa xong.
      const triggerAutoSave = async () => {
        if (this._formAutoSaving) return; // skip nếu save đang chạy
        this._formAutoSaving = true;
        try {
          await this._persistOpenNodeFormIfDirty();
        } catch (err) {
          console.warn('[WorkflowEditor] Auto-save form failed:', err?.message);
        } finally {
          this._formAutoSaving = false;
        }
      };
      promptTextareas.forEach(ta => {
        // Init count badge ngay khi bind (đề phòng render chưa set).
        this._updatePromptCharCount(ta);
        ta.addEventListener('input', () => {
          this._updatePromptCharCount(ta); // live count/limit khi gõ
          if (this._formAutoSaveTimer) clearTimeout(this._formAutoSaveTimer);
          this._formAutoSaveTimer = setTimeout(triggerAutoSave, 2500);
        });
        // Save on blur — user rời textarea → save ngay (cancel pending debounce).
        // Defense: skip nếu textarea đã removed khỏi DOM (form switch race) hoặc form clean
        // (user click vào rồi click ra mà không gõ → tránh save wasted).
        ta.addEventListener('blur', () => {
          if (this._formAutoSaveTimer) {
            clearTimeout(this._formAutoSaveTimer);
            this._formAutoSaveTimer = null;
          }
          if (!ta.isConnected) return; // form đã rebuild/đóng → skip
          if (typeof this._isFormDirty === 'function' && !this._isFormDirty()) return; // form clean → skip
          triggerAutoSave();
        });
      });
    }

    // Text Extract Node (2026-05-29): toggle marker vs regex input group khi mode đổi.
    if (nodeType === 'text_extract') {
      const modeSelect = this.overlay?.querySelector('#nodeExtractMode');
      const markerGroup = this.overlay?.querySelector('#nodeExtractMarkerGroup');
      const regexGroup = this.overlay?.querySelector('#nodeExtractRegexGroup');
      if (modeSelect && markerGroup && regexGroup) {
        modeSelect.addEventListener('change', () => {
          const isRegex = modeSelect.value === 'regex';
          regexGroup.classList.toggle('hidden', !isRegex);
          markerGroup.classList.toggle('hidden', isRegex);
        });
      }
    }

    // Phase 3: Prompt Sequence — toggle nhóm "Dấu ngăn" chỉ khi mode = separator.
    if (nodeType === 'prompt_sequence') {
      const psMode = this.overlay?.querySelector('#nodePsMode');
      const sepGroup = this.overlay?.querySelector('#nodePsSeparatorGroup');
      if (psMode && sepGroup) {
        psMode.addEventListener('change', () => {
          sepGroup.style.display = psMode.value === 'separator' ? '' : 'none';
        });
      }
    }

    // Fix audit #1: Condition — toggle ô "Giá trị" chỉ khi op = contains/regex (trước: field ẩn
    // vĩnh viễn với op mặc định has_text → user chọn contains/regex mà không nhập được → luôn FALSE).
    if (nodeType === 'condition') {
      const condOp = this.overlay?.querySelector('#nodeConditionOp');
      const condValGroup = this.overlay?.querySelector('#nodeConditionValueGroup');
      if (condOp && condValGroup) {
        condOp.addEventListener('change', () => {
          const needsVal = condOp.value === 'contains' || condOp.value === 'regex';
          condValGroup.style.display = needsVal ? '' : 'none';
        });
      }
    }

    // 2026-06-25 UI: switch Tên ↔ Slug sub-tabs (node-nameslug-group, gọn sidebar).
    const nsTabs = this.overlay?.querySelector('#nodeNameSlugTabs');
    if (nsTabs) {
      const nsGroup = nsTabs.closest('.node-nameslug-group');
      nsTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.node-form-tab[data-nstab]');
        if (!tab || !nsGroup) return;
        const key = tab.dataset.nstab;
        nsTabs.querySelectorAll('.node-form-tab').forEach(t => t.classList.toggle('active', t === tab));
        nsGroup.querySelectorAll('.node-nameslug-pane').forEach(p =>
          p.classList.toggle('active', p.dataset.nspane === key));
      });
    }

    // Phase 1 — Node Reference System: Slug inline edit handlers
    const slugInlineDisplay = this.overlay?.querySelector('#slugInlineDisplay');
    const slugInlineEdit = this.overlay?.querySelector('#slugInlineEdit');
    const slugInput = this.overlay?.querySelector('#nodeSlug');
    const slugConfirmBtn = this.overlay?.querySelector('#slugConfirmBtn');
    const slugAutoInput = this.overlay?.querySelector('#nodeSlugAuto');
    const slugError = this.overlay?.querySelector('#slugError');

    if (slugInlineDisplay && slugInlineEdit && slugInput) {
      const showEditMode = () => {
        if (this.isReadOnly()) return;
        slugInlineDisplay.classList.add('hidden');
        slugInlineEdit.classList.remove('hidden');
        slugInput.focus();
        slugInput.select();
      };

      const hideEditMode = () => {
        slugInlineEdit.classList.add('hidden');
        slugInlineDisplay.classList.remove('hidden');
      };

      const confirmSlug = () => {
        const newSlug = (slugInput.value || '').trim().toLowerCase();
        const placeholder = slugInput.placeholder || '';
        const displayValue = newSlug || placeholder;

        if (newSlug) {
          const validation = this._validateSlug(newSlug, nodeId);
          if (!validation.valid) {
            if (slugError) {
              slugError.textContent = validation.error;
              slugError.classList.remove('hidden');
            }
            slugInput.focus();
            return;
          }
        }

        if (slugError) slugError.classList.add('hidden');
        const slugValueEl = slugInlineDisplay.querySelector('.slug-value');
        if (slugValueEl) slugValueEl.textContent = displayValue;
        const isManual = !!newSlug && newSlug !== placeholder;
        slugInlineDisplay.classList.toggle('slug-auto', !isManual);
        slugInlineDisplay.classList.toggle('slug-manual', isManual);
        if (slugAutoInput) slugAutoInput.value = isManual ? 'false' : 'true';
        hideEditMode();
        this._hasUnsavedChanges = true;
      };

      slugInlineDisplay.addEventListener('click', showEditMode);
      slugConfirmBtn?.addEventListener('click', confirmSlug);
      slugInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmSlug();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (slugError) slugError.classList.add('hidden');
          hideEditMode();
        }
      });
      slugInput.addEventListener('input', () => {
        const val = slugInput.value || '';
        // 2026-05-28: strip leading digit/underscore live — regex backend yêu cầu bắt đầu bằng [a-z].
        // Trước: chỉ filter non-alphanum → user nhập "1abc" → input giữ "1abc" → confirmSlug
        // validate reject NHƯNG user khó hiểu. Live filter prevent state invalid ngay từ keystroke.
        slugInput.value = val.toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^[0-9_]+/, '');
      });
    }

    // Provider login reminder button (ChatGPT/Grok nodes)
    const providerReminderBtn = this.overlay?.querySelector('.provider-reminder-btn[data-action="openProvider"]');
    if (providerReminderBtn) {
      providerReminderBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Skip if already ready
        if (providerReminderBtn.classList.contains('ready')) return;
        const provider = providerReminderBtn.dataset.provider;
        chrome.runtime.sendMessage({ action: 'openProviderTab', provider, focusWindow: false }, (resp) => {
          if (resp?.ok) {
            console.log(`[WorkflowEditor] Opened/activated ${provider} tab:`, resp.tabId, resp.existing ? '(existing)' : '(new)');
            // Poll status until ready or max attempts reached (30s)
            this._pollProviderStatus(provider, 15, 2000);
          }
        });
      });
    }

    // Download node: chỉ bind upgrade link
    if (nodeType === 'download') {
      const upgradeLink = this.overlay?.querySelector('.node-download-upgrade-link');
      if (upgradeLink) {
        upgradeLink.addEventListener('click', (e) => {
          e.preventDefault();
          this._openUpgradeModal();
        });
      }
      return;
    }
    if (nodeType === 'telegram') {
      // Bind upgrade link
      const telegramUpgradeLink = this.overlay?.querySelector('.node-telegram-upgrade-link');
      if (telegramUpgradeLink) {
        telegramUpgradeLink.addEventListener('click', (e) => {
          e.preventDefault();
          this._openUpgradeModal();
        });
      }
      // Auto-fill telegram chat_id from TelegramLink
      const linkStatusEl = this.overlay?.querySelector('#telegramLinkStatus');
      const chatIdInput = this.overlay?.querySelector('#telegramChatId');
      if (linkStatusEl && window.authManager?.isLoggedIn()) {
        window.authManager._apiCall('GET', 'telegram/link/status').then(resp => {
          const respData = resp?.data || resp;
          if (respData?.linked && respData?.telegram_chat_id) {
            if (linkStatusEl) {
              linkStatusEl.textContent = `${window.I18n?.t('workflow.telegramLinked') || 'Linked'}: @${respData.telegram_username || respData.telegram_chat_id}`;
              linkStatusEl.style.color = '#19d07b';
            }
            if (chatIdInput && !chatIdInput.value) {
              chatIdInput.value = respData.telegram_chat_id;
            }
          } else {
            if (linkStatusEl) {
              linkStatusEl.innerHTML = `${window.I18n?.t('workflow.telegramNotLinked') || 'Chưa liên kết Telegram'}. <a href="#" style="color: var(--primary);">${window.I18n?.t('workflow.openSettings') || 'Mở Settings'}</a>`;
              linkStatusEl.style.color = '#f59e0b';
            }
            const settingsLink = linkStatusEl?.querySelector('a');
            if (settingsLink) {
              settingsLink.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.runtime.sendMessage({ action: 'openSettings' });
              });
            }
          }
        }).catch(() => {
          if (linkStatusEl) {
            linkStatusEl.textContent = window.I18n?.t('workflow.telegramCheckFailed') || 'Không thể kiểm tra liên kết';
            linkStatusEl.style.color = 'var(--muted-foreground)';
          }
        });
      } else if (linkStatusEl) {
        linkStatusEl.textContent = window.I18n?.t('workflow.telegramLoginToLink') || 'Login to link Telegram';
        linkStatusEl.style.color = 'var(--muted-foreground)';
      }
      return;
    }
    // Note: palette 9 màu (parity web NoteForm) — click swatch set hidden #nodeNoteColor + active state.
    if (nodeType === 'note') {
      const swatchWrap = this.overlay?.querySelector('#nodeNoteSwatches');
      const colorInput = this.overlay?.querySelector('#nodeNoteColor');
      if (swatchWrap && colorInput) {
        swatchWrap.querySelectorAll('.wf-note-swatch').forEach(btn => {
          btn.addEventListener('click', () => {
            const c = btn.dataset.color;
            if (!c) return;
            colorInput.value = c;
            swatchWrap.querySelectorAll('.wf-note-swatch').forEach(b => b.classList.toggle('active', b === btn));
          });
        });
      }
    }
    if (nodeType === 'note' || nodeType === 'delay') return;

    // === PHASE 2 — MENTION AUTOCOMPLETE (moved here to run before type-specific early returns) ===
    if (this._canUseMentions(nodeType)) {
      const promptTextareaId = nodeType === 'chatgpt' ? '#chatgptNodePrompt'
        : nodeType === 'grok' ? '#grokNodePrompt'
        : nodeType === 'prompt' ? '#promptNodeText'
        : '#nodePrompt';
      const promptTextarea = this.overlay?.querySelector(promptTextareaId);
      if (promptTextarea) {
        this._bindMentionAutocomplete(promptTextarea, nodeId);
      }
    }

    // === PROMPT SOURCE TOGGLE (Phase CG-8) — generate / chatgpt / grok ===
    if (['generate', 'chatgpt', 'grok'].includes(nodeType)) {
      const toggle = this.overlay?.querySelector('#promptSourceToggle');
      if (toggle) {
        // Ẩn cả form-group prompt (label + textarea) khi dùng upstream_node
        const promptGroupId =
          (nodeType === 'chatgpt') ? '#chatgptNodePromptGroup'
          : nodeType === 'generate' ? '#nodePromptGroup'
          : nodeType === 'grok' ? '#grokNodePromptGroup'
          : null;
        const promptGroup = promptGroupId ? this.overlay?.querySelector(promptGroupId) : null;

        const updateState = () => {
          const useOwnPrompt = toggle.checked;
          if (promptGroup) {
            promptGroup.classList.toggle('hidden', !useOwnPrompt);
          }
          // Update inline indicator visibility
          try { this._refreshAllPromptSourceBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateState', e); }
        };
        toggle.addEventListener('change', () => {
          updateState();
          // Bug fix 2026-06-22: persist prompt_source NGAY khi toggle (không đợi full form-save).
          // Trước: toggle chỉ show/hide ô prompt → data.prompt_source giữ null (node MCP / chưa save)
          // → runtime auto-detect flip 'upstream_node' dù user bật "use own prompt".
          try {
            const editor = this.diagramCanvas?.editor;
            const nid = this.selectedNodeId;
            if (editor && nid != null) {
              const cur = editor.getNodeFromId(nid)?.data || {};
              editor.updateNodeDataFromId(nid, { ...cur, prompt_source: toggle.checked ? 'textbox' : 'upstream_node' });
            }
          } catch (e) { /* ignore */ }
        });
        updateState();
      }
    }

    // === AI AGENT NODE (Phase CG-8 + AI Agent rename 2026-05-30) ===
    if (nodeType === 'prompt') {
      // Toggle Use AI ON/OFF → show/hide provider+timeout sections
      const enhanceToggle = this.overlay?.querySelector('#promptNodeUseAi');
      const providerSections = this.overlay?.querySelectorAll('.prompt-node-provider-section');
      // Provider status button for Prompt node
      const providerSelect = this.overlay?.querySelector('#promptNodeProvider');
      const providerStatusBtn = this.overlay?.querySelector('#promptProviderStatusBtn');

      const applyEnhanceVisibility = () => {
        const isOn = !!enhanceToggle?.checked;
        if (providerSections) {
          providerSections.forEach((sec) => {
            sec.classList.toggle('hidden', !isOn);
          });
        }
        // Update provider status when enhance is toggled ON
        if (isOn && providerSelect) {
          this._updateProviderStatusIndicator(providerSelect.value || 'chatgpt');
        }
      };
      enhanceToggle?.addEventListener('change', applyEnhanceVisibility);

      const updatePromptProviderButton = () => {
        if (!providerStatusBtn || !providerSelect) return;
        const prov = providerSelect.value || 'chatgpt';
        const provLabel = window.ProviderMeta?.getName?.(prov) || (prov === 'chatgpt' ? 'ChatGPT' : 'Gemini');
        const openText = window.I18n?.t('workflow.openProvider') || 'Open';
        const readyText = window.I18n?.t('workflow.providerReady') || 'Ready';
        providerStatusBtn.dataset.provider = prov;
        const textEl = providerStatusBtn.querySelector('.provider-btn-text');
        if (textEl) {
          textEl.dataset.notReadyText = `${openText} ${provLabel}`;
          textEl.dataset.readyText = readyText;
        }
        // Check status for the new provider
        this._updateProviderStatusIndicator(prov);
      };

      providerSelect?.addEventListener('change', updatePromptProviderButton);

      // Click handler for provider status button
      providerStatusBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (providerStatusBtn.classList.contains('ready')) return;
        const prov = providerStatusBtn.dataset.provider || 'chatgpt';
        chrome.runtime.sendMessage({ action: 'openProviderTab', provider: prov, focusWindow: false }, (resp) => {
          if (resp?.ok) {
            console.log(`[WorkflowEditor] Opened/activated ${prov} tab for Prompt node:`, resp.tabId);
            this._pollProviderStatus(prov, 15, 2000);
          }
        });
      });

      // Initial provider status check if enhance is ON
      if (enhanceToggle?.checked) {
        const initialProv = providerSelect?.value || 'chatgpt';
        this._updateProviderStatusIndicator(initialProv);
      }

      // Phase CG-8 ext: Ref images picker cho Prompt node (max 4, chỉ enhance=ON)
      // EWT-9.1: Kiểm tra template mode để bind events phù hợp
      if (this.isTemplateMode) {
        // Template mode: bind WorkflowMediaModal
        this._bindTemplateRefImagesEvents('promptNodePickBtn', 'promptNodeRefImgUrls', 'promptNodeRefPreview', 4);
      } else {
        // Normal mode: bind imagePickerModal
        const promptPickBtn = this.overlay?.querySelector('#promptNodePickBtn');
        promptPickBtn?.addEventListener('click', () => {
          const fileIdInput = this.overlay?.querySelector('#promptNodeRefFileIds');
          const existingIds = (fileIdInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
          if (!this._ensureImagePickerReady()) return;
          window.imagePickerModal.open({
            existingFileIds: existingIds,
            mediaFilter: 'image',
            // Prompt node là pass-through ref images cho downstream — giới hạn tổng quát 4
            maxSelections: 4,
            onConfirm: async (images) => {
              const flowImages = images.filter(img => img.source === 'flow' || img.source === 'existing');
              const uploadImages = images.filter(img => img.source === 'upload' && img.file);
              const newIds = flowImages.map(img => img.fileId).filter(Boolean);
              for (const img of flowImages) {
                if (img.fileId && img.thumbnail) {
                  this._tileCacheSet(img.fileId, { thumbnail: img.thumbnail, file_name: img.file_name || '', type: img.type || 'image' });
                }
              }
              const albumImages = images.filter(img => img.source === 'album');
              for (const img of albumImages) {
                try {
                  const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
                  if (!prepared) continue;
                  const key = prepared.key;
                  this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: prepared.file_name || '', type: 'image' });
                  newIds.push(key);
                  if (key.startsWith('upload_')) {
                    const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                    if (pendingFile && window.ImmediateUploader) {
                      ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Prompt'));
                    }
                    this._formUploadKeys?.add(key);
                  }
                } catch (err) {
                  console.error('[WorkflowEditor] Lỗi chuẩn bị ảnh album (prompt):', err);
                }
              }
              if (uploadImages.length > 0) {
                if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
                for (const img of uploadImages) {
                  const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                  window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
                  this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: '', type: 'image' });
                  if (window.ImmediateUploader) {
                    ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Prompt image'));
                  } else if (window.PendingUploadStore) {
                    PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
                  }
                  newIds.push(key);
                  this._formUploadKeys?.add(key);
                }
              }
              const mergedIds = [...new Set([...existingIds, ...newIds])].slice(0, 4);
              const fileIdsInput = this.overlay?.querySelector('#promptNodeRefFileIds');
              if (fileIdsInput) fileIdsInput.value = mergedIds.join(', ');
              this._renderNodeRefPreview(fileIdsInput?.value || '', '#promptNodeRefPreview');
              this._updateFormButtonState();
            }
          });
        });
        // Render existing ref previews (normal mode)
        if (data.ref_file_ids) {
          this._renderNodeRefPreview(data.ref_file_ids, { containerSelector: '#promptNodeRefPreview', refFileNames: data.ref_file_names });
        }
      }
      return;
    }


    // T-1.6: Auto-download toggle → show/hide resolution select based on media type
    const nodeAutoDownload = this.overlay?.querySelector('#nodeAutoDownload');
    const nodeDownloadResWrap = this.overlay?.querySelector('#nodeDownloadResWrap');
    const nodeVideoDownloadResWrap = this.overlay?.querySelector('#nodeVideoDownloadResWrap');
    const nodeMediaType = this.overlay?.querySelector('#nodeMediaType');
    const updateNodeDownloadResolutionVisibility = () => {
      const isAutoDownload = nodeAutoDownload?.checked;
      const isVideo = nodeMediaType?.value === 'Video';
      if (nodeDownloadResWrap) {
        nodeDownloadResWrap.classList.toggle('hidden', !isAutoDownload || isVideo);
      }
      if (nodeVideoDownloadResWrap) {
        nodeVideoDownloadResWrap.classList.toggle('hidden', !isAutoDownload || !isVideo);
      }
    };
    nodeAutoDownload?.addEventListener('change', updateNodeDownloadResolutionVisibility);
    nodeMediaType?.addEventListener('change', updateNodeDownloadResolutionVisibility);
    if (nodeType === 'chatgpt') {
      // Bind upgrade link (gate banner khi chatgpt_enabled=false)
      const cgUpgradeLink = this.overlay?.querySelector('.node-chatgpt-upgrade-link');
      if (cgUpgradeLink) {
        cgUpgradeLink.addEventListener('click', (e) => {
          e.preventDefault();
          this._openUpgradeModal();
        });
      }
      // Bind ratio pills (story/portrait/square/landscape/widescreen)
      const cgRatioPillsContainer = this.overlay?.querySelector('#chatgptImageRatioPills');
      const cgRatioInput = this.overlay?.querySelector('#chatgptImageRatio');
      if (cgRatioPillsContainer && cgRatioInput) {
        cgRatioPillsContainer.querySelectorAll('.chatgpt-ratio-pill').forEach(pill => {
          pill.addEventListener('click', (e) => {
            e.preventDefault();
            const val = pill.dataset.ratio;
            if (!val) return;
            cgRatioInput.value = val;
            cgRatioPillsContainer.querySelectorAll('.chatgpt-ratio-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
          });
        });
      }
      // Bind image picker (max 4 ref images)
      // EWT-9.1: Kiểm tra template mode để bind events phù hợp
      if (this.isTemplateMode) {
        // Template mode: bind WorkflowMediaModal
        this._bindTemplateRefImagesEvents('chatgptImageNodePickBtn', 'chatgptImageRefImgUrls', 'chatgptImageRefPreview', 4);
        // EWT-12: Bind result image events cho template mode (with ratio selector for ChatGPT pills)
        this._bindTemplateResultImageEvents('chatgptResultPickBtn', 'chatgptResultImgUrl', 'chatgptResultPreview', '#chatgptImageRatioPills');
      } else {
        // Normal mode: bind imagePickerModal
        const cgPickBtn = this.overlay?.querySelector('#chatgptImageNodePickBtn');
        cgPickBtn?.addEventListener('click', () => {
          const fileIdInput = this.overlay?.querySelector('#chatgptImageRefFileIds');
          const existingIds = (fileIdInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
          if (this._ensureImagePickerReady()) {
            window.imagePickerModal.open({
              existingFileIds: existingIds,
              mediaFilter: 'image',
              maxSelections: ImagePickerModal.resolveMaxSelections({ provider: 'chatgpt', mode: 'image' }) || 4,
              onConfirm: async (images) => {
                const flowImages = images.filter(img => img.source === 'flow' || img.source === 'existing');
                const uploadImages = images.filter(img => img.source === 'upload' && img.file);
                const newIds = flowImages.map(img => img.fileId).filter(Boolean);
                // Cache thumbnail cho Flow images
                for (const img of flowImages) {
                  if (img.fileId && img.thumbnail) {
                    this._tileCacheSet(img.fileId, { thumbnail: img.thumbnail, file_name: img.file_name || '', type: img.type || 'image' });
                  }
                }
                // Xử lý ảnh album (ALIVE/STALE)
                const albumImages = images.filter(img => img.source === 'album');
                for (const img of albumImages) {
                  try {
                    const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
                    if (!prepared) continue;
                    const key = prepared.key;
                    this._tileCacheSet(key, {
                      thumbnail: img.thumbnail,
                      file_name: prepared.file_name || '',
                      type: 'image'
                    });
                    newIds.push(key);
                    if (key.startsWith('upload_')) {
                      const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                      if (pendingFile && window.ImmediateUploader) {
                        ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'ChatGPT'));
                      }
                      this._formUploadKeys?.add(key);
                    }
                  } catch (err) {
                    console.error('[WorkflowEditor] Lỗi chuẩn bị ảnh album (chatgpt):', err);
                  }
                }
                if (uploadImages.length > 0) {
                  if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
                  for (const img of uploadImages) {
                    const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
                    this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: '', type: 'image' });
                    if (window.ImmediateUploader) {
                      ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'ChatGPT image'));
                    } else if (window.PendingUploadStore) {
                      PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
                    }
                    newIds.push(key);
                    this._formUploadKeys?.add(key);
                  }
                }
                // Cap theo max_ref_images (admin api_config) thay vì hardcode 4. Giữ ref MỚI NHẤT
                // (slice từ cuối) → ảnh user vừa thêm được dùng, không bị kẹt ref cũ.
                const cgRefLimit = this._getNodeRefLimit('#chatgptImageRefPreview') || 4;
                const cgMerged = [...new Set([...existingIds, ...newIds])];
                const mergedIds = cgMerged.length > cgRefLimit ? cgMerged.slice(-cgRefLimit) : cgMerged;
                if (cgMerged.length > cgRefLimit) {
                  console.log(`[WorkflowEditor] ChatGPT ref vượt giới hạn (${cgMerged.length}/${cgRefLimit}), giữ ${cgRefLimit} ảnh mới nhất`);
                }
                const fileIdsInput = this.overlay?.querySelector('#chatgptImageRefFileIds');
                if (fileIdsInput) fileIdsInput.value = mergedIds.join(', ');
                this._renderNodeRefPreview(fileIdsInput?.value || '', '#chatgptImageRefPreview');
                this._updateFormButtonState();
              }
            });
          }
        });
        // Render existing ref previews (normal mode)
        if (data.ref_file_ids) this._renderNodeRefPreview(data.ref_file_ids, { containerSelector: '#chatgptImageRefPreview', refFileNames: data.ref_file_names });
      }
      return;
    }
    if (nodeType === 'grok') {
      // Phase G-6: Bind upgrade link
      const grokUpgradeLink = this.overlay?.querySelector('.node-grok-upgrade-link');
      if (grokUpgradeLink) {
        grokUpgradeLink.addEventListener('click', (e) => {
          e.preventDefault();
          this._openUpgradeModal();
        });
      }
      // Mode toggle (icon button — mirror gen-type-toggle pattern) → show/hide video-only / image-only fields
      const grokModeInput = this.overlay?.querySelector('#grokNodeMode');
      const grokModeToggle = this.overlay?.querySelector('#grokNodeModeToggle');
      const grokVideoOnlyRow = this.overlay?.querySelector('#grokVideoOnlyRow');
      const grokImageOnlyRow = this.overlay?.querySelector('#grokImageOnlyRow');
      const updateGrokModeVisibility = () => {
        const isVideo = grokModeInput?.value === 'video';
        if (grokVideoOnlyRow) grokVideoOnlyRow.style.display = isVideo ? '' : 'none';
        // Image quality (Speed/Quality) chỉ áp dụng khi mode=image
        if (grokImageOnlyRow) grokImageOnlyRow.style.display = isVideo ? 'none' : '';
      };
      if (grokModeToggle && grokModeInput) {
        grokModeToggle.querySelectorAll('.node-form-mode-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = btn.dataset.mode;
            if (!mode || grokModeInput.value === mode) return;
            grokModeInput.value = mode;
            grokModeToggle.querySelectorAll('.node-form-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateGrokModeVisibility();
            // Post-audit fix: re-render ref preview để update ref-thumb-exceeded grayscale
            // theo grok_mode mới (Grok video có thể có limit khác image).
            try {
              const grokRefInput = this.overlay?.querySelector('#grokNodeRefFileIds');
              if (grokRefInput?.value) {
                this._renderNodeRefPreview(grokRefInput.value, '#grokNodeRefPreview');
              }
            } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateGrokModeVisibility', _); }

            // Bug 44 fix (2026-05-13): Persist grok_mode vào node.data ngay khi đổi —
            // tránh data stale → output port type='image' nhưng UI hiển thị Video mode →
            // user kéo edge video→image input ko bị reject.
            try {
              const drawflowId = this.selectedNodeId;
              const editor = this.diagramCanvas?.editor;
              if (drawflowId && editor && window.NodeTemplates?.getNodePorts) {
                const node = editor.getNodeFromId(drawflowId);
                if (node) {
                  const updated = { ...(node.data || {}), grok_mode: mode };
                  const nodeType = updated.node_type || node.class || 'grok';
                  const newPorts = window.NodeTemplates.getNodePorts(nodeType, updated);
                  const portMap = {};
                  (newPorts.in || []).forEach((p, idx) => { portMap[`input_${idx + 1}`] = p.name; });
                  (newPorts.out || []).forEach((p, idx) => { portMap[`output_${idx + 1}`] = p.name; });
                  updated._port_map = portMap;
                  editor.updateNodeDataFromId(drawflowId, updated);
                  if (this.diagramCanvas?._resizeNodePorts) {
                    this.diagramCanvas._resizeNodePorts(drawflowId, newPorts);
                  }
                  if (this.diagramCanvas?._injectPortAttributes) {
                    requestAnimationFrame(() => this.diagramCanvas._injectPortAttributes(drawflowId, newPorts));
                  }
                  const removedCount = this._revalidateNodeEdges(drawflowId);
                  if (removedCount > 0) {
                    const msg = window.I18n?.t('workflow.edgesRemovedOnTypeChange', { count: removedCount })
                      || `Đã gỡ ${removedCount} kết nối không tương thích sau khi đổi grok mode`;
                    if (typeof window.showNotification === 'function') {
                      window.showNotification(msg, 'warning', 2500);
                    }
                    try { this.diagramCanvas?._recolorAllEdges?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateGrokModeVisibility', e); }
                  }
                }
              }
            } catch (e) {
              console.warn('[WorkflowEditor] Sync grok_mode to node data failed:', e?.message);
            }
          });
        });
      }
      updateGrokModeVisibility();

      // Ratio pills (story/portrait/square/landscape/widescreen)
      const grokRatioPillsContainer = this.overlay?.querySelector('#grokRatioPills');
      const grokRatioInput = this.overlay?.querySelector('#grokNodeRatio');
      if (grokRatioPillsContainer && grokRatioInput) {
        grokRatioPillsContainer.querySelectorAll('.grok-ratio-pill').forEach(pill => {
          pill.addEventListener('click', (e) => {
            e.preventDefault();
            const val = pill.dataset.ratio;
            if (!val) return;
            grokRatioInput.value = val;
            grokRatioPillsContainer.querySelectorAll('.grok-ratio-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
          });
        });
      }

      // Image picker (max 4 ref images) — mirror chatgpt pattern
      // EWT-9.1: Kiểm tra template mode để bind events phù hợp
      if (this.isTemplateMode) {
        // Template mode: bind WorkflowMediaModal
        this._bindTemplateRefImagesEvents('grokNodePickBtn', 'grokNodeRefImgUrls', 'grokNodeRefPreview', 4);
        // EWT-12: Bind result image events cho template mode (with ratio selector for Grok pills)
        this._bindTemplateResultImageEvents('grokNodeResultPickBtn', 'grokNodeResultImgUrl', 'grokNodeResultPreview', '#grokRatioPills');
      } else {
        // Normal mode: bind imagePickerModal
        const grokPickBtn = this.overlay?.querySelector('#grokNodePickBtn');
        grokPickBtn?.addEventListener('click', () => {
          const fileIdInput = this.overlay?.querySelector('#grokNodeRefFileIds');
          const existingIds = (fileIdInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
          if (this._ensureImagePickerReady()) {
            const grokMode = (data?.grok_mode || data?.mode || 'image').toLowerCase();
            window.imagePickerModal.open({
              existingFileIds: existingIds,
              mediaFilter: 'image',
              maxSelections: ImagePickerModal.resolveMaxSelections({ provider: 'grok', mode: grokMode }) || 4,
              onConfirm: async (images) => {
                const flowImages = images.filter(img => img.source === 'flow' || img.source === 'existing');
                const uploadImages = images.filter(img => img.source === 'upload' && img.file);
                const newIds = flowImages.map(img => img.fileId).filter(Boolean);
                for (const img of flowImages) {
                  if (img.fileId && img.thumbnail) {
                    this._tileCacheSet(img.fileId, { thumbnail: img.thumbnail, file_name: img.file_name || '', type: img.type || 'image' });
                  }
                }
                const albumImages = images.filter(img => img.source === 'album');
                for (const img of albumImages) {
                  try {
                    const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
                    if (!prepared) continue;
                    const key = prepared.key;
                    this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: prepared.file_name || '', type: 'image' });
                    newIds.push(key);
                    if (key.startsWith('upload_')) {
                      const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                      if (pendingFile && window.ImmediateUploader) {
                        ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Grok'));
                      }
                      this._formUploadKeys?.add(key);
                    }
                  } catch (err) {
                    console.error('[WorkflowEditor] Lỗi chuẩn bị ảnh album (grok):', err);
                  }
                }
                if (uploadImages.length > 0) {
                  if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
                  for (const img of uploadImages) {
                    const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
                    this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: '', type: 'image' });
                    if (window.ImmediateUploader) {
                      ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Grok image'));
                    } else if (window.PendingUploadStore) {
                      PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
                    }
                    newIds.push(key);
                    this._formUploadKeys?.add(key);
                  }
                }
                const mergedIds = [...new Set([...existingIds, ...newIds])].slice(0, 4);
                const fileIdsInput = this.overlay?.querySelector('#grokNodeRefFileIds');
                if (fileIdsInput) fileIdsInput.value = mergedIds.join(', ');
                this._renderNodeRefPreview(fileIdsInput?.value || '', '#grokNodeRefPreview');
                this._updateFormButtonState();
              }
            });
          }
        });
        // Render existing ref previews (normal mode)
        if (data.ref_file_ids) this._renderNodeRefPreview(data.ref_file_ids, { containerSelector: '#grokNodeRefPreview', refFileNames: data.ref_file_names });
      }
      return;
    }
    if (nodeType === 'image') {
      // EWT-9.1: Kiểm tra template mode để bind events phù hợp
      if (this.isTemplateMode) {
        // Template mode: bind WorkflowMediaModal
        this._bindTemplateRefImagesEvents('imageNodePickBtn', 'imageNodeRefImgUrls', 'imageNodeRefPreview', 10);
      } else {
        // Normal mode: bind imagePickerModal
        // Render existing ref previews
        if (data.ref_file_ids) this._renderNodeRefPreview(data.ref_file_ids, { containerSelector: '#imageNodeRefPreview', refFileNames: data.ref_file_names });
        // Pick button
        const pickBtn = this.overlay?.querySelector('#imageNodePickBtn');
        pickBtn?.addEventListener('click', () => {
          const fileIdInput = this.overlay?.querySelector('#nodeRefFileIds');
          const existingIds = (fileIdInput?.value || '').split(',').filter(Boolean);
          if (this._ensureImagePickerReady()) {
            window.imagePickerModal.open({
              existingFileIds: existingIds,
              mediaFilter: 'image',
              // Image node: Flow image bag → 10 ref images max
              maxSelections: ImagePickerModal.resolveMaxSelections({ provider: 'flow', mode: 'image' }) || 10,
              onConfirm: async (images) => {
                const existingFileIds = (fileIdInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
                const flowImages = images.filter(img => img.source === 'flow' || img.source === 'existing');
                const uploadImages = images.filter(img => img.source === 'upload' && img.file);
                const newIds = flowImages.map(img => img.fileId).filter(Boolean);
                // Cache thumbnail cho Flow images
                for (const img of flowImages) {
                  if (img.fileId && img.thumbnail) {
                    this._tileCacheSet(img.fileId, { thumbnail: img.thumbnail, file_name: img.file_name || '', type: img.type || 'image' });
                  }
                }
                // Xử lý ảnh album (ALIVE/STALE)
                const albumImages = images.filter(img => img.source === 'album');
                // Upload ref ảnh cần Flow project đang mở. Đang ở homepage (no project) → modal cảnh báo
                // + nút đi tới project, KHÔNG upload (tránh fail im lặng chỉ ⚠️ trên node).
                if ((uploadImages.length > 0 || albumImages.length > 0) && !(await this._ensureFlowProjectOrWarn())) return;
                for (const img of albumImages) {
                  try {
                    const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
                    if (!prepared) continue;
                    const key = prepared.key;
                    this._tileCacheSet(key, {
                      thumbnail: img.thumbnail,
                      file_name: prepared.file_name || '',
                      type: 'image'
                    });
                    newIds.push(key);
                    // STALE: fire ImmediateUploader
                    if (key.startsWith('upload_')) {
                      const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                      if (pendingFile && window.ImmediateUploader) {
                        ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Image node'));
                      }
                      this._formUploadKeys?.add(key);
                    }
                  } catch (err) {
                    console.error('[WorkflowEditor] Lỗi chuẩn bị ảnh album (image node):', err);
                  }
                }
                if (uploadImages.length > 0) {
                  if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
                  for (const img of uploadImages) {
                    const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    // Set memory ngay lập tức
                    window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
                    // Cache thumbnail vào _tileCache
                    this._tileCacheSet(key, { thumbnail: img.thumbnail, file_name: '', type: 'image' });
                    // S2: Upload ngay nếu Flow tab mở, hoặc lưu lightweight pending
                    if (window.ImmediateUploader) {
                      ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(e => this._handleUploadError(e, 'Image node'));
                    } else if (window.PendingUploadStore) {
                      PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
                    }
                    newIds.push(key);
                    this._formUploadKeys?.add(key);
                  }
                }
                const mergedIds = [...new Set([...existingFileIds, ...newIds])];
                if (fileIdInput) fileIdInput.value = mergedIds.join(', ');
                this._renderNodeRefPreview(fileIdInput?.value || '', '#imageNodeRefPreview');
                this._updateFormButtonState();
              }
            });
          }
        });
      }
      return;
    }
    // Quantity +/- buttons — range từ provider_configs.flow.api_config.quantity_range
    const nodeQtyInput = this.overlay?.querySelector('#nodeQuantity');
    const _qRange = window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow');
    const _qMinBtn = _qRange?.min ?? 1;
    const _qMaxBtn = _qRange?.max ?? 4;
    this.overlay?.querySelector('#nodeQtyMinus')?.addEventListener('click', () => {
      const val = parseInt(nodeQtyInput?.value) || _qMinBtn;
      if (val > _qMinBtn && nodeQtyInput) nodeQtyInput.value = val - 1;
    });
    this.overlay?.querySelector('#nodeQtyPlus')?.addEventListener('click', () => {
      const val = parseInt(nodeQtyInput?.value) || _qMinBtn;
      if (val < _qMaxBtn && nodeQtyInput) nodeQtyInput.value = val + 1;
    });

    const pickerBtn = this.overlay?.querySelector('#nodeOpenImagePickerBtn');
    pickerBtn?.addEventListener('click', () => {
      // EWT-12: Template mode dùng WorkflowMediaModal (upload lên server)
      if (this.isTemplateMode && typeof WorkflowMediaModal !== 'undefined') {
        // Lấy preselected URLs từ cache dựa trên existing fileIds
        const existingIdsStr = this.overlay?.querySelector('#nodeRefFileIds')?.value || '';
        const existingIds = existingIdsStr.split(',').filter(Boolean);
        const preselectedUrls = existingIds
          .map(id => this._tileCache.get(id)?.thumbnail)
          .filter(Boolean);
        WorkflowMediaModal.show({
          type: 'ref_image',
          multiple: true,
          preselected: preselectedUrls,
          onSelect: (urls) => {
            // urls đã bao gồm preselected, thay thế hoàn toàn (không merge)
            const selectedUrls = Array.isArray(urls) ? urls : [urls];
            const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
            if (fileIdsInput) {
              // Tạo keys mới cho tất cả URLs được chọn (thay thế existing)
              const timestamp = Date.now();
              const keys = selectedUrls.map((url, idx) => `upload_import_${timestamp}_${idx}_${Math.random().toString(36).substr(2, 5)}`);
              // Cache thumbnails
              keys.forEach((key, idx) => {
                this._tileCacheSet(key, { thumbnail: selectedUrls[idx], file_name: '', type: 'image' });
              });
              // Thay thế hoàn toàn (không merge với existing)
              fileIdsInput.value = keys.join(',');
              this._renderNodeRefPreview(fileIdsInput.value);
              this._hasUnsavedChanges = true;
            }
          }
        });
        return;
      }
      // Normal mode: dùng imagePickerModal (chọn từ Flow)
      const existingIds = (this.overlay?.querySelector('#nodeRefFileIds')?.value || '').split(',').filter(Boolean);
      if (this._ensureImagePickerReady()) {
        // Bug 2026-05-28: ĐỌC LIVE VALUES TỪ DOM thay vì `data?.*` snapshot (stale từ lúc mở form).
        // Trước fix: user switch select Omni Flash nhưng data.model vẫn là model cũ → picker dùng cap cũ.
        const mediaTypeLive = this.overlay?.querySelector('#nodeMediaType')?.value || data?.media_type || 'Image';
        const videoInputTypeLive = this.overlay?.querySelector('#nodeVideoInputType')?.value || data?.video_input_type || '';
        const isVideo = String(mediaTypeLive).toLowerCase() === 'video';
        const isFrames = isVideo && String(videoInputTypeLive).toLowerCase() === 'frames';
        const modelLive = isVideo
          ? (this.overlay?.querySelector('#nodeVideoModel')?.value || data?.model || '')
          : (this.overlay?.querySelector('#nodeImageModel')?.value || data?.model || '');
        const _wfeDuration = isVideo ? (this.overlay?.querySelector('#nodeVideoDuration')?.value || undefined) : undefined;
        const _wfeCaps = ImagePickerModal.resolveCapsMulti({
          provider: 'flow',
          mode: isVideo ? 'video' : 'image',
          isFrames,
          modelValue: modelLive,
          duration: _wfeDuration,
        });
        const _wfeMaxRef = _wfeCaps.image;
        // 0 = model không hỗ trợ ref → giữ 0 (block); null/positive → fallback 10.
        const _wfeFinalMax = _wfeMaxRef === 0 ? 0 : (_wfeMaxRef || 10);
        // existingFileTypes: lookup type từ _tileCache cho mỗi ref ID hiện có →
        // modal pre-select biết video vs image → multi-cap count đúng khi mở lại.
        const _wfeExistingTypes = {};
        for (const id of existingIds) {
          const cached = this._tileCache.get(id);
          if (cached?.type === 'video') _wfeExistingTypes[id] = 'video';
        }
        window.imagePickerModal.open({
          existingFileIds: existingIds,
          existingFileTypes: _wfeExistingTypes,
          mediaFilter: 'image',
          // 2026-05-27: model Flow có supports_ref_video (vd Omni Flash) → cho phép chọn + upload video.
          allowVideo: window.ProviderRegistry?.get?.('flow')?.supportsRefVideo?.(modelLive) === true,
          maxSelections: _wfeCaps.total ?? _wfeFinalMax,
          maxImageSelections: _wfeFinalMax,
          maxVideoSelections: _wfeCaps.video,
          maxTotalSelections: _wfeCaps.total,
          noRefSupportContext: _wfeMaxRef === 0 ? {
            provider: 'flow',
            modelValue: modelLive,
            mediaType: isVideo ? 'video' : 'image',
            inputType: isVideo ? (isFrames ? 'Frames' : 'Ingredients') : undefined,
            duration: _wfeDuration,
          } : null,
          onConfirm: (images) => this.handleNodeImagePickerConfirm(images)
        });
      }
    });
    if (data.ref_file_ids) this._renderNodeRefPreview(data.ref_file_ids, { refFileNames: data.ref_file_names });
    if (nodeType === 'generate') {
      // Bind upgrade link (gate banner khi gen_enabled=false)
      const genUpgradeLink = this.overlay?.querySelector('.node-generate-upgrade-link');
      if (genUpgradeLink) {
        genUpgradeLink.addEventListener('click', (e) => {
          e.preventDefault();
          this._openUpgradeModal();
        });
      }
      this._bindFrameSourceEvents(1, data);
      this._bindFrameSourceEvents(2, data);
      const f1Select = this.overlay?.querySelector('#frame1Source');
      const f2Select = this.overlay?.querySelector('#frame2Source');
      if (f1Select && data.frame_1_source) { f1Select.value = data.frame_1_source; f1Select.dispatchEvent(new Event('change')); }
      if (f2Select && data.frame_2_source) { f2Select.value = data.frame_2_source; f2Select.dispatchEvent(new Event('change')); }
      if (data.frame_1_file_id) this._renderFramePreview(1, data.frame_1_file_id);
      if (data.frame_2_file_id) this._renderFramePreview(2, data.frame_2_file_id);
      const nodeMediaType = this.overlay?.querySelector('#nodeMediaType');
      const nodeMediaTypeToggle = this.overlay?.querySelector('#nodeMediaTypeToggle');
      const nodeImageModelGroup = this.overlay?.querySelector('#nodeImageModelGroup');
      const nodeVideoModelGroup = this.overlay?.querySelector('#nodeVideoModelGroup');
      const nodeVideoInputTypeGroup = this.overlay?.querySelector('#nodeVideoInputTypeGroup');
      const nodeVideoDurationGroup = this.overlay?.querySelector('#nodeVideoDurationGroup');
      const nodeRefImagesGroup = this.overlay?.querySelector('#nodeRefImagesGroup');
      const nodeFrameConfigGroup = this.overlay?.querySelector('#nodeFrameConfigGroup');
      const nodeVideoInputType = this.overlay?.querySelector('#nodeVideoInputType');
      const nodeVideoModel = this.overlay?.querySelector('#nodeVideoModel');
      const nodeVideoDuration = this.overlay?.querySelector('#nodeVideoDuration');
      // Mode toggle (icon button — mirror Grok pattern). Dispatch 'change' trên hidden input
      // để các handler hiện hữu (#nodeMediaType change) tiếp tục hoạt động.
      if (nodeMediaTypeToggle && nodeMediaType) {
        nodeMediaTypeToggle.querySelectorAll('.node-form-mode-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = btn.dataset.mode;
            if (!mode || nodeMediaType.value === mode) return;
            nodeMediaType.value = mode;
            nodeMediaTypeToggle.querySelectorAll('.node-form-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            nodeMediaType.dispatchEvent(new Event('change', { bubbles: true }));
          });
        });
      }
      const updateNodeMediaUI = () => {
        const isVideo = nodeMediaType?.value === 'Video';
        const isFrames = nodeVideoInputType?.value === 'Frames';
        nodeImageModelGroup?.classList.toggle('hidden', isVideo);
        nodeVideoModelGroup?.classList.toggle('hidden', !isVideo);
        nodeVideoInputTypeGroup?.classList.toggle('hidden', !isVideo);
        nodeVideoDurationGroup?.classList.toggle('hidden', !isVideo);
        // Flow Voice picker — chỉ video + model.config.supports_voice
        try { this._applyNodeVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateNodeMediaUI', _); }
        try { this._applyNodeCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateNodeMediaUI', _); }
        // 2026-05-22: toggle wrap break — Video mode break trước Ratio (đồng bộ GenTab/TaskModal).
        const compactBar = this.overlay?.querySelector('#nodeGenCompactBar');
        if (compactBar) compactBar.dataset.genMode = isVideo ? 'video' : 'image';
        if (isVideo && isFrames) { nodeRefImagesGroup?.classList.add('hidden'); nodeFrameConfigGroup?.classList.remove('hidden'); }
        else if (isVideo) { nodeRefImagesGroup?.classList.remove('hidden'); nodeFrameConfigGroup?.classList.add('hidden'); }
        else { nodeRefImagesGroup?.classList.remove('hidden'); nodeFrameConfigGroup?.classList.add('hidden'); }
      };
      // 2026-05-28: Strip refs vượt cap khi model/mode/inputType/duration đổi.
      // Reuse ImagePickerModal.resolveMaxSelections (single source of truth cap logic).
      // Vd switch Veo Lite (cap=3) → Veo Quality (cap=0) → bỏ refs + toast warn.
      const enforceRefCap = () => {
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (!fileIdsInput) return;
        const currentIds = String(fileIdsInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
        if (currentIds.length === 0) return;

        const isVid = (nodeMediaType?.value === 'Video');
        const isFr = isVid && (nodeVideoInputType?.value === 'Frames');
        const modelValue = isVid
          ? (nodeVideoModel?.value || '')
          : (this.overlay?.querySelector('#nodeImageModel')?.value || '');
        const duration = isVid ? (nodeVideoDuration?.value || undefined) : undefined;

        let cap;
        try {
          cap = window.ImagePickerModal?.resolveMaxSelections?.({
            provider: 'flow',
            mode: isVid ? 'video' : 'image',
            isFrames: isFr,
            modelValue,
            duration,
          });
        } catch (_) { return; }

        if (cap === null || cap === undefined) return; // unlimited
        if (currentIds.length <= cap) return;            // chưa vượt cap

        const kept = cap > 0 ? currentIds.slice(0, cap) : [];
        const dropped = currentIds.length - kept.length;
        fileIdsInput.value = kept.join(',');

        // Trim parallel thumbnails map (nếu có)
        const thumbsInput = this.overlay?.querySelector('#nodeRefThumbnails');
        if (thumbsInput?.value) {
          try {
            const map = JSON.parse(thumbsInput.value);
            const newMap = {};
            kept.forEach(id => { if (map[id]) newMap[id] = map[id]; });
            thumbsInput.value = Object.keys(newMap).length ? JSON.stringify(newMap) : '';
          } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#enforceRefCap', _); }
        }

        try { this._renderNodeRefPreview(fileIdsInput.value); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#enforceRefCap', _); }

        const msg = window.I18n?.t?.('workflow.refCapStrippedOnModelSwitch', {
          model: modelValue || '—', cap, dropped,
        }) || `Model "${modelValue}" chỉ hỗ trợ ${cap} ref — đã bỏ ${dropped} ảnh.`;
        if (typeof window.showNotification === 'function') {
          window.showNotification(msg, 'warning', 4000);
        }
      };

      // Update video duration options when video model changes (tier may differ)
      const updateNodeVideoDurationOptions = () => {
        if (!nodeVideoDuration) return;
        const currentModel = nodeVideoModel?.value || '';
        let tier = 'default';
        try {
          const models = window.ModelRegistry?.safeGetModelsSync?.('flow', 'video') || [];
          const modelObj = models.find(m => m.value === currentModel || m.name === currentModel);
          if (modelObj?.config?.duration_tier) tier = modelObj.config.duration_tier;
        } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateNodeVideoDurationOptions', _); }
        const durations = window.ProviderConfigManager?.safeGetVideoDurationsSync?.('flow', tier) || [];
        if (durations.length === 0) return;
        const prevValue = nodeVideoDuration.value;
        nodeVideoDuration.innerHTML = durations.map(d => `<option value="${d}">${d}</option>`).join('');
        if (prevValue && durations.includes(prevValue)) {
          nodeVideoDuration.value = prevValue;
        } else {
          const defaultIdx = durations.indexOf('6s');
          nodeVideoDuration.value = defaultIdx >= 0 ? durations[defaultIdx] : durations[0];
        }
      };
      nodeVideoModel?.addEventListener('change', () => {
        updateNodeVideoDurationOptions();
        // Rebuild option #nodeVideoInputType theo model mới — supports_frames đổi theo model.
        // Bug: đổi từ model KHÔNG support frame (vd Omni) sang model CÓ support → option 'Frames'
        // không xuất hiện (phải save node mới re-render full form). Giờ rebuild ngay khi đổi model.
        if (nodeVideoInputType) {
          const newModel = nodeVideoModel.value;
          const supportsFrames = window.ProviderRegistry?.get?.('flow')?.supportsFrames?.(newModel) !== false;
          const hasFramesOption = !!nodeVideoInputType.querySelector('option[value="Frames"]');
          if (supportsFrames !== hasFramesOption) {
            const cur = nodeVideoInputType.value;
            // Model mới không support Frames mà đang chọn Frames → fallback Ingredients.
            const target = (!supportsFrames && cur === 'Frames') ? 'Ingredients' : (cur || 'Ingredients');
            nodeVideoInputType.innerHTML =
              (supportsFrames ? `<option value="Frames" ${target === 'Frames' ? 'selected' : ''}>Frames</option>` : '') +
              `<option value="Ingredients" ${target === 'Ingredients' ? 'selected' : ''}>Ingredients</option>`;
            nodeVideoInputType.value = target;
            updateNodeMediaUI(); // re-apply port/frame UI theo option mới
          }
        }
        // Flow Voice picker visibility re-apply theo model mới
        try { this._applyNodeVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateNodeVideoDurationOptions', _); }
        try { this._applyNodeCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateNodeVideoDurationOptions', _); }
        // 2026-05-28: strip refs vượt cap mới trước khi re-render preview
        enforceRefCap();
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (fileIdsInput?.value) this._renderNodeRefPreview(fileIdsInput.value);
      });
      // nodeVideoDuration đã declare ở scope ngoài (line ~6248) — re-use binding
      nodeVideoDuration?.addEventListener('change', () => {
        // 2026-05-22: duration change → ref support có thể đổi (vd Lite/Fast strict 4s/6s block).
        enforceRefCap();
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (fileIdsInput?.value) this._renderNodeRefPreview(fileIdsInput.value);
      });
      nodeMediaType?.addEventListener('change', () => {
        // 2026-05-31 fix: Image→Video switch — apply user setting defaultVideoInputType
        // (vd 'Ingredients') nếu nodeVideoInputType chưa được user explicit chọn.
        // Heuristic: nếu data.video_input_type vẫn empty → user chưa chọn → apply default.
        // Tránh override nếu user đã explicit set Frames trước đó.
        if (nodeMediaType.value === 'Video' && nodeVideoInputType) {
          const currentNodeData = this.diagramCanvas?.editor?.getNodeFromId(this.selectedNodeId)?.data;
          const userHasExplicitChoice = !!(currentNodeData?.video_input_type);
          if (!userHasExplicitChoice) {
            const effectiveDefault = nodeVideoInputType.dataset.effectiveDefault
              || window.storageSettings?.get?.('defaultVideoInputType')
              || 'Frames';
            // Match validity: nếu effective='Frames' mà option 'Frames' không tồn tại (supportsFrames=false)
            // → fallback Ingredients. Browser tự skip non-existent option khi assign.
            const hasFramesOption = !!nodeVideoInputType.querySelector('option[value="Frames"]');
            const targetValue = (effectiveDefault === 'Frames' && !hasFramesOption) ? 'Ingredients' : effectiveDefault;
            if (nodeVideoInputType.value !== targetValue) {
              nodeVideoInputType.value = targetValue;
            }
          }
        }
        updateNodeMediaUI();
        this._updateNodeRatioOptions();
        // 2026-05-28: strip refs vượt cap mới (Image ↔ Video → cap đổi)
        enforceRefCap();
        // Re-render ref previews to update exceeded grayscale
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (fileIdsInput?.value) this._renderNodeRefPreview(fileIdsInput.value);

        // Bug 44 fix (2026-05-13): Persist media_type vào node.data NGAY khi đổi —
        // không đợi user click "Save Node". Trước fix: data.media_type vẫn 'Image' →
        // output port type='image' → user kéo edge video → image input ko bị reject
        // (vì port type chưa chuyển thành 'video'). Cũng resize ports + revalidate edges.
        try {
          const drawflowId = this.selectedNodeId;
          const editor = this.diagramCanvas?.editor;
          if (drawflowId && editor && window.NodeTemplates?.getNodePorts) {
            const node = editor.getNodeFromId(drawflowId);
            if (node) {
              const newMediaType = nodeMediaType.value;
              if ((node.data?.media_type || 'Image') !== newMediaType) {
                const updated = { ...(node.data || {}), media_type: newMediaType };
                // Update _port_map theo ports mới
                const nodeType = updated.node_type || node.class || 'generate';
                const newPorts = window.NodeTemplates.getNodePorts(nodeType, updated);
                const portMap = {};
                (newPorts.in || []).forEach((p, idx) => { portMap[`input_${idx + 1}`] = p.name; });
                (newPorts.out || []).forEach((p, idx) => { portMap[`output_${idx + 1}`] = p.name; });
                updated._port_map = portMap;
                editor.updateNodeDataFromId(drawflowId, updated);
                // Resize port count (Video+Frames thêm 2 frame ports)
                if (this.diagramCanvas?._resizeNodePorts) {
                  this.diagramCanvas._resizeNodePorts(drawflowId, newPorts);
                }
                if (this.diagramCanvas?._injectPortAttributes) {
                  requestAnimationFrame(() => this.diagramCanvas._injectPortAttributes(drawflowId, newPorts));
                }
                // Revalidate edges — gỡ edges video → image (incompat)
                const removedCount = this._revalidateNodeEdges(drawflowId);
                if (removedCount > 0) {
                  const msg = window.I18n?.t('workflow.edgesRemovedOnTypeChange', { count: removedCount })
                    || `Đã gỡ ${removedCount} kết nối không tương thích sau khi đổi loại media`;
                  if (typeof window.showNotification === 'function') {
                    window.showNotification(msg, 'warning', 2500);
                  }
                  try { this.diagramCanvas?._recolorAllEdges?.(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditorNodeForm#updateNodeVideoDurationOptions', e); }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[WorkflowEditor] Sync media_type to node data failed:', e?.message);
        }
      });
      nodeVideoInputType?.addEventListener('change', () => {
        updateNodeMediaUI();
        // 2026-05-28: Ingredients ↔ Frames → cap đổi (Frames thường dùng image cap; Veo Quality
        // Ingredients=0 nhưng Frames có thể support).
        enforceRefCap();
        const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (fileIdsInput?.value) this._renderNodeRefPreview(fileIdsInput.value);
      });
      updateNodeMediaUI();
      this._updateNodeRatioOptions();
      // EWT-12: Bind result image & ref images events cho template mode (generate node)
      if (this.isTemplateMode) {
        this._bindTemplateResultImageEvents('generateResultPickBtn', 'generateResultImgUrl', 'generateResultPreview', '#nodeRatio');
        this._bindTemplateRefImagesEvents('generateNodePickBtn', 'generateNodeRefImgUrls', 'generateNodeRefPreview', 4);
      }
    }

    // Ratio change → update node preview aspect ratio on canvas
    const nodeRatioSelect = this.overlay?.querySelector('#nodeRatio');
    if (nodeRatioSelect && this.selectedNodeId) {
      nodeRatioSelect.addEventListener('change', () => {
        const drawflowId = this.selectedNodeId;
        const nodeEl = this.overlay?.querySelector(`#node-${drawflowId}`);
        const previewEl = nodeEl?.querySelector('.df-node-preview');
        if (previewEl) {
          const isPortrait = ['9:16', '3:4', 'Dọc'].includes(nodeRatioSelect.value);
          const isLandscape = ['16:9', '4:3', 'Ngang'].includes(nodeRatioSelect.value);
          previewEl.classList.toggle('ratio-portrait', isPortrait);
          previewEl.classList.toggle('ratio-landscape', isLandscape);
        }
      });
    }

  },

  _applyNodeFormData(targetNodeId = null) {
    const nodeId = targetNodeId || this.selectedNodeId;
    if (!nodeId || !this.diagramCanvas) return;

    const node = this.diagramCanvas.editor.getNodeFromId(nodeId);
    if (!node) return;
    // Bug fix: Ưu tiên node.data?.node_type (original từ backend) over node.class.
    // node.class có thể bị corrupt thành 'generate' do loadWorkflow fallback khi node_type missing.
    // Điều này gây cascade bug: node download → type 'generate' → tên "Flow - Tạo ảnh/video".
    const nodeType = node.data?.node_type || node.class || 'generate';

    // Empty input → giữ tên cũ, fallback display name từ NodeTemplates (vd "Grok"),
    // last resort = nodeType. Trước fix: '' → save rỗng → exportWorkflow fallback `node.class`
    // (lowercase 'grok') → user thấy node đổi tên thành 'grok'.
    const inputName = (this.overlay?.querySelector('#nodeName')?.value || '').trim();
    const fallbackName = node.data?.node_name
      || (window.NodeTemplates?.types?.[nodeType]?.name)
      || nodeType;
    const data = {
      node_name: inputName || fallbackName,
      // Bug fix: Luôn persist node_type để tránh mất type khi node.data.node_type bị undefined
      // (workflows cũ hoặc data corruption). Điều này đảm bảo render/export dùng đúng type.
      node_type: nodeType
    };

    // Phase 1 — Node Reference System: Slug collection for mentionable nodes
    // Task 4.12: Track slug changes for Find & Replace dialog
    let pendingSlugChange = null;
    if (this._isMentionableNodeType(nodeType)) {
      const slugInput = this.overlay?.querySelector('#nodeSlug');
      const slugAutoInput = this.overlay?.querySelector('#nodeSlugAuto');
      if (slugInput) {
        const newSlug = (slugInput.value || '').trim();
        const oldSlug = node.data?.slug || '';
        const wasSlugAuto = node.data?.slug_auto !== false;
        // Validate slug
        const validation = this._validateSlug(newSlug, nodeId);
        if (!validation.valid) {
          console.warn(`[WorkflowEditor] Invalid slug "${newSlug}":`, validation.error);
        } else if (newSlug) {
          data.slug = newSlug;
          // User edited slug manually → set slug_auto=false
          data.slug_auto = newSlug === oldSlug && wasSlugAuto;
          // Task 4.12: Track slug change
          if (oldSlug && newSlug !== oldSlug) {
            pendingSlugChange = { oldSlug, newSlug, nodeId };
          }
        } else if (wasSlugAuto && data.node_name !== node.data?.node_name) {
          // Name changed + slug_auto=true → regenerate slug
          const regeneratedSlug = this._generateSlug(data.node_name, nodeId);
          data.slug = regeneratedSlug;
          data.slug_auto = true;
          // Task 4.12: Track slug change for auto-regenerated slugs too
          if (oldSlug && regeneratedSlug !== oldSlug) {
            pendingSlugChange = { oldSlug, newSlug: regeneratedSlug, nodeId };
          }
        } else {
          // Keep existing slug
          data.slug = oldSlug;
          data.slug_auto = wasSlugAuto;
        }
      }
    }

    // Type-specific data collection
    if (nodeType === 'note') {
      data.note_text = this.overlay?.querySelector('#nodeNoteText')?.value || '';
      // [Parity audit] note frame màu/cỡ chữ (đồng bộ web note-frame). width/height set khi resize
      // (web canvas) — extension chỉ render read-only, không đụng ở đây (giữ giá trị đã lưu).
      const noteColor = this.overlay?.querySelector('#nodeNoteColor')?.value;
      if (noteColor && /^#[0-9a-fA-F]{3,8}$/.test(noteColor)) data.note_color = noteColor;
      const noteFont = parseInt(this.overlay?.querySelector('#nodeNoteFontSize')?.value, 10);
      if (noteFont >= 10 && noteFont <= 128) data.note_font_size = noteFont;
    } else if (nodeType === 'style_anchor') {
      const q = (id) => this.overlay?.querySelector(id);
      data.anchor_block = q('#nodeAnchorBlock')?.value || '';
      data.anchor_label = (q('#nodeAnchorLabel')?.value || 'STYLE').trim() || 'STYLE';
      data.anchor_position = q('#nodeAnchorPos')?.value === 'append' ? 'append' : 'prepend';
    } else if (nodeType === 'entity_ref') {
      const q = (id) => this.overlay?.querySelector(id);
      data.entities = q('#nodeEntities')?.value || '';
      data.entity_label = (q('#nodeEntityLabel')?.value || 'CAST').trim() || 'CAST';
    } else if (nodeType === 'image_composite') {
      const q = (id) => this.overlay?.querySelector(id);
      data.composite_mode = q('#nodeCompMode')?.value === 'center-scale' ? 'center-scale' : 'center';
      const f = parseInt(q('#nodeCompFeather')?.value, 10);
      data.composite_feather = Number.isFinite(f) ? Math.min(64, Math.max(0, f)) : 0;
    } else if (nodeType === 'quality_gate') {
      const q = (id) => this.overlay?.querySelector(id);
      // Ngưỡng ngoài thang 0–10 là vô nghĩa → kẹp lại thay vì lưu giá trị hỏng.
      const th = parseFloat(q('#nodeQaThreshold')?.value);
      data.qa_threshold = isFinite(th) ? Math.min(10, Math.max(0, th)) : 7.5;
      data.qa_sampling = q('#nodeQaSampling')?.value === 'deep' ? 'deep' : 'light';
      data.qa_focus = q('#nodeQaFocus')?.value || '';
    } else if (nodeType === 'text_overlay') {
      const q = (id) => this.overlay?.querySelector(id);
      data.overlay_text = q('#nodeOverlayText')?.value || '';
      data.overlay_pos = q('#nodeOverlayPos')?.value || 'center';
      data.overlay_mode = q('#nodeOverlayMode')?.value || 'heading';
      data.overlay_align = q('#nodeOverlayAlign')?.value || 'center';
      const _oc = q('#nodeOverlayColor')?.value;
      if (_oc && /^#[0-9a-fA-F]{3,8}$/.test(_oc)) data.overlay_color = _oc;
      const _os = q('#nodeOverlaySize')?.value;
      data.overlay_size = (_os && parseInt(_os, 10) > 0) ? String(parseInt(_os, 10)) : '';
      data.overlay_download = !!q('#nodeOverlayDownload')?.checked;
    } else if (nodeType === 'text_qa') {
      const q = (id) => this.overlay?.querySelector(id);
      data.expected_text = q('#nodeQaExpected')?.value || '';
      data.qa_provider = q('#nodeQaProvider')?.value || 'chatgpt';
      data.qa_no_diacritics = !!q('#nodeQaNoDiacritics')?.checked;
    } else if (nodeType === 'delay') {
      data.delay_seconds = parseInt(this.overlay?.querySelector('#nodeDelaySeconds')?.value) || 3;
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'image') {
      // EWT-9.4: Lưu ref_img_urls cho template mode, ref_file_ids cho normal mode
      if (this.isTemplateMode) {
        const refImgUrlsInput = this.overlay?.querySelector('#imageNodeRefImgUrls');
        // Bug fix: Chỉ update nếu input tồn tại VÀ có items, nếu rỗng thì giữ nguyên từ node.data
        // Trừ khi user đã xóa hết (dataset.cleared = true)
        if (refImgUrlsInput !== null) {
          try {
            const parsedUrls = JSON.parse(refImgUrlsInput.value || '[]');
            if (parsedUrls.length > 0) {
              data.ref_img_urls = parsedUrls;
              data.ref_thumbnails = this._convertRefImgUrlsToThumbnails(parsedUrls);
            } else if (refImgUrlsInput.dataset.cleared === 'true') {
              data.ref_img_urls = [];
              data.ref_thumbnails = {};
            }
            // Nếu rỗng và chưa cleared → giữ nguyên node.data (không ghi đè)
          } catch (e) { /* ignore parse error */ }
        }
      } else {
        // Bug fix: Chỉ update nếu input tồn tại
        const imageRefInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (imageRefInput !== null) {
          data.ref_file_ids = this._truncateRefFileIds(imageRefInput.value || '', '#imageNodeRefPreview');
        }
      }
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'text_export') {
      data.export_file_name = this.overlay?.querySelector('#exportFileName')?.value?.trim() || '';
      data.export_format = this.overlay?.querySelector('#exportFormat')?.value || 'json';
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'text' || nodeType === 'text_template') {
      // Phase 1 — Node Reference System: Text node data collection (text_template dùng chung field).
      // 2026-06-03: Clear stale result_text khi user edit content (same pattern prompt node).
      const oldPromptText = data.prompt || '';
      data.prompt = this.overlay?.querySelector('#textNodeContent')?.value || '';
      if (data.prompt !== oldPromptText) {
        data.result_text = '';
        data.result_source = '';
      }
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'condition') {
      // Build: Condition/Switch config.
      data.condition_op = this.overlay?.querySelector('#nodeConditionOp')?.value || 'has_text';
      data.condition_value = this.overlay?.querySelector('#nodeConditionValue')?.value || '';
      data._active_branch = ''; // reset preview badge khi sửa
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'switch') {
      // Build: Switch config (rẽ nhiều nhánh theo giá trị).
      data.switch_mode = this.overlay?.querySelector('#nodeSwitchMode')?.value || 'contains';
      data.switch_case1 = this.overlay?.querySelector('#nodeSwitchCase1')?.value || '';
      data.switch_case2 = this.overlay?.querySelector('#nodeSwitchCase2')?.value || '';
      data.switch_case3 = this.overlay?.querySelector('#nodeSwitchCase3')?.value || '';
      data._active_branch = '';
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'loop') {
      // Loop / Batch config.
      data.max_items = parseInt(this.overlay?.querySelector('#nodeLoopMax')?.value, 10) || 0;
      data.result_items = []; data.result_text = ''; data.loop_count = 0; data.result_source = ''; // clear stale khi sửa
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'prompt_sequence') {
      // Phase 3: Prompt Sequence / Scene Splitter config.
      data.split_mode = this.overlay?.querySelector('#nodePsMode')?.value || 'auto';
      data.split_separator = this.overlay?.querySelector('#nodePsSeparator')?.value || '---';
      data.max_scenes = parseInt(this.overlay?.querySelector('#nodePsMax')?.value, 10) || 0;
      data.scene_prefix = this.overlay?.querySelector('#nodePsPrefix')?.value || '';
      data.scene_suffix = this.overlay?.querySelector('#nodePsSuffix')?.value || '';
      data.result_text = ''; data.result_scenes = []; data.result_source = ''; // clear stale khi sửa config
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'variant_expand') {
      // Variant Expand config: preset hoặc danh sách tự nhập + cách nối + giới hạn.
      data.variant_preset = this.overlay?.querySelector('#nodeVePreset')?.value || 'ratios';
      data.variants = this.overlay?.querySelector('#nodeVeVariants')?.value || '';
      const veJoinerEl = this.overlay?.querySelector('#nodeVeJoiner');
      data.variant_joiner = veJoinerEl ? veJoinerEl.value : ', ';
      data.max_variants = parseInt(this.overlay?.querySelector('#nodeVeMax')?.value, 10) || 0;
      data.result_text = ''; data.result_scenes = []; data.result_items = []; data.result_source = ''; // clear stale khi sửa config
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'text_extract') {
      // Text Extract Node (2026-05-29): collect 6 extract_* fields
      data.extract_mode = this.overlay?.querySelector('#nodeExtractMode')?.value || 'marker';
      data.extract_marker = this.overlay?.querySelector('#nodeExtractMarker')?.value?.trim() || '';
      data.extract_regex = this.overlay?.querySelector('#nodeExtractRegex')?.value || '';
      data.extract_strict = this.overlay?.querySelector('#nodeExtractStrict')?.checked === true;
      data.extract_multi_match = this.overlay?.querySelector('#nodeExtractMultiMatch')?.value || 'first';
      data.extract_on_fail = this.overlay?.querySelector('#nodeExtractOnFail')?.value || 'skip_downstream';
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
    } else if (nodeType === 'download') {
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
      data.download_folder = this.overlay?.querySelector('#downloadFolder')?.value || '';
      data.download_file_template = this.overlay?.querySelector('#downloadFileTemplate')?.value || '';
      data.download_resolution = this.overlay?.querySelector('#downloadResolution')?.value || '1k';
      // Bug 39 fix (2026-05-19): Save video_download_resolution để runtime
      // (WorkflowExecutor.js detect upstream video) pick đúng resolution thay vì luôn '720p'.
      data.video_download_resolution = this.overlay?.querySelector('#downloadVideoResolution')?.value || '720p';
      data.download_collect_all = this.overlay?.querySelector('#downloadCollectAll')?.checked || false;
    } else if (nodeType === 'telegram') {
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
      const chatIdInput = this.overlay?.querySelector('#telegramChatId');
      data.telegram_chat_id = chatIdInput?.value?.trim() || '';
      data.telegram_send_mode = this.overlay?.querySelector('#telegramSendMode')?.value || 'single';
      data.telegram_message = this.overlay?.querySelector('#telegramMessage')?.value?.trim() || '';
      console.log('[WorkflowEditor] Telegram node save - chatIdInput:', chatIdInput, 'value:', chatIdInput?.value, 'data.telegram_chat_id:', data.telegram_chat_id);
    } else if (nodeType === 'prompt') {
      // AI Agent node (Phase CG-8 + rename 2026-05-30): text + use_ai toggle + provider + timeout
      // 2026-06-03: Clear stale result_text/result_source khi user edit prompt qua form
      // (đồng bộ với _savePromptInline pattern). Tránh downstream dùng OLD AI-enhanced text.
      const oldPromptForm = data.prompt || '';
      data.prompt = this.overlay?.querySelector('#promptNodeText')?.value || '';
      if (data.prompt !== oldPromptForm) {
        data.result_text = '';
        data.result_source = '';
        delete data._extract_failed;
        delete data._extract_reason;
      }
      data.use_ai = this.overlay?.querySelector('#promptNodeUseAi')?.checked || false;
      data.provider = this.overlay?.querySelector('#promptNodeProvider')?.value || 'chatgpt';
      data.timeout_sec = parseInt(this.overlay?.querySelector('#promptNodeTimeout')?.value, 10) || 60;
      // Fallback option: tự động dùng plain text nếu AI fail (default: true)
      data.ai_fallback = this.overlay?.querySelector('#promptNodeFallback')?.checked !== false;
      // ai_delete_after_run — xóa conversation sau AI run success (default: false)
      data.ai_delete_after_run = this.overlay?.querySelector('#promptNodeDeleteAfter')?.checked || false;
      // EWT-9.4: Lưu ref_img_urls cho template mode, ref_file_ids cho normal mode
      if (this.isTemplateMode) {
        const refImgUrlsInput = this.overlay?.querySelector('#promptNodeRefImgUrls');
        // Bug fix: Chỉ update nếu có items, nếu rỗng thì giữ nguyên trừ khi cleared
        if (refImgUrlsInput !== null) {
          try {
            const parsedUrls = JSON.parse(refImgUrlsInput.value || '[]');
            if (parsedUrls.length > 0) {
              data.ref_img_urls = parsedUrls;
              data.ref_thumbnails = this._convertRefImgUrlsToThumbnails(parsedUrls);
            } else if (refImgUrlsInput.dataset.cleared === 'true') {
              data.ref_img_urls = [];
              data.ref_thumbnails = {};
            }
          } catch (e) { /* ignore */ }
        }
      } else {
        // Phase CG-8 ext: persist ref_file_ids cho prompt node (chỉ dùng khi enhance=ON)
        const promptRefInput = this.overlay?.querySelector('#promptNodeRefFileIds');
        if (promptRefInput !== null) {
          data.ref_file_ids = this._truncateRefFileIds(promptRefInput.value || '', '#promptNodeRefPreview');
        }
      }
      data.max_ref_images = 4;
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
      // Mention mode: override nếu user chọn, auto-detect nếu 'auto'
      const promptModeOverride = this.overlay?.querySelector('#promptNodePromptMode')?.value;
      const refModeOverride = this.overlay?.querySelector('#promptNodeRefMode')?.value;
      const promptText = data.prompt || '';
      const { promptAuto, refAuto } = this._autoDetectMentionModes(promptText);
      data.prompt_mode = (promptModeOverride && promptModeOverride !== 'auto') ? promptModeOverride : promptAuto;
      data.ref_mode = (refModeOverride && refModeOverride !== 'auto') ? refModeOverride : refAuto;
    } else if (nodeType === 'chatgpt') {
      // Phase CG-8: persist prompt_source (toggle: checked = textbox, unchecked = upstream_node)
      // Bug fix: Chỉ update nếu toggle element tồn tại, giữ nguyên giá trị cũ nếu không
      const psToggleCg = this.overlay?.querySelector('#promptSourceToggle');
      if (psToggleCg !== null) {
        data.prompt_source = psToggleCg.checked ? 'textbox' : 'upstream_node';
      }
      data.prompt = this.overlay?.querySelector('#chatgptNodePrompt')?.value || '';
      // Preserve existing ratio if form element is empty/missing
      const chatgptRatioEl = this.overlay?.querySelector('#chatgptImageRatio');
      data.ratio = chatgptRatioEl?.value || node.data?.ratio || 'story';
      // Model (Instant/Thinking — GPT-5.5). Preserve existing nếu form element thiếu.
      const chatgptModelEl = this.overlay?.querySelector('#chatgptNodeModel');
      data.model = chatgptModelEl?.value || node.data?.model || 'Instant';
      // EWT-9.4: Lưu ref_img_urls cho template mode, ref_file_ids cho normal mode
      if (this.isTemplateMode) {
        const refImgUrlsInput = this.overlay?.querySelector('#chatgptImageRefImgUrls');
        // Bug fix: Chỉ update nếu có items, nếu rỗng thì giữ nguyên trừ khi cleared
        if (refImgUrlsInput !== null) {
          try {
            const parsedUrls = JSON.parse(refImgUrlsInput.value || '[]');
            if (parsedUrls.length > 0) {
              data.ref_img_urls = parsedUrls;
              data.ref_thumbnails = this._convertRefImgUrlsToThumbnails(parsedUrls);
            } else if (refImgUrlsInput.dataset.cleared === 'true') {
              data.ref_img_urls = [];
              data.ref_thumbnails = {};
            }
          } catch (e) { /* ignore */ }
        }
        // EWT-12: Lưu result_img_url cho template mode
        // Bug fix: Chỉ update nếu input tồn tại VÀ có value, nếu rỗng thì giữ nguyên từ node.data
        // Trừ khi user đã xóa ảnh (dataset.cleared = true)
        const chatgptResultInput = this.overlay?.querySelector('#chatgptResultImgUrl');
        if (chatgptResultInput !== null) {
          if (chatgptResultInput.value) {
            data.result_img_url = chatgptResultInput.value;
          } else if (chatgptResultInput.dataset.cleared === 'true') {
            data.result_img_url = '';
          }
          // Nếu rỗng và chưa cleared → giữ nguyên node.data.result_img_url (không ghi đè)
        }
        // Convert to result_thumbnails để DiagramCanvas hiển thị ngay
        if (data.result_img_url) {
          data.result_thumbnails = { ...data.result_thumbnails, [`result_${Date.now()}`]: data.result_img_url };
        }
      } else {
        const chatgptRefInput = this.overlay?.querySelector('#chatgptImageRefFileIds');
        if (chatgptRefInput !== null) {
          data.ref_file_ids = this._truncateRefFileIds(chatgptRefInput.value || '', '#chatgptImageRefPreview');
          // Bug #1A: rebuild ref_thumbnails khớp ref_file_ids mới → xoá key stale → tránh gửi ảnh ref CŨ.
          data.ref_thumbnails = this._rebuildRefThumbnails(data.ref_file_ids, node.data?.ref_thumbnails);
        }
      }
      data.use_fallback_prefix = this.overlay?.querySelector('#chatgptImageMode')?.value || 'auto';
      data.timeout_ms = parseInt(this.overlay?.querySelector('#chatgptImageTimeout')?.value) || 120000;
      data.auto_download = this.overlay?.querySelector('#chatgptImageAutoDownload')?.checked || false;
      data.max_ref_images = 4;
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
      // Mention mode: override nếu user chọn, auto-detect nếu 'auto'
      const cgPromptModeOverride = this.overlay?.querySelector('#chatgptPromptMode')?.value;
      const cgRefModeOverride = this.overlay?.querySelector('#chatgptRefMode')?.value;
      const cgPromptText = data.prompt || '';
      const { promptAuto: cgPromptAuto, refAuto: cgRefAuto } = this._autoDetectMentionModes(cgPromptText);
      data.prompt_mode = (cgPromptModeOverride && cgPromptModeOverride !== 'auto') ? cgPromptModeOverride : cgPromptAuto;
      data.ref_mode = (cgRefModeOverride && cgRefModeOverride !== 'auto') ? cgRefModeOverride : cgRefAuto;
    } else if (nodeType === 'grok') {
      // Phase G-6: Grok Image/Video node
      // Bug fix: persist prompt_source giống các node khác (ChatGPT/Generate)
      // Toggle: checked = textbox (sử dụng prompt riêng), unchecked = upstream_node
      // Bug fix: Chỉ update nếu toggle element tồn tại, giữ nguyên giá trị cũ nếu không
      const psToggleGrok = this.overlay?.querySelector('#promptSourceToggle');
      if (psToggleGrok !== null) {
        data.prompt_source = psToggleGrok.checked ? 'textbox' : 'upstream_node';
      }
      data.prompt = this.overlay?.querySelector('#grokNodePrompt')?.value || '';
      data.grok_mode = this.overlay?.querySelector('#grokNodeMode')?.value || 'image';
      // Preserve existing ratio if form element is empty/missing
      const grokRatioInputEl = this.overlay?.querySelector('#grokNodeRatio');
      data.ratio = grokRatioInputEl?.value || node.data?.ratio || 'widescreen';
      data.grok_duration = this.overlay?.querySelector('#grokNodeDuration')?.value || '6s';
      data.grok_resolution = this.overlay?.querySelector('#grokNodeResolution')?.value || '720p';
      // Image quality (Grok update 2026-04) — chỉ relevant khi grok_mode=image
      data.grok_image_quality = this.overlay?.querySelector('#grokNodeImageQuality')?.value || 'speed';
      // EWT-9.4: Lưu ref_img_urls cho template mode, ref_file_ids cho normal mode
      if (this.isTemplateMode) {
        const refImgUrlsInput = this.overlay?.querySelector('#grokNodeRefImgUrls');
        // Bug fix: Chỉ update nếu có items, nếu rỗng thì giữ nguyên trừ khi cleared
        if (refImgUrlsInput !== null) {
          try {
            const parsedUrls = JSON.parse(refImgUrlsInput.value || '[]');
            if (parsedUrls.length > 0) {
              data.ref_img_urls = parsedUrls;
              data.ref_thumbnails = this._convertRefImgUrlsToThumbnails(parsedUrls);
            } else if (refImgUrlsInput.dataset.cleared === 'true') {
              data.ref_img_urls = [];
              data.ref_thumbnails = {};
            }
          } catch (e) { /* ignore */ }
        }
        // EWT-12: Lưu result_img_url cho template mode
        // Bug fix: Chỉ update nếu input tồn tại VÀ có value, nếu rỗng thì giữ nguyên từ node.data
        const grokResultInput = this.overlay?.querySelector('#grokNodeResultImgUrl');
        if (grokResultInput !== null) {
          if (grokResultInput.value) {
            data.result_img_url = grokResultInput.value;
          } else if (grokResultInput.dataset.cleared === 'true') {
            data.result_img_url = '';
          }
        }
        // Convert to result_thumbnails để DiagramCanvas hiển thị ngay
        if (data.result_img_url) {
          data.result_thumbnails = { ...data.result_thumbnails, [`result_${Date.now()}`]: data.result_img_url };
        }
      } else {
        const grokRefInput = this.overlay?.querySelector('#grokNodeRefFileIds');
        if (grokRefInput !== null) {
          data.ref_file_ids = this._truncateRefFileIds(grokRefInput.value || '', '#grokNodeRefPreview');
          // Bug #1A (Grok): rebuild ref_thumbnails khớp ref_file_ids mới → xoá key stale → tránh gửi ảnh ref CŨ.
          data.ref_thumbnails = this._rebuildRefThumbnails(data.ref_file_ids, node.data?.ref_thumbnails);
        }
      }
      data.auto_download = !!this.overlay?.querySelector('#grokNodeAutoDownload')?.checked;
      data.timeout_ms = parseInt(this.overlay?.querySelector('#grokNodeTimeout')?.value, 10) || 180000;
      data.max_ref_images = 4;
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
      // Mention mode: override nếu user chọn, auto-detect nếu 'auto'
      const grokPromptModeOverride = this.overlay?.querySelector('#grokPromptMode')?.value;
      const grokRefModeOverride = this.overlay?.querySelector('#grokRefMode')?.value;
      const grokPromptText = data.prompt || '';
      const { promptAuto: grokPromptAuto, refAuto: grokRefAuto } = this._autoDetectMentionModes(grokPromptText);
      data.prompt_mode = (grokPromptModeOverride && grokPromptModeOverride !== 'auto') ? grokPromptModeOverride : grokPromptAuto;
      data.ref_mode = (grokRefModeOverride && grokRefModeOverride !== 'auto') ? grokRefModeOverride : grokRefAuto;
    } else {
      // Generate node
      // Phase CG-8: persist prompt_source (toggle: checked = textbox, unchecked = upstream_node)
      // Bug fix: Chỉ update nếu toggle element tồn tại, giữ nguyên giá trị cũ nếu không
      const psToggleGen = this.overlay?.querySelector('#promptSourceToggle');
      if (psToggleGen !== null) {
        data.prompt_source = psToggleGen.checked ? 'textbox' : 'upstream_node';
      }
      const mediaType = this.overlay?.querySelector('#nodeMediaType')?.value || 'Image';
      const videoInputType = mediaType === 'Video'
        ? (this.overlay?.querySelector('#nodeVideoInputType')?.value || 'Frames')
        : '';
      data.prompt = this.overlay?.querySelector('#nodePrompt')?.value || '';
      data.media_type = mediaType;
      // Strict Server-Only: ModelRegistry server-driven, cache miss → null (UI dropdown empty).
      data.model = mediaType === 'Video'
        ? (this.overlay?.querySelector('#nodeVideoModel')?.value || window.ModelRegistry?.safeGetDefault('flow', 'video') || null)
        : (this.overlay?.querySelector('#nodeModel')?.value || window.ModelRegistry?.safeGetDefault('flow', 'image') || null);
      if (!data.model) console.debug('[Tier3] WorkflowEditor save: model resolve null (UI empty + cache miss)');
      // Preserve existing ratio if form element is empty/missing
      const ratioInputEl = this.overlay?.querySelector('#nodeRatio');
      data.ratio = ratioInputEl?.value || node.data?.ratio || '16:9';
      data.quantity = parseInt(this.overlay?.querySelector('#nodeQuantity')?.value) || 1;
      data.video_input_type = videoInputType;
      // Flow video duration (Omni Flash: 10s support)
      if (mediaType === 'Video') {
        data.video_duration = this.overlay?.querySelector('#nodeVideoDuration')?.value || '6s';
      }
      // Flow Voice Selector — chỉ persist khi model.config.supports_voice = true
      const voiceSlugInput = this.overlay?.querySelector('#nodeVoiceSlug');
      const voiceSearchInput = this.overlay?.querySelector('#nodeVoiceSearchValue');
      if (mediaType === 'Video') {
        const modelObj = window.ModelRegistry?.findModel?.('flow', data.model);
        if (modelObj?.config?.supports_voice === true) {
          data.voice_slug = voiceSlugInput?.value || null;
          data.voice_search_value = voiceSearchInput?.value || null;
        } else {
          data.voice_slug = null;
          data.voice_search_value = null;
        }
      } else {
        data.voice_slug = null;
        data.voice_search_value = null;
      }
      // Flow Character Selector — persist khi model.config.supports_character (cả image+video)
      const charSlugInput = this.overlay?.querySelector('#nodeCharacterSlug');
      const charSearchInput = this.overlay?.querySelector('#nodeCharacterSearchValue');
      const charModelObj = window.ModelRegistry?.findModel?.('flow', data.model);
      if (charModelObj?.config?.supports_character === true) {
        data.character_slug = charSlugInput?.value || null;
        data.character_search_value = charSearchInput?.value || null;
      } else {
        data.character_slug = null;
        data.character_search_value = null;
      }
      // EWT-9.4: Lưu ref_img_urls cho template mode, ref_file_ids cho normal mode
      if (this.isTemplateMode) {
        const refImgUrlsInput = this.overlay?.querySelector('#generateNodeRefImgUrls');
        if (refImgUrlsInput !== null) {
          try {
            const parsedUrls = JSON.parse(refImgUrlsInput.value || '[]');
            if (parsedUrls.length > 0) {
              data.ref_img_urls = parsedUrls;
              data.ref_thumbnails = this._convertRefImgUrlsToThumbnails(parsedUrls);
            } else if (refImgUrlsInput.dataset.cleared === 'true') {
              data.ref_img_urls = [];
              data.ref_thumbnails = {};
            }
          } catch (e) { /* ignore */ }
        }
      } else {
        const genRefInput = this.overlay?.querySelector('#nodeRefFileIds');
        if (genRefInput !== null) {
          data.ref_file_ids = this._truncateRefFileIds(genRefInput.value || '', '#nodeRefImagesPreview');
        }
      }
      // EWT-12: Lưu result_img_url cho template mode
      // Bug fix: Chỉ update nếu input tồn tại VÀ có value, nếu rỗng thì giữ nguyên từ node.data
      // Trừ khi user đã xóa ảnh (dataset.cleared = true)
      if (this.isTemplateMode) {
        const resultInput = this.overlay?.querySelector('#generateResultImgUrl');
        if (resultInput !== null) {
          if (resultInput.value) {
            data.result_img_url = resultInput.value;
          } else if (resultInput.dataset.cleared === 'true') {
            data.result_img_url = '';
          }
          // Nếu rỗng và chưa cleared → giữ nguyên node.data.result_img_url (không ghi đè)
        }
        // Convert to result_thumbnails để DiagramCanvas hiển thị ngay
        if (data.result_img_url) {
          data.result_thumbnails = { [`result_${Date.now()}`]: data.result_img_url };
        }
      }
      data.enabled = this.overlay?.querySelector('#nodeEnabled')?.checked !== false;
      data.auto_download = this.overlay?.querySelector('#nodeAutoDownload')?.checked || false;
      data.download_resolution = this.overlay?.querySelector('#nodeDownloadResolution')?.value || '1k';
      data.video_download_resolution = this.overlay?.querySelector('#nodeVideoDownloadResolution')?.value || '720p';
      // Mention mode: override nếu user chọn, auto-detect nếu 'auto'
      const genPromptModeOverride = this.overlay?.querySelector('#nodePromptMode')?.value;
      const genRefModeOverride = this.overlay?.querySelector('#nodeRefMode')?.value;
      const genPromptText = data.prompt || '';
      const { promptAuto: genPromptAuto, refAuto: genRefAuto } = this._autoDetectMentionModes(genPromptText);
      data.prompt_mode = (genPromptModeOverride && genPromptModeOverride !== 'auto') ? genPromptModeOverride : genPromptAuto;
      data.ref_mode = (genRefModeOverride && genRefModeOverride !== 'auto') ? genRefModeOverride : genRefAuto;
      if (mediaType === 'Video' && videoInputType === 'Frames') {
        data.frame_1_source = this.overlay?.querySelector('#frame1Source')?.value || '';
        data.frame_1_file_id = this.overlay?.querySelector('#frame1FileId')?.value || '';
        data.frame_2_source = this.overlay?.querySelector('#frame2Source')?.value || '';
        data.frame_2_file_id = this.overlay?.querySelector('#frame2FileId')?.value || '';
        // Capture cross-project metadata từ _tileCache (set bởi _openNodeFramePicker khi pick frame mới)
        // Pattern tương tự ref_thumbnails + ref_file_names cho ref images.
        [1, 2].forEach(n => {
          const fid = data[`frame_${n}_file_id`];
          if (!fid) return;
          const cached = this._tileCache?.get(fid);
          if (cached?.thumbnail) data[`frame_${n}_thumbnail`] = cached.thumbnail;
          if (cached?.file_name) data[`frame_${n}_file_name`] = cached.file_name;
        });
      }
    }

    // Bug fix: Sync ref_thumbnails/ref_file_names với ref_file_ids.
    // Khi user xóa ref image, ref_file_ids thay đổi nhưng ref_thumbnails/ref_file_names
    // không được sync → WorkflowExecutor Smart Clone reconstruct ref_file_ids từ orphan metadata.
    // DiagramCanvas.exportWorkflow đã fix để không export orphan metadata, nhưng trong memory
    // node.data vẫn có metadata cũ → nếu run workflow ngay (không reload từ storage) sẽ dùng ref cũ.
    if (typeof data.ref_file_ids === 'string' && !this.isTemplateMode) {
      const currentRefIds = new Set(
        (data.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean)
      );
      // Sync ref_thumbnails/ref_file_names theo ref_file_ids hiện tại.
      // Bug fix 2026-05-26: picker + port nguồn CHỈ ghi _tileCache, KHÔNG ghi node.data.ref_thumbnails
      // → trước đây thumbnails không được persist → reload mất ảnh + prompt-node resolve fail
      // (_resolveRefImagesForLLM không tìm thấy URL). Giờ build từ active ref IDs: ưu tiên node.data,
      // fallback _tileCache. Vẫn clear orphan (key không còn trong ref_file_ids bị loại).
      const hadThumbs = !!node.data?.ref_thumbnails;
      const hadNames = !!node.data?.ref_file_names;
      const syncedThumbs = {};
      const syncedNames = {};
      for (const key of currentRefIds) {
        const fromData = node.data?.ref_thumbnails?.[key];
        const tc = this._tileCache?.get(key);
        // thumbnail có thể là string hoặc object {thumbnail, type}
        const thumb = (fromData && typeof fromData === 'object' ? fromData.thumbnail : fromData) || tc?.thumbnail;
        // 2026-05-27: preserve video type qua reload → ref video persist dạng object {thumbnail, type:'video'}
        // để has_ref_video detect được sau khi mở lại workflow (force duration 10s).
        const isVid = (fromData && typeof fromData === 'object' && fromData.type === 'video') || tc?.type === 'video';
        if (thumb) syncedThumbs[key] = isVid ? { thumbnail: thumb, type: 'video' } : thumb;
        const nm = node.data?.ref_file_names?.[key] || tc?.file_name;
        if (nm) syncedNames[key] = nm;
      }
      // Set khi có metadata cũ (để clear orphan) HOẶC có data mới (để persist).
      if (hadThumbs || Object.keys(syncedThumbs).length > 0) data.ref_thumbnails = syncedThumbs;
      if (hadNames || Object.keys(syncedNames).length > 0) data.ref_file_names = syncedNames;
    }

    this._formSnapshot = null;
    this._hasUnsavedChanges = true;
    // Apply form data to Drawflow node
    // updateNodeData() regenerates DOM from template → destroys dynamic previews
    // Bug fix: dùng nodeId (có thể là targetNodeId) thay vì this.selectedNodeId
    this.diagramCanvas.updateNodeData(nodeId, data);

    // Restore previews that were destroyed by updateNodeData DOM regeneration
    this._restoreNodePreviewAfterUpdate(nodeId, nodeType);

    // Update connections khi node size thay đổi (vd: thêm/xóa preview image làm height thay đổi)
    try {
      const drawflowId = this._findDrawflowId(nodeId) || nodeId;
      this.diagramCanvas?.editor?.updateConnectionNodes?.(`node-${drawflowId}`);
    } catch (e) { /* ignore */ }

    // Task 4.12: Check for slug change and offer Find & Replace
    if (pendingSlugChange) {
      const { oldSlug, newSlug, nodeId: changedNodeId } = pendingSlugChange;
      const references = this._findSlugReferences(oldSlug, changedNodeId);
      if (references.length > 0) {
        // Show dialog async (don't block form save)
        this._showFindReplaceDialog(oldSlug, newSlug, references).then(choice => {
          if (choice === 'update') {
            const updated = this._replaceSlugInAllNodes(oldSlug, newSlug);
            console.log(`[WorkflowEditor] Updated ${updated} node(s): @${oldSlug} → @${newSlug}`);
          }
          // 'skip' does nothing - keep new slug but old references will be broken
        });
      }
    }
  }
  });
})(typeof window !== 'undefined' ? window : this);
