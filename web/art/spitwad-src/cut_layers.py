"""Spit-Wad Sniper art: cut the hiding-spot occluders out of the plate, clean the Plank faces, write the game files.

  python3 cut_layers.py            -> web/art/factory/forge/ui/spitwad/ (hall.webp, occ-*.webp, plank-*.webp, scene.json)
  python3 cut_layers.py --preview  -> also preview-*.png here: every spot with Plank fully out (check before shipping)

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

def cut(img, o):
  x0, y0, x1, y1 = o['r']
  if o['cut'] == 'grab': m = grab(img, o['r'])
  else:
    m = np.zeros(img.shape[:2], np.uint8)
    if o['cut'] == 'rect': m[y0:y1, x0:x1] = 255
    else:
      v = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 2]
      dark = (v < o['v']).astype(np.uint8) * 255
      m[y0:y1, x0:x1] = (255 - dark if o['cut'] == 'dark-inverse' else dark)[y0:y1, x0:x1]
      if o['cut'] == 'dark-inverse': m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
  m = cv2.GaussianBlur(m, (3, 3), 0)
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

def main():
  global PLANK_BOX
  os.makedirs(OUT, exist_ok=True)
  spec = json.load(open(os.path.join(HERE, 'spots.json')))
  img = cv2.imread(os.path.join(HERE, 'hall-master.png'))
  Image.open(os.path.join(HERE, 'hall-master.png')).convert('RGB').save(os.path.join(OUT, 'hall.webp'), quality=80)
  occ = {}
  for name, o in spec['occluders'].items():
    rgba = cut(img, o); Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)).save(os.path.join(OUT, f'occ-{name}.webp'), quality=85)
    occ[name] = {'x': o['r'][0], 'y': o['r'][1], 'w': o['r'][2] - o['r'][0], 'h': o['r'][3] - o['r'][1]}
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
