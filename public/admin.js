const participantTable = document.querySelector("#participant-table");
const slotSummary = document.querySelector("#slot-summary");
const refreshButton = document.querySelector("#refresh-button");
const downloadCsvButton = document.querySelector("#download-csv-button");
const logoutButton = document.querySelector("#logout-button");
const totalParticipants = document.querySelector("#total-participants");
const totalAttended = document.querySelector("#total-attended");
const totalPending = document.querySelector("#total-pending");

// Reminder modal elements
const reminderModal = document.querySelector("#reminder-modal");
const modalSlotLabel = document.querySelector("#modal-slot-label");
const modalParticipantCount = document.querySelector("#modal-participant-count");
const modalCloseBtn = document.querySelector("#modal-close-btn");
const modalCancelBtn = document.querySelector("#modal-cancel-btn");
const sendRemindersBtn = document.querySelector("#send-reminders-btn");
const reminderResult = document.querySelector("#reminder-result");

let dashboardData = { participants: [], slots: [] };
let reminderConfig = { email: false, sms: false, whatsapp: false };
let activeSlotId = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function responseColumns(participants) {
  const columns = new Map();
  participants.forEach((p) => {
    Object.entries(p.responses || {}).forEach(([key, response]) => {
      if (!columns.has(key)) columns.set(key, response?.label || key);
    });
  });
  return columns;
}

function buildParticipantCsv(participants) {
  const questionColumns = responseColumns(participants);
  const headers = [
    "Participant ID", "Name", "Phone", "Email", "Age",
    "Enrolled in Institution", "Appointment Slot", "Attendance Status",
    "Created At", ...questionColumns.values(),
  ];
  const rows = participants.map((p) => {
    const answers = [...questionColumns.keys()].map((key) => p.responses?.[key]?.value || "");
    return [p.id, p.name, p.phone, p.email, p.age,
      p.enrolled ? "Yes" : "No", p.slot, p.attendance, p.createdAt, ...answers];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function downloadCsv() {
  const csv = buildParticipantCsv(dashboardData.participants);
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), {
    href: url, download: `participant-bookings-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatResponses(responses = {}) {
  const entries = Object.entries(responses).filter(([, r]) => r?.value);
  if (entries.length === 0) return '<p class="empty-state">No questionnaire responses saved.</p>';
  return `<dl class="response-list">${entries.map(([, r]) => `
    <div><dt>${escapeHtml(r.label)}</dt><dd>${escapeHtml(r.value)}</dd></div>`).join("")}</dl>`;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
async function updateAttendance(participantId, attendance) {
  const response = await fetch(`/api/attendance/${participantId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attendance }),
  });
  if (response.status === 401) { window.location.href = "/admin-login.html"; return; }
  await loadDashboard();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderParticipants(participants) {
  participantTable.innerHTML = "";

  if (participants.length === 0) {
    participantTable.innerHTML = `<tr><td colspan="7" class="empty-state">No participant bookings yet.</td></tr>`;
    return;
  }

  participants.forEach((participant) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(participant.name)}</td>
      <td>${escapeHtml(participant.phone)}</td>
      <td>${escapeHtml(participant.email)}</td>
      <td>${escapeHtml(participant.age)}</td>
      <td>${escapeHtml(participant.slot)}</td>
      <td>
        <button class="button small response-toggle" type="button" data-response-id="${participant.id}">
          View responses
        </button>
      </td>
      <td>
        <select data-participant-id="${participant.id}" aria-label="Attendance for ${escapeHtml(participant.name)}">
          <option value="pending"${participant.attendance === "pending" ? " selected" : ""}>Pending</option>
          <option value="attended"${participant.attendance === "attended" ? " selected" : ""}>Attended</option>
          <option value="missed"${participant.attendance === "missed" ? " selected" : ""}>Missed</option>
        </select>
      </td>`;

    const responseRow = document.createElement("tr");
    responseRow.id = `responses-${participant.id}`;
    responseRow.className = "response-row";
    responseRow.hidden = true;
    responseRow.innerHTML = `<td colspan="7">${formatResponses(participant.responses)}</td>`;

    participantTable.append(row, responseRow);
  });

  participantTable.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => updateAttendance(select.dataset.participantId, select.value));
  });

  participantTable.querySelectorAll(".response-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const row = document.querySelector(`#responses-${button.dataset.responseId}`);
      row.hidden = !row.hidden;
      button.textContent = row.hidden ? "View responses" : "Hide responses";
    });
  });
}

function renderSlots(slots) {
  slotSummary.innerHTML = "";

  slots.forEach((slot) => {
    const pct = Math.round((slot.signupCount / slot.capacity) * 100);
    const hasParticipants = slot.signupCount > 0;
    const item = document.createElement("article");
    item.className = "slot-card";
    item.innerHTML = `
      <div class="slot-card-top">
        <div>
          <h3>${escapeHtml(slot.label)}</h3>
          <p>${slot.signupCount} signup${slot.signupCount === 1 ? "" : "s"} &middot; ${slot.remaining} open</p>
        </div>
        <button
          class="button small reminder-btn"
          type="button"
          data-slot-id="${slot.id}"
          data-slot-label="${escapeHtml(slot.label)}"
          data-signup-count="${slot.signupCount}"
          ${hasParticipants ? "" : "disabled"}
          title="${hasParticipants ? "Send reminders to participants in this slot" : "No participants in this slot yet"}"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Remind
        </button>
      </div>
      <div class="progress" aria-label="${pct}% full">
        <span style="width: ${pct}%"></span>
      </div>`;
    slotSummary.append(item);
  });

  slotSummary.querySelectorAll(".reminder-btn").forEach((btn) => {
    btn.addEventListener("click", () => openReminderModal(
      Number(btn.dataset.slotId),
      btn.dataset.slotLabel,
      Number(btn.dataset.signupCount),
    ));
  });
}

function renderMetrics(participants) {
  totalParticipants.textContent = participants.length;
  totalAttended.textContent = participants.filter((p) => p.attendance === "attended").length;
  totalPending.textContent = participants.filter((p) => p.attendance === "pending").length;
}

// ---------------------------------------------------------------------------
// Reminder modal
// ---------------------------------------------------------------------------
const CHANNEL_KEYS = ["email", "sms", "whatsapp"];

function applyReminderConfig(config) {
  reminderConfig = config;
  CHANNEL_KEYS.forEach((ch) => {
    const card = document.getElementById(`channel-card-${ch}`);
    const badge = document.getElementById(`badge-${ch}`);
    const input = document.getElementById(`ch-${ch}`);

    if (config[ch]) {
      card.classList.remove("channel-card--disabled");
      input.disabled = false;
      badge.textContent = "Ready";
      badge.className = "channel-badge channel-badge--ready";
    } else {
      card.classList.add("channel-card--disabled");
      input.disabled = true;
      input.checked = false;
      badge.textContent = "Not configured";
      badge.className = "channel-badge channel-badge--off";
    }
  });
}

function openReminderModal(slotId, slotLabel, signupCount) {
  activeSlotId = slotId;
  modalSlotLabel.textContent = slotLabel;
  modalParticipantCount.textContent =
    `${signupCount} participant${signupCount === 1 ? "" : "s"} will receive a message.`;

  // Reset UI
  CHANNEL_KEYS.forEach((ch) => {
    const input = document.getElementById(`ch-${ch}`);
    if (!input.disabled) input.checked = false;
  });
  reminderResult.hidden = true;
  reminderResult.innerHTML = "";
  sendRemindersBtn.classList.remove("loading");
  sendRemindersBtn.disabled = false;
  sendRemindersBtn.textContent = "Send reminders";

  reminderModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeReminderModal() {
  reminderModal.hidden = true;
  document.body.style.overflow = "";
  activeSlotId = null;
}

async function sendReminders() {
  const channels = CHANNEL_KEYS.filter((ch) => {
    const input = document.getElementById(`ch-${ch}`);
    return input.checked && !input.disabled;
  });

  if (channels.length === 0) {
    reminderResult.hidden = false;
    reminderResult.innerHTML = `<p class="reminder-result-warn">Please select at least one channel.</p>`;
    return;
  }

  sendRemindersBtn.classList.add("loading");
  sendRemindersBtn.disabled = true;
  reminderResult.hidden = true;

  try {
    const res = await fetch("/api/admin/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotId: activeSlotId, channels }),
    });

    const data = await res.json();
    sendRemindersBtn.classList.remove("loading");
    sendRemindersBtn.textContent = "Done";

    if (!res.ok) {
      reminderResult.hidden = false;
      reminderResult.innerHTML = `<p class="reminder-result-warn">${escapeHtml(data.error || "Something went wrong.")}</p>`;
      return;
    }

    const successRows = data.results.map((r) => {
      const statuses = channels.map((ch) => {
        if (!r[ch]) return "";
        const ok = r[ch].ok;
        return `<span class="result-chip ${ok ? "result-chip--ok" : "result-chip--fail"}">
          ${ch}: ${ok ? "✓" : `✗ ${escapeHtml(r[ch].error || "failed")}`}
        </span>`;
      }).join("");
      return `<div class="result-row"><span class="result-name">${escapeHtml(r.name)}</span>${statuses}</div>`;
    }).join("");

    reminderResult.hidden = false;
    reminderResult.innerHTML = `
      <p class="reminder-result-ok">
        ✓ Sent to ${data.sent} of ${data.total} participant${data.total === 1 ? "" : "s"}.
      </p>
      <div class="result-rows">${successRows}</div>`;

  } catch (err) {
    sendRemindersBtn.classList.remove("loading");
    sendRemindersBtn.disabled = false;
    sendRemindersBtn.textContent = "Send reminders";
    reminderResult.hidden = false;
    reminderResult.innerHTML = `<p class="reminder-result-warn">Network error. Please try again.</p>`;
  }
}

// Close on overlay click
reminderModal.addEventListener("click", (e) => {
  if (e.target === reminderModal) closeReminderModal();
});
modalCloseBtn.addEventListener("click", closeReminderModal);
modalCancelBtn.addEventListener("click", closeReminderModal);
sendRemindersBtn.addEventListener("click", sendReminders);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !reminderModal.hidden) closeReminderModal();
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
async function loadDashboard() {
  const [dashRes, configRes] = await Promise.all([
    fetch("/api/admin"),
    fetch("/api/admin/reminder-config"),
  ]);

  if (dashRes.status === 401) { window.location.href = "/admin-login.html"; return; }

  const data = await dashRes.json();
  dashboardData = data;

  if (configRes.ok) {
    applyReminderConfig(await configRes.json());
  }

  renderMetrics(data.participants);
  renderParticipants(data.participants);
  renderSlots(data.slots);
}

async function logout() {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin-login.html";
}

refreshButton.addEventListener("click", loadDashboard);
downloadCsvButton.addEventListener("click", downloadCsv);
logoutButton.addEventListener("click", logout);
loadDashboard();
