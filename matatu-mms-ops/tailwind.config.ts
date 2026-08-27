import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        county: {
          green: "#0F5132",
          "green-dark": "#0A3823",
          "green-deep": "#082A1A",
          yellow: "#F5C518",
          "yellow-dark": "#C99B00",
          cream: "#FBF6E5",
          "cream-dark": "#F0E9CE",
          ink: "#0D1E14",
          blue: "#0F47AF",
          red: "#B4232C",
          black: "#0D1E14",
        },
      },
      fontFamily: {
        sans: ["Google Sans Variable", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
