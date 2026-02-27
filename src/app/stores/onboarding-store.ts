/**
 * Onboarding Store (Zustand)
 * Multi-step onboarding wizard state management.
 */
import { create } from "zustand";

export interface QueueTypeInput {
  name: string;
  prefix: string;
  description: string;
  estimatedServiceTime: number;
  maxCapacity: number;
}

export interface BusinessHours {
  day: string;
  enabled: boolean;
  open: string;
  close: string;
}

export interface StaffMemberInput {
  name: string;
  email: string;
  role: "admin" | "staff";
}

export const ONBOARDING_STEPS = [
  { id: 1, label: "Business Info", key: "business" },
  { id: 2, label: "First Location", key: "location" },
  { id: 3, label: "Queue Types", key: "queues" },
  { id: 4, label: "Business Hours", key: "hours" },
  { id: 5, label: "WhatsApp", key: "whatsapp" },
  { id: 6, label: "Add Staff", key: "staff" },
] as const;

const DEFAULT_HOURS: BusinessHours[] = [
  { day: "Monday", enabled: true, open: "09:00", close: "18:00" },
  { day: "Tuesday", enabled: true, open: "09:00", close: "18:00" },
  { day: "Wednesday", enabled: true, open: "09:00", close: "18:00" },
  { day: "Thursday", enabled: true, open: "09:00", close: "18:00" },
  { day: "Friday", enabled: true, open: "09:00", close: "18:00" },
  { day: "Saturday", enabled: false, open: "10:00", close: "14:00" },
  { day: "Sunday", enabled: false, open: "10:00", close: "14:00" },
];

interface OnboardingState {
  currentStep: number;
  // Step 1 - Business
  businessName: string;
  industry: string;
  businessPhone: string;
  businessEmail: string;
  businessAddress: string;
  ownerName: string;
  // Step 2 - Location
  locationName: string;
  locationAddress: string;
  locationCity: string;
  locationPhone: string;
  timezone: string;
  // Step 3 - Queue Types
  queueTypes: QueueTypeInput[];
  // Step 4 - Business Hours
  businessHours: BusinessHours[];
  // Step 5 - WhatsApp
  whatsappEnabled: boolean;
  whatsappPhone: string;
  // Step 6 - Staff
  staffMembers: StaffMemberInput[];
  // Created IDs (from server responses)
  createdBusinessId: string | null;
  createdLocationId: string | null;
  // Actions
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  updateField: (field: string, value: unknown) => void;
  addQueueType: () => void;
  removeQueueType: (index: number) => void;
  updateQueueType: (index: number, field: string, value: unknown) => void;
  updateBusinessHour: (index: number, field: string, value: unknown) => void;
  addStaffMember: () => void;
  removeStaffMember: (index: number) => void;
  updateStaffMember: (index: number, field: string, value: unknown) => void;
  setCreatedIds: (businessId: string, locationId: string) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  currentStep: 1,
  businessName: "",
  industry: "",
  businessPhone: "",
  businessEmail: "",
  businessAddress: "",
  ownerName: "",
  locationName: "",
  locationAddress: "",
  locationCity: "",
  locationPhone: "",
  timezone: "Europe/Istanbul",
  queueTypes: [
    { name: "General", prefix: "G", description: "General inquiry", estimatedServiceTime: 10, maxCapacity: 100 },
  ],
  businessHours: DEFAULT_HOURS,
  whatsappEnabled: false,
  whatsappPhone: "",
  staffMembers: [],
  createdBusinessId: null,
  createdLocationId: null,

  setStep: (step) => set({ currentStep: step }),
  nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, 6) })),
  prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 1) })),
  updateField: (field, value) => set({ [field]: value } as any),

  addQueueType: () =>
    set((s) => ({
      queueTypes: [
        ...s.queueTypes,
        { name: "", prefix: "", description: "", estimatedServiceTime: 10, maxCapacity: 100 },
      ],
    })),
  removeQueueType: (index) =>
    set((s) => ({
      queueTypes: s.queueTypes.filter((_, i) => i !== index),
    })),
  updateQueueType: (index, field, value) =>
    set((s) => ({
      queueTypes: s.queueTypes.map((qt, i) =>
        i === index ? { ...qt, [field]: value } : qt
      ),
    })),

  updateBusinessHour: (index, field, value) =>
    set((s) => ({
      businessHours: s.businessHours.map((bh, i) =>
        i === index ? { ...bh, [field]: value } : bh
      ),
    })),

  addStaffMember: () =>
    set((s) => ({
      staffMembers: [...s.staffMembers, { name: "", email: "", role: "staff" }],
    })),
  removeStaffMember: (index) =>
    set((s) => ({
      staffMembers: s.staffMembers.filter((_, i) => i !== index),
    })),
  updateStaffMember: (index, field, value) =>
    set((s) => ({
      staffMembers: s.staffMembers.map((sm, i) =>
        i === index ? { ...sm, [field]: value } : sm
      ),
    })),

  setCreatedIds: (businessId, locationId) =>
    set({ createdBusinessId: businessId, createdLocationId: locationId }),

  reset: () =>
    set({
      currentStep: 1,
      businessName: "",
      industry: "",
      businessPhone: "",
      businessEmail: "",
      businessAddress: "",
      ownerName: "",
      locationName: "",
      locationAddress: "",
      locationCity: "",
      locationPhone: "",
      timezone: "Europe/Istanbul",
      queueTypes: [
        { name: "General", prefix: "G", description: "General inquiry", estimatedServiceTime: 10, maxCapacity: 100 },
      ],
      businessHours: DEFAULT_HOURS,
      whatsappEnabled: false,
      whatsappPhone: "",
      staffMembers: [],
      createdBusinessId: null,
      createdLocationId: null,
    }),
}));
