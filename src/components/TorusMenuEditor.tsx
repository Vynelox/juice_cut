//TorusMenuEditor.tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import GraphEditor, { DEFAULT_TORUS_SIZE_GRAPH, getSavedSizeGraph, SizeGraphPoint, GraphConfig, DEFAULT_GRAPH_CONFIG } from './graph';
import { getSavedSegmentHandleValues, saveSegmentHandleValues } from '../utils/torusGraphEasing';
import DraggableModal from './DraggableModal';
import { showToast } from './Toast';
import { modalManager } from '../state/modalManager';
import TorusMenu from './TorusMenu';
import { Slider } from './Adjustables';
import { RotateCcw, Plus } from 'lucide-react';
import { isShortcutMatch, getShortcutKeys as scGetKeys, updateShortcuts as scUpdate, resetDefaultShortcuts as scReset, type ShortcutAction, SHORTCUT_LABELS } from './shortcuts';

// Torus Menu Editor modal dimensions
const EDITOR_WIDTH = 620; //default 620px, can be wider if needed
const EDITOR_HEIGHT = 370; //minimum: 370px, can be taller if needed

const GRAPH_PADDING_LEFT = 10; //THIS CONTROLS THE CLIPPING default 10px. this controls how wide it is
const GRAPH_WIDTH = 100; //kind of a useless variable, doesn't do anything
const GRAPH_HEIGHT = 100; //THIS is a useful variable. controls how high it is

const TORUS_GRAPH_CONFIG: GraphConfig = {
  ...DEFAULT_GRAPH_CONFIG,
  width: GRAPH_WIDTH,
  height: GRAPH_HEIGHT,
  padding: GRAPH_PADDING_LEFT,
};

// Convert saved segment handle values (-1 to 1) back to pixel Y offsets for GraphEditor
function segmentHandleValuesToOffsets(
  values: number[],
  graph: SizeGraphPoint[],
  config: GraphConfig,
  graphWidth: number = config.width
): number[] {
  if (!values || values.length === 0) return [];
  const sorted = graph.slice().sort((a, b) => a.time - b.time);
  const plotWidth = Math.max(0, graphWidth - config.padding * 2);
  const plotHeight = Math.max(0, config.height - config.padding * 2);
  
  return values.map((handleValue, index) => {
    const pointA = sorted[index];
    const pointB = sorted[index + 1];
    if (!pointA || !pointB) return 0;
    
    const svgPointA = { x: config.padding + pointA.time * plotWidth, y: config.padding + (1 - pointA.size) * plotHeight };
    const svgPointB = { x: config.padding + pointB.time * plotWidth, y: config.padding + (1 - pointB.size) * plotHeight };
    
    const minY = Math.min(svgPointA.y, svgPointB.y);
    const maxY = Math.max(svgPointA.y, svgPointB.y);
    const handlerMinY = (2 * minY + svgPointA.y + svgPointB.y) / 4;
    const handlerMaxY = (2 * maxY + svgPointA.y + svgPointB.y) / 4;
    const range = handlerMaxY - handlerMinY;
    if (range <= 0) return (svgPointA.y + svgPointB.y) / 2;
    
    const midpointY = (svgPointA.y + svgPointB.y) / 2;
    const segmentDirection = Math.sign(pointB.size - pointA.size);
    const handlerY = midpointY - (handleValue * range * segmentDirection) / 2;
    
    return Math.max(handlerMinY, Math.min(handlerMaxY, handlerY));
  });
}

function getSavedDuration(): number {
  try {
    const v = window.localStorage.getItem('juicecut.settings.torusDuration');
    if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n <= 2000) return n; }
  } catch {}
  return 300;
}

function getSavedEasing(): number {
  try {
    const v = window.localStorage.getItem('juicecut.settings.torusEasing');
    if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n <= 100) return n; }
  } catch {}
  return 50;
}

function getSavedDelay(): number {
  try {
    const v = window.localStorage.getItem('juicecut.settings.torusDelay');
    if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= -1000 && n <= 1000) return n; }
  } catch {}
  return 0;
}

function getSavedHoverScale(): number {
  try {
    const v = window.localStorage.getItem('juicecut.settings.torusHoverScale');
    if (v !== null) { const n = parseFloat(v); if (!isNaN(n) && n >= 1 && n <= 1.5) return n; }
  } catch {}
  return 1.08;
}

// Logarithmic mapping for delay slider: slider 0..1000 → delay -1000..1000
// Slider 0 = -1000ms, slider 500 = 0ms, slider 1000 = 1000ms
// Both halves use log scale for magnitude
function sliderToDelay(slider: number): number {
  if (slider === 500) return 0;
  if (slider < 500) {
    // Left half: slider 0 → -1000, slider 499 → ~-1
    const t = (500 - slider) / 500; // 1 → 0 as slider goes 0 → 500
    const logVal = Math.pow(10, t * 3); // 1000 → 1
    return -Math.round(logVal);
  } else {
    // Right half: slider 501 → ~1, slider 1000 → 1000
    const t = (slider - 500) / 500;
    const logVal = Math.pow(10, t * 3); // 1 → 1000
    return Math.round(logVal);
  }
}

function delayToSlider(delay: number): number {
  if (delay === 0) return 500;
  if (delay < 0) {
    // Map -1000..-1 to slider 0..499
    const absVal = Math.max(1, Math.abs(delay));
    const t = Math.log10(absVal) / 3; // 0..1
    return Math.round(500 - t * 500); // 500..0
  } else {
    // Map 1..1000 to slider 501..1000
    const t = Math.log10(Math.max(1, delay)) / 3;
    return Math.round(500 + t * 500);
  }
}

export function OpenTorusMenuEditor(onCloseCallback?: () => void) {
  const result = modalManager.requestOpen('torusMenuEditor');
  if (!result.allowed) {
    showToast(result.reason || '⚠ <br/>opening multiple menus is disabled');
    return;
  }
  
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const closeAndReturnToSettings = () => {
    try { root.unmount(); } catch (e) {}
    if (container.parentNode) container.parentNode.removeChild(container);
    (window as any).__popClose?.();
    modalManager.close('torusMenuEditor');
    if (onCloseCallback) onCloseCallback();
  };
  const closeDirectly = () => {
    try { root.unmount(); } catch (e) {}
    if (container.parentNode) container.parentNode.removeChild(container);
    (window as any).__popClose?.();
    modalManager.close('torusMenuEditor');
  };
  (window as any).__pushClose?.(closeDirectly);
  root.render(<TorusMenuEditorModal onClose={closeDirectly} onBack={closeAndReturnToSettings} />);
  return closeDirectly;
}

export interface TorusMenuEditorModalProps {
  onClose: () => void;
  onBack: () => void;
}

export default function TorusMenuEditorModal({ onClose, onBack }: TorusMenuEditorModalProps) {
  // Initialize torusOpen from localStorage to support toggling
  const [torusOpen, setTorusOpen] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem('juicecut.settings.torusOpen');
      return v === 'true';
    } catch {
      return false;
    }
  });
  const [duration, setDuration] = useState(getSavedDuration);
  const [sizeGraph, setSizeGraph] = useState<SizeGraphPoint[]>(getSavedSizeGraph);
  const [segmentHandleValues, setSegmentHandleValues] = useState<number[]>(getSavedSegmentHandleValues);
  const [delay, setDelay] = useState(getSavedDelay);
  const [hoverScale, setHoverScale] = useState(getSavedHoverScale);
  const [closeTorusKeys, setCloseTorusKeys] = useState<string[][]>(() => scGetKeys('toggleTorusMenu'));
  const [editingCloseTorusIndex, setEditingCloseTorusIndex] = useState<number | null>(null);

  // Sync shortcut keys when they change (from Settings or other sources)
  useEffect(() => {
    const handler = () => {
      setCloseTorusKeys(scGetKeys('toggleTorusMenu'));
    };
    window.addEventListener('juicecut-settings-changed', handler);
    return () => window.removeEventListener('juicecut-settings-changed', handler);
  }, []);

  const sortedSizeGraph = useMemo(() => sizeGraph.slice().sort((a, b) => a.time - b.time), [sizeGraph]);

  useEffect(() => {
    try { window.localStorage.setItem('juicecut.settings.torusDuration', String(duration)); } catch {}
  }, [duration]);

  useEffect(() => {
    try { window.localStorage.setItem('juicecut.settings.torusSizeGraph', JSON.stringify(sortedSizeGraph)); } catch {}
  }, [sortedSizeGraph]);

  useEffect(() => {
    saveSegmentHandleValues(segmentHandleValues);
  }, [segmentHandleValues]);

  useEffect(() => {
    try { window.localStorage.setItem('juicecut.settings.torusDelay', String(delay)); } catch {}
  }, [delay]);

  useEffect(() => {
    try { window.localStorage.setItem('juicecut.settings.torusHoverScale', String(hoverScale)); } catch {}
  }, [hoverScale]);

  const handleCloseTorus = useCallback(() => {
    setTorusOpen(prev => !prev); // Toggle
  }, []);

  // Listen for toggle torus menu shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isShortcutMatch('toggleTorusMenu', e)) {
        e.preventDefault();
        e.stopPropagation();
        handleCloseTorus(); // Toggles by setting torusOpen to false
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [handleCloseTorus]);

  const noop = useCallback(() => {}, []);
  const noopBool = useCallback((_ripple: boolean) => {}, []);
  const noopNumBool = useCallback((_dir: number, _ripple: boolean) => {}, []);
  const dummyTarget = { kind: 'inside' as const, clipId: '__preview__', frame: 0 };

  // Delay slider uses logarithmic mapping
  const delaySliderValue = delayToSlider(delay);

  // Format keys for display
  const formatKeys = (keys: string[]): string => {
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
  };

  const handleCloseTorusKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const keys: string[] = [];
    if (e.ctrlKey || e.metaKey) keys.push("ctrl");
    if (e.shiftKey) keys.push("shift");
    if (e.altKey) keys.push("alt");
    const key = e.key.toLowerCase();
    if (key !== "control" && key !== "shift" && key !== "alt" && key !== "meta") {
      keys.push(key === " " ? "space" : key);
    }
    if (keys.length > 0) {
      // Update the shortcut
      const current = scGetKeys('toggleTorusMenu');
      let next: string[][];
      
      // If we're editing an existing slot (empty or not), update it
      if (editingCloseTorusIndex !== null) {
        next = current.map((combo, i) => i === editingCloseTorusIndex ? keys : combo);
      } else {
        // Otherwise append a new combination
        next = [...current, keys];
      }
      
      scUpdate({ ...scGetKeys('undo'), toggleTorusMenu: next } as any);
      setCloseTorusKeys(next);
      setEditingCloseTorusIndex(null);
    }
  };

  const removeCloseTorusCombination = (index: number) => {
    const current = scGetKeys('toggleTorusMenu');
    const next = current.filter((_, i) => i !== index);
    scUpdate({ ...scGetKeys('undo'), toggleTorusMenu: next } as any);
    setCloseTorusKeys(next);
  };

  return (
    <DraggableModal
      title="Torus Menu Editor"
      onClose={onClose}
      headerLeft={
        <button
          className="icon-btn"
          onClick={onBack} 
          style={
            {
              position: 'absolute', 
              left: 8, 
              top: '50%', 
              transform: 'translateY(-50%)', 
              width: 26, 
              height: 26, 
              color: 'var(--text-secondary)',

            }
          }
          title="Back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
      }
      style={{ width: EDITOR_WIDTH, minHeight: EDITOR_HEIGHT }}
      body={
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '4px 0 12px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 12, width: 260 }}>
              <Slider
                label="Duration"
                value={duration}
                min={0}
                max={2000}
                step={10}
                onChange={setDuration}
                onReset={() => setDuration(300)}
                formatValue={v => `${v}ms`}
              />
              <div className="settings-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ lineHeight: 1.2 }}>{SHORTCUT_LABELS.toggleTorusMenu}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" className="icon-btn" onClick={() => {
                      const current = scGetKeys('toggleTorusMenu');
                      const next = [...current, []];
                      scUpdate({ ...scGetKeys('undo'), toggleTorusMenu: next } as any);
                      setCloseTorusKeys(next);
                    }} title="Add shortcut combination" style={{ padding: 4 }}><Plus size={14} /></button>
                    <button type="button" className="icon-btn" onClick={() => {
                      scReset('toggleTorusMenu');
                      setCloseTorusKeys(scGetKeys('toggleTorusMenu'));
                    }} title="Reset to default shortcuts" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {closeTorusKeys.map((keys, idx) => {
                    const isEditing = editingCloseTorusIndex === idx;
                    return (
                      <div
                        key={idx}
                        tabIndex={0}
                        onFocus={() => setEditingCloseTorusIndex(idx)}
                        onBlur={() => setTimeout(() => setEditingCloseTorusIndex(null), 150)}
                        onKeyDown={handleCloseTorusKeyDown}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: isEditing ? 'var(--bg-hover)' : 'var(--bg-elevated)',
                          border: isEditing ? '1px solid var(--highlight-color)' : '1px solid var(--border-mid)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '3px 8px',
                          cursor: 'pointer',
                          outline: 'none',
                          minHeight: 28,
                        }}
                        title={isEditing && keys.length === 0 ? "Press keys to assign..." : "Click then press new keys to reassign"}
                      >
                        <span style={{ fontSize: 12, color: keys.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {isEditing && keys.length === 0 ? "..." : keys.length > 0 ? formatKeys(keys) : "None"}
                        </span>
                        {closeTorusKeys.length > 1 && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              removeCloseTorusCombination(idx);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '0 2px',
                              fontSize: 13,
                              lineHeight: 1,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Remove this combination"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <GraphEditor
                graph={sizeGraph}
                onChange={setSizeGraph}
                onEasingChange={setSegmentHandleValues}
                config={TORUS_GRAPH_CONFIG}
                Y_label="size"
                X_label="time"
                initialEasingOffsets={segmentHandleValuesToOffsets(segmentHandleValues, sizeGraph, TORUS_GRAPH_CONFIG)}
              />
              <div className="settings-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ flex: 1, lineHeight: 1.2 }}>Delay</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{delay}ms</span>
                    <button type="button" className="icon-btn" onClick={() => setDelay(0)} title="Reset to default" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                  </div>
                </div>
                <input
                  type="range"
                  className="settings-range-input"
                  min={0}
                  max={1000}
                  step={1}
                  value={delaySliderValue}
                  onChange={e => setDelay(sliderToDelay(Number(e.target.value)))}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>-1000ms</span>
                  <span style={{ color: 'var(--text-muted)' }}>0ms</span>
                  <span>1000ms</span>
                </div>
              </div>
              <div className="settings-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ flex: 1, lineHeight: 1.2 }}>Hover Scale</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{hoverScale.toFixed(2)}x</span>
                    <button type="button" className="icon-btn" onClick={() => setHoverScale(1.08)} title="Reset to default" style={{ padding: 4 }}><RotateCcw size={14} /></button>
                  </div>
                </div>
                <input
                  type="range"
                  className="settings-range-input"
                  min={100}
                  max={150}
                  step={1}
                  value={Math.round(hoverScale * 100)}
                  onChange={e => setHoverScale(Number(e.target.value) / 100)}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>1.00x</span>
                  <span style={{ color: 'var(--text-muted)' }}>1.08x</span>
                  <span>1.50x</span>
                </div>
              </div>
            </div>

            <div
              style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: 260,
                height: 260,
              }}
            >
              {torusOpen && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  zIndex: 5,
                  pointerEvents: 'none',
                }}>
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'auto',
                  }}>
                    <TorusMenu
                      interactive
                      pos={{ x: 0, y: 0 }}
                      target={dummyTarget}
                      onClose={handleCloseTorus}
                      onSplit={noop}
                      onTrimLatter={noopBool}
                      onTrimFormer={noopBool}
                      onStep={noopNumBool}
                      onRoll={noop}
                      showCloseButton
                      duration={duration}
                      sizeGraph={sortedSizeGraph}
                      segmentHandleValues={segmentHandleValues}
                      delay={delay}
                      hoverScale={hoverScale}
                      closeOnBackgroundClick={false}
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                className="torus-toggle-btn"
                onClick={() => setTorusOpen(o => !o)}
                title="Toggle torus menu"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: '1px solid var(--border-mid)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 3000,
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1,
                }}
              >
                •••
              </button>
            </div>
          </div>
        </div>
      }
    />
  );
}