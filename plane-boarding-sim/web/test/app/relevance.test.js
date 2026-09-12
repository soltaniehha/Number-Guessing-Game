/** Which controls are live, and why the dead ones are dead. */
import { describe, expect, it } from 'vitest'
import { relevanceOf, optionRelevance, ZONE_STRATEGIES } from '../../src/state/relevance.js'
import { presentControls, SECTIONS, rootKey } from '../../src/app/controlSchema.js'
import { defaults, a320, e175, b777, engine } from './fixtures.js'

const at = (key, patch = {}, aircraft = a320) => relevanceOf(key, { ...defaults, ...patch }, aircraft)

describe('relevance', () => {
  it('zoneCount is live only for zone strategies', () => {
    for (const key of ZONE_STRATEGIES) expect(at('zoneCount', { strategy: key }).relevant).toBe(true)
    const dead = at('zoneCount', { strategy: 'wilma' })
    expect(dead.relevant).toBe(false)
    expect(dead.reason).toMatch(/zone/i)
  })

  it('openSeatingPolicy is live only for open seating', () => {
    expect(at('openSeatingPolicy', { strategy: 'open_seating' }).relevant).toBe(true)
    expect(at('openSeatingPolicy', { strategy: 'random' }).relevant).toBe(false)
  })

  it('eliteMix is dead for strategies that ignore status', () => {
    expect(at('eliteMix', { strategy: 'priority_5tier' }).relevant).toBe(true)
    expect(at('eliteMix', { strategy: 'steffen_perfect' }).relevant).toBe(false)
  })

  it('doorAssignment is dead with a single open door', () => {
    expect(at('doorAssignment', { doors: ['1L'] }).relevant).toBe(false)
    expect(at('doorAssignment', { doors: ['1L', '2L'] }).relevant).toBe(true)
  })

  it('non-compliance drift is dead when nobody is non-compliant', () => {
    expect(at('complianceJitter', { nonComplianceRate: 0 }).relevant).toBe(false)
    expect(at('complianceJitter', { nonComplianceRate: 0.1 }).relevant).toBe(true)
  })

  it('reduced-mobility factors are dead when there are no such passengers', () => {
    expect(at('slowSpeedFactor', { slowPaxRate: 0 }).relevant).toBe(false)
    expect(at('slowStowFactor', { slowPaxRate: 0 }).relevant).toBe(false)
    expect(at('slowStowFactor', { slowPaxRate: 0.05 }).relevant).toBe(true)
  })

  it('preboardFirst is dead when there are no preboards', () => {
    expect(at('preboardFirst', { preboardRate: 0 }).relevant).toBe(false)
  })

  it('party controls are dead when everyone travels alone', () => {
    const solo = { partySizeWeights: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 } }
    expect(at('keepPartiesTogether', solo).relevant).toBe(false)
    expect(at('childRate', solo).relevant).toBe(false)
    expect(at('shuffleSamePartyMovements', solo).relevant).toBe(false)
    expect(at('keepPartiesTogether').relevant).toBe(true)
  })

  it('bag and bin controls are dead when nobody carries a bag', () => {
    const noBags = { bagWeights: { 0: 1, 1: 0, 2: 0 } }
    for (const key of ['stowWeibullScale', 'stowVariability', 'binSearchRadius', 'gateCheckPenalty', 'binCongestionWeight']) {
      expect(at(key, noBags).relevant).toBe(false)
    }
    expect(at('stowWeibullScale').relevant).toBe(true)
  })

  it('the second-bag exponent needs two-bag passengers', () => {
    expect(at('stowBagExponent', { bagWeights: { 0: 0.5, 1: 0.5, 2: 0 } }).relevant).toBe(false)
    expect(at('stowBagExponent', { bagWeights: { 0: 0.2, 1: 0.5, 2: 0.3 } }).relevant).toBe(true)
  })

  it('two-blocker shuffles are dead on a 2-2 regional jet', () => {
    expect(at('shuffleMovements.both', {}, e175).relevant).toBe(false)
    expect(at('shuffleMovements.middle', {}, e175).relevant).toBe(false)
    expect(at('shuffleMovements.aisle', {}, e175).relevant).toBe(true)
    expect(at('shuffleMovements.both', {}, a320).relevant).toBe(true)
  })

  it('unknown keys default to relevant rather than silently disabling', () => {
    expect(at('somethingNew').relevant).toBe(true)
  })

  it('split-by-aisle is offered only on twin-aisle aircraft', () => {
    expect(optionRelevance('doorAssignment', 'split_by_aisle', defaults, a320).relevant).toBe(false)
    expect(optionRelevance('doorAssignment', 'split_by_aisle', defaults, b777).relevant).toBe(true)
    expect(optionRelevance('doorAssignment', 'split_by_row', defaults, a320).relevant).toBe(true)
  })

  it('a disabled control always explains itself', () => {
    for (const section of SECTIONS) {
      for (const control of presentControls(section.id, engine.DEFAULTS)) {
        const r = relevanceOf(control.key, { ...defaults, bagWeights: { 0: 1, 1: 0, 2: 0 } }, e175)
        if (!r.relevant) expect(r.reason.length).toBeGreaterThan(10)
      }
    }
  })
})

describe('control schema', () => {
  it('only offers controls the engine actually has a default for', () => {
    for (const section of SECTIONS) {
      for (const control of presentControls(section.id, engine.DEFAULTS)) {
        // Shell parameters (the aircraft, the strategy, the seed, the doors,
        // the replication count and the sweep) are the shell's own and are
        // marked as such in the schema; everything else must be a real engine
        // parameter.
        const shell =
          control.shell || ['aircraftId', 'strategy', 'seed', 'doors'].includes(control.key)
        if (!shell) expect(engine.DEFAULTS).toHaveProperty(rootKey(control.key))
      }
    }
  })

  it('covers every simulation parameter the engine exposes', () => {
    const covered = new Set(SECTIONS.flatMap((s) => presentControls(s.id, engine.DEFAULTS).map((c) => rootKey(c.key))))
    for (const key of Object.keys(engine.DEFAULTS)) expect(covered.has(key)).toBe(true)
  })

  it('every control has a label and a plain-English explanation', () => {
    for (const section of SECTIONS) {
      for (const control of presentControls(section.id, engine.DEFAULTS)) {
        expect(control.label).toBeTruthy()
        expect(control.explain.length).toBeGreaterThan(25)
      }
    }
  })
})
