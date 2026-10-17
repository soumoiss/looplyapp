import { uploadResumable } from "./social.js";

const maxStoryBytes = 100 * 1024 * 1024;
const storyMimeTypes = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
  ["video/mp4", "mp4"], ["video/webm", "webm"]
]);
let storiesChannel = null;
let storyRefreshTimer = null;
const refreshers = new WeakMap();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function safeSignedUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? escapeHtml(url.href) : "";
  } catch {
    return "";
  }
}

function rawSignedUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function profileName(profile) {
  return String(profile?.display_name || profile?.username || "Membro");
}

function storyTimeLabels(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { relative: "agora", exact: "" };
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Number.POSITIVE_INFINITY, "year"]];
  let amount = seconds;
  let unit = "second";
  for (const [limit, currentUnit] of units) {
    unit = currentUnit;
    if (Math.abs(amount) < limit) break;
    amount = Math.round(amount / limit);
  }
  const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto", style: "short" }).format(amount, unit);
  const exact = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  return { relative, exact };
}

function initials(value) {
  return Array.from(String(value || "").trim())[0]?.toLocaleUpperCase("pt-BR") || "?";
}

function storyAvatar(profile, label, own = false) {
  const name = profileName(profile);
  const imageUrl = safeSignedUrl(profile?.avatarUrl);
  return '<span class="story-avatar-frame' + (own ? " is-own-story" : "") + '">' +
    (imageUrl
      ? '<img class="story-avatar-image" src="' + imageUrl + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="story-avatar-initial" aria-hidden="true">' + escapeHtml(initials(name)) + "</span>") +
    (label === "Seu story" ? '<span class="story-add-mark" aria-hidden="true">+</span>' : "") +
    '</span><span class="story-avatar-label">' + escapeHtml(label) + "</span>";
}

export function groupActiveStories(stories, now = Date.now()) {
  const grouped = new Map();
  for (const story of Array.isArray(stories) ? stories : []) {
    const createdAt = Date.parse(story?.created_at || "");
    const expiresAt = Date.parse(story?.expires_at || "");
    const effectiveExpiry = Number.isFinite(expiresAt)
      ? expiresAt
      : Number.isFinite(createdAt) ? createdAt + 24 * 60 * 60 * 1000 : NaN;
    if (!story?.author_id || !Number.isFinite(effectiveExpiry) || effectiveExpiry <= now) continue;
    const item = { ...story, expires_at: new Date(effectiveExpiry).toISOString() };
    let group = grouped.get(item.author_id);
    if (!group) {
      group = { author_id: item.author_id, author: item.author || null, stories: [] };
      grouped.set(item.author_id, group);
    }
    if (!group.author && item.author) group.author = item.author;
    group.stories.push(item);
  }
  const result = [...grouped.values()];
  for (const group of result) group.stories.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  return result.sort((left, right) =>
    Date.parse(right.stories.at(-1)?.created_at || 0) - Date.parse(left.stories.at(-1)?.created_at || 0)
  );
}

export function storyMediaUrlTtl(expiresAt, now = Date.now()) {
  const expiry = Date.parse(expiresAt || "");
  if (!Number.isFinite(expiry)) return 0;
  const secondsBeforeExpiry = Math.floor((expiry - now - 5000) / 1000);
  return Math.max(0, Math.min(1800, Math.floor(secondsBeforeExpiry / 30) * 30));
}

export async function loadStories(client) {
  const { data, error } = await client.from("stories")
    .select("id,author_id,body,visibility,created_at,expires_at,author:profiles!stories_author_id_fkey(id,username,display_name,avatar_path),media:story_media!story_media_story_id_fkey(id,storage_path,kind,mime_type,alt_text,created_at)")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;

  const rows = data || [];
  const mediaItems = rows.flatMap((story) => {
    const media = Array.isArray(story.media) ? story.media : story.media ? [story.media] : [];
    return media.map((item) => ({ ...item, storyId: story.id, storyExpiresAt: story.expires_at }));
  });
  const signedAt = Date.now();
  const signGroups = new Map();
  for (const item of mediaItems) {
    item.signedUrl = null;
    const ttl = storyMediaUrlTtl(item.storyExpiresAt, signedAt);
    if (!ttl) continue;
    const group = signGroups.get(ttl) || [];
    group.push(item);
    signGroups.set(ttl, group);
  }
  await Promise.all([...signGroups].map(async ([ttl, items]) => {
    const { data: signed, error: signedError } = await client.storage.from("looply-media")
      .createSignedUrls(items.map((item) => item.storage_path), ttl);
    items.forEach((item, index) => {
      item.signedUrl = signedError ? null : signed?.[index]?.signedUrl || null;
    });
  }));

  const avatarPaths = [...new Set(rows.map((story) => story.author?.avatar_path).filter(Boolean))];
  const avatarUrls = new Map();
  if (avatarPaths.length) {
    const { data: signed, error: signedError } = await client.storage.from("looply-avatars")
      .createSignedUrls(avatarPaths, 1800);
    if (!signedError) avatarPaths.forEach((path, index) => avatarUrls.set(path, signed?.[index]?.signedUrl || null));
  }

  const mediaByStory = new Map();
  for (const item of mediaItems) {
    const list = mediaByStory.get(item.storyId) || [];
    list.push(item);
    mediaByStory.set(item.storyId, list);
  }
  for (const story of rows) {
    story.media = mediaByStory.get(story.id) || [];
    if (story.author) story.author.avatarUrl = avatarUrls.get(story.author.avatar_path) || null;
  }
  return rows;
}

function storyButtonMarkup(group, userId) {
  const own = group.author_id === userId;
  const author = group.author || {};
  const label = own ? "Seu story" : profileName(author);
  return '<button class="story-avatar-button" type="button" data-story-open="' + escapeHtml(group.author_id) +
    '" aria-label="Abrir stories de ' + escapeHtml(label) + '">' +
    storyAvatar(author, label, own) + '<span class="story-count">' + group.stories.length + "</span></button>";
}

function storyListMarkup(groups, userId, profile) {
  const ownGroup = groups.find((group) => group.author_id === userId);
  const otherGroups = groups.filter((group) => group.author_id !== userId);
  const ownStory = ownGroup ? storyButtonMarkup(ownGroup, userId) : "";
  const others = otherGroups.map((group) => storyButtonMarkup(group, userId)).join("");
  const ownAvatar = ownGroup?.author || profile;
  const createShortcut = '<button class="story-avatar-button story-create-shortcut" type="button" data-story-create-open aria-label="Adicionar story">' +
    storyAvatar(ownAvatar, "Seu story", true) + "</button>";
  return ownStory ? ownStory + others : createShortcut + others;
}

export function storiesMarkup(stories, error, people, peopleError, userId, profile) {
  const groups = groupActiveStories(stories);
  const eligiblePeople = (people || []).filter((person) =>
    person.id !== userId && person.profile_visibility !== "private"
  );
  const recipientOptions = eligiblePeople.map((person) =>
    '<option value="' + escapeHtml(person.id) + '">' +
      escapeHtml(person.display_name || person.username) + " · @" + escapeHtml(person.username) +
    "</option>"
  ).join("");
  const peopleHint = peopleError
    ? "Não foi possível carregar os perfis; atualize antes de enviar para pessoas escolhidas."
    : eligiblePeople.length ? "Selecione uma ou mais pessoas visíveis."
      : "Nenhum outro perfil visível está disponível.";
  return '<section class="story-area" aria-labelledby="storyAreaTitle">' +
    '<div class="story-area-heading"><div><span class="section-kicker">Stories</span><h2 id="storyAreaTitle">Stories</h2></div>' +
    '<button class="text-button" type="button" data-story-create-open>Adicionar story</button></div>' +
    '<div class="story-list" data-story-list aria-label="Stories ativos">' +
      storyListMarkup(groups, userId, profile) +
    "</div><p class=\"story-feed-status\" data-story-feed-status role=\"status\">" +
      (error
        ? 'Não foi possível carregar os stories. <button type="button" class="text-button" data-story-refresh>Tentar novamente</button>'
        : groups.length ? "" : "Nenhum story ativo.") +
    "</p>" +
    '<dialog class="story-create-dialog" data-story-create-dialog aria-labelledby="storyCreateTitle">' +
      '<div class="story-dialog-heading"><div><span class="section-kicker">Story</span><h2 id="storyCreateTitle">Adicionar story</h2></div>' +
      '<button class="icon-button" type="button" data-story-create-close aria-label="Fechar">×</button></div>' +
      '<form class="story-create-form" data-story-create>' +
        '<label for="storyBody">Texto <span>(opcional, até 1.000 caracteres)</span></label>' +
        '<textarea id="storyBody" name="body" maxlength="1000" rows="3" placeholder="Adicione um texto"></textarea>' +
        '<div class="story-media-label"><span>Foto ou vídeo <small>(opcional, até 100 MB)</small></span><div class="story-capture-actions">' +
          '<label class="story-file-picker" for="storyMedia">Escolher arquivo ou tirar foto</label>' +
          '<button class="text-button" type="button" data-story-camera-open>Usar câmera</button></div></div>' +
        '<input class="story-file-input" id="storyMedia" name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" capture="environment">' +
        '<section class="story-camera" data-story-camera hidden aria-label="Câmera para gravar um story">' +
          '<video data-story-camera-preview autoplay muted playsinline></video>' +
          '<div class="story-camera-actions"><button class="primary-button compact-button" type="button" data-story-capture-photo>Tirar foto</button>' +
          '<button class="text-button" type="button" data-story-record-toggle>Gravar vídeo</button>' +
          '<button class="text-button" type="button" data-story-camera-close>Fechar câmera</button></div>' +
          '<span class="form-status" data-story-camera-status role="status" aria-live="polite"></span>' +
        '</section>' +
        '<div class="story-media-preview" data-story-preview aria-live="polite"></div>' +
        '<label for="storyVisibility">Quem pode ver?</label>' +
        '<select id="storyVisibility" name="visibility"><option value="public">Todos os membros</option><option value="selected">Pessoas escolhidas</option><option value="private">Só você</option></select>' +
        '<div class="story-recipient-picker" data-story-recipient-picker hidden>' +
          '<label for="storyRecipients">Pessoas escolhidas</label>' +
          '<select id="storyRecipients" name="recipientIds" multiple size="4" ' + (eligiblePeople.length ? "" : "disabled") + ">" + recipientOptions + "</select>" +
          '<small>' + escapeHtml(peopleHint) + "</small>" +
        "</div>" +
        '<div class="story-form-actions"><button class="primary-button compact-button" type="submit">Publicar story</button>' +
        '<span class="form-status" data-story-create-status role="status" aria-live="polite"></span></div>' +
      "</form>" +
    "</dialog>" +
    '<dialog class="story-viewer-dialog" data-story-viewer aria-label="Visualizador de stories">' +
      '<div class="story-viewer-shell">' +
        '<div class="story-progress-list" data-story-progress-list></div>' +
        '<header class="story-viewer-header"><div class="story-viewer-author">' +
          '<span data-story-viewer-avatar></span><span><strong data-story-viewer-name></strong><time data-story-viewer-time></time></span>' +
        '</div><button class="icon-button" type="button" data-story-close aria-label="Fechar stories">×</button></header>' +
        '<div class="story-viewer-stage" data-story-touch-surface>' +
          '<button class="story-tap-zone story-tap-zone-prev" type="button" data-story-prev aria-label="Story anterior"></button>' +
          '<div class="story-viewer-media" data-story-viewer-media></div>' +
          '<button class="story-tap-zone story-tap-zone-next" type="button" data-story-next aria-label="Próximo story"></button>' +
        '</div>' +
        '<p class="story-viewer-caption" data-story-viewer-caption></p>' +
        '<footer class="story-viewer-actions">' +
          '<div class="story-viewer-owner-actions" data-story-owner-actions hidden>' +
            '<button class="story-insights-button" type="button" data-story-insights-open>◉ <span data-story-view-count>Ver visualizações</span></button>' +
            '<button class="story-delete-button" type="button" data-story-delete>Excluir</button>' +
          '</div>' +
          '<div class="story-viewer-reply-actions" data-story-reply-actions hidden>' +
            '<button class="story-like-button" type="button" data-story-like aria-pressed="false"><span aria-hidden="true">♡</span><span data-story-like-label>Curtir</span></button>' +
            '<form class="story-reply-form" data-story-reply><label class="visually-hidden" for="storyReplyMessage">Responder em particular</label>' +
              '<input id="storyReplyMessage" name="reply" maxlength="2000" placeholder="Responder em particular…" autocomplete="off" required>' +
              '<button type="submit" aria-label="Enviar resposta">➤</button></form>' +
            '<span class="story-reply-status" data-story-reply-status role="status" aria-live="polite"></span>' +
          '</div>' +
        '</footer>' +
        '<section class="story-insights-panel" data-story-insights-panel hidden aria-label="Visualizações do story">' +
          '<header><strong>Atividade do story</strong><button type="button" class="icon-button" data-story-insights-close aria-label="Fechar atividade">×</button></header>' +
          '<p data-story-insights-summary>Carregando visualizações…</p><ul data-story-insights-list></ul>' +
        '</section>' +
      "</div>" +
    "</dialog>" +
  "</section>";
}

function setFormStatus(form, message, isError = false) {
  const status = form?.querySelector("[data-story-create-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = isError ? "error" : "success";
}

function activeStoriesFor(group) {
  return (group?.stories || []).filter((story) => Date.parse(story.expires_at) > Date.now());
}

function cleanupExpiredStories(client) {
  if (!client?.functions?.invoke) return;
  void client.functions.invoke("looply-stories-cleanup", { body: {} }).then(({ error }) => {
    if (error) console.warn("Looply story cleanup will retry on a later visit.", error);
  }).catch((error) => console.warn("Looply story cleanup request failed.", error));
}

export function bindStories(root, client, userId, initialStories = [], initialError = null, profile = null) {
  const list = root.querySelector("[data-story-list]");
  const status = root.querySelector("[data-story-feed-status]");
  const createDialog = root.querySelector("[data-story-create-dialog]");
  const viewer = root.querySelector("[data-story-viewer]");
  if (!list || !viewer || !createDialog) return;

  const state = {
    groups: groupActiveStories(initialStories), active: null, index: 0, timer: null, previewUrl: null,
    viewedThisSession: new Set(), likedStories: new Set(), cameraStream: null, mediaRecorder: null,
    recordTimer: null, recordingDiscarded: false, likePending: new Set(), ignoreTapUntil: 0
  };
  const showStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = isError ? "error" : "info";
  };
  const renderList = () => {
    list.innerHTML = storyListMarkup(state.groups, userId, profile);
    if (!state.groups.length) showStatus("Nenhum story ativo.");
    else showStatus("");
  };
  const cameraPanel = root.querySelector("[data-story-camera]");
  const cameraPreview = root.querySelector("[data-story-camera-preview]");
  const cameraStatus = root.querySelector("[data-story-camera-status]");
  const setCameraStatus = (message, isError = false) => {
    if (!cameraStatus) return;
    cameraStatus.textContent = message;
    cameraStatus.dataset.kind = isError ? "error" : "success";
  };
  const stopCamera = (discardRecording = true) => {
    clearTimeout(state.recordTimer);
    state.recordTimer = null;
    if (state.mediaRecorder?.state === "recording") {
      state.recordingDiscarded = discardRecording;
      state.mediaRecorder.stop();
    }
    state.cameraStream?.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    if (cameraPreview) cameraPreview.srcObject = null;
    if (cameraPanel) cameraPanel.hidden = true;
    const recordButton = root.querySelector("[data-story-record-toggle]");
    if (recordButton) {
      recordButton.textContent = "Gravar vídeo";
      recordButton.dataset.recording = "false";
    }
  };
  const selectStoryFile = (blob, filename) => {
    const input = root.querySelector("#storyMedia");
    if (!input || typeof DataTransfer !== "function") throw new Error("file_selection_unavailable");
    const transfer = new DataTransfer();
    const normalizedType = String(blob.type || "").split(";")[0];
    transfer.items.add(new File([blob], filename, { type: normalizedType, lastModified: Date.now() }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera_unavailable");
    const videoOnly = { video: { facingMode: { ideal: "environment" } }, audio: false };
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: true
      });
    } catch {
      state.cameraStream = await navigator.mediaDevices.getUserMedia(videoOnly);
    }
    cameraPreview.srcObject = state.cameraStream;
    cameraPanel.hidden = false;
    root.querySelector("[data-story-capture-photo]").disabled = false;
    root.querySelector("[data-story-record-toggle]").disabled = false;
    setCameraStatus("Câmera pronta. Escolha tirar uma foto ou gravar um vídeo.");
    await cameraPreview.play().catch(() => {});
  };
  const captureStoryPhoto = async () => {
    if (!cameraPreview?.videoWidth || !cameraPreview.videoHeight) throw new Error("camera_not_ready");
    const canvas = document.createElement("canvas");
    canvas.width = cameraPreview.videoWidth;
    canvas.height = cameraPreview.videoHeight;
    canvas.getContext("2d", { alpha: false }).drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
    const photo = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("photo_capture_failed")), "image/jpeg", 0.9));
    selectStoryFile(photo, `story-${Date.now()}.jpg`);
    setCameraStatus("Foto pronta para publicar.");
    stopCamera(false);
  };
  const toggleStoryRecording = () => {
    const button = root.querySelector("[data-story-record-toggle]");
    if (state.mediaRecorder?.state === "recording") {
      state.mediaRecorder.stop();
      return;
    }
    if (!state.cameraStream) throw new Error("camera_not_ready");
    if (typeof MediaRecorder !== "function") throw new Error("recording_unavailable");
    const mimeType = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported?.(type));
    if (!mimeType) throw new Error("recording_unavailable");
    const recorder = new MediaRecorder(state.cameraStream, { mimeType });
    const chunks = [];
    state.recordingDiscarded = false;
    state.mediaRecorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      clearTimeout(state.recordTimer);
      state.recordTimer = null;
      if (state.recordingDiscarded) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (!blob.size || blob.size > maxStoryBytes) {
        setCameraStatus("A gravação ficou vazia ou passou de 100 MB.", true);
        return;
      }
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      try {
        selectStoryFile(blob, `story-${Date.now()}.${extension}`);
        setCameraStatus("Vídeo pronto para publicar.");
      } catch (error) {
        setCameraStatus("Este navegador não permite anexar a gravação. Escolha um arquivo salvo.", true);
      }
      button.textContent = "Gravar vídeo";
      button.dataset.recording = "false";
    });
    recorder.start(1000);
    button.textContent = "Parar gravação";
    button.dataset.recording = "true";
    setCameraStatus("Gravando vídeo… toque em Parar gravação para finalizar.");
    state.recordTimer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 60000);
  };
  const clearTimer = () => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  };
  const resumeStoryTimer = () => {
    const mediaHost = viewer.querySelector("[data-story-viewer-media]");
    const video = mediaHost.querySelector("video");
    if (video && !video.paused && Number.isFinite(video.duration)) {
      const remaining = Math.max(1000, (video.duration - video.currentTime) * 1000);
      setProgressDuration(remaining);
      state.timer = setTimeout(() => advance(1), remaining);
    } else if (!video) {
      setProgressDuration(7000);
      state.timer = setTimeout(() => advance(1), 7000);
    }
  };
  const setProgressDuration = (duration) => {
    const activeProgress = viewer.querySelector(".story-progress-item.is-current i");
    if (activeProgress) {
      activeProgress.style.animationDuration = duration + "ms";
      activeProgress.style.animationPlayState = "running";
    }
  };
  const advance = (direction = 1) => {
    if (!state.active) return;
    clearTimer();
    const groupIndex = state.groups.findIndex((group) => group.author_id === state.active?.author_id);
    if (groupIndex < 0) return;
    let targetGroupIndex = groupIndex;
    let targetIndex = state.index + direction;
    let targetStories = activeStoriesFor(state.groups[targetGroupIndex]);
    while (targetIndex < 0 || targetIndex >= targetStories.length) {
      targetGroupIndex += direction;
      if (targetGroupIndex < 0 || targetGroupIndex >= state.groups.length) {
        if (direction > 0) {
          viewer.close();
          void refresh();
          cleanupExpiredStories(client);
        }
        return;
      }
      targetStories = activeStoriesFor(state.groups[targetGroupIndex]);
      targetIndex = direction > 0 ? 0 : targetStories.length - 1;
      if (!targetStories.length) continue;
    }
    state.active = { ...state.groups[targetGroupIndex], stories: targetStories };
    state.index = targetIndex;
    renderSlide();
  };
  const renderSlide = () => {
    clearTimer();
    if (!state.active) return;
    const stories = activeStoriesFor(state.active);
    state.active.stories = stories;
    if (!stories.length || state.index >= stories.length) {
      viewer.close();
      void refresh();
      return;
    }
    const story = stories[state.index];
    if (!story) return;
    viewer.querySelector("[data-story-progress-list]").innerHTML = stories.map((item, index) =>
      '<span class="story-progress-item' + (index < state.index ? " is-done" : index === state.index ? " is-current" : "") + '">' +
        (index === state.index ? '<i></i>' : "") +
      "</span>"
    ).join("");
    const author = story.author || state.active.author || {};
    const media = Array.isArray(story.media) ? story.media[0] : story.media;
    const mediaUrl = rawSignedUrl(media?.signedUrl);
    viewer.querySelector("[data-story-viewer-name]").textContent = profileName(author);
    const storyTime = viewer.querySelector("[data-story-viewer-time]");
    const timeLabels = storyTimeLabels(story.created_at);
    storyTime.textContent = timeLabels.exact ? `${timeLabels.relative} · ${timeLabels.exact}` : timeLabels.relative;
    storyTime.dateTime = story.created_at;
    storyTime.title = timeLabels.exact ? "Publicado em " + timeLabels.exact : "";
    storyTime.setAttribute("aria-label", timeLabels.exact ? "Publicado em " + timeLabels.exact : "Publicado agora");
    const avatarHost = viewer.querySelector("[data-story-viewer-avatar]");
    avatarHost.innerHTML = storyAvatar(author, "", false);
    const caption = viewer.querySelector("[data-story-viewer-caption]");
    caption.textContent = story.body || "";
    const mediaHost = viewer.querySelector("[data-story-viewer-media]");
    mediaHost.querySelectorAll("video").forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
    mediaHost.replaceChildren();
    if (mediaUrl) {
      if (media.kind === "video") {
        const video = document.createElement("video");
        video.src = mediaUrl;
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", media.alt_text || "Vídeo do story");
        video.addEventListener("loadedmetadata", () => {
          if (Number.isFinite(video.duration) && video.duration > 0) setProgressDuration(video.duration * 1000);
        }, { once: true });
        video.addEventListener("play", () => {
          clearTimer();
          if (Number.isFinite(video.duration) && video.duration > 0) {
            const remaining = Math.max(1000, (video.duration - video.currentTime) * 1000);
            setProgressDuration(remaining);
            state.timer = setTimeout(() => advance(1), remaining);
          }
        });
        video.addEventListener("pause", clearTimer);
        video.addEventListener("ended", () => advance(1), { once: true });
        mediaHost.append(video);
      } else {
        const image = document.createElement("img");
        image.src = mediaUrl;
        image.alt = media.alt_text || "Foto do story";
        image.referrerPolicy = "no-referrer";
        mediaHost.append(image);
        setProgressDuration(7000);
        state.timer = setTimeout(() => advance(1), 7000);
      }
    } else if (!story.body) {
      const missing = document.createElement("p");
      missing.className = "story-media-unavailable";
      missing.textContent = "Mídia temporariamente indisponível.";
      mediaHost.append(missing);
    } else {
      setProgressDuration(7000);
      state.timer = setTimeout(() => advance(1), 7000);
    }

    const currentGroupIndex = state.groups.findIndex((group) => group.author_id === story.author_id);
    viewer.querySelector("[data-story-prev]").disabled = state.index === 0 && currentGroupIndex <= 0;
    viewer.querySelector("[data-story-delete]").hidden = story.author_id !== userId;
    viewer.querySelector("[data-story-owner-actions]").hidden = story.author_id !== userId;
    viewer.querySelector("[data-story-reply-actions]").hidden = story.author_id === userId;
    viewer.querySelector("[data-story-insights-panel]").hidden = true;
    const replyStatus = viewer.querySelector("[data-story-reply-status]");
    if (replyStatus) replyStatus.textContent = "";
    const likeButton = viewer.querySelector("[data-story-like]");
    likeButton.dataset.storyId = story.id;
    likeButton.disabled = false;
    likeButton.setAttribute("aria-pressed", state.likedStories.has(story.id) ? "true" : "false");
    viewer.querySelector("[data-story-like-label]").textContent = state.likedStories.has(story.id) ? "Curtido" : "Curtir";
    const likeIcon = likeButton.querySelector("[aria-hidden]");
    if (likeIcon) likeIcon.textContent = state.likedStories.has(story.id) ? "♥" : "♡";
    const replyInput = viewer.querySelector("[data-story-reply] input");
    if (replyInput) replyInput.value = "";
    if (story.author_id !== userId && !state.viewedThisSession.has(story.id)) {
      state.viewedThisSession.add(story.id);
      void client.rpc("record_story_view", { p_story_id: story.id }).then(({ error }) => {
        if (error) console.warn("Looply story view could not be recorded.", error);
      }).catch((error) => console.warn("Looply story view could not be recorded.", error));
    }
    if (story.author_id === userId) {
      const viewCount = viewer.querySelector("[data-story-view-count]");
      viewCount.textContent = "Carregando visualizações…";
      void client.from("story_views").select("viewer_id", { count: "exact", head: true }).eq("story_id", story.id)
        .then(({ count, error }) => {
          if (!error && state.active?.stories?.[state.index]?.id === story.id) {
            viewCount.textContent = count === 1 ? "1 visualização" : `${count || 0} visualizações`;
          }
        });
    }
    if (story.author_id !== userId) {
      const storyId = story.id;
      void client.from("story_likes").select("story_id").eq("story_id", storyId).eq("user_id", userId).maybeSingle()
        .then(({ data, error }) => {
          if (error || state.likePending.has(storyId)) return;
          if (data) state.likedStories.add(storyId);
          else state.likedStories.delete(storyId);
          if (state.active?.stories?.[state.index]?.id === storyId) {
            likeButton.setAttribute("aria-pressed", data ? "true" : "false");
            viewer.querySelector("[data-story-like-label]").textContent = data ? "Curtido" : "Curtir";
            if (likeIcon) likeIcon.textContent = data ? "♥" : "♡";
          }
        });
    }
  };
  const currentStory = () => state.active?.stories?.[state.index] || null;
  const loadStoryInsights = async (story) => {
    const panel = viewer.querySelector("[data-story-insights-panel]");
    const summary = viewer.querySelector("[data-story-insights-summary]");
    const list = viewer.querySelector("[data-story-insights-list]");
    panel.hidden = false;
    summary.textContent = "Carregando visualizações…";
    list.replaceChildren();
    clearTimer();
    try {
      const { data, error } = await client.from("story_views")
        .select("viewed_at,viewer:profiles!story_views_viewer_id_fkey(username,display_name)")
        .eq("story_id", story.id).order("viewed_at", { ascending: false }).limit(500);
      if (error) throw error;
      const views = data || [];
      summary.textContent = views.length === 1 ? "1 pessoa viu este story." : `${views.length} pessoas viram este story.`;
      if (!views.length) {
        const empty = document.createElement("li");
        empty.className = "story-insights-empty";
        empty.textContent = "As visualizações aparecerão aqui.";
        list.append(empty);
      }
      for (const view of views) {
        const item = document.createElement("li");
        const person = document.createElement("span");
        const name = document.createElement("strong");
        const username = document.createElement("small");
        const viewedAt = document.createElement("time");
        const exactTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(view.viewed_at));
        name.textContent = profileName(view.viewer);
        username.textContent = "@" + String(view.viewer?.username || "membro");
        viewedAt.dateTime = view.viewed_at;
        viewedAt.textContent = exactTime;
        person.append(name, username);
        item.append(person, viewedAt);
        list.append(item);
      }
    } catch (error) {
      console.error("Looply story insights could not load.", error);
      summary.textContent = "Não foi possível carregar as visualizações agora.";
    }
  };
  const refresh = async () => {
    try {
      state.groups = groupActiveStories(await loadStories(client));
      renderList();
      if (state.active) {
        const replacement = state.groups.find((group) => group.author_id === state.active.author_id);
        if (replacement) state.active = replacement;
        else {
          state.active = null;
          if (viewer.open) viewer.close();
        }
      }
      scheduleNextExpiry();
      return true;
    } catch (error) {
      console.error("Looply stories refresh failed.", error);
      showStatus("Não foi possível atualizar os stories.", true);
      return false;
    }
  };
  const scheduleNextExpiry = () => {
    clearTimeout(root.__looplyStoryExpiryTimer);
    root.__looplyStoryExpiryTimer = null;
    const expirations = state.groups.flatMap((group) => group.stories.map((story) => Date.parse(story.expires_at)))
      .filter((expiry) => Number.isFinite(expiry) && expiry > Date.now());
    if (!expirations.length) {
      root.__looplyStoryExpiryTimer = null;
      return;
    }
    const delay = Math.min(Math.max(1000, Math.min(...expirations) - Date.now() + 100), 2147483647);
    root.__looplyStoryExpiryTimer = setTimeout(() => {
      root.__looplyStoryExpiryTimer = null;
      cleanupExpiredStories(client);
      void refresh();
    }, delay);
  };
  renderList();
  scheduleNextExpiry();
  root.__looplyStoryStop = clearTimer;
  root.__looplyStoryCameraStop = () => stopCamera(true);
  root.__looplyStoryClose = () => { if (viewer.open) viewer.close(); };
  root.__looplyRefreshStoryInsights = () => {
    const story = currentStory();
    if (story?.author_id === userId && !viewer.querySelector("[data-story-insights-panel]").hidden) {
      void loadStoryInsights(story);
    }
  };
  refreshers.set(root, refresh);
  cleanupExpiredStories(client);

  root.addEventListener("change", (event) => {
    if (event.target.matches("#storyVisibility")) {
      const picker = root.querySelector("[data-story-recipient-picker]");
      if (picker) picker.hidden = event.target.value !== "selected";
    }
    if (event.target.matches("#storyMedia")) {
      if (state.cameraStream) stopCamera(true);
      const preview = root.querySelector("[data-story-preview]");
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
      preview?.replaceChildren();
      const file = event.target.files?.[0];
      if (!file || !preview) return;
      if (!storyMimeTypes.has(file.type) || file.size > maxStoryBytes) {
        preview.textContent = "Use uma imagem JPEG, PNG ou WebP, ou um vídeo MP4 ou WebM de até 100 MB.";
        return;
      }
      state.previewUrl = URL.createObjectURL(file);
      const item = document.createElement(file.type.startsWith("video/") ? "video" : "img");
      item.src = state.previewUrl;
      if (item instanceof HTMLVideoElement) item.controls = true;
      else item.alt = "Prévia do story";
      preview.append(item);
    }
  });

  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-story-create-open]")) {
      createDialog.showModal();
      return;
    }
    if (event.target.closest("[data-story-camera-open]")) {
      const openButton = root.querySelector("[data-story-camera-open]");
      openButton.disabled = true;
      root.querySelector("[data-story-capture-photo]").disabled = true;
      root.querySelector("[data-story-record-toggle]").disabled = true;
      try {
        await startCamera();
      } catch (error) {
        console.warn("Looply story camera could not start.", error);
        cameraPanel.hidden = false;
        setCameraStatus(error?.message === "camera_unavailable"
          ? "A câmera não está disponível neste dispositivo ou navegador."
          : "Não foi possível acessar a câmera. Confira a permissão ou escolha um arquivo.", true);
      } finally {
        openButton.disabled = false;
      }
      return;
    }
    if (event.target.closest("[data-story-capture-photo]")) {
      try {
        await captureStoryPhoto();
      } catch (error) {
        console.error("Looply story photo capture failed.", error);
        setCameraStatus("Não foi possível tirar a foto. Tente novamente.", true);
      }
      return;
    }
    if (event.target.closest("[data-story-record-toggle]")) {
      try {
        toggleStoryRecording();
      } catch (error) {
        console.error("Looply story video recording failed.", error);
        setCameraStatus(error?.message === "recording_unavailable"
          ? "A gravação de vídeo não é compatível com este navegador."
          : "Não foi possível iniciar a gravação.", true);
      }
      return;
    }
    if (event.target.closest("[data-story-camera-close]")) {
      stopCamera(true);
      return;
    }
    if (event.target.closest("[data-story-create-close]")) {
      createDialog.close();
      return;
    }
    if (event.target.closest("[data-story-refresh]")) {
      showStatus("Atualizando stories…");
      await refresh();
      scheduleNextExpiry();
      return;
    }
    const storyButton = event.target.closest("[data-story-open]");
    if (storyButton) {
      const group = state.groups.find((item) => item.author_id === storyButton.dataset.storyOpen);
      if (!group) return;
      state.active = { ...group, stories: activeStoriesFor(group) };
      if (!state.active.stories.length) {
        await refresh();
        return;
      }
      state.index = 0;
      renderSlide();
      viewer.showModal();
      return;
    }
    if (event.target.closest("[data-story-close]")) {
      viewer.close();
      return;
    }
    if (event.target.closest("[data-story-prev]")) {
      if (Date.now() < state.ignoreTapUntil) return;
      advance(-1);
      return;
    }
    if (event.target.closest("[data-story-next]")) {
      if (Date.now() < state.ignoreTapUntil) return;
      advance(1);
      return;
    }
    if (event.target.closest("[data-story-like]")) {
      const story = currentStory();
      const button = viewer.querySelector("[data-story-like]");
      if (!story || story.author_id === userId || state.likePending.has(story.id)) return;
      const isLiked = state.likedStories.has(story.id);
      state.likePending.add(story.id);
      button.disabled = true;
      try {
        const result = isLiked
          ? await client.from("story_likes").delete().eq("story_id", story.id).eq("user_id", userId)
          : await client.from("story_likes").insert({ story_id: story.id, user_id: userId });
        if (result.error) throw result.error;
        if (isLiked) state.likedStories.delete(story.id);
        else state.likedStories.add(story.id);
        button.setAttribute("aria-pressed", isLiked ? "false" : "true");
        viewer.querySelector("[data-story-like-label]").textContent = isLiked ? "Curtir" : "Curtido";
        const icon = button.querySelector("[aria-hidden]");
        if (icon) icon.textContent = isLiked ? "♡" : "♥";
      } catch (error) {
        console.error("Looply story reaction failed.", error);
        const status = viewer.querySelector("[data-story-reply-status]");
        status.textContent = "Não foi possível registrar sua curtida. Tente novamente.";
      } finally {
        state.likePending.delete(story.id);
        button.disabled = false;
      }
      return;
    }
    if (event.target.closest("[data-story-insights-open]")) {
      const story = currentStory();
      if (story?.author_id === userId) await loadStoryInsights(story);
      return;
    }
    if (event.target.closest("[data-story-insights-close]")) {
      viewer.querySelector("[data-story-insights-panel]").hidden = true;
      const story = currentStory();
      const media = Array.isArray(story?.media) ? story.media[0] : story?.media;
      if (!media || media.kind !== "video") {
        setProgressDuration(7000);
        state.timer = setTimeout(() => advance(1), 7000);
      }
      return;
    }
    if (event.target.closest("[data-story-delete]")) {
      const current = state.active?.stories?.[state.index];
      if (!current || current.author_id !== userId) return;
      const button = viewer.querySelector("[data-story-delete]");
      button.disabled = true;
      try {
        const paths = (Array.isArray(current.media) ? current.media : current.media ? [current.media] : [])
          .map((item) => item.storage_path).filter(Boolean);
        if (paths.length) {
          const { error } = await client.storage.from("looply-media").remove(paths);
          if (error) throw error;
        }
        const { error } = await client.from("stories").delete().eq("id", current.id).eq("author_id", userId);
        if (error) throw error;
        viewer.close();
        await refresh();
        scheduleNextExpiry();
      } catch (error) {
        console.error("Looply story deletion failed.", error);
        showStatus("Não foi possível excluir o story. Ele continua salvo.", true);
      } finally {
        button.disabled = false;
      }
    }
  });

  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  const touchSurface = viewer.querySelector("[data-story-touch-surface]");
  let pointerStart = null;
  const replyForm = viewer.querySelector("[data-story-reply]");
  replyForm.addEventListener("focusin", clearTimer);
  replyForm.addEventListener("focusout", (event) => {
    if (!replyForm.contains(event.relatedTarget)) resumeStoryTimer();
  });
  touchSurface.addEventListener("pointerdown", (event) => {
    if (event.isPrimary && event.pointerType !== "mouse") pointerStart = { x: event.clientX, y: event.clientY };
  });
  touchSurface.addEventListener("pointerup", (event) => {
    if (!pointerStart) return;
    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      state.ignoreTapUntil = Date.now() + 500;
      advance(deltaX < 0 ? 1 : -1);
    }
    else if (deltaY > 90) viewer.close();
  });
  touchSurface.addEventListener("pointercancel", () => { pointerStart = null; });
  viewer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") { event.preventDefault(); advance(1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); advance(-1); }
  });
  viewer.addEventListener("close", () => {
    clearTimer();
    viewer.querySelectorAll("video").forEach((video) => { video.pause(); video.removeAttribute("src"); });
  });
  createDialog.addEventListener("close", () => {
    stopCamera(true);
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    root.querySelector("[data-story-preview]")?.replaceChildren();
  });

  root.addEventListener("submit", async (event) => {
    const replyForm = event.target.closest("form[data-story-reply]");
    if (replyForm) {
      event.preventDefault();
      const story = currentStory();
      const body = String(new FormData(replyForm).get("reply") || "").trim();
      const submit = replyForm.querySelector('button[type="submit"]');
      const replyStatus = viewer.querySelector("[data-story-reply-status]");
      if (!story || story.author_id === userId || !body) return;
      submit.disabled = true;
      replyStatus.textContent = "Enviando em particular…";
      try {
        const { data, error } = await client.rpc("send_story_reply", { p_story_id: story.id, p_body: body });
        if (error) throw error;
        const reply = Array.isArray(data) ? data[0] : data;
        if (!reply?.conversation_id) throw new Error("story_reply_unavailable");
        replyStatus.textContent = "Resposta enviada em particular. Abrindo conversa…";
        setTimeout(() => window.location.assign(`conversa.html?id=${encodeURIComponent(reply.conversation_id)}`), 650);
      } catch (error) {
        console.error("Looply story reply failed.", error);
        replyStatus.textContent = "Não foi possível enviar em particular. Tente novamente.";
      } finally {
        submit.disabled = false;
      }
      return;
    }
    const form = event.target.closest("form[data-story-create]");
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    let storyId = null;
    let uploadedPath = null;
    try {
      const formData = new FormData(form);
      const body = String(formData.get("body") || "").trim().slice(0, 1000);
      const file = formData.get("media");
      const media = file instanceof File && file.size ? file : null;
      const visibility = String(formData.get("visibility") || "public");
      const recipientIds = [...new Set(formData.getAll("recipientIds").map(String))];
      if (media && (!storyMimeTypes.has(media.type) || media.size > maxStoryBytes)) throw new Error("invalid_media");
      if (!body && !media) throw new Error("empty_story");
      if (visibility === "selected" && (recipientIds.length < 1 || recipientIds.length > 20)) throw new Error("invalid_recipients");

      setFormStatus(form, "Salvando story…");
      const { data, error } = await client.from("stories")
        .insert({ author_id: userId, body, visibility })
        .select("id").single();
      if (error) throw error;
      storyId = data.id;

      if (visibility === "selected") {
        const { error: recipientsError } = await client.from("story_recipients").insert(
          recipientIds.map((recipientId) => ({ story_id: storyId, recipient_id: recipientId }))
        );
        if (recipientsError) throw recipientsError;
      }

      if (media) {
        const extension = storyMimeTypes.get(media.type);
        uploadedPath = "stories/" + storyId + "/" + crypto.randomUUID() + "." + extension;
        await uploadResumable(client, uploadedPath, media, (percent) => setFormStatus(form, "Enviando mídia: " + percent + "%"));
        const { error: mediaError } = await client.from("story_media").insert({
          story_id: storyId,
          storage_path: uploadedPath,
          kind: media.type.startsWith("video/") ? "video" : "image",
          mime_type: media.type,
          byte_size: media.size,
          alt_text: ""
        });
        if (mediaError) throw mediaError;
      }

      form.reset();
      createDialog.close();
      await refresh();
      showStatus("Story publicado. Ele expira após 24 horas.");
    } catch (error) {
      console.error("Looply story creation failed.", error);
      if (uploadedPath) await client.storage.from("looply-media").remove([uploadedPath]).catch(() => {});
      if (storyId) await client.from("stories").delete().eq("id", storyId).eq("author_id", userId);
      const message = error?.message === "empty_story" ? "Adicione um texto ou uma mídia."
        : error?.message === "invalid_media" ? "O arquivo precisa ser uma imagem JPEG/PNG/WebP ou vídeo MP4/WebM de até 100 MB."
          : error?.message === "invalid_recipients" ? "Escolha de 1 a 20 pessoas para este story."
            : "Não foi possível publicar o story. Confira a conexão e tente novamente.";
      setFormStatus(form, message, true);
    } finally {
      submit.disabled = false;
    }
  });
}

export function setupStoriesRealtime(client, userId, root) {
  const refresh = refreshers.get(root);
  if (!client || !refresh) return;
  const scheduleRefresh = () => {
    clearTimeout(storyRefreshTimer);
    storyRefreshTimer = setTimeout(() => {
      storyRefreshTimer = null;
      void refresh();
        root.__looplyRefreshStoryInsights?.();
    }, 350);
  };
  storiesChannel = client.channel("looply-stories-" + userId)
    .on("postgres_changes", { event: "*", schema: "public", table: "stories" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "story_media" }, scheduleRefresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "story_views" }, () => root.__looplyRefreshStoryInsights?.())
    .subscribe((status) => {
      const state = root.querySelector("[data-story-feed-status]");
      if (state && status === "SUBSCRIBED") state.textContent = state.textContent || "Atualizações em tempo real ativas.";
    });
}

export function disposeStoriesRealtime(client, root) {
  clearTimeout(storyRefreshTimer);
  storyRefreshTimer = null;
  if (storiesChannel && client) void client.removeChannel(storiesChannel);
  storiesChannel = null;
  if (root) {
    refreshers.delete(root);
    if (root.__looplyStoryExpiryTimer) clearTimeout(root.__looplyStoryExpiryTimer);
    root.__looplyStoryExpiryTimer = null;
    root.__looplyStoryStop?.();
    delete root.__looplyStoryStop;
    root.__looplyStoryCameraStop?.();
    delete root.__looplyStoryCameraStop;
    root.__looplyStoryClose?.();
    delete root.__looplyStoryClose;
    delete root.__looplyRefreshStoryInsights;
  }
}


