import { useMemo, useState } from 'react'
import { Field, NumberInput } from '../components'
import { BUNDLED_FONTS, FONT_GROUPS, bundledFontCss } from '../fonts'
import { BUILTIN_FONTS } from '../layoutDefaults'
import { MATERIAL_LABEL, type Material } from '../rules'
import { fontFamilyCss, useStudio } from '../store'
import { TEXT_FIELDS, type Layout } from '../types'

interface FontOption { label: string; css: string; group: string }

/** Every font the studio can use: bundled, system and uploaded. */
export function useFontOptions(): FontOption[] {
  const s = useStudio()
  return useMemo(() => [
    ...BUNDLED_FONTS.map((f) => ({ label: f.family, css: bundledFontCss(f), group: f.group as string })),
    ...BUILTIN_FONTS.map((f) => ({ label: f.label, css: f.css, group: 'System' })),
    ...s.fonts.map((f) => ({ label: f.fileName, css: fontFamilyCss(f), group: 'Uploaded' })),
  ], [s.fonts])
}

/** Font tiles that show the sample text in each font, with group tabs and a search box. */
export function FontPicker({ value, sample, onPick }: { value: string; sample: string; onPick: (css: string) => void }) {
  const options = useFontOptions()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string>('All')
  const groups = ['All', ...FONT_GROUPS, 'System', ...(options.some((o) => o.group === 'Uploaded') ? ['Uploaded'] : [])]
  const shown = options.filter((o) => (group === 'All' || o.group === group) && o.label.toLowerCase().includes(q.trim().toLowerCase()))
  const current = options.find((o) => o.css === value)
  return (
    <div className="font-picker" data-testid="font-picker">
      <div className="row wrap">
        <input className="font-search" placeholder="Search fonts" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">Current: <b style={{ fontFamily: value }}>{current?.label ?? value}</b></span>
      </div>
      <div className="font-groups">
        {groups.map((g) => <button key={g} className={g === group ? 'active' : ''} onClick={() => setGroup(g)}>{g}</button>)}
      </div>
      <div className="font-grid">
        {shown.map((o) => (
          <button key={o.css} className={`font-tile ${o.css === value ? 'active' : ''}`} onClick={() => onPick(o.css)} title={o.label} data-testid={`font-${o.label}`}>
            <span className="font-sample" style={{ fontFamily: o.css }}>{sample || 'Rabbit'}</span>
            <span className="font-name">{o.label}</span>
          </button>
        ))}
        {!shown.length && <span className="muted small">No fonts match.</span>}
      </div>
    </div>
  )
}

/** One text style per material: the font and colours of every piece of text on that material's cards. */
export function CardTextStyle({ m, layout, setLayout, sample, onFontToAll }: {
  m: Material
  layout: Layout
  setLayout: (f: (l: Layout) => Layout) => void
  sample: string
  onFontToAll: (css: string) => void
}) {
  const st = layout.text.name.style
  const mixed = TEXT_FIELDS.some((f) => layout.text[f].style.font !== st.font)
    || TEXT_FIELDS.some((f) => layout.text[f].style.color !== st.color)
  const setAll = (patch: Partial<typeof st>, psaFont = false) => setLayout((l) => ({
    ...l,
    text: Object.fromEntries(TEXT_FIELDS.map((f) => [f, { ...l.text[f], style: { ...l.text[f].style, ...patch } }])) as Layout['text'],
    psa: psaFont && patch.font ? { ...l.psa, style: { ...l.psa.style, font: patch.font } } : l.psa,
  }))
  return (
    <div className="text-style" data-testid="card-text-style">
      <h4>{MATERIAL_LABEL[m]} card text</h4>
      <p className="muted small">Applies to the name, material and category on every {MATERIAL_LABEL[m]} card (the font also goes on the PSA badge).{mixed ? ' The fields differ right now; picking here makes them match.' : ''}</p>
      <FontPicker value={st.font} sample={sample} onPick={(css) => setAll({ font: css }, true)} />
      <div className="row wrap">
        <Field label="Text colour"><input type="color" value={st.color} onChange={(e) => setAll({ color: e.target.value })} data-testid="text-color" /></Field>
        <Field label="Outline colour"><input type="color" value={st.outlineColor} onChange={(e) => setAll({ outlineColor: e.target.value })} /></Field>
        <Field label="Outline width"><NumberInput min={0} value={st.outlineWidth} onChange={(n) => setAll({ outlineWidth: Math.max(0, n) })} /></Field>
        <button onClick={() => onFontToAll(st.font)} data-testid="font-to-all">Use this font on all materials</button>
      </div>
    </div>
  )
}
