# Open Here

**Find where your business idea has hidden demand.**

Try it: **https://open-here.vercel.app** · Made for the [Qloo Agentic Hackathon](https://qloo.devpost.com/)

Tell Open Here what you want to open, where, and what you're going for, like "Italian restaurant, Austin, cozy date-night spot for young couples". An agent digs through Qloo's data while you watch and comes back with:

- **A map of hidden demand:** areas where interest in your concept is higher than the area's general popularity would suggest
- **The best spots by neighborhood**, each with a well-known place nearby and how many popular competitors are within 1 km
- **Who likes places like yours:** which age groups like this kind of place more or less than average, and the gender lean
- **What they're into:** music, films and brands, for the city and for each spot
- **A launch plan:** best spot, vibe, menu ideas, a playlist, partner brands and an opening pitch. Every artist and brand is checked against what Qloo actually returned.

## Why it needs Qloo

Click **Compare with plain AI** under any plan. The same model gets the same request, just without Qloo and in a single answer. Then Open Here puts the plain AI's neighborhood on the same map and scores both picks exactly the same way: average taste lift within 1 km, and popular competitors within 1 km.

From the examples on the site:

| Example | Plain AI's pick | Open Here's pick |
|---|---|---|
| Italian date night, Austin | East Austin: −1 | Downtown, on Rainey Street: +5 |
| Ramen, Los Angeles | Little Tokyo: +2, with 8 popular competitors within 1 km | Venice: +12 |
| Wine bar, Brooklyn | Bushwick North: −7 | Red Hook: +4 |
| Taqueria, Chicago | Pilsen: +15, a good pick near my #4 spot | Brighton Park: +25 |

To be fair about what this shows: Open Here picks spots using this same map, so it has a home advantage here. The comparison shows that a plain AI picks without seeing the map, not that Open Here's picks will sell more. Sometimes the plain AI's instinct is good, like Pilsen, and the app says so.

## The agent double-checks itself

Before it commits to a plan, the agent flags one to three results that look off and says what it did about each, without inventing explanations the data doesn't support. In Austin it noticed the crowd's top artists are Texas country acts rather than classic Italian dinner music, so it kept the mellow ones for quiet evenings. In Los Angeles it passed over the top-ranked spot because it's a drive-heavy stretch that doesn't suit a quick after-work bowl, and picked Venice instead. When something can't be explained from the data, it says so. You'll find these under "What the agent double-checked" in every plan.

## How it works

```
concept + city + brief
        │
        ▼
  Agent (LLM with tools)  ──►  analyze_market   Qloo tags, places, heatmap, demographics, taste
        │                  ──►  zone_taste       what people who go to one spot's places are into
        │                  ──►  audience_taste   the audience's taste, optionally for some age groups
        ▼
  submit_playbook  ──►  checked on the server, names verified against what Qloo returned
```

**Taste lift.** Qloo's raw heatmap mostly follows how busy an area is (r ≈ 0.95 in Austin), so on its own it just says "go downtown". I compare interest in your concept against general popularity across the city, and a spot's taste lift is the average gap within 1 km of it. That's the same measure used for the plain AI's pick. Then I keep only spots with real businesses around them, so no airports, parks or zoos. It measures taste, not sales or rent, so treat it as a lead worth checking in person.

**One spot's crowd.** Qloo quietly ignores or barely weighs some parameters, so I tested the ones I use. A location point on its own hardly changed the taste results: two Austin zones 15 km apart got almost the same artists. Using the places actually in a zone works much better. Fans of South Lamar's record and vintage shops lean toward Rayland Baxter and Nikki Lane, while The Domain mall's crowd leans mainstream country and Louis the Child.

**Calling Qloo.** The server talks to Qloo's REST API directly (`/v2/tags`, `/v2/insights`, `/search`), the way Qloo's developer guide shows. I skipped the `@qloo/qloo-harness` CLI because I wanted fine control over heatmaps, demographics and location. The key stays on the server. Results are cached for 30 minutes, at most 4 calls run at once and no more than 8 start per second, and 429 or 5xx errors get a short retry.

**Checking names.** An artist only gets the "✓ Qloo" mark if Qloo returned it as an artist, and a partner only if Qloo returned it as a brand. Anything else shows up as an "AI suggestion".

**Speed.** You see each step as it happens. The map shows up after about 3 seconds and the plan after 15 to 20. The example buttons replay real recorded runs, so they load instantly.

### One search, step by step

What the Austin example actually asks Qloo (key left out, numbers from the example):

1. **Turn the concept into a place category.** `GET /v2/tags?filter.query=Italian restaurant` returns a handful of tags. I only keep place categories and pick `urn:tag:category:place:italian_restaurant`, since it matches the main word with nothing extra.
2. **Find the competitors.** `GET /v2/insights?filter.type=urn:entity:place&filter.tags=urn:tag:category:place:italian_restaurant&filter.location.query=Austin&take=50` returns the most popular matching places. Qloo reads the city as "Austin, Travis County, Texas". After dropping the wrong kinds of places and anything outside the city, 43 are left.
3. **Map the demand.** `GET /v2/insights?filter.type=urn:heatmap&output.heatmap.boundary=urn:geohash&filter.location.query=Austin&signal.interests.entities=<top 3 competitors>` returns map cells with interest and popularity scores. These turn into taste lift, and candidate spots are ranked by their average within 1 km.
4. **Check each spot.** For each candidate, `GET /v2/insights?filter.type=urn:entity:place&filter.location=POINT(lon lat)&filter.location.radius=700` lists what's around it. Their categories decide whether there's a real street of businesses, which well-known place to name the spot after ("Emmer & Rye"), and the neighborhood ("Downtown"). Spots near airports are dropped.
5. **Learn about the audience.** `filter.type=urn:demographics` gives the age and gender lean. Artists, films and brands with `signal.location.query=Austin` show what they're into. For one spot, the agent uses that spot's own places instead.
6. **Write the plan.** The agent gets a summary of all this, asks for more detail if it wants it, flags anything that looks off, and submits the plan. Every artist and brand in it is checked against what Qloo returned.

The result: Downtown on Rainey Street near Emmer & Rye, taste lift +5, with 2 of the top 43 competitors within 1 km. Another Downtown spot also scored +5 but had 10 competitors nearby, so the agent set it aside.

## Limits

- **Competitor counts are a sample.** Qloo returns the 50 most popular matching places, so smaller spots may be missing.
- **Coverage depends on the city and concept.** Big cities and common concepts work best. Concepts are matched in English, and if a search finds nothing, the app suggests concepts that do have data there.
- **Very dense cities** like Manhattan can max out Qloo's scores, leaving little to rank. The app warns you when that happens.
- **City names can be ambiguous.** "New York" can mean the state, so Open Here focuses on where the competitors actually are and shows which place Qloo matched.

## Run it locally

You need Node 22. There's nothing to install.

```bash
cp .env.example .env    # add QLOO_API_KEY, QLOO_BASE_URL and DEEPSEEK_API_KEY
npm test
npm run dev             # http://127.0.0.1:3000
```

The example buttons on the live site replay recorded runs. Those recordings are cached Qloo results, and Qloo asks participants to keep those out of public repos, so they aren't in here. To make your own: `node --env-file=.env scripts/record-example.mjs austin-italian "Italian restaurant" Austin "cozy date-night spot for young couples"`, then `node --env-file=.env scripts/record-baseline.mjs austin-italian`.

Optional settings: `LLM_BASE_URL`, `LLM_MODEL` (default `deepseek-flash`) and `LLM_DAILY_CAP_USD` (default 2). Any OpenAI-compatible Responses API works.

## Project layout

| Path | What's in it |
|---|---|
| `lib/analyze.mjs` | Market analysis: concept matching, competitors, taste-lift spots, audience |
| `lib/lift.mjs` | The taste-lift math |
| `lib/agent.mjs` | The agent: tools, checks, name verification |
| `lib/baseline.mjs` | The "without Qloo" comparison |
| `lib/llm.mjs` | LLM client with a daily spending cap |
| `api/` | Vercel functions: `analyze`, `agent` (streams its steps) and `baseline` |
| `public/` | The web app (plain JavaScript and Leaflet) |
| `scripts/` | Live test runs, a coverage check and example recording |

## Safety

API keys only live in server environment variables. Every endpoint is rate limited per visitor. The agent has a deadline that fits the hosting limit, stops when you leave the page, and sets aside budget before each model call. The city and concept sent to Qloo always come from you, not from the model.

## Attribution

Taste data from the Qloo API. Open Here is an independent hackathon project, not affiliated with or endorsed by Qloo.

## License

MIT. See [LICENSE](LICENSE).
