const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
]);

const TRANSIENT_AVAILABILITY_SQLSTATE_CODES = new Set([
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getDatabaseErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;

  for (let depth = 0; depth < 4 && isRecord(current) && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current.code === "string") return current.code;
    current = current.cause;
  }

  return undefined;
}

export function isUniqueViolation(error: unknown) {
  return getDatabaseErrorCode(error) === "23505";
}

export function isTransientDatabaseError(error: unknown) {
  const code = getDatabaseErrorCode(error);
  if (!code) return false;
  const normalizedCode = code.toUpperCase();
  if (CONNECTION_ERROR_CODES.has(normalizedCode)) return true;
  if (normalizedCode.startsWith("08")) return true;
  return TRANSIENT_AVAILABILITY_SQLSTATE_CODES.has(normalizedCode);
}

// Keep the existing name for callers while making its semantics explicit:
// only transient database availability failures are classified as 503-worthy.
export const isDatabaseError = isTransientDatabaseError;