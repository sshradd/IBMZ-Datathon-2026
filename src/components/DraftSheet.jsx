import { Copy, MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "../lib/share.js";
import { useStore } from "../lib/store.jsx";

const segments = n => (n <= 160 ? 1 : Math.ceil(n / 153));

/** Any drafted text (a resupply request, a situation summary): add a note, open it in Messages or copy it. Nothing is sent by the app. */
export default function DraftSheet() {
  const s = useStore();
  const d = s.draft;
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [tried, setTried] = useState(false);
  const key = d?.key ?? "";

  useEffect(() => {
    if (!d) return;
    setNote("");
    setTried(false);
    try {
      setPhone(localStorage.getItem(`uw-phone-${key}`) ?? "");
    } catch {
      setPhone("");
    }
  }, [key, !!d]); // eslint-disable-line react-hooks/exhaustive-deps

  const { closeDraft } = s;
  useEffect(() => {
    if (!d) return;
    const esc = e => e.key === "Escape" && closeDraft();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [d, closeDraft]);

  if (!d) return null;
  const message = `${d.text}${note.trim() ? ` Note: ${note.trim()}` : ""}`;
  const savePhone = v => {
    setPhone(v);
    try {
      if (v) localStorage.setItem(`uw-phone-${key}`, v);
      else localStorage.removeItem(`uw-phone-${key}`);
    } catch {
      /* storage unavailable */
    }
  };
  const open = () => {
    setTried(true);
    window.location.href = `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(message)}`;
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={d.title}>
      <button className="modal-back" aria-label="Close" onClick={s.closeDraft} tabIndex={-1} />
      <div className="modal-card">
        <div className="modal-h">
          <div><p className="eyebrow">{d.eyebrow}</p><h2>{d.title}</h2></div>
          <button className="icon-btn" onClick={s.closeDraft} aria-label="Close"><X size={20} /></button>
        </div>
        <p className="mono xs msg-preview">{message}</p>
        <p className="mono faint xs">{message.length} characters · {segments(message.length)} {segments(message.length) === 1 ? "text" : "texts"}</p>
        <input className="input" value={note} maxLength={120} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)" />
        <input className="input" type="tel" inputMode="tel" value={phone} onChange={e => savePhone(e.target.value)} placeholder="Their phone (optional)" autoComplete="off" />
        <div className="btn-row">
          <button className="btn primary grow" onClick={open}><MessageSquare size={18} /> Open in Messages</button>
          <button className="btn" onClick={async () => s.say((await copyText(message)) ? "Text copied" : "Could not copy")}><Copy size={18} /> Copy</button>
        </div>
        {tried && <p className="muted sm mt-xs">If Messages did not open (computers often cannot), use Copy and paste it into your texting app.</p>}
        <p className="faint xs mt-s">Number stays on this device. The app only drafts; you send it.</p>
      </div>
    </div>
  );
}
