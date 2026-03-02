import { Router } from "express";
import {
    createBusiness, createLocation, createQueueTypes,
    saveBusinessHours, saveWhatsApp, createStaff, complete,
} from "../controllers/onboarding.controller.js";

const router = Router();

router.post("/business", createBusiness);
router.post("/location", createLocation);
router.post("/queue-types", createQueueTypes);
router.post("/business-hours", saveBusinessHours);
router.post("/whatsapp", saveWhatsApp);
router.post("/staff", createStaff);
router.post("/complete", complete);

export default router;
