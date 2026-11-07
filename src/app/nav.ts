import type { IconName } from './Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/** The five main tabs, in the order the design doc lists them. */
export const TABS: NavItem[] = [
  { to: '/capture', label: 'Capture', icon: 'capture' },
  { to: '/today', label: 'Today', icon: 'today' },
  { to: '/inbox', label: 'Inbox', icon: 'inbox' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/insights', label: 'Insights', icon: 'insights' },
];

/** Calendar: in the sidebar after Today; on the phone a header button (five tabs stay). */
export const CALENDAR: NavItem = { to: '/calendar', label: 'Calendar', icon: 'calendar' };

export const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: 'settings' };
