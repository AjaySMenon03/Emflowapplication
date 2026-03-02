import { Router } from "express";
import {
    getEntries, callNext, markServed, markNoShow,
    moveEntry, reassignStaff, getQueueTypes, getSession,
} from "../controllers/queue.controller.js";

const router = Router();

router.get("/entries/:locationId", getEntries);
router.post("/call-next", callNext);
router.post("/mark-served/:entryId", markServed);
router.post("/mark-noshow/:entryId", markNoShow);
router.post("/move/:entryId", moveEntry);
router.post("/reassign/:entryId", reassignStaff);
router.get("/types/:locationId", getQueueTypes);
router.post("/session", getSession);

export default router;
