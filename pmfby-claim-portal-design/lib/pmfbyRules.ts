/**
 * pmfbyRules.ts
 * -------------
 * Rule data + pure matchers used by the "Cline PMFBY Compliance Auditor"
 * (app/api/cline-audit/route.ts). No I/O here, so it is easy to test.
 */

export type Season = 'Kharif' | 'Rabi'

export interface CropRule {
  /** Canonical crop name reported in the audit. */
  name: string
  season: Season
  /** Lower-case names / regional aliases (English, Hindi, Marathi transliterations). */
  aliases: string[]
}

export interface CalamityRule {
  name: string
  aliases: string[]
}

/** PMFBY: loss from localised calamities must be intimated within 72 hours. */
export const INTIMATION_WINDOW_HOURS = 72

/** Demo fallback location used when a photo has no GPS (Wardha, Maharashtra). */
export const DEMO_FALLBACK_GPS = { lat: 20.7453, lng: 78.6022 } as const

export const ELIGIBLE_CROPS: CropRule[] = [
  // Kharif
  { name: 'Paddy', season: 'Kharif', aliases: ['paddy', 'rice', 'dhan', 'dhaan', 'chawal'] },
  { name: 'Maize', season: 'Kharif', aliases: ['maize', 'corn', 'makka', 'makai'] },
  { name: 'Jowar', season: 'Kharif', aliases: ['jowar', 'jwari', 'sorghum'] },
  { name: 'Bajra', season: 'Kharif', aliases: ['bajra', 'pearl millet'] },
  { name: 'Cotton', season: 'Kharif', aliases: ['cotton', 'kapas'] },
  { name: 'Soybean', season: 'Kharif', aliases: ['soybean', 'soyabean', 'soya'] },
  { name: 'Groundnut', season: 'Kharif', aliases: ['groundnut', 'peanut', 'moongphali', 'mungfali'] },
  { name: 'Tur (Arhar)', season: 'Kharif', aliases: ['tur', 'toor', 'tuvar', 'arhar', 'pigeon pea'] },
  { name: 'Moong', season: 'Kharif', aliases: ['moong', 'mung', 'green gram'] },
  { name: 'Urad', season: 'Kharif', aliases: ['urad', 'black gram'] },
  { name: 'Sugarcane', season: 'Kharif', aliases: ['sugarcane', 'sugar cane', 'ganna'] },
  // Rabi
  { name: 'Wheat', season: 'Rabi', aliases: ['wheat', 'gehu', 'gehun', 'gahu'] },
  { name: 'Barley', season: 'Rabi', aliases: ['barley', 'jau'] },
  { name: 'Gram', season: 'Rabi', aliases: ['gram', 'chana', 'chickpea', 'bengal gram'] },
  { name: 'Mustard', season: 'Rabi', aliases: ['mustard', 'sarson', 'rapeseed'] },
  { name: 'Masur', season: 'Rabi', aliases: ['masur', 'masoor', 'lentil'] },
  { name: 'Peas', season: 'Rabi', aliases: ['peas', 'pea', 'matar', 'mattar'] },
]

export const COVERED_CALAMITIES: CalamityRule[] = [
  { name: 'Flood', aliases: ['flood', 'floods', 'flooding', 'flooded', 'baadh', 'badh'] },
  {
    name: 'Inundation',
    aliases: ['inundation', 'inundated', 'waterlogging', 'water logging', 'waterlogged', 'submergence', 'submerged'],
  },
  { name: 'Cyclone', aliases: ['cyclone', 'cyclonic', 'toofan', 'tufan'] },
  { name: 'Hailstorm', aliases: ['hailstorm', 'hail', 'ole', 'olavrishti'] },
  { name: 'Landslide', aliases: ['landslide', 'landslip'] },
  {
    name: 'Unseasonal rain',
    aliases: ['unseasonal rain', 'unseasonal rains', 'untimely rain', 'excess rain', 'bemausam barish'],
  },
  { name: 'Drought', aliases: ['drought', 'dry spell', 'sukha', 'sookha'] },
]

/** Lower-case, turn punctuation into spaces, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find the rule whose alias appears (as a whole word or phrase) earliest in
 * `text`, so "Flood / Waterlogging" reports Flood. On a tie at the same
 * position the longer alias wins, so "green gram" matches Moong and not Gram.
 */
function matchByAlias<T extends { aliases: string[] }>(text: string, rules: T[]): T | null {
  const haystack = ` ${normalize(text)} `
  let best: { rule: T; index: number; length: number } | null = null
  for (const rule of rules) {
    for (const alias of rule.aliases) {
      const index = haystack.indexOf(` ${alias} `)
      if (index === -1) continue
      if (!best || index < best.index || (index === best.index && alias.length > best.length)) {
        best = { rule, index, length: alias.length }
      }
    }
  }
  return best ? best.rule : null
}

/** Case-insensitive, alias-aware lookup, e.g. "Dhan", "Paddy (Rice)" give Paddy. */
export function findEligibleCrop(crop: string): CropRule | null {
  return matchByAlias(crop, ELIGIBLE_CROPS)
}

/** Case-insensitive, alias-aware lookup, e.g. "Flood / Waterlogging" gives Flood. */
export function findCoveredCalamity(calamity: string): CalamityRule | null {
  return matchByAlias(calamity, COVERED_CALAMITIES)
}

/** True when the coordinates equal the demo fallback (to ~11 m precision). */
export function isFallbackLocation(lat: number, lng: number): boolean {
  const EPS = 1e-4
  return Math.abs(lat - DEMO_FALLBACK_GPS.lat) < EPS && Math.abs(lng - DEMO_FALLBACK_GPS.lng) < EPS
}
