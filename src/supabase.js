import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const config = window.LOOPLY_CONFIG || {};
const projectUrl = String(config.supabaseUrl || "").trim();
const publishableKey = String(config.publishableKey || "").trim();

function isAllowedProjectUrl(value) {
  try {
    const parsed = new URL(value);
    const isSupabaseHost = parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
    const isLocalHost = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    return isSupabaseHost || isLocalHost;
  } catch {
    return false;
  }
}

export const isSupabaseConfigured =
  isAllowedProjectUrl(projectUrl) &&
  publishableKey.startsWith("sb_publishable_") &&
  publishableKey.length > 24;

export const supabase = isSupabaseConfigured
  ? createClient(projectUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null;

