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

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The next `weekday` after today at local hh:mm in Dublin (GMT in winter, so UTC is close enough). */
function nextWeekdayAt(weekday, hour, minute = 0) {
  const d = new Date(nextWeekday(weekday, hour));
  d.setUTCMinutes(minute);
  return d.toISOString();
}

/** What the model would plausibly return for one capture. */
export function sortOne(id, text, ctx, instant = null) {
  const t = text.trim();
  const lower = t.toLowerCase();
  const result = {
    capture_id: id,
    items: [],
    actions: [],
    leftover: null,
    proposed_facts: [],
    link_summary: null,
  };

  // Words that cannot be placed at all (Task 11.2): no items, no actions.
  if (/^hmm\b/i.test(t)) return result;

  // "Planning Christmas sandwiches every week on a Friday. Still need to plan but
  // keep as a placeholder" (Task 11.2): a weekly event, plus the words no item covers.
  const plan = t.match(
    /^(?:planning\s+)?(.+?) every week on (?:a )?(\w+day)\.\s*(still need to plan)\b/i,
  );
  if (plan && WEEKDAYS.includes(plan[2].toLowerCase())) {
    const day = WEEKDAYS.indexOf(plan[2].toLowerCase());
    result.items.push({
      ...blankItem,
      type: 'event',
      title: cap(plan[1]),
      start_at: instant?.start ?? nextWeekday(day, 0),
      all_day: instant ? instant.allDay : true,
      rrule: `FREQ=WEEKLY;BYDAY=${plan[2].slice(0, 2).toUpperCase()}`,
    });
    result.leftover = cap(plan[3]);
    return result;
  }

  // "Training on Tuesday. Need a reminder to send report to Trevor" (Task 11.1):
  // the instant event comes back first with a clean title, then the task it lost.
  const reminder = t.match(/^(.+?)\s+(?:on\s+)?(\w+day)\.\s*need a reminder to (.+?)\.?$/i);
  if (reminder) {
    const day = WEEKDAYS.indexOf(reminder[2].toLowerCase());
    result.items.push(
      {
        ...blankItem,
        type: 'event',
        title: cap(reminder[1].replace(/\s+on$/i, '')),
        start_at: instant?.start ?? nextWeekday(day < 0 ? 2 : day, 0),
        all_day: instant ? instant.allDay : true,
      },
      { ...blankItem, type: 'task', title: cap(reminder[3]) },
    );
    return result;
  }

  // "Quiz every Thursday 8pm-12pm": a weekly event with its end time.
  const range = lower.match(
    /^(.+?) every (\w+day) (\d{1,2})(?::(\d\d))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)\b(.*)$/,
  );
  if (range && WEEKDAYS.includes(range[2])) {
    const h = (n, ap) => (Number(n) % 12) + (ap === 'pm' ? 12 : 0);
    const day = WEEKDAYS.indexOf(range[2]);
    const from = h(range[3], range[5] ?? range[8]) * 60 + Number(range[4] ?? 0);
    let to = h(range[6], range[8]) * 60 + Number(range[7] ?? 0);
    if (to <= from && to >= 720) to -= 720; // "8pm-12pm": until midnight
    if (to <= from) to += 1440;
    const start = instant?.start ?? nextWeekdayAt(day, Math.floor(from / 60), from % 60);
    result.items.push({
      ...blankItem,
      type: 'event',
      title: cap(range[1]),
      start_at: start,
      end_at: new Date(Date.parse(start) + (to - from) * 60_000).toISOString(),
      rrule: `FREQ=WEEKLY;BYDAY=${range[2].slice(0, 2).toUpperCase()}`,
    });
    const rest = range[9].replace(/^[.\s]+/, '').trim();
    if (rest) result.items.push({ ...blankItem, type: 'task', title: cap(rest) });
    return result;
  }

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

/**
 * What the model would plausibly return for one of the person's notes (Task 11.0):
 * only what the new text asks for; the note itself is never returned.
 */
export function sortNote(id, text) {
  const result = {
    capture_id: `note:${id}`,
    items: [],
    actions: [],
    leftover: null,
    proposed_facts: [],
    link_summary: null,
  };
  // "need to send the report to Trevor by Friday": a task due that day.
  const need = text.match(/need to (.+?) by (\w+day)\b/i);
  if (need) {
    const day = WEEKDAYS.indexOf(need[2].toLowerCase());
    result.items.push({
      ...blankItem,
      type: 'task',
      title: cap(need[1].trim()),
      due_at: day >= 0 ? nextWeekday(day, 17) : null,
    });
  }
  return result;
}

/** Answers a sorting request from the captures and notes in its user message. */
export function sortAnswer(userText) {
  const ctxMatch = userText.match(/Context:\n(\{.*\})\n/);
  const ctx = ctxMatch ? JSON.parse(ctxMatch[1]) : {};
  const results = [];
  const re =
    /<capture id="([^"]+)"(?: instant_event="([^"]*)")?>\n(?:url: [^\n]*\n)?([\s\S]*?)\n<\/capture>/g;
  for (const m of userText.matchAll(re)) {
    const text = m[3].replace(/\n<article[\s\S]*<\/article>$/, '');
    // instant_event="title | start (all day)": the event Airhead already made.
    const inst = m[2]?.match(/^(.*) \| (\S+)( \(all day\))?$/);
    const instant = inst ? { title: inst[1], start: inst[2], allDay: !!inst[3] } : null;
    results.push(sortOne(m[1], text, ctx, instant));
  }
  const notes = /<note id="([^"]+)" title="[^"]*">\n([\s\S]*?)\n<\/note>/g;
  for (const m of userText.matchAll(notes)) results.push(sortNote(m[1], m[2]));
  // A digest when a note asked for something (stored as a memory fact).
  const found = results.find((r) => r.capture_id.startsWith('note:') && r.items.length);
  const digest = found ? `Noted from their notes: ${found.items[0].title}.` : null;
  return { results, digest };
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
      console.log(`mock-ai: sorted ${answer.results.length} capture(s) and note(s)`);
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
