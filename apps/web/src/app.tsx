import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AppShell } from './components/shell/app-shell';
import { ListSkeleton } from './components/ui/skeleton';
import { ToastProvider } from './components/ui/toast';
import { useAuth } from './hooks/use-auth';
import { isApiError, setUnauthenticatedHandler } from './lib/api';
import { LoginScreen } from './screens/login/login-screen';
import { MaintenanceScreen } from './screens/maintenance-screen';
import { ComingSoonScreen } from './screens/placeholder/coming-soon-screen';
import { SetupScreen } from './screens/setup/setup-screen';
import { StockScreen } from './screens/stock/stock-screen';
import { SettingsScreen } from './screens/settings/settings-screen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Les erreurs de l'API sont des réponses, pas des pannes : on ne les rejoue pas.
        if (isApiError(error) && error.status > 0 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <UnauthenticatedRedirect />
          <Routes>
            <Route path="/installation" element={<SetupScreen />} />
            <Route path="/connexion" element={<LoginScreen />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<StockScreen />} />
                <Route path="/recettes" element={<ComingSoonScreen title="Recettes" />} />
                <Route path="/courses" element={<ComingSoonScreen title="Courses" />} />
                <Route path="/reglages" element={<SettingsScreen />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/** Le client API redirige via le routeur plutôt que par rechargement complet. */
function UnauthenticatedRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    setUnauthenticatedHandler((target) => {
      queryClient.removeQueries({ queryKey: ['auth', 'me'] });
      navigate(target, { replace: true });
    });
  }, [navigate]);
  return null;
}

function RequireAuth({ children }: { children?: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.state === 'loading') return <LoadingScreen />;
  if (auth.state === 'unreachable') return <MaintenanceScreen error={auth.error} onRetry={() => void auth.refresh()} />;
  if (auth.state === 'setup_required') return <Navigate to="/installation" replace />;
  if (auth.state === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/connexion?next=${next}`} replace />;
  }
  return children ?? <Outlet />;
}

function LoadingScreen() {
  return (
    <div className="mx-auto max-w-lg pt-20">
      <ListSkeleton rows={4} />
    </div>
  );
}
