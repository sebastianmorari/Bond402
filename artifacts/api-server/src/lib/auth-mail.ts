import { createHash, randomBytes } from "node:crypto";
import { logger } from "./logger";

export const AUTH_TOKEN_PURPOSE = {
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  PASSWORD_RESET: "PASSWORD_RESET",
} as const;

export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSE)[keyof typeof AUTH_TOKEN_PURPOSE];

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

const DEFAULT_FROM = "onboarding@resend.dev";
const RESEND_API_URL = "https://api.resend.com/emails";

export class EmailDeliveryError extends Error {
  constructor(message = "Die E-Mail konnte nicht versendet werden.") {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getMailConfig(fallbackBaseUrl?: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const baseUrl =
    process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ||
    fallbackBaseUrl?.trim().replace(/\/+$/, "");
  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;

  if (!apiKey) {
    throw new EmailDeliveryError("Der E-Mail-Versand ist serverseitig nicht konfiguriert.");
  }
  if (!baseUrl || !/^https?:\/\/[^/]+/i.test(baseUrl)) {
    throw new EmailDeliveryError("Die öffentliche Basis-URL für E-Mail-Links ist nicht konfiguriert.");
  }
  if (process.env.NODE_ENV === "production" && !baseUrl.startsWith("https://")) {
    throw new EmailDeliveryError("Die öffentliche Basis-URL muss in Produktion HTTPS verwenden.");
  }

  return { apiKey, baseUrl, from };
}

export function createAuthToken() {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashAuthToken(rawToken) };
}

export function hashAuthToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function buildLink(baseUrl: string, path: string, rawToken: string) {
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
}: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  let response: Response;
  try {
    response = await fetch(process.env.RESEND_API_URL?.trim() || RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : typeof error }, "Auth-E-Mail konnte nicht versendet werden");
    throw new EmailDeliveryError();
  }

  if (!response.ok) {
    logger.error({ statusCode: response.status }, "Resend hat die Auth-E-Mail abgelehnt");
    throw new EmailDeliveryError();
  }
}

export async function sendVerificationEmail(
  email: string,
  displayName: string,
  rawToken: string,
  options: { fallbackBaseUrl?: string } = {},
) {
  const { apiKey, baseUrl, from } = getMailConfig(options.fallbackBaseUrl);
  const link = buildLink(baseUrl, "/verify-email", rawToken);
  const safeName = escapeHtml(displayName);
  await sendResendEmail({
    apiKey,
    from,
    to: email,
    subject: "Bond402: E-Mail-Adresse bestätigen",
    html: `<p>Hallo ${safeName},</p><p>bestätigen Sie Ihre E-Mail-Adresse für Bond402 innerhalb von 24 Stunden:</p><p><a href="${escapeHtml(link)}">E-Mail-Adresse bestätigen</a></p><p>Wenn Sie kein Konto erstellt haben, können Sie diese Nachricht ignorieren.</p>`,
    text: `Hallo ${displayName},\n\nbestätigen Sie Ihre E-Mail-Adresse für Bond402 innerhalb von 24 Stunden:\n${link}\n\nWenn Sie kein Konto erstellt haben, können Sie diese Nachricht ignorieren.`,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  displayName: string,
  rawToken: string,
  options: { fallbackBaseUrl?: string } = {},
) {
  const { apiKey, baseUrl, from } = getMailConfig(options.fallbackBaseUrl);
  const link = buildLink(baseUrl, "/reset-password", rawToken);
  const safeName = escapeHtml(displayName);
  await sendResendEmail({
    apiKey,
    from,
    to: email,
    subject: "Bond402: Passwort zurücksetzen",
    html: `<p>Hallo ${safeName},</p><p>über diesen Link können Sie Ihr Bond402-Passwort innerhalb von 30 Minuten neu setzen:</p><p><a href="${escapeHtml(link)}">Passwort zurücksetzen</a></p><p>Wenn Sie diese Anfrage nicht gestellt haben, können Sie diese Nachricht ignorieren.</p>`,
    text: `Hallo ${displayName},\n\nüber diesen Link können Sie Ihr Bond402-Passwort innerhalb von 30 Minuten neu setzen:\n${link}\n\nWenn Sie diese Anfrage nicht gestellt haben, können Sie diese Nachricht ignorieren.`,
  });
}