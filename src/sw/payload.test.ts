import { describe, expect, it } from 'vitest';
import { parsePush, safePath } from './payload';

describe('push payloads (Task 4.11)', () => {
  it('reads title, body, tag and the screen to open', () => {
    const text = JSON.stringify({
      title: 'Dentist in 30 min',
      body: '15:00 · Smile Clinic',
      url: '/calendar',
      tag: 'item-1',
    });
    expect(parsePush(text)).toEqual({
      title: 'Dentist in 30 min',
      body: '15:00 · Smile Clinic',
      url: '/calendar',
      tag: 'item-1',
    });
  });

  it('falls back safely for empty or plain-text messages', () => {
    expect(parsePush(null)).toEqual({ title: 'Airhead', body: '', url: '/today' });
    expect(parsePush('hello')).toEqual({ title: 'Airhead', body: 'hello', url: '/today' });
  });

  it('only opens paths inside the app', () => {
    expect(safePath('/review?date=2027-01-10')).toBe('/review?date=2027-01-10');
    expect(safePath('https://evil.example')).toBe('/today');
    expect(safePath('//evil.example')).toBe('/today');
    expect(safePath('javascript:alert(1)')).toBe('/today');
    expect(safePath(42)).toBe('/today');
  });
});
