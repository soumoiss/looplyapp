import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });

  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return respond(401, { error: "unauthorized" });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !anonKey || !serviceKey) {
    console.error("Story cleanup is missing server-side Supabase configuration.");
    return respond(500, { error: "server_configuration_error" });
  }

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(match[1]);
  if (authError || !authData.user) return respond(401, { error: "unauthorized" });

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const cutoff = new Date().toISOString();
  const { data: expired, error: selectError } = await service.from("stories")
    .select("id")
    .lt("expires_at", cutoff)
    .order("expires_at", { ascending: true })
    .limit(100);
  if (selectError) {
    console.error("Story cleanup could not list expired rows.", selectError);
    return respond(500, { error: "cleanup_failed" });
  }
  const storyIds = (expired || []).map((story: { id: string }) => story.id);
  if (!storyIds.length) return respond(200, { deletedStories: 0, deletedFiles: 0, moreMayRemain: false });

  const { data: media, error: mediaError } = await service.from("story_media")
    .select("storage_path")
    .in("story_id", storyIds);
  if (mediaError) {
    console.error("Story cleanup could not list expired media.", mediaError);
    return respond(500, { error: "cleanup_failed" });
  }

  const paths = (media || []).map((item: { storage_path: string }) => item.storage_path).filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await service.storage.from("looply-media").remove(paths);
    if (storageError) {
      console.error("Story cleanup could not remove expired files.", storageError);
      return respond(500, { error: "cleanup_failed" });
    }
  }

  const { data: deleted, error: deleteError } = await service.from("stories")
    .delete()
    .in("id", storyIds)
    .lt("expires_at", cutoff)
    .select("id");
  if (deleteError) {
    console.error("Story cleanup could not remove expired rows.", deleteError);
    return respond(500, { error: "cleanup_failed" });
  }

  return respond(200, {
    deletedStories: deleted?.length || 0,
    deletedFiles: paths.length,
    moreMayRemain: storyIds.length === 100
  });
});
