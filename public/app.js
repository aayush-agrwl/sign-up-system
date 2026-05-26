const screeningForm = document.querySelector("#screening-form");
const bookingForm = document.querySelector("#booking-form");
const slotsList = document.querySelector("#slots-list");
const message = document.querySelector("#eligibility-message");
const questionnaireSections = document.querySelector("#questionnaire-sections");

const questionnaire = [
  {
    title: "Education and study profile",
    fields: [
      {
        name: "employment",
        label: "What is your employment status?",
        type: "select",
        required: true,
        choices: ["Student", "Employed full-time", "Employed part-time", "Self employed", "Unemployed", "Other"],
      },
      {
        name: "field",
        label: "If you are a student, please select your major or primary field of study.",
        type: "select",
        required: true,
        choices: [
          "Biology",
          "Chemistry",
          "Computer Science",
          "Economics",
          "English",
          "Geography",
          "History",
          "International Relations",
          "Mathematics",
          "Media Studies/Communications",
          "Performing Arts",
          "Physics",
          "Political Science",
          "Psychology",
          "Sociology",
          "Other",
        ],
      },
      {
        name: "education",
        label: "What is the highest level of education you have completed?",
        type: "select",
        required: true,
        choices: [
          "No schooling completed",
          "Primary school",
          "Secondary school",
          "Bachelor's degree",
          "Master's degree",
          "Doctoral degree",
        ],
      },
    ],
  },
  {
    title: "Demographics",
    fields: [
      {
        name: "gender",
        label: "What is your gender?",
        type: "select",
        required: true,
        choices: ["Female", "Male", "Non-binary", "Transgender", "Prefer not to say", "Any other gender not listed here"],
      },
      {
        name: "religion",
        label: "What is your religion?",
        type: "select",
        choices: ["Hinduism", "Islam", "Christianity", "Jainism", "Sikhism", "Atheist", "Prefer not to say"],
      },
      {
        name: "state",
        label: "Please select the state or union territory you are based in.",
        type: "select",
        required: true,
        choices: [
          "Andaman and Nicobar Islands",
          "Andhra Pradesh",
          "Arunachal Pradesh",
          "Assam",
          "Bihar",
          "Chandigarh",
          "Chhattisgarh",
          "Delhi",
          "Goa",
          "Gujarat",
          "Haryana",
          "Karnataka",
          "Kerala",
          "Madhya Pradesh",
          "Maharashtra",
          "Odisha",
          "Punjab",
          "Rajasthan",
          "Tamil Nadu",
          "Telangana",
          "Uttar Pradesh",
          "West Bengal",
          "Other",
        ],
      },
      {
        name: "live",
        label: "Which best describes the general area where you live?",
        type: "select",
        required: true,
        choices: ["Urban", "Rural"],
      },
      {
        name: "caste",
        label: "What is your caste category?",
        type: "select",
        choices: ["Scheduled Caste (SC)", "Scheduled Tribe (ST)", "OBC", "General", "Other", "Does not apply to me", "Prefer not to say"],
      },
    ],
  },
  {
    title: "Participation logistics",
    fields: [
      { name: "personal_comp", label: "Do you have a personal computer, laptop, or tablet?", type: "select", required: true, choices: ["Yes", "No"] },
    ],
  },
];

let currentParticipant = null;

function showMessage(text, type = "info") {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
}

function clearSlots() {
  slotsList.innerHTML = "";
  bookingForm.hidden = true;
}

function createQuestionField(field) {
  const label = document.createElement("label");
  label.className = "question-field";
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

  screeningForm.querySelectorAll("[data-question]").forEach((field) => {
    responses[field.dataset.question] = {
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

function renderSlots(slots) {
  slotsList.innerHTML = "";

  if (slots.length === 0) {
    slotsList.innerHTML = "<p>No slots are currently available.</p>";
    bookingForm.hidden = false;
    bookingForm.querySelector("button").disabled = true;
    return;
  }

  bookingForm.querySelector("button").disabled = false;
  slots.forEach((slot) => {
    const label = document.createElement("label");
    label.className = "slot-option";
    label.innerHTML = `
      <input type="radio" name="slotId" value="${slot.id}" required>
      <span>
        <strong>${slot.label}</strong>
        <small>${slot.remaining} of ${slot.capacity} places remaining</small>
      </span>
    `;
    slotsList.append(label);
  });

  bookingForm.hidden = false;
}

screeningForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearSlots();

  const formData = new FormData(screeningForm);
  const age = Number(formData.get("age"));
  const enrolled = formData.get("enrolled") === "true";

  currentParticipant = {
    name: formData.get("name").trim(),
    phone: formData.get("phone").trim(),
    email: formData.get("email").trim(),
    age,
    enrolled,
    responses: collectQuestionResponses(formData),
  };

  if (age < 18 || age > 26 || !enrolled) {
    showMessage("Thank you for your interest. This study is only open to enrolled students aged 18-26.", "warning");
    return;
  }

  showMessage("You are eligible. Please choose one appointment slot.", "success");
  const response = await fetch("/api/slots");
  const slots = await response.json();
  renderSlots(slots);
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const selectedSlot = new FormData(bookingForm).get("slotId");
  if (!selectedSlot) {
    showMessage("Please choose one appointment slot.", "warning");
    return;
  }

  const response = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...currentParticipant, slotId: selectedSlot }),
  });

  const result = await response.json();
  if (!response.ok) {
    showMessage(result.error || "Something went wrong. Please try again.", "warning");
    return;
  }

  showMessage(result.message, "success");
  screeningForm.reset();
  clearSlots();
  currentParticipant = null;
});

renderQuestionnaire();
