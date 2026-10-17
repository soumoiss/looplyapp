const allowedPlaylists = new Set([
  "PLUZFdmgmipvI",
  "PLCn4CAsA_tiM",
  "PLE0tcB0gaSzM",
  "PLD5PXwJcU-Sg",
  "PLMeQ_QyqhY7s"
]);
const youtubeEndpoint = "https://www.googleapis.com/youtube/v3/playlistItems";
const allowedOrigins = new Set([
  "https://soumoiss.github.io",
  "https://looply-mu.vercel.app",
  "https://looply-git-codex-looply-foundation-mpsant0s-projects.vercel.app"
]);

function applyCors(request, response) {
  const origin = String(request.headers?.origin || request.headers?.Origin || "");
  response.setHeader("vary", "Origin, Authorization");
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization, content-type");
  response.setHeader("access-control-max-age", "600");
  return true;
}

function respond(response, status, body) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("vary", "Origin, Authorization");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(body));
}

function bearerToken(request) {
  const value = String(request.headers?.authorization || request.headers?.Authorization || "");
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match ? match[1] : "";
}

function supabaseOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.endsWith(".supabase.co")) return "";
    return url.origin;
  } catch {
    return "";
  }
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    let data = null;
    try { data = await response.json(); } catch { /* A non-JSON response is handled by its status. */ }
    return { response, data };
  } catch (error) {
    return { failure: error?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timeout);
  }
}

function safeReason(data) {
  const reason = String(data?.error?.errors?.[0]?.reason || "");
  return /^[A-Za-z0-9_-]{1,80}$/.test(reason) ? reason : "";
}

export async function handleYouTubePlaylist(request, response, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!applyCors(request, response)) {
    return respond(response, 403, { error: "youtube_origin_not_allowed" });
  }
  if (request.method === "OPTIONS") {
    response.setHeader("allow", "GET, OPTIONS");
    response.statusCode = 204;
    response.end("");
    return;
  }
  if (request.method !== "GET") {
    response.setHeader("allow", "GET, OPTIONS");
    return respond(response, 405, { error: "method_not_allowed" });
  }

  const token = bearerToken(request);
  if (!token) return respond(response, 401, { error: "youtube_unauthorized" });

  const origin = supabaseOrigin(env.LOOPLY_SUPABASE_URL);
  const publishableKey = String(env.LOOPLY_SUPABASE_PUBLISHABLE_KEY || "").trim();
  const youtubeKey = String(env.LOOPLY_YOUTUBE_API_KEY || "").trim();
  if (!origin || !publishableKey || !youtubeKey) {
    return respond(response, 503, { error: "youtube_service_not_configured" });
  }

  const auth = await fetchJson(fetchImpl, origin + "/auth/v1/user", {
    method: "GET",
    headers: {
      accept: "application/json",
      apikey: publishableKey,
      authorization: "Bearer " + token
    }
  }, 3000);
  if (auth.failure) {
    return respond(response, auth.failure === "timeout" ? 504 : 503, { error: "youtube_auth_service_unavailable" });
  }
  if (!auth.response.ok || !auth.data || typeof auth.data.id !== "string") {
    const status = auth.response.status >= 500 ? 503 : 401;
    return respond(response, status, { error: status === 401 ? "youtube_unauthorized" : "youtube_auth_service_unavailable" });
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url || "/api/youtube-playlist", "https://looply.invalid");
  } catch {
    return respond(response, 400, { error: "invalid_request" });
  }
  const playlistId = String(requestUrl.searchParams.get("playlistId") || "");
  if (!allowedPlaylists.has(playlistId)) {
    return respond(response, 400, { error: "youtube_playlist_not_allowed" });
  }
  const pageToken = String(requestUrl.searchParams.get("pageToken") || "");
  if (pageToken.length > 2048 || /[\u0000-\u001f\u007f]/.test(pageToken)) {
    return respond(response, 400, { error: "invalid_page_token" });
  }

  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId,
    maxResults: "50",
    key: youtubeKey
  });
  if (pageToken) params.set("pageToken", pageToken);

  const upstream = await fetchJson(fetchImpl, youtubeEndpoint + "?" + params.toString(), {
    method: "GET",
    headers: { accept: "application/json" }
  }, 5000);
  if (upstream.failure) {
    return respond(response, upstream.failure === "timeout" ? 504 : 502, {
      error: upstream.failure === "timeout" ? "youtube_upstream_timeout" : "youtube_upstream_unavailable"
    });
  }
  if (!upstream.response.ok) {
    const reason = safeReason(upstream.data);
    const error = ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason)
      ? "youtube_quota_exceeded"
      : ["keyInvalid", "ipRefererBlocked", "refererBlocked", "forbidden"].includes(reason)
        ? "youtube_key_rejected"
        : ["accessNotConfigured", "youtubeSignupRequired"].includes(reason)
          ? "youtube_api_disabled"
          : "youtube_api_error";
    return respond(response, 502, { error, reason, upstreamStatus: upstream.response.status });
  }

  const items = [];
  for (const item of Array.isArray(upstream.data?.items) ? upstream.data.items : []) {
    const videoId = String(item?.snippet?.resourceId?.videoId || item?.contentDetails?.videoId || "");
    const title = String(item?.snippet?.title || "").trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !title || title === "Private video" || title === "Deleted video") continue;
    items.push({
      videoId,
      title,
      channel: String(item?.snippet?.videoOwnerChannelTitle || item?.snippet?.channelTitle || ""),
      position: Number.isInteger(item?.snippet?.position) ? item.snippet.position : items.length,
      thumbnail: "https://i.ytimg.com/vi/" + encodeURIComponent(videoId) + "/hqdefault.jpg"
    });
  }
  const nextPageToken = String(upstream.data?.nextPageToken || "");
  return respond(response, 200, {
    items,
    nextPageToken: nextPageToken.length <= 2048 ? nextPageToken : ""
  });
}

export default function handler(request, response, options = {}) {
  return handleYouTubePlaylist(request, response, options);
}
