import { useEffect, useState } from "react";

/** A setting kept in localStorage, applied to <html> as a data attribute. */
export function useSetting(key, fallback, attr) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`uw-${key}`);
      if (saved) setValue(saved);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  useEffect(() => {
    if (attr) document.documentElement.dataset[attr] = value;
  }, [attr, value]);
  const set = v => {
    setValue(v);
    try {
      localStorage.setItem(`uw-${key}`, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set];
}
