import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { logger } from "./logger";
import {
  getDatabaseErrorCode,
  isTransientDatabaseError,
} from "./database-errors";

type ErrorLogger = Pick<typeof logger, "error">;

function resolveRequestId(req: Request) {
  return typeof req.id === "string" && req.id.length > 0
    ? req.id
    : crypto.randomUUID();
}

export function setRequestIdHeader(req: Request, res: Response) {
  const requestId = resolveRequestId(req);
  res.setHeader("X-Request-ID", requestId);
  return requestId;
}

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  setRequestIdHeader(req, res);
  next();
};

export function createApiErrorHandler(
  errorLogger: ErrorLogger = logger,
): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    const requestId = setRequestIdHeader(req, res);
    const databaseCode = getDatabaseErrorCode(error);
    errorLogger.error(
      {
        requestId,
        errorType: error instanceof Error ? error.name : typeof error,
        databaseCode,
        err: error,
      },
      "Unhandled request error",
    );

    if (res.headersSent) {
      next(error);
      return;
    }

    if (
      typeof error === "object" &&
      error &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      res.status(413).json({
        error: "Die Anfrage ist zu groß. Bitte senden Sie weniger Daten.",
        code: "PAYLOAD_TOO_LARGE",
      });
      return;
    }

    if (
      typeof error === "object" &&
      error &&
      "type" in error &&
      error.type === "entity.parse.failed"
    ) {
      res.status(400).json({
        error: "Die Anfrage enthält kein gültiges JSON.",
        code: "INVALID_JSON",
      });
      return;
    }

    if (isTransientDatabaseError(error)) {
      res.status(503).json({
        error: "Der Datenbankdienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.",
        code: "DATABASE_UNAVAILABLE",
      });
      return;
    }

    res.status(500).json({
      error: "Der Server konnte die Anfrage nicht verarbeiten.",
      code: "INTERNAL_ERROR",
    });
  };
}