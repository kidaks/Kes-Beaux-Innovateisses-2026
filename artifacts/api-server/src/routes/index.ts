import { Router, type IRouter } from "express";
import { loadAuthSession } from "../middlewares/auth-context";
import authRouter from "./auth";
import healthRouter from "./health";
import monitoringRouter from "./monitoring";

const router: IRouter = Router();

router.use(loadAuthSession);
router.use(authRouter);
router.use(monitoringRouter);
router.use(healthRouter);

export default router;
