/** A row of the ai_prices table (US dollars per million tokens). */
export interface Price {
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
  /** Euros per US dollar. */
  eur_rate: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Cost of one call in euros, rounded to 6 decimals (an estimate; the Console is the true record). */
export function costEur(usage: TokenUsage, price: Price): number {
  const usd =
    (usage.input_tokens * Number(price.input_per_mtok) +
      usage.output_tokens * Number(price.output_per_mtok) +
      (usage.cache_read_input_tokens ?? 0) * Number(price.cache_read_per_mtok) +
      (usage.cache_creation_input_tokens ?? 0) * Number(price.cache_write_per_mtok)) /
    1_000_000;
  return Math.round(usd * Number(price.eur_rate) * 1_000_000) / 1_000_000;
}
