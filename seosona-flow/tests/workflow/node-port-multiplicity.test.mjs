// SEOSONA regression coverage — NodeTemplates text input ports accept MULTIPLE
// upstream connections. Lets several prompt/text sources feed one node.
// Upstream changed flow(generate)/chatgpt/grok/prompt: text port multiple false→true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

function types() {
  const ctx = loadClassic('src/workflow/NodeTemplates.js', { window: {} });
  return ctx.window.NodeTemplates.types;
}

const NODES_WITH_MULTI_TEXT = ['generate', 'chatgpt', 'grok', 'prompt'];

test('positive: text input ports accept multiple connections on prompt-carrying nodes', () => {
  const t = types();
  for (const key of NODES_WITH_MULTI_TEXT) {
    const port = (t[key]?.ports?.in || []).find((p) => p.name === 'text');
    assert.ok(port, `${key} has a text input port`);
    assert.equal(port.multiple, true, `${key}.text should accept multiple connections`);
  }
});

test('regression: text ports stay text-typed (compat unchanged)', () => {
  const t = types();
  for (const key of NODES_WITH_MULTI_TEXT) {
    const port = (t[key]?.ports?.in || []).find((p) => p.name === 'text');
    assert.equal(port.type, 'text');
  }
});

test('regression: non-text multi ports and the SEOSONA text_template node are untouched', () => {
  const t = types();
  // image_ref stays multiple:true; text_template (SEOSONA-added) already multiple:true
  const gen = (t.generate?.ports?.in || []).find((p) => p.name === 'image_ref');
  assert.equal(gen.multiple, true);
  const tt = (t.text_template?.ports?.in || []).find((p) => p.name === 'text');
  if (tt) assert.equal(tt.multiple, true);
});
