import { Check, Copy, MessageSquare, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Stepper from "./Stepper.jsx";
import { plural } from "../lib/decisions.js";
import { departBy, mins } from "../lib/format.js";
import { copyText } from "../lib/share.js";
import { useStore } from "../lib/store.jsx";

const CHIPS = ["Call on arrival", "Access code needed", "Bring a generator", "Care homes first"];
const NOTE_MAX = 120;
const phoneKey = depot => `uw-phone-${depot}`;
const segments = n => (n <= 160 ? 1 : Math.ceil(n / 153));
const crewsText = o =>
  [o.line && plural(o.line, "line crew"), o.shelter && plural(o.shelter, "shelter team"), o.outreach && plural(o.outreach, "outreach team")].filter(Boolean).join(", ");

/**
 * Assign, start to finish, in one popup: see where crews come from and how long they take,
 * add a note if you want, then one tap assigns them and opens the text in Messages.
 * The app only drafts: the responder sends the text from their own phone.
 */
export default function AssignSheet() {
  const s = useStore();
  const open = !!s.assign;
  const [orders, setOrders] = useState([]);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState("review");
  const [texted, setTexted] = useState(false);
  const init = useRef(null);
  init.current = s.assign;

  // set up once each time it opens; live data keeps arriving and must not reset what you typed
  useEffect(() => {
    if (!open) return;
    setOrders(init.current ?? []);
    setNote("");
    setStage("review");
    setTexted(false);
  }, [open]);

  const { closeAssign } = s;
  useEffect(() => {
    if (!open) return;
    const esc = e => e.key === "Escape" && closeAssign();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, closeAssign]);

  const now = s.latest?.as_of ?? s.latest?.t ?? "";
  const rows = useMemo(
    () =>
      orders.map(o => {
        const p = s.plan?.priorities.find(x => x.fips === o.fips);
        const name = p?.county ?? s.counties.find(c => c.fips === o.fips)?.name ?? "County";
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
    const parts = rows.map(r => {
      const detail = r.eta != null ? ` (${mins(r.eta)}${r.when ? `, ${r.when}` : ""})` : "";
      return `${r.depot ? `${r.depot} depot: ` : ""}send ${crewsText(r.o)} to ${r.name} County${detail}.`;
    });
    return `Relit: ${parts.join(" ")}${note.trim() ? ` Note: ${note.trim()}` : ""}`;
  }, [rows, note]);

  if (!open) return null;

  const single = orders.length === 1 ? orders[0] : null;
  const maxLine = s.plan?.totals.line.available ?? 40;
  const setLine = n => setOrders(os => os.map(o => ({ ...o, line: n })));
  const toggleChip = c =>
    setNote(n => {
      const has = n.includes(c);
      const next = has ? n.replace(c, "").replace(/\s*[.,]\s*(?=[.,]|$)/g, "").replace(/^[\s.,]+/, "").trim() : n.trim() ? `${n.trim().replace(/[.,]$/, "")}. ${c}` : c;
      return next.slice(0, NOTE_MAX);
    });
  const smsHref = () => `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;

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
    window.location.href = smsHref();
  };
  const total = orders.reduce((n, o) => n + o.line + o.shelter + o.outreach, 0);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Assign crews">
      <button className="modal-back" aria-label="Close" onClick={s.closeAssign} tabIndex={-1} />
      <div className="modal-card">
        {stage === "review" ? (
          <>
            <p className="eyebrow">Assign</p>
            <h2>{rows.length === 1 ? `${rows[0].name} County` : `${rows.length} counties`}</h2>

            <ul className="rows mt-s">
              {rows.map(r => (
                <li key={r.o.fips} className="as-row">
                  <div className="grow">
                    <p className="as-crew">{rows.length > 1 ? `${r.name} · ` : ""}{crewsText(r.o)}</p>
                    <p className="muted sm">
                      {r.depot ? `from ${r.depot}` : "nearest free crew"}
                      {r.eta != null && <> · <b className="ink">{mins(r.eta)}</b></>}
                      {r.when && <> · <span className="accent">{r.when}</span></>}
                    </p>
                  </div>
                  {single && r.o.line > 0 && single.shelter + single.outreach === 0 && <Stepper bare label="Line crews" value={single.line} max={maxLine} onChange={n => setLine(Math.max(1, n))} />}
                </li>
              ))}
            </ul>

            <div className="chips mt-s">
              {CHIPS.map(c => (
                <button key={c} className="pill" aria-pressed={note.includes(c)} onClick={() => toggleChip(c)}>{c}</button>
              ))}
            </div>
            <input className="input" value={note} maxLength={NOTE_MAX} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)" />
            <input className="input" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Their phone (optional)" autoComplete="off" />
            <p className="mono faint xs mt-s msg-preview">
              {message}
              <br />
              {message.length} characters · {segments(message.length)} {segments(message.length) === 1 ? "text" : "texts"} · number stays on this device
            </p>

            <button className="btn primary block-btn" onClick={assignAndText} disabled={!total}><MessageSquare size={18} /> Assign and text</button>
            <div className="btn-row">
              <button className="btn grow" onClick={commit} disabled={!total}>Assign only</button>
              <button className="btn grow" onClick={s.closeAssign}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <span className="ok"><Check size={22} /></span>
            <h2>{s.pendingUndo ? `Assigned ${plural(s.pendingUndo.count, "crew")}` : "Assigning…"}</h2>
            <p className="muted mt-xs">{texted ? "The text is ready in Messages. Press send there." : "Nothing was texted."}</p>
            <div className="btn-row">
              <button className="btn primary grow" onClick={() => { setTexted(true); window.location.href = smsHref(); }}><MessageSquare size={18} /> {texted ? "Open Messages again" : "Text them"}</button>
              <button className="btn" onClick={async () => s.say((await copyText(message)) ? "Text copied" : "Could not copy")}><Copy size={18} /> Copy</button>
            </div>
            <div className="btn-row">
              <button className="btn grow" onClick={() => { void s.undo(); s.closeAssign(); }}><Undo2 size={18} /> Undo</button>
              <button className="btn grow" onClick={s.closeAssign}>Done</button>
            </div>
            <p className="faint xs mt-s">If Messages did not open (computers often cannot), use Copy and paste it into your texting app.</p>
          </>
        )}
      </div>
    </div>
  );
}
