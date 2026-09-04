import { Router, type IRouter } from "express";
import healthRouter from "./health";
import servicesRouter from "./services";
import apiKeysRouter from "./api-keys";
import developerRouter from "./developer";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(servicesRouter);
router.use(apiKeysRouter);
router.use(developerRouter);
router.use(authRouter);

export default router;
