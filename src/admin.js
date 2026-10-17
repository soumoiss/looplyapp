function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export async function checkAdminAccess(client) {
  if (!client) return false;
  try {
    const { data, error } = await client.functions.invoke("looply-admin", { body: { resourceType: "status" } });
    if (error) throw error;
    return data?.isAdmin === true;
  } catch (error) {
    console.error("Looply admin status unavailable", error);
    return false;
  }
}

export function adminMarkup(profile = {}) {
  const adminName = profile.username === "peixinho" ? "Peixinho" : `@${escapeHtml(profile.username || "administrador")}`;
  return `<section class="admin-area" aria-labelledby="adminTitle">
    <div class="admin-heading"><div><span class="section-kicker">Acesso verificado pelo servidor</span><h2 id="adminTitle">Administração</h2></div>
      <span class="admin-badge">${adminName} · administrador</span></div>
    <p class="admin-description">Toda consulta a conteúdo privado exige um motivo e gera eventos na trilha de auditoria.</p>
    <form class="admin-read-form" data-admin-read>
      <div class="admin-form-grid">
        <div class="field"><label for="adminResource">Área</label><select id="adminResource" name="resourceType">
          <option value="posts">Publicações, comentários e mídias</option>
          <option value="music_dedications">Músicas e comentários</option>
          <option value="music_library">Coleções pessoais de músicas</option>
          <option value="letters">Cartas para Peixinho</option>
          <option value="conversations">Conversas privadas</option>
          <option value="chat_messages">Mensagens de chat e anexos</option>
          <option value="profiles">Perfis</option>
          <option value="post_media">Arquivo de mídia</option>
          <option value="archived_cards">Cartas antigas</option>
          <option value="archive_media">Mídias antigas</option>
          <option value="archive_media_comments">Comentários das mídias antigas</option>
          <option value="audit">Trilha de auditoria</option>
        </select></div>
        <div class="field" data-admin-id-field><label for="adminResourceId">UUID específico (opcional)</label><input id="adminResourceId" name="resourceId" type="text" maxlength="36" placeholder="Deixe vazio para consultar a lista recente"></div>
        <div class="field" data-admin-offset-field hidden><label for="adminOffset">Posição da lista</label><input id="adminOffset" name="offset" type="number" min="0" max="10000" step="100" value="0"><small>As mídias são exibidas em grupos de 100.</small></div>
      </div>
      <div class="field"><label for="adminPurpose">Motivo da consulta</label><textarea id="adminPurpose" name="purpose" minlength="20" maxlength="500" rows="3" required placeholder="Descreva por que esta consulta é necessária (mínimo de 20 caracteres)."></textarea></div>
      <button class="primary-button compact-button" type="submit">Registrar e consultar <span aria-hidden="true">↗</span></button>
      <span class="form-status" data-status role="status" aria-live="polite"></span>
    </form>
    <div class="admin-results" data-admin-results aria-live="polite"><p>Consultas administrativas aparecem aqui depois de registradas.</p></div>
    <div data-archive-import></div>
  </section>`;
}

function dateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function setStatus(form, message, kind = "success") {
  const status = form.querySelector("[data-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

function mediaMarkup(media) {
  if (!media.signed_url) return `<p class="admin-media-link">Arquivo sem link temporário ativo.</p>`;
  const url = escapeHtml(media.signed_url);
  const label = escapeHtml(media.alt_text || media.file_name || media.storage_path || "Mídia privada");
  if (media.mime_type?.startsWith("audio/")) return `<figure><audio src="${url}" controls preload="metadata" aria-label="${label}"></audio><figcaption>${label}</figcaption></figure>`;
  if (media.mime_type === "application/pdf" || media.mime_type === "text/plain") return `<p class="admin-media-link"><a href="${url}" target="_blank" rel="noopener noreferrer">Abrir ${label} ↗</a></p>`;
  if (media.mime_type === "image/heic") return `<p class="admin-media-link"><a href="${url}" target="_blank" rel="noopener noreferrer">Abrir ou baixar ${label} ↗</a></p>`;
  return (media.kind === "video" || media.mime_type?.startsWith("video/"))
    ? `<figure><video src="${url}" controls preload="metadata" aria-label="${label}"></video><figcaption>${label}</figcaption></figure>`
    : `<figure><img src="${url}" alt="${label}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${label}</figcaption></figure>`;
}

function itemMarkup(resourceType, item) {
  if (resourceType === "posts") {
    const comments = (item.comments || []).map((comment) => `<li><strong>@${escapeHtml(comment.author?.username || "perfil restrito")}</strong><p>${escapeHtml(comment.body)}</p></li>`).join("");
    const media = (item.media || []).map(mediaMarkup).join("");
    return `<article class="admin-record"><div class="admin-record-top"><strong>@${escapeHtml(item.author?.username || "perfil restrito")}</strong><span>${escapeHtml(item.visibility)} · ${escapeHtml(dateTime(item.created_at))}</span></div>
      <p class="admin-record-body">${escapeHtml(item.body)}</p>${media ? `<div class="admin-media-grid">${media}</div>` : ""}
      ${comments ? `<details><summary>${item.comments.length} comentário(s)</summary><ul>${comments}</ul></details>` : ""}
      <form class="admin-comment-form" data-admin-comment data-post-id="${escapeHtml(item.id)}"><label class="visually-hidden" for="admin-comment-${escapeHtml(item.id)}">Comentário administrativo</label><textarea id="admin-comment-${escapeHtml(item.id)}" name="body" maxlength="2000" required placeholder="Comente como administrador..."></textarea><button class="text-button" type="submit">Comentar como administrador</button><span class="form-status" data-status role="status" aria-live="polite"></span></form>
      <small>Post UUID: ${escapeHtml(item.id)}</small></article>`;
  }
  if (resourceType === "music_dedications") {
    const comments = (item.comments || []).map((comment) => `<li><strong>@${escapeHtml(comment.author?.username || "perfil restrito")} · ${escapeHtml(comment.visibility)}</strong><p>${escapeHtml(comment.body)}</p></li>`).join("");
    return `<article class="admin-record"><div class="admin-record-top"><strong>${escapeHtml(item.title)}${item.artist ? ` · ${escapeHtml(item.artist)}` : ""}</strong><span>${escapeHtml(dateTime(item.created_at))}</span></div>
      <p class="admin-record-body">${escapeHtml(item.dedication_note)}</p><p>@${escapeHtml(item.sender?.username || "perfil restrito")} → @${escapeHtml(item.recipient?.username || "perfil restrito")}</p>
      <a class="music-listen" href="${escapeHtml(item.listen_url)}" target="_blank" rel="noopener noreferrer">Abrir link externo ↗</a>${comments ? `<details><summary>Comentários</summary><ul>${comments}</ul></details>` : ""}</article>`;
  }
  if (resourceType === "music_library") {
    return `<article class="admin-record"><div class="admin-record-top"><strong>${escapeHtml(item.title)}${item.artist ? ` · ${escapeHtml(item.artist)}` : ""}</strong><span>${escapeHtml(dateTime(item.created_at))}</span></div>
      <p>@${escapeHtml(item.owner?.username || "perfil restrito")}</p>${item.note ? `<p class="admin-record-body">${escapeHtml(item.note)}</p>` : ""}
      <a class="music-listen" href="${escapeHtml(item.listen_url)}" target="_blank" rel="noopener noreferrer">Abrir link externo ↗</a></article>`;
  }
  if (resourceType === "profiles") {
    return `<article class="admin-record"><div class="admin-record-top"><strong>@${escapeHtml(item.username)}</strong><span>${escapeHtml(item.profile_visibility)}</span></div>
      <p class="admin-record-body">${escapeHtml(item.display_name)}${item.bio ? ` · ${escapeHtml(item.bio)}` : ""}</p><button class="text-button" type="button" data-admin-chat-start="${escapeHtml(item.id)}">Iniciar conversa</button><span class="form-status" data-status role="status" aria-live="polite"></span><small>Perfil UUID: ${escapeHtml(item.id)}</small></article>`;
  }
  if (resourceType === "post_media") {
    return `<article class="admin-record"><div class="admin-record-top"><strong>${escapeHtml(item.kind)} · ${escapeHtml(item.mime_type)}</strong><span>${escapeHtml(String(Math.ceil(item.byte_size / 1024)))} KiB</span></div>
      ${mediaMarkup(item)}<p>${escapeHtml(item.post?.body || "")}</p><small>Mídia UUID: ${escapeHtml(item.id)} · Post UUID: ${escapeHtml(item.post_id)}</small></article>`;
  }
  if (resourceType === "archived_cards") {
    const recipient = item.recipient?.display_name || item.recipient?.username || "Perfil";
    const body = item.body ? `<details class="admin-archive-card-body"><summary>Visualizar carta</summary><pre>${escapeHtml(item.body)}</pre></details>` : `<p class="admin-record-body">O conteúdo da carta não está disponível.</p>`;
    return `<article class="admin-record"><div class="admin-record-top"><strong>${escapeHtml(item.original_file)} · ${escapeHtml(recipient)}</strong><span>${item.is_private ? "Privada" : "Carta"}${item.is_protected ? " · protegida" : ""}${item.sent_date ? ` · ${escapeHtml(item.sent_date)}` : ""}</span></div>
      ${item.password_hint ? `<p class="admin-record-hint">Dica: ${escapeHtml(item.password_hint)}</p>` : ""}${body}<small>Carta UUID: ${escapeHtml(item.id)}</small></article>`;
  }
  if (resourceType === "archive_media") {
    const recipients = (item.recipients || []).map((entry) => `@${escapeHtml(entry.profile?.username || "perfil restrito")}`).join(" · ");
    const comments = (item.comments || []).map((comment) => `<li><strong>@${escapeHtml(comment.author?.username || "perfil restrito")}</strong><p>${escapeHtml(comment.body)}</p></li>`).join("");
    return `<article class="admin-record"><div class="admin-record-top"><strong>${escapeHtml(item.file_name)} · ${escapeHtml(item.kind)}</strong><span>${escapeHtml(item.visibility)}${item.source_date ? ` · ${escapeHtml(dateTime(item.source_date))}` : ""}</span></div>
      ${mediaMarkup({ ...item, alt_text: item.file_name })}<p>${escapeHtml(item.source_path)} · ${escapeHtml(String(Math.ceil(item.byte_size / 1024)))} KiB${recipients ? ` · ${recipients}` : ""}</p>
      ${comments ? `<details><summary>${item.comments.length} comentário(s)</summary><ul>${comments}</ul></details>` : "<p class=\"admin-empty\">Nenhum comentário.</p>"}
      <form class="admin-comment-form" data-admin-archive-comment data-media-id="${escapeHtml(item.id)}"><label class="visually-hidden" for="admin-archive-comment-${escapeHtml(item.id)}">Comentário administrativo</label><textarea id="admin-archive-comment-${escapeHtml(item.id)}" name="body" maxlength="2000" required placeholder="Comente como administrador..."></textarea><button class="text-button" type="submit">Comentar como administrador</button><span class="form-status" data-status role="status" aria-live="polite"></span></form>
      <small>Mídia UUID: ${escapeHtml(item.id)}</small></article>`;
  }
  if (resourceType === "archive_media_comments") {
    return `<article class="admin-record"><div class="admin-record-top"><strong>@${escapeHtml(item.author?.username || "perfil restrito")}</strong><span>${escapeHtml(dateTime(item.created_at))}</span></div><p class="admin-record-body">${escapeHtml(item.body)}</p><p>${escapeHtml(item.media?.file_name || "Mídia antiga")} · ${escapeHtml(item.media?.visibility || "")}</p><small>Comentário UUID: ${escapeHtml(item.id)} · Mídia UUID: ${escapeHtml(item.media_id)}</small></article>`;
  }
  if (resourceType === "letters") {
    return `<article class="admin-record"><div class="admin-record-top"><strong>Carta · ${escapeHtml(item.subject)}</strong><span>${escapeHtml(dateTime(item.created_at))}</span></div>
      <p>@${escapeHtml(item.sender?.username || "perfil restrito")} → @${escapeHtml(item.recipient?.username || "peixinho")}</p>
      <p class="admin-record-body">${escapeHtml(item.initial_message?.body || "A mensagem inicial não está disponível.")}</p><small>Conversa UUID: ${escapeHtml(item.conversation_id)}</small></article>`;
  }
  if (resourceType === "conversations") {
    const participants = (item.participants || []).map((participant) => `@${escapeHtml(participant.profile?.username || "perfil restrito")}`).join(" · ");
    return `<article class="admin-record"><div class="admin-record-top"><strong>${escapeHtml(item.kind === "letter" ? `Carta · ${item.subject || ""}` : "Conversa privada")}</strong><span>${escapeHtml(dateTime(item.updated_at))}</span></div><p>${participants}</p><small>Conversa UUID: ${escapeHtml(item.id)}</small></article>`;
  }
  if (resourceType === "chat_messages") {
    const media = (item.media || []).map(mediaMarkup).join("");
    return `<article class="admin-record"><div class="admin-record-top"><strong>@${escapeHtml(item.author?.username || "perfil restrito")}</strong><span>${escapeHtml(dateTime(item.created_at))}</span></div>
      <p class="admin-record-body">${escapeHtml(item.body)}</p>${media ? `<div class="admin-media-grid">${media}</div>` : ""}<small>Conversa UUID: ${escapeHtml(item.conversation_id)} · Mensagem UUID: ${escapeHtml(item.id)}</small></article>`;
  }
  return `<article class="admin-record"><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre></article>`;
}

function renderResults(container, resourceType, data) {
  const rows = Array.isArray(data) ? data : data == null ? [] : [data];
  if (!rows.length) {
    container.innerHTML = `<p class="admin-empty">Nenhum registro foi encontrado.</p>`;
    return;
  }
  container.innerHTML = `<p class="admin-result-count">${rows.length} registro(s) · conteúdo privado consultado após auditoria</p>${rows.map((item) => itemMarkup(resourceType, item)).join("")}`;
}

export function bindAdminEvents(root, client) {
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-admin-chat-start]");
    if (!button || !client) return;
    button.disabled = true;
    try {
      const { data, error } = await client.functions.invoke("looply-chat", {
        body: { action: "create_direct", targetId: button.dataset.adminChatStart }
      });
      if (error) throw error;
      if (!data?.conversationId) throw new Error(data?.errorCode || "conversation unavailable");
      root.dispatchEvent(new CustomEvent("looply:open-conversation", { detail: { conversationId: data.conversationId } }));
    } catch (error) {
      console.error("Looply admin conversation start failed", error);
      const status = button.parentElement?.querySelector("[data-status]");
      if (status) {
        status.textContent = "Não foi possível iniciar essa conversa.";
        status.dataset.kind = "error";
      }
    } finally { button.disabled = false; }
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("#adminResource")) {
      const field = root.querySelector("[data-admin-id-field]");
      if (field) field.hidden = event.target.value === "audit";
      const offsetField = root.querySelector("[data-admin-offset-field]");
      if (offsetField) offsetField.hidden = event.target.value !== "archive_media";
      const offset = root.querySelector("#adminOffset");
      if (offset && event.target.value === "archive_media") offset.value = "0";
    }
  });

  root.addEventListener("submit", async (event) => {
    const archiveCommentForm = event.target.closest("form[data-admin-archive-comment]");
    if (archiveCommentForm && client) {
      event.preventDefault();
      const button = archiveCommentForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const purpose = String(root.querySelector('[data-admin-read] textarea[name="purpose"]')?.value || "").trim();
        const body = String(new FormData(archiveCommentForm).get("body") || "").trim();
        if (purpose.length < 20 || purpose.length > 500) throw new Error("purpose");
        if (!body || body.length > 2000) throw new Error("comment");
        const { data, error } = await client.functions.invoke("looply-admin", {
          body: { action: "comment_archive_media", resourceType: "archive_media", mediaId: archiveCommentForm.dataset.mediaId, body, purpose }
        });
        if (error) throw error;
        if (!data?.comment) throw new Error("comment unavailable");
        const saved = document.createElement("p");
        saved.className = "admin-record-body admin-comment-confirmation";
        saved.textContent = `Comentário de administrador: ${data.comment.body}`;
        archiveCommentForm.before(saved);
        archiveCommentForm.reset();
        setStatus(archiveCommentForm, "Comentário registrado e atribuído ao perfil administrador.");
      } catch (error) {
        console.error("Looply audited archive comment failed");
        setStatus(archiveCommentForm, /purpose/.test(String(error?.message || ""))
          ? "Informe o motivo da ação no campo acima (20–500 caracteres)."
          : "O comentário não foi salvo. Confira o acesso administrativo e tente novamente.", "error");
      } finally {
        if (button) button.disabled = false;
      }
      return;
    }
    const commentForm = event.target.closest("form[data-admin-comment]");
    if (commentForm && client) {
      event.preventDefault();
      const button = commentForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const purpose = String(root.querySelector('[data-admin-read] textarea[name="purpose"]')?.value || "").trim();
        const body = String(new FormData(commentForm).get("body") || "").trim();
        if (purpose.length < 20 || purpose.length > 500) throw new Error("purpose");
        if (!body || body.length > 2000) throw new Error("comment");
        const { data, error } = await client.functions.invoke("looply-admin", {
          body: { action: "comment", resourceType: "posts", postId: commentForm.dataset.postId, body, purpose }
        });
        if (error) throw error;
        if (!data?.comment) throw new Error("comment unavailable");
        const saved = document.createElement("p");
        saved.className = "admin-record-body admin-comment-confirmation";
        saved.textContent = `Comentário de administrador: ${data.comment.body}`;
        commentForm.before(saved);
        commentForm.reset();
        setStatus(commentForm, "Comentário registrado e atribuído ao perfil administrador.");
      } catch (error) {
        console.error("Looply audited admin comment failed", error);
        const message = /purpose/.test(String(error?.message || ""))
          ? "Informe o motivo da ação no campo acima (20–500 caracteres)."
          : "O comentário não foi salvo. A publicação pode ter sido removida ou o serviço está indisponível.";
        setStatus(commentForm, message, "error");
      } finally {
        if (button) button.disabled = false;
      }
      return;
    }
    const form = event.target.closest("form[data-admin-read]");
    if (!form || !client) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const status = form.querySelector("[data-status]");
    if (status) status.textContent = "Registrando consulta e carregando conteúdo...";
    try {
      const values = new FormData(form);
      const resourceType = String(values.get("resourceType") || "posts");
      const resourceId = String(values.get("resourceId") || "").trim() || null;
      const offset = Number(values.get("offset") || 0);
      const purpose = String(values.get("purpose") || "").trim();
      if (purpose.length < 20) throw new Error("purpose");
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("offset");
      const { data, error } = await client.functions.invoke("looply-admin", {
        body: { resourceType, resourceId: resourceType === "audit" ? null : resourceId, offset, purpose }
      });
      if (error) throw error;
      renderResults(root.querySelector("[data-admin-results]"), resourceType, data?.data);
      if (status) status.textContent = `Consulta registrada · ${data?.requestId || ""}`;
      status?.setAttribute("data-kind", "success");
    } catch (error) {
      console.error("Looply audited admin read failed", error);
      const message = /purpose/.test(String(error?.message || ""))
        ? "Informe um motivo com pelo menos 20 caracteres."
        : /offset/.test(String(error?.message || ""))
          ? "Informe uma posição válida entre 0 e 10.000."
          : "A consulta não foi concluída. A associação administrativa ou o serviço não está disponível.";
      if (status) {
        status.textContent = message;
        status.dataset.kind = "error";
      }
    } finally {
      if (button) button.disabled = false;
    }
  });
}

