// OpenAI-compatible image generation: POST {base}/images/generations. Works with OpenAI (gpt-image-1, b64_json) and
// the many services that copy the API (some return a URL instead: fetched).
import { fetchText } from "../util.mjs";

export function openaiCompatible({ base, key, model, quality }) {
  return {
    name: `openai:${model}`,
    async generate({ prompt, size = "1536x1024" }) {
      const body = { model, prompt, size, n: 1 };
      if (quality) body.quality = quality;
      const j = JSON.parse(await fetchText(`${base.replace(/\/$/, "")}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      }));
      const d = j.data?.[0];
      if (d?.b64_json) return { bytes: Buffer.from(d.b64_json, "base64"), ext: "png", model };
      if (d?.url) {
        const r = await fetch(d.url);
        return { bytes: Buffer.from(await r.arrayBuffer()), ext: (r.headers.get("content-type") ?? "").includes("jpeg") ? "jpg" : "png", model };
      }
      throw new Error("image API returned no image");
    },
  };
}
