import { mountAppPage } from "../../src/page-runtime.js";
import { archivedCardsMarkup, bindArchivedCards, loadArchivedCards } from "../../src/archived-cards.js";
import { bindCommunityLetters, communityLettersMarkup, loadCommunityLetters } from "../../src/letters-community.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
async function loadWrittenLetters(client, userId) {
  const { data, error } = await client.from("letters")
    .select("id,conversation_id,sender_id,recipient_id,subject,created_at,sender:profiles!letters_sender_id_fkey(username,display_name),recipient:profiles!letters_recipient_id_fkey(username,display_name)")
    .or("sender_id.eq." + userId + ",recipient_id.eq." + userId).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}
function writtenLettersMarkup(letters, userId) {
  if (!letters.length) return "<p class=\"written-letters-empty\">Nenhuma carta enviada ou recebida</p>";
  return letters.map((letter) => {
    const own = letter.sender_id === userId;
    const peer = own ? letter.recipient : letter.sender;
    return "<article class=\"written-letter-row\"><div><strong>" + escapeHtml(letter.subject) + "</strong><span>" +
      (own ? "Para " : "De ") + escapeHtml(peer?.display_name || peer?.username || "Perfil restrito") +
      " · " + escapeHtml(formatDate(letter.created_at)) + "</span></div>" +
      "<a class=\"text-button\" href=\"conversa.html?id=" + encodeURIComponent(letter.conversation_id) + "\">Abrir conversa</a></article>";
  }).join("");
}
await mountAppPage({ page: "letters", render: async ({ root, client, user }) => {
  const [archiveResult, letterResult, communityResult, profilesResult] = await Promise.allSettled([
    loadArchivedCards(client, user.id), loadWrittenLetters(client, user.id),
    loadCommunityLetters(client, user.id),
    client.from("profiles").select("id,username,display_name").order("username").limit(100)
  ]);
  const communityLetters = communityResult.status === "fulfilled" ? communityResult.value : [];
  const profiles = profilesResult.status === "fulfilled" ? profilesResult.value.data || [] : [];
  root.innerHTML = communityLettersMarkup(communityLetters, profiles, user.id) +
    "<section class=\"panel written-letters-panel\"><div class=\"written-letters-heading\"><h2>Cartas enviadas e recebidas</h2><a class=\"text-button\" href=\"chat.html\">Abrir conversa</a></div><div class=\"written-letters-list\"></div></section>" +
    archivedCardsMarkup();
  if (communityResult.status === "fulfilled") bindCommunityLetters(root, client, user, profiles, communityLetters);
  else {
    console.error("Looply community letters load failed", communityResult.reason);
    const composer = root.querySelector(".community-letter-compose-panel");
    if (composer) composer.innerHTML = "<p role=\"alert\">Não foi possível carregar as cartas da comunidade.</p>";
  }
  const letterList = root.querySelector(".written-letters-list");
  if (letterResult.status === "fulfilled") letterList.innerHTML = writtenLettersMarkup(letterResult.value, user.id);
  else {
    console.error("Looply written letters load failed", letterResult.reason);
    letterList.innerHTML = "<p class=\"written-letters-empty\" role=\"alert\">Não foi possível carregar as cartas enviadas e recebidas.</p>";
  }
  if (archiveResult.status === "fulfilled") bindArchivedCards(root, client, user.id, archiveResult.value);
  else {
    console.error("Looply archive cards load failed", archiveResult.reason);
    root.querySelector("[data-archived-cards]").innerHTML = "<p class=\"archive-media-empty\" role=\"alert\">Não foi possível carregar a coleção arquivada.</p>";
    root.querySelector("[data-card-collection-note]").textContent = "Acervo indisponível";
  }
} });
