// Regression (2026-07): a saved LOCAL workflow opened via the sidebar (which passes
// only metadata) must recover its nodes from local storage — not open empty.
// Reproduces the user report: backend-era workflow → nodes undefined → empty canvas.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';

let ext;
test.beforeAll(async () => { ext = await launchExtension(); });
test.afterAll(async () => { await ext?.close(); });

test('local workflow recovers its nodes when opened with metadata-only pending', async () => {
  // 1. seed a full workflow (with nodes) into LOCAL storage, then set a metadata-only pending
  const seed = await ext.context.newPage();
  await seed.goto(ext.extensionUrl('pages/sidebar.html'), { waitUntil: 'domcontentloaded' });
  await seed.waitForTimeout(1500);
  const saved = await seed.evaluate(async () => {
    const wfMeta = { wf_id: 'wf_recover_test', wf_name: 'Recover Test' };
    const nodes = [
      { node_id: 'n1', node_type: 'generate', node_name: 'Gen', pos_x: 100, pos_y: 100 },
      { node_id: 'n2', node_type: 'prompt', node_name: 'Prompt', pos_x: 400, pos_y: 100 },
    ];
    await window.storageManager?._ensureInit?.();
    // Persist via the SAME path the editor uses (saveWorkflowFull → nodes stored locally)
    await window.storageManager.saveWorkflowFull(wfMeta, nodes, []);
    const back = await window.storageManager.getWorkflow('wf_recover_test');
    // pending carries ONLY metadata (like the sidebar list item)
    await chrome.storage.local.set({ _pendingWorkflow: { mode: 'edit', workflow: { wf_id: 'wf_recover_test', wf_name: 'Recover Test' } } });
    return { savedNodes: back?.nodes?.length ?? null };
  });
  await seed.close();
  expect(saved.savedNodes, 'workflow with nodes stored locally').toBe(2);

  // 2. open the editor — it must recover the 2 nodes from local storage
  const p = await ext.context.newPage();
  await p.goto(ext.extensionUrl('pages/workflow-editor.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);

  const nodes = await p.evaluate(() => ({
    isArray: Array.isArray(window.workflowEditor?.workflow?.nodes),
    count: window.workflowEditor?.workflow?.nodes?.length ?? -1,
    visual: document.querySelectorAll('#drawflowCanvas .drawflow-node').length,
  }));

  // nodes must be a real array (guard) AND recovered (2 nodes rendered)
  expect(nodes.isArray, 'workflow.nodes is always an array').toBe(true);
  expect(nodes.count, 'nodes recovered from local storage').toBe(2);
  expect(nodes.visual, 'both nodes rendered on canvas').toBe(2);
  await p.close();
});

test('a workflow with truly no local nodes still opens usable (guard → empty array)', async () => {
  const seed = await ext.context.newPage();
  await seed.goto(ext.extensionUrl('pages/sidebar.html'), { waitUntil: 'domcontentloaded' });
  await seed.evaluate(async () => {
    await chrome.storage.local.set({ _pendingWorkflow: { mode: 'edit', workflow: { wf_id: 'wf_gone_forever', wf_name: 'Gone' } } });
  });
  await seed.close();

  const p = await ext.context.newPage();
  await p.goto(ext.extensionUrl('pages/workflow-editor.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const state = await p.evaluate(() => ({ isArray: Array.isArray(window.workflowEditor?.workflow?.nodes) }));
  expect(state.isArray, 'nodes normalized to [] so the editor stays usable').toBe(true);
  await p.close();
});
