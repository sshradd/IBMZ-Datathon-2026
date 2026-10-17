# Demo video script (3:00 max)

The required video must cover: the problem, supporting data, the solution, and how it uses IBM Z (tech stack, LinuxONE instance, model). Fill the `[ ]` numbers from your own LinuxONE runs.

| Time | Show | Say |
|---|---|---|
| 0:00-0:25 | Title slide, then a photo or headline from Winter Storm Uri | "February 2021. Four million Texas customers lost power, and the people who needed help most were the last anyone reached. Could we have seen the outages coming, and known who to call first?" |
| 0:25-0:45 | Architecture diagram | "Uri Watch scores all 254 Texas counties every hour from public data: utility outage reports, ERCOT grid telemetry and weather. It runs on an IBM LinuxONE instance." |
| 0:45-1:00 | Data slide | "Five years of real data: about 11 million county-hours from DOE EAGLE-I, ERCOT demand and generation from EIA, and weather. We trained on 2019 to November 2022 and removed February 2021 entirely." |
| 1:00-1:50 | Storm replay tab on LinuxONE (badge visible), Uri, "Out of sample" label on screen | Start the replay. "The model has never seen this storm. Watch counties light up before they lose power." Point at the scorecard: "396 counties hit severe outages. 97 percent had an alert first. Median lead [4] hours, up to [25]." Click a county: "Every score has plain-English reasons." |
| 1:50-2:15 | "Who first" tab | "Warnings are only useful if someone acts. We rank counties that are on alert but not out yet by risk times the seniors who live there: where to pre-position crews, open warming centers, call medical-need customers." |
| 2:15-2:40 | SSH terminal: `lscpu`, then benchmark output; Benchmark tab | "This is IBM LinuxONE, s390x. [ ] county scores per second on one core, [ ] on [ ] cores. A storm hits every county in the same hours, so sustained throughput and isolation for utility data matter. The scorer is pure Python with JSON weights, so it ran on Z unchanged." |
| 2:40-3:00 | Results slide (the table from the README) | "Out of sample: Uri 97 percent warned, ice storm 97 percent. We also show where we fail: the heat dome, 41 percent. Next: NWS forecasts, radar, and real medical-need registries." |

Tips:
- Record the LinuxONE part first, while the server is reachable.
- Keep a backup recording of the dashboard in case the live demo fails.
- Show the heat dome failure on screen or in the table. Honest limits build credibility with judges.
- Only say "on-chip AI acceleration" if `lscpu` and IBM docs confirm your box has it.
- Say clearly that senior counts are Census estimates, not private records.
