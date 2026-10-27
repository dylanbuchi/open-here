// Small OpenAI-compatible Responses API client with a daily spend guard.
// The guard is per server instance and estimated from reported usage; the
// provider account balance remains the true hard limit.

const PRICE = {
  input: Number(process.env.LLM_PRICE_INPUT_PER_M ?? 0.3) / 1e6,
  cached: Number(process.env.LLM_PRICE_CACHED_PER_M ?? 0.006) / 1e6,
  output: Number(process.env.LLM_PRICE_OUTPUT_PER_M ?? 1.2) / 1e6,
};
const DAILY_CAP_USD = Number(process.env.LLM_DAILY_CAP_USD ?? 2);
const MAX_OUTPUT_TOKENS = 1500;

const ledger = { day: '', spent: 0, reserved: 0 };
const today = () => new Date().toISOString().slice(0, 10);

export class LlmError extends Error {}

export function budgetStatus() {
  if (ledger.day !== today()) Object.assign(ledger, { day: today(), spent: 0, reserved: 0 });
  return { spentUsd: ledger.spent, capUsd: DAILY_CAP_USD, available: ledger.spent + ledger.reserved < DAILY_CAP_USD };
}

// Worst-case cost of one call, reserved up front so concurrent requests on
// this instance cannot all pass the cap check before any usage is charged.
const worstCase = body => (body.length / 2) * PRICE.input + MAX_OUTPUT_TOKENS * PRICE.output;

export function costOf(usage = {}) {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return (usage.input_tokens - cached) * PRICE.input + cached * PRICE.cached + usage.output_tokens * PRICE.output;
}

export function createLlm({
  apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY,
  baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  model = process.env.LLM_MODEL || 'deepseek-flash',
  fetchImpl = fetch,
} = {}) {
  const configured = Boolean(apiKey);

  async function respond({ instructions, input, tools, signal }) {
    if (!configured) throw new LlmError('The AI agent is not configured.');
    const payload = JSON.stringify({ model, instructions, input, tools, max_output_tokens: MAX_OUTPUT_TOKENS, store: false, reasoning: { effort: 'none' } });
    const reserve = worstCase(payload);
    if (!budgetStatus().available || ledger.spent + ledger.reserved + reserve > DAILY_CAP_USD) {
      throw new LlmError('The AI agent hit today\'s spending cap. The map data still works.');
    }

    ledger.reserved += reserve;
    let res, body;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]),
      });
      body = await res.json().catch(() => null);
    } catch (err) {
      // A cancelled call may still have been billed; charge the reservation.
      ledger.spent += reserve;
      throw new LlmError(err.name === 'AbortError' || err.name === 'TimeoutError' ? 'The agent ran out of time. The map data still works.' : 'The AI agent could not respond right now.');
    } finally {
      ledger.reserved -= reserve;
    }
    ledger.spent += body?.usage ? costOf(body.usage) : reserve;
    if (!res.ok) {
      console.error('LLM error', res.status, body?.error?.message);
      throw new LlmError('The AI agent could not respond right now.');
    }
    return body;
  }

  return { configured, model, respond };
}
