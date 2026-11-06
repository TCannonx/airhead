import { Navigate, type RouteObject } from 'react-router';
import CapturePage from '../features/capture/CapturePage';
import InboxPage from '../features/inbox/InboxPage';
import InsightsPage from '../features/insights/InsightsPage';
import LibraryPage from '../features/library/LibraryPage';
import SettingsPage from '../features/settings/SettingsPage';
import TodayPage from '../features/today/TodayPage';
import AppLayout from './AppLayout';

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    children: [
      // Capture is the home screen.
      { index: true, element: <Navigate to="/capture" replace /> },
      { path: 'capture', Component: CapturePage },
      { path: 'today', Component: TodayPage },
      { path: 'inbox', Component: InboxPage },
      { path: 'library', Component: LibraryPage },
      { path: 'insights', Component: InsightsPage },
      { path: 'settings', Component: SettingsPage },
      { path: '*', element: <Navigate to="/capture" replace /> },
    ],
  },
];
