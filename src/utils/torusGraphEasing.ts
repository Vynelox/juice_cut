//torusGraphEasing.ts
import type { SizeGraphPoint } from '../components/graph';

const STRENGTH = 3;

function evaluateSegment(localT: number, handleValue: number): number {
  if (handleValue === 0) return localT;
  if (handleValue < 0) {
    return Math.pow(localT, 1 - handleValue * STRENGTH);
  }
  return 1 - Math.pow(1 - localT, 1 + handleValue * STRENGTH);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function evaluateGraphWithHandles(
  time: number,
  graphPoints: SizeGraphPoint[],
  segmentHandleValues: number[] = [],
  logEasing = false,
): number {
  if (!graphPoints || graphPoints.length === 0) return 0;
  if (graphPoints.length === 1) return graphPoints[0].size;

  const clampedTime = Math.max(0, Math.min(1, time));
  const sorted = graphPoints.slice().sort((a, b) => a.time - b.time);

  for (let i = 0; i < sorted.length - 1; i++) {
    const segment = sorted[i];
    const nextX = sorted[i + 1].time;
    const nextY = sorted[i + 1].size;

    if (clampedTime >= segment.time && clampedTime <= nextX) {
      const segmentDuration = nextX - segment.time;
      const localT = segmentDuration > 0 ? (clampedTime - segment.time) / segmentDuration : 0;
      const handleValue = segmentHandleValues[i] ?? 0;

      let easedProgress = localT;
      if (handleValue !== 0) {
        easedProgress = evaluateSegment(localT, handleValue);
      }

      if (logEasing) {
        console.log('Eased Progress:', easedProgress, 'Linear Progress:', localT);
      }

      return lerp(segment.size, nextY, easedProgress);
    }
  }

  return sorted[sorted.length - 1].size;
}

export function getSavedSegmentHandleValues(): number[] {
  try {
    const raw = window.localStorage.getItem('juicecut.settings.torusSegmentHandleValues');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v: unknown) => Number(v)).filter((n: number) => !Number.isNaN(n));
      }
    }
  } catch {}
  return [];
}

export function saveSegmentHandleValues(values: number[]): void {
  try {
    window.localStorage.setItem('juicecut.settings.torusSegmentHandleValues', JSON.stringify(values));
  } catch {}
}
