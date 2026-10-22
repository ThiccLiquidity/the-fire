#!/usr/bin/env python3
"""Right-sized copies of the site's images, cut from the images already in the repo (no new art).

The Forge's card images are strips: <material>-<holo>.webp holds all 12 states of a card (raw, cased, PDA 1-10) side by
side at 360 x 504 each, and <material>-print.webp the 12 print layers at 720 x 1008. A tile or a reveal needs one state,
so this cuts each strip into one file per state:

  forge/cards/<id>/s/<material>-<holo>-<state>.webp    one state of a card, 360 x 504 (tiles, lists, the reveal's image)
  forge/cards/<id>/p/<material>-print-<state>.webp     one print layer, 720 x 1008 (the live holo, holo.js)

and makes the scene's backdrop and the Series tease in the sizes the page draws them at:

  build3/plate-<w>.webp           the 3840 x 2160 plate at 640 (the loading poster), 1280, 1920 and 2560 wide
  forge/ui/announce/<id>-sm.webp  each tease card at 180 x 252 (the small fans on the main page)

Run it after any card, plate or tease image changes: python3 web/art/factory/size_images.py (then sync_forge.sh).
It only writes files that are missing or older than their source.
"""
import glob
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
STATES = 12


def fresh(src, dst):
    return os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src)


def save(im, dst, **kw):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, "WEBP", method=6, **kw)


def cut(src, out_dir, name, quality, alpha_quality=None):
    """One strip of 12 states -> 12 files out_dir/<name>-<state>.webp. Returns how many were written."""
    targets = [os.path.join(out_dir, f"{name}-{k}.webp") for k in range(STATES)]
    if all(fresh(src, t) for t in targets):
        return 0
    im = Image.open(src)
    im.load()
    w = im.width // STATES
    for k, t in enumerate(targets):
        part = im.crop((k * w, 0, (k + 1) * w, im.height))
        kw = {"quality": quality}
        if alpha_quality is not None and part.mode == "RGBA":
            kw["alpha_quality"] = alpha_quality
        save(part, t, **kw)
    return len(targets)


def main():
    n = 0
    for d in sorted(glob.glob(os.path.join(HERE, "forge/cards/*/"))):
        for f in sorted(glob.glob(os.path.join(d, "*.webp"))):
            base = os.path.basename(f)[:-5]
            if base.endswith("-plain"):
                continue
            if base.endswith("-print"):
                n += cut(f, os.path.join(d, "p"), base, 82, 90)
            else:
                n += cut(f, os.path.join(d, "s"), base, 80)
    plate = os.path.join(HERE, "build3/plate.webp")
    for w in (640, 1280, 1920, 2560):
        t = os.path.join(HERE, f"build3/plate-{w}.webp")
        if fresh(plate, t):
            continue
        im = Image.open(plate).convert("RGB")
        save(im.resize((w, round(im.height * w / im.width)), Image.LANCZOS), t, quality=60 if w == 640 else 80)
        n += 1
    for f in sorted(glob.glob(os.path.join(HERE, "forge/ui/announce/*.webp"))):
        if f.endswith("-sm.webp"):
            continue
        t = f[:-5] + "-sm.webp"
        if fresh(f, t):
            continue
        im = Image.open(f)
        save(im.resize((180, round(im.height * 180 / im.width)), Image.LANCZOS), t, quality=82, alpha_quality=90)
        n += 1
    print(f"size_images: {n} files written", file=sys.stderr)


if __name__ == "__main__":
    main()
