import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../helpers/load-classic.mjs';

function loadPicker() {
  try {
    return loadClassic('src/capture/VisualPickerCore.js').SEOSONA_VisualPickerCore || null;
  } catch (_) {
    return null;
  }
}

test('positive: selector builder prefers a safe element id', () => {
  const V = loadPicker();
  assert.ok(V, 'VisualPickerCore module is available');

  const selector = V.buildCssSelector({
    tagName: 'A',
    id: 'buy-now',
    classes: ['btn', 'primary'],
  });

  assert.equal(selector, '#buy-now');
});

test('boundary: selector builder falls back to semantic classes and nth-of-type', () => {
  const V = loadPicker();
  assert.ok(V, 'VisualPickerCore module is available');

  const selector = V.buildCssSelector({
    tagName: 'BUTTON',
    id: '',
    classes: ['btn', 'btn-primary', 'active', 'x'.repeat(80)],
    nthOfType: 3,
  });

  assert.equal(selector, 'button.btn.btn-primary:nth-of-type(3)');
});

test('positive: selector probe reports unique matches with a preview sample', () => {
  const V = loadPicker();
  assert.ok(V, 'VisualPickerCore module is available');

  const receipt = V.buildProbeReceipt({
    selector: '.price',
    selectorType: 'css',
    matches: [{ text: '$19', href: '', src: '', tagName: 'SPAN' }],
  });

  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, 'unique');
  assert.equal(receipt.matchCount, 1);
  assert.equal(receipt.sample.text, '$19');
});

test('negative: selector probe rejects missing and ambiguous matches distinctly', () => {
  const V = loadPicker();
  assert.ok(V, 'VisualPickerCore module is available');

  assert.equal(V.buildProbeReceipt({ selector: '.missing', matches: [] }).status, 'missing');
  assert.equal(V.buildProbeReceipt({ selector: '.card', matches: [{}, {}] }).status, 'ambiguous');
});

test('positive: picked text becomes an extract_text workflow node draft', () => {
  const V = loadPicker();
  assert.ok(V, 'VisualPickerCore module is available');

  const node = V.toWorkflowNodeDraft({
    selector: '.headline',
    selectorType: 'css',
    extractionType: 'text',
    sample: { text: 'Launch offer' },
  });

  assert.equal(node.node_type, 'extract_text');
  assert.equal(node.selector, '.headline');
  assert.equal(node.selector_type, 'css');
  assert.equal(node.preview, 'Launch offer');
});

test('positive: message handler builds a node draft from picked element data', async () => {
  const V = loadPicker();
  assert.ok(V, 'VisualPickerCore module is available');

  const response = await V.handleMessage({
    action: 'visualPicker:buildNode',
    profile: {
      selector: '.product-title',
      extractionType: 'text',
      sample: { text: 'Running shoe' },
    },
  }, { trusted: true });

  assert.equal(response.ok, true);
  assert.equal(response.node.node_type, 'extract_text');
  assert.equal(response.node.preview, 'Running shoe');
});

test('negative: message handler rejects untrusted visual picker calls', async () => {
  const V = loadPicker();
  assert.ok(V, 'VisualPickerCore module is available');

  const response = await V.handleMessage({
    action: 'visualPicker:buildNode',
    profile: {},
  }, { trusted: false });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'UNTRUSTED_SENDER');
});
