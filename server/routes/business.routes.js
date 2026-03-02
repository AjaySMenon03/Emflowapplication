import { Router } from "express";
import { getBusiness, getLocations, getStaff } from "../controllers/business.controller.js";

const router = Router();

router.get("/:id", getBusiness);
router.get("/:id/locations", getLocations);
router.get("/:id/staff", getStaff);

export default router;
