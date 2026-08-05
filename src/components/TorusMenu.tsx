// Module-level singleton that persists across TorusMenu instances.
// Prevents entrance animation from replaying when component remounts.
let torusMenuHasAnimated = false;

import { useEffect, useState, useRef, ReactNode } from 'react';
import { Scissors, ChevronLeft, ChevronRight, Move } from 'lucide-react';
import { getSavedSizeGraph, SizeGraphPoint } from './graph';
import { evaluateGraphWithHandles, getSavedSegmentHandleValues } from '../utils/torusGraphEasing';

type TorusTarget =
  | { kind: 'inside'; clipId: string; frame: number }
  | { kind: 'edge'; clipId: string; side: 'start' | 'end'; frame: number }
  | { kind: 'cut'; clipAId: string; clipBId: string; frame: number };

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  color?: string;
}

interface Props {
  // Mode
  interactive?: boolean;

  // Interactive-only
  pos?: { x: number; y: number };
  target?: TorusTarget;
  onClose?: () => void;
  onSplit?: () => void;
  onTrimLatter?: (ripple: boolean) => void;
  onTrimFormer?: (ripple: boolean) => void;
  onStep?: (dir: number, ripple: boolean) => void;
  onRoll?: () => void;
  showCloseButton?: boolean;

  // Preview-only
  items?: MenuItem[];
  cx?: number;
  cy?: number;
  innerR?: number;
  outerR?: number;
  rotationOffset?: number;
  onSectorClick?: (label: string) => void;

  // Animation
  duration?: number;
  easing?: number;
  delay?: number;
  sizeGraph?: SizeGraphPoint[];
  segmentHandleValues?: number[];

  // Shared
  closeOnBackgroundClick?: boolean;

  // Scroll disabling
  disableScrolling?: 'whole torus menu' | 'annular sectors only' | 'none';
}

function annularSectorPath(
  cx: number, cy: number,
  innerR: number, outerR: number,
  startAngle: number, endAngle: number,
  gap: number = 1.5
): string {
  const sa = startAngle + gap * 0.5 * (Math.PI / 180);
  const ea = endAngle - gap * 0.5 * (Math.PI / 180);

  const x1 = cx + innerR * Math.cos(sa);
  const y1 = cy + innerR * Math.sin(sa);
  const x2 = cx + outerR * Math.cos(sa);
  const y2 = cy + outerR * Math.sin(sa);
  const x3 = cx + outerR * Math.cos(ea);
  const y3 = cy + outerR * Math.sin(ea);
  const x4 = cx + innerR * Math.cos(ea);
  const y4 = cy + innerR * Math.sin(ea);

  const largeArc = (ea - sa) > Math.PI ? 1 : 0;

  return [
    `M ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x3} ${y3}`,
    `L ${x4} ${y4}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1} ${y1}`,
    'Z',
  ].join(' ');
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

export default function TorusMenu({
  interactive = false,
  pos = { x: 0, y: 0 },
  target,
  onClose = () => {},
  onSplit = () => {},
  onTrimLatter = () => {},
  onTrimFormer = () => {},
  onStep = () => {},
  onRoll = () => {},
  showCloseButton = false,
  duration: durationProp,
  easing: easingProp,
  delay: delayProp,
  sizeGraph: sizeGraphProp,
  segmentHandleValues: segmentHandleValuesProp,
  items: propItems,
  cx: propCx,
  cy: propCy,
  innerR: propInnerR,
  outerR: propOuterR,
  rotationOffset: propRotationOffset,
  onSectorClick,
  closeOnBackgroundClick = true,
  disableScrolling = 'none',
}: Props) {
  const duration = durationProp ?? getSavedDuration();
  const easing = easingProp ?? getSavedEasing();
  const delay = delayProp ?? getSavedDelay();

  // 🔥 FIX: Use useState to calculate these EXACTLY ONCE per menu mount.
  // This prevents JSON.parse from creating new array references on every render,
  // which stops the useEffect from re-triggering and resetting the animation.
  const [stableSizeGraph] = useState(() => sizeGraphProp ?? getSavedSizeGraph());
  const [stableSegmentHandles] = useState(() => segmentHandleValuesProp ?? getSavedSegmentHandleValues());

  const sizeGraph = sizeGraphProp ?? stableSizeGraph;
  const segmentHandleValues = segmentHandleValuesProp ?? stableSegmentHandles;

  const cx = propCx ?? 120;
  const cy = propCy ?? 120;
  const innerR = propInnerR ?? 52;
  const outerR = propOuterR ?? 100;
  const rotationOffset = propRotationOffset ?? (-Math.PI / 6);

  const isEdgeOrCut = interactive && target ? (target.kind === 'edge' || target.kind === 'cut') : false;

  const insideItems: MenuItem[] = interactive
    ? [
        { label: 'Split', icon: <Scissors size={14} />, action: onSplit, color: '#60a5fa' },
        { label: 'Trim', icon: <ChevronRight size={14} />, action: () => onTrimLatter(false), color: '#34d399' },
        { label: 'Trim', icon: <ChevronLeft size={14} />, action: () => onTrimFormer(false), color: '#34d399' },
        { label: 'Ripple', icon: <ChevronRight size={14} />, action: () => onTrimLatter(true), color: '#fbbf24' },
        { label: 'Ripple', icon: <ChevronLeft size={14} />, action: () => onTrimFormer(true), color: '#fbbf24' },
        { label: 'Roll', icon: <Move size={14} />, action: onRoll, color: '#f472b6' },
      ]
    : (propItems ?? []);

  const edgeItems: MenuItem[] = interactive
    ? [
        { label: '+1f', icon: <ChevronRight size={14} />, action: () => onStep(1, false), color: '#60a5fa' },
        { label: '-1f', icon: <ChevronLeft size={14} />, action: () => onStep(-1, false), color: '#60a5fa' },
        { label: 'Ripple +1f', icon: <ChevronRight size={14} />, action: () => onStep(1, true), color: '#fbbf24' },
        { label: 'Ripple -1f', icon: <ChevronLeft size={14} />, action: () => onStep(-1, true), color: '#fbbf24' },
      ]
    : [];

  const items = isEdgeOrCut ? edgeItems : insideItems;
  const MAX_SECTORS = 6;
  const sectorAngle = (Math.PI * 2) / MAX_SECTORS;
  const visibleCount = items.length;

  // Interactive-only: scroll-to-close and background-click-to-close
  const ref = useRef<HTMLDivElement>(null);
  const sectorGroupRefs = useRef<(SVGGElement | null)[]>([]);
  
  // Track if the entrance animation has already played (persists across component instances)
  const hasAnimatedRef = useRef(torusMenuHasAnimated);

  useEffect(() => {
    // Allow the very first render to have the animation style.
    // After one frame, lock it so subsequent re-renders/remounts 
    // won't trigger the animation again.
    const rafId = requestAnimationFrame(() => {
      torusMenuHasAnimated = true;
      hasAnimatedRef.current = true;
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Remove animation styles from sectors after entrance completes.
  // This prevents CSS animation replay on re-mounts even if DOM nodes are recreated.
  useEffect(() => {
    if (!hasAnimatedRef.current) return;
    const timer = setTimeout(() => {
      sectorGroupRefs.current.forEach(group => {
        if (group) {
          group.style.animation = 'none';
          group.style.opacity = '1';
          group.style.transform = 'scale(1)';
        }
      });
    }, duration + delay + 100);
    return () => clearTimeout(timer);
  }, [duration, delay]);

  useEffect(() => {
    if (!interactive) return;
    const timer = setTimeout(() => {
      // Only attach scroll handler if scrolling is not disabled
      if (disableScrolling === 'none') {
        // Don't attach any scroll handler - let scroll propagate naturally
        return;
      }
      
      const scrollHandler = (e: Event) => {
        if (!ref.current) return;
        
        // Get mouse position
        const mouseX = (window as any).mouseX;
        const mouseY = (window as any).mouseY;
        
        // If we don't know mouse position, close the menu
        if (mouseX == null || mouseY == null) {
          onClose();
          return;
        }
        
        // Use elementFromPoint to detect what's under the mouse
        const el = document.elementFromPoint(mouseX, mouseY);
        
        if (disableScrolling === 'annular sectors only') {
          // If mouse is over a sector element, block scroll
          if (el?.closest('.torus-sector')) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // If mouse is inside the overlay but not on a sector (hollow center), allow scroll
          if (el && ref.current.contains(el)) {
            return;
          }
          // Otherwise close
          onClose();
          return;
        }
        
        if (disableScrolling === 'whole torus menu') {
          // If mouse is anywhere in the overlay, block scroll
          if (el && ref.current.contains(el)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        
        // Outside menu: close
        onClose();
      };
      window.addEventListener('scroll', scrollHandler, true);

      let clickHandler: ((e: MouseEvent) => void) | null = null;
      let pointerDownHandler: ((e: PointerEvent) => void) | null = null;
      if (closeOnBackgroundClick) {
        clickHandler = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest('.torus-toggle-btn')) return;
          if (target.closest('.torus-center-btn')) return;
          
          if (disableScrolling === 'annular sectors only') {
            // Close if not clicking on a sector (allow clicking center/outside to close)
            if (!target.closest('.torus-sector')) {
              onClose();
            }
            return;
          }
          
          if (ref.current && !ref.current.contains(target)) {
            onClose();
          }
        };
        window.addEventListener('mousedown', clickHandler);

        // Also handle pointerdown for splitters and other pointer-based interactions
        pointerDownHandler = (e: PointerEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest('.torus-toggle-btn')) return;
          if (target.closest('.torus-center-btn')) return;
          
          if (disableScrolling === 'annular sectors only') {
            if (!target.closest('.torus-sector')) {
              onClose();
            }
            return;
          }
          
          if (ref.current && !ref.current.contains(target)) {
            onClose();
          }
        };
        window.addEventListener('pointerdown', pointerDownHandler);
      }

      // Store mouse position globally for elementFromPoint access
      const mouseMoveHandler = (e: MouseEvent) => {
        (window as any).mouseX = e.clientX;
        (window as any).mouseY = e.clientY;
      };
      window.addEventListener('mousemove', mouseMoveHandler, true);

      return () => {
        window.removeEventListener('scroll', scrollHandler, true);
        if (clickHandler) window.removeEventListener('mousedown', clickHandler);
        if (pointerDownHandler) window.removeEventListener('pointerdown', pointerDownHandler);
        window.removeEventListener('mousemove', mouseMoveHandler, true);
      };
    }, 10);
    return () => clearTimeout(timer);
  }, [onClose, interactive, closeOnBackgroundClick, disableScrolling, outerR, innerR, cx, cy]);

  // Animation helpers
  const durationSec = duration / 1000;
  const t = easing / 100; // 0 = linear, 1 = max ease-in

  const getEasing = () => {
    // 0 = linear (cubic-bezier(0, 0, 1, 1))
    // max = strong ease-in (cubic-bezier(0.2, 0, 1, 1.3))
    const x2 = 1 - t * 0.8; // 1.0 (linear) -> 0.2 (strong ease-in)
    const y2 = 1 + t * 0.3; // slight overshoot for bounce feel
    return `cubic-bezier(${x2.toFixed(2)}, 0, 1, ${y2.toFixed(2)})`;
  };

  const hasSizeGraph = Array.isArray(sizeGraph) && sizeGraph.length >= 2;

  // Compute per-sector delay based on delay prop and sector index
  // delay = 0: all sectors animate at once (same as old pop)
  // delay > 0: sectors pop in clockwise one by one
  // delay < 0: sectors pop in anticlockwise one by one
  const getSectorDelay = (index: number): number => {
    if (delay === 0) return 0;
    const count = items.length;
    if (delay > 0) {
      // Clockwise: index 0 first, then 1, 2, ...
      return index * (delay / 1000);
    } else {
      // Anticlockwise: last index first
      return (count - 1 - index) * (-delay / 1000);
    }
  };

  const getSectorStyle = (index: number): React.CSSProperties => {
    
    //console.log('🔥GETSECTORSTYLE is running for index:', index);

    const sectorDelay = getSectorDelay(index);
    return {
      cursor: 'pointer',
      //animation: `torus-sector-pop ${durationSec}s ${getEasing()} ${sectorDelay.toFixed(3)}s`,
      animationFillMode: 'both',
      transformOrigin: `${cx}px ${cy}px`,
      transformBox: 'view-box',
      animation: 'none !important',
      transition: 'none !important',
    };

    // Use the module-level singleton directly to prevent animation replay on remounts.
    // This ensures the entrance animation only plays once per app session.
    if (torusMenuHasAnimated) {
      return { 
        cursor: 'pointer',
        opacity: 1 
      };
    }

    
  };

  const getGroupStyle = (): React.CSSProperties | undefined => {
    if (!hasSizeGraph) return undefined;
    const initialSize = sizeGraph![0]?.size ?? 0;
    return {
      transformOrigin: `${cx}px ${cy}px`,
      transformBox: 'view-box',
      //opacity: 0,
      //transform: `scale(${initialSize})`,
    };
  };

  useEffect(() => {
    if (!hasSizeGraph) return;

    const sortedGraph = sizeGraph!.slice().sort((a, b) => a.time - b.time);
    const initialSize = sortedGraph[0]?.size ?? 0;
    const animDuration = Math.max(duration, 1);
    let frameId = 0;
    const startTime = performance.now();

    const tick = (now: number) => {
      let stillAnimating = false;

      items.forEach((_, index) => {
        const group = sectorGroupRefs.current[index];
        if (!group) return;

        const delayMs = getSectorDelay(index) * 1000;
        const elapsed = now - startTime - delayMs;

        if (elapsed < 0) {
          group.style.opacity = '0';
          group.style.transform = `scale(${initialSize})`;
          stillAnimating = true;
          return;
        }

        const linearProgress = Math.min(1, elapsed / animDuration);
        const size = evaluateGraphWithHandles(
          linearProgress,
          sortedGraph,
          segmentHandleValues,
          index === 0,
        );

        group.style.opacity = '1';
        group.style.transform = `scale(${size})`;

        if (linearProgress < 1) stillAnimating = true;
      });

      if (stillAnimating) {
        frameId = requestAnimationFrame(tick);
      }
    };

    

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [hasSizeGraph, sizeGraph, segmentHandleValues, duration, delay, cx, cy]);

  const handleSectorClick = (item: MenuItem) => {
    if (interactive) {
      item.action();
      onClose();
    } else {
      onSectorClick?.(item.label);
    }
  };

  const svgContent = (
    <svg width={cx * 2} height={cy * 2} viewBox={`0 0 ${cx * 2} ${cy * 2}`}>
      <defs>
        <clipPath id="torus-clip">
          <circle cx={cx} cy={cy} r={outerR} />
        </clipPath>
      </defs>
      <g clipPath="url(#torus-clip)">
      {Array.from({ length: MAX_SECTORS }).map((_, i) => {
        if (i >= visibleCount) {
          return (
            <g
              key={i}
              ref={el => { sectorGroupRefs.current[i] = el; }}
              style={{ opacity: 0, pointerEvents: 'none' }}
            >
              <path
                d={annularSectorPath(cx, cy, innerR, outerR, 0, 0)}
                fill="none"
                stroke="none"
              />
            </g>
          );
        }

        const item = items[i];
        const startAngle = i * sectorAngle - Math.PI / 2 + rotationOffset;
        const endAngle = (i + 1) * sectorAngle - Math.PI / 2 + rotationOffset;
        const midAngle = (startAngle + endAngle) / 2;
        const labelR = (innerR + outerR) / 2;
        const labelX = cx + labelR * Math.cos(midAngle);
        const labelY = cy + labelR * Math.sin(midAngle);

        return (
          <g
            key={i}
            ref={el => { sectorGroupRefs.current[i] = el; }}
            style={getGroupStyle()}
          >
            <path
              d={annularSectorPath(cx, cy, innerR, outerR, startAngle, endAngle)}
              fill="var(--input-field-bg)"
              stroke="var(--border-mid)"
              strokeWidth={0.5}
              className="torus-sector"
              style={getSectorStyle(i)}
              onClick={(e) => { e.stopPropagation(); handleSectorClick(item); }}
            />
            <foreignObject
              x={labelX - 36}
              y={labelY - 16}
              width={72}
              height={32}
              className="torus-sector"
              style={{ cursor: 'pointer', overflow: 'visible', ...getSectorStyle(i) }}
              onClick={(e) => { e.stopPropagation(); handleSectorClick(item); }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  color: item.color,
                  fontSize: 10,
                  lineHeight: 1.1,
                  textAlign: 'center',
                  gap: 1,
                }}
              >
                <span style={{ color: item.color, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
              </div>
            </foreignObject>
          </g>
        );
      })}
      </g>
    </svg>
  );

return (
    <>
      <style>{`
        @keyframes torus-sector-pop {
          0% { opacity: 0; transform: scale(0); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: scale(1); }
        }
        .torus-overlay.torus-overlay--no-scroll {
          pointer-events: none;
        }
        .torus-overlay.torus-overlay--no-scroll > * {
          pointer-events: auto;
        }
      `}</style>
      {interactive ? (
        <div
          className={`torus-overlay${disableScrolling === 'none' ? ' torus-overlay--no-scroll' : ''}`}
          ref={ref}
          style={{ left: pos.x - cx, top: pos.y - cy, width: cx * 2, height: cy * 2, transformOrigin: `${cx}px ${cy}px`, transformBox: 'view-box', borderRadius: '50%', overflow: 'hidden', clipPath: `circle(${outerR}px at ${cx}px ${cy}px)` }}
          onMouseDown={(e) => {
            const targetEl = e.target as HTMLElement;
            if (disableScrolling !== 'annular sectors only' || targetEl.closest('.torus-sector')) {
              e.stopPropagation();
            }
          }}
        >
          {svgContent}
          {showCloseButton && (
            <button
              type="button"
              className="torus-center-btn"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              title="Close"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '2px solid var(--highlight-color)',
                background: 'rgba(56,189,248,0.2)',
                color: 'var(--highlight-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 10,
                fontSize: 16,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      ) : (
        svgContent
      )}
    </>
  );
}
export const insideMenuItems: MenuItem[] = [
  { label: 'Split', icon: <Scissors size={14} />, action: () => {}, color: '#60a5fa' },
  { label: 'Trim', icon: <ChevronRight size={14} />, action: () => {}, color: '#34d399' },
  { label: 'Trim', icon: <ChevronLeft size={14} />, action: () => {}, color: '#34d399' },
  { label: 'Ripple', icon: <ChevronRight size={14} />, action: () => {}, color: '#fbbf24' },
  { label: 'Ripple', icon: <ChevronLeft size={14} />, action: () => {}, color: '#fbbf24' },
  { label: 'Roll', icon: <Move size={14} />, action: () => {}, color: '#f472b6' },
];

