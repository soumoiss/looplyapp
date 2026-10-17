import { mountAppPage } from "../../src/page-runtime.js";
import { bindChatEvents, chatMarkup, disposeChatRealtime, loadChatData, setupChatRealtime } from "../../src/chat.js";

await mountAppPage({ page: "chat", render: async ({ root, client, user }) => {
  const data = await loadChatData(client, user.id);
  root.innerHTML = chatMarkup(data, user.id);
  bindChatEvents(root, client, () => user.id);
  setupChatRealtime(client, user.id, root);
  window.addEventListener("pagehide", () => disposeChatRealtime(client), { once: true });
} });
