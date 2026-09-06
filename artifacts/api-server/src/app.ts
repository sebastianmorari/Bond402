import express, { type Express } from "express";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

app.use("/api", router);

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (typeof error === "object" && error && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({
      error: "Die Anfrage ist zu groß. Bitte senden Sie weniger Daten.",
      code: "PAYLOAD_TOO_LARGE",
    });
    return;
  }
  if (typeof error === "object" && error && "type" in error && error.type === "entity.parse.failed") {
    res.status(400).json({
      error: "Die Anfrage enthält kein gültiges JSON.",
      code: "INVALID_JSON",
    });
    return;
  }
  logger.error(
    { errorType: error instanceof Error ? error.name : typeof error },
    "Unhandled request error",
  );
  res.status(500).json({
    error: "Der Server konnte die Anfrage nicht verarbeiten.",
    code: "INTERNAL_ERROR",
  });
});

export default app;
