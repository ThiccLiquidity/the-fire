"""Cleans the Omni logos (brand/originals/*.png) into brand/*.png: removes stray specks, anti-aliases the cut-out
edges (the originals have hard on/off transparency, so curves stair-step), and writes a sharp 2x version too.
The art itself is not repainted. Run from the repo root: python3 brand/clean_logos.py  (needs pillow, numpy, scipy)"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

SRC, OUT = 'brand/originals', 'brand'


def smooth_alpha(mask, scale):
    """Binary mask -> smooth anti-aliased alpha at `scale` x the size."""
    m = mask.astype(np.float32)
    big = np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((mask.shape[1] * scale * 4, mask.shape[0] * scale * 4), Image.BILINEAR), np.float32) / 255
    big = nd.gaussian_filter(big, 3.2)                      # ~0.8 px at the original size: rounds the stair steps
    big = np.clip((big - 0.5) * 6 + 0.5, 0, 1)              # back to a crisp edge, now smooth
    small = Image.fromarray((big * 255).astype(np.uint8)).resize((mask.shape[1] * scale, mask.shape[0] * scale), Image.BOX)
    return np.array(small, np.float32) / 255


def clean(path):
    a = np.array(Image.open(path).convert('RGBA'))
    mask = a[..., 3] > 127
    lab, n = nd.label(mask)
    sizes = nd.sum(mask, lab, range(1, n + 1))
    mask = np.isin(lab, 1 + np.nonzero(sizes >= 40)[0])       # drop specks smaller than 40 px
    # colour for pixels that become partly visible at the edge: the nearest solid pixel's colour
    _, (iy, ix) = nd.distance_transform_edt(~mask, return_indices=True)
    rgb = a[..., :3][iy, ix]
    out = []
    for scale in (1, 2):
        al = smooth_alpha(mask, scale)
        col = np.array(Image.fromarray(rgb).resize((al.shape[1], al.shape[0]), Image.LANCZOS)) if scale > 1 else rgb
        out.append(Image.fromarray(np.dstack([col, (al * 255 + 0.5).astype(np.uint8)])))
    return out


if __name__ == '__main__':
    for f in sorted(os.listdir(SRC)):
        if f.endswith('.png'):
            one, two = clean(os.path.join(SRC, f))
            base = os.path.splitext(f)[0]
            one.save(os.path.join(OUT, f'{base}.png'), optimize=True)
            two.save(os.path.join(OUT, f'{base}@2x.png'), optimize=True)
            print('ok', f, one.size, two.size)
