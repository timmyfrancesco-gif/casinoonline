import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter } from 'react-router';
// The DOM RouterProvider supports `flushSync` navigations (see useLeaveToLobby).
import { RouterProvider } from 'react-router/dom';
import { createQueryClient } from './queryClient.ts';
import { routes } from './routes.tsx';

const router = createBrowserRouter(routes);

export function App({ client }: { client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
