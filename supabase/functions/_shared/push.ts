import * as webpush from 'jsr:@negrel/webpush@0.5.0';

/**
 * Web Push sending (Task 4.11). VAPID keys live only in Supabase secrets:
 * VAPID_KEYS (the JSON from scripts/generate-vapid-keys.ts) and VAPID_SUBJECT
 * (a mailto: or https: contact). Payloads are encrypted per subscription.
 */
export interface PushPayload {
  title: string;
  body?: string;
  /** In-app path opened on tap, e.g. /review. */
  url?: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

export interface StoredSubscription {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}

export type SendResult = 'sent' | 'gone' | 'error';

export interface Pusher {
  publicKey(): Promise<string>;
  send(sub: StoredSubscription, payload: PushPayload): Promise<SendResult>;
}

export function isSubscription(v: unknown): v is StoredSubscription {
  const s = v as StoredSubscription | null;
  return (
    !!s &&
    typeof s.endpoint === 'string' &&
    /^https:\/\//.test(s.endpoint) &&
    typeof s.keys?.auth === 'string' &&
    typeof s.keys?.p256dh === 'string'
  );
}

/**
 * The message sent (Task 15.5): Airhead's own fields, which the service worker
 * reads, plus WebKit's Declarative Web Push fields when the app's address is
 * known (APP_URL), so Safari can show it even if the service worker does not
 * run. Browsers without Declarative Web Push ignore the extra keys. app_badge
 * is left out: the app sets the badge itself (WebKit reports crashes with it).
 */
export function pushMessage(payload: PushPayload, appUrl: string | null | undefined): string {
  const base = (appUrl ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+/.test(base)) return JSON.stringify(payload);
  const path = payload.url && payload.url.startsWith('/') ? payload.url : '/today';
  return JSON.stringify({
    ...payload,
    web_push: 8030,
    notification: {
      title: payload.title,
      ...(payload.body ? { body: payload.body } : {}),
      navigate: `${base}${path}`,
      ...(payload.tag ? { tag: payload.tag } : {}),
    },
  });
}

/** A pusher from the environment, or null when the VAPID secrets aren't set. */
export async function pusherFromEnv(env = Deno.env): Promise<Pusher | null> {
  const raw = env.get('VAPID_KEYS');
  const subject = env.get('VAPID_SUBJECT');
  if (!raw || !subject) return null;
  const keys = await webpush.importVapidKeys(JSON.parse(raw) as webpush.ExportedVapidKeys, {
    extractable: false,
  });
  const server = await webpush.ApplicationServer.new({
    contactInformation: subject,
    vapidKeys: keys,
  });
  return {
    publicKey: () => webpush.exportApplicationServerKey(keys),
    async send(sub, payload) {
      try {
        await server.subscribe(sub).pushTextMessage(pushMessage(payload, env.get('APP_URL')), {
          ttl: 60 * 60 * 6,
          urgency: webpush.Urgency.High,
          ...(payload.tag
            ? { topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) }
            : {}),
        });
        return 'sent';
      } catch (e) {
        if (e instanceof webpush.PushMessageError) {
          // 404 and 410: the subscription is gone (app removed, permission revoked).
          const status = e.response.status;
          return status === 404 || status === 410 ? 'gone' : 'error';
        }
        return 'error';
      }
    },
  };
}

export interface DeviceRow {
  id: string;
  user_id: string;
  push_subscription: unknown;
  receives_notifications: boolean;
}

/**
 * Sends to devices, clearing subscriptions that are gone. Returns how many
 * were delivered.
 */
export async function deliver(
  devices: DeviceRow[],
  payload: PushPayload,
  pusher: Pusher,
  clear: (deviceId: string) => Promise<void>,
): Promise<{ sent: number; gone: number; failed: number }> {
  const out = { sent: 0, gone: 0, failed: 0 };
  for (const d of devices) {
    if (!isSubscription(d.push_subscription)) continue;
    const r = await pusher.send(d.push_subscription, payload);
    if (r === 'sent') out.sent++;
    else if (r === 'gone') {
      out.gone++;
      await clear(d.id);
    } else out.failed++;
  }
  return out;
}
