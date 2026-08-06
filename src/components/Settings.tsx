//settings.tsx
import { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { RotateCcw, Plus, ChevronRight } from 'lucide-react';
import type { ShortcutAction } from './shortcuts';
import { getShortcutKeys as scGetKeys, updateShortcuts as scUpdate, resetDefaultShortcuts as scReset, SHORTCUT_LABELS } from './shortcuts';
import DraggableModal from './DraggableModal';
import { OpenTorusMenuEditor } from './TorusMenuEditor';
import { OpenPlayneedleEditor } from './PlayneedleEditor';
import { modalManager } from '../state/modalManager';
import { showToast } from './Toast';

// Stretch factors for the playneedle icon
const PLAYNEEDLE_ICON_HORIZONTAL_STRETCH_FACTOR = 0.4; // default 0.4
const PLAYNEEDLE_ICON_VERTICAL_STRETCH_FACTOR = 3; // default 3
const PLAYNEEDLE_ICON_Y_OFFSET_PX = 3; //bullshit variable, not used

// Settings modal dimensions
const SETTINGS_MODAL_WIDTH = '480px'; //default 480px
const SETTINGS_MODAL_HEIGHT = '72vh'; //default 72vh
const SETTINGS_MODAL_MIN_HEIGHT = '0vh';
const SETTINGS_MODAL_MAX_HEIGHT = '100vh';

// Gap in pixels between each slider component in the Settings sliders tab
const SLIDER_GAP_PX = 15; //default 15 px

type SettingsTab = "sliders" | "checkboxes" | "shortcuts" | "multiselects" | "components";

const TAB_NAMES: Record<SettingsTab, string> = {
  sliders: "Sliders",
  checkboxes: "Switches",
  shortcuts: "Keyboard",
  multiselects: "Multiselects",
  components: "Components",
};

interface Props {
  onClose?: () => void;
  initialPageData?: any;
  initialScroll?: number | null;
}

// SHORTCUT_LABELS is imported from './shortcuts' for consistency

function loadAllShortcuts(): Record<ShortcutAction, string[][]> {
  return {
    undo: scGetKeys("undo"),
    redo: scGetKeys("redo"),
    timelineZoomToggle: scGetKeys("timelineZoomToggle"),
    exitModal: scGetKeys("exitModal"),
    toggleTorusMenu: scGetKeys("toggleTorusMenu"),
  };
}

function formatKeys(keys: string[]): string {
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

function SettingsCategory({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="settings-category">
      <button type="button" className="settings-category-header" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
        <span className="settings-category-title">{title}</span>
        <ChevronRight size={14} className="settings-category-arrow" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} />
      </button>
      <div className="settings-category-body" style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr', overflow: 'hidden' }}>
        <div style={{ overflow: 'hidden' }}>
        <div className="settings-category-body-inner" style={{ display: "flex", flexDirection: "column", gap: SLIDER_GAP_PX }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function SliderSetting({ label, value, min, max, step, onChange, onReset, formatValue, logScale }: {
  label: React.ReactNode; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onReset: () => void; formatValue?: (v: number) => string; logScale?: boolean;
}) {
  const defaultFormat = (v: number) => v.toFixed(3);
  const fmt = formatValue || defaultFormat;
  const displayValue = fmt(value);
  const sliderToValue = (slider: number) => {
    if (!logScale) return min + (slider / 1000) * (max - min);
    const logMin = Math.log10(min); const logMax = Math.log10(max);
    return Math.pow(10, logMin + (slider / 1000) * (logMax - logMin));
  };
  const valueToSlider = (val: number) => {
    if (!logScale) return ((val - min) / (max - min)) * 1000;
    return ((Math.log10(val) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))) * 1000;
  };
  return (
    <div className="settings-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span style={{ flex: 1, lineHeight: 1.2 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--text-primary)", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{displayValue}</span>
          <button type="button" className="icon-btn" onClick={onReset} title="Reset to default" style={{ padding: 4 }}><RotateCcw size={14} /></button>
        </div>
      </div>
      <input type="range" className="settings-range-input" min={0} max={1000} step={1} value={valueToSlider(value)} onChange={e => onChange(sliderToValue(Number(e.target.value)))} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}><span>{fmt(min)}</span><span>{fmt(max)}</span></div>
    </div>
  );
}

export default function Settings(props: Props) { return SettingsShell(props); }

function SettingsShell({ onClose, initialPageData, initialScroll }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (initialPageData?.tab === "sliders") return "sliders";
    if (initialPageData?.tab === "checkboxes") return "checkboxes";
    if (initialPageData?.tab === "shortcuts") return "shortcuts";
    if (initialPageData?.tab === "components") return "components";
    return "sliders";
  });
  
  // Map tab keys to display names
  const getTabLabel = (tab: SettingsTab): string => TAB_NAMES[tab];
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [guiScale, setGuiScale] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.guiScale"); return v ? Number(v) : 100; } catch { return 100; } });
  const [includeResizeInUndo, setIncludeResizeInUndo] = useState<boolean>(() => { try { const v = window.localStorage.getItem("juicecut.settings.includeResizeInUndo"); return v === null ? true : v === "true"; } catch { return true; } });
  const [zoomEpicenter, setZoomEpicenter] = useState<string>(() => { try { return window.localStorage.getItem('juicecut.settings.zoomEpicenter') || 'playneedle'; } catch { return 'playneedle'; } });
  const [scrollSmooth, setScrollSmooth] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.scrollSmooth"); return v ? Number(v) : 50; } catch { return 50; } });
  const [scrollAmount, setScrollAmount] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.scrollAmount"); return v ? Number(v) : 100; } catch { return 100; } });
  const [scrollZoomAmount, setScrollZoomAmount] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.scrollZoomAmount"); return v ? Number(v) : 25; } catch { return 25; } });
  const [scrollZoomSmoothness, setScrollZoomSmoothness] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.scrollZoomSmoothness"); return v ? Number(v) : 70; } catch { return 70; } });
  const [viewerControlsType, setViewerControlsType] = useState<string>(() => { try { return window.localStorage.getItem('juicecut.settings.viewerControlsType') || 'compact'; } catch { return 'compact'; } });
  const [timecodePanel, setTimecodePanel] = useState<string>(() => { try { return window.localStorage.getItem('juicecut.settings.timecodePanel') || 'both'; } catch { return 'both'; } });
  const [torusScrollingDisabled, setTorusScrollingDisabled] = useState<string>(() => { try { return window.localStorage.getItem('juicecut.settings.torusScrollingDisabled') || 'none'; } catch { return 'none'; } });
  const [elevatedPanelDarken, setElevatedPanelDarken] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.elevatedPanelDarkenAmount"); return v ? Number(v) : 50; } catch { return 50; } });
  const [elevatedPanelBlur, setElevatedPanelBlur] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.elevatedPanelBlurAmount"); return v ? Number(v) : 0; } catch { return 0; } });
  const [pnT, setPnT] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedle_t"); return v !== null ? Number(v) : 0.092; } catch { return 0.092; } });
  const [pnJ, setPnJ] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedle_j"); return v !== null ? Number(v) : 0.049; } catch { return 0.049; } });
  const [pnK, setPnK] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedle_k"); return v !== null ? Number(v) : 103; } catch { return 103; } });
  const [draggableHeaderButtons, setDraggableHeaderButtons] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem("juicecut.settings.draggableHeaderButtons");
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  });

  // Toggle Switch component for cleaner rendering
  function ToggleSwitch({ checked, onChange, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
    return (
      <input 
        type="checkbox" 
        className="toggle-switch" 
        checked={checked} 
        onChange={e => onChange(e.target.checked)} 
        disabled={disabled}
        title={title}
      />
    );
  }
  
  useEffect(() => {
    try {
      window.localStorage.setItem("juicecut.settings.draggableHeaderButtons", String(draggableHeaderButtons));
      if (!(window as any).juicecut) (window as any).juicecut = {};
      if (!(window as any).juicecut.settings) (window as any).juicecut.settings = {};
      (window as any).juicecut.settings.draggableHeaderButtons = draggableHeaderButtons;
    } catch {}
  }, [draggableHeaderButtons]);

  const [allowMultipleMenus, setAllowMultipleMenus] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem("juicecut.settings.allowMultipleMenus");
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("juicecut.settings.allowMultipleMenus", String(allowMultipleMenus));
      if (!(window as any).juicecut) (window as any).juicecut = {};
      if (!(window as any).juicecut.settings) (window as any).juicecut.settings = {};
      (window as any).juicecut.settings.allowMultipleMenus = allowMultipleMenus;
      modalManager.updateSettings('allowMultipleMenus', allowMultipleMenus);
      window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "allowMultipleMenus", value: allowMultipleMenus } }));
    } catch {}
  }, [allowMultipleMenus]);

  const [allowEditsWhenMenuOpen, setAllowEditsWhenMenuOpen] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem("juicecut.settings.allowEditsWhenMenuOpen");
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("juicecut.settings.allowEditsWhenMenuOpen", String(allowEditsWhenMenuOpen));
      if (!(window as any).juicecut) (window as any).juicecut = {};
      if (!(window as any).juicecut.settings) (window as any).juicecut.settings = {};
      (window as any).juicecut.settings.allowEditsWhenMenuOpen = allowEditsWhenMenuOpen;
      window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "allowEditsWhenMenuOpen", value: allowEditsWhenMenuOpen } }));
    } catch {}
  }, [allowEditsWhenMenuOpen]);

  const [requireDragHover, setRequireDragHover] = useState(false);

  const [executeHeaderButtonsOnDrag, setExecuteHeaderButtonsOnDrag] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem("juicecut.settings.executeHeaderButtonsOnDrag");
      return v === null ? true : v === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("juicecut.settings.executeHeaderButtonsOnDrag", String(executeHeaderButtonsOnDrag));
      if (!(window as any).juicecut) (window as any).juicecut = {};
      if (!(window as any).juicecut.settings) (window as any).juicecut.settings = {};
      (window as any).juicecut.settings.executeHeaderButtonsOnDrag = executeHeaderButtonsOnDrag;
    } catch {}
  }, [executeHeaderButtonsOnDrag]);

  const [pnS, setPnS] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedle_s"); return v !== null ? Number(v) : 16.4; } catch { return 16.4; } });
  const [pnVo, setPnVo] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedle_v_o"); return v !== null ? Number(v) : 0.4; } catch { return 0.4; } });
  const [pnHb, setPnHb] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedle_h_b"); return v !== null ? Number(v) : 0.8; } catch { return 0.8; } });
  const [pnHr, setPnHr] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedle_h_r"); return v !== null ? Number(v) : 1; } catch { return 1; } });
  const [playneedleIconHorizontalStretch, setPlayneedleIconHorizontalStretch] = useState<number>(() => { try { const v = window.localStorage.getItem("juicecut.settings.playneedleIconHorizontalStretch"); return v !== null ? Number(v) : PLAYNEEDLE_ICON_HORIZONTAL_STRETCH_FACTOR; } catch { return PLAYNEEDLE_ICON_HORIZONTAL_STRETCH_FACTOR; } });
  const [colorTransitionDuration, setColorTransitionDuration] = useState<number>(() => {
    try {
      const v = window.localStorage.getItem("juicecut.settings.colorTransitionDuration");
      return v !== null ? Number(v) : 0;
    } catch {
      return 0;
    }
  });

  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, string[][]>>(loadAllShortcuts);
  const [editingChip, setEditingChip] = useState<{ action: ShortcutAction; index: number } | null>(null);
  const chipRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const SCROLL_AMOUNT_POWER = 3.355;
  const scrollAmountToSlider = (value: number) => { if (value <= 1) return 0; if (value >= 400) return 1000; return Math.round(1000 * Math.pow((value - 1) / 399, 1 / SCROLL_AMOUNT_POWER)); };
  const sliderToScrollAmount = (sv: number) => { return Math.round(1 + 399 * Math.pow(Math.max(0, Math.min(1, sv / 1000)), SCROLL_AMOUNT_POWER)); };

  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.guiScale", String(guiScale)); document.documentElement.style.setProperty('--gui-scale', `${guiScale / 100}`); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "guiScale", value: guiScale } })); } catch {} }, [guiScale]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.includeResizeInUndo", includeResizeInUndo ? "true" : "false"); } catch {} }, [includeResizeInUndo]);
  useEffect(() => { try { window.localStorage.setItem('juicecut.settings.zoomEpicenter', zoomEpicenter); window.dispatchEvent(new CustomEvent('juicecut.settings-changed', { detail: { key: 'zoomEpicenter', value: zoomEpicenter } })); } catch {} }, [zoomEpicenter]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.scrollSmooth", String(scrollSmooth)); } catch {} }, [scrollSmooth]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.scrollAmount", String(scrollAmount)); } catch {} }, [scrollAmount]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.scrollZoomAmount", String(scrollZoomAmount)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "scrollZoomAmount", value: scrollZoomAmount } })); } catch {} }, [scrollZoomAmount]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.scrollZoomSmoothness", String(scrollZoomSmoothness)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "scrollZoomSmoothness", value: scrollZoomSmoothness } })); } catch {} }, [scrollZoomSmoothness]);
  useEffect(() => { try { window.localStorage.setItem('juicecut.settings.viewerControlsType', viewerControlsType); window.dispatchEvent(new CustomEvent('juicecut.settings-changed', { detail: { key: 'viewerControlsType', value: viewerControlsType } })); } catch {} }, [viewerControlsType]);
  useEffect(() => { try { window.localStorage.setItem('juicecut.settings.timecodePanel', timecodePanel); window.dispatchEvent(new CustomEvent('juicecut.settings-changed', { detail: { key: 'timecodePanel', value: timecodePanel } })); } catch {} }, [timecodePanel]);
  useEffect(() => { try { window.localStorage.setItem('juicecut.settings.torusScrollingDisabled', torusScrollingDisabled); window.dispatchEvent(new CustomEvent('juicecut.settings-changed', { detail: { key: 'torusScrollingDisabled', value: torusScrollingDisabled } })); } catch {} }, [torusScrollingDisabled]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.elevatedPanelDarkenAmount", String(elevatedPanelDarken)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "elevatedPanelDarkenAmount", value: elevatedPanelDarken } })); } catch {} }, [elevatedPanelDarken]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.elevatedPanelBlurAmount", String(elevatedPanelBlur)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "elevatedPanelBlurAmount", value: elevatedPanelBlur } })); } catch {} }, [elevatedPanelBlur]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedle_t", String(pnT)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedle_t", value: pnT } })); } catch {} }, [pnT]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedle_j", String(pnJ)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedle_j", value: pnJ } })); } catch {} }, [pnJ]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedle_k", String(pnK)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedle_k", value: pnK } })); } catch {} }, [pnK]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedle_s", String(pnS)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedle_s", value: pnS } })); } catch {} }, [pnS]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedle_v_o", String(pnVo)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedle_v_o", value: pnVo } })); } catch {} }, [pnVo]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedle_h_b", String(pnHb)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedle_h_b", value: pnHb } })); } catch {} }, [pnHb]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedle_h_r", String(pnHr)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedle_h_r", value: pnHr } })); } catch {} }, [pnHr]);
  useEffect(() => { try { window.localStorage.setItem("juicecut.settings.playneedleIconHorizontalStretch", String(playneedleIconHorizontalStretch)); window.dispatchEvent(new CustomEvent("juicecut.settings-changed", { detail: { key: "playneedleIconHorizontalStretch", value: playneedleIconHorizontalStretch } })); } catch {} }, [playneedleIconHorizontalStretch]);

  useEffect(() => {
    try {
      window.localStorage.setItem("juicecut.settings.colorTransitionDuration", String(colorTransitionDuration));
      if (!(window as any).juicecut) (window as any).juicecut = {};
      if (!(window as any).juicecut.settings) (window as any).juicecut.settings = {};
      (window as any).juicecut.settings.colorTransitionDuration = colorTransitionDuration;
      
      if (document.documentElement) {
        document.documentElement.style.setProperty('--theme-transition-duration', `${colorTransitionDuration}ms`);
        document.documentElement.style.setProperty('--theme-transition-timing', 'cubic-bezier(0.4, 0, 0.2, 1)');
      }
    } catch {}
  }, [colorTransitionDuration]);

  useEffect(() => {
    if (initialScroll != null && panelRef.current) {
      const el = panelRef.current.querySelector(".settings-panel-content");
      if (el) el.scrollTop = initialScroll;
    }
    if (!(window as any).juicecut) (window as any).juicecut = {};
    if (!(window as any).juicecut.settings) (window as any).juicecut.settings = {};
    (window as any).juicecut.settings.draggableHeaderButtons = draggableHeaderButtons;
  }, []);

  const addCombination = (action: ShortcutAction) => { const next = { ...shortcuts, [action]: [...shortcuts[action], []] }; setShortcuts(next); scUpdate(next); const newIndex = next[action].length - 1; setEditingChip({ action, index: newIndex }); setTimeout(() => { chipRefs.current[`${action}-${newIndex}`]?.focus(); }, 0); };
  const removeCombination = (action: ShortcutAction, index: number) => { const arr = shortcuts[action].filter((_, i) => i !== index); const next = { ...shortcuts, [action]: arr }; setShortcuts(next); scUpdate(next); setEditingChip(null); };
  const updateCombination = (action: ShortcutAction, index: number, keys: string[]) => { const arr = [...shortcuts[action]]; arr[index] = keys; const next = { ...shortcuts, [action]: arr }; setShortcuts(next); scUpdate(next); setEditingChip(null); };
  const handleReset = (action: ShortcutAction) => { scReset(action); setShortcuts(loadAllShortcuts()); setEditingChip(null); };
  const handleChipKeyDown = (e: React.KeyboardEvent, action: ShortcutAction, index: number) => {
    e.preventDefault(); e.stopPropagation();
    const keys: string[] = [];
    if (e.ctrlKey || e.metaKey) keys.push("ctrl");
    if (e.shiftKey) keys.push("shift");
    if (e.altKey) keys.push("alt");
    const key = e.key.toLowerCase();
    if (key !== "control" && key !== "shift" && key !== "alt" && key !== "meta") keys.push(key === " " ? "space" : key);
    if (keys.length > 0) updateCombination(action, index, keys);
  };

  return (
    <DraggableModal
      title="Settings"
      onClose={() => { onClose?.(); }}
      className="settings-modal"
      style={{ width: SETTINGS_MODAL_WIDTH, height: SETTINGS_MODAL_HEIGHT, minHeight: SETTINGS_MODAL_MIN_HEIGHT, maxHeight: SETTINGS_MODAL_MAX_HEIGHT, overflow: 'hidden' }}
      persistenceKey="settings"
      pageState={activeTab}
      onSavePageState={(state) => {}}
      onRestorePageState={(state) => {
        if (state && TAB_NAMES[state as SettingsTab]) {
          setActiveTab(state as SettingsTab);
        }
      }}
      body={
      <div className="settings-body" ref={panelRef}>
        <nav className="settings-tabs" aria-label="Settings sections">
          <button type="button" className={"settings-tab" + (activeTab === "shortcuts" ? " settings-tab--active" : "")} onClick={() => setActiveTab("shortcuts")}>{getTabLabel("shortcuts")}</button>
          <button type="button" className={"settings-tab" + (activeTab === "sliders" ? " settings-tab--active" : "")} onClick={() => setActiveTab("sliders")}>{getTabLabel("sliders")}</button>
          <button type="button" className={"settings-tab" + (activeTab === "checkboxes" ? " settings-tab--active" : "")} onClick={() => setActiveTab("checkboxes")}>{getTabLabel("checkboxes")}</button>
          <button type="button" className={"settings-tab" + (activeTab === "multiselects" ? " settings-tab--active" : "")} onClick={() => setActiveTab("multiselects")}>{getTabLabel("multiselects")}</button>
          <button type="button" className={"settings-tab" + (activeTab === "components" ? " settings-tab--active" : "")} onClick={() => setActiveTab("components")}>{getTabLabel("components")}</button>
        </nav>
        <div className="settings-panel">
          {activeTab === "sliders" && (
            <div className="settings-panel-content">
              <div className="settings-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ flex: 1, lineHeight: 1.2 }}>GUI scale</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "var(--text-primary)", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{guiScale}%</span>
                    <button type="button" className="icon-btn" onClick={() => setGuiScale(100)} title="Reset to default (100%)" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                  </div>
                </div>
                <input type="range" className="settings-range-input" min={50} max={200} step={1} value={guiScale} onChange={e => setGuiScale(Number(e.target.value))} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}><span>50%</span><span>200%</span></div>
              </div>
              <SliderSetting 
                label="Global transition duration"
                value={colorTransitionDuration}
                min={0}
                max={1000}
                step={10}
                onChange={setColorTransitionDuration}
                onReset={() => setColorTransitionDuration(0)}
                formatValue={v => `${v}ms`}
              />
              <SettingsCategory title="Scrolling">
                <SliderSetting label="Timeline scroll smooth factor" value={scrollSmooth} min={0} max={100} step={1} onChange={setScrollSmooth} onReset={() => setScrollSmooth(50)} formatValue={v => `${v.toFixed(3)}%`} />
                <SliderSetting label="Timeline scroll amount" value={scrollAmount} min={1} max={400} step={1} onChange={setScrollAmount} onReset={() => setScrollAmount(100)} formatValue={v => `${v.toFixed(3)}%`} />
                <SliderSetting label="Timeline scroll zoom amount" value={scrollZoomAmount} min={1} max={100} step={1} onChange={setScrollZoomAmount} onReset={() => setScrollZoomAmount(25)} />
                <SliderSetting label="Timeline scroll zoom smoothness" value={scrollZoomSmoothness} min={0} max={100} step={1} onChange={setScrollZoomSmoothness} onReset={() => setScrollZoomSmoothness(70)} formatValue={v => `${v.toFixed(3)}%`} />
              </SettingsCategory>
                {/* Playneedle settings have been moved to the Playneedle Editor component. */}
              <SettingsCategory title="Miscellaneous">
                <SliderSetting label="Draggable modal background darken amount" value={elevatedPanelDarken} min={0} max={100} step={1} onChange={setElevatedPanelDarken} onReset={() => setElevatedPanelDarken(50)} formatValue={v => `${v.toFixed(3)}%`} />
                <SliderSetting label="Draggable modal background blur amount" value={elevatedPanelBlur} min={0} max={100} step={1} onChange={setElevatedPanelBlur} onReset={() => setElevatedPanelBlur(0)} formatValue={v => `${v.toFixed(3)}%`} />
              </SettingsCategory>
            </div>
          )}
          {activeTab === "checkboxes" && (
            <div className="settings-panel-content">
               <div className="settings-field" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <span style={{ flex: 1, lineHeight: 1.2 }}>Include splitter resize<br />actions in Ctrl+Z/Ctrl+Y</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ToggleSwitch checked={includeResizeInUndo} onChange={setIncludeResizeInUndo} title="Reset to default (Checked)" />
                  <button type="button" className="icon-btn" onClick={() => setIncludeResizeInUndo(true)} title="Reset to default (Checked)" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                </div>
              </div>
               <div className="settings-field" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
                <span style={{ flex: 1, lineHeight: 1.2 }}>Allow ×, -, and ← buttons in modals' header bar to be draggable</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ToggleSwitch checked={draggableHeaderButtons} onChange={setDraggableHeaderButtons} title="Reset to default (Checked)" />
                  <button type="button" className="icon-btn" onClick={() => setDraggableHeaderButtons(true)} title="Reset to default (Checked)" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                </div>
              </div>
              <div className="settings-field" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
                <span style={{ flex: 1, lineHeight: 1.2, color: 'var(--text-secondary)' }}>
                  Execute header button actions when dragging
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ToggleSwitch checked={executeHeaderButtonsOnDrag} onChange={setExecuteHeaderButtonsOnDrag} title="Reset to default (Checked)" />
                  <button type="button" className="icon-btn" onClick={() => setExecuteHeaderButtonsOnDrag(true)} title="Reset to default (Checked)" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                </div>
              </div>
               <div className="settings-field" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
                <span style={{ flex: 1, lineHeight: 1.2 }}>Allow open multiple menus</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ToggleSwitch checked={allowMultipleMenus} onChange={setAllowMultipleMenus} title="Reset to default (Checked)" />
                  <button type="button" className="icon-btn" onClick={() => setAllowMultipleMenus(true)} title="Reset to default (Checked)" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                </div>
              </div>
               <div className="settings-field" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
                <span style={{ flex: 1, lineHeight: 1.2 }}>Allow edits when menu is open</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ToggleSwitch checked={allowEditsWhenMenuOpen} onChange={setAllowEditsWhenMenuOpen} title="Reset to default (Checked)" />
                  <button type="button" className="icon-btn" onClick={() => setAllowEditsWhenMenuOpen(true)} title="Reset to default (Checked)" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                </div>
              </div>
            </div>
          )}
          {activeTab === "multiselects" && (
            <div className="settings-panel-content">
              <div className="settings-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <span style={{ lineHeight: 1.2 }}>Viewer controls type</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {(['compact', 'centered'] as const).map(opt => { const active = viewerControlsType === opt; return (<button key={opt} type="button" onClick={() => setViewerControlsType(opt)} style={{ padding: "5px 14px", borderRadius: "var(--radius-sm)", border: active ? "1px solid var(--highlight-color)" : "1px solid var(--border-mid)", background: active ? "rgba(56,189,248,0.15)" : "var(--bg-elevated)", color: active ? "var(--highlight-color)" : "var(--text-secondary)", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer" }}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</button>); })}
                </div>
              </div>
              <div className="settings-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <span style={{ lineHeight: 1.2 }}>Timecode display</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(['timeline', 'viewer', 'both', 'none'] as const).map(opt => { const active = timecodePanel === opt; return (<button key={opt} type="button" onClick={() => setTimecodePanel(opt)} style={{ padding: "5px 14px", borderRadius: "var(--radius-sm)", border: active ? "1px solid var(--highlight-color)" : "1px solid var(--border-mid)", background: active ? "rgba(56,189,248,0.15)" : "var(--bg-elevated)", color: active ? "var(--highlight-color)" : "var(--text-secondary)", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer" }}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</button>); })}
                </div>
              </div>
              <div className="settings-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <span style={{ lineHeight: 1.2 }}>Timeline zoom epicenter</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(['playneedle', 'middle', 'cursor'] as const).map(opt => { const active = zoomEpicenter === opt; return (<button key={opt} type="button" onClick={() => setZoomEpicenter(opt)} style={{ padding: "5px 14px", borderRadius: "var(--radius-sm)", border: active ? "1px solid var(--highlight-color)" : "1px solid var(--border-mid)", background: active ? "rgba(56,189,248,0.15)" : "var(--bg-elevated)", color: active ? "var(--highlight-color)" : "var(--text-secondary)", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer" }}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</button>); })}
                </div>
              </div>
              <div className="settings-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <span style={{ lineHeight: 1.2 }}>Disable scrolling when torus menu is open and mouse is on:</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(['whole torus menu', 'annular sectors only', 'none'] as const).map(opt => { const active = torusScrollingDisabled === opt; return (<button key={opt} type="button" onClick={() => setTorusScrollingDisabled(opt)} style={{ padding: "5px 14px", borderRadius: "var(--radius-sm)", border: active ? "1px solid var(--highlight-color)" : "1px solid var(--border-mid)", background: active ? "rgba(56,189,248,0.15)" : "var(--bg-elevated)", color: active ? "var(--highlight-color)" : "var(--text-secondary)", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer" }}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</button>); })}
                </div>
              </div>
            </div>
          )}
          {activeTab === "shortcuts" && (
            <div className="settings-panel-content">
              {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map(action => (
                <div key={action} className="settings-field" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ lineHeight: 1.2 }}>{SHORTCUT_LABELS[action]}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button type="button" className="icon-btn" onClick={() => addCombination(action)} title="Add shortcut combination" style={{ padding: 4 }}><Plus size={14} /></button>
                      <button type="button" className="icon-btn" onClick={() => handleReset(action)} title="Reset to default shortcuts" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {shortcuts[action].map((keys, idx) => {
                      const isEditing = editingChip?.action === action && editingChip?.index === idx;
                      return (
                        <div key={idx} ref={el => { chipRefs.current[`${action}-${idx}`] = el; }} tabIndex={0} onFocus={() => setEditingChip({ action, index: idx })} onBlur={() => { setTimeout(() => setEditingChip(null), 150); }} onKeyDown={(e) => handleChipKeyDown(e, action, idx)} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: isEditing ? "var(--bg-hover)" : "var(--bg-elevated)", border: isEditing ? "1px solid var(--highlight-color)" : "1px solid var(--border-mid)", borderRadius: "var(--radius-sm)", padding: "3px 8px", cursor: "pointer", outline: "none", minHeight: 28 }} title={isEditing ? "Press keys to assign..." : keys.length === 0 ? "Click then press keys to assign" : "Click then press new keys to reassign"}>
                            <span style={{ fontSize: 12, color: keys.length > 0 ? "var(--text-primary)" : "var(--text-muted)", fontFamily: "monospace" }}>{isEditing && keys.length === 0 ? "..." : keys.length > 0 ? formatKeys(keys) : "None"}</span>
                            <button type="button" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0 2px", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center" }} onMouseDown={(e) => { e.stopPropagation(); removeCombination(action, idx); }} title="Remove this combination">x</button>
                          </div>
                        );
                      })}
                    </div>
                </div>
              ))}
            </div>
          )}
          {activeTab === "components" && (
            <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 90px)', gap: '8px 12px', alignItems: 'flex-start', justifyContent: 'flex-start' }}>
              <button onClick={() => { 
                onClose?.(); 
                OpenTorusMenuEditor(() => {
                  OpenSettings({ tab: 'components' });
                }); 
              }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent', border: 'none', borderRadius: 'var(--radius-md)', padding: '12px 16px', cursor: 'pointer', color: 'var(--text-secondary)', width: 90, height: 100, flexShrink: 0 }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="3" x2="12" y2="7" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                  <line x1="3" y1="12" x2="7" y2="12" />
                  <line x1="17" y1="12" x2="21" y2="12" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textAlign: 'center' }}>Torus Menu Editor</span>
              </button>
              <button onClick={() => { 
                onClose?.(); 
                OpenPlayneedleEditor(() => {
                  OpenSettings({ tab: 'components' });
                }); 
              }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent', border: 'none', borderRadius: 'var(--radius-md)', padding: '12px 16px', cursor: 'pointer', color: 'var(--text-secondary)', width: 90, height: 100, flexShrink: 0 }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
<g transform={"translate(18, 0) scale(" + PLAYNEEDLE_ICON_HORIZONTAL_STRETCH_FACTOR + ", " + PLAYNEEDLE_ICON_VERTICAL_STRETCH_FACTOR + ") translate(-18, 0)"}>
                    <path d="M 0.10439774978512162 0 L 0.1739754970771017 0.18 L 0.28909907105190413 0.36 L 0.47814990198903473 0.54 L 0.7847839179498877 0.72 L 1.2722912322855038 0.9 L 2.023257809269225 1.08 L 3.1255583753595584 1.2600000000000002 L 4.634075538549787 1.44 L 6.511983325843259 1.6199999999999999 L 8.592486320766021 1.8 L 10.6197353508729 1.98 L 12.362472702255566 2.16 L 13.7064144566513 2.34 L 14.65856331371573 2.5200000000000005 L 15.293341080070947 2.6999999999999997 L 15.699556135482387 2.88 L 15.95273481398118 3.06 L 16.107944283731246 3.2399999999999998 L 16.202131849562647 3.42 L 16.258936505191116 3.6 L 16.293067816679965 3.78 L 16.31352977157061 3.96 L 16.32578034869086 4.140000000000001 L 16.33310886075748 4.32 L 16.3374907919708 4.5 L 16.340110120782242 4.68 L 16.135795463384383 4.86 L 15.440309810234199 5.040000000000001 L 14.305519190903285 5.22 L 12.820006496204748 5.3999999999999995 L 11.099593569308327 5.58 L 9.278351518624564 5.76 L 7.498176911935058 5.94 L 5.897750858410571 6.12 L 4.6017440003565575 6.3 L 3.711110054807694 6.4799999999999995 L 3.295225024269495 6.66 L 3.3864849990949217 6.84 L 3.9777837138672343 7.0200000000000005 L 5.023066561719379 7.2 L 6.440918054130655 7.38 L 8.120903385295186 7.56 L 9.932170211881486 7.74 L 11.733640692799895 7.92 L 13.384999957681602 8.1 L 14.757625132495923 8.280000000000001 L 15.744603676416974 8.459999999999999 L 16.269060714249065 8.64 L 16.343999972086046 8.82 L 16.343999983321396 9 L 16.343999990034526 9.18 L 16.34399999404562 9.36 L 16.343999996442257 9.540000000000001 L 16.343999997874246 9.72 L 16.34399999872986 9.9 L 16.343999999241092 10.080000000000002 L 16.34399999954655 10.26 L 16.343999999729064 10.44 L 16.343999999838115 10.62 L 16.343999999903275 10.799999999999999 L 16.343999999942206 10.98 L 16.34399999996547 11.16 L 16.343999999979367 11.34 L 16.343999999987673 11.52 L 16.343999999992633 11.700000000000001 L 16.3439999999956 11.88 L 16.343999999997372 12.06 L 16.343999999998427 12.24 L 16.34399999999906 12.419999999999998 L 16.34399999999944 12.6 L 16.343999999999664 12.78 L 16.3439999999998 12.959999999999999 L 16.34399999999988 13.14 L 16.34399999999993 13.32 L 16.34399999999996 13.5 L 16.343999999999973 13.68 L 16.343999999999983 13.86 L 16.34399999999999 14.040000000000001 L 16.343999999999994 14.22 L 16.343999999999998 14.4 L 16.343999999999998 14.580000000000002 L 16.343999999999998 14.76 L 16.343999999999998 14.94 L 16.344 15.12 L 16.344 15.299999999999999 L 16.344 15.48 L 16.344 15.66 L 16.344 15.84 L 16.344 16.02 L 16.344 16.2 L 16.344 16.38 L 16.344 16.560000000000002 L 16.344 16.740000000000002 L 16.344 16.919999999999998 L 16.344 17.099999999999998 L 16.344 17.28 L 16.344 17.46 L 16.344 17.64 L 16.344 17.82 L 16.344 18 L 16.344 18.18 L 16.344 18.36 L 16.344 18.54 L 16.344 18.72 L 16.344 18.900000000000002 L 16.344 19.080000000000002 L 16.344 19.26 L 16.344 19.44 L 16.344 19.62 L 16.344 19.8 L 16.344 19.98 L 16.344 20.160000000000004 L 16.344 20.339999999999996 L 16.344 20.52 L 16.344 20.7 L 16.344 20.88 L 16.344 21.06 L 16.344 21.24 L 16.344 21.419999999999998 L 16.344 21.599999999999998 L 16.344 21.78 L 16.344 21.96 L 16.344 22.14 L 16.344 22.32 L 16.344 22.5 L 16.344 22.68 L 16.344 22.86 L 16.344 23.04 L 16.344 23.22 L 16.344 23.400000000000002 L 16.344 23.580000000000002 L 16.344 23.76 L 16.344 23.94 L 16.344 24.12 L 16.344 24.3 L 16.344 24.48 L 16.344 24.660000000000004 L 16.344 24.839999999999996 L 16.344 25.02 L 16.344 25.2 L 16.344 25.38 L 16.344 25.56 L 16.344 25.74 L 16.344 25.919999999999998 L 16.344 26.099999999999998 L 16.344 26.28 L 16.344 26.46 L 16.344 26.64 L 16.344 26.82 L 16.344 27 L 16.344 27.18 L 16.344 27.36 L 16.344 27.54 L 16.344 27.72 L 16.344 27.900000000000002 L 16.344 28.080000000000002 L 16.344 28.26 L 16.344 28.44 L 16.344 28.62 L 16.344 28.8 L 16.344 28.98 L 16.344 29.160000000000004 L 16.344 29.339999999999996 L 16.344 29.52 L 16.344 29.7 L 16.344 29.88 L 16.344 30.06 L 16.344 30.24 L 16.344 30.419999999999998 L 16.344 30.599999999999998 L 16.344 30.78 L 16.344 30.96 L 16.344 31.14 L 16.344 31.32 L 16.344 31.5 L 16.344 31.68 L 16.344 31.86 L 16.344 32.04 L 16.344 32.22 L 16.344 32.4 L 16.344 32.58 L 16.344 32.76 L 16.344 32.94 L 16.344 33.120000000000005 L 16.344 33.300000000000004 L 16.344 33.480000000000004 L 16.344 33.660000000000004 L 16.344 33.839999999999996 L 16.344 34.019999999999996 L 16.344 34.199999999999996 L 16.344 34.379999999999995 L 16.344 34.56 L 16.344 34.74 L 16.344 34.92 L 16.344 35.1 L 16.344 35.28 L 16.344 35.46 L 16.344 35.64 L 16.344 35.82 L 16.344 36 L 19.656 36 L 19.656 35.82 L 19.656 35.64 L 19.656 35.46 L 19.656 35.28 L 19.656 35.1 L 19.656 34.92 L 19.656 34.74 L 19.656 34.56 L 19.656 34.379999999999995 L 19.656 34.199999999999996 L 19.656 34.019999999999996 L 19.656 33.839999999999996 L 19.656 33.660000000000004 L 19.656 33.480000000000004 L 19.656 33.300000000000004 L 19.656 33.120000000000005 L 19.656 32.94 L 19.656 32.76 L 19.656 32.58 L 19.656 32.4 L 19.656 32.22 L 19.656 32.04 L 19.656 31.86 L 19.656 31.68 L 19.656 31.5 L 19.656 31.32 L 19.656 31.14 L 19.656 30.96 L 19.656 30.78 L 19.656 30.599999999999998 L 19.656 30.419999999999998 L 19.656 30.24 L 19.656 30.06 L 19.656 29.88 L 19.656 29.7 L 19.656 29.52 L 19.656 29.339999999999996 L 19.656 29.160000000000004 L 19.656 28.98 L 19.656 28.8 L 19.656 28.62 L 19.656 28.44 L 19.656 28.26 L 19.656 28.080000000000002 L 19.656 27.900000000000002 L 19.656 27.72 L 19.656 27.54 L 19.656 27.36 L 19.656 27.18 L 19.656 27 L 19.656 26.82 L 19.656 26.64 L 19.656 26.46 L 19.656 26.28 L 19.656 26.099999999999998 L 19.656 25.919999999999998 L 19.656 25.74 L 19.656 25.56 L 19.656 25.38 L 19.656 25.2 L 19.656 25.02 L 19.656 24.839999999999996 L 19.656 24.660000000000004 L 19.656 24.48 L 19.656 24.3 L 19.656 24.12 L 19.656 23.94 L 19.656 23.76 L 19.656 23.580000000000002 L 19.656 23.400000000000002 L 19.656 23.22 L 19.656 23.04 L 19.656 22.86 L 19.656 22.68 L 19.656 22.5 L 19.656 22.32 L 19.656 22.14 L 19.656 21.96 L 19.656 21.78 L 19.656 21.599999999999998 L 19.656 21.419999999999998 L 19.656 21.24 L 19.656 21.06 L 19.656 20.88 L 19.656 20.7 L 19.656 20.52 L 19.656 20.339999999999996 L 19.656 20.160000000000004 L 19.656 19.98 L 19.656 19.8 L 19.656 19.62 L 19.656 19.44 L 19.656 19.26 L 19.656 19.080000000000002 L 19.656 18.900000000000002 L 19.656 18.72 L 19.656 18.54 L 19.656 18.36 L 19.656 18.18 L 19.656 18 L 19.656 17.82 L 19.656 17.64 L 19.656 17.46 L 19.656 17.28 L 19.656 17.099999999999998 L 19.656 16.919999999999998 L 19.656 16.740000000000002 L 19.656 16.560000000000002 L 19.656 16.38 L 19.656 16.2 L 19.656 16.02 L 19.656 15.84 L 19.656 15.66 L 19.656 15.48 L 19.656 15.299999999999999 L 19.656 15.12 L 19.656000000000002 14.94 L 19.656000000000002 14.76 L 19.656000000000002 14.580000000000002 L 19.656000000000002 14.4 L 19.656000000000006 14.22 L 19.65600000000001 14.040000000000001 L 19.656000000000017 13.86 L 19.656000000000027 13.68 L 19.65600000000004 13.5 L 19.65600000000007 13.32 L 19.65600000000012 13.14 L 19.6560000000002 12.959999999999999 L 19.656000000000336 12.78 L 19.65600000000056 12.6 L 19.65600000000094 12.419999999999998 L 19.656000000001573 12.24 L 19.656000000002628 12.06 L 19.6560000000044 11.88 L 19.656000000007367 11.700000000000001 L 19.656000000012327 11.52 L 19.656000000020633 11.34 L 19.65600000003453 11.16 L 19.656000000057794 10.98 L 19.656000000096725 10.799999999999999 L 19.656000000161885 10.62 L 19.656000000270936 10.44 L 19.65600000045345 10.26 L 19.656000000758908 10.080000000000002 L 19.65600000127014 9.9 L 19.656000002125754 9.72 L 19.656000003557743 9.540000000000001 L 19.65600000595438 9.36 L 19.656000009965474 9.18 L 19.656000016678604 9 L 19.656000027913954 8.82 L 19.730939285750935 8.64 L 20.255396323583028 8.459999999999999 L 21.242374867504076 8.280000000000001 L 22.6150000423184 8.1 L 24.266359307200105 7.92 L 26.067829788118516 7.74 L 27.879096614704814 7.56 L 29.559081945869345 7.38 L 30.97693343828062 7.2 L 32.02221628613277 7.0200000000000005 L 32.61351500090508 6.84 L 32.7047749757305 6.66 L 32.28888994519231 6.4799999999999995 L 31.398255999643442 6.3 L 30.10224914158943 6.12 L 28.501823088064942 5.94 L 26.721648481375436 5.76 L 24.900406430691675 5.58 L 23.179993503795252 5.3999999999999995 L 21.694480809096717 5.22 L 20.559690189765803 5.040000000000001 L 19.864204536615617 4.86 L 19.659889879217758 4.68 L 19.6625092080292 4.5 L 19.66689113924252 4.32 L 19.67421965130914 4.140000000000001 L 19.68647022842939 3.96 L 19.706932183320035 3.78 L 19.741063494808884 3.6 L 19.797868150437353 3.42 L 19.892055716268754 3.2399999999999998 L 20.04726518601882 3.06 L 20.30044386451761 2.88 L 20.706658919929055 2.6999999999999997 L 21.34143668628427 2.5200000000000005 L 22.293585543348698 2.34 L 23.637527297744434 2.16 L 25.3802646491271 1.98 L 27.40751367923398 1.8 L 29.48801667415674 1.6199999999999999 L 31.365924461450213 1.44 L 32.87444162464044 1.2600000000000002 L 33.976742190730775 1.08 L 34.727708767714496 0.9 L 35.21521608205011 0.72 L 35.521850098010965 0.54 L 35.71090092894809 0.36 L 35.8260245029229 0.18 L 35.89560225021488 0 Z" fill="var(--text-secondary)"/>
                  </g>
                </svg>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textAlign: 'center' }}>Playneedle Editor</span>
              </button>
            </div>
          )}
        </div>
      </div>
    } />
  );
}

export function OpenSettings(pageData?: any, scroll?: number | null) {
  if (document.documentElement && !document.documentElement.style.getPropertyValue('--theme-transition-duration')) {
    const duration = (window as any).juicecut?.settings?.colorTransitionDuration || 0;
    document.documentElement.style.setProperty('--theme-transition-duration', `${duration}ms`);
    document.documentElement.style.setProperty('--theme-transition-timing', 'cubic-bezier(0.4, 0, 0.2, 1)');
  }
  
  const result = modalManager.requestOpen('settings');
  if (!result.allowed) {
    showToast(result.reason || '⚠ <br/>opening multiple menus is disabled');
    return;
  }
  
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const cleanup = () => { 
    try { root.unmount(); } catch (e) {} 
    if (container.parentNode) container.parentNode.removeChild(container); 
    modalManager.close('settings');
    (window as any).__popClose?.(); 
  };
  (window as any).__pushClose?.(cleanup);
  root.render(<SettingsShell initialPageData={pageData} initialScroll={scroll ?? null} onClose={cleanup} />);
  return cleanup;
}

export function closeSettings() { modalManager.close('settings'); const existing = document.querySelector(".modal-overlay.settings-modal"); if (existing && existing.parentNode) existing.parentNode.removeChild(existing); }
(window as any).__onColorPickerClose = null;
try { (window as any).OpenSettings = OpenSettings; } catch (e) {}
try { (window as any).closeSettings = closeSettings; } catch (e) {}