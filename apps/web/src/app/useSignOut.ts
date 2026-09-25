import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useLogout } from '../api/hooks.ts';

/**
 * Shows the lobby, committed synchronously, then runs `then` (which drops the session).
 * Router navigations are transitions while the session update is not: dropping the session first
 * would render the private page once more and its guard would redirect to "Accedi".
 */
export function useLeaveToLobby(): (then: () => void, options?: { replace?: boolean }) => void {
  const navigate = useNavigate();
  return useCallback(
    (then, options) => {
      void Promise.resolve(
        navigate('/', { replace: options?.replace ?? false, flushSync: true }),
      ).finally(then);
    },
    [navigate],
  );
}

/** Logout from any page: the player ends up in the lobby. */
export function useSignOut(): { signOut: () => void; isPending: boolean } {
  const logout = useLogout();
  const leave = useLeaveToLobby();
  const { mutate } = logout;
  const signOut = useCallback(() => leave(() => mutate()), [leave, mutate]);
  return { signOut, isPending: logout.isPending };
}
