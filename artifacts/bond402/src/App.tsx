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
import { X402SandboxPage } from '@/pages/x402-sandbox';
import { BondSandboxPage } from '@/pages/bond-sandbox';
import { AuthPage } from '@/pages/auth';
import { DatenschutzPage, ImpressumPage } from '@/pages/legal';
import { ApiDocsPage } from '@/pages/api-docs';
import { StatusPage } from '@/pages/status';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '@/pages/auth-mail';
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

function X402SandboxProtect() {
  const { user, isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return user ? <X402SandboxPage /> : <Redirect to="/" />;
}

function BondSandboxProtect() {
  const { user, isLoaded } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return user ? <BondSandboxPage /> : <Redirect to="/" />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/dashboard" component={DashboardProtect} />
        <Route path="/developer" component={DeveloperProtect} />
        <Route path="/x402-sandbox" component={X402SandboxProtect} />
        <Route path="/bond-sandbox" component={BondSandboxProtect} />
        <Route path="/profile" component={ProfileProtect} />
        <Route path="/impressum" component={ImpressumPage} />
        <Route path="/datenschutz" component={DatenschutzPage} />
        <Route path="/api-docs" component={ApiDocsPage} />
        <Route path="/status" component={StatusPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
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
