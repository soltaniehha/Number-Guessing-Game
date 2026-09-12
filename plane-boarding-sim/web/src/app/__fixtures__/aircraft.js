/**
 * Fixture aircraft catalogue. Shapes match ENGINE_SPEC section 2; the real
 * catalogue lives in `src/sim/index.js` and replaces this at integration.
 */
import { resolveAircraftSpec } from './geometry.js'

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const skip13 = (rows) => rows.filter((r) => r !== 13)

const SPECS = [
  {
    id: 'a320neo',
    name: 'A320neo',
    manufacturer: 'Airbus',
    description: 'US legacy narrowbody: 12 domestic first seats ahead of a 3-3 main cabin.',
    seatPitchIn: 31,
    aisleCount: 1,
    binBagsPerRowSide: 4,
    cabins: [
      { id: 'first', name: 'Domestic First', classKey: 'first', rows: range(1, 3), layout: ['A', 'B', '|', 'C', 'D'], pitchIn: 37, exitRows: [], missingSeats: [] },
      { id: 'economy', name: 'Main Cabin', classKey: 'economy', rows: skip13(range(6, 32)), layout: ['A', 'B', 'C', '|', 'D', 'E', 'F'], pitchIn: 31, exitRows: [11, 12], missingSeats: [] },
    ],
    doors: [
      { id: '1L', name: 'Door 1L (forward)', rowBefore: 1, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: true },
      { id: '2L', name: 'Door 2L (aft)', rowBefore: null, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: false },
    ],
  },
  {
    id: 'b737-8200',
    name: '737-8200',
    manufacturer: 'Boeing',
    description: 'High-density European LCC MAX: 197 seats, single class, both airstairs in use.',
    seatPitchIn: 29,
    aisleCount: 1,
    binBagsPerRowSide: 3,
    cabins: [
      { id: 'economy', name: 'Economy', classKey: 'economy', rows: range(1, 33), layout: ['A', 'B', 'C', '|', 'D', 'E', 'F'], pitchIn: 29, exitRows: [16, 17], missingSeats: [] },
    ],
    doors: [
      { id: '1L', name: 'Door 1L (forward airstair)', rowBefore: 1, aisleIndex: 0, kind: 'airstair', defaultEnabled: true },
      { id: '2L', name: 'Door 2L (aft airstair)', rowBefore: null, aisleIndex: 0, kind: 'airstair', defaultEnabled: true },
    ],
  },
  {
    id: 'b737-800',
    name: '737-800',
    manufacturer: 'Boeing',
    description: 'The open-seating workhorse: 175 seats, one cabin, single jet-bridge.',
    seatPitchIn: 31,
    aisleCount: 1,
    binBagsPerRowSide: 4,
    cabins: [
      { id: 'economy', name: 'Cabin', classKey: 'economy', rows: range(1, 30), layout: ['A', 'B', 'C', '|', 'D', 'E', 'F'], pitchIn: 31, exitRows: [15, 16], missingSeats: [] },
    ],
    doors: [
      { id: '1L', name: 'Door 1L (forward)', rowBefore: 1, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: true },
      { id: '2L', name: 'Door 2L (aft)', rowBefore: null, aisleIndex: 0, kind: 'airstair', defaultEnabled: false },
    ],
  },
  {
    id: 'e175',
    name: 'E175',
    manufacturer: 'Embraer',
    description: 'Regional jet: 2-2 cabin, so nobody is ever more than one seat from the aisle.',
    seatPitchIn: 31,
    aisleCount: 1,
    binBagsPerRowSide: 2,
    cabins: [
      { id: 'first', name: 'First', classKey: 'first', rows: range(1, 3), layout: ['A', '|', 'C', 'D'], pitchIn: 37, exitRows: [], missingSeats: [] },
      { id: 'economy', name: 'Main Cabin', classKey: 'economy', rows: range(4, 20), layout: ['A', 'B', '|', 'C', 'D'], pitchIn: 31, exitRows: [12], missingSeats: [] },
    ],
    doors: [
      { id: '1L', name: 'Door 1L (forward)', rowBefore: 1, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: true },
    ],
  },
  {
    id: 'b777-300er',
    name: '777-300ER',
    manufacturer: 'Boeing',
    description: 'Twin-aisle long-haul: 3-4-3 economy behind a 1-2-1 business cabin.',
    seatPitchIn: 32,
    aisleCount: 2,
    binBagsPerRowSide: 5,
    cabins: [
      { id: 'business', name: 'Business', classKey: 'business', rows: range(1, 10), layout: ['A', '|', 'D', 'G', '|', 'K'], pitchIn: 78, exitRows: [], missingSeats: [] },
      { id: 'premium', name: 'Premium Economy', classKey: 'premium', rows: range(20, 24), layout: ['A', 'C', '|', 'D', 'E', 'F', 'G', '|', 'H', 'K'], pitchIn: 38, exitRows: [], missingSeats: [] },
      { id: 'economy', name: 'Economy', classKey: 'economy', rows: range(30, 58), layout: ['A', 'B', 'C', '|', 'D', 'E', 'F', 'G', '|', 'H', 'J', 'K'], pitchIn: 32, exitRows: [44, 45], missingSeats: [] },
    ],
    doors: [
      { id: '1L', name: 'Door 1L (forward)', rowBefore: 1, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: true },
      { id: '2L', name: 'Door 2L (mid-forward)', rowBefore: 30, aisleIndex: 1, kind: 'jetbridge', defaultEnabled: true },
      { id: '3L', name: 'Door 3L (mid-aft)', rowBefore: 46, aisleIndex: 1, kind: 'jetbridge', defaultEnabled: false },
      { id: '4L', name: 'Door 4L (aft)', rowBefore: null, aisleIndex: 0, kind: 'jetbridge', defaultEnabled: false },
    ],
  },
]

/** @type {Record<string, object>} resolved aircraft keyed by id */
export const AIRCRAFT = Object.fromEntries(SPECS.map((s) => [s.id, resolveAircraftSpec(s)]))

export function resolveAircraft(id) {
  return AIRCRAFT[id] || AIRCRAFT[SPECS[0].id]
}
