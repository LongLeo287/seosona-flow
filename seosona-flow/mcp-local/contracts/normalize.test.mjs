#!/usr/bin/env node
/** Unit tests for normalizeResult / toAssets. Run: node contracts/normalize.test.mjs */
import assert from 'node:assert';
import { normalizeResult, toAssets } from './normalize.mjs';

let n = 0;
const t = (label, fn) => { fn(); n++; console.error('ok  ', label); };

// gen_image → assets[] from thumbnails
t('gen_image maps thumbnails to assets', () => {
  const env = normalizeResult('gen_image', {
    job_id: 'j', status: 'completed',
    thumbnails: [{ url: 'http://x/a.png', thumbnail: 'http://x/a_t.png', file_name: 'a.png', type: 'image' }],
    batch: { succeeded: 1, failed: 0 },
  });
  assert.equal(env.ok, true);
  assert.equal(env.tool, 'gen_image');
  assert.equal(env.assets.length, 1);
  assert.equal(env.assets[0].asset_id, 'a.png');
  assert.equal(env.assets[0].kind, 'image');
  assert.equal(env.assets[0].url, 'http://x/a.png');
  assert.deepEqual(env.batch, { succeeded: 1, failed: 0 });
});

// gen_video → kind video via video_url
t('gen_video detects video kind', () => {
  const env = normalizeResult('gen_video', { status: 'completed', thumbnails: [{ video_url: 'http://x/v.mp4', thumbnail: 'http://x/v.jpg' }] });
  assert.equal(env.assets[0].kind, 'video');
  assert.equal(env.assets[0].url, 'http://x/v.mp4');
});

// run_workflow → collected[] also supported
t('run_workflow reads collected[]', () => {
  const env = normalizeResult('run_workflow', { status: 'completed', collected: [{ url: 'http://x/c.png', type: 'image' }] });
  assert.equal(env.assets.length, 1);
  assert.equal(env.assets[0].url, 'http://x/c.png');
});

// discovery → data channel preserved
t('list_voices data preserved', () => {
  const env = normalizeResult('list_voices', { status: 'completed', data: { voices: [{ slug: 'aoede' }] } });
  assert.equal(env.assets, undefined);
  assert.deepEqual(env.data, { voices: [{ slug: 'aoede' }] });
});

// get_context → top-level {project} promoted to data
t('get_context promotes top-level fields', () => {
  const env = normalizeResult('get_context', { status: 'completed', project: { project_id: 'p1' } });
  assert.deepEqual(env.data, { project: { project_id: 'p1' } });
});

// failure → ok=false + error passthrough
t('failed result carries error', () => {
  const env = normalizeResult('gen_image', { status: 'failed', error_code: 'PROVIDER_NOT_LOGGED_IN', error_message: 'login flow' });
  assert.equal(env.ok, false);
  assert.equal(env.error_code, 'PROVIDER_NOT_LOGGED_IN');
  assert.equal(env.error_message, 'login flow');
});

// empty gen → assets []
t('empty thumbnails → []', () => {
  assert.deepEqual(toAssets({}), []);
});

console.error(`\n${n} normalize tests passed`);
