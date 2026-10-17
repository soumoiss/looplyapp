import { mountAppPage } from "../../src/page-runtime.js";
import { applyProfilePreferences } from "../../src/theme.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

function settingsMarkup(profile) {
  const theme = profile.theme || "lilas";
  const family = profile.font_family || "system";
  const size = profile.font_size || "normal";
  return `<form class="panel settings-form" data-settings-form>
    <fieldset><legend>Tema</legend><label for="settingsTheme">Aparência</label><select id="settingsTheme" name="theme">
      <option value="lilas" ${theme === "lilas" ? "selected" : ""}>Claro</option>
      <option value="noite" ${theme === "noite" ? "selected" : ""}>Escuro</option>
      <option value="system" ${theme === "system" ? "selected" : ""}>Automático</option>
      <option value="oceano" ${theme === "oceano" ? "selected" : ""}>Oceano</option>
      <option value="rosa" ${theme === "rosa" ? "selected" : ""}>Rosa</option>
      <option value="floresta" ${theme === "floresta" ? "selected" : ""}>Floresta</option>
    </select></fieldset>
    <fieldset><legend>Texto</legend>
      <label for="settingsFont">Fonte</label><select id="settingsFont" name="font_family">
        <option value="system" ${family === "system" ? "selected" : ""}>Sistema</option>
        <option value="sans" ${family === "sans" ? "selected" : ""}>Arial</option>
        <option value="serif" ${family === "serif" ? "selected" : ""}>Serifada</option>
        <option value="rounded" ${family === "rounded" ? "selected" : ""}>Arredondada</option>
      </select>
      <label for="settingsSize">Tamanho</label><select id="settingsSize" name="font_size">
        <option value="small" ${size === "small" ? "selected" : ""}>Pequeno</option>
        <option value="normal" ${size === "normal" ? "selected" : ""}>Normal</option>
        <option value="large" ${size === "large" ? "selected" : ""}>Grande</option>
        <option value="very_large" ${size === "very_large" ? "selected" : ""}>Muito grande</option>
      </select>
    </fieldset>
    <div class="settings-actions"><button class="primary-button compact-button" type="submit">Salvar preferências</button><span class="form-status" data-settings-status role="status" aria-live="polite"></span></div>
  </form>`;
}

await mountAppPage({ page: "settings", render: async ({ root, client, user, profile }) => {
  root.innerHTML = settingsMarkup(profile);
  const form = root.querySelector("[data-settings-form]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector("[data-settings-status]");
    button.disabled = true;
    status.textContent = "Salvando…";
    status.dataset.kind = "info";
    try {
      const values = new FormData(form);
      const updates = {
        theme: String(values.get("theme")),
        font_family: String(values.get("font_family")),
        font_size: String(values.get("font_size"))
      };
      const { data, error } = await client.from("profiles").update(updates).eq("id", user.id)
        .select("theme,font_family,font_size").single();
      if (error) throw error;
      applyProfilePreferences(data);
      status.textContent = "Preferências salvas.";
      status.dataset.kind = "success";
    } catch (error) {
      console.error("Looply preferences update failed", error);
      status.textContent = "Não foi possível salvar. Tente novamente.";
      status.dataset.kind = "error";
    } finally {
      button.disabled = false;
    }
  });
} });
