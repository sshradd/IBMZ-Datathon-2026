// One-page assignment order, built in the browser. jsPDF is loaded only when a PDF is first needed.
let counter = 0;

function orderNumber() {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  try {
    const key = `uw-order-${day}`;
    counter = Number(localStorage.getItem(key) ?? 0);
    return { day, key };
  } catch {
    return { day, key: null };
  }
}

/** Build the order. rows: [{ name, crews, depot, eta, when, status }], people: roster entries, note: free text. */
export async function buildAssignmentPdf({ rows, people, note, headline, asOf, commit = false }) {
  const { jsPDF } = await import("jspdf");
  const { day, key } = orderNumber();
  const n = counter + 1;
  if (commit && key) {
    try {
      localStorage.setItem(key, String(n));
    } catch {
      /* storage unavailable */
    }
  }
  const no = `SURGE-${day}-${String(n).padStart(3, "0")}`;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 516;
  let y = 56;
  const gap = v => {
    y += v;
    if (y > 740) {
      doc.addPage();
      y = 56;
    }
  };
  const text = (t, size = 11, bold = false, after = 6, x = 48, width = W) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.splitTextToSize(String(t), width).forEach(l => {
      doc.text(l, x, y);
      gap(size + 4);
    });
    gap(after);
  };
  const rule = () => {
    doc.setDrawColor(40).setLineWidth(1).line(48, y - 6, 564, y - 6);
    gap(14);
  };

  doc.setFont("helvetica", "bold").setFontSize(22).text("SURGE", 48, y);
  doc.setFontSize(16).text("ASSIGNMENT ORDER", 564, y, { align: "right" });
  gap(18);
  doc.setFont("helvetica", "italic").setFontSize(10).text("Grid Resilience Command", 48, y);
  doc.setFont("helvetica", "normal").text(`Order No. ${no}`, 564, y, { align: "right" });
  gap(10);
  rule();

  text(`Issued: ${new Date().toLocaleString()}`, 11, false, 0);
  text(`Data as of: ${asOf}`, 11, false, 0);
  text(`Situation: ${headline}`, 11, false, 10);

  text("1. ASSIGNMENT", 12, true, 2);
  rule();
  rows.forEach(r => {
    text(`${r.name} County: ${r.crews}`, 12, true, 0);
    text(`${r.depot ? `From ${r.depot}. ` : ""}${r.eta != null ? `Travel about ${r.eta} min. ` : ""}${r.when ? r.when.charAt(0).toUpperCase() + r.when.slice(1) + "." : ""}${r.status ? ` County status: ${r.status}.` : ""}`, 11, false, 8);
  });

  text("2. INSTRUCTIONS", 12, true, 2);
  rule();
  text(note?.trim() ? note.trim() : "Proceed as recommended. Confirm receipt and report status on arrival.", 11, false, 10);

  text("3. ASSIGNED PERSONNEL", 12, true, 2);
  rule();
  if (people.length) people.forEach(p => text(`${p.name}   ${p.role}   ${p.phone}`, 11, false, 0));
  else text("No one selected yet.", 11, false, 0);
  gap(14);

  doc.setTextColor(90);
  text("Recommendations only. This order was drafted by Surge; the responder confirms it and sends it. Crews, depots and phone numbers are sample data unless edited. Travel times are planning estimates, not routing.", 9, false, 0);
  doc.setTextColor(0);

  const filename = `${no}.pdf`;
  const blob = doc.output("blob");
  return { blob, file: new File([blob], filename, { type: "application/pdf" }), filename, number: no };
}
