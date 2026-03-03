/**
 * Auth Store (Zustand)
 * Manages authentication state with role detection.
 */
import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";

export type UserRole = "owner" | "admin" | "staff" | "customer" | null;

interface StaffRecord {
  id: string;
  auth_user_id: string;
  business_id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  locations: string[];
  onboarding_completed?: boolean;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  role: UserRole;
  businessId: string | null;
  hasOnboarded: boolean;
  staffRecord: StaffRecord | null;
  setAuth: (user: User | null, session: Session | null) => void;
  setRole: (role: UserRole, businessId: string | null, hasOnboarded: boolean, staffRecord?: StaffRecord | null) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  role: null,
  businessId: null,
  hasOnboarded: false,
  staffRecord: null,
  setAuth: (user, session, isLoading = false) =>
    set({
      user,
      session,
      isAuthenticated: !!user,
      isLoading,
    }),
  setRole: (role, businessId, hasOnboarded, staffRecord = null) =>
    set({ role, businessId, hasOnboarded, staffRecord, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  clear: () =>
    set({
      user: null,
      session: null,
      isAuthenticated: false,
      isLoading: false,
      role: null,
      businessId: null,
      hasOnboarded: false,
      staffRecord: null,
    }),
}));
