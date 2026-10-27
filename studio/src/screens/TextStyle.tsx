import { SAMPLE_LOOK } from '../series'
import { useMemo, useState } from 'react'
import { Field, NumberInput } from '../components'
import { BUNDLED_FONTS, FONT_GROUPS, bundledFontCss } from '../fonts'
import { BUILTIN_FONTS } from '../layoutDefaults'
import { frameSetLabel } from '../frames'
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

type Target = 'all' | (typeof TEXT_FIELDS)[number] | 'psa'
const TARGETS: { id: Target; label: string }[] = [
  { id: 'all', label: 'All lines' }, { id: 'name', label: 'Name' }, { id: 'theme', label: 'Theme' }, { id: 'style', label: 'Art style' },
  { id: 'material', label: 'Type' }, { id: 'category', label: 'Category' }, { id: 'forged', label: 'Series #' }, { id: 'psa', label: 'PDA seal' },
]

/** The text style of one frame set: every line at once ("All lines"), or one line at a time (name, theme, art style,
 *  type, category, Series #, the seal's number): font, colour, outline and size. Positions are fixed (lockPositions). */
export function CardTextStyle({ m, layout, setLayout, sample, onFontToAll }: {
  m: string
  layout: Layout
  setLayout: (f: (l: Layout) => Layout) => void
  sample: string
  onFontToAll: (css: string) => void
}) {
  const [target, setTarget] = useState<Target>('all')
  const st = target === 'all' ? layout.text.name.style : target === 'psa' ? layout.psa.style : layout.text[target].style
  const mixed = TEXT_FIELDS.some((f) => layout.text[f].style.font !== layout.text.name.style.font)
    || TEXT_FIELDS.some((f) => layout.text[f].style.color !== layout.text.name.style.color)
  const set = (patch: Partial<typeof st>) => setLayout((l) => {
    if (target === 'psa') return { ...l, psa: { ...l.psa, style: { ...l.psa.style, ...patch } } }
    const fields = target === 'all' ? TEXT_FIELDS : [target]
    return {
      ...l,
      text: { ...l.text, ...Object.fromEntries(fields.map((f) => [f, { ...l.text[f], style: { ...l.text[f].style, ...patch } }])) } as Layout['text'],
      // "All lines" also puts the font on the seal
      psa: target === 'all' && patch.font ? { ...l.psa, style: { ...l.psa.style, font: patch.font } } : l.psa,
    }
  })
  const sampleFor: Record<Target, string> = {
    all: sample, name: sample, theme: SAMPLE_LOOK.theme, style: SAMPLE_LOOK.style, material: frameSetLabel(m).toUpperCase(), category: 'Category',
    forged: 'Series 1', psa: '7',
  }
  return (
    <div className="text-style" data-testid="card-text-style">
      <h4>{frameSetLabel(m)} card text</h4>
      <div className="font-groups" data-testid="text-target">
        {TARGETS.map((t) => <button key={t.id} className={t.id === target ? 'active' : ''} onClick={() => setTarget(t.id)} data-testid={`target-${t.id}`}>{t.label}</button>)}
      </div>
      <p className="muted small">
        {target === 'all'
          ? `Every line on ${frameSetLabel(m)} cards at once (the font also goes on the PDA seal).${mixed ? ' The lines differ right now; picking here makes them match.' : ''}`
          : `Only the ${TARGETS.find((t) => t.id === target)!.label.toLowerCase()} on ${frameSetLabel(m)} cards.`}
      </p>
      <FontPicker value={st.font} sample={sampleFor[target]} onPick={(css) => set({ font: css })} />
      <div className="row wrap">
        <Field label="Text colour"><input type="color" value={st.color} onChange={(e) => set({ color: e.target.value })} data-testid="text-color" /></Field>
        {target !== 'psa' && <Field label="Outline colour"><input type="color" value={st.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} /></Field>}
        {target !== 'psa' && <Field label="Outline width"><NumberInput min={0} value={st.outlineWidth} onChange={(n) => set({ outlineWidth: Math.max(0, n) })} /></Field>}
        {target !== 'all' && target !== 'psa' && <Field label="Size" hint="shrinks to fit"><NumberInput min={8} value={st.size} onChange={(n) => set({ size: Math.max(8, n) })} /></Field>}
        {target === 'all' && <button onClick={() => onFontToAll(st.font)} data-testid="font-to-all">Use this font on all materials</button>}
      </div>
    </div>
  )
}
