# SEOSONA Project Rules

This project is bound to SEOSONA OS through `seosona.project.json`.

## Startup Contract

1. Resolve SEOSONA OS through `~/.seosona`.
2. Read `~/.seosona/1_CORE/SOUL.md`.
3. Read `~/.seosona/2_KNOWLEDGE/MASTER_INDEX.md`.
4. Query `~/.seosona/1_CORE/scripts/seosona_capability_bridge.js` for routing.
5. Check project memory at `~/.seosona/3_MEMORY/projects/seosona-flow/`.
6. Run project health with `npm run seosona:doctor` when available.

## Project Connector

- Manifest: `seosona.project.json`
- Memory namespace: `seosona-flow`
- Autonomy level: `project_edit`
- Publish/deploy actions require explicit user intent.

## Toolbar UI/UX Standard (SF Toolbar Format)

All toolbars across all tabs must strictly adhere to the following synchronized layout & styling standard:

1. **Toolbar Container (`.sf-toolbar`):**
   - Layout: `display: flex; gap: 8px; align-items: center; width: 100%; box-sizing: border-box; flex-wrap: nowrap; overflow-x: hidden; padding: 0 12px; height: 32px;`
   - Structure: Left group (Search, Reload, Import, Category Filter) -> Spacer (`.sf-spacer { flex: 1 !important; min-width: 8px !important; }`) -> Right Action Button.

2. **Control Heights & Borders:**
   - Every control inside the toolbar MUST have `height: 32px !important;` and `border-radius: 8px !important;`.

3. **Category Dropdown (`.sf-filter-select`):**
   - Flex & Max-Width: `flex: 0 1 auto !important; min-width: 65px !important; max-width: 120px !important;`
   - Text Truncation: `white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;`
   - Prevents long option titles from expanding the select box while scaling cleanly when short text ("Tất cả") is active.

4. **Primary Action Button (`#runAllWorkflowsBtn`, `.ms-spaces-run-all`, etc.):**
   - Flex & Max-Width: `flex: 0 0 auto !important; width: auto !important; max-width: max-content !important; height: 32px !important; border-radius: 8px !important; padding: 0 14px !important; white-space: nowrap !important;`
   - Never stretches endlessly across wide viewports; always docks neatly to the far right.

5. **Responsive Rules (`@media (max-width: 380px)`):**
   - Tighten gaps & padding: `gap: 5px !important; padding: 0 6px !important;`
   - Category dropdown max-width: `max-width: 90px !important;`
   - Action buttons collapse to icon-only (`width: 32px !important; min-width: 32px !important; padding: 0 !important;` with text `display: none !important;`).

