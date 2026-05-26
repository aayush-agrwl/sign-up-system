const participantTable = document.querySelector("#participant-table");
const slotSummary = document.querySelector("#slot-summary");
const refreshButton = document.querySelector("#refresh-button");
const downloadCsvButton = document.querySelector("#download-csv-button");
const logoutButton = document.querySelector("#logout-button");
const totalParticipants = document.querySelector("#total-participants");
const totalAttended = document.querySelector("#total-attended");
const totalPending = document.querySelector("#total-pending");

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

function responseColumns(participants) {
  const columns = new Map();

  participants.forEach((participant) => {
    Object.entries(participant.responses || {}).forEach(([key, response]) => {
      if (!columns.has(key)) {
        columns.set(key, response?.label || key);
      }
    });
  });

  return columns;
}

function buildParticipantCsv(participants) {
  const questionColumns = responseColumns(participants);
  const headers = [
    "Participant ID",
    "Name",
    "Phone",
    "Email",
    "Age",
    "Enrolled in Institution",
    "Appointment Slot",
    "Attendance Status",
    "Created At",
    ...questionColumns.values(),
  ];

  const rows = participants.map((participant) => {
    const answers = [...questionColumns.keys()].map((key) => participant.responses?.[key]?.value || "");
    return [
      participant.id,
      participant.name,
      participant.phone,
      participant.email,
      participant.age,
      participant.enrolled ? "Yes" : "No",
      participant.slot,
      participant.attendance,
      participant.createdAt,
      ...answers,
    ];
  });

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

  slots.forEach((slot) => {
    const percentFull = Math.round((slot.signupCount / slot.capacity) * 100);
    const item = document.createElement("article");
    item.className = "slot-card";
    item.innerHTML = `
      <div>
        <h3>${escapeHtml(slot.label)}</h3>
        <p>${slot.signupCount} signup${slot.signupCount === 1 ? "" : "s"} · ${slot.remaining} open</p>
      </div>
      <div class="progress" aria-label="${percentFull}% full">
        <span style="width: ${percentFull}%"></span>
      </div>
    `;
    slotSummary.append(item);
  });
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
loadDashboard();
