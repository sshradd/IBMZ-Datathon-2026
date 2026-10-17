"use client";

import { Minus, Plus } from "lucide-react";

/** A count the responder sets with big plus and minus buttons. */
export default function Stepper({
  label,
  value,
  onChange,
  max = 60,
  note,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[14px]">{label}</p>
        {note && <p className="text-[11.5px] text-mute">{note}</p>}
      </div>
      <button className="btn !min-h-11 !w-11 !px-0" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Fewer ${label}`} disabled={value <= 0}>
        <Minus />
      </button>
      <span className="cond w-9 text-center text-[28px] tnum" aria-live="polite">
        {value}
      </span>
      <button className="btn !min-h-11 !w-11 !px-0" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`} disabled={value >= max}>
        <Plus />
      </button>
    </div>
  );
}
