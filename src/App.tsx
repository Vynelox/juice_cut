//app.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import MediaPool from './components/MediaPool';

// Web APIs not yet in TypeScript standard library
declare class MediaStreamTrackProcessor {
  readonly track: MediaStreamTrack;
  readonly readable: ReadableStream<VideoFrame>;
  constructor(options: { track: MediaStreamTrack });
}

import Viewer from './components/Viewer';
import Timeline from './components/Timeline';
import RollDialog from './components/RollDialog';
import ViewerControls from './components/ViewerControls';
import { OpenSettings } from './components/Settings';
import { isShortcutMatch } from './components/shortcuts';
import { parentMap, StylesModal, applyThemeToDocument } from './components/styles';
import Splitter from './components/Splitter';
import DraggableModal from './components/DraggableModal';
import { ChevronDown, ChevronUp } from 'lucide-react';

import {
  type MediaItem, type TimelineClip, type Track,
  FPS, generateId, secondsToFrames
} from './types';
import { HistoryProvider, useHistory } from './state/history';
import { modalManager, registerModalPermissions } from './state';
import Toast from './components/Toast';
// Toast is a class, not a React component - no need to render it

const DEFAULT_IMAGE_DURATION = 5 * FPS;
const WINDOW_BUTTONS_SPACING = 10; //px
const WINDOW_BUTTONS_SIZE = 15; //px
const TOP_BAR_MENU_BUTTONS_SPACING = 0; //px
const header_font_size = 15;


// Initialize modal manager permissions
registerModalPermissions();

const TRACKS: Track[] = [
  { id: 'v1', type: 'video', label: 'V1' },
  { id: 'a1', type: 'audio', label: 'A1' },
];

function loadMediaDuration(file: File, type: MediaItem['type']): Promise<number> {
  return new Promise(resolve => {
    if (type === 'image') { resolve(DEFAULT_IMAGE_DURATION); return; }
    const el = type === 'video'
      ? document.createElement('video')
      : document.createElement('audio');
    el.preload = 'metadata';
    el.src = URL.createObjectURL(file);
    el.onloadedmetadata = () => resolve(secondsToFrames(el.duration));
    el.onerror = () => resolve(5 * FPS);
  });
}

function generateThumbnail(file: File, type: MediaItem['type']): Promise<string | undefined> {
  return new Promise(resolve => {
    if (type === 'audio') { resolve(undefined); return; }
    if (type === 'image') {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target?.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(file);
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = URL.createObjectURL(file);
    video.onloadeddata = () => { video.currentTime = 0.5; };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 120; canvas.height = 68;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(video, 0, 0, 120, 68);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    video.onerror = () => resolve(undefined);
  });
}



function AppContent() {
  const history = useHistory();
  const multipleMenusToast = new Toast('opening multiple <br/> menus is disabled!');
  const [mediaItems, setMediaItems] = useState<Map<string, MediaItem>>(new Map());
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rollClipId, setRollClipId] = useState<string | null>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hasModalOpen, setHasModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [shaderFps, setShaderFps] = useState<number | null>(null);
  const [shaderEnabled, setShaderEnabled] = useState(false);
  
  // Check if shader window is enabled from config
  useEffect(() => {
    fetch('/config.json')
      .then(r => r.json())
      .then(cfg => setShaderEnabled(!!cfg?.shader_window))
      .catch(() => setShaderEnabled(false));
  }, []);

  // Listen for FPS updates from the shader window (forwarded via main process)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.on) return;
    api.on('shader-fps', (fps: number) => {
      setShaderFps(fps);
    });
  }, []);

  // When shader window is disabled, measure the app window's own FPS
  useEffect(() => {
    if (shaderEnabled) return; // Only measure app FPS when shader is disabled
    let rafId = 0;
    let frameCount = 0;
    let fpsStartTime = performance.now();
    
    const measureFps = () => {
      frameCount++;
      const now = performance.now();
      const elapsed = now - fpsStartTime;
      if (elapsed >= 1000) {
        setShaderFps(Math.round((frameCount * 1000) / elapsed));
        frameCount = 0;
        fpsStartTime = now;
      }
      rafId = requestAnimationFrame(measureFps);
    };
    rafId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(rafId);
  }, [shaderEnabled]);

  // settings (persisted)
  const [playheadTop, setPlayheadTop] = useState<number>(() => {
    try {
      const v = window.localStorage.getItem('juicecut.settings.playheadTopPercent');
      if (v) {
        const n = Number(v);
        if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
      }
      const legacy = window.localStorage.getItem('juicecut.settings.playheadTop');
      if (legacy) {
        const n = Number(legacy);
        if (!Number.isNaN(n) && n >= 0 && n <= 100) return n;
      }
    } catch { /* ignore */ }
    return 15;
  });
  const [includeResizeInUndo, setIncludeResizeInUndo] = useState<boolean>(() => {
    try { const v = window.localStorage.getItem('juicecut.settings.includeResizeInUndo'); return v === null ? true : v === 'true'; } catch { return true; }
  });

  // layout (persisted) - stored as percentages of viewport
  const [leftWidthPct, setLeftWidthPct] = useState<number>(() => {
    try { const v = window.localStorage.getItem('juicecut.layout.leftWidthPct'); return v ? Number(v) : 20; } catch { return 20; }
  });
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    try { const v = window.localStorage.getItem('juicecut.layout.leftCollapsed'); return v === 'true'; } catch { return false; }
  });
  useEffect(() => { try { window.localStorage.setItem('juicecut.layout.leftCollapsed', leftCollapsed ? 'true' : 'false'); } catch {} }, [leftCollapsed]);
  const [savedTimelineHeightPct, setSavedTimelineHeightPct] = useState<number | null>(null);
  const [timelineHeightPct, setTimelineHeightPct] = useState<number>(() => {
    try { const v = window.localStorage.getItem('juicecut.layout.timelineHeightPct'); return v ? Number(v) : 35; } catch { return 35; }
  });
  
  // Get GUI scale
  const getGuiScale = () => {
    try { const v = window.localStorage.getItem('juicecut.settings.guiScale'); return v ? Number(v) / 100 : 1; } catch { return 1; }
  };
  
  // Calculate pixel positions from stored percentages
  // These are pure percentages of the viewport — no GUI scale division.
  // The splitter position as a % of the total viewport stays constant regardless of GUI scale.
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const leftWidth = Math.round(viewportWidth * leftWidthPct / 100);
  const timelineHeight = Math.round(viewportHeight * timelineHeightPct / 100);
  // guiScale is still read to trigger re-renders when scale changes
  const guiScale = getGuiScale();
  void guiScale; // used to force re-render dependency
  const [showStyle, setShowStyle] = useState(false);
  const [stylePage, setStylePage] = useState<string | null>(null);
  const [allowEditsWhenMenuOpen, setAllowEditsWhenMenuOpen] = useState(() => 
    (window as any).juicecut?.settings?.allowEditsWhenMenuOpen ?? true
  );

  // Watch for modal overlays in DOM to toggle hasModalOpen
  useEffect(() => {
    const checkModals = () => {
      const open = !!document.querySelector('.modal-overlay, .torus-overlay');
      setHasModalOpen(open);
    };
    checkModals();
    const observer = new MutationObserver(() => checkModals());
    observer.observe(document.body, { childList: true, subtree: false });
    return () => observer.disconnect();
  }, []);

  // Listen for settings changes to update allowEditsWhenMenuOpen reactively
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === 'allowEditsWhenMenuOpen') {
        setAllowEditsWhenMenuOpen(detail.value ?? true);
      }
    };
    window.addEventListener('juicecut.settings-changed', handler);
    return () => window.removeEventListener('juicecut.settings-changed', handler);
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, []);

  // Apply saved theme on mount
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('juicecut.styles.activeTheme');
      if (!saved) window.localStorage.setItem('juicecut.styles.activeTheme', 'og-dark');
      applyThemeToDocument(saved || 'og-dark');
    } catch {}
  }, []);
  
  // Apply GUI scale on mount
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('juicecut.settings.guiScale');
      const scale = v ? Number(v) / 100 : 1;
      document.documentElement.style.setProperty('--gui-scale', scale.toString());
    } catch {}
  }, []);

  // Send theme colors to shader window for dynamic effects and UI masking
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.send) return;

    const sendThemeColorsToShader = () => {
      const styles = getComputedStyle(document.documentElement);
      // Must match the exact order of colorFields in GlobalStyleSettings.tsx
      const varNames = [
        '--bg-panel', '--bg-base', '--bg-viewer', '--video-bg', '--bg-elevated',
        '--bg-hover', '--border', '--border-mid', '--splitter', '--text-primary',
        '--text-secondary', '--text-muted', '--input-field', '--input-field-bg',
        '--playneedle', '--highlight-color', '--automation-line'
      ];

      const hexToRgb = (hex: string): [number, number, number] => {
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substring(0, 2), 16) / 255;
        const g = parseInt(clean.substring(2, 4), 16) / 255;
        const b = parseInt(clean.substring(4, 6), 16) / 255;
        return [r, g, b];
      };

      const colorArray: number[] = [];
      varNames.forEach(varName => {
        const hex = styles.getPropertyValue(varName).trim();
        const [r, g, b] = hex.startsWith('#') ? hexToRgb(hex) : [0, 0, 0];
        colorArray.push(r, g, b);
      });

      api.send('update-shader-colors', colorArray);
    };

    // Send on mount
    sendThemeColorsToShader();

    // Listen for theme/color changes
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Trigger update on any style change
      setTimeout(sendThemeColorsToShader, 50);
    };
    window.addEventListener('juicecut.settings-changed', handler);
    window.addEventListener('juicecut.theme-changed', handler);

    return () => {
      window.removeEventListener('juicecut.settings-changed', handler);
      window.removeEventListener('juicecut.theme-changed', handler);
    };
  }, []);

  // Apply saved elevatedPanelDarkenAmount on mount
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('juicecut.settings.elevatedPanelDarkenAmount');
      if (v) {
        const pct = Number(v);
        if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
          let overlayColor: string;
          if (pct <= 50) {
            const factor = pct / 50;
            const a = 1 - factor;
            overlayColor = `rgba(255,255,255,${a.toFixed(3)})`;
          } else {
            const factor = (pct - 50) / 50;
            overlayColor = `rgba(0,0,0,${factor.toFixed(3)})`;
          }
          document.documentElement.style.setProperty('--modal-overlay-bg', overlayColor);
        }
      }
    } catch {}
  }, []);

  // Apply saved elevatedPanelBlurAmount on mount
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('juicecut.settings.elevatedPanelBlurAmount');
      if (v) {
        const pct = Number(v);
        if (!Number.isNaN(pct) && pct >= 0 && pct <= 100) {
          const blurPx = (pct / 100) * 50;
          document.documentElement.style.setProperty('--modal-overlay-blur', `${blurPx}px`);
        }
      }
    } catch {}
  }, []);



  // Determine if background should be locked
  const blockBackground = !allowEditsWhenMenuOpen && hasModalOpen;

  const [showExport, setShowExport] = useState(false);
  const [exportVideo, setExportVideo] = useState(true);
  const [exportAudio, setExportAudio] = useState(true);
  const [exportPath, setExportPath] = useState('');
  useEffect(() => { try { window.localStorage.setItem('juicecut.layout.leftWidthPct', String(leftWidthPct)); } catch {} }, [leftWidthPct]);
  useEffect(() => { try { window.localStorage.setItem('juicecut.layout.timelineHeightPct', String(timelineHeightPct)); } catch {} }, [timelineHeightPct]);

  const totalFrames = clips.reduce((max, c) => Math.max(max, c.endFrame), 0);

  const snapshot = useCallback(() => ({
    clips: JSON.parse(JSON.stringify(clips)),
    mediaItems: Array.from(mediaItems.entries()),
    selectedIds: [...selectedIds],
    playhead,
    settings: { playheadTop, includeResizeInUndo },
    layout: { leftWidthPct, timelineHeightPct }
  }), [clips, mediaItems, selectedIds, playhead, playheadTop, includeResizeInUndo, leftWidthPct, timelineHeightPct]);

  const restore = useCallback((snap: any) => {
    try {
      setClips(Array.isArray(snap?.clips) ? snap.clips : []);
      setMediaItems(new Map(Array.isArray(snap?.mediaItems) ? snap.mediaItems : []));
      setSelectedIds(Array.isArray(snap?.selectedIds) ? snap.selectedIds : []);
      setPlayhead(typeof snap?.playhead === 'number' ? snap.playhead : 0);
      if (snap?.settings) {
        if (typeof snap.settings.playheadTop === 'number') {
          const v = snap.settings.playheadTop;
          setPlayheadTop(v >= 0 && v <= 100 ? v : 15);
        }
        setIncludeResizeInUndo(typeof snap.settings.includeResizeInUndo === 'boolean' ? snap.settings.includeResizeInUndo : includeResizeInUndo);
      }
      if (snap?.layout) {
        setLeftWidthPct(typeof snap.layout.leftWidthPct === 'number' ? snap.layout.leftWidthPct : leftWidthPct);
        setTimelineHeightPct(typeof snap.layout.timelineHeightPct === 'number' ? snap.layout.timelineHeightPct : timelineHeightPct);
      }
    } catch (err) {
      console.warn('Failed to restore snapshot', err);
    }
  }, [setClips, setMediaItems, setSelectedIds, setPlayhead, playheadTop, includeResizeInUndo, leftWidthPct, timelineHeightPct]);

  // layout (persisted)
  useEffect(() => {
    try { window.localStorage.setItem('juicecut.settings.playheadTopPercent', String(playheadTop)); } catch {}
  }, [playheadTop]);

  // GUI scale state - needed to trigger re-render when scale changes
  const [guiScaleState, setGuiScaleState] = useState<number>(() => {
    try { const v = window.localStorage.getItem('juicecut.settings.guiScale'); return v ? Number(v) / 100 : 1; } catch { return 1; }
  });

  // Listen for settings changes from the Settings modal
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === 'playheadTopPercent' && typeof detail.value === 'number') {
        setPlayheadTop(detail.value);
      }
      if (detail?.key === 'guiScale' && typeof detail.value === 'number') {
        setGuiScaleState(detail.value / 100);
      }
      if (detail?.key === 'elevatedPanelDarkenAmount' && typeof detail.value === 'number') {
        const pct = detail.value;
        let overlayColor: string;
        if (pct <= 50) {
          const factor = pct / 50;
          const a = 1 - factor;
          overlayColor = `rgba(255,255,255,${a.toFixed(3)})`;
        } else {
          const factor = (pct - 50) / 50;
          overlayColor = `rgba(0,0,0,${factor.toFixed(3)})`;
        }
        document.documentElement.style.setProperty('--modal-overlay-bg', overlayColor);
      }
      if (detail?.key === 'elevatedPanelBlurAmount' && typeof detail.value === 'number') {
        const pct = detail.value;
        const blurPx = (pct / 100) * 50;
        document.documentElement.style.setProperty('--modal-overlay-blur', `${blurPx}px`);
      }
      // Force re-render when allowEditsWhenMenuOpen changes
      if (detail?.key === 'allowEditsWhenMenuOpen') {
        setHasModalOpen(prev => prev); // trigger re-render
      }
    };
    window.addEventListener('juicecut.settings-changed', handler);
    return () => window.removeEventListener('juicecut.settings-changed', handler);
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem('juicecut.settings.includeResizeInUndo', includeResizeInUndo ? 'true' : 'false'); } catch {}
  }, [includeResizeInUndo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if graph editor already handled undo/redo via capture phase
      if ((window as any).__graphUndoRedoHandled) {
        (window as any).__graphUndoRedoHandled = false;
        return;
      }
      
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); return; }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); history.undo(snapshot(), restore); }
      if (e.ctrlKey && ((e.shiftKey && e.key.toLowerCase() === 'z') || (e.altKey && e.key.toLowerCase() === 'z') || (e.key.toLowerCase() === 'y' && !e.altKey && !e.shiftKey))) { e.preventDefault(); history.redo(snapshot(), restore); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history, snapshot, restore]);

  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setPlayhead(p => { if (p >= totalFrames) { setPlaying(false); return p; } return p + 1; });
      }, 1000 / FPS);
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    }
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [playing, totalFrames]);

  // Window controls (Electron only)
  const sendWindowCommand = useCallback((command: string) => {
    const api = (window as any).electronAPI;
    if (api?.send) {
      api.send(command);
    }
  }, []);

  // Track mouse position for custom cursor overlay (sent to main process → forwarded to shader_window)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.send) return;
    const handler = (e: MouseEvent) => {
      api.send('cursor-move', { x: e.clientX, y: e.clientY });
    };
    document.addEventListener('mousemove', handler);
    return () => document.removeEventListener('mousemove', handler);
  }, []);

  // Styles back/close: goes back one level if inside a sub-page, otherwise closes
  const handleStyleBackOrClose = useCallback(() => {
    if (stylePage) {
      const parentId = parentMap[stylePage] || null;
      setStylePage(parentId);
    } else {
      setShowStyle(false);
    }
  }, [stylePage]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'd') { e.preventDefault(); setSelectedIds([]); }
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      if (isShortcutMatch('exitModal', e)) {
        // Don't intercept when typing in inputs
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        // Check close stack first (Settings, TorusMenuEditor)
        const topClose = (window as any).__peekClose?.();
        if (topClose) {
          e.preventDefault();
          e.stopPropagation();
          topClose();
          return;
        }
        // React-state modals
        if (showExport) { e.preventDefault(); setShowExport(false); return; }
        if (showStyle) { e.preventDefault(); handleStyleBackOrClose(); return; }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showExport, showStyle, handleStyleBackOrClose]);

  const handleAddMedia = useCallback(async (files: FileList) => {
    history.push(snapshot());
    const newItems = new Map(mediaItems);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isVideo = ['mp4', 'mkv', 'mov', 'webm'].includes(ext);
      const isAudio = ['mp3', 'ogg', 'wav', 'aac'].includes(ext);
      const isImage = ['png', 'jpg', 'jpeg', 'avif', 'gif', 'webp'].includes(ext);
      if (!isVideo && !isAudio && !isImage) continue;
      const type: MediaItem['type'] = isVideo ? 'video' : isAudio ? 'audio' : 'image';
      const src = URL.createObjectURL(file);
      const duration = await loadMediaDuration(file, type);
      const thumbnail = await generateThumbnail(file, type);
      const item: MediaItem = { id: generateId(), name: file.name, type, file, src, duration, thumbnail };
      newItems.set(item.id, item);
    }
    setMediaItems(newItems);
  }, [mediaItems]);

  const handleDropMediaPool = useCallback((e: React.DragEvent) => { e.preventDefault(); if (e.dataTransfer.files.length) handleAddMedia(e.dataTransfer.files); }, [handleAddMedia]);
  const handleDragOverMediaPool = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);

  const handleRemoveMedia = useCallback((id: string) => {
    history.push(snapshot());
    const newItems = new Map(mediaItems);
    const item = newItems.get(id);
    if (item) URL.revokeObjectURL(item.src);
    newItems.delete(id);
    setMediaItems(newItems);
    setClips(prev => prev.filter(c => c.mediaId !== id));
  }, [mediaItems, history, snapshot]);

  const handleDropMedia = useCallback((mediaId: string, track: number, startFrame: number) => {
    history.push(snapshot());
    const media = mediaItems.get(mediaId);
    if (!media) return;
    const trackObj = TRACKS[track];
    if (!trackObj) return;
    if (trackObj.type === 'video' && media.type === 'audio') return;
    if (trackObj.type === 'audio' && (media.type === 'video' || media.type === 'image')) return;
    const endFrame = startFrame + media.duration;
    const newClip: TimelineClip = { id: generateId(), mediaId, track, startFrame, endFrame, srcIn: 0, srcOut: media.duration, fades: { in: 0, out: 0 }, name: media.name, type: media.type };
    setClips(prev => [...prev, newClip]);
  }, [mediaItems]);

  const handleSelectClip = useCallback((id: string, multi: boolean) => {
    setSelectedIds(prev => { if (multi) return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; return prev.includes(id) && prev.length === 1 ? prev : [id]; });
  }, []);

  const handleNudge = useCallback((ids: string[], delta: number) => {
    history.push(snapshot());
    setClips(prev => {
      const movers = new Set(ids);
      return prev.map(clip => {
        if (!movers.has(clip.id)) return clip;
        const newStart = Math.max(0, clip.startFrame + delta);
        const len = clip.endFrame - clip.startFrame;
        const wouldOverlap = prev.some(other => !movers.has(other.id) && other.track === clip.track && newStart < other.endFrame && newStart + len > other.startFrame);
        if (wouldOverlap) return clip;
        return { ...clip, startFrame: newStart, endFrame: newStart + len };
      });
    });
  }, [history, snapshot]);

  const handleSplitClip = useCallback((clipId: string, frame: number) => {
    history.push(snapshot());
    setClips(prev => {
      const clip = prev.find(c => c.id === clipId);
      if (!clip || frame <= clip.startFrame || frame >= clip.endFrame) return prev;
      const relFrame = frame - clip.startFrame;
      const part1: TimelineClip = { ...clip, endFrame: frame, srcOut: clip.srcIn + relFrame, fades: { ...clip.fades, out: 0 } };
      const part2: TimelineClip = { ...clip, id: generateId(), startFrame: frame, srcIn: clip.srcIn + relFrame, fades: { ...clip.fades, in: 0 } };
      return prev.map(c => c.id === clipId ? part1 : c).concat(part2);
    });
  }, [history, snapshot]);

  const handleTrimLatter = useCallback((clipId: string, frame: number, ripple: boolean) => {
    history.push(snapshot());
    setClips(prev => {
      const clip = prev.find(c => c.id === clipId);
      if (!clip || frame <= clip.startFrame) return prev;
      const newEnd = frame;
      const gap = clip.endFrame - newEnd;
      return prev.map(c => {
        if (c.id === clipId) return { ...c, endFrame: newEnd, srcOut: c.srcIn + (newEnd - c.startFrame) };
        if (ripple && c.track === clip.track && c.startFrame >= clip.endFrame) return { ...c, startFrame: c.startFrame - gap, endFrame: c.endFrame - gap };
        return c;
      });
    });
  }, [history, snapshot]);

  const handleTrimFormer = useCallback((clipId: string, frame: number, ripple: boolean) => {
    history.push(snapshot());
    setClips(prev => {
      const clip = prev.find(c => c.id === clipId);
      if (!clip || frame >= clip.endFrame) return prev;
      const gap = frame - clip.startFrame;
      return prev.map(c => {
        if (c.id === clipId) return { ...c, startFrame: frame, srcIn: c.srcIn + gap };
        if (ripple && c.track === clip.track && c.startFrame < clip.startFrame) return { ...c, startFrame: Math.max(0, c.startFrame - gap), endFrame: Math.max(0, c.endFrame - gap) };
        return c;
      });
    });
  }, [history, snapshot]);

  const handleJoin = useCallback((clipAId: string, clipBId: string) => {
    history.push(snapshot());
    setClips(prev => {
      const a = prev.find(c => c.id === clipAId);
      const b = prev.find(c => c.id === clipBId);
      if (!a || !b || a.mediaId !== b.mediaId) return prev;
      const merged: TimelineClip = { ...a, endFrame: b.endFrame, srcOut: b.srcOut, fades: { in: a.fades.in, out: b.fades.out } };
      return prev.filter(c => c.id !== clipAId && c.id !== clipBId).concat(merged);
    });
  }, [history, snapshot]);

  const handleFadeChange = useCallback((clipId: string, side: 'in' | 'out', frames: number) => {
    history.push(snapshot());
    setClips(prev => prev.map(c => { if (c.id !== clipId) return c; const maxFade = Math.floor((c.endFrame - c.startFrame) / 2); return { ...c, fades: { ...c.fades, [side]: Math.min(Math.max(0, frames), maxFade) } }; }));
  }, [history, snapshot]);

  const handleStepEdge = useCallback((clipId: string | null, cutBetween: [string, string] | null, direction: number, ripple: boolean) => {
    history.push(snapshot());
    setClips(prev => {
      if (cutBetween) {
        const [aId, bId] = cutBetween;
        return prev.map(c => {
          if (c.id === aId) return { ...c, endFrame: c.endFrame + direction, srcOut: c.srcOut + direction };
          if (!ripple && c.id === bId) return { ...c, startFrame: c.startFrame + direction, srcIn: c.srcIn + direction };
          if (ripple && c.id !== aId) { const bClip = prev.find(x => x.id === bId); if (bClip && c.track === bClip.track && c.startFrame >= bClip.startFrame) return { ...c, startFrame: c.startFrame + direction, endFrame: c.endFrame + direction }; }
          return c;
        });
      }
      if (clipId) return prev.map(c => { if (c.id !== clipId) return c; return { ...c, endFrame: c.endFrame + direction, srcOut: c.srcOut + direction }; });
      return prev;
    });
  }, [history, snapshot]);

  const handleRollApply = useCallback((clipId: string, newSrcIn: number, newSrcOut: number) => {
    history.push(snapshot());
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, srcIn: newSrcIn, srcOut: newSrcOut } : c));
  }, [history, snapshot]);

  const handleExport = useCallback(async () => {
    const videoClips = clips.filter(c => c.type === 'video' && c.track === 0).sort((a, b) => a.startFrame - b.startFrame);
    if (videoClips.length === 0) { alert('No video clips on track V1 to export.'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = 854; canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(FPS);
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }); } catch { recorder = new MediaRecorder(stream); }
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => { const blob = new Blob(chunks, { type: 'video/webm' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'export.webm'; a.click(); URL.revokeObjectURL(url); };
    recorder.start();
    let frame = 0;
    const renderFrame = () => {
      if (frame > totalFrames) { recorder.stop(); return; }
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 854, 480);
      const videoClip = videoClips.find(c => frame >= c.startFrame && frame < c.endFrame);
      if (videoClip) {
        const media = mediaItems.get(videoClip.mediaId);
        if (media) {
          const videoEl = document.getElementById(`vid-${media.id}`) as HTMLVideoElement | null;
          if (videoEl && videoEl.readyState >= 2) {
            videoEl.currentTime = (frame - videoClip.startFrame + videoClip.srcIn) / FPS;
            let alpha = 1;
            const len = videoClip.endFrame - videoClip.startFrame;
            const rel = frame - videoClip.startFrame;
            if (rel < videoClip.fades.in) alpha = rel / videoClip.fades.in;
            if (rel > len - videoClip.fades.out) alpha = (len - rel) / videoClip.fades.out;
            ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
            const ar = videoEl.videoWidth / videoEl.videoHeight || 16 / 9;
            const cAr = 854 / 480;
            let w = 854, h = 480, x = 0, y = 0;
            if (ar > cAr) { h = 854 / ar; y = (480 - h) / 2; } else { w = 480 * ar; x = (854 - w) / 2; }
            ctx.drawImage(videoEl, x, y, w, h); ctx.globalAlpha = 1;
          }
        }
      }
      frame++;
      setTimeout(renderFrame, 1000 / FPS);
    };
    renderFrame();
  }, [clips, mediaItems, totalFrames]);

  const rollClip = rollClipId ? clips.find(c => c.id === rollClipId) ?? null : null;
  const rollMedia = rollClip ? mediaItems.get(rollClip.mediaId) ?? null : null;

  // Toggle cursor visibility based on config.custom_cursor
  useEffect(() => {
    let injectedStyleTag: HTMLStyleElement | null = null;
    fetch('/config.json')
      .then(r => r.json())
      .then(cfg => {
        if (cfg?.custom_cursor) {
          // ENABLE CUSTOM CURSOR MODE
          document.body.classList.add('cursor-hidden');
          // Inject the nuclear option just in case
          injectedStyleTag = document.createElement('style');
          injectedStyleTag.innerHTML = '* { cursor: none !important; }';
          document.head.appendChild(injectedStyleTag);
        } else {
          // DISABLE CUSTOM CURSOR MODE (Revert to normal)
          document.body.classList.remove('cursor-hidden');
          document.documentElement.style.cursor = '';
          document.body.style.cursor = '';
          // Remove injected style if it exists
          if (injectedStyleTag && injectedStyleTag.parentNode) {
            injectedStyleTag.parentNode.removeChild(injectedStyleTag);
          }
        }
      })
      .catch(() => {});
    // Cleanup on unmount
    return () => {
      if (injectedStyleTag && injectedStyleTag.parentNode) {
        injectedStyleTag.parentNode.removeChild(injectedStyleTag);
      }
    };
  }, []);

  //add cursor: 'none' in the style=({}) section in the
  //<div id="editor-container"> 
  return (
    <div id="editor-container" style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column'}}>
    <div className="app-shell">
      {/* Background blocking overlay: sits below modal/torus overlays (z-index 199 vs 200) */}
      {blockBackground && (
        <div
          className="app-bg-lock"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 199,
            background: 'transparent',
            pointerEvents: 'auto',
          }}
        />
      )}
      {Array.from(mediaItems.values()).map(item =>
        item.type === 'video' ? (
          <video key={item.id} id={`vid-${item.id}`} src={item.src} style={{ display: 'none' }} preload="auto" muted />
        ) : item.type === 'audio' ? (
          <audio key={item.id} id={`aud-${item.id}`} src={item.src} style={{ display: 'none' }} preload="auto" />
        ) : null
      )}
      <header className="app-header"
        onMouseDown={(e) => {
          setIsDragging(true);
          const api = (window as any).electronAPI;
          if (api) api.send('start-drag', { x: e.screenX, y: e.screenY });
        }}
        onMouseMove={(e) => {
          if (isDragging) {
            const api = (window as any).electronAPI;
            if (api) api.send('dragging', { x: e.screenX, y: e.screenY });
          }
        }}
        onMouseUp={() => {
          setIsDragging(false);
          const api = (window as any).electronAPI;
          if (api) api.send('stop-drag');
        }}
        onMouseLeave={() => {
          setIsDragging(false);
          const api = (window as any).electronAPI;
          if (api) api.send('stop-drag');
        }}
      >
        <div className="app-logo">
          <img src="/src/67_editing_software.ico" alt="67 editing software" style={{ width: 22, height: 22, transform: 'translateY(0px)', }} />
        

          {/*67 editing software title*/}
          <span style={{
            fontSize: header_font_size,
            color: 'var(--text-secondary)',
            fontWeight: 500,
            verticalAlign: 'bottom',
            transform: 'translateY(1px)',
            position: 'relative',
            minWidth: '200px',      // 🔥 Reserve space for "fps: 999"
            }}>67 editing software | fps: {shaderFps ?? '--'}</span>
          {/* fps counter title */}
        </div>

        
        <div style={{ display: 'flex', gap: TOP_BAR_MENU_BUTTONS_SPACING, alignItems: 'center', marginLeft: WINDOW_BUTTONS_SPACING }}>
          <button className="icon-btn" onClick={() => {
            const result = modalManager.requestOpen('styles');
            if (!result.allowed) {
              multipleMenusToast.show();
              return;
            }
            setShowStyle(true);
          }} title="Style">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C12 2 5 10 5 15c0 3.866 3.134 7 7 7s7-3.134 7-7c0-5-7-13-7-13z"/>
            </svg>
          </button>
          <button className="icon-btn" onClick={() => {
            OpenSettings({ tab: 'misc' }, null);
          }} title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: WINDOW_BUTTONS_SPACING, alignItems: 'center' }}>
          <button className="status-dot" data-color="yellow" title="Minimize" onClick={() => sendWindowCommand('window-minimize')} style={{ width: WINDOW_BUTTONS_SIZE, height: WINDOW_BUTTONS_SIZE }} />
          <button className="status-dot" data-color="green" title="Maximize" onClick={() => sendWindowCommand('window-maximize')} style={{ width: WINDOW_BUTTONS_SIZE, height: WINDOW_BUTTONS_SIZE }} />
          <button className="status-dot" data-color="red" title="Close" onClick={() => sendWindowCommand('window-close')} style={{ width: WINDOW_BUTTONS_SIZE, height: WINDOW_BUTTONS_SIZE }} />
        </div>
      </header>
      <div
        className="workspace"
        style={{
          '--timeline-height': `${timelineHeight}px`,
          '--left-width': `${leftCollapsed ? 36 : leftWidth}px`,
          '--vsplit-width': leftCollapsed ? '0px' : '8px',
        } as React.CSSProperties}
      >
        <div className="workspace-panel-mediapool" onDrop={handleDropMediaPool} onDragOver={handleDragOverMediaPool}>
          <div className="viewer-header">
            <span className="panel-title">Media Pool</span>
          </div>
          {!leftCollapsed && (
            <MediaPool items={Array.from(mediaItems.values())} selectedMediaId={selectedMediaId} onSelect={setSelectedMediaId} onAdd={handleAddMedia} onRemove={handleRemoveMedia} />
          )}
        </div>

        {!leftCollapsed && (
          <div className="workspace-vsplit">
             <Splitter orientation="vertical" onChange={(dx) => {
               const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
               const dxPct = dx / viewportWidth * 100;
               setLeftWidthPct(w => Math.max(5, Math.min(50, w + dxPct)));
             }} onDragEnd={() => { history.push({ ...snapshot(), __meta: { type: 'resize' } }); }} />
          </div>
        )}

        <div className="workspace-panel-viewer">
          <Viewer clips={clips} mediaItems={mediaItems} playhead={playhead} playing={playing} totalFrames={totalFrames} onExport={() => {
            const result = modalManager.requestOpen('export');
            if (!result.allowed) {
              multipleMenusToast.show();
              return;
            }
            setShowExport(true);
          }} />
          <ViewerControls
            style={{ marginTop: 'auto' }}
            clips={clips}
            mediaItems={mediaItems}
            playhead={playhead}
            playing={playing}
            totalFrames={totalFrames}
            onPlayPause={() => setPlaying(p => !p)}
            onSeek={setPlayhead}
          />
        </div>

        <div className="workspace-hsplit">
          <Splitter orientation="horizontal" thickness={8} onChange={(dy) => {
            const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
            const dyPct = dy / viewportHeight * 100;
            setTimelineHeightPct(h => Math.max(15, Math.min(60, h - dyPct)));
          }} onDragEnd={() => { history.push({ ...snapshot(), __meta: { type: 'resize' } }); }} />
        </div>

        <Timeline clips={clips} tracks={TRACKS} mediaItems={mediaItems} playhead={playhead} selectedIds={selectedIds} onSeek={setPlayhead} onDropMedia={handleDropMedia} onSelectClip={handleSelectClip} onSplitClip={handleSplitClip} onTrimLatter={handleTrimLatter} onTrimFormer={handleTrimFormer} onNudge={handleNudge} onJoin={handleJoin} onFadeChange={handleFadeChange} onRoll={setRollClipId} onStepEdge={handleStepEdge} totalFrames={totalFrames} />
      </div>
      {showExport && (
        <DraggableModal
          title="Export"
          onClose={() => {
            modalManager.close('export');
            setShowExport(false);
          }}
          style={{ width: 400 }}
          body={
            <div className="settings-panel-content">
              <label className="settings-checkbox-field" style={{ cursor: 'pointer' }}>
                <span>Export video</span>
                <input type="checkbox" className="settings-checkbox" checked={exportVideo} onChange={e => setExportVideo(e.target.checked)} />
              </label>
              <label className="settings-checkbox-field" style={{ cursor: 'pointer' }}>
                <span>Export audio</span>
                <input type="checkbox" className="settings-checkbox" checked={exportAudio} onChange={e => setExportAudio(e.target.checked)} />
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="text" className="settings-number-input" style={{ flex: 1, marginLeft: 0 }} placeholder="Export path..." value={exportPath} onChange={e => setExportPath(e.target.value)} />
                <button className="btn-secondary" style={{ whiteSpace: 'nowrap', padding: '4px 12px' }}>Browse</button>
              </div>
              <button className="btn-primary" style={{ alignSelf: 'center', padding: '8px 32px', background: 'var(--input-field)' }}>Export</button>
            </div>
          }
        />
      )}
      <StylesModal showStyle={showStyle} setShowStyle={(v) => {
        setShowStyle(v);
        if (!v) modalManager.close('styles');
      }} stylePage={stylePage} setStylePage={setStylePage} />
      {rollClip && rollMedia && (
        <RollDialog clip={rollClip} media={rollMedia} onClose={() => setRollClipId(null)} onApply={handleRollApply} />
      )}
      </div>
      

    </div>
  );
}

export default function App() {
  return (
    <HistoryProvider>
      <AppContent />
    </HistoryProvider>
  );
}