/**
 * The control panel: every simulation parameter, in seven collapsible
 * sections, each control showing its live value and what it physically means.
 */
import { useStore } from '../state/StoreProvider.jsx'
import { relevanceOf, optionRelevance } from '../state/relevance.js'
import {
  describeBatchCost,
  describeSweepCost,
  runCounts,
  sweepAxesFor,
  sweepAxis,
  sweepParamOf,
  sweepPointsOf,
  sweepSpecFor,
  sweepValuesKey,
} from '../state/sweep.js'
import { SECTIONS, autoValueOf, presentControls, rootKey } from './controlSchema.js'
import { getPath, setPath } from '../lib/path.js'
import { Section } from './Section.jsx'
import { Slider } from './controls/Slider.jsx'
import { NullableSlider } from './controls/NullableSlider.jsx'
import { Toggle } from './controls/Toggle.jsx'
import { Segmented } from './controls/Segmented.jsx'
import { WeightSet } from './controls/WeightSet.jsx'
import { SeedField } from './controls/SeedField.jsx'
import { DoorPicker } from './controls/DoorPicker.jsx'
import { AircraftPicker } from './controls/AircraftPicker.jsx'
import { SweepPointSet } from './controls/SweepPointSet.jsx'
import { SweepParamPicker } from './controls/SweepParamPicker.jsx'
import { StrategyPicker } from './controls/StrategyPicker.jsx'
import { PresetSection } from './PresetSection.jsx'

export function ControlPanel() {
  const store = useStore()
  const { config, defaults, aircraft, mode, openSections, toggleSection } = store

  return (
    <div className="panel">
      <div className="panel__scroll">
        {SECTIONS.map((section) => {
          if (section.id === 'presets') {
            return (
              <Section
                key={section.id}
                id={section.id}
                title={section.title}
                hint={section.hint}
                open={Boolean(openSections[section.id])}
                onToggle={toggleSection}
              >
                <PresetSection />
              </Section>
            )
          }
          const controls = presentControls(section.id, defaults, mode)
          if (controls.length === 0) return null
          return (
            <Section
              key={section.id}
              id={section.id}
              title={section.title}
              hint={section.hint}
              badge={sectionBadge(section.id, config, aircraft)}
              open={Boolean(openSections[section.id])}
              onToggle={toggleSection}
            >
              {controls.map((control) => (
                <Control key={control.key} control={control} store={store} />
              ))}
              {section.id === 'scenario' && mode !== 'cabin' && <RunCost store={store} />}
            </Section>
          )
        })}
      </div>
    </div>
  )
}

/** A one-glance summary shown on the collapsed section header. */
function sectionBadge(sectionId, config, aircraft) {
  switch (sectionId) {
    case 'scenario':
      return `${Math.round((config.loadFactor || 0) * 100)}%`
    case 'doors': {
      // Boarding doors only: the badge counts what the picker offers, not the
      // service doors and overwing exits nobody can board through.
      const boardable = (aircraft?.doors || []).filter((d) => d.boardable !== false).length
      return `${(config.doors || []).length}/${boardable}`
    }
    case 'behaviour':
      return `${Math.round((config.nonComplianceRate || 0) * 100)}%`
    default:
      return null
  }
}

/**
 * What pressing Run will actually cost, before it is pressed.
 *
 * A sweep is a second axis on an already-large batch, so the arithmetic is
 * spelled out rather than discovered halfway through a five-minute run.
 */
function RunCost({ store }) {
  const { config, mode, engine } = store
  const list = mode === 'compare' ? config.compareStrategies || [] : [config.strategy]
  const sweep = sweepSpecFor(config, mode, engine?.SWEEPABLE)
  const counts = runCounts({ strategies: list.length, runs: config.runs, sweep })
  return (
    <div className="runcost" role="note" aria-label="Run size">
      <p className="runcost__line num">{describeBatchCost(counts)}</p>
      {sweep && <p className="runcost__line num">{describeSweepCost(counts)}</p>}
      {sweep && (
        <p className="runcost__total num">
          {counts.total.toLocaleString('en-GB')} runs in total
        </p>
      )}
    </div>
  )
}

/** "The airframe just set this for you", said where the value changed. */
function AirframeNote({ note, controlKey }) {
  if (!note || !note.keys.includes(controlKey)) return null
  return (
    <p className="field__help field__help--airframe" role="note">
      Set by the {note.aircraftName}. Change it and it stays changed.
    </p>
  )
}

function Control({ control, store }) {
  const { config, aircraft, engine, setField, toggleDoor, randomiseSeed, strategies, aircraftList, airframeNote } =
    store
  const id = `ctl-${control.key.replace(/\./g, '-')}`
  const value = getPath(config, control.key)
  const { relevant, reason } = relevanceOf(control.key, config, aircraft)
  const disabled = !relevant
  const note = <AirframeNote note={airframeNote} controlKey={rootKey(control.key)} />

  // Dotted keys write back through the nested object they belong to.
  const commit = (next) => {
    const root = rootKey(control.key)
    if (root === control.key) setField(root, next)
    else setField(root, getPath(setPath(config, control.key, next), root))
  }

  switch (control.kind) {
    case 'aircraft':
      return (
        <AircraftPicker
          id={id}
          label={control.label}
          explain={control.explain}
          value={value}
          aircraftList={aircraftList}
          onChange={(v) => setField('aircraftId', v)}
        />
      )

    case 'strategy':
      return (
        <StrategyPicker
          id={id}
          label={control.label}
          explain={control.explain}
          value={value}
          strategies={strategies}
          onChange={(v) => setField('strategy', v)}
        />
      )

    case 'seed':
      return (
        <SeedField
          id={id}
          label={control.label}
          explain={control.explain}
          value={value}
          onChange={(v) => setField('seed', v)}
          onRandomise={randomiseSeed}
        />
      )

    case 'doors':
      return (
        <DoorPicker
          id={id}
          label={control.label}
          explain={control.explain}
          aircraft={aircraft}
          enabled={config.doors || []}
          onToggle={toggleDoor}
        />
      )

    case 'toggle':
      return (
        <Toggle
          id={id}
          label={control.label}
          explain={control.explain}
          value={value}
          disabled={disabled}
          reason={reason}
          onChange={commit}
        />
      )

    case 'segmented':
      return (
        <Segmented
          id={id}
          label={control.label}
          explain={control.explain}
          value={value}
          disabled={disabled}
          reason={reason}
          options={control.options.map((opt) => {
            const r = optionRelevance(control.key, opt.value, config, aircraft)
            return { ...opt, disabled: !r.relevant, reason: r.reason }
          })}
          onChange={commit}
        />
      )

    case 'weights':
      return (
        <>
          <WeightSet
            id={id}
            label={control.label}
            explain={control.explain}
            value={value}
            keys={control.keys}
            keyLabels={control.keyLabels}
            disabled={disabled}
            reason={reason}
            onChange={commit}
          />
          {note}
        </>
      )

    // The sweep axis, and the points on it. Both read the engine's SWEEPABLE
    // map rather than a list of their own, and the points are written to
    // whichever config key that axis owns (state/sweep.js `sweepValuesKey`).
    case 'sweep-param':
      return (
        <SweepParamPicker
          id={id}
          label={control.label}
          explain={control.explain}
          value={sweepParamOf(config, engine?.SWEEPABLE)}
          axes={sweepAxesFor(engine?.SWEEPABLE)}
          disabled={disabled}
          reason={reason}
          onChange={(v) => setField('sweepParam', v)}
        />
      )

    case 'sweep-points': {
      const param = sweepParamOf(config, engine?.SWEEPABLE)
      const axis = sweepAxis(param)
      return (
        <SweepPointSet
          id={id}
          label={control.label}
          explain={control.explain}
          value={sweepPointsOf(config, engine?.SWEEPABLE)}
          points={axis.points}
          format={axis.format}
          disabled={disabled}
          reason={reason}
          onChange={(next) => setField(sweepValuesKey(param), next)}
        />
      )
    }

    case 'nullable-slider':
      return (
        <NullableSlider
          id={id}
          label={control.label}
          explain={control.explain}
          value={value}
          autoValue={autoValueOf(control, { aircraft, config })}
          autoLabel={control.autoLabel}
          autoSpoken={control.autoSpoken}
          min={control.min}
          max={control.max}
          step={control.step}
          format={control.format}
          announce={control.announce}
          disabled={disabled}
          reason={reason}
          onChange={commit}
        />
      )

    case 'slider':
    default:
      return (
        <>
          <Slider
            id={id}
            label={control.label}
            explain={control.explain}
            value={value}
            min={control.min}
            max={control.max}
            step={control.step}
            format={control.format}
            announce={control.announce}
            disabled={disabled}
            reason={reason}
            onChange={commit}
          />
          {note}
        </>
      )
  }
}
