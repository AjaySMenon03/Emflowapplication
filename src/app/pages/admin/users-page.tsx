/**
 * Admin Users Page — placeholder with polished empty state
 */
import { useLocaleStore } from "../../stores/locale-store";
import { Card, CardContent } from "../../components/ui/card";
import { Users, UserPlus } from "lucide-react";

export function UsersPage() {
  const { t } = useLocaleStore();

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.users")}</h1>
        <p className="text-muted-foreground text-sm">
          Manage staff members and their permissions
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <Users className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-foreground">
              Staff Management
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Invite staff, assign roles (Owner, Admin, Staff), manage location assignments, and control permissions. Coming soon.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            <UserPlus className="h-3.5 w-3.5" />
            <span>Under development</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
