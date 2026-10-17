import { mountAppPage } from "../../src/page-runtime.js";
import { bindProfileEvents, profileAreaMarkup, showProfileInContainer } from "../../src/profiles.js";

await mountAppPage({ page: "profile", render: async ({ root, client, profile }) => {
  const targetId = new URLSearchParams(window.location.search).get("usuario");
  if (targetId && targetId !== profile.id) {
    await showProfileInContainer(client, targetId, root, { showBack: false });
    return;
  }
  root.innerHTML = profileAreaMarkup(profile);
  bindProfileEvents(root, client, () => window.location.reload());
} });
