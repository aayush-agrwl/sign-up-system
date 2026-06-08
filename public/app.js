const screeningForm = document.querySelector("#screening-form");
const bookingForm = document.querySelector("#booking-form");
const slotsList = document.querySelector("#slots-list");
const message = document.querySelector("#eligibility-message");
const questionnaireSections = document.querySelector("#questionnaire-sections");
const successModal = document.querySelector("#booking-success-modal");
const confirmationName = document.querySelector("#confirmation-name");
const confirmationEmail = document.querySelector("#confirmation-email");
const confirmationPhone = document.querySelector("#confirmation-phone");
const confirmationSlot = document.querySelector("#confirmation-slot");
const managementMessage = document.querySelector("#booking-management-message");
const cancelBookingButton = document.querySelector("#cancel-booking-button");
const rescheduleBookingButton = document.querySelector("#reschedule-booking-button");

const questionnaire = [
  {
    title: "Demographics",
    fields: [
      {
        name: "gender",
        label: "Gender",
        type: "select",
        required: true,
        choices: ["Female", "Male", "Non-binary", "Transgender", "Prefer not to say", "Any other gender not listed here"],
      },
    ],
  },
  {
    title: "Participation logistics",
    fields: [
      {
        name: "personal_comp",
        label: "Do you have a personal computer, laptop, or tablet?",
        type: "select",
        required: true,
        choices: ["Yes", "No"],
      },
      {
        name: "future_studies",
        label: "Would you like to be invited to participate in future CSBC studies?",
        type: "select",
        required: true,
        choices: ["Yes", "No"],
      },
    ],
  },
];

let currentParticipant = null;
let activeBooking = null;

const checkSVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const calendarSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

function setButtonLoading(btn, loading) {
  if (loading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

function showMessage(text, type = "info") {
  if (Array.isArray(text)) {
    message.innerHTML = `
      <p>${text.length > 1 ? "Thank you for your interest. This study is currently limited to participants who meet these requirements:" : "Thank you for your interest. This study is currently limited to participants who meet this requirement:"}</p>
      <ul>${text.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
    `;
  } else {
    message.textContent = text;
  }
  message.className = `message ${type}`;
  message.hidden = false;
  message.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showManagementMessage(text, type = "info") {
  managementMessage.textContent = text;
  managementMessage.className = `message ${type}`;
  managementMessage.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearSlots() {
  slotsList.innerHTML = "";
  bookingForm.hidden = true;
}

// Returns a choice-card group for fields with ≤3 options, otherwise a styled select
function createQuestionField(field) {
  const useCards = field.type === "select" && field.choices && field.choices.length <= 3;

  if (useCards) {
    const wrapper = document.createElement("div");
    wrapper.className = "wide-field";

    const labelEl = document.createElement("span");
    labelEl.className = "field-label";
    labelEl.textContent = field.label;
    wrapper.append(labelEl);

    const group = document.createElement("div");
    group.className = "choice-group";
    group.setAttribute("role", "group");

    field.choices.forEach((choice) => {
      const card = document.createElement("label");
      card.className = "choice-card";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = field.name;
      input.value = choice;
      input.dataset.question = field.name;
      input.dataset.label = field.label;
      if (field.required) input.required = true;

      const span = document.createElement("span");
      span.textContent = choice;

      card.append(input, span);
      group.append(card);
    });

    wrapper.append(group);
    return wrapper;
  }

  // Standard label + select/input
  const label = document.createElement("label");
  label.dataset.questionName = field.name;

  const labelText = document.createElement("span");
  labelText.className = "question-label";
  labelText.textContent = field.label;
  label.append(labelText);

  if (field.type === "select") {
    const select = document.createElement("select");
    select.name = field.name;
    select.dataset.question = field.name;
    select.dataset.label = field.label;
    select.required = Boolean(field.required);
    select.append(new Option("Choose one", ""));
    field.choices.forEach((choice) => select.append(new Option(choice, choice)));
    label.append(select);
    return label;
  }

  const input = document.createElement("input");
  input.type = field.type || "text";
  input.name = field.name;
  input.dataset.question = field.name;
  input.dataset.label = field.label;
  input.required = Boolean(field.required);
  input.placeholder = field.placeholder || "";
  label.append(input);
  return label;
}

function renderQuestionnaire() {
  questionnaire.forEach((section) => {
    const wrapper = document.createElement("section");
    wrapper.className = "question-section";

    const heading = document.createElement("h3");
    heading.textContent = section.title;
    wrapper.append(heading);

    const grid = document.createElement("div");
    grid.className = "form-grid";
    section.fields.forEach((field) => grid.append(createQuestionField(field)));
    wrapper.append(grid);
    questionnaireSections.append(wrapper);
  });
}

function collectQuestionResponses(formData) {
  const responses = {};
  const seen = new Set();

  screeningForm.querySelectorAll("[data-question]").forEach((field) => {
    const name = field.dataset.question;
    if (seen.has(name)) return;
    seen.add(name);
    responses[name] = {
      label: field.dataset.label,
      value: formData.get(field.name) || "",
    };
  });

  responses.institution_name = {
    label: "Institution name",
    value: formData.get("institution_name") || "",
  };

  return responses;
}

// ── Slot calendar ───────────────────────────────────────────────────────────

const HOUR_PX  = 64;  // pixels per hour in the calendar grid
const SLOT_H   = 60;  // fixed height of each slot block in px
const DAY_ABB  = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MONTH_MAP = {
  January:0, February:1, March:2, April:3, May:4, June:5,
  July:6, August:7, September:8, October:9, November:10, December:11,
};

/** Parse the label built by buildSlotLabel() → Date, or null on failure. */
function parseSlotDt(label) {
  const m = label.match(/\w+, (\w+) (\d+) at (\d+):(\d+) (AM|PM)/);
  if (!m) return null;
  const [, mName, dayStr, hStr, minStr, ampm] = m;
  let h = Number(hStr);
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  const mIdx = MONTH_MAP[mName];
  if (mIdx === undefined) return null;
  const now  = new Date();
  let   yr   = now.getFullYear();
  const cand = new Date(yr, mIdx, Number(dayStr));
  // bump to next year if the date is clearly in the past
  if (cand < now && now - cand > 86_400_000) yr++;
  return new Date(yr, mIdx, Number(dayStr), h, Number(minStr));
}

/** Calendar-view slot picker (primary). */
function renderSlots(slots) {
  slotsList.innerHTML = "";
  const submitBtn = bookingForm.querySelector("button[type='submit']");

  if (slots.length === 0) {
    slotsList.innerHTML = `<p class="empty-state">No appointment slots are currently available. Please check back later.</p>`;
    bookingForm.hidden = false;
    submitBtn.disabled = true;
    return;
  }
  submitBtn.disabled = false;

  // Parse datetimes; fall back to list if any label can't be parsed
  const withDt = slots.map(s => ({ ...s, dt: parseSlotDt(s.label) }));
  if (!withDt.every(s => s.dt)) { renderSlotList(slots); return; }

  withDt.sort((a, b) => a.dt - b.dt);

  // Group by calendar day
  const dayMap = new Map();
  withDt.forEach(s => {
    const key = s.dt.toDateString();
    if (!dayMap.has(key)) dayMap.set(key, { dt: s.dt, slots: [] });
    dayMap.get(key).slots.push(s);
  });
  const days    = [...dayMap.values()];
  const numDays = days.length;
  const todayStr = new Date().toDateString();

  // Hour range: earliest slot − 1 h  →  latest slot + 2 h
  const hrs       = withDt.map(s => s.dt.getHours());
  const startHour = Math.max(0,  Math.min(...hrs) - 1);
  const endHour   = Math.min(23, Math.max(...hrs) + 2);
  const numHours  = endHour - startHour;
  const gridH     = numHours * HOUR_PX;

  // ── Header ──────────────────────────────────────────────────────
  let hdr = `<div class="cal-ghdr"></div>`;
  days.forEach(({ dt }) => {
    const isToday = dt.toDateString() === todayStr;
    hdr += `
      <div class="cal-dhdr${isToday ? " is-today" : ""}">
        <span class="cal-dname">${DAY_ABB[dt.getDay()]}</span>
        <span class="cal-dnum${isToday ? " today-pill" : ""}">${dt.getDate()}</span>
      </div>`;
  });

  // ── Time gutter ──────────────────────────────────────────────────
  let gutter = "";
  for (let h = startHour; h < endHour; h++) {
    const lbl = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
    gutter += `<div class="cal-hlbl" style="height:${HOUR_PX}px">${lbl}</div>`;
  }

  // ── Day columns ──────────────────────────────────────────────────
  let cols = "";
  days.forEach(({ slots: ds }) => {
    let inner = "";
    for (let h = 0; h < numHours; h++) {
      inner += `<div class="cal-hline" style="top:${h * HOUR_PX}px"></div>`;
    }
    ds.forEach(slot => {
      const top    = ((slot.dt.getHours() - startHour) + slot.dt.getMinutes() / 60) * HOUR_PX;
      const filled = slot.capacity - slot.remaining;
      const timeStr = slot.label.match(/at (.+?)( ·|$)/)?.[1] ?? "";
      const dots   = Array.from({ length: slot.capacity }, (_, i) =>
        `<span class="cal-dot${i < filled ? " on" : ""}"></span>`
      ).join("");
      inner += `
        <label class="cal-slot" style="top:${top}px;height:${SLOT_H}px" title="${escapeHtml(slot.label)}">
          <input type="radio" name="slotId" value="${slot.id}" required>
          <span class="cal-st">${escapeHtml(timeStr)}</span>
          <span class="cal-ss">${slot.remaining} of ${slot.capacity} open</span>
          <span class="cal-dots">${dots}</span>
        </label>`;
    });
    cols += `<div class="cal-dcol" style="height:${gridH}px">${inner}</div>`;
  });

  slotsList.innerHTML = `
    <div class="slot-cal" style="--nd:${numDays}">
      ${hdr}
      <div class="cal-gutter">${gutter}</div>
      ${cols}
    </div>`;

  // Keep .selected class in sync for browsers without :has() support
  slotsList.querySelectorAll(".cal-slot input[type='radio']").forEach(inp => {
    inp.addEventListener("change", () => {
      slotsList.querySelectorAll(".cal-slot").forEach(b => b.classList.remove("selected"));
      inp.closest(".cal-slot").classList.add("selected");
    });
  });

  bookingForm.hidden = false;
  bookingForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** Fallback list-view (used if any slot label can't be parsed as a date). */
function renderSlotList(slots) {
  function buildCapacityDots(remaining, capacity) {
    const filled = capacity - remaining;
    return Array.from({ length: capacity }, (_, i) =>
      `<span class="capacity-dot${i < filled ? " filled" : ""}"></span>`
    ).join("");
  }

  slots.forEach((slot) => {
    const label = document.createElement("label");
    label.className = "slot-option";
    label.innerHTML = `
      <input type="radio" name="slotId" value="${slot.id}" required>
      <span class="slot-indicator">${checkSVG}</span>
      <span class="slot-info">
        <strong>${escapeHtml(slot.label)}</strong>
        <span class="slot-meta">
          ${calendarSVG}
          <small>${slot.remaining} of ${slot.capacity} spots remaining &nbsp;
            <span class="slot-capacity">${buildCapacityDots(slot.remaining, slot.capacity)}</span>
          </small>
        </span>
      </span>
    `;
    slotsList.append(label);
  });

  bookingForm.hidden = false;
  bookingForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function getEligibilityIssues({ age, enrolled, personalComputer }) {
  const issues = [];

  if (age < 18 || age > 35 || !Number.isInteger(age)) {
    issues.push("You must be between 18 and 35 years old.");
  }

  if (!enrolled) {
    issues.push("You must currently be enrolled in an educational institution.");
  }

  if (personalComputer !== "Yes") {
    issues.push("You must have access to a personal computer, laptop, or tablet.");
  }

  return issues;
}

async function loadAndShowSlots(messageText = "Please choose a session slot below.") {
  const response = await fetch("/api/slots");
  const slots = await response.json();
  showMessage(messageText, "success");
  renderSlots(slots);
}

function showBookingConfirmation(booking) {
  activeBooking = booking;
  confirmationName.textContent = booking.name;
  confirmationEmail.textContent = booking.email;
  confirmationPhone.textContent = booking.phone;
  confirmationSlot.textContent = booking.slot;
  managementMessage.hidden = true;
  cancelBookingButton.disabled = false;
  rescheduleBookingButton.disabled = false;
  successModal.hidden = false;
}

async function cancelActiveBooking({ keepParticipantForReschedule = false } = {}) {
  if (!activeBooking) return false;

  const response = await fetch(`/api/bookings/${activeBooking.id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: activeBooking.email,
      phone: activeBooking.phone,
    }),
  });
  const result = await response.json();

  if (!response.ok) {
    showManagementMessage(result.error || "Could not cancel this booking. Please try again.", "warning");
    return false;
  }

  const cancelledBooking = activeBooking;
  activeBooking = null;

  if (!keepParticipantForReschedule) {
    currentParticipant = null;
    cancelBookingButton.disabled = true;
    rescheduleBookingButton.disabled = true;
  } else {
    currentParticipant = {
      name: cancelledBooking.name,
      phone: cancelledBooking.phone,
      email: cancelledBooking.email,
      age: cancelledBooking.age,
      enrolled: cancelledBooking.enrolled,
      responses: cancelledBooking.responses || {},
      replaceBookingId: cancelledBooking.id,
    };
  }

  return true;
}

screeningForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearSlots();

  const submitBtn = screeningForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true);

  const formData = new FormData(screeningForm);
  const age = Number(formData.get("age"));
  const enrolled = formData.get("enrolled") === "true";
  const personalComputer = formData.get("personal_comp");

  currentParticipant = {
    name: formData.get("name").trim(),
    phone: formData.get("phone").trim(),
    email: formData.get("email").trim(),
    age,
    enrolled,
    responses: collectQuestionResponses(formData),
  };

  if (!/^[0-9]{10}$/.test(currentParticipant.phone)) {
    setButtonLoading(submitBtn, false);
    showMessage("Please enter a valid 10-digit mobile number.", "warning");
    return;
  }

  const eligibilityIssues = getEligibilityIssues({ age, enrolled, personalComputer });
  if (eligibilityIssues.length > 0) {
    setButtonLoading(submitBtn, false);
    showMessage(eligibilityIssues, "warning");
    return;
  }

  try {
    await loadAndShowSlots("You are eligible. Please choose a session slot below.");
    setButtonLoading(submitBtn, false);
  } catch {
    setButtonLoading(submitBtn, false);
    showMessage("Could not load available slots. Please try again.", "warning");
  }
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const selectedSlot = new FormData(bookingForm).get("slotId");
  if (!selectedSlot) {
    showMessage("Please choose a session slot before confirming.", "warning");
    return;
  }

  const submitBtn = bookingForm.querySelector("button[type='submit']");
  setButtonLoading(submitBtn, true);

  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...currentParticipant, slotId: selectedSlot }),
    });

    const result = await response.json();
    setButtonLoading(submitBtn, false);

    if (!response.ok) {
      showMessage(result.error || "Something went wrong. Please try again.", "warning");
      return;
    }

    screeningForm.reset();
    clearSlots();
    currentParticipant = null;
    message.hidden = true;
    showBookingConfirmation(result.booking);
  } catch {
    setButtonLoading(submitBtn, false);
    showMessage("Could not complete the booking. Please try again.", "warning");
  }
});

cancelBookingButton.addEventListener("click", async () => {
  if (!activeBooking) return;
  if (!confirm("Are you sure you want to cancel this booking?")) return;

  cancelBookingButton.disabled = true;
  rescheduleBookingButton.disabled = true;
  const cancelled = await cancelActiveBooking();

  if (cancelled) {
    showManagementMessage("Your booking has been cancelled. The slot is now available for someone else.", "success");
  } else {
    cancelBookingButton.disabled = false;
    rescheduleBookingButton.disabled = false;
  }
});

rescheduleBookingButton.addEventListener("click", async () => {
  if (!activeBooking) return;
  if (!confirm("Reschedule this booking? Your current slot will be released before you choose a new one.")) return;

  cancelBookingButton.disabled = true;
  rescheduleBookingButton.disabled = true;
  const cancelled = await cancelActiveBooking({ keepParticipantForReschedule: true });

  if (!cancelled) {
    cancelBookingButton.disabled = false;
    rescheduleBookingButton.disabled = false;
    return;
  }

  successModal.hidden = true;
  try {
    await loadAndShowSlots("Your previous booking was cancelled. Please choose a new session slot.");
  } catch {
    showMessage("Your previous booking was cancelled, but available slots could not be loaded. Please try again.", "warning");
  }
});

renderQuestionnaire();
