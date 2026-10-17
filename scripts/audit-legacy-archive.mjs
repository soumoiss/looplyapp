import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "work", "legacy-app", "Loooply-main");
const manifestPath = path.join(projectRoot, "work", "legacy-app", "manifest.json");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function mediaType(filename) {
  const extension = path.extname(filename).toLowerCase();
  return new Map([
    [".txt", "text/plain"], [".html", "text/html"], [".css", "text/css"],
    [".js", "text/javascript"], [".mjs", "text/javascript"], [".json", "application/json"],
    [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
    [".webp", "image/webp"], [".heic", "image/heic"], [".mp4", "video/mp4"], [".mp3", "audio/mpeg"],
    [".wav", "audio/wav"], [".yml", "text/yaml"], [".yaml", "text/yaml"],
    [".sql", "application/sql"], [".py", "text/x-python"], [".pyc", "application/octet-stream"]
  ]).get(extension) || "application/octet-stream";
}

function letterIdentity(filename) {
  const match = path.basename(filename).match(/^(misol|patati|yara)carta(?:privada)?\d+\.txt$/i);
  if (!match) return null;
  return match[1].toLowerCase();
}

const filePaths = (await walk(sourceRoot)).sort((a, b) => a.localeCompare(b));
const files = await Promise.all(filePaths.map(async (absolutePath) => {
  const relativePath = path.relative(sourceRoot, absolutePath).split(path.sep).join("/");
  const content = await readFile(absolutePath);
  return {
    path: relativePath,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    mediaType: mediaType(relativePath),
    filenameIdentityHint: letterIdentity(relativePath)
  };
}));

const fileByLowerPath = new Map(files.map((file) => [file.path.toLowerCase(), file.path]));
const indexes = [];
for (const relativeIndexPath of ["midia-index.json", "data/midia-index.json"]) {
  const indexFile = path.join(sourceRoot, relativeIndexPath);
  try {
    const index = JSON.parse(await readFile(indexFile, "utf8"));
    const sharedReferences = ["fotos", "audios", "videos"].flatMap((group) =>
      (Array.isArray(index[group]) ? index[group] : []).map((item) => String(item.path || "").replaceAll("\\", "/"))
    ).filter(Boolean);
    const exclusiveReferences = Object.values(index.exclusivo || {}).flatMap((entries) =>
      (Array.isArray(entries) ? entries : []).map((item) => String(item.path || "").replaceAll("\\", "/"))
    ).filter(Boolean);
    const references = [...sharedReferences, ...exclusiveReferences];
    const uniqueReferences = [...new Set(references.map((reference) => reference.toLowerCase()))];
    const resolved = uniqueReferences.map((reference) => ({
      path: reference,
      exists: fileByLowerPath.has(reference.replace(/^\.\//, "").toLowerCase())
    }));
    indexes.push({
      index: relativeIndexPath,
      referenceCount: sharedReferences.length,
      exclusiveReferenceCount: exclusiveReferences.length,
      exclusiveOwnerCounts: Object.fromEntries(Object.entries(index.exclusivo || {}).map(([owner, entries]) => [owner, Array.isArray(entries) ? entries.length : 0])),
      uniquePathCount: uniqueReferences.length,
      presentCount: resolved.filter((item) => item.exists).length,
      missingCount: resolved.filter((item) => !item.exists).length,
      missingPaths: resolved.filter((item) => !item.exists).map((item) => item.path)
    });
  } catch {
    indexes.push({ index: relativeIndexPath, error: "not found or invalid JSON" });
  }
}

const extensionCounts = Object.fromEntries([...new Set(files.map((file) => path.extname(file.path).toLowerCase() || "[sem extensão]"))]
  .sort().map((extension) => [extension, files.filter((file) => (path.extname(file.path).toLowerCase() || "[sem extensão]") === extension).length]));
const letterCounts = Object.fromEntries(["misol", "patati", "yara"].map((identity) => [
  identity,
  files.filter((file) => file.mediaType === "text/plain" && file.filenameIdentityHint === identity).length
]));

const manifest = {
  source: "Loooply-main.zip (extracted copy; source archive remains unchanged)",
  generatedAt: new Date().toISOString(),
  files,
  summary: { fileCount: files.length, extensionCounts, letterCounts, indexes }
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  manifest: path.relative(projectRoot, manifestPath),
  fileCount: manifest.summary.fileCount,
  extensionCounts: manifest.summary.extensionCounts,
  letterCounts: manifest.summary.letterCounts,
  indexes: manifest.summary.indexes.map(({ index, referenceCount, exclusiveReferenceCount, exclusiveOwnerCounts, uniquePathCount, presentCount, missingCount }) => ({
    index, referenceCount, exclusiveReferenceCount, exclusiveOwnerCounts, uniquePathCount, presentCount, missingCount
  }))
}, null, 2));

