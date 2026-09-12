import { isTransientDatabaseError } from "./database-errors";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 40;
const DEFAULT_MAX_DELAY_MS = 250;
const DEFAULT_JITTER_RATIO = 0.25;

type Sleep = (delayMs: number) => Promise<void>;

export type DatabaseReadRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  sleep?: Sleep;
  random?: () => number;
};

const defaultSleep: Sleep = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export async function withTransientDatabaseReadRetry<T>(
  operation: () => Promise<T>,
  options: DatabaseReadRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const jitterRatio = Math.max(0, Math.min(1, options.jitterRatio ?? DEFAULT_JITTER_RATIO));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientDatabaseError(error)) {
        throw error;
      }

      const exponentialDelay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1),
      );
      const jitter = exponentialDelay * jitterRatio * (random() * 2 - 1);
      await sleep(Math.max(0, Math.round(exponentialDelay + jitter)));
    }
  }

  throw new Error("Datenbank-Leseoperation konnte nicht ausgeführt werden.");
}