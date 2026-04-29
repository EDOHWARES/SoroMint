import { create } from "zustand";
import { persist } from "zustand/middleware";

// Wallet Store - Manages wallet connection and user address
export const useWalletStore = create(
  persist(
    (set) => ({
      address: null,
      isConnected: false,

      setWallet: (address) =>
        set({
          address,
          isConnected: !!address,
        }),

      disconnectWallet: () =>
        set({
          address: null,
          isConnected: false,
        }),
    }),
    {
      name: "wallet-storage", // localStorage key
    },
  ),
);

// Token Store - Manages token data and operations
export const useTokenStore = create(
  persist(
    (set) => ({
      tokens: [],
      isLoading: false,
      error: null,

      setTokens: (tokens) => set({ tokens }),

      addToken: (token) =>
        set((state) => ({
          tokens: [...state.tokens, token],
        })),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      clearError: () => set({ error: null }),

      // Fetch tokens for a specific address
      fetchTokens: async (address) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(
            `http://localhost:5000/api/tokens/${address}`,
          );
          if (!response.ok) throw new Error("Failed to fetch tokens");
          const data = await response.json();
          set({ tokens: data.data || [], isLoading: false });
        } catch (error) {
          set({ error: error.message, isLoading: false });
        }
      },
    }),
    {
      name: "token-storage",
      partialize: (state) => ({ tokens: state.tokens }), // Only persist tokens
    },
  ),
);

// UI Store - Manages UI state like theme and menus
export const useUIStore = create(
  persist(
    (set, get) => ({
      theme: "system", // 'light' | 'dark' | 'system'
      resolvedTheme: "dark", // The actual resolved theme
      isSidebarOpen: false,

      // Get system preference
      getSystemTheme: () => {
        if (typeof window !== "undefined") {
          return window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
        }
        return "dark";
      },

      // Resolve the actual theme to apply
      resolveTheme: () => {
        const { theme, getSystemTheme } = get();
        return theme === "system" ? getSystemTheme() : theme;
      },

      // Set theme and apply it
      setTheme: (theme) => {
        const resolved = theme === "system" ? get().getSystemTheme() : theme;
        set({ theme, resolvedTheme: resolved });

        // Apply classes to document
        if (typeof document !== "undefined") {
          const root = document.documentElement;
          if (resolved === "dark") {
            root.classList.add("dark");
            root.classList.remove("light");
          } else {
            root.classList.remove("dark");
            root.classList.add("light");
          }
        }
      },

      toggleTheme: () => {
        const { theme } = get();
        const cycle = ["light", "dark", "system"];
        const nextIndex = (cycle.indexOf(theme) + 1) % cycle.length;
        get().setTheme(cycle[nextIndex]);
      },

      initTheme: () => {
        const { theme, setTheme } = get();
        setTheme(theme);

        if (typeof window !== "undefined") {
          const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
          const handleChange = () => {
            if (get().theme === "system") {
              get().setTheme("system");
            }
          };
          mediaQuery.addEventListener("change", handleChange);
        }
      },

      toggleSidebar: () =>
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      closeSidebar: () => set({ isSidebarOpen: false }),
    }),
    {
      name: "ui-storage",
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);

// Combined App State (optional - for convenience)
export const useAppStore = create((set, get) => ({
  // Wallet actions
  connectWallet: (address) => {
    get().wallet.setWallet(address);
  },

  disconnectWallet: () => {
    get().wallet.disconnectWallet();
  },

  // Token actions
  addToken: (token) => {
    get().tokens.addToken(token);
  },

  // UI actions
  toggleSidebar: () => {
    get().ui.toggleSidebar();
  },

  // Access to individual stores
  wallet: useWalletStore.getState(),
  tokens: useTokenStore.getState(),
  ui: useUIStore.getState(),
}));
