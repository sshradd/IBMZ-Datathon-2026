"use client";

import { useEffect, useState } from "react";

/** A setting kept in localStorage, applied to <html> as a data attribute. */
export function useSetting<T extends string>(key: string, fallback: T, attr?: string): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`uw-${key}`);
      if (saved) setValue(saved as T);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  useEffect(() => {
    if (attr) document.documentElement.dataset[attr] = value;
  }, [attr, value]);
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(`uw-${key}`, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set];
}
