// FlowApiSpec + FlowApiGateway tests — Phase 1 read-only gateway.
// Acceptance checks lấy từ docs/REPORT-flow-api-bridge-upgrade-2026-07-27.md (Package 1 & 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const load = (p, root) => { new Function('self', readFileSync(join(PKG, p), 'utf8'))(root); return root; };

const root = {};
load('src/core/FlowApiSpec.js', root);
const S = root.FlowApiSpec;

const SHIPPED = JSON.parse(readFileSync(join(PKG, 'config/flow-api.json'), 'utf8'));

// Spec hợp lệ, đã "điền" (dùng cho test resolve/build).
const filled = {
  specVersion: '1.0.0',
  status: 'ready',
  origins: { trpc: 'https://labs.google', api: 'https://aisandbox-pa.googleapis.com' },
  phase: { readOnly: true, allowedOrigins: ['trpc'] },
  endpoints: {
    listProjects: { origin: 'trpc', method: 'GET', path: '/fx/api/trpc/project.list', readOnly: true },
    createProject: { origin: 'trpc', method: 'POST', path: '/fx/api/trpc/project.create', readOnly: false },
    generate: { origin: 'api', method: 'POST', path: '/v1/flow:generate', readOnly: false },
    readOnApi: { origin: 'api', method: 'GET', path: '/v1/credits', readOnly: true },
  },
  redactHeaders: ['authorization', 'cookie'],
  limits: { timeoutMs: 15000, maxResponseBytes: 2000000, maxBodyBytes: 262144 },
};

test('spec đóng gói: hợp lệ nhưng CHƯA dùng được (nằm im)', () => {
  assert.equal(S.validate(SHIPPED).ok, true, 'spec ship kèm phải hợp lệ');
  const u = S.isUsable(SHIPPED);
  assert.equal(u.usable, false);
  assert.ok(['SPEC_EMPTY', 'SPEC_DRAFT'].includes(u.reason), 'phải nêu lý do rõ, got ' + u.reason);
});

test('isUsable: thiếu spec / spec sai → lý do rõ ràng', () => {
  assert.deepEqual(S.isUsable(null), { usable: false, reason: 'SPEC_MISSING' });
  const bad = S.isUsable({ specVersion: 1, origins: {}, phase: {}, endpoints: {} });
  assert.equal(bad.usable, false);
  assert.equal(bad.reason, 'SPEC_INVALID');
  assert.ok(bad.errors.length > 0);
});

test('validate: bắt path traversal / protocol-relative / method lạ', () => {
  const mk = (ep) => ({ ...filled, endpoints: { x: { origin: 'trpc', method: 'GET', path: '/ok', readOnly: true, ...ep } } });
  assert.equal(S.validate(mk({ path: '/a/../b' })).ok, false);
  assert.equal(S.validate(mk({ path: '//evil.com/x' })).ok, false);
  assert.equal(S.validate(mk({ path: 'no-slash' })).ok, false);
  assert.equal(S.validate(mk({ method: 'TRACE' })).ok, false);
  assert.equal(S.validate(mk({ origin: 'nope' })).ok, false);
  assert.equal(S.validate(mk({})).ok, true);
});

test('phase gate: chặn ghi + chặn origin api (chưa security review)', () => {
  assert.equal(S.resolve(filled, 'listProjects').ok, true, 'read trên trpc → cho');
  assert.equal(S.resolve(filled, 'createProject').error, 'WRITE_BLOCKED_IN_PHASE', 'ghi → chặn');
  assert.equal(S.resolve(filled, 'generate').error, 'WRITE_BLOCKED_IN_PHASE');
  assert.equal(S.resolve(filled, 'readOnApi').error, 'ORIGIN_BLOCKED_IN_PHASE', 'đọc nhưng origin api → vẫn chặn');
  assert.equal(S.resolve(filled, 'khongCo').error, 'UNKNOWN_ENDPOINT');
});

test('buildUrl: đúng origin + query scalar; bỏ non-scalar', () => {
  const r = S.buildUrl(filled, 'listProjects', { a: 1, b: 'x', c: true, d: { deep: 1 }, e: null });
  assert.equal(r.ok, true);
  const u = new URL(r.url);
  assert.equal(u.origin, 'https://labs.google');
  assert.equal(u.pathname, '/fx/api/trpc/project.list');
  assert.equal(u.searchParams.get('a'), '1');
  assert.equal(u.searchParams.get('b'), 'x');
  assert.equal(u.searchParams.get('c'), 'true');
  assert.equal(u.searchParams.get('d'), null, 'object bị bỏ');
  assert.equal(u.searchParams.get('e'), null, 'null bị bỏ');
});

test('buildUrl: path tuyệt đối KHÔNG được đổi origin', () => {
  const evil = { ...filled, phase: { readOnly: false, allowedOrigins: ['trpc'] },
    endpoints: { x: { origin: 'trpc', method: 'GET', path: 'https://evil.com/steal', readOnly: true } } };
  // validate bắt trước (path phải bắt đầu bằng "/")
  assert.equal(S.validate(evil).ok, false);
  // và nếu lọt qua validate, buildUrl vẫn phải chặn bằng ORIGIN_MISMATCH
  const r = S.buildUrl(evil, 'x');
  assert.notEqual(r.ok && new URL(r.url).origin, 'https://evil.com');
});

// ─────────────── Gateway ───────────────
const g = {};
load('src/core/FlowApiSpec.js', g);
load('src/core/FlowApiGateway.js', g);
const G = g.FlowApiGateway;

test('gateway: từ chối URL thô (không thể biến thành proxy tuỳ ý)', async () => {
  assert.equal((await G.handle({ url: 'https://evil.com' })).error, 'RAW_URL_NOT_ALLOWED');
  assert.equal((await G.handle({ rawUrl: 'https://evil.com' })).error, 'RAW_URL_NOT_ALLOWED');
});

test('gateway: thiếu tên endpoint → lỗi rõ', async () => {
  assert.equal((await G.handle({})).error, 'ENDPOINT_REQUIRED');
});

test('gateway: spec chưa dùng được → KHÔNG chạm mạng', async () => {
  let fetched = false;
  g.FlowApiSpec.load = async () => SHIPPED;      // spec ship kèm = draft rỗng
  globalThis.fetch = () => { fetched = true; throw new Error('không được gọi'); };
  const r = await G.handle({ endpoint: 'listProjects' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'SPEC_NOT_USABLE');
  assert.equal(fetched, false, 'spec chưa sẵn sàng thì tuyệt đối không fetch');
});

test('gateway: endpoint bị phase chặn → KHÔNG chạm mạng', async () => {
  let fetched = false;
  g.FlowApiSpec.load = async () => filled;
  globalThis.fetch = () => { fetched = true; throw new Error('không được gọi'); };
  assert.equal((await G.handle({ endpoint: 'generate' })).error, 'WRITE_BLOCKED_IN_PHASE');
  assert.equal((await G.handle({ endpoint: 'readOnApi' })).error, 'ORIGIN_BLOCKED_IN_PHASE');
  assert.equal(fetched, false, 'endpoint bị chặn thì không được phát request');
});

test('gateway: ĐƯỜNG CHẠY ĐƯỢC — endpoint read hợp lệ → gọi đúng URL, trả data, che header', async () => {
  let seenUrl = null, seenInit = null;
  g.FlowApiSpec.load = async () => filled;
  globalThis.fetch = async (url, init) => {
    seenUrl = url; seenInit = init;
    const h = new Map([['authorization', 'Bearer ya29.SECRET'], ['content-type', 'application/json']]);
    h.forEach = Map.prototype.forEach.bind(h);
    return { ok: true, status: 200, headers: h, text: async () => JSON.stringify({ projects: [{ id: 'p1' }] }) };
  };
  const r = await G.handle({ endpoint: 'listProjects', query: { limit: 5 } });

  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { projects: [{ id: 'p1' }] }, 'JSON được parse');
  assert.equal(new URL(seenUrl).origin, 'https://labs.google', 'gọi đúng origin same-origin');
  assert.equal(new URL(seenUrl).searchParams.get('limit'), '5');
  assert.equal(seenInit.method, 'GET');
  assert.equal(seenInit.credentials, 'include', 'dùng session sẵn có');
  assert.equal(r.headersSummary.authorization, '[redacted]');
  assert.ok(!JSON.stringify(r.headersSummary).includes('ya29'));
});

test('gateway: response quá lớn → chặn, không trả data', async () => {
  g.FlowApiSpec.load = async () => ({ ...filled, limits: { ...filled.limits, maxResponseBytes: 10 } });
  globalThis.fetch = async () => {
    const h = new Map(); h.forEach = Map.prototype.forEach.bind(h);
    return { ok: true, status: 200, headers: h, text: async () => 'x'.repeat(5000) };
  };
  const r = await G.handle({ endpoint: 'listProjects' });
  assert.equal(r.error, 'RESPONSE_TOO_LARGE');
  assert.equal(r.data, undefined);
});

test('gateway: header nhạy cảm bị che trong kết quả trả về', () => {
  const headers = new Map([['authorization', 'Bearer ya29.secret'], ['cookie', 'sid=abc'], ['content-type', 'application/json']]);
  headers.forEach = Map.prototype.forEach.bind(headers);
  const out = G.redactHeaders(headers, ['authorization', 'cookie']);
  assert.equal(out.authorization, '[redacted]');
  assert.equal(out.cookie, '[redacted]');
  assert.equal(out['content-type'], 'application/json', 'header thường vẫn giữ');
  assert.ok(!JSON.stringify(out).includes('ya29'), 'token không được lọt ra ngoài');
});
