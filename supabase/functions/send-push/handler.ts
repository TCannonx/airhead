import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { deliver, type DeviceRow, type Pusher } from '../_shared/push.ts';

export interface SendPushHandlerDeps {
  caller: Caller;
  /** null when the VAPID secrets aren't set. */
  pusher(): Promise<Pusher | null>;
  /** The user's devices that receive notifications (not deleted). */
  notificationDevices(userId: string): Promise<DeviceRow[]>;
  /** One device, only if it is this user's (not deleted). */
  device(deviceId: string, userId: string): Promise<DeviceRow | null>;
  /** Forgets a subscription the push service says is gone. */
  clear(deviceId: string): Promise<void>;
}

/**
 * GET  /send-push                     → { public_key } for subscribing (public; it's a public key)
 * POST /send-push { mode: 'test', device_id }  (signed in) → a test notification to that device
 * POST /send-push { user_id, payload }         (service key) → the user's notification devices
 */
export async function handleSendPush(req: Request, d: SendPushHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS')
    return new Response('ok', {
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
    });
  const pusher = await d.pusher().catch(() => null);
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

  const token = bearer(req);
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    device_id?: string;
    user_id?: string;
    payload?: { title?: string; body?: string; url?: string; tag?: string };
  };

  if (await d.caller.isService(token)) {
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
    const res = await deliver(
      await d.notificationDevices(body.user_id),
      { ...body.payload, title: body.payload.title },
      pusher,
      d.clear,
    );
    return json({
      ok: res.sent > 0,
      error_code: res.sent ? null : 'not_delivered',
      message: `Sent to ${res.sent} device(s).`,
      ...res,
    });
  }

  const userId = await d.caller.userId(token);
  if (!userId)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  if (body.mode !== 'test' || !body.device_id) {
    return json({ ok: false, error_code: 'bad_request', message: 'Unknown request.' }, 400);
  }
  const device = await d.device(body.device_id, userId);
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
    [device],
    {
      title: 'Airhead',
      body: 'Test notification: notifications are working.',
      url: '/settings',
      tag: 'test',
    },
    pusher,
    d.clear,
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
}
