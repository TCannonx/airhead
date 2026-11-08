// A stand-in for the Anthropic Messages API, used only by CI's end-to-end job
// (the functions get ANTHROPIC_BASE_URL pointing here). It answers sorting
// requests with outputs worked out from the capture text, so the whole flow
// (app -> Edge Function -> database -> other device) runs without the paid API.
//
// It also rejects requests the real API would reject, so a schema that breaks
// the API's structured-output limits fails CI instead of failing the owner
// (2026-11-08: the sorting schema had 26 union-typed parameters; the limit is 16).
//
// Usage: node tests/mock-ai/server.mjs [port]   (default 4010)
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 4010);
export const MAX_UNION_PARAMS = 16;

export function countUnionParams(schema) {
  let n = 0;
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.properties)
      for (const p of Object.values(node.properties))
        if (Array.isArray(p.anyOf) || Array.isArray(p.oneOf) || Array.isArray(p.type)) n += 1;
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(schema);
  return n;
}

const today = (tz = 'Europe/Dublin') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const blankItem = {
  type: 'note',
  title: '',
  body: null,
  start_at: null,
  end_at: null,
  all_day: false,
  due_at: null,
  rrule: null,
  list_name: null,
  topics: [],
  confidence: 0.9,
  suggest_workshop: false,
  related_idea_title: null,
};
const action = (kind, quote, details, confidence = 0.92) => ({
  kind,
  quote,
  confidence,
  details: JSON.stringify(details),
});
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The next date (after today) that falls on `weekday`, at hour:00 UTC. */
function nextWeekday(weekday, hour) {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== weekday);
  return d.toISOString();
}

/** What the model would plausibly return for one capture. */
export function sortOne(id, text, ctx) {
  const t = text.trim();
  const lower = t.toLowerCase();
  const result = { capture_id: id, items: [], actions: [], proposed_facts: [], link_summary: null };

  const left = lower.match(/(\d+(?:\.\d+)?) days?(?: of)?(?: annual)?(?: leave)? left/);
  if (left) {
    result.actions.push(
      action('set_leave_remaining', t, {
        days: Number(left[1]),
        as_of: today(ctx.time_zone),
        leave_type: 'annual',
      }),
    );
    return result;
  }

  const off = lower.match(/^off (\d{1,2})\s*-\s*(\d{1,2}) dec/);
  if (off) {
    const now = new Date();
    const year =
      now.getUTCMonth() === 11 && now.getUTCDate() > Number(off[2])
        ? now.getUTCFullYear() + 1
        : now.getUTCFullYear();
    const pad = (n) => String(n).padStart(2, '0');
    result.actions.push(
      action('book_leave', t, {
        start_date: `${year}-12-${pad(off[1])}`,
        end_date: `${year}-12-${pad(off[2])}`,
        leave_type: 'annual',
        leave_status: 'planned',
      }),
    );
    return result;
  }

  // "I get a haircut every 2-3 weeks ... remind me ... once booked, ensure I have cash"
  if (/once (?:it'?s |it is )?booked/.test(lower) && /(haircut|barber)/.test(lower)) {
    const weeks = lower.match(/every (\d+)/)?.[1] ?? '2';
    const euros = t.match(/€\s?(\d+)/)?.[1];
    result.items.push({
      ...blankItem,
      type: 'task',
      title: 'Text barber for haircut',
      rrule: `FREQ=WEEKLY;INTERVAL=${weeks}`,
    });
    result.actions.push(
      action('add_prep_rule', 'once booked, ensure I have cash', {
        match: ['barber', 'haircut'],
        reminder: euros ? `Bring €${euros} cash` : 'Bring cash',
        minutes_before: 720,
      }),
    );
    return result;
  }

  const every = lower.match(/remind me every (\d+)(?:\s*-\s*\d+)? weeks? to (.+?)\.?$/);
  if (every) {
    const title = every[2].charAt(0).toUpperCase() + every[2].slice(1);
    result.items.push({
      ...blankItem,
      type: 'task',
      title,
      rrule: `FREQ=WEEKLY;INTERVAL=${every[1]}`,
    });
    return result;
  }

  const moved = lower.match(/^(.+?) moved to (\w+) (\d{1,2})\s*(am|pm)$/);
  if (moved) {
    const name = moved[1].trim();
    const matches = (ctx.existing_items ?? []).filter((c) => c.title.toLowerCase().includes(name));
    const day = WEEKDAYS.indexOf(moved[2]);
    if (matches.length && day >= 0) {
      const hour = (Number(moved[3]) % 12) + (moved[4] === 'pm' ? 12 : 0);
      result.actions.push(
        action('reschedule_item', t, {
          target_id: matches[0].id,
          other_matches: matches.slice(1).map((c) => c.id),
          start_at: nextWeekday(day, hour),
          all_day: false,
        }),
      );
      return result;
    }
  }

  result.items.push({ ...blankItem, title: t.charAt(0).toUpperCase() + t.slice(1) });
  return result;
}

/** Answers a sorting request from the captures in its user message. */
export function sortAnswer(userText) {
  const ctxMatch = userText.match(/Context:\n(\{.*\})\n/);
  const ctx = ctxMatch ? JSON.parse(ctxMatch[1]) : {};
  const results = [];
  const re = /<capture id="([^"]+)">\n(?:url: [^\n]*\n)?([\s\S]*?)\n<\/capture>/g;
  for (const m of userText.matchAll(re)) {
    const text = m[2].replace(/\n<article[\s\S]*<\/article>$/, '');
    results.push(sortOne(m[1], text, ctx));
  }
  return { results };
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
const apiError = (res, status, message) =>
  reply(res, status, { type: 'error', error: { type: 'invalid_request_error', message } });

/** The stand-in server (not yet listening). */
export function createMockServer() {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true });
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages'))
      return apiError(res, 404, 'not found');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return apiError(res, 400, 'mock: body is not JSON');
      }
      const schema = body.output_config?.format?.schema;
      if (schema) {
        const n = countUnionParams(schema);
        if (n > MAX_UNION_PARAMS) {
          console.log(`mock-ai: rejected schema with ${n} union params`);
          return apiError(
            res,
            400,
            `Schemas contain too many parameters with union types (${n} parameters with type arrays or anyOf). The limit is ${MAX_UNION_PARAMS}.`,
          );
        }
      }
      const system = (body.system ?? []).map((b) => b.text ?? '').join('\n');
      const user = (body.messages ?? [])
        .map((m) =>
          typeof m.content === 'string' ? m.content : m.content.map((c) => c.text ?? '').join(''),
        )
        .join('\n');
      let answer;
      if (system.startsWith('You sort the captures')) answer = sortAnswer(user);
      else {
        console.log('mock-ai: no saved answer for this task');
        return apiError(res, 400, 'mock: no saved answer for this task');
      }
      console.log(`mock-ai: sorted ${answer.results.length} capture(s)`);
      reply(res, 200, {
        id: `msg_mock_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });
    });
  });
}

if (process.argv[1]?.endsWith('server.mjs')) {
  createMockServer().listen(PORT, '0.0.0.0', () => console.log(`mock-ai listening on ${PORT}`));
}
