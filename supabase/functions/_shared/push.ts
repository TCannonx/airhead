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
        await server.subscribe(sub).pushTextMessage(JSON.stringify(payload), {
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
