import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type UntypedServiceClient = Omit<SupabaseClient<any, any, any, any, any>, "rpc"> & {
  rpc: (...args: any[]) => Promise<any>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { errorCode: "method_not_allowed" });

  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return respond(401, { errorCode: "sign_in_required" });

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
    if (authError || !authData.user) return respond(401, { errorCode: "session_invalid" });

    const payload = await request.json().catch(() => ({}));
    const service = createClient(projectUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as UntypedServiceClient;
    if (payload.action === "create_direct") {
      const targetId = String(payload.targetId || "");
      if (!uuidPattern.test(targetId)) return respond(400, { errorCode: "invalid_target" });
      const { data, error } = await service.rpc("create_direct_conversation", {
        p_actor_id: authData.user.id,
        p_target_id: targetId
      });
      if (error) {
        if (error.code === "42501") return respond(200, { errorCode: "profile_unavailable" });
        console.error("Looply conversation creation failed", error);
        return respond(500, { errorCode: "conversation_unavailable" });
      }
      return respond(200, { conversationId: data });
    }

    if (payload.action === "create_group") {
      const subject = String(payload.subject || "").trim();
      const targetIds = Array.isArray(payload.targetIds) ? payload.targetIds.map((id: unknown) => String(id)) : [];
      if (!subject || subject.length > 120 || targetIds.length < 2 || targetIds.length > 49
          || new Set(targetIds).size !== targetIds.length || targetIds.some((id: string) => !uuidPattern.test(id) || id === authData.user.id)) {
        return respond(400, { errorCode: "invalid_group" });
      }
      const { data, error } = await service.rpc("create_group_conversation", {
        p_actor_id: authData.user.id,
        p_target_ids: targetIds,
        p_subject: subject
      });
      if (error) {
        if (error.code === "42501") return respond(200, { errorCode: "profile_unavailable" });
        if (error.code === "22023") return respond(400, { errorCode: "invalid_group" });
        console.error("Looply group creation failed", error);
        return respond(500, { errorCode: "group_unavailable" });
      }
      return respond(200, { conversationId: data });
    }

    if (payload.action === "create_letter") {
      const subject = String(payload.subject || "").trim();
      const body = String(payload.body || "").trim();
      if (!subject || subject.length > 120 || !body || body.length > 5000) return respond(400, { errorCode: "invalid_letter" });
      const { data, error } = await service.rpc("create_admin_letter", {
        p_actor_id: authData.user.id,
        p_subject: subject,
        p_body: body
      });
      if (error) {
        if (error.code === "55000") return respond(200, { errorCode: "peixinho_admin_not_ready" });
        if (error.code === "22023") return respond(400, { errorCode: "invalid_letter" });
        console.error("Looply letter creation failed", error);
        return respond(500, { errorCode: "letter_unavailable" });
      }
      return respond(200, { conversationId: data });
    }

    return respond(400, { errorCode: "unsupported_action" });
  } catch (error) {
    console.error("Looply chat function failed", error);
    return respond(500, { errorCode: "chat_unavailable" });
  }
});
