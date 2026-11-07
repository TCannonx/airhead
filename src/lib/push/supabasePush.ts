import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { PushService } from '../auth/types';

/** send-push: the VAPID public key, and a test notification to this device (Task 4.11). */
export function supabasePush(supabase: SupabaseClient): PushService {
  return {
    async publicKey() {
      const { data, error } = await supabase.functions.invoke('send-push', { method: 'GET' });
      if (error || !data || typeof data.public_key !== 'string') return null;
      return data.public_key as string;
    },
    async sendTest(deviceId) {
      const { data, error } = await supabase.functions.invoke('send-push', {
        body: { mode: 'test', device_id: deviceId },
      });
      if (!error && data) return data as { ok: boolean; message: string };
      if (error instanceof FunctionsHttpError) {
        const res = await (error.context as Response).json().catch(() => null);
        if (res && typeof res === 'object' && 'message' in res)
          return res as { ok: boolean; message: string };
      }
      return {
        ok: false,
        message: 'Couldn’t reach Airhead’s server. Try again when you’re online.',
      };
    },
  };
}
