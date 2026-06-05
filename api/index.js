import { randomBytes, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ---------------------------------------------------------------------------
// Sessions — in-memory only (admins simply re-login after a cold start)
// ---------------------------------------------------------------------------
if (!global.__adminSessions) global.__adminSessions = new Set();
const sessions = global.__adminSessions;

// Schema is created once per warm instance then cached
if (global.__schemaReady === undefined) global.__schemaReady = false;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
function getDb() {
  return neon(process.env.DATABASE_URL);
}

async function ensureSchema(sql) {
  if (global.__schemaReady) return;

  await sql`
    CREATE TABLE IF NOT EXISTS slots (
      id       SERIAL  PRIMARY KEY,
      label    TEXT    NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 4
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS participants (
      id             SERIAL       PRIMARY KEY,
      name           TEXT         NOT NULL,
      phone          TEXT         NOT NULL DEFAULT '',
      email          TEXT         NOT NULL,
      age            INTEGER      NOT NULL,
      enrolled       BOOLEAN      NOT NULL,
      responses_json TEXT         NOT NULL DEFAULT '{}',
      slot_id        INTEGER      NOT NULL REFERENCES slots(id),
      attendance     TEXT         NOT NULL DEFAULT 'pending',
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `;

  global.__schemaReady = true;
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------
const visibleResponseKeys = new Set([
  "institution_name", "employment", "field", "education",
  "gender", "religion", "state", "live", "caste", "personal_comp",
]);

async function getSlots(sql, includeFull = false) {
  const rows = await sql`
    SELECT
      s.id,
      s.label,
      s.capacity,
      COUNT(p.id)::int                  AS signup_count,
      (s.capacity - COUNT(p.id)::int)   AS remaining
    FROM slots s
    LEFT JOIN participants p ON p.slot_id = s.id
    GROUP BY s.id
    ORDER BY s.id
  `;

  const mapped = rows.map((r) => ({
    id:          r.id,
    label:       r.label,
    capacity:    r.capacity,
    signupCount: r.signup_count,
    remaining:   r.remaining,
  }));

  return includeFull ? mapped : mapped.filter((s) => s.remaining > 0);
}

async function getParticipants(sql) {
  const rows = await sql`
    SELECT
      p.id,
      p.name,
      p.phone,
      p.email,
      p.age,
      p.enrolled,
      p.responses_json,
      p.attendance,
      p.created_at,
      s.label AS slot
    FROM participants p
    JOIN slots s ON s.id = p.slot_id
    ORDER BY p.created_at DESC
  `;

  return rows.map((p) => {
    const responses = JSON.parse(p.responses_json || "{}");
    const visibleResponses = Object.fromEntries(
      Object.entries(responses).filter(([key]) => visibleResponseKeys.has(key)),
    );
    return {
      id:         p.id,
      name:       p.name,
      phone:      p.phone,
      email:      p.email,
      age:        p.age,
      enrolled:   p.enrolled,
      responses:  visibleResponses,
      attendance: p.attendance,
      createdAt:  p.created_at,
      slot:       p.slot,
    };
  });
}

// ---------------------------------------------------------------------------
// Slot label builder
// ---------------------------------------------------------------------------
function buildSlotLabel(date, time, description) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute]     = time.split(":").map(Number);
  const d = new Date(year, month - 1, day);
  const DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const h12    = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm   = hour < 12 ? "AM" : "PM";
  const minStr = minute.toString().padStart(2, "0");
  let label = `${DAYS[d.getDay()]}, ${MONTHS[month - 1]} ${day} at ${h12}:${minStr} ${ampm}`;
  if (description?.trim()) label += ` · ${description.trim()}`;
  return label;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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
  return Boolean(token && sessions.has(token));
}

function passwordMatches(password) {
  if (!ADMIN_PASSWORD) return false;
  const submitted  = Buffer.from(String(password || ""));
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
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  // Config guards
  if (!ADMIN_PASSWORD) {
    return sendJson(res, 503, { error: "Server misconfigured: ADMIN_PASSWORD is not set." });
  }
  if (!process.env.DATABASE_URL) {
    return sendJson(res, 503, { error: "Server misconfigured: DATABASE_URL is not set." });
  }

  const sql = getDb();

  try {
    await ensureSchema(sql);
  } catch {
    global.__schemaReady = false; // retry next request
    return sendJson(res, 503, { error: "Could not connect to the database. Please try again." });
  }

  const url      = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname;

  // ── Public routes ──────────────────────────────────────────────────────────

  // GET /api/slots
  if (req.method === "GET" && pathname === "/api/slots") {
    return sendJson(res, 200, await getSlots(sql, false));
  }

  // POST /api/admin/login
  if (req.method === "POST" && pathname === "/api/admin/login") {
    const { password } = await readJson(req);
    if (!passwordMatches(password)) {
      return sendJson(res, 401, { error: "Incorrect password." });
    }
    const token = randomBytes(32).toString("hex");
    sessions.add(token);
    setAdminCookie(res, token);
    return sendJson(res, 200, { message: "Logged in." });
  }

  // POST /api/admin/logout
  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const token = parseCookies(req).admin_session;
    if (token) sessions.delete(token);
    clearAdminCookie(res);
    return sendJson(res, 200, { message: "Logged out." });
  }

  // POST /api/bookings  (public — no auth required)
  if (req.method === "POST" && pathname === "/api/bookings") {
    try {
      const booking   = await readJson(req);
      const age       = Number(booking.age);
      const enrolled  = booking.enrolled === true || booking.enrolled === "true";
      const slotId    = Number(booking.slotId);
      const name      = String(booking.name  || "").trim();
      const phone     = String(booking.phone || "").trim();
      const email     = String(booking.email || "").trim();
      const responses = booking.responses && typeof booking.responses === "object"
        ? booking.responses : {};

      if (!name || !phone || !email || !slotId || !Number.isInteger(age)) {
        return sendJson(res, 400, { error: "Please complete all required fields." });
      }
      if (!/^[0-9]{10}$/.test(phone)) {
        return sendJson(res, 400, { error: "Please enter a valid 10-digit mobile number." });
      }
      if (age < 18 || age > 35 || !enrolled) {
        return sendJson(res, 403, { error: "This study is only open to enrolled students aged 18–35." });
      }
      if (responses?.personal_comp?.value !== "Yes") {
        return sendJson(res, 403, { error: "This study requires participants to have access to a personal computer, laptop, or tablet." });
      }

      // Check slot exists and has capacity
      const [slot] = await sql`
        SELECT s.id, s.capacity, COUNT(p.id)::int AS signup_count
        FROM slots s
        LEFT JOIN participants p ON p.slot_id = s.id
        WHERE s.id = ${slotId}
        GROUP BY s.id
      `;
      if (!slot) {
        return sendJson(res, 404, { error: "That appointment slot does not exist." });
      }
      if (slot.signup_count >= slot.capacity) {
        return sendJson(res, 409, { error: "That slot is full. Please choose another time." });
      }

      const [row] = await sql`
        INSERT INTO participants (name, phone, email, age, enrolled, responses_json, slot_id)
        VALUES (${name}, ${phone}, ${email}, ${age}, ${enrolled}, ${JSON.stringify(responses)}, ${slotId})
        RETURNING id
      `;
      return sendJson(res, 201, { id: row.id, message: "Your appointment has been booked." });
    } catch {
      return sendJson(res, 400, { error: "The booking could not be saved." });
    }
  }

  // ── Auth guard ─────────────────────────────────────────────────────────────
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
      participants: await getParticipants(sql),
      slots:        await getSlots(sql, true),
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

    const rows = await sql`
      UPDATE participants SET attendance = ${attendance}
      WHERE id = ${participantId}
      RETURNING id
    `;
    if (rows.length === 0) {
      return sendJson(res, 404, { error: "Participant not found." });
    }
    return sendJson(res, 200, { message: "Attendance updated." });
  }

  // POST /api/admin/slots — create a slot
  if (req.method === "POST" && pathname === "/api/admin/slots") {
    const { date, time, capacity, description } = await readJson(req);

    if (!date || !time) {
      return sendJson(res, 400, { error: "Date and time are required." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return sendJson(res, 400, { error: "Invalid date or time format." });
    }

    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
      return sendJson(res, 400, { error: "Capacity must be a whole number between 1 and 100." });
    }

    const label = buildSlotLabel(date, time, description);
    const [newSlot] = await sql`
      INSERT INTO slots (label, capacity) VALUES (${label}, ${cap})
      RETURNING id, label, capacity
    `;
    return sendJson(res, 201, {
      slot: { ...newSlot, signupCount: 0, remaining: cap },
    });
  }

  // DELETE /api/admin/slots/:id — remove a slot (blocked if participants exist)
  if (req.method === "DELETE" && pathname.startsWith("/api/admin/slots/")) {
    const slotId = Number(pathname.split("/").pop());

    const [slot] = await sql`SELECT id FROM slots WHERE id = ${slotId}`;
    if (!slot) return sendJson(res, 404, { error: "Slot not found." });

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM participants WHERE slot_id = ${slotId}
    `;
    if (count > 0) {
      return sendJson(res, 409, {
        error: "This slot has participants booked. Remove their bookings before deleting.",
      });
    }

    await sql`DELETE FROM slots WHERE id = ${slotId}`;
    return sendJson(res, 200, { message: "Slot deleted." });
  }

  return sendJson(res, 404, { error: "API route not found." });
}
