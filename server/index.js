import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.API_PORT || 8787);
const maxBodyBytes = 10 * 1024 * 1024;
const pdfs = new Map();

// Trim env values so stray spaces or newlines don't break auth.
const env = name => (process.env[name] || "").trim();

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Request body must be valid JSON.")); }
    });
    req.on("error", reject);
  });
}

function normalizePhone(value) {
  const phone = String(value || "").trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  return /^\+?[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function providerError(error) {
  if (error?.status === 401) {
    const hint = error.authMethod === "api key"
      ? "Check TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET."
      : "Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.";
    return `Twilio rejected the credentials (using ${error.authMethod || "unknown auth"}). ${hint}`;
  }
  if (error?.body?.message) return `Twilio rejected the SMS: ${error.body.message}`;
  if (error?.message) return error.message;
  return "Could not send assignment messages.";
}

function twilioConfig() {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const from = env("TWILIO_FROM");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const apiKeySid = env("TWILIO_API_KEY_SID");
  const apiKeySecret = env("TWILIO_API_KEY_SECRET");

  const hasAuthToken = Boolean(authToken);
  const hasApiKey = Boolean(apiKeySid && apiKeySecret);

  if (!accountSid || !from || (!hasAuthToken && !hasApiKey)) {
    throw new Error("Set TWILIO_ACCOUNT_SID, TWILIO_FROM, and either TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID plus TWILIO_API_KEY_SECRET.");
  }

  // Auth token wins when present; API key is the fallback.
  const useApiKey = !hasAuthToken && hasApiKey;
  const config = {
    authMethod: useApiKey ? "api key" : "auth token",
    accountSid,
    username: useApiKey ? apiKeySid : accountSid,
    password: useApiKey ? apiKeySecret : authToken,
    from,
  };

  // Safe to log: only the first two characters of the username (expect AC or SK).
  console.log(`Twilio auth: ${config.authMethod} | user prefix: ${config.username.slice(0, 2)} | password length: ${config.password.length}`);
  return config;
}

async function sendTwilioSms({ to, from, text }, config) {
  // Trial accounts only accept Twilio's predefined template names as the body.
  // Set TWILIO_TRIAL_TEMPLATE (e.g. sms_account_alerts) while testing; remove after upgrading.
  const trialTemplate = env("TWILIO_TRIAL_TEMPLATE");
  const params = new URLSearchParams({ To: to, From: from, Body: trialTemplate || text });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Twilio request failed with status ${response.status}.`);
    error.status = response.status;
    error.body = body;
    error.authMethod = config.authMethod;
    throw error;
  }
  return body;
}

function pdfUrl(req, id) {
  const base = process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`;
  return `${base.replace(/\/$/, "")}/files/${id}.pdf`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }
  if (req.method === "GET" && url.pathname.startsWith("/files/") && url.pathname.endsWith(".pdf")) {
    const id = url.pathname.slice("/files/".length, -".pdf".length);
    const file = pdfs.get(id);
    if (!file) return json(res, 404, { error: "PDF not found or expired." });
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.filename}"`,
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    });
    return res.end(file.content);
  }
  if (req.method !== "POST" || url.pathname !== "/api/assignments") {
    return json(res, 404, { error: "Not found." });
  }

  try {
    const body = await readBody(req);
    if (!Array.isArray(body.people) || body.people.length === 0 || !body.note?.trim()) {
      return json(res, 400, { error: "At least one recipient and a description are required." });
    }
    const recipients = body.people.map(person => ({ ...person, phone: normalizePhone(person.phone) }));
    if (recipients.some(person => !person.phone)) {
      return json(res, 400, { error: "Every phone number must be in international format, such as +14155550123." });
    }

    // Validate Twilio config before doing any other work.
    const config = twilioConfig();

    let attachmentUrl = "";
    if (body.pdf?.content) {
      if (!process.env.PUBLIC_BASE_URL) {
        return json(res, 500, { error: "PUBLIC_BASE_URL is required when sending a PDF." });
      }
      const id = randomUUID();
      const content = Buffer.from(body.pdf.content, "base64");
      if (content.length > maxBodyBytes) return json(res, 413, { error: "PDF is too large." });
      pdfs.set(id, { content, filename: body.pdf.filename || "assignment.pdf" });
      setTimeout(() => pdfs.delete(id), 24 * 60 * 60 * 1000).unref();
      attachmentUrl = pdfUrl(req, id);
    }

    const text = `${body.note.trim()}${attachmentUrl ? `\n\nAssignment PDF: ${attachmentUrl}` : ""}`;

    // allSettled so one bad number doesn't hide the messages that did go out.
    const settled = await Promise.allSettled(recipients.map(person =>
      sendTwilioSms({ to: person.phone, from: config.from, text }, config)));

    const sent = [];
    const messageSids = [];
    const failed = [];
    settled.forEach((result, i) => {
      const phone = recipients[i].phone;
      if (result.status === "fulfilled") {
        sent.push(phone);
        messageSids.push(result.value.sid);
      } else {
        console.error(`SMS to ${phone} failed:`, providerError(result.reason));
        console.error("Twilio response details:", JSON.stringify(result.reason?.body || result.reason, null, 2));
        failed.push({ phone, error: providerError(result.reason) });
      }
    });

    // Everything failed: surface the first error as before.
    if (sent.length === 0) {
      const first = settled[0].reason;
      return json(res, first?.status === 401 ? 502 : 500, { error: providerError(first), failed });
    }
    return json(res, 200, { sent, messageSids, failed });
  } catch (error) {
    console.error("Assignment SMS failed:", providerError(error));
    console.error("Twilio response details:", JSON.stringify(error?.body || error, null, 2));
    return json(res, error.status === 401 ? 502 : 500, { error: providerError(error) });
  }
});

server.listen(port, () => console.log(`Assignment API listening on http://localhost:${port}`));