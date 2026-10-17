function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export function profileAreaMarkup(profile) {
  const username = escapeHtml(profile.username);
  const displayName = escapeHtml(profile.display_name);
  const bio = escapeHtml(profile.bio || "");
  const visibility = profile.profile_visibility || "members";
  const visibilityLabel = visibility === "private" ? "Perfil privado" : visibility === "public" ? "Público" : "Visível para membros";
  const avatarUrl = profile.avatarUrl ? escapeHtml(profile.avatarUrl) : "";
  const avatar = profile.avatarUrl
    ? `<img class="profile-avatar-edit-image" src="${escapeHtml(profile.avatarUrl)}" alt="Sua foto de perfil" referrerpolicy="no-referrer">`
    : `<span class="profile-avatar-edit-fallback" aria-hidden="true">${escapeHtml((profile.display_name || profile.username || "?").slice(0, 1).toLocaleUpperCase("pt-BR"))}</span>`;
  return `<section class="people-area profile-page-area" aria-labelledby="peopleTitle">
    <article class="profile-overview" aria-label="Resumo do seu perfil">
      <div class="profile-overview-avatar">${avatar}</div>
      <div class="profile-overview-copy"><span class="section-kicker">Meu espaço</span><h2>${displayName || username}</h2>
        <span class="profile-overview-username">@${username}</span>${bio ? `<p>${bio}</p>` : `<p>Conte um pouco sobre você.</p>`}
        <span class="profile-visibility-badge">◉ ${escapeHtml(visibilityLabel)}</span></div>
      <a class="profile-overview-shortcut" href="#profileEditor">Editar dados <span aria-hidden="true">↓</span></a>
    </article>
    <section class="profile-editor-card" id="profileEditor" aria-labelledby="profileEditorTitle">
      <header class="profile-editor-heading"><div><span class="section-kicker">Personalização</span><h2 id="profileEditorTitle">Deixe seu perfil com a sua cara</h2><p>Atualize seu nome, foto, apresentação e privacidade.</p></div><span class="profile-editor-mark" aria-hidden="true">✦</span></header>
      <form class="profile-editor-form" data-profile-edit>
        <div class="profile-avatar-editor">
          <div class="profile-avatar-edit-preview" data-avatar-preview data-original-avatar-url="${avatarUrl}">${avatar}</div>
          <div class="profile-avatar-controls"><div><strong>Sua foto de perfil</strong></div>
            <div class="profile-avatar-actions"><label class="profile-photo-picker" for="profileAvatar">${profile.avatarUrl ? "Trocar foto" : "Escolher foto"}</label>
              <input class="profile-photo-input" id="profileAvatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" capture="user" data-avatar-input>
              <input type="hidden" name="removeAvatar" value="false" data-avatar-remove-state>
              <button class="profile-photo-remove" type="button" data-avatar-remove ${profile.avatarUrl ? "" : "hidden"}>${profile.avatarUrl ? "Remover foto" : "Cancelar seleção"}</button></div>
          </div>
        </div>
        <div class="profile-edit-grid">
          <div class="field"><span class="profile-username-label">Username</span><strong class="profile-username-readonly">@${username}</strong></div>
          <div class="field"><label for="editDisplayName">Nome de exibição</label><input id="editDisplayName" name="displayName" value="${displayName}" maxlength="80" required></div>
        </div>
        <div class="field"><label for="editBio">Sobre mim</label><textarea id="editBio" name="bio" maxlength="280" rows="3">${bio}</textarea></div>
        <div class="profile-privacy-field"><div><label for="profileVisibility">Quem pode encontrar seu perfil?</label><span class="field-hint">A visibilidade do perfil não altera as permissões de cada story ou mídia.</span></div>
          <select id="profileVisibility" name="visibility">
            <option value="members" ${visibility === "members" ? "selected" : ""}>Membros</option>
            <option value="public" ${visibility === "public" ? "selected" : ""}>Público</option>
            <option value="private" ${visibility === "private" ? "selected" : ""}>Privado</option>
          </select>
        </div>
        <footer class="profile-edit-footer"><span class="form-status" data-status role="status" aria-live="polite"></span><button class="primary-button compact-button" type="submit">Salvar alterações</button></footer>
      </form>
    <div class="people-search profile-people-search">
      <div class="people-search-heading"><span class="section-kicker">Comunidade</span><h2 id="peopleTitle">Encontre seus amigos</h2><p>Busque pelo início do username. Os perfis privados não aparecem para outras pessoas.</p></div>
      <form class="people-search-form" data-profile-search>
        <label class="visually-hidden" for="peopleQuery">Username para buscar</label>
        <span aria-hidden="true">⌕</span>
        <input id="peopleQuery" name="query" type="text" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]{3,30}" placeholder="username (3 ou mais caracteres)" required>
        <button class="text-button" type="submit">Buscar</button>
      </form>
      <div class="profile-results" data-profile-results aria-live="polite"></div>
    </div>
  </section>`;
}

function setStatus(form, message, kind = "success") {
  const target = form.querySelector("[data-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.kind = kind;
}

export async function signProfileAvatars(client, profiles) {
  const withUrls = (profiles || []).map((profile) => ({ ...profile, avatarUrl: "" }));
  const withAvatars = withUrls.filter((profile) => profile.avatar_path);
  if (!withAvatars.length) return withUrls;
  const { data, error } = await client.storage.from("looply-avatars").createSignedUrls(
    withAvatars.map((profile) => profile.avatar_path),
    1800
  );
  if (!error && data) {
    withAvatars.forEach((profile, index) => { profile.avatarUrl = data[index]?.signedUrl || ""; });
  }
  return withUrls;
}

export function renderSearchResults(container, profiles) {
  if (!profiles.length) {
    container.innerHTML = `<p class="search-empty">Nenhum perfil visível foi encontrado.</p>`;
    return;
  }
  container.innerHTML = profiles.map((profile) => `<article class="person-result">
    <span class="person-result-avatar" aria-hidden="true">${profile.avatarUrl
      ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : escapeHtml((profile.display_name || profile.username).slice(0, 1).toLocaleUpperCase("pt-BR"))}</span>
    <div><strong>${escapeHtml(profile.display_name || profile.username)}</strong><span>@${escapeHtml(profile.username)}</span></div>
    <div class="person-result-actions"><button class="text-button" type="button" data-profile-open="${escapeHtml(profile.id)}">Abrir perfil</button><button class="text-button" type="button" data-chat-start="${escapeHtml(profile.id)}">Conversar</button></div>
  </article>`).join("");
}

function renderOpenedProfile(container, profile, posts, postsError, showBack = true) {
  const mediaMarkup = (post) => (post.media || []).map((media) => {
    if (!media.signedUrl) return `<span class="media-unavailable">Mídia temporariamente indisponível.</span>`;
    const url = escapeHtml(media.signedUrl);
    const label = escapeHtml(media.alt_text || (media.kind === "video" ? "Vídeo do perfil" : "Foto do perfil"));
    return media.kind === "video"
      ? `<video src="${url}" controls preload="metadata" aria-label="${label}"></video>`
      : `<img src="${url}" alt="${label}" loading="lazy" referrerpolicy="no-referrer">`;
  }).join("");
  const postList = postsError
    ? `<p class="search-empty">Não foi possível carregar as publicações deste perfil.</p>`
    : posts.length
      ? posts.map((post) => `<article class="profile-post"><time datetime="${escapeHtml(post.created_at)}">${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(post.created_at)))}</time><p>${escapeHtml(post.body)}</p>${post.media?.length ? `<div class="profile-post-media-grid">${mediaMarkup(post)}</div>` : ""}</article>`).join("")
      : `<p class="search-empty">Este perfil não tem publicações visíveis para você.</p>`;
  const avatar = profile.avatarUrl
    ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : escapeHtml((profile.display_name || profile.username).slice(0, 1).toLocaleUpperCase("pt-BR"));
  container.innerHTML = `<section class="opened-profile" aria-label="Perfil de ${escapeHtml(profile.username)}">
    ${showBack ? `<button class="text-button" type="button" data-profile-close>← Voltar aos resultados</button>` : `<a class="text-button" href="usuarios.html">← Pessoas</a>`}
    <div class="opened-profile-heading"><span class="person-result-avatar" aria-hidden="true">${avatar}</span>
      <div><h3>${escapeHtml(profile.display_name || profile.username)}</h3><span>@${escapeHtml(profile.username)}</span></div>
    </div>
    ${profile.bio ? `<p class="opened-profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
    <h4>Publicações visíveis</h4><div class="profile-post-list">${postList}</div>
  </section>`;
}

export async function showProfileInContainer(client, profileId, container, { showBack = true } = {}) {
  container.innerHTML = `<p class="search-empty" role="status">Carregando perfil...</p>`;
  const { data: profile, error } = await client.from("profiles").select("id,username,display_name,bio,avatar_path").eq("id", profileId).maybeSingle();
  if (error || !profile) {
    container.innerHTML = `<p class="search-empty" role="alert">Este perfil não está disponível para sua conta.</p>`;
    return;
  }
  if (profile.avatar_path) {
    const { data: signedAvatar } = await client.storage.from("looply-avatars").createSignedUrl(profile.avatar_path, 1800);
    profile.avatarUrl = signedAvatar?.signedUrl || "";
  }
  const { data: posts, error: postsError } = await client.from("posts")
    .select("id,body,created_at,media:post_media(id,storage_path,kind,mime_type,alt_text)")
    .eq("author_id", profileId).order("created_at", { ascending: false }).limit(12);
  const visiblePosts = posts || [];
  const media = visiblePosts.flatMap((post) => (post.media || []).map((item) => item));
  if (!postsError && media.length) {
    const { data: signed, error: signedError } = await client.storage.from("looply-media").createSignedUrls(media.map((item) => item.storage_path), 1800);
    if (!signedError && signed) media.forEach((item, index) => { item.signedUrl = signed[index]?.signedUrl || null; });
  }
  renderOpenedProfile(container, profile, visiblePosts, postsError, showBack);
}

export function bindProfileEvents(root, client, onProfileUpdated) {
  const syncProfileOverview = (form) => {
    const area = form.closest(".profile-page-area");
    const preview = form.querySelector("[data-avatar-preview]");
    const overviewAvatar = area?.querySelector(".profile-overview-avatar");
    const overviewName = area?.querySelector(".profile-overview-copy h2");
    const overviewBio = area?.querySelector(".profile-overview-copy p");
    const visibilityBadge = area?.querySelector(".profile-visibility-badge");
    if (overviewName) overviewName.textContent = form.elements.displayName.value.trim()
      || form.querySelector(".profile-username-readonly")?.textContent.replace(/^@/, "").trim() || "Meu perfil";
    if (overviewBio) overviewBio.textContent = form.elements.bio.value.trim() || "Conte um pouco sobre você.";
    if (overviewAvatar && preview?.firstElementChild) overviewAvatar.replaceChildren(preview.firstElementChild.cloneNode(true));
    if (visibilityBadge) {
      const visibility = form.elements.visibility.value;
      visibilityBadge.textContent = visibility === "private" ? "◉ Perfil privado"
        : visibility === "public" ? "◉ Público" : "◉ Visível para membros";
    }
  };

  const renderAvatarPreview = (preview, url, form) => {
    if (!preview) return;
    const fallbackName = form.elements.displayName.value.trim()
      || form.querySelector(".profile-username-readonly")?.textContent.replace(/^@/, "").trim() || "?";
    const fallbackInitial = Array.from(fallbackName)[0]?.toLocaleUpperCase("pt-BR") || "?";
    if (url) {
      const image = document.createElement("img");
      image.className = "profile-avatar-edit-image";
      image.src = url;
      image.alt = "Prévia da foto de perfil";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        if (!preview.contains(image)) return;
        image.remove();
        const fallback = document.createElement("span");
        fallback.className = "profile-avatar-edit-fallback";
        fallback.setAttribute("aria-hidden", "true");
        fallback.textContent = fallbackInitial;
        preview.append(fallback);
        syncProfileOverview(form);
      }, { once: true });
      preview.replaceChildren(image);
      syncProfileOverview(form);
      return;
    }
    const fallback = document.createElement("span");
    fallback.className = "profile-avatar-edit-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = fallbackInitial;
    preview.replaceChildren(fallback);
    syncProfileOverview(form);
  };

  root.addEventListener("input", (event) => {
    const form = event.target.closest("form[data-profile-edit]");
    if (form && ["displayName", "bio"].includes(event.target.name)) syncProfileOverview(form);
  });
  root.addEventListener("change", (event) => {
    const form = event.target.closest("form[data-profile-edit]");
    if (form && event.target.name === "visibility") syncProfileOverview(form);
  });

  root.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-avatar-input]");
    if (!input) return;
    const form = input.closest("form[data-profile-edit]");
    const preview = form?.querySelector("[data-avatar-preview]");
    const removeButton = form?.querySelector("[data-avatar-remove]");
    const removeState = form?.querySelector("[data-avatar-remove-state]");
    const file = input.files?.[0];
    const previousUrl = form?.dataset.avatarPreviewUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    if (form) delete form.dataset.avatarPreviewUrl;
    if (!file || !preview || !form) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      input.value = "";
      const removingAvatar = removeState?.value === "true";
      renderAvatarPreview(preview, removingAvatar ? "" : preview.dataset.originalAvatarUrl || "", form);
      if (removeButton) {
        removeButton.hidden = !preview.dataset.originalAvatarUrl && !removingAvatar;
        removeButton.textContent = removingAvatar ? "Desfazer" : preview.dataset.originalAvatarUrl ? "Remover foto" : "Cancelar seleção";
      }
      setStatus(form, "Escolha uma imagem JPEG, PNG ou WebP de até 10 MB.", "error");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    form.dataset.avatarPreviewUrl = previewUrl;
    if (removeState) removeState.value = "false";
    if (removeButton) {
      removeButton.hidden = false;
      removeButton.textContent = "Cancelar seleção";
    }
    renderAvatarPreview(preview, previewUrl, form);
    setStatus(form, "Prévia atualizada. Salve para aplicar a foto.", "success");
  });

  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-profile-edit], form[data-profile-search]");
    if (!form || !client) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const values = new FormData(form);
      if (form.matches("[data-profile-edit]")) {
        const displayName = String(values.get("displayName") || "").trim();
        const bio = String(values.get("bio") || "").trim();
        const visibility = String(values.get("visibility") || "members");
        const avatarFile = values.get("avatar");
        const hasAvatarFile = avatarFile instanceof File && avatarFile.size > 0;
        const removeAvatar = String(values.get("removeAvatar") || "false") === "true" && !hasAvatarFile;
        if (!displayName || displayName.length > 80 || bio.length > 280) throw new Error("profile-fields");
        const userId = (await client.auth.getUser()).data.user?.id;
        if (!userId) throw new Error("session expired");
        let newAvatarPath = null;
        let oldAvatarPath = null;
        if (hasAvatarFile || removeAvatar) {
          const { data: currentProfile, error: currentError } = await client.from("profiles").select("avatar_path").eq("id", userId).single();
          if (currentError) throw currentError;
          oldAvatarPath = currentProfile.avatar_path;
        }
        if (hasAvatarFile) {
          const extensions = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
          const extension = extensions.get(avatarFile.type);
          if (!extension || avatarFile.size > 10 * 1024 * 1024) throw new Error("unsupported avatar");
          newAvatarPath = `avatars/${userId}/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await client.storage.from("looply-avatars").upload(newAvatarPath, avatarFile, { contentType: avatarFile.type, upsert: false, cacheControl: "3600" });
          if (uploadError) throw uploadError;
        }
        const updates = { display_name: displayName, bio, profile_visibility: visibility };
        if (hasAvatarFile || removeAvatar) updates.avatar_path = newAvatarPath;
        const { error } = await client.from("profiles").update(updates).eq("id", userId);
        if (error) {
          if (newAvatarPath) await client.storage.from("looply-avatars").remove([newAvatarPath]);
          throw error;
        }
        if (oldAvatarPath && (newAvatarPath || removeAvatar)) {
          const { error: removeError } = await client.storage.from("looply-avatars").remove([oldAvatarPath]);
          if (removeError) console.error("Could not remove previous profile avatar", removeError);
        }
        const previewUrl = form.dataset.avatarPreviewUrl;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setStatus(form, "Perfil atualizado.");
        await onProfileUpdated?.();
      } else {
        const query = String(values.get("query") || "").trim().toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(query)) throw new Error("username");
        const { data, error } = await client.from("profiles").select("id,username,display_name,avatar_path").ilike("username", `${query}%`).order("username").limit(20);
        if (error) throw error;
        renderSearchResults(root.querySelector("[data-profile-results]"), await signProfileAvatars(client, data || []));
      }
    } catch (error) {
      console.error("Looply profile action failed", error);
      if (form.matches("[data-profile-edit]")) {
        const message = "Não foi possível salvar. Confira os campos e tente novamente.";
        setStatus(form, message, "error");
      } else {
        const results = root.querySelector("[data-profile-results]");
        if (results) results.innerHTML = `<p class="search-empty" role="alert">Não foi possível buscar agora. Confira sua conexão e tente novamente.</p>`;
      }
    } finally {
      if (button) button.disabled = false;
    }
  });

  root.addEventListener("click", async (event) => {
    const avatarRemove = event.target.closest("[data-avatar-remove]");
    if (avatarRemove) {
      const form = avatarRemove.closest("form[data-profile-edit]");
      const input = form?.querySelector("[data-avatar-input]");
      const preview = form?.querySelector("[data-avatar-preview]");
      const removeState = form?.querySelector("[data-avatar-remove-state]");
      if (!form || !input || !preview || !removeState) return;
      const hadSelection = Boolean(input.files?.length);
      const pendingUrl = form.dataset.avatarPreviewUrl;
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      delete form.dataset.avatarPreviewUrl;
      if (hadSelection) input.value = "";
      const originalUrl = preview.dataset.originalAvatarUrl || "";
      if (hadSelection) {
        removeState.value = "false";
        renderAvatarPreview(preview, originalUrl, form);
        avatarRemove.textContent = originalUrl ? "Remover foto" : "Escolher foto";
        setStatus(form, "Seleção cancelada.", "success");
      } else if (removeState.value === "true") {
        removeState.value = "false";
        renderAvatarPreview(preview, originalUrl, form);
        avatarRemove.textContent = "Remover foto";
        setStatus(form, "Remoção desfeita.", "success");
      } else if (originalUrl) {
        removeState.value = "true";
        renderAvatarPreview(preview, "", form);
        avatarRemove.textContent = "Desfazer";
        setStatus(form, "A foto será removida ao salvar.", "success");
      } else {
        renderAvatarPreview(preview, "", form);
        avatarRemove.hidden = true;
        setStatus(form, "Seleção cancelada.", "success");
      }
      if (removeState.value === "false" && !originalUrl && !input.files?.length) avatarRemove.hidden = true;
      else avatarRemove.hidden = false;
      return;
    }
    const openButton = event.target.closest("[data-profile-open]");
    const closeButton = event.target.closest("[data-profile-close]");
    const chatButton = event.target.closest("[data-chat-start]");
    const container = root.querySelector("[data-profile-results]");
    if (chatButton && client) {
      chatButton.disabled = true;
      try {
        const { data, error } = await client.functions.invoke("looply-chat", { body: { action: "create_direct", targetId: chatButton.dataset.chatStart } });
        if (error) throw error;
        if (!data?.conversationId) throw new Error("conversation unavailable");
        window.location.assign(`conversa.html?id=${encodeURIComponent(data.conversationId)}`);
      } catch (error) {
        console.error("Looply profile conversation failed", error);
        chatButton.disabled = false;
        chatButton.textContent = "Tentar novamente";
      }
      return;
    }
    if (closeButton && container) {
      const query = root.querySelector("#peopleQuery")?.value || "";
      if (query.length >= 3) {
        const { data } = await client.from("profiles").select("id,username,display_name,avatar_path").ilike("username", `${query.toLowerCase()}%`).order("username").limit(20);
        renderSearchResults(container, await signProfileAvatars(client, data || []));
      }
    }
    if (!openButton || !client || !container) return;
    await showProfileInContainer(client, openButton.dataset.profileOpen, container);
  });
}


