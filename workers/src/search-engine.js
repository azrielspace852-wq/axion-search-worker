/* AXION Search Worker engine — dependency-free, low-CPU parsers. */
let globalAiKeyCursor = 0;
let globalModelCursor = 0;
let globalSearchCursor = 0;

export function createSearchEngine(env = {}) {
  const SILENT = env.SILENT !== '0';
  const SAFESEARCH_DEFAULT = env.SAFESEARCH_DEFAULT !== '0';
  const TIMEOUT = Math.max(1500, Math.min(parseInt(env.TIMEOUT_MS || '12000', 10) || 12000, 30000));
  const AI_KEYS = [
    env.GOOGLE_AI_STUDIO_API_KEY_1 || env.AI_KEY_1,
    env.GOOGLE_AI_STUDIO_API_KEY_2 || env.AI_KEY_2,
    env.GOOGLE_AI_STUDIO_API_KEY_3 || env.AI_KEY_3
  ].filter(Boolean);
  const MODEL_ROTATION = ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
  const DEFAULT_MODEL = 'automatic (Gemma 4 rotation)';
  const logErr = (...items) => {
    if (SILENT) return;
    console.warn('[axn-provider]', ...items.map((x) => String(x?.message || x || 'unknown error')).map((x) => x.slice(0, 160)));
  };
  const MAX_RESPONSE_BYTES = 240 * 1024;

  /* Read only a bounded response body to keep memory/CPU predictable. */
  async function readLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (size < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        const remaining = maxBytes - size;
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining));
          size += remaining;
          await reader.cancel('response body limit reached').catch(() => {});
          break;
        }
        chunks.push(value);
        size += value.byteLength;
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(joined);
  }

  const ax = async (cfg = {}) => {
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Math.min(Number(cfg.timeout) || TIMEOUT, 30000));
    const timer = setTimeout(() => controller.abort('upstream timeout'), timeoutMs);
    try {
      const headers = new Headers(cfg.headers || {});
      let body;
      if (cfg.data !== undefined && cfg.data !== null) {
        if (cfg.data instanceof URLSearchParams || typeof cfg.data === 'string' || cfg.data instanceof ArrayBuffer || ArrayBuffer.isView(cfg.data)) body = cfg.data;
        else {
          body = JSON.stringify(cfg.data);
          if (!headers.has('content-type')) headers.set('content-type', 'application/json');
        }
      }
      const response = await fetch(String(cfg.url || ''), {
        method: String(cfg.method || 'GET').toUpperCase(), headers, body,
        redirect: 'follow', signal: controller.signal
      });
      const contentType = response.headers.get('content-type') || '';
      const raw = await readLimited(response, cfg.maxBytes || MAX_RESPONSE_BYTES);
      let data = raw;
      if (/\bjson\b/i.test(contentType) || /^[\s]*[\[{]/.test(raw)) {
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
      }
      const accepted = typeof cfg.validateStatus === 'function' ? cfg.validateStatus(response.status) : response.status >= 200 && response.status < 300;
      if (!accepted) {
        const error = new Error(`upstream returned HTTP ${response.status}`);
        error.response = { status: response.status, data, headers: response.headers };
        throw error;
      }
      return { data, status: response.status, headers: response.headers };
    } catch (error) {
      if (controller.signal.aborted && !error?.response) {
        const timeoutError = new Error(`upstream timeout after ${timeoutMs}ms`);
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      throw error;
    } finally { clearTimeout(timer); }
  };

  const UA_POOL = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0'
  ];
  const hdr = () => ({ 'User-Agent': UA_POOL[Math.floor(Math.random() * UA_POOL.length)], 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9,id;q=0.8', 'Cache-Control': 'no-cache' });
  const absolute = (href, base) => { try { return new URL(decodeHtml(href), base).href; } catch { return ''; } };
  const safeJson = (s) => { if (!s) return null; try { return JSON.parse(decodeHtml(s)); } catch { try { return JSON.parse(String(s).replace(/\\x22/g, '"')); } catch { return null; } } };
  const blocked = (html = '') => /unusual traffic|captcha|are you a robot|verify you are|sorry, you have been|too many requests/i.test(String(html).slice(0, 50000));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const dedupe = (arr, key = 'link') => { const seen = new Set(); return arr.filter((r) => { const k = r[key] || r.title; if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
  const NSFW = /porn|xxx|sex|nsfw|nude|hentai|onlyfans|brazzers|xnxx|xvideos|pornhub/i;
  const applySafe = (q, on) => on ? `${q} -porn -xxx -nsfw` : q;
  const filterSafe = (results, on) => on ? results.filter(r => !NSFW.test((r.title || '') + ' ' + (r.link || '') + ' ' + (r.snippet || ''))) : results;

  /* Lightweight entity and markup parsing instead of shipping Cheerio to a 10ms CPU Worker. */
  function decodeHtml(value = '') {
    return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);?/gi, (whole, entity) => {
      const e = entity.toLowerCase();
      if (e === 'amp') return '&'; if (e === 'quot') return '"'; if (e === 'apos') return "'";
      if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'nbsp') return ' ';
      const num = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(num) && num >= 0 && num <= 0x10ffff ? String.fromCodePoint(num) : whole; } catch { return whole; }
    });
  }
  function textOf(markup = '') {
    return decodeHtml(String(markup).replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|td|tr|article|section)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
  }
  function attrOf(attrs = '', name) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(attrs).match(new RegExp(`(?:^|\\s)${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? '') : '';
  }
  function anchors(html = '') {
    const out = [];
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    let match;
    while ((match = re.exec(String(html))) !== null) out.push({ attrs: match[1], inner: match[2], href: attrOf(match[1], 'href'), className: attrOf(match[1], 'class'), index: match.index });
    return out;
  }
  function openTags(html = '', tagName = 'div') {
    const out = [];
    const re = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
    let match;
    while ((match = re.exec(String(html))) !== null) out.push({ attrs: match[1], className: attrOf(match[1], 'class'), index: match.index });
    return out;
  }
  function firstTagText(markup = '', tag = 'p') {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i');
    const m = String(markup).match(re);
    return m ? textOf(m[1]) : '';
  }
  function nearbySnippet(html, index, classPattern) {
    const from = Math.max(0, index - 400);
    const around = String(html).slice(from, Math.min(String(html).length, index + 2600));
    const re = new RegExp(`<(?:(?:div)|(?:span)|(?:p))\\b[^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>([\\s\\S]{0,1500}?)<\\/(?:div|span|p)\\s*>`, 'i');
    const m = around.match(re);
    return m ? textOf(m[1]).slice(0, 500) : textOf(firstTagText(around, 'p')).slice(0, 500);
  }
  function xmlItems(xml = '') {
    const out = [];
    const re = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
    let match;
    while ((match = re.exec(String(xml))) !== null) out.push(match[1]);
    return out;
  }
  function xmlValue(item, tag) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i');
    const m = String(item).match(re);
    if (!m) return '';
    let val = m[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
    return textOf(val);
  }

  /* ── Web providers ─────────────────────────────────────── */
  async function webGoogle(q, safeOn) {
    const url = `https://www.google.com/search?num=15&hl=en&q=${encodeURIComponent(applySafe(q, safeOn))}&gws_rd=ssl`;
    const { data } = await ax({ url, headers: { ...hdr(), Referer: 'https://www.google.com/' }, validateStatus: () => true, maxBytes: 190 * 1024 });
    if (blocked(data)) throw new Error('google blocked');
    const out = [];
    for (const a of anchors(data)) {
      if (!/<h3\b/i.test(a.inner)) continue;
      const link = absolute(a.href, 'https://www.google.com/');
      const title = firstTagText(a.inner, 'h3') || textOf(a.inner);
      if (title && /^https?:\/\//.test(link)) out.push({ title, link, snippet: nearbySnippet(data, a.index, 'VwiC3b|IsZvec|ITZIwc|aCOpRe'), source: hostOf(link) });
      if (out.length >= 15) break;
    }
    if (!out.length) throw new Error('google empty');
    return out;
  }
  async function webGoogleBasic(q, safeOn) {
    const url = `https://www.google.com/search?gbv=1&num=15&hl=en&q=${encodeURIComponent(applySafe(q, safeOn))}`;
    const { data } = await ax({ url, headers: { ...hdr(), Referer: 'https://www.google.com/' }, validateStatus: () => true, maxBytes: 190 * 1024 });
    if (blocked(data)) throw new Error('google basic blocked');
    const out = [];
    for (const a of anchors(data)) {
      if (!a.href.startsWith('/url?q=') && !a.href.startsWith('/url?')) continue;
      let link = '';
      try { link = new URL(a.href, 'https://www.google.com').searchParams.get('q') || new URL(a.href, 'https://www.google.com').searchParams.get('url') || ''; } catch {}
      if (!/^https?:\/\//.test(link) || /google\.com|youtube\.com/i.test(link)) continue;
      const title = textOf(a.inner);
      if (title) out.push({ title, link, snippet: nearbySnippet(data, a.index, 'BNeawe|s3v9rd|st'), source: hostOf(link) });
      if (out.length >= 15) break;
    }
    if (!out.length) throw new Error('google basic empty');
    return out;
  }
  async function webBing(q, safeOn, lang = 'en') {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(applySafe(q, safeOn))}&setlang=${encodeURIComponent(lang)}&cc=US&count=20&ensearch=1`;
    const { data } = await ax({ url, headers: { ...hdr(), Referer: 'https://www.bing.com/' }, maxBytes: 190 * 1024 });
    if (blocked(data)) throw new Error('bing blocked');
    const out = [];
    const blocks = String(data).match(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>[\s\S]*?<\/li\s*>/gi) || [];
    for (const block of blocks) {
      const a = anchors(block).find(x => /^https?:/i.test(x.href));
      if (!a) continue;
      const title = textOf(a.inner); const link = absolute(a.href, 'https://www.bing.com');
      const snippet = firstTagText(block, 'p').slice(0, 500);
      if (title && link) out.push({ title, link, snippet, source: hostOf(link) });
      if (out.length >= 15) break;
    }
    if (!out.length) {
      for (const a of anchors(data)) {
        if (!/^https?:/i.test(a.href) || !/<h[23]\b/i.test(data.slice(Math.max(0, a.index - 900), a.index + 50)) || /bing\.com|microsoft\.com|msn\.com|live\.com/i.test(a.href)) continue;
        const title = textOf(a.inner); const link = absolute(a.href, 'https://www.bing.com');
        if (title && link) out.push({ title, link, snippet: nearbySnippet(data, a.index, 'b_caption|b_lineclamp|snippet'), source: hostOf(link) });
        if (out.length >= 15) break;
      }
    }
    if (!out.length) throw new Error('bing empty');
    return out;
  }
  async function webDuckDuckGo(q, safeOn) {
    const body = new URLSearchParams({ q: applySafe(q, safeOn), kl: 'wt-wt' });
    const { data } = await ax({ method: 'post', url: 'https://html.duckduckgo.com/html/', data: body, headers: { ...hdr(), Referer: 'https://duckduckgo.com/', 'Content-Type': 'application/x-www-form-urlencoded' }, maxBytes: 190 * 1024 });
    const out = [];
    for (const a of anchors(data)) {
      if (!/\bresult__a\b/i.test(a.className)) continue;
      const raw = a.href || '';
      let link = raw;
      try { const u = new URL(raw, 'https://duckduckgo.com'); link = u.searchParams.get('uddg') || u.href; } catch {}
      link = absolute(link, 'https://duckduckgo.com');
      const title = textOf(a.inner); const snippet = nearbySnippet(data, a.index, 'result__snippet');
      if (title && /^https?:\/\//.test(link)) out.push({ title, link, snippet, source: hostOf(link) });
      if (out.length >= 15) break;
    }
    if (!out.length) throw new Error('ddg empty');
    return out;
  }
  async function webYahoo(q, safeOn) {
    const url = `https://search.yahoo.com/search?p=${encodeURIComponent(applySafe(q, safeOn))}&n=15`;
    const { data } = await ax({ url, headers: { ...hdr(), Referer: 'https://search.yahoo.com/' }, maxBytes: 190 * 1024 });
    const out = [];
    for (const a of anchors(data)) {
      const before = String(data).slice(Math.max(0, a.index - 1200), a.index);
      if (!/<h3\b/i.test(before) || !/\b(?:algo|Sr|compTitle)\b/i.test(before.slice(-900))) continue;
      let link = a.href || '';
      const ru = link.match(/(?:^|\/)RU=([^/]+)/i);
      if (ru) { try { link = decodeURIComponent(ru[1]); } catch {} }
      link = absolute(link, 'https://search.yahoo.com');
      const title = textOf(a.inner);
      if (title && /^https?:\/\//.test(link)) out.push({ title, link, snippet: nearbySnippet(data, a.index, 'compText|lh-16|s-desc'), source: hostOf(link) });
      if (out.length >= 15) break;
    }
    if (!out.length) throw new Error('yahoo empty');
    return out;
  }
  async function webMojeek(q, safeOn) {
    const url = `https://www.mojeek.com/search?q=${encodeURIComponent(applySafe(q, safeOn))}`;
    const { data } = await ax({ url, headers: hdr(), maxBytes: 190 * 1024 });
    const out = [];
    for (const a of anchors(data)) {
      if (!/\b(?:ob|title)\b/i.test(a.className)) continue;
      const link = absolute(a.href, 'https://www.mojeek.com'); const title = textOf(a.inner);
      if (title && /^https?:\/\//.test(link)) out.push({ title, link, snippet: nearbySnippet(data, a.index, 's|desc|snippet'), source: hostOf(link) });
      if (out.length >= 15) break;
    }
    if (!out.length) throw new Error('mojeek empty');
    return out;
  }
  async function webBrave(q, safeOn) {
    const key = env.BRAVE_API_KEY;
    if (!key) throw new Error('brave no key');
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(applySafe(q, safeOn))}&count=15&safesearch=${safeOn ? 'strict' : 'off'}`;
    const { data } = await ax({ url, headers: { Accept: 'application/json', 'X-Subscription-Token': key }, maxBytes: 180 * 1024 });
    const out = (data.web?.results || []).map(r => ({ title: r.title, link: r.url, snippet: r.description, source: hostOf(r.url) }));
    if (!out.length) throw new Error('brave empty');
    return out;
  }

  /* ── Images / Videos / News / Audio ─────────────────────── */
  async function imgBing(q, safeOn) {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(applySafe(q, safeOn))}&first=1`;
    const { data } = await ax({ url, headers: { ...hdr(), Referer: 'https://www.bing.com/' }, maxBytes: 180 * 1024 });
    const out = [];
    for (const tag of openTags(data, 'a')) {
      if (!/\biusc\b/i.test(tag.className)) continue;
      const meta = safeJson(attrOf(tag.attrs, 'm')); if (!meta) continue;
      const src = meta.murl || ''; if (!/^https?:/i.test(src)) continue;
      out.push({ title: textOf(meta.t || ''), link: src, thumb: meta.turl || '', source: hostOf(src) });
      if (out.length >= 12) break;
    }
    if (!out.length) throw new Error('bing img empty');
    return out;
  }
  async function imgDuckDuckGo(q, safeOn) {
    const vqdHtml = await ax({ url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`, headers: hdr(), maxBytes: 100 * 1024 });
    const vqd = (String(vqdHtml.data).match(/vqd=['"]([^'"]+)['"]/i) || [])[1];
    if (!vqd) throw new Error('ddg vqd fail');
    const url = `https://duckduckgo.com/i.js?o=json&q=${encodeURIComponent(applySafe(q, safeOn))}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=${safeOn ? 1 : -1}`;
    const { data } = await ax({ url, headers: { ...hdr(), Referer: 'https://duckduckgo.com/' }, maxBytes: 180 * 1024 });
    const out = (data.results || []).map(r => ({ title: r.title, link: r.image, thumb: r.thumbnail, source: hostOf(r.image) })).filter(r => /^https?:/i.test(r.link || '')).slice(0, 12);
    if (!out.length) throw new Error('ddg img empty');
    return out;
  }
  async function vidBing(q, safeOn) {
    const url = `https://www.bing.com/videos/search?q=${encodeURIComponent(applySafe(q, safeOn))}`;
    const { data } = await ax({ url, headers: { ...hdr(), Referer: 'https://www.bing.com/' }, maxBytes: 180 * 1024 });
    const out = [];
    for (const tag of openTags(data, 'div')) {
      if (!/\bmc_vtvc\b/i.test(tag.className)) continue;
      const meta = safeJson(attrOf(tag.attrs, 'm')); if (!meta) continue;
      const link = meta.p || meta.vurl || ''; if (!/^https?:/i.test(link)) continue;
      out.push({ title: textOf(meta.t || ''), link, thumb: meta.imgurl || meta.thumbnailUrl || '', source: meta.pub || meta.provider || hostOf(link), duration: meta.d || '' });
      if (out.length >= 12) break;
    }
    if (!out.length) throw new Error('bing vid empty');
    return out;
  }
  async function vidYouTube(q, safeOn) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(applySafe(q, safeOn))}&sp=${safeOn ? 'EgQQARgB' : ''}`;
    // The response is intentionally bounded for low CPU/memory use. A large ytInitialData
    // object may be truncated, so fall back to extracting only the first few videoRenderer records.
    const { data } = await ax({ url, headers: hdr(), maxBytes: 200 * 1024 });
    const raw = String(data);
    const m = raw.match(/ytInitialData\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/) || raw.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});/);
    const j = m ? safeJson(m[1]) : null;
    const items = j?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
    const out = [];
    for (const it of items) {
      const v = it.videoRenderer; if (!v) continue;
      out.push({ title: v.title?.runs?.[0]?.text || '', link: `https://www.youtube.com/watch?v=${v.videoId}`, thumb: v.thumbnail?.thumbnails?.[0]?.url || '', source: v.longBylineText?.runs?.[0]?.text || 'YouTube', duration: v.lengthText?.simpleText || '' });
      if (out.length >= 12) break;
    }
    if (!out.length) {
      const rendererPattern = /"videoRenderer"\s*:\s*\{/g;
      let match;
      while ((match = rendererPattern.exec(raw)) && out.length < 12) {
        const blockStart = match.index + match[0].length;
        let block = raw.slice(blockStart, Math.min(raw.length, blockStart + 12000));
        const nextRenderer = block.search(/"videoRenderer"\s*:\s*\{/);
        if (nextRenderer >= 0) block = block.slice(0, nextRenderer);
        const videoId = block.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{6,})"/);
        const rawTitle = block.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!videoId || !rawTitle) continue;
        let title = rawTitle[1];
        try { title = JSON.parse('"' + title + '"'); } catch { title = decodeHtml(title); }
        const thumb = block.match(/"thumbnail"\s*:\s*\{[\s\S]{0,2000}?"url"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const rawDuration = block.match(/"lengthText"\s*:\s*\{[\s\S]{0,600}?"simpleText"\s*:\s*"((?:\\.|[^"\\])*)"/);
        let thumbnail = thumb ? thumb[1] : ''; let duration = rawDuration ? rawDuration[1] : '';
        try { thumbnail = JSON.parse('"' + thumbnail + '"'); } catch {}
        try { duration = JSON.parse('"' + duration + '"'); } catch {}
        out.push({ title: decodeHtml(title), link: `https://www.youtube.com/watch?v=${videoId[1]}`, thumb: thumbnail, source: 'YouTube', duration });
      }
    }
    if (!out.length) throw new Error('yt empty');
    return dedupe(out).slice(0, 12);
  }
  async function newsGoogle(q, safeOn, lang = 'en') {
    const hl = { id: 'id', en: 'en', es: 'es', fr: 'fr', de: 'de', zh: 'zh-Hans', ja: 'ja', ar: 'ar', hi: 'hi', ru: 'ru', pt: 'pt' }[lang] || 'en';
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(applySafe(q, safeOn))}&hl=${hl}&gl=US&ceid=US:en`;
    const { data } = await ax({ url, headers: hdr(), maxBytes: 150 * 1024 });
    const out = [];
    for (const item of xmlItems(data)) {
      const title = xmlValue(item, 'title'); const link = xmlValue(item, 'link'); const pub = xmlValue(item, 'pubDate');
      const snippet = xmlValue(item, 'description').slice(0, 500);
      if (title && /^https?:/i.test(link)) out.push({ title, link, snippet, source: pub, date: pub });
      if (out.length >= 12) break;
    }
    if (!out.length) throw new Error('news empty');
    return out;
  }
  async function newsBing(q, safeOn) {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(applySafe(q, safeOn))}&format=rss`;
    const { data } = await ax({ url, headers: hdr(), maxBytes: 150 * 1024 });
    const out = [];
    for (const item of xmlItems(data)) {
      const title = xmlValue(item, 'title'); const link = xmlValue(item, 'link');
      const snippet = xmlValue(item, 'description').slice(0, 500);
      if (title && /^https?:/i.test(link)) out.push({ title, link, snippet, source: hostOf(link) });
      if (out.length >= 12) break;
    }
    if (!out.length) throw new Error('bing news empty');
    return out;
  }
  async function audioITunes(q) {
    const { data } = await ax({ url: `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=all&limit=18`, maxBytes: 150 * 1024 });
    const out = (data.results || []).map(r => ({
      title: `${r.trackName || r.collectionName || ''} — ${r.artistName || ''}`.trim(),
      link: r.trackViewUrl || r.collectionViewUrl || '', thumb: r.artworkUrl100 || '',
      source: r.kind || r.wrapperType || 'Audio', duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) + 's' : ''
    })).filter(r => r.title && /^https?:/i.test(r.link)).slice(0, 12);
    if (!out.length) throw new Error('itunes empty');
    return out;
  }

  const PROVIDER_MAP = {
    web: [webDuckDuckGo, webBing, webGoogleBasic, webYahoo, webGoogle, webMojeek, webBrave],
    images: [imgBing, imgDuckDuckGo],
    videos: [vidBing, vidYouTube],
    news: [newsGoogle, newsBing],
    audio: [audioITunes],
    apps: [(q, s, l) => webBing(`${q} app OR site:play.google.com OR site:apps.apple.com`, s, l), webDuckDuckGo, webYahoo],
    shop: [(q, s, l) => webBing(`${q} buy OR shop OR price OR jual OR harga`, s, l), webDuckDuckGo, webYahoo],
    axion: [(q, s, l) => webBing(`site:axn.cc.cd ${q}`, s, l), (q, s) => webDuckDuckGo(`site:axn.cc.cd ${q}`, s), (q, s, l) => webYahoo(`site:axn.cc.cd ${q}`, s)]
  };
  const PROVIDER_BUDGET = { web: 2, images: 1, videos: 1, news: 1, audio: 1, apps: 1, shop: 1, axion: 1 };
  function rotateStart(len) { const start = globalSearchCursor++ % Math.max(1, len); return start; }
  async function runSearch(type, q, opts = {}) {
    if (type === 'site' || !PROVIDER_MAP[type]) type = type === 'site' ? 'all' : 'web';
    if (type === 'all') return runAllSearch(q, opts);
    if (type === 'web' && !opts._skipPriority && /\baxion\b/i.test(q) && !/^site:axn\.cc\.cd\s/i.test(q)) {
      const [axion, general] = await Promise.all([runSearch('axion', q, { ...opts, _skipPriority: true }), runSearch('web', q, { ...opts, _skipPriority: true })]);
      const prioritized = dedupe([...(axion.results || []), ...(general.results || [])]);
      return { type: 'web', query: q, count: prioritized.length, results: prioritized.slice(0, 30) };
    }
    const fns = PROVIDER_MAP[type];
    const start = rotateStart(fns.length);
    const safeOn = opts.safe ?? SAFESEARCH_DEFAULT;
    const lang = opts.lang || 'en';
    const requestedBudget = opts._fromAll && type === 'web' ? 1 : (PROVIDER_BUDGET[type] || 1);
    const budget = Math.min(fns.length, Math.max(1, requestedBudget));
    const ordered = Array.from({ length: budget }, (_, i) => fns[(start + i) % fns.length]);
    const settled = await Promise.allSettled(ordered.map(fn => fn(q, safeOn, lang)));
    let merged = [];
    settled.forEach((entry, i) => {
      if (entry.status === 'fulfilled') merged = dedupe(merged.concat(entry.value || []));
      else logErr(`provider ${ordered[i].name || 'anonymous'} [${type}]`, entry.reason);
    });
    merged = filterSafe(merged, safeOn);
    return { type, query: q, count: merged.length, results: merged.slice(0, 30) };
  }
  async function runAllSearch(q, opts = {}) {
    const [web, images, videos, news, audio] = await Promise.allSettled([
      runSearch('web', q, { ...opts, _fromAll: true, _skipPriority: true }), runSearch('images', q, opts), runSearch('videos', q, opts), runSearch('news', q, opts), runSearch('audio', q, opts)
    ]);
    const val = (p) => p.status === 'fulfilled' ? p.value.results : [];
    return { type: 'all', query: q,
      count: val(web).length + val(images).length + val(videos).length + val(news).length + val(audio).length,
      web: val(web).slice(0, 10), images: val(images).slice(0, 6), videos: val(videos).slice(0, 5), news: val(news).slice(0, 5), audio: val(audio).slice(0, 3) };
  }

  /* ── Google AI Studio: live streamGenerateContent + fixed Gemma 4 rotation ── */
  const LANG_NAME = { id: 'Bahasa Indonesia', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', zh: '中文', ja: '日本語', ar: 'العربية', hi: 'हिन्दी', ru: 'Русский', pt: 'Português' };
  function httpError(response, body) {
    let message = `Google AI Studio returned HTTP ${response.status}`;
    try { const parsed = JSON.parse(body); message = parsed.error?.message || message; } catch {}
    const error = new Error(message.slice(0, 240));
    error.status = response.status;
    if (response.status === 429) error.code = 'RATE_LIMITED';
    if (response.status === 401 || response.status === 403) error.code = 'INVALID_KEY';
    return error;
  }
  function shouldRetry(error) { return [401, 403, 404, 408, 429].includes(error?.status) || error?.status >= 500 || error?.code === 'ETIMEDOUT'; }
  async function generateAI(prompt, onEvent = null) {
    if (!AI_KEYS.length) { const e = new Error('Google AI Studio API key is not configured'); e.code = 'NO_KEY'; throw e; }
    const startModel = globalModelCursor++ % MODEL_ROTATION.length;
    const models = Array.from({ length: MODEL_ROTATION.length }, (_, i) => MODEL_ROTATION[(startModel + i) % MODEL_ROTATION.length]);
    let lastError = null;
    for (const model of models) {
      const keyStart = globalAiKeyCursor % AI_KEYS.length;
      for (let k = 0; k < AI_KEYS.length; k++) {
        const keyIndex = (keyStart + k) % AI_KEYS.length;
        const key = AI_KEYS[keyIndex];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort('Google AI Studio timeout'), TIMEOUT);
        let response;
        try {
          const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`);
          endpoint.searchParams.set('alt', 'sse');
          endpoint.searchParams.set('key', key);
          response = await fetch(endpoint.href, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 850 } })
          });
          if (!response.ok) {
            const body = await readLimited(response, 12 * 1024);
            const err = httpError(response, body); lastError = err;
            if (shouldRetry(err)) continue;
            // A model-specific rejection should try the other configured model.
            if (response.status === 400) break;
            throw err;
          }
          globalAiKeyCursor = (keyIndex + 1) % AI_KEYS.length;
          if (onEvent) onEvent({ type: 'meta', model });
          const reader = response.body?.getReader();
          if (!reader) throw new Error('Google AI Studio returned an empty stream');
          const decoder = new TextDecoder();
          let buffer = ''; let fullText = '';
          const consumeEvent = (rawEvent) => {
            const data = rawEvent.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
            if (!data || data === '[DONE]') return;
            let payload;
            try { payload = JSON.parse(data); } catch { return; }
            const parts = payload?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (typeof part.text !== 'string' || !part.text) continue;
              fullText += part.text;
              if (onEvent) onEvent({ type: 'delta', text: part.text });
            }
            const apiError = payload?.error?.message;
            if (apiError) throw new Error(String(apiError).slice(0, 200));
          };
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let boundary;
              while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
                const eventText = buffer.slice(0, boundary);
                const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
                buffer = buffer.slice(boundary + delimiter.length);
                consumeEvent(eventText);
              }
            }
            buffer += decoder.decode();
            if (buffer.trim()) consumeEvent(buffer);
          } catch (error) {
            try { await reader.cancel(); } catch {}
            // Once text was emitted, retrying would produce duplicated/contradictory output.
            if (fullText) throw error;
            lastError = error;
            break;
          } finally { try { reader.releaseLock(); } catch {} }
          if (fullText.trim()) return { text: fullText.trim(), model };
          lastError = new Error(`Model ${model} returned no text`);
          break;
        } catch (error) {
          if (controller.signal.aborted && !error?.status) error.code = 'ETIMEDOUT';
          lastError = error;
          if (!shouldRetry(error) && error?.code !== 'NO_KEY') throw error;
        } finally { clearTimeout(timer); }
      }
    }
    throw lastError || new Error('Both Gemma 4 models and available keys failed');
  }
  async function summarizeAI(query, webResults, opts = {}) {
    if (opts.aiOn === false) return { summary: null, ai: false, reason: 'ai_off', model: null };
    if (!webResults?.length) return { summary: null, ai: false, reason: 'no_web_results', model: null };
    const lang = LANG_NAME[opts.lang] || 'English';
    const ctx = webResults.slice(0, 8).map((r, i) => `[${i + 1}] ${String(r.title || '').slice(0, 240)}\n${String(r.snippet || '').slice(0, 500)}\n${String(r.link || '').slice(0, 500)}`).join('\n\n');
    const prompt = `You are AXION, a search assistant. Answer using the context below. If the context does not contain the answer, say so explicitly in ${lang}; do not invent facts, numbers, or sources. Cite sources by number like [1]. Reply in ${lang}. Be concise (max 3 short paragraphs).\nQuery: "${String(query).slice(0, 1000)}"\nContext:\n${ctx}\nAnswer in ${lang}:`;
    const generated = await generateAI(prompt);
    return { summary: generated.text, model: generated.model };
  }
  async function streamSummarizeAI(query, webResults, opts = {}, emit = () => {}) {
    if (opts.aiOn === false) { emit({ type: 'complete', summary: null, ai: false, reason: 'ai_off' }); return { summary: null, ai: false }; }
    if (!webResults?.length) { emit({ type: 'error', error: 'No web results were available to summarize.' }); return { summary: null, ai: false }; }
    const lang = LANG_NAME[opts.lang] || 'English';
    const ctx = webResults.slice(0, 8).map((r, i) => `[${i + 1}] ${String(r.title || '').slice(0, 240)}\n${String(r.snippet || '').slice(0, 500)}\n${String(r.link || '').slice(0, 500)}`).join('\n\n');
    const prompt = `You are AXION, a search assistant. Answer using the context below. If the context does not contain the answer, say so explicitly in ${lang}; do not invent facts, numbers, or sources. Cite sources by number like [1]. Reply in ${lang}. Be concise (max 3 short paragraphs).\nQuery: "${String(query).slice(0, 1000)}"\nContext:\n${ctx}\nAnswer in ${lang}:`;
    const generated = await generateAI(prompt, emit);
    emit({ type: 'complete', summary: generated.text, model: generated.model });
    return { summary: generated.text, model: generated.model };
  }
  async function chatAI(messages, opts = {}) {
    if (!Array.isArray(messages) || !messages.length) throw new Error('no messages');
    const lang = LANG_NAME[opts.lang] || 'English';
    const lastQ = String(messages[messages.length - 1].content || '').slice(0, 12000);
    const { results } = await runSearch('web', lastQ, { safe: opts.safe, lang: opts.lang });
    const ctx = results.slice(0, 6).map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet || ''}\n${r.link}`).join('\n\n') || '(no web results found — clearly mark uncertainty)';
    const history = messages.slice(-5).map(m => `${m.role === 'user' ? 'User' : 'AXION'}: ${String(m.content).slice(0, 2500)}`).join('\n');
    const prompt = `You are AXION, a helpful search assistant chatting in ${lang}. Use the fresh web context to answer the user's latest message. Cite sources by number like [1]. If context is insufficient, say so; never invent. Keep replies concise and in ${lang}.\n\nFresh web context:\n${ctx}\n\nConversation:\n${history}\n\nAXION (in ${lang}):`;
    const generated = await generateAI(prompt);
    return { reply: generated.text, model: generated.model, sources: results.slice(0, 6), webCount: results.length };
  }
  async function streamChatAI(messages, opts = {}, emit = () => {}) {
    if (!Array.isArray(messages) || !messages.length) throw new Error('no messages');
    emit({ type: 'status', message: 'Searching the web for current context…' });
    const lang = LANG_NAME[opts.lang] || 'English';
    const lastQ = String(messages[messages.length - 1].content || '').slice(0, 12000);
    const { results } = await runSearch('web', lastQ, { safe: opts.safe, lang: opts.lang });
    const sources = results.slice(0, 6);
    emit({ type: 'sources', sources, webCount: results.length });
    const ctx = sources.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet || ''}\n${r.link}`).join('\n\n') || '(no web results found — clearly mark uncertainty)';
    const history = messages.slice(-5).map(m => `${m.role === 'user' ? 'User' : 'AXION'}: ${String(m.content).slice(0, 2500)}`).join('\n');
    const prompt = `You are AXION, a helpful search assistant chatting in ${lang}. Use the fresh web context to answer the user's latest message. Cite sources by number like [1]. If context is insufficient, say so; never invent. Keep replies concise and in ${lang}.\n\nFresh web context:\n${ctx}\n\nConversation:\n${history}\n\nAXION (in ${lang}):`;
    const generated = await generateAI(prompt, emit);
    emit({ type: 'complete', reply: generated.text, model: generated.model, sources, webCount: results.length });
    return { reply: generated.text, model: generated.model, sources, webCount: results.length };
  }

  return {
    runSearch, runAllSearch, summarizeAI, streamSummarizeAI, chatAI, streamChatAI,
    SAFESEARCH_DEFAULT, DEFAULT_MODEL, MODEL_ROTATION,
    TIMEOUT, aiConfigured: AI_KEYS.length > 0, proxyConfigured: false
  };
}
