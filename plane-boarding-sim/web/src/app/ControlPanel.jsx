/**
 * The control panel: every simulation parameter, in seven collapsible
 * sections, each control showing its live value and what it physically means.
 */
import { useStore } from '../state/StoreProvider.jsx'
import { relevanceOf, optionRelevance } from '../state/relevance.js'
import { SECTIONS, presentControls, rootKey } from './controlSchema.js'
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
import { StrategyPicker } from './controls/StrategyPicker.jsx'
import { PresetSection } from './PresetSection.jsx'

export function ControlPanel() {
  const store = useStore()
  const { config, defaults, aircraft, openSections, toggleSection } = store

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
          const controls = presentControls(section.id, defaults)
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
    case 'doors':
      return `${(config.doors || []).length}/${(aircraft?.doors || []).length}`
    case 'behaviour':
      return `${Math.round((config.nonComplianceRate || 0) * 100)}%`
    default:
      return null
  }
}

function Control({ control, store }) {
  const { config, aircraft, setField, toggleDoor, randomiseSeed, strategies, aircraftList } = store
  const id = `ctl-${control.key.replace(/\./g, '-')}`
  const value = getPath(config, control.key)
  const { relevant, reason } = relevanceOf(control.key, config, aircraft)
  const disabled = !relevant

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
      )

    case 'nullable-slider':
      return (
        <NullableSlider
          id={id}
          label={control.label}
          explain={control.explain}
          value={value}
          autoValue={aircraft?.binBagsPerRowSide ?? control.min}
          autoLabel={control.autoLabel}
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
      )
  }
}
