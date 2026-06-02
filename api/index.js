import { randomBytes, timingSafeEqual } from "node:crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
if (!global.__bookingState) {
  global.__bookingState = {
    sessions: new Set(),
    participants: [],
    nextId: 1,
    slots: [
      { id: 1, label: "Monday, June 3 at 10:00 AM", capacity: 4 },
      { id: 2, label: "Monday, June 3 at 2:00 PM", capacity: 4 },
      { id: 3, label: "Tuesday, June 4 at 11:00 AM", capacity: 4 },
      { id: 4, label: "Wednesday, June 5 at 3:00 PM", capacity: 4 },
      { id: 5, label: "Thursday, June 6 at 1:00 PM", capacity: 4 },
    ],
  };
}

const state = global.__bookingState;

const visibleResponseKeys = new Set([
  "institution_name",
  "employment",
  "field",
  "education",
  "gender",
  "religion",
  "state",
  "live",
  "caste",
  "personal_comp",
]);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const [name, ...parts] = c.split("=");
        return [name, decodeURIComponent(parts.join("="))];
      }),
  );
}

function isAdminAuthenticated(req) {
  const token = parseCookies(req).admin_session;
  return Boolean(token && state.sessions.has(token));
}

function passwordMatches(password) {
  if (!ADMIN_PASSWORD) return false;
  const submitted = Buffer.from(String(password || ""));
  const configured = Buffer.from(ADMIN_PASSWORD);
  if (submitted.length !== configured.length) return false;
  return timingSafeEqual(submitted, configured);
}

function setAdminCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
  );
}

function clearAdminCookie(res) {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------
function getSlots(includeFull = false) {
  return state.slots
    .map((slot) => {
      const signupCount = state.participants.filter((p) => p.slot_id === slot.id).length;
      return {
        id: slot.id,
        label: slot.label,
        capacity: slot.capacity,
        signupCount,
        remaining: slot.capacity - signupCount,
      };
    })
    .filter((slot) => includeFull || slot.remaining > 0);
}

function getParticipants() {
  return state.participants
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((p) => {
      const slot = state.slots.find((s) => s.id === p.slot_id);
      const visibleResponses = Object.fromEntries(
        Object.entries(p.responses || {}).filter(([key]) => visibleResponseKeys.has(key)),
      );
      return {
        id: p.id,
        name: p.name,
        phone: p.phone,
        email: p.email,
        age: p.age,
        enrolled: p.enrolled,
        responses: visibleResponses,
        attendance: p.attendance,
        createdAt: p.createdAt,
        slot: slot ? slot.label : "Unknown",
      };
    });
}

// ---------------------------------------------------------------------------
// Reminder helpers
// ---------------------------------------------------------------------------

/** Normalise an Indian phone number to E.164 format (+91XXXXXXXXXX). */
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length > 7) return `+${digits}`;
  return null; // unparseable
}

function buildEmailHtml(participant, slot) {
  const firstName = participant.name.split(" ")[0];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reminder: CSBC Research Session</title>
  <style>
    body{margin:0;padding:0;background:#f8f5fb;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f1235}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(82,34,91,.1)}
    .hd{background:#52225b;padding:28px 32px}
    .hd h1{margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px}
    .hd p{margin:4px 0 0;color:rgba(255,255,255,.65);font-size:13px}
    .bd{padding:32px}
    .bd p{line-height:1.7;color:#3a2e45;margin:0 0 16px}
    .slot-box{background:#f8f5fb;border:1px solid #e4dcea;border-left:4px solid #dd5938;border-radius:8px;padding:18px 22px;margin:24px 0}
    .slot-box strong{display:block;color:#52225b;font-size:16px;font-weight:700;margin-bottom:4px}
    .slot-box span{color:#6b5f78;font-size:14px}
    .ft{padding:20px 32px;background:#f8f5fb;border-top:1px solid #e4dcea;font-size:12px;color:#9b8faa;line-height:1.6}
  </style>
</head>
<body>
<div class="wrap">
  <div class="hd">
    <h1>Centre for Social and Behaviour Change</h1>
    <p>Ashoka University · Research Participant Reminder</p>
  </div>
  <div class="bd">
    <p>Hi ${firstName},</p>
    <p>This is a friendly reminder about your upcoming research session with CSBC at Ashoka University.</p>
    <div class="slot-box">
      <strong>&#128197; ${slot.label}</strong>
      <span>Ashoka University campus</span>
    </div>
    <p>Please arrive a few minutes before your scheduled time. The session takes approximately <strong>45–60 minutes</strong>.</p>
    <p>If you have any questions or need to reschedule, please reply to this email and a member of the team will get back to you.</p>
    <p style="margin-top:32px">
      Best regards,<br>
      <strong style="color:#52225b">The CSBC Research Team</strong><br>
      <span style="color:#6b5f78;font-size:14px">Centre for Social and Behaviour Change, Ashoka University</span>
    </p>
  </div>
  <div class="ft">
    You are receiving this message because you signed up for a CSBC research session.<br>
    If you believe this was sent in error, please disregard this email.
  </div>
</div>
</body>
</html>`;
}

function buildEmailText(participant, slot) {
  const firstName = participant.name.split(" ")[0];
  return `Hi ${firstName},\n\nThis is a reminder for your CSBC research session at Ashoka University:\n\n  ${slot.label}\n\nPlease arrive a few minutes early. Sessions take approximately 45–60 minutes.\n\nIf you have questions or need to reschedule, reply to this email.\n\nBest regards,\nThe CSBC Research Team\nCentre for Social and Behaviour Change, Ashoka University`;
}

function buildSmsText(participant, slot) {
  const firstName = participant.name.split(" ")[0];
  return `Hi ${firstName}, reminder: your CSBC research session is on ${slot.label} at Ashoka University. See you then! – CSBC Team`;
}

function buildWhatsAppText(participant, slot) {
  const firstName = participant.name.split(" ")[0];
  return `Hi ${firstName} 👋\n\nThis is a reminder for your *CSBC research session* at Ashoka University:\n\n📅 *${slot.label}*\n📍 Ashoka University campus\n\nPlease arrive a few minutes early. The session takes ~45–60 mins.\n\nSee you soon!\n— CSBC Research Team`;
}

async function sendEmail(participant, slot) {
  const fromEmail = process.env.FROM_EMAIL || "CSBC Research <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [participant.email],
      subject: `Reminder: Your CSBC research session – ${slot.label}`,
      html: buildEmailHtml(participant, slot),
      text: buildEmailText(participant, slot),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Resend error ${res.status}`);
  }
  return res.json();
}

async function sendTwilioMessage(participant, slot, isWhatsApp) {
  const phone = normalizePhone(participant.phone);
  if (!phone) throw new Error(`Could not parse phone number: ${participant.phone}`);

  const from = isWhatsApp
    ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_PHONE}`
    : process.env.TWILIO_FROM_PHONE;

  const to = isWhatsApp ? `whatsapp:${phone}` : phone;
  const body = isWhatsApp ? buildWhatsAppText(participant, slot) : buildSmsText(participant, slot);

  const params = new URLSearchParams({ From: from, To: to, Body: body });
  const creds = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Twilio error ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// API handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (!ADMIN_PASSWORD) {
    return sendJson(res, 503, { error: "Server misconfigured: ADMIN_PASSWORD environment variable is not set." });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname;

  // ── Public routes ──────────────────────────────────────────────────────────

  // GET /api/slots
  if (req.method === "GET" && pathname === "/api/slots") {
    return sendJson(res, 200, getSlots(false));
  }

  // POST /api/admin/login
  if (req.method === "POST" && pathname === "/api/admin/login") {
    const { password } = await readJson(req);
    if (!passwordMatches(password)) {
      return sendJson(res, 401, { error: "Incorrect password." });
    }
    const token = randomBytes(32).toString("hex");
    state.sessions.add(token);
    setAdminCookie(res, token);
    return sendJson(res, 200, { message: "Logged in." });
  }

  // POST /api/admin/logout
  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const token = parseCookies(req).admin_session;
    if (token) state.sessions.delete(token);
    clearAdminCookie(res);
    return sendJson(res, 200, { message: "Logged out." });
  }

  // POST /api/bookings (public — no auth required)
  if (req.method === "POST" && pathname === "/api/bookings") {
    try {
      const booking = await readJson(req);
      const age = Number(booking.age);
      const enrolled = booking.enrolled === true || booking.enrolled === "true";
      const slotId = Number(booking.slotId);
      const name = String(booking.name || "").trim();
      const phone = String(booking.phone || "").trim();
      const email = String(booking.email || "").trim();
      const responses = booking.responses && typeof booking.responses === "object" ? booking.responses : {};

      if (!name || !phone || !email || !slotId || !Number.isInteger(age)) {
        return sendJson(res, 400, { error: "Please complete all required fields." });
      }

      if (age < 18 || age > 26 || !enrolled) {
        return sendJson(res, 403, { error: "This study is only open to enrolled students aged 18–26." });
      }

      const slot = state.slots.find((s) => s.id === slotId);
      if (!slot) {
        return sendJson(res, 404, { error: "That appointment slot does not exist." });
      }

      const signupCount = state.participants.filter((p) => p.slot_id === slotId).length;
      if (signupCount >= slot.capacity) {
        return sendJson(res, 409, { error: "That slot is full. Please choose another time." });
      }

      const id = state.nextId++;
      state.participants.push({
        id, name, phone, email, age,
        enrolled: enrolled ? 1 : 0,
        responses,
        slot_id: slotId,
        attendance: "pending",
        createdAt: new Date().toISOString(),
      });

      return sendJson(res, 201, { id, message: "Your appointment has been booked." });
    } catch {
      return sendJson(res, 400, { error: "The booking could not be saved." });
    }
  }

  // ── Auth guard for all remaining /api/admin/* and /api/attendance/* ────────
  const requiresAuth =
    pathname === "/api/admin" ||
    (pathname.startsWith("/api/admin/") &&
      pathname !== "/api/admin/login" &&
      pathname !== "/api/admin/logout") ||
    pathname.startsWith("/api/attendance/");

  if (requiresAuth && !isAdminAuthenticated(req)) {
    return sendJson(res, 401, { error: "Admin password required." });
  }

  // ── Protected admin routes ─────────────────────────────────────────────────

  // GET /api/admin
  if (req.method === "GET" && pathname === "/api/admin") {
    return sendJson(res, 200, {
      participants: getParticipants(),
      slots: getSlots(true),
    });
  }

  // PATCH /api/attendance/:id
  if (req.method === "PATCH" && pathname.startsWith("/api/attendance/")) {
    const participantId = Number(pathname.split("/").pop());
    const { attendance } = await readJson(req);
    const allowed = ["pending", "attended", "missed"];

    if (!participantId || !allowed.includes(attendance)) {
      return sendJson(res, 400, { error: "Invalid attendance update." });
    }

    const participant = state.participants.find((p) => p.id === participantId);
    if (!participant) {
      return sendJson(res, 404, { error: "Participant not found." });
    }

    participant.attendance = attendance;
    return sendJson(res, 200, { message: "Attendance updated." });
  }

  // GET /api/admin/reminder-config
  // Returns which messaging services are currently configured via env vars.
  if (req.method === "GET" && pathname === "/api/admin/reminder-config") {
    return sendJson(res, 200, {
      email: Boolean(process.env.RESEND_API_KEY),
      sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_PHONE),
      whatsapp: Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_PHONE),
      ),
    });
  }

  // POST /api/admin/reminders
  // Body: { slotId: number, channels: ("email"|"sms"|"whatsapp")[] }
  if (req.method === "POST" && pathname === "/api/admin/reminders") {
    const { slotId, channels } = await readJson(req);

    if (!slotId || !Array.isArray(channels) || channels.length === 0) {
      return sendJson(res, 400, { error: "Provide a slotId and at least one channel." });
    }

    const slot = state.slots.find((s) => s.id === Number(slotId));
    if (!slot) return sendJson(res, 404, { error: "Slot not found." });

    const participants = state.participants.filter((p) => p.slot_id === Number(slotId));

    if (participants.length === 0) {
      return sendJson(res, 200, { sent: 0, total: 0, results: [] });
    }

    const results = [];

    for (const participant of participants) {
      const entry = { id: participant.id, name: participant.name };

      if (channels.includes("email") && process.env.RESEND_API_KEY) {
        try {
          await sendEmail(participant, slot);
          entry.email = { ok: true };
        } catch (err) {
          entry.email = { ok: false, error: err.message };
        }
      }

      if (channels.includes("sms") && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_FROM_PHONE) {
        try {
          await sendTwilioMessage(participant, slot, false);
          entry.sms = { ok: true };
        } catch (err) {
          entry.sms = { ok: false, error: err.message };
        }
      }

      if (
        channels.includes("whatsapp") &&
        process.env.TWILIO_ACCOUNT_SID &&
        (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_PHONE)
      ) {
        try {
          await sendTwilioMessage(participant, slot, true);
          entry.whatsapp = { ok: true };
        } catch (err) {
          entry.whatsapp = { ok: false, error: err.message };
        }
      }

      results.push(entry);
    }

    const sent = results.filter((r) => r.email?.ok || r.sms?.ok || r.whatsapp?.ok).length;
    return sendJson(res, 200, { sent, total: participants.length, results });
  }

  return sendJson(res, 404, { error: "API route not found." });
}
