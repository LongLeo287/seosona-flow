// SEOSONA Flow — Privileged Action Registry (Phase 3 / P3.T1, SEC/AUD-009).
// Classic worker script. Default-deny gate for runtime messages.
// BẬT MẶC ĐỊNH từ 2026-08-02. Trước đây observe-only và phải tự bật, nên thực tế
// không ai bật — một lớp bảo vệ không ai kích hoạt thì bằng không có.
// Bật được là nhờ KNOWN_ACTIONS phủ 100% action CÓ HANDLER, và gate `security:actions`
// giữ nó khớp bằng chứng: thêm/bớt handler mà quên đồng bộ thì CI gãy trước, chứ không
// phải chặn nhầm lúc người dùng đang chạy.
// Tắt: đặt storage key SEOSONA_SECURITY_ENFORCE = false (Settings → Advanced).
//
// KNOWN_ACTIONS is derived from artifacts/audit/phase-01/message-contracts.json
// (handled actions). The connector-contract / registry drift test keeps it in
// sync with the inventory. Do not hand-edit the list; regenerate from evidence.
(function (global) {
  'use strict';

  var KNOWN_ACTIONS = [
    "DEVICE_BANNED", "DEVICE_BAN_RETRY", "DEVICE_UNBANNED", "EXTENSION_AUTHORIZED",
    "EXTENSION_AUTH_RETRY", "EXTENSION_NOT_AUTHORIZED", "FETCH_CONFIGS_IF_NEEDED", "activateFlowTabForExecution",
    "addImageToGenTab", "ai_cancel", "ai_command", "apiRequest",
    "auth:oauthLogin", "batchCollector:collect", "binary", "boolean",
    "captcha:userAction", "capture", "captureScreen", "chatAI:execute",
    "chatAI:send", "chatgpt:abort", "chatgpt:activateImageMode", "chatgpt:checkLogin",
    "chatgpt:closeTab", "chatgpt:deleteLastMessage", "chatgpt:ensureActive", "chatgpt:fetchImage",
    "chatgpt:findOrCreateTab", "chatgpt:getTabInfo", "chatgpt:injectScript", "chatgpt:navigated",
    "chatgpt:navigatedBroadcast", "chatgpt:setRatio", "chatgpt:submitAndWait", "chatgpt:tabClosed",
    "checkFlowTabOpen", "checkImageUrl", "checkbox", "chromeDownload",
    "claude:checkLogin", "claude:checkStatus", "claude:closeTab", "claude:deleteCurrentConversation",
    "claude:ensureActive", "claude:findOrCreateTab", "claude:getTabInfo", "claude:injectScript",
    "claude:navigatedBroadcast", "claude:ping", "claude:tabClosed", "clickCreateNewProject",
    "cloneSharedWorkflow", "cloneWorkflowTemplate", "closeExtraProviderTabs", "closeWindow",
    "cloudflare:challenge", "condition", "connectorStatus:evaluate", "contentLog",
    "creator:fetchImage", "creatorTemplateUpdated", "currentProject", "delete",
    "drainLocalToGenTab", "editName", "editWorkflowTemplate", "ensureFlowTabActive",
    "ensureFlowTabReady", "execution:lock_broadcast", "execution:tracker_broadcast", "executionStatusUpdate",
    "fetchBlob", "fetchImageAsBase64", "fetchMedia", "file_id",
    "flow:openSidebar", "flowCreditsScan", "flowHomepageProjectsChanged", "flowTabActivated",
    "focusWorkflowWindow", "frame", "gemini:abort", "gemini:checkLogin",
    "gemini:closeTab", "gemini:deleteCurrentConversation", "gemini:ensureActive", "gemini:findOrCreateTab",
    "gemini:getTabInfo", "gemini:injectScript", "gemini:navigatedBroadcast", "gemini:submitAndWait",
    "gemini:tabClosed", "gen_image", "generate", "getBrowserZoom",
    "getEditingWorkflowId", "getFlowProjectContext", "getProviderApiConfigs", "getProviderConfigs",
    "getSettingsWindowId", "grok", "grok:abort", "grok:applySettings",
    "grok:applySettingsInline", "grok:checkLogin", "grok:checkStatus", "grok:closeTab",
    "grok:ensureActive", "grok:fetchImage", "grok:fetchMedia", "grok:findOrCreateTab",
    "grok:gen_progress", "grok:getTabInfo", "grok:injectScript", "grok:navigated",
    "grok:navigatedBroadcast", "grok:restoreFocus", "grok:setRatio", "grok:submitAndWait",
    "grok:tabClosed", "halt", "header", "hello",
    "hello_ack", "i2p:analyze", "i2p:cancel", "i2p:captureRegion",
    "i2p:checkAccess", "i2p:checkProviders", "i2p:fetchImage", "i2p:genOnFlow",
    "i2p:genToNode", "i2p:getConfig", "i2p:getCtxImageUrl", "i2p:invalidateConfig",
    "i2p:openApp", "i2p:openProviderLogin", "i2p:regionMode", "i2p:sendImageToGen",
    "i2p:setGenPrompt", "i2p:showCard", "i2p:uploadMode", "image",
    "importWorkflowTemplate", "integer", "interval", "keydown",
    "listFlowCharacters", "listFlowLibrary", "loadTemplateInEditor", "loadTemplatePreview",
    "loadWorkflowInEditor", "navigateToProject", "number", "oauth:linked",
    "oauth:success", "object", "openAnglesEditor", "openEffectsEditor",
    "openFlow", "openFlowTab", "openFlowTabForLogin", "openOrActivateTab",
    "openProviderTab", "openSettings", "openSidePanel", "openTemplateEditor",
    "openTemplatePreview", "openWebSpaces", "openWorkflowEditor", "openWorkflowTemplatePreview",
    "openWorkflowTemplatePreviewById", "pa:activateTab", "pa:generate", "pa:getConfig",
    "pa:getFormats", "pa:invalidateFormats", "payment:cancelled", "payment:completed",
    "payment:success", "ping", "pong", "pq:pauseJob",
    "pq:resumeJob", "pq:state_broadcast", "pq:stopAll", "pq:stopJob",
    "pq:trackerUpdate", "prepareDownloadRename", "progress", "projectContext",
    "prompt", "promptExecutionComplete", "promptProgress", "provider:textTask",
    "providerApiConfigUpdated", "providerConfigUpdated", "providerStatus", "queryProviderTabs",
    "queue:pause_job", "queue:resume_job", "queue:stop_all", "queue:stop_job",
    "quota", "reinjectSlateBridge", "reportSelectorFailure", "requestCapturePermission",
    "restorePreviousTab", "result", "retry:status", "runEvents:list",
    "runEvents:markRead", "runEvents:record", "runNode", "runWorkflow",
    "sendWebhook", "setBadge", "setBrowserZoom", "settingsAction",
    "settingsClosed", "settingsSaved", "showNotification", "sourceImport:cleanupExpired",
    "sourceImport:createImage", "sourceImport:get", "sseRelay:entitlements_changed", "sseRelay:force_logout",
    "startCropOnActiveTab", "stopWorkflow", "string", "success",
    "task", "templateCreated", "templateEditorClosed", "templateUpdated",
    "terminal", "text", "updateEditingWorkflowId", "updateProviderUrlsCache",
    "upload", "uploadToFlow", "use", "video",
    "visualPicker:buildNode", "visualPicker:probeSelector", "wm:autoProcess", "wm:fetchImage",
    "workflowClonedFromShared", "workflowDeleted", "workflowEditorClosed", "workflowExecutionEvent",
    "workflowResults:appendRows", "workflowResults:createRun", "workflowResults:exportCsv", "workflowResults:getRun",
    "workflowResults:listRuns", "workflowResults:setStatus", "workflowSaved", "workflowStatus",
    "workflowTemplateImportRequested", "workflow_shared",
  ];
  var KNOWN = new Set(KNOWN_ACTIONS);

  var enforce = false;            // default OFF — fail-open to legacy behavior
  var observations = [];

  function actionOf(msg) {
    if (!msg || typeof msg !== 'object') return null;
    return msg.action || msg.type || msg.cmd || msg.command || null;
  }

  function guard(msg, sender, opts) {
    opts = opts || {};
    var action = actionOf(msg);
    var known = action != null && KNOWN.has(action);
    var decision = {
      action: action, known: known, external: !!opts.external,
      allowed: known, block: false, reason: null,
    };
    if (!known) {
      decision.reason = action == null ? 'NO_ACTION' : 'UNKNOWN_ACTION';
      decision.block = enforce; // only block when enforcing
    }
    observations.push({ action: action, known: known, blocked: decision.block });
    if (observations.length > 500) observations.shift();
    return decision;
  }

  global.SEOSONA_PrivilegedActionRegistry = {
    KNOWN_ACTIONS: KNOWN_ACTIONS,
    guard: guard,
    setEnforce: function (v) { enforce = !!v; },
    isEnforcing: function () { return enforce; },
    isKnown: function (a) { return KNOWN.has(a); },
    observations: function () { return observations.slice(); },
    _knownCount: KNOWN_ACTIONS.length,
  };
})(typeof self !== 'undefined' ? self : this);
