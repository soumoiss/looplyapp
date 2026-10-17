import { mountAppPage } from "../../src/page-runtime.js";
import { welcomeGreeting } from "../../src/welcome.js";
import { bindSocialEvents, disposeSocialRealtime, loadSocialData, setupSocialRealtime, socialMarkup } from "../../src/social.js";
import { bindStories, disposeStoriesRealtime, loadStories, setupStoriesRealtime, storiesMarkup } from "../../src/stories.js";

function renderWelcome(profile) {
  const name = String(profile.display_name || profile.username || "usuário");
  const avatar = profile.avatarUrl;
  const markup = `<section class="hero-panel home-welcome" aria-labelledby="homeWelcomeTitle">
    <div class="home-welcome-avatar" data-home-avatar aria-hidden="true"><span data-home-avatar-initial></span></div>
    <div class="home-welcome-copy"><div class="eyebrow">Início</div><h1 class="hero-title" id="homeWelcomeTitle" data-home-welcome-title></h1><p>Feed</p></div>
    <a class="header-action home-profile-shortcut" href="perfil.html">Meu perfil</a>
  </section>`;
  const template = document.createElement("template");
  template.innerHTML = markup;
  const welcome = template.content.firstElementChild;
  welcome.querySelector("[data-home-welcome-title]").textContent = welcomeGreeting(profile.username) + ", " + name;
  const fallback = welcome.querySelector("[data-home-avatar-initial]");
  fallback.textContent = Array.from(name.trim())[0]?.toLocaleUpperCase("pt-BR") || "?";
  if (avatar) {
    const image = document.createElement("img");
    image.src = avatar;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove(), { once: true });
    welcome.querySelector("[data-home-avatar]").prepend(image);
  }
  return welcome.outerHTML;
}

await mountAppPage({ page: "home", render: async ({ root, client, user, profile }) => {
  const [socialResult, storiesResult] = await Promise.allSettled([
    loadSocialData(client), loadStories(client)
  ]);
  const socialData = socialResult.status === "fulfilled"
    ? socialResult.value
    : { people: [], peopleError: socialResult.reason, posts: [], postsError: socialResult.reason };
  const stories = storiesResult.status === "fulfilled" ? storiesResult.value : [];
  const storiesError = storiesResult.status === "rejected" ? storiesResult.reason : null;
  root.innerHTML = `${renderWelcome(profile)}${storiesMarkup(
    stories, storiesError, socialData.people, socialData.peopleError, user.id, profile
  )}${socialMarkup(socialData, user.id)}`;
  bindStories(root, client, user.id, stories, storiesError, profile);
  bindSocialEvents(root, client, () => user.id);
  setupStoriesRealtime(client, user.id, root);
  setupSocialRealtime(client, user.id, root);
  window.addEventListener("pagehide", () => {
    disposeStoriesRealtime(client, root);
    disposeSocialRealtime(client);
  }, { once: true });
} });

if (window.location.hash) {
  requestAnimationFrame(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}
