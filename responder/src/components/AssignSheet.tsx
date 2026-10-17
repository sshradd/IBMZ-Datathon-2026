"use client";

import { Check, Copy, MessageSquare, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Stepper from "@/components/Stepper";
import { plural } from "@/lib/decisions";
import { departBy, mins } from "@/lib/format";
import { copyText } from "@/lib/share";
import { useStore } from "@/lib/store";
import type { Order } from "@/lib/types";

const CHIPS = ["Call on arrival", "Access code needed", "Bring a generator", "Care homes first"];
const NOTE_MAX = 120;
const phoneKey = (depot: string) => `uw-phone-${depot}`;
const segments = (n: number) => (n <= 160 ? 1 : Math.ceil(n / 153));

const crewsText = (o: Order) =>
  [o.line && plural(o.line, "line crew"), o.shelter && plural(o.shelter, "shelter team"), o.outreach && plural(o.outreach, "outreach team")].filter(Boolean).join(", ");

/**
 * Assign, start to finish, in one popup: see where crews come from and how long they take,
 * add a note if you want, then one tap assigns them and opens the text in Messages.
 * The app only drafts: the responder sends the text from their own phone.
 */
export default function AssignSheet() {
  const s = useStore();
  const open = !!s.assign;
  const [orders, setOrders] = useState<Order[]>([]);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"review" | "done">("review");
  const [texted, setTexted] = useState(false);
  const init = useRef<Order[] | null>(null);
  init.current = s.assign;

  // set up once each time it opens; live data keeps arriving and must not reset what you typed
  useEffect(() => {
    if (!open) return;
    setOrders(init.current ?? []);
    setNote("");
    setStage("review");
    setTexted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { closeAssign } = s;
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeAssign();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, closeAssign]);

  const now = s.latest?.as_of ?? s.latest?.t ?? "";
  const rows = useMemo(
    () =>
      orders.map((o) => {
        const p = s.plan?.priorities.find((x) => x.fips === o.fips);
        const name = p?.county ?? s.counties.find((c) => c.fips === o.fips)?.name ?? "County";
        const when = p ? (p.depart_by_min === 0 ? "leave now" : `leave by ${departBy(now, p.depart_by_min)}`) : "";
        return { o, p, name, depot: p?.nearest?.depot, eta: p?.nearest?.eta_min, when };
      }),
    [orders, s.plan, s.counties, now],
  );

  const depotForPhone = rows[0]?.depot ?? "";
  useEffect(() => {
    if (!open || !depotForPhone) return;
    try {
      setPhone(localStorage.getItem(phoneKey(depotForPhone)) ?? "");
    } catch {
      setPhone("");
    }
  }, [open, depotForPhone]);

  const message = useMemo(() => {
    const parts = rows.map((r) => {
      const detail = r.eta != null ? ` (${mins(r.eta)}${r.when ? `, ${r.when}` : ""})` : "";
      return `${r.depot ? `${r.depot} depot: ` : ""}send ${crewsText(r.o)} to ${r.name} County${detail}.`;
    });
    return `Uri Watch: ${parts.join(" ")}${note.trim() ? ` Note: ${note.trim()}` : ""}`;
  }, [rows, note]);

  if (!open) return null;

  const single = orders.length === 1 ? orders[0] : null;
  const maxLine = s.plan?.totals.line.available ?? 40;
  const setLine = (n: number) => setOrders((os) => os.map((o) => ({ ...o, line: n })));
  const toggleChip = (c: string) =>
    setNote((n) => {
      const has = n.includes(c);
      const next = has ? n.replace(c, "").replace(/\s*[.,]\s*(?=[.,]|$)/g, "").replace(/^[\s.,]+/, "").trim() : n.trim() ? `${n.trim().replace(/[.,]$/, "")}. ${c}` : c;
      return next.slice(0, NOTE_MAX);
    });

  const commit = () => {
    void s.dispatch(orders);
    setStage("done");
  };
  const assignAndText = () => {
    commit();
    try {
      if (depotForPhone) phone ? localStorage.setItem(phoneKey(depotForPhone), phone) : localStorage.removeItem(phoneKey(depotForPhone));
    } catch {
      /* storage unavailable */
    }
    setTexted(true);
    // same tap as the assign, so the phone allows it to open Messages
    window.location.href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;
  };
  const total = orders.reduce((n, o) => n + o.line + o.shelter + o.outreach, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label="Assign crews">
      <button className="absolute inset-0 bg-black/45" aria-label="Close" onClick={s.closeAssign} tabIndex={-1} />
      <div className="relative max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-[20px] border border-line bg-card p-5 shadow-2xl md:rounded-[20px]">
        {stage === "review" ? (
          <>
            <p className="eyebrow">Assign</p>
            <h2 className="display mt-1 text-[28px]">{rows.length === 1 ? `${rows[0].name} County` : `${rows.length} counties`}</h2>

            <ul className="rows mt-3">
              {rows.map((r) => (
                <li key={r.o.fips} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[17px] font-semibold tracking-tight">{rows.length > 1 ? `${r.name} · ` : ""}{crewsText(r.o)}</p>
                      <p className="text-[14.5px] text-ink2">
                        {r.depot ? `from ${r.depot}` : "nearest free crew"}
                        {r.eta != null && <> · <b className="text-ink">{mins(r.eta)}</b></>}
                        {r.when && <> · <span className="accent text-[18px]">{r.when}</span></>}
                      </p>
                    </div>
                    {single && r.o.line > 0 && single.shelter + single.outreach === 0 && <Stepper bare label="Line crews" value={single.line} max={maxLine} onChange={(n) => setLine(Math.max(1, n))} />}
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <button key={c} className="pill !min-h-9" aria-pressed={note.includes(c)} onClick={() => toggleChip(c)} style={note.includes(c) ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" } : undefined}>
                  {c}
                </button>
              ))}
            </div>
            <input
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (optional)"
              className="mt-2 min-h-12 w-full rounded-[9px] border border-line2 bg-card px-3 text-[16px]"
            />
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Their phone (optional)"
              className="mt-2 min-h-12 w-full rounded-[9px] border border-line2 bg-card px-3 text-[16px]"
              autoComplete="off"
            />
            <p className="mono mt-2 text-[11.5px] leading-snug text-ink3">
              {message} <br />
              {message.length} characters · {segments(message.length)} {segments(message.length) === 1 ? "text" : "texts"} · number stays on this device
            </p>

            <button className="btn btn-ink mt-4 w-full" onClick={assignAndText} disabled={!total}>
              <MessageSquare /> Assign and text
            </button>
            <div className="mt-2 flex gap-2">
              <button className="btn flex-1" onClick={commit} disabled={!total}>
                Assign only
              </button>
              <button className="btn flex-1" onClick={s.closeAssign}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="grid h-11 w-11 place-items-center rounded-full bg-green text-bg">
              <Check />
            </span>
            <h2 className="display mt-3 text-[28px]">{s.pendingUndo ? `Assigned ${plural(s.pendingUndo.count, "crew")}` : "Assigning…"}</h2>
            <p className="mt-1 text-[15px] muted">{texted ? "The text is ready in Messages. Press send there." : "Nothing was texted."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="btn btn-ink flex-1"
                onClick={() => {
                  setTexted(true);
                  window.location.href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;
                }}
              >
                <MessageSquare /> {texted ? "Open Messages again" : "Text them"}
              </button>
              <button className="btn" onClick={async () => s.say((await copyText(message)) ? "Text copied" : "Could not copy")}>
                <Copy /> Copy
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                className="btn flex-1"
                onClick={() => {
                  void s.undo();
                  s.closeAssign();
                }}
              >
                <Undo2 /> Undo
              </button>
              <button className="btn flex-1" onClick={s.closeAssign}>
                Done
              </button>
            </div>
            <p className="mt-3 text-[12.5px] text-ink3">If Messages did not open (computers often cannot), use Copy and paste it into your texting app.</p>
          </>
        )}
      </div>
    </div>
  );
}
