import { describe, expect, it } from 'vitest';
import { fallbackList, rankTasks, type ListTask } from './fallback';

const t = (id: string, fields: Partial<ListTask> = {}): ListTask => ({
  id,
  title: id,
  due: null,
  top3: false,
  carry_count: 0,
  age_days: 0,
  ...fields,
});
const TODAY = '2027-01-10';

describe('fallback daily list (Task 5.5)', () => {
  it('orders: Top 3, overdue, due today, carried over, oldest', () => {
    const tasks = [
      t('old', { age_days: 30 }),
      t('carried', { carry_count: 2 }),
      t('due-today-late', { due: '2027-01-10 17:00' }),
      t('due-today-early', { due: '2027-01-10 09:00' }),
      t('overdue', { due: '2027-01-08 12:00' }),
      t('very-overdue', { due: '2027-01-02 12:00' }),
      t('pinned', { top3: true }),
      t('future', { due: '2027-01-20 09:00' }),
    ];
    expect(rankTasks(tasks, TODAY).map((x) => x.id)).toEqual([
      'pinned',
      'very-overdue',
      'overdue',
      'due-today-early',
      'due-today-late',
      'carried',
      'old',
      'future',
    ]);
  });

  it('Top 3 is the first three; Also today keeps only what is due or carried', () => {
    const tasks = [
      t('a', { due: '2027-01-09 09:00' }),
      t('b', { due: '2027-01-10 09:00' }),
      t('c', { due: '2027-01-10 10:00' }),
      t('d', { due: '2027-01-10 11:00' }),
      t('e', { carry_count: 1 }),
      t('f', { age_days: 100 }),
      t('g', { due: '2027-02-01 09:00' }),
    ];
    expect(fallbackList(tasks, TODAY)).toEqual({ top3: ['a', 'b', 'c'], also_today: ['d', 'e'] });
  });

  it('ties: more carries, then older, then by title', () => {
    const tasks = [
      t('b', { carry_count: 1, age_days: 5 }),
      t('a', { carry_count: 1, age_days: 5 }),
      t('c', { carry_count: 1, age_days: 9 }),
      t('d', { carry_count: 3 }),
    ];
    expect(rankTasks(tasks, TODAY).map((x) => x.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('a quiet day: no tasks, empty lists', () => {
    expect(fallbackList([], TODAY)).toEqual({ top3: [], also_today: [] });
  });
});
