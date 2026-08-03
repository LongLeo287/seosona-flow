#!/usr/bin/env node
// P5.T8 — deterministic workflow replay corpus. Runs every regression fixture
// through migrate → schema → limits → execution state machine and produces a
// stable "golden" receipt. --check compares against the committed golden.
import vm from 'node:vm';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot, stableJson } from '../audit/lib/repo.mjs';

const GOLDEN_REL = 'seosona-flow/artifacts/workflow/phase-05/replay-golden.json';
const FIX_REL = 'seosona-flow/tests/fixtures/workflows/regression';

function loadModules(root) {
  const files = [
    'src/workflow/WorkflowSchema.js',
    'src/workflow/WorkflowMigrator.js',
    'src/workflow/ExecutionStateMachine.js',
    'src/workflow/WorkflowLimits.js',
  ];
  const sandbox = { console };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('globalThis.self = globalThis;', ctx);
  for (const f of files) {
    vm.runInContext(readFileSync(join(root, 'seosona-flow', f), 'utf8'), ctx);
  }
  return ctx;
}

// Deterministic execution driven by the fixture's _replay.outcome.
function runExecution(ctx, outcome) {
  const SM = ctx.SEOSONA_ExecutionStateMachine;
  const m = SM.create();
  const scripts = {
    complete: ['START', 'COMPLETE'],
    cancel: ['START', 'CANCEL'],
    'fail-retry-complete': ['START', 'FAIL', 'RETRY', 'COMPLETE'],
  };
  for (const ev of scripts[outcome] || scripts.complete) m.dispatch(ev);
  return { finalState: m.status(), events: m.history().filter((h) => h.applied).map((h) => h.event) };
}

function replayOne(ctx, wf) {
  const migrated = ctx.SEOSONA_WorkflowMigrator.migrate(wf);
  const doc = migrated.ok ? migrated.workflow : wf;
  const schema = ctx.SEOSONA_WorkflowSchema.validate(doc);
  const limits = ctx.SEOSONA_WorkflowLimits.check(doc);
  const outcome = (wf._replay && wf._replay.outcome) || 'complete';
  const exec = (schema.valid && limits.ok) ? runExecution(ctx, outcome) : { finalState: 'not-run', events: [] };
  return {
    name: wf.name,
    migratedFrom: migrated.ok ? migrated.from : null,
    valid: schema.valid,
    errorCount: schema.errorCount || 0,
    violations: limits.violations.map((v) => v.code).sort(),
    nodeCount: schema.nodeCount,
    finalState: exec.finalState,
    events: exec.events,
  };
}

function buildGolden(root) {
  const ctx = loadModules(root);
  const dir = join(root, FIX_REL);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const receipts = files.map((f) => replayOne(ctx, JSON.parse(readFileSync(join(dir, f), 'utf8'))));
  return { schema: 'seosona.workflow.replay-golden.v1', count: receipts.length, receipts };
}

function main() {
  const root = repoRoot();
  const golden = buildGolden(root);
  const serialized = stableJson(golden);
  const goldenPath = join(root, GOLDEN_REL);
  const check = process.argv.includes('--check');

  if (check) {
    if (!existsSync(goldenPath) || readFileSync(goldenPath, 'utf8') !== serialized) {
      console.error('[replay] DRIFT: replay receipts differ from the committed golden.');
      process.exit(1);
    }
    console.log(`[replay] OK ${golden.count} golden outcomes accepted.`);
  } else {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, serialized);
    console.log(`[replay] wrote ${GOLDEN_REL} (${golden.count} receipts).`);
  }
}

// Run only when invoked directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('replay-workflows.mjs')) main();

export { buildGolden };
