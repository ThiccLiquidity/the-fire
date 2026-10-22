// Image providers behind one interface, so the paper isn't tied to one vendor:
//   const p = provider();  await p.generate({ prompt, size }) -> { bytes: Buffer, ext: "png", model } | null
// IMAGE_PROVIDER = openai (any OpenAI-compatible /images/generations endpoint: IMAGE_API_BASE, IMAGE_API_KEY,
// IMAGE_MODEL) | none (no images: the story keeps its placeholder and the site draws a stand-in).
import { env } from "../util.mjs";
import { openaiCompatible } from "./openai.mjs";

export const HOUSE_STYLE =
  "Press photograph for The Morning Wood, a satirical small-town newspaper. Shot like a 1970s wire photo: " +
  "slightly grainy, warm flash, newsprint halftone feel, dramatic but deadpan. No text, no logos, no watermarks. " +
  "Never a real, identifiable person: use anonymous stand-ins, backs of heads, silhouettes, props or cartoon card characters. Scene: ";

const none = { name: "none", generate: async () => null };

export function provider(name = env("IMAGE_PROVIDER", "none")) {
  if (name === "none" || !env("IMAGE_API_KEY")) return none;
  if (name === "openai") return openaiCompatible({ base: env("IMAGE_API_BASE", "https://api.openai.com/v1"), key: env("IMAGE_API_KEY"), model: env("IMAGE_MODEL", "gpt-image-1"), quality: env("IMAGE_QUALITY", "medium") });
  throw new Error(`unknown IMAGE_PROVIDER ${name} (openai | none)`);
}
