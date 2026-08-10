/**
 * Pure result-normalization for the Flow MCP server: turn the extension's raw result body into the
 * stable Flow↔V2 envelope (FlowResult) documented in flow-asset.schema.json. Kept in its own module
 * (no side effects) so it can be unit-tested without booting the WebSocket server.
 */

// Tools whose result carries generated assets → normalize to FlowAsset[].
export const ASSET_TOOLS = new Set(['gen_image', 'gen_video', 'run_workflow']);

const QUALITY_ACTIONS = new Set(['accept', 'trim', 'regen_image', 'rewrite_prompt', 'review_manually']);

/**
 * Narrow the extension's quality verdict to the contract shape.
 *
 * Returns undefined when quality was not requested, so the field simply stays absent rather than
 * appearing as null — an absent field says "not asked for", a null one says "asked and failed",
 * and callers act differently on those.
 *
 * `judged` is deliberately separate from `pass`: a verdict that could not be produced has
 * pass === null, and a consumer writing `if (a.quality.pass)` must not read that as approval.
 */
export function toQuality(q) {
  if (q == null || typeof q !== 'object') return undefined;
  const judged = q.judged === true;
  const action = QUALITY_ACTIONS.has(q.action) ? q.action : 'review_manually';
  // Normalize ENFORCES the invariant instead of merely copying: an unjudged asset can never carry
  // pass or a score on the way out. Copying faithfully would let a caller inside the extension
  // emit `judged:false, pass:true` and have every downstream reader treat it as approved.
  const pass = judged ? (q.pass === true) : null;
  const score = (judged && typeof q.score === 'number' && Number.isFinite(q.score))
    ? Math.min(10, Math.max(0, q.score))
    : null;
  return {
    judged,
    pass,
    score,
    verdict: typeof q.verdict === 'string' && q.verdict ? q.verdict : 'unjudged',
    action,
    critical: Array.isArray(q.critical) ? q.critical.filter((x) => typeof x === 'string') : [],
  };
}

/** Map the extension's raw result body to a stable FlowAsset[] (see seosona://contract). */
export function toAssets(body) {
  const b = body || {};
  const src = Array.isArray(b.thumbnails) ? b.thumbnails
    : Array.isArray(b.collected) ? b.collected
    : Array.isArray(b.assets) ? b.assets : [];
  return src.map((t, i) => {
    const a = {
      asset_id: t.file_name || t.tile_id || t.asset_id || `asset_${i}`,
      kind: (t.type === 'video' || t.video_url) ? 'video' : 'image',
      url: t.video_url || t.url || t.thumbnail || t.thumbnailUrl || '',
      thumbnail_url: t.thumbnail || t.thumbnailUrl || t.url || '',
      file_name: t.file_name || '',
      provider: t.provider || 'flow',
    };
    const q = toQuality(t.quality);
    if (q) a.quality = q;
    return a;
  });
}

/** Wrap any tool result into the stable Flow↔V2 envelope. */
export function normalizeResult(name, body) {
  const b = body || {};
  const ok = b.status ? b.status === 'completed' : (b.error_code == null && b.errorCode == null);
  const env = { ok, tool: name, status: b.status || (ok ? 'completed' : 'failed') };
  if (b.error_code || b.errorCode) env.error_code = b.error_code || b.errorCode;
  if (b.error_message || b.errorMessage) env.error_message = b.error_message || b.errorMessage;
  if (ASSET_TOOLS.has(name)) {
    env.assets = toAssets(b);
    if (b.batch) env.batch = b.batch;
  } else if (b.data != null) {
    // discovery / provider-status / memory route their fields through the `data` channel
    env.data = b.data;
  } else {
    // project tools (get_context → {project}, upload_ref → {upload}) expose top-level fields
    const { job_id, status, error_code, errorCode, error_message, errorMessage, ...rest } = b;
    env.data = rest;
  }
  return env;
}
