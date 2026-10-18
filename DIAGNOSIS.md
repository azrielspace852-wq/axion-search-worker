# AXION Search v4.2 — Cloudflare Diagnostics

## Deployment order

1. Run `npm test` from the repository root.
2. Deploy the API Worker first: `npm run deploy:api`.
3. Configure `GOOGLE_AI_STUDIO_API_KEY_1` as a Worker Secret; optional fallbacks are `GOOGLE_AI_STUDIO_API_KEY_2` and `_3`.
4. Deploy Pages: `npm run deploy:pages`.
5. Confirm `api.search.axn.cc.cd` routes to `axion-search-api`, `search.xxn.cc.cd` routes to the Pages project, and Pages binding `AXION_SEARCH_API` targets Worker service `axion-search-api`.
6. Check `https://api.search.axn.cc.cd/health`, then submit a search from the site.

## Common failures

| Symptom | Check |
|---|---|
| Pages API returns 503 | Verify the `AXION_SEARCH_API` Service binding on the Pages production environment, then redeploy Pages. |
| Worker returns 404 on custom hostname | Check the Worker custom domain `api.search.axn.cc.cd` and API route. |
| Search works but AI says not configured | Add `GOOGLE_AI_STUDIO_API_KEY_1` as a Worker Secret. Do not put it in Pages variables or frontend code. |
| Google API returns 400/404 | Confirm API key validity, model availability, and Google AI Studio API access. The Worker has no model selector; it rotates only `gemma-4-31b-it` and `gemma-4-26b-a4b-it`. |
| Google returns 429 | Key quota or rate limit may be exhausted. Additional secrets rotate across configured keys; rotation does not increase the quota for a single key. |
| AI tokens do not appear live | Check that `/api/summary?stream=1` or `/api/v1/chat?stream=1` returns `text/event-stream`, and inspect browser Network → Response. Pages must keep the `AXION_SEARCH_API` service binding. |
| Worker error 1102 | Check Worker CPU metrics and reduce parse work or provider fan-out. CPU limit is configured at 10 ms; network wait itself does not count as CPU. |
| A search provider returns no results | External search sites can change markup or block scraping. The engine rotates supported providers and does not guarantee third-party uptime. |

## Active runtime boundary

Production consists only of `pages/` and `workers/` on Cloudflare. The active deployment does not use Cloudflare Tunnel or VPN/proxy environment variables. No legacy Node server or Tunnel/VPN runtime is included in the release archive.
