import { isSupabaseConfigured, supabase } from "./supabase.js";
import { checkAdminAccess } from "./admin.js";
import { applyProfilePreferences } from "./theme.js";

const navigation = [
  ["home", "Início", "home.html"],
  ["letters", "Cartas", "cartas.html"],
  ["gallery", "Galeria", "galeria.html"],
  ["music", "Músicas", "musicas.html"],
  ["chat", "Chat", "chat.html"],
  ["notifications", "Notificações", "notificacoes.html"]
];
const navigationShortLabels = { chat: "Chat", letters: "Cartas", notifications: "Avisos", gallery: "Galeria", music: "Músicas", home: "Início" };
const navigationIcons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
  letters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.5a3.5 3.5 0 0 1 0 6.8M17 14a5.5 5.5 0 0 1 4.5 5.5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19 6v5c0 5-3.2 8.3-7 10-3.8-1.7-7-5-7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>'
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function notice(root, text, kind = "info") {
  root.innerHTML = `<section class="panel page-notice" role="${kind === "error" ? "alert" : "status"}">${escapeHtml(text)}</section>`;
}

function headerMarkup(page, profile, admin, unreadCount) {
  const username = escapeHtml(profile.username);
  const name = escapeHtml(profile.display_name || profile.username);
  const avatar = profile.avatarUrl
    ? `<img class="looply-user-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="looply-user-initial" aria-hidden="true">${escapeHtml(name.slice(0, 1).toLocaleUpperCase("pt-BR"))}</span>`;
  const activePage = page === "conversation" ? "chat" : page;
  const links = navigation.map(([key, label, href]) => `<a class="header-action" href="${href}" aria-label="${label}"${key === activePage ? ' aria-current="page"' : ""}><span class="page-navigation-icon" aria-hidden="true">${navigationIcons[key]}</span><span class="page-navigation-label" data-short-label="${navigationShortLabels[key] || label}">${label}</span>${key === "notifications" && unreadCount ? `<span class="navigation-badge" aria-label="${unreadCount} não lidas">${unreadCount > 99 ? "99+" : unreadCount}</span>` : ""}</a>`).join("");
  const profileCurrent = page === "profile" ? " aria-current=\"page\"" : "";
  const settingsCurrent = page === "settings" ? " aria-current=\"page\"" : "";
  const accountLinks = `<a class="account-menu-link"${profileCurrent} href="perfil.html">Meu perfil</a><a class="account-menu-link" href="usuarios.html">Pessoas</a><a class="account-menu-link"${settingsCurrent} href="configuracoes.html">Configurações</a>${admin ? `<a class="account-menu-link" href="admin.html">Administração</a>` : ""}`;
  return `<a class="brand-inline" href="home.html" aria-label="Looply, início"><span class="brand-mark brand-mark-animated" aria-hidden="true"><span class="circle"><svg viewBox="0 0 100 100" fill="none"><path d="M50 15A35 35 0 0 1 85 50" stroke="currentColor" stroke-width="5"/></svg></span></span><span><strong>Looply</strong><span>MoissWorld</span></span></a>
    <nav class="header-actions page-navigation" aria-label="Navegação principal">${links}</nav>
    <details class="looply-account-menu"><summary class="looply-account" aria-label="Abrir menu da conta">${avatar}<span><strong>${name}</strong><small>@${username}${admin ? " · administrador" : ""}</small></span><span class="account-menu-caret" aria-hidden="true">⌄</span></summary>
      <div class="account-menu-popover">${accountLinks}<button class="header-action" type="button" data-sign-out>Sair</button></div></details>`;
}

async function loadProfile(userId) {
  const { data, error } = await supabase.from("profiles")
    .select("id,username,display_name,bio,profile_visibility,avatar_path,theme,font_family,font_size")
    .eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("O perfil desta conta não foi encontrado.");
  return data;
}

async function loadProfileAvatar(profile) {
  if (!profile?.avatar_path) return "";
  const { data, error } = await supabase.storage.from("looply-avatars").createSignedUrl(profile.avatar_path, 1800);
  if (error) throw error;
  return data?.signedUrl || "";
}

async function loadUnreadNotifications(client) {
  const [notifications, chats] = await Promise.all([
    client.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    client.from("chat_notifications").select("id", { count: "exact", head: true }).is("read_at", null)
  ]);
  return (notifications.error ? 0 : notifications.count || 0) + (chats.error ? 0 : chats.count || 0);
}

async function refreshUnreadBadge(header, client) {
  const count = await loadUnreadNotifications(client);
  const link = header.querySelector('.page-navigation a[href="notificacoes.html"]');
  if (!link) return;
  let badge = link.querySelector(".navigation-badge");
  if (!count) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "navigation-badge";
    link.append(badge);
  }
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.setAttribute("aria-label", `${count} não lidas`);
}

function prefetchNavigation(header) {
  const requested = new Set();
  const prefetch = (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || !header.contains(link) || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.endsWith(".html") || requested.has(url.href)) return;
    requested.add(url.href);
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.as = "document";
    hint.href = url.href;
    document.head.append(hint);
  };
  header.addEventListener("pointerover", prefetch, { passive: true });
  header.addEventListener("focusin", prefetch);
}

export async function mountAppPage({ page, adminOnly = false, render }) {
  const root = document.getElementById("pageContent");
  const header = document.querySelector("[data-site-header]");
  if (!root || !header) return;

  if (!isSupabaseConfigured || !supabase) {
    notice(root, "A configuração pública do Supabase está ausente ou inválida.", "error");
    return;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    await supabase.auth.signOut();
    window.location.replace("login.html");
    return;
  }

  const user = userData.user;
  let profile;
  let isAdmin = false;
  try {
    const [profileResult, adminResult] = await Promise.allSettled([
      loadProfile(user.id), checkAdminAccess(supabase)
    ]);
    if (profileResult.status === "rejected") throw profileResult.reason;
    profile = profileResult.value;
    isAdmin = adminResult.status === "fulfilled" && Boolean(adminResult.value);
  } catch (error) {
    notice(root, error?.message || "Não foi possível carregar o perfil.", "error");
    return;
  }

  if (adminOnly && !isAdmin) {
    window.location.replace("home.html");
    return;
  }

  applyProfilePreferences(profile);
  header.innerHTML = headerMarkup(page, profile, isAdmin, 0);
  prefetchNavigation(header);
  document.querySelectorAll(".page-navigation a").forEach((link) => {
    if (link.getAttribute("aria-current") === "page") link.setAttribute("aria-current", "page");
  });
  header.querySelector("[data-sign-out]").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const { error } = await supabase.auth.signOut();
    if (error) event.currentTarget.disabled = false;
  });

  void refreshUnreadBadge(header, supabase).catch((error) => console.warn("Looply unread count refresh failed", error));
  void loadProfileAvatar(profile).then((avatarUrl) => {
    if (!avatarUrl) return;
    profile.avatarUrl = avatarUrl;
    const current = header.querySelector(".looply-user-avatar, .looply-user-initial");
    if (!current) return;
    const image = document.createElement("img");
    image.className = "looply-user-avatar";
    image.src = avatarUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    current.replaceWith(image);
  }).catch((error) => console.warn("Looply profile avatar load failed", error));

  const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) window.location.replace("login.html");
  });

  const activityChannel = supabase.channel(`looply-activity-${user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` }, () => refreshUnreadBadge(header, supabase))
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_notifications", filter: `user_id=eq.${user.id}` }, () => refreshUnreadBadge(header, supabase))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` }, ({ new: updated }) => {
      if (updated) applyProfilePreferences(updated);
    })
    .subscribe();

  try {
    await render({ root, client: supabase, user, profile, isAdmin });
  } catch (error) {
    console.error("Looply page failed to load", error);
    notice(root, "Não foi possível carregar esta página. Confira sua conexão e tente novamente.", "error");
  }

  window.addEventListener("pagehide", () => {
    authListener.subscription.unsubscribe();
    supabase.removeChannel(activityChannel);
  }, { once: true });
}

export { notice };

