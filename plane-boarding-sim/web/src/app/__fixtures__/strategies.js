/**
 * Fixture strategy catalogue — key, name, family and the one-paragraph
 * description shown under the strategy picker. Text is condensed from
 * docs/STRATEGIES.md. Superseded by `STRATEGIES` from `src/sim/index.js`.
 */
export const STRATEGIES = {
  random: {
    key: 'random',
    name: 'Random / free-for-all',
    family: 'baseline',
    description:
      'Everyone boards in a full shuffle. The literature’s inconvenient baseline: it beats most zone schemes because it spreads passengers naturally along the aisle.',
  },
  back_to_front: {
    key: 'back_to_front',
    name: 'Back-to-front zones',
    family: 'zone',
    description:
      'Contiguous row bands called rearmost first, random within each band. Intuitive, and reliably among the worst: it concentrates everyone into one short stretch of aisle at a time.',
  },
  front_to_back: {
    key: 'front_to_back',
    name: 'Front-to-back zones',
    family: 'zone',
    description:
      'The same bands called foremost first. The pathological control case — every later passenger has to walk past every earlier one.',
  },
  wilma: {
    key: 'wilma',
    name: 'WilMA (outside-in)',
    family: 'outside-in',
    description:
      'All windows, then all middles, then all aisles, random within each wave. Eliminates seat-shuffle interference by construction. United’s current scheme.',
  },
  wilma_zoned: {
    key: 'wilma_zoned',
    name: 'WilMA + zones',
    family: 'outside-in',
    description:
      'Outside-in, and within each seat-column band, rear-to-front by zone. Adds aisle spreading to WilMA and usually beats it slightly.',
  },
  steffen_perfect: {
    key: 'steffen_perfect',
    name: 'Steffen (perfect)',
    family: 'optimal',
    description:
      'Adjacent boarders are always two rows apart, so many people stow at once. The theoretical optimum — and it needs perfect passenger compliance, which is why no airline runs it.',
  },
  steffen_modified: {
    key: 'steffen_modified',
    name: 'Steffen (modified)',
    family: 'optimal',
    description:
      'Four gate-callable groups: even rows left, even right, odd left, odd right, window first inside each. Captures most of the perfect method’s benefit while being announceable at a gate.',
  },
  reverse_pyramid: {
    key: 'reverse_pyramid',
    name: 'Reverse pyramid',
    family: 'hybrid',
    description:
      'A diagonal wave from rear-window toward front-aisle, blending outside-in with back-to-front. Flown by America West; in most studies it lands between WilMA and Steffen.',
  },
  rotating_zone: {
    key: 'rotating_zone',
    name: 'Rotating zone',
    family: 'zone',
    description:
      'Alternates rearmost band, foremost band, second-rearmost, second-foremost, so the two flows interleave instead of queueing behind one another.',
  },
  block_boarding: {
    key: 'block_boarding',
    name: 'Block boarding (classic zones)',
    family: 'zone',
    description:
      'The plain vanilla airline scheme: premium cabin first, then contiguous zone blocks rear to front, random within each.',
  },
  open_seating: {
    key: 'open_seating',
    name: 'Open seating',
    family: 'open',
    description:
      'No assigned seats. The queue is check-in position with elites pulled forward, and each passenger picks a seat on entering the cabin. Surprisingly fast, because people self-select to avoid each other.',
  },
  priority_5tier: {
    key: 'priority_5tier',
    name: '5-tier priority (revenue)',
    family: 'commercial',
    description:
      'The realistic modern scheme: preboards, premium cabin and top elites, mid elites, then groups 3, 4 and basic economy last. It sells position rather than optimising flow — it has no spatial logic at all.',
  },
  common_sense_5tier: {
    key: 'common_sense_5tier',
    name: '5-tier common sense',
    family: 'commercial',
    description:
      'The best boarding you could actually sell: premium cabin stays first, then five printable groups that quantise the reverse pyramid — rear windows, front windows plus rear middles, and so on. Elites board at the front of their group, not ahead of everyone.',
  },
  southwest_2026: {
    key: 'southwest_2026',
    name: 'Southwest 2026 (WilMA × zones + status, 8 groups)',
    family: 'commercial',
    description:
      'The real converged design: Southwest replaced 53 years of open seating on 27 January 2026 with window/middle/aisle boarded rear-to-front, merged with fare and Rapid Rewards status into eight numbered groups. Live on roughly 4,000 flights a day, which makes it the benchmark any proposal has to beat.',
  },
  by_bags: {
    key: 'by_bags',
    name: 'Bag-count boarding',
    family: 'experimental',
    description:
      'Zero-bag passengers first, then one bag, then two. Tests the “the bags are the bottleneck” hypothesis directly.',
  },
  slowest_first: {
    key: 'slowest_first',
    name: 'Slowest first',
    family: 'experimental',
    description:
      'Sorted by expected service time descending. The theory: start the slow stows early and let fast passengers fill in behind them.',
  },
}

export const STRATEGY_FAMILIES = {
  baseline: 'Baseline',
  zone: 'Zones',
  'outside-in': 'Outside-in',
  optimal: 'Optimal',
  hybrid: 'Hybrid',
  commercial: 'Commercial',
  open: 'Open seating',
  experimental: 'Experimental',
}
