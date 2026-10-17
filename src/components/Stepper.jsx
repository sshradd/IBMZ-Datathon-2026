import { Minus, Plus } from "lucide-react";

/** A count the responder sets with big plus and minus buttons. `bare` drops the label for tight rows. */
export default function Stepper({ label, value, onChange, max = 60, note, bare }) {
  return (
    <div className="stepper">
      {!bare && (
        <div className="stepper-l">
          <p>{label}</p>
          {note && <small className="mono">{note}</small>}
        </div>
      )}
      <button className="icon-btn" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Fewer ${label}`} disabled={value <= 0}><Minus size={18} /></button>
      <span className="step-n" aria-live="polite">{value}</span>
      <button className="icon-btn" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More ${label}`} disabled={value >= max}><Plus size={18} /></button>
    </div>
  );
}
