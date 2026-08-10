import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(join(root, 'src/core/McpExecutor.js'), 'utf8');

function flowGenerationBody() {
  const start = source.indexOf('static async _executeFlowGen(');
  const end = source.indexOf('static async _executeChatGPTGen(', start);
  assert.ok(start >= 0 && end > start, 'cannot locate the Flow generation method');
  return source.slice(start, end);
}

test('MCP Flow generation does not depend on the user-facing pipeline toggle', () => {
  const body = flowGenerationBody();
  assert.match(body, /!window\.PromptQueue/, 'the PromptQueue implementation must still be present');
  assert.doesNotMatch(
    body,
    /PromptQueue\.isEnabled/,
    'MCP owns its execution request and must not fail just because the UI pipeline toggle is off',
  );
});
