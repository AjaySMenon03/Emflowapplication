/**
 * Kiosk Layout — Fullscreen display with no navigation.
 * Designed for wall-mounted screens and lobby tablets.
 */
import { Outlet } from "react-router";

export function KioskLayout() {
  return (
    <div className="relative flex h-screen w-full flex-col bg-background overflow-hidden">
      <Outlet />
    </div>
  );
}
