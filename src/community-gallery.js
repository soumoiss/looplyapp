const bucketName = "looply-gallery";
const regularMaxBytes = 100 * 1024 * 1024;
const administratorMaxBytes = 200 * 1024 * 1024;
const maxFilesPerUpload = 12;
const types = new Map([
  ["image/jpeg", ["image", "jpg"]], ["image/png", ["image", "png"]], ["image/webp", ["image", "webp"]], ["image/heic", ["image", "heic"]],
  ["video/mp4", ["video", "mp4"]], ["video/webm", ["video", "webm"]],
  ["audio/mpeg", ["audio", "mp3"]], ["audio/mp4", ["audio", "m4a"]], ["audio/ogg", ["audio", "ogg"]],
  ["audio/webm", ["audio", "webm"]], ["audio/wav", ["audio", "wav"]], ["audio/aac", ["audio", "aac"]]
]);
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}
function mediaContent(item) {
  const url = escapeHtml(item.signedUrl || "");
  const name = escapeHtml(item.file_name);
  if (!url) return "<span class=\"community-gallery-unavailable\">Arquivo indisponível.</span>";
  if (item.kind === "image" && item.mime_type !== "image/heic") return "<img src=\"" + url + "\" alt=\"" + name + "\" loading=\"lazy\" referrerpolicy=\"no-referrer\">";
  if (item.kind === "video") return "<video src=\"" + url + "\" controls playsinline preload=\"metadata\" aria-label=\"" + name + "\"></video>";
  if (item.kind === "audio") return "<audio src=\"" + url + "\" controls preload=\"metadata\" aria-label=\"" + name + "\"></audio>";
  return "<a href=\"" + url + "\" target=\"_blank\" rel=\"noopener noreferrer\">Abrir " + name + "</a>";
}
function itemMarkup(item, userId, isAdmin) {
  const canDelete = item.owner_id === userId || isAdmin;
  return "<article class=\"community-gallery-card\"><div class=\"community-gallery-visual\">" + mediaContent(item) + "</div>" +
    "<div class=\"community-gallery-card-copy\"><strong>" + escapeHtml(item.caption || item.file_name) + "</strong>" +
    "<span>@" + escapeHtml(item.owner?.username || "membro") + " · " + escapeHtml(dateLabel(item.created_at)) + "</span></div>" +
    (canDelete ? "<button class=\"community-gallery-delete\" type=\"button\" data-delete-community-media=\"" + escapeHtml(item.id) + "\">Excluir</button>" : "") +
    "</article>";
}
export async function loadCommunityGallery(client) {
  const { data, error } = await client.from("community_gallery_media")
    .select("id,owner_id,storage_path,file_name,kind,mime_type,byte_size,caption,created_at,owner:profiles!community_gallery_media_owner_id_fkey(username,display_name)")
    .order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return [];
  const { data: signed, error: signedError } = await client.storage.from(bucketName).createSignedUrls(rows.map((item) => item.storage_path), 1800);
  return rows.map((item, index) => ({ ...item, signedUrl: signedError ? null : signed?.[index]?.signedUrl || null }));
}
function galleryGridMarkup(media, userId, isAdmin) {
  return media.length ? media.map((item) => itemMarkup(item, userId, isAdmin)).join("") :
    "<p class=\"community-gallery-empty\">Nenhuma mídia publicada.</p>";
}
export function communityGalleryMarkup(media, userId, isAdmin) {
  const maxLabel = isAdmin ? "Até 200 MB por arquivo" : "Até 100 MB por arquivo";
  return "<section class=\"panel community-gallery-panel\" aria-labelledby=\"communityGalleryTitle\">" +
    "<div class=\"community-gallery-heading\"><div><span class=\"section-kicker\">Mídia</span><h2 id=\"communityGalleryTitle\">Galeria da comunidade</h2></div><span data-community-gallery-count>" + media.length + " arquivo(s)</span></div>" +
    "<form class=\"community-gallery-upload\" data-community-gallery-upload><label>Fotos, vídeos ou áudios<input type=\"file\" name=\"files\" accept=\"image/jpeg,image/png,image/webp,image/heic,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/webm,audio/wav,audio/aac\" multiple required></label>" +
    "<label>Descrição (opcional)<input type=\"text\" name=\"caption\" maxlength=\"500\"></label><small>" + maxLabel + " · até " + maxFilesPerUpload + " arquivos por envio</small>" +
    "<button class=\"primary-button compact-button\" type=\"submit\">Publicar mídia</button><p class=\"form-status\" data-community-gallery-status role=\"status\" aria-live=\"polite\"></p></form>" +
    "<div class=\"community-gallery-grid\" data-community-gallery-grid>" + galleryGridMarkup(media, userId, isAdmin) + "</div></section>";
}
async function uploadFile(client, file, path, contentType, onProgress) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (sessionError || !token) throw new Error("Sessão expirada. Entre novamente.");
  const key = window.LOOPLY_CONFIG?.publishableKey;
  if (!key) throw new Error("A chave pública do Supabase está ausente.");
  if (file.size <= 6 * 1024 * 1024) {
    const { error } = await client.storage.from(bucketName).upload(path, file, { contentType, cacheControl: "3600", upsert: false });
    if (error) throw error;
    onProgress(100);
    return;
  }
  const projectUrl = new URL(window.LOOPLY_CONFIG.supabaseUrl);
  const endpoint = projectUrl.hostname.endsWith(".supabase.co")
    ? projectUrl.protocol + "//" + projectUrl.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co") + "/storage/v1/upload/resumable"
    : new URL("/storage/v1/upload/resumable", projectUrl).toString();
  const tus = await import("https://esm.sh/tus-js-client@4.3.1");
  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint, retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: "Bearer " + token, apikey: key }, uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true, chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: bucketName, objectName: path, contentType, cacheControl: "3600" },
      onError: reject, onProgress: (uploaded, total) => onProgress(Math.floor(uploaded / total * 100)), onSuccess: resolve
    });
    upload.start();
  });
}
function fileDescriptor(file) {
  if (types.has(file.type)) return { kind: types.get(file.type)[0], ext: types.get(file.type)[1], mime: file.type };
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  const suffixes = {
    jpg: ["image", "jpg", "image/jpeg"], jpeg: ["image", "jpeg", "image/jpeg"],
    png: ["image", "png", "image/png"], webp: ["image", "webp", "image/webp"], heic: ["image", "heic", "image/heic"],
    mp4: ["video", "mp4", "video/mp4"], webm: file.type.startsWith("audio/") ? ["audio", "webm", "audio/webm"] : ["video", "webm", "video/webm"],
    mp3: ["audio", "mp3", "audio/mpeg"], m4a: ["audio", "m4a", "audio/mp4"], ogg: ["audio", "ogg", "audio/ogg"],
    wav: ["audio", "wav", "audio/wav"], aac: ["audio", "aac", "audio/aac"]
  };
  const value = suffixes[ext];
  return value ? { kind: value[0], ext: value[1], mime: value[2] } : null;
}
async function removeUploaded(client, path) {
  const { error } = await client.storage.from(bucketName).remove([path]);
  if (error) console.warn("Community gallery cleanup failed", error);
}
export function bindCommunityGallery(root, client, user, isAdmin, initialMedia) {
  let media = [...initialMedia];
  const section = root.querySelector(".community-gallery-panel");
  const render = () => {
    const grid = section?.querySelector("[data-community-gallery-grid]");
    const count = section?.querySelector("[data-community-gallery-count]");
    if (grid) grid.innerHTML = galleryGridMarkup(media, user.id, isAdmin);
    if (count) count.textContent = media.length + " arquivo(s)";
  };
  const reload = async () => { media = await loadCommunityGallery(client); render(); };
  section?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-community-gallery-upload]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector('input[type="file"]');
    const files = [...(input?.files || [])];
    const maxBytes = isAdmin ? administratorMaxBytes : regularMaxBytes;
    const status = form.querySelector("[data-community-gallery-status]");
    const button = form.querySelector('button[type="submit"]');
    if (!files.length) return;
    if (files.length > maxFilesPerUpload) { status.textContent = "Envie no máximo " + maxFilesPerUpload + " arquivos por vez."; return; }
    button.disabled = true;
    let uploaded = 0;
    const failures = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const descriptor = fileDescriptor(file);
      if (!descriptor || file.size < 1 || file.size > maxBytes) {
        failures.push(file.name + ": formato ou tamanho não permitido."); continue;
      }
      const path = "gallery/" + user.id + "/" + crypto.randomUUID() + "." + descriptor.ext;
      status.textContent = "Enviando " + (index + 1) + " de " + files.length + ": " + file.name + " (0%).";
      try {
        await uploadFile(client, file, path, descriptor.mime, (percentage) => {
          status.textContent = "Enviando " + (index + 1) + " de " + files.length + ": " + file.name + " (" + percentage + "%).";
        });
        const { error } = await client.from("community_gallery_media").insert({
          owner_id: user.id, storage_path: path, file_name: file.name.slice(0, 180),
          kind: descriptor.kind, mime_type: descriptor.mime, byte_size: file.size,
          caption: String(new FormData(form).get("caption") || "").trim()
        });
        if (error) throw error;
        uploaded += 1;
        root.dispatchEvent(new CustomEvent("looply:gallery-refresh"));
      } catch (error) {
        await removeUploaded(client, path);
        console.warn("Community gallery item failed", file.name, error);
        failures.push(file.name + ": não foi possível enviar.");
      }
    }
    form.reset();
    status.textContent = uploaded + " arquivo(s) enviado(s)." + (failures.length ? " " + failures.length + " falha(s): " + failures.slice(0, 4).join(" ") : "");
    button.disabled = false;
  });
  section?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-community-media]");
    if (!button) return;
    const item = media.find((row) => row.id === button.dataset.deleteCommunityMedia);
    if (!item || (item.owner_id !== user.id && !isAdmin)) return;
    button.disabled = true;
    const { error: storageError } = await client.storage.from(bucketName).remove([item.storage_path]);
    if (storageError) { button.disabled = false; console.error("Community gallery media deletion failed", storageError); return; }
    const { error } = await client.from("community_gallery_media").delete().eq("id", item.id);
    if (error) console.error("Community gallery row deletion failed", error);
    root.dispatchEvent(new CustomEvent("looply:gallery-refresh"));
  });

}
