/**
 * Admin Customers Page — /admin/users
 *
 * Business-scoped customer management table with:
 *   - List all customers for the logged-in user's business
 *   - Edit customer (name, email, phone) via modal
 *   - Delete customer with confirmation dialog
 *   - Loading spinner, empty state, toast notifications
 */
import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "../../stores/auth-store";
import { api } from "../../lib/api";
import { toast } from "sonner";
import {
  Card,
  CardContent,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Users,
  Loader2,
  Pencil,
  Trash2,
  Save,
  Search,
  UserRound,
  Mail,
  Phone,
  X,
} from "lucide-react";

// ── Types ──
interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

export function UsersPage() {
  const { session, businessId } = useAuthStore();
  const accessToken = session?.access_token;

  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Load Customers ──
  const loadCustomers = useCallback(async () => {
    if (!businessId || !accessToken) return;
    setLoading(true);
    const { data, error } = await api<{ customers: Customer[] }>(
      `/customers/${businessId}`,
      { accessToken }
    );
    if (error) {
      toast.error(error);
    } else if (data?.customers) {
      setCustomers(data.customers);
    }
    setLoading(false);
  }, [businessId, accessToken]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // ── Search filter ──
  const filteredCustomers = customers.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q)
    );
  });

  // ── Edit Handlers ──
  const openEdit = (customer: Customer) => {
    setEditCustomer(customer);
    setEditName(customer.name);
    setEditEmail(customer.email);
    setEditPhone(customer.phone);
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editCustomer || !accessToken) return;
    if (!editName.trim()) {
      toast.error("Name is required");
      return;
    }
    setEditSaving(true);
    const { error } = await api(`/customers/${editCustomer.id}`, {
      method: "PUT",
      accessToken,
      body: {
        name: editName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
      },
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success(`Customer "${editName.trim()}" updated`);
      setEditOpen(false);
      loadCustomers();
    }
    setEditSaving(false);
  };

  // ── Delete Handlers ──
  const openDelete = (customer: Customer) => {
    setDeleteCustomer(customer);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteCustomer || !accessToken) return;
    setDeleting(true);
    const { error } = await api(`/customers/${deleteCustomer.id}`, {
      method: "DELETE",
      accessToken,
    });
    if (error) {
      toast.error(error);
    } else {
      toast.success(`Customer "${deleteCustomer.name}" deleted`);
      setDeleteOpen(false);
      loadCustomers();
    }
    setDeleting(false);
  };

  // ── Loading State ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground text-sm">
            {customers.length} {customers.length === 1 ? "customer" : "customers"} in your business
          </p>
        </div>

        {/* Search */}
        {customers.length > 0 && (
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              id="customer-search"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════ */}
      {/* EMPTY STATE                                 */}
      {/* ════════════════════════════════════════════ */}
      {customers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Users className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground">
                No customers found
              </h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Customers will appear here once they join a queue at your business. Share your queue link to start getting customers!
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ════════════════════════════════════════════ */}
          {/* CUSTOMER TABLE                              */}
          {/* ════════════════════════════════════════════ */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <UserRound className="h-3.5 w-3.5" />
                        Customer Name
                      </span>
                    </th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">
                      <span className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" />
                        Email
                      </span>
                    </th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">
                      <span className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" />
                        Phone Number
                      </span>
                    </th>
                    <th className="text-right font-medium text-muted-foreground px-4 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-12 text-muted-foreground">
                        No customers match your search
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((customer) => (
                      <tr
                        key={customer.id}
                        className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                      >
                        {/* Name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                              <span className="text-sm font-semibold text-primary">
                                {(customer.name || "?").charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">
                                {customer.name || "—"}
                              </p>
                              {/* Show email on mobile below name */}
                              <p className="text-xs text-muted-foreground sm:hidden truncate">
                                {customer.email || "No email"}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <p className="text-foreground truncate max-w-[200px]">
                            {customer.email || "—"}
                          </p>
                        </td>

                        {/* Phone */}
                        <td className="px-4 py-3 hidden md:table-cell">
                          <p className="text-foreground">
                            {customer.phone || "—"}
                          </p>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => openEdit(customer)}
                              title="Edit customer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => openDelete(customer)}
                              title="Delete customer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            {filteredCustomers.length > 0 && (
              <div className="px-4 py-3 border-t border-border bg-muted/10">
                <p className="text-xs text-muted-foreground">
                  Showing {filteredCustomers.length} of {customers.length} customers
                </p>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ════════════════════════════════════════════ */}
      {/* EDIT DIALOG                                 */}
      {/* ════════════════════════════════════════════ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>
              Update this customer's information.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-customer-name">Name</Label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="edit-customer-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Customer name"
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-customer-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="edit-customer-email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="customer@email.com"
                  className="pl-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-customer-phone">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="edit-customer-phone"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="+91 12345 67890"
                  className="pl-10"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={editSaving} className="gap-1.5">
              {editSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════════════════════════ */}
      {/* DELETE CONFIRMATION                         */}
      {/* ════════════════════════════════════════════ */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteCustomer?.name}</strong>? This action cannot be undone and will permanently remove the customer record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
