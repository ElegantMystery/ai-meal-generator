import { create } from "zustand";

export interface User {
  id?: string;
  email?: string;
  name?: string;
  provider?: string;
  providerId?: string;
  createdAt?: string;
}

interface AuthState {
  user: any | null;
  setUser: (u: any | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
