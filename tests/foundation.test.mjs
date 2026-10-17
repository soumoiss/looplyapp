import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { canReuseArchiveObjectAfterUploadFailure, processSequentially } from "../src/archive-import.js";
import { groupActiveStories, storiesMarkup, storyMediaUrlTtl } from "../src/stories.js";
import { profileAreaMarkup } from "../src/profiles.js";
import { fetchPlaylistItems } from "../src/youtube-playlist.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(projectRoot, path), "utf8");

test("the browser client uses an exact Supabase JS version and a publishable key", async () => {
  const [client, config] = await Promise.all([read("src/supabase.js"), read("config.js")]);
  assert.match(client, /@supabase\/supabase-js@2\.117\.3/);
  assert.match(client, /sb_publishable_/);
  assert.doesNotMatch(client + config, /service_role|sb_secret_/i);
  assert.match(client, /persistSession:\s*true/);
});

test("the initial schema protects profile rows and never derives administrator access from metadata", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const foundationName = names.find((name) => name.endsWith("_foundation_profiles_admin.sql"));
  const hardeningName = names.find((name) => name.endsWith("_harden_admin_memberships.sql"));
  assert.ok(foundationName);
  assert.ok(hardeningName);
  const [sql, hardening] = await Promise.all([
    read("supabase/migrations/" + foundationName),
    read("supabase/migrations/" + hardeningName)
  ]);
  assert.match(sql, /alter table public\.profiles enable row level security/i);
  assert.match(sql, /profiles_update_self[\s\S]*?with check \(id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /profiles_public_read[\s\S]*?to anon[\s\S]*?profile_visibility = 'public'/i);
  assert.match(sql, /revoke all on table private\.admin_users from public, anon, authenticated/i);
  assert.match(sql, /private\.is_admin\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  assert.match(sql, /raw_user_meta_data ->> 'username'/i);
  assert.doesNotMatch(sql, /raw_user_meta_data[^;]*(?:role|admin)/i);
  assert.doesNotMatch(sql, /insert into private\.admin_users/i);
  assert.match(hardening, /admin_users_deny_direct_access[\s\S]*?using \(false\)[\s\S]*?with check \(false\)/i);
});

test("only four owner-created usernames can have profiles, then remain immutable", async () => {
  const [identity, login, profiles, allowlistMigration, immutableMigration, authProfileMigration] = await Promise.all([
    read("src/identities.js"),
    read("src/login.js"),
    read("src/profiles.js"),
    read("supabase/migrations/20261016001621_lock_looply_usernames.sql"),
    read("supabase/migrations/20261016002713_immutable_usernames.sql"),
    read("supabase/migrations/20261016023922_admin_created_auth_profiles.sql")
  ]);
  for (const username of ["patati", "misol", "yara", "peixinho"]) {
    assert.match(identity, new RegExp(`\\b${username}\\b`));
    assert.match(allowlistMigration, new RegExp(`'${username}'`));
  }
  assert.match(login, /emailForUsername\(username\)/);
  assert.match(identity, /loooply\.app/);
  assert.match(authProfileMigration, /split_part\(coalesce\(new\.email, ''\), '@', 1\)/i);
  assert.match(authProfileMigration, /@loooply\\\.app\$/i);
  assert.doesNotMatch(authProfileMigration, /raw_user_meta_data ->> 'username'/i);
  assert.match(authProfileMigration, /requested_username not in \('patati', 'misol', 'yara', 'peixinho'\)/i);
  assert.match(authProfileMigration, /when 'peixinho' then 'Peixinho'/i);
  assert.match(allowlistMigration, /profiles_username_allowlist/);
  assert.doesNotMatch(profiles, /Seu username confirmado não pode ser alterado/);
  assert.doesNotMatch(profiles, /update\(\{ username/);
  assert.match(immutableMigration, /revoke update \(username\) on table public\.profiles from authenticated/i);
  assert.match(immutableMigration, /profiles_prevent_username_change/);
  assert.match(immutableMigration, /new\.username is distinct from old\.username/i);
});

test("the interface supports only Auth sign-in and never stores browser credentials", async () => {
  const [login, client] = await Promise.all([read("src/login.js"), read("src/supabase.js")]);
  assert.doesNotMatch(login + client, /localStorage\.(?:getItem|setItem)\(["'](?:username|password|isLoggedIn)/i);
  assert.doesNotMatch(login + client, /(?:initialPassword|seedPassword|password\s*[:=]\s*["'][^"']{8,}["'])/i);
  assert.match(login, /signInWithPassword/);
  assert.doesNotMatch(login, /supabase\.auth\.signUp|toggle-auth|Criar conta|Criar minha conta/);
  assert.match(login, /emailForUsername\(username\)/);
});

test("separate pages keep the original login, navigation, five themes, and responsive layout", async () => {
  const [login, home, gallery, music, chat, profile, admin, css, theme, readme] = await Promise.all([
    read("login.html"), read("home.html"), read("galeria.html"), read("musicas.html"),
    read("chat.html"), read("perfil.html"), read("admin.html"), read("styles.css"),
    read("src/theme.js"), read("README.md")
  ]);
  for (const theme of ["lilas", "noite", "oceano", "rosa", "floresta"]) {
    assert.match(theme, new RegExp("\\b" + theme + "\\b"));
  }
  assert.match(login, /Quem és\?/);
  assert.match(login, /código secreto/);
  assert.match(login, /Avante!/);
  for (const page of [home, gallery, music, chat, profile, admin]) {
    assert.match(page, /data-site-header/);
    assert.match(page, /id="pageContent"/);
    assert.match(page, /assets\/js\//);
  }
  assert.match(home, /home\.js/);
  assert.match(gallery, /gallery\.js/);
  assert.match(music, /music\.js/);
  assert.match(chat, /chat\.js/);
  assert.match(profile, /profile\.js/);
  assert.match(admin, /admin\.js/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(readme, /supabase\/migrations/);
});

test("account playlists play tracks in an in-app dialog and never link out to YouTube", async () => {
  const [playlists, musicPage] = await Promise.all([read("src/youtube-playlist.js"), read("musicas.html")]);
  assert.match(playlists, /peixinho:\s*"PLD5PXwJcU-Sg"/);
  assert.match(playlists, /PLUZFdmgmipvI/);
  assert.match(playlists, /PLCn4CAsA_tiM/);
  assert.match(playlists, /PLE0tcB0gaSzM/);
  assert.match(playlists, /youtube-nocookie\.com\/embed\/videoseries/);
  assert.match(playlists, /<dialog[^>]*data-youtube-track-dialog/);
  assert.match(playlists, /dialog\.showModal\(\)/);
  assert.match(playlists, /dialogPlayer\.removeAttribute\("src"\)/);
  assert.match(playlists, /youtube-nocookie\.com\/embed\/\$\{encodeURIComponent\(videoId\)\}/);
  assert.doesNotMatch(playlists, /youtube\.com\/playlist\?list=|Abrir no YouTube|target="_blank"/i);
  assert.match(playlists, /lista pesquisável ainda não está configurada no servidor/);
  assert.match(playlists, /data-youtube-retry/);
  assert.match(playlists, /youtube-playlist-timeout/);
  assert.match(playlists, /playlistCachePrefix/);
  assert.match(playlists, /authorization: "Bearer " \+ accessToken/);
  assert.match(playlists, /playlistApiEndpoint = "\/api\/youtube-playlist"/);
  assert.match(musicPage, /assets\/js\/music\.js/);
  assert.doesNotMatch(playlists, /AIza[\w-]{20,}/);
});

test("the removed account is absent from active frontend code and page copy", async () => {
  const files = ["src/identities.js", "src/login.js", "src/page-runtime.js", "src/social.js", "src/music.js", "src/chat.js", "src/profiles.js", "assets/js/home.js", "assets/js/gallery.js", "assets/js/music.js", "assets/js/chat.js", "assets/js/conversation.js", "assets/js/letters.js", "assets/js/notifications.js", "assets/js/users.js", "assets/js/settings.js", "assets/js/profile.js", "assets/js/admin.js", "home.html", "galeria.html", "musicas.html", "chat.html", "conversa.html", "cartas.html", "notificacoes.html", "usuarios.html", "configuracoes.html", "perfil.html", "admin.html"];
  const contents = await Promise.all(files.map(read));
  const removedUsername = ["li", "li", "ka"].join("");
  assert.doesNotMatch(contents.join("\n"), new RegExp(removedUsername, "i"));
});

test("the build emits all independent pages and their assets", async () => {
  const { access } = await import("node:fs/promises");
  for (const path of ["dist/login.html", "dist/home.html", "dist/galeria.html", "dist/musicas.html", "dist/chat.html", "dist/conversa.html", "dist/mensagens.html", "dist/cartas.html", "dist/notificacoes.html", "dist/usuarios.html", "dist/configuracoes.html", "dist/perfil.html", "dist/admin.html", "dist/assets/js/login.js", "dist/assets/js/conversation.js", "dist/assets/js/letters.js", "dist/assets/js/notifications.js", "dist/assets/js/users.js", "dist/assets/js/settings.js", "dist/assets/css/pages/conversation.css", "dist/assets/css/pages/letters.css", "dist/assets/css/pages/notifications.css", "dist/assets/css/pages/users.css", "dist/assets/css/pages/settings.css", "dist/assets/css/app.css", "dist/src/page-runtime.js"]) {
    await access(resolve(projectRoot, path));
  }
});

test("the YouTube API key is absent from the browser build", async () => {
  const [config, clientModule, build] = await Promise.all([
    read("dist/config.js"), read("dist/src/youtube-playlist.js"), read("scripts/build.mjs")
  ]);
  assert.doesNotMatch(config, /youtubeApiKey|AIza[\w-]{20,}/);
  assert.doesNotMatch(clientModule, /LOOPLY_YOUTUBE_API_KEY|AIza[\w-]{20,}|googleapis\.com\/youtube\/v3/);
  assert.doesNotMatch(build, /process\.env\.LOOPLY_YOUTUBE_API_KEY/);
});

test("the activity center and profile preferences are persisted with recipient-only access", async () => {
  const [runtime, settings, notificationPage, migration, build] = await Promise.all([
    read("src/page-runtime.js"), read("assets/js/settings.js"), read("assets/js/notifications.js"),
    read("supabase/migrations/20261016061021_user_preferences_and_notifications.sql"), read("scripts/build.mjs")
  ]);
  assert.match(runtime, /from\("notifications"\)/);
  assert.match(runtime, /table: "profiles"[\s\S]*?applyProfilePreferences/);
  assert.match(settings, /from\("profiles"\)\.update\(updates\)/);
  assert.match(settings, /font_family/);
  assert.match(settings, /font_size/);
  assert.match(notificationPage, /from\("notifications"\)/);
  assert.match(notificationPage, /from\("chat_notifications"\)/);
  assert.match(notificationPage, /Marcar todas como lidas/);
  assert.match(migration, /alter table public\.notifications enable row level security/i);
  assert.match(migration, /notifications_select_recipient[\s\S]*?recipient_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /notifications_update_read_recipient[\s\S]*?with check \(recipient_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(migration, /create trigger notifications_on_comment/i);
  assert.match(migration, /create trigger notifications_on_music_dedication/i);
  assert.match(migration, /create trigger notifications_on_selected_post_recipient/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.notifications/i);
  assert.match(build, /notificacoes\.html/);
});

test("conversations have their own route and real microphone recording flow", async () => {
  const [chat, conversation, page, css, sharedChatCss] = await Promise.all([
    read("src/chat.js"), read("assets/js/conversation.js"), read("conversa.html"), read("assets/css/pages/conversation.css"), read("assets/css/pages/chat.css")
  ]);
  assert.match(page, /assets\/js\/conversation\.js/);
  assert.match(conversation, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(chat, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(chat, /new MediaRecorder/);
  assert.match(chat, /data-chat-record-cancel/);
  assert.match(chat, /data-chat-record-stop/);
  assert.match(chat, /bucketName: "looply-chat"/);
  assert.match(chat, /data-chat-open/);
  assert.match(css, /page-conversation/);
  assert.match(chat, /data-chat-conversation-search/);
  assert.match(chat, /data-chat-filter="unread"/);
  assert.match(chat, /data-chat-copy/);
  assert.match(chat, /data-chat-audio-rate/);
  assert.match(chat, /chat-date-separator/);
  assert.match(sharedChatCss, /chat-message-avatar/);
});

test("YouTube playlist loading paginates, ignores unavailable videos, and explains API failures", async () => {
  const { fetchPlaylistItems, youtubeApiErrorMessage } = await import("../src/youtube-playlist.js");
  const requests = [];
  const pagesFromApi = [
    { items: [{ videoId: "abcdefghijk", title: "Faixa 1", position: 0, channel: "Canal" }], nextPageToken: "page-2" },
    { items: [
      { videoId: "lmnopqrstuv", title: "Faixa 2", position: 1 },
      { videoId: "zzzzzzzzzzz", title: "Deleted video", position: 2 }
    ] }
  ];
  const tracks = await fetchPlaylistItems("PLD5PXwJcU-Sg", "unit-test-token", async (url, options) => {
    requests.push({ url: new URL(url, "https://looply.test"), options });
    return { ok: true, status: 200, json: async () => pagesFromApi[requests.length - 1] };
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, "/api/youtube-playlist");
  assert.equal(requests[0].url.searchParams.get("playlistId"), "PLD5PXwJcU-Sg");
  assert.equal(requests[0].url.searchParams.has("key"), false);
  assert.equal(requests[0].options.headers.authorization, "Bearer unit-test-token");
  assert.equal(requests[1].url.searchParams.get("pageToken"), "page-2");
  assert.deepEqual(tracks.map((track) => track.title), ["Faixa 1", "Faixa 2"]);
  assert.match(youtubeApiErrorMessage(502, { error: "youtube_quota_exceeded", reason: "quotaExceeded" }), /cota diária/i);
  assert.match(youtubeApiErrorMessage(502, { error: "youtube_key_rejected", reason: "ipRefererBlocked" }), /chave do servidor/i);
  assert.match(youtubeApiErrorMessage(502, { error: "youtube_api_disabled", reason: "accessNotConfigured" }), /ative a YouTube Data API v3/i);
});

test("the mobile navigation remains outside the sticky header stacking context", async () => {
  const sharedCss = await read("assets/css/pages/shared.css");
  assert.match(sharedCss, /@media \(max-width: 760px\)[\s\S]*?\.looply-page \.page-header \{[^}]*backdrop-filter: none/);
  assert.match(sharedCss, /\.looply-page \.page-navigation \{ position: fixed;[\s\S]*?bottom: calc\(7px \+ env\(safe-area-inset-bottom\)\)/);
});

test("the social schema scopes posts and comments to the post audience", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const filename = names.find((name) => name.endsWith("_posts_comments_core.sql"));
  const invokerName = names.find((name) => name.endsWith("_selected_posts_invoker.sql"));
  assert.ok(filename);
  assert.ok(invokerName);
  const sql = await read("supabase/migrations/" + filename);
  const invoker = await read("supabase/migrations/" + invokerName);
  assert.match(sql, /private\.can_view_post\(p_post_id uuid\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  assert.match(sql, /posts_read_visible[\s\S]*?using \(\(select private\.can_view_post\(id\)\)\)/i);
  assert.match(sql, /comments_read_with_post[\s\S]*?using \(\(select private\.can_view_post\(post_id\)\)\)/i);
  assert.match(sql, /create policy comments_insert_with_post[\s\S]*?author_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /public\.create_selected_post[\s\S]*?actor_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /comments_parent_same_post_fk[\s\S]*?references public\.comments \(id, post_id\)/i);
  assert.match(sql, /comments_enforce_one_reply_level/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.posts/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.comments/i);
  assert.match(invoker, /alter function public\.create_selected_post\(text, uuid\[\]\) security invoker/i);
  assert.match(invoker, /posts_insert_own[\s\S]*?visibility in \('public', 'private', 'selected'\)/i);
  assert.doesNotMatch(sql, /insert into private\.admin_users/i);
});

test("the feed escapes database text and writes through Supabase with realtime refresh", async () => {
  const social = await read("src/social.js");
  assert.match(social, /function escapeHtml\(value\)/);
  assert.match(social, /from\("posts"\)/);
  assert.match(social, /from\("comments"\)\.insert/);
  assert.match(social, /rpc\("create_selected_post"/);
  assert.match(social, /postgres_changes/);
  assert.match(social, /refreshSocialFeed/);
  assert.match(social, /createSignedUrls/);
  assert.match(social, /tus-js-client@4\.3\.1/);
  assert.match(social, /from\("post_media"\)\.insert/);
});

test("comment attachments use private storage and inherit the post's visibility", async () => {
  const [social, migration] = await Promise.all([
    read("src/social.js"),
    read("supabase/migrations/20261016023926_mobile_media.sql")
  ]);
  assert.match(social, /name="commentMedia" type="file" multiple/);
  assert.match(social, /comments\/\$\{postId\}\/\$\{comment\.id\}/);
  assert.match(social, /from\("comment_media"\)\.insert/);
  assert.match(social, /createSignedUrls\(allMedia\.map/);
  assert.match(social, /table: "comment_media"/);
  assert.match(migration, /alter table public\.comment_media enable row level security/i);
  assert.match(migration, /private\.can_view_post\(post_id\)/i);
  assert.match(migration, /looply_comment_media_read[\s\S]*?private\.can_view_post\(media\.post_id\)/i);
  assert.match(migration, /looply_comment_media_insert[\s\S]*?comment\.author_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /looply_comment_media_delete[\s\S]*?post\.author_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /byte_size between 1 and 104857600/i);
  assert.match(migration, /at most 4 media files/i);
});

test("comment media foreign keys have covering indexes", async () => {
  const sql = await read("supabase/migrations/20261016024015_mobile_media_fk_indexes.sql");
  assert.match(sql, /comment_media_author_id_idx[\s\S]*?on public\.comment_media \(author_id\)/i);
  assert.match(sql, /comment_media_comment_post_idx[\s\S]*?on public\.comment_media \(comment_id, post_id\)/i);
});

test("media storage stays private and follows post-level RLS", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const filename = names.find((name) => name.endsWith("_private_post_media.sql"));
  assert.ok(filename);
  const sql = await read("supabase/migrations/" + filename);
  assert.match(sql, /'looply-media',[\s\S]*?false,[\s\S]*?104857600/i);
  assert.match(sql, /post_media_read_with_post[\s\S]*?private\.can_view_post\(post_id\)/i);
  assert.match(sql, /looply_media_read_authorized_post[\s\S]*?private\.can_view_post\(media\.post_id\)/i);
  assert.match(sql, /looply_media_insert_post_author[\s\S]*?p\.author_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /looply_media_delete_post_author[\s\S]*?p\.author_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /post_media_validate_uploaded_object/i);
  assert.doesNotMatch(sql, /grant select on public\.post_media to anon/i);
});

test("profile search and editing use only profile fields protected by RLS", async () => {
  const profiles = await read("src/profiles.js");
  assert.match(profiles, /const updates = \{ display_name: displayName, bio, profile_visibility: visibility \}/);
  assert.match(profiles, /from\("profiles"\)\.update\(updates\)/);
  assert.match(profiles, /storage\.from\("looply-avatars"\)\.createSignedUrls/);
  assert.match(profiles, /storage\.from\("looply-avatars"\)\.upload/);
  assert.match(profiles, /avatars\/\$\{userId\}\/\$\{crypto\.randomUUID\(\)\}/);
  assert.match(profiles, /\.ilike\("username", `\$\{query\}%`\)/);
  assert.match(profiles, /from\("posts"\)[\s\S]*?select\("id,body,created_at,media:post_media/);
  assert.doesNotMatch(profiles, /\.select\([^\n]*email/i);
});

test("music dedications are limited to the two participants and comments are private by default", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const migration = names.find((name) => name.endsWith("_music_dedications_private_comments.sql"));
  assert.ok(migration);
  const [sql, module] = await Promise.all([read("supabase/migrations/" + migration), read("src/music.js")]);
  assert.match(sql, /music_dedications_read_participants[\s\S]*?sender_id = \(select auth\.uid\(\)\)[\s\S]*?recipient_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /music_comments_read_author_or_shared_participant[\s\S]*?visibility = 'participants'/i);
  assert.match(sql, /visibility text not null default 'private'/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.music_comments/i);
  assert.match(module, /from\("music_dedications"\)/);
  assert.match(module, /from\("music_comments"\)\.insert/);
  assert.match(module, /values\.get\("visibility"\) \|\| "private"/);
  assert.doesNotMatch(sql, /grant select on public\.music_comments to anon/i);
});

test("personal music libraries are owner-only and administrative reads are audited", async () => {
  const [migration, music, admin, edge] = await Promise.all([
    read("supabase/migrations/20261016002153_private_music_library.sql"),
    read("src/music.js"),
    read("src/admin.js"),
    read("supabase/functions/looply-admin/index.ts")
  ]);
  assert.match(migration, /alter table public\.music_library enable row level security/i);
  assert.match(migration, /music_library_select_owner[\s\S]*?owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /music_library_insert_owner[\s\S]*?with check \(owner_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(migration, /revoke all on table public\.music_library from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.music_library to authenticated/i);
  assert.match(migration, /music_library[\s\S]*?record_looply_admin_access/);
  assert.match(music, /from\("music_library"\)[\s\S]*?\.eq\("owner_id", userId\)/);
  assert.match(music, /from\("music_library"\)\.insert/);
  assert.match(music, /data-music-library-delete/);
  assert.match(music, /table: "music_library", filter: `owner_id=eq\.\$\{userId\}`/);
  assert.match(admin, /value="music_library"/);
  assert.match(edge, /resourceType === "music_library"/);
  assert.match(edge, /owner:profiles!music_library_owner_id_fkey/);
});

test("admin reads use a verified Edge Function and a service-role-only audit bridge", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const bridgeName = names.find((name) => name.endsWith("_admin_audit_bridge.sql"));
  const denyName = names.find((name) => name.endsWith("_deny_direct_admin_audit_access.sql"));
  assert.ok(bridgeName);
  assert.ok(denyName);
  const [sql, denySql, edge, admin, config] = await Promise.all([
    read("supabase/migrations/" + bridgeName),
    read("supabase/migrations/" + denyName),
    read("supabase/functions/looply-admin/index.ts"),
    read("src/admin.js"),
    read("supabase/config.toml")
  ]);
  assert.match(sql, /private\.admin_audit[\s\S]*?enable row level security/i);
  assert.match(denySql, /admin_audit_deny_direct_access[\s\S]*?using \(false\)[\s\S]*?with check \(false\)/i);
  assert.match(sql, /is_looply_admin[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.match(sql, /record_looply_admin_access[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.match(edge, /auth\.getUser\(\)/);
  assert.match(edge, /record_looply_admin_access/);
  assert.match(edge, /createSignedUrls/);
  assert.match(config, /\[functions\.looply-admin\][\s\S]*?verify_jwt = true/i);
  assert.match(admin, /functions\.invoke\("looply-admin"/);
  assert.match(admin, /purpose.length < 20/);
  assert.doesNotMatch(edge, /sb_secret_[A-Za-z0-9_-]{10,}|service_role["']\s*:\s*["'][A-Za-z0-9_-]{20,}/i);
});

test("chat, letters, notifications, and attachments are private to conversation participants", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const migrationName = names.find((name) => name.endsWith("_conversations_letters_chat_media.sql"));
  const hardeningName = names.find((name) => name.endsWith("_harden_chat_entrypoints.sql"));
  assert.ok(migrationName);
  assert.ok(hardeningName);
  const [sql, hardening, chat, edge, config] = await Promise.all([
    read("supabase/migrations/" + migrationName),
    read("supabase/migrations/" + hardeningName),
    read("src/chat.js"),
    read("supabase/functions/looply-chat/index.ts"),
    read("supabase/config.toml")
  ]);
  assert.match(sql, /private\.is_conversation_participant\(p_conversation_id uuid\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  assert.match(sql, /chat_messages_select_participants[\s\S]*?private\.is_conversation_participant\(conversation_id\)/i);
  assert.match(sql, /chat_notifications_select_own[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /looply_chat_read_participants[\s\S]*?chat_media as media[\s\S]*?private\.is_conversation_participant/i);
  assert.match(sql, /looply-chat',[\s\S]*?false,[\s\S]*?104857600/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.chat_messages/i);
  assert.match(hardening, /revoke all on function public\.create_direct_conversation\(uuid, uuid\)[\s\S]*?from public, anon, authenticated, service_role[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.match(hardening, /revoke all on function public\.create_admin_letter\(uuid, text, text\)[\s\S]*?from public, anon, authenticated, service_role[\s\S]*?grant execute[\s\S]*?to service_role/i);
  assert.match(chat, /functions\.invoke\("looply-chat"/);
  assert.match(chat, /createSignedUrls/);
  assert.match(chat, /tus-js-client@4\.3\.1/);
  assert.match(chat, /last_read_at/);
  assert.match(edge, /auth\.getUser\(\)/);
  assert.match(edge, /p_actor_id: authData\.user\.id/);
  assert.match(config, /\[functions\.looply-chat\][\s\S]*?verify_jwt = true/i);
  assert.doesNotMatch(edge, /sb_secret_[A-Za-z0-9_-]{10,}|service_role["']\s*:\s*["'][A-Za-z0-9_-]{20,}/i);
});

test("the original login keeps its recovery link without requiring SMTP for sign-in", async () => {
  const [login, page] = await Promise.all([read("src/login.js"), read("login.html")]);
  assert.match(login, /signInWithPassword/);
  assert.match(page, /Esqueci minha senha/);
  assert.doesNotMatch(login, /resetPasswordForEmail|auth\.updateUser/);
  assert.doesNotMatch(login, /localStorage\.(?:getItem|setItem)\(["'](?:username|password|isLoggedIn)/i);
});

test("administrative comments preserve actor identity and audit both sides of the write", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const migrationName = names.find((name) => name.endsWith("_admin_audited_comments.sql"));
  assert.ok(migrationName);
  const [sql, edge, admin] = await Promise.all([
    read("supabase/migrations/" + migrationName),
    read("supabase/functions/looply-admin/index.ts"),
    read("src/admin.js")
  ]);
  assert.match(sql, /'write_requested', 'write_completed', 'write_failed'/i);
  assert.match(edge, /payload\.action === "comment"/);
  assert.match(edge, /recordAccess\(service, authData\.user\.id, "write_requested", "posts"/);
  assert.match(edge, /author_id: authData\.user\.id/);
  assert.match(edge, /"write_completed"/);
  assert.match(admin, /data-admin-comment/);
  assert.match(admin, /action: "comment"/);
});

test("owners can remove their own feed posts and profile pages render authorized media", async () => {
  const [social, profiles] = await Promise.all([read("src/social.js"), read("src/profiles.js")]);
  assert.match(social, /post\.author_id === userId[\s\S]*?data-delete-post/);
  assert.match(social, /storage\.from\("looply-media"\)\.remove\(paths\)/);
  assert.match(social, /\.delete\(\)\.eq\("id", postId\)\.eq\("author_id", userId\)/);
  assert.match(profiles, /createSignedUrls\(media\.map\(\(item\) => item\.storage_path\), 1800\)/);
  assert.match(profiles, /profile-post-media-grid/);
});

test("the legacy archive migration keeps letters private and all media objects behind RLS", async () => {
  const [migration, cards, importer, edge] = await Promise.all([
    read("supabase/migrations/20261016042907_legacy_archive.sql"),
    read("src/archived-cards.js"),
    read("src/archive-import.js"),
    read("supabase/functions/looply-admin/index.ts")
  ]);
  assert.match(migration, /create table public\.archived_cards[\s\S]*?enable row level security/i);
  assert.match(migration, /archived_cards_recipient_read[\s\S]*?recipient_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /create table private\.archived_card_secrets[\s\S]*?password_hash text not null/i);
  assert.match(migration, /body text,[\s\S]*?password_salt text not null[\s\S]*?password_hash text not null/i);
  assert.match(migration, /grant execute on function public\.read_looply_archived_card_secret\(uuid, uuid\) to service_role/i);
  assert.match(migration, /grant execute on function public\.consume_looply_archived_card_unlock\(uuid, uuid\) to service_role/i);
  assert.match(migration, /attempts between 0 and 8/i);
  const denyPolicies = await read("supabase/migrations/20261016042944_archive_secret_deny_policies.sql");
  assert.match(denyPolicies, /archived_card_secrets_deny_direct_access[\s\S]*?using \(false\)[\s\S]*?with check \(false\)/i);
  assert.match(denyPolicies, /archived_card_unlock_attempts_deny_direct_access[\s\S]*?using \(false\)[\s\S]*?with check \(false\)/i);
  assert.match(migration, /create table public\.archive_media[\s\S]*?visibility text not null[\s\S]*?enable row level security/i);
  assert.match(migration, /archive_media_audience_read[\s\S]*?private\.can_view_archive_media\(id\)/i);
  assert.match(migration, /looply_legacy_archive_media_read[\s\S]*?private\.can_view_archive_media/i);
  assert.match(migration, /looply_legacy_archive_admin_insert[\s\S]*?private\.is_admin\(\)/i);
  assert.match(migration, /looply_legacy_archive_admin_delete[\s\S]*?private\.is_admin\(\)/i);
  assert.match(migration, /update storage\.buckets[\s\S]*?image\/heic[\s\S]*?audio\/mpeg/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.archive_media_comments/i);
  assert.match(cards, /from\("archived_cards"\)\.select\("id,recipient_id,original_file,card_number,is_private,is_protected,password_hint,body,sent_date"\)/);
  assert.doesNotMatch(cards, /password_(?:salt|hash)/);
  assert.match(importer, /action: "import_archived_cards", resourceType: "archived_cards"/);
  assert.match(importer, /action: "register_archive_media", resourceType: "archive_media"/);
  assert.match(edge, /payload\.action === "unlock_archived_card"[\s\S]*?consume_looply_archived_card_unlock[\s\S]*?verifyArchivedCardPassword[\s\S]*?reset_looply_archived_card_unlock/);
  assert.match(edge, /recordAccess\(service, authData\.user\.id, "read_completed", media\.bucket_id === "looply-chat" \? "chat_media" : media\.audit_resource_type \|\| "post_media"/);
});

test("the archive importer indexes legacy media but leaves audience decisions to the gallery administrator", async () => {
  const { findMediaIndexEntry, makeMediaCatalog } = await import("../src/archive-import.js");
  const rootIndex = { file: { name: "midia-index.json" }, path: "midia-index.json" };
  const dataIndex = { file: { name: "midia-index.json" }, path: "data/midia-index.json" };
  assert.equal(findMediaIndexEntry(new Map([["midia-index.json", rootIndex]])), rootIndex);
  assert.equal(findMediaIndexEntry(new Map([["data/midia-index.json", dataIndex]])), dataIndex);
  assert.equal(findMediaIndexEntry(new Map()), null);
  const index = {
    fotos: [
      { path: "midia/comum.jpg" },
      { path: "midia/Misol/restrita.jpg" },
      { path: "midia/fora-da-audiencia/ignorada.jpg" }
    ],
    videos: [{ path: "midia/video.mp4" }],
    audios: [],
    exclusivo: {
      Misol: [{ path: "midia/Misol/restrita.jpg" }],
      YARA: [{ path: "midia/YARA/foto.heic" }],
      Patati: []
    }
  };
  const paths = ["midia/comum.jpg", "midia/Misol/restrita.jpg", "midia/video.mp4", "midia/YARA/foto.heic"];
  const fileMap = new Map(paths.map((path) => [path.toLocaleLowerCase("pt-BR"), { path, file: {} }]));
  const catalog = makeMediaCatalog(index, fileMap);
  assert.equal(catalog.length, 4);
  assert.equal(catalog.find((item) => item.source_path === "midia/comum.jpg").visibility, "members");
  assert.equal(catalog.find((item) => item.source_path === "midia/Misol/restrita.jpg").visibility, "members");
  assert.equal(catalog.find((item) => item.source_path === "midia/YARA/foto.heic").visibility, "members");
  assert.deepEqual(catalog.find((item) => item.source_path === "midia/Misol/restrita.jpg").recipient_names, []);
  assert.deepEqual(catalog.find((item) => item.source_path === "midia/YARA/foto.heic").recipient_names, []);
  assert.equal(catalog.find((item) => item.source_path === "midia/YARA/foto.heic").mime_type, "image/heic");
  assert.equal(catalog.some((item) => item.source_path.includes("fora-da-audiencia")), false);
});

test("archive import processes each item sequentially and continues after an item fails", async () => {
  const order = [];
  const progress = [];
  const result = await processSequentially(["carta-1", "carta-2", "midia-1"], async (item) => {
    order.push(`start:${item}`);
    if (item === "carta-2") throw new Error("Edge Function returned a non-2xx status code");
    order.push(`done:${item}`);
  }, (state) => progress.push({ item: state.item, succeeded: state.succeeded, failed: state.failed }));

  assert.deepEqual(order, ["start:carta-1", "done:carta-1", "start:carta-2", "start:midia-1", "done:midia-1"]);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0].item, "carta-2");
  assert.deepEqual(progress, [
    { item: "carta-1", succeeded: 1, failed: 0 },
    { item: "carta-2", succeeded: 1, failed: 1 },
    { item: "midia-1", succeeded: 2, failed: 1 }
  ]);
});

test("archive uploads use resumable chunks and isolate each card and media request", async () => {
  const importer = await read("src/archive-import.js");
  assert.match(importer, /chunkSize:\s*6\s*\*\s*1024\s*\*\s*1024/);
  assert.match(importer, /processSequentially\(cards,[\s\S]*?cards:\s*\[card\]/);
  assert.match(importer, /processSequentially\(media,[\s\S]*?register_archive_media/);
  assert.match(importer, /falha individual não interrompe o restante/);
  assert.doesNotMatch(importer, /Promise\.all\(workers\)/);
});

test("the admin screen connects the archive importer and audited archive comments", async () => {
  const [admin, entry, css] = await Promise.all([
    read("src/admin.js"), read("assets/js/admin.js"), read("assets/css/pages/admin.css")
  ]);
  assert.match(admin, /data-archive-import/);
  assert.match(admin, /value="archived_cards"/);
  assert.match(admin, /value="archive_media"/);
  assert.match(admin, /data-admin-archive-comment/);
  assert.match(admin, /action: "comment_archive_media"/);
  assert.match(admin, /data-admin-offset-field/);
  assert.match(entry, /bindArchiveImport\(root, client\)/);
  assert.match(css, /archive-import-errors/);
});
test("an archive upload conflict is recoverable only when Storage confirms the exact object and size", () => {
  const conflict = new Error("unexpected TUS response code: 409");
  assert.equal(canReuseArchiveObjectAfterUploadFailure(conflict, { exists: false, byteSize: null }, 4096), false);
  assert.equal(canReuseArchiveObjectAfterUploadFailure(conflict, { exists: true, byteSize: 4095 }, 4096), false);
  assert.equal(canReuseArchiveObjectAfterUploadFailure(conflict, { exists: true, byteSize: 4096 }, 4096), true);
  assert.equal(canReuseArchiveObjectAfterUploadFailure(null, { exists: true, byteSize: 4096 }, 4096), false);
});

test("all resumable uploads include the publishable key and archive retries use the server-side Storage check", async () => {
  const [archive, social, chat, admin] = await Promise.all([
    read("src/archive-import.js"), read("src/social.js"), read("src/chat.js"),
    read("supabase/functions/looply-admin/index.ts")
  ]);
  for (const source of [archive, social, chat]) assert.match(source, /apikey: publishableKey/);
  assert.match(archive, /client\.functions\.invoke\("looply-admin", \{[\s\S]*?verify_archive_media_upload/);
  assert.match(admin, /payload\.action === "verify_archive_media_upload"/);
  assert.match(admin, /service\.storage\.from\("looply-media"\)\.list\(folder/);
});


test("group conversations are created through the authenticated server path with participant RLS", async () => {
  const [chat, edge, migration] = await Promise.all([
    read("src/chat.js"),
    read("supabase/functions/looply-chat/index.ts"),
    read("supabase/migrations/20261016113305_group_conversations.sql")
  ]);
  assert.match(migration, /kind in \('direct', 'letter', 'group'\)/i);
  assert.match(migration, /create or replace function public\.create_group_conversation/i);
  assert.match(migration, /revoke all on function public\.create_group_conversation\(uuid, uuid\[\], text\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.create_group_conversation\(uuid, uuid\[\], text\) to service_role/i);
  assert.match(edge, /payload\.action === "create_group"/);
  assert.match(edge, /service\.rpc\("create_group_conversation"/);
  assert.match(chat, /data-chat-group-create/);
  assert.match(chat, /conversation\.kind === "group"/);
  assert.match(chat, /targetIds\.length < 2/);
  assert.match(chat, /user_id=eq\.\$\{userId\}/);
  assert.match(chat, /Lida por todos/);
});

test("global navigation keeps the six core pages and puts profile tools in the account menu", async () => {
  const [runtime, shared] = await Promise.all([read("src/page-runtime.js"), read("assets/css/pages/shared.css")]);
  const primaryNavigation = runtime.slice(runtime.indexOf("const navigation = ["), runtime.indexOf("const navigationIcons = {"));
  assert.match(primaryNavigation, /"letters", "Cartas"/);
  assert.match(primaryNavigation, /"notifications", "Notificações"/);
  assert.doesNotMatch(primaryNavigation, /"users"|"profile"|"settings"/);
  assert.match(runtime, /class="account-menu-link" href="usuarios\.html"/);
  assert.match(runtime, /data-sign-out/);
  assert.match(shared, /\.account-menu-popover/);
});

test("stories are grouped by author, sorted in sequence, and hidden at expiry", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const groups = groupActiveStories([
    { id: "expired", author_id: "a", created_at: "2026-10-15T10:00:00.000Z", expires_at: "2026-10-16T11:00:00.000Z" },
    { id: "a-later", author_id: "a", created_at: "2026-10-16T11:20:00.000Z", expires_at: "2026-10-16T12:20:00.000Z" },
    { id: "b-one", author_id: "b", created_at: "2026-10-16T11:30:00.000Z", expires_at: "2026-10-16T12:30:00.000Z" },
    { id: "a-first", author_id: "a", created_at: "2026-10-16T11:10:00.000Z", expires_at: "2026-10-16T12:10:00.000Z" },
    { id: "fallback", author_id: "c", created_at: "2026-10-16T11:30:00.000Z" },
    { id: "boundary", author_id: "d", created_at: "2026-10-16T11:00:00.000Z", expires_at: "2026-10-16T12:00:00.000Z" }
  ], now);
  assert.deepEqual(groups.map((group) => group.author_id), ["b", "c", "a"]);
  assert.deepEqual(groups.find((group) => group.author_id === "a").stories.map((story) => story.id), ["a-first", "a-later"]);
  assert.equal(groups.find((group) => group.author_id === "c").stories[0].expires_at, "2026-10-17T11:30:00.000Z");
});

test("story media signed URLs never outlive their story", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  assert.equal(storyMediaUrlTtl("2026-10-16T12:03:00.000Z", now), 150);
  assert.equal(storyMediaUrlTtl("2026-10-17T12:00:00.000Z", now), 1800);
  assert.equal(storyMediaUrlTtl("2026-10-16T12:00:20.000Z", now), 0);
  assert.equal(storyMediaUrlTtl("not-a-date", now), 0);
});

test("stories expose private replies, likes, camera capture, viewer history, and swipe navigation", async () => {
  const markup = storiesMarkup([], null, [], null, "viewer", { id: "viewer", username: "viewer", display_name: "Viewer" });
  const source = await read("src/stories.js");
  assert.match(markup, /data-story-camera-open/);
  assert.match(markup, /data-story-capture-photo/);
  assert.match(markup, /data-story-record-toggle/);
  assert.match(markup, /data-story-like/);
  assert.match(markup, /data-story-reply/);
  assert.match(markup, /data-story-insights-open/);
  assert.match(source, /send_story_reply/);
  assert.match(source, /record_story_view/);
  assert.match(source, /pointerup/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /timeLabels.exact/);
  assert.doesNotMatch(source, /if (!await refresh()) return;/);

  const profile = profileAreaMarkup({ id: "viewer", username: "viewer", display_name: "Viewer", bio: "About me", profile_visibility: "members" });
  assert.match(profile, /profile-editor-card/);
  assert.match(profile, /data-avatar-preview/);
  assert.match(profile, /capture="user"/);
  assert.match(profile, /data-avatar-remove/);
});

test("story engagement tables reveal views only to the viewer and story author", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const migrationName = names.find((name) => name.endsWith("_story_engagement_private_replies.sql"));
  assert.ok(migrationName);
  const migration = await read("supabase/migrations/" + migrationName);
  assert.match(migration, /alter table public\.story_views enable row level security/i);
  assert.match(migration, /story_views_select_viewer_or_author[\s\S]*?viewer_id = \(select auth\.uid\(\)\)[\s\S]*?s\.author_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /private\.can_view_story\(p_story_id\)/i);
  assert.match(migration, /create or replace function public\.record_story_view\(p_story_id uuid\)/i);
  assert.match(migration, /create or replace function public\.send_story_reply\(p_story_id uuid, p_body text\)/i);
  assert.match(migration, /create_direct_conversation\(actor_id, story_author_id\)/i);
  assert.match(migration, /grant execute on function public\.send_story_reply\(uuid, text\) to authenticated/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.story_views/i);
});

test("Home, Galeria, and Cartas have separate page responsibilities", async () => {
  const [home, gallery, letters] = await Promise.all([
    read("assets/js/home.js"), read("assets/js/gallery.js"), read("assets/js/letters.js")
  ]);
  assert.match(home, /storiesMarkup/);
  assert.match(home, /socialMarkup/);
  assert.doesNotMatch(home, /archivedCardsMarkup|loadArchivedCards/);
  assert.match(gallery, /galleryExperienceMarkup/);
  assert.match(gallery, /loadGalleryMedia/);
  assert.doesNotMatch(gallery, /socialMarkup|loadSocialData/);
  assert.match(letters, /archivedCardsMarkup/);
});

test("24-hour stories use authenticated RLS and private Storage object authorization", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const storyName = names.find((name) => name.endsWith("_stories_24h_private_media_realtime.sql"));
  assert.ok(storyName);
  const [migration, moduleSource, edgeConfig] = await Promise.all([
    read("supabase/migrations/" + storyName), read("src/stories.js"),
    read("supabase/config.toml")
  ]);
  assert.match(migration, /expires_at timestamptz not null default \(now\(\) \+ interval '24 hours'\)/i);
  assert.match(migration, /stories_read_active_authorized[\s\S]*?expires_at > now\(\)/i);
  assert.match(migration, /story_media_read_authorized[\s\S]*?private\.can_view_story/i);
  assert.match(migration, /looply_media_read_authorized_story/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.stories/i);
  assert.match(moduleSource, /looply-stories-cleanup/);
  assert.match(edgeConfig, /\[functions\.looply-stories-cleanup\][\s\S]*?verify_jwt = true/);
});
test("post and story media metadata changes trigger realtime refreshes", async () => {
  const [social, stories, migration] = await Promise.all([
    read("src/social.js"), read("src/stories.js"),
    read("supabase/migrations/20261016122215_realtime_post_story_media.sql")
  ]);
  assert.match(social, /table: "post_media"/);
  assert.match(stories, /table: "story_media"/);
  assert.match(migration, /alter publication supabase_realtime add table public\.post_media/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.story_media/i);
});

test("feed media paths are registered for rollback before upload starts", async () => {
  const source = await read("src/social.js");
  const indexesOf = (needle) => {
    const positions = [];
    let offset = 0;
    while (true) {
      const position = source.indexOf(needle, offset);
      if (position === -1) return positions;
      positions.push(position);
      offset = position + needle.length;
    }
  };
  const paths = indexesOf("uploadedPaths.push(path);");
  const uploads = indexesOf("await uploadResumable(client, path, file");
  assert.equal(paths.length, 2);
  assert.equal(uploads.length, 2);
  paths.forEach((position, index) => assert.ok(position < uploads[index] && uploads[index] - position < 100));
});

import { welcomeGreeting } from "../src/welcome.js";
import { openProtectedLetter, sealLetter } from "../src/letters-community.js";

test("home greeting follows the confirmed account usernames", () => {
  assert.equal(welcomeGreeting("misol"), "Bem-vinda");
  assert.equal(welcomeGreeting("YARA"), "Bem-vinda");
  assert.equal(welcomeGreeting("patati"), "Bem-vindo");
  assert.equal(welcomeGreeting("peixinho"), "Bem-vindo");
});

test("password-protected letters encrypt content and reject a wrong password", async () => {
  const sealed = await sealLetter("Texto confidencial", "senha-longa-123", "Assunto");
  assert.equal(sealed.body, null);
  assert.doesNotMatch(JSON.stringify(sealed), /Texto confidencial|senha-longa-123/);
  const letter = { subject: "Assunto", ...sealed };
  assert.equal(await openProtectedLetter(letter, "senha-longa-123"), "Texto confidencial");
  await assert.rejects(openProtectedLetter(letter, "senha-incorreta"), /Senha incorreta/);
});

test("community gallery and letters use RLS, encryption and receipt-aware chat", async () => {
  const names = await readdir(resolve(projectRoot, "supabase/migrations"));
  const migrationName = names.find((name) => name.endsWith("_community_letters_gallery_receipts.sql"));
  assert.ok(migrationName);
  const [sql, gallery, letters, chat, css, adminFunction] = await Promise.all([
    read("supabase/migrations/" + migrationName), read("src/community-gallery.js"),
    read("src/letters-community.js"), read("src/chat.js"), read("assets/css/pages/chat.css"),
    read("supabase/functions/looply-admin/index.ts")
  ]);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /sender_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /is_protected = true and body is null[\s\S]*password_ciphertext/);
  assert.match(sql, /looply-gallery[\s\S]*209715200/i);
  assert.match(sql, /209715200 else 104857600/i);
  assert.match(sql, /archive_media_byte_size_check[\s\S]*209715200/i);
  assert.match(gallery, /looply-gallery/);
  assert.match(gallery, /tus-js-client/);
  assert.match(letters, /crypto\.subtle\.encrypt/);
  assert.doesNotMatch(letters, /password:\s*String\(values\.get/);
  assert.match(chat, /mark_conversations_delivered/);
  assert.match(chat, /message\.read_at \? "Lida" : message\.delivered_at \? "Entregue"/);
  assert.match(css, /--looply-visible-height/);
  assert.match(adminFunction, /expectedSize > 209_715_200/);
});




test("chat realtime refresh keeps the active draft and avoids delivery-triggered refresh loops", async () => {
  const chat = await read("src/chat.js");
  assert.ok(chat.includes("loadChatData(client, userId, { markDelivered: false })"));
  assert.ok(chat.includes('payload?.eventType === "INSERT"'));
  assert.ok(chat.includes('mark_conversations_delivered", { p_conversation_ids: [payload.new.conversation_id] }'));
  assert.ok(chat.includes('form.dataset.sending = "true"'));
  assert.ok(chat.includes("data-chat-messages"));
  assert.ok(chat.includes('composer?.dataset.sending === "true"'));
  assert.ok(chat.includes('if (!conversationId) throw new Error("conversation not selected")'));
  const submit = chat.slice(chat.indexOf('root.addEventListener("submit"'));
  assert.ok(submit.indexOf("event.preventDefault()") < submit.indexOf('form.dataset.sending === "true"'),
    "duplicate chat submits must not fall through to native page navigation");
  assert.match(submit, /form\.dataset\.conversationId \|\| routeConversationId \|\| activeConversationId/);
  assert.match(submit, /form\.dataset\.conversationId = conversationId/);
  assert.ok(!chat.includes('if (!conversationId || conversationId !== activeConversationId)'));
  assert.equal(chat.split("else if (/conversation not selected").length - 1, 1);
  assert.ok(!chat.includes("area.replaceWith("));
});

test("gallery access, comment audiences and swipeable responsive viewer are wired end to end", async () => {
  const [gallery, entry, migration, accessRpc, realtimeMigration, css] = await Promise.all([
    read("src/gallery-experience.js"),
    read("assets/js/gallery.js"),
    read("supabase/migrations/20261016152935_gallery_private_audiences.sql"),
    read("supabase/migrations/20261016195217_gallery_permissions_atomic_rpc.sql"),
    read("supabase/migrations/20261016200337_gallery_comment_audience_realtime.sql"),
    read("assets/css/pages/gallery.css")
  ]);
  assert.ok(entry.includes("bindGalleryExperience"));
  assert.ok(gallery.includes("set_gallery_media_permissions"));
  assert.ok(gallery.includes("loadSharedGalleryComments"));
  assert.ok(gallery.includes("data-comment-audience"));
  assert.ok(gallery.includes("pointerup"));
  assert.ok(gallery.includes("pinch"));
  assert.ok(migration.includes("archive_media_comment_recipients"));
  assert.ok(migration.includes("community_gallery_comment_recipients"));
  assert.ok(migration.includes("audience = 'selected'"));
  assert.ok(accessRpc.includes("grant execute on function public.set_gallery_media_permissions"));
  assert.ok(realtimeMigration.includes("archive_media_comment_recipients"));
  assert.ok(realtimeMigration.includes("community_gallery_comment_recipients"));
  assert.ok(gallery.includes("scheduleGalleryRefresh"));
  assert.ok(css.includes("gallery-viewer-content img") && css.includes("object-fit:contain"));
});

test("archive permission administration uses the active authenticated atomic RPC", async () => {
  const [edge, migration] = await Promise.all([
    read("supabase/functions/looply-admin/index.ts"),
    read("supabase/migrations/20261016195217_gallery_permissions_atomic_rpc.sql")
  ]);
  assert.match(edge, /userClient\.rpc\("set_gallery_media_permissions"/);
  assert.match(edge, /p_source: "archive"/);
  assert.match(edge, /viewerIds\.length > 100/);
  assert.doesNotMatch(edge, /set_looply_archive_media_access/);
  assert.match(migration, /grant execute on function public\.set_gallery_media_permissions[\s\S]*?to authenticated/i);
});


test("chat editing and deletion use the authenticated author's existing RLS and clean attached files", async () => {
  const [chat, migration] = await Promise.all([
    read("src/chat.js"),
    read("supabase/migrations/20261015234516_conversations_letters_chat_media.sql")
  ]);
  assert.match(chat, /data-chat-edit/);
  assert.match(chat, /data-chat-delete/);
  assert.match(chat, /\.update\(\{ body: nextBody \}\)[\s\S]*?\.eq\("sender_id", userId\)/);
  assert.match(chat, /window\.confirm\("Apagar esta mensagem e os anexos enviados com ela\?"\)/);
  assert.match(chat, /storage\.from\("looply-chat"\)\.remove\(paths\)[\s\S]*?\.delete\(\)\.eq\("id", messageId\)\.eq\("sender_id", userId\)/);
  assert.match(migration, /chat_messages_update_own[\s\S]*?sender_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /chat_messages_delete_own[\s\S]*?sender_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /looply_chat_delete_own_message[\s\S]*?message\.sender_id = \(select auth\.uid\(\)\)/i);
});


test("chat composer uses Enter to send, Shift+Enter for a newline, and valid CSS rules", async () => {
  const [chat, css] = await Promise.all([
    read("src/chat.js"), read("assets/css/pages/chat.css")
  ]);
  assert.match(chat, /root\.addEventListener\("keydown"/);
  assert.match(chat, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(chat, /form\.requestSubmit\(\)/);
  assert.ok(chat.indexOf('root.addEventListener("keydown"') < chat.indexOf('root.addEventListener("submit"'));
  assert.doesNotMatch(css, /\\n/);
});

test("chat composer inserts selected emojis at the cursor", async () => {
  const [chat, css] = await Promise.all([
    read("src/chat.js"), read("assets/css/pages/chat.css")
  ]);
  assert.match(chat, /data-chat-emoji-toggle/);
  assert.match(chat, /data-chat-emoji-picker/);
  assert.match(chat, /textarea\.setRangeText\(emoji, start, end, "end"\)/);
  assert.match(chat, /emojiButton\.closest\("\[data-chat-send\]"\)/);
  assert.match(css, /\.chat-emoji-picker\[hidden\] \{ display: none; \}/);
});


test("chat conversations use the dedicated route and preload on interaction without mock data", async () => {
  const [chat, css] = await Promise.all([read("src/chat.js"), read("assets/css/pages/chat.css")]);
  assert.match(chat, /function prefetchConversationPage\(root\)/);
  assert.match(chat, /hint\.rel = "prefetch"/);
  assert.ok(chat.includes("window.location.assign(`mensagens.html?id="));
  assert.match(chat, /client\.functions\.invoke\("looply-chat"/);
  assert.match(css, /grid-template-columns: minmax\(275px, \.78fr\) minmax\(0, 1\.35fr\)/);
  assert.ok(css.includes(".page-chat:not(.page-conversation) .chat-thread-panel { display: none; }"));
  assert.match(css, /max-height: calc\(100dvh - 360px\)/);
});


test("the dedicated messages route renders the thread on small screens", async () => {
  const [page, build, css, chat] = await Promise.all([
    read("mensagens.html"), read("scripts/build.mjs"), read("assets/css/pages/chat.css"), read("src/chat.js")
  ]);
  assert.ok(page.includes("assets/js/conversation.js"));
  assert.ok(page.includes("page-conversation"));
  assert.ok(build.includes("mensagens.html"));
  assert.ok(css.includes(".page-chat:not(.page-conversation) .chat-thread-panel { display: none; }"));
  assert.ok(chat.includes("mensagens.html?id="));
});


test("playlist loading retries a transient network failure and follows every page", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    if (!String(url).includes("pageToken=")) {
      return { ok: true, json: async () => ({
        items: [{ videoId: "ME3nTqgLDEg", title: "Faixa 1", position: 0 }],
        nextPageToken: "page-two"
      }) };
    }
    return { ok: true, json: async () => ({
      items: [{ videoId: "U3M33tm_Vtg", title: "Faixa 2", position: 1 }],
      nextPageToken: ""
    }) };
  };
  const tracks = await fetchPlaylistItems("PLCn4CAsA_tiM", "session-token", fetchImpl);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].title, "Faixa 1");
  assert.equal(tracks[1].title, "Faixa 2");
  assert.equal(calls, 3);
});
