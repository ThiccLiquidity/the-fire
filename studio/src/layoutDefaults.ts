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
export const LAYOUT_VERSION = 6

/** Text colours per frame: Paper, Wood and Diamond have light panels (dark ink); Burning and Coal have dark panels
 *  (light ink). `window` fills the art window behind keyed art. */
/** `seal` = the PDA seal's light and dark colours and its text colour, matched to each frame: pencil graphite on
 *  Paper, walnut on Wood, ember on Fire, black and silver on Coal, icy crystal on Diamond. */
const INK: Record<string, { color: string; outline: string; outlineWidth: number; window: string; seal: [string, string, string]; head: string; body: string; accent?: string; color2?: string; shadow?: string; scale?: number; bodyLook?: Partial<TextStyle>
  /** Per type: extra look for every line, line sizes, an upright art style line, extra look for the small row. */
  look?: Partial<TextStyle>; sizes?: { theme: number; style: number; row: number }; styleItalic?: boolean; rowLook?: Partial<TextStyle> }> = {
  // Paper: pencil on paper. Wood: carved slab letters. Fire: ember gold on soot. Coal: cold silver. Gold: engraved
  // capitals. Full Art: cream on its dark glass panels (render.ts drawGlassPanels).
  // Paper: hand lettering in graphite pencil (render.ts paintPencil), big enough to read (owner-approved Oct 2026)
  paper: { color: '#26272b', outline: '#ffffff', outlineWidth: 0, window: '#f4f0e6', seal: ['#8a8a8a', '#2f2f31', '#f3efe6'], head: font('Permanent Marker', 'cursive'), body: font('Permanent Marker', 'cursive'),
    look: { bold: false, pencil: 0.9 }, sizes: { theme: 100, style: 74, row: 60 }, styleItalic: false, rowLook: { pencil: 0.5 } },
  // Wood: western letters burned into the wood (render.ts paintBurn), plain bold slab in the small row (owner-approved Oct 2026)
  wood: { color: '#2a1408', outline: '#f6e2c0', outlineWidth: 0, window: '#f1e4cc', seal: ['#9a6230', '#4a2810', '#f6e2c0'], head: font('Rye', 'serif'), body: font('Rye', 'serif'),
    look: { bold: false, burn: true, color2: '#120804' }, sizes: { theme: 90, style: 68, row: 56 }, styleItalic: false, rowLook: { font: font('Roboto Slab', 'serif'), bold: true } },
  // Fire: heavy slab letters, white-hot fading to gold, with a bright ember glow (owner-approved Oct 2026)
  burning: { color: '#ffffff', color2: '#ffbf3d', shadow: 'rgba(255,150,30,1)', outline: '#140401', outlineWidth: 7, window: '#24100a', seal: ['#f08a2a', '#7a1606', '#fff1d6'],
    head: font('Alfa Slab One', 'serif'), body: font('Roboto Slab', 'serif'), look: { bold: false }, bodyLook: { bold: true }, sizes: { theme: 96, style: 70, row: 58 }, styleItalic: false },
  // Coal: brushed steel, white fading to steel grey on a dark halo; no colour (owner-approved Oct 2026)
  charcoal: { color: '#ffffff', color2: '#7d828c', shadow: 'rgba(0,0,0,.95)', outline: '#000000', outlineWidth: 6, window: '#26262a', seal: ['#8a8b93', '#2c2c31', '#f2f3f6'],
    head: font('Bebas Neue', 'sans-serif'), body: font('Oswald', 'sans-serif'), look: { bold: false }, sizes: { theme: 112, style: 86, row: 68 }, styleItalic: false },
  diamond: { color: '#12324a', outline: '#ffffff', outlineWidth: 0, window: '#eef6fb', seal: ['#f4fbff', '#9cc0d8', '#12324a'], head: font('Cinzel', 'serif'), body: font('Cormorant Garamond', 'serif') },
  // Gold: ivory capitals inlaid in the gold, with a bronze rim and a deep shadow (owner-approved Oct 2026)
  gold: { color: '#fffaf0', color2: '#f4e4c0', shadow: 'rgba(45,22,0,1)', outline: '#64380a', outlineWidth: 5, window: '#f5e3a8', seal: ['#f7d774', '#8a5a10', '#3a2606'],
    head: font('Cinzel', 'serif'), body: font('Cinzel', 'serif'), look: { bold: true }, sizes: { theme: 96, style: 70, row: 58 }, styleItalic: false },
  // Full Art: gold letters in a chunky font for the name, white for the rest, both with a purple edge and a pink glow
  // (over the holo boxes, render.ts drawHoloBoxes)
  fullart: { color: '#fff6c8', color2: '#e09a2c', shadow: 'rgba(255,60,200,.95)', outline: '#2a1458', outlineWidth: 6, window: '#1d1d22', seal: ['#f7d774', '#8a5a10', '#3a2606'],
    head: font('Lilita One', 'sans-serif'), body: font('Lilita One', 'sans-serif'), bodyLook: { color: '#ffffff', color2: '#d9e4ff' }, accent: '#ffffff' },
}

/** A frame set the studio has no colours for yet (a new set built by clean_frames.py): light text with a dark
 *  outline reads on any panel; set its real colours in Frames & Layout. */
const NEUTRAL_INK = { color: '#fff7e8', outline: '#1a1410', outlineWidth: 5, window: '#1d1d22', seal: ['#d9b25a', '#5a3d10', '#fff6e0'] as [string, string, string],
  head: BUILTIN_FONTS[0].css, body: BUILTIN_FONTS[0].css, accent: undefined as string | undefined,
  color2: undefined as string | undefined, shadow: undefined as string | undefined, scale: undefined as number | undefined,
  bodyLook: undefined as Partial<TextStyle> | undefined, look: undefined as Partial<TextStyle> | undefined,
  sizes: undefined as { theme: number; style: number; row: number } | undefined, styleItalic: undefined as boolean | undefined, rowLook: undefined as Partial<TextStyle> | undefined }

/** A bundled font's stored value (fonts.ts bundledFontCss). */
function font(family: string, fallback: string): string {
  return `"${family}", ${fallback}`
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

/** The name prints as big as fits its bar (render.ts fillTextSize): this is only the ceiling. */
const NAME_MAX = 240

/** The small row under the theme and art style: type, category and Series # side by side (render.ts drawRow
 *  places them one after the other; each box spans the row so any one of them can be the widest). */
function smallRow(info: Rect, w: number, c: Partial<TextStyle>, k = 1, size?: number): Pick<Layout['text'], 'material' | 'category' | 'forged'> {
  const box = { x: info.x, y: info.y + 194, w, h: 56 }
  return {
    material: tb({ ...box }, { ...c, size: size ?? Math.round(40 * k), minSize: 18, uppercase: true }),
    category: tb({ ...box }, { ...c, size: size ?? Math.round(40 * k), minSize: 18, bold: false }),
    forged: tb({ ...box }, { ...c, size: size ?? Math.round(40 * k), minSize: 18, bold: false }),
  }
}

/** The default layout of a frame set (layouts are per frame set; every card type using the set shares it). */
export function defaultLayout(material: string): Layout {
  const ink = INK[material] ?? NEUTRAL_INK
  const c = { color: ink.color, outlineColor: ink.outline, outlineWidth: ink.outlineWidth }
  const fx = { ...(ink.color2 ? { color2: ink.color2 } : {}), ...(ink.shadow ? { shadow: ink.shadow } : {}) }
  const head = { ...c, ...fx, font: ink.head, ...ink.look }, body = { ...c, ...fx, font: ink.body, ...ink.look, ...ink.bodyLook }
  const small = { ...body, color: ink.accent ?? body.color, ...ink.rowLook }
  const sz = ink.sizes
  const k = ink.scale ?? 1 // hand fonts have small letters for their size
  const g = FRAME_GEOMETRY
  const info = g.infoText
  const textW = 780
  const psa: PsaBox = {
    // the seal: a 236 px circle centred at (1170, 1815); fill/border are its light/dark wax colours
    ...tb({ x: 1052, y: 1697, w: 236, h: 236 }, { font: ink.head, size: 112, minSize: 24, color: ink.seal[2], outlineWidth: 0, align: 'center' }),
    fill: ink.seal[0], border: ink.seal[1], borderWidth: 0, radius: 0,
  }
  return {
    material,
    version: LAYOUT_VERSION,
    layering: 'art-behind',
    art: { box: artBoxOf(material), fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, background: ink.window },
    text: {
      name: tb({ ...g.nameBar }, { ...head, size: NAME_MAX, align: 'center' }),
      // the Series' theme big, its art style under it, then one small row: type · category · Series #
      theme: tb({ x: info.x, y: info.y + 4, w: textW, h: 100 }, { ...head, size: sz?.theme ?? Math.round(84 * k) }),
      style: tb({ x: info.x, y: info.y + 110, w: textW, h: 70 }, { ...body, size: sz?.style ?? Math.round(58 * k), bold: false, italic: ink.styleItalic ?? true }),
      ...smallRow(info, textW, small, k, sz?.row),
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
  // v4 -> v5: the theme and art style take the big spots; type, category and Series # shrink to one small row.
  // Fonts and colours stay (the new lines take the old type and category looks)
  if ((stored.version ?? 0) < 5 && stored.text) {
    const t = { ...stored.text }
    const look = (f: 'theme' | 'style', from?: TextBox) => ({ ...d.text[f], style: { ...d.text[f].style,
      ...(from ? { font: from.style.font, color: from.style.color, outlineColor: from.style.outlineColor, outlineWidth: from.style.outlineWidth } : {}) } })
    t.theme = look('theme', t.material)
    t.style = look('style', t.category)
    for (const f of ['material', 'category', 'forged'] as const) {
      const st = t[f]
      if (st) t[f] = { ...st, box: { ...d.text[f].box }, style: { ...st.style, size: d.text[f].style.size, minSize: d.text[f].style.minSize, italic: d.text[f].style.italic } }
    }
    stored = { ...stored, text: t }
  }
  // v5 -> v6: each card type got its own fonts and colours (and Full Art its holo look), and the name fills its bar:
  // the text looks start from the new defaults (shown or hidden stays as saved)
  if ((stored.version ?? 0) < 6 && stored.text) {
    const t = { ...stored.text }
    for (const f of TEXT_FIELDS) if (t[f]) t[f] = { ...t[f], style: { ...d.text[f].style } }
    stored = { ...stored, text: t, psa: stored.psa ? { ...stored.psa, style: { ...d.psa.style } } : stored.psa }
  }
  return lockPositions({
    ...d,
    ...stored,
    material,
    version: LAYOUT_VERSION,
    layering: 'art-behind',
    art: { ...d.art, ...stored.art },
    text: Object.fromEntries(TEXT_FIELDS.map((f) => {
      const st = stored.text?.[f]
      return [f, { ...d.text[f], ...st, style: { ...d.text[f].style, ...st?.style } }]
    })) as Layout['text'],
    psa: { ...d.psa, ...stored.psa, style: { ...d.psa.style, ...stored.psa?.style } },
  })
}

/** Where everything prints is fixed, the same on every frame set: the name centred in the top bar (both ways, any
 *  font or size), the theme, art style and the small type · category · Series row left in the bottom panel, the seal in its spot, and the art
 *  filling its window (a character's own framing is per image, Library). Only the look (font, size, colour, outline,
 *  bold, italic, capitals, shown or hidden) is set per frame set. */
export function lockPositions(l: Layout): Layout {
  const d = defaultLayout(l.material)
  const fix = (f: keyof Layout['text'], align: TextBox['style']['align']) =>
    ({ ...l.text[f], box: { ...d.text[f].box }, style: { ...l.text[f].style, align } })
  return {
    ...l,
    layering: 'art-behind',
    art: { ...l.art, box: artBoxOf(l.material), fit: 'cover', scale: 1, offsetX: 0, offsetY: 0 },
    text: {
      name: fix('name', 'center'), theme: fix('theme', 'left'), style: fix('style', 'left'),
      material: fix('material', 'left'), category: fix('category', 'left'), forged: fix('forged', 'left'),
    },
    psa: { ...l.psa, box: { ...d.psa.box }, style: { ...l.psa.style, align: 'center' } },
  }
}
