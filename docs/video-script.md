# Demo video script (3:00 max)

The required video must cover: the problem, supporting data, the solution, and how it uses IBM Z (tech stack, LinuxONE instance, model). Fill the `[ ]` numbers from your own runs.

| Time | Show | Say |
|---|---|---|
| 0:00–0:25 | Title slide, then a news headline or stat about elder scams | "Scammers trick people, often seniors, into sending instant payments. Instant means irreversible: once it settles, the money is gone, usually into a mule account." |
| 0:25–0:45 | Architecture diagram | "Scam Stopper sits in the payment path and decides before settlement. It looks at both ends: is this sender acting unlike themselves, and is this receiver behaving like a mule?" |
| 0:45–1:00 | Data slide | "We built a seeded simulator of 2,000 customers, including seniors, merchants and mule accounts, with five real scam patterns. No real customer data." |
| 1:00–1:45 | Ops console live on LinuxONE (badge visible) | Start the stream. Point at an alert: "Held: $400, gift-card memo, third payment in ten minutes, to a 5-day-old account." Point at the mule-ring radar: "This new account got money from 13 people today." |
| 1:45–2:10 | Guardian view | "The customer sees why, in plain English, and can call a trusted contact. Customers 65+ get stronger protection." |
| 2:10–2:40 | SSH terminal: `lscpu`, then benchmark output; Benchmark tab | "This is running on IBM LinuxONE, s390x. [ ] payments per second, p99 decision latency [ ] ms, on [ ] cores. The scorer is pure Python with JSON weights, so it ran on Z without changes." |
| 2:40–3:00 | Results slide | "Precision [ ], recall [ ], false-positive rate [ ] on held-out data. Next: real bank data, a graph model for mule rings, and on-chip inference." |

Tips:
- Record the LinuxONE part first, while the server is reachable.
- Keep a backup recording of the dashboard in case the live demo fails.
- Only say "on-chip AI acceleration" if `lscpu` and IBM docs confirm your box has it.
