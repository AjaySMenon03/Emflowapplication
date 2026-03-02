import { Router } from "express";
import { poll } from "../controllers/realtime.controller.js";

const router = Router();

router.get("/poll/:locationId", poll);

export default router;
