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

Click **Compare with plain AI** on any playbook. The same model gets the same brief with no Qloo tools, and its picks are checked against Qloo's results for that audience.

For the bundled Austin example, the plain AI suggests a generic date-night soundtrack (Norah Jones, Sade, Chet Baker) and vague partners ("Local florists"). **None of its 10 picks** appear in Qloo's top results for people who love Austin's Italian spots. With Qloo, Open Here finds that crowd actually loves Texas country (Randy Rogers Band, Turnpike Troubadours) and local brands like Central Market and Kendra Scott, and it places the restaurant by measured taste, not guesswork.

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

## License

MIT. See [LICENSE](LICENSE).
