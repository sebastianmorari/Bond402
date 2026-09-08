const SQLSTATE_PREFIXES = new Set([
  "08",
  "09",
  "0A",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "2B",
  "2D",
  "2F",
  "34",
  "38",
  "39",
  "3B",
  "3D",
  "3F",
  "40",
  "42",
  "44",
  "53",
  "54",
  "55",
  "57",
  "58",
  "F0",
  "HV",
  "P0",
  "XX",
]);

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
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

export function isDatabaseError(error: unknown) {
  const code = getDatabaseErrorCode(error);
  if (!code) return false;
  if (CONNECTION_ERROR_CODES.has(code)) return true;
  return code.length >= 2 && SQLSTATE_PREFIXES.has(code.slice(0, 2).toUpperCase());
}