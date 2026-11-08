/**
 * Structured-output schemas sent to the API must stay within its complexity
 * limits, or every request is rejected (the sorting outage of 2026-11-08: the
 * Phase 10 action fields pushed the sorting schema past them). Counted over the
 * JSON schema the SDK sends.
 */
export const MAX_UNION_PARAMS = 16;

/** Properties that allow more than one type (anyOf / oneOf / type arrays, e.g. nullable). */
export function countUnionParams(schema: unknown): number {
  let n = 0;
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const s = node as Record<string, unknown>;
    const props = s.properties as Record<string, Record<string, unknown>> | undefined;
    if (props)
      for (const p of Object.values(props)) {
        if (Array.isArray(p.anyOf) || Array.isArray(p.oneOf) || Array.isArray(p.type)) n += 1;
      }
    for (const v of Object.values(s)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(schema);
  return n;
}
