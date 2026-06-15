import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const sessions = new Set();
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "booking.db");
const visibleResponseKeys = new Set([
  "institution_name",
  "gender",
  "personal_comp",
  "future_studies",
]);

function sanitizeResponses(responses) {
  return Object.fromEntries(
    Object.entries(responses).filter(([key]) => visibleResponseKeys.has(key)),
  );
}

if (!ADMIN_PASSWORD) {
  console.error('Please set an admin password before starting the app: ADMIN_PASSWORD="your-password" node --no-warnings server.js');
  process.exit(1);
}

if (!existsSync(dataDir)) {
  mkdirSync(dataDir);
}

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE,
    capacity INTEGER NOT NULL DEFAULT 4
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    age INTEGER NOT NULL,
    enrolled INTEGER NOT NULL,
    responses_json TEXT NOT NULL DEFAULT '{}',
    slot_id INTEGER NOT NULL,
    attendance TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (slot_id) REFERENCES slots(id)
  );
`);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn("participants", "phone", "TEXT NOT NULL DEFAULT ''");
ensureColumn("participants", "responses_json", "TEXT NOT NULL DEFAULT '{}'");

const slotCount = db.prepare("SELECT COUNT(*) AS count FROM slots").get().count;
if (slotCount === 0) {
  const insertSlot = db.prepare("INSERT INTO slots (label, capacity) VALUES (?, ?)");
  [
    ["Monday, June 3 at 10:00 AM", 4],
    ["Monday, June 3 at 2:00 PM", 4],
    ["Tuesday, June 4 at 11:00 AM", 4],
    ["Wednesday, June 5 at 3:00 PM", 4],
    ["Thursday, June 6 at 1:00 PM", 4],
  ].forEach(([label, capacity]) => insertSlot.run(label, capacity));
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sendRedirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...valueParts] = cookie.split("=");
        return [name, decodeURIComponent(valueParts.join("="))];
      }),
  );
}

function isAdminAuthenticated(request) {
  const token = parseCookies(request).admin_session;
  return Boolean(token && sessions.has(token));
}

function passwordMatches(password) {
  const submitted = Buffer.from(String(password || ""));
  const configured = Buffer.from(ADMIN_PASSWORD);

  if (submitted.length !== configured.length) {
    return false;
  }

  return timingSafeEqual(submitted, configured);
}

function setAdminCookie(response, token) {
  response.setHeader(
    "Set-Cookie",
    `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
  );
}

function clearAdminCookie(response) {
  response.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

function getSlots(includeFull = false) {
  const availabilityClause = includeFull
    ? ""
    : "HAVING s.capacity > COUNT(CASE WHEN p.attendance NOT IN ('cancelled', 'deleted') THEN p.id END)";
  return db
    .prepare(`
      SELECT
        s.id,
        s.label,
        s.capacity,
        COUNT(p.id) AS bookingCount,
        COUNT(CASE WHEN p.attendance NOT IN ('cancelled', 'deleted') THEN p.id END) AS signupCount,
        s.capacity - COUNT(CASE WHEN p.attendance NOT IN ('cancelled', 'deleted') THEN p.id END) AS remaining
      FROM slots s
      LEFT JOIN participants p ON p.slot_id = s.id
      GROUP BY s.id
      ${availabilityClause}
      ORDER BY s.id
    `)
    .all();
}

function getParticipants() {
  const participants = db
    .prepare(`
      SELECT
        p.id,
        p.name,
        p.phone,
        p.email,
        p.age,
        p.enrolled,
        p.responses_json AS responsesJson,
        p.attendance,
        p.created_at AS createdAt,
        s.label AS slot
      FROM participants p
      JOIN slots s ON s.id = p.slot_id
      ORDER BY p.created_at DESC
    `)
    .all();

  return participants.map((participant) => {
    const responses = JSON.parse(participant.responsesJson || "{}");
    const visibleResponses = Object.fromEntries(
      Object.entries(responses).filter(([key]) => visibleResponseKeys.has(key)),
    );

    return {
      ...participant,
      responses: visibleResponses,
      responsesJson: undefined,
    };
  });
}

function buildSlotLabel(date, time, description) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const d = new Date(year, month - 1, day);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? "AM" : "PM";
  const minStr = minute.toString().padStart(2, "0");
  let label = `${days[d.getDay()]}, ${months[month - 1]} ${day} at ${h12}:${minStr} ${ampm}`;
  if (description?.trim()) label += ` · ${description.trim()}`;
  return label;
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/slots") {
    return sendJson(response, 200, getSlots(false));
  }

  if (request.method === "POST" && pathname === "/api/admin/login") {
    const { password } = await readJson(request);

    if (!passwordMatches(password)) {
      return sendJson(response, 401, { error: "Incorrect password." });
    }

    const token = randomBytes(32).toString("hex");
    sessions.add(token);
    setAdminCookie(response, token);
    return sendJson(response, 200, { message: "Logged in." });
  }

  if (request.method === "POST" && pathname === "/api/admin/logout") {
    const token = parseCookies(request).admin_session;
    if (token) {
      sessions.delete(token);
    }
    clearAdminCookie(response);
    return sendJson(response, 200, { message: "Logged out." });
  }

  if (
    (pathname === "/api/admin" ||
      pathname.startsWith("/api/admin/") ||
      pathname.startsWith("/api/attendance/")) &&
    pathname !== "/api/admin/login" &&
    pathname !== "/api/admin/logout" &&
    !isAdminAuthenticated(request)
  ) {
    return sendJson(response, 401, { error: "Admin password required." });
  }

  if (request.method === "GET" && pathname === "/api/admin") {
    return sendJson(response, 200, {
      participants: getParticipants(),
      slots: getSlots(true),
    });
  }

  if (request.method === "POST" && pathname === "/api/bookings") {
    try {
      const booking = await readJson(request);
      const age = Number(booking.age);
      const enrolled = booking.enrolled === true || booking.enrolled === "true";
      const slotId = Number(booking.slotId);
      const name = String(booking.name || "").trim();
      const phone = String(booking.phone || "").trim();
      const email = String(booking.email || "").trim();
      const responses = booking.responses && typeof booking.responses === "object" ? booking.responses : {};
      const sanitizedResponses = sanitizeResponses(responses);
      const eligibilityIssues = [];

      if (!name || !phone || !email || !slotId || !Number.isInteger(age)) {
        return sendJson(response, 400, { error: "Please complete all required fields." });
      }

      if (!/^[0-9]{10}$/.test(phone)) {
        return sendJson(response, 400, { error: "Please enter a valid 10-digit mobile number." });
      }

      if (age < 18 || age > 35) {
        eligibilityIssues.push("You must be between 18 and 35 years old.");
      }

      if (!enrolled) {
        eligibilityIssues.push("You must currently be enrolled in an educational institution.");
      }

      if (sanitizedResponses?.personal_comp?.value !== "Yes") {
        eligibilityIssues.push("You must have access to a personal computer, laptop, or tablet.");
      }

      if (eligibilityIssues.length > 0) {
        return sendJson(response, 403, {
          error: eligibilityIssues.length === 1
            ? eligibilityIssues[0]
            : `This study is currently limited to participants who meet these requirements: ${eligibilityIssues.join(" ")}`,
          reasons: eligibilityIssues,
        });
      }

      const slot = db
        .prepare(`
          SELECT
            s.id,
            s.label,
            s.capacity,
            COUNT(CASE WHEN p.attendance NOT IN ('cancelled', 'deleted') THEN p.id END) AS signupCount
          FROM slots s
          LEFT JOIN participants p ON p.slot_id = s.id
          WHERE s.id = ?
          GROUP BY s.id
        `)
        .get(slotId);

      if (!slot) {
        return sendJson(response, 404, { error: "That appointment slot does not exist." });
      }

      if (slot.signupCount >= slot.capacity) {
        return sendJson(response, 409, { error: "That slot is full. Please choose another time." });
      }

      db
        .prepare(`
          UPDATE participants
          SET attendance = 'cancelled'
          WHERE attendance NOT IN ('cancelled', 'deleted')
            AND (lower(email) = lower(?) OR phone = ?)
        `)
        .run(email, phone);

      const result = db
        .prepare(`
          INSERT INTO participants (name, phone, email, age, enrolled, responses_json, slot_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(name, phone, email, age, enrolled ? 1 : 0, JSON.stringify(sanitizedResponses), slotId);

      return sendJson(response, 201, {
        id: result.lastInsertRowid,
        message: "Your appointment has been booked.",
        booking: {
          id: result.lastInsertRowid,
          name,
          phone,
          email,
          age,
          enrolled,
          responses: sanitizedResponses,
          slot: slot.label,
          attendance: "pending",
        },
      });
    } catch (error) {
      return sendJson(response, 400, { error: "The booking could not be saved." });
    }
  }

  if (request.method === "POST" && pathname === "/api/bookings/lookup") {
    try {
      const { contact } = await readJson(request);
      const c = String(contact || "").trim();
      if (!c) {
        return sendJson(response, 400, { error: "Please enter the email or phone number you booked with." });
      }

      const row = db
        .prepare(`
          SELECT p.id, p.name, p.phone, p.email, p.age, p.enrolled, p.responses_json,
                 s.label AS slot
          FROM participants p
          JOIN slots s ON s.id = p.slot_id
          WHERE p.attendance NOT IN ('cancelled', 'deleted')
            AND (lower(p.email) = lower(?) OR p.phone = ?)
          ORDER BY p.created_at DESC
          LIMIT 1
        `)
        .get(c, c);

      if (!row) {
        return sendJson(response, 404, {
          error: "We couldn't find an active booking for those details. Please check and try again.",
        });
      }

      let responses = {};
      try { responses = JSON.parse(row.responses_json || "{}"); } catch {}

      return sendJson(response, 200, {
        booking: {
          id:         row.id,
          name:       row.name,
          phone:      row.phone,
          email:      row.email,
          age:        row.age,
          enrolled:   Boolean(row.enrolled),
          responses,
          slot:       row.slot,
          attendance: "pending",
        },
      });
    } catch {
      return sendJson(response, 400, { error: "Could not look up your booking. Please try again." });
    }
  }

  if (request.method === "POST" && pathname.startsWith("/api/bookings/") && pathname.endsWith("/cancel")) {
    try {
      const participantId = Number(pathname.split("/").at(-2));
      const { email, phone } = await readJson(request);
      const normalizedEmail = String(email || "").trim();
      const normalizedPhone = String(phone || "").trim();

      if (!participantId || !normalizedEmail || !normalizedPhone) {
        return sendJson(response, 400, { error: "Could not verify this booking." });
      }

      const result = db
        .prepare(`
          UPDATE participants
          SET attendance = 'cancelled'
          WHERE id = ?
            AND lower(email) = lower(?)
            AND phone = ?
            AND attendance NOT IN ('cancelled', 'deleted')
        `)
        .run(participantId, normalizedEmail, normalizedPhone);

      if (result.changes === 0) {
        return sendJson(response, 404, { error: "No active booking was found for those details." });
      }

      return sendJson(response, 200, { message: "Your booking has been cancelled." });
    } catch {
      return sendJson(response, 400, { error: "The booking could not be cancelled." });
    }
  }

  if (request.method === "PATCH" && pathname.startsWith("/api/attendance/")) {
    const participantId = Number(pathname.split("/").pop());
    const { attendance } = await readJson(request);
    const allowedStatuses = ["pending", "attended", "missed", "cancelled", "deleted"];

    if (!participantId || !allowedStatuses.includes(attendance)) {
      return sendJson(response, 400, { error: "Invalid attendance update." });
    }

    const result = db
      .prepare("UPDATE participants SET attendance = ? WHERE id = ?")
      .run(attendance, participantId);

    if (result.changes === 0) {
      return sendJson(response, 404, { error: "Participant not found." });
    }

    return sendJson(response, 200, { message: "Attendance updated." });
  }

  if (request.method === "POST" && pathname === "/api/admin/slots") {
    const { date, time, capacity, description } = await readJson(request);

    if (!date || !time) {
      return sendJson(response, 400, { error: "Date and time are required." });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return sendJson(response, 400, { error: "Invalid date or time format." });
    }

    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
      return sendJson(response, 400, { error: "Capacity must be a whole number between 1 and 100." });
    }

    try {
      const label = buildSlotLabel(date, time, description);
      const result = db
        .prepare("INSERT INTO slots (label, capacity) VALUES (?, ?)")
        .run(label, cap);

      return sendJson(response, 201, {
        slot: {
          id: result.lastInsertRowid,
          label,
          capacity: cap,
          bookingCount: 0,
          signupCount: 0,
          remaining: cap,
        },
      });
    } catch {
      return sendJson(response, 400, { error: "Could not create slot." });
    }
  }

  if (request.method === "DELETE" && pathname.startsWith("/api/admin/slots/")) {
    const slotId = Number(pathname.split("/").pop());

    const slot = db.prepare("SELECT id FROM slots WHERE id = ?").get(slotId);
    if (!slot) return sendJson(response, 404, { error: "Slot not found." });

    const count = db
      .prepare("SELECT COUNT(*) AS count FROM participants WHERE slot_id = ?")
      .get(slotId).count;

    if (count > 0) {
      return sendJson(response, 409, {
        error: "This slot has participant records attached and cannot be deleted.",
      });
    }

    db.prepare("DELETE FROM slots WHERE id = ?").run(slotId);
    return sendJson(response, 200, { message: "Slot deleted." });
  }

  return sendJson(response, 404, { error: "API route not found." });
}

async function serveStatic(request, response, pathname) {
  if (pathname === "/admin.html" && !isAdminAuthenticated(request)) {
    sendRedirect(response, "/admin-login.html");
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(__dirname, "public", requestedPath));

  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Page not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url.pathname);
    return;
  }

  await serveStatic(request, response, url.pathname);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Participant booking app running at http://localhost:${PORT}`);
});
