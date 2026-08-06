//timeline.tsx
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { Film, Music } from 'lucide-react';
import type { TimelineClip, Track, MediaItem } from '../types';
import { FPS, formatTimecode } from '../types';
import TorusMenu from './TorusMenu';
import Waveform from './Waveform';
import ThumbnailRoll from './ThumbnailRoll';
import { isWheelShortcutMatch } from './shortcuts';
import FormulaPlayneedle from './FormulaPlayneedle';

interface Props {
  clips: TimelineClip[];
  tracks: Track[];
  playhead: number;
  selectedIds: string[];
  onSeek: (frame: number) => void;
  onDropMedia: (mediaId: string, track: number, startFrame: number) => void;
  onSelectClip: (id: string, multi: boolean) => void;
  onSplitClip: (clipId: string, frame: number) => void;
  onTrimLatter: (clipId: string, frame: number, ripple: boolean) => void;
  onTrimFormer: (clipId: string, frame: number, ripple: boolean) => void;
  onNudge: (ids: string[], delta: number) => void;
  onJoin: (clipAId: string, clipBId: string) => void;
  onFadeChange: (clipId: string, side: 'in' | 'out', frames: number) => void;
  onRoll: (clipId: string) => void;
  onStepEdge: (clipId: string | null, cutBetween: [string, string] | null, direction: number, ripple: boolean) => void;
  totalFrames: number;
}

const TRACK_H = 64;
const HEADER_H = 32;
const PX_PER_FRAME = 4;
const PLAYHEAD_MAX_WIDTH = 20;

// Retrieve saved playneedle width (in pixels) for timeline preview
function getSavedPnWidth(): number {
  try {
    const v = window.localStorage.getItem('juicecut.settings.playneedle_width');
    if (v !== null) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0 && n <= 500) return n; }
  } catch {}
  // Default matches editor preview width
  return 260;
}

function getSavedHoverScale(): number {
  try {
    const v = window.localStorage.getItem('juicecut.settings.torusHoverScale');
    if (v !== null) { const n = parseFloat(v); if (!isNaN(n) && n >= 1 && n <= 1.5) return n; }
  } catch {}
  return 1.08;
}

function frameToX(frame: number, zoom: number) { return frame * PX_PER_FRAME * zoom; }
function xToFrame(x: number, zoom: number) { return Math.round(x / (PX_PER_FRAME * zoom)); }

type TorusTarget =
  | { kind: 'inside'; clipId: string; frame: number }
  | { kind: 'edge'; clipId: string; side: 'start' | 'end'; frame: number }
  | { kind: 'cut'; clipAId: string; clipBId: string; frame: number };

interface PropsWithMedia extends Props {
  mediaItems: Map<string, MediaItem>;
}

interface PlayneedleFormulaParams {
  t: number;
  j: number;
  k: number;
  s: number;
  v_o: number;
  h_b: number;
  h_r: number;
}

function getPlayneedleParams(): PlayneedleFormulaParams {
  const get = (key: string, fallback: number) => {
    try { const v = window.localStorage.getItem(`juicecut.settings.playneedle_${key}`); return v !== null ? Number(v) : fallback; } catch { return fallback; }
  };
  return {
    t:   get('t',   0.092),
    j:   get('j',   0.049),
    k:   get('k',   103),
    s:   get('s',   16.4),
    v_o: get('v_o', 0.4),
    h_b: get('h_b', 0.8),
    h_r: get('h_r', 1),
  };
}

export default function Timeline({
  clips, tracks, playhead, selectedIds,
  onSeek, onDropMedia, onSelectClip,
  onSplitClip, onTrimLatter, onTrimFormer,
  onNudge, onJoin, onFadeChange, onRoll, onStepEdge,
  totalFrames,
  mediaItems
}: PropsWithMedia) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [torusPos, setTorusPos] = useState<{ x: number; y: number } | null>(null);
  const [torusTarget, setTorusTarget] = useState<TorusTarget | null>(null);
  const [dragState, setDragState] = useState<{
    clipId: string; origStart: number; mouseStartX: number;
  } | null>(null);
  const [fadeState, setFadeState] = useState<{
    clipId: string; side: 'in' | 'out'; origFrames: number; mouseStartX: number;
  } | null>(null);
  const playheadDraggingRef = useRef(false);
  const lastMouseClientX = useRef(0);
  const playheadRef = useRef(playhead);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  const getScrollSmoothFactor = () => {
    try { const v = window.localStorage.getItem('juicecut.settings.scrollSmooth'); return v ? Number(v) : 50; } catch { return 50; }
  };
  const getScrollAmount = () => {
    try { const v = window.localStorage.getItem('juicecut.settings.scrollAmount'); return v ? Number(v) : 100; } catch { return 100; }
  };
  const getScrollZoomAmount = () => {
    try { const v = window.localStorage.getItem('juicecut.settings.scrollZoomAmount'); return v ? Number(v) : 25; } catch { return 25; }
  };
  const getScrollZoomSmoothness = () => {
    try { const v = window.localStorage.getItem('juicecut.settings.scrollZoomSmoothness'); return v ? Number(v) : 70; } catch { return 70; }
  };
  const getCancelZoomOnScroll = () => {
    try { const v = window.localStorage.getItem('juicecut.settings.cancelZoomOnScroll'); return v === null ? true : v === 'true'; } catch { return true; }
  };
  const getTorusScrollingDisabled = (): 'whole torus menu' | 'annular sectors only' | 'none' => {
    try { return (window.localStorage.getItem('juicecut.settings.torusScrollingDisabled') as 'whole torus menu' | 'annular sectors only' | 'none') || 'none'; } catch { return 'none'; }
  };
  const [timecodePanel, setTimecodePanel] = useState<string>(() => {
    try { return window.localStorage.getItem('juicecut.settings.timecodePanel') || 'both'; } catch { return 'both'; }
  });
  const [playneedleParams, setPlayneedleParams] = useState<PlayneedleFormulaParams>(getPlayneedleParams);
  // Reactive playneedle width (re-reads when the setting changes)
  const [pnWidth, setPnWidth] = useState<number>(getSavedPnWidth);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === 'timecodePanel' && typeof detail.value === 'string') {
        setTimecodePanel(detail.value);
      }
      // Re-read all playneedle params when any playneedle setting changes
      if (detail?.key && String(detail.key).startsWith('playneedle_')) {
        setPlayneedleParams(getPlayneedleParams());
      }
      // Re-read playneedle width when it changes
      if (detail?.key === 'playneedle_width') {
        setPnWidth(getSavedPnWidth());
      }
    };
    window.addEventListener('juicecut-settings-changed', handler);
    return () => window.removeEventListener('juicecut-settings-changed', handler);
  }, []);
  const getGuiScale = () => {
    try { const v = window.localStorage.getItem('juicecut.settings.guiScale'); return v ? Number(v) / 100 : 1; } catch { return 1; }
  };
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const zoomTargetRef = useRef<number>(1);
  const zoomRafRef = useRef<number | null>(null);
  const zoomScrollElRef = useRef<HTMLElement | null>(null);
  const zoomMouseXRef = useRef<number>(0);
  const zoomBeforeFrameRef = useRef<number>(0);
  const zoomCurrentRef = useRef<number>(1);
  const zoomAnimatingRef = useRef(false);
  const [zoomAnimTrigger, setZoomAnimTrigger] = useState(0);
  const scrollTargetRef = useRef<number | null>(null);
  const zoomMouseXTargetRef = useRef<number>(0);
  const playheadScrollTargetRef = useRef<number | null>(null);
  const [playheadHeight, setPlayheadHeight] = useState(200);

  useEffect(() => {
    zoomCurrentRef.current = zoom;
    if (!zoomAnimatingRef.current) zoomTargetRef.current = zoom;
  }, [zoom]);
  
  // Keep the playneedle height synchronized with the visible timeline pane
  useLayoutEffect(() => {
    const updatePlayheadHeight = () => {
      const scrollEl = containerRef.current?.querySelector('.tl-scroll') as HTMLElement | null;
      if (scrollEl) {
        const nextHeight = Math.max(1, Math.round(scrollEl.clientHeight));
        setPlayheadHeight(prev => (prev === nextHeight ? prev : nextHeight));
      }
    };

    updatePlayheadHeight();

    const scrollEl = containerRef.current?.querySelector('.tl-scroll') as HTMLElement | null;
    const resizeObserver = scrollEl ? new ResizeObserver(() => updatePlayheadHeight()) : null;
    if (resizeObserver && scrollEl) {
      resizeObserver.observe(scrollEl);
    }

    window.addEventListener('resize', updatePlayheadHeight);

    const handleGuiScaleChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === 'guiScale') {
        setTimeout(updatePlayheadHeight, 50);
      }
    };
    window.addEventListener('juicecut-settings-changed', handleGuiScaleChange);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePlayheadHeight);
      window.removeEventListener('juicecut-settings-changed', handleGuiScaleChange);
    };
  }, []);

  const pendingScrollCorrection = useRef<{ el: HTMLElement; scrollLeft: number } | null>(null);
  useLayoutEffect(() => {
    if (!pendingScrollCorrection.current) return;
    const { el, scrollLeft } = pendingScrollCorrection.current;
    pendingScrollCorrection.current = null;
    el.scrollLeft = scrollLeft;
  });

  useEffect(() => {
    if (zoomRafRef.current !== null) return;

    const animateZoom = () => {
      const currentZoom = zoomCurrentRef.current;
      const targetZoom = zoomTargetRef.current;
      const diff = targetZoom - currentZoom;
      const smoothness = getScrollZoomSmoothness();
      const t = smoothness === 0 ? 1 : Math.pow(1 - smoothness / 100, 2) * 0.96 + 0.04;
      const done = Math.abs(diff) < 0.0001;
      const clampedZoom = done ? targetZoom : Math.max(0.25, Math.min(4, currentZoom + diff * t));

      zoomCurrentRef.current = clampedZoom;
      zoomAnimatingRef.current = !done;

      if (zoomScrollElRef.current) {
        const el = zoomScrollElRef.current;
        const zoomEpicenter = (() => { try { return window.localStorage.getItem('juicecut.settings.zoomEpicenter') || 'playneedle'; } catch { return 'playneedle'; } })();

        let targetScrollLeft: number;
        if (zoomEpicenter === 'playneedle') {
          if (playheadScrollTargetRef.current !== null) {
            const currentScroll = el.scrollLeft;
            const scrollSmoothFactor = getScrollSmoothFactor();
            const st = scrollSmoothFactor === 0 ? 1 : 0.02 + (1 - scrollSmoothFactor / 100) * 0.18;
            const newScroll = currentScroll + (playheadScrollTargetRef.current - currentScroll) * st;
            const playheadViewportX = frameToX(playheadRef.current, clampedZoom) - newScroll;
            if (playheadViewportX >= el.clientWidth * 0.25 && playheadViewportX <= el.clientWidth * 0.75) {
              playheadScrollTargetRef.current = null;
            }
            targetScrollLeft = Math.max(0, newScroll);
          } else {
            targetScrollLeft = Math.max(0, frameToX(zoomBeforeFrameRef.current, clampedZoom) - zoomMouseXRef.current);
          }
        } else if (zoomEpicenter === 'middle') {
          const centeredScrollLeft = frameToX(zoomBeforeFrameRef.current, clampedZoom) - el.clientWidth / 2;
          targetScrollLeft = Math.max(0, centeredScrollLeft);
        } else {
          targetScrollLeft = Math.max(0, frameToX(zoomBeforeFrameRef.current, clampedZoom) - zoomMouseXRef.current);
        }

        pendingScrollCorrection.current = { el, scrollLeft: targetScrollLeft };
      }

      setZoom(clampedZoom);

      if (done) {
        zoomRafRef.current = null;
      } else {
        zoomRafRef.current = requestAnimationFrame(animateZoom);
      }
    };

    if (Math.abs(zoomTargetRef.current - zoomCurrentRef.current) > 0.001) {
      zoomRafRef.current = requestAnimationFrame(animateZoom);
    }
  }, [zoomAnimTrigger]);

  const totalWidth = Math.max(frameToX(totalFrames + 60 * FPS, zoom), 1200);

  const rulerTicks = () => {
    const ticks: Array<{ x: number; label: string }> = [];
    const pxPerSec = PX_PER_FRAME * zoom * FPS;
    const step = pxPerSec < 40 ? 5 : pxPerSec < 80 ? 2 : 1;
    const frames = totalFrames + 60 * FPS;
    for (let s = 0; s * FPS <= frames; s += step) {
      ticks.push({ x: frameToX(s * FPS, zoom), label: formatTimecode(s * FPS) });
    }
    return ticks;
  };

  const getPlayheadContext = useCallback((): TorusTarget => {
    for (const clip of clips) {
      if (Math.abs(playhead - clip.startFrame) <= 1) {
        const adj = clips.find(c => c.track === clip.track && Math.abs(c.endFrame - clip.startFrame) <= 1);
        if (adj) return { kind: 'cut', clipAId: adj.id, clipBId: clip.id, frame: playhead };
        return { kind: 'edge', clipId: clip.id, side: 'start', frame: playhead };
      }
      if (Math.abs(playhead - clip.endFrame) <= 1) {
        const adj = clips.find(c => c.track === clip.track && Math.abs(c.startFrame - clip.endFrame) <= 1);
        if (adj) return { kind: 'cut', clipAId: clip.id, clipBId: adj.id, frame: playhead };
        return { kind: 'edge', clipId: clip.id, side: 'end', frame: playhead };
      }
      if (playhead > clip.startFrame && playhead < clip.endFrame) {
        return { kind: 'inside', clipId: clip.id, frame: playhead };
      }
    }
    return { kind: 'inside', clipId: '', frame: playhead };
  }, [clips, playhead]);

  const playheadX = frameToX(playhead, zoom);

  const handleNeedleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const target = getPlayheadContext();
    setTorusTarget(target);
    
    // Calculate the viewport position of the playneedle button center
    const el = containerRef.current;
    if (el) {
      const scrollEl = el.querySelector('.tl-scroll') as HTMLElement | null;
      const scrollRect = scrollEl?.getBoundingClientRect();
      const scrollLeft = scrollEl?.scrollLeft ?? 0;
      const phHeight = scrollEl?.clientHeight ?? 200;
      
      // X coordinate: center of the playneedle in viewport
      const btnCenterX = (scrollRect?.left ?? 0) + playheadX - scrollLeft;
      
      // Y coordinate: button center position within the playneedle
      // The playneedle function f(x) maps x ∈ [0,1] to the full height
      // The button center is at: v_o * (1 - π/s) + π/(2s) as a fraction of the height
      const { v_o, s } = playneedleParams;
      const buttonCenterFraction = v_o * (1 - Math.PI / s) + Math.PI / (2 * s);
      const btnCenterY = (scrollRect?.top ?? 0) + buttonCenterFraction * phHeight;
      
      setTorusPos({ x: btnCenterX, y: btnCenterY });
    } else {
      setTorusPos({ x: e.clientX, y: e.clientY });
    }
  }, [getPlayheadContext, playheadX, playneedleParams]);

  // Toggle torus menu open/closed when the shortcut is pressed
  const torusTargetRef = useRef(torusTarget);
  torusTargetRef.current = torusTarget;

  useEffect(() => {
    const handler = () => {
      if (torusTargetRef.current) {
        // Already open → close it
        setTorusTarget(null);
        setTorusPos(null);
      } else {
        // Closed → open it at the playhead context
        const target = getPlayheadContext();
        setTorusTarget(target);

        // Position the menu at the playneedle button center (same as handleNeedleClick)
        const el = containerRef.current;
        if (el) {
          const scrollEl = el.querySelector('.tl-scroll') as HTMLElement | null;
          const scrollRect = scrollEl?.getBoundingClientRect();
          const scrollLeft = scrollEl?.scrollLeft ?? 0;
          const phHeight = scrollEl?.clientHeight ?? 200;
          const btnCenterX = (scrollRect?.left ?? 0) + playheadX - scrollLeft;
          const { v_o, s } = playneedleParams;
          const buttonCenterFraction = v_o * (1 - Math.PI / s) + Math.PI / (2 * s);
          const btnCenterY = (scrollRect?.top ?? 0) + buttonCenterFraction * phHeight;
          setTorusPos({ x: btnCenterX, y: btnCenterY });
        } else {
          setTorusPos({ x: 400, y: 300 });
        }
      }
    };
    window.addEventListener('juicecut-torus-toggle', handler);
    return () => window.removeEventListener('juicecut-torus-toggle', handler);
  }, [getPlayheadContext, playheadX, playneedleParams]);

  const getJoinPairs = useCallback(() => {
    const pairs: Array<{ clipA: TimelineClip; clipB: TimelineClip }> = [];
    for (const clipA of clips) {
      const clipB = clips.find(c =>
        c.track === clipA.track &&
        c.id !== clipA.id &&
        Math.abs(c.startFrame - clipA.endFrame) <= 1
      );
      if (clipB) {
        const alreadyAdded = pairs.some(p => p.clipA.id === clipB.id || p.clipB.id === clipA.id);
        if (!alreadyAdded) pairs.push({ clipA, clipB });
      }
    }
    return pairs;
  }, [clips]);

  const startClipDrag = (e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    if (!selectedIds.includes(clipId)) onSelectClip(clipId, e.shiftKey);
    setDragState({ clipId, origStart: clip.startFrame, mouseStartX: e.clientX });
  };

  const startFadeDrag = (e: React.MouseEvent, clipId: string, side: 'in' | 'out') => {
    e.stopPropagation();
    e.preventDefault();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    setFadeState({
      clipId, side,
      origFrames: side === 'in' ? clip.fades.in : clip.fades.out,
      mouseStartX: e.clientX
    });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    lastMouseClientX.current = e.clientX;
    if (dragState) {
      const dx = e.clientX - dragState.mouseStartX;
      const deltaFrames = xToFrame(dx, zoom);
      const newStart = Math.max(0, dragState.origStart + deltaFrames);
      const el = document.querySelector(`[data-clip-id="${dragState.clipId}"]`) as HTMLElement;
      if (el) el.style.transform = `translateX(${frameToX(newStart - dragState.origStart, zoom)}px)`;
    }
    if (fadeState) {
      const dx = e.clientX - fadeState.mouseStartX;
      const deltaFrames = xToFrame(dx, zoom) * (fadeState.side === 'in' ? 1 : -1);
      const newFrames = Math.max(0, fadeState.origFrames + deltaFrames);
      onFadeChange(fadeState.clipId, fadeState.side, newFrames);
    }
    if (playheadDraggingRef.current && containerRef.current) {
      const scrollEl = containerRef.current.querySelector('.tl-scroll') as HTMLElement;
      const scrollRect = scrollEl?.getBoundingClientRect();
      const scrollX = scrollEl?.scrollLeft ?? 0;
      if (scrollRect) {
        const x = scrollX + (lastMouseClientX.current - scrollRect.left);
        const frame = Math.max(0, xToFrame(x, zoom));
        onSeek(frame);
      }
    }
  }, [dragState, fadeState, zoom, onFadeChange, onSeek]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (dragState) {
      const dx = e.clientX - dragState.mouseStartX;
      const deltaFrames = xToFrame(dx, zoom);
      if (deltaFrames !== 0) onNudge([dragState.clipId], deltaFrames);
      const el = document.querySelector(`[data-clip-id="${dragState.clipId}"]`) as HTMLElement;
      if (el) el.style.transform = '';
      setDragState(null);
    }
    if (fadeState) setFadeState(null);
    if (playheadDraggingRef.current) {
      playheadDraggingRef.current = false;
    }
  }, [dragState, fadeState, zoom, onNudge]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const scrollEl = containerRef.current?.querySelector('.tl-scroll') as HTMLElement | null;
    if (!scrollEl) return;
    const handleScroll = () => {
      if (playheadDraggingRef.current && containerRef.current) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const scrollX = scrollEl.scrollLeft;
        const x = scrollX + (lastMouseClientX.current - scrollRect.left);
        const frame = Math.max(0, xToFrame(x, zoom));
        onSeek(frame);
      }
    };
    scrollEl.addEventListener('scroll', handleScroll);
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, [zoom, onSeek]);

  useEffect(() => {
    const animate = () => {
      const vel = velocityRef.current;
      if (Math.abs(vel) > 0.5 && scrollElRef.current) {
        scrollElRef.current.scrollLeft += vel;
        const scrollSmoothFactor = getScrollSmoothFactor();
        const friction = 0.92 + (scrollSmoothFactor / 100) * 0.06;
        velocityRef.current = vel * friction;
        rafRef.current = requestAnimationFrame(animate);
      } else {
        velocityRef.current = 0;
        rafRef.current = null;
      }
    };

    if (velocityRef.current !== 0 && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const handleWheel = useCallback((_e: React.WheelEvent<HTMLElement>) => {
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && selectedIds.length > 0) { e.preventDefault(); onNudge(selectedIds, -1); }
      if (e.key === 'ArrowRight' && selectedIds.length > 0) { e.preventDefault(); onNudge(selectedIds, 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, onNudge]);

  useEffect(() => {
    const scrollEl = containerRef.current?.querySelector('.tl-scroll') as HTMLElement | null;
    if (!scrollEl) return;
    const handler = (e: WheelEvent) => {
      const el = scrollEl;
      scrollElRef.current = el;
      const scrollSmoothFactor = getScrollSmoothFactor();
      const scrollAmount = getScrollAmount();

      if (isWheelShortcutMatch('timelineZoomToggle', e)) {
        e.preventDefault();
        velocityRef.current = 0;

        const zoomAmountSetting = getScrollZoomAmount();
        const zoomScale = 1 + zoomAmountSetting / 100;
        const scale = e.deltaY < 0 ? zoomScale : 1 / zoomScale;
        const targetZoom = Math.max(0.25, Math.min(4, zoomTargetRef.current * scale));

        const zoomEpicenter = (() => { try { return window.localStorage.getItem('juicecut.settings.zoomEpicenter') || 'playneedle'; } catch { return 'playneedle'; } })();

        if (zoomEpicenter === 'playneedle') {
          zoomBeforeFrameRef.current = playheadRef.current;
          const playheadViewportX = frameToX(playheadRef.current, zoomCurrentRef.current) - el.scrollLeft;
          zoomMouseXRef.current = playheadViewportX;
          zoomMouseXTargetRef.current = playheadViewportX;
          if (playheadViewportX < 0 || playheadViewportX > el.clientWidth) {
            const targetViewportX = el.clientWidth * 0.5;
            const targetScrollLeft = frameToX(playheadRef.current, zoomCurrentRef.current) - targetViewportX;
            playheadScrollTargetRef.current = Math.max(0, targetScrollLeft);
          } else {
            playheadScrollTargetRef.current = null;
          }
        } else if (zoomEpicenter === 'cursor') {
          const rect = el.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          zoomBeforeFrameRef.current = xToFrame(el.scrollLeft + mouseX, zoomCurrentRef.current);
          zoomMouseXRef.current = mouseX;
          zoomMouseXTargetRef.current = mouseX;
        } else {
          const rect = el.getBoundingClientRect();
          const middleX = el.clientWidth / 2;
          zoomBeforeFrameRef.current = xToFrame(el.scrollLeft + middleX, zoomCurrentRef.current);
          zoomMouseXRef.current = middleX;
          zoomMouseXTargetRef.current = middleX;
        }

        zoomTargetRef.current = targetZoom;
        zoomScrollElRef.current = el;
        setZoomAnimTrigger(n => n + 1);
        return;
      }

      const rawDelta = Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY;
      const delta = rawDelta * (scrollAmount / 100);
      if (delta === 0) return;
      e.preventDefault();

      if (zoomAnimatingRef.current) {
        if (zoomRafRef.current !== null) { cancelAnimationFrame(zoomRafRef.current); zoomRafRef.current = null; }
        if (pendingScrollCorrection.current) {
          const { el: corrEl, scrollLeft } = pendingScrollCorrection.current;
          pendingScrollCorrection.current = null;
          corrEl.scrollLeft = scrollLeft;
        }
        zoomScrollElRef.current = null;
        scrollTargetRef.current = null;
        zoomAnimatingRef.current = false;
        if (getCancelZoomOnScroll()) {
          zoomCurrentRef.current = zoomTargetRef.current;
          setZoom(zoomTargetRef.current);
        }
      }

      if (scrollSmoothFactor === 0) {
        el.scrollLeft += delta;
      } else {
        velocityRef.current += delta * 0.5;
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(function animate() {
            const vel = velocityRef.current;
            if (Math.abs(vel) > 0.5 && scrollElRef.current) {
              scrollElRef.current.scrollLeft += vel;
              const friction = 0.92 + (getScrollSmoothFactor() / 100) * 0.06;
              velocityRef.current = vel * friction;
              rafRef.current = requestAnimationFrame(animate);
            } else {
              velocityRef.current = 0;
              rafRef.current = null;
            }
          });
        }
      }
    };
    scrollEl.addEventListener('wheel', handler, { passive: false });
    return () => scrollEl.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    const handleSettingsChange = () => {
      if (Math.abs(zoomTargetRef.current - zoom) > 0.001 && zoomRafRef.current === null) {
      }
    };
    window.addEventListener('juicecut-settings-changed', handleSettingsChange);
    return () => window.removeEventListener('juicecut-settings-changed', handleSettingsChange);
  }, [zoom]);

  const handleTrackDrop = (e: React.DragEvent, trackIdx: number) => {
    e.preventDefault();
    const mediaId = e.dataTransfer.getData('text/plain');
    if (!mediaId) return;
    const scrollEl = containerRef.current?.querySelector('.tl-scroll') as HTMLElement;
    const scrollX = scrollEl?.scrollLeft ?? 0;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + scrollX;
    const frame = Math.max(0, xToFrame(x, zoom));
    onDropMedia(mediaId, trackIdx, frame);
  };

  const clipColor = (type: string) =>
    type === 'video' ? 'clip-video' : type === 'audio' ? 'clip-audio' : 'clip-image';

  return (
    <div className="timeline" ref={containerRef}>
      <div className="tl-toolbar">
        <span className="panel-title">Timeline</span>
        <div className="zoom-ctrl">
          <button className="icon-btn" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}>-</button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn" onClick={() => setZoom(z => Math.min(4, z + 0.25))}>+</button>
        </div>
        {timecodePanel === 'timeline' || timecodePanel === 'both' ? (
          <span className="timecode">{formatTimecode(playhead)}</span>
        ) : null}
      </div>

      <div className="tl-main">
        <div className="tl-labels">
          {tracks.map(tr => (
            <div key={tr.id} className="tl-label" style={{ height: TRACK_H }}>
              {tr.type === 'video' ? <Film size={13} /> : <Music size={13} />}
              <span>{tr.label}</span>
            </div>
          ))}
        </div>

        <div className="tl-scroll" style={{ position: 'relative', overflow: 'auto hidden', flex: 1, height: '100%' }} onWheel={handleWheel}>
          <div
            className="tl-inner"
            style={{ width: totalWidth, position: 'relative', height: '100%' }}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('.tl-clip') || target.closest('.fade-handle') || target.closest('.join-btn') || target.closest('.tl-playhead')) {
                return;
              }
              e.preventDefault();
              const scrollEl = containerRef.current?.querySelector('.tl-scroll') as HTMLElement;
              const scrollX = scrollEl?.scrollLeft ?? 0;
              const scrollRect = scrollEl?.getBoundingClientRect();
              if (scrollRect) {
                const x = scrollX + (e.clientX - scrollRect.left);
                onSeek(Math.max(0, xToFrame(x, zoom)));
              }
              playheadDraggingRef.current = true;
            }}
          >
            <div className="tl-ruler" style={{ height: HEADER_H, width: totalWidth }}>
              {rulerTicks().map((t, i) => (
                <div key={i} className="ruler-tick" style={{ left: t.x }}>
                  <span className="ruler-label">{t.label}</span>
                </div>
              ))}
            </div>

            <div className="tl-grid-overlay" style={{ position: 'absolute', top: HEADER_H, left: 0, width: totalWidth, height: `calc(100% - ${HEADER_H}px)`, pointerEvents: 'none', zIndex: 1 }}>
              {rulerTicks().map((t, i) => (
                <div key={i} className="ruler-tick" style={{ left: t.x }} />
              ))}
            </div>

            <div className="tl-tracks-wrap" style={{ height: `calc(100% - ${HEADER_H}px)` }}>
              {tracks.map((tr, tIdx) => (
                <div
                  key={tr.id}
                  className="tl-track"
                  style={{ height: TRACK_H, width: totalWidth }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                  onDrop={e => handleTrackDrop(e, tIdx)}
                >
                  {clips.filter(c => c.track === tIdx).map(clip => {
                    const x = frameToX(clip.startFrame, zoom);
                    const w = Math.max(frameToX(clip.endFrame - clip.startFrame, zoom), 4);
                    const fadeInW = frameToX(clip.fades.in, zoom);
                    const fadeOutW = frameToX(clip.fades.out, zoom);
                    const isSelected = selectedIds.includes(clip.id);

                    return (
                      <div
                        key={clip.id}
                        data-clip-id={clip.id}
                        className={`tl-clip ${clipColor(clip.type)}${isSelected ? ' selected' : ''}`}
                        style={{ left: x, width: w, height: TRACK_H, top: 0 }}
                        onMouseDown={e => startClipDrag(e, clip.id)}
                        onClick={e => { e.stopPropagation(); onSelectClip(clip.id, e.shiftKey); }}
                      >
                        {fadeInW > 0 && <div className="fade-overlay fade-in" style={{ width: fadeInW }} />}
                        {fadeOutW > 0 && <div className="fade-overlay fade-out" style={{ width: fadeOutW }} />}
                        <div className="clip-inner" style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 22px' }}>
                          <span className="clip-label">{clip.name}</span>
                          <div style={{ flex: 1 }}>
                            {clip.type === 'audio' && (() => {
                              const media = mediaItems.get(clip.mediaId);
                              if (media) return <Waveform src={media.src} width={w} height={TRACK_H - 24} color="#d1fae5" />;
                              return null;
                            })()}
                            {clip.type === 'video' && (() => {
                              const media = mediaItems.get(clip.mediaId);
                              if (media) return <ThumbnailRoll src={media.src} totalWidth={w} height={Math.min(48, TRACK_H - 16)} count={Math.min(8, Math.max(3, Math.floor(w / 80)))} />;
                              return null;
                            })()}
                          </div>
                        </div>
                        <div className="fade-handle fade-handle-l" onMouseDown={e => startFadeDrag(e, clip.id, 'in')} />
                        <div className="fade-handle fade-handle-r" onMouseDown={e => startFadeDrag(e, clip.id, 'out')} />
                      </div>
                    );
                  })}

                  {getJoinPairs()
                    .filter(p => clips.find(c => c.id === p.clipA.id)?.track === tIdx)
                    .map(({ clipA, clipB }) => (
                      <button
                        key={`join-${clipA.id}-${clipB.id}`}
                        className="join-btn"
                        style={{ left: frameToX(clipA.endFrame, zoom) - 16, top: TRACK_H / 2 - 10 }}
                        onClick={e => { e.stopPropagation(); onJoin(clipA.id, clipB.id); }}
                        title="Join clips"
                      >
                        J
                      </button>
                    ))
                  }
                </div>
              ))}
            </div>

            {/* Formula-based playneedle */}
            <div
              className="tl-playhead"
              style={{
                position: 'absolute',
                left: playheadX - pnWidth / 2,
                top: 0,
                width: pnWidth,
                height: '100%',
                zIndex: 40,
                pointerEvents: 'none',
                overflow: 'hidden',
              }}
            >
              <div
                style={{ pointerEvents: 'all', width: '100%', height: '100%' }}
                onMouseDown={(e) => { e.preventDefault(); playheadDraggingRef.current = true; }}
                onClick={handleNeedleClick}
              >
                <FormulaPlayneedle
                  height={playheadHeight}
                  maxWidth={pnWidth}
                  color="var(--playneedle)"
                  glowColor="color-mix(in srgb, var(--playneedle) 60%, transparent)"
                  params={playneedleParams}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {torusTarget && torusPos && (
        <TorusMenu
          interactive
          pos={torusPos}
          target={torusTarget}
          onClose={() => { setTorusTarget(null); setTorusPos(null); }}
          onSplit={() => { if (torusTarget.kind === 'inside') onSplitClip(torusTarget.clipId, torusTarget.frame); setTorusTarget(null); setTorusPos(null); }}
          onTrimLatter={(ripple) => { if (torusTarget.kind === 'inside') onTrimLatter(torusTarget.clipId, torusTarget.frame, ripple); setTorusTarget(null); setTorusPos(null); }}
          onTrimFormer={(ripple) => { if (torusTarget.kind === 'inside') onTrimFormer(torusTarget.clipId, torusTarget.frame, ripple); setTorusTarget(null); setTorusPos(null); }}
          onStep={(dir, ripple) => { onStepEdge(torusTarget.kind === 'edge' ? torusTarget.clipId : null, torusTarget.kind === 'cut' ? [torusTarget.clipAId, torusTarget.clipBId] : null, dir, ripple); setTorusTarget(null); setTorusPos(null); }}
          onRoll={() => { if (torusTarget.kind === 'inside') onRoll(torusTarget.clipId); setTorusTarget(null); setTorusPos(null); }}
          disableScrolling={getTorusScrollingDisabled()}
          hoverScale={getSavedHoverScale()}
        />
      )}
    </div>
  );
}