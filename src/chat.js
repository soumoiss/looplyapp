const fileExtensions = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
  ["video/mp4", "mp4"], ["video/webm", "webm"], ["audio/mp4", "mp4"],
  ["audio/mpeg", "mp3"], ["audio/ogg", "ogg"], ["audio/webm", "webm"],
  ["application/pdf", "pdf"], ["text/plain", "txt"]
]);
const maxFileSize = 100 * 1024 * 1024;
const maxFilesPerMessage = 8;

let activeConversationId = null;
let realtimeChannel = null;
let realtimeUserId = null;
let refreshTimer = null;
let refreshVersion = 0;
let conversationSearch = "";
let conversationFilter = "all";
const voiceRecordings = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatMessageDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (left, right) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (sameDay(date, today)) return "Hoje";
  if (sameDay(date, yesterday)) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(date);
}

export async function loadChatData(client, userId, { markDelivered = true } = {}) {
  const [participantResult, notificationResult, profilesResult] = await Promise.all([
    client.from("conversation_participants").select("conversation_id,last_read_at").eq("user_id", userId),
    client.from("chat_notifications").select("id,conversation_id,kind,preview,created_at,read_at").order("created_at", { ascending: false }).limit(50),
    client.from("profiles").select("id,username,display_name,avatar_path").order("username").limit(100)
  ]);
  if (participantResult.error) throw participantResult.error;
  const participants = participantResult.data || [];
  const ids = participants.map((row) => row.conversation_id);
  if (markDelivered && ids.length) {
    const { error: deliveredError } = await client.rpc("mark_conversations_delivered", { p_conversation_ids: ids });
    if (deliveredError) console.warn("Looply delivery receipt update failed", deliveredError);
  }
  let conversations = [];
  let latestMessages = [];
  if (ids.length) {
    const { data, error } = await client.from("conversations")
      .select("id,kind,subject,created_by,created_at,updated_at,participants:conversation_participants(user_id,profile:profiles!conversation_participants_user_id_fkey(id,username,display_name,avatar_path))")
      .in("id", ids).order("updated_at", { ascending: false }).limit(50);
    if (error) throw error;
    conversations = data || [];
    const { data: latest, error: messagesError } = await client.from("chat_messages")
      .select("conversation_id,body,created_at,sender_id,author:profiles!chat_messages_sender_id_fkey(username,display_name)")
      .in("conversation_id", ids).order("created_at", { ascending: false }).limit(500);
    if (messagesError) throw messagesError;
    latestMessages = latest || [];
  }
  const latestByConversation = new Map();
  for (const message of latestMessages) if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
  const readByConversation = new Map(participants.map((row) => [row.conversation_id, row.last_read_at]));
  const unreadByConversation = new Map();
  for (const notification of notificationResult.data || []) {
    if (!notification.read_at) unreadByConversation.set(notification.conversation_id, (unreadByConversation.get(notification.conversation_id) || 0) + 1);
  }
  const profiles = profilesResult.data || [];
  const avatarProfiles = new Map();
  for (const profile of profiles) if (profile.avatar_path) avatarProfiles.set(profile.id, profile);
  for (const conversation of conversations) {
    for (const participant of conversation.participants || []) {
      if (participant.profile?.avatar_path) avatarProfiles.set(participant.profile.id, participant.profile);
    }
  }
  const avatarList = [...avatarProfiles.values()];
  if (avatarList.length) {
    const { data: signed } = await client.storage.from("looply-avatars")
      .createSignedUrls(avatarList.map((profile) => profile.avatar_path), 1800);
    if (signed) avatarList.forEach((profile, index) => { profile.avatarUrl = signed[index]?.signedUrl || ""; });
  }
  return {
    conversations: conversations.map((conversation) => ({
      ...conversation,
      lastMessage: latestByConversation.get(conversation.id) || null,
      lastReadAt: readByConversation.get(conversation.id),
      unreadCount: unreadByConversation.get(conversation.id) || 0
    })),
    notifications: notificationResult.data || [],
    profiles,
    profilesError: profilesResult.error
  };
}

function conversationLabel(conversation, userId) {
  if (conversation.kind === "letter") return `Carta · ${conversation.subject || "para Peixinho"}`;
  if (conversation.kind === "group") return conversation.subject || "Grupo";
  const other = (conversation.participants || []).find((row) => row.user_id !== userId)?.profile;
  return other ? `${other.display_name || other.username} · @${other.username}` : "Conversa privada";
}

function conversationAvatar(conversation, userId) {
  if (conversation.kind === "letter") return `<span class="chat-conversation-avatar" aria-hidden="true">✉</span>`;
  if (conversation.kind === "group") return `<span class="chat-conversation-avatar chat-group-avatar" aria-label="Conversa em grupo">👥</span>`;
  const profile = (conversation.participants || []).find((row) => row.user_id !== userId)?.profile;
  const initial = (profile?.display_name || profile?.username || "?").slice(0, 1).toLocaleUpperCase("pt-BR");
  return profile?.avatarUrl
    ? `<img class="chat-conversation-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="chat-conversation-avatar" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function conversationPreview(conversation, userId) {
  const message = conversation.lastMessage;
  if (!message) return conversation.kind === "letter" ? "Carta privada" : "Nenhuma mensagem";
  const authorName = message.sender_id === userId ? "Você" : conversation.kind === "group" ? (message.author?.display_name || message.author?.username || "Membro") : "";
  const author = authorName ? `${authorName}: ` : "";
  const text = String(message.body || "").trim();
  return `${author}${text || "Mídia"}`.slice(0, 68);
}

function notificationsMarkup(notifications) {
  const unread = notifications.filter((item) => !item.read_at).length;
  if (!notifications.length) return `<p class="chat-empty">Nenhuma notificação</p>`;
  return `<div class="chat-notification-list">${notifications.slice(0, 5).map((item) => `<a class="chat-notification ${item.read_at ? "is-read" : ""}" href="mensagens.html?id=${encodeURIComponent(item.conversation_id)}" data-chat-open="${escapeHtml(item.conversation_id)}">
    <span class="chat-notification-kind">${item.kind === "letter" ? "Carta" : "Mensagem"}</span><span>${escapeHtml(item.preview)}</span><time>${escapeHtml(formatDate(item.created_at))}</time>
  </a>`).join("")}</div><span class="chat-count">${unread} não lida${unread === 1 ? "" : "s"}</span>`;
}

export function chatMarkup(data, userId) {
  if (data.error) return `<section class="chat-area" data-chat-area aria-labelledby="chatTitle"><div class="chat-heading"><div><span class="section-kicker">Mensagens</span><h2 id="chatTitle">Conversas e cartas</h2></div></div><div class="chat-empty" role="alert">Não foi possível carregar as conversas. Atualize a página e tente novamente.</div></section>`;
  const conversations = data.conversations.length
    ? data.conversations.map((conversation) => `<a class="chat-conversation ${conversation.id === activeConversationId ? "is-active" : ""}" href="mensagens.html?id=${encodeURIComponent(conversation.id)}" data-chat-open="${escapeHtml(conversation.id)}">
        ${conversationAvatar(conversation, userId)}
        <span class="chat-conversation-copy"><strong>${escapeHtml(conversationLabel(conversation, userId))}</strong><small>${escapeHtml(conversationPreview(conversation, userId))}</small><time>${escapeHtml(formatDate(conversation.lastMessage?.created_at || conversation.updated_at))}</time></span>
        ${conversation.unreadCount ? `<span class="chat-unread">${conversation.unreadCount}</span>` : ""}
      </a>`).join("")
    : `<p class="chat-empty">Nenhuma conversa.</p>`;
  const conversationTools = `<div class="chat-conversation-tools">
    <label class="visually-hidden" for="chatConversationSearch">Buscar conversa</label>
    <input id="chatConversationSearch" type="search" maxlength="100" placeholder="Buscar conversa ou última mensagem" value="${escapeHtml(conversationSearch)}" data-chat-conversation-search>
    <div class="chat-filter-tabs" role="group" aria-label="Filtrar conversas">
      <button type="button" data-chat-filter="all" aria-pressed="${conversationFilter === "all"}">Todas</button>
      <button type="button" data-chat-filter="unread" aria-pressed="${conversationFilter === "unread"}">Não lidas</button>
    </div>
  </div>`;
  const people = (data.profiles || []).filter((profile) => profile.id !== userId).map((profile) => `<article class="chat-person">
    ${profile.avatarUrl ? `<img class="chat-person-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="chat-person-avatar" aria-hidden="true">${escapeHtml((profile.display_name || profile.username || "?").slice(0, 1).toLocaleUpperCase("pt-BR"))}</span>`}
    <span><strong>${escapeHtml(profile.display_name || profile.username)}</strong><small>@${escapeHtml(profile.username)}</small></span>
    <button class="text-button" type="button" data-chat-start="${escapeHtml(profile.id)}">Conversar</button>
  </article>`).join("");
  const searchMessage = data.profilesError
    ? `<p class="chat-empty" role="alert">Não foi possível carregar os perfis para iniciar uma conversa.</p>`
    : `<div class="chat-people-list" data-chat-people>${people || `<p class="chat-empty">Nenhum outro perfil está visível agora.</p>`}</div>`;
  const groupProfiles = (data.profiles || []).filter((profile) => profile.id !== userId);
  const groupOptions = groupProfiles.map((profile) => {
    const name = profile.display_name || profile.username;
    const initial = String(name || "?").slice(0, 1).toLocaleUpperCase("pt-BR");
    const avatar = profile.avatarUrl
      ? `<img class="chat-group-option-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="chat-group-option-avatar" aria-hidden="true">${escapeHtml(initial)}</span>`;
    return `<label class="chat-group-option">${avatar}<span><strong>${escapeHtml(name)}</strong><small>@${escapeHtml(profile.username)}</small></span><input type="checkbox" name="memberIds" value="${escapeHtml(profile.id)}" aria-label="Adicionar ${escapeHtml(name)} ao grupo"></label>`;
  }).join("");
  const groupCompose = `<details class="chat-panel group-compose-panel"><summary>Criar grupo</summary>
    <form class="chat-group-form" data-chat-group-create>
      <div class="field"><label for="chatGroupSubject">Nome do grupo</label><input id="chatGroupSubject" name="subject" type="text" maxlength="120" required placeholder="Ex.: Amigos"></div>
      <fieldset class="group-member-options"><legend>Escolha pelo menos duas pessoas</legend>${groupOptions || `<p class="chat-empty">Não há outros perfis disponíveis.</p>`}</fieldset>
      <button class="primary-button compact-button" type="submit"${groupProfiles.length < 2 ? " disabled" : ""}>Criar grupo</button>
      <span class="form-status" data-status role="status" aria-live="polite"></span>
    </form>
  </details>`;
  return `<section class="chat-area" data-chat-area aria-labelledby="chatTitle">
    <div class="chat-heading"><div><span class="section-kicker">Mensagens</span><h2 id="chatTitle">Conversas e cartas</h2></div><span class="chat-live" data-chat-live role="status">Atualizações ao vivo</span></div>
    <div class="chat-layout">
      <aside class="chat-sidebar">
        <section class="chat-panel" aria-label="Suas conversas"><div class="chat-panel-heading"><h3>Conversas</h3><span>${data.conversations.length}</span></div>${conversationTools}<div class="chat-conversation-list" data-chat-conversations>${conversations}<p class="chat-empty chat-conversation-no-match" data-chat-no-matches hidden>Nenhuma conversa corresponde ao filtro.</p></div></section>
        <details class="chat-panel chat-search-panel"><summary>Encontrar uma pessoa</summary>
          <form class="chat-search-form" data-chat-search><label class="visually-hidden" for="chatSearch">Username</label><input id="chatSearch" name="query" type="text" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]{3,30}" required placeholder="Buscar pelo username"><button class="text-button" type="submit">Buscar</button></form>
          ${searchMessage}
        </details>
        ${groupCompose}
        <details class="chat-panel letter-compose-panel"><summary>Escrever uma carta para Peixinho</summary>
          <form class="letter-form" data-letter-send><div class="field"><label for="letterSubject">Assunto</label><input id="letterSubject" name="subject" maxlength="120" required placeholder="Um título para sua carta"></div>
            <div class="field"><label for="letterBody">Mensagem</label><textarea id="letterBody" name="body" maxlength="5000" rows="5" required placeholder="Escreva sua carta"></textarea></div>
            
            <button class="primary-button compact-button" type="submit">Enviar carta <span aria-hidden="true">↗</span></button><span class="form-status" data-status role="status" aria-live="polite"></span>
          </form>
        </details>
        <details class="chat-panel chat-notifications-panel"><summary>Notificações <span class="chat-summary-unread">${data.notifications.filter((item) => !item.read_at).length}</span></summary>${notificationsMarkup(data.notifications)}</details>
      </aside>
      <section class="chat-thread-panel" aria-label="Mensagens da conversa"><div class="chat-thread" data-chat-thread><div class="chat-empty chat-thread-empty"><strong>Nenhuma conversa selecionada.</strong></div></div></section>
    </div>
  </section>`;
}

function setStatus(form, message, kind = "success") {
  const status = form.querySelector("[data-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

function selectedFiles(formData) {
  const files = formData.getAll("files").filter((file) => file instanceof File && file.size > 0);
  if (files.length > maxFilesPerMessage || files.some((file) => !fileExtensions.has(file.type.split(";")[0]) || file.size > maxFileSize)) {
    throw new Error("unsupported attachment");
  }
  return files;
}

function formatRecordingTime(milliseconds) {
  const total = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function setRecordingFile(form, file, remove = false) {
  const input = form.querySelector('input[name="files"]');
  if (!input) return;
  const transfer = new DataTransfer();
  for (const existing of input.files) {
    const isRecorded = existing.name === file?.name && existing.lastModified === file?.lastModified && existing.size === file?.size;
    if (!isRecorded) transfer.items.add(existing);
  }
  if (file && !remove) transfer.items.add(file);
  input.files = transfer.files;
}

function cancelVoiceRecording(form) {
  const state = voiceRecordings.get(form);
  if (state) {
    state.cancelled = true;
    if (state.timer) clearInterval(state.timer);
    if (state.recorder.state !== "inactive") state.recorder.stop();
    state.stream.getTracks().forEach((track) => track.stop());
    voiceRecordings.delete(form);
  }
  const recordedFile = form._looplyRecordedFile;
  if (recordedFile) {
    setRecordingFile(form, recordedFile, true);
    delete form._looplyRecordedFile;
  }
  const preview = form.querySelector("[data-chat-record-preview]");
  if (preview?.src?.startsWith("blob:")) URL.revokeObjectURL(preview.src);
  if (preview) preview.removeAttribute("src");
  form.querySelector("[data-chat-recording]").hidden = true;
  form.querySelector("[data-chat-record-ready]").hidden = true;
  const startButton = form.querySelector("[data-chat-record-start]");
  startButton.hidden = false;
  startButton.textContent = "Gravar áudio";
  setStatus(form, "Gravação descartada.");
}

async function startVoiceRecording(form) {
  const startButton = form.querySelector("[data-chat-record-start]");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus(form, "Gravação de áudio indisponível neste navegador.", "error");
    return;
  }
  if (!window.isSecureContext) {
    setStatus(form, "A gravação exige uma conexão HTTPS.", "error");
    return;
  }
  const ready = form.querySelector("[data-chat-record-ready]");
  const oldPreview = form.querySelector("[data-chat-record-preview]");
  if (form._looplyRecordedFile) {
    setRecordingFile(form, form._looplyRecordedFile, true);
    delete form._looplyRecordedFile;
  }
  if (oldPreview?.src?.startsWith("blob:")) URL.revokeObjectURL(oldPreview.src);
  oldPreview?.removeAttribute("src");
  ready.hidden = true;
  startButton.disabled = true;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const supportedTypes = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported?.(type));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const state = { stream, recorder, chunks: [], startedAt: Date.now(), timer: null, cancelled: false };
    voiceRecordings.set(form, state);
    recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) state.chunks.push(event.data); });
    recorder.addEventListener("error", () => {
      cancelVoiceRecording(form);
      setStatus(form, "Não foi possível gravar o áudio.", "error");
    }, { once: true });
    recorder.addEventListener("stop", () => {
      if (state.cancelled) return;
      const actualType = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
      const extension = fileExtensions.get(actualType);
      const blob = new Blob(state.chunks, { type: actualType });
      if (!extension || !blob.size || blob.size > maxFileSize) {
        cancelVoiceRecording(form);
        setStatus(form, "O formato ou tamanho do áudio não é compatível.", "error");
        return;
      }
      const file = new File([blob], `gravacao-${Date.now()}.${extension}`, { type: actualType, lastModified: Date.now() });
      form._looplyRecordedFile = file;
      setRecordingFile(form, file);
      const preview = form.querySelector("[data-chat-record-preview]");
      preview.src = URL.createObjectURL(blob);
      form.querySelector("[data-chat-recording]").hidden = true;
      ready.hidden = false;
      startButton.hidden = false;
      startButton.textContent = "Gravar outro áudio";
      if (state.timer) clearInterval(state.timer);
      state.stream.getTracks().forEach((track) => track.stop());
      voiceRecordings.delete(form);
      setStatus(form, "Áudio pronto para enviar.");
    }, { once: true });
    recorder.start();
    form.querySelector("[data-chat-recording]").hidden = false;
    form.querySelector("[data-chat-record-time]").textContent = "00:00";
    startButton.hidden = true;
    state.timer = setInterval(() => {
      const time = form.querySelector("[data-chat-record-time]");
      if (time) time.textContent = formatRecordingTime(Date.now() - state.startedAt);
    }, 250);
    setStatus(form, "Gravando áudio…", "info");
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    console.error("Looply microphone access failed", error);
    setStatus(form, error?.name === "NotAllowedError"
      ? "Permita o uso do microfone para gravar áudio."
      : "Microfone indisponível. Verifique as permissões do navegador.", "error");
  } finally {
    startButton.disabled = false;
  }
}

async function uploadResumable(client, path, file, onProgress) {
  const { data, error } = await client.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (error || !accessToken) throw new Error("session expired");
  const publishableKey = window.LOOPLY_CONFIG?.publishableKey;
  if (!publishableKey) throw new Error("Supabase publishable key is missing.");
  if (file.size <= 6 * 1024 * 1024) {
    const { error: uploadError } = await client.storage.from("looply-chat").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (uploadError) throw uploadError;
    onProgress(100);
    return;
  }
  const projectUrl = new URL(window.LOOPLY_CONFIG.supabaseUrl);
  const endpoint = projectUrl.hostname.endsWith(".supabase.co")
    ? `${projectUrl.protocol}//${projectUrl.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co")}/storage/v1/upload/resumable`
    : new URL("/storage/v1/upload/resumable", projectUrl).toString();
  const tus = await import("https://esm.sh/tus-js-client@4.3.1");
  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${accessToken}`, apikey: publishableKey },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: "looply-chat", objectName: path, contentType: file.type, cacheControl: "3600" },
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.floor(uploaded / total * 100)),
      onSuccess: resolve
    });
    upload.start();
  });
}

function renderMedia(media) {
  if (!media.signedUrl) return `<span class="chat-media-unavailable">Anexo temporariamente indisponível.</span>`;
  const url = escapeHtml(media.signedUrl);
  const fileName = escapeHtml(media.file_name);
  if (media.mime_type.startsWith("image/")) return `<a class="chat-image-link" href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="${fileName}" loading="lazy" referrerpolicy="no-referrer"></a>`;
  if (media.mime_type.startsWith("video/")) return `<video src="${url}" controls preload="metadata" aria-label="${fileName}"></video>`;
  if (media.mime_type.startsWith("audio/")) return `<div class="chat-audio-player"><audio src="${url}" controls preload="metadata" aria-label="${fileName}"></audio><label>Velocidade <select data-chat-audio-rate aria-label="Velocidade do áudio"><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></label></div>`;
  return `<a class="chat-file-link" href="${url}" target="_blank" rel="noopener noreferrer">↗ ${fileName}</a>`;
}

async function loadThread(client, conversationId, before = null) {
  let messageQuery = client.from("chat_messages")
    .select("id,conversation_id,sender_id,reply_to,body,created_at,delivered_at,read_at,author:profiles!chat_messages_sender_id_fkey(id,username,display_name,avatar_path),media:chat_media!chat_media_message_fk(id,storage_path,mime_type,file_name,byte_size)")
    .eq("conversation_id", conversationId);
  if (before) messageQuery = messageQuery.lt("created_at", before);
  const [messageResult, participantResult, conversationResult] = await Promise.all([
    messageQuery.order("created_at", { ascending: false }).limit(100),
    client.from("conversation_participants").select("user_id,last_read_at,profile:profiles!conversation_participants_user_id_fkey(id,username,display_name,avatar_path)").eq("conversation_id", conversationId),
    client.from("conversations").select("id,kind,subject").eq("id", conversationId).maybeSingle()
  ]);
  if (messageResult.error) throw messageResult.error;
  if (participantResult.error) throw participantResult.error;
  if (conversationResult.error) throw conversationResult.error;
  if (!conversationResult.data) throw new Error("Conversation unavailable");
  const messages = (messageResult.data || []).reverse();
  const media = messages.flatMap((message) => message.media || []);
  if (media.length) {
    const { data: signed, error: signedError } = await client.storage.from("looply-chat").createSignedUrls(media.map((item) => item.storage_path), 1800);
    if (!signedError && signed) media.forEach((item, index) => { item.signedUrl = signed[index]?.signedUrl || null; });
  }
  return { messages, participants: participantResult.data || [], conversation: conversationResult.data };
}

function olderMessagesButton(conversationId, oldestMessage) {
  return `<button class="chat-load-older" type="button" data-chat-load-older data-conversation-id="${escapeHtml(conversationId)}" data-before="${escapeHtml(oldestMessage.created_at)}">Carregar mensagens anteriores</button>`;
}

function threadMarkup(messages, userId, peerReadAt = null, peerProfile = null, participants = [], isGroup = false) {
  if (!messages.length) return `<div class="chat-empty"><strong>Esta conversa está pronta.</strong><span>Envie a primeira mensagem.</span></div>`;
  const byId = new Map(messages.map((message) => [message.id, message]));
  let lastDay = "";
  return messages.map((message) => {
    const day = formatMessageDay(message.created_at);
    const daySeparator = day && day !== lastDay ? `<div class="chat-date-separator"><span>${escapeHtml(day)}</span></div>` : "";
    lastDay = day || lastDay;
    const parent = message.reply_to ? byId.get(message.reply_to) : null;
    const replyContext = message.reply_to ? `<small class="chat-reply-preview">↳ ${escapeHtml(parent ? (parent.body || "mensagem").slice(0, 120) : "Respondeu a uma mensagem anterior")}</small>` : "";
    const isMine = message.sender_id === userId;
    const authorProfile = participants.find((participant) => participant.user_id === message.sender_id)?.profile || message.author || peerProfile;
    const avatarLabel = (authorProfile?.display_name || authorProfile?.username || "?").slice(0, 1).toLocaleUpperCase("pt-BR");
    const avatar = !isMine && authorProfile ? (authorProfile.avatarUrl
      ? `<img class="chat-message-avatar" src="${escapeHtml(authorProfile.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="chat-message-avatar" aria-hidden="true">${escapeHtml(avatarLabel)}</span>`) : "";
    const readCount = isGroup ? participants.filter((participant) => participant.user_id !== userId && participant.last_read_at && new Date(participant.last_read_at) >= new Date(message.created_at)).length : 0;
    const readTotal = Math.max(0, participants.length - 1);
    const groupReadText = readCount === readTotal && readTotal ? "Lida por todos" : readCount ? `Lida por ${readCount} de ${readTotal}` : "Enviada";
    const deliveryLabel = isGroup ? groupReadText : message.read_at ? "Lida" : message.delivered_at ? "Entregue" : "Enviada";
    const delivery = isMine ? `<small class="chat-delivery">${deliveryLabel}</small>` : "";
    return `${daySeparator}<div class="chat-message-row ${isMine ? "is-mine" : "is-theirs"}">${avatar}<article class="chat-message ${isMine ? "is-mine" : ""}">
    <div class="chat-message-meta"><strong>${escapeHtml(message.sender_id === userId ? "Você" : authorProfile?.display_name || authorProfile?.username || "Perfil restrito")}</strong><time>${escapeHtml(formatDate(message.created_at))}</time></div>
    ${replyContext}<p>${escapeHtml(message.body)}</p>${message.media?.length ? `<div class="chat-message-media">${message.media.map(renderMedia).join("")}</div>` : ""}${delivery}
    <div class="chat-message-actions-inline"><button class="chat-reply-button" type="button" data-chat-reply="${escapeHtml(message.id)}">Responder</button><button class="chat-reply-button" type="button" data-chat-copy="${escapeHtml(message.id)}">Copiar</button>${isMine ? `<button class="chat-reply-button" type="button" data-chat-edit="${escapeHtml(message.id)}">Editar</button><button class="chat-reply-button chat-delete-button" type="button" data-chat-delete="${escapeHtml(message.id)}">Apagar</button>` : ""}</div>
  </article></div>`;
  }).join("");
}

function peerParticipantFor(participants, userId) {
  return participants.find((participant) => participant.user_id !== userId) || null;
}

function messageComposerMarkup(conversationId) {
  return `<form class="chat-message-form" data-chat-send data-conversation-id="${escapeHtml(conversationId)}">
    <input type="hidden" name="replyTo" value=""><p class="chat-reply-context" data-chat-reply-context hidden><span></span><button type="button" data-chat-reply-clear aria-label="Cancelar resposta">×</button></p>
    <label class="visually-hidden" for="message-${escapeHtml(conversationId)}">Mensagem</label><textarea id="message-${escapeHtml(conversationId)}" name="body" maxlength="5000" rows="2" placeholder="Escreva uma mensagem..."></textarea>
    <div class="chat-message-actions"><button class="text-button chat-emoji-toggle" type="button" data-chat-emoji-toggle aria-expanded="false" aria-controls="chatEmojiPicker">😊 Emoji</button>
    <div id="chatEmojiPicker" class="chat-emoji-picker" data-chat-emoji-picker role="group" aria-label="Inserir emoji" hidden>
      ${["😀", "😂", "🥰", "😊", "😍", "👍", "❤️", "🎉"].map((emoji) => `<button type="button" data-chat-emoji="${escapeHtml(emoji)}" aria-label="Inserir ${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`).join("")}
    </div><label class="chat-attachment-label" for="files-${escapeHtml(conversationId)}">Anexar fotos, vídeos, áudio ou arquivos</label><input id="files-${escapeHtml(conversationId)}" name="files" type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mp4,audio/mpeg,audio/ogg,audio/webm,application/pdf,text/plain"><button class="text-button chat-record-start" type="button" data-chat-record-start>Gravar áudio</button><button class="primary-button compact-button" type="submit">Enviar <span aria-hidden="true">↗</span></button></div>
    <div class="chat-recorder" data-chat-recording hidden><span data-chat-record-time>00:00</span><button class="text-button" type="button" data-chat-record-stop>Finalizar áudio</button><button class="text-button" type="button" data-chat-record-cancel>Cancelar</button></div>
    <div class="chat-record-ready" data-chat-record-ready hidden><audio controls data-chat-record-preview></audio><button class="text-button" type="button" data-chat-record-cancel>Remover áudio</button></div>
    <span class="form-status" data-status role="status" aria-live="polite"></span></form>`;
}

function threadHeadingMarkup(root, participants, userId, conversationInfo = null) {
  if (conversationInfo?.kind === "group") {
    const memberCount = participants.length;
    return `<header class="chat-thread-heading"><span class="chat-thread-avatar chat-group-avatar" aria-label="Conversa em grupo">👥</span><div><strong>${escapeHtml(conversationInfo.subject || "Grupo")}</strong><small>${memberCount} participantes</small></div><a href="chat.html">Todas as conversas</a></header>`;
  }
  const peer = participants.find((participant) => participant.user_id !== userId)?.profile;
  const fallback = (peer?.display_name || peer?.username || "?").slice(0, 1).toLocaleUpperCase("pt-BR");
  const conversation = [...root.querySelectorAll("[data-chat-open]")].find((item) => item.dataset.chatOpen === activeConversationId);
  const image = conversation?.querySelector(".chat-conversation-avatar[src]");
  const avatarUrl = image?.src || peer?.avatarUrl;
  const avatar = avatarUrl
    ? `<img class="chat-thread-avatar" src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="chat-thread-avatar" aria-hidden="true">${escapeHtml(fallback)}</span>`;
  const name = conversation?.querySelector(".chat-conversation-copy strong")?.textContent || peer?.display_name || peer?.username || "Conversa privada";
  return `<header class="chat-thread-heading">${avatar}<strong>${escapeHtml(name)}</strong><a href="chat.html">Todas as conversas</a></header>`;
}

async function signThreadAvatar(client, participants) {
  const profiles = participants.map((participant) => participant.profile).filter((profile) => profile?.avatar_path);
  if (!profiles.length) return;
  const { data } = await client.storage.from("looply-avatars").createSignedUrls(profiles.map((profile) => profile.avatar_path), 1800);
  if (data) profiles.forEach((profile, index) => { profile.avatarUrl = data[index]?.signedUrl || ""; });
}

async function openConversation(root, client, conversationId, userId) {
  activeConversationId = conversationId;
  const thread = root.querySelector("[data-chat-thread]");
  if (!thread) return;
  thread.innerHTML = `<p class="chat-empty" role="status">Carregando mensagens...</p>`;
  try {
    const { messages, participants, conversation } = await loadThread(client, conversationId);
    if (activeConversationId !== conversationId || !root.querySelector("[data-chat-thread]")) return;
    await signThreadAvatar(client, participants);
    const peer = peerParticipantFor(participants, userId);
    const isGroup = conversation.kind === "group";
    thread.innerHTML = `${threadHeadingMarkup(root, participants, userId, conversation)}<div class="chat-message-history" data-chat-messages>${messages.length === 100 ? olderMessagesButton(conversationId, messages[0]) : ""}${threadMarkup(messages, userId, peer?.last_read_at || null, peer?.profile || null, participants, isGroup)}</div>${messageComposerMarkup(conversationId)}`;
    thread.scrollTop = thread.scrollHeight;
    const { error: readError } = await client.rpc("mark_conversation_read", { p_conversation_id: conversationId });
    if (readError) console.warn("Looply read receipt update failed", readError);
    await refreshChat(root, client, userId, { keepThread: true });
  } catch (error) {
    console.error("Looply conversation load failed", error);
    const composer = thread.querySelector("[data-chat-send]");
    if (composer) setStatus(composer, "Conexão instável. Sua mensagem ainda não foi enviada; tente novamente.", "error");
    else if (thread.isConnected) thread.innerHTML = `<p class="chat-empty" role="alert">Não foi possível carregar esta conversa. Confira o acesso e tente novamente.</p>`;
  }
}

async function refreshActiveThread(root, client, userId, { refreshReadState = false } = {}) {
  const conversationId = activeConversationId;
  const thread = root.querySelector("[data-chat-thread]");
  if (!conversationId || !thread) return;
  const composer = thread.querySelector("[data-chat-send]");
  if (composer?.dataset.sending === "true") return;
  const focused = composer?.contains(document.activeElement);
  const scrollTop = thread.scrollTop;
  try {
    const { messages, participants, conversation } = await loadThread(client, conversationId);
    if (conversationId !== activeConversationId || !thread.isConnected) return;
    await signThreadAvatar(client, participants);
    const peer = peerParticipantFor(participants, userId);
    const nextHeading = document.createElement("div");
    nextHeading.innerHTML = threadHeadingMarkup(root, participants, userId, conversation);
    const currentHeading = thread.querySelector(".chat-thread-heading");
    const heading = nextHeading.firstElementChild;
    if (currentHeading && heading) currentHeading.replaceWith(heading);
    else if (heading) thread.prepend(heading);
    const history = thread.querySelector("[data-chat-messages]");
    const historyHtml = (messages.length === 100 ? olderMessagesButton(conversationId, messages[0]) : "") +
      threadMarkup(messages, userId, peer?.last_read_at || null, peer?.profile || null, participants, conversation.kind === "group");
    if (history) history.innerHTML = historyHtml;
    else {
      const wrapper = document.createElement("div");
      wrapper.className = "chat-message-history";
      wrapper.dataset.chatMessages = "";
      wrapper.innerHTML = historyHtml;
      const composerForm = thread.querySelector("[data-chat-send]");
      if (composerForm) composerForm.before(wrapper);
      else thread.append(wrapper);
    }
    if (refreshReadState) {
      const { error } = await client.rpc("mark_conversation_read", { p_conversation_id: conversationId });
      if (error) console.warn("Looply read receipt update failed", error);
    }
    thread.scrollTop = focused ? scrollTop : thread.scrollHeight;
  } catch (error) {
    console.warn("Looply active thread refresh failed", error);
    const live = root.querySelector("[data-chat-live]");
    if (live) live.textContent = "Conexão instável · tentando novamente";
  }
}
async function refreshChat(root, client, userId, { keepThread = false } = {}) {
  const area = root.querySelector("[data-chat-area]");
  if (!area) return;
  const version = ++refreshVersion;
  try {
    const data = await loadChatData(client, userId, { markDelivered: false });
    if (version !== refreshVersion || !area.isConnected) return;
    const replacement = document.createElement("div");
    replacement.innerHTML = chatMarkup(data, userId);
    const fresh = replacement.firstElementChild;
    if (!fresh?.querySelector("[data-chat-thread]")) throw new Error("Conversation list refresh returned invalid markup");
    const currentList = area.querySelector("[data-chat-conversations]");
    const newList = fresh.querySelector("[data-chat-conversations]");
    if (currentList && newList) currentList.innerHTML = newList.innerHTML;
    const currentCount = currentList?.closest(".chat-panel")?.querySelector(".chat-panel-heading span");
    const newCount = newList?.closest(".chat-panel")?.querySelector(".chat-panel-heading span");
    if (currentCount && newCount) currentCount.textContent = newCount.textContent;
    const currentNotifications = area.querySelector(".chat-notifications-panel");
    const newNotifications = fresh.querySelector(".chat-notifications-panel");
    if (currentNotifications && newNotifications) currentNotifications.innerHTML = newNotifications.innerHTML;
    applyConversationFilter(root);
    const composer = area.querySelector("[data-chat-send]");
    if (keepThread && activeConversationId && composer?.dataset.sending !== "true") {
      await refreshActiveThread(root, client, userId);
    }
  } catch (error) {
    console.error("Looply conversation refresh failed", error);
    const live = root.querySelector("[data-chat-live]");
    if (live) live.textContent = "Conexão instável · tentando novamente";
  }
}
function scheduleRefresh(root, client, userId) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await refreshChat(root, client, userId, { keepThread: Boolean(activeConversationId) });
    if (activeConversationId && root.querySelector("[data-chat-thread]")) {
      const thread = root.querySelector("[data-chat-thread]");
      if (thread && !thread.querySelector("[data-chat-send] [name=body]:focus")) thread.scrollTop = thread.scrollHeight;
    }
  }, 400);
}

export function setupChatRealtime(client, userId, root) {
  if (!client || !userId || (realtimeChannel && realtimeUserId === userId)) return;
  if (realtimeChannel) client.removeChannel(realtimeChannel);
  realtimeUserId = userId;
  realtimeChannel = client.channel(`looply-chat-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (payload) => {
      const incoming = payload?.eventType === "INSERT" && payload.new?.sender_id !== userId && payload.new?.conversation_id;
      if (!incoming) { scheduleRefresh(root, client, userId); return; }
      void client.rpc("mark_conversations_delivered", { p_conversation_ids: [payload.new.conversation_id] })
        .then(({ error }) => { if (error) console.warn("Looply delivery receipt update failed", error); })
        .catch((error) => console.warn("Looply delivery receipt update failed", error))
        .finally(() => scheduleRefresh(root, client, userId));
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_notifications", filter: `user_id=eq.${userId}` }, () => scheduleRefresh(root, client, userId))
    .on("postgres_changes", { event: "*", schema: "public", table: "conversation_participants", filter: `user_id=eq.${userId}` }, () => scheduleRefresh(root, client, userId))
    .subscribe((state) => {
      const status = root.querySelector("[data-chat-live]");
      if (status) status.textContent = state === "SUBSCRIBED" ? "Atualizações ao vivo" : "Reconectando...";
    });
}

export function disposeChatRealtime(client) {
  if (realtimeChannel && client) client.removeChannel(realtimeChannel);
  realtimeChannel = null;
  realtimeUserId = null;
  activeConversationId = null;
  conversationSearch = "";
  conversationFilter = "all";
  clearTimeout(refreshTimer);
  refreshVersion += 1;
  for (const form of voiceRecordings.keys()) cancelVoiceRecording(form);
}

function prefetchConversationPage(root) {
  const prefetched = new Set();
  const prefetch = (event) => {
    const link = event.target.closest?.("a[data-chat-open]");
    if (!link || !root.contains(link) || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.endsWith("mensagens.html") || prefetched.has(url.href)) return;
    prefetched.add(url.href);
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.as = "document";
    hint.href = url.href;
    document.head.append(hint);
  };
  root.addEventListener("pointerover", prefetch, { passive: true });
  root.addEventListener("focusin", prefetch);
}

export function bindChatEvents(root, client, getUserId) {
  prefetchConversationPage(root);
  if (root.dataset.conversationPage === "true" && window.visualViewport) {
    const viewport = window.visualViewport;
    const updateViewport = () => {
      root.style.setProperty("--looply-visible-height", viewport.height + "px");
      const thread = root.querySelector("[data-chat-thread]");
      if (document.activeElement?.matches(".chat-message-form textarea") && thread) requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
    };
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    updateViewport();
    window.addEventListener("pagehide", () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    }, { once: true });
    root.addEventListener("focusin", (event) => {
      if (event.target.matches(".chat-message-form textarea")) window.setTimeout(updateViewport, 80);
    });
  }
  root.addEventListener("looply:open-conversation", async (event) => {
    const conversationId = event.detail?.conversationId;
    const userId = getUserId?.();
    if (!client || !userId || !conversationId) return;
    activeConversationId = conversationId;
    await refreshChat(root, client, userId);
    await openConversation(root, client, conversationId, userId);
  });

  root.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-chat-open]");
    const startButton = event.target.closest("[data-chat-start]");
    const replyButton = event.target.closest("[data-chat-reply]");
    const copyButton = event.target.closest("[data-chat-copy]");
    const editButton = event.target.closest("[data-chat-edit]");
    const deleteButton = event.target.closest("[data-chat-delete]");
    const emojiToggle = event.target.closest("[data-chat-emoji-toggle]");
    const emojiButton = event.target.closest("[data-chat-emoji]");
    const conversationFilterButton = event.target.closest("[data-chat-filter]");
    const clearReplyButton = event.target.closest("[data-chat-reply-clear]");
    const olderButton = event.target.closest("[data-chat-load-older]");
    const recordStartButton = event.target.closest("[data-chat-record-start]");
    const recordStopButton = event.target.closest("[data-chat-record-stop]");
    const recordCancelButton = event.target.closest("[data-chat-record-cancel]");
    const userId = getUserId?.();
    if (!client || !userId) return;
    if (emojiToggle) {
      const picker = emojiToggle.closest("[data-chat-send]")?.querySelector("[data-chat-emoji-picker]");
      if (picker) {
        picker.hidden = !picker.hidden;
        emojiToggle.setAttribute("aria-expanded", String(!picker.hidden));
      }
      return;
    }
    if (emojiButton) {
      const form = emojiButton.closest("[data-chat-send]");
      const textarea = form?.querySelector('textarea[name="body"]');
      if (!textarea) return;
      const emoji = emojiButton.dataset.chatEmoji || "";
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      textarea.setRangeText(emoji, start, end, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      const picker = form.querySelector("[data-chat-emoji-picker]");
      if (picker) picker.hidden = true;
      form.querySelector("[data-chat-emoji-toggle]")?.setAttribute("aria-expanded", "false");
      return;
    }
    if (conversationFilterButton) {
      conversationFilter = conversationFilterButton.dataset.chatFilter === "unread" ? "unread" : "all";
      root.querySelectorAll("[data-chat-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button === conversationFilterButton)));
      applyConversationFilter(root);
      return;
    }
    if (editButton) {
      const messageId = editButton.dataset.chatEdit;
      const messageNode = editButton.closest(".chat-message");
      const currentBody = messageNode?.querySelector("p")?.textContent || "";
      const body = window.prompt("Editar mensagem", currentBody);
      if (body === null) return;
      const nextBody = body.trim();
      if (!nextBody || nextBody.length > 5000) {
        const composer = root.querySelector("[data-chat-send]");
        if (composer) setStatus(composer, "A mensagem precisa ter entre 1 e 5.000 caracteres.", "error");
        return;
      }
      editButton.disabled = true;
      try {
        const { data, error } = await client.from("chat_messages")
          .update({ body: nextBody }).eq("id", messageId).eq("sender_id", userId).select("id").maybeSingle();
        if (error) throw error;
        if (!data?.id) throw new Error("message unavailable");
        await refreshActiveThread(root, client, userId);
      } catch (error) {
        console.error("Looply message edit failed", error);
        const composer = root.querySelector("[data-chat-send]");
        if (composer) setStatus(composer, "Não foi possível editar esta mensagem. Confira se ela ainda pertence a você.", "error");
      }
      return;
    }
    if (deleteButton) {
      const messageId = deleteButton.dataset.chatDelete;
      if (!window.confirm("Apagar esta mensagem e os anexos enviados com ela?")) return;
      deleteButton.disabled = true;
      try {
        const { data: media, error: mediaError } = await client.from("chat_media")
          .select("storage_path").eq("message_id", messageId);
        if (mediaError) throw mediaError;
        const paths = (media || []).map((item) => item.storage_path).filter(Boolean);
        if (paths.length) {
          const { error: storageError } = await client.storage.from("looply-chat").remove(paths);
          if (storageError) throw storageError;
        }
        const { data, error } = await client.from("chat_messages")
          .delete().eq("id", messageId).eq("sender_id", userId).select("id").maybeSingle();
        if (error) throw error;
        if (!data?.id) throw new Error("message unavailable");
        await refreshChat(root, client, userId, { keepThread: true });
      } catch (error) {
        console.error("Looply message deletion failed", error);
        const composer = root.querySelector("[data-chat-send]");
        if (composer) setStatus(composer, "Não foi possível apagar a mensagem ou seus anexos. A mensagem foi mantida.", "error");
      }
      return;
    }
    if (copyButton) {
      const text = copyButton.closest(".chat-message")?.querySelector("p")?.textContent || "";
      try {
        if (!text || !navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(text);
        copyButton.textContent = "Copiada";
        setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = "Copiar"; }, 1600);
      } catch {
        copyButton.textContent = "Cópia indisponível";
        setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = "Copiar"; }, 2200);
      }
      return;
    }
    if (recordStartButton) {
      const form = recordStartButton.closest("[data-chat-send]");
      if (form) await startVoiceRecording(form);
      return;
    }
    if (recordStopButton) {
      const form = recordStopButton.closest("[data-chat-send]");
      const state = voiceRecordings.get(form);
      if (state?.recorder.state === "recording") state.recorder.stop();
      return;
    }
    if (recordCancelButton) {
      const form = recordCancelButton.closest("[data-chat-send]");
      if (form) cancelVoiceRecording(form);
      return;
    }
    if (olderButton) {
      const conversationId = olderButton.dataset.conversationId;
      const before = olderButton.dataset.before;
      olderButton.disabled = true;
      try {
        const { messages, participants, conversation } = await loadThread(client, conversationId, before);
        await signThreadAvatar(client, participants);
        const thread = root.querySelector("[data-chat-thread]");
        if (!thread || activeConversationId !== conversationId) return;
        const scrollHeight = thread.scrollHeight;
        olderButton.remove();
        const nextButton = messages.length === 100 ? olderMessagesButton(conversationId, messages[0]) : "";
        const peer = peerParticipantFor(participants, userId);
        history.insertAdjacentHTML("afterbegin", `${nextButton}${threadMarkup(messages, userId, peer?.last_read_at || null, peer?.profile || null, participants, conversation?.kind === "group")}`);
        thread.scrollTop += thread.scrollHeight - scrollHeight;
      } catch (error) {
        console.error("Looply older messages failed", error);
        olderButton.disabled = false;
        olderButton.textContent = "Não foi possível carregar; tente de novo";
      }
      return;
    }
    if (replyButton) {
      const form = replyButton.closest("[data-chat-thread]")?.querySelector("[data-chat-send]");
      const message = replyButton.closest(".chat-message");
      const input = form?.querySelector('input[name="replyTo"]');
      const context = form?.querySelector("[data-chat-reply-context]");
      if (input && context && message) {
        input.value = replyButton.dataset.chatReply;
        context.querySelector("span").textContent = `Respondendo: ${(message.querySelector("p")?.textContent || "mensagem").slice(0, 140)}`;
        context.hidden = false;
        form.querySelector("textarea[name='body']")?.focus();
      }
      return;
    }
    if (clearReplyButton) {
      const form = clearReplyButton.closest("[data-chat-send]");
      if (form) {
        form.querySelector('input[name="replyTo"]').value = "";
        form.querySelector("[data-chat-reply-context]").hidden = true;
      }
      return;
    }
    if (openButton) {
      event.preventDefault();
      const conversationId = openButton.dataset.chatOpen;
      if (root.dataset.conversationPage !== "true") {
        window.location.assign(`mensagens.html?id=${encodeURIComponent(conversationId)}`);
        return;
      }
      await openConversation(root, client, conversationId, userId);
      return;
    }
    if (startButton) {
      startButton.disabled = true;
      try {
        const { data, error } = await client.functions.invoke("looply-chat", { body: { action: "create_direct", targetId: startButton.dataset.chatStart } });
        if (error) throw error;
        if (!data?.conversationId) throw new Error(data?.errorCode || "conversation unavailable");
        if (root.dataset.conversationPage !== "true") {
          window.location.assign(`mensagens.html?id=${encodeURIComponent(data.conversationId)}`);
          return;
        }
        activeConversationId = data.conversationId;
        await refreshChat(root, client, userId);
        await openConversation(root, client, data.conversationId, userId);
      } catch (error) {
        console.error("Looply direct conversation failed", error);
        startButton.insertAdjacentHTML("afterend", `<small class="chat-inline-error">Não foi possível iniciar agora.</small>`);
      } finally { startButton.disabled = false; }
    }
  });

  root.addEventListener("input", (event) => {
    if (!event.target.matches("[data-chat-conversation-search]")) return;
    conversationSearch = event.target.value;
    applyConversationFilter(root);
  });

  root.addEventListener("change", (event) => {
    const select = event.target.closest("[data-chat-audio-rate]");
    if (!select) return;
    const audio = select.closest(".chat-audio-player")?.querySelector("audio");
    if (audio) audio.playbackRate = Math.min(2, Math.max(0.5, Number(select.value) || 1));
  });

  root.addEventListener("keydown", (event) => {
    const textarea = event.target.closest?.(".chat-message-form textarea");
    if (!textarea || event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    const form = textarea.closest("form[data-chat-send]");
    if (form && form.dataset.sending !== "true") form.requestSubmit();
  });

  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-chat-search], form[data-chat-group-create], form[data-letter-send], form[data-chat-send]");
    if (!form) return;

    // Always suppress native form navigation for app forms, including duplicate submits.
    // Otherwise a second tap during an in-flight send can reload the page and lose the draft.
    event.preventDefault();
    const userId = getUserId?.();
    if (!client || !userId) {
      if (form.matches("form[data-chat-send]")) {
        setStatus(form, "Sua sessão não está disponível. Entre novamente; o rascunho foi mantido.", "error");
      }
      return;
    }
    if (form.dataset.sending === "true") return;
    form.dataset.sending = "true";
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const values = new FormData(form);
      if (form.matches("[data-chat-group-create]")) {
        const subject = String(values.get("subject") || "").trim();
        const targetIds = values.getAll("memberIds").map((value) => String(value));
        if (!subject || subject.length > 120 || targetIds.length < 2 || targetIds.length > 49 || new Set(targetIds).size !== targetIds.length) throw new Error("invalid group");
        const { data, error } = await client.functions.invoke("looply-chat", { body: { action: "create_group", subject, targetIds } });
        if (error) throw error;
        if (!data?.conversationId) throw new Error(data?.errorCode || "group unavailable");
        form.reset();
        activeConversationId = data.conversationId;
        setStatus(form, "Grupo criado.");
        await refreshChat(root, client, userId);
        if (root.dataset.conversationPage !== "true") {
          window.location.assign(`mensagens.html?id=${encodeURIComponent(data.conversationId)}`);
          return;
        }
        await openConversation(root, client, data.conversationId, userId);
      } else if (form.matches("[data-chat-search]")) {
        const query = String(values.get("query") || "").trim().toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(query)) throw new Error("invalid query");
        const { data, error } = await client.from("profiles").select("id,username,display_name").ilike("username", `${query}%`).neq("id", userId).order("username").limit(20);
        if (error) throw error;
        const container = root.querySelector("[data-chat-people]");
        if (container) container.innerHTML = (data || []).map((profile) => `<article class="chat-person"><span><strong>${escapeHtml(profile.display_name || profile.username)}</strong><small>@${escapeHtml(profile.username)}</small></span><button class="text-button" type="button" data-chat-start="${escapeHtml(profile.id)}">Conversar</button></article>`).join("") || `<p class="chat-empty">Nenhum perfil visível correspondeu à busca.</p>`;
        setStatus(form, `${(data || []).length} perfil(is) encontrado(s).`);
      } else if (form.matches("[data-letter-send]")) {
        const subject = String(values.get("subject") || "").trim();
        const body = String(values.get("body") || "").trim();
        const { data, error } = await client.functions.invoke("looply-chat", { body: { action: "create_letter", subject, body } });
        if (error) throw error;
        if (!data?.conversationId) throw new Error(data?.errorCode || "letter unavailable");
        form.reset();
        activeConversationId = data.conversationId;
        setStatus(form, "Carta enviada e guardada numa conversa privada.");
        await refreshChat(root, client, userId);
        await openConversation(root, client, data.conversationId, userId);
      } else {
        const routeConversationId = root.dataset.conversationPage === "true"
          ? new URLSearchParams(window.location.search).get("id")
          : "";
        const conversationId = String(form.dataset.conversationId || routeConversationId || activeConversationId || "").trim();
        if (!conversationId) throw new Error("conversation not selected");
        // Keep the selected thread bound to the composer if Realtime refreshes the page state.
        form.dataset.conversationId = conversationId;
        const files = selectedFiles(values);
        const body = String(values.get("body") || "").trim() || (files.length ? "Compartilhou arquivos." : "");
        if (!body) throw new Error("empty message");
        const { data: message, error } = await client.from("chat_messages")
          .insert({ conversation_id: conversationId, reply_to: String(values.get("replyTo") || "") || null, body })
          .select("id").single();
        if (error) throw error;
        const uploadedPaths = [];
        try {
          for (const [index, file] of files.entries()) {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "arquivo";
            const path = `conversations/${conversationId}/${message.id}/${crypto.randomUUID()}.${fileExtensions.get(file.type.split(";")[0])}`;
            setStatus(form, `Enviando arquivo ${index + 1} de ${files.length}: 0%`);
            uploadedPaths.push(path);
            await uploadResumable(client, path, file, (percentage) => setStatus(form, `Enviando arquivo ${index + 1} de ${files.length}: ${percentage}%`));
            const { error: mediaError } = await client.from("chat_media").insert({
              conversation_id: conversationId, message_id: message.id, storage_path: path,
              mime_type: file.type.split(";")[0], byte_size: file.size, file_name: safeName
            });
            if (mediaError) throw mediaError;
          }
        } catch (error) {
          if (uploadedPaths.length) await client.storage.from("looply-chat").remove(uploadedPaths);
          await client.from("chat_messages").delete().eq("id", message.id);
          throw error;
        }
        if (form._looplyRecordedFile) {
          const preview = form.querySelector("[data-chat-record-preview]");
          if (preview?.src?.startsWith("blob:")) URL.revokeObjectURL(preview.src);
          delete form._looplyRecordedFile;
        }
        if (form.isConnected) {
          form.reset();
          setStatus(form, files.length ? "Mensagem e anexos enviados." : "Mensagem enviada.");
        }
        delete form.dataset.sending;
        await refreshActiveThread(root, client, userId);
      }
    } catch (error) {
      console.error("Looply chat action failed", error);
      let message;
      if (/invalid group/.test(String(error?.message || ""))) message = "Informe um nome e selecione de duas a 49 pessoas para o grupo.";
      else if (/profile_unavailable/i.test(String(error?.message || ""))) message = "Um dos perfis selecionados não está disponível para participar do grupo.";
      else if (/unsupported attachment/.test(String(error?.message || ""))) message = "Formato inválido, arquivo acima de 100 MiB ou mais de 8 anexos.";
      else if (/empty message/.test(String(error?.message || ""))) message = "Escreva uma mensagem ou escolha ao menos um arquivo.";
      else if (/conversation not selected/.test(String(error?.message || ""))) message = "Abra uma conversa pela lista antes de enviar. Seu texto continua no campo.";
      else if (/peixinho_admin_not_ready/i.test(String(error?.message || ""))) message = "A caixa de cartas abrirá assim que Peixinho concluir a nova conta administrativa.";
      else message = "Não foi possível concluir. Confira sua conexão e as permissões e tente novamente.";
      setStatus(form, message, "error");
    } finally {
      delete form.dataset.sending;
      if (button) button.disabled = false;
    }
  });
}

function applyConversationFilter(root) {
  const items = [...root.querySelectorAll("[data-chat-conversations] [data-chat-open]")];
  let visible = 0;
  const query = conversationSearch.trim().toLocaleLowerCase("pt-BR");
  for (const item of items) {
    const matchesQuery = !query || item.textContent.toLocaleLowerCase("pt-BR").includes(query);
    const matchesFilter = conversationFilter !== "unread" || Boolean(item.querySelector(".chat-unread"));
    item.hidden = !(matchesQuery && matchesFilter);
    if (!item.hidden) visible += 1;
  }
  const noMatches = root.querySelector("[data-chat-no-matches]");
  if (noMatches) noMatches.hidden = !items.length || visible > 0;
}

