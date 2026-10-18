import { createSearchEngine } from './search-engine.js';

const API_DOMAIN = 'https://api.search.axn.cc.cd';
const SITE_DOMAIN = 'https://search.xxn.cc.cd';
const API_PATHS = new Set(['/api/v1/tool/search', '/api/v1/search', '/api/v1/chat', '/api/search', '/api/summary']);
const encoder = new TextEncoder();

function responseHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra
  };
}
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders })
  });
}
function eventStream(run) {
  const body = new ReadableStream({
    start(controller) {
      let closed = false;
      const emit = (payload) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); }
        catch { closed = true; }
      };
      Promise.resolve().then(() => run(emit)).then(() => {
        emit({ type: 'done' });
        if (!closed) { closed = true; try { controller.close(); } catch {} }
      }).catch((error) => {
        const code = error?.code === 'NO_KEY' ? 'AI not configured'
          : error?.status === 429 ? 'Google AI Studio rate limit reached; retry shortly.'
          : error?.code === 'ETIMEDOUT' ? 'Google AI Studio request timed out.'
          : String(error?.message || 'AI request failed').slice(0, 200);
        emit({ type: 'error', error: code });
        if (!closed) { closed = true; try { controller.close(); } catch {} }
      });
    },
    cancel() {}
  });
  return new Response(body, {
    status: 200,
    headers: responseHeaders({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
  });
}
function cookieMap(request) {
  const out = Object.create(null);
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}
function pickLanguage(url, cookies) {
  return (url.searchParams.get('lang') || cookies.axn_lang || 'en').slice(0, 2).toLowerCase();
}
function pickSafe(url, cookies, fallback) {
  const param = url.searchParams.get('safe');
  if (param !== null) return param === '1' || param.toLowerCase() === 'true';
  if (cookies.axn_safe === '0') return false;
  if (cookies.axn_safe === '1') return true;
  return fallback;
}
function normalizeSuppliedResults(results) {
  if (!Array.isArray(results)) return [];
  return results.slice(0, 10).map((r) => {
    const link = String(r?.link || r?.url || '');
    if (!/^https?:\/\//i.test(link)) return null;
    return {
      title: String(r?.title || '').slice(0, 240),
      link: link.slice(0, 700),
      snippet: String(r?.snippet || '').slice(0, 500),
      source: String(r?.source || '').slice(0, 120)
    };
  }).filter((r) => r && r.title);
}
function errorDetail(error) {
  if (error?.code === 'NO_KEY') return 'Google AI Studio API key is not configured in Worker secrets.';
  if (error?.status === 429) return 'Google AI Studio rate limit reached; retry shortly.';
  if (error?.code === 'ETIMEDOUT') return 'Upstream request timed out.';
  return String(error?.message || 'unknown error').slice(0, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const apiDomain = env.API_DOMAIN || API_DOMAIN;
    const siteDomain = env.SITE_DOMAIN || SITE_DOMAIN;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders() });

    if (path === '/' && request.method === 'GET') {
      return json({
        name: 'AXION Search API', version: '4.2.0', status: 'ok', site: siteDomain, api: apiDomain,
        docs: `${siteDomain}/docs`, modelPolicy: 'automatic-round-robin',
        models: ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'],
        endpoints: ['/api/v1/search', '/api/v1/tool/search', '/api/v1/chat', '/api/search', '/api/summary', '/health']
      });
    }
    if (path === '/health' && request.method === 'GET') {
      const engine = createSearchEngine(env);
      return json({ ok: true, ts: Date.now(), platform: 'cloudflare-workers', aiConfigured: engine.aiConfigured,
        modelPolicy: 'automatic-round-robin', models: engine.MODEL_ROTATION, cpuBudgetMs: 10 });
    }
    if (!API_PATHS.has(path)) return json({ error: 'not found', site: siteDomain, docs: `${siteDomain}/docs` }, 404);
    const methodAllowed = path === '/api/v1/chat' ? request.method === 'POST'
      : path === '/api/summary' ? ['GET', 'POST'].includes(request.method)
      : request.method === 'GET';
    if (!methodAllowed) return json({ error: 'method not allowed' }, 405, { Allow: path === '/api/v1/chat' ? 'POST, OPTIONS' : path === '/api/summary' ? 'GET, POST, OPTIONS' : 'GET, OPTIONS' });

    const engine = createSearchEngine(env);
    const cookies = cookieMap(request);
    const lang = pickLanguage(url, cookies);
    const safe = pickSafe(url, cookies, engine.SAFESEARCH_DEFAULT);
    try {
      if (path === '/api/v1/tool/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return json({ error: 'empty query' }, 400);
        const { results } = await engine.runSearch('web', q, { safe, lang });
        return json({ query: q, results: results.slice(0, 10).map(r => ({ title: r.title, url: r.link, snippet: r.snippet, source: r.source })) });
      }
      if (path === '/api/v1/search' || path === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim();
        let type = (url.searchParams.get('type') || 'all').trim().toLowerCase();
        if (type === 'site' || !type) type = 'all';
        if (!q) return json({ error: 'empty query' }, 400);
        const data = type === 'all' ? await engine.runAllSearch(q, { safe, lang }) : await engine.runSearch(type, q, { safe, lang });
        return json(data);
      }
      if (path === '/api/v1/chat') {
        const contentLength = Number(request.headers.get('content-length') || 0);
        if (contentLength > 192_000) return json({ error: 'request body too large' }, 413);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
        const messages = body?.messages;
        if (!Array.isArray(messages) || !messages.length) return json({ error: 'messages must be a non-empty array' }, 400);
        if (messages.length > 12 || messages.some(m => typeof m?.content !== 'string' || m.content.length > 6000)) return json({ error: 'messages exceed supported limits' }, 413);
        const opts = { lang: String(body?.lang || lang).slice(0, 2), safe: body?.safe !== undefined ? Boolean(body.safe) : safe };
        if (url.searchParams.get('stream') === '1' || body?.stream === true) {
          return eventStream(async emit => { await engine.streamChatAI(messages, opts, emit); });
        }
        return json(await engine.chatAI(messages, opts));
      }
      if (path === '/api/summary') {
        const contentLength = Number(request.headers.get('content-length') || 0);
        if (contentLength > 192_000) return json({ error: 'request body too large' }, 413);
        let body = null;
        if (request.method === 'POST') {
          try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
        }
        const q = String(body?.q || url.searchParams.get('q') || '').trim();
        if (!q) return json({ error: 'empty query' }, 400);
        const suppliedResults = normalizeSuppliedResults(body?.results);
        const aiOn = body?.ai !== false && url.searchParams.get('ai') !== '0';
        const opts = { lang: String(body?.lang || lang).slice(0, 2), safe: body?.safe !== undefined ? Boolean(body.safe) : safe, aiOn };
        const wantsStream = url.searchParams.get('stream') === '1' || body?.stream === true;
        if (wantsStream) {
          return eventStream(async emit => {
            let results = suppliedResults;
            if (!results.length) {
              emit({ type: 'status', message: 'Searching the web…' });
              ({ results } = await engine.runSearch('web', q, { safe: opts.safe, lang: opts.lang }));
            }
            if (!aiOn) { emit({ type: 'complete', summary: null, ai: false, reason: 'ai_off' }); return; }
            await engine.streamSummarizeAI(q, results, opts, emit);
          });
        }
        let results = suppliedResults;
        if (!results.length) ({ results } = await engine.runSearch('web', q, { safe: opts.safe, lang: opts.lang }));
        const out = await engine.summarizeAI(q, results, opts);
        if (!out?.summary) return json({ query: q, summary: null, ai: false, reason: out?.reason || 'ai_off', webCount: results.length });
        return json({ query: q, ...out, ai: true, webCount: results.length });
      }
    } catch (error) {
      if (env.SILENT === '0') console.warn(`[axn-err] ${path.replace('/api/', '')}: ${errorDetail(error)}`);
      return json({ error: error?.code === 'NO_KEY' ? 'AI not configured' : path.endsWith('/chat') ? 'chat failed' : path.endsWith('/summary') ? 'summary failed' : 'search failed', detail: errorDetail(error) }, error?.code === 'NO_KEY' ? 501 : 500);
    }
    return json({ error: 'not found' }, 404);
  }
};
