#!/usr/bin/env node
/**
 * Contract tests for the `quality` field on FlowAsset (contract 1.1.0).
 *
 * The thing under test is not "does the field copy across" — it is the invariant that an UNJUDGED
 * asset can never come out of normalize carrying pass or a score. A consumer that writes
 * `if (asset.quality.pass) publish()` must not be able to publish an image nobody looked at.
 */
import { toAssets, toQuality, normalizeResult } from './normalize.mjs';
import { validateQuality, validateFlowAsset, validateFlowResult } from './validate.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (label, cond, extra) => {
  if (cond) { console.error(`ok   ${label}`); return; }
  fails++; console.error(`FAIL ${label}`, extra === undefined ? '' : extra);
};
const eq = (label, a, b) => check(label, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

const JUDGED_PASS = { judged: true, pass: true, score: 8.7, verdict: 'good', action: 'accept', critical: [] };

// ── absent vs null: two different facts, two different caller behaviours ──
check('no quality asked → field ABSENT, not null',
  toAssets({ thumbnails: [{ url: 'u', file_name: 'a.png' }] })[0].quality === undefined);
check('toQuality(undefined) → undefined', toQuality(undefined) === undefined);
check('toQuality(null) → undefined', toQuality(null) === undefined);

// ── the invariant ──
const un = toQuality({ judged: false, pass: true, score: 9.9, verdict: 'unjudged', action: 'review_manually' });
check('judged=false CANNOT carry pass=true', un.pass === null, un);
check('judged=false CANNOT carry a score', un.score === null, un);
// Asserted via eq() on purpose. Comparing a dotted action property against a quoted string is
// how the message-contract scanner recognises a handler, so writing it that way here would file
// a fake entry into the privileged-action security registry straight from a test file. The
// scanner reads raw text, so the same care applies to comments — do not spell the shape out.
eq('unjudged keeps action=review_manually', un.action, 'review_manually');

const forged = toQuality({ judged: false, pass: true, score: 10, verdict: 'excellent', action: 'accept' });
check('a forged "excellent unjudged" is defanged on the way out',
  forged.pass === null && forged.score === null);
check('...and the defanged shape still validates', validateQuality(forged, 'q').length === 0,
  validateQuality(forged, 'q'));

// ── passthrough of a real verdict ──
const good = toQuality(JUDGED_PASS);
eq('a judged verdict passes through intact', good, JUDGED_PASS);
check('score is clamped to 0..10', toQuality({ ...JUDGED_PASS, score: 42 }).score === 10);
eq('unknown action falls back to review_manually',
  toQuality({ ...JUDGED_PASS, action: 'delete_everything' }).action, 'review_manually');
check('non-string entries are dropped from critical',
  toQuality({ ...JUDGED_PASS, critical: ['real', 7, null, 'also real'] }).critical.length === 2);

// ── validator catches the shapes normalize refuses to emit ──
check('validator rejects judged=false + pass=true',
  validateQuality({ judged: false, pass: true, score: null, verdict: 'unjudged', action: 'review_manually' }, 'q').length > 0);
check('validator rejects judged=true + pass=null',
  validateQuality({ judged: true, pass: null, score: 5, verdict: 'poor', action: 'regen_image' }, 'q').length > 0);
check('validator rejects an out-of-range score',
  validateQuality({ ...JUDGED_PASS, score: 11 }, 'q').length > 0);
check('validator rejects a bogus action',
  validateQuality({ ...JUDGED_PASS, action: 'ship_it' }, 'q').length > 0);
check('validator accepts a well-formed verdict', validateQuality(JUDGED_PASS, 'q').length === 0);

// ── asset + envelope level ──
check('an asset with no quality is still valid (field is optional)',
  validateFlowAsset({ asset_id: 'a', kind: 'image', url: 'u' }, 'a').length === 0);
check('a bad quality block fails its parent asset',
  validateFlowAsset({ asset_id: 'a', kind: 'image', url: 'u', quality: { judged: 'yes' } }, 'a').length > 0);

const env = normalizeResult('gen_image', {
  status: 'completed',
  thumbnails: [
    { url: 'u1', file_name: 'a.png', quality: JUDGED_PASS },
    { url: 'u2', file_name: 'b.png', quality: { judged: false, verdict: 'unjudged', action: 'review_manually' } },
    { url: 'u3', file_name: 'c.png' },
  ],
});
check('envelope carries quality through gen_image', env.assets[0].quality.score === 8.7);
check('mixed batch: judged and unjudged coexist', env.assets[1].quality.judged === false);
check('mixed batch: an unasked asset stays absent', env.assets[2].quality === undefined);
check('the whole envelope validates', validateFlowResult(env).length === 0, validateFlowResult(env));

// A CRITICAL defect must fail regardless of score — averaging hides a six-fingered hand.
const crit = toQuality({ judged: true, pass: false, score: 9.4, verdict: 'critical_fail', action: 'regen_image', critical: ['six fingers'] });
check('critical_fail survives normalization with pass=false', crit.pass === false && crit.score === 9.4);
check('critical_fail validates', validateQuality(crit, 'q').length === 0);

// ── schema and code must agree, or the docs lie ──
const schema = JSON.parse(readFileSync(join(__dirname, 'flow-asset.schema.json'), 'utf8'));
check('schema declares contract 1.1.0', schema.contractVersion === '1.1.0', schema.contractVersion);
check('FlowAsset.quality is declared', !!schema.$defs.FlowAsset.properties.quality);
const schemaActions = schema.$defs.Quality.properties.action.enum;
for (const a of schemaActions) {
  check(`schema action "${a}" is accepted by the validator`,
    validateQuality({ judged: true, pass: true, score: 8, verdict: 'good', action: a }, 'q').length === 0);
}
const serverSrc = readFileSync(join(__dirname, '..', 'server.mjs'), 'utf8');
check('server CONTRACT_VERSION matches the schema',
  serverSrc.includes(`const CONTRACT_VERSION = '${schema.contractVersion}'`));
// Slice the actual tool block instead of matching within N characters: a fixed-width window
// silently spills into the NEXT tool, so the check would pass on the wrong declaration.
function toolBlock(name) {
  const i = serverSrc.indexOf(`name: '${name}'`);
  if (i < 0) return '';
  const j = serverSrc.indexOf("name: '", i + 8);
  return serverSrc.slice(i, j < 0 ? serverSrc.length : j);
}
for (const t of ['gen_image', 'gen_video']) {
  check(`${t} exposes quality_gate`, toolBlock(t).includes('quality_gate'));
}
check('judge_assets is a bridge command, NOT a public tool',
  !toolBlock('judge_assets') && serverSrc.includes("runCommand('judge_assets'"));

if (fails) { console.error(`\n${fails} quality contract check(s) FAILED`); process.exit(1); }
console.error('\nquality: all checks passed');
