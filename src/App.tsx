import { useMemo } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from './app/routes';
import AuthGate from './features/auth/AuthGate';
import { AuthProvider } from './lib/auth/AuthProvider';
import type { Services } from './lib/auth/types';

export default function App({ services }: { services: Services }) {
  // Created once per App instance (tests mount several).
  const router = useMemo(() => createBrowserRouter(routes), []);
  return (
    <AuthProvider services={services}>
      <AuthGate>
        <RouterProvider router={router} />
      </AuthGate>
    </AuthProvider>
  );
}
