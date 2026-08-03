/**
 * NodeTemplates - HTML templates cho các loại node trong Drawflow
 */
const NodeTemplates = {
  // Phase WK-1.2: Typed port system — 5 port types
  // Mỗi port có color (visual), label (UI), icon (chữ ngắn hiển thị trong port circle)
  PORT_TYPES: {
    // Palette 2026-05-25: contrast cao với white inner dashes (rope-style connection).
    // text → soft violet (prompt/lavender feel); video giữ purple-500 đậm hơn để distinct.
    text:   { color: '#9177e1', label: 'Text',   icon: 'T' }, // custom violet (prompt color)
    image:  { color: '#3b82f6', label: 'Image',  icon: 'I' }, // blue-500
    video:  { color: '#a855f7', label: 'Video',  icon: 'V' }, // purple-500
    any:    { color: '#71717a', label: 'Any',    icon: '*' }, // zinc-500 (darker for white contrast)
    frame:  { color: '#14b8a6', label: 'Frame',  icon: 'F' }, // teal-500
  },

  // Phase WK-1.2: Port compatibility matrix — source type → array of acceptable target types
  // Auto-coerce: image ↔ frame, any tương thích với mọi loại
  PORT_COMPAT: {
    text:  ['text', 'any'],
    image: ['image', 'frame', 'any'],
    video: ['video', 'any'],
    frame: ['frame', 'image', 'any'],
    any:   ['text', 'image', 'video', 'frame', 'any'],
  },

  // Icon SVGs
  icons: {
    generate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"/></svg>`,
    download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    image: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    video_camera: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>`,
    delay: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    note: `<svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.75 2.625V4.65C9.75 5.91012 9.75 6.54018 9.99524 7.02148C10.211 7.44484 10.5552 7.78905 10.9785 8.00476C11.4598 8.25 12.0899 8.25 13.35 8.25H15.375M15.75 9.74117V12.15C15.75 13.4101 15.75 14.0402 15.5048 14.5215C15.289 14.9448 14.9448 15.289 14.5215 15.5048C14.0402 15.75 13.4101 15.75 12.15 15.75H5.85C4.58988 15.75 3.95982 15.75 3.47852 15.5048C3.05516 15.289 2.71095 14.9448 2.49524 14.5215C2.25 14.0402 2.25 13.4101 2.25 12.15V5.85C2.25 4.58988 2.25 3.95982 2.49524 3.47852C2.71095 3.05516 3.05516 2.71095 3.47852 2.49524C3.95982 2.25 4.58988 2.25 5.85 2.25H8.25883C8.80916 2.25 9.08432 2.25 9.34327 2.31217C9.57285 2.36729 9.79233 2.4582 9.99364 2.58156C10.2207 2.7207 10.4153 2.91527 10.8044 3.30442L14.6956 7.19559C15.0847 7.58473 15.2793 7.7793 15.4184 8.00636C15.5418 8.20767 15.6327 8.42715 15.6878 8.65673C15.75 8.91568 15.75 9.19084 15.75 9.74117Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    telegram: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
    chatgpt: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="11" r="1" fill="currentColor"/><circle cx="13" cy="11" r="1" fill="currentColor"/><circle cx="17" cy="11" r="1" fill="currentColor"/></svg>`,
    grok: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
    prompt: `<svg width="14" height="14" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.47158 3.7689C4.43604 4.12493 5.19375 4.88096 5.55044 5.84302C5.64791 6.10611 5.89926 6.28072 6.18038 6.28072C6.46138 6.28072 6.71273 6.10611 6.81033 5.84328C7.16715 4.88096 7.92499 4.12493 8.88932 3.7689C9.15287 3.67152 9.32787 3.42073 9.32787 3.14036C9.32787 2.85999 9.15287 2.6092 8.88932 2.51182C7.92499 2.15579 7.16728 1.39976 6.81033 0.437441C6.71273 0.17461 6.46138 0 6.18038 0C5.89926 0 5.64804 0.17461 5.55044 0.437703C5.19362 1.39976 4.43591 2.15579 3.47158 2.51182C3.20803 2.6092 3.03303 2.85999 3.03303 3.14036C3.03303 3.42073 3.20803 3.67152 3.47158 3.7689ZM6.18038 2.07621C6.4783 2.48407 6.83814 2.84324 7.24704 3.14036C6.83801 3.43748 6.4783 3.79639 6.18038 4.20451C5.8826 3.79639 5.52289 3.43748 5.11386 3.14036C5.52276 2.84324 5.8826 2.48407 6.18038 2.07621ZM14.9858 15.163C14.4549 14.967 14.0377 14.5507 13.8412 14.0209C13.7436 13.7578 13.4923 13.5832 13.2113 13.5832C12.9302 13.5832 12.6788 13.7578 12.5813 14.0209C12.385 14.5507 11.9678 14.967 11.4368 15.163C11.1731 15.2604 10.9981 15.5112 10.9981 15.7916C10.9981 16.072 11.1731 16.3228 11.4368 16.4201C11.9678 16.6162 12.385 17.0324 12.5813 17.5623C12.6788 17.8254 12.9302 18 13.2113 18C13.4923 18 13.7436 17.8254 13.8412 17.5623C14.0377 17.0324 14.4549 16.6162 14.9858 16.4201C15.2495 16.3228 15.4245 16.072 15.4245 15.7916C15.4245 15.5112 15.2495 15.2604 14.9858 15.163ZM13.2113 16.0521C13.1293 15.9604 13.0422 15.8735 12.9502 15.7916C13.0422 15.7097 13.1293 15.6227 13.2113 15.5311C13.2934 15.6227 13.3805 15.7097 13.4723 15.7916C13.3805 15.8735 13.2934 15.9604 13.2113 16.0521ZM13.6885 9.89753L15.3237 8.25012C15.8941 7.67524 15.8918 6.74224 15.3186 6.17025L13.5778 4.43331C13.2988 4.15477 12.9277 4.00137 12.5329 4.00137C12.1382 4.00137 11.7671 4.15477 11.4882 4.43331L9.83338 6.08445C9.83292 6.08491 9.83233 6.08523 9.83187 6.08569C9.83145 6.08608 9.83122 6.08661 9.83076 6.08707L2.44678 13.4546C2.32071 13.5803 2.25 13.7507 2.25 13.9285V16.8463C2.25 17.2165 2.55067 17.5165 2.92166 17.5165H5.846C6.02519 17.5165 6.19704 17.445 6.32324 17.3178L13.6885 9.89753ZM12.4381 5.38097C12.5033 5.31578 12.5631 5.31631 12.6279 5.38097L14.3687 7.1179C14.4208 7.17 14.4209 7.25482 14.3691 7.30717L13.2069 8.47813L11.2613 6.55513L12.4381 5.38097ZM5.56592 16.1762H3.59332V14.206L10.3113 7.50299L12.2616 9.4305L5.56592 16.1762Z" fill="currentColor"/></svg>`,
    // Phase 1 — Node Reference System: Text node icon
    text: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    // Text Extract Node (2026-05-29): scissors-like icon cho "trích xuất"
    text_extract: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="8" width="10" height="8" rx="1"/></svg>`,
    // Text Template Node: braces {} — ghép prompt động
    text_template: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4H6a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1"/><path d="M17 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1"/></svg>`,
    text_overlay: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h6M7 11h10"/></svg>`,
    text_qa: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
    // Style Anchor: khối neo phong cách (hình khiên + tâm) — giữ loạt ảnh không "trôi" style
    style_anchor: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 7v10l8 5 8-5V7z"/><circle cx="12" cy="12" r="3"/></svg>`,
    // Ghép ảnh: 2 lớp chồng nhau.
    image_composite: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 8h13v13H8z"/></svg>`,
    // Cổng chất lượng: khiên có dấu tick — chấm rồi mới cho đi tiếp.
    quality_gate: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
    // Bảng thực thể: 3 người/vật xếp hàng — gợi ý "dàn nhân vật dùng chung".
    entity_ref: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2"/><path d="M17 3.5a3 3 0 0 1 0 7"/><path d="M21 21v-2a5 5 0 0 0-3-4.6"/></svg>`,
    // Random Pick Node: shuffle
    random_pick: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>`,
    transform: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
    condition: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>`,
    // Switch: rẽ nhiều nhánh (git-branch style)
    switch: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2"/><path d="M5 8v3a3 3 0 0 0 3 3h6"/><path d="M5 8v8"/><path d="M14 11l3 3-3 3"/><circle cx="5" cy="18" r="2"/></svg>`,
    // Prompt Sequence (Scene Splitter): ordered-list icon
    prompt_sequence: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`,
    variant_expand: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 12h3M12 11l5-5M12 12h5M12 13l5 5"/></svg>`,
    // Loop / Batch: repeat icon
    loop: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
    merge: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>`,
    output: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    // Provider brand logos — kích thước 16px cho floating pill ở trên node
    brandFlow: `<svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF"/></svg>`,
    brandOpenAI: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
    brandGrok: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/></svg>`,
    // Media type indicators (image / video) — hiển thị nhỏ next to title
    mediaImage: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    mediaVideo: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>`
  },

  // Provider mapping cho từng node type → để render badge logo brand
  // Image source / utility nodes (delay/download/note/upscale/telegram) không thuộc provider nào → null
  getNodeProvider(type) {
    if (type === 'generate') return 'flow';
    if (type === 'chatgpt') return 'openai';
    if (type === 'grok') return 'grok';
    return null;
  },

  // Render provider badge HTML — floating pill ở phía TRÊN node (nằm ngoài card)
  // Mục đích marketing: user thấy nhiều AI provider (Flow / ChatGPT / Grok) chạy chung
  // trong 1 workflow → wow factor. Pill có logo brand + tên rõ ràng, gradient theo brand color.
  renderProviderBadge(type) {
    const provider = this.getNodeProvider(type);
    if (!provider) return '';
    const logoMap = {
      flow: this.icons.brandFlow,
      openai: this.icons.brandOpenAI,
      grok: this.icons.brandGrok,
    };
    const labelMap = { flow: 'Google Flow', openai: 'ChatGPT', grok: 'Grok' };
    const logo = logoMap[provider];
    if (!logo) return '';
    return `<div class="df-node-provider-pill df-node-provider-${provider}" title="${labelMap[provider]}" data-tooltip="${labelMap[provider]}">
      <span class="df-node-provider-pill-logo">${logo}</span>
      <span class="df-node-provider-pill-label">${labelMap[provider]}</span>
    </div>`;
  },

  // Header cho node thumbnail-style (image/generate/chatgpt/grok): header NỔI ngoài card (CSS
  // .df-node-thumb), icon + tên (rename inline qua pencil) + toggle TÁCH khỏi header (sibling) để
  // CSS đè lên góc thumbnail. Trả về header + toggle, đặt đúng chỗ block header cũ.
  _thumbHeader(iconClass, iconHtml, name, badgeHtml, enabled, headerExtra = '') {
    const tRename = window.I18n?.t('node.rename') || 'Đổi tên';
    const onTitle = enabled
      ? (window.I18n?.t('node.disableNode') || 'Tắt node')
      : (window.I18n?.t('node.enableNode') || 'Bật node');
    const pen = '<svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 15.7502H9.75002M1.875 16.1252L6.03695 14.5245C6.30343 14.4221 6.43666 14.3708 6.56133 14.3038C6.67203 14.2442 6.77758 14.1755 6.8769 14.0985C6.98876 14.0117 7.08969 13.9108 7.29155 13.7089L15.375 5.62538C16.2034 4.79695 16.2034 3.45381 15.375 2.62538C14.5466 1.79696 13.2034 1.79696 12.375 2.62538L4.29159 10.7088C4.08973 10.9107 3.9888 11.0116 3.90201 11.1235C3.82505 11.2228 3.75633 11.3284 3.69673 11.4391C3.62973 11.5637 3.57842 11.697 3.47599 11.9634L1.875 16.1252Z"/></svg>';
    return `<div class="df-node-header">
            <div class="df-node-icon ${iconClass}">${iconHtml}</div>
            <div class="df-node-title" title="${this.escapeAttr(name)}"><span class="df-node-title-text">${this.escapeHtml(name)}</span>${badgeHtml || ''}</div>
            ${headerExtra || ''}
            <button type="button" class="df-node-rename-btn nodrag" title="${this.escapeAttr(tRename)}" data-tooltip="${this.escapeAttr(tRename)}">${pen}</button>
          </div>
          <button class="df-node-toggle ${enabled ? 'on' : 'off'}" title="${this.escapeAttr(onTitle)}">
            <span class="df-node-toggle-track"><span class="df-node-toggle-thumb"></span></span>
          </button>`;
  },

  // UI 2026-05-27: bỏ media badge cạnh title — node chỉ hiển thị 1 icon (df-node-icon) bên trái
  // node_name ở header. Giữ method trả '' để không phải sửa 4 call site (generate/chatgpt/grok/image).
  renderMediaTypeBadge() {
    return '';
  },

  // Slug badge inline-editable (text/image): @prefix + slug text (contenteditable khi click) +
  // pencil bên phải. Validate chống trùng wire ở WorkflowEditor._bindInlineSlugEdit.
  slugBadge(slug) {
    if (!slug) return '';
    const pen = '<svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 15.7502H9.75002M1.875 16.1252L6.03695 14.5245C6.30343 14.4221 6.43666 14.3708 6.56133 14.3038C6.67203 14.2442 6.77758 14.1755 6.8769 14.0985C6.98876 14.0117 7.08969 13.9108 7.29155 13.7089L15.375 5.62538C16.2034 4.79695 16.2034 3.45381 15.375 2.62538C14.5466 1.79696 13.2034 1.79696 12.375 2.62538L4.29159 10.7088C4.08973 10.9107 3.9888 11.0116 3.90201 11.1235C3.82505 11.2228 3.75633 11.3284 3.69673 11.4391C3.62973 11.5637 3.57842 11.697 3.47599 11.9634L1.875 16.1252Z"/></svg>';
    const tEdit = window.I18n?.t('node.editSlug') || 'Sửa slug';
    return `<span class="df-node-slug-badge" data-slug-edit title="@${this.escapeAttr(slug)}"><span class="df-node-slug-prefix">@</span><span class="df-node-slug-text">${this.escapeHtml(slug)}</span><button type="button" class="df-node-slug-edit-btn nodrag" title="${this.escapeAttr(tEdit)}" data-tooltip="${this.escapeAttr(tEdit)}">${pen}</button></span>`;
  },

  // Nút zoom node (image/generate/chatgpt/grok): click → scale node 1.5× (wrapper) + connection
  // auto-correct. Chứa 2 icon (expand/collapse), CSS swap theo .df-node[data-zoom]. Wire ở
  // DiagramCanvas._toggleNodeZoom. nodrag để không kéo node khi bấm.
  zoomToggleBtn() {
    const t = window.I18n?.t('node.zoomNodeCycle') || 'Đổi mức phóng to (1× → 1.5× → 2×)';
    const expand = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    return `<button type="button" class="df-node-zoom-toggle nodrag" data-action="zoom-node" title="${this.escapeAttr(t)}" data-tooltip="${this.escapeAttr(t)}"><span class="df-zoom-state df-zoom-state-1">${expand}</span><span class="df-zoom-state df-zoom-state-15">1.5×</span><span class="df-zoom-state df-zoom-state-2">2×</span></button>`;
  },

  // Nút Run tròn nền trắng góc TRÊN-TRÁI thumbnail (generate/chatgpt/grok) → click chạy riêng node đó.
  // Hiện khi hover/selected node (CSS giống df-node-toggle). data-action="run-node" reuse dispatch
  // (DiagramCanvas → node:run_single). nodrag chống kéo node khi bấm.
  runNodeCornerBtn() {
    const t = window.I18n?.t('node.runNode') || 'Chạy node';
    const play = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
    return `<button type="button" class="df-node-run-corner nodrag" data-action="run-node" title="${this.escapeAttr(t)}" data-tooltip="${this.escapeAttr(t)}">${play}</button>`;
  },

  // Placeholder icon cho preview rỗng (opacity 0.3): video → camcorder, image → photo.
  _previewPlaceholderIcon(isVid) {
    return isVid
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  },

  // Node type configs - dùng getter để evaluate I18n.t() tại runtime (fix i18n loading race condition)
  get types() {
    // Helper để lấy translation với fallback
    const t = (key, fallback) => {
      const val = window.I18n?.t(key);
      // I18n.t() trả về key nếu không tìm thấy translation → fallback
      return (val && val !== key) ? val : fallback;
    };
    return {
      generate: {
        name: t('node.generateName', 'Tạo ảnh/video'), description: t('node.generateDesc', 'Tạo ảnh/video mới'),
        color: 'generate', inputs: 1, outputs: 1, portType: 'image',
        // Phase WK-1.2: Typed multi-port (additive — KHÔNG xoá fields cũ để giữ backward-compat)
        ports: {
          in: [
            { name: 'image_ref', type: 'image', required: false, multiple: true,  label: t('node.portRefImages', 'Reference images') },
            { name: 'text',      type: 'text',  required: false, multiple: true,  label: t('node.portPromptText', 'Prompt text') },
            { name: 'frame_1',   type: 'frame', required: false, multiple: false, label: t('node.portFrame1', 'Frame 1 (video)'), visibleWhen: 'isVideoFrames' },
            { name: 'frame_2',   type: 'frame', required: false, multiple: false, label: t('node.portFrame2', 'Frame 2 (video)'), visibleWhen: 'isVideoFrames' },
            // 2026-06-06: video ref port cho model support ref_video (vd Omni Flash mode Ingredients).
            // Server-Only: visibleWhen='isVideoIngredient' resolve qua FlowAdapter.supportsRefVideo
            // đọc provider_models.config.supports_ref_video.
            // max_ref_images.video=1 (Omni Flash) → multiple:false.
            // acceptFromNodeTypes: CHỈ nhận video output từ node `generate` (Flow gen) — chặn Grok/
            // ChatGPT/Gemini vì các provider khác KHÔNG hỗ trợ cross-provider ref video transfer.
            { name: 'video_ref', type: 'video', required: false, multiple: false, label: t('node.portRefVideo', 'Reference video'), visibleWhen: 'isVideoIngredient', acceptFromNodeTypes: ['generate'] },
          ],
          out: [
            { name: 'media', type: 'image', label: t('node.portResult', 'Result'), dynamicType: 'media_type' },
            // Port 1.1.58 VIDEO_NODE_LAST_FRAME: frame CUỐI video làm output ảnh thứ 2 (nối tiếp video).
            { name: 'frame', type: 'image', label: t('node.portFrameOut', 'Last frame'), visibleWhen: 'isVideo' },
          ],
        },
      },
      download: {
        name: t('node.downloadName', 'Download'), description: t('node.downloadDesc', 'Auto-download results'),
        color: 'download', inputs: 1, outputs: 0, portType: 'any',
        ports: {
          in: [{ name: 'media_in', type: 'any', required: true, multiple: true, label: t('node.portFilesToDownload', 'Files to download') }],
          out: [],
        },
      },
      delay: {
        name: t('node.delayName', 'Wait'), description: t('node.delayDesc', 'Wait X seconds'),
        color: 'delay', inputs: 1, outputs: 1, portType: 'any',
        ports: {
          in: [{ name: 'any_in', type: 'any', required: false, label: t('node.portInputPassthrough', 'Input pass-through') }],
          out: [{ name: 'any_out', type: 'any', label: t('node.portOutputAfterDelay', 'Output (after delay)') }],
        },
      },
      image: {
        name: t('node.imageName', 'Image'), description: t('node.imageDesc', 'Upload or assign reference image'),
        color: 'image', inputs: 0, outputs: 1, portType: 'image',
        ports: {
          in: [],
          out: [{ name: 'media', type: 'image', label: t('node.portRefImage', 'Ref image') }],
        },
      },
      // Phase 1 — Node Reference System: Text node for prompt composition via @slug
      text: {
        name: t('node.textName', 'Text'), description: t('node.textDesc', 'Static text/prompt source for @mentions'),
        color: 'text', inputs: 0, outputs: 1, portType: 'text',
        ports: {
          in: [],
          out: [{ name: 'text', type: 'text', label: t('node.portTextOutput', 'Text output') }],
        },
      },
      // n8n-style Text Template — ghép text từ các node upstream vào mẫu {{input}}, {{input1}},
      // {{input2}}... → prompt động cho gen hàng loạt. Pure string, chạy 100% local (không AI/backend).
      text_template: {
        name: t('node.textTemplateName', 'Text Template'),
        description: t('node.textTemplateDesc', 'Ghép text từ node upstream vào mẫu {{input}}, {{input1}}, {{input2}}... để tạo prompt động'),
        icon: 'text_template', color: 'text', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in: [{ name: 'text', type: 'text', required: false, multiple: true, label: t('node.portTextInputs', 'Text inputs') }],
          out: [{ name: 'text', type: 'text', label: t('node.portResultText', 'Result text') }],
        },
      },
      // Port 1.1.58: khai báo LOCAL cho text_extract (seosona render + execute node này nhưng thiếu
      // entry trong types → offline getType('text_extract') fallback về 'generate' = image ports SAI.
      // Thêm entry text in/out → ports đúng khi chạy offline.
      text_extract: {
        name: t('node.textExtractName', 'Text Extract'), description: t('node.textExtractDesc', 'Trích text từ upstream (marker/JSON/regex)'),
        icon: 'text_extract', color: 'text', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in:  [{ name: 'text', type: 'text', required: true, multiple: false, label: t('node.portTextUpstream', 'Text upstream') }],
          out: [{ name: 'text', type: 'text', label: t('node.portExtractedText', 'Extracted text') }],
        },
      },
      // Build (n8n-style): Random Pick — nhận nhiều text upstream, chọn NGẪU NHIÊN 1 → output.
      // Đa dạng hoá prompt/style khi gen loạt. Pure data (không đụng DAG/executor branch).
      random_pick: {
        name: t('node.randomPickName', 'Random Pick'),
        description: t('node.randomPickDesc', 'Chọn ngẫu nhiên 1 trong nhiều text upstream → đa dạng hoá prompt'),
        icon: 'random_pick', color: 'text', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in:  [{ name: 'text', type: 'text', required: false, multiple: true, label: t('node.portTextOptions', 'Text options') }],
          out: [{ name: 'text', type: 'text', label: t('node.portPickedText', 'Picked text') }],
        },
      },
      // Phase 3 (n8n pipeline): Prompt Sequence / Scene Splitter — tách 1 blob nhiều scene (từ AI Agent
      // hoặc paste) thành DANH SÁCH scene-prompt đánh số → sẵn sàng batch generate / loop. Pure data
      // (chỉ xử lý string, KHÔNG gọi AI/backend). Output text (numbered join) + data.result_scenes[].
      prompt_sequence: {
        name: t('node.promptSequenceName', 'Prompt Sequence'),
        description: t('node.promptSequenceDesc', 'Tách 1 khối nhiều scene → danh sách prompt đánh số để batch generate'),
        icon: 'prompt_sequence', color: 'text', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in:  [{ name: 'text', type: 'text', required: false, multiple: true, label: t('node.portTextBlock', 'Text (khối nhiều scene)') }],
          out: [{ name: 'text', type: 'text', label: t('node.portPromptList', 'Danh sách prompt') }],
        },
      },
      // Variant Expand — nhân 1 prompt gốc × danh sách modifier (ratio/style/góc/ánh sáng) → N biến thể
      // prompt. Pure data (KHÔNG gọi AI). Output text (numbered) + data.result_scenes[] → nối Loop/Generate
      // để batch. "1 concept → 4 tỉ lệ" / "1 subject → 3 phong cách". Modifier: data.variants (mỗi dòng 1)
      // hoặc data.variant_preset = ratios|styles|angles|lighting.
      variant_expand: {
        name: t('node.variantExpandName', 'Variant Expand'),
        description: t('node.variantExpandDesc', '1 prompt gốc × danh sách biến thể (tỉ lệ/phong cách/góc) → N prompt để batch'),
        icon: 'variant_expand', color: 'text', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in:  [{ name: 'text', type: 'text', required: false, multiple: true, label: t('node.portBasePrompt', 'Prompt gốc') }],
          out: [{ name: 'text', type: 'text', label: t('node.portVariantList', 'Danh sách biến thể') }],
        },
      },
      // Loop / Batch — nhận DANH SÁCH (từ prompt_sequence result_scenes[] hoặc tách text) → chuẩn bị
      // batch: lưu result_items[] + đếm, re-emit từng item để generate hàng loạt. Pure-data (phần chạy
      // gen N lần do executor batch xử lý khi gen sống). n8n "Loop Over Items" style.
      loop: {
        name: t('node.loopName', 'Loop / Batch'),
        description: t('node.loopDesc', 'Nhận danh sách (scene/prompt) → lặp qua từng item để generate hàng loạt'),
        icon: 'loop', color: 'text', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in:  [{ name: 'text', type: 'text', required: false, multiple: true, label: t('node.portLoopList', 'Danh sách (từ Prompt Sequence)') }],
          out: [{ name: 'text', type: 'text', label: t('node.portLoopItem', 'Từng item → generate') }],
        },
      },
      telegram: {
        name: 'Telegram', description: t('node.telegramDesc', 'Send images via Telegram'),
        icon: 'telegram', color: 'telegram', inputs: 1, outputs: 1, portType: 'any',
        // Terminal sink: chỉ nhận input (gửi đi), không gợi ý làm upstream cho node khác.
        // Picker filter: ẩn khỏi danh sách khi user click empty INPUT port của node khác.
        // Bug 27 fix (2026-05-19): nest trong `ui` để khớp backend config.ui.terminal_sink
        // (admin tweak qua /admin/workflow-node-types). Trước đây ext đọc root-level
        // `terminalSink`, admin tweak backend không có hiệu lực.
        ui: { terminal_sink: true },
        ports: {
          in: [{ name: 'media_in', type: 'any', required: true, multiple: true, label: t('node.portFilesToTelegram', 'Files to Telegram') }],
          out: [{ name: 'pass', type: 'any', label: t('node.portPassthrough', 'Pass-through') }],
        },
      },
      // ChatGPT node — provider ChatGPT, hỗ trợ image (chuẩn bị mở rộng video).
      chatgpt: {
        name: t('node.chatgptName', 'ChatGPT'), description: t('node.chatgptDesc', 'Generate images via ChatGPT'),
        icon: 'chatgpt', color: 'chatgpt', inputs: 1, outputs: 1, portType: 'image',
        ports: {
          in: [
            { name: 'image_ref', type: 'image', required: false, multiple: true,  label: t('node.portRefImages', 'Reference images') },
            { name: 'text',      type: 'text',  required: false, multiple: true,  label: t('node.portPromptText', 'Prompt text') },
          ],
          out: [{ name: 'media', type: 'image', label: t('node.portChatgptImages', 'ChatGPT images') }],
        },
      },
      // Phase G-6: Grok node — tạo ảnh/video qua Grok provider.
      // Cleanup (2026-05-19): Removed inline `config` (max_ref_images, supported_modes,
      // supported_ratios, supported_durations, supported_resolutions) — duplicate với
      // GrokAdapter.capabilities. Source of truth: provider adapter capabilities (Phase J
      // pending migrate sang provider_configs.api_config).
      grok: {
        name: t('node.grokName', 'Grok'),
        description: t('node.grokDesc', 'Generate image/video via Grok'),
        icon: 'grok', color: 'grok', inputs: 1, outputs: 1, portType: 'image',
        ports: {
          in: [
            { name: 'image_ref', type: 'image', required: false, multiple: true,  label: t('node.portRefImages', 'Reference images') },
            { name: 'text',      type: 'text',  required: false, multiple: true,  label: t('node.portPromptText', 'Prompt text') },
          ],
          out: [
            // dynamicType='grok_mode' → resolve theo data.grok_mode (image/video) cho đúng port type.
            { name: 'media', type: 'image', label: t('node.portResult', 'Result'), dynamicType: 'grok_mode' },
            // Port 1.1.58 VIDEO_NODE_LAST_FRAME (Grok): frame CUỐI video grok làm output ảnh thứ 2.
            { name: 'frame', type: 'image', label: t('node.portFrameOut', 'Last frame'), visibleWhen: 'isGrokVideo' },
          ],
        },
      },
      prompt: {
        // AI Agent rename (2026-05-30): display name "AI Agent" — server WorkflowNodeTypeSeeder
        // cũng set name="AI Agent". Local fallback dùng khi server config chưa fetch.
        name: t('node.promptName', 'AI Agent'), description: t('node.promptDesc', 'Pass-through text hoặc dùng AI (ChatGPT/Gemini) để xử lý text — enhance prompt, viết kịch bản, phân tích ảnh, summarize, translate, brainstorm.'),
        icon: 'prompt', color: 'prompt', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in: [
            { name: 'text',      type: 'text',  required: false, multiple: true,  label: t('node.portPromptUpstream', 'Prompt upstream') },
            { name: 'image_ref', type: 'image', required: false, multiple: true,  label: t('node.portRefImages', 'Reference images'), visibleWhen: 'enhance' },
          ],
          out: [{ name: 'text', type: 'text', label: t('node.portResultText', 'Result text') }],
        },
      },
      note: {
        name: t('node.noteName', 'Ghi chú'), description: t('node.noteDesc', 'Ghi chú trên canvas'),
        color: 'note', inputs: 0, outputs: 0, portType: 'none',
        ports: { in: [], out: [] },
      },
      // Legacy (backward compat) — KHÔNG khai báo ports → getNodePorts trả {in:[], out:[]} → render Drawflow native ports
      transform: { name: 'Transform', description: t('node.transformDesc', 'Biến đổi ảnh/video'), color: 'transform', inputs: 1, outputs: 1, portType: 'image' },
      // Build (n8n-style Condition/Switch): rẽ nhánh workflow theo điều kiện trên input. 2 output:
      // 'true' (điều kiện đúng) / 'false' (sai). Executor skip nhánh KHÔNG chọn (gated).
      condition: {
        name: t('node.conditionName', 'Condition'),
        description: t('node.conditionDesc', 'Rẽ nhánh: nếu điều kiện đúng → nhánh TRUE, sai → nhánh FALSE'),
        icon: 'condition', color: 'condition', inputs: 1, outputs: 2, portType: 'any',
        ports: {
          in:  [{ name: 'in', type: 'any', required: false, multiple: true, label: t('node.portConditionIn', 'Input') }],
          out: [
            { name: 'true',  type: 'any', label: t('node.portConditionTrue', 'TRUE (đúng)') },
            { name: 'false', type: 'any', label: t('node.portConditionFalse', 'FALSE (sai)') },
          ],
        },
      },
      // Build (n8n-style Switch): rẽ NHIỀU nhánh theo giá trị khớp trên input. 4 output cố định:
      // case1/case2/case3 (khớp giá trị) + else (mặc định). Executor skip nhánh KHÔNG chọn (gated, như condition).
      switch: {
        name: t('node.switchName', 'Switch'),
        description: t('node.switchDesc', 'Rẽ nhiều nhánh theo giá trị khớp (case 1/2/3, còn lại → mặc định)'),
        icon: 'switch', color: 'condition', inputs: 1, outputs: 4, portType: 'any',
        ports: {
          in:  [{ name: 'in', type: 'any', required: false, multiple: true, label: t('node.portSwitchIn', 'Input') }],
          out: [
            { name: 'case1', type: 'any', label: t('node.portSwitchCase1', 'Case 1') },
            { name: 'case2', type: 'any', label: t('node.portSwitchCase2', 'Case 2') },
            { name: 'case3', type: 'any', label: t('node.portSwitchCase3', 'Case 3') },
            { name: 'else',  type: 'any', label: t('node.portSwitchElse', 'Mặc định') },
          ],
        },
      },
      merge: { name: 'Merge', description: t('node.mergeDesc', 'Gộp nhiều inputs'), color: 'merge', inputs: 2, outputs: 1, portType: 'any' },
      // Text Overlay — overlay chữ VECTOR (deterministic) lên ảnh upstream → diệt rớt-chữ/sai-dấu.
      // Nhận ảnh (port image) + chữ (port text hoặc field overlay_text), xuất ảnh (result_thumbnails)
      // + tự lưu file. Chữ do code dựng (font Be Vietnam Pro) → chính tả/dấu/ngắt-dòng luôn đúng.
      text_overlay: {
        name: t('node.textOverlayName', 'Text Overlay'),
        description: t('node.textOverlayDesc', 'Overlay chữ vector lên ảnh (chống rớt-chữ/sai-dấu) — chọn vị trí/font/màu'),
        icon: 'text_overlay', color: 'text', inputs: 2, outputs: 1, portType: 'any',
        ports: {
          in: [
            { name: 'image', type: 'image', required: true, multiple: false, label: t('node.portImageBase', 'Ảnh nền') },
            { name: 'text', type: 'text', required: false, multiple: false, label: t('node.portTextOverlay', 'Chữ overlay') },
          ],
          out: [{ name: 'image', type: 'image', label: t('node.portImageOut', 'Ảnh + chữ') }],
        },
      },
      // Style Anchor — chèn 1 khối "phong cách" (palette/chất liệu/ánh sáng/ống kính) vào MỌI prompt
      // đi qua, để loạt ảnh nhiều cảnh không bị trôi style. Text vào → text ra (đặt TRƯỚC node gen).
      style_anchor: {
        name: t('node.styleAnchorName', 'Style Anchor'),
        description: t('node.styleAnchorDesc', 'Chèn khối phong cách vào mọi prompt đi qua — giữ loạt ảnh nhất quán'),
        icon: 'style_anchor', color: 'text', inputs: 1, outputs: 1, portType: 'text',
        ports: {
          in: [{ name: 'text', type: 'text', required: true, multiple: true, label: t('node.portPromptsIn', 'Prompt vào') }],
          out: [{ name: 'text', type: 'text', label: t('node.portPromptsAnchored', 'Prompt đã neo style') }],
        },
      },
      // Ghép ảnh — dán ảnh GỐC đè lên kết quả outpaint để tâm ảnh giữ nguyên PIXEL.
      // Không có bước này thì mọi câu 'do not modify the original' đều vô nghĩa: model
      // khuếch tán tái sinh toàn khung, chữ nghĩa không khoá được pixel.
      image_composite: {
        name: t('node.compositeName', 'Ghép ảnh'),
        description: t('node.compositeDesc', 'Dán ảnh gốc đè lên ảnh đã mở rộng — giữ nguyên pixel vùng tâm'),
        icon: 'image_composite', color: 'image', inputs: 2, outputs: 1, portType: 'image',
        ports: {
          in: [
            { name: 'base', type: 'image', required: true, multiple: false, label: t('node.portCompBase', 'Ảnh nền (đã mở rộng)') },
            { name: 'overlay', type: 'image', required: true, multiple: false, label: t('node.portCompOverlay', 'Ảnh gốc (dán đè)') },
          ],
          out: [{ name: 'image', type: 'image', label: t('node.portCompOut', 'Ảnh đã ghép') }],
        },
      },
      // Cổng chất lượng — chấm ảnh/video rồi rẽ nhánh: đạt đi tiếp, trượt quay lại gen.
      // Lỗi CRITICAL là trượt bất kể điểm trung bình (xem src/core/QualityGate.js).
      quality_gate: {
        name: t('node.qualityGateName', 'Cổng chất lượng'),
        description: t('node.qualityGateDesc', 'Chấm ảnh/video → đạt đi tiếp, trượt rẽ nhánh gen lại'),
        icon: 'quality_gate', color: 'text', inputs: 1, outputs: 2, portType: 'any',
        ports: {
          in: [{ name: 'image', type: 'image', required: true, multiple: true, label: t('node.portQaIn', 'Ảnh/video cần chấm') }],
          out: [
            { name: 'pass', type: 'image', label: t('node.portQaPass', 'Đạt') },
            { name: 'fail', type: 'image', label: t('node.portQaFail', 'Trượt → gen lại') },
          ],
        },
      },
      // Bảng thực thể — mỗi nhân vật/bối cảnh/đạo cụ có MỘT ảnh gốc, dùng lại cho MỌI cảnh.
      // Đây là cách chuẩn để chống trôi mặt / đổi trang phục giữa các cảnh: thay vì @mention ref
      // thủ công ở từng node, khai một lần ở đây rồi mọi node gen hạ lưu đều nhận.
      // Luật đi kèm (executor nhúng vào prompt): cảnh gọi thực thể BẰNG TÊN và tả HÀNH ĐỘNG —
      // tả lại ngoại hình là đá nhau với ảnh ref.
      entity_ref: {
        name: t('node.entityRefName', 'Bảng thực thể'),
        description: t('node.entityRefDesc', 'Nhân vật / bối cảnh / đạo cụ — mỗi thứ 1 ảnh gốc dùng cho mọi cảnh'),
        icon: 'entity_ref', color: 'image', inputs: 1, outputs: 1, portType: 'any',
        ports: {
          in: [{ name: 'text', type: 'text', required: false, multiple: true, label: t('node.portEntitySeed', 'Mô tả thực thể (tuỳ chọn)') }],
          out: [{ name: 'image', type: 'image', label: t('node.portEntityRefs', 'Ảnh gốc các thực thể') }],
        },
      },
      // Text QA — kiểm chữ trong ảnh: OCR ảnh upstream qua vision provider (pa:generate) rồi đối chiếu
      // chuỗi mong đợi bằng TextIntegrity → verdict pass/warn/fail. Pass-through ảnh cho downstream.
      text_qa: {
        name: t('node.textQaName', 'Text QA'),
        description: t('node.textQaDesc', 'Kiểm chính tả chữ trong ảnh (OCR + đối chiếu) → verdict'),
        icon: 'text_qa', color: 'text', inputs: 1, outputs: 1, portType: 'any',
        ports: {
          in: [{ name: 'image', type: 'image', required: true, multiple: false, label: t('node.portImageQa', 'Ảnh cần kiểm') }],
          out: [{ name: 'image', type: 'image', label: t('node.portImageOut', 'Ảnh (pass-through)') }],
        },
      },
      // Text Export — ghi text upstream (manifest JSON, kịch bản, danh sách prompt...) ra FILE.
      // Sink: chỉ nhận input, không có output. Bù cho việc node `download` chỉ nhận media.
      text_export: {
        name: t('node.textExportName', 'Xuất file text'),
        description: t('node.textExportDesc', 'Ghi text upstream ra file (.json/.txt/.md/.csv) — dùng lưu manifest, kịch bản, danh sách prompt'),
        icon: 'text_extract', color: 'output', inputs: 1, outputs: 0, portType: 'text',
        ports: {
          in: [{ name: 'text', type: 'text', required: true, multiple: true, label: t('node.portTextToFile', 'Text cần ghi ra file') }],
          out: [],
        },
      },
      output: { name: 'Output', description: t('node.outputDesc', 'Kết quả cuối'), color: 'output', inputs: 1, outputs: 0, portType: 'any' }
    };
  },

  // Port type colors for visual distinction
  // Phase CG-8: text port → amber #F59E0B (matches prompt node sparkle color)
  portColors: {
    image: '#3b82f6',
    video: '#8b5cf6',
    text: '#F59E0B',
    any: '#d4d4d8',
    none: 'transparent'
  },

  // Hook chuẩn hoá node type. Hiện tại pass-through (không có alias).
  // Thêm mapping ở đây nếu rename node type trong tương lai (vd: chatgpt → chatgpt_v2).
  _normalizeType(type) {
    return type;
  },

  // Generate node HTML for Drawflow
  createNodeHTML(type, data = {}) {
    type = this._normalizeType(type);
    // Dùng getType() để lấy config merged với server (icon, color, ports từ backend).
    // Name của node trên canvas là SNAPSHOT lúc tạo (lưu vào data.node_name) — admin đổi
    // template name KHÔNG override node đã vẽ. Picker (list thêm node) đọc config.name
    // trực tiếp nên picker tự update khi SSE push.
    const config = this.getType(type);
    // Icon lookup: server config.icon (string key) → this.icons[key], fallback type → fallback generate
    const iconKey = config.icon || type;
    const icon = this.icons[iconKey] || this.icons[type] || this.icons.generate;
    // Name resolution: snapshot — node_name lưu lúc tạo node, render từ data.
    // Fallback config.name chỉ cho edge case node thiếu node_name (legacy data).
    const name = data.node_name || config.name;
    const prompt = data.prompt || '';
    const status = data.status || 'pending';
    const mediaType = data.media_type || 'Image';
    const model = data.model || '';
    const ratio = data.ratio || '';
    const quantity = data.quantity || 1;
    const enabled = data.enabled !== false;
    const videoInputType = data.video_input_type || '';
    const isVideoFrames = mediaType === 'Video' && videoInputType === 'Frames';
    const isVideo = mediaType === 'Video';
    // Pill display fallback theo server default (defaultVideoInputType) — KHÔNG hardcode 'Frames'.
    const _vitSettingDefault = window.storageSettings?.get?.('defaultVideoInputType');
    const videoInputTypeDisplay = videoInputType
      || ((_vitSettingDefault === 'Ingredients' || _vitSettingDefault === 'Frames') ? _vitSettingDefault : 'Frames');
    const videoDuration = data.video_duration || '6s';
    // Per-node zoom: '1'/'1.5'/'2' (chỉ image/generate/chatgpt/grok). Attr trên .df-node →
    // CSS :has() scale wrapper .drawflow-node + hiện mức trên nút.
    const _nz = Number(data.node_zoom);
    const nodeZoom = _nz === 1.5 ? '1.5' : (_nz === 2 ? '2' : '1');

    // Header icon dynamic theo media_type:
    // - generate Video → video-camera (camcorder)
    // - generate Image / chatgpt → photo (rect + mountain)
    // - Các type khác giữ icon mặc định
    let headerIcon = icon;
    if (type === 'generate') {
      headerIcon = mediaType === 'Video' ? this.icons.video_camera : this.icons.image;
    } else if (type === 'chatgpt') {
      headerIcon = this.icons.image;
    } else if (type === 'grok') {
      // Grok: header icon theo grok_mode (image/video) giống node generate
      const _grokMode = data.grok_mode || data.mode || 'image';
      headerIcon = _grokMode === 'video' ? this.icons.video_camera : this.icons.image;
    }

    // Phase WK-1.2 (REFACTORED — bug fix): Style Drawflow native ports trực tiếp qua data attributes
    // thay vì overlay rails. Native ports có drag/drop mechanism của Drawflow → user kéo edge được.
    // DiagramCanvas._injectPortAttributes() (post-render hook) set data-port-type/name/required.
    // KHÔNG render rails nữa — giữ biến rỗng để các render branches không break.
    const portRailIn = '';
    const portRailOut = '';
    const nodeHasPortsClass = '';
    // OLD visual overlay rails đã DELETE — Drawflow native ports được style trực tiếp qua post-render hook
    // trong DiagramCanvas._injectPortAttributes() (set data-port-type/name/required).

    // Generate node: chi tiết ratio classes (như ChatGPT)
    const genRatioClassMap = {
      '9:16': 'ratio-9-16', 'Dọc': 'ratio-9-16',
      '3:4': 'ratio-3-4',
      '2:3': 'ratio-2-3',   // Grok portrait
      '1:1': '', 'Vuông': '',
      '4:3': 'ratio-4-3',
      '3:2': 'ratio-3-2',   // Grok landscape
      '16:9': 'ratio-16-9', 'Ngang': 'ratio-16-9'
    };
    // (Dùng cho node generate — dimensional trực tiếp. Grok có grokRatioClassMap riêng bên dưới.)
    const ratioClass = genRatioClassMap[ratio] !== undefined ? genRatioClassMap[ratio] : '';

    // Hover toolbar HTML (shared across node types that support it)
    // Run button: chỉ hiển thị khi node có content VÀ đã được save (có node_id)
    // Bug fix: Grok/ChatGPT/Generate có thể nhận prompt qua port `text` từ upstream Prompt node
    // → cho phép hover-toolbar run-button hiện kể cả khi prompt rỗng (đã saved). Runtime
    // _checkDependencies sẽ verify có Prompt upstream, KHÔNG có thì throw error rõ ràng.
    const hasContent = type === 'delay' ? enabled
      : type === 'note' ? false
      : type === 'image' ? false
      : ['chatgpt', 'grok', 'generate', 'prompt'].includes(type) ? true
      : !!(prompt && prompt.trim());
    const isNodeSaved = !!(data.node_id);
    const canRunNode = hasContent && isNodeSaved;
    const hasResults = !!(data.result_file_ids && data.result_file_ids.trim());
    // hasResetable: dùng cho reset button — đồng bộ với WorkflowEditor._updateResetSingleNodeButton
    // + DiagramCanvas._showNodeContextMenu hasResults check. 3 chỗ giờ cùng logic:
    // result_file_ids HOẶC result_text HOẶC status !== 'pending' → cho phép reset.
    const hasResetable = hasResults
      || !!data.result_text
      || !!(data.status && data.status !== 'pending');
    const hasPrompt = !!(prompt && prompt.trim());
    // Quick-add (＋): mở picker từ output port của node → thêm + nối node kế tiếp (tái dùng _showNodePicker).
    // Chỉ hiện khi node có ít nhất 1 output port (bỏ qua terminal như download/note).
    let hasOutputPort = false;
    try { hasOutputPort = (this.getNodePorts?.(type, data)?.out || []).length > 0; } catch (_) { hasOutputPort = false; }
    const tQuickAdd = window.I18n?.t('node.quickAdd') || 'Thêm node kế tiếp';
    const tCopyPrompt = window.I18n?.t('node.copyPrompt') || 'Copy prompt';
    const tRunNode = window.I18n?.t('node.runNode') || 'Chạy node';
    const tDownloadResults = window.I18n?.t('node.downloadResults') || 'Tải kết quả';
    const tSettings = window.I18n?.t('node.settings') || 'Cài đặt';
    const tBranch = window.I18n?.t('node.branch') || 'Tạo nhánh';
    const tDuplicate = window.I18n?.t('node.duplicate') || 'Nhân bản';
    const tDeleteNode = window.I18n?.t('node.deleteNode') || 'Xóa node';
    const tResetNode = window.I18n?.t('node.resetNode') || 'Reset node';
    const hoverToolbar = `
      <div class="df-hover-toolbar">
        ${canRunNode ? `<button class="df-hover-btn" data-action="run-node" title="${tRunNode}" data-tooltip="${tRunNode}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>` : ''}
        ${hasResetable ? `<button class="df-hover-btn" data-action="reset-node" title="${tResetNode}" data-tooltip="${tResetNode}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>` : ''}
        ${hasResults ? `<button class="df-hover-btn" data-action="download-node" title="${tDownloadResults}" data-tooltip="${tDownloadResults}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>` : ''}
        <button class="df-hover-btn df-hover-btn-settings" data-action="settings-node" title="${tSettings}" data-tooltip="${tSettings}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button class="df-hover-btn" data-action="branch-node" title="${tBranch}" data-tooltip="${tBranch}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 6a9 9 0 0 0 9 9"/></svg>
        </button>
        ${hasOutputPort ? `<button class="df-hover-btn df-hover-btn-quickadd" data-action="quick-add-node" title="${tQuickAdd}" data-tooltip="${tQuickAdd}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>` : ''}
        ${hasPrompt ? `<button class="df-hover-btn" data-action="copy-prompt" title="${tCopyPrompt}" data-tooltip="${tCopyPrompt}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><path d="M9 13h8M9 17h6"/></svg>
        </button>` : ''}
        <button class="df-hover-btn" data-action="copy-node" title="${tDuplicate}" data-tooltip="${tDuplicate}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="df-hover-btn danger" data-action="delete-node" title="${tDeleteNode}" data-tooltip="${tDeleteNode}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>`;

    // Note node - LUÔN render FRAME (parity web /app/spaces BaseNode noteStyle — bỏ fallback card vàng).
    // Web luôn frame với NOTE_DEFAULT {w:420,h:280,color:#3b82f6,font:14} khi field thiếu → extension đồng bộ.
    if (type === 'note') {
      const nColor = /^#[0-9a-fA-F]{3,8}$/.test(String(data.note_color || '')) ? data.note_color : '#3b82f6';
      const nW = Math.max(160, Math.min(4000, parseInt(data.note_width, 10) || 420));
      const nH = Math.max(100, Math.min(4000, parseInt(data.note_height, 10) || 280));
      const nFont = Math.max(10, Math.min(128, parseInt(data.note_font_size, 10) || 14));
      // Dùng rgba(hex→rgb, alpha) thay color-mix(...,transparent): color-mix in srgb nội suy premultiplied
      // với transparent-BLACK → kéo màu về đen (sai tông). rgba giữ ĐÚNG màu note_color + alpha để thấy
      // xuyên diagram phía sau. bg alpha thấp (mờ, thấy diagram) — border alpha cao (viền màu rõ, định danh).
      const _h = String(nColor).replace('#', '');
      let _r = 59, _g = 130, _b = 246, _a = 1; // fallback #3b82f6
      if (_h.length === 3) { _r = parseInt(_h[0] + _h[0], 16); _g = parseInt(_h[1] + _h[1], 16); _b = parseInt(_h[2] + _h[2], 16); }
      else if (_h.length === 4) { _r = parseInt(_h[0] + _h[0], 16); _g = parseInt(_h[1] + _h[1], 16); _b = parseInt(_h[2] + _h[2], 16); _a = parseInt(_h[3] + _h[3], 16) / 255; }
      else if (_h.length >= 6) { _r = parseInt(_h.slice(0, 2), 16); _g = parseInt(_h.slice(2, 4), 16); _b = parseInt(_h.slice(4, 6), 16); if (_h.length === 8) _a = parseInt(_h.slice(6, 8), 16) / 255; }
      const _bgA = (0.24 * _a).toFixed(3), _bdA = (0.6 * _a).toFixed(3);
      const frameStyle = `width:${nW}px;height:${nH}px;background:rgba(${_r},${_g},${_b},${_bgA});border:1.5px solid rgba(${_r},${_g},${_b},${_bdA});`;
      const tResize = window.I18n?.t('workflow.noteResizeHint') || 'Kéo để thay đổi kích thước';
      // 8 handle resize (4 góc + 4 cạnh) — parity web BaseNode. Wire mousedown ở DiagramCanvas._initNoteInteractions.
      const resizeHandles = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w']
        .map(c => `<div class="df-note-resize df-note-resize--${c} nodrag" data-corner="${c}" title="${this.escapeAttr(tResize)}"></div>`).join('');
      return `
        <div class="df-node df-node-note df-node-note-frame${nodeHasPortsClass}" data-node-type="note" style="${frameStyle}">
          ${portRailIn}${portRailOut}
          <div class="df-node-body" style="height:100%;box-sizing:border-box;align-items:flex-start;">
            <div class="df-node-note-text" style="font-size:${nFont}px;color:${nColor};font-weight:600;opacity:0.92;line-height:1.45;">${this.escapeHtml(data.note_text || (window.I18n?.t('node.notePlaceholder') || 'Ghi chú...'))}</div>
          </div>
          ${resizeHandles}
          ${hoverToolbar}
        </div>`;
    }

    // Delay node - special card
    if (type === 'delay') {
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="delay" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('delay', this.icons.delay, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-delay-setting">
              <span>${window.I18n?.t('node.wait') || 'Chờ'}</span>
              <input type="number" class="df-node-inline-input df-delay-seconds nodrag" value="${data.delay_seconds || 3}" min="1" max="300" style="width:50px">
              <span>${window.I18n?.t('node.seconds') || 'giây'}</span>
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    // Image node - reference image upload/pick
    if (type === 'image') {
      const refFileIds = data.ref_file_ids || '';
      const refImgUrls = data.ref_img_urls || [];
      // Count from ref_file_ids (normal mode) or ref_img_urls (template mode)
      const refCount = refImgUrls.length > 0
        ? refImgUrls.length
        : (refFileIds ? refFileIds.split(',').filter(Boolean).length : 0);
      const imgSlug = data.slug || '';
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="image" data-zoom="${nodeZoom}" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('image', this.icons.image, name, '', enabled)}
          ${this.zoomToggleBtn()}
          ${this.slugBadge(imgSlug)}
          <div class="df-node-body">
            <div class="df-node-preview${refCount === 0 ? ' ratio-9-16' : ''}" data-node-preview>
              <div class="df-node-preview-placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </div>
            </div>
            <div class="df-node-settings-bar">
              <span class="df-node-tag">${refCount ? refCount + ' ' + (window.I18n?.t('node.images') || 'images') : (window.I18n?.t('node.noImages') || 'No images')}</span>
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    // Download node - special card
    if (type === 'download') {
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="download" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('download', this.icons.download, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-download-info">${window.I18n?.t('node.downloadInfo') || 'Tự động tải kết quả từ node trước'}</div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    // Telegram node - special card
    if (type === 'telegram') {
      const chatId = data.telegram_chat_id || '';
      const sendMode = data.telegram_send_mode === 'group' ? (window.I18n?.t('node.telegramGroup') || 'Nhóm ảnh') : (window.I18n?.t('node.telegramSingle') || 'Từng ảnh');
      const statusText = chatId
        ? `<span class="df-telegram-linked"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ${window.I18n?.t('node.telegramLinked') || 'Linked'}</span>`
        : `<span class="df-telegram-unlinked">${window.I18n?.t('node.notConfigured') || 'Chưa cấu hình'}</span>`;
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="telegram" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('telegram', this.icons.telegram, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-telegram-info">
              ${statusText}
              <span class="df-telegram-mode">${sendMode}</span>
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    // AI Agent node — Phase CG-8 + rename 2026-05-30: chứa text + tuỳ chọn use_ai qua LLM.
    // 2 chế độ: use_ai OFF = pass-through plain text, use_ai ON = submit qua ChatGPT/Gemini
    if (type === 'prompt') {
      const promptText = data.prompt || '';
      const enhance = !!data.use_ai;
      const provider = data.provider || 'chatgpt';
      const resultText = data.result_text || '';
      const resultSource = data.result_source || '';
      const providerLabel = provider === 'gemini' ? 'Gemini' : 'ChatGPT';
      const modeBadge = enhance
        ? `<span class="df-node-tag df-node-tag-mode-image">AI: ${this.escapeHtml(providerLabel)}</span>`
        : `<span class="df-node-tag">Plain</span>`;
      // Phase CG-8 ext: ref images count badge (chỉ khi use_ai=ON)
      const promptRefIds = data.ref_file_ids || '';
      const promptRefCount = promptRefIds ? promptRefIds.split(',').filter(Boolean).length : 0;
      const refBadge = (enhance && promptRefCount > 0)
        ? `<span class="df-node-tag">${promptRefCount} ${window.I18n?.t('node.images') || 'images'}</span>`
        : '';
      // AI Agent rename (2026-05-30): ai_delete_after_run badge — chỉ visible khi use_ai=ON.
      // SVG trash icon (server-only đa ngôn ngữ, KHÔNG emoji 🗑) + red tint background.
      const deleteAfter = !!data.ai_delete_after_run;
      const trashIconSvg = `<svg class="df-node-tag-delete-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/>
        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
      </svg>`;
      const deleteBadge = (enhance && deleteAfter)
        ? `<span class="df-node-tag df-node-tag-delete" title="${this.escapeAttr(window.I18n?.t('node.deleteAfterEnhanceTip') || 'Xoá conversation trên ' + providerLabel + ' sau khi AI run')}">${trashIconSvg}<span class="df-node-tag-delete-text">${this.escapeHtml(window.I18n?.t('node.deleteAfterEnhanceBadge') || 'Auto-delete')}</span></span>`
        : '';
      // AI Agent rename (2026-05-30) — design hiển thị 2 sections khi AI run done:
      //   Section 1: Prompt gốc (edit được qua ✏ button → textarea)
      //   Section 2: AI Output (read-only, label "AI: <provider>")
      // Khi chưa run AI hoặc Use AI OFF: chỉ hiện Section 1.
      const hasEnhancedResult = resultText && enhance && resultText.trim() !== promptText.trim();
      // Last error badge
      const lastError = data.last_error;
      const errorBadge = lastError
        ? `<span class="df-node-tag df-node-tag-error">${this.escapeHtml(lastError)}</span>`
        : '';
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="prompt" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('prompt', this.icons.prompt, name, '', enabled, `<span class="df-node-saved-badge nodrag" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span class="df-node-saved-text"></span></span>`)}
          <div class="df-node-body">
            <!-- Always-edit: textarea luôn editable (bỏ view/edit-btn toggle), char count overlay góc dưới-phải. -->
            <div class="df-inline-prompt-container df-prompt-always-edit" data-mode="edit">
              <textarea
                class="df-inline-prompt-edit"
                placeholder="${this.escapeAttr(window.I18n?.t('node.promptPlaceholder') || 'Nhập prompt...')}"
                rows="10"
                spellcheck="false"
              >${this.escapeHtml(promptText)}</textarea>
            </div>
            <!-- Section 2: AI Output (read-only). 2026-05-30: chỉ hiện khi AI run done + result khác prompt gốc. -->
            ${hasEnhancedResult ? `
              <div class="df-ai-output-container nodrag">
                <div class="df-ai-output-label">
                  <svg class="df-ai-output-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>
                  </svg>
                  <span class="df-ai-output-label-text">${this.escapeHtml(window.I18n?.t('node.aiOutputLabel') || 'AI Output')}</span>
                  <span class="df-ai-output-provider">${this.escapeHtml(providerLabel)}</span>
                </div>
                <div class="df-ai-output-text">${this.formatPromptWithMentions(resultText)}</div>
              </div>
            ` : ''}
            <div class="df-node-settings-bar">
              ${modeBadge}
              ${refBadge}
              ${deleteBadge}
              ${errorBadge}
              ${this.charCountBadge(promptText)}
            </div>
            ${(enhance && promptRefCount > 0) ? `<div class="df-node-ref-preview" data-ref-preview></div>` : ''}
          </div>
          ${hoverToolbar}
        </div>
      `;
    }

    // Phase 1 — Node Reference System: Text node — static text source for @mention composition
    if (type === 'text') {
      const textContent = data.prompt || data.note_text || '';
      const slug = data.slug || '';
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="text" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('text', this.icons.text, name, '', enabled)}
          ${this.slugBadge(slug)}
          <div class="df-node-body">
            <div class="df-inline-prompt-container df-prompt-always-edit" data-mode="edit">
              <textarea
                class="df-inline-prompt-edit"
                placeholder="${this.escapeAttr(window.I18n?.t('node.textPlaceholder') || 'Nhập text...')}"
                rows="10"
                spellcheck="false"
              >${this.escapeHtml(textContent)}</textarea>
            </div>
            <div class="df-node-settings-bar">
              ${this.charCountBadge(textContent)}
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    // Text Template Node — mirror card `text` (inline-edit lưu data.prompt = mẫu), thêm input port.
    if (type === 'text_template') {
      const templateContent = data.prompt || '';
      const slug = data.slug || '';
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="text_template" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('text_template', this.icons.text_template, name, '', enabled)}
          ${this.slugBadge(slug)}
          <div class="df-node-body">
            <div class="df-inline-prompt-container df-prompt-always-edit" data-mode="edit">
              <textarea
                class="df-inline-prompt-edit"
                placeholder="${this.escapeAttr(window.I18n?.t('node.textTemplatePlaceholder') || 'Mẫu: {{input}} — vd: “Ảnh chân dung {{input}}, ánh sáng điện ảnh”')}"
                rows="10"
                spellcheck="false"
              >${this.escapeHtml(templateContent)}</textarea>
            </div>
            <div class="df-node-settings-bar">
              ${this.charCountBadge(templateContent)}
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    // Text Extract Node (2026-05-29): pure regex/JSON parse, tách output text từ upstream.
    // Render: title + slug badge + small info row (mode + marker preview).
    // 2026-05-31: thêm AI Output container hiển thị result_text sau khi run (parity với prompt node).
    if (type === 'condition') {
      const op = data.condition_op || 'has_text';
      const val = data.condition_value || '';
      const opLabel = { has_text: 'Có text', no_text: 'Rỗng', contains: 'Chứa', regex: 'Regex', has_result: 'Có kết quả' }[op] || op;
      const branch = data._active_branch;
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="condition" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('condition', this.icons.condition, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-extract-row">
              <span class="df-node-tag">${this.escapeHtml(opLabel)}</span>
              ${(op === 'contains' || op === 'regex') ? `<span class="df-node-extract-marker" title="${this.escapeAttr(val)}">${this.escapeHtml(val.substring(0, 30)) || '<em>(chưa set)</em>'}</span>` : ''}
              ${branch ? `<span class="df-node-tag" style="margin-left:auto;background:${branch === 'true' ? 'rgba(25,208,123,.2);color:#19d07b' : 'rgba(239,68,68,.2);color:#ef4444'};">→ ${branch === 'true' ? 'TRUE' : 'FALSE'}</span>` : ''}
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    if (type === 'switch') {
      const smode = data.switch_mode || 'contains';
      const modeLabel = { contains: 'Chứa', equals: 'Bằng', regex: 'Regex' }[smode] || smode;
      const cases = [data.switch_case1, data.switch_case2, data.switch_case3].filter(function (v) { return v; });
      const sbranch = data._active_branch;
      const branchLabel = { case1: 'CASE 1', case2: 'CASE 2', case3: 'CASE 3', else: 'MẶC ĐỊNH' }[sbranch];
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="switch" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('condition', this.icons.switch, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-extract-row">
              <span class="df-node-tag">${this.escapeHtml(modeLabel)}</span>
              <span class="df-node-extract-marker" title="${this.escapeAttr(cases.join(' · '))}">${cases.length ? this.escapeHtml(cases.join(' · ').substring(0, 30)) : '<em>(chưa set case)</em>'}</span>
              ${branchLabel ? `<span class="df-node-tag" style="margin-left:auto;background:rgba(61,111,245,.2);color:#3d6ff5;">→ ${branchLabel}</span>` : ''}
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    if (type === 'random_pick') {
      const rpResult = (data.result_text || '').trim();
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="random_pick" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('text', this.icons.random_pick, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-extract-row">
              <span class="df-node-tag">🎲</span>
              <span class="df-node-extract-marker">${window.I18n?.t('node.randomPickHint') || 'Chọn ngẫu nhiên 1 input'}</span>
            </div>
            ${rpResult ? `<div class="df-ai-output-container nodrag" data-extract-output><div class="df-ai-output-text">${this.escapeHtml(rpResult)}</div></div>` : ''}
          </div>
          ${hoverToolbar}
        </div>`;
    }

    if (type === 'prompt_sequence') {
      const psCount = Array.isArray(data.result_scenes) ? data.result_scenes.length : 0;
      const psMode = data.split_mode || 'auto';
      const psResult = (data.result_text || '').trim();
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="prompt_sequence" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('text', this.icons.prompt_sequence, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-extract-row">
              <span class="df-node-tag">≡</span>
              <span class="df-node-extract-marker">${window.I18n?.t('node.promptSequenceHint') || 'Tách scene'} · ${this.escapeHtml(psMode)}${psCount ? ` · ${psCount}` : ''}</span>
            </div>
            ${psResult ? `<div class="df-ai-output-container nodrag" data-extract-output><div class="df-ai-output-text">${this.escapeHtml(psResult.substring(0, 400))}</div></div>` : ''}
          </div>
          ${hoverToolbar}
        </div>`;
    }

    if (type === 'variant_expand') {
      const veRaw = (data.variants || '').trim();
      const veCount = Array.isArray(data.result_scenes) && data.result_scenes.length ? data.result_scenes.length
        : (veRaw ? (veRaw.indexOf('\n') >= 0 ? veRaw.split(/\r?\n+/) : veRaw.split(',')).map(s => s.trim()).filter(Boolean).length : 0);
      const veSrc = (data.variants || '').trim() ? (window.I18n?.t('node.variantExpandCustom') || 'tuỳ chỉnh') : (data.variant_preset || 'ratios');
      const veResult = (data.result_text || '').trim();
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="variant_expand" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('text', this.icons.variant_expand, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-extract-row">
              <span class="df-node-tag">✳</span>
              <span class="df-node-extract-marker">${window.I18n?.t('node.variantExpandHint') || 'Biến thể'} · ${this.escapeHtml(veSrc)}${veCount ? ` · ${veCount}` : ''}</span>
            </div>
            ${veResult ? `<div class="df-ai-output-container nodrag" data-extract-output><div class="df-ai-output-text">${this.escapeHtml(veResult.substring(0, 400))}</div></div>` : ''}
          </div>
          ${hoverToolbar}
        </div>`;
    }

    if (type === 'loop') {
      const lpCount = Array.isArray(data.result_items) ? data.result_items.length : 0;
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="loop" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('text', this.icons.loop, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-extract-row">
              <span class="df-node-tag">↻</span>
              <span class="df-node-extract-marker">${window.I18n?.t('node.loopHint') || 'Lặp từng item'}${lpCount ? ` · ${lpCount} item` : ''}</span>
            </div>
          </div>
          ${hoverToolbar}
        </div>`;
    }

    if (type === 'text_extract') {
      const slug = data.slug || '';
      const mode = data.extract_mode || 'marker';
      const marker = data.extract_marker || data.extract_regex || '';
      const markerLabel = marker
        ? this.escapeHtml(marker.substring(0, 40))
        : `<em>${window.I18n?.t('node.textExtractEmpty') || '(chưa set marker)'}</em>`;
      const modeIcon = mode === 'json' ? '{}' : (mode === 'regex' ? '/.../' : '[ ]');
      const extractResultText = (data.result_text || '').trim();
      const hasExtractResult = !!extractResultText;
      const extractOutputLabel = window.I18n?.t('node.extractOutputLabel') || 'Extracted';
      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="text_extract" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('text', this.icons.text_extract, name, '', enabled)}
          <div class="df-node-body">
            <div class="df-node-extract-row">
              <span class="df-node-tag" title="${this.escapeAttr(mode)}">${modeIcon}</span>
              <span class="df-node-extract-marker" title="${this.escapeAttr(marker)}">${markerLabel}</span>
            </div>
            ${hasExtractResult ? `
              <div class="df-ai-output-container nodrag" data-extract-output>
                <div class="df-ai-output-label">
                  <svg class="df-ai-output-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="8" width="10" height="8" rx="1"/>
                  </svg>
                  <span class="df-ai-output-label-text">${this.escapeHtml(extractOutputLabel)}</span>
                </div>
                <div class="df-ai-output-text">${this.escapeHtml(extractResultText)}</div>
              </div>
            ` : ''}
          </div>
          ${hoverToolbar}
        </div>`;
    }

    // ChatGPT node — tương tự generate nhưng theo provider ChatGPT
    if (type === 'chatgpt') {
      // Mapping ratio key → label hiển thị (5 options) — từ PCM hoặc fallback
      const ratioUiMap = window.ProviderConfigManager?.getRatioUiMapSync?.('chatgpt')
        || { story: '9:16', portrait: '3:4', square: '1:1', landscape: '4:3', widescreen: '16:9' };
      const cgRatio = data.ratio || 'story';
      const cgRatioLabel = ratioUiMap[cgRatio] || cgRatio;
      const cgModel = data.model || 'Instant'; // Instant | Thinking (GPT-5.5)
      // Khung tỷ lệ preview — class chi tiết cho 5 options (chính xác từng ratio)
      const cgRatioClassMap = {
        story:      'ratio-9-16',
        portrait:   'ratio-3-4',
        square:     '',
        landscape:  'ratio-4-3',
        widescreen: 'ratio-16-9'
      };
      const cgRatioClass = cgRatioClassMap[cgRatio] !== undefined ? cgRatioClassMap[cgRatio] : '';

      // Mode pill: use_fallback_prefix (auto/always/never)
      const cgUseFallback = data.use_fallback_prefix || 'auto';
      const cgModeLabelMap = {
        auto: 'Auto',
        always: 'Always',
        never: 'Never',
      };
      const cgModeLabel = cgModeLabelMap[cgUseFallback] || cgUseFallback;

      // Badge error code last_error: RATE_LIMIT/CONTENT_BLOCKED/IMAGE_GEN_FAILED/NETWORK
      const lastError = data.last_error;
      const errorMap = {
        RATE_LIMIT: window.I18n?.t('node.errBadge.rateLimit') || 'Hết lượt',
        CONTENT_BLOCKED: window.I18n?.t('node.errBadge.contentBlocked') || 'Bị chặn',
        IMAGE_GEN_FAILED: window.I18n?.t('node.errBadge.genFailed') || 'Lỗi gen',
        NETWORK: window.I18n?.t('node.errBadge.network') || 'Mạng'
      };
      const errorLabel = lastError && errorMap[lastError] ? errorMap[lastError] : '';
      const errorBadge = errorLabel ? `<span class="df-node-tag df-node-tag-error">${errorLabel}</span>` : '';

      const cgRefFileIds = data.ref_file_ids || '';
      const cgRefCount = cgRefFileIds ? cgRefFileIds.split(',').filter(Boolean).length : 0;

      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="chatgpt" data-provider="openai" data-zoom="${nodeZoom}" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          ${this.renderProviderBadge('chatgpt')}
          ${canRunNode ? this.runNodeCornerBtn() : ''}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('chatgpt', headerIcon, name, '', enabled)}
          ${this.zoomToggleBtn()}
          <div class="df-node-body">
            <div class="df-node-preview-wrap">
              <div class="df-node-preview ${cgRatioClass}" data-node-preview>
                <div class="df-node-preview-placeholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>
              </div>
              ${prompt ? `<div class="df-node-prompt df-node-prompt-overlay nodrag" title="${this.escapeHtml(prompt)}">${this.escapeHtml(prompt)}</div>` : ''}
            </div>
            <div class="df-node-settings-bar">
              <button type="button" class="df-node-tag df-node-tag-editable" data-setting="chatgptModel" title="${window.I18n?.t('node.modelPill') || 'Model'}" data-tooltip="${window.I18n?.t('node.modelPill') || 'Model'}"><span>${this.escapeHtml(cgModel)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              <button type="button" class="df-node-tag df-node-tag-editable" data-setting="chatgptRatio" title="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}" data-tooltip="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}"><span>${this.escapeHtml(cgRatioLabel)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              <button type="button" class="df-node-tag df-node-tag-editable" data-setting="chatgptMode" title="${window.I18n?.t('workflow.chatgptMode') || 'Chế độ submit'}" data-tooltip="${window.I18n?.t('workflow.chatgptMode') || 'Chế độ submit'}"><span>${this.escapeHtml(cgModeLabel)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              ${errorBadge}
            </div>
            ${cgRefCount > 0 ? `<div class="df-node-ref-preview" data-ref-preview></div>` : ''}
          </div>
          ${hoverToolbar}
        </div>
      `;
    }

    // === GROK NODE === (Phase G-6.1)
    if (type === 'grok') {
      const grokRatio = data.ratio || 'widescreen';
      // Grok ratios: 2:3 / 3:2 / 1:1 / 9:16 / 16:9 (KHÔNG dùng 3:4/4:3 như ChatGPT) — từ PCM hoặc fallback
      const grokRatioUiMap = window.ProviderConfigManager?.getRatioUiMapSync?.('grok')
        || { 'story': '9:16', 'portrait': '2:3', 'square': '1:1', 'landscape': '3:2', 'widescreen': '16:9' };
      const grokRatioLabel = grokRatioUiMap[grokRatio] || grokRatio;
      // Map ratio key → preview ratio class (chi tiết cho từng tỷ lệ)
      // Grok ratios: story=9:16, portrait=2:3, square=1:1, landscape=3:2, widescreen=16:9
      // Chấp nhận CẢ key (story/...) LẪN dimensional (9:16/...) — data.ratio có thể là dimensional do
      // settings sync từ GenTab (aspectRatioSelect.value). Trước fix: chỉ có key → data.ratio='9:16' →
      // undefined → '' → placeholder vuông dù setting là 9:16 (chỉ đúng sau khi re-set node form).
      const grokRatioClassMap = {
        story: 'ratio-9-16', '9:16': 'ratio-9-16',
        portrait: 'ratio-2-3', '2:3': 'ratio-2-3',
        square: '', '1:1': '',
        landscape: 'ratio-3-2', '3:2': 'ratio-3-2',
        widescreen: 'ratio-16-9', '16:9': 'ratio-16-9'
      };
      const grokRatioClass = grokRatioClassMap[grokRatio] !== undefined ? grokRatioClassMap[grokRatio] : '';
      const grokMode = data.grok_mode || data.mode || 'image';
      const grokRefFileIds = data.ref_file_ids || '';
      const grokRefCount = grokRefFileIds ? grokRefFileIds.split(',').filter(Boolean).length : 0;
      const grokModeLabel = grokMode === 'video' ? 'Video' : 'Image';
      // Grok image quality (speed/quality) — chỉ khi mode=image
      const grokImageQuality = data.grok_image_quality || 'speed';
      const grokQualityLabel = grokImageQuality === 'quality'
        ? (window.I18n?.t('grok.imageQualityQuality') || 'Chất lượng')
        : (window.I18n?.t('grok.imageQualitySpeed') || 'Nhanh');
      // Grok video settings — chỉ khi mode=video
      const grokDuration = data.grok_duration || '6s';
      const grokResolution = data.grok_resolution || '720p';

      return `
        <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="grok" data-provider="grok" data-media-type="${grokModeLabel}" data-zoom="${nodeZoom}" data-enabled="${enabled}">
          ${portRailIn}${portRailOut}
          ${this.renderProviderBadge('grok')}
          ${canRunNode ? this.runNodeCornerBtn() : ''}
          <div class="df-node-status ${status}"></div>
          ${this._thumbHeader('grok', headerIcon, name, '', enabled)}
          ${this.zoomToggleBtn()}
          <div class="df-node-body">
            <div class="df-node-preview-wrap">
              <div class="df-node-preview ${grokRatioClass}" data-node-preview>
                <div class="df-node-preview-placeholder">
                  ${this._previewPlaceholderIcon(grokMode === 'video')}
                </div>
              </div>
              ${prompt ? `<div class="df-node-prompt df-node-prompt-overlay nodrag" title="${this.escapeHtml(prompt)}">${this.escapeHtml(prompt)}</div>` : ''}
            </div>
            <div class="df-node-settings-bar">
                <button type="button" class="df-node-tag df-node-tag-editable" data-setting="grokMode" title="${window.I18n?.t('node.modeGrok') || 'Mode (Image/Video)'}" data-tooltip="${window.I18n?.t('node.modeGrok') || 'Mode (Image/Video)'}"><span>${grokModeLabel}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              <button type="button" class="df-node-tag df-node-tag-editable" data-setting="grokRatio" title="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}" data-tooltip="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}"><span>${this.escapeHtml(grokRatioLabel)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              ${grokMode === 'image' ? `
              <button type="button" class="df-node-tag df-node-tag-editable" data-setting="grokImageQuality" title="${window.I18n?.t('workflow.grokImageQuality') || 'Chất lượng ảnh'}" data-tooltip="${window.I18n?.t('workflow.grokImageQuality') || 'Chất lượng ảnh'}"><span>${this.escapeHtml(grokQualityLabel)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              ` : `
              <button type="button" class="df-node-tag df-node-tag-editable" data-setting="grokDuration" title="${window.I18n?.t('workflow.grokDuration') || 'Thời lượng'}" data-tooltip="${window.I18n?.t('workflow.grokDuration') || 'Thời lượng'}"><span>${this.escapeHtml(grokDuration)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              <button type="button" class="df-node-tag df-node-tag-editable" data-setting="grokResolution" title="${window.I18n?.t('workflow.grokResolution') || 'Resolution'}" data-tooltip="${window.I18n?.t('workflow.grokResolution') || 'Resolution'}"><span>${this.escapeHtml(grokResolution)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
              `}
              </div>
            ${grokRefCount > 0 ? `<div class="df-node-ref-preview" data-ref-preview></div>` : ''}
          </div>
          ${hoverToolbar}
        </div>
      `;
    }

    // Generate card (redesigned - larger with preview + inline settings)
    const refFileIds = data.ref_file_ids || '';
    const refCount = refFileIds ? refFileIds.split(',').filter(Boolean).length : 0;

    return `
      <div class="df-node ${!enabled ? 'df-node-disabled' : ''}${nodeHasPortsClass} df-node-thumb" data-node-type="${type}" data-media-type="${mediaType}" data-provider="${this.getNodeProvider(type) || ''}" data-zoom="${nodeZoom}" data-enabled="${enabled}">
        ${portRailIn}${portRailOut}
        ${this.renderProviderBadge(type)}
        ${canRunNode ? this.runNodeCornerBtn() : ''}
        <div class="df-node-status ${status}"></div>
        ${this._thumbHeader(config.color, headerIcon, name, '', enabled)}
        ${this.zoomToggleBtn()}
        <div class="df-node-body">
          <div class="df-node-preview-wrap">
            <div class="df-node-preview ${ratioClass}" data-node-preview>
              <div class="df-node-preview-placeholder">
                ${this._previewPlaceholderIcon(isVideo)}
              </div>
            </div>
            ${prompt ? `<div class="df-node-prompt df-node-prompt-overlay nodrag" title="${this.escapeHtml(prompt)}">${this.escapeHtml(prompt)}</div>` : `<div class="df-node-prompt-hint nodrag">${this.escapeHtml(isVideo ? (window.I18n?.t('node.describeVideoHint') || 'Mô tả video bạn muốn tạo…') : (window.I18n?.t('node.describeImageHint') || 'Mô tả ảnh bạn muốn tạo…'))}</div>`}
          </div>
          <div class="df-node-settings-bar">
              <div class="df-qty-stepper" title="${window.I18n?.t('node.quantityPill') || 'Số lượng'}" data-tooltip="${window.I18n?.t('node.quantityPill') || 'Số lượng'}"><button type="button" class="df-qty-btn nodrag" data-qty-delta="-1" aria-label="−">−</button><span class="df-qty-value" data-qty-value>${quantity}x</span><button type="button" class="df-qty-btn nodrag" data-qty-delta="1" aria-label="+">+</button></div>
            <button type="button" class="df-node-tag df-node-tag-editable" data-setting="mediaType" title="${window.I18n?.t('node.mediaTypePill') || 'Loại media'}" data-tooltip="${window.I18n?.t('node.mediaTypePill') || 'Loại media'}"><span>${mediaType}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
            ${model ? `<button type="button" class="df-node-tag df-node-tag-editable" data-setting="model" title="${window.I18n?.t('node.modelPill') || 'Model'}" data-tooltip="${window.I18n?.t('node.modelPill') || 'Model'}"><span>${this.escapeHtml(model)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>` : `<button type="button" class="df-node-tag df-node-tag-editable df-node-tag-empty" data-setting="model" title="${window.I18n?.t('node.modelPill') || 'Model'}" data-tooltip="${window.I18n?.t('node.modelPill') || 'Model'}"><span>${window.I18n?.t('node.modelAuto') || 'Auto'}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>`}
            ${isVideo ? `<button type="button" class="df-node-tag df-node-tag-editable" data-setting="videoInputType" title="${window.I18n?.t('node.videoInputTypePill') || 'Chế độ video'}" data-tooltip="${window.I18n?.t('node.videoInputTypePill') || 'Chế độ video'}"><span>${this.escapeHtml(videoInputTypeDisplay)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>` : ''}
            ${isVideo ? `<button type="button" class="df-node-tag df-node-tag-editable" data-setting="videoDuration" title="${window.I18n?.t('node.durationPill') || 'Thời lượng'}" data-tooltip="${window.I18n?.t('node.durationPill') || 'Thời lượng'}"><span>${videoDuration}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>` : ''}
            ${ratio ? `<button type="button" class="df-node-tag df-node-tag-editable" data-setting="ratio" title="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}" data-tooltip="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}"><span>${this.escapeHtml(ratio)}</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>` : `<button type="button" class="df-node-tag df-node-tag-editable df-node-tag-empty" data-setting="ratio" title="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}" data-tooltip="${window.I18n?.t('node.ratioPill') || 'Tỷ lệ'}"><span>—</span><svg class="df-pill-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>`}
            </div>
          ${refCount > 0 ? `<div class="df-node-ref-preview" data-ref-preview></div>` : ''}
        </div>
        ${hoverToolbar}
      </div>
    `;
  },

  /**
   * Default data cho node MỚI tạo — đồng bộ với sidebar form defaults.
   * Tránh mismatch: pill "—" / "Auto" trong khi sidebar form có default 16:9 / Nano Banana Pro.
   * Caller (addNode) merge defaults này vào data trước khi gọi editor.addNode.
   *
   * @param {string} type - Node type
   * @param {object|null} settings - User af_settings object (nullable). Khi null/thiếu key, fallback hardcode defaults.
   */
  _mapVnRatioToNumeric(vnRatio) {
    if (!vnRatio) return null;
    const map = { 'Dọc': '9:16', 'Ngang': '16:9', 'Vuông': '1:1' };
    return map[vnRatio] || vnRatio; // pass-through nếu đã numeric
  },

  /**
   * 2026-05-25: Client-side normalize required defaults — mirror backend
   * `WorkflowDataHealer::normalizeRequiredDefaults` (5 rules).
   *
   * Mục đích: tránh bug "display drift" — vd `media_type='Video'` nhưng `video_input_type=null`
   * → diagram render Ingredients-style (2 ports) trong khi form auto-select 'Frames' (browser
   * default cho option đầu).
   *
   * Wire vào các path tạo node có nguy cơ propagate empty values:
   *  - `DiagramCanvas.duplicateNode` (spread source data)
   *  - `_copyNodeToClipboard` + `_pasteNodeFromClipboard` (deep clone source)
   *  - `DiagramCanvas.loadWorkflow` (legacy/clone data từ server)
   *
   * Mutate in-place + return cho convenience chain.
   *
   * @param {Object} data - Node data object
   * @returns {Object} same reference, mutated
   */
  normalizeNodeData(data) {
    if (!data || typeof data !== 'object') return data;
    const t = data.node_type;

    // Generate node defaults
    if (t === 'generate') {
      if (!data.media_type) data.media_type = 'Image';
      else {
        // Normalize case: AI/MCP/import gửi 'image'/'video' lowercase → editor so 'Image'/'Video' case-sensitive
        // → nút mode không active. Chuẩn hoá về Image/Video.
        const mt = String(data.media_type).toLowerCase();
        if (mt === 'image') data.media_type = 'Image';
        else if (mt === 'video') data.media_type = 'Video';
      }
      // Default flow model khi thiếu (vd node tạo qua MCP không truyền model) → tránh pill hiện "Auto".
      if (!data.model) {
        const isVid = data.media_type === 'Video';
        data.model = window.ModelRegistry?.safeGetDefault?.('flow', isVid ? 'video' : 'image') || data.model;
      }
      if (data.media_type === 'Video') {
        if (!data.video_input_type) {
          // 2026-05-29: đọc default từ StorageSettings (server-tuned qua /admin/default-settings)
          const settingDefault = window.storageSettings?.get?.('defaultVideoInputType');
          data.video_input_type = (settingDefault === 'Ingredients' || settingDefault === 'Frames')
            ? settingDefault : 'Frames';
        }
        if (!data.video_duration) data.video_duration = '6s';
      }
    }
    // ChatGPT node defaults
    else if (t === 'chatgpt') {
      if (!data.use_fallback_prefix) data.use_fallback_prefix = 'auto';
      // Heal model: chatgpt chỉ dùng model chatgpt (Instant/Thinking). Legacy/export cũ luôn set
      // model='Nano Banana 2' (flow default) cho mọi node → reset về chatgpt default để pill +
      // selectChatGPTModel đúng. Chỉ reset nếu model KHÔNG thuộc danh sách model chatgpt.
      const cgModels = window.ModelRegistry?.safeGetValuesList?.('chatgpt', 'image') || ['Instant', 'Thinking'];
      if (!data.model || (cgModels.length > 0 && !cgModels.includes(data.model))) {
        data.model = window.ModelRegistry?.safeGetDefault?.('chatgpt', 'image') || cgModels[0] || 'Instant';
      }
    }
    // Grok node defaults
    else if (t === 'grok') {
      if (!data.grok_mode) data.grok_mode = 'image';
    }
    // AI Agent rename (2026-05-30) — Prompt/AI Agent node: heal stale chrome.storage data.
    // - Pair 1+2 (enhance/enhance_fallback): v1.1.5 PUBLIC client có field → heal cho user
    //   update v1.1.5 → v1.1.6 (chrome.storage cache stale).
    // - Pair 3 (delete_after_enhance): v1.1.5 PUBLIC client KHÔNG có, NHƯNG v1.1.6 dev test
    //   đã ghi field này trước rename → workflow saved có delete_after_enhance=true nhưng
    //   ai_delete_after_run undefined. Heal 1-way để protect dev/test data.
    // 1-way migrate sang keys mới khi user vừa update extension. KHÔNG ghi ngược (backend Node observer lo).
    else if (t === 'prompt') {
      if (data.use_ai === undefined && data.enhance !== undefined) data.use_ai = !!data.enhance;
      if (data.ai_fallback === undefined && data.enhance_fallback !== undefined) data.ai_fallback = !!data.enhance_fallback;
      if (data.ai_delete_after_run === undefined && data.delete_after_enhance !== undefined) data.ai_delete_after_run = !!data.delete_after_enhance;
    }
    // Text Extract Node (2026-05-29): fill defaults nếu thiếu (paste/import workflow cũ)
    else if (t === 'text_extract') {
      if (!data.extract_mode) data.extract_mode = 'marker';
      if (data.extract_strict === undefined) data.extract_strict = false;
      if (!data.extract_multi_match) data.extract_multi_match = 'first';
      if (!data.extract_on_fail) data.extract_on_fail = 'skip_downstream';
    }

    return data;
  },

  getDefaults(type, settings = null) {
    type = this._normalizeType(type);
    switch (type) {
      case 'generate': {
        const mediaType = settings?.defaultGenType || 'Image';
        const isVideo = mediaType === 'Video';

        // Ưu tiên key numeric mới (Settings popup save), fallback legacy VN key
        const userRatio = isVideo
          ? (settings?.defaultVideoRatio || this._mapVnRatioToNumeric(settings?.defaultRatio))
          : (settings?.defaultImageRatio || this._mapVnRatioToNumeric(settings?.defaultRatio));

        // Video chỉ có '16:9'/'9:16' — cap fallback nếu user ratio không tương thích
        const ratio = isVideo
          ? ((userRatio === '16:9' || userRatio === '9:16') ? userRatio : '16:9')
          : (userRatio || '16:9');

        // Strict Server-Only: user pref → ModelRegistry → null (caller xử lý).
        const model = (isVideo ? settings?.defaultVideoModel : settings?.defaultImageModel)
          || window.ModelRegistry?.safeGetDefault('flow', isVideo ? 'video' : 'image')
          || null;
        if (!model) console.debug(`[Tier3] NodeTemplates: flow.${isVideo ? 'video' : 'image'} default model cache miss`);

        // 2026-05-29: video_input_type default từ settings (admin tune qua /admin/default-settings)
        const videoInputDefault = settings?.defaultVideoInputType;
        const videoInputType = (videoInputDefault === 'Ingredients' || videoInputDefault === 'Frames')
          ? videoInputDefault : 'Frames';

        return {
          quantity: 1,
          media_type: mediaType,
          ratio,
          model,
          video_input_type: isVideo ? videoInputType : undefined,
          video_duration: isVideo ? (settings?.defaultVideoDuration || '6s') : undefined,
          // Flow Voice Selector — default null (Random voice). Picker chỉ hiển thị khi model.config.supports_voice=true
          voice_slug: null,
          voice_search_value: null,
          // Flow Character Selector — default null. Picker hiển thị khi model.config.supports_character=true (cả image+video)
          character_slug: null,
          character_search_value: null,
          auto_download: false,
          download_resolution: settings?.downloadResolution || '1k',
          video_download_resolution: '720p',
          enabled: true,
          status: 'pending',
        };
      }
      case 'chatgpt':
        return {
          ratio: settings?.chatgptDefaultRatio || 'story',
          use_fallback_prefix: 'auto',
          timeout_ms: 120000,
          max_ref_images: 4,
          auto_download: false,
          enabled: true,
          status: 'pending',
        };
      case 'grok':
        return {
          ratio: settings?.grokDefaultRatio || 'widescreen',
          grok_mode: settings?.grokDefaultMode || 'image',
          grok_duration: settings?.grokDefaultDuration || '6s',
          grok_resolution: settings?.grokDefaultResolution || '720p',
          grok_image_quality: settings?.grokDefaultImageQuality || 'speed',
          quantity: 1,
          timeout_ms: 180000,
          max_ref_images: 4,
          auto_download: false,
          enabled: true,
          status: 'pending',
        };
      case 'prompt':
        // AI Agent rename (2026-05-30) — extension v1.1.6+ chỉ dùng keys mới.
        // Backend Node observer mirror sang legacy enhance/enhance_fallback cho v1.1.3 client backward compat.
        // ai_delete_after_run default TRUE (2026-05-30 UX): khi user enable AI, conversation auto-cleanup
        // → tránh history rác ChatGPT/Gemini. User có thể tắt nếu muốn keep conversation.
        return {
          use_ai: false,
          ai_fallback: true,
          ai_delete_after_run: true,
          provider: 'chatgpt',
          timeout_sec: 60,
          max_ref_images: 4,
          enabled: true,
          status: 'pending',
        };
      case 'delay':
        return { delay_seconds: 3, enabled: true, status: 'pending' };
      case 'download':
        return {
          download_resolution: settings?.downloadResolution || '1k',
          download_folder: '',
          // 2026-06-03: default template descriptive cho user — bao gồm node name, prompt
          // upstream, date, time, index. User có thể clear/override qua form input.
          download_file_template: '{node}_{prompt}_{date}_{time}_{index}',
          download_collect_all: false,
          enabled: true,
          status: 'pending',
        };
      case 'telegram':
        return { telegram_send_mode: 'group', telegram_message: '', enabled: true, status: 'pending' };
      case 'image':
        return { max_ref_images: 1, enabled: true, status: 'pending' };
      // Phase 1 — Node Reference System: Text node defaults
      case 'text':
        return { prompt: '', slug_auto: true, enabled: true, status: 'pending' };
      // Text Extract Node (2026-05-29): pure regex/JSON parse defaults
      case 'text_extract':
        return {
          extract_mode: 'marker',
          extract_marker: '',
          extract_regex: '',
          extract_strict: false,
          extract_multi_match: 'first',
          extract_on_fail: 'skip_downstream',
          slug_auto: true,
          enabled: true,
          status: 'pending',
        };
      case 'note':
        // Parity web nodeDefaults: note = group frame lớn (1260×840) bọc nhóm node, kéo di chuyển cả nhóm. Font 32px.
        return { note_text: '', note_color: '#3b82f6', note_font_size: 32, note_width: 1260, note_height: 840, enabled: true };
      default:
        return { enabled: true, status: 'pending' };
    }
  },

  // Create palette item HTML
  createPaletteItem(type) {
    const config = this.getType(type);
    const icon = this.icons[type];
    const isComingSoon = !!config.comingSoon;
    const comingSoonLabel = window.I18n?.t('workflow.comingSoon') || 'Sắp ra mắt';

    return `
      <div class="node-palette-item${isComingSoon ? ' node-palette-item--coming-soon' : ''}"
           data-node-type="${type}"
           draggable="${isComingSoon ? 'false' : 'true'}"
           ${isComingSoon ? `data-disabled="true" title="${comingSoonLabel}"` : ''}>
        <div class="node-palette-item-icon df-node-icon ${config.color}">${icon}</div>
        <div class="node-palette-item-name">${config.name}</div>
        ${isComingSoon ? `<span class="node-palette-item-badge">${comingSoonLabel}</span>` : ''}
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  },

  escapeAttr(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /** Format số nguyên với dấu chấm phân nhóm nghìn (locale-independent): 10000 → "10.000". */
  _fmtThousands(n) {
    return String(n >>> 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  },

  /** prompt_max_length từ ValidationRules (server-only, fallback 5000). */
  promptMaxLength() {
    return window.ValidationRules?.safeGetInt?.('prompt_max_length', 5000) ?? 5000;
  },

  /** Badge "count/limit" hiển thị bên phải settings bar của prompt/text node. */
  charCountBadge(text) {
    const len = (text || '').length;
    const max = this.promptMaxLength();
    const over = len > max;
    const title = window.I18n?.t?.('node.charCountTip') || `Số ký tự / giới hạn (prompt_max_length=${this._fmtThousands(max)})`;
    return `<span class="df-node-char-count${over ? ' df-over-limit' : ''}" title="${this.escapeAttr(title)}">${this._fmtThousands(len)}/${this._fmtThousands(max)}</span>`;
  },

  /**
   * Render prompt với @slug mentions được highlight (label color giống .df-node-tag-mode-image).
   * Escape HTML first, sau đó replace @slug pattern → span wrap.
   * Slug pattern: lowercase + digit + underscore, 1-30 chars (match MAX_MENTIONS regex).
   */
  formatPromptWithMentions(text) {
    if (!text) return '';
    const escaped = this.escapeHtml(text);
    // @slug pattern (match WorkflowEditor _parseMentions regex)
    // Phải dùng pattern trên text đã escape — `&` đã thành `&amp;` nên @slug vẫn intact
    return escaped.replace(/@([a-z][a-z0-9_]{0,29})/gi,
      '<span class="df-prompt-mention">@$1</span>');
  },

  // Phase WK-1.2: Resolve danh sách port hiển thị cho 1 node theo data hiện tại.
  // Hỗ trợ dynamic ports qua `visibleWhen` flag (vd frame_1/frame_2 chỉ visible khi media_type=Video + Frames).
  // Hỗ trợ dynamic port type qua `dynamicType` (vd port `media` của generate đổi type theo data.media_type).
  //
  // Group D: Đọc ports từ getType() (merged local + server). Server override ports
  // nếu admin update qua admin panel. Resolver logic (visibleWhen, dynamicType) VẪN ở
  // extension — backend chỉ store string identifiers.
  // Doc: data/plans/NODE_RESOLVERS_REGISTRY.md
  getNodePorts(type, data = {}) {
    type = this._normalizeType(type);
    // Group D: dùng getType() để merged ports (server override local).
    // Fallback this.types[type] nếu getType chưa available (vd: trong test).
    const merged = this.getType ? this.getType(type) : null;
    const config = merged || this.types[type];
    if (!config?.ports) return { in: [], out: [] };

    const filterDynamic = (port) => {
      if (!port.visibleWhen) return true;
      if (port.visibleWhen === 'isVideoFrames') {
        // UI 2026-05-27: ẩn port frame nếu model set config.supports_frames=false.
        const flowAdapter = window.ProviderRegistry?.get?.('flow');
        const modelSupportsFrames = typeof flowAdapter?.supportsFrames === 'function'
          ? flowAdapter.supportsFrames(data.model) : true;
        return data.media_type === 'Video' && data.video_input_type === 'Frames' && modelSupportsFrames;
      }
      if (port.visibleWhen === 'isVideoIngredient') {
        // 2026-06-06: Port video_ref visible khi:
        //   - media_type = 'Video'
        //   - video_input_type = 'Ingredients'
        //   - model có config.supports_ref_video=true (vd Omni Flash)
        // Pattern đồng nhất với isVideoFrames (line trên), Server-Only qua FlowAdapter.
        const flowAdapter = window.ProviderRegistry?.get?.('flow');
        const modelSupportsRefVideo = typeof flowAdapter?.supportsRefVideo === 'function'
          ? flowAdapter.supportsRefVideo(data.model) : false;
        return data.media_type === 'Video' && data.video_input_type === 'Ingredients' && modelSupportsRefVideo;
      }
      if (port.visibleWhen === 'enhance') {
        // AI Agent rename (2026-05-30): port image_ref visible khi use_ai=ON.
        // visibleWhen resolver key giữ 'enhance' để backward compat config server không cần re-seed.
        return !!data.use_ai;
      }
      // Port 1.1.58 VIDEO_NODE_LAST_FRAME: frame out-port chỉ hiện khi node đang tạo VIDEO.
      if (port.visibleWhen === 'isVideo') {
        return data.media_type === 'Video';
      }
      if (port.visibleWhen === 'isGrokVideo') {
        return (data.grok_mode || data.mode) === 'video';
      }
      return true;
    };

    // Resolve dynamicType: vd port.dynamicType='media_type' + data.media_type='Video' → type='video'
    // CRITICAL: trả về clone (spread) để KHÔNG mutate config.types[type].ports gốc.
    const resolveDynamicType = (port) => {
      if (!port.dynamicType) return port;
      if (port.dynamicType === 'media_type') {
        const mt = data.media_type || 'Image';
        return { ...port, type: mt === 'Video' ? 'video' : 'image' };
      }
      // Phase G-6: Grok output port resolve theo data.grok_mode ('image' | 'video').
      // Cần thiết để port type sync với mode → PORT_COMPAT block edges incompat
      // (vd: video result → image ref / frame port).
      if (port.dynamicType === 'grok_mode') {
        const mode = data.grok_mode || data.mode || 'image';
        return { ...port, type: mode === 'video' ? 'video' : 'image' };
      }
      return port;
    };

    return {
      in: (config.ports.in || []).filter(filterDynamic).map(resolveDynamicType),
      out: (config.ports.out || []).filter(filterDynamic).map(resolveDynamicType),
    };
  },

  // Server-fetched node types cache
  _serverTypes: null,
  _serverTypesFetching: false,
  _serverTypesPromise: null,
  _serverTypesFetchedAt: 0,
  _SERVER_TYPES_TTL: 60 * 60 * 1000, // [Phase 5 2026-05-24] 1h — ConfigVersionPoller + SSE invalidate (admin tweak rare)
  _lastVersion: null,                // [Phase 5] cached version từ response.meta.version

  /**
   * Fetch node types từ server và cache
   * @returns {Promise<Object>} Map of type -> config
   */
  async fetchFromServer() {
    // Local/offline: node types phục vụ 100% từ local node map (getMergedTypes fallback).
    // KHÔNG gọi server — _doFetch dùng raw fetch() bypass ApiClient kill-switch → offline sẽ
    // treo tới ~8s (AbortController timeout) MỖI lần mở node picker + rò 1 outbound request
    // (vi phạm cam kết 100% offline). Trả rỗng ngay + set fetchedAt để không thử lại.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      this._serverTypes = {};
      this._serverTypesFetchedAt = Date.now();
      return {};
    }
    // Return cached if still fresh (TTL)
    if (this._serverTypes && this._serverTypesFetchedAt &&
        (Date.now() - this._serverTypesFetchedAt < this._SERVER_TYPES_TTL)) {
      console.log('[NodeTemplates] fetchFromServer → returning cached', Object.keys(this._serverTypes).length, 'types');
      return this._serverTypes;
    }
    console.log('[NodeTemplates] fetchFromServer → fetching fresh data...');

    // Return existing promise if fetching
    if (this._serverTypesFetching && this._serverTypesPromise) {
      return this._serverTypesPromise;
    }

    this._serverTypesFetching = true;
    this._serverTypesPromise = this._doFetch();

    try {
      const result = await this._serverTypesPromise;
      this._serverTypes = result;
      this._serverTypesFetchedAt = Date.now();
      return result;
    } finally {
      this._serverTypesFetching = false;
    }
  },

  async _doFetch() {
    try {
      const baseUrl = window.ApiBaseConfig.get();
      const headers = { 'Content-Type': 'application/json' };
      // Anti-clone: X-Extension-Id để pass VerifyExtensionId middleware khi toggle ON
      try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('NodeTemplates#_doFetch', _); }
      // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
      try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${baseUrl}/workflow-node-types`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('NodeTemplates#_doFetch', _); }
      try {
        const manifestVersion = chrome?.runtime?.getManifest?.()?.version;
        if (manifestVersion) headers['X-Ext-Version'] = manifestVersion;
      } catch (e) { /* ignore — chrome.runtime not available */ }
      // Include bearer token for feature gate filtering (backend detectUser từ token)
      try {
        const token = window.authManager?.token;
        if (token) headers['Authorization'] = `Bearer ${token}`;
      } catch (e) { /* ignore — authManager not available */ }

      console.log('[NodeTemplates] Fetching from:', `${baseUrl}/workflow-node-types`, 'token:', !!headers['Authorization']);

      // Timeout 8s — tránh sidebar đứng hình trên mạng chậm.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let resp;
      try {
        resp = await fetch(`${baseUrl}/workflow-node-types`, {
          method: 'GET',
          headers,
          // BẮT BUỘC `no-store` — chống Chrome HTTP cache stale entry sau khi admin
          // deactivate node type (vd migration deactivate angles/list/upscale).
          // Cùng pattern với background.js apiRequest cho /entitlements.
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!resp.ok) {
        console.warn('[NodeTemplates] Failed to fetch node types from server:', resp.status);
        return {};
      }

      const json = await resp.json();
      if (!json.success || !Array.isArray(json.data)) {
        console.warn('[NodeTemplates] Invalid response:', { success: json.success, dataType: typeof json.data, dataLength: json.data?.length });
        return {};
      }
      console.log('[NodeTemplates] Server returned', json.data.length, 'node types');
      // [Phase 5] Persist version từ meta cho ConfigVersionPoller diff
      if (json.meta && typeof json.meta.version !== 'undefined') {
        this._lastVersion = json.meta.version;
      }

      // Convert array to map. Group D: extract đầy đủ config schema:
      //   - metadata (name, description, icon, color, comingSoon, sortOrder)
      //   - ports (server override local types ports)
      //   - defaults (model, ratio, quantity, media_type)
      //   - validation (prompt_max_length per node, etc.)
      //   - ui (terminal_sink, show_model_picker, etc.)
      //   - raw_config (everything else — provider-specific configs like supported_ratios)
      const serverMap = {};
      for (const item of json.data) {
        const cfg = item.config || {};
        serverMap[item.type] = {
          // Metadata
          name: item.name,
          description: item.description,
          icon: item.icon || null,
          color: item.color || item.type,
          comingSoon: item.coming_soon === true || item.coming_soon === 1,
          sortOrder: item.sort_order ?? 999,
          // Group D: Schema từ config JSON
          ports: cfg.ports || null,           // null = giữ local ports
          defaults: cfg.defaults || {},
          validation: cfg.validation || {},
          ui: cfg.ui || {},
          // Raw config — provider-specific fields (max_ref_images, supported_modes, ratio_ui_map, etc.)
          // Vẫn giữ để code legacy đọc trực tiếp config.X (vd: chatgpt fallback_prompt_prefix)
          config: cfg,
        };
      }

      console.log('[NodeTemplates] Loaded', Object.keys(serverMap).length, 'node types from server:',
        Object.entries(serverMap).map(([k, v]) => `${k}="${v.name}"`).join(', '));
      return serverMap;
    } catch (err) {
      console.warn('[NodeTemplates] Error fetching node types:', err.message);
      return {};
    }
  },

  /**
   * Get merged config for a node type (server overrides local)
   * @param {string} type - Node type key
   * @returns {Object} Config object
   */
  getType(type) {
    type = this._normalizeType(type);
    const localConfig = this.types[type] || this.types.generate;
    const serverConfig = this._serverTypes?.[type];

    if (!serverConfig) {
      // console.debug('[NodeTemplates] getType', type, '→ local only (no server config)');
      return localConfig;
    }
    // console.debug('[NodeTemplates] getType', type, '→ merged (server name:', serverConfig.name, ')');

    // Group D: Server values override local cho TOÀN BỘ schema:
    //   - Metadata (name, description, color, icon, comingSoon, sortOrder)
    //   - Ports (server.ports override local.ports nếu có — admin có thể thêm/xoá port qua admin panel)
    //   - Defaults (model, ratio, quantity, media_type — admin tweak được)
    //   - Validation (prompt_max_length per node, etc.)
    //   - UI (terminal_sink, show_model_picker, etc.)
    //   - Raw config (provider-specific fields)
    //
    // CRITICAL: Ports server CHỈ chứa string identifiers (visibleWhen=isVideoFrames,
    // dynamicType=media_type). Resolver logic vẫn ở getNodePorts (extension) —
    // xem data/plans/NODE_RESOLVERS_REGISTRY.md.
    return {
      ...localConfig,
      // Metadata override
      name: serverConfig.name || localConfig.name,
      description: serverConfig.description || localConfig.description,
      color: serverConfig.color || localConfig.color,
      icon: serverConfig.icon || localConfig.icon,
      comingSoon: serverConfig.comingSoon ?? localConfig.comingSoon ?? false,
      sortOrder: serverConfig.sortOrder ?? localConfig.sortOrder ?? 999,
      // Schema override (Group D — NEW). Port: server cấp STRUCTURE (name/type/visibleWhen/
      // dynamicType), nhưng LABEL lấy từ local (i18n live qua getter) — server label là VI
      // hardcode → nếu dùng thẳng thì tooltip port chỉ tiếng Việt. Match theo port name.
      ports: this._mergePortsI18nLabel(serverConfig.ports, localConfig.ports),
      defaults: { ...(localConfig.defaults || {}), ...(serverConfig.defaults || {}) },
      validation: { ...(localConfig.validation || {}), ...(serverConfig.validation || {}) },
      ui: { ...(localConfig.ui || {}), ...(serverConfig.ui || {}) },
      // Raw config merged — provider-specific fields readable trực tiếp
      config: { ...(localConfig.config || {}), ...(serverConfig.config || {}) },
    };
  },

  /**
   * Merge port: giữ STRUCTURE từ server (admin có thể thêm/xoá port) nhưng dùng LABEL i18n từ
   * local (server label là VI hardcode). Match theo port name; port server-only (không có local
   * match) giữ label server. Resolver visibleWhen/dynamicType (chỉ ở label local) cũng được vá.
   */
  // Map server VI label → i18n key (fallback cho node KHÔNG có trong local types, vd text_extract).
  // Server config chỉ có 1 label VI duy nhất → bridge sang i18n key để localize tooltip port.
  _PORT_LABEL_I18N: {
    'Ảnh tham chiếu': 'node.portRefImages', 'Prompt text': 'node.portPromptText',
    'Frame 1 (video)': 'node.portFrame1', 'Frame 2 (video)': 'node.portFrame2',
    'Video tham chiếu': 'node.portRefVideo', 'Kết quả': 'node.portResult',
    'Files cần tải': 'node.portFilesToDownload', 'Input pass-through': 'node.portInputPassthrough',
    'Output (sau delay)': 'node.portOutputAfterDelay', 'Ảnh ref': 'node.portRefImage',
    'Files gửi Telegram': 'node.portFilesToTelegram', 'Pass-through': 'node.portPassthrough',
    'Ảnh ChatGPT': 'node.portChatgptImages', 'Prompt upstream': 'node.portPromptUpstream',
    'Result text': 'node.portResultText', 'Text output': 'node.portTextOutput',
    'Text upstream': 'node.portTextUpstream', 'Extracted text': 'node.portExtractedText',
  },

  _mergePortsI18nLabel(serverPorts, localPorts) {
    if (!serverPorts) return localPorts;
    const idx = (arr) => { const m = {}; (arr || []).forEach(p => { if (p?.name) m[p.name] = p; }); return m; };
    const localIn = idx(localPorts?.in);
    const localOut = idx(localPorts?.out);
    const tr = (key, fb) => { const v = window.I18n?.t?.(key); return (v && v !== key) ? v : fb; };
    const mergeSide = (sidePorts, localMap) => (sidePorts || []).map(sp => {
      // 1) local port cùng name → label i18n (đã resolve live qua getter)
      const lp = localMap[sp.name];
      if (lp && lp.label) return { ...sp, label: lp.label };
      // 2) fallback: map VI label server → i18n key (node không có local, vd text_extract)
      const key = sp.label && this._PORT_LABEL_I18N[sp.label];
      if (key) return { ...sp, label: tr(key, sp.label) };
      return sp;
    });
    return { in: mergeSide(serverPorts.in, localIn), out: mergeSide(serverPorts.out, localOut) };
  },

  /**
   * Get all types merged with server data, sorted by sortOrder
   * @returns {Object} Map of type -> config (sorted by sortOrder)
   */
  getMergedTypes() {
    const local = this.types;
    const server = this._serverTypes || {};

    console.log('[NodeTemplates] getMergedTypes - local keys:', Object.keys(local).length, 'server keys:', Object.keys(server).length);

    const merged = {};
    // Server-Only: khi server ĐÃ load, type không nằm trong danh sách active server-side
    // (admin tắt is_active trên /admin/workflow-node-types, vd delay, hoặc placeholder
    // transform/condition/merge/output) → KHÔNG đưa vào picker. Chỉ fallback local khi
    // server CHƯA load (cold-start) để picker không rỗng.
    const serverLoaded = Object.keys(server).length > 0;

    // Merge local với server values
    for (const [key, localConfig] of Object.entries(local)) {
      const serverConfig = server[key];
      if (serverConfig) {
        merged[key] = {
          ...this.getType(key),
          sortOrder: serverConfig.sortOrder ?? 999,
        };
      } else if (!serverLoaded) {
        // Cold-start fallback (server chưa load) → hiện local. Khi server đã load mà thiếu
        // type này → bỏ qua (đồng bộ is_active từ admin).
        merged[key] = {
          ...localConfig,
          sortOrder: 999,
        };
      }
    }

    // Thêm types chỉ có trên server (không có trong local)
    for (const [key, serverConfig] of Object.entries(server)) {
      if (!merged[key]) {
        merged[key] = {
          ...serverConfig,
          name: serverConfig.name || key,
          color: serverConfig.color || 'generate',
          sortOrder: serverConfig.sortOrder ?? 999,
        };
      }
    }

    // Sort theo sortOrder và rebuild object
    const sorted = Object.entries(merged)
      .sort((a, b) => (a[1].sortOrder ?? 999) - (b[1].sortOrder ?? 999));

    const result = {};
    for (const [key, config] of sorted) {
      result[key] = config;
    }

    return result;
  },

  /**
   * Clear server cache (call when need refresh)
   */
  clearServerCache() {
    this._serverTypes = null;
    this._serverTypesFetchedAt = 0;
  },

  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi version mismatch.
   * Invalidate cache + force fetch fresh, emit refreshed event để UI re-render.
   */
  async _updateFromVersion(remoteVersion) {
    if (this._lastVersion === remoteVersion) return; // No-op (Polish 3 defensive)
    console.log('[NodeTemplates] Version mismatch:', this._lastVersion, '→', remoteVersion);
    this._serverTypes = null;
    this._serverTypesFetchedAt = 0;
    await this.fetchFromServer();
    if (window.eventBus) {
      window.eventBus.emit('node_types:refreshed', { source: 'version_poller' });
    }
  }
};

// Export
window.NodeTemplates = NodeTemplates;
