import { FRAME_GEOMETRY, artBoxOf } from './frames'
import { TEXT_FIELDS, type Layout, type PsaBox, type Rect, type TextBox, type TextStyle } from './types'

/** Built-in font choices: web-safe stacks only (no Google Fonts, nothing fetched). Uploaded fonts are added on top. */
export const BUILTIN_FONTS: { label: string; css: string }[] = [
  { label: 'Georgia (serif)', css: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { label: 'Arial / Helvetica', css: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', css: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { label: 'Impact', css: 'Impact, "Arial Black", "Franklin Gothic Bold", sans-serif' },
  { label: 'Courier New (mono)', css: '"Courier New", Courier, monospace' },
  { label: 'System UI', css: 'system-ui, "Segoe UI", Roboto, sans-serif' },
]

/** Layouts saved before the built-in frames existed were made for placeholder frames; they are replaced by the
 *  defaults below. Bump when the default layout changes in a way old saved layouts must not keep. */
export const LAYOUT_VERSION = 5

/** Text colours per frame: Paper, Wood and Diamond have light panels (dark ink); Burning and Coal have dark panels
 *  (light ink). `window` fills the art window behind keyed art. */
/** `seal` = the PDA seal's light and dark colours and its text colour, matched to each frame: pencil graphite on
 *  Paper, walnut on Wood, ember on Fire, black and silver on Coal, icy crystal on Diamond. */
const INK: Record<string, { color: string; outline: string; outlineWidth: number; window: string; seal: [string, string, string] }> = {
  paper: { color: '#2b2622', outline: '#ffffff', outlineWidth: 0, window: '#f4f0e6', seal: ['#8a8a8a', '#2f2f31', '#f3efe6'] },
  wood: { color: '#3a2412', outline: '#ffffff', outlineWidth: 0, window: '#f1e4cc', seal: ['#9a6230', '#4a2810', '#f6e2c0'] },
  burning: { color: '#ffe9c4', outline: '#1a0904', outlineWidth: 5, window: '#24100a', seal: ['#f08a2a', '#7a1606', '#fff1d6'] },
  charcoal: { color: '#ececf0', outline: '#0e0e10', outlineWidth: 4, window: '#26262a', seal: ['#8a8b93', '#2c2c31', '#f2f3f6'] },
  diamond: { color: '#12324a', outline: '#ffffff', outlineWidth: 0, window: '#eef6fb', seal: ['#f4fbff', '#9cc0d8', '#12324a'] },
  // Gold: dark ink on gold leaf. Full Art: dark ink with a light outline, over the art's own light name and info boxes
  gold: { color: '#3a2606', outline: '#fff4d0', outlineWidth: 0, window: '#f5e3a8', seal: ['#f7d774', '#8a5a10', '#3a2606'] },
  fullart: { color: '#1a1410', outline: '#fff7e8', outlineWidth: 5, window: '#1d1d22', seal: ['#f7d774', '#8a5a10', '#3a2606'] },
}

/** A frame set the studio has no colours for yet (a new set built by clean_frames.py): light text with a dark
 *  outline reads on any panel; set its real colours in Frames & Layout. */
const NEUTRAL_INK = { color: '#fff7e8', outline: '#1a1410', outlineWidth: 5, window: '#1d1d22', seal: ['#d9b25a', '#5a3d10', '#fff6e0'] as [string, string, string] }

function style(over: Partial<TextStyle>): TextStyle {
  return {
    font: BUILTIN_FONTS[0].css, bold: true, italic: false, size: 80, minSize: 24, color: '#ffffff',
    outlineColor: '#000000', outlineWidth: 6, align: 'left', uppercase: false, ...over,
  }
}

function tb(box: Rect, over: Partial<TextStyle>): TextBox {
  return { box, style: style(over), visible: true }
}

/** Frame sets whose name bar isn't where the shared FRAME_GEOMETRY puts it. Gold is drawn smaller inside its canvas
 *  (y 88-2008 of 2100), so its name bar sits lower: y 144-268. */
const NAME_BAR: Record<string, Rect> = {
  gold: { x: 150, y: 150, w: 1200, h: 112 },
}

/** The default layout of a frame set (layouts are per frame set; every card type using the set shares it). */
export function defaultLayout(material: string): Layout {
  const ink = INK[material] ?? NEUTRAL_INK
  const c = { color: ink.color, outlineColor: ink.outline, outlineWidth: ink.outlineWidth }
  const g = FRAME_GEOMETRY
  const info = g.infoText
  const textW = 780
  const psa: PsaBox = {
    // the seal: a 236 px circle centred at (1170, 1815); fill/border are its light/dark wax colours
    ...tb({ x: 1052, y: 1697, w: 236, h: 236 }, { size: 112, minSize: 24, color: ink.seal[2], outlineWidth: 0, align: 'center' }),
    fill: ink.seal[0], border: ink.seal[1], borderWidth: 0, radius: 0,
  }
  return {
    material,
    version: LAYOUT_VERSION,
    layering: 'art-behind',
    art: { box: artBoxOf(material), fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, background: ink.window },
    text: {
      name: tb({ ...(NAME_BAR[material] ?? g.nameBar) }, { ...c, size: 104, align: 'center' }),
      material: tb({ x: info.x, y: info.y + 4, w: textW, h: 110 }, { ...c, size: 96, uppercase: true }),
      category: tb({ x: info.x, y: info.y + 118, w: textW, h: 66 }, { ...c, size: 58, bold: false }),
      forged: tb({ x: info.x, y: info.y + 186, w: textW, h: 58 }, { ...c, size: 48, bold: false, italic: true }),
    },
    psa,
    updatedAt: 0,
  }
}

/** Fill in any field missing from a stored layout (forward compatibility). */
export function normalizeLayout(material: string, stored: Partial<Layout> | undefined): Layout {
  const d = defaultLayout(material)
  if (!stored || !stored.version || stored.version < 2 || stored.version > LAYOUT_VERSION) return d
  // v2 -> v3: the PDA badge became the seal; keep every other saved setting
  if (stored.version === 2) stored = { ...stored, psa: d.psa }
  // v3 -> v4: a 4th line (Forged · Series #) joined the bottom panel; the bottom boxes and sizes move to make room,
  // fonts and colours stay
  if ((stored.version ?? 0) < 4 && stored.text) {
    const t = { ...stored.text }
    for (const f of ['material', 'category'] as const) {
      const st = t[f]
      if (st) t[f] = { ...st, box: { ...d.text[f].box }, style: { ...st.style, size: d.text[f].style.size } }
    }
    const font = t.name?.style.font
    t.forged = { ...d.text.forged, style: { ...d.text.forged.style, ...(font ? { font, color: t.category?.style.color ?? d.text.forged.style.color } : {}) } }
    stored = { ...stored, text: t }
  }
  // v4 -> v5: Gold's name box moved onto Gold's own name bar
  if ((stored.version ?? 0) < 5 && NAME_BAR[material] && stored.text?.name) {
    stored = { ...stored, text: { ...stored.text, name: { ...stored.text.name, box: { ...d.text.name.box } } } }
  }
  return {
    ...d,
    ...stored,
    material,
    version: LAYOUT_VERSION,
    // the frames are fixed, so the art window and layering are too
    layering: 'art-behind',
    art: { ...d.art, ...stored.art, box: artBoxOf(material) },
    text: Object.fromEntries(TEXT_FIELDS.map((f) => {
      const st = stored.text?.[f]
      return [f, { ...d.text[f], ...st, style: { ...d.text[f].style, ...st?.style } }]
    })) as Layout['text'],
    psa: { ...d.psa, ...stored.psa, style: { ...d.psa.style, ...stored.psa?.style } },
  }
}
