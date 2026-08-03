/**
 * Pure result-normalization for the Flow MCP server: turn the extension's raw result body into the
 * stable Flow↔V2 envelope (FlowResult) documented in flow-asset.schema.json. Kept in its own module
 * (no side effects) so it can be unit-tested without booting the WebSocket server.
 */

// Tools whose result carries generated assets → normalize to FlowAsset[].
export const ASSET_TOOLS = new Set(['gen_image', 'gen_video', 'run_workflow']);

/** Map the extension's raw result body to a stable FlowAsset[] (see seosona://contract). */
export function toAssets(body) {
  const b = body || {};
  const src = Array.isArray(b.thumbnails) ? b.thumbnails
    : Array.isArray(b.collected) ? b.collected
    : Array.isArray(b.assets) ? b.assets : [];
  return src.map((t, i) => ({
    asset_id: t.file_name || t.tile_id || t.asset_id || `asset_${i}`,
    kind: (t.type === 'video' || t.video_url) ? 'video' : 'image',
    url: t.video_url || t.url || t.thumbnail || t.thumbnailUrl || '',
    thumbnail_url: t.thumbnail || t.thumbnailUrl || t.url || '',
    file_name: t.file_name || '',
    provider: t.provider || 'flow',
  }));
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
