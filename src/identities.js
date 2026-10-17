export const ALLOWED_USERNAMES = Object.freeze(["patati", "misol", "yara", "peixinho"]);

export function isAllowedUsername(value) {
  return ALLOWED_USERNAMES.includes(String(value ?? "").trim().toLowerCase());
}

const AUTH_EMAIL_DOMAIN = "loooply.app";

export function emailForUsername(value) {
  const username = String(value ?? "").trim().toLowerCase();
  return isAllowedUsername(username) ? `${username}@${AUTH_EMAIL_DOMAIN}` : null;
}
