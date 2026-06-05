const participantTable = document.querySelector("#participant-table");
const slotSummary = document.querySelector("#slot-summary");
const refreshButton = document.querySelector("#refresh-button");
const downloadCsvButton = document.querySelector("#download-csv-button");
const logoutButton = document.querySelector("#logout-button");
const totalParticipants = document.querySelector("#total-participants");
const totalAttended = document.querySelector("#total-attended");
const totalPending = document.querySelector("#total-pending");

// Slot creation elements
const toggleCreateSlotBtn = document.querySelector("#toggle-create-slot-btn");
const createSlotPanel = document.querySelector("#create-slot-panel");
const createSlotBtn = document.querySelector("#create-slot-btn");
const cancelCreateSlotBtn = document.querySelector("#cancel-create-slot-btn");
const createSlotMsg = document.querySelector("#create-slot-message");
const newSlotDate = document.querySelector("#new-slot-date");
const newSlotTime = document.querySelector("#new-slot-time");
const newSlotCapacity = document.querySelector("#new-slot-capacity");
const newSlotDescription = document.querySelector("#new-slot-description");

let dashboardData = {
  participants: [],
  slots: [],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

// All questions asked on the sign-up page, in the order they appear.
const RESPONSE_COLUMNS = [
  { key: "institution_name", label: "Institution name" },
  { key: "employment",       label: "Employment status" },
  { key: "field",            label: "Field of study" },
  { key: "education",        label: "Highest level of education" },
  { key: "gender",           label: "Gender" },
  { key: "personal_comp",    label: "Has personal computer / laptop / tablet" },
  { key: "future_studies",   label: "Open to future CSBC studies" },
];

function buildParticipantCsv(participants) {
  const headers = [
    "Participant ID",
    "Name",
    "Phone",
    "Email",
    "Age",
    "Enrolled in institution",
    "Appointment slot",
    "Attendance status",
    "Signed up at",
    ...RESPONSE_COLUMNS.map((c) => c.label),
  ];

  const rows = participants.map((p) => [
    p.id,
    p.name,
    p.phone,
    p.email,
    p.age,
    p.enrolled ? "Yes" : "No",
    p.slot,
    p.attendance,
    p.createdAt,
    ...RESPONSE_COLUMNS.map((c) => p.responses?.[c.key]?.value || ""),
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function downloadCsv() {
  const csv = buildParticipantCsv(dashboardData.participants);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `participant-bookings-${dateStamp}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatResponses(responses = {}) {
  const entries = Object.entries(responses).filter(([, response]) => response?.value);

  if (entries.length === 0) {
    return '<p class="empty-state">No questionnaire responses saved.</p>';
  }

  return `
    <dl class="response-list">
      ${entries
        .map(([, response]) => `
          <div>
            <dt>${escapeHtml(response.label)}</dt>
            <dd>${escapeHtml(response.value)}</dd>
          </div>
        `)
        .join("")}
    </dl>
  `;
}

async function updateAttendance(participantId, attendance) {
  const response = await fetch(`/api/attendance/${participantId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attendance }),
  });

  if (response.status === 401) {
    window.location.href = "/admin-login.html";
    return;
  }

  await loadDashboard();
}

function renderParticipants(participants) {
  participantTable.innerHTML = "";

  if (participants.length === 0) {
    participantTable.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">No participant bookings yet.</td>
      </tr>
    `;
    return;
  }

  participants.forEach((participant) => {
    const row = document.createElement("tr");
    if (participant.attendance === "deleted") row.classList.add("participant-deleted");
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
          <option value="deleted"${participant.attendance === "deleted" ? " selected" : ""}>Deleted from slot</option>
        </select>
      </td>
    `;

    const responseRow = document.createElement("tr");
    responseRow.id = `responses-${participant.id}`;
    responseRow.className = "response-row";
    responseRow.hidden = true;
    responseRow.innerHTML = `
      <td colspan="7">
        ${formatResponses(participant.responses)}
      </td>
    `;

    participantTable.append(row, responseRow);
  });

  participantTable.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => {
      updateAttendance(select.dataset.participantId, select.value);
    });
  });

  participantTable.querySelectorAll(".response-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const responseRow = document.querySelector(`#responses-${button.dataset.responseId}`);
      responseRow.hidden = !responseRow.hidden;
      button.textContent = responseRow.hidden ? "View responses" : "Hide responses";
    });
  });
}

function renderSlots(slots) {
  slotSummary.innerHTML = "";

  if (slots.length === 0) {
    slotSummary.innerHTML = `<p class="empty-state" style="padding:20px">No slots yet. Create one above.</p>`;
    return;
  }

  slots.forEach((slot) => {
    const percentFull = Math.round((slot.signupCount / slot.capacity) * 100);
    const canDelete = slot.signupCount === 0;
    const item = document.createElement("article");
    item.className = "slot-card";
    item.innerHTML = `
      <div class="slot-card-row">
        <div class="slot-card-info">
          <h3>${escapeHtml(slot.label)}</h3>
          <p>${slot.signupCount} signup${slot.signupCount === 1 ? "" : "s"} &middot; ${slot.remaining} of ${slot.capacity} open</p>
        </div>
        <button
          class="slot-delete-btn"
          data-slot-id="${slot.id}"
          title="${canDelete ? "Delete this slot" : "Cannot delete — participants are booked"}"
          ${canDelete ? "" : "disabled"}
          aria-label="Delete slot"
        >&times;</button>
      </div>
      <div class="progress" aria-label="${percentFull}% full">
        <span style="width: ${percentFull}%"></span>
      </div>
    `;
    slotSummary.append(item);
  });

  slotSummary.querySelectorAll(".slot-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteSlot(Number(btn.dataset.slotId)));
  });
}

// ---------------------------------------------------------------------------
// Slot creation
// ---------------------------------------------------------------------------
function setCreateSlotPanelVisible(visible) {
  createSlotPanel.hidden = !visible;
  toggleCreateSlotBtn.textContent = visible ? "Cancel" : "+ New slot";
  if (visible) {
    // Pre-fill date to today
    if (!newSlotDate.value) {
      newSlotDate.value = new Date().toISOString().slice(0, 10);
    }
    newSlotDate.focus();
  }
}

function showCreateMsg(text, isError = false) {
  createSlotMsg.textContent = text;
  createSlotMsg.className = `create-slot-msg ${isError ? "create-slot-msg--error" : "create-slot-msg--ok"}`;
  createSlotMsg.hidden = false;
}

async function createSlot() {
  const date = newSlotDate.value.trim();
  const time = newSlotTime.value.trim();
  const capacity = newSlotCapacity.value;
  const description = newSlotDescription.value.trim();

  if (!date || !time) {
    showCreateMsg("Please set both a date and a time.", true);
    return;
  }

  createSlotBtn.classList.add("loading");
  createSlotBtn.disabled = true;
  createSlotMsg.hidden = true;

  try {
    const res = await fetch("/api/admin/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, time, capacity: Number(capacity), description }),
    });
    const data = await res.json();
    createSlotBtn.classList.remove("loading");
    createSlotBtn.disabled = false;

    if (!res.ok) {
      showCreateMsg(data.error || "Could not create slot.", true);
      return;
    }

    // Reset form and collapse panel
    newSlotDate.value = "";
    newSlotTime.value = "";
    newSlotCapacity.value = "4";
    newSlotDescription.value = "";
    createSlotMsg.hidden = true;
    setCreateSlotPanelVisible(false);
    await loadDashboard();
  } catch {
    createSlotBtn.classList.remove("loading");
    createSlotBtn.disabled = false;
    showCreateMsg("Network error. Please try again.", true);
  }
}

async function deleteSlot(slotId) {
  if (!confirm("Delete this slot? This cannot be undone.")) return;

  try {
    const res = await fetch(`/api/admin/slots/${slotId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Could not delete slot.");
      return;
    }
    await loadDashboard();
  } catch {
    alert("Network error. Please try again.");
  }
}

function renderMetrics(participants) {
  totalParticipants.textContent = participants.length;
  totalAttended.textContent = participants.filter((participant) => participant.attendance === "attended").length;
  totalPending.textContent = participants.filter((participant) => participant.attendance === "pending").length;
}

async function loadDashboard() {
  const response = await fetch("/api/admin");
  if (response.status === 401) {
    window.location.href = "/admin-login.html";
    return;
  }

  const data = await response.json();
  dashboardData = data;

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

toggleCreateSlotBtn.addEventListener("click", () =>
  setCreateSlotPanelVisible(createSlotPanel.hidden)
);
cancelCreateSlotBtn.addEventListener("click", () => setCreateSlotPanelVisible(false));
createSlotBtn.addEventListener("click", createSlot);

loadDashboard();
