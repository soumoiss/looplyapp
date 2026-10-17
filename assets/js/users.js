import { mountAppPage } from "../../src/page-runtime.js";
import { bindProfileEvents, renderSearchResults, signProfileAvatars } from "../../src/profiles.js";

function directoryMarkup() {
  return `<section class="panel people-area"><div class="people-search">
    <div class="people-search-heading"><h2 id="peopleTitle">Usuários</h2></div>
    <form class="people-search-form" data-profile-search><label class="visually-hidden" for="peopleQuery">Buscar por username</label>
      <span aria-hidden="true">⌕</span><input id="peopleQuery" name="query" type="text" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]{3,30}" placeholder="Buscar username" required>
      <button class="text-button" type="submit">Buscar</button></form>
    <div class="profile-results" data-profile-results aria-live="polite"><p class="search-empty" role="status">Carregando usuários…</p></div>
  </div></section>`;
}

await mountAppPage({ page: "users", render: async ({ root, client, user }) => {
  root.innerHTML = directoryMarkup();
  bindProfileEvents(root, client, null);
  const results = root.querySelector("[data-profile-results]");
  try {
    const { data, error } = await client.from("profiles").select("id,username,display_name,avatar_path")
      .neq("id", user.id).order("username").limit(100);
    if (error) throw error;
    renderSearchResults(results, await signProfileAvatars(client, data || []));
  } catch (error) {
    console.error("Looply directory load failed", error);
    results.innerHTML = `<p class="search-empty" role="alert">Não foi possível carregar os usuários.</p>`;
  }
} });
