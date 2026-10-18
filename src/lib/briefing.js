import { jsPDF } from "jspdf";

export function buildSms(summary, counties, plan) {
  const top = counties.slice(0, 3).map(c => `${c.name} ${c.risk}`).join(", ");
  const acts = plan.slice(0, 3).map((a, i) => `${i + 1}) ${a.title}`).join(" ");
  // Keep under ~320 chars (2 SMS segments)
  return `CATCH ${new Date().toTimeString().slice(0,5)}: ${summary.status}. Risk: ${top}. Do: ${acts}`.slice(0, 320);
}

export function sendSms(text, number = "") {
  // Opens the phone's SMS app. Works on mobile; on desktop use the Copy button.
  window.location.href = `sms:${number}?&body=${encodeURIComponent(text)}`;
}

export function downloadBriefPdf(summary, counties, plan) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = 56;
  const line = (t, size = 11, bold = false, gap = 16) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.text(t, 48, y); y += gap;
  };
  line("CATCH · FIELD BRIEF", 18, true, 24);
  line(`${summary.status} — generated ${new Date().toLocaleString()}`, 10);
  line(`Model confidence ${summary.confidence}% · ${summary.note}`, 10, false, 28);

  line("COUNTY RISK", 12, true);
  counties.forEach((c, i) =>
    line(`${i + 1}. ${c.name}   risk ${c.risk} (${c.delta > 0 ? "+" : ""}${c.delta}%)   ${c.exposure.toLocaleString()} exposed   ${c.sites} critical sites`));
  y += 14;

  line("DISPATCH ORDER (harm prevented per crew-hour)", 12, true);
  plan.forEach((a, i) => {
    line(`${i === 0 ? "NOW" : "+" + i * 15 + "M"}  ${a.title}`, 11, true, 14);
    line(`      ${a.where} — ${a.people.toLocaleString()} people, ${a.facilities} facilities, ${a.cost} hrs`, 10, false, 20);
  });
  y += 10;
  line("Printed copy for use when cell/internet is down.", 9);
  doc.save("catch-field-brief.pdf");
}