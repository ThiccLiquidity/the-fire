"""Builds the factory scene's layers from ChatGPT's art in originals/ into build3/.
Nothing here draws: it copies, cuts and colour-matches his pixels.
  plate.webp   the clean plate, with the lit boiler gauge copied back from the master (the images are aligned)
  front-*.webp static parts in front of moving ones, cut from the master with hand polygons
  belt.webp    the belt slats without the chain (the chain-free right part repeated leftwards, relit per column)
  chain-*.webp the chain's two strands, cut from the plate, to slide along themselves
  roll-*.webp  the roller print as a multiply layer (master / plate), unwrapped around the roller, seamless
  s-*.webp     moving-part sprites, scaled to scene size and colour-matched to the master
  scene.json   geometry
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

os.makedirs('build3', exist_ok=True)
F = np.asarray(Image.open('originals/factory-full.png').convert('RGB')).astype(float)
C = np.asarray(Image.open('originals/factory-clean.png').convert('RGB')).astype(float)
H, W = C.shape[:2]
G = {}  # geometry for the page

def save(arr, name, lossless=False, q=88):
    im = Image.fromarray(arr.clip(0, 255).astype(np.uint8), 'RGBA' if arr.shape[2] == 4 else 'RGB')
    im.save(f'build3/{name}', lossless=lossless, quality=q, method=6)

def poly_mask(pts, feather=1.5, box=None):
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon([tuple(p) for p in pts], fill=255)
    if feather: m = m.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(m).astype(float) / 255

def cut(arr, mask, name):
    ys, xs = np.nonzero(mask > 0.01); x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    px = np.dstack([arr[y0:y1, x0:x1], mask[y0:y1, x0:x1] * 255])
    save(px, name, lossless=True); return [int(x0), int(y0)]

# ---- the plate: clean + the lit gauge from the master
plate = C.copy()
gm = np.zeros((H, W)); gm[400:648, 1680:1776] = 1
gm = ndimage.gaussian_filter(gm, 4); gm[650:] = 0           # never touch the flywheel area below
plate = plate * (1 - gm[..., None]) + F * gm[..., None]
save(plate, 'plate.webp', q=90)

# ---- front occluders from the master
STAND = [(1622, 916), (1682, 916), (1690, 1000), (1708, 1050), (1736, 1052), (1738, 1100), (1574, 1100), (1576, 1052),
         (1606, 1050), (1614, 1000)]
G['front'] = {'stand': cut(F, poly_mask(STAND), 'front-stand.webp')}

# ---- belt: slats only, no chain
BX0, BX1, BY0, BY1, PER = 2130, 3404, 956, 1052, 66
G['belt'] = {'x': BX0, 'y': BY0, 'w': BX1 - BX0, 'h': BY1 - BY0, 'period': PER}
src = C[BY0:BY1, BX0:BX1].copy()
clean_from = 2480 - BX0                                     # right of here there's no chain
tex = src.copy()
for x in range(clean_from - 1, -1, -1):
    k = ((clean_from - x + PER - 1) // PER) * PER           # a whole number of slats to the right
    tex[:, x] = tex[:, x + k]
# relight: per-column gain so the left keeps the original light (median ignores the chain's pixels)
med_src = np.median(src, axis=0); med_tex = np.median(tex, axis=0)
gain = ndimage.uniform_filter1d(med_src, 61, axis=0) / np.maximum(1, ndimage.uniform_filter1d(med_tex, 61, axis=0))
tex = tex * gain[None]
ramp = np.clip(np.arange(tex.shape[1]) / 18, 0, 1)[None, :, None] * 255  # soft left edge against the gearbox
save(np.concatenate([tex, np.broadcast_to(ramp, tex.shape[:2] + (1,))], 2), 'belt.webp', q=90)

# ---- chain strands: plate pixels that differ from the chain-free belt, along each strand
diff = np.abs(src - tex).sum(2)
chainm = np.zeros((H, W)); chainm[BY0:BY1, BX0:BX1] = diff > 70
chainm = ndimage.binary_closing(chainm, iterations=2); chainm = ndimage.binary_dilation(chainm, iterations=2).astype(float)
STRANDS = {'up': ((2096, 946), (2452, 1034)), 'lo': ((2104, 961), (2404, 1058))}
G['chain'] = {}
for k, (a, b) in STRANDS.items():
    a, b = np.array(a, float), np.array(b, float); u = (b - a) / np.linalg.norm(b - a); v = np.array([-u[1], u[0]])
    band = [a - v * 9, b - v * 9, b + v * 9, a + v * 9]
    m = poly_mask(band, feather=0) * chainm
    m = ndimage.gaussian_filter(m, 0.8)
    G['chain'][k] = {'pos': cut(C, m, f'chain-{k}.webp'), 'a': a.tolist(), 'b': b.tolist(), 'period': 49}

# ---- roller print: multiply layer, unwrapped
G['rolls'] = []
for i, (x0, x1, y0, y1) in enumerate([(2150, 2426, 262, 490), (2156, 2420, 548, 778)]):
    R = np.clip((F[y0:y1, x0:x1] + 4) / (C[y0:y1, x0:x1] + 4), 0, 1)
    h = y1 - y0; r = h / 2
    # unwrap: row y sees surface arc s = r*asin((y-yc)/r); resample onto even arc steps
    ys = np.arange(h) + 0.5 - r
    s = r * np.arcsin(np.clip(ys / r, -0.999, 0.999))
    L = int(round(s[-1] - s[0])); se = np.linspace(s[0], s[-1], L)
    U = np.stack([np.stack([np.interp(se, s, R[:, x, c]) for c in range(3)], 1) for x in range(R.shape[1])], 1)
    # seamless loop: cross-fade the last band into the first
    bnd = L // 4; P = L - bnd
    T = U[:P].copy(); wgt = (np.arange(bnd) / bnd)[:, None, None]
    T[:bnd] = U[P:P + bnd] * (1 - wgt) + U[:bnd] * wgt
    save(T * 255, f'roll-{i}.webp', q=92)
    G['rolls'].append({'x': x0, 'y': y0, 'w': x1 - x0, 'h': h, 'r': r, 'period': P})

# ---- sprites: scale to scene size, match the master's colour
def sprite(name, size, ref_box=None, ref_mask=None, crop=None):
    im = Image.open(f'build2/sprite-{name}.webp')
    if crop: im = im.crop(crop)
    im = im.resize(size, Image.LANCZOS)
    a = np.asarray(im).astype(float)
    if ref_mask is not None:
        rgb, al = a[..., :3], a[..., 3] > 200
        ref = F[ref_mask]
        gain = ref.mean(0) / np.maximum(1, rgb[al].mean(0))
        a[..., :3] = rgb * gain
    save(a, f's-{name}.webp', lossless=True)

def disc(cx, cy, r0, r1):
    yy, xx = np.mgrid[0:H, 0:W]; d = np.hypot(xx - cx, yy - cy); return (d >= r0) & (d <= r1)

FLY = {'cx': 1655, 'cy': 861, 'r': 207, 'pin': [1579, 748]}
GEARS = [{'n': 'gear-big-a', 'cx': 2003, 'cy': 814, 'r': 76, 'teeth': 32},
         {'n': 'gear-small', 'cx': 2005, 'cy': 914, 'r': 39, 'teeth': 16},
         {'n': 'gear-big-b', 'cx': 2003, 'cy': 1028, 'r': 82, 'teeth': 32}]
PULLEYS = [[2100, 1111, 41], [2433, 1103, 40], [2612, 1108, 39], [2956, 1108, 39], [3316, 1108, 39], [3464, 1108, 39]]
sprite('flywheel', (2 * FLY['r'],) * 2, ref_mask=disc(FLY['cx'], FLY['cy'], 185, 203))
for g in GEARS: sprite(g['n'], (2 * g['r'],) * 2, ref_mask=disc(g['cx'], g['cy'], g['r'] * 0.45, g['r'] * 0.8))
sprite('pulley', (80, 80), ref_mask=disc(2612, 1108, 20, 36))
sprite('rod', (470, 22), crop=(10, 20, 1070, 112))
sprite('capsule', (50, 109)); sprite('padlock', (160, 99))
for n in ['log0', 'log1', 'log2']: sprite(n, (150, 104))
for n in ['paper0', 'paper1', 'paper2']: sprite(n, (120, 64))
sprite('token', (90, 89))
sprite('conrod', (72, 72), crop=(962, 6, 1246, 286))  # its eye end: the crank boss
G.update(fly=FLY, gears=GEARS, pulleys=PULLEYS, gland=[1368, 812])

json.dump(G, open('build3/scene.json', 'w'), indent=1)
print(json.dumps(G)[:400])

# the card that gets burned: the approved Paper frame (a copy, scaled; the frames themselves are never edited)
Image.open('../../../studio/src/assets/frames/paper.webp').resize((84, 118), Image.LANCZOS).save('build3/card.webp', lossless=True)
