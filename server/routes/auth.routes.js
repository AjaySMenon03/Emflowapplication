import { Router } from "express";
import { signup, getRole } from "../controllers/auth.controller.js";

const router = Router();

router.post("/signup", signup);
router.get("/role", getRole);

export default router;
