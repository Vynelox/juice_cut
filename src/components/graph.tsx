import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import { useLocalHistory } from '../state/history';
import { formatShortcutLabel, getShortcutKeys, isShortcutMatch } from './shortcuts';
import { formatSensitivity, adjustSensitivity, DEFAULT_SENSITIVITY, MIN_SENSITIVITY, MAX_SENSITIVITY, DISPLAY_DURATION_MS } from '../utils/sensitivity';

export interface SizeGraphPoint {
  time: number;
  size: number;
}

export interface GraphSnapshot {
  graph: SizeGraphPoint[];
  easingOffsets: number[];
}

export interface GraphConfig {
  width: number;
  height: number;
  padding: number;
  minTimeDelta: number;
}

export const EASE_HANDLE_DIAMETER_PX = 6;
export const EASE_HANDLE_RING_THICKNESS_PX = 2;
export const GRAPH_LINE_COLOR = 'var(--automation-line)';
export const EASE_HANDLE_COLOR = 'var(--automation-line)';
export const ANCHOR_OUTER_COLOR = 'var(--automation-line)';
export const ANCHOR_INNER_COLOR = 'var(--input-field-bg)';
export const ANCHOR_DIAMETER_PX = 12;
export const ANCHOR_BORDER_THICKNESS_PX = 2;

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  width: 260,
  height: 180,
  padding: 40,
  minTimeDelta: 0.01,
};

export const DEFAULT_TORUS_SIZE_GRAPH: SizeGraphPoint[] = [
  { time: 0, size: 0 },
  { time: 0.75, size: 1 },
  { time: 1, size: 1 },
];

export function getSavedSizeGraph(): SizeGraphPoint[] {
  try {
    const raw = window.localStorage.getItem('juicecut.settings.torusSizeGraph');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const points = parsed
          .map((item: any) => ({ time: Number(item?.time), size: Number(item?.size) }))
          .filter(p => !Number.isNaN(p.time) && !Number.isNaN(p.size));
        if (points.length >= 2) {
          const sorted = points.sort((a, b) => a.time - b.time);
          return [
            { time: 0, size: 0 },
            ...sorted.filter(p => p.time > 0 && p.time < 1),
            { time: 1, size: 1 },
          ];
        }
      }
    }
  } catch {}
  return DEFAULT_TORUS_SIZE_GRAPH;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cloneGraphSnapshot(graph: SizeGraphPoint[], easingOffsets: number[]): GraphSnapshot {
  return {
    graph: graph.map(p => ({ ...p })),
    easingOffsets: [...easingOffsets],
  };
}

function snapshotsEqual(a: GraphSnapshot, b: GraphSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Helper function for Power Curve easing
function evaluateSegment(t: number, handleValue: number): number {
  const strength = 3;
  if (handleValue < 0) {
    const power = 1 - (handleValue * strength);
    return Math.pow(t, power);
  } else if (handleValue > 0) {
    const power = 1 + (handleValue * strength);
    return 1 - Math.pow(1 - t, power);
  }
  return t; // Linear fallback
}

// Evaluate the graph at a given normalized time (0-1)
// Returns the interpolated size value using Power Curve easing for each segment
export function evaluateGraphAtTime(time: number, points: SizeGraphPoint[]): number {
  if (!points || points.length === 0) return 0;
  if (points.length === 1) return points[0].size;
  
  // Clamp time to [0, 1]
  const clampedTime = Math.max(0, Math.min(1, time));
  
  // Find the segment containing this time
  for (let i = 0; i < points.length - 1; i++) {
    const pointA = points[i];
    const pointB = points[i + 1];
    
    if (clampedTime >= pointA.time && clampedTime <= pointB.time) {
      // Normalize t within the segment
      const segmentDuration = pointB.time - pointA.time;
      const t = segmentDuration > 0 ? (clampedTime - pointA.time) / segmentDuration : 0;
      
      // Calculate handleValue for this segment based on the midpoint constraint
      const midpointT = 0.5;
      const midpointSize = pointA.size + (pointB.size - pointA.size) * midpointT;
      
      // For now, use a default handleValue of 0 (linear)
      // This will be computed from the easingOffsets if available
      const handleValue = 0;
      
      const curvedProgress = evaluateSegment(t, handleValue);
      return pointA.size + (pointB.size - pointA.size) * curvedProgress;
    }
  }
  
  // If time is beyond the last point, return last point's value
  return points[points.length - 1].size;
}

function getGraphMetrics(config: GraphConfig, graphWidth: number) {
  const plotWidth = Math.max(0, graphWidth - config.padding * 2);
  const plotHeight = Math.max(0, config.height - config.padding * 2);
  return { plotWidth, plotHeight };
}

function graphPointToSvg(config: GraphConfig, point: SizeGraphPoint, graphWidth: number) {
  const { plotWidth, plotHeight } = getGraphMetrics(config, graphWidth);
  return {
    x: config.padding + point.time * plotWidth,
    y: config.padding + (1 - point.size) * plotHeight,
  };
}

function graphCoordsFromEvent(config: GraphConfig, event: { clientX: number; clientY: number }, svg: SVGSVGElement | null, graphWidth: number) {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const { plotWidth, plotHeight } = getGraphMetrics(config, graphWidth);
  const x = clamp((event.clientX - rect.left - config.padding) / plotWidth, 0, 1);
  const y = clamp(1 - (event.clientY - rect.top - config.padding) / plotHeight, 0, 1);
  return { time: x, size: y };
}

function buildSmoothCurvePath(config: GraphConfig, points: SizeGraphPoint[], graphWidth: number, easingOffsets: number[] = []) {
  if (points.length === 0) return '';
  const samples = 30;
  let d = ``;
  d += `M ${graphPointToSvg(config, points[0], graphWidth).x} ${graphPointToSvg(config, points[0], graphWidth).y}`;
  for (let i = 1; i < points.length; i++) {
    const pointA = points[i - 1];
    const pointB = points[i];
    const svgPointA = graphPointToSvg(config, pointA, graphWidth);
    const svgPointB = graphPointToSvg(config, pointB, graphWidth);
    const handlerY = easingOffsets[i - 1] || (svgPointA.y + svgPointB.y) / 2;
    
    const minY = Math.min(svgPointA.y, svgPointB.y);
    const maxY = Math.max(svgPointA.y, svgPointB.y);
    const handlerMinY = (2 * minY + svgPointA.y + svgPointB.y) / 4;
    const handlerMaxY = (2 * maxY + svgPointA.y + svgPointB.y) / 4;
    
    const midpointY = (svgPointA.y + svgPointB.y) / 2;
    let handleValue = 0;
    const range = handlerMaxY - handlerMinY;
    const segmentDirection = Math.sign(pointB.size - pointA.size); // +1 for upward, -1 for downward
    if (range > 0) {
      handleValue = -(handlerY - midpointY) * 2 / range * segmentDirection;
    }
    handleValue = Math.max(-1, Math.min(1, handleValue));
    
    const strength = 3;
    const { plotWidth, plotHeight } = getGraphMetrics(config, graphWidth);
    
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      let curvedProgress = t;
      if (handleValue < 0) {
        const power = 1 - (handleValue * strength);
        curvedProgress = Math.pow(t, power);
      } else if (handleValue > 0) {
        const power = 1 + (handleValue * strength);
        curvedProgress = 1 - Math.pow(1 - t, power);
      }
      const finalY = pointA.size + (pointB.size - pointA.size) * curvedProgress;
      const finalX = pointA.time + (pointB.time - pointA.time) * t;
      const svgX = config.padding + finalX * plotWidth;
      const svgY = config.padding + (1 - finalY) * plotHeight;
      d += ` L ${svgX} ${svgY}`;
    }
  }
  return d;
}

export default function GraphEditor({
  graph,
  onChange,
  config = DEFAULT_GRAPH_CONFIG,
  Y_label = 'value',
  X_label = 'time',
  onEasingChange,
  initialEasingOffsets,
}: {
  graph: SizeGraphPoint[];
  onChange: Dispatch<SetStateAction<SizeGraphPoint[]>>;
  config?: GraphConfig;
  Y_label?: string;
  X_label?: string;
  onEasingChange?: (offsets: number[]) => void;
  initialEasingOffsets?: number[];
}) {
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [svgWidth, setSvgWidth] = useState(config.width);
  const [easingOffsets, setEasingOffsets] = useState<number[]>(() => initialEasingOffsets ?? []);
  const [dragSensitivity, setDragSensitivity] = useState(DEFAULT_SENSITIVITY);
  const [showSensitivityDisplay, setShowSensitivityDisplay] = useState(false);
  const sensitivityHideTimeoutRef = useRef<number | null>(null);
  
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingPointIndex = useRef<number | null>(null);
  const draggingEasingIndex = useRef<number | null>(null);
  const preDragSnapshot = useRef<GraphSnapshot | null>(null);
  const graphRef = useRef(graph);
  const easingOffsetsRef = useRef(easingOffsets);
  const graphHistory = useLocalHistory<GraphSnapshot>('graph');
  
  // Track drag start position for sensitivity calculations
  const dragStartPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
  
  // Helper to show sensitivity display temporarily
  const showSensitivityDisplayTemporarily = useCallback(() => {
    setShowSensitivityDisplay(true);
    if (sensitivityHideTimeoutRef.current !== null) {
      window.clearTimeout(sensitivityHideTimeoutRef.current);
    }
    sensitivityHideTimeoutRef.current = window.setTimeout(() => {
      setShowSensitivityDisplay(false);
      sensitivityHideTimeoutRef.current = null;
    }, DISPLAY_DURATION_MS);
  }, []);
  
  // Handle wheel event during drag to adjust sensitivity
  const handleWheelDuringDrag = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setDragSensitivity(prev => adjustSensitivity(prev, e.deltaY));
    showSensitivityDisplayTemporarily();
  }, [showSensitivityDisplayTemporarily]);
  
  // Lock pointer to element during drag using Pointer Lock API
  const lockPointer = useCallback((element: Element) => {
    if (element.requestPointerLock) {
      element.requestPointerLock();
    }
  }, []);
  
  const unlockPointer = useCallback(() => {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
  }, []);

  useEffect(() => { graphRef.current = graph; }, [graph]);
  useEffect(() => { easingOffsetsRef.current = easingOffsets; }, [easingOffsets]);

  const sortedGraph = useMemo(() => graph.slice().sort((a, b) => a.time - b.time), [graph]);

  const getCurrentSnapshot = useCallback((): GraphSnapshot => {
    const sorted = graphRef.current.slice().sort((a, b) => a.time - b.time);
    return cloneGraphSnapshot(sorted, easingOffsetsRef.current);
  }, []);

  const restoreSnapshot = useCallback((snap: GraphSnapshot) => {
    onChange(snap.graph);
    setEasingOffsets(snap.easingOffsets);
  }, [onChange]);

  const handleUndo = useCallback(() => {
    console.log('handleUndo called. canUndo:', graphHistory.canUndo);
    graphHistory.undo(getCurrentSnapshot(), restoreSnapshot);
  }, [graphHistory, getCurrentSnapshot, restoreSnapshot]);

  const handleRedo = useCallback(() => {
    console.log('handleRedo called. canRedo:', graphHistory.canRedo);
    graphHistory.redo(getCurrentSnapshot(), restoreSnapshot);
  }, [graphHistory, getCurrentSnapshot, restoreSnapshot]);

  const pushHistorySnapshot = useCallback((snapshot: GraphSnapshot) => {
    graphHistory.push(snapshot);
  }, [graphHistory]);

  const beginDragSnapshot = useCallback(() => {
    preDragSnapshot.current = getCurrentSnapshot();
  }, [getCurrentSnapshot]);

  const commitDragSnapshot = useCallback(() => {
    if (!preDragSnapshot.current) return;
    const current = getCurrentSnapshot();
    if (!snapshotsEqual(preDragSnapshot.current, current)) {
      pushHistorySnapshot(preDragSnapshot.current);
    }
    preDragSnapshot.current = null;
  }, [getCurrentSnapshot, pushHistorySnapshot]);

  // Refs to hold latest versions of handleUndo and handleRedo for stable event listener
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);

  useEffect(() => {
    handleUndoRef.current = handleUndo;
    handleRedoRef.current = handleRedo;
  }, [handleUndo, handleRedo]);
  
  useEffect(() => {
    // Only reset to defaults if no saved offsets were provided
    if (initialEasingOffsets && initialEasingOffsets.length > 0) return;
    
    const initialOffsets = sortedGraph.map((point, index) => {
      if (index < sortedGraph.length - 1) {
        const nextPoint = sortedGraph[index + 1];
        const point1Svg = graphPointToSvg(config, point, svgWidth);
        const point2Svg = graphPointToSvg(config, nextPoint, svgWidth);
        const midY = (point1Svg.y + point2Svg.y) / 2;
        const minY = Math.min(point1Svg.y, point2Svg.y);
        const maxY = Math.max(point1Svg.y, point2Svg.y);
        
        // Constrain midpoint to valid range that keeps curve within bounds
        const handlerMinY = (2 * minY + point1Svg.y + point2Svg.y) / 4;
        const handlerMaxY = (2 * maxY + point1Svg.y + point2Svg.y) / 4;
        return clamp(midY, handlerMinY, handlerMaxY);
      }
      return 0;
    });
    setEasingOffsets(initialOffsets);
  }, [sortedGraph.length, svgWidth, config, initialEasingOffsets]);
  
  const graphPath = useMemo(() => buildSmoothCurvePath(config, sortedGraph, svgWidth, easingOffsets), [sortedGraph, svgWidth, easingOffsets, config]);

  const segmentHandleValues = useMemo(() => {
    return sortedGraph.slice(0, -1).map((pointA, index) => {
      const pointB = sortedGraph[index + 1];
      const svgPointA = graphPointToSvg(config, pointA, svgWidth);
      const svgPointB = graphPointToSvg(config, pointB, svgWidth);
      const handlerY = easingOffsets[index] ?? (svgPointA.y + svgPointB.y) / 2;
      const midpointY = (svgPointA.y + svgPointB.y) / 2;
      const minY = Math.min(svgPointA.y, svgPointB.y);
      const maxY = Math.max(svgPointA.y, svgPointB.y);
      const handlerMinY = (2 * minY + svgPointA.y + svgPointB.y) / 4;
      const handlerMaxY = (2 * maxY + svgPointA.y + svgPointB.y) / 4;
      const range = handlerMaxY - handlerMinY;
      if (range <= 0) return 0;
      const segmentDirection = Math.sign(pointB.size - pointA.size);
      return clamp(-(handlerY - midpointY) * 2 / range * segmentDirection, -1, 1);
    });
  }, [sortedGraph, easingOffsets, svgWidth, config]);

  useEffect(() => {
    onEasingChange?.(segmentHandleValues);
  }, [segmentHandleValues, onEasingChange]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        console.log('Keyboard shortcut blocked: focus is in input/textarea');
        return;
      }
      
      console.log('=== KEYDOWN EVENT ===');
      console.log('Key:', e.key, 'Code:', e.code);
      console.log('Modifiers: Ctrl=', e.ctrlKey, 'Shift=', e.shiftKey, 'Alt=', e.altKey);
      console.log('Match undo:', isShortcutMatch('undo', e));
      console.log('Match redo:', isShortcutMatch('redo', e));
      console.log('graphHistory.canUndo:', graphHistory.canUndo);
      console.log('handleUndoRef.current exists:', !!handleUndoRef.current);
      
      if (isShortcutMatch('undo', e)) {
        console.log('>>> UNDO SHORTCUT MATCHED! Calling handleUndoRef.current()');
        e.preventDefault();
        e.stopImmediatePropagation();
        (window as any).__graphUndoRedoHandled = true;
        try {
          handleUndoRef.current();
          console.log('>>> handleUndoRef.current() completed');
        } catch (err) {
          console.error('>>> ERROR in handleUndoRef.current():', err);
        }
        return;
      }
      
      if (isShortcutMatch('redo', e)) {
        console.log('>>> REDO SHORTCUT MATCHED!');
        e.preventDefault();
        e.stopImmediatePropagation();
        (window as any).__graphUndoRedoHandled = true;
        handleRedoRef.current();
      }
    };
    
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const pointIndex = draggingPointIndex.current;
      const easingIndex = draggingEasingIndex.current;
      const sensitivity = dragSensitivity;
      
      // Use relative movement so the mouse doesn't need to move far
      const relX = e.movementX * sensitivity;
      const relY = e.movementY * sensitivity;
      
      if (pointIndex !== null) {
        // Store current graph position and apply relative movement
        const currentGraph = graphRef.current.slice().sort((a, b) => a.time - b.time);
        const currentPoint = currentGraph[pointIndex];
        if (!currentPoint) return;
        
        // Convert relative pixel movement to graph coordinate changes
        const svg = svgRef.current;
        if (!svg) return;
        const { plotWidth, plotHeight } = getGraphMetrics(config, svgWidth);
        
        // Approximate conversion: movement in pixels -> space in graph units
        // For x (time): movement / plotWidth
        // For y (size): -movement / plotHeight (inverted because SVG Y is flipped)
        const timeDelta = relX / plotWidth;
        const sizeDelta = -relY / plotHeight;
        
        let newTime = currentPoint.time + timeDelta;
        let newSize = clamp(currentPoint.size + sizeDelta, 0, 1);
        
        // Constrain time based on neighboring points
        if (pointIndex === 0 || pointIndex === currentGraph.length - 1) {
          newSize = clamp(newSize, 0, 1);
        } else {
          const minTime = pointIndex > 0 ? currentGraph[pointIndex - 1].time + config.minTimeDelta : 0;
          const maxTime = pointIndex < currentGraph.length - 1 ? currentGraph[pointIndex + 1].time - config.minTimeDelta : 1;
          newTime = clamp(newTime, minTime, maxTime);
          newSize = clamp(newSize, 0, 1);
        }
        
        onChange(prev => {
          const next = prev.slice().sort((a, b) => a.time - b.time);
          if (pointIndex === 0 || pointIndex === next.length - 1) {
            next[pointIndex] = {
              ...next[pointIndex],
              size: newSize,
            };
            return next;
          }
          next[pointIndex] = {
            time: newTime,
            size: newSize,
          };
          return next;
        });
      } else if (easingIndex !== null) {
        // For easing handles, only vertical movement matters
        const currentOffset = easingOffsetsRef.current[easingIndex] ?? 0;
        const newOffset = currentOffset + relY;
        
        const point1 = sortedGraph[easingIndex];
        const point2 = sortedGraph[easingIndex + 1];
        const svgPoint1 = graphPointToSvg(config, point1, svgWidth);
        const svgPoint2 = graphPointToSvg(config, point2, svgWidth);
        
        const minY = Math.min(svgPoint1.y, svgPoint2.y);
        const maxY = Math.max(svgPoint1.y, svgPoint2.y);
        const handlerMinY = (2 * minY + svgPoint1.y + svgPoint2.y) / 4;
        const handlerMaxY = (2 * maxY + svgPoint1.y + svgPoint2.y) / 4;
        
        const constrainedY = clamp(newOffset, handlerMinY, handlerMaxY);
        
        setEasingOffsets(prev => {
          const next = [...prev];
          next[easingIndex] = constrainedY;
          return next;
        });
      }
    };

    const handlePointerUp = () => {
      const wasDragging = draggingPointIndex.current !== null || draggingEasingIndex.current !== null;
      if (wasDragging) {
        commitDragSnapshot();
      }
      draggingPointIndex.current = null;
      draggingEasingIndex.current = null;
      dragStartPositionRef.current = null;
      unlockPointer();
    };

    // Handle case where user presses Esc to exit pointer lock
    const handlePointerLockChange = () => {
      if (!document.pointerLockElement) {
        if (draggingPointIndex.current !== null || draggingEasingIndex.current !== null) {
          commitDragSnapshot();
          draggingPointIndex.current = null;
          draggingEasingIndex.current = null;
          dragStartPositionRef.current = null;
        }
      }
    };

    window.addEventListener('wheel', handleWheelDuringDrag, { passive: false });
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => {
      window.removeEventListener('wheel', handleWheelDuringDrag);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [onChange, svgWidth, commitDragSnapshot, config, sortedGraph, handleWheelDuringDrag, unlockPointer, dragSensitivity]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      const nextWidth = container.clientWidth || config.width;
      setSvgWidth(prev => (prev === nextWidth ? prev : nextWidth));
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [config.width]);

  const plotHeight = config.height - config.padding * 2;
  const plotWidth = Math.max(0, svgWidth - config.padding * 2);
  const undoShortcutLabel = formatShortcutLabel('undo');
  const redoShortcutLabel = formatShortcutLabel('redo');

  return (
    <div ref={containerRef} className="settings-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, width: '100%', position: 'relative', zIndex: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, lineHeight: 1.2 }}>{Y_label} over {X_label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className="icon-btn"
            onClick={handleUndo}
            disabled={!graphHistory.canUndo}
            title={`Undo (${undoShortcutLabel})`}
            style={{ padding: 4, opacity: graphHistory.canUndo ? 1 : 0.4 }}
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handleRedo}
            disabled={!graphHistory.canRedo}
            title={`Redo (${redoShortcutLabel})`}
            style={{ padding: 4, opacity: graphHistory.canRedo ? 1 : 0.4 }}
          >
            <Redo2 size={14} />
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height={config.height}
        viewBox={`0 0 ${svgWidth} ${config.height}`}
        onPointerDown={e => {
          if (e.button !== 0) return; // Only respond to left-click
          if ((e.target as SVGElement).tagName.toLowerCase() === 'circle') return;
          const coords = graphCoordsFromEvent(config, e, svgRef.current, svgWidth);
          if (!coords) return;
          const time = clamp(coords.time, 0.01, 0.99);
          if (sortedGraph.some(p => Math.abs(p.time - time) < config.minTimeDelta)) return;
          const size = clamp(coords.size, 0, 1);
          pushHistorySnapshot(cloneGraphSnapshot(sortedGraph, easingOffsets));
          const next = [...sortedGraph, { time, size }].sort((a, b) => a.time - b.time);
          const newIndex = next.findIndex(p => p.time === time && p.size === size);
          onChange(next);
          setSelectedPointIndex(newIndex);
          draggingPointIndex.current = newIndex;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', cursor: 'crosshair' }}
      >
        <rect x={0} y={0} width={svgWidth} height={config.height} fill="transparent" />
        <g stroke="var(--border-mid)" strokeWidth={1} fill="none">
          <line x1={config.padding} y1={config.padding} x2={config.padding} y2={config.height - config.padding} />
          <line x1={config.padding} y1={config.height - config.padding} x2={svgWidth - config.padding} y2={config.height - config.padding} />
        </g>
        <path d={graphPath} fill="none" stroke={GRAPH_LINE_COLOR} strokeWidth={2} />
        {showSensitivityDisplay && (
          <text
            x={config.padding + 10}
            y={config.padding + 20}
            fill="var(--highlight-color)"
            fontSize="12"
            fontFamily="monospace"
            fontWeight="bold"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            Sens: {formatSensitivity(dragSensitivity)}
          </text>
        )}
        {sortedGraph.map((point, index) => {
          if (index < sortedGraph.length - 1) {
            const nextPoint = sortedGraph[index + 1];
            const midPoint: SizeGraphPoint = {
              time: (point.time + nextPoint.time) / 2,
              size: (point.size + nextPoint.size) / 2,
            };
            const midSvg = graphPointToSvg(config, midPoint, svgWidth);
            const point1Svg = graphPointToSvg(config, point, svgWidth);
            const point2Svg = graphPointToSvg(config, nextPoint, svgWidth);
            
            const minY = Math.min(point1Svg.y, point2Svg.y);
            const maxY = Math.max(point1Svg.y, point2Svg.y);
            const handlerMinY = (2 * minY + point1Svg.y + point2Svg.y) / 4;
            const handlerMaxY = (2 * maxY + point1Svg.y + point2Svg.y) / 4;

            // Compute the actual curve Y at t=0.5 using the same formula as buildSmoothCurvePath
            const handlerY = easingOffsets[index] !== undefined 
              ? clamp(easingOffsets[index], handlerMinY, handlerMaxY)
              : (point1Svg.y + point2Svg.y) / 2;
            const midpointY = (point1Svg.y + point2Svg.y) / 2;
            const range = handlerMaxY - handlerMinY;
            let handleValue = 0;
            const segmentDirection = Math.sign(nextPoint.size - point.size);
            if (range > 0) {
              handleValue = -(handlerY - midpointY) * 2 / range * segmentDirection;
            }
            handleValue = Math.max(-1, Math.min(1, handleValue));

            const strength = 3;
            const t = 0.5;
            let curvedProgress = t;
            if (handleValue < 0) {
              const power = 1 - (handleValue * strength);
              curvedProgress = Math.pow(t, power);
            } else if (handleValue > 0) {
              const power = 1 + (handleValue * strength);
              curvedProgress = 1 - Math.pow(1 - t, power);
            }
            const finalY = point.size + (nextPoint.size - point.size) * curvedProgress;
            const handleY = config.padding + (1 - finalY) * plotHeight;
            
            return (
              <g key={`easing-${index}`} style={{ cursor: 'ns-resize', zIndex: 5 }}>
                <circle
                  cx={midSvg.x}
                  cy={handleY}
                  r={16}
                  fill="transparent"
              onPointerDown={e => {
                if (e.button !== 0) return; // Only respond to left-click
                e.stopPropagation();
                beginDragSnapshot();
                draggingEasingIndex.current = index;
                dragStartPositionRef.current = { clientX: e.clientX, clientY: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
                lockPointer(e.currentTarget);
              }}
                />
                <circle
                  cx={midSvg.x}
                  cy={handleY}
                  r={EASE_HANDLE_DIAMETER_PX / 2 + 1}
                  fill="var(--bg-elevated)"
                  style={{ pointerEvents: 'none' }}
                />
                <circle
                  cx={midSvg.x}
                  cy={handleY}
                  r={EASE_HANDLE_DIAMETER_PX / 2}
                  fill="none"
                  stroke={EASE_HANDLE_COLOR}
                  strokeWidth={EASE_HANDLE_RING_THICKNESS_PX}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            );
          }
          return null;
        })}
        {sortedGraph.map((point, index) => {
          const svgPoint = graphPointToSvg(config, point, svgWidth);
          const isSelected = selectedPointIndex === index;
          return (
            <circle
              key={`point-${index}`}
              cx={svgPoint.x}
              cy={svgPoint.y}
              r={ANCHOR_DIAMETER_PX / 2}
              fill={index === 0 || index === sortedGraph.length - 1 ? 'var(--highlight-color)' : ANCHOR_INNER_COLOR}
              stroke={ANCHOR_OUTER_COLOR}
              strokeWidth={ANCHOR_BORDER_THICKNESS_PX}
              style={{ cursor: index === 0 || index === sortedGraph.length - 1 ? 'default' : 'grab', zIndex: 10 }}
              onPointerDown={e => {
                e.stopPropagation();
                
                // Handle right-click for deletion
                if (e.button === 2) {
                  e.preventDefault();
                  if (index === 0 || index === sortedGraph.length - 1) return;
                  pushHistorySnapshot(cloneGraphSnapshot(sortedGraph, easingOffsets));
                  onChange(prev => {
                    const next = prev.slice().sort((a, b) => a.time - b.time);
                    next.splice(index, 1);
                    return next;
                  });
                  setSelectedPointIndex(null);
                  return;
                }
                
                // Only respond to left-click for dragging
                if (e.button !== 0) return;
                
                beginDragSnapshot();
                draggingPointIndex.current = index;
                dragStartPositionRef.current = { clientX: e.clientX, clientY: e.clientY };
                setSelectedPointIndex(index);
                e.currentTarget.setPointerCapture(e.pointerId);
                lockPointer(e.currentTarget);
              }}
              onClick={e => {
                e.stopPropagation();
                setSelectedPointIndex(index);
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}