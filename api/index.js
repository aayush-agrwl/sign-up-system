import { randomBytes, timingSafeEqual } from "node:crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ---------------------------------------------------------------------------
// In-memory state
// Global variables persist across requests within a warm serverless instance.
// Data resets on cold starts — suitable for testing.
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
// Helpers
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
// Data helpers (mirror the SQLite queries using in-memory arrays)
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
// API handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (!ADMIN_PASSWORD) {
    return sendJson(res, 503, { error: "Server misconfigured: ADMIN_PASSWORD environment variable is not set." });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname;

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

  // Auth guard for admin + attendance routes
  if ((pathname === "/api/admin" || pathname.startsWith("/api/attendance/")) && !isAdminAuthenticated(req)) {
    return sendJson(res, 401, { error: "Admin password required." });
  }

  // GET /api/admin
  if (req.method === "GET" && pathname === "/api/admin") {
    return sendJson(res, 200, {
      participants: getParticipants(),
      slots: getSlots(true),
    });
  }

  // POST /api/bookings
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
        return sendJson(res, 403, { error: "This study is only open to enrolled students aged 18-26." });
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
        id,
        name,
        phone,
        email,
        age,
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

  return sendJson(res, 404, { error: "API route not found." });
}
