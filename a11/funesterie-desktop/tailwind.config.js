/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"],
        display: ["Rajdhani", "Inter", "ui-sans-serif", "system-ui"]
      },
      colors: {
        nexus: {
          ink: "#050510",
          panel: "#0d0a1d",
          panel2: "#12102a",
          border: "#302052",
          purple: "#a855f7",
          violet: "#7c3aed",
          cyan: "#22d3ee",
          green: "#22c55e",
          pink: "#ec4899",
          amber: "#f59e0b"
        }
      }
    }
  },
  plugins: []
};
