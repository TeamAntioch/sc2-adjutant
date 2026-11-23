import type { Config } from "tailwindcss";

// The mapping reference's console look (screference.antioch.games), copied from its
// tailwind.config.ts rather than shared.
const config: Config = {
  content: ["./app/**/*.{ts,tsx,md,mdx}", "./components/**/*.{ts,tsx}", "./mdx-components.tsx"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-chakra-petch)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Menlo", "Consolas", "monospace"],
      },
      dropShadow: {
        glow: "0 0 8px rgba(34, 211, 238, 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
