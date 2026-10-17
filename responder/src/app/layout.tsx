import type { Metadata, Viewport } from "next";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/inter-tight/700.css";
import "@fontsource/inter-tight/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "Uri Watch Responder",
  description: "Texas power outage response: where crews are most needed, how long they take to arrive, and what material is short.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Uri Watch", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f3ee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="day" data-glove="off">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
