# Open Here

**Find where your business idea has hidden demand.**

Live app: **https://open-here.vercel.app** · Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/)

Open Here is an AI location scout for people opening a local business. Give it a concept (say, an Italian restaurant), a city, and your angle ("cozy date-night spot for young couples"). An agent works through Qloo's taste data and returns:

- **A taste-lift map** showing where affinity for your concept beats what the area's general popularity predicts
- **The top spots**, each named after a real nearby place, with how many of the city's most popular competitors sit within 1 km
- **Who your customers are**: Qloo's age and gender affinity for the people who love places like yours
- **What they love**: their music, films and brands, localized to the city
- **A launch playbook**: best spot, vibe, offer ideas, playlist, partners and an opening pitch, with every playlist and partner name checked against Qloo's data

## Why Qloo is the difference

Click **Compare with plain AI** on any playbook. The same model gets the same brief with no Qloo tools. Then Open Here puts the plain AI's neighborhood on the same Qloo taste map and measures it exactly like its own spots: taste lift, and how many of the city's most popular competitors sit within 1 km.

In the bundled examples:

| Example | Plain AI's pick | Open Here's pick |
|---|---|---|
| Italian date night, Austin | East Austin: taste lift −1 | South Lamar: +15 |
| Ramen, Los Angeles | Little Tokyo: +2, with 8 popular competitors within 1 km | Los Feliz: +37 |
| Wine bar, Brooklyn | Bushwick North: −7 (next to our #3 spot) | Williamsburg: +15 |
| Taqueria, Chicago | Pilsen: +15, a good pick | Armour Square: +20 |

A plain AI can name a plausible neighborhood. It can't see where demand beats popularity, which competitors are already there, or who the audience is. Sometimes its instinct is good (Chicago), and the app says so.

## The agent double-checks Qloo

Before it commits to a plan, the agent records 1 to 3 surprising Qloo results and what it did about them. For example: "Qloo's top artists in South Lamar are country acts, a mismatch for red-sauce romantic dining", so the playlist blends them in rather than leading with them. These checks appear in every playbook under "What the agent double-checked".

## How it works

```
concept + city + brief
        │
        ▼
  Agent (LLM with tools)  ──►  analyze_market   Qloo tags, places, heatmap, demographics, cross-domain taste
        │                  ──►  zone_taste       what people around one spot love (Qloo, location signal)
        │                  ──►  audience_taste   the audience's taste in a domain, optionally by age band
        ▼
  submit_playbook  ──►  validated server-side, names checked against Qloo results by domain
```

**How we call Qloo.** The server calls Qloo's REST API directly (`/v2/tags`, `/v2/insights`, `/search`) with the event-issued key, which stays in server environment variables and never reaches the browser. We didn't use the `@qloo/qloo-harness` CLI or MCP package, because the agent needed fine control over heatmaps, demographics and location signals. Results are cached for 30 minutes, at most 4 calls run at once, and 429 or 5xx responses get a short bounded retry.

### Request to result: Italian date night in Austin

What one search actually asks Qloo, step by step (key redacted, values from the bundled example):

1. **Match the concept to a place category.** `GET /v2/tags?filter.query=Italian restaurant` returns several tags. We keep only place-type tags and pick `urn:tag:category:place:italian_restaurant`, because it matches the head noun with no extra words.
2. **Find the competitors.** `GET /v2/insights?filter.type=urn:entity:place&filter.tags=urn:tag:category:place:italian_restaurant&filter.location.query=Austin&take=50` returns the most popular matching places. Qloo resolves the city as "Austin, Travis County, Texas", and after dropping wrong-kind places and those outside the city cluster, 43 remain.
3. **Map the taste.** `GET /v2/insights?filter.type=urn:heatmap&output.heatmap.boundary=urn:geohash&filter.location.query=Austin&signal.interests.entities=<top 3 competitors>` returns geohash cells with affinity and popularity. We fit affinity against popularity and rank areas by how far affinity beats the prediction (taste lift).
4. **Name and vet each zone.** For each candidate zone, `GET /v2/insights?filter.type=urn:entity:place&filter.location=POINT(lon lat)&filter.location.radius=700` lists nearby places. Their Qloo categories decide whether the zone has a real commercial street, which nearby café or restaurant names it ("Radio Coffee & Beer"), and its neighborhood ("South Lamar"). Zones near airports are dropped.
5. **Profile the audience.** `filter.type=urn:demographics` gives age and gender affinity. `urn:entity:artist`, `urn:entity:movie` and `urn:entity:brand` with `signal.location.query=Austin` (or a zone's `signal.location` point) give cross-domain taste.
6. **Agent and playbook.** The agent sees a summary of steps 1 to 5, asks for more zone or audience taste if it needs it, flags surprising results, and submits a playbook. Each playlist name is checked against the artists Qloo returned, and each partner against the brands.

Result: South Lamar, taste lift +15, none of the top 43 competitors within 1 km, with a playlist and partners drawn from what Qloo says this crowd loves.

**Taste lift.** Qloo's raw heatmap tracks overall popularity closely (we measured r ≈ 0.95 in Austin), so a raw map mostly says "downtown is busy." Open Here fits affinity against popularity across the city and ranks areas by the residual: where people are more drawn to *this* concept than the area's general popularity predicts. It's a scouting signal, not a guarantee.

**Grounding.** Playlist names are only marked "✓ Qloo" if Qloo returned them as artists, and partner names only if Qloo returned them as brands. Anything else is shown as "AI suggestion."

**Agent flow.** The agent streams its steps live. The map appears after about 3 seconds and the playbook after about 12. The first page load replays a recorded real run, so it's instant and free.

## Honest limits

- **Competitor counts are a sample.** Qloo returns the 50 most popular matching places, so smaller spots may not be counted.
- **Coverage varies.** Big cities and common concepts work best. Niche concepts may return no data, and the app then suggests concepts that do have data in that city. Concepts are matched in English.
- **Very dense cities** (like Manhattan) saturate Qloo's scores, leaving little lift. The app flags this as a weak signal.
- **City names can resolve wide** ("New York" can mean the state). Open Here focuses on where competitors actually cluster.
- **Airports** always look like hidden demand, so zones near airports are excluded.

## Run it locally

Requires Node 22. No dependencies to install.

```bash
cp .env.example .env    # add QLOO_API_KEY, QLOO_BASE_URL and DEEPSEEK_API_KEY
npm test
npm run dev             # http://127.0.0.1:3000
```

The four example chips on the live site replay recorded agent runs. Those recordings are cached Qloo results, which Qloo asks participants to keep out of public repos, so they aren't committed. To create your own: `node --env-file=.env scripts/record-example.mjs austin-italian "Italian restaurant" Austin "cozy date-night spot for young couples"`, then `node --env-file=.env scripts/record-baseline.mjs austin-italian`.

Optional settings: `LLM_BASE_URL`, `LLM_MODEL` (default `deepseek-flash`) and `LLM_DAILY_CAP_USD` (default 2). Any OpenAI-compatible Responses API works.

## Project layout

| Path | What |
|---|---|
| `lib/analyze.mjs` | Market pipeline: concept resolution, competitors, taste-lift zones, audience |
| `lib/lift.mjs` | Taste-lift math |
| `lib/agent.mjs` | The agent: tools, validation, grounding |
| `lib/baseline.mjs` | The "without Qloo" comparison |
| `lib/llm.mjs` | LLM client with a daily spend guard |
| `api/` | Vercel functions: `analyze`, `agent` (streaming NDJSON), `baseline` |
| `public/` | The web app (vanilla JS, Leaflet) |
| `scripts/` | Live smoke tests, coverage check, example recording |

## Safety

API keys live only in server environment variables. Every endpoint is rate limited per IP. The agent has a request deadline under the hosting limit, stops when the visitor leaves, and reserves budget before each model call. City and concept for Qloo calls always come from the user, never from the model.

## Attribution

Taste data from the Qloo API. Open Here is an independent hackathon project, not affiliated with or endorsed by Qloo.

## License

MIT. See [LICENSE](LICENSE).
