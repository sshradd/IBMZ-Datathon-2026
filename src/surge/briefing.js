import { jsPDF } from "jspdf";

export function buildSms(summary, counties, actions) {
  const top = counties.slice(0, 3).map(c => `${c.name} ${c.risk}`).join(", ");
  const acts = actions.slice(0, 3).map((a, i) => `${i + 1}) ${a.title}`).join(" ");
  // Keep under ~320 chars (2 SMS segments)
  return `SURGE ${new Date().toTimeString().slice(0, 5)}: ${summary.status}. Risk: ${top}. Do: ${acts}`.slice(0, 320);
}

export function sendSms(text, number = "") {
  // Opens the phone's SMS app. Works on mobile; on desktop use the Copy button.
  window.location.href = `sms:${number}?&body=${encodeURIComponent(text)}`;
}

export function downloadBriefPdf(summary, counties, actions) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = 56;
  const line = (t, size = 11, bold = false, gap = 16) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.splitTextToSize(t, 516).forEach(l => { doc.text(l, 48, y); y += gap; });
  };
  line("SURGE · FIELD BRIEF", 18, true, 24);
  line(`${summary.status} - generated ${new Date().toLocaleString()}`, 10);
  line(`${summary.warned != null ? `Warned before the outage: ${summary.warned}% of county outages. ` : ""}${summary.note}`, 10, false, 28);

  line("COUNTY RISK (index 0-100, from the model's alert lines)", 12, true);
  counties.forEach((c, i) =>
    line(`${i + 1}. ${c.name}   risk ${c.risk} (${c.delta > 0 ? "+" : ""}${c.delta} pts)   ${c.exposure.toLocaleString()} exposed   ${c.seniors.toLocaleString()} aged 65+`));
  y += 14;

  line("RECOMMENDED ASSIGNMENTS (ordered by the model's risk ranking)", 12, true);
  actions.forEach((a, i) => {
    line(`${i + 1}  ${a.title}`, 11, true, 14);
    line(`      ${a.where} - ${a.people.toLocaleString()} people exposed, ${a.seniors.toLocaleString()} aged 65+`, 10, false, 20);
  });
  y += 10;
  line("Printed copy for use when cell/internet is down. Recommendations only.", 9);
  doc.save("surge-field-brief.pdf");
}
