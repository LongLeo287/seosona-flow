#!/usr/bin/env node
/**
 * Zero-dep validator for the SEOSONA Flow ↔ Video AI V2 contract (flow-asset.schema.json).
 * Not a full JSON-Schema engine — just the structural checks both products actually rely on, so
 * either side can fail fast on a malformed script.json / FlowResult without pulling a schema lib.
 *
 * Usage:
 *   node validate.mjs script <file.json>     # validate a V2 render script.json
 *   node validate.mjs result <file.json>     # validate an MCP FlowResult envelope
 *   node validate.mjs --self-test            # run built-in fixtures (exit 0 = all pass)
 */

const ASPECTS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const SCENE_TYPES = ['hook', 'body', 'outro'];
const INPUT_SOURCES = ['flow_gen_image', 'flow_gen_video', 'flow_run_workflow', 'flow_asset', 'local'];
const ASSET_KINDS = ['image', 'video'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** @returns {string[]} list of errors ([] = valid) */
export function validateSceneInput(inp, path) {
  const e = [];
  if (!isObj(inp)) return [`${path}: must be an object`];
  if (!INPUT_SOURCES.includes(inp.source)) e.push(`${path}.source: must be one of ${INPUT_SOURCES.join(' | ')}`);
  if (inp.source === 'flow_gen_image' || inp.source === 'flow_gen_video') {
    if (!isStr(inp.prompt)) e.push(`${path}.prompt: required for ${inp.source}`);
  }
  if (inp.source === 'flow_run_workflow' && !isStr(inp.wf_id)) e.push(`${path}.wf_id: required for flow_run_workflow`);
  if (inp.source === 'flow_asset' && !isStr(inp.asset_id)) e.push(`${path}.asset_id: required for flow_asset`);
  return e;
}

export function validateFlowAsset(a, path) {
  const e = [];
  if (!isObj(a)) return [`${path}: must be an object`];
  if (!isStr(a.asset_id)) e.push(`${path}.asset_id: required string`);
  if (!ASSET_KINDS.includes(a.kind)) e.push(`${path}.kind: must be image | video`);
  if (!isStr(a.url)) e.push(`${path}.url: required string`);
  return e;
}

export function validateScript(s) {
  const e = [];
  if (!isObj(s)) return ['root: must be an object'];
  if (!isStr(s.version)) e.push('version: required string');
  if (!ASPECTS.includes(s.aspect)) e.push(`aspect: must be one of ${ASPECTS.join(' | ')}`);
  if (!Array.isArray(s.scenes) || s.scenes.length < 1) {
    e.push('scenes: required non-empty array');
  } else {
    s.scenes.forEach((sc, i) => {
      const p = `scenes[${i}]`;
      if (!isObj(sc)) { e.push(`${p}: must be an object`); return; }
      if (!isStr(sc.id)) e.push(`${p}.id: required string`);
      if (!SCENE_TYPES.includes(sc.type)) e.push(`${p}.type: must be hook | body | outro`);
      if (!isStr(sc.voiceText)) e.push(`${p}.voiceText: required string (V2-owned voiceover text)`);
      if (sc.inputs != null) {
        if (!Array.isArray(sc.inputs)) e.push(`${p}.inputs: must be an array`);
        else sc.inputs.forEach((inp, j) => e.push(...validateSceneInput(inp, `${p}.inputs[${j}]`)));
      }
      if (sc.asset != null) e.push(...validateFlowAsset(sc.asset, `${p}.asset`));
    });
  }
  return e;
}

export function validateFlowResult(r) {
  const e = [];
  if (!isObj(r)) return ['root: must be an object'];
  if (typeof r.ok !== 'boolean') e.push('ok: required boolean');
  if (!isStr(r.tool)) e.push('tool: required string');
  if (r.status !== 'completed' && r.status !== 'failed') e.push('status: must be completed | failed');
  if (r.assets != null) {
    if (!Array.isArray(r.assets)) e.push('assets: must be an array');
    else r.assets.forEach((a, i) => e.push(...validateFlowAsset(a, `assets[${i}]`)));
  }
  if (r.ok === false && !isStr(r.error_code)) e.push('error_code: required string when ok=false');
  return e;
}

// ─────────────────────────── CLI / self-test ───────────────────────────
function selfTest() {
  let fails = 0;
  const check = (label, errs, wantValid) => {
    const ok = wantValid ? errs.length === 0 : errs.length > 0;
    if (!ok) { fails++; console.error(`FAIL ${label}:`, errs); }
    else console.error(`ok   ${label}`);
  };
  check('valid script', validateScript({
    version: '1', aspect: '9:16',
    scenes: [
      { id: 's1', type: 'hook', voiceText: 'Hook line', inputs: [{ source: 'flow_gen_image', prompt: 'a cat' }] },
      { id: 's2', type: 'body', voiceText: 'Body', inputs: [{ source: 'flow_run_workflow', wf_id: 'wf_1' }] },
      { id: 's3', type: 'outro', voiceText: 'Bye', inputs: [{ source: 'flow_asset', asset_id: 'a_1' }] },
    ],
  }), true);
  check('script bad aspect', validateScript({ version: '1', aspect: '2:1', scenes: [{ id: 'x', type: 'hook', voiceText: 'v' }] }), false);
  check('script missing voiceText', validateScript({ version: '1', aspect: '9:16', scenes: [{ id: 'x', type: 'hook' }] }), false);
  check('input missing prompt', validateSceneInput({ source: 'flow_gen_video' }, 'in'), false);
  check('valid result assets', validateFlowResult({ ok: true, tool: 'gen_image', status: 'completed', assets: [{ asset_id: 'a', kind: 'image', url: 'http://x/a.png' }] }), true);
  check('failed result needs code', validateFlowResult({ ok: false, tool: 'gen_image', status: 'failed' }), false);
  check('asset bad kind', validateFlowAsset({ asset_id: 'a', kind: 'gif', url: 'u' }, 'a'), false);
  if (fails) { console.error(`\n${fails} self-test(s) FAILED`); process.exit(1); }
  console.error('\nall self-tests passed');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('validate.mjs')) {
  const [mode, file] = process.argv.slice(2);
  if (mode === '--self-test') { selfTest(); }
  else if ((mode === 'script' || mode === 'result') && file) {
    const { readFileSync } = await import('node:fs');
    let data;
    try { data = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { console.error('cannot read/parse', file, '-', e.message); process.exit(2); }
    const errs = mode === 'script' ? validateScript(data) : validateFlowResult(data);
    if (errs.length) { console.error(`INVALID ${file}:`); errs.forEach((x) => console.error('  -', x)); process.exit(1); }
    console.error(`OK ${file}`);
  } else {
    console.error('usage: node validate.mjs script <file> | result <file> | --self-test');
    process.exit(2);
  }
}
