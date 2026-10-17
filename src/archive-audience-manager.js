function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function selectedValues(select) {
  return select ? [...select.selectedOptions].map((option) => String(option.value)).filter(Boolean) : [];
}

function visibilityLabel(item) {
  if (item.visibility !== "exclusive") return "Visível para todos os membros";
  const recipients = Array.isArray(item.recipients) ? item.recipients : [];
  return "Exclusiva para " + recipients.length + (recipients.length === 1 ? " pessoa" : " pessoas");
}

function commentAccessLabel(item) {
  if (item.comment_access === "disabled") return "Comentários desativados";
  if (item.comment_access === "selected") {
    const commenters = Array.isArray(item.commenters) ? item.commenters : [];
    return "Comentários permitidos para " + commenters.length + (commenters.length === 1 ? " pessoa" : " pessoas");
  }
  return "Quem vê a mídia pode comentar";
}

function mediaPreview(item) {
  const url = escapeHtml(item.signed_url || "");
  const title = escapeHtml(item.file_name || item.source_path);
  if (!url) return '<span class="archive-audience-preview-empty">Prévia indisponível</span>';
  if (item.kind === "image" && !String(item.mime_type || "").includes("heic")) return '<img src="' + url + '" alt="' + title + '" loading="lazy" referrerpolicy="no-referrer">';
  if (item.kind === "video") return '<video src="' + url + '" controls playsinline preload="metadata" aria-label="' + title + '"></video>';
  if (item.kind === "audio") return '<audio src="' + url + '" controls preload="metadata" aria-label="' + title + '"></audio>';
  return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">Abrir ' + title + '</a>';
}

function personOptions(profiles, selectedIds) {
  const selected = new Set(selectedIds.map(String));
  return profiles.map((person) => {
    const id = escapeHtml(person.id);
    const username = String(person.username || "");
    const display = escapeHtml(person.display_name || username || "Perfil");
    return '<option value="' + id + '"' + (selected.has(String(person.id)) ? " selected" : "") + '>' +
      display + (username ? " · @" + escapeHtml(username) : "") + '</option>';
  }).join("");
}

function audienceItemMarkup(item, profiles) {
  const id = escapeHtml(item.id);
  const recipients = Array.isArray(item.recipients) ? item.recipients : [];
  const commenters = Array.isArray(item.commenters) ? item.commenters : [];
  const viewerIds = recipients.map((entry) => String(entry.user_id));
  const commenterIds = commenters.map((entry) => String(entry.user_id));
  const visibility = item.visibility === "exclusive" ? "exclusive" : "members";
  const commentAccess = ["viewers", "selected", "disabled"].includes(item.comment_access) ? item.comment_access : "viewers";
  const options = personOptions(profiles, viewerIds);
  const commenterOptions = personOptions(profiles, commenterIds);
  const needsViewerChoice = visibility === "exclusive" && viewerIds.some((viewerId) => !profiles.some((profile) => String(profile.id) === viewerId));
  const needsCommenterChoice = commentAccess === "selected" && commenterIds.some((viewerId) => !profiles.some((profile) => String(profile.id) === viewerId));
  const missingViewerOption = needsViewerChoice ? '<option value="" disabled selected>Há um perfil sem acesso selecionável</option>' : "";
  const missingCommenterOption = needsCommenterChoice ? '<option value="" disabled selected>Há um perfil sem permissão selecionável</option>' : "";
  return '<article class="archive-audience-item" data-audience-item="' + id + '">' +
    '<div class="archive-audience-preview">' + mediaPreview(item) + '</div>' +
    '<div class="archive-audience-fields">' +
      '<strong>' + escapeHtml(item.file_name || item.source_path) + '</strong>' +
      '<span data-audience-current>' + escapeHtml(visibilityLabel(item)) + ' · ' + escapeHtml(commentAccessLabel(item)) + '</span>' +
      '<label>Quem pode ver esta mídia<select data-audience-visibility data-media-id="' + id + '">' +
        '<option value="members"' + (visibility === "members" ? " selected" : "") + '>Todos os membros</option>' +
        '<option value="exclusive"' + (visibility === "exclusive" ? " selected" : "") + '>Somente pessoas selecionadas</option>' +
      '</select></label>' +
      '<label data-audience-viewers-wrap' + (visibility === "exclusive" ? "" : " hidden") + '>Pessoas que podem ver' +
        '<select multiple size="4" data-audience-viewers data-media-id="' + id + '">' + missingViewerOption + options + '</select></label>' +
      '<label>Quem pode comentar<select data-audience-comment-access data-media-id="' + id + '">' +
        '<option value="viewers"' + (commentAccess === "viewers" ? " selected" : "") + '>Quem puder ver a mídia</option>' +
        '<option value="selected"' + (commentAccess === "selected" ? " selected" : "") + '>Pessoas selecionadas</option>' +
        '<option value="disabled"' + (commentAccess === "disabled" ? " selected" : "") + '>Ninguém</option>' +
      '</select></label>' +
      '<label data-audience-commenters-wrap' + (commentAccess === "selected" ? "" : " hidden") + '>Pessoas autorizadas a comentar' +
        '<select multiple size="4" data-audience-commenters data-media-id="' + id + '">' + missingCommenterOption + commenterOptions + '</select></label>' +
      '<button type="button" class="primary-button compact-button" data-save-audience data-media-id="' + id + '">Salvar permissões</button>' +
      '<span class="form-status" data-audience-status role="status" aria-live="polite"></span>' +
    '</div></article>';
}

function updateCardControls(card) {
  const visibility = card.querySelector("[data-audience-visibility]")?.value;
  const access = card.querySelector("[data-audience-comment-access]")?.value;
  const viewers = card.querySelector("[data-audience-viewers-wrap]");
  const commenters = card.querySelector("[data-audience-commenters-wrap]");
  if (viewers) viewers.hidden = visibility !== "exclusive";
  if (commenters) commenters.hidden = access !== "selected";
}

export function bindArchiveGalleryControls(root) {
  const library = root.querySelector(".archive-media-library");
  if (!library) return;
  const apply = () => {
    const grid = library.querySelector("[data-archive-media-grid]");
    const tiles = grid ? [...grid.querySelectorAll(".archive-media-tile")] : [];
    const query = String(library.querySelector("[data-archive-gallery-search]")?.value || "").trim().toLocaleLowerCase("pt-BR");
    const kind = library.querySelector("[data-archive-gallery-type]")?.value || "all";
    const access = library.querySelector("[data-archive-gallery-access]")?.value || "all";
    const sort = library.querySelector("[data-archive-gallery-sort]")?.value || "newest";
    const view = library.querySelector("[data-archive-gallery-view][aria-pressed='true']")?.dataset.archiveGalleryView || "grid";
    const matches = [];
    for (const tile of tiles) {
      const visible = (!query || String(tile.dataset.search || "").includes(query))
        && (kind === "all" || tile.dataset.kind === kind)
        && (access === "all" || tile.dataset.access === access);
      tile.hidden = !visible;
      if (visible) matches.push(tile);
    }
    matches.sort((left, right) => {
      const leftTime = Date.parse(left.dataset.createdAt || "") || 0;
      const rightTime = Date.parse(right.dataset.createdAt || "") || 0;
      const byName = String(left.dataset.name || "").localeCompare(String(right.dataset.name || ""), "pt-BR");
      if (sort === "oldest") return leftTime - rightTime;
      if (sort === "name-asc") return byName;
      if (sort === "name-desc") return -byName;
      return rightTime - leftTime;
    });
    if (grid) {
      for (const tile of matches) grid.append(tile);
      for (const tile of tiles) if (!matches.includes(tile)) grid.append(tile);
      grid.dataset.view = view;
    }
    const count = library.querySelector("[data-archive-media-count]");
    if (count) count.textContent = matches.length === tiles.length
      ? `${tiles.length} arquivo(s)`
      : `${matches.length} de ${tiles.length} arquivo(s)`;
    const empty = library.querySelector("[data-archive-gallery-empty]");
    if (empty) empty.hidden = matches.length > 0 || tiles.length === 0;
    root.dispatchEvent(new CustomEvent("archive-gallery-filter"));
  };
  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-archive-gallery-search]")) apply();
  });
  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-archive-gallery-type], [data-archive-gallery-access], [data-archive-gallery-sort]")) apply();
  });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-archive-gallery-view]");
    if (!button || !library.contains(button)) return;
    for (const option of library.querySelectorAll("[data-archive-gallery-view]")) {
      option.setAttribute("aria-pressed", String(option === button));
    }
    apply();
  });
  root.addEventListener("archive-gallery-refresh", apply);
  apply();
}

async function adminRequest(client, body) {
  const { data, error } = await client.functions.invoke("looply-admin", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "A solicitação administrativa falhou.");
  return data || {};
}

async function loadAll(client, resourceType, purpose) {
  const rows = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const result = await adminRequest(client, { resourceType, purpose, offset });
    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

export function bindArchiveAudienceManager(root, client, isAdmin) {
  if (!isAdmin) return;
  const library = root.querySelector(".archive-media-library");
  const grid = library?.querySelector("[data-archive-media-grid]");
  if (!library || !grid) return;
  const details = document.createElement("details");
  details.className = "archive-audience-manager";
  details.innerHTML = '<summary>Administrar acesso por mídia</summary>' +
    '<p>Para cada mídia, escolha quem pode visualizar e, separadamente, quem pode comentar. A lista de destinatários e cada alteração ficam na auditoria administrativa.</p>' +
    '<form data-audience-load><label>Motivo administrativo<textarea name="purpose" minlength="20" maxlength="500" required placeholder="Descreva por que está revisando os acessos da galeria."></textarea></label>' +
    '<button type="submit" class="primary-button compact-button">Carregar mídias para administrar</button><span class="form-status" data-audience-load-status role="status" aria-live="polite"></span></form>' +
    '<div class="archive-audience-list" data-audience-list hidden></div>';
  library.insertBefore(details, library.querySelector(".archive-gallery-toolbar"));
  const list = details.querySelector("[data-audience-list]");
  const loadForm = details.querySelector("[data-audience-load]");
  const loadButton = loadForm.querySelector('button[type="submit"]');
  const loadStatus = details.querySelector("[data-audience-load-status]");
  const state = { items: new Map(), profiles: [] };

  loadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const purpose = String(new FormData(loadForm).get("purpose") || "").trim();
    if (purpose.length < 20 || purpose.length > 500) {
      loadStatus.textContent = "Descreva o motivo em pelo menos 20 caracteres.";
      loadStatus.dataset.kind = "error";
      return;
    }
    loadButton.disabled = true;
    loadStatus.textContent = "Carregando mídias e pessoas…";
    loadStatus.dataset.kind = "";
    try {
      const [items, profiles] = await Promise.all([
        loadAll(client, "archive_media", purpose),
        loadAll(client, "profiles", purpose)
      ]);
      state.profiles = profiles;
      state.items = new Map(items.map((item) => [String(item.id), item]));
      list.innerHTML = items.length
        ? items.map((item) => audienceItemMarkup(item, profiles)).join("")
        : '<p class="archive-media-empty">Nenhuma mídia disponível para administrar.</p>';
      list.hidden = false;
      loadStatus.textContent = items.length + " mídia(s) carregada(s).";
      loadStatus.dataset.kind = "success";
    } catch (error) {
      console.error("Looply archive audience load failed", error);
      loadStatus.textContent = "Não foi possível carregar as mídias administrativas. Confira o motivo e o acesso de administrador.";
      loadStatus.dataset.kind = "error";
    } finally {
      loadButton.disabled = false;
    }
  });

  details.addEventListener("change", (event) => {
    const card = event.target.closest("[data-audience-item]");
    if (card && event.target.matches("[data-audience-visibility], [data-audience-comment-access]")) updateCardControls(card);
  });

  details.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-audience]");
    if (!button) return;
    const id = String(button.dataset.mediaId || "");
    const card = button.closest("[data-audience-item]");
    const status = card?.querySelector("[data-audience-status]");
    const purpose = String(loadForm.querySelector('[name="purpose"]').value || "").trim();
    const visibility = card?.querySelector("[data-audience-visibility]")?.value || "";
    const commentAccess = card?.querySelector("[data-audience-comment-access]")?.value || "";
    const viewerIds = visibility === "exclusive" ? selectedValues(card.querySelector("[data-audience-viewers]")) : [];
    const commenterIds = commentAccess === "selected" ? selectedValues(card.querySelector("[data-audience-commenters]")) : [];
    if (purpose.length < 20 || purpose.length > 500) {
      if (status) { status.textContent = "Descreva o motivo em pelo menos 20 caracteres."; status.dataset.kind = "error"; }
      return;
    }
    if (visibility === "exclusive" && viewerIds.length === 0) {
      if (status) { status.textContent = "Selecione pelo menos uma pessoa para a mídia exclusiva."; status.dataset.kind = "error"; }
      return;
    }
    if (commentAccess === "selected" && commenterIds.length === 0) {
      if (status) { status.textContent = "Selecione pelo menos uma pessoa autorizada a comentar."; status.dataset.kind = "error"; }
      return;
    }
    button.disabled = true;
    if (status) { status.textContent = "Salvando permissões…"; status.dataset.kind = ""; }
    try {
      await adminRequest(client, {
        action: "set_archive_media_access",
        resourceType: "archive_media",
        mediaId: id,
        visibility,
        viewerIds,
        commentAccess,
        commenterIds,
        purpose
      });
      const item = state.items.get(id);
      if (item) {
        item.visibility = visibility;
        item.comment_access = commentAccess;
        item.recipients = viewerIds.map((userId) => ({
          user_id: userId,
          profile: state.profiles.find((person) => String(person.id) === userId) || null
        }));
        item.commenters = commenterIds.map((userId) => ({
          user_id: userId,
          profile: state.profiles.find((person) => String(person.id) === userId) || null
        }));
      }
      const label = card?.querySelector("[data-audience-current]");
      if (label && item) label.textContent = visibilityLabel(item) + " · " + commentAccessLabel(item);
      if (status) {
        status.textContent = "As permissões desta mídia foram salvas.";
        status.dataset.kind = "success";
      }
    } catch (error) {
      console.error("Looply archive access update failed", error);
      if (status) { status.textContent = "Não foi possível salvar. Verifique o acesso de administrador e tente novamente."; status.dataset.kind = "error"; }
    } finally {
      button.disabled = false;
    }
  });
}




