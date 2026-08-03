import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../helpers/load-classic.mjs';

function createExecutor() {
  const window = {};
  loadClassic('src/core/WorkflowExecutor.js', {
    window,
    chrome: {},
    navigator: {},
  });
  return new window.WorkflowExecutor();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('file-name lookup keeps every connected image reference and frame name', () => {
  const executor = createExecutor();
  const current = {
    node_id: 'generate',
    ref_file_names: {
      'image-a': 'incorrect-current-name',
    },
  };
  const workflow = {
    nodes: [
      {
        node_id: 'image-source',
        result_file_names: { 'result-a': 'result-a.png' },
        ref_file_names: {
          'image-a': 'image-a.png',
          'image-b': 'image-b.png',
        },
        result_frame_thumbnails: {
          'frame-a': { file_name: 'frame-a.png' },
        },
      },
      current,
    ],
  };

  assert.deepEqual(
    plain(executor._buildFileNameLookup(current, workflow)),
    {
      'result-a': 'result-a.png',
      'image-a': 'image-a.png',
      'image-b': 'image-b.png',
      'frame-a': 'frame-a.png',
    },
  );
});

test('pipeline reference names prefer directly connected image-source metadata', () => {
  const executor = createExecutor();
  const current = {
    node_id: 'generate',
    ref_file_names: {
      'image-a': 'incorrect-current-name',
    },
  };
  const workflow = {
    nodes: [
      {
        node_id: 'image-source',
        result_file_names: { 'result-a': 'result-a.png' },
        ref_file_names: {
          'image-a': 'image-a.png',
          'image-b': 'image-b.png',
        },
      },
      {
        node_id: 'unrelated-image',
        ref_file_names: { unrelated: 'unrelated.png' },
      },
      current,
    ],
    edges: [
      { source_node_id: 'image-source', target_node_id: 'generate' },
    ],
  };

  assert.deepEqual(
    plain(executor._buildPipelineRefNames(current, workflow)),
    {
      'image-a': 'image-a.png',
      'image-b': 'image-b.png',
      'result-a': 'result-a.png',
    },
  );
});
