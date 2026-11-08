import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { cors, json } from '../_shared/http.ts';
import { isServiceToken, SERVICE_KEYS } from '../_shared/serviceAuth.ts';
import { deliver, pusherFromEnv, type DeviceRow } from '../_shared/push.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

const clear = async (deviceId: string) => {
  await db.from('devices').update({ push_subscription: null }).eq('id', deviceId);
};

/**
 * GET  /send-push                     → { public_key } for subscribing (public; it's a public key)
 * POST /send-push { mode: 'test', device_id }  (signed in) → a test notification to that device
 * POST /send-push { user_id, payload }         (service key) → the user's notification devices
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', {
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
    });
  const pusher = await pusherFromEnv().catch(() => null);
  if (!pusher) {
    return json(
      {
        ok: false,
        error_code: 'not_configured',
        message: 'Notifications aren’t set up on the server yet.',
      },
      503,
    );
  }
  if (req.method === 'GET') {
    return json({
      ok: true,
      error_code: null,
      message: 'ok',
      public_key: await pusher.publicKey(),
    });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use GET or POST.' }, 405);
  }

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    device_id?: string;
    user_id?: string;
    payload?: { title?: string; body?: string; url?: string; tag?: string };
  };

  if (isServiceToken(token, SERVICE_KEYS)) {
    if (!body.user_id || !body.payload?.title) {
      return json(
        {
          ok: false,
          error_code: 'bad_request',
          message: 'user_id and payload.title are required.',
        },
        400,
      );
    }
    const { data } = await db
      .from('devices')
      .select('id, user_id, push_subscription, receives_notifications')
      .eq('user_id', body.user_id)
      .eq('receives_notifications', true)
      .is('deleted_at', null);
    const res = await deliver(
      (data ?? []) as DeviceRow[],
      { ...body.payload, title: body.payload.title },
      pusher,
      clear,
    );
    return json({
      ok: res.sent > 0,
      error_code: res.sent ? null : 'not_delivered',
      message: `Sent to ${res.sent} device(s).`,
      ...res,
    });
  }

  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  if (body.mode !== 'test' || !body.device_id) {
    return json({ ok: false, error_code: 'bad_request', message: 'Unknown request.' }, 400);
  }
  const { data: device } = await db
    .from('devices')
    .select('id, user_id, push_subscription, receives_notifications')
    .eq('id', body.device_id)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!device) {
    return json(
      {
        ok: false,
        error_code: 'not_found',
        message: 'This device hasn’t synced yet. Try again in a moment.',
      },
      404,
    );
  }
  const res = await deliver(
    [device as DeviceRow],
    {
      title: 'Airhead',
      body: 'Test notification: notifications are working.',
      url: '/settings',
      tag: 'test',
    },
    pusher,
    clear,
  );
  return json({
    ok: res.sent === 1,
    error_code: res.sent ? null : res.gone ? 'gone' : 'not_delivered',
    message: res.sent
      ? 'Sent. It should arrive in a few seconds.'
      : res.gone
        ? 'This device’s notification permission has expired. Turn notifications on again.'
        : 'The notification service didn’t accept it. Try again later.',
  });
});
