"use client";

import { Copy, MessageSquare, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { departBy, mins } from "@/lib/format";
import { copyText } from "@/lib/share";
import { useStore } from "@/lib/store";

const NOTE_MAX = 160;
const phoneKey = (id: string) => `uw-phone-${id}`;

/** Characters to text segments: 160 for one text, 153 each once it splits. */
const segments = (n: number) => (n <= 160 ? 1 : Math.ceil(n / 153));

/**
 * Draft a text to a crew in the plan. Pick the crew, add a note, open it in Messages.
 * This only drafts: nothing is sent by this app, and a phone number is optional and stays on this device.
 */
export default function TextCrew() {
  const s = useStore();
  const open = !!s.composer;
  const units = useMemo(() => (s.ops?.units ?? []).filter((u) => u.assignment && (u.status === "en_route" || u.status === "on_site")), [s.ops]);
  const [unitId, setUnitId] = useState<string>("");
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLSelectElement>(null);

  // Set the sheet up once each time it opens: the crew the caller asked for, or the first in the plan.
  // Live data keeps arriving while it is open, so nothing here may re-run on every update.
  const latestUnits = useRef(units);
  latestUnits.current = units;
  const wanted = s.composer?.unitId ?? null;
  useEffect(() => {
    if (!open) return;
    const us = latestUnits.current;
    setUnitId(us.find((u) => u.id === wanted)?.id ?? us[0]?.id ?? "");
    setNote("");
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // if the chosen crew leaves the plan while the sheet is open, fall back to the first one
  useEffect(() => {
    if (open && unitId && !units.some((u) => u.id === unitId)) setUnitId(units[0]?.id ?? "");
  }, [open, unitId, units]);

  // phone numbers are remembered per crew, on this device only
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
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeComposer();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, closeComposer]);

  const unit = units.find((u) => u.id === unitId);
  const now = s.latest?.as_of ?? s.latest?.t ?? "";
  const a = unit?.assignment;
  const depot = s.ops?.depots.find((d) => d.id === unit?.depot)?.name ?? unit?.depot;
  const when = a ? (a.depart_by_min === 0 ? "Leave now" : `Leave by ${departBy(now, a.depart_by_min)}`) : "";
  const message = unit && a ? `Uri Watch recommends: ${unit.name} to ${a.county} County from ${depot}. Travel ${mins(a.eta_min)}. ${when}.${note.trim() ? ` Note: ${note.trim()}` : ""}` : "";

  if (!open) return null;

  const savePhone = (v: string) => {
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
    const to = phone.replace(/[^\d+]/g, "");
    window.location.href = `sms:${to}?&body=${encodeURIComponent(message)}`;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Text a crew">
      <button className="absolute inset-0 bg-black/45" aria-label="Close" onClick={s.closeComposer} tabIndex={-1} />
      <div className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[20px] border border-line bg-card p-5 shadow-2xl md:rounded-[20px]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Text a crew</p>
            <h2 className="display mt-1 text-[26px]">Assign and notify</h2>
          </div>
          <button className="btn btn-icon" onClick={s.closeComposer} aria-label="Close">
            <X />
          </button>
        </div>

        {!units.length ? (
          <p className="mt-4 text-[16px] muted">No crew is in the plan yet. Assign a crew to a county first, then come back to text them.</p>
        ) : (
          <>
            <label className="mt-4 block">
              <span className="eyebrow">Crew</span>
              <select
                ref={first}
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="mt-1.5 min-h-12 w-full rounded-[9px] border border-line2 bg-card px-3 text-[16px] font-medium"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.assignment?.county} · {mins(u.assignment?.eta_min ?? 0)}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="eyebrow">Note (optional)</span>
              <textarea
                value={note}
                maxLength={NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Gate code, who to call on arrival, route to avoid…"
                className="mt-1.5 w-full resize-none rounded-[9px] border border-line2 bg-card p-3 text-[16px]"
              />
              <span className="mono text-[11.5px] text-ink3">{note.length}/{NOTE_MAX}</span>
            </label>

            <label className="mt-2 block">
              <span className="eyebrow">Their phone (optional)</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => savePhone(e.target.value)}
                placeholder="Leave blank to pick a contact in Messages"
                className="mt-1.5 min-h-12 w-full rounded-[9px] border border-line2 bg-card px-3 text-[16px]"
                autoComplete="off"
              />
              <span className="text-[12px] text-ink3">Saved on this device only. Never sent to a server.</span>
            </label>

            <div className="mt-4">
              <p className="eyebrow">Message</p>
              <p className="mono mt-1.5 whitespace-pre-wrap rounded-xl border border-line bg-card2 p-3 text-[13px] leading-relaxed">{message}</p>
              <p className="mono mt-1 text-[11.5px] text-ink3">
                {message.length} characters · {segments(message.length)} {segments(message.length) === 1 ? "text" : "texts"}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-ink flex-1" onClick={openMessages} disabled={!message}>
                <MessageSquare /> Open in Messages
              </button>
              <button className="btn" onClick={async () => s.say((await copyText(message)) ? "Message copied" : "Could not copy")} disabled={!message}>
                <Copy /> Copy
              </button>
            </div>
            {tried && <p className="mt-2 text-[13px] text-ink2">If Messages did not open (computers often cannot), use Copy and paste it into your texting app.</p>}
            <p className="mt-3 text-[12.5px] text-ink3">Uri Watch only drafts this. You send it from your own phone.</p>
          </>
        )}
      </div>
    </div>
  );
}
