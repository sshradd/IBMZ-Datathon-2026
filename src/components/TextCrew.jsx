import { Copy, MessageSquare, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { departBy, mins } from "../lib/format.js";
import { copyText } from "../lib/share.js";
import { useStore } from "../lib/store.jsx";

const NOTE_MAX = 160;
const phoneKey = id => `uw-phone-${id}`;
const segments = n => (n <= 160 ? 1 : Math.ceil(n / 153));

/**
 * Draft a text to a crew that is already in the plan: pick the crew, add a note, open it in Messages.
 * This only drafts: nothing is sent by this app, and a phone number is optional and stays on this device.
 */
export default function TextCrew() {
  const s = useStore();
  const open = !!s.composer;
  const units = useMemo(() => (s.ops?.units ?? []).filter(u => u.assignment && (u.status === "en_route" || u.status === "on_site")), [s.ops]);
  const [unitId, setUnitId] = useState("");
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [tried, setTried] = useState(false);
  const first = useRef(null);
  const latestUnits = useRef(units);
  latestUnits.current = units;
  const wanted = s.composer?.unitId ?? null;

  // set up once each time it opens; live data keeps arriving while it is open
  useEffect(() => {
    if (!open) return;
    const us = latestUnits.current;
    setUnitId(us.find(u => u.id === wanted)?.id ?? us[0]?.id ?? "");
    setNote("");
    setTried(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && unitId && !units.some(u => u.id === unitId)) setUnitId(units[0]?.id ?? "");
  }, [open, unitId, units]);

  useEffect(() => {
    if (!unitId) return;
    try {
      setPhone(localStorage.getItem(phoneKey(unitId)) ?? "");
    } catch {
      setPhone("");
    }
  }, [unitId]);

  const { closeComposer } = s;
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const esc = e => e.key === "Escape" && closeComposer();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, closeComposer]);

  const unit = units.find(u => u.id === unitId);
  const now = s.latest?.as_of ?? s.latest?.t ?? "";
  const a = unit?.assignment;
  const depot = s.ops?.depots.find(d => d.id === unit?.depot)?.name ?? unit?.depot;
  const when = a ? (a.depart_by_min === 0 ? "Leave now" : `Leave by ${departBy(now, a.depart_by_min)}`) : "";
  const message = unit && a ? `Surge recommends: ${unit.name} to ${a.county} County from ${depot}. Travel ${mins(a.eta_min)}. ${when}.${note.trim() ? ` Note: ${note.trim()}` : ""}` : "";

  if (!open) return null;

  const savePhone = v => {
    setPhone(v);
    try {
      if (v) localStorage.setItem(phoneKey(unitId), v);
      else localStorage.removeItem(phoneKey(unitId));
    } catch {
      /* storage unavailable */
    }
  };
  const openMessages = () => {
    setTried(true);
    window.location.href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Text a crew">
      <button className="modal-back" aria-label="Close" onClick={s.closeComposer} tabIndex={-1} />
      <div className="modal-card">
        <div className="modal-h">
          <div>
            <p className="eyebrow">Text a crew</p>
            <h2>Assign and notify</h2>
          </div>
          <button className="icon-btn" onClick={s.closeComposer} aria-label="Close"><X size={20} /></button>
        </div>

        {!units.length ? (
          <p className="muted mt-s">No crew is in the plan yet. Assign a crew to a county first, then come back to text them.</p>
        ) : (
          <>
            <label className="field-l">
              <span className="eyebrow">Crew</span>
              <select ref={first} className="input" value={unitId} onChange={e => setUnitId(e.target.value)}>
                {units.map(u => <option key={u.id} value={u.id}>{u.name} · {u.assignment?.county} · {mins(u.assignment?.eta_min ?? 0)}</option>)}
              </select>
            </label>
            <label className="field-l">
              <span className="eyebrow">Note (optional)</span>
              <textarea className="input area" value={note} maxLength={NOTE_MAX} onChange={e => setNote(e.target.value)} rows={2} placeholder="Gate code, who to call on arrival, route to avoid…" />
              <span className="mono faint xs">{note.length}/{NOTE_MAX}</span>
            </label>
            <label className="field-l">
              <span className="eyebrow">Their phone (optional)</span>
              <input className="input" type="tel" inputMode="tel" value={phone} onChange={e => savePhone(e.target.value)} placeholder="Leave blank to pick a contact in Messages" autoComplete="off" />
              <span className="faint xs">Saved on this device only. Never sent to a server.</span>
            </label>
            <div className="mt-s">
              <p className="eyebrow">Message</p>
              <p className="mono xs msg-preview">{message}</p>
              <p className="mono faint xs">{message.length} characters · {segments(message.length)} {segments(message.length) === 1 ? "text" : "texts"}</p>
            </div>
            <div className="btn-row">
              <button className="btn primary grow" onClick={openMessages} disabled={!message}><MessageSquare size={18} /> Open in Messages</button>
              <button className="btn" onClick={async () => s.say((await copyText(message)) ? "Message copied" : "Could not copy")} disabled={!message}><Copy size={18} /> Copy</button>
            </div>
            {tried && <p className="muted sm mt-xs">If Messages did not open (computers often cannot), use Copy and paste it into your texting app.</p>}
            <p className="faint xs mt-s">Surge only drafts this. You send it from your own phone.</p>
          </>
        )}
      </div>
    </div>
  );
}
