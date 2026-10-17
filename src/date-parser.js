const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

const MONTH_ALIASES = new Map([
  ["janeiro", 1], ["jan", 1], ["jane", 1],
  ["fevereiro", 2], ["fev", 2], ["fevreiro", 2],
  ["marco", 3], ["mar", 3],
  ["abril", 4], ["abr", 4],
  ["maio", 5], ["mai", 5],
  ["junho", 6], ["jun", 6],
  ["julho", 7], ["jul", 7],
  ["agosto", 8], ["ago", 8],
  ["setembro", 9], ["set", 9], ["setem", 9],
  ["outubro", 10], ["out", 10],
  ["novembro", 11], ["nov", 11],
  ["dezembro", 12], ["dez", 12]
]);

function removeAccents(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[\u00A0]/g, " ");
}

function validDate(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  if (!Number.isInteger(y) || y < 1900 || y > 2099) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  const result = new Date(y, m - 1, d);
  if (result.getFullYear() !== y || result.getMonth() !== m - 1 || result.getDate() !== d) return null;
  result.setHours(12, 0, 0, 0);
  return result;
}

function pushCandidate(list, index, year, month, day) {
  const date = validDate(year, month, day);
  if (date) list.push({ index, date });
}

export function findAllDates(text) {
  const value = normalizeText(text);
  if (!value.trim()) return [];
  const result = [];

  for (const match of value.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    pushCandidate(result, match.index ?? 0, match[1], match[2], match[3]);
  }

  for (const match of value.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) {
    pushCandidate(result, match.index ?? 0, match[3], match[2], match[1]);
  }

  const wordPattern = new RegExp(
    `\\b(\\d{1,2})\\s+(?:de\\s+)?(${[...MONTH_ALIASES.keys()].join("|")})(?:\\s+(?:de\\s+)?)?(\\d{4})\\b`,
    "gi"
  );
  const normalizedForMonth = removeAccents(value).toLowerCase();
  for (const match of normalizedForMonth.matchAll(wordPattern)) {
    const month = MONTH_ALIASES.get(match[2].toLowerCase());
    if (month) pushCandidate(result, match.index ?? 0, match[3], month, match[1]);
  }

  const dedup = new Map();
  for (const item of result.sort((a, b) => a.index - b.index)) {
    const key = `${item.index}:${toISO(item.date)}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }
  return [...dedup.values()];
}

export function extractDate(text) {
  return findAllDates(text)[0]?.date || null;
}

export function toISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function fromISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return validDate(year, month, day);
}

export function formatFull(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function formatShort(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatMonthYear(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const text = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function sameDay(a, b) {
  return Boolean(a && b) && toISO(a) === toISO(b);
}

export function firstDayOfMonth(date) {
  const result = new Date(date || Date.now());
  result.setDate(1);
  result.setHours(12, 0, 0, 0);
  return result;
}

export function addMonths(date, amount) {
  const result = firstDayOfMonth(date);
  result.setMonth(result.getMonth() + amount);
  return result;
}

export function monthKey(date) {
  const d = firstDayOfMonth(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const MONTH_NAMES = Object.freeze(MONTHS);

