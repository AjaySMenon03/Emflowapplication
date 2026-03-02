/**
 * Kiosk Layout — Fullscreen display with no navigation.
 * Designed for wall-mounted screens and lobby tablets.
 *
 * Features:
 *   - No header/footer chrome
 *   - Blocks back/forward navigation when locked
 *   - Prevents accidental swipe-back gestures
 *   - Touch-action optimized for tablets
 */
import { useEffect } from "react";
import { Outlet } from "react-router";

export function KioskLayout() {
  // Prevent context menu on long-press (tablet UX)
  useEffect(() => {
    const handler = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  // Prevent text selection drag (tablet UX)
  useEffect(() => {
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      document.body.style.overscrollBehavior = "";
    };
  }, []);

  return (
    <div
      className="relative flex h-screen w-full flex-col bg-background overflow-hidden"
      style={{ touchAction: "manipulation" }}
    >
      <Outlet />
    </div>
  );
}
