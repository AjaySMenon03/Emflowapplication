/**
 * Quecumber — Auth Routes
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import { supabaseAdmin, getAuthUser } from "../lib/helpers.ts";

export function register(app: Hono) {
  app.post("/auth/signup", async (c: any) => {
    try {
      const { email, password, name } = await c.req.json();
      if (!email || !password) {
        return c.json({ error: "Email and password are required" }, 400);
      }
      const supabase = supabaseAdmin();
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        user_metadata: { name: name || "" },
        email_confirm: true,
      });
      if (error)
        return c.json({ error: `Signup error: ${error.message}` }, 400);
      return c.json({ user: data.user });
    } catch (err: any) {
      return c.json({ error: `Signup failed: ${err.message}` }, 500);
    }
  });

  app.get("/auth/role", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) {
        console.warn(
          "[/auth/role] Unauthorized access attempt (no user or invalid token)",
        );
        return c.json(
          { error: "Unauthorized - missing or invalid user session" },
          401,
        );
      }

      console.log(
        `[/auth/role] Checking role for user: ${user.id} (${user.email})`,
      );

      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (staffRecord) {
        return c.json({
          role: staffRecord.role || "staff",
          businessId: staffRecord.business_id,
          hasOnboarded: true,
          record: staffRecord,
        });
      }
      const customerRecord = await kv.get(`customer:${user.id}`);
      if (customerRecord) {
        return c.json({
          role: "customer",
          hasOnboarded: true,
          record: customerRecord,
        });
      }
      return c.json({ role: null, hasOnboarded: false, record: null });
    } catch (err: any) {
      return c.json({ error: `Role check failed: ${err.message}` }, 500);
    }
  });
}
