import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const TARGET_AUTH_TYPES = ["NONE", "BEARER", "API_KEY_HEADER"] as const;
export type TargetAuthType = (typeof TARGET_AUTH_TYPES)[number];

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const MAX_SECRET_LENGTH = 4096;

const FORBIDDEN_HEADER_NAMES = new Set([
  "authorization",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);

function encryptionKey() {
  const rootSecret = process.env.SESSION_SECRET;
  if (!rootSecret) {
    throw Object.assign(new Error("Serverseitige Secret-Verschlüsselung ist nicht verfügbar."), {
      code: "TARGET_AUTH_UNAVAILABLE",
    });
  }
  return createHash("sha256")
    .update(`bond402-target-auth:${rootSecret}`, "utf8")
    .digest()
    .subarray(0, KEY_BYTES);
}

export function encryptTargetSecret(secret: string) {
  if (secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
    throw Object.assign(new Error("Das Ziel-Secret ist ungültig."), {
      code: "INVALID_TARGET_AUTH",
    });
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptTargetSecret(payload: string) {
  try {
    const [version, ivValue, tagValue, ciphertextValue] = payload.split(".");
    if (
      version !== ENCRYPTION_VERSION ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue
    ) {
      throw new Error("Invalid encrypted target secret");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    if (plaintext.length === 0 || plaintext.length > MAX_SECRET_LENGTH) {
      throw new Error("Invalid decrypted target secret");
    }
    return plaintext;
  } catch {
    throw Object.assign(new Error("Das Ziel-Secret konnte nicht sicher geladen werden."), {
      code: "TARGET_AUTH_UNAVAILABLE",
    });
  }
}

export function validateTargetAuthHeaderName(name: string) {
  const normalized = name.trim().toLowerCase();
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(normalized) ||
    FORBIDDEN_HEADER_NAMES.has(normalized)
  ) {
    throw Object.assign(new Error("Dieser Authentifizierungs-Header ist nicht erlaubt."), {
      code: "INVALID_TARGET_AUTH_HEADER",
    });
  }
  return normalized;
}

export function isForbiddenTargetHeader(name: string) {
  return FORBIDDEN_HEADER_NAMES.has(name.trim().toLowerCase());
}