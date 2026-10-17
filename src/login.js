import { isSupabaseConfigured, supabase } from "./supabase.js";
import { emailForUsername } from "./identities.js";

const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const submit = document.getElementById("loginButton");
const password = document.getElementById("password");
const toggle = document.getElementById("togglePassword");

function status(text, kind = "error") {
  message.textContent = text;
  message.dataset.kind = kind;
  message.classList.add("show");
}

toggle.addEventListener("click", () => {
  const showing = password.type === "text";
  password.type = showing ? "password" : "text";
  toggle.setAttribute("aria-pressed", String(!showing));
  toggle.setAttribute("aria-label", showing ? "Mostrar senha" : "Ocultar senha");
});

if (!isSupabaseConfigured || !supabase) {
  status("O login não está configurado. Confira config.js.");
} else {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) window.location.replace("home.html");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim().toLowerCase();
    const secret = String(formData.get("password") || "");
    const email = emailForUsername(username);
    message.classList.remove("show");
    if (!email || !secret) {
      status("Usuário ou senha incorretos.");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Entrando…";
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: secret });
      if (error) throw error;
      window.location.replace("home.html");
    } catch (error) {
      status(/invalid login credentials/i.test(String(error?.message || ""))
        ? "Usuário ou senha incorretos."
        : "Não foi possível entrar. Confira a conexão e tente novamente.");
      submit.disabled = false;
      submit.textContent = "Avante!";
    }
  });
}
