/** Fonts bundled with the studio (no network): free Google fonts under the SIL Open Font License, except Luckiest Guy,
 *  Permanent Marker and Roboto Slab (Apache License 2.0); all fine for commercial use including the card images. Installed as @fontsource packages; the latin 400 and 700 files are loaded into the
 *  page and into the build workers. A font with no 700 file uses its 400 file for bold too (no fake bold). */

import f0w400 from '@fontsource/cinzel/files/cinzel-latin-400-normal.woff2?url'
import f0w700 from '@fontsource/cinzel/files/cinzel-latin-700-normal.woff2?url'
import f1w400 from '@fontsource/cinzel-decorative/files/cinzel-decorative-latin-400-normal.woff2?url'
import f1w700 from '@fontsource/cinzel-decorative/files/cinzel-decorative-latin-700-normal.woff2?url'
import f2w400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url'
import f2w700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url'
import f3w400 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2?url'
import f3w700 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2?url'
import f4w400 from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url'
import f4w700 from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url'
import f5w400 from '@fontsource/lora/files/lora-latin-400-normal.woff2?url'
import f5w700 from '@fontsource/lora/files/lora-latin-700-normal.woff2?url'
import f6w400 from '@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff2?url'
import f6w700 from '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff2?url'
import f7w400 from '@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2?url'
import f8w400 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url'
import f9w400 from '@fontsource/anton/files/anton-latin-400-normal.woff2?url'
import f10w400 from '@fontsource/oswald/files/oswald-latin-400-normal.woff2?url'
import f10w700 from '@fontsource/oswald/files/oswald-latin-700-normal.woff2?url'
import f11w400 from '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2?url'
import f12w400 from '@fontsource/russo-one/files/russo-one-latin-400-normal.woff2?url'
import f13w400 from '@fontsource/teko/files/teko-latin-400-normal.woff2?url'
import f13w700 from '@fontsource/teko/files/teko-latin-700-normal.woff2?url'
import f14w400 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff2?url'
import f14w700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2?url'
import f15w400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?url'
import f15w700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?url'
import f16w400 from '@fontsource/medievalsharp/files/medievalsharp-latin-400-normal.woff2?url'
import f17w400 from '@fontsource/uncial-antiqua/files/uncial-antiqua-latin-400-normal.woff2?url'
import f18w400 from '@fontsource/metamorphous/files/metamorphous-latin-400-normal.woff2?url'
import f19w400 from '@fontsource/pirata-one/files/pirata-one-latin-400-normal.woff2?url'
import f20w400 from '@fontsource/rye/files/rye-latin-400-normal.woff2?url'
import f21w400 from '@fontsource/bangers/files/bangers-latin-400-normal.woff2?url'
import f22w400 from '@fontsource/luckiest-guy/files/luckiest-guy-latin-400-normal.woff2?url'
import f23w400 from '@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2?url'
import f24w400 from '@fontsource/righteous/files/righteous-latin-400-normal.woff2?url'
import f25w400 from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url'
import f26w400 from '@fontsource/caveat/files/caveat-latin-400-normal.woff2?url'
import f26w700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff2?url'
import f27w400 from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url'
import f28w400 from '@fontsource/lobster/files/lobster-latin-400-normal.woff2?url'
import f29w400 from '@fontsource/creepster/files/creepster-latin-400-normal.woff2?url'
import f30w400 from '@fontsource/nosifer/files/nosifer-latin-400-normal.woff2?url'
import f31w400 from '@fontsource/orbitron/files/orbitron-latin-400-normal.woff2?url'
import f31w700 from '@fontsource/orbitron/files/orbitron-latin-700-normal.woff2?url'
import f32w400 from '@fontsource/audiowide/files/audiowide-latin-400-normal.woff2?url'
import f33w400 from '@fontsource/rajdhani/files/rajdhani-latin-400-normal.woff2?url'
import f33w700 from '@fontsource/rajdhani/files/rajdhani-latin-700-normal.woff2?url'
import f34w400 from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2?url'

export const FONT_GROUPS = ['Classic', 'Bold', 'Clean', 'Fantasy', 'Fun', 'Hand-drawn', 'Spooky', 'Tech'] as const
export type FontGroup = (typeof FONT_GROUPS)[number]

export interface BundledFont {
  family: string
  group: FontGroup
  fallback: string
  files: { 400?: string; 700?: string }
}

export const BUNDLED_FONTS: BundledFont[] = [
  { family: 'Cinzel', group: 'Classic', fallback: 'serif', files: { 400: f0w400, 700: f0w700 } },
  { family: 'Cinzel Decorative', group: 'Classic', fallback: 'serif', files: { 400: f1w400, 700: f1w700 } },
  { family: 'Playfair Display', group: 'Classic', fallback: 'serif', files: { 400: f2w400, 700: f2w700 } },
  { family: 'Cormorant Garamond', group: 'Classic', fallback: 'serif', files: { 400: f3w400, 700: f3w700 } },
  { family: 'Merriweather', group: 'Classic', fallback: 'serif', files: { 400: f4w400, 700: f4w700 } },
  { family: 'Lora', group: 'Classic', fallback: 'serif', files: { 400: f5w400, 700: f5w700 } },
  { family: 'Roboto Slab', group: 'Classic', fallback: 'serif', files: { 400: f6w400, 700: f6w700 } },
  { family: 'Alfa Slab One', group: 'Classic', fallback: 'serif', files: { 400: f7w400 } },
  { family: 'Bebas Neue', group: 'Bold', fallback: 'sans-serif', files: { 400: f8w400 } },
  { family: 'Anton', group: 'Bold', fallback: 'sans-serif', files: { 400: f9w400 } },
  { family: 'Oswald', group: 'Bold', fallback: 'sans-serif', files: { 400: f10w400, 700: f10w700 } },
  { family: 'Archivo Black', group: 'Bold', fallback: 'sans-serif', files: { 400: f11w400 } },
  { family: 'Russo One', group: 'Bold', fallback: 'sans-serif', files: { 400: f12w400 } },
  { family: 'Teko', group: 'Bold', fallback: 'sans-serif', files: { 400: f13w400, 700: f13w700 } },
  { family: 'Montserrat', group: 'Clean', fallback: 'sans-serif', files: { 400: f14w400, 700: f14w700 } },
  { family: 'Poppins', group: 'Clean', fallback: 'sans-serif', files: { 400: f15w400, 700: f15w700 } },
  { family: 'MedievalSharp', group: 'Fantasy', fallback: 'serif', files: { 400: f16w400 } },
  { family: 'Uncial Antiqua', group: 'Fantasy', fallback: 'serif', files: { 400: f17w400 } },
  { family: 'Metamorphous', group: 'Fantasy', fallback: 'serif', files: { 400: f18w400 } },
  { family: 'Pirata One', group: 'Fantasy', fallback: 'serif', files: { 400: f19w400 } },
  { family: 'Rye', group: 'Fantasy', fallback: 'serif', files: { 400: f20w400 } },
  { family: 'Bangers', group: 'Fun', fallback: 'sans-serif', files: { 400: f21w400 } },
  { family: 'Luckiest Guy', group: 'Fun', fallback: 'sans-serif', files: { 400: f22w400 } },
  { family: 'Lilita One', group: 'Fun', fallback: 'sans-serif', files: { 400: f23w400 } },
  { family: 'Righteous', group: 'Fun', fallback: 'sans-serif', files: { 400: f24w400 } },
  { family: 'Permanent Marker', group: 'Hand-drawn', fallback: 'cursive', files: { 400: f25w400 } },
  { family: 'Caveat', group: 'Hand-drawn', fallback: 'cursive', files: { 400: f26w400, 700: f26w700 } },
  { family: 'Pacifico', group: 'Hand-drawn', fallback: 'cursive', files: { 400: f27w400 } },
  { family: 'Lobster', group: 'Hand-drawn', fallback: 'cursive', files: { 400: f28w400 } },
  { family: 'Creepster', group: 'Spooky', fallback: 'cursive', files: { 400: f29w400 } },
  { family: 'Nosifer', group: 'Spooky', fallback: 'cursive', files: { 400: f30w400 } },
  { family: 'Orbitron', group: 'Tech', fallback: 'sans-serif', files: { 400: f31w400, 700: f31w700 } },
  { family: 'Audiowide', group: 'Tech', fallback: 'sans-serif', files: { 400: f32w400 } },
  { family: 'Rajdhani', group: 'Tech', fallback: 'sans-serif', files: { 400: f33w400, 700: f33w700 } },
  { family: 'Press Start 2P', group: 'Tech', fallback: 'monospace', files: { 400: f34w400 } },
]

/** The value stored in a text style's `font`. */
export function bundledFontCss(f: BundledFont): string {
  return `"${f.family}", ${f.fallback}`
}

/** The faces to register: [weight, url] for 400 and 700 (700 falls back to the 400 file). */
function faces(f: BundledFont): [number, string][] {
  const w400 = f.files[400] ?? f.files[700]!
  return [[400, w400], [700, f.files[700] ?? w400]]
}

let loading: Promise<void> | null = null

/** Register every bundled font in the page (once). Resolves when they're all loaded. */
export function loadBundledFonts(): Promise<void> {
  loading ??= Promise.all(BUNDLED_FONTS.flatMap((f) => faces(f).map(async ([weight, url]) => {
    const face = new FontFace(f.family, `url(${url})`, { weight: String(weight) })
    document.fonts.add(face)
    try { await face.load() } catch { /* a font that fails to load falls back to the next family in its list */ }
  }))).then(() => undefined)
  return loading
}

/** Font files for the build workers: only the bundled fonts named in `fontCss` values (the layouts' text styles). */
export async function bundledFontData(fontCss: string[]): Promise<{ family: string; weight: string; data: ArrayBuffer }[]> {
  const used = BUNDLED_FONTS.filter((f) => fontCss.some((css) => css.includes(`"${f.family}"`)))
  const out: { family: string; weight: string; data: ArrayBuffer }[] = []
  for (const f of used) {
    for (const [weight, url] of faces(f)) out.push({ family: f.family, weight: String(weight), data: await (await fetch(url)).arrayBuffer() })
  }
  return out
}
