import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingState } from '../../components/states';
import { useSession } from './session-context';

/**
 * Client-side gate. It keeps unauthenticated users out of the UI; it is not a
 * security boundary — the API authorises every request independently.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return <LoadingState label="Checking your session…" />;
  }

  if (!isAuthenticated) {
    // Remember where the user was heading so login can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
