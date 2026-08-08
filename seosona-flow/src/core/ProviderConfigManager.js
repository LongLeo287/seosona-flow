/**
 * ProviderConfigManager — Fetch + cache provider configs (DOM selectors) từ backend.
 *
 * Features:
 * - Fetch selectors từ API (cache 1h)
 * - Listen SSE push để update ngay lập tức
 * - Fallback chain support
 * - Hard-coded defaults khi offline
 */
class ProviderConfigManager {
  static _CACHE_KEY = 'seosona_provider_configs';
  static _API_CONFIGS_CACHE_KEY = 'seosona_provider_api_configs';
  static _CACHE_TTL_MS = 4 * 60 * 60 * 1000; // [Phase 5 2026-05-24] 4h — ConfigVersionPoller detect per-provider config_version mismatch
  static _GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h - Phase 3: offline grace period
  static _cache = null;
  static _fetchPromise = null;

  // Phase 3 Test: Enable verbose logging
  static _DEBUG = true;

  // Initiative 4 (rev6): API configs cache riêng (ratios per mode, download_resolutions, error_patterns, ...)
  // Persist vào chrome.storage._API_CONFIGS_CACHE_KEY để content.js đọc được.
  static _apiConfigsCache = null;
  static _apiConfigsFetchPromise = null;

  // Phase 3: Server-Only — _DEFAULT_BASE_URLS and _DEFAULT_URLS REMOVED
  // URL data comes from server via /api/v1/providers/api-configs

  // Phase 3: Minimal bootstrap URLs - chỉ giữ base + tabQuery để extension có thể:
  // 1. Connect tới server (base URL)
  // 2. Detect provider tabs (tabQuery pattern)
  // Các URLs chi tiết (createUrl, localeBase, cdnPatterns) lấy từ server.
  static _BOOTSTRAP_URLS = {
    flow: { base: 'https://labs.google/fx/tools/flow', tabQuery: 'https://labs.google/fx/*' },
    chatgpt: { base: 'https://chatgpt.com', tabQuery: '*://chatgpt.com/*' },
    grok: { base: 'https://grok.com', tabQuery: '*://grok.com/*' },
    gemini: { base: 'https://gemini.google.com', tabQuery: '*://gemini.google.com/*' },
  };

  // Phase 3: Server-Only — all _DEFAULT_* REMOVED (ratios, download_resolutions, max_ref_images, etc.)
  // Data comes from server via /api/v1/providers/api-configs

  // Phase 3: Server-Only — _DEFAULT_RATIO_ARIA_LABELS and _DEFAULTS (DOM selectors) REMOVED
  // DOM selector data comes from server via /api/v1/providers/dom-selectors

  // ───────────────────────────────────────────────────────────────────────
  // LOCAL MODE (offline) — bundled defaults
  //
  // Khi self.SEOSONA_LOCAL_MODE !== false (mặc định true) extension KHÔNG gọi
  // backend. Các default dưới đây được "prime" vào cả in-memory cache lẫn
  // chrome.storage (2 key content.js đọc: seosona_provider_configs +
  // seosona_provider_api_configs) để:
  //   - Sync getters (getRatiosSync, getDownloadResolutionsSync, ...) trả data
  //     hợp lệ thay vì throw ConfigRequiredError.
  //   - content.js _runSelectorWaitLoop() thấy data.flow → flip
  //     _selectorConfigReady=true → KHÔNG hiện overlay "Mất kết nối server",
  //     automation Flow tiếp tục chạy.
  //
  // GHI CHÚ về DOM selectors: giá trị selector Radix thật của Flow do server
  // giữ, KHÔNG có trong repo. Bundled default để `selectors: {}` (rỗng-nhưng-hợp-lệ)
  // — đủ để bỏ overlay + không throw. Nếu user đã có cache selector thật từ
  // phiên online trước, cache đó vẫn được ưu tiên (xem _isLocal priming: chỉ
  // set khi storage chưa có data).
  // ───────────────────────────────────────────────────────────────────────
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  // DOM selectors default cho LOCAL mode. Flow để rỗng (content.js có selector cứng riêng).
  // CHAT (chatgpt/gemini) content-script KHÔNG có fallback cứng → nếu để rỗng thì không gõ/đọc
  // được prompt (Prompt Assistant + i2p hỏng). Bundle selector CÔNG KHAI phổ biến cho các key
  // cốt lõi (gõ/gửi/dừng/tạo chat mới/đọc kết quả). Chỉ dùng khi server rỗng; nhiều fallback để
  // bền với thay đổi DOM. Grok để rỗng (chỉ dùng cho gen ảnh, không thuộc luồng PA text).
  static _LOCAL_DOM_SELECTORS = {"chatgpt":{"base_url":"https://chatgpt.com","config_version":39,"meta":{"version":39},"name":"ChatGPT","selectors":{"assistant_turn":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-testid^=\"conversation-turn-\"][data-turn=\"assistant\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"auth_link":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["a[href*=\"/auth/login\"]","a[href*=\"/auth/signin\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"cdn_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["img[src*=\"estuary/content\"]","img[src*=\"oaiusercontent\"]","img[src*=\"sandboxed.openai\"]","img[src*=\"/backend-api/\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"challenge_overlay":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"dialog\"][data-state=\"open\"]","div[role=\"dialog\"]","[role=\"alertdialog\"]","dialog[open]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"chat_history_home_link":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"href","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["nav[aria-label=\"Chat history\"] a[href=\"/\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"cloudflare_iframe":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["iframe[src*=\"challenges.cloudflare.com\"]","iframe[src*=\"turnstile\"]",".cf-turnstile","[data-cf-turnstile]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"composer":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["#prompt-textarea","div.ProseMirror[role=\"textbox\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"conversation_options_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-testid=\"conversation-options-button\"]","button[aria-label=\"Open conversation options\"]","button[aria-label*=\"conversation options\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"conversation_turn":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"data-testid","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[data-testid^=\"conversation-turn-\"]","[data-turn-id]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"delete_chat_menu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-testid=\"delete-chat-menu-item\"]","[role=\"menuitem\"][data-color=\"danger\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"delete_confirm_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[data-testid=\"delete-conversation-confirm-button\"]","button[data-testid=\"delete-confirm-button\"]","button.btn-danger"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"file_input":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["#upload-photos","input[type=\"file\"][accept*=\"image\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"generated_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["img[alt^=\"Generated image\"]:not([aria-hidden])"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"generating_indicator":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[data-testid^=\"image-gen-loading-state\"]","[aria-label=\"Generating image...\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"image_action_buttons":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[aria-label=\"Like this image\"]","[aria-label=\"Edit image\"]","[aria-label=\"Dislike this image\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"image_mode_pill":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-system-hint-type=\"picture_v2\"]","[data-inline-selection-pill][data-id=\"picture_v2\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"login_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[data-testid=\"login-button\"]","button[data-testid*=\"login\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"menu_items":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[".__menu-item","[role=\"menuitemradio\"]","[role=\"menuitem\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"message_author":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"data-message-author-role","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-message-author-role]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"mode_menu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"menuitemradio\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"model_switcher_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button.__composer-pill[aria-haspopup=\"menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"new_chat_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["a[data-testid=\"create-new-chat-button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"open_menu":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[popover]:popover-open:has(.__menu-item)","[popover]:popover-open","[data-radix-popper-content-wrapper]","div[role=\"menu\"][data-radix-menu-content][data-state=\"open\"]","div[role=\"menu\"][data-state=\"open\"]","[role=\"menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"paragen_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[class*=\"image-paragen-multigen\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"plus_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["#composer-plus-btn","[data-testid=\"composer-plus-btn\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"ratio_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[aria-label=\"Choose image aspect ratio\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"ref_upload_pending":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["form[data-type=\"unified-composer\"] [role=\"group\"] .cursor-wait","div[data-default-action] .cursor-wait"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"remove_ref_image_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[aria-label^=\"Remove file\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"response_text_content":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[".markdown.prose"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"stop_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[aria-label=\"Stop generating\"]","[data-testid=\"stop-button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"submit_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["#composer-submit-button","button[data-testid=\"send-button\"]","button.composer-submit-button-color","button[aria-label=\"Send prompt\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"text_file_tile":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[name=\"expand-file-tile\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"thinking_indicator":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[class*=\"thinking\"]","[class*=\"loading\"]","[class*=\"typing\"]",".result-thinking",".result-streaming"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null}},"status":"active"},"flow":{"base_url":"https://labs.google/fx/tools/flow","config_version":84,"meta":{"version":84},"name":"Google Flow","selectors":{"add_to_prompt_menu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"menuitem\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":["Thêm vào câu lệnh","Add to prompt","เพิ่มในข้อความ","プロンプトに追加"]},"advanced_menu_add_to_prompt_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":["Thêm vào câu lệnh","Add To Prompt","Add to prompt","เพิ่มในข้อความ","プロンプトに追加"],"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_character_name_div":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[":scope > div:nth-child(2)",":scope div.sc-b0e5-12",":scope > div:last-child"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_character_option":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"option\"]:has(img)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_characters_tab":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"accessibility_new","panel_label_text":null,"priority":"P1","selectors":["button[role=\"tab\"]:has(i.google-symbols)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_search_input":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["input[data-testid=\"search-input\"]","input[placeholder*=\"search\" i]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_voice_description_div":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":[":scope > div:nth-child(2) > div:nth-child(2)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_voice_name_div":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[":scope > div:nth-child(2) > div:nth-child(1)",":scope > div:nth-child(2) > div:first-child"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_voice_option":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"voice_selection","panel_label_text":null,"priority":"P1","selectors":["[role=\"option\"]:has(i.google-symbols)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"advanced_menu_voices_tab":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"voice_selection","panel_label_text":null,"priority":"P1","selectors":["button[role=\"tab\"]:has(i.google-symbols)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"composer_advanced_menu_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"add_2","panel_label_text":null,"priority":"P1","selectors":["button:has(i.google-symbols)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"context_menu":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"menu\"]","[role=\"menu\"][data-state=\"open\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"download_menu_trigger":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":["Tải xuống","Download","ดาวน์โหลด","ダウンロード"],"class_selected":null,"closest_attribute":null,"icon_text":"download","panel_label_text":null,"priority":"P1","selectors":["[role=\"menuitem\"][aria-haspopup=\"menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"download_submenu":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"aria-controls","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"menu\"][data-state=\"open\"]","[data-radix-popper-content-wrapper] [role=\"menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"download_submenu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"menuitem\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"edit_link":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"href","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["a[href*=\"/edit/\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"flow_agent_instruction_done_button":{"anchor_walk_depth":6,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":["Xong","Done","Save","Finish","OK","完了","保存","เสร็จสิ้น","บันทึก"],"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":["Hướng dẫn cho tác nhân","Instructions for agent","Agent instructions","Instructions","エージェントの指示","エージェント手順","คำสั่งสำหรับเอเจนต์","คำสั่งเอเจนต์"],"priority":"P1","selectors":[],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"flow_agent_toggle_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":"true","attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":["Tác nhân","Agent","エージェント","ตัวแทน"],"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[aria-pressed]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"flow_chat_agent_close_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":["Đóng","Close","閉じる","ปิด"],"class_selected":null,"closest_attribute":null,"icon_text":"close","panel_label_text":null,"priority":"P1","selectors":["button"],"sibling_button_text":["Phiên mới","New session","新しいセッション","เซสชันใหม่"],"sibling_icon_text":"edit_square","text_match":null},"flow_credit_limit_alert":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["img[src*=\"flow_alert_sphere\"]","img[src*=\"alert_sphere\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"flow_modal_dialog":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"dialog\"]","[role=\"alertdialog\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"flow_scroll_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":"[style*=\"overflow\"]","icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[class*=\"sc-\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"flow_tab_slider_trigger":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[".flow_tab_slider_trigger"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"grid_view_tab":{"anchor_walk_depth":null,"aria_labels":["Grid","Lưới","グリッド","กริด"],"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[".flow_tab_slider_trigger","button[role=\"tab\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"icon_element":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["i.google-symbols","i[class*=\"icon\"]","span[class*=\"material-symbol\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"menu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"menuitem\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"mode_tab_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"aria-selected","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button[id$=\"-trigger-IMAGE\"]","button[role=\"tab\"][aria-controls*=\"IMAGE\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"mode_tab_video":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"aria-selected","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button[id$=\"-trigger-VIDEO\"]:not([id*=\"VIDEO_\"])","button[role=\"tab\"][aria-controls*=\"VIDEO\"]:not([aria-controls*=\"VIDEO_\"])"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"model_picker_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[aria-haspopup=\"menu\"]","button[id^=\"radix-:\"][aria-haspopup=\"menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"new_project_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":["add_2","add","add_circle"],"panel_label_text":null,"priority":"P1","selectors":["button","[role=\"button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":["New project","Dự án mới","Create new project","Tạo dự án","新しいプロジェクト","โปรเจกต์ใหม่"]},"project_error_indicator":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["#__next a[href$=\"/tools/flow\"]","a[href$=\"/tools/flow\"] i.material-icons"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"project_link":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"href","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["a[href*=\"/project/\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"project_name_input":{"anchor_walk_depth":null,"aria_labels":["Văn bản có thể chỉnh sửa","Editable text","ข้อความที่แก้ไขได้","編集可能なテキスト"],"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["input[aria-label=\"Văn bản có thể chỉnh sửa\"]","input[aria-label=\"Editable text\"]","input[aria-label=\"ข้อความที่แก้ไขได้\"]","input[aria-label=\"編集可能なテキスト\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"prompt_selected_character_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"accessibility_new","panel_label_text":null,"priority":"P1","selectors":["button:has(> i.google-symbols)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"prompt_selected_voice_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"voice_selection","panel_label_text":null,"priority":"P1","selectors":["button:has(> i.google-symbols)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"settings_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"crop_","panel_label_text":null,"priority":"P0","selectors":["button[aria-haspopup=\"menu\"]","button[id^=\"radix-:\"]","button[aria-haspopup=\"dialog\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"settings_panel_candidates":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[role=\"dialog\"]","[data-radix-popper-content-wrapper]","[role=\"menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"settings_panel_marker":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button[role=\"tab\"][id*=\"-trigger-\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"show_tile_details_setting":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["[role=\"menu\"] div"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":["Hiện thông tin chi tiết về ô","Show tile details","แสดงรายละเอียดของแผ่น","タイルの詳細を表示"]},"slate_editor":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["div[data-slate-editor=\"true\"]","[data-slate-node=\"value\"]","[role=\"textbox\"][aria-multiline=\"true\"]","[contenteditable=\"true\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"submit_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":["Tạo","Create"],"class_selected":null,"closest_attribute":null,"icon_text":"arrow_forward","panel_label_text":null,"priority":"P0","selectors":["button:has(i.google-symbols)","button[type=\"submit\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tab_button_generic":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[role=\"tab\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tile_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"data-tile-id","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[data-tile-id]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tile_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["img[src*=\"getMediaUrlRedirect\"]","img[src*=\"googleusercontent.com\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tile_retry_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":["Retry","Thử lại","再試行","ลองอีกครั้ง"],"class_selected":null,"closest_attribute":null,"icon_text":"refresh","panel_label_text":null,"priority":"P1","selectors":["button:has(i.google-symbols)"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tile_video":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["video[src*=\"getMediaUrlRedirect\"]","video"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"toggle_state_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":["Đang tắt","Off","ปิด","オフ"],"aria_labels_on":["Đang bật","On","เปิด","オン"],"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":[".flow_tab_slider_trigger"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"upload_consent_confirm":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["[role=\"dialog\"][data-state=\"open\"] button","[role=\"dialog\"] button"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":"Tôi đồng ý | I agree, Do not show again | I agree"},"video_duration_tab":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[role=\"tab\"].flow_tab_slider_trigger"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":["4s","6s","8s","10s"]},"video_mode_frames":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"aria-selected","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button[id$=\"-trigger-VIDEO_FRAMES\"]","button[role=\"tab\"][aria-controls*=\"VIDEO_FRAMES\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":["frames","khung hình","khung"]},"video_mode_ingredients":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"aria-selected","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button[id$=\"-trigger-VIDEO_REFERENCES\"]","button[role=\"tab\"][aria-controls*=\"VIDEO_REFERENCES\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":["ingredients","thành phần","thanh phan"]},"warning_icon":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":[".google-symbols","i[class*=\"icon\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":"warning"},"video_upload_confirm":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["[role=\"dialog\"][data-state=\"open\"] button","[role=\"dialog\"] button"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":["Tôi đồng ý","I agree, Do not show again","I agree"]}},"status":"active"},"gemini":{"base_url":"https://gemini.google.com","config_version":7,"meta":{"version":7},"name":"Gemini","selectors":{"add_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button.upload-card-button","button:has(mat-icon[data-mat-icon-name=\"add_2\"])","button:has(mat-icon[fonticon=\"add_2\"])","button[aria-controls=\"upload-file-menu\"]","button[aria-label=\"Mở trình đơn tải tệp lên\"]","button[aria-label*=\"upload menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"cloudflare_iframe":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["iframe[src*=\"challenges.cloudflare.com\"]","iframe[src*=\"recaptcha\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"composer":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":[".ql-editor","div[role=\"textbox\"]","[contenteditable=\"true\"]","rich-textarea"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"conversation_actions_menu":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[data-test-id=\"conversation-actions-menu-icon-button\"]","button[data-test-id=\"actions-menu-button\"].gem-conversation-actions-menu-button","button[data-test-id=\"actions-menu-button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"delete_confirm_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["mat-dialog-container button[mat-flat-button]",".mat-mdc-dialog-container button.mat-mdc-button-base","mat-dialog-container button"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"delete_confirm_dialog":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["mat-dialog-container",".mat-mdc-dialog-container",".cdk-overlay-pane mat-dialog-actions"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"delete_menu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["gem-menu-item[data-test-id=\"delete-button\"]","gem-menu-item[value=\"delete\"]","[data-test-id=\"delete-button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"generated_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["img[src*=\"googleusercontent\"]","img[data-src]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"image_preview":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[class*=\"image-preview\"]","[class*=\"attachment\"]","img[src^=\"blob:\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"input_area_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[".input-area-container",".input-area","[class*=\"input-area\"]","[class*=\"composer-input\"]","form"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"model_option_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":"data-mode-id","attribute_selected":"aria-current","button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button.bard-mode-list-button","button[data-test-id^=\"bard-mode-option-\"]",".mat-mdc-menu-item.bard-mode-list-button"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"model_switcher_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[data-test-id=\"bard-mode-menu-button\"]","button.input-area-switch[data-test-id*=\"bard-mode\"]","bard-mode-switcher button[aria-haspopup=\"menu\"]","button[aria-label=\"Mở bộ chọn chế độ\"]","button[aria-label*=\"mode picker\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"new_chat_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["gem-nav-list-item[data-test-id=\"new-chat-button\"] a","[data-test-id=\"new-chat-button\"] a","[data-test-id=\"new-chat-button\"]","a[data-test-id=\"side-nav-sparkle-button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"response_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[data-message-id]",".response-container","model-response"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"stop_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button.send-button.stop","button[aria-label=\"Ngừng tạo câu trả lời\"]","button[aria-label*=\"Stop generating\"]","button[aria-label*=\"Stop\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"submit_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button.send-button.submit","button.send-button:not(.stop)","button[aria-label=\"Gửi tin nhắn\"]","button[aria-label=\"Send message\"]","button[aria-label*=\"Send\"]","button[type=\"submit\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tools_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["toolbox-drawer button.toolbox-drawer-button","button.toolbox-drawer-button[aria-haspopup=\"menu\"]","button[aria-label=\"Công cụ\"]","button[aria-label=\"Tools\"]","button[aria-controls^=\"toolbox-drawer-menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tools_image_gen_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":"photo_prints","panel_label_text":null,"priority":"P2","selectors":["button.toolbox-drawer-item-list-button:has(mat-icon[data-mat-icon-name=\"photo_prints\"])","button.toolbox-drawer-item-list-button:has(mat-icon[fonticon=\"photo_prints\"])","toolbox-drawer-item:has(mat-icon[data-mat-icon-name=\"photo_prints\"]) button"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"tools_menu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":"aria-checked","button_text":null,"class_selected":"is-selected","closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["button.toolbox-drawer-item-list-button","toolbox-drawer-item button[role=\"menuitemcheckbox\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"upload_in_progress":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["uploader-file-preview .image-preview.loading","uploader-file-preview .progress-spinner",".file-preview-chip .image-preview.loading"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null}},"status":"active"},"grok":{"base_url":"https://x.com/i/grok","config_version":33,"meta":{"version":33},"name":"Grok","selectors":{"age_verification_continue_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button.bg-button-filled","button[class*=\"bg-button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"age_verification_modal":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"data-analytics-name","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-analytics-name=\"age_verification\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"age_verification_scroll_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":[".overflow-y-auto","[class*=\"snap-y\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"age_verification_year_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[type=\"button\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"auth_link":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"href","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["a[href*=\"/login\"]","a[href*=\"/signin\"]","a[href*=\"auth\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"back_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["div[aria-label=\"Back\"]","button[aria-label=\"Back\"]","div[aria-label=\"Quay lại\"]","button[aria-label=\"Quay lại\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"cloudflare_iframe":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["iframe[src*=\"challenges.cloudflare.com\"]","iframe[src*=\"turnstile\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"cloudflare_overlay_dialog":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["div[class*=\"fixed\"]","div[role=\"dialog\"]","body > div"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"cloudflare_turnstile":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":[".cf-turnstile","[data-cf-turnstile]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"composer":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["form div[contenteditable=\"true\"]",".ProseMirror",".tiptap"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"file_input":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["input[type=\"file\"][accept=\"image/*\"]","input[type=\"file\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"filmstrip_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-filmstrip-item]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"generation_mode":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"radiogroup\"][aria-label=\"Generation mode\"]","[role=\"radiogroup\"][aria-label=\"Chế độ tạo\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"grok_cdn_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["img[src*=\"assets.grok.com\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"image_quality_picker":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[role=\"radiogroup\"][aria-label=\"Image generation speed\"]","[role=\"radiogroup\"][aria-label=\"Tốc độ tạo hình ảnh\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"imagine_link":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["a[href=\"/imagine\"]","a[href=\"/imagine/\"]","button[aria-label=\"Imagine\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"modal_overlay_wrapper":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[role=\"dialog\"]","[role=\"alertdialog\"]","div[class*=\"modal\"]","div[class*=\"Modal\"]","div[class*=\"fixed\"]","div[class*=\"overlay\"]","div[class*=\"Overlay\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"open_menu":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[data-radix-popper-content-wrapper]","[role=\"menu\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"ratio_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[aria-label=\"Aspect Ratio\"]","button[aria-label=\"Tỷ lệ khung hình\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"ratio_menu_item":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["div[role=\"menuitem\"]","[role=\"menuitemradio\"]","[role=\"option\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"remove_image_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button[aria-label=\"Remove image\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"remove_image_button_broad":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["button[aria-label=\"Remove\"]","button[aria-label=\"Cancel\"]","button[aria-label=\"Delete\"]","button[aria-label=\"Remove file\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"result_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[data-testid=\"result-container\"]","main article","div[id^=\"imagine-masonry-section-\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"result_feed_card_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["img[alt=\"Generated image\"]:not([class*=\"blur\"])"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"result_feed_section":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["[id^=\"imagine-masonry-section-0\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"result_image":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["img[src^=\"https://\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"result_video":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":"src","attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["video","video source"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"saved_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["a[aria-label=\"Saved\"]","button[aria-label=\"Saved\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"stop_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button[aria-label=\"Stop\"]","[aria-label=\"Stop generating\"]","button[aria-label=\"Dừng\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"submit_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["button[type=\"submit\"][aria-label=\"Submit\"]","button[aria-label=\"Submit\"]","button[type=\"submit\"]","button[type=\"submit\"][aria-label=\"Gửi\"]","button[aria-label=\"Gửi\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"upload_container":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P2","selectors":["[class*=\"upload\"]","[class*=\"preview\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"upload_error_close_button":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["button svg.lucide-x"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"upload_error_icon":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["svg.lucide-triangle-alert"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"upload_loading_indicator":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P1","selectors":["span.animate-pulse","div.animate-spin"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"video_duration_picker":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[role=\"radiogroup\"][aria-label=\"Video duration\"]","[role=\"radiogroup\"][aria-label=\"Thời lượng video\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null},"video_resolution_picker":{"anchor_walk_depth":null,"aria_labels":null,"aria_labels_off":null,"aria_labels_on":null,"aria_pressed_on":null,"attribute":null,"attribute_id":null,"attribute_selected":null,"button_text":null,"class_selected":null,"closest_attribute":null,"icon_text":null,"panel_label_text":null,"priority":"P0","selectors":["[role=\"radiogroup\"][aria-label=\"Video resolution\"]","[role=\"radiogroup\"][aria-label=\"Độ phân giải video\"]"],"sibling_button_text":null,"sibling_icon_text":null,"text_match":null}},"status":"active"}};

  // API configs default: ratios per mode, download resolutions, capabilities.
  static _LOCAL_API_CONFIGS = {"chatgpt":{"config_version":39,"configs":{"ai_agent_prefix":{"en":"Respond directly to the request below. Return ONLY plain text/json response — no markdown formatting, no preamble (like \"Here is...\", \"Sure,...\"), no quotation marks wrapping the answer, no image/file generation, no code blocks. Keep the user intent without adding commentary.\n\n---REQUEST---","vi":"Phản hồi trực tiếp yêu cầu bên dưới. Chỉ trả về plain text/json — KHÔNG markdown, KHÔNG preamble (như \"Đây là...\", \"Để tôi...\", \"Sure,...\"), KHÔNG dấu ngoặc kép bao quanh response, KHÔNG tạo ảnh/file, KHÔNG code block. Giữ đúng intent user yêu cầu, không thêm bình luận.\n\n---YÊU CẦU---"},"chatgpt_model_labels":{"High":"High|Cao","Instant":"Instant|Tức thì","Medium":"Medium|Trung bình","Pro":"Pro"},"error_patterns":{"cloudflare_challenge_text":"making sure you're human|verify you are human|verifying cloudflare","content_blocked_text":"can't create|cannot generate|can't generate|content policy|violates our content polic|violates our usage polic|this request violates|request violates generation policy|safety system|not allowed by our safety system|unable to create|unable to generate images for that request|unable to generate the requested image|may violate our content polic|prompt may violate|violate our guardrails|We’re so sorry|please retry|edit your prompt|content policies|may violate","image_gen_failed_text":"experienced an error when generating image|something went wrong while generating your image|couldn't generate the image|couldn't generate that image|couldn't create the image|couldn't create that image|trouble generating that image|trouble generating the image|error generating image|error creating images|error creating message|failed to generate the image|failed to generate image|unable to generate the image|unable to generate that image|unable to generate images directly|can't generate images at the moment|contact us through our help center","network_error_text":"network error|something went wrong|connection error|please check your internet|we are currently processing too many requests||help.openai.com","not_logged_in_text":"log in|sign in|sign up|đăng nhập|đăng ký","rate_limit_error_text":"You've reached your limit|you've hit the plus plan limit|rate limit|too many requests|please upgrade|limit will reset|limit resets in|daily limit|reached the daily maximum|generating images too quickly|create more images when the limit|You’re out of uploads|upgrade to ChatGPT|Unable to upload|Max 0 uploads at a time","text_only_pattern":"i'm sorry, but i|i apologize, but|i'm unable to|i cannot|unfortunately, i|i'm not able to|as an ai|as a language model|i don't have the ability|i can't directly|instead of generating|rather than creating an image|let me describe|here's a description|i'll describe|instead, i can|however, i can|but i can help|i can help you with|let me help you|i can assist"},"max_ref_images":{"image":10},"ratios":{"image":[{"ui_name":"story","value":"9:16"},{"ui_name":"portrait","value":"3:4"},{"ui_name":"square","value":"1:1"},{"ui_name":"landscape","value":"4:3"},{"ui_name":"widescreen","value":"16:9"}]},"supports":{"auto_download":true,"humanized":true,"image_mode":true,"quantity":false,"ratio":true,"ref_image":true,"video":false},"ui_text_patterns":{"create_image_menu_text":"create image|create an image|tạo hình ảnh","delete_menu_text":"delete|xóa","generated_image_alt_text":"generated image"},"urls":{"base":"https://chatgpt.com","create_url":"https://chatgpt.com/","tab_query":"*://chatgpt.com/*","tab_query_patterns":["*://chatgpt.com/*"]}},"meta":{"version":39},"name":"ChatGPT","status":"active"},"flow":{"config_version":84,"configs":{"api_endpoints":{"base_url":"https://aisandbox-pa.googleapis.com","credits":"/v1/credits","image_generate":"/v1/projects/{project_id}/flowMedia:batchGenerateImages","image_upload":"/v1/flow/uploadImage","image_upscale":"/v1/flow/upsampleImage","media":"/v1/media/{media_id}","trpc_base_url":"https://labs.google","trpc_create_project":"/fx/api/trpc/project.createProject","trpc_generate":"/fx/api/trpc/GenerateService.generate","trpc_generate_video":"/fx/api/trpc/GenerateService.generateVideo","trpc_get_operation":"/fx/api/trpc/GenerateService.getOperation","video_generate":"/v1/video:batchAsyncGenerateVideoStartImage","video_references":"/v1/video:batchAsyncGenerateVideoReferenceImages","video_start_end":"/v1/video:batchAsyncGenerateVideoStartAndEndImage","video_status":"/v1/video:batchCheckAsyncVideoGenerationStatus","video_upscale":"/v1/video:batchAsyncGenerateVideoUpsampleVideo"},"api_error_codes":{"CAPTCHA_FAILED":"captcha_failed","ENTITY_NOT_FOUND":"media_expired","PUBLIC_ERROR_MODEL_ACCESS_DENIED":"tier_restricted","PUBLIC_ERROR_UNSAFE_GENERATION":"content_blocked","PUBLIC_ERROR_UNUSUAL_ACTIVITY":"bot_detected","PUBLIC_ERROR_USER_QUOTA_REACHED":"quota_exceeded"},"api_model_mapping":{"image":{"Nano Banana 2":"NARWHAL","Nano Banana Pro":"GEM_PIX_2","nano-banana-2":"NARWHAL","nano-banana-pro":"GEM_PIX_2"},"video":{"Omni Flash":"MODEL_OMNI_FLASH","Veo 3.1 - Fast":"MODEL_VEO_LITE","Veo 3.1 - Lite":"MODEL_VEO_LITE","Veo 3.1 - Quality":"MODEL_VEO_2","omni-flash":"MODEL_OMNI_FLASH","veo-3.1-fast":"MODEL_VEO_LITE","veo-3.1-lite":"MODEL_VEO_LITE","veo-3.1-quality":"MODEL_VEO_2"}},"api_rate_limits":{"base_backoff_ms":10000,"circuit_breaker_reset_ms":60000,"circuit_breaker_threshold":5,"cooldown_ms":10000,"image_timeout_ms":180000,"max_backoff_ms":300000,"max_concurrent":5,"max_retries":5,"poll_interval_ms":2000,"video_timeout_ms":420000},"api_ratio_mapping":{"16:9":"ASPECT_RATIO_16_9","1:1":"ASPECT_RATIO_1_1","3:4":"ASPECT_RATIO_3_4","4:3":"ASPECT_RATIO_4_3","9:16":"ASPECT_RATIO_9_16"},"captcha_config":{"actions":{"image":"IMAGE_GENERATION","upload":"UPLOAD","video":"VIDEO_GENERATION"},"max_retries":3,"site_key":"6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV","timeout_ms":30000},"download_resolutions":{"image":[{"label":"1K — bản gốc (tải thẳng)","menu_label":"1K","pixel_width":1024,"value":"1k"},{"label":"2K — phóng to (không tải thẳng được)","menu_label":"2K","pixel_width":2048,"upscale":true,"value":"2k"},{"label":"4K — phóng to (không tải thẳng được)","menu_label":"4K","pixel_width":4096,"upscale":true,"value":"4k"}],"image_fallback_chain":["4K","2K","1K"],"video":[{"label":"720p — bản gốc (tải thẳng)","menu_label":"720p","value":"720p"},{"label":"1080p — phóng to (không tải thẳng được)","menu_label":"1080p","upscale":true,"value":"1080p"},{"label":"4K — phóng to · tốn tín dụng","menu_label":"4K","upscale":true,"costs_credits":true,"value":"4k"}],"video_fallback_chain":["4K","1080p","720p"]},"error_patterns":{"captcha_text":"hoạt động bất thường|unusual activity|unusual traffic|detected unusual","policy_text":"vi phạm|chính sách|người nổi tiếng|nội dung gây hại|không tạo được nội dung bạn yêu cầu|bên thứ ba|violat|policy|prominent people|harmful content","quota_text":"đạt đến hạn mức|hết hạn mức|quota|quay lại vào ngày mai|usage limit|reached your limit","rate_limit_text":"tốc độ yêu cầu|quá nhanh|too fast|too many requests|thử lại sau vài phút|đang bị quá tải|overloaded","upload_blocked_text":"we do not allow|do not allow uploads|sexual content|inappropriate|prohibited|not allowed|violat|unsafe|không cho phép|không phù hợp|Unsupported image format"},"image_url_pattern":{"description":"Flow tRPC route serving generated media. URL format: /fx/api/trpc/media.getMediaUrlRedirect?name=UUID hoặc ?input={\"json\":{\"name\":\"UUID\"}}","known_routes":["/fx/api/trpc/media.getMediaUrlRedirect"],"url_substring":"getMediaUrlRedirect","uuid_regex":"^[a-f0-9-]{8,}$"},"max_ref_images":{"image":10,"video_ingredients":5},"quantity_range":{"max":4,"min":1},"radix_trigger_button_pattern":"button[id$=\"-trigger-{suffix}\"]","ratios":{"image":["16:9","4:3","1:1","3:4","9:16"],"video":["16:9","9:16"]},"supports":{"auto_download":true,"humanized":true,"image_mode":false,"quantity":true,"ratio":true,"ref_image":true,"video":true},"urls":{"base":"https://labs.google/fx/tools/flow","create_url":"https://labs.google/fx/tools/flow","locale_base":"https://labs.google/fx/{locale}/tools/flow","tab_query":"https://labs.google/fx/*","tab_query_patterns":["https://labs.google/fx/*"]},"video_durations":{"advanced":["4s","6s","8s","10s"],"default":["4s","6s","8s"],"fixed":["8s"]}},"meta":{"version":84},"name":"Google Flow","status":"active"},"gemini":{"config_version":7,"configs":{"ai_agent_prefix":{"en":"Respond directly to the request below. Return ONLY plain text response — no markdown formatting, no preamble (like \"Here is...\", \"Sure,...\"), no quotation marks wrapping the answer, no image/file generation, no code blocks. Keep the user intent without adding commentary.\n\n---REQUEST---\n","vi":"Phản hồi trực tiếp yêu cầu bên dưới. Chỉ trả về plain text — KHÔNG markdown, KHÔNG preamble (như \"Đây là...\", \"Để tôi...\", \"Sure,...\"), KHÔNG dấu ngoặc kép bao quanh response, KHÔNG tạo ảnh/file, KHÔNG code block. Giữ đúng intent user yêu cầu, không thêm bình luận.\n\n---YÊU CẦU---\n"},"max_ref_images":{"image":4},"ratios":{"image":["1:1","9:16","16:9"]},"supports":{"auto_download":true,"humanized":false,"image_mode":true,"quantity":false,"ratio":false,"ref_image":true,"video":false},"urls":{"app":"https://gemini.google.com/app","base":"https://gemini.google.com","create_url":"https://gemini.google.com/app","tab_query":"*://gemini.google.com/*","tab_query_patterns":["*://gemini.google.com/*"]}},"meta":{"version":7},"name":"Gemini","status":"active"},"grok":{"config_version":33,"configs":{"error_patterns":{"cloudflare_challenge_text":"making sure you're human|verifying|just a moment|checking your browser|i am not a robot|please verify","content_blocked_text":"content policy|violates|cannot generate","network_error_text":"network error|connection error|failed to fetch|something went wrong","not_logged_in_text":"sign in|sign up|log in|đăng nhập|đăng ký","rate_limit_text":"rate limit|too many requests|please slow down|unlock your creativity with imagine","subscription_required_text":"unlock your creativity with imagine|subscribe to|upgrade to continue|subscription required|premium required|superx premium|get premium"},"image_quality_labels":{"quality":"Quality|Chất lượng","speed":"Speed|Tốc độ"},"max_ref_images":{"image":5,"video":5},"mode_labels":{"image":"Image|Hình ảnh","video":"Video"},"mode_toggle_svg_paths":{"image":"M14.0996 2.5","video":"M12 4C14.4853"},"ratios":{"image":[{"ui_name":"story","value":"9:16"},{"ui_name":"portrait","value":"2:3"},{"ui_name":"square","value":"1:1"},{"ui_name":"landscape","value":"3:2"},{"ui_name":"widescreen","value":"16:9"}],"video":[{"ui_name":"story","value":"9:16"},{"ui_name":"portrait","value":"2:3"},{"ui_name":"square","value":"1:1"},{"ui_name":"landscape","value":"3:2"},{"ui_name":"widescreen","value":"16:9"}]},"supported_durations":["6s","10s","15s"],"supported_image_qualities":["speed","quality"],"supported_resolutions":["480p","720p"],"supports":{"auto_download":true,"humanized":false,"image_mode":true,"quantity":false,"ratio":true,"ref_image":true,"video":true},"urls":{"base":"https://grok.com","cdn_patterns":["assets.grok.com","grok.x.ai","imagine-public.x.ai"],"create_url":"https://grok.com/","imagine":"https://grok.com/imagine","saved":"https://grok.com/imagine/saved","tab_query":"*://grok.com/*","tab_query_patterns":["*://grok.com/*","https://x.com/i/grok*"]}},"meta":{"version":33},"name":"Grok","status":"active"}};

  /**
   * LOCAL: prime cả 2 in-memory cache + chrome.storage (nếu chưa có data thật).
   * Idempotent. Gọi lúc load module + đầu mỗi fetch path khi local.
   */
  static _primeLocalDefaults() {
    const now = Date.now();
    const ttl = this._CACHE_TTL_MS;

    if (!this._cache?.data) {
      this._cache = { data: this._LOCAL_DOM_SELECTORS, expiresAt: now + ttl, fetchedAt: now };
    }
    if (!this._apiConfigsCache?.data) {
      this._apiConfigsCache = { data: this._LOCAL_API_CONFIGS, expiresAt: now + ttl, fetchedAt: now };
    }

    // Prime storage cho content.js — CHỈ set khi storage chưa có (giữ cache thật
    // từ phiên online trước nếu có). Fire-and-forget.
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([this._CACHE_KEY, this._API_CONFIGS_CACHE_KEY], (res) => {
          const set = {};
          const cur = res?.[this._CACHE_KEY]?.data;
          const flowSelCount = (cur && cur.flow && cur.flow.selectors) ? Object.keys(cur.flow.selectors).length : 0;
          // Re-prime khi CHƯA có data HOẶC selector Flow quá ít (<20) → nâng bản cũ (rỗng/đoán) lên bản
          // ĐẦY ĐỦ 53-selector thật. Cache đã đủ selector (>=20) thì giữ (là bản thật của user).
          // Cũng re-prime nếu thiếu key mới `video_upload_confirm` (config cũ trước fix) → nạp bổ sung.
          // Port 1.1.49: re-prime cả khi thiếu key mới grid_size_small_button (flow) / mention_menu
          // (chatgpt) → config cũ cached được nạp bổ sung 2 selector mới.
          if (!cur?.flow || flowSelCount < 20 || !cur.flow.selectors?.video_upload_confirm
              || !cur.flow.selectors?.grid_size_small_button || !cur.chatgpt?.selectors?.mention_menu
              || !cur.chatgpt?.selectors?.composer_mode_radio) {
            set[this._CACHE_KEY] = { data: this._LOCAL_DOM_SELECTORS, expiresAt: now + ttl, fetchedAt: now };
          }
          const apiCur = res?.[this._API_CONFIGS_CACHE_KEY]?.data;
          if (!apiCur || !apiCur.flow?.configs?.image_url_pattern) {
            set[this._API_CONFIGS_CACHE_KEY] = { data: this._LOCAL_API_CONFIGS, expiresAt: now + ttl, fetchedAt: now };
          }
          if (Object.keys(set).length) chrome.storage.local.set(set);
        });
      }
    } catch (_) { /* non-extension ctx */ }
  }

  /**
   * Phase 3: Server-Only — lấy selector config cho 1 key.
   * @returns {Object} { selectors: [], text_match?, attribute?, icon_text?, button_text? }
   * @throws {ConfigRequiredError} nếu không có data
   */
  static async get(provider, key) {
    const data = await this.fetch();
    const providerData = data?.[provider];

    if (!providerData) {
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`selector_${provider}`, 'provider_not_found');
      }
      return null;
    }

    const selectors = providerData.selectors || {};
    const config = selectors[key];

    if (!config) {
      // Selector không tồn tại - có thể là optional key
      return null;
    }

    return {
      selectors: config.selectors || [],
      text_match: config.text_match || null,
      attribute: config.attribute || null,
      icon_text: config.icon_text || null,
      button_text: config.button_text || null,
    };
  }

  /**
   * Phase 3: Server-Only — lấy array selectors cho 1 key.
   */
  static async getSelectors(provider, key) {
    const config = await this.get(provider, key);
    return config?.selectors || [];
  }

  /**
   * Phase 3: Server-Only — lấy tất cả selectors của 1 provider.
   * @throws {ConfigRequiredError} nếu không có data
   */
  static async getProvider(provider) {
    const data = await this.fetch();
    const remote = data?.[provider];

    if (!remote) {
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`provider_${provider}`, 'provider_not_found');
      }
      return {
        name: provider,
        status: 'unknown',
        base_url: null,
        config_version: 0,
        selectors: {},
      };
    }

    return {
      name: remote.name || provider,
      status: remote.status || 'active',
      base_url: remote.base_url || null,
      config_version: remote.config_version || 1,
      selectors: remote.selectors || {},
    };
  }

  /**
   * Initiative 7: Get base URL của 1 provider.
   * Replace 10+ vị trí hardcode 'https://labs.google/fx/*' trong app.js.
   * @returns {Promise<string>}
   */
  static async getBaseUrl(providerSlug) {
    const data = await this.fetch();
    const remote = data?.[providerSlug];
    // Phase 3: Server-Only — fallback to _BOOTSTRAP_URLS minimal
    return remote?.base_url || this._BOOTSTRAP_URLS[providerSlug]?.base || '';
  }

  /**
   * SYNC version — return từ cache nếu có, fallback _BOOTSTRAP_URLS.
   * Dùng cho hot path không thể await.
   */
  static getBaseUrlSync(providerSlug) {
    if (this._cache?.data?.[providerSlug]?.base_url) {
      return this._cache.data[providerSlug].base_url;
    }
    // Phase 3: Server-Only — minimal bootstrap only
    return this._BOOTSTRAP_URLS[providerSlug]?.base || '';
  }

  // ============ Rev10: Centralized URL helpers ============

  /**
   * Get tab query pattern để tìm tabs đã mở.
   * Phase 3: Server first → _BOOTSTRAP_URLS (minimal)
   * @param {string} slug — 'flow' | 'chatgpt' | 'grok' | 'gemini'
   * @returns {string} Pattern cho chrome.tabs.query (vd: '*://chatgpt.com/*')
   */
  static getTabQuery(slug) {
    // 1. Server cache (api_configs.urls.tab_query)
    const serverUrl = this._apiConfigsCache?.data?.[slug]?.configs?.urls?.tab_query;
    if (serverUrl) return serverUrl;
    // 2. _BOOTSTRAP_URLS (minimal bootstrap for offline check)
    return this._BOOTSTRAP_URLS[slug]?.tabQuery || '';
  }

  /**
   * Get all tab query patterns (array) — dùng khi provider có nhiều domain.
   * Phase 3: Server first → derive từ getTabQuery
   * @param {string} slug
   * @returns {string[]} Array patterns
   */
  static getTabQueryPatterns(slug) {
    // 1. Server cache
    const serverPatterns = this._apiConfigsCache?.data?.[slug]?.configs?.urls?.tab_query_patterns;
    if (Array.isArray(serverPatterns) && serverPatterns.length > 0) return serverPatterns;
    // 2. Derive từ getTabQuery (which falls back to _BOOTSTRAP_URLS)
    return [this.getTabQuery(slug)].filter(Boolean);
  }

  /**
   * Get URL để tạo tab mới.
   * Phase 3: Server first → _BOOTSTRAP_URLS (minimal)
   * @param {string} slug
   * @returns {string}
   */
  static getCreateUrl(slug) {
    // 1. Server cache
    const serverUrl = this._apiConfigsCache?.data?.[slug]?.configs?.urls?.create_url;
    if (serverUrl) return serverUrl;
    // 2. _BOOTSTRAP_URLS base (minimal)
    return this._BOOTSTRAP_URLS[slug]?.base || this.getBaseUrlSync(slug);
  }

  /**
   * Get specific URL của provider.
   * Phase 3: Server-Only — only server data, no fallback for non-bootstrap keys
   * @param {string} slug
   * @param {string} key — 'imagine', 'saved', 'app', 'localeBase', etc.
   * @returns {string|null}
   */
  static getProviderUrl(slug, key) {
    // Server cache (snake_case key: locale_base, cdn_patterns)
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    const serverUrl = this._apiConfigsCache?.data?.[slug]?.configs?.urls?.[snakeKey];
    if (serverUrl) return serverUrl;
    // Phase 3: Server-Only — no fallback for specific URLs
    return null;
  }

  /**
   * Check URL có thuộc provider không (match any tabQueryPatterns).
   * @param {string} url
   * @param {string} slug
   * @returns {boolean}
   */
  static isProviderUrl(url, slug) {
    if (!url || !slug) return false;

    // M6: remote-supplied tabQueryPatterns are used to build RegExp → ReDoS/bypass risk.
    // Constrain matching to a hardcoded provider-origin allowlist so a compromised
    // backend cannot point automation at an attacker-chosen host, and wrap RegExp
    // construction in try/catch so a malformed remote pattern can't throw.
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch (_) {
      return false;
    }
    if (!ProviderConfigManager._isAllowedProviderHost(host)) return false;

    const patterns = this.getTabQueryPatterns(slug);
    return patterns.some(pattern => {
      try {
        // Convert chrome pattern to regex
        const regex = new RegExp('^' + String(pattern).replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
        return regex.test(url);
      } catch (_) {
        // Malformed remote pattern → ignore (do not match).
        return false;
      }
    });
  }

  /**
   * M6: Allowlist of known provider origins. Remote config is treated as data;
   * only URLs whose host is (a suffix of) one of these may be considered a
   * provider URL, regardless of what remote patterns claim.
   */
  static PROVIDER_ORIGIN_ALLOWLIST = [
    'labs.google',
    'chatgpt.com',
    'grok.com',
    'gemini.google.com',
    'x.com',
    'x.ai',
  ];

  static _isAllowedProviderHost(host) {
    if (!host) return false;
    return ProviderConfigManager.PROVIDER_ORIGIN_ALLOWLIST.some(
      (allowed) => host === allowed || host.endsWith('.' + allowed)
    );
  }

  /**
   * Check URL có chứa CDN pattern của provider không (Grok CDN check).
   * Phase 3: Server-Only — only server data
   * @param {string} url
   * @param {string} slug
   * @returns {boolean}
   */
  static isCdnUrl(url, slug) {
    if (!url || !slug) return false;
    // Server cache only
    const serverPatterns = this._apiConfigsCache?.data?.[slug]?.configs?.urls?.cdn_patterns;
    if (Array.isArray(serverPatterns) && serverPatterns.length > 0) {
      return serverPatterns.some(pattern => url.includes(pattern));
    }
    // Phase 3: No fallback — return false if no server data
    return false;
  }

  /**
   * Get all provider slugs.
   * @returns {string[]}
   */
  static getProviderSlugs() {
    // Merge server + bootstrap slugs
    const serverSlugs = Object.keys(this._apiConfigsCache?.data || {});
    const bootstrapSlugs = Object.keys(this._BOOTSTRAP_URLS);
    return [...new Set([...serverSlugs, ...bootstrapSlugs])];
  }

  // ============ End Rev10 URL helpers ============

  /**
   * Initiative 4 (rev6 fix): Get ratios của 1 provider per mode.
   * Fetch từ /api/v1/providers/api-configs (KHÔNG dùng cache của /dom-selectors).
   *
   * @param {string} providerSlug — 'flow' | 'chatgpt' | 'grok' | 'gemini'
   * @param {string} mode — 'image' | 'video'
   * @returns {Promise<Array>} List ratios:
   *   - Flow: ["1:1", "9:16", "16:9", ...] (string only)
   *   - ChatGPT/Grok: [{ ui_name: "story", value: "9:16" }, ...] (object với UI mapping)
   */
  /**
   * Phase 3: Server-Only — async version, throws if no data.
   */
  /**
   * Giới hạn tốc độ gọi provider. Config `api_rate_limits` đã có sẵn trong
   * _LOCAL_API_CONFIGS từ lâu nhưng TRƯỚC ĐÂY KHÔNG AI ĐỌC — executor và
   * BatchQueue tự đặt hằng số riêng, gấp gáp hơn nhiều (3s/2 lần thay vì
   * 10s/5 lần + trần 300s). Đó là đường ngắn nhất tới PUBLIC_ERROR_UNUSUAL_ACTIVITY,
   * mà lỗi đó thì gỡ bằng "xoá cookie, đăng nhập lại, chờ 1-6 giờ" chứ không sửa được.
   *
   * KHÔNG throw như getRatiosSync: giới hạn tốc độ phải luôn có giá trị dùng được,
   * thiếu config thì rơi về mặc định AN TOÀN (chậm) chứ không phải chạy tự do.
   * @returns {{maxConcurrent:number, cooldownMs:number, baseBackoffMs:number,
   *   maxBackoffMs:number, maxRetries:number, circuitBreakerThreshold:number,
   *   circuitBreakerResetMs:number, pollIntervalMs:number,
   *   imageTimeoutMs:number, videoTimeoutMs:number}}
   */
  static getRateLimitsSync(providerSlug = 'flow') {
    const SAFE = {
      maxConcurrent: 3, cooldownMs: 10000, baseBackoffMs: 10000, maxBackoffMs: 300000,
      maxRetries: 5, circuitBreakerThreshold: 5, circuitBreakerResetMs: 60000,
      pollIntervalMs: 2000, imageTimeoutMs: 180000, videoTimeoutMs: 420000,
    };
    let raw = null;
    try {
      raw = this._apiConfigsCache?.data?.[providerSlug]?.configs?.api_rate_limits
        || this._LOCAL_API_CONFIGS?.[providerSlug]?.configs?.api_rate_limits
        || null;
    } catch (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#getRateLimitsSync', _e); }
    if (!raw) return SAFE;
    const num = (v, fb) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : fb);
    return {
      maxConcurrent: num(raw.max_concurrent, SAFE.maxConcurrent),
      cooldownMs: num(raw.cooldown_ms, SAFE.cooldownMs),
      baseBackoffMs: num(raw.base_backoff_ms, SAFE.baseBackoffMs),
      maxBackoffMs: num(raw.max_backoff_ms, SAFE.maxBackoffMs),
      maxRetries: num(raw.max_retries, SAFE.maxRetries),
      circuitBreakerThreshold: num(raw.circuit_breaker_threshold, SAFE.circuitBreakerThreshold),
      circuitBreakerResetMs: num(raw.circuit_breaker_reset_ms, SAFE.circuitBreakerResetMs),
      pollIntervalMs: num(raw.poll_interval_ms, SAFE.pollIntervalMs),
      imageTimeoutMs: num(raw.image_timeout_ms, SAFE.imageTimeoutMs),
      videoTimeoutMs: num(raw.video_timeout_ms, SAFE.videoTimeoutMs),
    };
  }

  static async getRatios(providerSlug, mode) {
    const apiConfigs = await this._fetchApiConfigs();
    const ratios = apiConfigs?.[providerSlug]?.configs?.ratios?.[mode];
    if (ratios && ratios.length > 0) return ratios;
    // Server-Only: throw instead of fallback
    if (window.ConfigRequiredError) {
      throw new window.ConfigRequiredError(`ratios_${providerSlug}_${mode}`, 'data_missing');
    }
    return []; // Fallback if ConfigRequiredError not loaded
  }

  /**
   * Phase 3: Server-Only — sync version, throws if cache empty.
   */
  static getRatiosSync(providerSlug, mode) {
    // Check cache exists
    if (!this._apiConfigsCache?.data) {
      // Trigger background fetch
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`ratios_${providerSlug}_${mode}`, 'cache_empty');
      }
      return []; // Fallback if ConfigRequiredError not loaded
    }
    const ratios = this._apiConfigsCache.data[providerSlug]?.configs?.ratios?.[mode];
    if (ratios && ratios.length > 0) return ratios;
    // Server-Only: throw instead of fallback
    if (window.ConfigRequiredError) {
      throw new window.ConfigRequiredError(`ratios_${providerSlug}_${mode}`, 'data_missing');
    }
    return []; // Fallback if ConfigRequiredError not loaded
  }

  /**
   * Get download resolutions config (Flow only — ChatGPT/Grok không có menu resolution).
   *
   * @param {string} providerSlug — 'flow'
   * @param {string|null} mode — 'image' | 'video' | null (trả full config)
   * @returns {Array|Object|null}
   *   - mode='image': [{value, label, menu_label, pixel_width}, ...]
   *   - mode='video': [{value, label, menu_label}, ...]
   *   - mode=null: { image, video, image_fallback_chain, video_fallback_chain }
   */
  /**
   * Phase 3: Server-Only — throws if cache empty.
   */
  static getDownloadResolutionsSync(providerSlug, mode = null) {
    // Check cache exists
    if (!this._apiConfigsCache?.data) {
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`download_resolutions_${providerSlug}`, 'cache_empty');
      }
      return mode === null ? null : [];
    }
    const cfg = this._apiConfigsCache.data[providerSlug]?.configs?.download_resolutions;
    if (!cfg) {
      // Flow-only feature, other providers may not have it - return empty instead of throw
      return mode === null ? null : [];
    }
    if (mode === null) return cfg;
    return Array.isArray(cfg[mode]) ? cfg[mode] : [];
  }

  /**
   * Get fallback chain (theo thứ tự ưu tiên khi menu item aria-disabled).
   * @param {string} providerSlug — 'flow'
   * @param {string} mode — 'image' | 'video'
   * @returns {string[]} — vd ['4K', '2K', '1K']
   */
  static getDownloadFallbackChainSync(providerSlug, mode) {
    const cfg = this.getDownloadResolutionsSync(providerSlug, null);
    if (!cfg) return [];
    const key = `${mode}_fallback_chain`;
    return Array.isArray(cfg[key]) ? cfg[key] : [];
  }

  /**
   * Get pixel_width cho resolution (image only — dùng cho applyResolutionToUrl).
   * @returns {number|null}
   */
  static getDownloadPixelWidthSync(providerSlug, resolution) {
    const list = this.getDownloadResolutionsSync(providerSlug, 'image');
    const found = list.find(r => r.value === resolution);
    return found?.pixel_width || null;
  }

  /**
   * Get menu_label theo resolution + mode.
   * @returns {string|null} — vd '1K' / '720p' / '4K'
   */
  static getDownloadMenuLabelSync(providerSlug, mode, resolution) {
    const list = this.getDownloadResolutionsSync(providerSlug, mode);
    const found = list.find(r => r.value === resolution);
    return found?.menu_label || null;
  }

  // ============ Phase J: Provider Capabilities Methods ============

  /**
   * Phase 3: Server-Only — throws if cache empty.
   * @param {string} slug — 'flow' | 'chatgpt' | 'grok' | 'gemini'
   * @param {string} mode — 'image' | 'video' | 'video_ingredients'
   * @returns {number}
   */
  static getMaxRefImagesSync(slug, mode = 'image') {
    // Check cache exists
    if (!this._apiConfigsCache?.data) {
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`max_ref_images_${slug}`, 'cache_empty');
      }
      return 0;
    }
    const cfg = this._apiConfigsCache.data[slug]?.configs?.max_ref_images;
    if (!cfg) {
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`max_ref_images_${slug}`, 'data_missing');
      }
      return 0;
    }
    // Flow special: video_ingredients mode
    if (slug === 'flow' && mode === 'video_ingredients') {
      return cfg.video_ingredients ?? cfg.image ?? 0;
    }
    // Grok: video mode
    if (slug === 'grok' && mode === 'video') {
      return cfg.video ?? cfg.image ?? 0;
    }
    return cfg.image ?? cfg[mode] ?? 0;
  }

  static async getMaxRefImages(slug, mode = 'image') {
    await this._fetchApiConfigs();
    return this.getMaxRefImagesSync(slug, mode);
  }

  /**
   * Phase 3: Server-Only — throws if cache empty.
   * @param {string} slug
   * @returns {object} { ratio, quantity, video, ref_image, auto_download, humanized, image_mode }
   */
  static getSupportsSync(slug) {
    // Check cache exists
    if (!this._apiConfigsCache?.data) {
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`supports_${slug}`, 'cache_empty');
      }
      return {};
    }
    const cfg = this._apiConfigsCache.data[slug]?.configs?.supports;
    if (!cfg) {
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`supports_${slug}`, 'data_missing');
      }
      return {};
    }
    return cfg;
  }

  static async getSupports(slug) {
    await this._fetchApiConfigs();
    return this.getSupportsSync(slug);
  }

  /**
   * Phase 3: Server-Only — Grok only, throws if cache empty.
   * @param {string} slug
   * @returns {string[]} — ['6s', '10s']
   */
  static getSupportedDurationsSync(slug) {
    if (!this._apiConfigsCache?.data) {
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`supported_durations_${slug}`, 'cache_empty');
      }
      return [];
    }
    const cfg = this._apiConfigsCache.data[slug]?.configs?.supported_durations;
    return Array.isArray(cfg) ? cfg : [];
  }

  /**
   * Phase 3: Server-Only — Grok only, throws if cache empty.
   * @param {string} slug
   * @returns {string[]} — ['480p', '720p']
   */
  static getSupportedResolutionsSync(slug) {
    if (!this._apiConfigsCache?.data) {
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`supported_resolutions_${slug}`, 'cache_empty');
      }
      return [];
    }
    const cfg = this._apiConfigsCache.data[slug]?.configs?.supported_resolutions;
    return Array.isArray(cfg) ? cfg : [];
  }

  /**
   * Phase 3: Server-Only — Grok only, throws if cache empty.
   * @param {string} slug
   * @returns {string[]} — ['speed', 'quality']
   */
  static getSupportedImageQualitiesSync(slug) {
    if (!this._apiConfigsCache?.data) {
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`supported_image_qualities_${slug}`, 'cache_empty');
      }
      return [];
    }
    const cfg = this._apiConfigsCache.data[slug]?.configs?.supported_image_qualities;
    return Array.isArray(cfg) ? cfg : [];
  }

  /**
   * Flow video durations by tier. Tier từ model.config.duration_tier.
   * @param {string} slug — provider slug ('flow')
   * @param {string} tier — 'default' | 'advanced' | 'fixed' (future use)
   * @returns {string[]} — default=['4s', '6s', '8s'], advanced=['4s', '6s', '8s', '10s'], fixed=['8s']
   */
  static getVideoDurationsSync(slug, tier = 'default') {
    if (!this._apiConfigsCache?.data) {
      this._fetchApiConfigs().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      if (window.ConfigRequiredError) {
        throw new window.ConfigRequiredError(`video_durations_${slug}`, 'cache_empty');
      }
      return [];
    }
    const cfg = this._apiConfigsCache.data[slug]?.configs?.video_durations;
    if (!cfg || typeof cfg !== 'object') return [];
    return Array.isArray(cfg[tier]) ? cfg[tier] : (Array.isArray(cfg.default) ? cfg.default : []);
  }

  /**
   * Safe version of getVideoDurationsSync.
   */
  static safeGetVideoDurationsSync(slug, tier = 'default') {
    try {
      return this.getVideoDurationsSync(slug, tier);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.warn(`[PCM] safeGetVideoDurationsSync: ${err.message}`);
        return [];
      }
      throw err;
    }
  }

  /**
   * Phase 3: Server-Only — derive từ ratios, throws if cache empty.
   * @param {string} slug
   * @returns {object} { story: '9:16', portrait: '3:4', ... }
   */
  static getRatioUiMapSync(slug) {
    // 1. Check legacy key (backward compat)
    if (this._apiConfigsCache?.data?.[slug]?.configs?.ratio_ui_map) {
      const legacy = this._apiConfigsCache.data[slug].configs.ratio_ui_map;
      if (Object.keys(legacy).length > 0) return legacy;
    }

    // 2. Derive từ ratios (will throw if cache empty)
    const ratios = this.getRatiosSync(slug, 'image');
    if (Array.isArray(ratios) && ratios.length > 0 && ratios[0]?.ui_name) {
      return ratios.reduce((acc, r) => {
        acc[r.ui_name] = r.value;
        return acc;
      }, {});
    }

    // 3. No ui_name in ratios - return empty (not all providers have this)
    return {};
  }

  /**
   * Phase 3: Server-Only — derive từ ratios, throws if cache empty.
   * @param {string} slug
   * @returns {object} { story: 'Story 9:16', ... }
   */
  static getRatioAriaLabelsSync(slug) {
    // 1. Check legacy key (backward compat)
    if (this._apiConfigsCache?.data?.[slug]?.configs?.ratio_aria_labels) {
      const legacy = this._apiConfigsCache.data[slug].configs.ratio_aria_labels;
      if (Object.keys(legacy).length > 0) return legacy;
    }

    // 2. Derive từ ratios (will throw if cache empty)
    const ratios = this.getRatiosSync(slug, 'image');
    if (Array.isArray(ratios) && ratios.length > 0 && ratios[0]?.ui_name) {
      return ratios.reduce((acc, r) => {
        const label = r.ui_name.charAt(0).toUpperCase() + r.ui_name.slice(1);
        acc[r.ui_name] = `${label} ${r.value}`;
        return acc;
      }, {});
    }

    // 3. No ui_name in ratios - return empty (not all providers have this)
    return {};
  }

  // ============ End Phase J Methods ============

  // ───────────────────────────────────────────────────────────────────────
  // Phase 3: SAFE GETTERS (catch ConfigRequiredError, return fallback)
  // Use these in UI components for graceful degradation
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Safe version of getRatiosSync - returns empty array if data unavailable.
   * Use in UI templates where throwing would crash rendering.
   */
  static safeGetRatiosSync(providerSlug, mode) {
    try {
      const result = this.getRatiosSync(providerSlug, mode);
      if (this._DEBUG) console.log(`[PCM] safeGetRatiosSync(${providerSlug}, ${mode}) ✓`, result?.length, 'items');
      return result;
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        if (this._DEBUG) console.log(`[PCM] safeGetRatiosSync(${providerSlug}, ${mode}) → [] (caught ConfigRequiredError)`);
        return [];
      }
      throw err;
    }
  }

  /**
   * Safe version of getErrorPatternsSync - returns empty array if unavailable.
   */
  static safeGetErrorPatternsSync(providerSlug) {
    try {
      const result = this.getErrorPatternsSync(providerSlug);
      if (this._DEBUG) console.log(`[PCM] safeGetErrorPatternsSync(${providerSlug}) ✓`, result?.length, 'patterns');
      return result;
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        if (this._DEBUG) console.log(`[PCM] safeGetErrorPatternsSync(${providerSlug}) → [] (caught ConfigRequiredError)`);
        return [];
      }
      throw err;
    }
  }

  /**
   * Safe version of getDownloadResolutionsSync - returns empty array if unavailable.
   */
  static safeGetDownloadResolutionsSync(providerSlug) {
    try {
      const result = this.getDownloadResolutionsSync(providerSlug);
      if (this._DEBUG) console.log(`[PCM] safeGetDownloadResolutionsSync(${providerSlug}) ✓`, result?.length, 'resolutions');
      return result;
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        if (this._DEBUG) console.log(`[PCM] safeGetDownloadResolutionsSync(${providerSlug}) → [] (caught ConfigRequiredError)`);
        return [];
      }
      throw err;
    }
  }

  /**
   * Safe version of getRatioUiMapSync - returns empty object if unavailable.
   */
  static safeGetRatioUiMapSync(slug) {
    try {
      return this.getRatioUiMapSync(slug);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        return {};
      }
      throw err;
    }
  }

  /**
   * Safe version of getRatioAriaLabelsSync - returns empty object if unavailable.
   */
  static safeGetRatioAriaLabelsSync(slug) {
    try {
      return this.getRatioAriaLabelsSync(slug);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        return {};
      }
      throw err;
    }
  }

  /**
   * Safe version of getSupportsSync - returns empty object if unavailable.
   */
  static safeGetSupportsSync(slug) {
    try {
      return this.getSupportsSync(slug);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        console.warn(`[PCM] safeGetSupportsSync: ${err.message}`);
        return {};
      }
      throw err;
    }
  }

  /**
   * Safe version of getMaxRefImagesSync - returns null if unavailable.
   */
  static safeGetMaxRefImagesSync(slug, mode) {
    try {
      return this.getMaxRefImagesSync(slug, mode);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get quantity_range config (min/max) cho provider — Flow only hiện tại.
   * Format value: {min: 1, max: 4}
   * @param {string} slug
   * @returns {{min:number,max:number}|null}
   */
  static getQuantityRangeSync(slug) {
    const data = this._apiConfigsCache?.data?.[slug]?.configs?.quantity_range;
    if (data && typeof data.min === 'number' && typeof data.max === 'number') {
      return { min: data.min, max: data.max };
    }
    return null;
  }

  /**
   * Safe version of getQuantityRangeSync - returns null if unavailable.
   * Caller fallback to inline default (vd {min:1, max:4}).
   */
  static safeGetQuantityRangeSync(slug) {
    try {
      return this.getQuantityRangeSync(slug);
    } catch (err) {
      if (window.ConfigRequiredError?.is?.(err)) {
        return null;
      }
      throw err;
    }
  }

  // ============ End Phase 3 Safe Getters ============

  /**
   * Internal: fetch /providers/api-configs với cache riêng (TTL 1h).
   * Separate khỏi /dom-selectors vì 2 endpoint khác nhau.
   */
  static async _fetchApiConfigs() {
    // LOCAL: KHÔNG fetch server — trả bundled defaults (primed vào cache + storage).
    if (this._isLocal()) {
      this._primeLocalDefaults();
      return this._apiConfigsCache.data;
    }
    if (this._apiConfigsCache && Date.now() < this._apiConfigsCache.expiresAt) {
      return this._apiConfigsCache.data;
    }
    if (this._apiConfigsFetchPromise) return this._apiConfigsFetchPromise;

    this._apiConfigsFetchPromise = this._doFetchApiConfigs();
    try {
      return await this._apiConfigsFetchPromise;
    } finally {
      this._apiConfigsFetchPromise = null;
    }
  }

  static async _doFetchApiConfigs() {
    try {
      const cached = await this._readApiConfigsCache();
      if (cached && cached.data && Date.now() < (cached.expiresAt || 0)) {
        this._apiConfigsCache = cached;
        if (window.eventBus) {
          window.eventBus.emit('provider:api_configs_loaded', { data: cached.data });
        }
        return cached.data;
      }

      const baseUrl = await this._getApiBaseUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const apiConfigUrl = `${baseUrl}/providers/api-configs`;
      
      let resp;
      try {
        resp = await fetch(apiConfigUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json.success && json.data) {
        this._apiConfigsCache = {
          data: json.data,
          expiresAt: Date.now() + this._CACHE_TTL_MS,
          fetchedAt: Date.now(),
        };
        this._writeApiConfigsCache(this._apiConfigsCache);
        if (window.eventBus) {
          window.eventBus.emit('provider:api_configs_loaded', { data: json.data });
        }
        return json.data;
      }
      throw new Error('Invalid response');
    } catch (e) {
      console.warn('[ProviderConfigManager] api-configs fetch failed:', e.message);
      const cached = await this._readApiConfigsCache();
      if (cached?.data) {
        this._apiConfigsCache = cached;
        return cached.data;
      }
      return {};
    }
  }

  /**
   * Fetch từ API với cache
   */
  static async fetch() {
    // LOCAL: KHÔNG fetch server — trả bundled DOM-selector defaults.
    if (this._isLocal()) {
      this._primeLocalDefaults();
      return this._cache.data;
    }
    if (this._cache && Date.now() < this._cache.expiresAt) {
      return this._cache.data;
    }

    if (this._fetchPromise) return this._fetchPromise;

    this._fetchPromise = this._doFetch();
    try {
      const data = await this._fetchPromise;
      return data;
    } finally {
      this._fetchPromise = null;
    }
  }

  static async _doFetch() {
    try {
      const cached = await this._readCache();
      if (cached && Date.now() < cached.expiresAt) {
        this._cache = cached;
        return cached.data;
      }

      const baseUrl = await this._getApiBaseUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const domSelectorsUrl = `${baseUrl}/providers/dom-selectors`;
      
      let resp;
      try {
        resp = await fetch(domSelectorsUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();

      if (json.success && json.data) {
        const cacheData = {
          data: json.data,
          expiresAt: Date.now() + this._CACHE_TTL_MS,
          fetchedAt: Date.now(),
        };
        this._cache = cacheData;
        await this._writeCache(cacheData);
        if (window.eventBus) {
          window.eventBus.emit('provider:configs_loaded', { data: json.data });
        }
        return json.data;
      }

      throw new Error('Invalid response');
    } catch (e) {
      console.warn('[ProviderConfigManager] Fetch failed, using cache/defaults:', e.message);

      const staleCache = await this._readCache();
      if (staleCache?.data) {
        this._cache = { ...staleCache, expiresAt: Date.now() + 5 * 60 * 1000 };
        return staleCache.data;
      }

      return {};
    }
  }

  /**
   * Force refresh cache
   */
  static async refresh() {
    this._cache = null;
    await this._clearCache();
    return this.fetch();
  }

  /**
   * [Phase 5 2026-05-24] Called by ConfigVersionPoller khi version mismatch.
   * Input: providersVersionMap {flow: 158, chatgpt: 89, grok: 124, gemini: 67}
   * Diff per-provider với cached _cache.data[provider].config_version → fetch nếu ANY mismatch.
   * Force refresh BOTH dom-selectors + api-configs (2 endpoint riêng).
   */
  static async _updateFromVersion(providersVersionMap) {
    if (!providersVersionMap || typeof providersVersionMap !== 'object') return;

    let anyMismatch = false;
    for (const [provider, remoteVersion] of Object.entries(providersVersionMap)) {
      const cachedVersion = this._cache?.data?.[provider]?.config_version;
      if (cachedVersion !== remoteVersion) {
        anyMismatch = true;
        console.log(`[ProviderConfigManager] ${provider} version mismatch: ${cachedVersion} → ${remoteVersion}`);
      }
    }

    if (!anyMismatch) return; // No-op (Polish 3 defensive)

    // Force refresh CẢ 2 cache (dom-selectors + api-configs)
    this._cache = null;
    this._apiConfigsCache = null;
    this._apiConfigsFetchPromise = null; // huỷ reuse fetch in-flight PRE-clear (line 718) → ép fetch fresh post-clear
    // Clear CẢ 2 storage cache — nếu chỉ clear dom-selectors, _doFetchApiConfigs đọc warm api-configs
    // storage cũ + SKIP HTTP → trả stale (version bump nhưng value mới không về).
    await Promise.all([
      this._clearCache().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); }),
      this._clearApiConfigsCache().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); }),
    ]);
    // Fetch parallel
    await Promise.all([
      this.fetch().catch(e => console.warn('[ProviderConfigManager] dom-selectors refresh failed:', e.message)),
      this._fetchApiConfigs().catch(e => console.warn('[ProviderConfigManager] api-configs refresh failed:', e.message)),
    ]);
    // Emit để UI re-render (mirror handleSseUpdate emit pattern)
    if (window.eventBus) {
      window.eventBus.emit('provider:updated', { source: 'version_poller' });
      window.eventBus.emit('provider:api_configs_loaded', { source: 'version_poller', data: this._apiConfigsCache?.data || {} });
    }
  }

  /**
   * Phase 3: Fetch config với mandatory check.
   * @param {string} configType - 'dom_selectors' | 'api_configs'
   * @throws {ConfigRequiredError} nếu server unavailable và cache expired (> 24h)
   */
  static async fetchMandatory(configType) {
    // LOCAL: bundled defaults luôn "mandatory-satisfied".
    if (this._isLocal()) {
      this._primeLocalDefaults();
      return configType === 'api_configs' ? this._apiConfigsCache.data : this._cache.data;
    }
    const ConfigRequiredError = window.ConfigRequiredError;

    // 1. Try server first
    try {
      let data;
      if (configType === 'api_configs') {
        data = await this._fetchApiConfigs();
      } else {
        data = await this._doFetch();
      }

      if (data && Object.keys(data).length > 0) {
        return data;
      }
    } catch (e) {
      console.warn(`[PCM] fetchMandatory server fail for ${configType}:`, e.message);
    }

    // 2. Try cache with grace period
    const cacheKey = configType === 'api_configs' ? this._API_CONFIGS_CACHE_KEY : this._CACHE_KEY;
    const cached = configType === 'api_configs'
      ? await this._readApiConfigsCache()
      : await this._readCache();

    if (cached?.data) {
      const cacheAge = Date.now() - (cached.fetchedAt || cached.expiresAt - this._CACHE_TTL_MS || 0);

      // Within grace period (24h) - use cache
      if (cacheAge < this._GRACE_PERIOD_MS) {
        console.log(`[PCM] Using cached ${configType} (age: ${Math.round(cacheAge / 1000 / 60)}m)`);

        // Update in-memory cache
        if (configType === 'api_configs') {
          this._apiConfigsCache = cached;
        } else {
          this._cache = cached;
        }

        return cached.data;
      }

      // Expired but still return with warning
      console.warn(`[PCM] Cache expired for ${configType}, grace period exceeded`);
    }

    // 3. No data available - throw error
    if (ConfigRequiredError) {
      throw new ConfigRequiredError(configType, 'server_unavailable_cache_expired');
    }

    // Fallback if ConfigRequiredError not loaded (shouldn't happen)
    console.error(`[PCM] CRITICAL: No data for ${configType}, ConfigRequiredError not available`);
    return configType === 'api_configs' ? this._apiConfigsCache?.data || {} : this._cache?.data || {};
  }

  /**
   * Background fetch (fire-and-forget)
   */
  static fetchInBackground() {
    this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
  }

  /**
   * Handle SSE push update
   */
  static handleSseUpdate(data) {
    const { type, provider } = data;

    if (type === 'dom_selector_updated') {
      const { key, value, config_version } = data;
      console.log(`[ProviderConfigManager] SSE selector update: ${provider}.${key}`, value);

      if (this._cache?.data?.[provider]) {
        if (!this._cache.data[provider].selectors) {
          this._cache.data[provider].selectors = {};
        }
        // Store full value object (selectors, attribute, text_match, icon_text, button_text)
        this._cache.data[provider].selectors[key] = value;
        this._cache.data[provider].config_version = config_version;
        this._writeCache(this._cache);
      }

      if (window.eventBus) {
        window.eventBus.emit('provider:selector_updated', { provider, key, value });
      }

      // Notify content scripts via background broadcast
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'providerConfigUpdated', data }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
      }
    }

    if (type === 'provider_status_changed') {
      const { status, name } = data;
      console.log(`[ProviderConfigManager] SSE status change: ${provider} → ${status}`);

      if (this._cache?.data?.[provider]) {
        this._cache.data[provider].status = status;
        this._writeCache(this._cache);
      }

      if (window.eventBus) {
        window.eventBus.emit('provider:status_changed', { provider, status, name });
      }

      if (status === 'disabled' || status === 'maintenance') {
        this._notifyProviderUnavailable(provider, status, name);
      }
    }

    if (type === 'api_config_updated' || type === 'api_config_created' || type === 'api_config_deleted') {
      const key = data.key;
      const value = data.value;
      const configVersion = data.config_version;
      console.log(`[ProviderConfigManager] SSE api_config ${type}: ${provider}.${key}`);

      // Race fix (Bug 19): nếu payload có value đầy đủ, update cache in-place
      // → consumer listener đọc fresh data ngay. Tránh emit trước khi async refetch xong.
      const hasCache = !!this._apiConfigsCache?.data?.[provider];
      const hasValue = value !== undefined && value !== null;

      if (hasCache && hasValue) {
        // Optimistic update — cache in-memory + persist storage để content.js đọc được
        if (!this._apiConfigsCache.data[provider].configs) {
          this._apiConfigsCache.data[provider].configs = {};
        }
        if (type === 'api_config_deleted') {
          delete this._apiConfigsCache.data[provider].configs[key];
        } else {
          this._apiConfigsCache.data[provider].configs[key] = value;
        }
        if (configVersion) this._apiConfigsCache.data[provider].config_version = configVersion;
        this._apiConfigsCache.fetchedAt = Date.now();
        // Persist để content.js + popup windows sync
        this._writeApiConfigsCache(this._apiConfigsCache);
        if (window.eventBus) {
          window.eventBus.emit('provider:api_config_updated', { provider, key, type, value });
        }
        // Notify content scripts qua background broadcast (giống dom_selector_updated)
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ action: 'providerApiConfigUpdated', data }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager', _e); });
        }
      } else {
        // No cache hoặc thiếu value → invalidate + refetch + emit SAU khi fetch xong.
        // Clear CẢ storage cache — nếu không, _doFetchApiConfigs đọc warm storage cũ + SKIP HTTP → stale.
        this._apiConfigsCache = null;
        this._apiConfigsFetchPromise = null;
        // Chain clear TRƯỚC fetch (await) — tránh race read storage cũ trước khi remove flush xong.
        const _emit = () => {
          if (window.eventBus) {
            window.eventBus.emit('provider:api_config_updated', { provider, key, type, value });
          }
        };
        this._clearApiConfigsCache()
          .catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#_emit', _e); })
          .then(() => this._fetchApiConfigs())
          .then(_emit)
          .catch(_emit);
      }
    }
  }

  static _notifyProviderUnavailable(provider, status, name) {
    const messages = {
      disabled: `${name} đã bị tắt tạm thời.`,
      maintenance: `${name} đang bảo trì. Vui lòng thử lại sau.`,
    };

    if (window.SEOSONANotify) {
      window.SEOSONANotify.warning(messages[status] || `${name} không khả dụng.`);
    }
  }

  /**
   * Report selector failure (throttled)
   */
  static _recentFailures = new Map();

  static reportFailure(provider, key, triedSelectors) {
    // LOCAL mode: không gửi analytics selector-failure lên server (offline).
    if (this._isLocal && this._isLocal()) return;
    const throttleKey = `sel_fail_${provider}_${key}`;
    if (this._recentFailures.has(throttleKey)) return;

    this._recentFailures.set(throttleKey, Date.now());
    setTimeout(() => this._recentFailures.delete(throttleKey), 5 * 60 * 1000);

    this._getApiBaseUrl().then(async (baseUrl) => {
      const url = `${baseUrl}/api/v1/analytics/selector-failure`;
      // Build body ONCE — signature hash phải khớp chính xác body gửi đi
      const bodyStr = JSON.stringify({
        provider,
        key,
        tried_selectors: triedSelectors,
        page_url: location?.hostname + location?.pathname,
        timestamp: new Date().toISOString(),
      });
      const headers = {
        'Content-Type': 'application/json',
        'X-Extension-Id': chrome.runtime.id,
      };
      // Sprint 3 HMAC: ký kèm body hash để pass VerifySignature enforce mode (POST)
      try { Object.assign(headers, await (window.RequestSigner?.headers?.('POST', new URL(url).pathname, bodyStr) || {})); } catch (_) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#_emit', _); }
      fetch(url, { method: 'POST', headers, body: bodyStr }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#_emit', _e); });
    });
  }

  // Storage helpers
  static async _readCache() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([this._CACHE_KEY], res => {
          resolve(res[this._CACHE_KEY] || null);
        });
      } else {
        try {
          const cached = localStorage.getItem(this._CACHE_KEY);
          resolve(cached ? JSON.parse(cached) : null);
        } catch {
          resolve(null);
        }
      }
    });
  }

  static async _writeCache(data) {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [this._CACHE_KEY]: data }, resolve);
      } else {
        try {
          localStorage.setItem(this._CACHE_KEY, JSON.stringify(data));
        } catch (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#_emit', _e); }
        resolve();
      }
    });
  }

  static async _clearCache() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove([this._CACHE_KEY], resolve);
      } else {
        try {
          localStorage.removeItem(this._CACHE_KEY);
        } catch (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#_emit', _e); }
        resolve();
      }
    });
  }

  // Clear chrome.storage api-configs cache. CRITICAL: null in-memory `_apiConfigsCache` KHÔNG đủ —
  // `_doFetchApiConfigs` đọc warm storage TRƯỚC + SKIP HTTP nếu chưa expired → invalidate mà không
  // clear storage → refetch trả STALE (bug: SSE bump version nhưng UI không thấy value mới).
  static async _clearApiConfigsCache() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove([this._API_CONFIGS_CACHE_KEY], resolve);
      } else {
        try {
          localStorage.removeItem(this._API_CONFIGS_CACHE_KEY);
        } catch (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#_emit', _e); }
        resolve();
      }
    });
  }

  // ─── API configs persistence (cho content.js access) ────────────────────
  static async _readApiConfigsCache() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([this._API_CONFIGS_CACHE_KEY], res => {
          resolve(res[this._API_CONFIGS_CACHE_KEY] || null);
        });
      } else {
        try {
          const cached = localStorage.getItem(this._API_CONFIGS_CACHE_KEY);
          resolve(cached ? JSON.parse(cached) : null);
        } catch {
          resolve(null);
        }
      }
    });
  }

  static async _writeApiConfigsCache(data) {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [this._API_CONFIGS_CACHE_KEY]: data }, resolve);
      } else {
        try {
          localStorage.setItem(this._API_CONFIGS_CACHE_KEY, JSON.stringify(data));
        } catch (_e) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#_emit', _e); }
        resolve();
      }
    });
  }

  static async _getApiBaseUrl() {
    // Strict Server-Only: ApiBaseConfig là single source of truth (DEFAULT đã có).
    return new Promise(resolve => {
      const webBase = window.ApiBaseConfig?.getWebBase?.();
      if (!webBase) console.debug('[Tier3] ProviderConfigManager._getApiBaseUrl: ApiBaseConfig not loaded');
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['af_api_url'], res => {
          resolve(res.af_api_url || webBase);
        });
      } else {
        resolve(webBase);
      }
    });
  }
}

// Port 1.1.49: seed 2 selector cho feature mới — mention_menu (ChatGPT @-activate image mode) +
// grid_size_small_button (Flow grid nhỏ). Chạy TRƯỚC _primeLocalDefaults() để lọt vào storage cho
// content.js. Selector BEST-EFFORT theo cấu trúc ChatGPT/Flow đã biết — CHƯA verify DOM thật; code
// tiêu thụ có fallback graceful (sai/miss → về hành vi cũ, KHÔNG regression). Cần verify selector
// thật khi có phiên login để feature kích hoạt.
(function _seedNewSelectors_1_1_49() {
  try {
    const S = ProviderConfigManager._LOCAL_DOM_SELECTORS;
    if (!S) return;
    const mk = (selectors) => ({
      anchor_walk_depth: null, aria_labels: null, aria_labels_off: null, aria_labels_on: null,
      aria_pressed_on: null, attribute: null, attribute_id: null, attribute_selected: null,
      button_text: null, class_selected: null, closest_attribute: null, icon_text: null,
      panel_label_text: null, priority: 'P1', selectors, sibling_button_text: null,
      sibling_icon_text: null, text_match: null,
    });
    if (S.chatgpt && S.chatgpt.selectors && !S.chatgpt.selectors.mention_menu) {
      // Popover mở khi gõ "@" trong composer (chứa menu item). menu_items được scoped trong menu này.
      S.chatgpt.selectors.mention_menu = mk([
        '[data-radix-popper-content-wrapper] [role="menu"]',
        '[role="menu"]:has(.__menu-item)',
        'div.popover:has(.__menu-item)',
        '[role="listbox"]:has([role="option"])',
        '[role="menu"]',
      ]);
    }
    if (S.chatgpt && S.chatgpt.selectors && !S.chatgpt.selectors.composer_mode_radio) {
      // Port 1.1.58: radio group Chat/Work ở composer (2026-07). radio[0]=Chat. Neo role=radio.
      S.chatgpt.selectors.composer_mode_radio = mk([
        '[role="radiogroup"] [role="radio"]',
        'form [role="radiogroup"] [role="radio"]',
        '[data-testid*="composer" i] [role="radio"]',
      ]);
    }
    if (S.flow && S.flow.selectors && !S.flow.selectors.grid_size_small_button) {
      // Nút grid size SMALL trong settings (radix — id suffix -trigger-SMALL / value SMALL). PHẢI
      // SMALL-specific (code click nút đầu chưa-active → tránh selector match cả MEDIUM/LARGE).
      S.flow.selectors.grid_size_small_button = mk([
        '[id$="-trigger-SMALL"]',
        'button[value="SMALL"]',
        '[data-value="SMALL"]',
        '[role="tab"][aria-label*="Small" i]',
      ]);
    }
  } catch (e) { try { console.warn('[ProviderConfigManager] seed 1.1.49 selectors fail:', e.message); } catch (_) { globalThis.SEOSONA_swallow?.('ProviderConfigManager#mk', _); } }
})();

// Export for different contexts
if (typeof window !== 'undefined') {
  window.ProviderConfigManager = ProviderConfigManager;
  // LOCAL: prime cache + storage ngay khi load để sync getters + content.js
  // wait-loop có data (không đợi getter đầu tiên).
  if (ProviderConfigManager._isLocal()) {
    ProviderConfigManager._primeLocalDefaults();
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProviderConfigManager;
}
