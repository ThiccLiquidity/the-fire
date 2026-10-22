// Imgflip memes (free): POST https://api.imgflip.com/caption_image with a template id and the text boxes. Needs a free
// Imgflip account (IMGFLIP_USERNAME / IMGFLIP_PASSWORD). Without one the story keeps its placeholder.
import { fetchJson } from "../util.mjs";

/** Fallback ids for common templates; the live list (get_memes, no login) is asked first, by name. */
export const TEMPLATES = {
  "Drake Hotline Bling": "181913649",
  "Distracted Boyfriend": "112126428",
  "Two Buttons": "87743020",
  "This Is Fine": "55311130",
  "Change My Mind": "129242436",
  "Expanding Brain": "93895088",
  "Left Exit 12 Off Ramp": "124822590",
  "Woman Yelling At Cat": "188390779",
  "Gru's Plan": "131940431",
  "Is This A Pigeon": "100777631",
  "Disaster Girl": "97984",
  "Surprised Pikachu": "155067746",
  "One Does Not Simply": "61579",
  "Batman Slapping Robin": "438680",
  "Running Away Balloon": "131087935",
  "Bernie I Am Once Again Asking": "222403160",
  "Sad Pablo Escobar": "80707627",
  "UNO Draw 25 Cards": "217743513",
};

export async function templateId(name) {
  if (/^\d+$/.test(name)) return name;
  try {
    const j = await fetchJson("https://api.imgflip.com/get_memes");
    const hit = j.data?.memes?.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
  } catch {}
  if (TEMPLATES[name]) return TEMPLATES[name];
  throw new Error(`imgflip: no template named "${name}"`);
}

export async function caption({ template, captions }, { username, password }) {
  const id = await templateId(template);
  const form = new URLSearchParams({ template_id: id, username, password });
  captions.forEach((t, i) => form.append(`boxes[${i}][text]`, t));
  const j = await fetchJson("https://api.imgflip.com/caption_image", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  if (!j.success) throw new Error(`imgflip: ${j.error_message}`);
  const r = await fetch(j.data.url);
  return { bytes: Buffer.from(await r.arrayBuffer()), ext: "jpg", url: j.data.url };
}
