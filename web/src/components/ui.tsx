import type { ReactNode } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { compact, n0, pct, type Confidence, type Move, type TierName } from "../api";

export function Lens({ n, name, question }: { n: string; name: string; question: string }) {
  return (
    <div className="lens">
      <b>{n}</b>
      <span>{name}</span>
      <span className="text-dim">· {question}</span>
    </div>
  );
}

export function Panel({
  title,
  note,
  children,
  className,
  action,
}: {
  title?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={clsx("panel", className)}>
      {(title || note || action) && (
        <div className="panel-head">
          {title && <h3 className="panel-title">{title}</h3>}
          <div className="ml-auto flex items-center gap-3">
            {note && <span className="panel-note">{note}</span>}
            {action}
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  sub,
  foot,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  foot?: ReactNode;
  tone?: "loss" | "gain" | "signal" | "data";
}) {
  const color =
    tone === "loss" ? "text-loss" : tone === "gain" ? "text-gain" : tone === "signal" ? "text-signal" : tone === "data" ? "text-data" : "";
  return (
    <div className="kpi">
      <p className="k-label">{label}</p>
      <p className={clsx("k-val", color)}>{value}</p>
      {sub && <p className="k-sub">{sub}</p>}
      {foot && <div className="k-foot">{foot}</div>}
    </div>
  );
}

export function TierChip({ tier }: { tier: TierName | "out" }) {
  if (tier === "clear") return <span className="chip">clear</span>;
  return <span className={clsx("chip", `chip--${tier}`)}>{tier === "out" ? "out now" : tier}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="panel py-14 text-center text-[13px] text-mut">{children}</div>;
}

export function MiniBars({ p6, p12, p24, max }: { p6: number; p12: number; p24: number; max: number }) {
  const h = (p: number) => `${Math.max(8, Math.min(100, (p / max) * 100))}%`;
  return (
    <span className="pbars" aria-label={`6 h ${pct(p6, 1)}, 12 h ${pct(p12, 1)}, 24 h ${pct(p24, 1)}`}>
      <i style={{ height: h(p6), opacity: 0.55 }} />
      <i style={{ height: h(p12), opacity: 0.78 }} />
      <i style={{ height: h(p24) }} />
    </span>
  );
}

export const KIND_LABEL: Record<Move["kind"], string> = {
  crews: "Crews",
  centers: "Centers",
  callers: "Outreach",
  statewide: "Statewide",
};

function confidenceText(c: Confidence): string {
  const base = c.base_rate != null ? ` versus ${pct(c.base_rate, 1)} for a typical county-hour` : "";
  return `In out-of-sample storms, ${pct(c.precision, 0)} of '${c.tier}'-tier counties went severe within 24 h${base} (${c.lift}x).`;
}

export type MoveState = "approved" | "dismissed" | undefined;

export function MoveCard({
  move,
  index,
  state,
  onDecide,
  compactView,
}: {
  move: Move;
  index: number;
  state: MoveState;
  onDecide?: (id: string, s: MoveState) => void;
  compactView?: boolean;
}) {
  return (
    <article className="move" data-urgency={move.urgency} data-state={state}>
      <div className="m-num">{index + 1}</div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={clsx("chip", move.urgency === "act" ? "chip--act" : move.urgency === "prepare" ? "chip--prepare" : "chip--watch")}>
            {move.urgency === "act" ? (move.window === "now" ? "act now" : "priority") : move.urgency}
          </span>
          <span className="chip">{KIND_LABEL[move.kind]}</span>
          <span className="chip">{move.window === "now" ? "now" : `window ${move.window}`}</span>
        </div>
        <h4 className="m-title">{move.title}</h4>
        {!compactView && <p className="m-detail">{move.detail}</p>}
        {!compactView && move.why.length > 0 && (
          <div className="m-why">
            {move.why.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
        )}
        <div className="m-meta">
          {move.impact && (
            <span className="m-stat">
              Exposed <b>{compact(move.impact.people)}</b>
              {move.impact.seniors > 0 && (
                <>
                  {" "}
                  · seniors <b>{compact(move.impact.seniors)}</b>
                </>
              )}
              {move.impact.share != null && (
                <>
                  {" "}
                  · <b>{pct(move.impact.share, 0)}</b> of crew need
                </>
              )}
            </span>
          )}
          {move.confidence && (
            <span className="m-stat" title={confidenceText(move.confidence)}>
              Track record <b>{pct(move.confidence.precision, 0)}</b> hit rate · <b>{move.confidence.lift}x</b> base
            </span>
          )}
          {onDecide && (
            <div className="m-actions">
              {state === "approved" ? (
                <button className="btn btn--sm btn--ghost" onClick={() => onDecide(move.id, undefined)}>
                  <Check /> Approved · undo
                </button>
              ) : (
                <>
                  <button className="btn btn--sm btn--ghost" onClick={() => onDecide(move.id, state === "dismissed" ? undefined : "dismissed")}>
                    <X /> {state === "dismissed" ? "Restore" : "Dismiss"}
                  </button>
                  <button className="btn btn--sm btn--primary" onClick={() => onDecide(move.id, "approved")}>
                    <Check /> Approve
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {move.confidence && !compactView && <p className="mt-2.5 text-[11.5px] leading-snug text-dim">{confidenceText(move.confidence)}</p>}
      </div>
    </article>
  );
}

export function DriverBar({ label, share, push }: { label: string; share: number; push: number }) {
  return (
    <div className="grid grid-cols-[132px_1fr_52px] items-center gap-3 py-1.5">
      <span className="text-[12.5px] text-mut">{label}</span>
      <div className={clsx("hbar", push < 0 && "gain")}>
        <i style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} />
      </div>
      <span className="mono text-right text-[11.5px] text-mut tnum">
        {push >= 0 ? "+" : ""}
        {push.toFixed(2)}
      </span>
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; ring?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={it.ring ? { background: "transparent", border: `2px solid ${it.color}` } : { background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export { n0 };
