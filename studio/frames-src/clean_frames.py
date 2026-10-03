"""Turns the owner's frame templates (frames-src/originals/*.png, 750 x 1050) into the master frames the studio ships
(src/assets/frames/*.webp, 1500 x 2100, lossless). Every frame gets exactly the same treatment, so they stay identical:

  1. faithful 2x upscale (premultiplied-alpha Lanczos + light unsharp mask; no AI, the texture is not repainted)
  2. one clean rounded-rectangle outline (radius 93, 8 px in from the edge, anti-aliased), the same on every frame
  3. the art window cut perfectly square: x 128-1371, y 296-1539 (FRAME_GEOMETRY in src/frames.ts)
  4. the ragged rim colours along both cut edges replaced by the frame's own colour from just inside

Run from studio/:  python3 frames-src/clean_frames.py      (needs pillow, numpy, scipy)
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as nd

W, H, S, INSET, RADIUS = 1500, 2100, 4, 8, 93
WX0, WY0, WX1, WY1 = 128, 296, 1371, 1539
SRC, OUT = 'frames-src/originals', 'src/assets/frames'


def upscale(path):
    a = np.array(Image.open(path).convert('RGBA')).astype(np.float32)
    al = a[..., 3:] / 255
    pm = Image.fromarray(np.dstack([a[..., :3] * al, a[..., 3:]]).clip(0, 255).astype(np.uint8))
    big = np.array(pm.resize((W, H), Image.LANCZOS)).astype(np.float32)
    A = big[..., 3:] / 255
    rgb = np.where(A > 0.004, big[..., :3] / np.maximum(A, 0.004), 0)
    im = Image.fromarray(np.dstack([rgb.clip(0, 255), big[..., 3:]]).astype(np.uint8))
    r, g, b, aa = im.split()
    sharp = Image.merge('RGB', (r, g, b)).filter(ImageFilter.UnsharpMask(radius=1.6, percent=70, threshold=2))
    return np.array(Image.merge('RGBA', (*sharp.split(), aa)))


def outline():
    m = Image.new('L', (W * S, H * S), 0)
    ImageDraw.Draw(m).rounded_rectangle([INSET * S, INSET * S, (W - INSET) * S - 1, (H - INSET) * S - 1], radius=RADIUS * S, fill=255)
    return np.array(m.resize((W, H), Image.LANCZOS))


def clean(a, outer):
    al = np.minimum(np.where(a[..., 3] > 0, 255, 0).astype(np.uint8), outer)
    al[WY0:WY1 + 1, WX0:WX1 + 1] = 0
    # window rim: copy colour from a few px further out into the 4 px band around the window
    b = 4
    for k in range(1, b + 1):
        a[WY1 + k, WX0 - b:WX1 + b + 1, :3] = a[WY1 + b + 3, WX0 - b:WX1 + b + 1, :3]
        a[WY0 - k, WX0 - b:WX1 + b + 1, :3] = a[WY0 - b - 3, WX0 - b:WX1 + b + 1, :3]
        a[WY0 - b:WY1 + b + 1, WX0 - k, :3] = a[WY0 - b:WY1 + b + 1, WX0 - b - 3, :3]
        a[WY0 - b:WY1 + b + 1, WX1 + k, :3] = a[WY0 - b:WY1 + b + 1, WX1 + b + 3, :3]
    a[..., 3] = al
    # outer rim: the 6 px along the card's edge take the colour of the nearest pixel further in
    filled = nd.binary_fill_holes(al > 0)
    d = nd.distance_transform_edt(filled)
    _, (iy, ix) = nd.distance_transform_edt(~(filled & (d > 6)), return_indices=True)
    band = filled & (d <= 6) & (al > 0)
    a[band, :3] = a[iy[band], ix[band], :3]
    return a


if __name__ == '__main__':
    outer = outline()
    os.makedirs(OUT, exist_ok=True)
    for f in sorted(os.listdir(SRC)):
        if not f.endswith(('.webp', '.png')):
            continue
        Image.fromarray(clean(upscale(os.path.join(SRC, f)), outer)).save(os.path.join(OUT, os.path.splitext(f)[0] + '.webp'), 'WEBP', lossless=True, quality=100, method=6)
        print('ok', f)
