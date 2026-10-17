function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

export async function loadArchiveMedia(client, userId) {
  const [mediaResult, commenterResult] = await Promise.all([
    client.from("archive_media")
      .select("id,source_path,file_name,description,storage_path,kind,mime_type,byte_size,visibility,comment_access,created_at")
      .order("source_path", { ascending: true }).limit(500),
    userId
      ? client.from("archive_media_commenters").select("media_id").eq("user_id", userId)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (mediaResult.error) throw mediaResult.error;
  if (commenterResult.error) throw commenterResult.error;
  const commenterMedia = new Set((commenterResult.data || []).map((row) => row.media_id));
  return (mediaResult.data || []).map((item) => ({
    ...item,
    signedUrl: null,
    comments: [],
    commentsLoaded: false,
    canComment: item.comment_access === "viewers" || (item.comment_access === "selected" && commenterMedia.has(item.id))
  }));
}

export function archiveGalleryMarkup(media, isAdmin = false) {
  const tiles = media.map((item) => {
    const title = escapeHtml(item.file_name || item.source_path);
    const url = escapeHtml(item.signedUrl || "");
    const kind = escapeHtml(item.kind);
    const access = item.visibility === "exclusive" ? "exclusive" : "members";
    const searchText = escapeHtml([item.file_name, item.source_path, item.description].join(" ").toLocaleLowerCase("pt-BR"));
    const preview = item.kind === "image" && !String(item.mime_type || "").toLowerCase().includes("heic")
      ? (item.signedUrl
        ? '<img data-archive-thumbnail data-media-id="' + escapeHtml(item.id) + '" src="' + url + '" alt="' + title + '" loading="lazy" referrerpolicy="no-referrer">'
        : '<span class="archive-media-placeholder" data-archive-thumbnail data-media-id="' + escapeHtml(item.id) + '">Imagem</span>')
      : '<span class="archive-media-placeholder">' + (item.kind === "video" ? "Vídeo" : item.kind === "audio" ? "Áudio" : "Imagem") + '</span>';
    const legacyComment = item.description && item.kind === "image"
      ? '<button class="media-comment-toggle" type="button" data-open-archive-description="' + escapeHtml(item.id) + '" aria-label="Ver comentário de ' + title + '" title="Ver comentário"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg></button>'
      : "";
    const createdAt = escapeHtml(item.created_at || "");
    const sortName = escapeHtml(String(item.file_name || item.source_path || "").toLocaleLowerCase("pt-BR"));
    return '<article class="archive-media-tile" data-kind="' + kind + '" data-access="' + access + '" data-created-at="' + createdAt + '" data-name="' + sortName + '" data-search="' + searchText + '">' +
      '<button class="archive-media-open" type="button" data-open-archive-media="' + escapeHtml(item.id) + '" aria-label="Abrir ' + title + '">' + preview +
      '<span class="archive-media-caption"><strong>' + title + '</strong><small>' + kind + ' · ' + escapeHtml(formatDate(item.created_at)) + '</small></span></button>' + legacyComment + '</article>';
  }).join("");
  const emptyMessage = media.length ? "" : '<p class="archive-media-empty" data-archive-media-empty>O acervo ainda não foi importado.</p>';
  const grid = '<div class="archive-media-grid" data-archive-media-grid data-view="grid">' + tiles + '</div>';
  return '<section class="archive-media-library" aria-labelledby="archiveMediaTitle">' +
    '<div class="archive-media-heading"><div><span class="section-kicker">Acervo</span><h2 id="archiveMediaTitle">Mídias antigas</h2></div><span data-archive-media-count>' + media.length + ' arquivo(s)</span></div>' +
    '<div class="archive-gallery-toolbar">' +
      '<label>Buscar<input type="search" data-archive-gallery-search placeholder="Nome ou descrição" autocomplete="off"></label>' +
      '<label>Tipo<select data-archive-gallery-type><option value="all">Todos</option><option value="image">Fotos</option><option value="video">Vídeos</option><option value="audio">Áudios</option></select></label>' +
      '<label>Acesso<select data-archive-gallery-access><option value="all">Todos</option><option value="members">Para todos</option><option value="exclusive">Exclusivos</option></select></label>' +
      '<label>Ordenar<select data-archive-gallery-sort><option value="newest">Mais recentes</option><option value="oldest">Mais antigas</option><option value="name-asc">Nome A–Z</option><option value="name-desc">Nome Z–A</option></select></label>' +
      '<div class="archive-gallery-view-controls" role="group" aria-label="Forma de exibição">' +
        '<button type="button" data-archive-gallery-view="grid" aria-pressed="true">Grade</button>' +
        '<button type="button" data-archive-gallery-view="list" aria-pressed="false">Lista</button>' +
      '<button type="button" data-archive-gallery-view="masonry" aria-pressed="false" title="Mosaico estilo Pinterest">Mosaico</button>' +
      '</div>' +
    '</div>' +
    '<p class="archive-gallery-filter-empty" data-archive-gallery-empty hidden>Nenhuma mídia corresponde aos filtros.</p>' +
    emptyMessage + grid +
    '<div class="archive-viewer" data-archive-viewer aria-hidden="true" inert>' +
      '<div class="archive-viewer-backdrop" data-archive-viewer-close></div>' +
      '<section class="archive-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby="archiveViewerTitle">' +
        '<header class="archive-viewer-header"><div><h2 id="archiveViewerTitle" data-archive-viewer-title></h2><span data-archive-viewer-meta></span></div>' +
          '<div class="archive-viewer-actions"><button type="button" data-viewer-previous aria-label="Mídia anterior">‹</button><button type="button" data-viewer-next aria-label="Próxima mídia">›</button><button type="button" data-viewer-fullscreen>Expandir</button><button type="button" data-archive-viewer-close aria-label="Fechar visualização">×</button></div>' +
        '</header>' +
        '<p class="archive-viewer-description" data-archive-viewer-description hidden></p>' +
        '<div class="archive-viewer-layout"><div class="archive-viewer-stage" data-archive-viewer-stage>' +
          '<div class="archive-viewer-controls"><button type="button" data-media-zoom="out" aria-label="Diminuir zoom">−</button><button type="button" data-media-zoom="reset">Ajustar</button><button type="button" data-media-zoom="in" aria-label="Aumentar zoom">+</button></div>' +
          '<div class="archive-viewer-content" data-archive-viewer-content></div>' +
        '</div>' +
        '<aside class="archive-viewer-comments"><h3>Comentários <span data-viewer-comment-count>0</span></h3><div class="archive-viewer-comment-list" data-viewer-comments></div>' +
          '<p data-no-comment hidden>Você pode visualizar esta mídia, mas não tem permissão para comentar.</p>' +
          '<form class="archive-media-comment-form" data-archive-media-comment><label for="archiveMediaCommentBody">Adicionar comentário</label><textarea id="archiveMediaCommentBody" name="body" maxlength="2000" required placeholder="Escreva um comentário"></textarea>' +
            '<label for="archiveMediaCommentAudience">Quem poderá ver este comentário?</label><select id="archiveMediaCommentAudience" name="audience" data-comment-audience>' +
              '<option value="media_viewers">Quem pode ver a mídia</option><option value="members">Todos os membros</option><option value="selected">Escolher pessoas</option><option value="author_only">Só eu</option></select>' +
            '<label data-comment-recipient-wrap hidden>Destinatários deste comentário<select name="recipientIds" multiple size="4" data-comment-recipients></select></label>' +
            '<button class="primary-button compact-button" type="submit">Comentar</button><span class="form-status" data-status role="status" aria-live="polite"></span></form>' +
        '</aside></div>' +
      '</section>' +
    '</div>' +
  '</section>';
}


function commentsMarkup(comments) {
  if (!comments.length) return '<p class="archive-media-empty">Ainda não há comentários.</p>';
  return comments.map((item) => {
    const visibility = item.audience === "author_only" ? "Privado · só você"
      : item.audience === "selected" ? "Privado · destinatários escolhidos"
        : item.audience === "members" ? "Visível para todos os membros"
          : "Visível para quem pode ver a mídia";
    return '<article class="archive-media-comment"><div><strong>' + escapeHtml(item.author?.display_name || item.author?.username || "Membro") +
      '</strong><span class="archive-comment-visibility">' + visibility + '</span><time datetime="' + escapeHtml(item.created_at) + '">' +
      escapeHtml(formatDate(item.created_at)) + '</time></div><p>' + escapeHtml(item.body) + '</p></article>';
  }).join("");
}


function mediaContent(item) {
  if (!item.signedUrl) return `<p class="archive-media-unavailable">Arquivo temporariamente indisponível.</p>`;
  const url = escapeHtml(item.signedUrl);
  const title = escapeHtml(item.file_name || item.source_path);
  if (item.kind === "video") return `<video src="${url}" controls playsinline preload="metadata" aria-label="${title}"></video>`;
  if (item.kind === "audio") return `<div class="archive-audio-player"><span>${title}</span><audio src="${url}" controls preload="metadata" aria-label="${title}"></audio></div>`;
  if (String(item.mime_type || "").toLowerCase().includes("heic")) return `<a class="archive-heic-link" href="${url}" target="_blank" rel="noopener noreferrer">Abrir ou baixar ${title}</a>`;
  return `<img class="archive-zoom-image" data-zoom-image src="${url}" alt="${title}" draggable="false" referrerpolicy="no-referrer">`;
}

function setCommentStatus(form, message, kind = "") {
  const status = form.querySelector("[data-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

export function bindArchiveGallery(root, client, user, media, profile = user, isAdmin = false) {
  const state = {
    media: [...media], activeId: null, zoom: 1, panX: 0, panY: 0,
    dragging: null, gesture: null, channel: null, lastFocus: null,
    profileOptionsLoaded: false, profileOptionsLoading: null, thumbnailObserver: null
  };
  const viewer = root.querySelector("[data-archive-viewer]");
  const viewerContent = root.querySelector("[data-archive-viewer-content]");
  const stage = root.querySelector("[data-archive-viewer-stage]");
  const current = () => state.media.find((item) => item.id === state.activeId);
  const visibleMedia = () => [...root.querySelectorAll("[data-open-archive-media]")]
    .filter((button) => !button.closest(".archive-media-tile")?.hidden)
    .map((button) => state.media.find((item) => item.id === button.dataset.openArchiveMedia)).filter(Boolean);

  function openLegacyDescription(item) {
    if (!item?.description) return;
    document.querySelector(".media-comment-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "media-comment-overlay";
    const panel = document.createElement("section");
    panel.className = "media-comment-window";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "archiveLegacyCommentTitle");
    const header = document.createElement("header");
    header.className = "media-comment-window-head";
    const title = document.createElement("h2");
    title.id = "archiveLegacyCommentTitle";
    title.textContent = "Comentário da fotografia";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "icon-action";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Fechar comentário");
    header.append(title, closeButton);
    const subtitle = document.createElement("p");
    subtitle.className = "media-comment-window-subtitle";
    subtitle.textContent = item.file_name || item.source_path || "Fotografia";
    const content = document.createElement("div");
    content.className = "media-comment-window-content";
    content.textContent = item.description;
    panel.append(header, subtitle, content);
    overlay.append(panel);
    (document.fullscreenElement || document.body).append(overlay);
    const dismiss = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (event) => { if (event.key === "Escape") dismiss(); };
    closeButton.addEventListener("click", dismiss);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) dismiss(); });
    document.addEventListener("keydown", onKey);
    closeButton.focus();
  }

  function updateNavigation() {
    const visible = visibleMedia();
    const index = visible.findIndex((item) => item.id === state.activeId);
    const previous = root.querySelector("[data-viewer-previous]");
    const next = root.querySelector("[data-viewer-next]");
    if (previous) previous.disabled = index <= 0;
    if (next) next.disabled = index < 0 || index >= visible.length - 1;
  }

  function renderThumbnail(item) {
    const target = [...root.querySelectorAll("[data-archive-thumbnail]")]
      .find((element) => element.dataset.mediaId === item.id);
    if (!target || !item.signedUrl) return;
    if (target instanceof HTMLImageElement) {
      if (target.src !== item.signedUrl) target.src = item.signedUrl;
      return;
    }
    const image = document.createElement("img");
    image.dataset.archiveThumbnail = "";
    image.dataset.mediaId = item.id;
    image.src = item.signedUrl;
    image.alt = item.file_name || item.source_path || "Imagem";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    target.replaceWith(image);
  }

  async function ensureSigned(items) {
    const now = Date.now();
    const missing = [...new Map(items.filter(Boolean)
      .filter((item) => !item.signedUrl || !item.signedAt || now - item.signedAt > 20 * 60 * 1000)
      .map((item) => [item.id, item])).values()];
    if (!missing.length) return;
    const { data, error } = await client.storage.from("looply-media")
      .createSignedUrls(missing.map((item) => item.storage_path), 1800);
    if (error) throw error;
    missing.forEach((item, index) => {
      item.signedUrl = data?.[index]?.signedUrl || null;
      item.signedAt = item.signedUrl ? Date.now() : 0;
      renderThumbnail(item);
    });
  }

  function observeThumbnails() {
    state.thumbnailObserver?.disconnect();
    const targets = [...root.querySelectorAll("[data-archive-thumbnail]")];
    if (!targets.length) return;
    if (!("IntersectionObserver" in window)) {
      void ensureSigned(state.media.filter((item) => item.kind === "image").slice(0, 24))
        .catch((error) => console.warn("Looply archive thumbnail load failed", error));
      return;
    }
    state.thumbnailObserver = new IntersectionObserver((entries) => {
      const visibleIds = entries.filter((entry) => entry.isIntersecting)
        .map((entry) => entry.target.dataset.mediaId).filter(Boolean);
      const candidates = visibleIds.map((id) => state.media.find((item) => item.id === id)).filter(Boolean);
      if (candidates.length) {
        void ensureSigned(candidates).catch((error) => console.warn("Looply archive thumbnail load failed", error));
        for (const entry of entries) if (entry.isIntersecting) state.thumbnailObserver?.unobserve(entry.target);
      }
    }, { rootMargin: "320px 0px" });
    for (const target of targets) state.thumbnailObserver.observe(target);
  }

  async function loadCommentProfiles() {
    if (state.profileOptionsLoaded) return;
    if (state.profileOptionsLoading) return state.profileOptionsLoading;
    state.profileOptionsLoading = (async () => {
      const select = root.querySelector("[data-comment-recipients]");
      if (!select) return;
      const { data, error } = await client.from("profiles")
        .select("id,username,display_name").order("username", { ascending: true }).limit(500);
      if (error) throw error;
      select.replaceChildren();
      for (const person of data || []) {
        const option = document.createElement("option");
        option.value = String(person.id);
        option.textContent = (person.display_name || person.username || "Perfil") +
          (person.username ? " · @" + person.username : "");
        select.append(option);
      }
      state.profileOptionsLoaded = true;
    })();
    try { await state.profileOptionsLoading; }
    finally { state.profileOptionsLoading = null; }
  }

  async function loadComments(item, force = false) {
    if (item.commentsLoaded && !force) return item.comments || [];
    const { data, error } = await client.from("archive_media_comments")
      .select("id,media_id,author_id,body,audience,created_at,author:profiles!archive_media_comments_author_id_fkey(username,display_name)")
      .eq("media_id", item.id).order("created_at", { ascending: true }).limit(100);
    if (error) throw error;
    item.comments = data || [];
    item.commentsLoaded = true;
    if (current()?.id === item.id) renderComments(item);
    return item.comments;
  }

  function renderComments(item) {
    const list = root.querySelector("[data-viewer-comments]");
    const count = root.querySelector("[data-viewer-comment-count]");
    if (list) list.innerHTML = commentsMarkup(item.comments || []);
    if (count) count.textContent = String((item.comments || []).length);
  }

  function setCommentForm(item) {
    const form = root.querySelector("[data-archive-media-comment]");
    const noComment = root.querySelector("[data-no-comment]");
    if (!form) return;
    form.reset();
    form.dataset.mediaId = item.id;
    form.hidden = !item.canComment;
    if (noComment) noComment.hidden = Boolean(item.canComment);
    const audience = form.querySelector("[data-comment-audience]");
    const recipientWrap = form.querySelector("[data-comment-recipient-wrap]");
    const recipientSelect = form.querySelector("[data-comment-recipients]");
    if (audience) audience.value = "media_viewers";
    if (recipientWrap) recipientWrap.hidden = true;
    if (recipientSelect) recipientSelect.replaceChildren();
  }

  function applyZoom() {
    const image = viewerContent?.querySelector("[data-zoom-image]");
    if (!image) return;
    if (state.zoom <= 1) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
    }
    const maxX = Math.max(0, (image.clientWidth * state.zoom - stage.clientWidth) / 2);
    const maxY = Math.max(0, (image.clientHeight * state.zoom - stage.clientHeight) / 2);
    state.panX = Math.max(-maxX, Math.min(maxX, state.panX));
    state.panY = Math.max(-maxY, Math.min(maxY, state.panY));
    image.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    image.style.cursor = state.zoom > 1 ? (state.dragging ? "grabbing" : "grab") : "zoom-in";
  }

  async function show(item, trigger = document.activeElement) {
    if (!item || !viewer) return;
    state.activeId = item.id;
    state.lastFocus = trigger instanceof HTMLElement ? trigger : null;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.dragging = null;
    state.gesture = null;
    root.querySelector("[data-archive-viewer-title]").textContent = item.file_name || item.source_path;
    root.querySelector("[data-archive-viewer-meta]").textContent = `${item.kind} · ${formatDate(item.created_at)}`;
    const description = root.querySelector("[data-archive-viewer-description]");
    if (description) {
      description.textContent = item.description || "";
      description.hidden = !item.description;
    }
    if (viewerContent) viewerContent.innerHTML = '<span class="archive-media-placeholder">Carregando mídia…</span>';
    renderComments(item);
    if (!item.commentsLoaded) {
      const list = root.querySelector("[data-viewer-comments]");
      if (list) list.innerHTML = '<p class="archive-media-empty">Carregando comentários…</p>';
    }
    setCommentForm(item);
    viewer.classList.add("is-open");
    viewer.setAttribute("aria-hidden", "false");
    viewer.removeAttribute("inert");
    document.body.classList.add("modal-open");
    updateNavigation();

    const visible = visibleMedia();
    const position = visible.findIndex((entry) => entry.id === item.id);
    const neighbors = [visible[position - 1], item, visible[position + 1]].filter(Boolean);
    const [signedResult, commentsResult] = await Promise.allSettled([
      ensureSigned(neighbors), loadComments(item)
    ]);
    if (signedResult.status === "rejected") console.warn("Looply archive viewer media load failed", signedResult.reason);
    if (commentsResult.status === "rejected") {
      console.warn("Looply archive comments load failed", commentsResult.reason);
      if (current()?.id === item.id) {
        const list = root.querySelector("[data-viewer-comments]");
        if (list) list.innerHTML = '<p class="archive-media-empty" role="alert">Não foi possível carregar os comentários.</p>';
      }
    }
    if (current()?.id !== item.id) return;
    if (viewerContent) viewerContent.innerHTML = mediaContent(item);
    applyZoom();
    if (item.canComment) {
      const audience = root.querySelector("[data-comment-audience]");
      if (audience?.value === "selected") {
        try { await loadCommentProfiles(); }
        catch (error) { setCommentStatus(root.querySelector("[data-archive-media-comment]"), "Não foi possível carregar os destinatários.", "error"); }
      }
    }
  }

  function close() {
    if (!viewer) return;
    viewerContent?.querySelectorAll("video,audio").forEach((player) => player.pause());
    if (document.fullscreenElement === stage) void document.exitFullscreen?.();
    viewer.classList.remove("is-open");
    viewer.setAttribute("aria-hidden", "true");
    viewer.setAttribute("inert", "");
    document.body.classList.remove("modal-open");
    state.activeId = null;
    state.gesture = null;
    state.dragging = null;
    const trigger = state.lastFocus;
    state.lastFocus = null;
    if (trigger?.isConnected) trigger.focus();
  }

  function refreshTiles(nextMedia) {
    const activeId = state.activeId;
    const previous = new Map(state.media.map((item) => [item.id, item]));
    state.media = nextMedia.map((item) => {
      const old = previous.get(item.id);
      return old ? { ...item, signedUrl: old.signedUrl, signedAt: old.signedAt, comments: old.comments, commentsLoaded: old.commentsLoaded } : item;
    });
    const replacement = document.createElement("div");
    replacement.innerHTML = archiveGalleryMarkup(state.media, isAdmin);
    const nextLibrary = replacement.firstElementChild;
    const currentLibrary = root.querySelector(".archive-media-library");
    const currentGrid = currentLibrary?.querySelector("[data-archive-media-grid]");
    const nextGrid = nextLibrary?.querySelector("[data-archive-media-grid]");
    if (currentGrid && nextGrid) currentGrid.replaceWith(nextGrid);
    const emptyMessage = currentLibrary?.querySelector("[data-archive-media-empty]");
    if (emptyMessage) emptyMessage.hidden = state.media.length > 0;
    const count = currentLibrary?.querySelector("[data-archive-media-count]");
    if (count) count.textContent = `${state.media.length} arquivo(s)`;
    observeThumbnails();
    const active = activeId ? current() : null;
    if (active) {
      renderComments(active);
      updateNavigation();
      const content = viewerContent?.firstElementChild;
      if (active.signedUrl && content && content.getAttribute("src") !== active.signedUrl) {
        content.setAttribute("src", active.signedUrl);
        content.load?.();
        applyZoom();
      }
    } else if (activeId) {
      close();
    }
    root.dispatchEvent(new CustomEvent("archive-gallery-refresh"));
  }

  root.addEventListener("click", (event) => {
    const description = event.target.closest("[data-open-archive-description]");
    if (description) {
      event.preventDefault();
      event.stopPropagation();
      openLegacyDescription(state.media.find((item) => item.id === description.dataset.openArchiveDescription));
      return;
    }
    const open = event.target.closest("[data-open-archive-media]");
    if (open) {
      void show(state.media.find((item) => item.id === open.dataset.openArchiveMedia), open);
      return;
    }
    if (event.target.closest("[data-archive-viewer-close]")) { close(); return; }
    const zoomButton = event.target.closest("[data-media-zoom]");
    if (zoomButton) {
      const action = zoomButton.dataset.mediaZoom;
      if (action === "in") state.zoom = Math.min(5, state.zoom + 0.25);
      else if (action === "out") state.zoom = Math.max(1, state.zoom - 0.25);
      else { state.zoom = 1; state.panX = 0; state.panY = 0; }
      applyZoom();
      return;
    }
    if (event.target.closest("[data-viewer-fullscreen]")) {
      stage?.requestFullscreen?.().catch((error) => console.warn("Fullscreen unavailable", error));
      return;
    }
    const nav = event.target.closest("[data-viewer-previous], [data-viewer-next]");
    if (nav) {
      const visible = visibleMedia();
      const index = visible.findIndex((entry) => entry.id === state.activeId);
      const next = visible[index + (nav.matches("[data-viewer-previous]") ? -1 : 1)];
      if (next) void show(next, nav);
    }
  });

  root.addEventListener("archive-gallery-filter", () => {
    const visible = visibleMedia();
    if (current() && !visible.some((item) => item.id === state.activeId)) { close(); return; }
    updateNavigation();
  });

  root.addEventListener("change", (event) => {
    if (!event.target.matches("[data-comment-audience]")) return;
    const selected = event.target.value === "selected";
    const recipientWrap = root.querySelector("[data-comment-recipient-wrap]");
    if (recipientWrap) recipientWrap.hidden = !selected;
    if (selected) void loadCommentProfiles().catch((error) => {
      console.warn("Looply comment recipient list failed", error);
      setCommentStatus(root.querySelector("[data-archive-media-comment]"), "Não foi possível carregar os destinatários.", "error");
    });
  });

  stage?.addEventListener("wheel", (event) => {
    if (!viewer?.classList.contains("is-open") || !viewerContent?.querySelector("[data-zoom-image]")) return;
    event.preventDefault();
    state.zoom = Math.max(1, Math.min(5, state.zoom + (event.deltaY < 0 ? 0.12 : -0.12)));
    applyZoom();
  }, { passive: false });
  stage?.addEventListener("pointerdown", (event) => {
    if (!viewer?.classList.contains("is-open") || event.target.closest(".archive-viewer-controls")) return;
    if (state.zoom > 1 && event.target.matches("[data-zoom-image]")) {
      state.dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      stage.setPointerCapture?.(event.pointerId);
      applyZoom();
      return;
    }
    if (event.pointerType !== "mouse" && !event.target.closest("button,audio,video,a,input,textarea,select")) {
      state.gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });
  stage?.addEventListener("pointermove", (event) => {
    if (state.dragging?.id === event.pointerId) {
      state.panX = state.dragging.panX + event.clientX - state.dragging.x;
      state.panY = state.dragging.panY + event.clientY - state.dragging.y;
      applyZoom();
    }
  });
  stage?.addEventListener("pointerup", (event) => {
    if (state.dragging?.id === event.pointerId) {
      state.dragging = null;
      applyZoom();
      return;
    }
    const gesture = state.gesture;
    state.gesture = null;
    if (!gesture || gesture.id !== event.pointerId || state.zoom > 1) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    const visible = visibleMedia();
    const index = visible.findIndex((item) => item.id === state.activeId);
    const next = visible[index + (dx > 0 ? -1 : 1)];
    if (next) void show(next, state.lastFocus);
  });
  stage?.addEventListener("pointercancel", () => { state.dragging = null; state.gesture = null; });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && viewer?.classList.contains("is-open")) { close(); return; }
    if (!viewer?.classList.contains("is-open")) return;
    if (event.target.matches("input,textarea,select,[contenteditable=true]")) return;
    if (event.key === "ArrowLeft") root.querySelector("[data-viewer-previous]")?.click();
    if (event.key === "ArrowRight") root.querySelector("[data-viewer-next]")?.click();
  });

  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-archive-media-comment]");
    if (!form) return;
    event.preventDefault();
    const formData = new FormData(form);
    const body = String(formData.get("body") || "").trim();
    const audience = String(formData.get("audience") || "media_viewers");
    const recipientIds = formData.getAll("recipientIds").map(String).filter(Boolean);
    const button = form.querySelector('button[type="submit"]');
    if (!body || body.length > 2000) { setCommentStatus(form, "Escreva um comentário de até 2.000 caracteres.", "error"); return; }
    if (!["media_viewers", "members", "selected", "author_only"].includes(audience)) {
      setCommentStatus(form, "Escolha quem poderá ver este comentário.", "error");
      return;
    }
    if (audience === "selected" && recipientIds.length === 0) {
      setCommentStatus(form, "Escolha pelo menos uma pessoa para receber este comentário.", "error");
      return;
    }
    if (button) button.disabled = true;
    setCommentStatus(form, "Salvando comentário…");
    try {
      const mediaId = form.dataset.mediaId;
      const { data: commentId, error } = await client.rpc("create_archive_media_comment", {
        p_media_id: mediaId,
        p_body: body,
        p_audience: audience,
        p_recipient_ids: audience === "selected" ? recipientIds : []
      });
      if (error) throw error;
      const item = current();
      const comment = {
        id: commentId,
        media_id: mediaId,
        author_id: user.id,
        body,
        audience,
        created_at: new Date().toISOString(),
        author: { username: profile.username, display_name: profile.display_name }
      };
      if (item?.id === mediaId) {
        if (!(item.comments || []).some((existing) => existing.id === commentId)) {
          item.comments = [...(item.comments || []), comment];
        }
        item.commentsLoaded = true;
        renderComments(item);
      }
      form.reset();
      const recipientWrap = form.querySelector("[data-comment-recipient-wrap]");
      if (recipientWrap) recipientWrap.hidden = true;
      setCommentStatus(form, "Comentário salvo na nuvem.", "success");
    } catch (error) {
      console.error("Looply archive media comment failed", error);
      setCommentStatus(form, "O comentário não foi salvo. Confira a conexão e as permissões.", "error");
    } finally {
      if (button) button.disabled = false;
    }
  });

  const status = root.querySelector("[data-archive-media-count]");
  if (status) status.textContent = `${state.media.length} arquivo(s)`;
  observeThumbnails();
  state.channel = client.channel(`looply-archive-media-${user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "archive_media" }, async () => {
      try { refreshTiles(await loadArchiveMedia(client, user.id)); }
      catch (error) { console.error("Looply archive media refresh failed", error); }
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "archive_media_comments" }, async (payload) => {
      const item = current();
      if (!item || item.id !== payload.new.media_id) return;
      try { await loadComments(item, true); }
      catch (error) { console.error("Looply archive comments refresh failed", error); }
    })
    .subscribe();
  window.addEventListener("pagehide", () => {
    state.thumbnailObserver?.disconnect();
    if (state.channel) client.removeChannel(state.channel);
  }, { once: true });
}


