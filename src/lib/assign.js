import { jsPDF } from "jspdf";

// Which county does this action belong to? (matches the county name in the title/location text)
export function findCounty(action, counties) {
  const text = `${action.title} ${action.where}`;
  return counties.find(c => text.includes(c.name));
}

// Short auto-written crisis blurb. Backend/model can later replace this with generated text.
export function buildBlurb({ action, county, summary }) {
  const unit = action.kind === "crew" ? "crew-hours" : "staff-hours";
  const situation = county
    ? `${county.name} County risk is ${county.risk}/100 (${county.delta > 0 ? "+" : ""}${county.delta}% in the last 90 min), with ${county.exposure.toLocaleString()} people exposed and ${county.sites} critical sites. `
    : "";
  return (
    `${summary.status}. ${summary.note} ${situation}\n\n` +
    `Your task: ${action.title} (${action.where}). ` +
    `Expected to protect ${action.people.toLocaleString()} people and ${action.facilities} critical facilities, using ${action.cost} ${unit}.\n\n` +
    `Confirm receipt and report status when on site.`
  );
}

// Builds the assignment-order PDF (Times New Roman). Returns { doc, file, filename }.
export function makeAssignmentPdf({ action, county, summary, note, people }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 54, W = 504, BOTTOM = 735;
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const orderNo = `CATCH-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${String(action.id).padStart(3, "0")}`;
  const unit = action.kind === "crew" ? "crew-hours" : "staff-hours";
  let y = 54;

  const font = (style = "normal", size = 11) => doc.setFont("times", style).setFontSize(size);
  const gray = v => doc.setTextColor(v, v, v);
  const rule = (yy, weight = 0.6, shade = 120) => { doc.setDrawColor(shade).setLineWidth(weight).line(M, yy, M + W, yy); };
  const need = h => { if (y + h > BOTTOM) { doc.addPage(); y = 54; } };

  // wrapped paragraph(s); returns nothing, advances y
  const paragraph = (t, { size = 11.5, x = M, width = W, style = "normal", lh = 1.35, after = 6 } = {}) => {
    font(style, size);
    String(t).split("\n").forEach(line => {
      if (!line.trim()) { y += size * 0.6; return; }
      doc.splitTextToSize(line, width).forEach(l => { need(size * lh); doc.text(l, x, y); y += size * lh; });
    });
    y += after;
  };

  const heading = (num, title) => {
    need(40);
    y += 8;
    font("bold", 12); doc.setTextColor(0); doc.text(`${num}.  ${title.toUpperCase()}`, M, y);
    y += 5; rule(y, 0.8, 60); y += 16;
  };

  // key/value rows
  const kv = (label, value) => {
    font("bold", 11.5); doc.setTextColor(0);
    const lines = doc.splitTextToSize(String(value), W - 120);
    need(lines.length * 15);
    doc.text(label, M, y);
    font("normal", 11.5);
    lines.forEach(l => { doc.text(l, M + 120, y); y += 15; });
  };

  // simple table: cols = [{ label, x, width }]
  const table = (cols, rows) => {
    need(46);
    doc.setFillColor(238).rect(M, y - 12, W, 20, "F");
    font("bold", 10.5); doc.setTextColor(0);
    cols.forEach(c => doc.text(c.label.toUpperCase(), M + c.x, y + 1));
    y += 14;
    rows.forEach(r => {
      need(22);
      font("normal", 11.5);
      cols.forEach((c, i) => doc.text(doc.splitTextToSize(String(r[i]), c.width)[0], M + c.x, y + 6));
      y += 14; rule(y + 2, 0.4, 200); y += 10;
    });
    y += 4;
  };

  // ---------- letterhead ----------
  font("bold", 24); doc.setTextColor(0); doc.text("CATCH", M, y + 6);
  font("italic", 11); gray(90); doc.text("Grid Resilience Command", M, y + 22);
  font("bold", 17); doc.setTextColor(0); doc.text("ASSIGNMENT ORDER", M + W, y + 6, { align: "right" });
  font("normal", 11); gray(90); doc.text(`Order No. ${orderNo}`, M + W, y + 22, { align: "right" });
  y += 36; rule(y, 2, 0); y += 22;

  // ---------- order details ----------
  doc.setTextColor(0);
  kv("Issued:", now.toLocaleString([], { dateStyle: "long", timeStyle: "short" }));
  kv("Incident status:", summary.status);
  if (county) {
    kv("County:", `${county.name} County`);
    kv("Risk index:", `${county.risk} / 100  (${county.delta > 0 ? "+" : ""}${county.delta}% in the last 90 minutes)`);
    kv("People exposed:", `${county.exposure.toLocaleString()}  (${county.sites} critical sites)`);
  }
  kv("Task:", action.title);
  kv("Location:", action.where);
  y += 4;

  // ---------- 1. impact ----------
  heading(1, "Expected Impact");
  table(
    [{ label: "People protected", x: 8, width: 160 }, { label: "Critical facilities", x: 190, width: 140 }, { label: "Resources required", x: 350, width: 150 }],
    [[action.people.toLocaleString(), String(action.facilities), `${action.cost} ${unit}`]]
  );

  // ---------- 2. briefing ----------
  heading(2, "Briefing and Instructions");
  paragraph(note && note.trim() ? note.trim() : "No additional instructions.");

  // ---------- 3. personnel ----------
  heading(3, "Assigned Personnel");
  if (people.length) {
    table(
      [{ label: "Name", x: 8, width: 170 }, { label: "Role", x: 190, width: 190 }, { label: "Phone", x: 400, width: 100 }],
      people.map(p => [p.name, p.role, p.phone])
    );
  } else {
    paragraph("No personnel selected.", { style: "italic" });
  }

  const filename = `${orderNo}-${action.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  const file = new File([doc.output("blob")], filename, { type: "application/pdf" });
  return { doc, file, filename };
}

// Provider credentials stay on the API server. The PDF is sent as base64 JSON
// so the browser never needs direct access to the SMS provider or its secrets.
export async function sendAssignment({ action, people, note, file }) {
  const pdf = file ? {
    filename: file.name,
    content: await file.arrayBuffer().then(buffer => {
      let binary = "";
      new Uint8Array(buffer).forEach(byte => { binary += String.fromCharCode(byte); });
      return btoa(binary);
    }),
  } : null;
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${apiUrl}/api/assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actionId: action.id,
      actionTitle: action.title,
      people: people.map(({ id, name, role, phone }) => ({ id, name, role, phone })),
      note,
      pdf,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Send failed");
  return result;
}