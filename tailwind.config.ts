import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211c",
        paper: "#fbfaf6",
        leaf: "#2f6b4f",
        mint: "#dff0e6",
        coral: "#e66a55",
        line: "#ded9cd"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(23, 33, 28, 0.08)"
      }
    }
  },
  plugins: []
} satisfies Config;
