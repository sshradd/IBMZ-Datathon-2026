"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";
import { StoreProvider } from "@/lib/store";
import Shell from "./Shell";

export default function Providers({ children }: { children: React.ReactNode }) {
  useSetting<"night" | "day">("theme", "day", "theme");
  useSetting<"off" | "on">("glove", "off", "glove");
  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <StoreProvider>
      <Shell>{children}</Shell>
    </StoreProvider>
  );
}
