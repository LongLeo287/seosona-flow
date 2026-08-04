# Magnific Save-As Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Magnific overlay support to the existing PNG, JPEG, and WEBP context-menu save flow.

**Architecture:** Extend `ContextMenuModel` with Magnific-only page-context menu items. Reuse the current cursor resolver, format conversion, filename, permission, and download paths in `background.js` without duplicating them.

**Tech Stack:** Chrome Extension Manifest V3, classic JavaScript, Node.js built-in test runner.

## Global Constraints

- No new dependency or Chrome permission.
- No paywall, premium-download, token, or license bypass.
- No global page-context Save-As item outside Magnific.
- Keep PNG, JPEG, and WEBP behavior compatible with existing callers.

---

### Task 1: Magnific page-context menu contract

**Files:**
- Modify: `tests/unit/context-menu-model.test.mjs`
- Modify: `src/background/ContextMenuModel.js`

**Interfaces:**
- Consumes: `SEOSONA_ContextMenuModel.buildItems(locale)` and `formatFromMenuId(menuId)`.
- Produces: Magnific-only page-context menu definitions mapped to existing format records.

- [ ] **Step 1: Write failing behavior tests**

Add literal assertions that Magnific-only Save-As items use `contexts: ['page']`, `documentUrlPatterns: ['https://magnific.com/*', 'https://*.magnific.com/*']`, and map to PNG/JPEG/WEBP.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/context-menu-model.test.mjs`

Expected: FAIL because no Magnific-specific page-context items exist.

- [ ] **Step 3: Implement the minimum model extension**

Add Magnific URL patterns, a Magnific Save-As submenu ID, three Magnific format menu IDs, and recognition in `formatFromMenuId()`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/context-menu-model.test.mjs`

Expected: all context-menu tests pass.

### Task 2: Integration verification

**Files:**
- Verify: `background.js`
- Verify: `manifest.json`

**Interfaces:**
- Consumes: menu items returned by `buildItems()` and format records returned by `formatFromMenuId()`.
- Produces: no new API; the existing `_saveImageAsFormat()` pipeline handles Magnific clicks.

- [ ] **Step 1: Run syntax checks**

Run: `node --check src/background/ContextMenuModel.js` and `node --check background.js`.

- [ ] **Step 2: Run focused regression tests**

Run: `node --test tests/unit/context-menu-model.test.mjs tests/governance/product-independence.test.mjs`.

- [ ] **Step 3: Run project health**

Run: `npm run seosona:doctor`.

- [ ] **Step 4: Review the final diff**

Confirm only the approved menu model, tests, spec, and plan changed, and confirm no new permission or host permission was added.

