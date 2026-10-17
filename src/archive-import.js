import { extractDate, toISO } from "./date-parser.js";

const maxFileBytes = 200 * 1024 * 1024;
const passwordIterations = 210_000;
const mediaTypes = new Map([
  ["jpg", ["image", "image/jpeg"]], ["jpeg", ["image", "image/jpeg"]],
  ["png", ["image", "image/png"]], ["webp", ["image", "image/webp"]],
  ["heic", ["image", "image/heic"]], ["mp4", ["video", "video/mp4"]],
  ["webm", ["video", "video/webm"]], ["mp3", ["audio", "audio/mpeg"]]
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export function archiveImportMarkup() {
  return `<section class="archive-import panel" aria-labelledby="archiveImportTitle">
    <div class="admin-heading"><div><span class="section-kicker">Migração privada</span><h2 id="archiveImportTitle">Importar cartas e mídias antigas</h2></div></div>
    <p class="admin-description">Selecione a pasta extraída completa do Loooply-main. As cartas e mídias serão enviadas para o Supabase privado; textos MSG associados às mídias também serão preservados. Cada item é processado separadamente; uma falha individual não interrompe o restante.</p>
    <form data-archive-import-form>
      <div class="field"><label for="archiveSourceFolder">Pasta Loooply-main</label><input id="archiveSourceFolder" type="file" webkitdirectory directory multiple required></div>
      <div class="field"><label for="archiveImportPurpose">Motivo desta importação</label><textarea id="archiveImportPurpose" name="purpose" minlength="20" maxlength="500" rows="2" required placeholder="Descreva o motivo da importação para a auditoria."></textarea></div>
      <button class="primary-button compact-button" type="submit">Importar acervo <span aria-hidden="true">↗</span></button>
      <div class="archive-import-progress" data-archive-import-status role="status" aria-live="polite">Nenhum arquivo selecionado.</div>
      <ul class="archive-import-errors" data-archive-import-errors hidden></ul>
    </form>
  </section>`;
}

function normalizedPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").normalize("NFC");
}

function keyPath(value) {
  return normalizedPath(value).toLocaleLowerCase("pt-BR");
}

function selectedRootFiles(fileList) {
  const files = [...fileList];
  if (!files.length) throw new Error("Selecione a pasta extraída Loooply-main.");
  const rootName = (files[0].webkitRelativePath || files[0].name).split("/")[0];
  const map = new Map();
  for (const file of files) {
    const fullPath = normalizedPath(file.webkitRelativePath || file.name);
    const parts = fullPath.split("/");
    if (parts[0] !== rootName) continue;
    const relative = parts.slice(1).join("/");
    if (relative) map.set(keyPath(relative), { file, path: relative });
  }
  return map;
}

function fileNameFromPath(value) {
  return normalizedPath(value).split("/").at(-1) || "";
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: passwordIterations, hash: "SHA-256" }, key, 256);
  return { password_salt: base64Url(salt), password_hash: base64Url(new Uint8Array(bits)) };
}

async function readCardText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(bytes);
  return text.replace(/^\uFEFF/, "");
}

async function parseCard(file, profileByName) {
  const name = fileNameFromPath(file.webkitRelativePath || file.name);
  const match = name.match(/^(Misol|Patati|YARA)carta(privada)?([0-9]+)\.txt$/i);
  if (!match) return null;
  const username = match[1].toLocaleLowerCase("pt-BR");
  const recipientId = profileByName.get(username);
  if (!recipientId) throw new Error(`O perfil autorizado @${username} não foi encontrado.`);
  if (file.size > 100_000) throw new Error(`Uma carta excede o limite de 100.000 caracteres: ${name}`);
  const source = (await readCardText(file)).replace(/\r/g, "");
  const lines = source.split("\n");
  const protectedMatch = (lines[0] || "").trim().match(/^Essa carta é protegida pela senha:\s*(.*)$/i);
  const isPrivate = Boolean(match[2]);
  const isProtected = Boolean(protectedMatch);
  let body = source;
  let password = "";
  let hint = "";
  if (protectedMatch) {
    password = protectedMatch[1].trim();
    hint = (lines[1] || "").trim().match(/^Dica\s*:\s*(.*)$/i)?.[1]?.trim() || "";
    body = lines.slice(2).join("\n");
  }
  if (isProtected && !password) throw new Error(`A carta protegida não contém senha válida: ${name}`);
  const card = {
    recipient_id: recipientId,
    original_file: name,
    card_number: Number(match[3]),
    is_private: isPrivate,
    is_protected: isProtected,
    password_hint: hint.slice(0, 300),
    sent_date: (() => { const date = extractDate(body); return date ? toISO(date) : null; })(),
    body: isProtected ? null : body,
    secret_body: isProtected ? body : null
  };
  if (isProtected) Object.assign(card, await hashPassword(password));
  return card;
}

export function makeMediaCatalog(index, fileMap) {
  const items = new Map();
  const upsert = (entry) => {
    const sourcePath = normalizedPath(entry.path);
    if (!/^midia\/(?:[^/]+|misol\/[^/]+|yara\/[^/]+)$/i.test(sourcePath)) return;
    const extension = sourcePath.split(".").at(-1).toLowerCase();
    if (!mediaTypes.has(extension)) return;
    const entryKind = mediaTypes.get(extension)[0];
    items.set(keyPath(sourcePath), {
      source_path: sourcePath,
      file_name: fileNameFromPath(sourcePath),
      description: String(entry.description || ""),
      kind: entryKind,
      mime_type: mediaTypes.get(extension)[1],
      // Audience is assigned per media in the gallery after import, never from a folder name.
      visibility: "members",
      recipient_names: [],
      source_date: entry.uploadedAt || entry.modified || ""
    });
  };

  for (const type of ["fotos", "videos", "audios"]) {
    for (const entry of Array.isArray(index[type]) ? index[type] : []) upsert(entry);
  }
  // Keep legacy exclusive-index entries in the catalog, but require the administrator
  // to assign a recipient explicitly after import.
  for (const entries of Object.values(index.exclusivo || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) upsert(entry);
  }

  return [...items.values()];
}
export function findMediaIndexEntry(fileMap) {
  return fileMap.get(keyPath("data/midia-index.json")) || fileMap.get(keyPath("midia-index.json")) || null;
}

export async function processSequentially(items, processItem, onProgress = () => {}) {
  let succeeded = 0;
  const failures = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      await processItem(item, index);
      succeeded += 1;
    } catch (error) {
      failures.push({ item, index, error });
    }
    onProgress({ item, index, total: items.length, succeeded, failed: failures.length });
  }
  return { succeeded, failed: failures.length, failures };
}

async function uploadResumable(client, path, file, contentType, onProgress) {
  const { data, error } = await client.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error("A sessão administrativa expirou.");
  const configuredUrl = window.LOOPLY_CONFIG?.supabaseUrl;
  if (!configuredUrl) throw new Error("A configuração do Supabase não foi encontrada.");
  const publishableKey = window.LOOPLY_CONFIG?.publishableKey;
  if (!publishableKey) throw new Error("A chave pública do Supabase não está configurada.");
  const projectUrl = new URL(configuredUrl);
  const endpoint = projectUrl.hostname.endsWith(".supabase.co")
    ? `${projectUrl.protocol}//${projectUrl.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co")}/storage/v1/upload/resumable`
    : new URL("/storage/v1/upload/resumable", projectUrl).toString();
  const tus = await import("https://esm.sh/tus-js-client@4.3.1");
  const uploadFile = file.type === contentType ? file : new File([file], file.name, { type: contentType });
  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(uploadFile, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, apikey: publishableKey },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: "looply-media", objectName: path, contentType, cacheControl: "3600" },
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.floor((uploaded / total) * 100)),
      onSuccess: resolve
    });
    upload.start();
  });
}

export function canReuseArchiveObjectAfterUploadFailure(uploadError, verification, expectedBytes) {
  const expectedSize = Number(expectedBytes);
  return Boolean(
    uploadError
    && Number.isSafeInteger(expectedSize)
    && expectedSize > 0
    && verification?.exists === true
    && Number(verification.byteSize) === expectedSize
  );
}

async function uploadArchiveFile(client, path, file, contentType, onProgress) {
  if (file.size <= 6 * 1024 * 1024) {
    const { error } = await client.storage.from("looply-media").upload(path, file, {
      cacheControl: "3600",
      contentType,
      upsert: false
    });
    if (error) throw error;
    onProgress(100);
    return;
  }
  await uploadResumable(client, path, file, contentType, onProgress);
}

function classifyFailure(error) {
  const message = String(error?.message || error || "");
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240) || "Falha sem detalhe retornado pelo serviço.";
}

async function functionFailureMessage(error, data, fallback) {
  let detail = String(data?.error || data?.message || "").trim();
  const response = error?.context;
  if (!detail && response && typeof response.clone === "function") {
    const copy = response.clone();
    try {
      const body = await copy.json();
      detail = String(body?.error || body?.message || "").trim();
    } catch {
      try { detail = (await response.clone().text()).trim(); } catch { /* Use the status fallback below. */ }
    }
    if (!detail && Number.isFinite(Number(response.status))) detail = `HTTP ${response.status}`;
  }
  if (!detail) detail = String(error?.message || fallback || "Falha no serviço.");
  return detail.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

export function bindArchiveImport(root, client) {
  const mount = root.querySelector("[data-archive-import]");
  if (!mount) return;
  mount.innerHTML = archiveImportMarkup();
  const form = mount.querySelector("[data-archive-import-form]");
  const input = mount.querySelector("#archiveSourceFolder");
  const status = mount.querySelector("[data-archive-import-status]");
  const errorsList = mount.querySelector("[data-archive-import-errors]");

  input?.addEventListener("change", () => {
    status.textContent = input.files?.length ? `${input.files.length} arquivo(s) selecionado(s).` : "Nenhum arquivo selecionado.";
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input?.files?.length) { status.textContent = "Selecione a pasta extraída Loooply-main."; return; }
    const purpose = String(new FormData(form).get("purpose") || "").trim();
    if (purpose.length < 20 || purpose.length > 500) { status.textContent = "Descreva o motivo da importação (20 a 500 caracteres)."; return; }
    const button = form.querySelector('button[type="submit"]');
    const errors = [];
    errorsList.replaceChildren();
    errorsList.hidden = true;
    if (button) button.disabled = true;
    try {
      const fileMap = selectedRootFiles(input.files);
      const indexEntry = findMediaIndexEntry(fileMap);
      if (!indexEntry) throw new Error("Não encontrei midia-index.json. Selecione a pasta completa Loooply-main.");
      const index = JSON.parse(await indexEntry.file.text());
      const profileResult = await client.from("profiles").select("id,username").in("username", ["misol", "patati", "yara"]);
      if (profileResult.error) throw profileResult.error;
      const profileByName = new Map((profileResult.data || []).map((profile) => [profile.username, profile.id]));
      const cards = [];
      for (const entry of fileMap.values()) {
        const name = fileNameFromPath(entry.path);
        if (!/^(misol|patati|yara)carta(privada)?[0-9]+\.txt$/i.test(name)) continue;
        try {
          const card = await parseCard(entry.file, profileByName);
          if (card) cards.push(card);
        } catch (error) { errors.push(`${name}: ${String(error?.message || "falha ao ler carta")}`); }
      }
      cards.sort((a, b) => a.recipient_id.localeCompare(b.recipient_id) || Number(b.is_private) - Number(a.is_private) || a.card_number - b.card_number);
      const catalog = makeMediaCatalog(index, fileMap);
      const indexedPaths = new Set(catalog.map((item) => keyPath(item.source_path)));
      const unindexedCount = [...fileMap.values()].filter(({ path }) => {
        const normalized = normalizedPath(path);
        return /^midia\//i.test(normalized)
          && mediaTypes.has(normalized.split(".").at(-1).toLowerCase())
          && !indexedPaths.has(keyPath(normalized));
      }).length;
      const media = [];
      let missingMediaCount = 0;
      for (const item of catalog) {
        const fileEntry = fileMap.get(keyPath(item.source_path));
        if (!fileEntry) { missingMediaCount += 1; continue; }
        if (fileEntry.file.size < 1 || fileEntry.file.size > maxFileBytes) { errors.push(`${item.source_path}: tamanho fora do limite permitido; arquivo ignorado.`); continue; }
        const folder = item.source_path.slice(0, item.source_path.lastIndexOf("/"));
        const sidecarName = `MSG_${fileNameFromPath(item.source_path)}.txt`;
        const sidecar = fileMap.get(keyPath(`${folder}/${sidecarName}`));
        if (sidecar) {
          try { item.description = (await readCardText(sidecar.file)).trim() || item.description; }
          catch (error) { errors.push(`${sidecar.path}: não foi possível ler a legenda; usando a descrição do índice (${String(error?.message || "erro de leitura").slice(0, 120)}).`); }
        }
        if (item.description.length > 10_000) { errors.push(`${item.source_path}: a descrição associada excede 10.000 caracteres; arquivo ignorado.`); continue; }
        const recipientIds = item.recipient_names.map((username) => profileByName.get(username)).filter(Boolean);
        if (item.visibility === "exclusive" && recipientIds.length !== 1) { errors.push(`${item.source_path}: não foi possível associar o destinatário exclusivo; arquivo ignorado.`); continue; }
        if (item.source_date && Number.isNaN(new Date(item.source_date).valueOf())) { errors.push(`${item.source_path}: data original inválida; arquivo ignorado.`); continue; }
        media.push({
          ...item,
          storage_path: `legacy-archive/${item.source_path}`,
          byte_size: fileEntry.file.size,
          recipient_ids: recipientIds
        });
      }
      let cardsImported = 0;
      const cardResult = await processSequentially(cards, async (card, indexNumber) => {
        status.textContent = `Importando carta ${indexNumber + 1} de ${cards.length}: ${card.original_file}…`;
        const { data, error } = await client.functions.invoke("looply-admin", {
          body: { action: "import_archived_cards", resourceType: "archived_cards", purpose, cards: [card] }
        });
        if (error || !Number.isFinite(Number(data?.importedCount))) {
          throw new Error(await functionFailureMessage(error, data, "Falha ao confirmar a importação da carta."));
        }
        cardsImported += Number(data.importedCount);
      }, ({ item, index, total, succeeded, failed }) => {
        status.textContent = `Cartas: ${succeeded} de ${total} · falhas: ${failed}${item ? ` · ${item.original_file}` : ""}`;
      });
      for (const failure of cardResult.failures) {
        errors.push(`${failure.item.original_file}: ${String(failure.error?.message || "falha ao importar carta").slice(0, 240)}`);
      }

      const mediaResult = await processSequentially(media, async (item, position) => {
        const file = fileMap.get(keyPath(item.source_path))?.file;
        if (!file) {
          missingMediaCount += 1;
          throw new Error("arquivo ausente na pasta selecionada; ignorado.");
        }
        status.textContent = `Enviando mídia ${position + 1} de ${media.length}: ${item.file_name} (0%)`;
        try {
          await uploadArchiveFile(client, item.storage_path, file, item.mime_type, (percentage) => {
            status.textContent = `Enviando mídia ${position + 1} de ${media.length}: ${item.file_name} (${percentage}%)`;
          });
        } catch (uploadError) {
          const { data: verification, error: verificationError } = await client.functions.invoke("looply-admin", {
            body: { action: "verify_archive_media_upload", resourceType: "archive_media", purpose, media: item }
          });
          if (verificationError || !canReuseArchiveObjectAfterUploadFailure(uploadError, verification, item.byte_size)) {
            const detail = await functionFailureMessage(verificationError, verification, "O Storage não confirmou o arquivo.");
            throw new Error(`Upload não confirmado (${classifyFailure(uploadError)}). ${detail}`);
          }
        }
        const { data, error } = await client.functions.invoke("looply-admin", {
          body: { action: "register_archive_media", resourceType: "archive_media", purpose, media: item }
        });
        if (error || !data?.mediaId) {
          throw new Error(await functionFailureMessage(error, data, "O objeto não foi localizado no bucket privado."));
        }
      }, ({ item, index, total, succeeded, failed }) => {
        status.textContent = `Mídias registradas: ${succeeded} de ${total} · falhas: ${failed} · ${cardsImported} cartas · ${item?.file_name || ""}`;
      });
      for (const failure of mediaResult.failures) {
        errors.push(`${failure.item.source_path}: ${String(failure.error?.message || "falha ao enviar ou registrar mídia").slice(0, 240)}`);
      }

      status.textContent = `Importação concluída: ${cardsImported} de ${cards.length} cartas registradas (${cardResult.failed} falha(s)) · ${mediaResult.succeeded} de ${media.length} mídias registradas (${mediaResult.failed} falha(s)) · ${missingMediaCount} item(ns) catalogado(s) ausente(s) ignorado(s) · ${unindexedCount} arquivo(s) fora do catálogo ignorado(s). Os demais itens foram processados mesmo quando algum falhou. A importação pode ser repetida para tentar novamente.`;
      if (errors.length) {
        errorsList.hidden = false;
        for (const message of errors.slice(0, 100)) {
          const row = document.createElement("li");
          row.textContent = message;
          errorsList.append(row);
        }
      }
    } catch (error) {
      console.error("Looply archive import failed");
      status.textContent = String(error?.message || "A importação não foi concluída.");
      if (errors.length) {
        errorsList.hidden = false;
        for (const message of errors) {
          const row = document.createElement("li");
          row.textContent = message;
          errorsList.append(row);
        }
      }
    } finally {
      if (button) button.disabled = false;
    }
  });
}




