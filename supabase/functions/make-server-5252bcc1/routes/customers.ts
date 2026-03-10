/**
 * Quecumber — Customer Management Routes (staff-facing)
 */
import type { Hono } from "npm:hono";
import * as kv from "../kv_store.tsx";
import { getAuthUser, now } from "../lib/helpers.ts";

export function register(app: Hono) {
  app.get("/customers/:businessId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (!staffRecord) return c.json({ error: "Staff record not found" }, 403);
      const businessId = c.req.param("businessId");
      if (staffRecord.business_id !== businessId)
        return c.json({ error: "Not authorized for this business" }, 403);
      const customerIds =
        (await kv.get(`business_customers:${businessId}`)) || [];
      const rawCustomers = await Promise.all(
        customerIds.map((cid: string) => kv.get(`customer:${cid}`)),
      );
      const customers = rawCustomers
        .filter((c: any) => c !== null && c !== undefined)
        .map((c: any) => ({
          id: c.id,
          name: c.name || "",
          email: c.email || "",
          phone: c.phone || "",
          created_at: c.created_at || "",
          updated_at: c.updated_at || "",
        }));
      customers.sort((a: any, b: any) =>
        (b.created_at || "").localeCompare(a.created_at || ""),
      );
      const seenPhones = new Set();
      const distinctCustomers = [];
      for (const customer of customers) {
        if (customer.phone) {
          if (!seenPhones.has(customer.phone)) {
            seenPhones.add(customer.phone);
            distinctCustomers.push(customer);
          }
        } else {
          distinctCustomers.push(customer);
        }
      }
      return c.json({ customers: distinctCustomers });
    } catch (err: any) {
      return c.json({ error: `Customer list failed: ${err.message}` }, 500);
    }
  });

  app.put("/customers/:customerId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (!staffRecord || !["owner", "admin"].includes(staffRecord.role))
        return c.json({ error: "Only owners/admins can edit customers" }, 403);
      const customerId = c.req.param("customerId");
      const customer = await kv.get(`customer:${customerId}`);
      if (!customer) return c.json({ error: "Customer not found" }, 404);
      const bizCustomers: string[] =
        (await kv.get(`business_customers:${staffRecord.business_id}`)) || [];
      if (!bizCustomers.includes(customerId))
        return c.json(
          { error: "Customer does not belong to your business" },
          403,
        );
      const body = await c.req.json();
      const updated = {
        ...customer,
        name: body.name?.trim() ?? customer.name,
        email: body.email?.trim() ?? customer.email,
        phone: body.phone?.trim() ?? customer.phone,
        updated_at: now(),
      };
      await kv.set(`customer:${customerId}`, updated);
      return c.json({ customer: updated });
    } catch (err: any) {
      return c.json({ error: `Customer update failed: ${err.message}` }, 500);
    }
  });

  app.delete("/customers/:customerId", async (c: any) => {
    try {
      const user = await getAuthUser(c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const staffRecord = await kv.get(`staff_user:${user.id}`);
      if (!staffRecord || !["owner", "admin"].includes(staffRecord.role))
        return c.json(
          { error: "Only owners/admins can delete customers" },
          403,
        );
      const customerId = c.req.param("customerId");
      const customer = await kv.get(`customer:${customerId}`);
      if (!customer) return c.json({ error: "Customer not found" }, 404);
      const bizCustomers: string[] =
        (await kv.get(`business_customers:${staffRecord.business_id}`)) || [];
      if (!bizCustomers.includes(customerId))
        return c.json(
          { error: "Customer does not belong to your business" },
          403,
        );
      const updatedList = bizCustomers.filter(
        (id: string) => id !== customerId,
      );
      await kv.set(
        `business_customers:${staffRecord.business_id}`,
        updatedList,
      );
      await kv.del(`customer:${customerId}`);
      try {
        await kv.del(`customer_entries:${customerId}`);
      } catch {}
      return c.json({
        success: true,
        message: `Customer "${customer.name}" deleted`,
      });
    } catch (err: any) {
      return c.json({ error: `Customer delete failed: ${err.message}` }, 500);
    }
  });
}
