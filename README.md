# Research Participant Booking App

A beginner-friendly web app for screening research participants, showing eligible users available appointment slots, saving bookings, and tracking signups from an admin dashboard.

## Project Overview

This app supports research participant recruitment by combining eligibility screening, questionnaire collection, and appointment booking in one local web tool. Participants read the study information, complete contact and screening questions, confirm eligibility, and select an available session slot. Admin users log in with a server-side password to review bookings, track attendance, inspect questionnaire responses, and export participant data as CSV.

Key features include age and enrollment eligibility checks, mobile-friendly participant forms, password-protected admin access, attendance tracking, slot signup summaries, participant self-service cancellation/rescheduling, and Excel/Google Sheets-friendly CSV export. The app uses beginner-friendly technologies: HTML, CSS, plain JavaScript, Node.js, SQLite for local runs, and Neon Postgres for Vercel deployments.

## Requirements

- Node.js 24 or newer
- No package installation is required

## Folder Structure

```text
participant booking app/
├── public/
│   ├── index.html      # Participant landing page, study info, screening, and booking form
│   ├── admin.html      # Admin dashboard page
│   ├── admin-login.html # Password page for admin access
│   ├── app.js          # Browser code for the adapted questionnaire, eligibility checks, and booking
│   ├── admin.js        # Browser code for dashboard data, response details, and attendance updates
│   ├── admin-login.js   # Browser code for admin login
│   └── styles.css      # Shared clean modern styling
├── data/
│   ├── .gitkeep        # Keeps the folder in the shared project
│   └── booking.db      # Local SQLite database, created automatically and ignored by Git
├── .gitignore          # Excludes local data, secrets, dependencies, logs, and system files
├── server.js           # Local Node server, API routes, static file hosting, SQLite setup
├── api/index.js        # Vercel serverless API backed by Neon Postgres
├── vercel.json         # Vercel static/API routing
└── README.md           # Setup and usage notes
```

## How to Run Locally

1. Open a terminal in this folder.
2. Start the app with an admin password:

Mac/Linux:

```bash
ADMIN_PASSWORD="choose-a-strong-password" node --no-warnings server.js
```

Windows PowerShell:

```powershell
$env:ADMIN_PASSWORD="choose-a-strong-password"; node --no-warnings server.js
```

3. Open the participant booking page:

```text
http://localhost:3000
```

4. Open the admin dashboard:

```text
http://localhost:3000/admin.html
```

5. Enter the password you used in `ADMIN_PASSWORD`.

## How It Works

- The participant page explains the study and asks for name, phone number, email, eligibility details, and demographic/logistics questions.
- Users can continue only if they are 18-35, currently enrolled in an educational institution, and have access to a personal computer, laptop, or tablet.
- Eligible users see open appointment slots and can choose one slot.
- After booking, participants can cancel their booking or reschedule into another available slot.
- Bookings and questionnaire responses are stored locally in `data/booking.db`.
- The admin dashboard shows all participants, phone/email contact details, expandable questionnaire responses, signup counts per slot, slot creation/deletion controls, and an attendance dropdown for each participant.
- Use the admin dashboard's `Download CSV` button to export participant details, appointment slot, attendance status, and questionnaire responses for Excel or Google Sheets.
- The admin dashboard and admin APIs require the server-side `ADMIN_PASSWORD`.
- The local database file is created at `data/booking.db` the first time the app runs.
- `data/booking.db` is ignored by Git so participant data is not accidentally shared.

## Changing the Admin Password

Stop the server, then start it again with a new password:

```bash
ADMIN_PASSWORD="new-password-here" node --no-warnings server.js
```

The password is not stored in frontend JavaScript. It is read by `server.js` from the server environment when the app starts.

## Sharing the Project

Before sharing, include the project files but do not include local data or secrets.

Safe to share:

- `server.js`
- `public/`
- `README.md`
- `.gitignore`
- `data/.gitkeep`

Do not share:

- `data/booking.db`
- `.env` files
- system files such as `.DS_Store`
- dependency folders such as `node_modules/`

## Technology Choices

- HTML, CSS, and plain JavaScript for the browser interface.
- Node.js for the local server.
- SQLite for the local database.
- No extra packages are required.

Note: this uses Node's built-in SQLite module, which is available in recent Node versions. If your Node version is older, install a current Node release before running the app.
