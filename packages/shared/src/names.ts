/**
 * Anonymous identity helpers. GhostLink never stores real identities; every
 * session gets a random "ghost alias" (adjective + noun) plus an emoji.
 */

const ADJECTIVES = [
  'Quiet', 'Hollow', 'Wandering', 'Silver', 'Velvet', 'Ashen', 'Lunar', 'Drifting',
  'Echoing', 'Muted', 'Cinder', 'Fogbound', 'Nocturnal', 'Veiled', 'Dusky',
  'Flickering', 'Wistful', 'Phantom', 'Lone', 'Serene',
] as const;

const NOUNS = [
  'Fox', 'Owl', 'Moth', 'Wanderer', 'Traveler', 'Raven', 'Wolf', 'Hare',
  'Lynx', 'Otter', 'Stag', 'Swan', 'Sparrow', 'Finch', 'Heron', 'Vole',
  'Badger', 'Vixen', 'Falcon', 'Eel',
] as const;

const EMOJIS = [
  '👻', '🦊', '🦉', '🌫️', '🌒', '🕯️', '🍃', '🌊', '🦇', '🪶',
  '🌿', '🌙', '🪐', '🌸', '🍂', '❄️', '🌾', '🫧', '🪷', '🌵',
] as const;

export function randomAlias(rand: () => number = Math.random): string {
  const adj = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)] ?? 'Quiet';
  const noun = NOUNS[Math.floor(rand() * NOUNS.length)] ?? 'Fox';
  return `${adj} ${noun}`;
}

export function randomEmoji(rand: () => number = Math.random): string {
  return EMOJIS[Math.floor(rand() * EMOJIS.length)] ?? '👻';
}

export const GHOST_EMOJIS = EMOJIS;

export function aliasFromSeed(seed: string): { alias: string; emoji: string } {
  // Deterministic-ish (FNV-1a) so a given seed maps to a stable alias.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  const adj = ADJECTIVES[h % ADJECTIVES.length] ?? 'Quiet';
  const noun = NOUNS[(h >>> 4) % NOUNS.length] ?? 'Fox';
  const emoji = EMOJIS[(h >>> 8) % EMOJIS.length] ?? '👻';
  return { alias: `${adj} ${noun}`, emoji };
}
