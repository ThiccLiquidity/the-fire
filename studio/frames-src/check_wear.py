"""Checks every built PDA wear frame against its source: outside the art window, the built frame must match the
upscaled source (alpha and colour), so no wear is lost. Run from studio/ after clean_frames.py; exits 1 on a mismatch."""
import os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import clean_frames as cf

bad = 0
wear = os.path.join(cf.SRC, 'wear')
for level in sorted(os.listdir(wear)):
    for f in sorted(os.listdir(os.path.join(wear, level))):
        if not f.endswith('.png'):
            continue
        up = cf.upscale(os.path.join(wear, level, f)).astype(float)
        out = np.asarray(Image.open(os.path.join(cf.OUT, f'{f[:-4]}-{level}.webp')).convert('RGBA')).astype(float)
        m = np.ones(up.shape[:2], bool); m[cf.WY0 - 6:cf.WY1 + 7, cf.WX0 - 6:cf.WX1 + 7] = False
        pa, pb = up[..., 3:] / 255 * up[..., :3], out[..., 3:] / 255 * out[..., :3]
        d = np.abs(pa - pb).mean(2)[m].mean() + np.abs(up[..., 3] - out[..., 3])[m].mean()
        ok = d < 0.5
        bad += not ok
        print('ok  ' if ok else 'LOST', level, f, round(d, 2))
sys.exit(1 if bad else 0)
