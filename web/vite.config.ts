import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // `npm run dev` proxies the API to the backend on :8000.
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Scam Stopper",
        short_name: "ScamStopper",
        description: "Real-time instant-payment scam and mule-ring interception on IBM LinuxONE.",
        theme_color: "#0b0f17",
        background_color: "#0b0f17",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // Never cache the live API or the event stream.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: /\/api\//, handler: "NetworkOnly" }],
      },
    }),
  ],
});
