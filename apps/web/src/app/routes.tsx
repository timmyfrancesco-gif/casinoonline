import type { RouteObject } from 'react-router';
import { PageLoader } from '../components/Spinner.tsx';
import { LobbyPage } from '../pages/LobbyPage.tsx';
import { LoginPage } from '../pages/LoginPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import { RegisterPage } from '../pages/RegisterPage.tsx';
import { RouteErrorPage } from '../pages/RouteErrorPage.tsx';
import { Layout } from './Layout.tsx';
import { RequireAuth } from './RequireAuth.tsx';

/**
 * Public: lobby, auth, rules, verification, RG info. Tables and private pages require a
 * session. Heavier pages are split into their own chunks (loaded on first visit).
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <PageLoader />,
    children: [
      {
        // Page errors render inside the layout (header, balance, virtual-chips banner); the root
        // errorElement only catches failures of the layout itself.
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <LobbyPage /> },
          { path: 'accedi', element: <LoginPage /> },
          { path: 'registrati', element: <RegisterPage /> },
          {
            path: 'regole',
            lazy: async () => ({ Component: (await import('../pages/RulesPage.tsx')).RulesPage }),
          },
          {
            path: 'verifica',
            lazy: async () => ({ Component: (await import('../pages/VerifyPage.tsx')).VerifyPage }),
          },
          {
            path: 'gioco-responsabile',
            lazy: async () => ({
              Component: (await import('../pages/ResponsibleGamingPage.tsx')).ResponsibleGamingPage,
            }),
          },
          {
            element: <RequireAuth />,
            children: [
              {
                path: 'roulette',
                lazy: async () => ({
                  Component: (await import('../games/roulette/RoulettePage.tsx')).RoulettePage,
                }),
              },
              {
                path: 'slot',
                lazy: async () => ({
                  Component: (await import('../games/slot/SlotPage.tsx')).SlotPage,
                }),
              },
              {
                path: 'blackjack',
                lazy: async () => ({
                  Component: (await import('../games/blackjack/BlackjackPage.tsx')).BlackjackPage,
                }),
              },
              {
                path: 'videopoker',
                lazy: async () => ({
                  Component: (await import('../games/videopoker/VideoPokerPage.tsx'))
                    .VideoPokerPage,
                }),
              },
              {
                path: 'storico',
                lazy: async () => ({
                  Component: (await import('../pages/HistoryPage.tsx')).HistoryPage,
                }),
              },
              {
                path: 'storico/:id',
                lazy: async () => ({
                  Component: (await import('../pages/RoundDetailPage.tsx')).RoundDetailPage,
                }),
              },
              {
                path: 'profilo',
                lazy: async () => ({
                  Component: (await import('../pages/ProfilePage.tsx')).ProfilePage,
                }),
              },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
