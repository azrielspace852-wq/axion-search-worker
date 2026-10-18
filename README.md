# AXION Search v4.2

AXION Search is a privacy-focused meta-search website with separate Cloudflare Pages and Workers deployments, a live Google AI Studio AI layer, automatic rotation between the two fixed Gemma 4 models, 11 interface/answer languages, SafeSearch, search history in IndexedDB, JSON export/import, OpenSearch integration, and a zero-dependency JavaScript SDK.

## Production architecture

- **Website / Pages:** `https://search.xxn.cc.cd`
- **API / Worker:** `https://api.search.axn.cc.cd`
- **Pages-to-Worker bridge:** `AXION_SEARCH_API` service binding. Browser requests use `/api/*` on the site; Pages Functions forward them to the Worker internally. SDK clients may call the API domain directly.
- **No Cloudflare Tunnel, VPNX proxy, or long-running Node server** is part of the active production architecture.
- **Google AI Studio only:** AI requests are server-side and stream tokens from the selected model. The browser never receives the Google API key.

## Preserved search features

- Web providers: DuckDuckGo, Bing, Google basic/regular, Yahoo, Mojeek, and optional Brave API.
- Images: Bing and DuckDuckGo. Videos: Bing and YouTube. News: Google News RSS and Bing News RSS. Audio: iTunes. Apps, Shop, and AXION ecosystem search remain available.
- Grounded AI summary and chat; API key rotation; automatic model rotation between `gemma-4-31b-it` and `gemma-4-26b-a4b-it`. There is no user-facing model selector and client-supplied model parameters are ignored.
- 11 UI/answer languages; dark/light theme; SafeSearch; search shortcut URLs; OpenSearch, sitemap, robots.txt, documentation and SDK pages.
- Search history is stored in IndexedDB (with one-time migration from the older `localStorage` key). Theme/language and other small preferences remain in localStorage. JSON export/import includes search history.
- Existing API routes remain available: `/api/search`, `/api/summary`, `/api/v1/search`, `/api/v1/chat`, `/api/v1/tool/search`, and `/health`.

## Repository layout

```text
pages/
  public/                    Static HTML, CSS, JavaScript and SDK
  functions/                 Pages Functions /api, /health and /s/* handlers
  wrangler.jsonc             Pages settings and AXION_SEARCH_API binding
workers/
  src/index.js               Fetch-based API Worker
  src/search-engine.js       Lightweight search providers and live AI engine
  wrangler.jsonc             Worker domain, environment and CPU limit
  .dev.vars.example          Local-only secrets template
.github/workflows/           Worker-first, Pages-second deployment workflow
tests/smoke-tests.js         Static/configuration/SDK checks
```

## Configure Google AI Studio

Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey). Keep the key private. Add it to **Workers & Pages → `axion-search-api` → Settings → Variables and Secrets → Secrets** as `GOOGLE_AI_STUDIO_API_KEY_1`. Optional additional keys are `GOOGLE_AI_STUDIO_API_KEY_2` and `GOOGLE_AI_STUDIO_API_KEY_3`; they rotate on upstream errors/quota limits. The model is not configured by the user: the Worker alternates the two fixed model IDs automatically.

For local development, copy `workers/.dev.vars.example` to `workers/.dev.vars` and fill in the key(s). `.dev.vars` is ignored by Git.

With Wrangler CLI from the repository root, secrets can also be set like this:

```bash
npx wrangler secret put GOOGLE_AI_STUDIO_API_KEY_1 --config workers/wrangler.jsonc
npx wrangler secret put GOOGLE_AI_STUDIO_API_KEY_2 --config workers/wrangler.jsonc
npx wrangler secret put GOOGLE_AI_STUDIO_API_KEY_3 --config workers/wrangler.jsonc
# Optional provider:
npx wrangler secret put BRAVE_API_KEY --config workers/wrangler.jsonc
```

`GOOGLE_AI_STUDIO_API_KEY_1` is sufficient. Keys 2 and 3 are optional. `BRAVE_API_KEY` is only needed if you want the optional Brave provider. Do not put secrets in `pages/public`, SDK code, GitHub files, or ordinary public `vars`.

## Deploy

Deploy the Worker first so the Pages service binding target exists, then deploy Pages:

```bash
npm test
npm run deploy:api
npm run deploy:pages
```

Configure `api.search.axn.cc.cd` as the Worker custom domain and `search.xxn.cc.cd` as the Pages custom domain. Confirm the Pages binding `AXION_SEARCH_API` points to Worker service `axion-search-api`. Wrangler config is under `workers/wrangler.jsonc` and `pages/wrangler.jsonc`.

Optional GitHub auto-deploy uses `.github/workflows/deploy-cloudflare.yml`. Add repository secrets `CLOUDFLARE_API_TOKEN` (Workers and Pages deploy permissions) and `CLOUDFLARE_ACCOUNT_ID`. Google/Brave keys are still configured as Worker Secrets in Cloudflare, not GitHub Actions.

## Local development

Install Wrangler if needed (`npm install --global wrangler`). Run the API in one terminal:

```bash
npm run dev:api
```

Run the website in a second terminal:

```bash
npm run dev:pages
```

`dev:pages` supplies the `AXION_SEARCH_API=axion-search-api` binding. If the local binding is not resolved by the installed Wrangler version, start the Worker first, then run `cd pages && npx wrangler pages dev ./public --config wrangler.jsonc --service AXION_SEARCH_API=axion-search-api`.

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/search?q=...&type=all&safe=1&lang=id` | Search. Types: `all`, `web`, `images`, `videos`, `news`, `audio`, `apps`, `shop`, `axion`. The default is `all`. |
| GET | `/api/v1/tool/search?q=...` | Compact results for AI tool/function calling. |
| POST | `/api/v1/chat` | Grounded AI chat; body accepts `messages`, `lang`, and `safe`. Add `?stream=1` for live SSE. |
| GET/POST | `/api/summary` | Grounded summary; add `?stream=1` for live SSE. No model selection parameter is needed. |
| GET | `/api/search?q=...` | Legacy-compatible search endpoint; default type `all`. |
| GET | `/health` | Health, AI-key configured state and fixed model policy; never returns secrets. |

API base URL: `https://api.search.axn.cc.cd`. Site URLs such as `/search` and `/s/<query>` belong to `https://search.xxn.cc.cd`.

## JavaScript SDK

SDK file: `https://search.xxn.cc.cd/sdk/axion-search-sdk.js`.

```html
<script src="https://search.xxn.cc.cd/sdk/axion-search-sdk.js"></script>
<script>
  const axn = new AxionSDK();
  const results = await axn.search('neural networks', { type: 'all', lang: 'en' });
  const summary = await axn.summary('what is AXION?', { lang: 'en' });
  await axn.summaryStream('explain neural networks', { lang: 'en' }, event => {
    if (event.type === 'delta') console.log(event.text); // live output
  });
</script>
```

`summaryStream()` and `chatStream()` use Server-Sent Events; model choice stays on the Worker. Options `apiBase`, `siteBase`, `timeout`, and the older `base` compatibility option are supported.

## CPU budget and runtime notes

The Worker and Pages Functions configs set `limits.cpu_ms` to **10 ms**. Code uses no Cheerio/Axios dependency, bounds upstream HTML payload reads, limits provider fan-out, and avoids a second web search for AI summaries when the UI sends the existing result set. External network waiting is not counted as Worker CPU, but parsing/orchestration still consumes CPU. The configured cap is not a guarantee every possible third-party response will fit the budget; validate actual usage in Cloudflare Metrics after deployment. Cloudflare Workers Free currently documents 10 ms CPU per request; Paid plans permit higher configured limits. See [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## AI model references

The Worker rotates only these Google Gemini API-hosted Gemma 4 model IDs: `gemma-4-31b-it` and `gemma-4-26b-a4b-it`. Google confirms both are supported in the Gemini API: [Run Gemma with the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api).

## License

MIT.
