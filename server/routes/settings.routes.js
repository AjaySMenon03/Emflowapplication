import { Router } from "express";
import {
    createQueueType, updateQueueType, deleteQueueType,
    updateStaff, deleteStaff, inviteStaff,
    updateBusiness, updateLocation,
    getWhatsAppSettings, updateWhatsAppSettings,
    getBusinessHours, updateBusinessHours,
} from "../controllers/settings.controller.js";

const router = Router();

// Queue types
router.post("/queue-type", createQueueType);
router.put("/queue-type/:id", updateQueueType);
router.delete("/queue-type/:id", deleteQueueType);

// Staff
router.put("/staff/:authUid", updateStaff);
router.delete("/staff/:authUid", deleteStaff);
router.post("/staff/invite", inviteStaff);

// Business
router.put("/business/:id", updateBusiness);

// Location
router.put("/location/:id", updateLocation);

// WhatsApp
router.get("/whatsapp/:businessId", getWhatsAppSettings);
router.put("/whatsapp/:businessId", updateWhatsAppSettings);

// Business hours
router.get("/business-hours/:locationId", getBusinessHours);
router.put("/business-hours/:locationId", updateBusinessHours);

export default router;
