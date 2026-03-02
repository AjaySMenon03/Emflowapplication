import { Router } from "express";
import {
    getLocation, getLocationById, joinQueue, getStatus,
    cancelEntry, getPublicEntries, getPublicBusinessHours,
} from "../controllers/public.controller.js";

const router = Router();

router.get("/location/:slug", getLocation);
router.get("/location-by-id/:id", getLocationById);
router.post("/queue/join", joinQueue);
router.get("/queue/status/:entryId", getStatus);
router.post("/queue/cancel/:entryId", cancelEntry);
router.get("/queue/entries/:locationId", getPublicEntries);
router.get("/business-hours/:locationId", getPublicBusinessHours);

export default router;
