import { jsPDF } from "jspdf";

// Which county does this action belong to? (the action carries it)
export function findCounty(action, counties) {
  return counties.find(c => c.fips === action.fips) ?? counties.find(c => `${action.title}`.includes(c.name));
}

// Short auto-written briefing. Everything in it comes from the live feed.
export function buildBlurb({ action, county, summary }) {
  const situation = county
    ? `${county.name} County risk index is ${county.risk}/100 (${county.delta > 0 ? "+" : ""}${county.delta} points in the last 3 hours), with about ${county.exposure.toLocaleString()} people exposed${county.seniors ? `, ${county.seniors.toLocaleString()} of them aged 65 or older` : ""}. `
    : "";
  return (
    `${summary.status}. ${summary.note} ${situation}\n\n` +
    `Your task: ${action.title} (${action.where}).${action.leave === 0 ? " Leave now." : ""}\n\n` +
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

  text("SURGE · ASSIGNMENT ORDER", 18, true, 4);
  text(`Issued ${new Date().toLocaleString()} · ${summary.status}`, 10, false, 14);

  text("TASK", 12, true, 2);
  text(action.title, 14, true, 2);
  text(action.where, 11, false, 12);

  text("SITUATION", 12, true, 2);
  text(summary.note, 11, false, 2);
  if (county) text(`${county.name} County: risk index ${county.risk}/100 (${county.delta > 0 ? "+" : ""}${county.delta} points in 3 hours), about ${county.exposure.toLocaleString()} people exposed.`, 11, false, 12);

  text("IMPACT", 12, true, 2);
  text(`${action.people.toLocaleString()} people exposed · ${action.seniors.toLocaleString()} aged 65+ · ${action.eta != null ? `${action.eta} min drive` : "no crew free"}`, 11, false, 12);

  text("INSTRUCTIONS", 12, true, 2);
  text(note || "(none)", 11, false, 12);

  text("ASSIGNED TO", 12, true, 2);
  if (people.length) people.forEach(p => text(`${p.name} - ${p.role} - ${p.phone}`, 11, false, 0));
  else text("(no one selected yet)", 11, false, 0);
  gap(10);
  doc.setTextColor(110);
  text("Recommendation drafted by Surge. Crews, depots and phone numbers are sample data unless edited.", 9, false, 0);

  const filename = `assignment-${action.id}-${action.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  const file = new File([doc.output("blob")], filename, { type: "application/pdf" });
  return { doc, file, filename };
}

const digits = p => String(p).replace(/[\s().-]/g, "");

/**
 * Sends one assignment to several people. If an SMS server answers (POST /api/assignments), it sends from there.
 * With no server (the recorded demo, GitHub Pages, a laptop with only the model API), it drafts the text in Messages
 * through the share sheet or an sms: link and saves the PDF, and says so. Returns { mode: "sent" | "drafted" }.
 */
export async function sendAssignment({ action, people, note, file }) {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  try {
    const pdf = file ? {
      filename: file.name,
      content: await file.arrayBuffer().then(buffer => {
        let binary = "";
        new Uint8Array(buffer).forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
      }),
    } : null;
    const response = await fetch(`${apiUrl}/api/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: action.id, actionTitle: action.title, people: people.map(({ id, name, role, phone }) => ({ id, name, role, phone })), note, pdf }),
    });
    const type = response.headers.get("content-type") ?? "";
    if (response.ok && type.includes("json")) return { mode: "sent", ...(await response.json().catch(() => ({}))) };
    if (type.includes("json") && response.status !== 404 && response.status !== 405) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Send failed");
    }
  } catch (e) {
    if (e instanceof TypeError === false && e.message && e.message !== "Failed to fetch") throw e;
  }
  // no SMS server: draft it on this device
  const to = people.map(p => digits(p.phone)).join(",");
  if (file && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text: note, title: "Assignment order" }).catch(() => {});
  } else {
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    window.location.href = `sms:${to}?&body=${encodeURIComponent(note)}`;
  }
  return { mode: "drafted" };
}
