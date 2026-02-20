import { create } from "zustand";

export interface User {
  id?: string;
  email?: string;
  name?: string;
  provider?: string;
  providerId?: string;
  createdAt?: string;
  onboardingCompleted?: boolean;
}

interface AuthState {
  user: User | null;
  setUser: (u: User | null) => void;
  // Counter to trigger preference refresh in dashboard
  preferencesVersion: number;
  incrementPreferencesVersion: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  preferencesVersion: 0,
  incrementPreferencesVersion: () =>
    set((state) => ({ preferencesVersion: state.preferencesVersion + 1 })),
}));
