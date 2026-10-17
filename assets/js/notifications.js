import { mountAppPage } from "../../src/page-runtime.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
};

async function loadNotifications(client) {
  const [appResult, chatResult] = await Promise.all([
    client.from("notifications").select("id,kind,resource_id,event_id,preview,created_at,read_at,actor:profiles!notifications_actor_id_fkey(username,display_name)")
      .order("created_at", { ascending: false }).limit(100),
    client.from("chat_notifications").select("id,conversation_id,kind,preview,created_at,read_at")
      .order("created_at", { ascending: false }).limit(100)
  ]);
  if (appResult.error) throw appResult.error;
  if (chatResult.error) throw chatResult.error;
  const appItems = (appResult.data || []).map((item) => ({ ...item, source: "app" }));
  const chatItems = (chatResult.data || []).map((item) => ({ ...item, source: "chat", kind: item.kind === "letter" ? "letter" : "message" }));
  return [...appItems, ...chatItems].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function notificationHref(item) {
  if (item.source === "chat") return `conversa.html?id=${encodeURIComponent(item.conversation_id)}`;
  if (["post", "comment", "reply"].includes(item.kind)) return `home.html#post-${encodeURIComponent(item.resource_id)}`;
  if (item.kind === "music_dedication") return `musicas.html#dedication-${encodeURIComponent(item.resource_id)}`;
  return "#";
}

function notificationMarkup(item) {
  const labels = { post: "Publicação", comment: "Comentário", reply: "Resposta", music_dedication: "Dedicatória", letter: "Carta", message: "Mensagem" };
  const actor = item.actor ? (item.actor.display_name || item.actor.username) : "Looply";
  return `<a class="notification-row ${item.read_at ? "is-read" : "is-unread"}" href="${notificationHref(item)}"
      data-notification-source="${item.source}" data-notification-id="${escapeHtml(item.id)}" data-notification-target="${escapeHtml(notificationHref(item))}">
    <span class="notification-dot" aria-hidden="true"></span><span class="notification-copy"><strong>${escapeHtml(labels[item.kind] || "Atividade")}</strong>
    <span><b>${escapeHtml(actor)}</b> · ${escapeHtml(item.preview)}</span><time datetime="${escapeHtml(item.created_at)}">${escapeHtml(dateLabel(item.created_at))}</time></span>
  </a>`;
}

async function render(root, client) {
  try {
    const items = await loadNotifications(client);
    root.innerHTML = `<section class="panel notifications-panel"><div class="notifications-toolbar"><span>${items.filter((item) => !item.read_at).length} não lidas</span><button type="button" class="text-button" data-notifications-read-all ${items.some((item) => !item.read_at) ? "" : "disabled"}>Marcar todas como lidas</button></div>
      <div class="notification-list" data-notification-list>${items.length ? items.map(notificationMarkup).join("") : `<p class="notification-empty">Nenhuma notificação</p>`}</div><p class="notification-status" data-notification-status role="status" aria-live="polite"></p></section>`;
  } catch (error) {
    console.error("Looply notification load failed", error);
    root.innerHTML = `<section class="panel notifications-panel"><p class="notification-empty" role="alert">Não foi possível carregar as notificações. Atualize a página e tente novamente.</p></section>`;
  }
}

await mountAppPage({ page: "notifications", render: async ({ root, client, user }) => {
  await render(root, client);
  const channel = client.channel(`looply-notifications-page-${user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` }, () => render(root, client))
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_notifications", filter: `user_id=eq.${user.id}` }, () => render(root, client))
    .subscribe();
  root.addEventListener("click", async (event) => {
    const markAll = event.target.closest("[data-notifications-read-all]");
    const row = event.target.closest("[data-notification-source]");
    if (!markAll && !row) return;
    if (markAll) {
      markAll.disabled = true;
      const now = new Date().toISOString();
      const [appUpdate, chatUpdate] = await Promise.all([
        client.from("notifications").update({ read_at: now }).is("read_at", null),
        client.from("chat_notifications").update({ read_at: now }).is("read_at", null)
      ]);
      if (appUpdate.error || chatUpdate.error) {
        root.querySelector("[data-notification-status]").textContent = "Não foi possível atualizar todas as notificações.";
        markAll.disabled = false;
      } else await render(root, client);
      return;
    }
    event.preventDefault();
    const destination = row.dataset.notificationTarget;
    const source = row.dataset.notificationSource;
    const table = source === "chat" ? "chat_notifications" : "notifications";
    const { error } = await client.from(table).update({ read_at: new Date().toISOString() }).eq("id", row.dataset.notificationId).is("read_at", null);
    if (error) {
      root.querySelector("[data-notification-status]").textContent = "Não foi possível marcar como lida.";
      return;
    }
    window.location.assign(destination);
  });
  window.addEventListener("pagehide", () => client.removeChannel(channel), { once: true });
} });
