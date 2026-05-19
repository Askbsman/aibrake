// Tiny model → $/1k-token pricing table for the auto-patch.
//
// We only need a rough estimate to populate `next_action.estimated_cost`
// — the detector cares about *relative* spend, not exact billing. Update
// when major models drop or shift tier.

const PRICING_PER_1K_TOKENS_USD: Record<string, number> = {
  // OpenAI — input pricing (output is ~3× but we approximate)
  "gpt-4o":           0.005,
  "gpt-4o-mini":      0.00015,
  "gpt-4-turbo":      0.010,
  "gpt-4":            0.030,
  "gpt-3.5-turbo":    0.0005,
  "o1":               0.015,
  "o1-mini":          0.003,
  "o1-preview":       0.015,

  // Anthropic
  "claude-opus":            0.015,
  "claude-opus-4":          0.015,
  "claude-opus-4.5":        0.015,
  "claude-opus-4.6":        0.015,
  "claude-opus-4.7":        0.015,
  "claude-sonnet":          0.003,
  "claude-sonnet-4":        0.003,
  "claude-sonnet-4.5":      0.003,
  "claude-sonnet-4.6":      0.003,
  "claude-sonnet-4.7":      0.003,
  "claude-haiku":           0.00025,
  "claude-haiku-4":         0.00025,
  "claude-haiku-4.5":       0.00025,
  "claude-3-opus":          0.015,
  "claude-3-sonnet":        0.003,
  "claude-3-haiku":         0.00025,
  "claude-3-5-sonnet":      0.003,
};

function findPricing(model: string): number {
  const direct = PRICING_PER_1K_TOKENS_USD[model];
  if (direct !== undefined) return direct;
  // Prefix match for date-suffixed model names (e.g. claude-3-5-sonnet-20240620).
  const lower = model.toLowerCase();
  for (const key of Object.keys(PRICING_PER_1K_TOKENS_USD)) {
    if (lower.startsWith(key)) return PRICING_PER_1K_TOKENS_USD[key]!;
  }
  // Sensible default for unknown models (slightly pessimistic).
  return 0.005;
}

// Rough char→token: ~4 chars per token. Good enough for AIBrake's purpose.
function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function estimateCostUsd(
  model: string,
  inputChars: number,
  maxOutputTokens?: number
): number {
  const inputTokens = estimateTokensFromChars(inputChars);
  // Assume max_tokens of output if specified, else 1k as a reasonable cap
  // (real responses often shorter, but AIBrake reasons about worst case).
  const outputTokens = maxOutputTokens ?? 1000;
  const totalTokens = inputTokens + outputTokens;
  const pricePerK = findPricing(model);
  // Keep 4 decimals — small calls ($0.001–$0.01) are meaningful to the
  // detector's relative cost scoring; rounding to cents (0.01) zeros them out.
  return Math.round((totalTokens / 1000) * pricePerK * 10000) / 10000;
}
