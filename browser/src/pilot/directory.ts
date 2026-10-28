export const explorers = [
  { id: 'character', title: 'Character Explorer', description: 'Bunny, Bear and Cat', detail: 'Creation, motion and customization' },
  { id: 'foliage', title: 'Foliage Explorer', description: 'Plants, trees and ground assets', detail: 'Forest floor, stone, wood, fungi, harvest and shoreline' },
  { id: 'island', title: 'Island Explorer', description: 'Landforms and their surfaces', detail: 'Preserved V1, V2 studies and build journal' },
  { id: 'navigation', title: 'Navigation Explorer', description: 'Movement and paths', detail: 'Fixtures, terrain editing and route inspection' },
] as const;

export type PilotRoute = 'home' | 'play' | 'ui' | typeof explorers[number]['id'];

export function resolveRoute(path: string, parameters: URLSearchParams): PilotRoute {
  if (path === '' || path === '/') return 'home';
  if (path === '/trees') {
    parameters.set('foliage', 'trees');
    return 'foliage';
  }
  if (path === '/foraging') return 'foliage';
  const match = explorers.find(item => path === `/${item.id}`);
  if (match) return match.id;
  if (path === '/play') return 'play';
  if (path === '/ui') return 'ui';
  throw new Error('That explorer does not exist. Return Home and choose an explorer.');
}

export function routeTitle(route: PilotRoute): string {
  return explorers.find(item => item.id === route)?.title
    ?? (route === 'home' ? 'a long table' : route === 'ui' ? 'UI Explorer' : 'Play');
}
