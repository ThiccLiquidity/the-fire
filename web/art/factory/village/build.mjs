// Village art for the site (the building outlines and sign spots are in forge/village.json): the four times of day (village/src, the owner's art, 1536 x 1024) -> forge/ui/village/
// <time>-<width>.webp at 1536 and 3072 wide, plus a tiny blurred placeholder. The 2x is a plain Lanczos resize with a
// light sharpen for now; swap in a proper AI upscale (Upscayl / Real-ESRGAN) by putting larger sources in village/src.
// Run: node village/build.mjs (from web/art/factory; needs sharp).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const T = { morning: '01_Morning.png', day: '02_Day.png', dusk: '03_Dusk.png', night: '04_Night.png' };
const out = new URL('../forge/ui/village/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const [t, f] of Object.entries(T)) {
  const src = new URL(`src/${f}`, import.meta.url).pathname;
  await sharp(src).resize(1536, 1024).webp({ quality: 84 }).toFile(`${out}${t}-1536.webp`);
  await sharp(src).resize(3072, 2048, { kernel: 'lanczos3' }).sharpen({ sigma: 0.8, m1: 0.6, m2: 1.2 }).webp({ quality: 82 }).toFile(`${out}${t}-3072.webp`);
  console.log(t);
}
await sharp(new URL('src/03_Dusk.png', import.meta.url).pathname).resize(48, 32).blur(1.2).webp({ quality: 60 }).toFile(`${out}placeholder.webp`);
