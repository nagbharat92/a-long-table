import type { DestinationId } from './core/contracts';

export interface Destination {
  id: DestinationId;
  title: string;
  description: string;
  detail: string;
  experimental: boolean;
}

export const destinations: readonly Destination[] = [
  {
    id: 'play',
    title: 'Play',
    description: 'A small island. A little company. Something to gather.',
    detail: 'Explore the island, select your character and gather berries.',
    experimental: false,
  },
  {
    id: 'island',
    title: 'Island Explorer',
    description: 'Coastlines, high ground and the ways between.',
    detail: 'Inspect seeded terrain, three elevations, cliffs and natural ramps.',
    experimental: true,
  },
  {
    id: 'character',
    title: 'Character Explorer',
    description: 'Every pixel, blink and little hop.',
    detail: 'The same artwork and animation used in the game, up close.',
    experimental: false,
  },
  {
    id: 'foraging',
    title: 'Foraging Explorer',
    description: 'From ripe berries to the next new growth.',
    detail: 'Try gathering, interruption, depletion and regrowth independently.',
    experimental: false,
  },
  {
    id: 'navigation',
    title: 'Navigation Explorer',
    description: 'Where we can walk, and how we get there.',
    detail: 'Inspect routes, movement costs and clearance. Paint a test world.',
    experimental: true,
  },
];

export function destinationById(id: string): Destination | undefined {
  return destinations.find((destination) => destination.id === id);
}
