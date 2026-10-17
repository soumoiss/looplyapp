import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// These server-only RPCs are maintained in SQL migrations rather than a generated Database type.
type UntypedServiceClient = Omit<SupabaseClient<any, any, any, any, any>, "rpc"> & {
  rpc: (...args: any[]) => Promise<any>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const allowedResources = new Set([
  "posts", "music_dedications", "music_library", "profiles", "post_media", "music_comments", "conversations", "letters", "chat_messages", "archive_media", "archive_media_comments", "archived_cards", "audit"
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cardPasswordIterations = 210_000;

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function defaultKey(dictionaryName: string, legacyName: string) {
  const raw = Deno.env.get(dictionaryName);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.default) return String(parsed.default);
  }
  return Deno.env.get(legacyName) || "";
}

function decodeBase64Url(value: string) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function verifyArchivedCardPassword(password: string, saltText: string, hashText: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: decodeBase64Url(saltText), iterations: cardPasswordIterations, hash: "SHA-256" }, key, 256);
  const actual = new Uint8Array(bits);
  const expected = decodeBase64Url(hashText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

async function recordAccess(service: UntypedServiceClient, actorId: string, event: string, resourceType: string, resourceId: string | null, purpose: string, requestId: string, metadata: Record<string, unknown> = {}) {
  const { error } = await service.rpc("record_looply_admin_access", {
    p_actor_id: actorId,
    p_event: event,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_purpose: purpose,
    p_request_id: requestId,
    p_metadata: metadata
  });
  if (error) throw error;
}

async function loadResource(service: UntypedServiceClient, actorId: string, resourceType: string, resourceId: string | null, offset = 0) {
  if (resourceType === "audit") {
    const { data, error } = await service.rpc("read_looply_admin_audit", { p_actor_id: actorId, p_limit: 100 });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  if (resourceType === "archived_cards") {
    const { data, error } = await service.rpc("read_looply_admin_archived_cards", {
      p_actor_id: actorId,
      p_card_id: resourceId,
      p_limit: resourceId ? 1 : 100
    });
    if (error) throw error;
    const cards = Array.isArray(data) ? data : [];
    const recipientIds = [...new Set(cards.map((card: any) => String(card.recipient_id || "")).filter(Boolean))];
    if (!recipientIds.length) return cards;
    const { data: profiles, error: profilesError } = await service.from("profiles").select("id,username,display_name").in("id", recipientIds);
    if (profilesError) throw profilesError;
    const recipients = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
    return cards.map((card: any) => ({ ...card, recipient: recipients.get(card.recipient_id) || null }));
  }

  if (resourceType === "archive_media") {
    let query = service.from("archive_media")
      .select("id,source_path,file_name,description,storage_path,kind,mime_type,byte_size,visibility,comment_access,source_date,created_at,recipients:archive_media_recipients(user_id,profile:profiles!archive_media_recipients_user_id_fkey(username,display_name)),commenters:archive_media_commenters(user_id,profile:profiles!archive_media_commenters_user_id_fkey(username,display_name))")
      .order("source_path");
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query.range(offset, offset + 99);
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "archive_media_comments") {
    let query = service.from("archive_media_comments")
      .select("id,media_id,author_id,body,audience,created_at,author:profiles!archive_media_comments_author_id_fkey(username,display_name),media:archive_media!archive_media_comments_media_id_fkey(id,source_path,file_name,visibility)")
      .order("created_at", { ascending: false }).limit(resourceId ? 1 : 100);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "posts") {
    let query = service.from("posts")
      .select("id,author_id,body,visibility,created_at,updated_at,author:profiles!posts_author_id_fkey(id,username,display_name,bio,profile_visibility),comments(id,author_id,parent_comment_id,body,created_at,author:profiles!comments_author_id_fkey(id,username,display_name)),media:post_media(id,storage_path,kind,mime_type,byte_size,alt_text,created_at)")
      .order("created_at", { ascending: false }).limit(resourceId ? 1 : 30);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "music_dedications") {
    let query = service.from("music_dedications")
      .select("id,sender_id,recipient_id,title,artist,listen_url,dedication_note,created_at,sender:profiles!music_dedications_sender_id_fkey(id,username,display_name),recipient:profiles!music_dedications_recipient_id_fkey(id,username,display_name),comments:music_comments(id,author_id,body,visibility,created_at,author:profiles!music_comments_author_id_fkey(id,username,display_name))")
      .order("created_at", { ascending: false }).limit(resourceId ? 1 : 30);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "music_library") {
    let query = service.from("music_library")
      .select("id,owner_id,title,artist,listen_url,note,created_at,updated_at,owner:profiles!music_library_owner_id_fkey(id,username,display_name)")
      .order("created_at", { ascending: false }).limit(resourceId ? 1 : 50);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "profiles") {
    let query = service.from("profiles")
      .select("id,username,display_name,bio,profile_visibility,created_at,updated_at")
      .order("username").range(offset, offset + 99);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "post_media") {
    let query = service.from("post_media")
      .select("id,post_id,storage_path,kind,mime_type,byte_size,alt_text,created_at,post:posts(id,author_id,body,visibility,created_at)")
      .order("created_at", { ascending: false }).limit(resourceId ? 1 : 50);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "letters") {
    let query = service.from("letters")
      .select("id,conversation_id,sender_id,recipient_id,subject,initial_message_id,created_at,sender:profiles!letters_sender_id_fkey(id,username,display_name),recipient:profiles!letters_recipient_id_fkey(id,username,display_name),initial_message:chat_messages!letters_initial_message_fk(id,body,created_at)")
      .order("created_at", { ascending: false }).limit(resourceId ? 1 : 30);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "conversations") {
    let query = service.from("conversations")
      .select("id,kind,subject,created_by,created_at,updated_at,participants:conversation_participants(user_id,joined_at,profile:profiles!conversation_participants_user_id_fkey(id,username,display_name))")
      .order("updated_at", { ascending: false }).limit(resourceId ? 1 : 40);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  if (resourceType === "chat_messages") {
    let query = service.from("chat_messages")
      .select("id,conversation_id,sender_id,body,created_at,author:profiles!chat_messages_sender_id_fkey(id,username,display_name),conversation:conversations!chat_messages_conversation_id_fkey(id,kind,subject),media:chat_media!chat_media_message_fk(id,storage_path,mime_type,file_name,byte_size,created_at)")
      .order("created_at", { ascending: false }).limit(resourceId ? 1 : 60);
    if (resourceId) query = query.eq("id", resourceId);
    const result = resourceId ? await query.maybeSingle() : await query;
    if (result.error) throw result.error;
    return result.data ? (Array.isArray(result.data) ? result.data : [result.data]) : [];
  }

  return null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Use POST." });

  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return respond(401, { error: "Sign in is required." });

  try {
    const projectUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = defaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = defaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!projectUrl || !publishableKey || !secretKey) throw new Error("Required Supabase function environment is missing.");

    const userClient = createClient(projectUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } }
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return respond(401, { error: "The session is invalid or expired." });

    const service = createClient(projectUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as UntypedServiceClient;
    const payload = await request.json().catch(() => ({}));
    const requestId = crypto.randomUUID();

    if (payload.action === "unlock_archived_card") {
      const cardId = String(payload.cardId || "");
      const password = String(payload.password || "");
      if (!uuidPattern.test(cardId) || password.length < 1 || password.length > 256) {
        return respond(400, { error: "invalid_card_unlock" });
      }
      const { data: secret, error: secretError } = await service.rpc("read_looply_archived_card_secret", {
        p_actor_id: authData.user.id,
        p_card_id: cardId
      });
      if (secretError || !secret) return respond(403, { error: "card_unavailable" });
      const { data: unlockAllowed, error: attemptError } = await service.rpc("consume_looply_archived_card_unlock", {
        p_actor_id: authData.user.id,
        p_card_id: cardId
      });
      if (attemptError) throw attemptError;
      if (unlockAllowed !== true) return respond(429, { error: "too_many_unlock_attempts" });
      if (!await verifyArchivedCardPassword(password, secret.password_salt, secret.password_hash)) {
        return respond(200, { error: "incorrect_password" });
      }
      const { error: resetError } = await service.rpc("reset_looply_archived_card_unlock", {
        p_actor_id: authData.user.id,
        p_card_id: cardId
      });
      if (resetError) throw resetError;
      return respond(200, { body: secret.body });
    }

    const requestedType = String(payload.resourceType || "");
    const resourceType = allowedResources.has(requestedType) ? requestedType : "posts";
    const { data: isAdmin, error: membershipError } = await service.rpc("is_looply_admin", { p_user_id: authData.user.id });
    if (membershipError) throw membershipError;

    if (requestedType === "status") return respond(200, { isAdmin: isAdmin === true });
    if (isAdmin !== true) {
      await recordAccess(service, authData.user.id, "access_denied", resourceType, null,
        "Attempted administrative access without a verified membership.", requestId);
      return respond(403, { error: "Administrator membership is required." });
    }
    if (!allowedResources.has(requestedType)) return respond(400, { error: "Unsupported administrative resource." });

    const purpose = String(payload.purpose || "").trim();
    if (purpose.length < 20 || purpose.length > 500) {
      await recordAccess(service, authData.user.id, "access_denied", resourceType, null,
        "Administrative read request was rejected because its purpose was missing or too short.", requestId);
      return respond(400, { error: "Describe the administrative purpose in at least 20 characters." });
    }
    const resourceId = payload.resourceId == null || payload.resourceId === "" ? null : String(payload.resourceId);
    if (resourceId && !uuidPattern.test(resourceId)) return respond(400, { error: "Resource ID must be a UUID." });
    const offset = Number(payload.offset ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) return respond(400, { error: "Archive media position is invalid." });

    if (payload.action === "set_archive_media_access") {
      const mediaId = String(payload.mediaId || "");
      const visibility = String(payload.visibility || "");
      const commentAccess = String(payload.commentAccess || "");
      const viewerIds = Array.isArray(payload.viewerIds) ? payload.viewerIds.map(String) : [];
      const commenterIds = Array.isArray(payload.commenterIds) ? payload.commenterIds.map(String) : [];
      if (requestedType !== "archive_media" || !uuidPattern.test(mediaId)
          || !["members", "exclusive"].includes(visibility)
          || !["viewers", "selected", "disabled"].includes(commentAccess)
          || viewerIds.length > 100 || commenterIds.length > 100
          || [...viewerIds, ...commenterIds].some((id) => !uuidPattern.test(id))) {
        return respond(400, { error: "invalid_archive_media_access" });
      }
      await recordAccess(service, authData.user.id, "write_requested", "archive_media", mediaId, purpose, requestId,
        { action: "set_media_access", visibility, viewer_count: viewerIds.length, comment_access: commentAccess, commenter_count: commenterIds.length });
      try {
        const { error } = await userClient.rpc("set_gallery_media_permissions", {
          p_source: "archive",
          p_media_id: mediaId,
          p_visibility: visibility,
          p_comment_access: commentAccess,
          p_viewer_ids: viewerIds,
          p_commenter_ids: commenterIds
        });
        if (error) throw error;
        await recordAccess(service, authData.user.id, "write_completed", "archive_media", mediaId, purpose, requestId,
          { action: "set_media_access", visibility, viewer_count: viewerIds.length, comment_access: commentAccess, commenter_count: commenterIds.length });
        return respond(200, { requestId, mediaId, visibility, viewerIds, commentAccess, commenterIds });
      } catch (error) {
        await recordAccess(service, authData.user.id, "write_failed", "archive_media", mediaId, purpose, requestId,
          { action: "set_media_access", reason: errorMessage(error, "Archive media access update failed.").slice(0, 200) });
        throw error;
      }
    }

    if (payload.action === "import_archived_cards") {
      const cards = payload.cards;
      if (!Array.isArray(cards) || cards.length < 1 || cards.length > 25) {
        return respond(400, { error: "Archive card batches must contain 1 to 25 cards." });
      }
      try {
        const { data, error } = await service.rpc("import_looply_archived_cards", {
          p_actor_id: authData.user.id,
          p_purpose: purpose,
          p_request_id: requestId,
          p_cards: cards
        });
        if (error) throw error;
        return respond(200, { requestId, importedCount: Number(data || 0) });
      } catch (error) {
        await recordAccess(service, authData.user.id, "write_failed", "archived_cards", null, purpose, requestId,
          { reason: errorMessage(error, "Card import failed.").slice(0, 200) });
        throw error;
      }
    }

    if (payload.action === "verify_archive_media_upload") {
      const media = payload.media && typeof payload.media === "object" ? payload.media : {};
      const storagePath = String(media.storage_path || "");
      const expectedSize = Number(media.byte_size);
      if (!/^legacy-archive\/midia\/(?:[^/]+|misol\/[^/]+|yara\/[^/]+)$/i.test(storagePath)
          || !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > 209_715_200) {
        return respond(400, { error: "invalid_archive_media_upload_check" });
      }

      await recordAccess(service, authData.user.id, "read_requested", "archive_media", null, purpose, requestId,
        { action: "verify_upload", storage_path: storagePath });
      try {
        const splitAt = storagePath.lastIndexOf("/");
        const folder = storagePath.slice(0, splitAt);
        const fileName = storagePath.slice(splitAt + 1);
        const { data: objects, error } = await service.storage.from("looply-media").list(folder, { search: fileName, limit: 100 });
        if (error) throw error;
        const object = (objects || []).find((entry: any) => entry.name === fileName);
        const byteSize = object ? Number(object.metadata?.size || 0) : null;
        const exists = Boolean(object);
        await recordAccess(service, authData.user.id, "read_completed", "archive_media", null, purpose, requestId,
          { action: "verify_upload", exists, byte_size: byteSize, byte_size_matches: exists && byteSize === expectedSize });
        return respond(200, { requestId, exists, byteSize });
      } catch (error) {
        await recordAccess(service, authData.user.id, "read_failed", "archive_media", null, purpose, requestId,
          { action: "verify_upload", reason: errorMessage(error, "Storage upload check failed.").slice(0, 200) });
        throw error;
      }
    }

    if (payload.action === "register_archive_media") {
      const media = payload.media && typeof payload.media === "object" ? payload.media : {};
      const storagePath = String(media.storage_path || "");
      if (!/^legacy-archive\/midia\/(?:[^/]+|misol\/[^/]+|yara\/[^/]+)$/i.test(storagePath)) {
        return respond(400, { error: "invalid_archive_media_path" });
      }
      try {
        const splitAt = storagePath.lastIndexOf("/");
        const folder = storagePath.slice(0, splitAt);
        const fileName = storagePath.slice(splitAt + 1);
        const { data: objects, error: storageError } = await service.storage.from("looply-media").list(folder, { search: fileName, limit: 100 });
        if (storageError) throw storageError;
        const object = (objects || []).find((entry) => entry.name === fileName);
        if (!object) throw new Error("Uploaded object was not found in the private bucket.");
        if (Number(object.metadata?.size || 0) !== Number(media.byte_size)) throw new Error("Uploaded object size does not match its catalog entry.");
        const { data, error } = await service.rpc("import_looply_archive_media", {
          p_actor_id: authData.user.id,
          p_purpose: purpose,
          p_request_id: requestId,
          p_item: media
        });
        if (error) throw error;
        return respond(200, { requestId, mediaId: data });
      } catch (error) {
        await recordAccess(service, authData.user.id, "write_failed", "archive_media", null, purpose, requestId,
          { reason: errorMessage(error, "Media registration failed.").slice(0, 200) });
        throw error;
      }
    }

    if (payload.action === "comment_archive_media") {
      const mediaId = String(payload.mediaId || "");
      const body = String(payload.body || "").trim();
      if (!uuidPattern.test(mediaId) || body.length < 1 || body.length > 2000) {
        return respond(400, { error: "A media ID and a comment of up to 2,000 characters are required." });
      }
      await recordAccess(service, authData.user.id, "write_requested", "archive_media_comments", mediaId, purpose, requestId,
        { action: "admin_comment" });
      try {
        const { data: media, error: mediaError } = await service.from("archive_media").select("id").eq("id", mediaId).maybeSingle();
        if (mediaError) throw mediaError;
        if (!media) throw new Error("Media is no longer available.");
        const { data: comment, error: commentError } = await service.from("archive_media_comments")
          .insert({ media_id: mediaId, author_id: authData.user.id, body, audience: "media_viewers" })
          .select("id,media_id,author_id,body,audience,created_at").single();
        if (commentError) throw commentError;
        await recordAccess(service, authData.user.id, "write_completed", "archive_media_comments", comment.id, purpose, requestId,
          { action: "admin_comment", media_id: mediaId });
        return respond(200, { requestId, comment });
      } catch (error) {
        await recordAccess(service, authData.user.id, "write_failed", "archive_media_comments", mediaId, purpose, requestId,
          { action: "admin_comment", reason: errorMessage(error, "Media comment failed.").slice(0, 200) });
        throw error;
      }
    }

    if (payload.action === "comment") {
      const postId = String(payload.postId || "");
      const body = String(payload.body || "").trim();
      if (!uuidPattern.test(postId) || body.length < 1 || body.length > 2000) {
        return respond(400, { error: "A post ID and a comment of up to 2,000 characters are required." });
      }
      await recordAccess(service, authData.user.id, "write_requested", "posts", postId, purpose, requestId, { action: "admin_comment" });
      try {
        const { data: post, error: postError } = await service.from("posts").select("id").eq("id", postId).maybeSingle();
        if (postError) throw postError;
        if (!post) throw new Error("Post is no longer available.");
        const { data: comment, error: commentError } = await service.from("comments")
          .insert({ post_id: postId, author_id: authData.user.id, body })
          .select("id,post_id,author_id,body,created_at").single();
        if (commentError) throw commentError;
        await recordAccess(service, authData.user.id, "write_completed", "posts", postId, purpose, requestId,
          { action: "admin_comment", comment_id: comment.id });
        return respond(200, { requestId, comment });
      } catch (error) {
        await recordAccess(service, authData.user.id, "write_failed", "posts", postId, purpose, requestId,
          { action: "admin_comment", reason: errorMessage(error, "Comment failed.").slice(0, 200) });
        throw error;
      }
    }

    await recordAccess(service, authData.user.id, "read_requested", requestedType, resourceId, purpose, requestId);
    try {
      let data = await loadResource(service, authData.user.id, requestedType, resourceId, offset);
      if (data === null) {
        await recordAccess(service, authData.user.id, "read_failed", requestedType, resourceId, purpose, requestId, { reason: "resource_not_enabled" });
        return respond(409, { error: "This resource is not available in the current stage." });
      }

      const rows = Array.isArray(data) ? data : [];
      const postMediaRows = rows.flatMap((row: any) => Array.isArray(row.media)
        ? row.media.map((media: any) => ({ ...media, bucket_id: "looply-media", audit_resource_type: "post_media" }))
        : requestedType === "post_media" ? [{ ...row, bucket_id: "looply-media", audit_resource_type: "post_media" }]
          : requestedType === "archive_media" ? [{ ...row, bucket_id: "looply-media", audit_resource_type: "archive_media" }] : []);
      const chatMediaRows = rows.flatMap((row: any) => Array.isArray(row.media) ? row.media.map((media: any) => ({ ...media, bucket_id: "looply-chat" })) : []);
      const mediaRows = [...postMediaRows, ...chatMediaRows];
      if (mediaRows.length) {
        const mediaAudit = await Promise.all(mediaRows.map((media: any) =>
          recordAccess(service, authData.user.id, "read_completed", media.bucket_id === "looply-chat" ? "chat_media" : media.audit_resource_type || "post_media", media.id, purpose, requestId, { delivery: "signed_url" })
        ));
        void mediaAudit;
        for (const bucketId of ["looply-media", "looply-chat"]) {
          const bucketMedia = mediaRows.filter((media: any) => media.bucket_id === bucketId);
          if (!bucketMedia.length) continue;
          const expiresIn = requestedType === "archive_media" ? 300 : 1800;
          const { data: signed, error: signedError } = await service.storage.from(bucketId).createSignedUrls(bucketMedia.map((media: any) => media.storage_path), expiresIn);
          if (signedError) throw signedError;
          bucketMedia.forEach((media: any, index: number) => {
            const signedUrl = signed?.[index]?.signedUrl || null;
            media.signed_url = signedUrl;
            if (requestedType === "archive_media") {
              const archiveRow = rows.find((row: any) => row.id === media.id);
              if (archiveRow) archiveRow.signed_url = signedUrl;
            }
          });
        }
      }

      await recordAccess(service, authData.user.id, "read_completed", requestedType,
        resourceId, purpose, requestId, { result_count: rows.length });
      return respond(200, { requestId, resourceType: requestedType, data });
    } catch (error) {
      await recordAccess(service, authData.user.id, "read_failed", requestedType, resourceId, purpose, requestId,
        { message: errorMessage(error, "Administrative read failed.").slice(0, 200) });
      throw error;
    }
  } catch (error) {
    console.error("Looply admin function failed", error);
    return respond(500, { error: "Administrative request could not be completed." });
  }
});





