import { describe, expect, it } from 'vitest';
import { normaliseSupabaseUrl } from './supabaseUrl';

describe('normaliseSupabaseUrl', () => {
  it('tidies a pasted address down to the project base', () => {
    const base = 'https://abc.supabase.co';
    expect(normaliseSupabaseUrl(' https://abc.supabase.co/rest/v1/')).toBe(base);
    expect(normaliseSupabaseUrl('https://abc.supabase.co/')).toBe(base);
    expect(normaliseSupabaseUrl('https://abc.supabase.co/auth/v1')).toBe(base);
    expect(normaliseSupabaseUrl(base)).toBe(base);
    expect(normaliseSupabaseUrl('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
  });

  it('is undefined when nothing is set', () => {
    expect(normaliseSupabaseUrl(undefined)).toBeUndefined();
    expect(normaliseSupabaseUrl('  ')).toBeUndefined();
  });
});
