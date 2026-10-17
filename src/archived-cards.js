import { addMonths, extractDate, firstDayOfMonth, formatMonthYear, formatShort, sameDay, toISO } from "./date-parser.js";

const $ = (root, selector) => root.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function cardDate(card) {
  if (card.sent_date) {
    const date = new Date(`${card.sent_date}T12:00:00`);
    if (!Number.isNaN(date.valueOf())) return date;
  }
  return extractDate(card.body || "");
}

function titleFromBody(body) {
  const lines = String(body || "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => !/^\d{1,4}[/.\-]/.test(line) && line.length > 3) || lines[0];
  if (!candidate) return "Carta sem conteúdo";
  return candidate.length > 74 ? `${candidate.slice(0, 71).trimEnd()}…` : candidate;
}

export function archivedCardsMarkup() {
  return `<section class="panel home-card archived-cards" aria-label="Minhas cartas">
    <div class="overview">
      <div class="overview-card"><div class="overview-label">Coleção</div><div class="lista-titulo">Minhas Cartas</div><div class="collection-note" data-card-collection-note>Carregando cartas…</div></div>
      <div class="contador" data-card-read-count>0/0 lidas</div>
    </div>
    <div class="filters" aria-label="Filtros das cartas">
      <button class="filter-button active" type="button" data-card-filter="all" aria-pressed="true">Todas</button>
      <button class="filter-button" type="button" data-card-calendar-toggle aria-controls="archiveCalendar" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 2.8v4M16 2.8v4M3 9h18"/></svg>Filtrar por data</button>
      <button class="filter-button" type="button" data-card-filter="no-date" hidden aria-pressed="false">Sem data</button>
      <span class="filter-status" data-card-filter-status>Mostrando todas as cartas</span>
    </div>
    <div class="calendar-panel" id="archiveCalendar" aria-hidden="true">
      <div class="calendar-card"><div class="calendar-head"><div class="calendar-month" data-calendar-month>Calendário</div><div class="calendar-nav"><button type="button" data-calendar="previous" aria-label="Mês anterior">‹</button><button type="button" data-calendar="next" aria-label="Próximo mês">›</button></div></div>
        <div class="weekdays" aria-hidden="true"><span class="weekday">Dom</span><span class="weekday">Seg</span><span class="weekday">Ter</span><span class="weekday">Qua</span><span class="weekday">Qui</span><span class="weekday">Sex</span><span class="weekday">Sáb</span></div>
        <div class="calendar-grid" data-calendar-grid aria-label="Calendário das cartas"></div><div class="calendar-foot"><span><strong>•</strong> dia com cartas</span><span data-calendar-info>Selecione uma data</span></div>
      </div>
    </div>
    <div class="cartas-container" data-archived-cards aria-live="polite"><div class="loading-state">Carregando cartas…</div></div>
    <p class="loading-summary" data-card-load-status role="status" aria-live="polite"></p>
    <div class="empty-state" data-card-empty hidden><strong>Nenhuma carta encontrada</strong>Não há cartas correspondentes ao filtro selecionado.</div>
  </section>
  <div class="modal" data-archive-card-modal aria-hidden="true" role="presentation" inert>
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="archiveCardTitle" aria-describedby="archiveCardText">
      <article class="modal-sheet"><header class="modal-header"><div><div class="modal-label">Carta</div><h2 data-archive-card-title id="archiveCardTitle">Carta</h2><div class="modal-date" data-archive-card-date></div></div>
        <div class="modal-tools"><button type="button" data-card-previous aria-label="Carta anterior">‹</button><button type="button" data-card-next aria-label="Próxima carta">›</button><button class="modal-close" type="button" data-card-close aria-label="Fechar carta">×</button></div>
      </header>
      <div data-archive-card-unlock hidden><div style="padding:22px"><p style="margin:0 0 6px;color:var(--paper-text);font-weight:800;font-size:16px">Esta carta está protegida.</p><p data-archive-card-hint style="margin:0 0 18px;color:#8b7f72;font-size:13px;line-height:1.5"></p><div class="form-field"><label class="form-label" for="archiveCardPassword">Senha</label><div class="input-wrap"><input class="input password-input" id="archiveCardPassword" type="password" autocomplete="current-password" placeholder="Digite a senha"></div></div><button class="login-button" type="button" data-card-unlock>Desbloquear carta</button><div class="form-message" data-card-unlock-error role="alert" aria-live="assertive"></div></div></div>
      <div class="modal-text" data-archive-card-text id="archiveCardText" tabindex="0" aria-live="polite"></div><footer class="modal-footer"><button type="button" data-card-close>Fechar carta</button></footer>
      </article>
    </div>
  </div>`;
}

export async function loadArchivedCards(client, userId) {
  const [{ data: cards, error: cardsError }, { data: reads, error: readsError }] = await Promise.all([
    client.from("archived_cards").select("id,recipient_id,original_file,card_number,is_private,is_protected,password_hint,body,sent_date")
      .eq("recipient_id", userId).order("is_private", { ascending: false }).order("card_number", { ascending: true }),
    client.from("archived_card_reads").select("card_id,read_at").eq("user_id", userId)
  ]);
  if (cardsError) throw cardsError;
  if (readsError) throw readsError;
  return { cards: (cards || []).map((card) => ({ ...card, date: cardDate(card), unlocked: false })), reads: reads || [] };
}

function visibleCards(state) {
  if (state.filter === "no-date") return state.cards.filter((card) => !card.date);
  if (state.filterDate) return state.cards.filter((card) => card.date && toISO(card.date) === state.filterDate);
  return state.cards;
}

function updateOverview(root, state) {
  const count = $(root, "[data-card-read-count]");
  const note = $(root, "[data-card-collection-note]");
  const filterStatus = $(root, "[data-card-filter-status]");
  const noDateButton = $(root, '[data-card-filter="no-date"]');
  const readCount = state.readIds.size;
  if (count) count.textContent = `${readCount}/${state.cards.length} lidas`;
  if (note) note.textContent = `${state.cards.length} cartas`;
  if (noDateButton) noDateButton.hidden = !state.cards.some((card) => !card.date);
  if (filterStatus) {
    filterStatus.textContent = state.filterDate
      ? `Cartas de ${formatShort(new Date(`${state.filterDate}T12:00:00`))}`
      : state.filter === "no-date" ? "Cartas sem data" : "Mostrando todas as cartas";
  }
}

function renderRows(root, state) {
  const container = $(root, "[data-archived-cards]");
  const empty = $(root, "[data-card-empty]");
  if (!container) return;
  container.replaceChildren();
  const cards = visibleCards(state);
  for (const card of cards) {
    const row = document.createElement("article");
    const number = Number(card.card_number) || 0;
    row.className = `card-row${card.is_protected ? " is-protected" : ""}`;
    row.dataset.cardId = card.id;
    row.dataset.number = String(number);
    row.dataset.private = card.is_private ? "true" : "false";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    const label = card.is_private ? "Carta privada" : "Carta";
    const title = card.is_protected ? (card.is_private ? "Carta privada protegida" : "Carta protegida") : titleFromBody(card.body);
    row.innerHTML = `<div class="card-number" aria-hidden="true">${String(number).padStart(2, "0")}</div><div class="card-info"><span class="card-label">${label} ${String(number).padStart(2, "0")}${card.is_protected ? " 🔒" : ""}</span><h3 class="card-title"></h3><p class="card-date"></p></div><span class="card-check" aria-label=""></span>`;
    row.querySelector(".card-title").textContent = title;
    const date = row.querySelector(".card-date");
    date.textContent = card.date ? formatShort(card.date) : "Sem data";
    date.classList.toggle("is-empty", !card.date);
    const check = row.querySelector(".card-check");
    const isRead = state.readIds.has(card.id);
    check.textContent = isRead ? "✓" : "○";
    check.classList.toggle("is-read", isRead);
    check.setAttribute("aria-label", isRead ? "Carta lida" : "Carta não lida");
    container.append(row);
  }
  if (empty) empty.hidden = cards.length > 0;
  if (!state.cards.length) {
    container.innerHTML = `<div class="empty-state"><strong>Nenhuma carta disponível</strong></div>`;
    if (empty) empty.hidden = true;
  }
  updateOverview(root, state);
  renderCalendar(root, state);
  updateModalNavigation(root, state);
}

function renderCalendar(root, state) {
  const grid = $(root, "[data-calendar-grid]");
  const monthLabel = $(root, "[data-calendar-month]");
  const info = $(root, "[data-calendar-info]");
  if (!grid || !monthLabel) return;
  const month = firstDayOfMonth(state.calendarMonth);
  monthLabel.textContent = formatMonthYear(month);
  const offset = month.getDay();
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  grid.replaceChildren();
  for (let index = 0; index < offset; index += 1) {
    const blank = document.createElement("span");
    blank.className = "calendar-blank";
    grid.append(blank);
  }
  for (let day = 1; day <= dayCount; day += 1) {
    const date = new Date(month.getFullYear(), month.getMonth(), day, 12);
    const iso = toISO(date);
    const hasCards = state.cards.some((card) => card.date && toISO(card.date) === iso);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day${hasCards ? " has-cards" : ""}${state.filterDate === iso ? " is-selected" : ""}`;
    button.dataset.calendarDate = iso;
    button.disabled = !hasCards;
    button.textContent = String(day);
    button.setAttribute("aria-label", `${day} de ${formatMonthYear(month)}${hasCards ? ", com cartas" : ", sem cartas"}`);
    grid.append(button);
  }
  if (info) info.textContent = state.filterDate ? `Filtrado por ${formatShort(new Date(`${state.filterDate}T12:00:00`))}` : "Selecione um dia com cartas";
}

function setModal(root, open) {
  const modal = $(root, "[data-archive-card-modal]");
  if (!modal) return;
  modal.classList.toggle("is-open", open);
  modal.setAttribute("aria-hidden", String(!open));
  if (open) modal.removeAttribute("inert");
  else modal.setAttribute("inert", "");
  document.body.classList.toggle("modal-open", open);
}

function updateModalNavigation(root, state) {
  const current = state.cards.find((card) => card.id === state.modalCardId);
  const rows = visibleCards(state).filter((card) => !card.is_protected || card.unlocked);
  const index = rows.findIndex((card) => card.id === current?.id);
  const previous = $(root, "[data-card-previous]");
  const next = $(root, "[data-card-next]");
  if (previous) previous.disabled = index <= 0;
  if (next) next.disabled = index < 0 || index >= rows.length - 1;
}

async function markRead(root, client, userId, state, card) {
  if (state.readIds.has(card.id)) return;
  const { error } = await client.from("archived_card_reads").upsert({ card_id: card.id, user_id: userId, read_at: new Date().toISOString() }, { onConflict: "card_id,user_id" });
  if (error) {
    const status = $(root, "[data-card-load-status]");
    if (status) status.textContent = "Carta aberta. O estado de leitura não foi sincronizado.";
    return;
  }
  state.readIds.add(card.id);
  renderRows(root, state);
}

function showCard(root, state, card) {
  if (!card) return;
  state.modalCardId = card.id;
  const title = $(root, "[data-archive-card-title]");
  const date = $(root, "[data-archive-card-date]");
  const text = $(root, "[data-archive-card-text]");
  const unlock = $(root, "[data-archive-card-unlock]");
  const hint = $(root, "[data-archive-card-hint]");
  const password = $(root, "#archiveCardPassword");
  const unlockError = $(root, "[data-card-unlock-error]");
  const locked = Boolean(card.is_protected && !card.unlocked);
  if (title) title.textContent = locked ? "Carta protegida" : card.is_private ? "Carta privada" : titleFromBody(card.body);
  if (date) date.textContent = card.date ? formatShort(card.date) : "";
  if (hint) hint.textContent = locked ? (card.password_hint || "") : "";
  if (password) password.value = "";
  if (unlockError) unlockError.textContent = "";
  if (unlock) unlock.hidden = !locked;
  if (text) {
    text.hidden = locked;
    text.textContent = locked ? "" : card.body || "Carta sem conteúdo";
  }
  setModal(root, true);
  if (!locked) {
    markRead(root, state.client, state.userId, state, card).catch(() => {});
    requestAnimationFrame(() => text?.focus());
  } else requestAnimationFrame(() => password?.focus());
  updateModalNavigation(root, state);
}

export function bindArchivedCards(root, client, userId, { cards, reads }) {
  const state = {
    // The previous Looply collection placed private cards before the numbered cards.
    cards: [...cards].sort((a, b) => Number(b.is_private) - Number(a.is_private) || a.card_number - b.card_number),
    readIds: new Set(reads.map((item) => item.card_id)),
    filter: "all", filterDate: null, calendarMonth: firstDayOfMonth(cards.find((item) => item.date)?.date || new Date()),
    modalCardId: null, client, userId
  };
  const status = $(root, "[data-card-load-status]");
  if (status) status.textContent = `${cards.length} carta(s) carregada(s) da nuvem.`;
  renderRows(root, state);

  root.addEventListener("click", async (event) => {
    const filter = event.target.closest("[data-card-filter]");
    if (filter) {
      state.filter = filter.dataset.cardFilter;
      state.filterDate = null;
      root.querySelectorAll("[data-card-filter]").forEach((button) => {
        const active = button === filter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      renderRows(root, state);
      return;
    }
    const calendarToggle = event.target.closest("[data-card-calendar-toggle]");
    if (calendarToggle) {
      const panel = $(root, "#archiveCalendar");
      const open = panel?.getAttribute("aria-hidden") !== "false";
      if (panel) {
        panel.setAttribute("aria-hidden", String(!open));
        panel.classList.toggle("is-open", open);
      }
      calendarToggle.setAttribute("aria-expanded", String(open));
      return;
    }
    const calendarNav = event.target.closest("[data-calendar]");
    if (calendarNav) {
      state.calendarMonth = addMonths(state.calendarMonth, calendarNav.dataset.calendar === "next" ? 1 : -1);
      renderCalendar(root, state);
      return;
    }
    const dateButton = event.target.closest("[data-calendar-date]");
    if (dateButton) {
      state.filter = "date";
      state.filterDate = dateButton.dataset.calendarDate;
      root.querySelectorAll("[data-card-filter]").forEach((button) => {
        const active = button.dataset.cardFilter === "all" && !state.filterDate;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      renderRows(root, state);
      return;
    }
    const close = event.target.closest("[data-card-close]");
    if (close || event.target.matches("[data-archive-card-modal]")) {
      setModal(root, false);
      state.modalCardId = null;
      return;
    }
    const unlockButton = event.target.closest("[data-card-unlock]");
    if (unlockButton) {
      const card = state.cards.find((item) => item.id === state.modalCardId);
      const password = $(root, "#archiveCardPassword");
      const error = $(root, "[data-card-unlock-error]");
      unlockButton.disabled = true;
      try {
        const suppliedPassword = String(password?.value || "");
        if (!card || suppliedPassword.length < 1 || suppliedPassword.length > 256) throw new Error("password");
        const { data, error: invokeError } = await client.functions.invoke("looply-admin", {
          body: { action: "unlock_archived_card", cardId: card.id, password: suppliedPassword }
        });
        if (data?.error === "too_many_unlock_attempts" || invokeError?.context?.status === 429) {
          if (error) error.textContent = "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.";
          if (password) password.value = "";
          return;
        }
        if (invokeError) throw invokeError;
        if (data?.error === "incorrect_password") {
          if (error) error.textContent = "Senha incorreta.";
          if (password) password.value = "";
        } else if (typeof data?.body === "string") {
          card.body = data.body;
          card.unlocked = true;
          showCard(root, state, card);
        } else throw new Error("unlock_unavailable");
      } catch (failure) {
        console.error("Looply archived card unlock failed");
        if (error) error.textContent = "Não foi possível verificar a senha. Confira a conexão e tente novamente.";
      } finally { unlockButton.disabled = false; }
      return;
    }
    const previous = event.target.closest("[data-card-previous]");
    const next = event.target.closest("[data-card-next]");
    if (previous || next) {
      const visible = visibleCards(state).filter((card) => !card.is_protected || card.unlocked);
      const index = visible.findIndex((card) => card.id === state.modalCardId);
      showCard(root, state, visible[index + (previous ? -1 : 1)]);
      return;
    }
    const row = event.target.closest("[data-card-id]");
    if (row) showCard(root, state, state.cards.find((card) => card.id === row.dataset.cardId));
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $(root, "[data-archive-card-modal]")?.classList.contains("is-open")) {
      setModal(root, false);
      state.modalCardId = null;
    }
    if (event.key === "Enter" || event.key === " ") {
      const row = event.target.closest("[data-card-id]");
      if (row) { event.preventDefault(); showCard(root, state, state.cards.find((card) => card.id === row.dataset.cardId)); }
    }
    if (event.key === "Enter" && event.target.matches("#archiveCardPassword")) $(root, "[data-card-unlock]")?.click();
  });
}


