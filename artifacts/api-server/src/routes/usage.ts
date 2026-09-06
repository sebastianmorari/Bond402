import { Router, type IRouter } from "express";
import { GetUsageResponse } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { getUsage } from "../lib/usage";

const router: IRouter = Router();

router.get("/usage", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet.", code: "UNAUTHORIZED" });
    return;
  }
  res.json(GetUsageResponse.parse(await getUsage(user.id)));
});

export default router;