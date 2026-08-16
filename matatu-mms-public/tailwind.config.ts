import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        county: {
          // Deep forest green matching Nairobi County / nairobiservices.go.ke — replaces the
          // previous electric #068930 which read as generic web green.
          green: "#0F5132",
          "green-dark": "#0A3823",
          "green-deep": "#082A1A",
          // Warmer, muted mustard used for accents and the corner marker on the reference site.
          yellow: "#F5C518",
          "yellow-dark": "#C99B00",
          // Warm cream body background straight off the reference site.
          cream: "#FBF6E5",
          "cream-dark": "#F0E9CE",
          // Ink text: near-black with the faintest green cast so headings feel weighted, not sterile.
          ink: "#0D1E14",
          blue: "#0F47AF",
          red: "#B4232C",
          black: "#0D1E14",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        elevated: "0 10px 30px -12px rgba(15, 81, 50, 0.18), 0 4px 12px -6px rgba(15, 81, 50, 0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
