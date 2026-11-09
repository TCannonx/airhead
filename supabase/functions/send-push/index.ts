import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { supabaseCaller } from '../_shared/caller.ts';
import { isService } from '../_shared/serviceAuth.ts';
import { pusherFromEnv, type DeviceRow } from '../_shared/push.ts';
import { handleSendPush } from './handler.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
  auth: { persistSession: false },
});

/** GET / POST /send-push: see handler.ts. */
Deno.serve((req) =>
  handleSendPush(req, {
    caller: supabaseCaller(db, isService),
    pusher: () => pusherFromEnv(),
    async notificationDevices(userId) {
      const { data } = await db
        .from('devices')
        .select('id, user_id, push_subscription, receives_notifications')
        .eq('user_id', userId)
        .eq('receives_notifications', true)
        .is('deleted_at', null);
      return (data ?? []) as DeviceRow[];
    },
    async device(deviceId, userId) {
      const { data } = await db
        .from('devices')
        .select('id, user_id, push_subscription, receives_notifications')
        .eq('id', deviceId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle();
      return data as DeviceRow | null;
    },
    async clear(deviceId) {
      await db.from('devices').update({ push_subscription: null }).eq('id', deviceId);
    },
  }),
);
