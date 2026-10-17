import { mountAppPage } from "../../src/page-runtime.js";
import { bindCommunityGallery, communityGalleryMarkup } from "../../src/community-gallery.js";
import { bindGalleryExperience, galleryExperienceMarkup, loadGalleryMedia } from "../../src/gallery-experience.js";

await mountAppPage({ page: "gallery", render: async ({ root, client, user, profile, isAdmin }) => {
  root.innerHTML = galleryExperienceMarkup();
  const uploadSlot = root.querySelector("[data-gallery-upload-slot]");
  uploadSlot.innerHTML = communityGalleryMarkup([], user.id, isAdmin);
  uploadSlot.querySelector("[data-community-gallery-grid]")?.remove();

  let media;
  let loadError = "";
  try {
    media = await loadGalleryMedia(client);
  } catch (error) {
    console.error("Looply gallery load failed", error);
    loadError = "Não foi possível carregar as mídias. Confira sua conexão e tente novamente.";
    media = [];
  }

  if (loadError) { const note = document.createElement("p"); note.className = "gallery-load-error"; note.setAttribute("role", "alert"); note.textContent = loadError; root.querySelector(".gallery-controls").after(note); }
  bindCommunityGallery(root, client, user, isAdmin, []);
  bindGalleryExperience(root, client, user, profile, isAdmin, media);
} });
