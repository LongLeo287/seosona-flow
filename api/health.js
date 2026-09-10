// Kiểm tra deployment còn sống — /health hoặc /api/health
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    project: "SEOSONA Flow",
    slug: "seosona-flow",
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    region: process.env.VERCEL_REGION || null,
    env: process.env.VERCEL_ENV || 'development',
    at: new Date().toISOString()
  });
}
