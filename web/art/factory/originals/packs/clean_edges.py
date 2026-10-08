import sys
from PIL import Image
import numpy as np
src, dst, y0, y1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = np.array(Image.open(src)).astype(np.float32)
h, w = im.shape[:2]
T, P = 11, 21.0   # tooth depth and period (px)
xs = np.arange(w) + 0.5
tri = np.abs(((xs / P) % 1.0) * 2 - 1)        # 0..1 triangle wave
a = im[:, :, 3]
a[:y0] = 0
a[y1 + 1:] = 0
for k in range(T):
    # top: row y0+k is kept where the tooth is at least k deep; 4x supersampled for soft edges
    cov = np.clip((k + 1 - T * tri) , 0, 1)
    a[y0 + k] *= cov
    a[y1 - k] *= cov
im[:, :, 3] = a
Image.fromarray(im.round().astype(np.uint8)).save(dst, lossless=True)
