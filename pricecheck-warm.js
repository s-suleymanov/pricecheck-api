// index.js (Modules syntax)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // On-demand warmup: visit .../workers.dev/?now=1
    if (url.searchParams.has('now')) {
      const r = await ping(env.TARGET_URL);
      return new Response(`warmed ${r.status}`, {
        headers: { 'content-type': 'text/plain' }
      });
    }

    // Default lightweight response
    return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  },

  // Scheduled warmup (Cron)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ping(env.TARGET_URL));
  }
};

async function ping(target) {
  if (!target) return new Response(null, { status: 500 });
  // simple GET to wake your Render dyno and DB path
  return fetch(target, {
    method: 'GET',
    headers: { 'cf-warm': '1' },
    // no cache, no gzip needed
    cf: { cacheTtl: 0 }
  });
}
