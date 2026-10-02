// profile.js
// Style parameters of the posters AutoBuild understands. 'nmsu' is the default and
// must stay as-is; another school's posters are tuned by passing a partial object
// (opts.profile) that overrides these keys. Pure.

export const PROFILES = {
  nmsu: {
    targetRoom: 100, // median room short side, in plan units: every plan comes out the same scale
    maxSide: 4200, // longest side of the finished plan, in plan units
    minScale: 0.5, maxScale: 6,
    levels: [1, 2, 3, 4], // wall gap-closing radii tried, finest first
    maxLinesPerRoom: 4,
    leakCols: 3.5, leakRows: 6, // labels further apart than this many text heights = two rooms glued together
    roomAspectMax: 3.4, roomAreaMax: 0.08, // unnumbered cells must look like a room
    hallMaxShort: 0.14, hallMinLong: 7, // corridor limits: share of the long side / text heights
    prefixes: 'RSTMJEH', // letters that may start a room number
    attempts: [[44, '7'], [64, '8'], [44, '8'], [64, '7']], // [text height, tesseract psm] renderings per label
    lowVotes: 2, lowCost: 0.6, // a reading with fewer agreeing renderings / more repair cost is flagged
    useFormat: true, // vote with the number format inferred from the confident reads (other schools)
    nearMiss: true, // a token one character off a valid number becomes a flagged room number
    inferRuns: false, // fill a number from its neighbours (a guess: off, nothing is invented)
    unlabeledRooms: true, // fully walled cells with unreadable text still become (blank) rooms
  },
};

export function resolveProfile(p) {
  const base = PROFILES.nmsu;
  if (!p) return { ...base };
  if (typeof p === 'string') return { ...(PROFILES[p] || base) };
  return { ...base, ...p };
}
