import type { NextConfig } from "next";

// Static export: the app is plain files served by the FastAPI server on the LinuxONE box,
// so the Z side needs no Node runtime.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default config;
