"use client";

import { Minus, Plus } from "lucide-react";

/** A count the responder sets with big plus and minus buttons. `bare` drops the label for tight rows. */
export default function Stepper({
  label,
  value,
  onChange,
  max = 60,
  note,
  bare,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
  note?: string;
  bare?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {!bare && (
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{label}</p>
          {note && <p className="mono text-[11.5px] text-ink3">{note}</p>}
        </div>
      )}
      <button className="btn btn-icon" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Fewer ${label}`} disabled={value <= 0}>
        <Minus />
      </button>
      <span className="num w-9 text-center text-[26px]" aria-live="polite">
        {value}
      </span>
      <button className="btn btn-icon" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`} disabled={value >= max}>
        <Plus />
      </button>
    </div>
  );
}
