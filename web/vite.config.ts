import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Served at /analyst/ so the responder console can own the root.
  base: "/analyst/",
  // `npm run dev` proxies the API to the backend on :8000.
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Uri Watch",
        short_name: "UriWatch",
        description: "Which Texas counties lose power next, and who needs help first. Runs on IBM LinuxONE.",
        theme_color: "#060a14",
        background_color: "#060a14",
        display: "standalone",
        start_url: "/analyst/",
        scope: "/analyst/",
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
