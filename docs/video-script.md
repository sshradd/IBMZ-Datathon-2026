# Demo video script (3:00 max)

The required video must cover: the problem, supporting data, the solution, and how it uses IBM Z (tech stack, LinuxONE instance, model). Fill the `[ ]` numbers from your own LinuxONE runs.

| Time | Show | Say |
|---|---|---|
| 0:00-0:25 | Title slide, then a photo or headline from Winter Storm Uri | "February 2021. Four million Texas customers lost power, and the people who needed help most were the last anyone reached. Could we have seen the outages coming, and known who to call first?" |
| 0:25-0:45 | Architecture diagram | "Uri Watch scores all 254 Texas counties every hour from public data: utility outage reports, ERCOT grid telemetry and weather. It runs on an IBM LinuxONE instance." |
| 0:45-1:00 | Data slide | "Five years of real data: about 11 million county-hours from DOE EAGLE-I, ERCOT demand and generation from EIA, and weather. We trained on 2019 to November 2022 and removed February 2021 entirely." |
| 1:00-1:50 | Storm replay tab on LinuxONE (badge visible), Uri, "Out of sample" label on screen | Start the replay. "The model has never seen this storm. Watch counties light up before they lose power." Point at the brief and the recommended moves: "Two days before the load shed it names Harris, Dallas and Tarrant and says where to send crews." Point at the scorecard: "396 counties hit severe outages. 82 percent had an alert first. Median lead 6 hours, up to 25." |
| 1:50-2:15 | Responder console on a phone: Outages, then Teams | "Warnings are only useful if someone acts. The responder console turns the forecast into one decision at a time. The decision panel says which county, how far the nearest free crew is and when to leave. The responder chooses how many crews to include, because the forecast only knows weather and outages. One tap adds them to a plan, with ten seconds to undo, and the plan copies or shares into whatever dispatch system the team already uses. We recommend; we never dispatch. Resources tracks the responder's own inventory against targets they set." |
| 2:15-2:40 | SSH terminal: `lscpu`, then benchmark output; Benchmark tab | "This is IBM LinuxONE, s390x. [ ] county scores per second on one core, [ ] on [ ] cores. A storm hits every county in the same hours, so sustained throughput and isolation for utility data matter. The scorer is pure Python with JSON weights, so it ran on Z unchanged." |
| 2:40-3:00 | Results slide (the table from the README) | "Out of sample: Uri 82 percent warned, the ice storm 94 percent, and top-tier alerts come true 36 percent of the time against a 2 percent base rate. We also show where we fail: the heat dome, 35 percent, and a model that under-sizes a statewide event. Next: NWS forecasts, radar, and real medical-need registries." |

Tips:
- Record the LinuxONE part first, while the server is reachable.
- Keep a backup recording of the dashboard in case the live demo fails.
- Show the heat dome failure on screen or in the table. Honest limits build credibility with judges.
- Only say "on-chip AI acceleration" if `lscpu` and IBM docs confirm your box has it.
- Say clearly that senior counts are Census estimates, not private records.
