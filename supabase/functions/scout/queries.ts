/**
 * Scout's web queries (Task 8.11) are built here, in code, from interests in
 * memory and the city only. Facts about people or personal matters never
 * become queries, and a filter rejects anything that looks like a name,
 * health detail, number or address. The run log stores exactly these.
 */
export interface FactIn {
  text: string;
  category: 'everyday' | 'person' | 'personal';
}

const INTEREST =
  /\b(?:likes?|loves?|enjoys?|into|fan of|interested in|supports?|plays?|follows?|goes to)\s+(.{3,40})$/i;
const HEALTH =
  /\b(?:allerg\w*|asthma|diabet\w*|pregnan\w*|doctor|hospital|therapy|therapist|medication|illness|cancer|depress\w*|anxiety|clinic|surgery|injur\w*)\b/i;
const SENSITIVE = /[@\d]|https?:|\b(?:street|road|avenue|apartment|flat)\b/i;
const SAFE = /^[\p{L}\s'&-]+$/u;

/** "Likes jazz" → "jazz"; "Supports Leinster rugby" → "Leinster rugby". */
export function interestOf(fact: FactIn): string | null {
  if (fact.category !== 'everyday') return null;
  const m = fact.text
    .trim()
    .replace(/[.!]+$/, '')
    .match(INTEREST);
  const topic = m?.[1]?.trim();
  if (!topic) return null;
  if (HEALTH.test(topic) || SENSITIVE.test(topic) || !SAFE.test(topic)) return null;
  return topic.toLowerCase().startsWith('the ') ? topic.slice(4) : topic;
}

/** Rejects a query that could carry personal details. */
export function safeQuery(q: string, people: string[]): boolean {
  if (!SAFE.test(q) || HEALTH.test(q) || SENSITIVE.test(q) || q.length > 80) return false;
  const lower = q.toLowerCase();
  return !people.some((p) => p.length > 2 && lower.includes(p.toLowerCase()));
}

/** Words from facts about people (likely names), so no query can carry them. */
export function peopleWords(facts: FactIn[]): string[] {
  return facts
    .filter((f) => f.category !== 'everyday')
    .flatMap((f) => f.text.match(/\b\p{Lu}[\p{L}'-]+/gu) ?? []);
}

export function buildQueries(facts: FactIn[], city: string, max: number): string[] {
  const place = city.trim();
  if (!place || max <= 0 || !SAFE.test(place)) return [];
  const people = peopleWords(facts).filter((w) => w.toLowerCase() !== place.toLowerCase());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of facts) {
    const topic = interestOf(f);
    if (!topic || seen.has(topic.toLowerCase())) continue;
    seen.add(topic.toLowerCase());
    const q = `${topic} events in ${place} in the next few weeks`;
    if (safeQuery(q, people)) out.push(q);
    if (out.length >= max) break;
  }
  return out;
}
