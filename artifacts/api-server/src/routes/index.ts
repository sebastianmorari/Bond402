import { Router, type IRouter } from "express";
import healthRouter from "./health";
import servicesRouter from "./services";
import apiKeysRouter from "./api-keys";
import developerRouter from "./developer";
import authRouter from "./auth";
import usageRouter from "./usage";
import publicRouter from "./public";
import executionRouter from "./execution";

const router: IRouter = Router();

router.use(healthRouter);
router.use(servicesRouter);
router.use(apiKeysRouter);
router.use(developerRouter);
router.use(authRouter);
router.use(usageRouter);
router.use(publicRouter);
router.use(executionRouter);

export default router;
