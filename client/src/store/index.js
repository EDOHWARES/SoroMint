import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  registerAndAuthenticate,
  getProfile,
  refreshToken,
} from "../services/authService";

// ─────────────────────────────────────────────────────────────────────────────
// Wallet / Auth Store
// Manages Freighter wallet connection + SEP-10 JWT session state.
// ─────────────────────────────────────────────────────────────────────────────

export const useWalletStore = create(
  persist(
    (set, get) => ({
      // ── State ──────────────────────────────────────────────────────────────
      address: null,
      isConnected: false,

      /** JWT access token issued after successful SEP-10 challenge-response */
      authToken: null,

      /** Expiry string returned by the server, e.g. "24h" */
      tokenExpiresIn: null,

      /** Full user object returned after login */
      user: null,

      /** True while the challenge-response flow (or profile fetch) is in flight */
      authLoading: false,

      /** Human-readable error from the most recent auth attempt */
      authError: null,

      /** True once the user has been authenticated via challenge-response */
      isAuthenticated: false,

      // ── Actions ────────────────────────────────────────────────────────────

      /**
       * @notice Runs the full SEP-10 flow:
       *   1. connectFreighter()    — retrieve public key
       *   2. register() if needed — auto-register new users (no username)
       *   3. getChallenge()        — fetch server-signed challenge tx
       *   4. signChallenge()       — Freighter co-signs the XDR
       *   5. login()               — exchange signed XDR for a JWT
       *
       * Stores the resulting JWT and user in Zustand (persisted to localStorage).
       *
       * @returns {Promise<void>}
       */
      connectWallet: async () => {
        set({ authLoading: true, authError: null });

        try {
          const { publicKey, token, expiresIn, user } =
            await registerAndAuthenticate();

          set({
            address: publicKey,
            isConnected: true,
            authToken: token,
            tokenExpiresIn: expiresIn,
            user,
            isAuthenticated: true,
            authLoading: false,
            authError: null,
          });
        } catch (err) {
          set({
            authLoading: false,
            authError: err.message || "Wallet connection failed",
            isAuthenticated: false,
          });
          // Re-throw so the UI can display a toast / alert
          throw err;
        }
      },

      /**
       * @notice Clears all auth and wallet state (logs the user out).
       */
      disconnectWallet: () =>
        set({
          address: null,
          isConnected: false,
          authToken: null,
          tokenExpiresIn: null,
          user: null,
          isAuthenticated: false,
          authLoading: false,
          authError: null,
        }),

      /**
       * @notice Clears any stored auth error (e.g. after the user dismisses it).
       */
      clearAuthError: () => set({ authError: null }),

      /**
       * @notice Refreshes the stored JWT using the current token.
       *         Call this proactively before the token expires.
       * @returns {Promise<void>}
       */
      refreshAuthToken: async () => {
        const { authToken } = get();
        if (!authToken) return;

        try {
          const { token, expiresIn } = await refreshToken(authToken);
          set({ authToken: token, tokenExpiresIn: expiresIn });
        } catch (err) {
          // If the refresh fails the session is dead — log out cleanly
          get().disconnectWallet();
          throw err;
        }
      },

      /**
       * @notice Re-fetches the user profile from the server and updates the store.
       * @returns {Promise<void>}
       */
      syncUserProfile: async () => {
        const { authToken } = get();
        if (!authToken) return;

        try {
          const user = await getProfile(authToken);
          if (user) set({ user });
        } catch {
          // Non-fatal — stale profile is acceptable until next login
        }
      },

      // ── Setters (kept for backward compatibility) ─────────────────────────

      /** Directly set wallet address without going through the auth flow. */
      setWallet: (address) => set({ address, isConnected: !!address }),
    }),
    {
      name: "wallet-storage",
      // Only persist the fields that should survive a page refresh
      partialize: (state) => ({
        address: state.address,
        isConnected: state.isConnected,
        authToken: state.authToken,
        tokenExpiresIn: state.tokenExpiresIn,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Token Store
// ─────────────────────────────────────────────────────────────────────────────

export const useTokenStore = create(
  persist(
    (set) => ({
      tokens: [],
      isLoading: false,
      error: null,

      setTokens: (tokens) => set({ tokens }),

      addToken: (token) =>
        set((state) => ({ tokens: [...state.tokens, token] })),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      clearError: () => set({ error: null }),

      fetchTokens: async (address) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(
            `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"}/tokens/${address}`,
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
      partialize: (state) => ({ tokens: state.tokens }),
    },
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// UI Store
// ─────────────────────────────────────────────────────────────────────────────

export const useUIStore = create(
  persist(
    (set, get) => ({
      theme: "system",
      resolvedTheme: "dark",
      isSidebarOpen: false,

      getSystemTheme: () => {
        if (typeof window !== "undefined") {
          return window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
        }
        return "dark";
      },

      resolveTheme: () => {
        const { theme, getSystemTheme } = get();
        return theme === "system" ? getSystemTheme() : theme;
      },

      setTheme: (theme) => {
        const resolved = theme === "system" ? get().getSystemTheme() : theme;
        set({ theme, resolvedTheme: resolved });

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
          mediaQuery.addEventListener("change", () => {
            if (get().theme === "system") {
              get().setTheme("system");
            }
          });
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
