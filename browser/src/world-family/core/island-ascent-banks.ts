import type { Point } from './contracts';
import {
  ascentSectionCoordinates, ascentSectionHeightAt, ascentSectionPolygon, ascentSectionPosition,
  type IslandAscent, type IslandAscentSection,
} from './island-ascents';
import { subtractIslandPolygon } from './island-columns';

/** Axis-aligned subtraction leaves rectangles on the original bank plane. */
export function subtractAscentBank(
  ascent: IslandAscent, section: IslandAscentSection, blockers: readonly Point[][],
): IslandAscentSection[] {
  let remaining = [ascentSectionPolygon(ascent, section)];
  for (const polygon of blockers) {
    remaining = remaining.flatMap(part => subtractIslandPolygon(part, polygon));
    if (!remaining.length) break;
  }
  return remaining.map(polygon => {
    const coordinates = polygon.map(point => ascentSectionCoordinates(ascent, section, point));
    const from = Math.min(...coordinates.map(point => point.x)), to = Math.max(...coordinates.map(point => point.x));
    const left = Math.min(...coordinates.map(point => point.y)), right = Math.max(...coordinates.map(point => point.y));
    const origin = ascentSectionPosition(ascent, section, from, (left + right) / 2);
    return {
      ...section, from, to, fromWidth: right - left, toWidth: right - left,
      fromHeight: ascentSectionHeightAt(ascent, section, origin),
      toHeight: ascentSectionHeightAt(ascent, section, ascentSectionPosition(ascent, section, to, (left + right) / 2)),
      axis: { origin, direction: { ...section.axis!.direction } },
    };
  });
}
