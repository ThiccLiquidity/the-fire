import type { Material } from './rules'
import { FRAME_GEOMETRY } from './frames'
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
export const LAYOUT_VERSION = 2

/** Text colours per frame: Paper, Wood and Diamond have light panels (dark ink); Burning and Charcoal have dark panels
 *  (light ink). `window` fills the art window behind keyed art. */
const INK: Record<Material, { color: string; outline: string; outlineWidth: number; window: string }> = {
  paper: { color: '#2b2622', outline: '#ffffff', outlineWidth: 0, window: '#f4f0e6' },
  wood: { color: '#3a2412', outline: '#ffffff', outlineWidth: 0, window: '#f1e4cc' },
  burning: { color: '#ffe9c4', outline: '#1a0904', outlineWidth: 5, window: '#24100a' },
  charcoal: { color: '#ececf0', outline: '#0e0e10', outlineWidth: 4, window: '#26262a' },
  diamond: { color: '#12324a', outline: '#ffffff', outlineWidth: 0, window: '#eef6fb' },
}

function style(over: Partial<TextStyle>): TextStyle {
  return {
    font: BUILTIN_FONTS[0].css, bold: true, italic: false, size: 80, minSize: 24, color: '#ffffff',
    outlineColor: '#000000', outlineWidth: 6, align: 'left', uppercase: false, ...over,
  }
}

function tb(box: Rect, over: Partial<TextStyle>): TextBox {
  return { box, style: style(over), visible: true }
}

export function defaultLayout(material: Material): Layout {
  const ink = INK[material]
  const c = { color: ink.color, outlineColor: ink.outline, outlineWidth: ink.outlineWidth }
  const g = FRAME_GEOMETRY
  const info = g.infoText
  const textW = 780
  const psa: PsaBox = {
    ...tb({ x: info.x + info.w - 260, y: info.y + 15, w: 260, h: 220 }, { size: 80, minSize: 30, color: '#1a1a1a', outlineWidth: 0, align: 'center', font: BUILTIN_FONTS[2].css }),
    fill: '#f4efe4', border: '#1a1a1a', borderWidth: 6, radius: 22,
  }
  return {
    material,
    version: LAYOUT_VERSION,
    layering: 'art-behind',
    art: { box: { ...g.art }, fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, background: ink.window },
    text: {
      name: tb({ ...g.nameBar }, { ...c, size: 104, align: 'center' }),
      material: tb({ x: info.x, y: info.y + 10, w: textW, h: 120 }, { ...c, size: 100, uppercase: true }),
      category: tb({ x: info.x, y: info.y + 140, w: textW, h: 90 }, { ...c, size: 66, bold: false }),
    },
    psa,
    updatedAt: 0,
  }
}

/** Fill in any field missing from a stored layout (forward compatibility). */
export function normalizeLayout(material: Material, stored: Partial<Layout> | undefined): Layout {
  const d = defaultLayout(material)
  if (!stored || stored.version !== LAYOUT_VERSION) return d
  return {
    ...d,
    ...stored,
    material,
    version: LAYOUT_VERSION,
    // the frames are fixed, so the art window and layering are too
    layering: 'art-behind',
    art: { ...d.art, ...stored.art, box: { ...FRAME_GEOMETRY.art } },
    text: Object.fromEntries(TEXT_FIELDS.map((f) => {
      const st = stored.text?.[f]
      return [f, { ...d.text[f], ...st, style: { ...d.text[f].style, ...st?.style } }]
    })) as Layout['text'],
    psa: { ...d.psa, ...stored.psa, style: { ...d.psa.style, ...stored.psa?.style } },
  }
}
