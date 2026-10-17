import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Uri Watch backend (FastAPI) serves /api, including the /api/events stream. Start it with:
//   cd backend && ../.venv/bin/uvicorn uriwatch.api:app --host 127.0.0.1 --port 8010
const API = process.env.VITE_PROXY ?? "http://127.0.0.1:8010";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: API, changeOrigin: true } } },
});
