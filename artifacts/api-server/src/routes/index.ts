import { Router, type IRouter } from "express";
import healthRouter from "./health";
import servicesRouter from "./services";
import apiKeysRouter from "./api-keys";
import developerRouter from "./developer";

const router: IRouter = Router();

router.use(healthRouter);
router.use(servicesRouter);
router.use(apiKeysRouter);
router.use(developerRouter);

export default router;
