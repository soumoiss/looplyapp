function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function person(profile) {
  return profile ? `@${escapeHtml(profile.username)}` : "perfil restrito";
}

export async function loadMusicData(client, userId) {
  const [peopleResult, dedicationsResult, libraryResult] = await Promise.all([
    client.from("profiles").select("id,username,display_name").order("username").limit(100),
    client.from("music_dedications")
      .select("id,sender_id,recipient_id,title,artist,listen_url,dedication_note,created_at,sender:profiles!music_dedications_sender_id_fkey(username,display_name),recipient:profiles!music_dedications_recipient_id_fkey(username,display_name),comments:music_comments(id,author_id,body,visibility,created_at,author:profiles!music_comments_author_id_fkey(username,display_name))")
      .order("created_at", { ascending: false }).limit(50),
    client.from("music_library").select("id,owner_id,title,artist,listen_url,note,created_at,updated_at")
      .eq("owner_id", userId).order("created_at", { ascending: false }).limit(100)
  ]);
  return {
    people: peopleResult.data || [],
    peopleError: peopleResult.error,
    dedications: dedicationsResult.data || [],
    dedicationsError: dedicationsResult.error,
    library: libraryResult.data || [],
    libraryError: libraryResult.error
  };
}

function libraryMarkup(items, error) {
  if (error) return `<p class="music-error" role="alert">Não foi possível carregar sua coleção pessoal.</p>`;
  if (!items.length) return `<p class="music-empty">Sua coleção pessoal está vazia.</p>`;
  return items.map((item) => `<article class="music-card music-library-card" data-library-track="${escapeHtml(item.id)}">
    <div class="music-card-top"><span class="music-disc" aria-hidden="true">♫</span><span class="music-date">Na sua coleção</span></div>
    <h3>${escapeHtml(item.title)}</h3>${item.artist ? `<p class="music-artist">${escapeHtml(item.artist)}</p>` : ""}
    ${item.note ? `<p class="music-note">${escapeHtml(item.note)}</p>` : ""}
    <a class="music-listen" href="${escapeHtml(item.listen_url)}" target="_blank" rel="noopener noreferrer">Ouvir a música <span aria-hidden="true">↗</span></a>
    <button class="text-button" type="button" data-music-library-delete="${escapeHtml(item.id)}">Remover da minha coleção</button>
    <span class="form-status" data-library-delete-status role="status" aria-live="polite"></span>
  </article>`).join("");
}

function personalLibraryMarkup(data) {
  return `<details class="music-library-panel"><summary>Minha coleção pessoal</summary>
    
    <form class="music-library-form" data-music-library>
      <div class="music-form-grid">
        <div class="field"><label for="libraryMusicTitle">Música</label><input id="libraryMusicTitle" name="title" type="text" maxlength="160" required placeholder="Nome da música"></div>
        <div class="field"><label for="libraryMusicArtist">Artista</label><input id="libraryMusicArtist" name="artist" type="text" maxlength="120" placeholder="Nome do artista"></div>
      </div>
      <div class="field"><label for="libraryMusicUrl">Link para ouvir</label><input id="libraryMusicUrl" name="listenUrl" type="url" maxlength="1000" required placeholder="YouTube, Spotify, Apple Music ou SoundCloud"></div>
      <div class="field"><label for="libraryMusicNote">Anotação pessoal (opcional)</label><textarea id="libraryMusicNote" name="note" maxlength="1000" rows="2" placeholder="Por que esta música é importante para você?"></textarea></div>
      <button class="text-button" type="submit">Salvar na minha coleção</button>
      <span class="form-status" data-status role="status" aria-live="polite"></span>
    </form>
    <div class="music-list" data-music-library-list>${libraryMarkup(data.library, data.libraryError)}</div>
  </details>`;
}

function dedicationMarkup(item, userId) {
  const comments = [...(item.comments || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const senderIsCurrent = item.sender_id === userId;
  const direction = senderIsCurrent
    ? `Você dedicou esta música para ${person(item.recipient)}.`
    : `${person(item.sender)} dedicou esta música para você.`;
  const notes = item.dedication_note
    ? `<p class="music-note">${escapeHtml(item.dedication_note)}</p>`
    : "";
  const commentsMarkup = comments.length
    ? comments.map((comment) => `<article class="music-comment">
        <div><strong>${person(comment.author)}</strong><span class="music-comment-visibility">${comment.visibility === "private" ? "Só você" : "Compartilhado"}</span></div>
        <p>${escapeHtml(comment.body)}</p>
      </article>`).join("")
    : `<p class="music-empty">Ainda não há comentários nesta dedicatória.</p>`;

  return `<article class="music-card" id="dedication-${escapeHtml(item.id)}" data-dedication="${escapeHtml(item.id)}">
    <div class="music-card-top"><span class="music-disc" aria-hidden="true">♫</span><span class="music-date">${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(item.created_at)))}</span></div>
    <p class="music-direction">${direction}</p>
    <h3>${escapeHtml(item.title)}</h3>
    ${item.artist ? `<p class="music-artist">${escapeHtml(item.artist)}</p>` : ""}
    ${notes}
    <a class="music-listen" href="${escapeHtml(item.listen_url)}" target="_blank" rel="noopener noreferrer">Ouvir a música <span aria-hidden="true">↗</span></a>
    <section class="music-comments" aria-label="Comentários privados da música">
      <h4>Comentários <span>${comments.length}</span></h4>
      <div class="music-comment-list">${commentsMarkup}</div>
      <form class="music-comment-form" data-music-comment data-dedication-id="${escapeHtml(item.id)}">
        <label class="visually-hidden" for="music-comment-${escapeHtml(item.id)}">Seu comentário sobre esta música</label>
        <textarea id="music-comment-${escapeHtml(item.id)}" name="body" maxlength="2000" required placeholder="Escreva um comentário"></textarea>
        <div class="music-comment-actions"><label for="comment-visibility-${escapeHtml(item.id)}">Visibilidade</label>
          <select id="comment-visibility-${escapeHtml(item.id)}" name="visibility"><option value="private">Só eu</option><option value="participants">Compartilhar com quem participa da dedicatória</option></select>
          <button class="text-button" type="submit">Salvar comentário</button>
        </div>
        <span class="form-status" data-status role="status" aria-live="polite"></span>
      </form>
    </section>
  </article>`;
}

function musicContent(data, userId) {
  if (data.dedicationsError) {
    return `<div class="social-message social-error" role="alert">Não foi possível carregar suas músicas. Confira a conexão e tente novamente.</div>`;
  }
  const incoming = data.dedications.filter((item) => item.recipient_id === userId).length;
  const outgoing = data.dedications.filter((item) => item.sender_id === userId).length;
  const list = data.dedications.length
    ? data.dedications.map((item) => dedicationMarkup(item, userId)).join("")
    : `<div class="social-message"><strong>Nenhuma dedicatória recebida ou enviada.</strong></div>`;
  const choices = data.people.filter((profile) => profile.id !== userId).map((profile) =>
    `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.display_name)} · @${escapeHtml(profile.username)}</option>`
  ).join("");
  const recipientHint = data.peopleError
    ? `<span class="field-hint field-error">Não foi possível carregar os perfis.</span>`
    : "";

  return `<section class="music-area" data-music-area aria-labelledby="musicTitle">
    <div class="music-heading"><div><span class="section-kicker">Biblioteca</span><h2 id="musicTitle">Músicas e dedicatórias</h2></div>
      <span class="music-count">${incoming} recebida${incoming === 1 ? "" : "s"} · ${outgoing} enviada${outgoing === 1 ? "" : "s"}</span></div>
    ${personalLibraryMarkup(data)}
    <details class="music-composer"><summary>Dedicar uma música</summary>
      <form data-music-send>
        <div class="field"><label for="musicRecipient">Para quem é esta música?</label><select id="musicRecipient" name="recipientId" required ${choices ? "" : "disabled"}><option value="">Escolha uma pessoa</option>${choices}</select>${recipientHint}</div>
        <div class="music-form-grid">
          <div class="field"><label for="musicTitle">Música</label><input id="musicTitle" name="title" type="text" maxlength="160" required placeholder="Nome da música"></div>
          <div class="field"><label for="musicArtist">Artista</label><input id="musicArtist" name="artist" type="text" maxlength="120" placeholder="Nome do artista"></div>
        </div>
        <div class="field"><label for="musicUrl">Link para ouvir</label><input id="musicUrl" name="listenUrl" type="url" maxlength="1000" required placeholder="YouTube, Spotify, Apple Music ou SoundCloud"></div>
        <div class="field"><label for="musicNote">Uma dedicatória (opcional)</label><textarea id="musicNote" name="note" maxlength="1000" rows="3" placeholder="Por que esta música lembrou essa pessoa?"></textarea></div>
        <button class="primary-button compact-button" type="submit">Enviar dedicatória <span aria-hidden="true">↗</span></button>
        <span class="form-status" data-status role="status" aria-live="polite"></span>
      </form>
    </details>
    <div class="music-list" data-music-list>${list}</div>
    <span class="realtime-state" data-music-realtime role="status">Conectando atualizações...</span>
  </section>`;
}

export function musicMarkup(data, userId) {
  return musicContent(data, userId);
}

async function refreshMusic(root, client, userId) {
  const area = root.querySelector("[data-music-area]");
  if (!area) return;
  area.setAttribute("aria-busy", "true");
  try {
    area.outerHTML = musicMarkup(await loadMusicData(client, userId), userId);
  } catch (error) {
    console.error("Looply music refresh failed", error);
    area.innerHTML = `<div class="social-message social-error" role="alert">Não foi possível atualizar agora.</div>`;
  }
}

function setStatus(form, message, kind = "success") {
  const status = form.querySelector("[data-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

export function bindMusicEvents(root, client, getUserId) {
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-music-library-delete]");
    if (!button || !client) return;
    button.disabled = true;
    try {
      const { error } = await client.from("music_library").delete().eq("id", button.dataset.musicLibraryDelete);
      if (error) throw error;
      await refreshMusic(root, client, getUserId?.());
    } catch (error) {
      console.error("Looply music library delete failed", error);
      const status = button.closest("[data-library-track]")?.querySelector("[data-library-delete-status]");
      if (status) {
        status.textContent = "Não foi possível remover a música. Tente novamente.";
        status.dataset.kind = "error";
      }
      button.disabled = false;
    }
  });

  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-music-library], form[data-music-send], form[data-music-comment]");
    if (!form || !client) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const userId = getUserId?.();
    if (button) button.disabled = true;
    try {
      const values = new FormData(form);
      const body = String(values.get("body") || "").trim();
      if (form.matches("[data-music-library]")) {
        const title = String(values.get("title") || "").trim();
        const artist = String(values.get("artist") || "").trim();
        const note = String(values.get("note") || "").trim();
        const listenUrl = String(values.get("listenUrl") || "").trim();
        const supported = /^https:\/\/(open\.spotify\.com|music\.youtube\.com|youtu\.be|www\.youtube\.com|youtube\.com|music\.apple\.com|soundcloud\.com)\//i.test(listenUrl);
        if (!title || title.length > 160 || !supported) throw new Error("music-library-fields");
        const { error } = await client.from("music_library").insert({ title, artist, listen_url: listenUrl, note });
        if (error) throw error;
        form.reset();
        setStatus(form, "A música foi salva na sua coleção.");
        await refreshMusic(root, client, userId);
      } else if (form.matches("[data-music-send]")) {
        const title = String(values.get("title") || "").trim();
        const artist = String(values.get("artist") || "").trim();
        const note = String(values.get("note") || "").trim();
        const recipientId = String(values.get("recipientId") || "");
        const listenUrl = String(values.get("listenUrl") || "").trim();
        const supported = /^https:\/\/(open\.spotify\.com|music\.youtube\.com|youtu\.be|www\.youtube\.com|youtube\.com|music\.apple\.com|soundcloud\.com)\//i.test(listenUrl);
        if (!title || title.length > 160 || !recipientId || !supported) throw new Error("music-fields");
        const { error } = await client.from("music_dedications").insert({ recipient_id: recipientId, title, artist, dedication_note: note, listen_url: listenUrl });
        if (error) throw error;
        form.reset();
        setStatus(form, "A dedicatória foi salva.");
        await refreshMusic(root, client, userId);
      } else {
        const dedicationId = form.dataset.dedicationId;
        const visibility = String(values.get("visibility") || "private");
        if (!body || body.length > 2000) throw new Error("comment-fields");
        const { error } = await client.from("music_comments").insert({ dedication_id: dedicationId, body, visibility });
        if (error) throw error;
        await refreshMusic(root, client, userId);
      }
    } catch (error) {
      console.error("Looply music action failed", error);
      const message = /duplicate|unique/i.test(String(error?.message || ""))
        ? "Esta dedicatória já foi salva."
        : "Não foi possível salvar. Confira os campos, o link e as permissões e tente novamente.";
      setStatus(form, message, "error");
    } finally {
      if (button) button.disabled = false;
    }
  });
}

let musicChannel = null;
let musicUserId = null;
let musicRefreshTimer = null;

export function setupMusicRealtime(client, userId, root) {
  if (!client || !userId) return;
  if (musicChannel && musicUserId === userId) return;
  if (musicChannel) client.removeChannel(musicChannel);
  musicUserId = userId;
  musicChannel = client
    .channel(`looply-music-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "music_dedications" }, () => scheduleMusicRefresh(root, client, userId))
    .on("postgres_changes", { event: "*", schema: "public", table: "music_comments" }, () => scheduleMusicRefresh(root, client, userId))
    .on("postgres_changes", { event: "*", schema: "public", table: "music_library", filter: `owner_id=eq.${userId}` }, () => scheduleMusicRefresh(root, client, userId))
    .subscribe((state) => {
      const status = root.querySelector("[data-music-realtime]");
      if (status) status.textContent = state === "SUBSCRIBED" ? "Atualizações ao vivo" : "Reconectando atualizações...";
    });
}

function scheduleMusicRefresh(root, client, userId) {
  clearTimeout(musicRefreshTimer);
  musicRefreshTimer = setTimeout(() => refreshMusic(root, client, userId), 350);
}

export function disposeMusicRealtime(client) {
  clearTimeout(musicRefreshTimer);
  if (musicChannel && client) client.removeChannel(musicChannel);
  musicChannel = null;
  musicUserId = null;
}
