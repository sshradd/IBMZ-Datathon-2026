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

// Builds the one-page assignment PDF. Returns { doc, file, filename }.
export function makeAssignmentPdf({ action, county, summary, note, people }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 516; // text width
  let y = 56;
  const gap = n => { y += n; if (y > 730) { doc.addPage(); y = 56; } };
  const text = (t, size = 11, bold = false, after = 6) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.splitTextToSize(String(t), W).forEach(l => { doc.text(l, 48, y); gap(size + 4); });
    gap(after);
  };

  text("CATCH · ASSIGNMENT ORDER", 18, true, 4);
  text(`Issued ${new Date().toLocaleString()} · ${summary.status}`, 10, false, 14);

  text("TASK", 12, true, 2);
  text(action.title, 14, true, 2);
  text(action.where, 11, false, 12);

  text("SITUATION", 12, true, 2);
  text(summary.note, 11, false, 2);
  if (county) text(`${county.name} County: risk ${county.risk}/100 (${county.delta > 0 ? "+" : ""}${county.delta}% in 90 min), ${county.exposure.toLocaleString()} people exposed, ${county.sites} critical sites.`, 11, false, 12);

  text("IMPACT", 12, true, 2);
  text(`${action.people.toLocaleString()} people · ${action.facilities} facilities · ${action.cost} ${action.kind === "crew" ? "crew-hours" : "staff-hours"}`, 11, false, 12);

  text("INSTRUCTIONS", 12, true, 2);
  text(note || "(none)", 11, false, 12);

  text("ASSIGNED TO", 12, true, 2);
  if (people.length) people.forEach(p => text(`${p.name} — ${p.role} — ${p.phone}`, 11, false, 0));
  else text("(no one selected yet)", 11, false, 0);

  const filename = `assignment-${action.id}-${action.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  const file = new File([doc.output("blob")], filename, { type: "application/pdf" });
  return { doc, file, filename };
}

// Sends one assignment to several people. Demo version: waits 0.7s and logs.
// Backend team: swap the demo lines for the fetch() below.
//   POST {VITE_API_URL}/api/assignments   (multipart/form-data)
//   fields: actionId, actionTitle, people (JSON array of {id,name,role,phone}), note, file (PDF, optional)
export async function sendAssignment({ action, people, note, file }) {
  const form = new FormData();
  form.append("actionId", action.id);
  form.append("actionTitle", action.title);
  form.append("people", JSON.stringify(people));
  form.append("note", note);
  if (file) form.append("file", file);

  // const res = await fetch(`${import.meta.env.VITE_API_URL}/api/assignments`, { method: "POST", body: form });
  // if (!res.ok) throw new Error("Send failed");

  await new Promise(r => setTimeout(r, 700)); // demo only
  console.log("Assignment sent (demo):", { to: people.map(p => p.name), action: action.title, note, pdf: file?.name });
  return true;
}