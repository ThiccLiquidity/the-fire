"""Keys the parts out of originals/sprites.png (ChatGPT's sheet on pure #00FF00) into build2/sprite-*.webp.
Only keying, despill and cropping: the art is ChatGPT's."""
import numpy as np
from PIL import Image
from scipy import ndimage

SHEET = {  # name: bounding box on the sheet (found by labelling the non-green regions)
    'flywheel': (22, 44, 1234, 1255), 'gear-small': (1311, 198, 1791, 684), 'gear-big-a': (1862, 35, 2668, 826),
    'gear-big-b': (2720, 36, 3520, 826), 'pulley': (3159, 756, 3765, 1361), 'conrod': (1423, 1075, 2663, 1355),
    'capsule': (71, 1233, 468, 2112), 'padlock': (641, 1366, 1579, 1943), 'chain': (1390, 1382, 2383, 1508),
    'rod': (2582, 1362, 3796, 1481), 'log0': (2139, 1483, 2659, 1839), 'log1': (2739, 1485, 3226, 1819),
    'log2': (3291, 1486, 3777, 1826), 'token': (1579, 1534, 1974, 1925), 'paper0': (1760, 1820, 2377, 2141),
    'paper1': (2428, 1830, 3001, 2141), 'paper2': (3076, 1839, 3690, 2137),
}
sp = np.asarray(Image.open('originals/sprites.png').convert('RGB')).astype(float)
r, g, b = sp[..., 0], sp[..., 1], sp[..., 2]
spill = g - np.maximum(r, b)                     # how green a pixel is
alpha = np.clip((140 - spill) / 80, 0, 1)        # pure green -> 0, no green excess -> 1, soft edge between
rgb = sp.copy()
rgb[..., 1] = np.where(spill > 0, np.maximum(r, b) + np.minimum(spill, 0), g)  # despill: green no higher than r/b
for name, (x0, y0, x1, y1) in SHEET.items():
    pad = 6
    box = (max(0, x0 - pad), max(0, y0 - pad), min(sp.shape[1], x1 + pad), min(sp.shape[0], y1 + pad))
    a = alpha[box[1]:box[3], box[0]:box[2]]
    # keep only this part (a neighbour's edge can sneak into the padding)
    lab, n = ndimage.label(a > 0.5)
    if n > 1:
        sizes = ndimage.sum(a > 0.5, lab, range(1, n + 1))
        keep = lab == (int(np.argmax(sizes)) + 1)
        keep = ndimage.binary_dilation(keep, iterations=3)
        a = a * keep
    px = np.dstack([rgb[box[1]:box[3], box[0]:box[2]], a * 255]).clip(0, 255).astype(np.uint8)
    Image.fromarray(px, 'RGBA').save(f'build2/sprite-{name}.webp', lossless=True)
    print(name, px.shape[1], px.shape[0])
