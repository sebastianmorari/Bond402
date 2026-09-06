import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type LocalAuthUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
};

type AuthContextValue = {
  user: LocalAuthUser | null;
  isLoaded: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function parseAuthResponse(response: Response) {
  if (!response.ok) {
    let message = "Die Anfrage konnte nicht abgeschlossen werden.";
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the generic message when the server returned no JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json() as Promise<{ user: LocalAuthUser; message?: string; verificationRequired?: boolean }>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<LocalAuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) return null;
        return parseAuthResponse(response);
      })
      .then((result) => {
        if (!cancelled) {
          setUser(result?.user ?? null);
          setIsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoaded,
    signIn: async (email, password) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await parseAuthResponse(response);
      setUser(result?.user ?? null);
      queryClient.clear();
    },
    signUp: async (name, email, password) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      await parseAuthResponse(response);
      queryClient.clear();
    },
    signOut: async () => {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      setUser(null);
      queryClient.clear();
    },
  }), [isLoaded, queryClient, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}