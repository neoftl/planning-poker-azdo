import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  IExtensionDataManager,
  IExtensionDataService,
  IHostNavigationService,
  ILocationService,
  getClient,
} from "azure-devops-extension-api";
import { Operation } from "azure-devops-extension-api/WebApi/WebApi";
import {
  IWorkItemFormService,
  WorkItemTrackingRestClient,
  WorkItemTrackingServiceIds,
} from "azure-devops-extension-api/WorkItemTracking";
import { DEFAULT_CARD_VALUES, DEFAULT_SETTINGS, PokerSettings, loadCardValues, loadSettings } from "./config-data";
import { escapeHtml } from "./utils";
import "./poker.css";

const COLLECTION = "planning-poker-sessions";
// Hub slug — must match contribution id in vss-extension.json
const HUB_SLUG = "NeoFintechLab.planning-poker.planning-poker-settings-hub";

let CARD_VALUES: string[] = [...DEFAULT_CARD_VALUES];
let settings: PokerSettings = { ...DEFAULT_SETTINGS, disabledStates: [...DEFAULT_SETTINGS.disabledStates], witOverrides: {} };

interface Vote {
  displayName: string;
  imageUrl?: string;
  hasVoted: boolean;
  value: string | null;
}

interface Session {
  id: string;
  votes: Record<string, Vote>;
  state: "voting" | "revealed";
  __etag?: number; // optimistic concurrency — must be preserved (AzDO error 1660003)
}

let dm: IExtensionDataManager;
let witSvc: IWorkItemFormService;
let wiId: number;
let userId: string;
let userName: string;
let userImg: string;
let lastJson = "";
let disabled = false;
let witType = "";
let pollTimer: ReturnType<typeof setInterval> | null = null;

function sessId(): string {
  return `wi-${wiId}`;
}

async function loadSession(): Promise<Session> {
  try {
    return (await dm.getDocument(COLLECTION, sessId())) as Session;
  } catch {
    // doc not yet retreived — start fresh
    return { id: sessId(), votes: {}, state: "voting" };
  }
}

async function saveSession(s: Session): Promise<void> {
  await dm.setDocument(COLLECTION, s);
}

async function castVote(value: string): Promise<void> {
  const s = await loadSession();
  if (s.state === "revealed") return;
  const existing = s.votes[userId];
  if (existing?.value === value) {
    delete s.votes[userId];
  } else {
    s.votes[userId] = { displayName: userName, imageUrl: userImg, hasVoted: true, value };
  }
  await saveSession(s);
  render(s);
}

async function endVoting(): Promise<void> {
  const s = await loadSession();
  s.state = "revealed";
  await saveSession(s);
  if (settings.postComment) await postComment(s);
  render(s);
}

async function newRound(): Promise<void> {
  // Carry __etag to avoid version mismatch (error 1660003)
  const cur = await loadSession();
  const fresh: Session = { id: sessId(), votes: {}, state: "voting", __etag: cur.__etag };
  await saveSession(fresh);
  render(fresh);
}

async function resume(): Promise<void> {
  const s = await loadSession();
  s.state = "voting";
  await saveSession(s);
  render(s);
}

async function postComment(s: Session): Promise<void> {
  const voted = sortVotes(Object.values(s.votes).filter((v) => v.hasVoted));
  if (voted.length === 0) return;
  const groups = groupVotes(voted);
  const rows = Array.from(groups)
    .map(([val, group]) =>
      `<tr><td><b>${escapeHtml(val)}</b></td><td>${group.map((v) => escapeHtml(v.displayName)).join(", ")}</td></tr>`
    )
    .join("");
  const html =
    `<b>Planning Poker Results</b>` +
    `<table><thead><tr><th>Vote</th><th>People</th></tr></thead><tbody>${rows}</tbody></table>`;
  try {
    await getClient(WorkItemTrackingRestClient).updateWorkItem(
      [{ op: Operation.Add, path: "/fields/System.History", value: html, from: "" }] as never,
      wiId
    );
  } catch (e) {
    console.warn("Could not post comment:", e);
  }
}

function sortVotes(votes: Vote[]): Vote[] {
  return [...votes].sort((a, b) => {
    const ai = CARD_VALUES.indexOf(a.value ?? "");
    const bi = CARD_VALUES.indexOf(b.value ?? "");
    return (ai === -1 ? CARD_VALUES.length : ai) - (bi === -1 ? CARD_VALUES.length : bi);
  });
}

function groupVotes(votes: Vote[]): Map<string, Vote[]> {
  const sorted = sortVotes(votes);
  const map = new Map<string, Vote[]>();
  for (const v of sorted) {
    const key = v.value ?? "—";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  }
  return map;
}

function render(s: Session): void {
  const root = document.getElementById("root");
  if (!root) return;
  lastJson = JSON.stringify(s);
  if (disabled) {
    root.innerHTML = buildDisabled();
    attachHandlers("disabled");
    resize();
    return;
  }
  const myVote = s.votes[userId];
  const voters = Object.values(s.votes).filter((v) => v.hasVoted);
  root.innerHTML =
    s.state === "voting"
      ? buildVoting(myVote?.value ?? null, voters, settings.anonymousVoting)
      : buildResults(voters);
  attachHandlers(s.state);
  resize();
}

function cog(): string {
  if (!settings.showSettings) return "";
  return `<button class="pp-btn pp-btn--icon" id="btn-settings" title="Configure card values">⚙</button>`;
}

function avatar(v: Vote): string {
  return v.imageUrl
    ? `<img class="pp-avatar" src="${escapeHtml(v.imageUrl)}" alt="" />`
    : `<span class="pp-avatar pp-avatar--initials">${escapeHtml(v.displayName.charAt(0).toUpperCase())}</span>`;
}

function buildDisabled(): string {
  return `
    <div class="pp-container">
      <div class="pp-header"><div class="pp-actions">${cog()}</div></div>
      <p class="pp-hint">Voting is not available for work items in this state.</p>
    </div>`;
}

function buildVoting(myVal: string | null, voters: Vote[], anon: boolean): string {
  const cards = CARD_VALUES.map((v) => {
    const sel = myVal === v ? " pp-card--selected" : "";
    return `<button class="pp-card${sel}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`;
  }).join("");

  let chips: string;
  if (voters.length === 0) {
    chips = `<span class="pp-hint">No votes yet — be the first!</span>`;
  } else if (anon) {
    chips = `<span class="pp-hint">${voters.length} vote${voters.length === 1 ? "" : "s"} cast — names hidden until End Voting</span>`;
  } else {
    chips = voters
      .map((v) => {
        const me = v.displayName === userName ? " pp-chip--me" : "";
        return `<span class="pp-chip${me}">${avatar(v)}${escapeHtml(v.displayName)} \u2713</span>`;
      })
      .join("");
  }

  return `
    <div class="pp-container">
      <div class="pp-header">
        <span class="pp-title">Voting</span>
        <div class="pp-actions">
          <button class="pp-btn pp-btn--primary" id="btn-end">End Voting</button>
          ${cog()}
        </div>
      </div>
      <div class="pp-cards">${cards}</div>
      <div class="pp-voters">${chips}</div>
    </div>`;
}

function buildResults(voters: Vote[]): string {
  let rows: string;
  if (voters.length === 0) {
    rows = `<span class="pp-hint">No votes were cast.</span>`;
  } else {
    rows = Array.from(groupVotes(voters))
      .map(([value, group]) => {
        const names = group
          .map((v) => {
            const me = v.displayName === userName ? " pp-result-name--me" : "";
            return `<span class="pp-result-name${me}">${avatar(v)}${escapeHtml(v.displayName)}</span>`;
          })
          .join("");
        return `
          <div class="pp-result-row">
            <span class="pp-result-card">${escapeHtml(value)}</span>
            <span class="pp-result-names">${names}</span>
          </div>`;
      })
      .join("");
  }
  return `
    <div class="pp-container">
      <div class="pp-header">
        <span class="pp-title">Results</span>
        <div class="pp-actions">
          <button class="pp-btn pp-btn--icon" id="btn-resume" title="Resume Voting">↩</button>
          <button class="pp-btn pp-btn--icon" id="btn-reset" title="New Round">↺</button>
          ${cog()}
        </div>
      </div>
      <div class="pp-results">${rows}</div>
    </div>`;
}

function attachHandlers(state: Session["state"] | "disabled"): void {
  if (state === "voting") {
    document.querySelectorAll<HTMLButtonElement>(".pp-card").forEach((btn) => {
      btn.addEventListener("click", () => castVote(btn.dataset.value!).catch(console.error));
    });
    document.getElementById("btn-end")?.addEventListener("click", () => endVoting().catch(console.error));
  }
  document.getElementById("btn-resume")?.addEventListener("click", () => resume().catch(console.error));
  document.getElementById("btn-reset")?.addEventListener("click", () => newRound().catch(console.error));
  document.getElementById("btn-settings")?.addEventListener("click", () => openSettings().catch(console.error));
}

async function openSettings(): Promise<void> {
  const [nav, loc] = await Promise.all([
    SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService),
    SDK.getService<ILocationService>(CommonServiceIds.LocationService),
  ]);
  const orgUrl = await loc.getServiceLocation();
  const project = SDK.getPageContext().webContext?.project?.name;
  const base = orgUrl.endsWith("/") ? orgUrl : `${orgUrl}/`;
  const url = project
    ? `${base}${encodeURIComponent(project)}/_settings/${HUB_SLUG}`
    : `${base}_settings/${HUB_SLUG}`;
  nav.openNewWindow(url, "");
}

function resize(): void {
  const c = document.querySelector<HTMLElement>(".pp-container");
  if (c) SDK.resize(undefined, c.scrollHeight + 24);
}

function startPolling(): void {
  if (pollTimer !== null) return;
  const ms = (settings.pollIntervalSeconds ?? 5) * 1000;
  if (ms === 0) return;
  pollTimer = setInterval(async () => {
    try {
      const s = await loadSession();
      const json = JSON.stringify(s);
      if (json !== lastJson) render(s);
    } catch { /* ignore transient errors */ }
  }, ms);
}

function stopPolling(): void {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
}

async function init(): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });

  const user = SDK.getUser();
  userId = user.id;
  userName = user.displayName || user.name;
  userImg = user.imageUrl ?? "";

  witSvc = await SDK.getService<IWorkItemFormService>(WorkItemTrackingServiceIds.WorkItemFormService);
  wiId = await witSvc.getId();

  // Recieve both fields in one round-trip before loading settings
  const [rawState, rawWit] = await Promise.all([
    witSvc.getFieldValue("System.State"),
    witSvc.getFieldValue("System.WorkItemType"),
  ]);
  const state = rawState as string;
  witType = (rawWit as string) ?? "";

  // Register field change handler — fires after notifyLoadSucceeded
  SDK.register(SDK.getContributionId(), {
    onFieldChanged: async (args: { changedFields: Record<string, unknown> }) => {
      if ("System.State" in args.changedFields) {
        const next = args.changedFields["System.State"] as string;
        const now =
          new Set(settings.disabledStates).has(next) ||
          settings.witOverrides[witType]?.enabled === false;
        if (now !== disabled) {
          disabled = now;
          disabled ? stopPolling() : startPolling();
          render(await loadSession());
        }
      }
    },
  });

  const token = await SDK.getAccessToken();
  const extSvc = await SDK.getService<IExtensionDataService>(CommonServiceIds.ExtensionDataService);
  dm = await extSvc.getExtensionDataManager(SDK.getExtensionContext().id, token);

  [CARD_VALUES, settings] = await Promise.all([
    loadCardValues(dm),
    loadSettings(dm),
  ]);

  const witOverride = settings.witOverrides[witType];
  disabled = new Set(settings.disabledStates).has(state) || witOverride?.enabled === false;
  if (witOverride?.cardValues?.length) CARD_VALUES = witOverride.cardValues;

  const s = await loadSession();
  render(s);
  if (!disabled) startPolling();
  await SDK.notifyLoadSucceeded();
}

init().catch((err: unknown) => {
  const root = document.getElementById("root");
  if (root) {
    const msg = err instanceof Error ? escapeHtml(err.message) : String(err);
    root.innerHTML = `<div class="pp-error">Failed to initialise Planning Poker: ${msg}</div>`;
  }
  SDK.notifyLoadSucceeded().catch(() => undefined);
});

