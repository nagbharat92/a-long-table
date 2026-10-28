export const GROUND_ASSET_GROUPS = [
  { name: 'Plants', assets: [['bush', 'Berry bush'], ['grass', 'Grass'], ['ferns', 'Ferns'], ['moss', 'Moss'], ['reeds', 'Reeds & rushes']] },
  { name: 'Trees', assets: [['trees', 'Trees']] },
  { name: 'Forest floor', assets: [['leaves', 'Fallen leaves'], ['seeds', 'Pinecones & acorns']] },
  { name: 'Stone & wood', assets: [['rocks', 'Rocks'], ['pebbles', 'Small stones'], ['wood', 'Wood'], ['roots', 'Roots']] },
  { name: 'Fungi', assets: [['mushrooms', 'Mushrooms']] },
  { name: 'Harvest', assets: [['vegetables', 'Wild vegetables'], ['fruit', 'Fallen fruit']] },
  { name: 'Shoreline', assets: [['shells', 'Shells']] },
] as const;

export type GroundAssetTab = typeof GROUND_ASSET_GROUPS[number]['assets'][number][0];
export type StaticGroundAssetTab = Exclude<GroundAssetTab, 'bush' | 'grass'>;

export function foliageTabs(selected: GroundAssetTab): HTMLElement {
  const library = document.createElement('div');
  library.className = 'forage-library';
  const categories = document.createElement('nav');
  categories.className = 'forage-categories';
  categories.setAttribute('aria-label', 'Asset categories');
  const current = GROUND_ASSET_GROUPS.find(group => group.assets.some(([id]) => id === selected))!;
  const href = (id: GroundAssetTab): string => `#/foliage?tab=${id}`;
  for (const group of GROUND_ASSET_GROUPS) {
    const link = document.createElement('a');
    link.textContent = group.name;
    link.href = href(group.assets[0][0]);
    if (group === current) link.setAttribute('aria-current', 'true');
    categories.append(link);
  }
  const assets = document.createElement('nav');
  assets.className = 'forage-tabs';
  assets.setAttribute('aria-label', 'Ground assets');
  for (const [id, label] of current.assets) {
    const link = document.createElement('a');
    link.className = 'button';
    link.textContent = label;
    link.href = href(id);
    if (id === selected) link.setAttribute('aria-current', 'page');
    assets.append(link);
  }
  library.append(categories);
  if (current.assets.length > 1) library.append(assets);
  return library;
}
