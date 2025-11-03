import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "vite.svg", "pwa-192.png", "pwa-512.png", "pwa-maskable.png"],
      manifest: {
        name: "Tid & Arbejde",
        short_name: "Tid&Arbejde",
        description: "Instempling, udstempling og timesats-registrering",
        theme_color: "#0ea5e9",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ],
      },
    }),
  ],
});
