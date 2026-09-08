export const INITIAL_AUTH_CHECK_TIMEOUT_MS = 5_000;

export type AuthSessionUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
};

type AuthFetch = typeof fetch;

export async function fetchCurrentAuthUser(
  fetchImpl: AuthFetch = globalThis.fetch,
  timeoutMs = INITIAL_AUTH_CHECK_TIMEOUT_MS,
): Promise<AuthSessionUser | null> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl("/api/auth/me", {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (response.status === 401) return null;
    if (!response.ok) {
      throw new Error("Die Sitzung konnte nicht geladen werden.");
    }
    const body = (await response.json()) as { user?: AuthSessionUser };
    return body.user ?? null;
  } catch (error) {
    if (timedOut) return null;
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}