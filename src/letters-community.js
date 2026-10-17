const passwordIterations = 310000;
const maxBodyLength = 5000;
const encoder = new TextEncoder();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeBase64Url(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function passwordKey(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error("Criptografia segura indisponível neste navegador.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: passwordIterations, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}
function letterAad(subject) {
  return encoder.encode("looply:community-letter:v1:" + subject);
}
export async function sealLetter(body, password, subject) {
  const text = String(body || "").trim();
  const secret = String(password || "");
  const cleanSubject = String(subject || "").trim();
  if (!text || text.length > maxBodyLength) throw new Error("A carta deve ter entre 1 e 5.000 caracteres.");
  if (secret.length < 8 || secret.length > 256) throw new Error("Use uma senha de 8 a 256 caracteres.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(secret, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: letterAad(cleanSubject) }, key, encoder.encode(text)
  );
  return {
    body: null, password_salt: encodeBase64Url(salt), password_iv: encodeBase64Url(iv),
    password_ciphertext: encodeBase64Url(new Uint8Array(ciphertext))
  };
}
export async function openProtectedLetter(letter, password) {
  try {
    const key = await passwordKey(String(password || ""), decodeBase64Url(letter.password_salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(letter.password_iv), additionalData: letterAad(String(letter.subject || "")) },
      key, decodeBase64Url(letter.password_ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Senha incorreta.");
  }
}
function displayName(profile) {
  return String(profile?.display_name || profile?.username || "Perfil");
}
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function rowMarkup(letter, own) {
  const peer = own ? letter.recipient : letter.sender;
  return "<article class=\"community-letter-row\"><div class=\"community-letter-meta\"><strong>" + escapeHtml(letter.subject) +
    "</strong><span>" + (own ? "Para " : "De ") + escapeHtml(displayName(peer)) +
    (letter.is_protected ? " · protegida por senha" : "") + " · " + escapeHtml(dateLabel(letter.created_at)) + "</span></div>" +
    "<button class=\"text-button\" type=\"button\" data-open-community-letter=\"" + escapeHtml(letter.id) + "\">" +
    (letter.is_protected ? "Desbloquear" : "Ler carta") + "</button></article>";
}
export async function loadCommunityLetters(client, userId) {
  const { data, error } = await client.from("community_letters")
    .select("id,sender_id,recipient_id,subject,body,is_protected,password_salt,password_iv,password_ciphertext,created_at,sender:profiles!community_letters_sender_id_fkey(username,display_name),recipient:profiles!community_letters_recipient_id_fkey(username,display_name)")
    .or("sender_id.eq." + userId + ",recipient_id.eq." + userId)
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return data || [];
}
function rowsMarkup(letters, userId, own) {
  const rows = letters.filter((letter) => own ? letter.sender_id === userId : letter.recipient_id === userId);
  if (!rows.length) return "<p class=\"community-letters-empty\">Nenhuma carta " + (own ? "enviada." : "recebida.") + "</p>";
  return rows.map((letter) => rowMarkup(letter, own)).join("");
}
export function communityLettersMarkup(letters, profiles, userId) {
  const options = (profiles || []).filter((profile) => profile.id !== userId)
    .map((profile) => "<option value=\"" + escapeHtml(profile.id) + "\">" + escapeHtml(displayName(profile)) +
      " (@" + escapeHtml(profile.username) + ")</option>").join("");
  return "<section class=\"panel community-letter-compose-panel\" aria-labelledby=\"communityLetterComposeTitle\">" +
    "<div class=\"community-letter-heading\"><div><span class=\"section-kicker\">Cartas</span><h2 id=\"communityLetterComposeTitle\">Escrever carta</h2></div></div>" +
    "<form class=\"community-letter-form\" data-community-letter-compose>" +
      "<label>Destinatário<select name=\"recipient_id\" required><option value=\"\" disabled selected>Selecione um destinatário</option><option value=\"all\">Todos os usuários</option>" + options + "</select></label>" +
      "<label>Assunto<input name=\"subject\" maxlength=\"120\" required></label>" +
      "<label>Mensagem<textarea name=\"body\" rows=\"5\" maxlength=\"5000\" required></textarea></label>" +
      "<label class=\"community-letter-protect\"><input type=\"checkbox\" name=\"is_protected\" data-letter-protected> Proteger a carta com senha</label>" +
      "<label data-letter-password-wrap hidden>Senha da carta<input name=\"password\" type=\"password\" minlength=\"8\" maxlength=\"256\" autocomplete=\"new-password\" data-letter-password disabled></label>" +
      "<button class=\"primary-button compact-button\" type=\"submit\">Enviar carta</button>" +
      "<p class=\"form-status\" data-community-letter-compose-status role=\"status\" aria-live=\"polite\"></p>" +
    "</form></section>" +
    "<section class=\"panel community-letter-collection\" aria-labelledby=\"communityReceivedLettersTitle\"><div class=\"community-letter-heading\"><div><span class=\"section-kicker\">Coleção</span><h2 id=\"communityReceivedLettersTitle\">Minhas Cartas · recebidas</h2></div><span data-letter-count=\"received\">" +
      letters.filter((letter) => letter.recipient_id === userId).length + "</span></div><div class=\"community-letter-list\" data-community-letter-received>" + rowsMarkup(letters, userId, false) + "</div></section>" +
    "<section class=\"panel community-letter-collection\" aria-labelledby=\"communitySentLettersTitle\"><div class=\"community-letter-heading\"><div><span class=\"section-kicker\">Arquivo</span><h2 id=\"communitySentLettersTitle\">Cartas enviadas</h2></div><span data-letter-count=\"sent\">" +
      letters.filter((letter) => letter.sender_id === userId).length + "</span></div><div class=\"community-letter-list\" data-community-letter-sent>" + rowsMarkup(letters, userId, true) + "</div></section>" +
    "<dialog class=\"community-letter-dialog\" data-community-letter-dialog aria-labelledby=\"communityLetterDialogTitle\"><div class=\"community-letter-dialog-card\">" +
      "<button type=\"button\" class=\"icon-action community-letter-close\" data-close-community-letter aria-label=\"Fechar carta\">×</button>" +
      "<span class=\"section-kicker\">Carta</span><h2 id=\"communityLetterDialogTitle\" data-community-letter-title></h2><p data-community-letter-byline></p>" +
      "<form data-community-letter-unlock hidden><label>Senha da carta<input type=\"password\" name=\"password\" autocomplete=\"current-password\" required></label>" +
      "<button class=\"primary-button compact-button\" type=\"submit\">Desbloquear</button><p class=\"form-status\" data-community-letter-unlock-status role=\"status\" aria-live=\"polite\"></p></form>" +
      "<pre class=\"community-letter-body\" data-community-letter-body hidden></pre></div></dialog>";
}
export function bindCommunityLetters(root, client, user, profiles, initialLetters) {
  let letters = [...initialLetters];
  let activeLetter = null;
  const dialog = root.querySelector("[data-community-letter-dialog]");
  const renderLists = () => {
    const received = root.querySelector("[data-community-letter-received]");
    const sent = root.querySelector("[data-community-letter-sent]");
    if (received) received.innerHTML = rowsMarkup(letters, user.id, false);
    if (sent) sent.innerHTML = rowsMarkup(letters, user.id, true);
    const receivedCount = root.querySelector('[data-letter-count="received"]');
    const sentCount = root.querySelector('[data-letter-count="sent"]');
    if (receivedCount) receivedCount.textContent = String(letters.filter((letter) => letter.recipient_id === user.id).length);
    if (sentCount) sentCount.textContent = String(letters.filter((letter) => letter.sender_id === user.id).length);
  };
  const reload = async () => { letters = await loadCommunityLetters(client, user.id); renderLists(); };
  const protect = root.querySelector("[data-letter-protected]");
  const passwordWrap = root.querySelector("[data-letter-password-wrap]");
  const passwordInput = root.querySelector("[data-letter-password]");
  protect?.addEventListener("change", () => {
    const enabled = protect.checked;
    passwordWrap.hidden = !enabled;
    passwordInput.disabled = !enabled;
    passwordInput.required = enabled;
  });
  root.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close-community-letter]");
    if (close) { dialog?.close(); return; }
    const button = event.target.closest("[data-open-community-letter]");
    if (!button) return;
    activeLetter = letters.find((letter) => letter.id === button.dataset.openCommunityLetter);
    if (!activeLetter || !dialog) return;
    root.querySelector("[data-community-letter-title]").textContent = activeLetter.subject;
    const peer = activeLetter.sender_id === user.id ? activeLetter.recipient : activeLetter.sender;
    root.querySelector("[data-community-letter-byline]").textContent =
      (activeLetter.sender_id === user.id ? "Para " : "De ") + displayName(peer) + " · " + dateLabel(activeLetter.created_at);
    const unlockForm = root.querySelector("[data-community-letter-unlock]");
    const body = root.querySelector("[data-community-letter-body]");
    unlockForm.hidden = !activeLetter.is_protected;
    unlockForm.reset();
    root.querySelector("[data-community-letter-unlock-status]").textContent = "";
    body.hidden = Boolean(activeLetter.is_protected);
    body.textContent = activeLetter.is_protected ? "" : (activeLetter.body || "");
    dialog.showModal();
    if (activeLetter.is_protected) unlockForm.querySelector("input").focus();
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-community-letter-compose], [data-community-letter-unlock]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = new FormData(form);
      if (form.matches("[data-community-letter-compose]")) {
        const subject = String(values.get("subject") || "").trim();
        const bodyText = String(values.get("body") || "").trim();
        const protectedLetter = protect.checked;
        const recipients = values.get("recipient_id") === "all"
          ? profiles.filter((profile) => profile.id !== user.id)
          : profiles.filter((profile) => profile.id === values.get("recipient_id") && profile.id !== user.id);
        if (!subject || subject.length > 120 || !bodyText || bodyText.length > maxBodyLength || !recipients.length) {
          throw new Error("Confira o destinatário, o assunto e o conteúdo da carta.");
        }
        let protectedContent = { body: bodyText, password_salt: null, password_iv: null, password_ciphertext: null };
        if (protectedLetter) protectedContent = await sealLetter(bodyText, values.get("password"), subject);
        const rows = recipients.map((recipient) => ({
          sender_id: user.id, recipient_id: recipient.id, subject, is_protected: protectedLetter,
          body: protectedContent.body, password_salt: protectedContent.password_salt,
          password_iv: protectedContent.password_iv, password_ciphertext: protectedContent.password_ciphertext
        }));
        const { error } = await client.from("community_letters").insert(rows);
        if (error) throw error;
        form.reset();
        passwordWrap.hidden = true;
        passwordInput.disabled = true;
        passwordInput.required = false;
        const status = root.querySelector("[data-community-letter-compose-status]");
        if (status) status.textContent = "Carta enviada para " + recipients.length + " usuário(s).";
        await reload();
      } else {
        const opened = await openProtectedLetter(activeLetter, String(values.get("password") || ""));
        const body = root.querySelector("[data-community-letter-body]");
        body.textContent = opened;
        body.hidden = false;
        form.hidden = true;
      }
    } catch (error) {
      const status = form.querySelector(".form-status");
      if (status) status.textContent = error?.message || "Não foi possível concluir esta ação.";
    } finally {
      button.disabled = false;
    }
  });
  dialog?.addEventListener("close", () => {
    const form = root.querySelector("[data-community-letter-unlock]");
    form.reset(); form.hidden = true;
    root.querySelector("[data-community-letter-body]").textContent = "";
    root.querySelector("[data-community-letter-body]").hidden = true;
    activeLetter = null;
  });
  const channel = client.channel("looply-community-letters-" + user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "community_letters" },
      () => reload().catch((error) => console.warn("Community letters refresh failed", error)))
    .subscribe();
  window.addEventListener("pagehide", () => client.removeChannel(channel), { once: true });
}
