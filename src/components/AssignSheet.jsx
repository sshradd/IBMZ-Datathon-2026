import { Check, Copy, Eye, FileText, MessageSquare, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Stepper from "./Stepper.jsx";
import { buildAssignmentPdf } from "../lib/assignPdf.js";
import { plural } from "../lib/decisions.js";
import { clock, departBy, mins } from "../lib/format.js";
import { ROSTER } from "../lib/roster.js";
import { copyText } from "../lib/share.js";
import { useStore } from "../lib/store.jsx";

const CHIPS = ["Call on arrival", "Access code needed", "Bring a generator", "Care homes first"];
const NOTE_MAX = 120;
const phoneKey = depot => `uw-phone-${depot}`;
const segments = n => (n <= 160 ? 1 : Math.ceil(n / 153));
const crewsText = o =>
  [o.line && plural(o.line, "line crew"), o.shelter && plural(o.shelter, "shelter team"), o.outreach && plural(o.outreach, "outreach team")].filter(Boolean).join(", ");
const digits = p => p.replace(/[^\d+]/g, "");

function download(pdf) {
  const url = URL.createObjectURL(pdf.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pdf.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Assign, start to finish, in one popup: see where crews come from and how long they take, pick who is told,
 * add a note, and one tap assigns them and hands the text (and, if you like, a one-page assignment order PDF)
 * to Messages or the share sheet. The app only drafts: the responder sends it from their own phone.
 */
export default function AssignSheet() {
  const s = useStore();
  const open = !!s.assign;
  const [orders, setOrders] = useState([]);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [attach, setAttach] = useState(true);
  const [pdf, setPdf] = useState(null);
  const [stage, setStage] = useState("review");
  const [texted, setTexted] = useState(false);
  const init = useRef(null);
  init.current = s.assign;

  // set up once each time it opens; live data keeps arriving and must not reset what you typed
  useEffect(() => {
    if (!open) return;
    setOrders(init.current ?? []);
    setNote("");
    setPicked(new Set());
    setPdf(null);
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

  const people = ROSTER.filter(p => picked.has(p.id));
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
    return `Surge: ${parts.join(" ")}${note.trim() ? ` Note: ${note.trim()}` : ""}`;
  }, [rows, note]);

  // build the PDF ahead of the tap, so sharing it happens inside the tap
  const headline = `${s.latest?.describe?.severe_now ?? 0} counties with severe outages, ${s.latest?.tier_counts?.[3] ?? 0} rated act`;
  const pdfKey = JSON.stringify([open && stage === "review" && attach, rows.map(r => [r.name, r.o, r.eta, r.when]), note, [...picked]]);
  useEffect(() => {
    if (!open || stage !== "review" || !attach || !rows.length) return;
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const made = await buildAssignmentPdf({
          rows: rows.map(r => ({ name: r.name, crews: crewsText(r.o), depot: r.depot, eta: r.eta, when: r.when, status: r.p?.status })),
          people, note, headline, asOf: now ? clock(now) : "now",
        });
        if (!dead) setPdf(made);
      } catch {
        if (!dead) setPdf(null);
      }
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfKey]);

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
  const toggle = id =>
    setPicked(p => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const recipients = people.length ? people.map(p => digits(p.phone)).join(",") : digits(phone);
  const smsHref = () => `sms:${recipients}?&body=${encodeURIComponent(message)}`;
  const canShareFile = !!(attach && pdf?.file && navigator.canShare?.({ files: [pdf.file] }));

  const commit = () => {
    void s.dispatch(orders);
    setStage("done");
  };
  // one tap: assign, then give Messages the text (and the PDF through the share sheet where the device allows it)
  const handOff = () => {
    setTexted(true);
    if (canShareFile) {
      navigator.share({ files: [pdf.file], text: message, title: "Assignment order" }).catch(() => {});
    } else {
      if (attach && pdf) download(pdf);
      window.location.href = smsHref();
    }
  };
  const assignAndText = () => {
    commit();
    try {
      if (depotForPhone) phone ? localStorage.setItem(phoneKey(depotForPhone), phone) : localStorage.removeItem(phoneKey(depotForPhone));
    } catch {
      /* storage unavailable */
    }
    handOff();
  };
  const preview = () => {
    if (pdf) window.open(URL.createObjectURL(pdf.blob), "_blank");
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

            <div className="ap-head">
              <span className="eyebrow">Who is told</span>
              <button className="linkbtn" onClick={() => setPicked(picked.size === ROSTER.length ? new Set() : new Set(ROSTER.map(p => p.id)))}>
                {picked.size === ROSTER.length ? "Clear" : "Select all"}
              </button>
            </div>
            <div className="people-list">
              {ROSTER.map(p => (
                <label key={p.id} className={`person ${picked.has(p.id) ? "on" : ""}`}>
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span><b>{p.name}</b><small>{p.role}</small></span>
                </label>
              ))}
            </div>
            {!people.length && <input className="input" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Or type a phone number (optional)" autoComplete="off" />}
            <p className="faint xs mt-xs">Sample roster. Numbers stay on this device.</p>

            <div className="chips mt-s">
              {CHIPS.map(c => (
                <button key={c} className="pill" aria-pressed={note.includes(c)} onClick={() => toggleChip(c)}>{c}</button>
              ))}
            </div>
            <input className="input" value={note} maxLength={NOTE_MAX} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)" />

            <label className="person pdf-opt">
              <input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} />
              <span><b><FileText size={15} /> Attach one-page assignment order (PDF)</b><small>{pdf ? pdf.number : "Preparing…"} · lists the crews, drive times, note and who is told</small></span>
              <button className="btn sm" onClick={e => { e.preventDefault(); preview(); }} disabled={!pdf || !attach}><Eye size={16} /> Preview</button>
            </label>

            <p className="mono faint xs mt-s msg-preview">
              {message}
              <br />
              {message.length} characters · {segments(message.length)} {segments(message.length) === 1 ? "text" : "texts"}
            </p>

            <div className="modal-actions">
              <button className="btn primary block-btn" onClick={assignAndText} disabled={!total}>
                <MessageSquare size={18} /> Assign and text{people.length ? ` ${people.length} ${people.length === 1 ? "person" : "people"}` : ""}
              </button>
              <div className="btn-row">
                <button className="btn grow" onClick={commit} disabled={!total}>Assign only</button>
                <button className="btn grow" onClick={s.closeAssign}>Cancel</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <span className="ok"><Check size={22} /></span>
            <h2>{s.pendingUndo ? `Assigned ${plural(s.pendingUndo.count, "crew")}` : "Assigning…"}</h2>
            <p className="muted mt-xs">{texted ? "The text is ready. Press send there." : "Nothing was texted."}</p>
            <div className="btn-row">
              <button className="btn primary grow" onClick={handOff}><MessageSquare size={18} /> {texted ? "Open Messages again" : "Text them"}</button>
              <button className="btn" onClick={async () => s.say((await copyText(message)) ? "Text copied" : "Could not copy")}><Copy size={18} /> Copy</button>
            </div>
            <div className="btn-row">
              {attach && pdf && <button className="btn grow" onClick={() => download(pdf)}><FileText size={18} /> Save PDF</button>}
              <button className="btn grow" onClick={() => { void s.undo(); s.closeAssign(); }}><Undo2 size={18} /> Undo</button>
              <button className="btn grow" onClick={s.closeAssign}>Done</button>
            </div>
            <p className="faint xs mt-s">If Messages did not open (computers often cannot), use Copy, and Save PDF to attach the order yourself.</p>
          </>
        )}
      </div>
    </div>
  );
}
