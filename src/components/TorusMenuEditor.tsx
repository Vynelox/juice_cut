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
import { RotateCcw } from 'lucide-react';

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
  const [torusOpen, setTorusOpen] = useState(false);
  const [duration, setDuration] = useState(getSavedDuration);
  const [sizeGraph, setSizeGraph] = useState<SizeGraphPoint[]>(getSavedSizeGraph);
  const [segmentHandleValues, setSegmentHandleValues] = useState<number[]>(getSavedSegmentHandleValues);
  const [delay, setDelay] = useState(getSavedDelay);
  const [hoverScale, setHoverScale] = useState(getSavedHoverScale);

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
    setTorusOpen(false);
  }, []);

  const noop = useCallback(() => {}, []);
  const noopBool = useCallback((_ripple: boolean) => {}, []);
  const noopNumBool = useCallback((_dir: number, _ripple: boolean) => {}, []);
  const dummyTarget = { kind: 'inside' as const, clipId: '__preview__', frame: 0 };

  // Delay slider uses logarithmic mapping
  const delaySliderValue = delayToSlider(delay);

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
              <GraphEditor
                graph={sizeGraph}
                onChange={setSizeGraph}
                onEasingChange={setSegmentHandleValues}
                config={TORUS_GRAPH_CONFIG}
                Y_label="size"
                X_label="time"
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