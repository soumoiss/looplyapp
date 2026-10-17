import { mountAppPage } from "../../src/page-runtime.js";
import { bindChatEvents, chatMarkup, disposeChatRealtime, loadChatData, setupChatRealtime } from "../../src/chat.js";

await mountAppPage({ page: "conversation", render: async ({ root, client, user }) => {
  root.dataset.conversationPage = "true";
  const data = await loadChatData(client, user.id);
  root.innerHTML = chatMarkup(data, user.id);
  root.insertAdjacentHTML("afterbegin", `<a class="conversation-back" href="chat.html">← Conversas</a>`);
  bindChatEvents(root, client, () => user.id);
  setupChatRealtime(client, user.id, root);
  const conversationId = new URLSearchParams(window.location.search).get("id");
  if (conversationId) root.dispatchEvent(new CustomEvent("looply:open-conversation", { detail: { conversationId } }));
  else root.querySelector("[data-chat-thread]").innerHTML = `<div class="chat-empty"><strong>Escolha uma conversa.</strong><span><a href="chat.html">Voltar à lista</a></span></div>`;
  window.addEventListener("pagehide", () => disposeChatRealtime(client), { once: true });
} });
