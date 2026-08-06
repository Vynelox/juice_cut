/**
 * Centralized keyboard shortcut management.
 */
export type ShortcutAction = "undo" | "redo" | "timelineZoomToggle" | "exitModal" | "closeTorusMenu";

const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[][]> = {
  undo: [["ctrl", "z"]],
  redo: [["ctrl", "shift", "z"], ["ctrl", "y"], ["ctrl", "alt", "z"]],
  timelineZoomToggle: [["alt"]],
  exitModal: [["escape"]],
  closeTorusMenu: [["q"]],
};

const STORAGE_KEY = "juicecut.settings.keyboardShortcuts";
let cache: Record<ShortcutAction, string[][]> | null = null;

// Track globally pressed keys (for wheel-event shortcut matching with non-modifier keys)
const pressedKeys = new Set<string>();
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    pressedKeys.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => {
    pressedKeys.delete(e.key.toLowerCase());
  });
  window.addEventListener("blur", () => {
    pressedKeys.clear();
  });
}

function load(): Record<ShortcutAction, string[][]> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged: Record<ShortcutAction, string[][]> = { ...DEFAULT_SHORTCUTS };
      for (const key of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
        if (parsed[key] && Array.isArray(parsed[key])) merged[key] = parsed[key];
      }
      return merged;
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
}

function getCache(): Record<ShortcutAction, string[][]> {
  if (!cache) cache = load();
  return cache;
}

function persist(s: Record<ShortcutAction, string[][]>) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

export function getShortcutKeys(action: ShortcutAction): string[][] {
  return getCache()[action] || [];
}

export function isShortcutMatch(action: ShortcutAction, e: KeyboardEvent): boolean {
  return getCache()[action].some(combo => keysMatchCombo(combo, e));
}

export function isWheelShortcutMatch(action: ShortcutAction, e: WheelEvent): boolean {
  return getCache()[action].some(combo => modifiersMatchCombo(combo, e));
}

export function updateShortcuts(next: Record<ShortcutAction, string[][]>) {
  cache = next;
  persist(next);
  window.dispatchEvent(new CustomEvent("juicecut-settings-changed", { detail: { key: "keyboardShortcuts", value: next } }));
}

export function resetDefaultShortcuts(action: ShortcutAction) {
  const current = getCache();
  const next = { ...current, [action]: JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS[action])) };
  updateShortcuts(next);
}

export function reloadShortcuts() { cache = load(); }

export function formatShortcutCombo(keys: string[]): string {
  const sorted = [...keys].sort((a, b) => {
    const order = ["ctrl", "shift", "alt", "meta"];
    const ia = order.indexOf(a.toLowerCase());
    const ib = order.indexOf(b.toLowerCase());
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  return sorted.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(" + ");
}

export function formatShortcutLabel(action: ShortcutAction): string {
  return getShortcutKeys(action)
    .filter(combo => combo.length > 0)
    .map(formatShortcutCombo)
    .join(", ");
}

if (typeof window !== "undefined") {
  window.addEventListener("juicecut-settings-changed", ((e: CustomEvent) => {
    if (e.detail?.key === "keyboardShortcuts") cache = e.detail.value;
  }) as EventListener);
}

function keysMatchCombo(combo: string[], e: KeyboardEvent): boolean {
  const eventKeys = eventToKeys(e);
  if (eventKeys.length === 0) return false;
  const cs = new Set(combo.map(k => k.toLowerCase()));
  const es = new Set(eventKeys.map(k => k.toLowerCase()));
  if (cs.size !== es.size) return false;
  for (const k of cs) { if (!es.has(k)) return false; }
  return true;
}

function modifiersMatchCombo(combo: string[], e: WheelEvent): boolean {
  const mods = combo.filter(k => ["ctrl","shift","alt","meta"].includes(k.toLowerCase()));
  const nonMods = combo.filter(k => !["ctrl","shift","alt","meta"].includes(k.toLowerCase()));
  // Check modifiers (if any)
  const em = eventModifiers(e);
  if (mods.length !== em.size) return false;
  for (const k of mods) { if (!em.has(k.toLowerCase())) return false; }
  // Check non-modifier keys (if any) against the global pressed keys set
  if (nonMods.length > 0) {
    for (const k of nonMods) {
      if (!pressedKeys.has(k.toLowerCase())) return false;
    }
  }
  return true;
}

function eventToKeys(e: KeyboardEvent): string[] {
  const k: string[] = [];
  if (e.ctrlKey || e.metaKey) k.push("ctrl");
  if (e.shiftKey) k.push("shift");
  if (e.altKey) k.push("alt");
  const key = e.key.toLowerCase();
  if (!["control","shift","alt","meta"].includes(key)) k.push(key === " " ? "space" : key);
  return k;
}

function eventModifiers(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Set<string> {
  const s = new Set<string>();
  if (e.ctrlKey) s.add("ctrl");
  if (e.shiftKey) s.add("shift");
  if (e.altKey) s.add("alt");
  return s;
}