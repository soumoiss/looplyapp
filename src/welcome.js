export function welcomeGreeting(username) {
  const normalized = String(username || "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
  return ["misol", "missol", "yara", "iara"].includes(normalized) ? "Bem-vinda" : "Bem-vindo";
}
