import { mountAppPage } from "../../src/page-runtime.js";
import { bindMusicEvents, disposeMusicRealtime, loadMusicData, musicMarkup, setupMusicRealtime } from "../../src/music.js";
import { bindYouTubePlaylist, playlistMarkup } from "../../src/youtube-playlist.js";

await mountAppPage({ page: "music", render: async ({ root, client, user, profile }) => {
  const data = await loadMusicData(client, user.id);
  root.innerHTML = playlistMarkup(profile) + musicMarkup(data, user.id);
  await bindYouTubePlaylist(root, client);
  bindMusicEvents(root, client, () => user.id);
  setupMusicRealtime(client, user.id, root);
  window.addEventListener("pagehide", () => disposeMusicRealtime(client), { once: true });
} });

if (window.location.hash) {
  requestAnimationFrame(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
