/**
 * Auth Controller
 */
import { getAuthUser } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import * as kv from "../models/kv-store.js";

// POST /api/auth/signup
export async function signup(req, res) {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }
        const supabase = supabaseAdmin();
        const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            user_metadata: { name: name || "" },
            email_confirm: true,
        });
        if (error)
            return res.status(400).json({ error: `Signup error: ${error.message}` });
        return res.json({ user: data.user });
    } catch (err) {
        return res
            .status(500)
            .json({ error: `Signup failed: ${err.message}` });
    }
}

// GET /api/auth/role
export async function getRole(req, res) {
    try {
        const user = await getAuthUser(req);
        if (!user)
            return res.status(401).json({
                error: "Unauthorized - invalid token while checking role",
            });

        const staffRecord = await kv.get(`staff_user:${user.id}`);
        if (staffRecord) {
            return res.json({
                role: staffRecord.role || "staff",
                businessId: staffRecord.business_id,
                hasOnboarded: true,
                record: staffRecord,
            });
        }
        const customerRecord = await kv.get(`customer:${user.id}`);
        if (customerRecord) {
            return res.json({
                role: "customer",
                hasOnboarded: true,
                record: customerRecord,
            });
        }
        return res.json({ role: null, hasOnboarded: false, record: null });
    } catch (err) {
        return res
            .status(500)
            .json({ error: `Role check failed: ${err.message}` });
    }
}
