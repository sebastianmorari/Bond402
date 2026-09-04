import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/dashboard';
import { Landing } from '@/pages/landing';
import { Profile } from '@/pages/profile';
import { Developer } from '@/pages/developer';
import { AuthPage } from '@/pages/auth';
import { AuthProvider, useAuth } from '@/lib/auth';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from 'wouter';

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthLoading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function HomeRedirect() {
  const { user, isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return user ? <Redirect to="/dashboard" /> : <Landing />;
}

function DashboardProtect() {
  const { user, isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return user ? <Dashboard /> : <Redirect to="/" />;
}

function ProfileProtect() {
  const { user, isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return user ? <Profile /> : <Redirect to="/" />;
}

function DeveloperProtect() {
  const { user, isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return user ? <Developer /> : <Redirect to="/" />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/dashboard" component={DashboardProtect} />
        <Route path="/developer" component={DeveloperProtect} />
        <Route path="/profile" component={ProfileProtect} />
        <Route path="/sign-in/*?" component={() => <AuthPage mode="signIn" />} />
        <Route path="/sign-up/*?" component={() => <AuthPage mode="signUp" />} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRuntime() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <AppRuntime />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
