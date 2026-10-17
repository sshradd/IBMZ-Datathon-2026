import { useEffect, useRef, useState } from "react";
import { Bell, PhoneCall, ShieldAlert, X } from "lucide-react";
import { money, type ScoredEvent } from "../api";

type Outcome = "called" | "cancelled" | "released";

/** What a 65+ customer (and their trusted contact) sees when a payment is held. */
export default function Guardian({ alerts }: { alerts: ScoredEvent[] }) {
  const held = alerts.filter((a) => a.decision.action === "hold" && a.txn.sender_age_band === "65+");
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [notify, setNotify] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const lastNotified = useRef<string | null>(null);

  // Pin the shown payment until the customer acts, so it doesn't change mid-read.
  const [current, setCurrent] = useState<ScoredEvent | null>(null);
  const next = held.find((a) => !outcomes[a.txn.id]);
  useEffect(() => {
    if (!current && next) setCurrent(next);
  }, [current, next]);

  useEffect(() => {
    if (!notify || !current || lastNotified.current === current.txn.id) return;
    lastNotified.current = current.txn.id;
    new Notification("Scam Stopper paused a payment", {
      body: `${money(current.txn.amount)} to ${current.txn.receiver_id}. ${current.decision.reasons[0]?.text ?? ""}`,
      icon: "/icon.svg",
    });
  }, [notify, current]);

  const enableNotify = async () => {
    if (typeof Notification === "undefined") return;
    setNotify((await Notification.requestPermission()) === "granted");
  };
  const resolve = (id: string, o: Outcome) => {
    setOutcomes((prev) => ({ ...prev, [id]: o }));
    setCurrent(null);
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="mx-auto w-full max-w-sm rounded-[2.5rem] border-[10px] border-line bg-card p-5">
        <p className="eyebrow mb-4 text-center">Your bank · Protected by Scam Stopper</p>
        {current ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-loss">
              <ShieldAlert className="h-6 w-6" />
              <h2 className="text-lg font-semibold">We paused this payment</h2>
            </div>
            <p className="tabular text-4xl font-semibold tracking-tight">{money(current.txn.amount)}</p>
            <p className="text-sm text-mut">to account {current.txn.receiver_id}</p>
            {current.txn.memo && <p className="text-sm text-mut">“{current.txn.memo}”</p>}
            <div className="rounded-card border border-loss/40 bg-loss/10 p-3 text-sm">
              <p className="eyebrow mb-1.5 text-loss">Why we stopped it</p>
              <ul className="list-disc space-y-1 pl-4 text-fg">
                {current.decision.reasons.map((r) => (
                  <li key={r.code}>{r.text}</li>
                ))}
              </ul>
            </div>
            <p className="text-sm text-mut">
              Scammers often pretend to be the IRS, a grandchild, or your bank. Real ones never ask for gift cards.
            </p>
            <button
              onClick={() => resolve(current.txn.id, "called")}
              className="btn btn-gain w-full justify-center py-3 font-semibold"
            >
              <PhoneCall className="h-5 w-5" /> Call my trusted contact
            </button>
            <button
              onClick={() => resolve(current.txn.id, "cancelled")}
              className="btn w-full justify-center py-3"
            >
              <X className="h-5 w-5" /> Cancel this payment
            </button>
            <button
              onClick={() => resolve(current.txn.id, "released")}
              className="w-full py-2 text-xs text-mut underline hover:text-fg"
            >
              I know this person. Send after a 24-hour wait.
            </button>
          </div>
        ) : (
          <p className="py-24 text-center text-sm text-mut">
            No paused payments. Start the stream on the Ops console.
          </p>
        )}
      </div>

      <div className="panel space-y-3 text-sm">
        <h2 className="eyebrow">Guardian view</h2>
        <p className="text-mut">
          Customers 65+ get stronger protection: medium-risk payments are held, not just sent to verify. Each hold
          explains itself in plain English and offers a call to a trusted contact.
        </p>
        <button onClick={enableNotify} className="btn">
          <Bell className="h-4 w-4" /> {notify ? "Trusted-contact alerts on" : "Turn on trusted-contact alerts"}
        </button>
        <p className="text-mut">
          {held.length} senior payments held in this session ·{" "}
          {Object.values(outcomes).filter((o) => o !== "released").length} stopped by the customer
        </p>
      </div>
    </div>
  );
}
