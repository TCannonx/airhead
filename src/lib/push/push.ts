import type { AirheadDb } from '../db/db';
import { update } from '../db/repository';
import type { Platform } from '../device';

/**
 * Push setup on the device (Task 4.11). Permission is asked for only when the
 * person taps "Turn on notifications". On iPhone and iPad, web push works only
 * for an app added to the Home Screen.
 */
export type PushSupport = 'supported' | 'needs_install' | 'unsupported';

export function isStandalone(): boolean {
  try {
    return (
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function pushSupport(platform: Platform, standalone = isStandalone()): PushSupport {
  if ((platform === 'ios' || platform === 'ipados') && !standalone) return 'needs_install';
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof window === 'undefined' ||
    !('PushManager' in window) ||
    !('Notification' in window)
  )
    return 'unsupported';
  return 'supported';
}

/** base64url VAPID public key → bytes for applicationServerKey. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class PermissionDenied extends Error {}

/** Asks for permission (call from a tap) and subscribes this browser. */
export async function subscribe(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PermissionDenied(permission);
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
  return sub.toJSON();
}

/**
 * Stores this device's subscription (synced to the server on the device row).
 * The first device turned on gets the notifications; an iPhone takes over
 * from a non-phone device, since notifications are meant for the iPhone.
 */
export async function saveSubscription(
  db: AirheadDb,
  deviceId: string,
  platform: Platform,
  sub: PushSubscriptionJSON,
): Promise<void> {
  const devices = (await db.devices.toArray()).filter((d) => !d.deleted_at);
  const receiver = devices.find((d) => d.receives_notifications && d.id !== deviceId);
  const takeOver = !receiver || (platform === 'ios' && receiver.platform !== 'ios');
  await update(db, 'devices', deviceId, {
    push_subscription: sub,
    ...(takeOver ? { receives_notifications: true } : {}),
  });
  if (takeOver && receiver)
    await update(db, 'devices', receiver.id, { receives_notifications: false });
}

/** Sends notifications to this device only. */
export async function sendNotificationsHere(db: AirheadDb, deviceId: string): Promise<void> {
  for (const d of await db.devices.toArray()) {
    if (d.id === deviceId && !d.receives_notifications)
      await update(db, 'devices', d.id, { receives_notifications: true });
    else if (d.id !== deviceId && d.receives_notifications)
      await update(db, 'devices', d.id, { receives_notifications: false });
  }
}

/** Turns notifications off on this device (unsubscribes the browser too). */
export async function unsubscribe(db: AirheadDb, deviceId: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  } catch {
    /* already gone */
  }
  await update(db, 'devices', deviceId, { push_subscription: null, receives_notifications: false });
}
