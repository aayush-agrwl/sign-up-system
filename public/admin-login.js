const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#login-message");

function showLoginMessage(text) {
  loginMessage.textContent = text;
  loginMessage.hidden = false;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: formData.get("password") }),
  });

  if (!response.ok) {
    const result = await response.json();
    showLoginMessage(result.error || "Login failed.");
    return;
  }

  window.location.href = "/admin.html";
});
