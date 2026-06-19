import { IExtensionDataManager } from "azure-devops-extension-api";

export const DEFAULT_CARD_VALUES = ["0", "1", "2", "3", "5", "8", "13", "21", "?", "☕"];

export interface WorkItemTypeOverride {
  enabled: boolean;      // false = hide panel for this WIT
  cardValues?: string[]; // undefined = use global defaults
}

export interface PokerSettings {
  disabledStates: string[];
  postComment: boolean;
  pollIntervalSeconds: number; // 0 = off
  anonymousVoting: boolean;
  showSettings: boolean;
  witOverrides: Record<string, WorkItemTypeOverride>;
}

export const DEFAULT_SETTINGS: PokerSettings = {
  disabledStates: ["Done", "Removed"],
  postComment: true,
  pollIntervalSeconds: 5,
  anonymousVoting: false,
  showSettings: true,
  witOverrides: {},
};

const CFG_COLLECTION = "planning-poker-config";
const CARDS_DOC = "card-values";
const SETTINGS_DOC = "settings";

interface CardValuesDoc { id: string; values: string[]; __etag?: number }
interface SettingsDoc extends PokerSettings { id: string; __etag?: number }

// Fetch the current __etag for a doc; returns undefined on first save
async function fetchEtag(dm: IExtensionDataManager, docId: string): Promise<number | undefined> {
  try {
    return ((await dm.getDocument(CFG_COLLECTION, docId)) as { __etag?: number }).__etag;
  } catch {
    return undefined;
  }
}

// Coerce helpers
function bool(v: unknown, def: boolean): boolean { return typeof v === "boolean" ? v : def; }
function num(v: unknown, def: number): number { return typeof v === "number" ? v : def; }

function parseWitOverrides(raw: unknown): Record<string, WorkItemTypeOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, WorkItemTypeOverride> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    result[key] = {
      enabled: bool(v.enabled, true),
      ...(Array.isArray(v.cardValues) ? { cardValues: v.cardValues as string[] } : {}),
    };
  }
  return result;
}

export async function loadCardValues(dm: IExtensionDataManager): Promise<string[]> {
  try {
    const doc = (await dm.getDocument(CFG_COLLECTION, CARDS_DOC)) as CardValuesDoc;
    if (Array.isArray(doc.values) && doc.values.length > 0) return doc.values;
  } catch {
    // doc not yet created — fall through to defaults
  }
  return [...DEFAULT_CARD_VALUES];
}

export async function saveCardValues(dm: IExtensionDataManager, values: string[]): Promise<void> {
  const doc: CardValuesDoc = { id: CARDS_DOC, values, __etag: await fetchEtag(dm, CARDS_DOC) };
  await dm.setDocument(CFG_COLLECTION, doc);
}

export async function loadSettings(dm: IExtensionDataManager): Promise<PokerSettings> {
  try {
    const doc = (await dm.getDocument(CFG_COLLECTION, SETTINGS_DOC)) as SettingsDoc;
    return {
      disabledStates: Array.isArray(doc.disabledStates) ? [...doc.disabledStates] : [...DEFAULT_SETTINGS.disabledStates],
      postComment:          bool(doc.postComment,          DEFAULT_SETTINGS.postComment),
      pollIntervalSeconds:  num(doc.pollIntervalSeconds,   DEFAULT_SETTINGS.pollIntervalSeconds),
      anonymousVoting:      bool(doc.anonymousVoting,      DEFAULT_SETTINGS.anonymousVoting),
      showSettings:         bool(doc.showSettings,         DEFAULT_SETTINGS.showSettings),
      witOverrides:         parseWitOverrides(doc.witOverrides),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, disabledStates: [...DEFAULT_SETTINGS.disabledStates], witOverrides: {} };
  }
}

export async function saveSettings(dm: IExtensionDataManager, settings: PokerSettings): Promise<void> {
  const doc: SettingsDoc = { id: SETTINGS_DOC, ...settings, __etag: await fetchEtag(dm, SETTINGS_DOC) };
  await dm.setDocument(CFG_COLLECTION, doc);
}
