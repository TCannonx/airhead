/**
 * Makes a VAPID key pair for push notifications (Task 4.11). Run it yourself:
 *
 *   npx deno@2.9.6 run scripts/generate-vapid-keys.ts > vapid.env
 *
 * then set both values as Supabase secrets (dev and live), and delete the file:
 *
 *   npx supabase secrets set --env-file vapid.env --project-ref <ref>
 *
 * The private key must never go into the repo or a chat.
 */
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const keys = await webpush.generateVapidKeys({ extractable: true });
const exported = await webpush.exportVapidKeys(keys);
console.log(`VAPID_KEYS='${JSON.stringify(exported)}'`);
console.log(`VAPID_SUBJECT='mailto:you@example.com'`);
console.error(`Public key (for reference only): ${await webpush.exportApplicationServerKey(keys)}`);
console.error('Edit VAPID_SUBJECT to your own email before setting the secrets.');
