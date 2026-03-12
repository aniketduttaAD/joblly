import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        beige: {
          50: "#fdfcf9",
          100: "#f9f6f0",
          200: "#f2ebe0",
          300: "#e8dcc8",
          400: "#d4c4a8",
        },
        orange: {
          brand: "#e07c3c",
          light: "#f0a066",
          dark: "#c45d24",
        },
      },
      fontFamily: {
        sans: ["system-ui", "ui-sans-serif", "sans-serif"],
        mono: ["ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
