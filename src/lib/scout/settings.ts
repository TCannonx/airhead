import { z } from 'zod';
import type { SettingsRow } from '../schemas/records';

/**
 * Scout settings (Task 8.9), in settings.data.scout. Interests come from
 * memory; the city is the only place detail web searches may use.
 */
export const MAX_SEARCHES = 3;

export const scoutSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  city: z.string().trim().max(60).default(''),
  max_searches: z.number().int().min(0).max(MAX_SEARCHES).default(MAX_SEARCHES),
});
export type ScoutSettings = z.infer<typeof scoutSettingsSchema>;

export function readScoutSettings(settings: SettingsRow | undefined | null): ScoutSettings {
  const r = scoutSettingsSchema.safeParse(settings?.data?.scout ?? {});
  return r.success ? r.data : scoutSettingsSchema.parse({});
}
