import clsx from "clsx";
import { fmtTime, n0, pct, type HourEvent, type ReplayState } from "../api";

/** The "who first" list: counties not yet out, ranked by risk times the seniors who live there. */
export default function Outreach({ latest, state }: { latest: HourEvent | null; state: ReplayState | null }) {
  if (!latest) {
    return (
      <div className="panel py-12 text-center text-sm text-mut">
        Start a storm replay on the first tab. This list ranks the counties that need crews, warming centers and
        phone calls first.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="panel">
        <p className="eyebrow">{state?.title ?? "Replay"} · {fmtTime(latest.t)}</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Reach these counties first</h2>
        <p className="mt-1 max-w-3xl text-sm text-mut">
          Ranked by the model's risk times the number of residents aged 65 or older. These are counties on alert that
          have not lost power yet, so there is still time to pre-position crews, open warming centers and call
          medical-need customers. Seniors are counted from Census population estimates, not from any private registry.
        </p>
      </div>

      {latest.top.length === 0 ? (
        <div className="panel py-10 text-center text-sm text-mut">No county is on alert right now.</div>
      ) : (
        <ol className="space-y-3">
          {latest.top.map((c, i) => (
            <li key={c.fips} className="panel flex flex-wrap gap-x-6 gap-y-3">
              <div className="w-full sm:w-52">
                <p className="eyebrow">#{i + 1}</p>
                <p className="text-[17px] font-semibold tracking-tight">{c.name} County</p>
                <span
                  className={clsx(
                    "chip mt-1.5",
                    c.tier === "act" ? "text-loss" : c.tier === "prepare" ? "text-warn" : "text-info",
                  )}
                >
                  {c.tier}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-5 sm:w-auto">
                <Num label="Seniors at risk" value={n0(c.seniors_at_risk)} />
                <Num label="People at risk" value={n0(c.people_at_risk)} />
                <Num label="Outage risk" value={pct(c.risk, 1)} />
              </div>
              <div className="min-w-[16rem] flex-1">
                <p className="eyebrow mb-1">Why</p>
                {c.reasons.length ? (
                  <ul className="space-y-0.5 text-[13px]">
                    {c.reasons.map((r) => (
                      <li key={r.code}>{r.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-mut">Elevated across several small signals.</p>
                )}
                <p className="eyebrow mt-2">
                  {c.grid_share >= 0.5 ? "mostly statewide / grid signals" : "mostly local weather and outages"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Num({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="tabular text-[22px] font-semibold leading-tight tracking-tight">{value}</p>
    </div>
  );
}
