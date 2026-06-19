import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  IExtensionDataManager,
  IExtensionDataService,
  getClient,
} from "azure-devops-extension-api";
import { WorkItemTrackingRestClient, WorkItemType } from "azure-devops-extension-api/WorkItemTracking";
import {
  DEFAULT_CARD_VALUES,
  DEFAULT_SETTINGS,
  PokerSettings,
  loadCardValues,
  loadSettings,
  saveCardValues,
  saveSettings,
} from "./config-data";
import { escapeHtml } from "./utils";
import "./config.css";

let dm: IExtensionDataManager;
let cards: string[] = [];
let settings: PokerSettings = { ...DEFAULT_SETTINGS, disabledStates: [...DEFAULT_SETTINGS.disabledStates], witOverrides: {} };
let witTypes: WorkItemType[] = [];
const openWits = new Set<string>();
let dragIdx: number | null = null;
let witDrag: { wit: string; idx: number } | null = null;

function render(status?: { text: string; error?: boolean }): void {
  const root = document.getElementById("root");
  if (!root) return;

  const cardChips = cards
    .map(
      (v, i) =>
        `<span class="cfg-chip" draggable="true" data-index="${i}">
          <span class="cfg-chip-handle" title="Drag to reorder">⠿</span>
          <span class="cfg-chip-label">${escapeHtml(v)}</span>
          <button class="cfg-chip-remove" data-index="${i}" data-list="cards" title="Remove">×</button>
        </span>`
    )
    .join("");

  const stateChips =
    settings.disabledStates
      .map(
        (s, i) =>
          `<span class="cfg-chip">
            <span class="cfg-chip-label">${escapeHtml(s)}</span>
            <button class="cfg-chip-remove" data-index="${i}" data-list="states" title="Remove">×</button>
          </span>`
      )
      .join("") || `<span class="cfg-hint">None — voting will show for all states.</span>`;

  const pollOptions = [0, 3, 5, 10]
    .map((v) => {
      const label = v === 0 ? "Off" : `${v} seconds`;
      const sel = settings.pollIntervalSeconds === v ? " selected" : "";
      return `<option value="${v}"${sel}>${label}</option>`;
    })
    .join("");

  const isDefault =
    JSON.stringify(cards) === JSON.stringify(DEFAULT_CARD_VALUES) &&
    JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS);

  const statusHtml = status
    ? `<span class="cfg-status${status.error ? " cfg-status--error" : ""}">${escapeHtml(status.text)}</span>`
    : "";

  root.innerHTML = `
    <div class="cfg-container">
      <section class="cfg-section">
        <h2 class="cfg-heading">Card Values</h2>
        <p class="cfg-description">
          Set the global default card values and order for a voting session.
        </p>
        <div class="cfg-chips" id="chip-list">${cardChips}</div>
        <div class="cfg-add-row">
          <input class="cfg-input" id="new-value" type="text" maxlength="6"
                 placeholder="New value…" autocomplete="off" />
          <button class="cfg-btn cfg-btn--primary" id="btn-add">Add</button>
        </div>
      </section>

      <section class="cfg-section">
        <h2 class="cfg-heading">Behaviour</h2>

        <div class="cfg-field">
          <label class="cfg-field-label">Disabled states</label>
          <p class="cfg-description">Work item states where the voting panel is disabled.</p>
          <div class="cfg-chips" id="state-chip-list">${stateChips}</div>
          <div class="cfg-add-row">
            <input class="cfg-input" id="new-state" type="text" maxlength="32"
                   placeholder="State name…" autocomplete="off" />
            <button class="cfg-btn cfg-btn--primary" id="btn-add-state">Add</button>
          </div>
        </div>

        <div class="cfg-field">
          <label class="cfg-toggle-label">
            <input type="checkbox" id="chk-post-comment" ${settings.postComment ? "checked" : ""} />
            Post a comment to the work item when voting ends
          </label>
        </div>

        <div class="cfg-field">
          <label class="cfg-field-label" for="sel-poll-interval">Auto-refresh interval</label>
          <select class="cfg-select" id="sel-poll-interval">${pollOptions}</select>
        </div>

        <div class="cfg-field">
          <label class="cfg-toggle-label">
            <input type="checkbox" id="chk-anonymous" ${settings.anonymousVoting ? "checked" : ""} />
            Anonymous voting — hide voter names until End Voting
          </label>
        </div>

        <div class="cfg-field">
          <label class="cfg-toggle-label">
            <input type="checkbox" id="chk-show-settings" ${settings.showSettings ? "checked" : ""} />
            Show settings cog (⚙) to all users
          </label>
        </div>
      </section>

      ${buildWitSection()}

      <div class="cfg-footer">
        <button class="cfg-btn cfg-btn--primary" id="btn-save">Save</button>
        <button class="cfg-btn cfg-btn--ghost" id="btn-reset"
                ${isDefault ? "disabled" : ""}>Reset to defaults</button>
        ${statusHtml}
      </div>
    </div>`;

  attachEvents();
}

function attachDrag(): void {
  const chips = document.querySelectorAll<HTMLElement>("#chip-list .cfg-chip");

  chips.forEach((chip) => {
    chip.addEventListener("dragstart", (e) => {
      dragIdx = parseInt(chip.dataset.index!, 10);
      chip.classList.add("cfg-chip--dragging");
      e.dataTransfer!.effectAllowed = "move";
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("cfg-chip--dragging");
      document.querySelectorAll(".cfg-chip--over").forEach((el) => el.classList.remove("cfg-chip--over"));
    });
    chip.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      chip.classList.add("cfg-chip--over");
    });
    chip.addEventListener("dragleave", () => chip.classList.remove("cfg-chip--over"));
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      chip.classList.remove("cfg-chip--over");
      const dest = parseInt(chip.dataset.index!, 10);
      if (dragIdx === null || dragIdx === dest) return;
      const [moved] = cards.splice(dragIdx, 1);
      cards.splice(dest, 0, moved);
      dragIdx = null;
      render();
    });
  });
}

function attachEvents(): void {
  attachDrag();

  // Remove chip (cards or disabled states)
  document.querySelectorAll<HTMLButtonElement>(".cfg-chip-remove:not([data-list='wit'])").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index!, 10);
      if (btn.dataset.list === "states") settings.disabledStates.splice(idx, 1);
      else if (btn.dataset.list === "cards") cards.splice(idx, 1);
      render();
    });
  });

  const cardInput = document.getElementById("new-value") as HTMLInputElement;
  const addCard = () => {
    const raw = cardInput.value.trim();
    if (!raw) return;
    if (cards.includes(raw)) { render({ text: `"${raw}" is already in the list.`, error: true }); return; }
    cards.push(raw);
    render();
    (document.getElementById("new-value") as HTMLInputElement)?.focus();
  };
  document.getElementById("btn-add")?.addEventListener("click", addCard);
  cardInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addCard(); });

  const stateInput = document.getElementById("new-state") as HTMLInputElement;
  const addState = () => {
    const raw = stateInput.value.trim();
    if (!raw) return;
    if (settings.disabledStates.includes(raw)) { render({ text: `"${raw}" is already in the list.`, error: true }); return; }
    settings.disabledStates.push(raw);
    render();
    (document.getElementById("new-state") as HTMLInputElement)?.focus();
  };
  document.getElementById("btn-add-state")?.addEventListener("click", addState);
  stateInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addState(); });

  document.getElementById("btn-save")?.addEventListener("click", async () => {
    if (cards.length === 0) { render({ text: "You need at least one card value.", error: true }); return; }
    settings.postComment = (document.getElementById("chk-post-comment") as HTMLInputElement).checked;
    settings.pollIntervalSeconds = parseInt((document.getElementById("sel-poll-interval") as HTMLSelectElement).value, 10);
    settings.anonymousVoting = (document.getElementById("chk-anonymous") as HTMLInputElement).checked;
    settings.showSettings = (document.getElementById("chk-show-settings") as HTMLInputElement).checked;
    try {
      await saveCardValues(dm, cards);
      await saveSettings(dm, settings);
      render({ text: "Saved." });
    } catch (e) {
      render({ text: `Save failed: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
  });

  document.getElementById("btn-reset")?.addEventListener("click", () => {
    cards = [...DEFAULT_CARD_VALUES];
    settings = { ...DEFAULT_SETTINGS, disabledStates: [...DEFAULT_SETTINGS.disabledStates], witOverrides: {} };
    openWits.clear();
    render();
  });

  attachWitEvents();
}

// ─── Work Item Type section ───────────────────────────────────────────────────

async function fetchWitTypes(): Promise<WorkItemType[]> {
  try {
    const project = SDK.getPageContext().webContext?.project?.name;
    if (!project) return [];
    const types = await getClient(WorkItemTrackingRestClient).getWorkItemTypes(project);
    return types.filter((t) => !t.isDisabled).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function buildWitSection(): string {
  if (witTypes.length === 0) return "";

  const rows = witTypes
    .map((wit) => {
      const key = wit.name;
      const override = settings.witOverrides[key];
      const enabled = override?.enabled !== false;
      const expanded = openWits.has(key);
      const customCards = override?.cardValues;
      const inputId = `wit-input-${key.replace(/\W/g, "_")}`;

      const iconHtml = wit.icon?.url
        ? `<span class="cfg-wit-badge" style="background:#${escapeHtml(wit.color ?? "888")}">` +
          `<img src="${escapeHtml(wit.icon.url)}" class="cfg-wit-icon-img" alt="" /></span>`
        : `<span class="cfg-wit-badge" style="background:#${escapeHtml(wit.color ?? "888")}"></span>`;

      let cardsHtml: string;
      if (expanded && customCards) {
        const chips = customCards
          .map(
            (v, i) =>
              `<span class="cfg-chip" draggable="true" data-wit-chip="${escapeHtml(key)}" data-index="${i}">` +
              `<span class="cfg-chip-handle" title="Drag to reorder">⠇</span>` +
              `<span class="cfg-chip-label">${escapeHtml(v)}</span>` +
              `<button class="cfg-chip-remove" data-list="wit" data-wit="${escapeHtml(key)}" data-index="${i}" title="Remove">\u00d7</button>` +
              `</span>`
          )
          .join("");
        cardsHtml =
          `<div class="cfg-wit-chips">${chips}</div>` +
          `<div class="cfg-wit-add-row">` +
          `<input class="cfg-input cfg-input--sm" id="${inputId}" type="text" maxlength="6"` +
          ` data-wit="${escapeHtml(key)}" placeholder="Add\u2026" autocomplete="off" />` +
          `<button class="cfg-btn cfg-btn--primary cfg-btn--sm" data-wit="${escapeHtml(key)}" data-action="wit-add">Add</button>` +
          `<button class="cfg-btn cfg-btn--ghost cfg-btn--sm" data-wit="${escapeHtml(key)}" data-action="wit-use-global">Reset</button>` +
          `</div>`;
      } else if (customCards && customCards.length > 0) {
        const preview = customCards.slice(0, 6).map(escapeHtml).join("  ");
        const more = customCards.length > 6 ? `  +${customCards.length - 6}` : "";
        cardsHtml =
          `<span class="cfg-wit-cards-preview">${preview}${escapeHtml(more)}</span>` +
          `<button class="cfg-btn cfg-btn--ghost cfg-btn--sm" data-wit="${escapeHtml(key)}" data-action="wit-expand">Edit</button>` +
          `<button class="cfg-btn cfg-btn--ghost cfg-btn--sm" data-wit="${escapeHtml(key)}" data-action="wit-use-global">Reset</button>`;
      } else {
        cardsHtml =
          `<span class="cfg-hint">Global defaults</span>` +
          `<button class="cfg-btn cfg-btn--ghost cfg-btn--sm" data-wit="${escapeHtml(key)}" data-action="wit-expand">Customise</button>`;
      }

      return (
        `<div class="cfg-wit-row${enabled ? "" : " cfg-wit-row--disabled"}">` +
        `<label class="cfg-wit-toggle-label" title="${enabled ? "Disable" : "Enable"} for ${escapeHtml(wit.name)}">` +
        `<input type="checkbox" class="cfg-wit-toggle" data-wit="${escapeHtml(key)}" ${enabled ? "checked" : ""} />` +
        `</label>` +
        `<span class="cfg-wit-type">${iconHtml}<span class="cfg-wit-name">${escapeHtml(wit.name)}</span></span>` +
        `<div class="cfg-wit-cards-cell">${cardsHtml}</div>` +
        `</div>`
      );
    })
    .join("");

  return (
    `<section class="cfg-section">` +
    `<h2 class="cfg-heading">Work Item Types</h2>` +
    `<p class="cfg-description">Override the panel behaviour and card values per work item type. Untick a type to disable the Planning Poker panel for it.<br />` +
    `To remove the panel entirely for a type, go to <strong>Project Settings → Process → <em>Type</em> → Layout</strong> and hide the group.</p>` +
    `<div class="cfg-wit-table">${rows}</div>` +
    `</section>`
  );
}

function attachWitEvents(): void {
  // Toggle enable/disable per WIT
  document.querySelectorAll<HTMLInputElement>(".cfg-wit-toggle").forEach((chk) => {
    chk.addEventListener("change", () => {
      const wit = chk.dataset.wit!;
      const override = settings.witOverrides[wit] ?? { enabled: true };
      override.enabled = chk.checked;
      if (override.enabled && !override.cardValues) delete settings.witOverrides[wit];
      else settings.witOverrides[wit] = override;
      render();
    });
  });

  // Action buttons: expand, use-global, add
  document.querySelectorAll<HTMLButtonElement>("[data-action^='wit-']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wit = btn.dataset.wit!;
      const action = btn.dataset.action!;
      if (action === "wit-expand") {
        if (!settings.witOverrides[wit]) {
          settings.witOverrides[wit] = { enabled: true, cardValues: [...cards] };
        } else if (!settings.witOverrides[wit].cardValues) {
          settings.witOverrides[wit].cardValues = [...cards];
        }
        openWits.add(wit);
        render();
      } else if (action === "wit-use-global") {
        openWits.delete(wit);
        if (settings.witOverrides[wit]) {
          delete settings.witOverrides[wit].cardValues;
          if (settings.witOverrides[wit].enabled !== false) delete settings.witOverrides[wit];
        }
        render();
      } else if (action === "wit-add") {
        const inputId = `wit-input-${wit.replace(/\W/g, "_")}`;
        const input = document.getElementById(inputId) as HTMLInputElement;
        const raw = input?.value.trim();
        if (!raw) return;
        const witCards = settings.witOverrides[wit]?.cardValues;
        if (!witCards) return;
        if (witCards.includes(raw)) { render({ text: `"${raw}" is already in the list.`, error: true }); return; }
        witCards.push(raw);
        render();
        (document.getElementById(inputId) as HTMLInputElement)?.focus();
      }
    });
  });

  // Remove chip from WIT card list
  document.querySelectorAll<HTMLButtonElement>(".cfg-chip-remove[data-list='wit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wit = btn.dataset.wit!;
      const idx = parseInt(btn.dataset.index!, 10);
      settings.witOverrides[wit]?.cardValues?.splice(idx, 1);
      render();
    });
  });

  // Enter key on WIT card inputs
  document.querySelectorAll<HTMLInputElement>("input[data-wit]").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const wit = input.dataset.wit!;
      const raw = input.value.trim();
      if (!raw) return;
      const witCards = settings.witOverrides[wit]?.cardValues;
      if (!witCards) return;
      if (witCards.includes(raw)) { render({ text: `"${raw}" is already in the list.`, error: true }); return; }
      witCards.push(raw);
      render();
      const inputId = `wit-input-${wit.replace(/\W/g, "_")}`;
      (document.getElementById(inputId) as HTMLInputElement)?.focus();
    });
  });

  // Drag-drop reorder for WIT card chips
  document.querySelectorAll<HTMLElement>("[data-wit-chip]").forEach((chip) => {
    chip.addEventListener("dragstart", (e) => {
      witDrag = { wit: chip.dataset.witChip!, idx: parseInt(chip.dataset.index!, 10) };
      chip.classList.add("cfg-chip--dragging");
      e.dataTransfer!.effectAllowed = "move";
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("cfg-chip--dragging");
      document.querySelectorAll(".cfg-chip--over").forEach((el) => el.classList.remove("cfg-chip--over"));
    });
    chip.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      chip.classList.add("cfg-chip--over");
    });
    chip.addEventListener("dragleave", () => chip.classList.remove("cfg-chip--over"));
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      chip.classList.remove("cfg-chip--over");
      const dest = parseInt(chip.dataset.index!, 10);
      if (!witDrag || witDrag.wit !== chip.dataset.witChip || witDrag.idx === dest) return;
      const witCards = settings.witOverrides[witDrag.wit]?.cardValues;
      if (!witCards) return;
      const [moved] = witCards.splice(witDrag.idx, 1);
      witCards.splice(dest, 0, moved);
      witDrag = null;
      render();
    });
  });
}

async function init(): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });

  const token = await SDK.getAccessToken();
  const extSvc = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
  dm = await extSvc.getExtensionDataManager(SDK.getExtensionContext().id, token);

  [cards, settings, witTypes] = await Promise.all([
    loadCardValues(dm),
    loadSettings(dm),
    fetchWitTypes(),
  ]);
  render();

  await SDK.notifyLoadSucceeded();
}

init().catch((err: unknown) => {
  const root = document.getElementById("root");
  if (root) {
    const msg = err instanceof Error ? err.message : String(err);
    root.innerHTML = `<div class="cfg-error">Failed to load settings: ${escapeHtml(msg)}</div>`;
  }
  SDK.notifyLoadSucceeded().catch(() => undefined);
});

