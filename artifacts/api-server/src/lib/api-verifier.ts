import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

export type VerificationOutcome = {
  status: "PASS" | "FAIL" | "REVIEW";
  reachable: boolean;
  responseTimeMs: number;
  structureMatch: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  summary: string;
  foundFields: string[];
  missingFields: string[];
};

function isBlockedIpv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6(address: string): bigint | null {
  let source = address.toLowerCase().split("%")[0];
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const ipv4 = source.slice(lastColon + 1);
    if (!net.isIPv4(ipv4)) return null;
    const octets = ipv4.split(".").map(Number);
    source =
      source.slice(0, lastColon + 1) +
      `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function hasPrefix(value: bigint, prefix: bigint, bits: number): boolean {
  return value >> BigInt(128 - bits) === prefix >> BigInt(128 - bits);
}

function isBlockedIp(address: string): boolean {
  if (net.isIPv4(address)) {
    return isBlockedIpv4(address);
  }

  if (net.isIPv6(address)) {
    const value = parseIpv6(address);
    if (value === null) return true;

    const embeddedPrefix = value >> 32n;
    if (embeddedPrefix === 0xffffn || embeddedPrefix === 0n) {
      const ipv4Value = Number(value & 0xffffffffn);
      const mapped = [
        (ipv4Value >>> 24) & 255,
        (ipv4Value >>> 16) & 255,
        (ipv4Value >>> 8) & 255,
        ipv4Value & 255,
      ].join(".");
      return isBlockedIpv4(mapped);
    }

    return (
      value === 0n ||
      value === 1n ||
      hasPrefix(value, 0xfc00n << 112n, 7) ||
      hasPrefix(value, 0xfe80n << 112n, 10) ||
      hasPrefix(value, 0xff00n << 112n, 8) ||
      hasPrefix(value, 0x0064ff9bn << 96n, 96) ||
      hasPrefix(value, 0x2001n << 112n, 23) ||
      hasPrefix(value, 0x20010db8n << 96n, 32) ||
      hasPrefix(value, 0x2002n << 112n, 16)
    );
  }

  return true;
}

async function lookupBeforeDeadline(hostname: string, deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw Object.assign(new Error("Die sichere Prüfzeit ist abgelaufen."), { code: "TIMEOUT" });
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error("Die Namensauflösung dauerte zu lange."), { code: "TIMEOUT" })),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function validatePublicUrl(
  rawUrl: string,
  deadline = Date.now() + 5_000,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error("Die URL ist ungültig."), { code: "INVALID_URL" });
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(
      new Error("Nur öffentliche HTTP- oder HTTPS-Adressen ohne Zugangsdaten sind erlaubt."),
      { code: "UNSAFE_URL" },
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw Object.assign(new Error("Private oder interne Adressen dürfen nicht geprüft werden."), {
      code: "PRIVATE_ADDRESS",
    });
  }

  const addresses = await lookupBeforeDeadline(hostname, deadline);
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIp(address))) {
    throw Object.assign(new Error("Die Adresse verweist auf ein privates oder unsicheres Netzwerk."), {
      code: "PRIVATE_ADDRESS",
    });
  }

  return url;
}

async function requestOnce(
  url: URL,
  deadline: number,
): Promise<{ status: number; body: string; location?: string; elapsedMs: number }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookupBeforeDeadline(hostname, deadline);
  const target = addresses.find(({ address }) => !isBlockedIp(address));
  if (!target || addresses.some(({ address }) => isBlockedIp(address))) {
    throw Object.assign(new Error("Die Zieladresse ist nicht öffentlich."), {
      code: "PRIVATE_ADDRESS",
    });
  }

  return new Promise((resolve, reject) => {
    const started = performance.now();
    const transport = url.protocol === "https:" ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(Object.assign(new Error("Die sichere Prüfzeit ist abgelaufen."), { code: "TIMEOUT" }));
      return;
    }
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: target.address,
        family: target.family,
        servername: hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "application/json, text/plain;q=0.8",
          Host: url.host,
          "User-Agent": "Bond402-Verification/1.0",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(
              Object.assign(new Error("Die Antwort ist größer als 1 MB."), {
                code: "RESPONSE_TOO_LARGE",
              }),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            location: response.headers.location,
            elapsedMs: Math.max(1, Math.round(performance.now() - started)),
          });
        });
      },
    );

    const deadlineTimer = setTimeout(() => {
      request.destroy(Object.assign(new Error("Die Prüfung hat zu lange gedauert."), { code: "TIMEOUT" }));
    }, remaining);
    request.on("error", (error) => {
      clearTimeout(deadlineTimer);
      reject(error);
    });
    request.on("close", () => clearTimeout(deadlineTimer));
    request.end();
  });
}

async function safeGet(
  initialUrl: string,
  timeoutMs: number,
): Promise<{ status: number; body: string; elapsedMs: number }> {
  const deadline = Date.now() + timeoutMs;
  let url = await validatePublicUrl(initialUrl, deadline);
  let totalElapsed = 0;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await requestOnce(url, deadline);
    totalElapsed += response.elapsedMs;
    if (response.status >= 300 && response.status < 400 && response.location) {
      if (redirect === MAX_REDIRECTS) {
        throw Object.assign(new Error("Zu viele Weiterleitungen."), { code: "TOO_MANY_REDIRECTS" });
      }
      url = await validatePublicUrl(new URL(response.location, url).toString(), deadline);
      continue;
    }
    return { status: response.status, body: response.body, elapsedMs: totalElapsed };
  }

  throw Object.assign(new Error("Die Weiterleitung konnte nicht abgeschlossen werden."), {
    code: "TOO_MANY_REDIRECTS",
  });
}

function collectKeys(value: unknown, prefix = "", keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    if (value.length > 0) collectKeys(value[0], prefix, keys);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      keys.add(key.toLowerCase());
      keys.add(path.toLowerCase());
      collectKeys(child, path, keys);
    }
  }
  return keys;
}

export function parseExpectedFields(input: string): string[] {
  try {
    const parsed = JSON.parse(input);
    const allKeys = [...collectKeys(parsed)];
    return allKeys.filter(
      (key) => !allKeys.some((candidate) => candidate.startsWith(`${key}.`)),
    );
  } catch {
    return [...new Set(
      input
        .split(/[,\n;]/)
        .map((field) => field.trim().replace(/^["'{\s]+|["'}\s]+$/g, "").toLowerCase())
        .filter(Boolean),
    )];
  }
}

export function compareStructure(expectedStructure: string, actual: unknown) {
  const expected = parseExpectedFields(expectedStructure);
  const actualKeys = collectKeys(actual);
  const foundFields = expected.filter((field) => actualKeys.has(field.toLowerCase()));
  const missingFields = expected.filter((field) => !actualKeys.has(field.toLowerCase()));
  const ratio = expected.length === 0 ? 0 : foundFields.length / expected.length;
  return { foundFields, missingFields, ratio, matches: expected.length > 0 && missingFields.length === 0 };
}

export async function runLiveVerification(
  url: string,
  expectedStructure: string,
  maxResponseTime: number,
): Promise<VerificationOutcome> {
  const timeoutMs = Math.min(10_000, Math.max(2_000, maxResponseTime + 2_000));
  try {
    const response = await safeGet(url, timeoutMs);
    if (response.status < 200 || response.status >= 300) {
      return {
        status: "FAIL",
        reachable: true,
        responseTimeMs: response.elapsedMs,
        structureMatch: false,
        httpStatus: response.status,
        errorCode: "HTTP_ERROR",
        summary: `Der Dienst antwortete mit HTTP-Status ${response.status}.`,
        foundFields: [],
        missingFields: parseExpectedFields(expectedStructure),
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      return {
        status: "FAIL",
        reachable: true,
        responseTimeMs: response.elapsedMs,
        structureMatch: false,
        httpStatus: response.status,
        errorCode: "INVALID_JSON",
        summary: "Der Dienst ist erreichbar, lieferte aber kein gültiges JSON.",
        foundFields: [],
        missingFields: parseExpectedFields(expectedStructure),
      };
    }

    const comparison = compareStructure(expectedStructure, json);
    const fastEnough = response.elapsedMs <= maxResponseTime;
    const status =
      comparison.matches && fastEnough
        ? "PASS"
        : comparison.ratio >= 0.5 || comparison.matches
          ? "REVIEW"
          : "FAIL";
    const summary =
      status === "PASS"
        ? "Der Dienst ist erreichbar, schnell genug und liefert die erwartete Struktur."
        : status === "REVIEW"
          ? "Der Dienst antwortet, aber Antwortzeit oder Struktur weichen teilweise ab."
          : "Der Dienst antwortet, aber wichtige erwartete Felder fehlen.";

    return {
      status,
      reachable: true,
      responseTimeMs: response.elapsedMs,
      structureMatch: comparison.matches,
      httpStatus: response.status,
      errorCode: status === "FAIL" ? "STRUCTURE_MISMATCH" : null,
      summary,
      foundFields: comparison.foundFields,
      missingFields: comparison.missingFields,
    };
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "UNREACHABLE";
    const summary =
      code === "TIMEOUT"
        ? "Der Dienst hat nicht innerhalb des sicheren Zeitlimits geantwortet."
        : error instanceof Error
          ? error.message
          : "Der Dienst konnte nicht erreicht werden.";
    return {
      status: "FAIL",
      reachable: false,
      responseTimeMs: 0,
      structureMatch: false,
      httpStatus: null,
      errorCode: code,
      summary,
      foundFields: [],
      missingFields: parseExpectedFields(expectedStructure),
    };
  }
}

export function runManualVerification(
  expectedStructure: string,
  actualResponse: string,
): VerificationOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(actualResponse);
  } catch {
    return {
      status: "FAIL",
      reachable: true,
      responseTimeMs: 0,
      structureMatch: false,
      httpStatus: null,
      errorCode: "INVALID_JSON",
      summary: "Das eingefügte tatsächliche Ergebnis ist kein gültiges JSON.",
      foundFields: [],
      missingFields: parseExpectedFields(expectedStructure),
    };
  }

  const comparison = compareStructure(expectedStructure, parsed);
  const status = comparison.matches ? "PASS" : comparison.ratio >= 0.5 ? "REVIEW" : "FAIL";
  return {
    status,
    reachable: true,
    responseTimeMs: 0,
    structureMatch: comparison.matches,
    httpStatus: null,
    errorCode: comparison.matches ? null : "STRUCTURE_MISMATCH",
    summary:
      status === "PASS"
        ? "Alle erwarteten Felder wurden gefunden."
        : status === "REVIEW"
          ? "Ein Teil der erwarteten Felder wurde gefunden. Bitte prüfen Sie die fehlenden Felder."
          : "Zu viele erwartete Felder fehlen.",
    foundFields: comparison.foundFields,
    missingFields: comparison.missingFields,
  };
}