import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// Liveness: confirms only that the API process is running.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness: confirms that the API process can also reach PostgreSQL.
router.get("/readyz", async (req, res): Promise<void> => {
  try {
    await pool.query("SELECT 1");
    const data = ReadinessCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    req.log.warn("Readiness check failed");
    const data = ReadinessCheckResponse.parse({ status: "unavailable" });
    res.status(503).json(data);
  }
});

export default router;
