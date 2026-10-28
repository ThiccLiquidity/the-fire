"""Spit-Wad Sniper art: cut the hiding-spot occluders out of the plate, clean the Plank faces, write the game files.

  python3 cut_layers.py            -> web/art/factory/forge/ui/spitwad/ (hall.webp, occ-*.webp, plank-*.webp, scene.json)
  python3 cut_layers.py --preview  -> also preview-*.png here: every spot with Plank fully out (check before shipping)
  python3 cut_layers.py --only a,b -> rebuild only those cut-outs (the rest keep their files; grabCut varies run to run)
  python3 cut_layers.py --check    -> only the hit check: at every spot, is at least 95% of the Plank you can see
                                      hittable with a shot in the green notch? (also run after every build)

Needs opencv-python-headless and Pillow. Inputs (this folder): hall-master.png, spots.json, plank-*-raw.png (ChatGPT
faces on a black background, the same body and position as plank-master-raw.png)."""
import glob, json, os, sys
import cv2, numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'factory', 'forge', 'ui', 'spitwad')
F = 768 / np.tan(np.radians(25))  # the plate's camera: 1536 px tall, 50 degree vertical field of view
PLANK_BOX = None                   # the master's box: every face is cropped to it, so they swap pixel for pixel

def grab(img, r, it=10):
  x0, y0, x1, y1 = r; mask = np.zeros(img.shape[:2], np.uint8)
  cv2.grabCut(img, mask, (x0, y0, x1 - x0, y1 - y0), np.zeros((1, 65)), np.zeros((1, 65)), it, cv2.GC_INIT_WITH_RECT)
  m = np.where((mask == 1) | (mask == 3), 255, 0).astype(np.uint8)
  n, lab, st, _ = cv2.connectedComponentsWithStats(m)
  if n > 1: m = np.where(lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
  return cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

def poly_mask(shape, o):
  """A hand-traced cut: o['shapes'] is a list of {poly: [[x, y], ...]}, {ellipse: [cx, cy, rx, ry]} or
  {line: [[x0, y0], [x1, y1]], w: width}, each adding to the mask, or cutting a hole when "sub": true (in order)."""
  m = np.zeros(shape, np.uint8)
  for s in o['shapes']:
    v = 0 if s.get('sub') else 255
    if 'poly' in s: cv2.fillPoly(m, [np.array(s['poly'], np.int32)], v, cv2.LINE_AA)
    elif 'ellipse' in s: cx, cy, rx, ry = s['ellipse']; cv2.ellipse(m, (cx, cy), (rx, ry), 0, 0, 360, v, -1, cv2.LINE_AA)
    elif 'line' in s: (ax, ay), (bx, by) = s['line']; cv2.line(m, (ax, ay), (bx, by), v, s.get('w', 8), cv2.LINE_AA)
  return m

def poly_box(o, pad=3):
  """the cut's box (plate px) from its shapes"""
  xs, ys = [], []
  for s in o['shapes']:
    if s.get('sub'): continue
    if 'poly' in s: xs += [p[0] for p in s['poly']]; ys += [p[1] for p in s['poly']]
    elif 'ellipse' in s: cx, cy, rx, ry = s['ellipse']; xs += [cx - rx, cx + rx]; ys += [cy - ry, cy + ry]
    elif 'line' in s: w = s.get('w', 8); xs += [p[0] + d for p in s['line'] for d in (-w, w)]; ys += [p[1] + d for p in s['line'] for d in (-w, w)]
  return [max(0, min(xs) - pad), max(0, min(ys) - pad), min(1024, max(xs) + pad), min(1536, max(ys) + pad)]

def cut(img, o):
  if o['cut'] == 'poly' and 'r' not in o: o['r'] = poly_box(o)
  x0, y0, x1, y1 = o['r']
  if o['cut'] == 'poly': m = poly_mask(img.shape[:2], o)
  elif o['cut'] == 'grab': m = grab(img, o['r'])
  else:
    m = np.zeros(img.shape[:2], np.uint8)
    if o['cut'] == 'rect': m[y0:y1, x0:x1] = 255
    else:
      v = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 2]
      dark = (v < o['v']).astype(np.uint8) * 255
      m[y0:y1, x0:x1] = (255 - dark if o['cut'] == 'dark-inverse' else dark)[y0:y1, x0:x1]
      if o['cut'] == 'dark-inverse': m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
  if o['cut'] != 'poly': m = cv2.GaussianBlur(m, (3, 3), 0)  # a traced cut is already anti-aliased
  rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA); rgba[:, :, 3] = m
  return rgba[y0:y1, x0:x1]

def clean_plank(path):
  """A face on a black background -> RGBA: the plank's fill, its holes filled, grown back over the black outline."""
  im = cv2.imread(path); hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
  fill = ((hsv[:, :, 2] > 90) & (hsv[:, :, 1] > 40)).astype(np.uint8) * 255
  n, lab, st, _ = cv2.connectedComponentsWithStats(fill); big = st[1:, cv2.CC_STAT_AREA].max()
  body = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 0.01 * big]).astype(np.uint8) * 255
  body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
  cnts, _ = cv2.findContours(body, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); solid = np.zeros_like(body); cv2.drawContours(solid, cnts, -1, 255, -1)
  grown = cv2.dilate(solid, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
  alpha = np.where(solid > 0, 255, np.where((grown > 0) & (hsv[:, :, 2] < 60), 255, 0)).astype(np.uint8)
  alpha = cv2.GaussianBlur(cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), (3, 3), 0)
  rgba = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA); rgba[:, :, 3] = alpha
  return rgba, cv2.boundingRect((alpha > 20).astype(np.uint8))

def plank_rect(s, h, w, rise=1.0, t=0.5):
  """Where Plank is drawn (plate px) and how: (x, y, w, h, flip, tilt). The game draws him the same way."""
  cx = s['cx']
  if s['look'] in ('ride', 'walk'): cx = s['x0'] + (s['x1'] - s['x0']) * t
  if s['look'] == 'lean': return (cx - w / 2 + s['side'] * w * 0.75 * rise, s['bottom'] - h, w, h, False, s['side'] * 10 * rise)
  if s['look'] == 'drop': return (cx - w / 2, s['bottom'] - h + h * 0.8 * rise, w, h, True, 0)
  return (cx - w / 2, s['bottom'] - h * rise, w, h, False, 0)

# ---------- --check: is every bit of Plank you can see hittable? A port of spitwad.js's flight and hit test.
# For each spot, with Plank fully out, every visible pixel (a 2 px grid) is shot at with the breath in the green notch;
# the shot must hit him. An occluder only counts when the game draws it over him (his spot's own cut-outs, or a nearer
# one his box overlaps), the same rule spitwad.js uses to draw and to test. Fails under 95% at any spot.
CHECK_MIN = 95.0
def check(scene_path=None):
  scene = json.load(open(scene_path or os.path.join(OUT, 'scene.json')))
  PL, G, ALPHA, SPAN, PITCH, CAM_Y = 16, 193, np.radians(3), 1440, np.radians(-10), 64
  PW, PH, BACK, Fc = 1024, 1536, 560, scene['plate']['F']
  cp, sp = np.cos(PITCH), np.sin(PITCH)
  occ = {}
  for k, o in scene['occluders'].items():
    a = np.array(Image.open(os.path.join(OUT, f'occ-{k}.webp')).convert('RGBA'))[:, :, 3]
    occ[k] = dict(o, alpha=a)
  occZ = {}
  for s in scene['spots']:
    for o in s['occ']: occZ[o] = min(occZ.get(o, 1e9), s['z'] - 8)
  def alpha_at(o, x, y):
    ix, iy = np.floor(x - o['x']).astype(int), np.floor(y - o['y']).astype(int)
    ok = (ix >= 0) & (iy >= 0) & (ix < o['w']) & (iy < o['h'])
    out = np.zeros(x.shape, np.int32); out[ok] = o['alpha'][iy[ok], ix[ok]]
    return out
  def rect_of(s):
    x, y, w, h, _, tilt = plank_rect(s, s['h'], s['w'], 1.0)
    return dict(x=x, y=y, w=w, h=h, tilt=tilt)
  def in_plank(s, r, x, y, m):
    ok = np.ones(x.shape, bool)
    if 'clip' in s: x0, y0, x1, y1 = s['clip']; ok &= (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
    if s['look'] == 'drop': ok &= y >= s['bottom']
    elif s['look'] in ('pop', 'ride', 'walk'): ok &= y <= s['bottom']
    if r['tilt']:
      cx, cy, an = r['x'] + r['w'] / 2, r['y'] + r['h'] / 2, -np.radians(r['tilt'])
      dx, dy = x - cx, y - cy; qx = dx * np.cos(an) - dy * np.sin(an); qy = dx * np.sin(an) + dy * np.cos(an)
      return ok & (np.abs(qx) <= r['w'] / 2 + m) & (np.abs(qy) <= r['h'] / 2 + m)
    return ok & (x >= r['x'] - m) & (x <= r['x'] + r['w'] + m) & (y >= r['y'] - m) & (y <= r['y'] + r['h'] + m)
  def drawn_over(s, r):
    """the cut-outs the game draws over Plank at this spot (spitwad.js draw())"""
    out = []
    for k, z in occZ.items():
      o = occ.get(k)
      if o is None: continue
      over = r['x'] < o['x'] + o['w'] and r['x'] + r['w'] > o['x'] and r['y'] < o['y'] + o['h'] and r['y'] + r['h'] > o['y']
      if k in s['occ'] or (z < s['z'] and over): out.append(k)
    return out
  def ray(px, py):
    xc, yc = (px - PW / 2) / Fc, -(py - PH / 2) / Fc
    y, z = yc * cp + sp, -yc * sp + cp; l = np.sqrt(xc * xc + y * y + z * z)
    return xc / l, y / l, z / l
  def proj(x, y, z):
    yc = y - CAM_Y; y2 = yc * cp - z * sp; z2 = yc * sp + z * cp; s = Fc / np.maximum(1, z2)
    return PW / 2 + x * s, PH / 2 - y2 * s
  def launch(ax, ay, Z):
    """spitwad.js fire(): 3 degrees over the aim ray, at the speed whose arc crosses that ray at depth Z"""
    dx, dy, dz = ray(ax, ay)
    rx, rz = dz, -dx; rl = np.sqrt(rx * rx + rz * rz); rx, rz = rx / rl, rz / rl
    ux, uy, uz = -rz * dy, rz * dx - rx * dz, rx * dy  # r x d (r has no y)
    flip = np.where(uy < 0, -1.0, 1.0); ux, uy, uz = ux * flip, uy * flip, uz * flip
    ca, sa = np.cos(ALPHA), np.sin(ALPHA)
    vx, vy, vz = dx * ca + ux * sa, dy * ca + uy * sa, dz * ca + uz * sa
    s = Z / dz; v = np.sqrt(s * G * uy * uy / (2 * sa * (ca * uy - dy * sa)))
    return vx * v, vy * v, vz * v
  report, bad = [], []
  for s in scene['spots']:
    r = rect_of(s)
    xs, ys = np.meshgrid(np.arange(r['x'] - 12, r['x'] + r['w'] + 12, 2.0), np.arange(r['y'] - 4, r['y'] + r['h'] + 4, 2.0))
    x, y = xs.ravel(), ys.ravel()
    over = drawn_over(s, r)
    vis = in_plank(s, r, x, y, 0)
    for k in over: vis &= alpha_at(occ[k], x, y) <= 40
    x, y = x[vis], y[vis]
    if not len(x): report.append((s['id'], 0, None, {})); bad.append(s['id']); continue
    cards = sorted([(s['z'], 'plank')] + [(occZ[k], k) for k in over])
    vx, vy, vz = launch(x, y, float(s['z']))
    wx, wy, wz = np.zeros_like(x), np.full_like(x, CAM_Y, dtype=float), np.zeros_like(x)
    res = np.zeros(len(x), np.int8)  # 0 flying, 1 hit Plank, 2 the floor or wall, 3+ the occluder cards[i - 3]
    h = 1 / 480
    for _ in range(480 * 5):
      fly = res == 0
      if not fly.any(): break
      z0 = wz.copy(); vy = np.where(fly, vy - G * h, vy)
      wx = np.where(fly, wx + vx * h, wx); wy = np.where(fly, wy + vy * h, wy); wz = np.where(fly, wz + vz * h, wz)
      for cz, k in cards:
        cross = fly & (res == 0) & (z0 < cz) & (wz >= cz)
        if not cross.any(): continue
        px, py = proj(wx, wy, wz)
        if k == 'plank': res[cross & in_plank(s, r, px, py, 2)] = 1
        else: res[cross & (alpha_at(occ[k], px, py) > 128)] = 3 + [c[1] for c in cards].index(k)
      res[(res == 0) & ((wy < 0) | (wz > BACK))] = 2
    pct = 100 * np.mean(res == 1)
    why = {('floor/wall' if c == 2 else cards[c - 3][1]): int(np.sum(res == c)) for c in set(res.tolist()) if c != 1}
    report.append((s['id'], len(x), pct, why))
    if pct < CHECK_MIN: bad.append(s['id'])
  for sid, n, pct, why in report: print(f'  {sid:10s} {n:5d} visible pts  {"-" if pct is None else f"{pct:5.1f}%"} hittable  {why or ""}')
  if bad: print(f'CHECK FAILED: under {CHECK_MIN}% hittable at {", ".join(bad)}'); sys.exit(1)
  print(f'check ok: every spot is at least {CHECK_MIN}% hittable')

def main():
  global PLANK_BOX
  if '--check' in sys.argv and '--build' not in sys.argv: return check()
  os.makedirs(OUT, exist_ok=True)
  spec = json.load(open(os.path.join(HERE, 'spots.json')))
  img = cv2.imread(os.path.join(HERE, 'hall-master.png'))
  Image.open(os.path.join(HERE, 'hall-master.png')).convert('RGB').save(os.path.join(OUT, 'hall.webp'), quality=80)
  occ = {}
  only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
  for name, o in spec['occluders'].items():
    if o['cut'] == 'poly' and 'r' not in o: o['r'] = poly_box(o)
    occ[name] = {'x': o['r'][0], 'y': o['r'][1], 'w': o['r'][2] - o['r'][0], 'h': o['r'][3] - o['r'][1]}
    if only and name not in only: continue  # keep the file as it is (grabCut can come out a little different each run)
    rgba = cut(img, o); Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)).save(os.path.join(OUT, f'occ-{name}.webp'), quality=85)
  faces = {}
  master, PLANK_BOX = clean_plank(os.path.join(HERE, 'plank-master-raw.png'))
  x, y, w, h = PLANK_BOX
  for path in sorted(glob.glob(os.path.join(HERE, 'plank-*-raw.png'))):
    name = os.path.basename(path)[6:-8]  # plank-<face>-raw.png
    rgba, box = (master, PLANK_BOX) if name == 'master' else clean_plank(path)
    if abs(box[0] - x) > 6 or abs(box[1] - y) > 6 or abs(box[2] - w) > 10 or abs(box[3] - h) > 10: print(f'WARNING {name}: body off the master ({box} vs {PLANK_BOX})')
    im = Image.fromarray(cv2.cvtColor(rgba[y:y + h, x:x + w], cv2.COLOR_BGRA2RGBA)).resize((round(w / 2), round(h / 2)), Image.LANCZOS)
    face = 'idle' if name == 'master' else name; im.save(os.path.join(OUT, f'plank-{face}.webp'), quality=88); faces[face] = f'plank-{face}.webp'
  aspect = w / h
  spots = []
  for s in spec['spots']:
    s = dict(s); s['h'] = round(16 * F / s['z']); s['w'] = round(s['h'] * aspect); spots.append(s)
  scene = {'plate': {'src': 'hall.webp', 'w': 1024, 'h': 1536, 'F': F, 'pitchDeg': -10, 'camY': 64},
           'occluders': occ, 'faces': faces, 'plankAspect': aspect, 'spots': spots}
  json.dump(scene, open(os.path.join(OUT, 'scene.json'), 'w'), indent=1)
  print(f'{len(spots)} spots, {len(occ)} occluders, faces: {", ".join(faces)}')
  if '--preview' in sys.argv: preview(spots, occ)
  check()  # every spot must stay hittable

def preview(spots, occ):
  plank = Image.open(os.path.join(OUT, 'plank-idle.webp'))
  groups = [spots[i::2] for i in range(2)]
  for k, group in enumerate(groups):
    plate = Image.open(os.path.join(HERE, 'hall-master.png')).convert('RGBA')
    items = []
    for s in group:
      items.append((s['z'], 'p', s))
      for o in s['occ']: items.append((s['z'] - 8, 'o', o))
    for z, kind, v in sorted(items, key=lambda t: -t[0]):
      if kind == 'o': plate.alpha_composite(Image.open(os.path.join(OUT, f'occ-{v}.webp')).convert('RGBA'), (occ[v]['x'], occ[v]['y'])); continue
      x, y, w, h, flip, tilt = plank_rect(v, v['h'], v['w'])
      im = plank.resize((v['w'], v['h']), Image.LANCZOS)
      if flip: im = ImageOps.flip(im)
      if tilt: im = im.rotate(-tilt, expand=True, resample=Image.BICUBIC)
      layer = Image.new('RGBA', plate.size); layer.alpha_composite(im, (round(x + w / 2 - im.width / 2), round(y + h / 2 - im.height / 2)))
      if 'clip' in v:
        cx0, cy0, cx1, cy1 = v['clip']; m = Image.new('L', plate.size, 0); m.paste(255, (cx0, cy0, cx1, cy1)); layer.putalpha(Image.composite(layer.getchannel('A'), m, m))
      plate.alpha_composite(layer)
    plate.convert('RGB').save(os.path.join(HERE, f'preview-{k + 1}.png'))
  print('preview-1.png, preview-2.png')

if __name__ == '__main__': main()
