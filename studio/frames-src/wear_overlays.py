"""The PDA wear overlays: one transparent 1500 x 2100 layer per wear level (L2 = PDA 9-8 ... L6 = PDA 1), drawn over
the finished card for every card type alike, framed or Full Art. Real-card wear only: worn card-stock edges and corners,
ink chips, scratches, scuffs, rubbed-off ink, creases, cracks, dents, stains; PDA 1 also water damage, grime and a pen
scribble. The card's shape never changes. Deterministic (fixed seeds): rerunning gives the same files.

Run from studio/:  python3 frames-src/wear_overlays.py      (needs pillow, numpy, scipy)
Writes src/assets/wear/wear-l2.webp ... wear-l6.webp (lossless). Bump FRAMES_UPDATED_AT in src/frames.ts after a change."""
import numpy as np, sys
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as nd
W, H, S, INSET, R = 1500, 2100, 4, 8, 93

def outline():
    m = Image.new('L', (W*S, H*S), 0)
    ImageDraw.Draw(m).rounded_rectangle([INSET*S, INSET*S, (W-INSET)*S-1, (H-INSET)*S-1], radius=R*S, fill=255)
    return np.array(m.resize((W, H), Image.LANCZOS)).astype(np.float32)/255

def noise(rng, scale, octaves=4):
    out = np.zeros((H, W), np.float32); amp = 1; tot = 0
    for o in range(octaves):
        s = max(2, int(scale / 2**o))
        g = rng.random((H//s+2, W//s+2)).astype(np.float32)
        out += amp*np.array(Image.fromarray(g).resize((W + 2*s, H + 2*s), Image.BICUBIC))[:H, :W]; tot += amp; amp *= 0.5
    return out/tot

BASE = outline()
DIST = nd.distance_transform_edt(BASE > 0.5).astype(np.float32)
YY, XX = np.mgrid[:H, :W].astype(np.float32)
CORNER = np.minimum(np.minimum(np.hypot(XX-R, YY-R), np.hypot(W-R-XX, YY-R)), np.minimum(np.hypot(XX-R, H-R-YY), np.hypot(W-R-XX, H-R-YY)))
INCORNER = ((XX < R) | (XX > W-R)) & ((YY < R) | (YY > H-R))
TIP = np.minimum(np.minimum(np.hypot(XX-INSET, YY-INSET), np.hypot(W-INSET-XX, YY-INSET)), np.minimum(np.hypot(XX-INSET, H-INSET-YY), np.hypot(W-INSET-XX, H-INSET-YY)))

def blur(img, r): return np.array(img.filter(ImageFilter.GaussianBlur(r)), np.float32)/255

def level(L, seed=11):
    rng = np.random.default_rng(seed*10 + L)
    t = (L-1)/5                                   # PDA 9-8: 0.2 ... PDA 1: 1
    rgb = np.zeros((H, W, 3), np.float32); a = np.zeros((H, W), np.float32)
    def paint(col, alpha):
        nonlocal rgb, a
        alpha = np.clip(alpha, 0, 1)
        rgb = rgb*(1-alpha[..., None]) + np.array(col, np.float32)*alpha[..., None]
        a = a + alpha*(1-a)
    n_big, n_mid, n_fine = noise(rng, 160), noise(rng, 40), noise(rng, 6, 2)

    # 1. dulled surface: the gloss rubbed off, a faint milky veil (PDA 5 and below)
    if L >= 4:
        paint((235, 232, 225), (0.03 + 0.10*t)*np.clip((n_big - 0.3)*2, 0, 1))

    # 2. scuffs: patches where the surface is rubbed, a haze plus lots of tiny strokes the same way
    sc = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(sc); haze = np.zeros((H, W), np.float32)
    for _ in range({2: 2, 3: 4, 4: 7, 5: 11, 6: 16}[L]):
        cx, cy = rng.uniform(60, W-60), rng.uniform(60, H-60); rx, ry = rng.uniform(40, 200), rng.uniform(30, 140)
        ang0 = rng.uniform(0, np.pi)
        haze += np.clip(1 - np.hypot((XX-cx)/rx, (YY-cy)/ry), 0, 1)**1.5
        for _ in range(int((rx+ry)*(0.5 + 1.0*t))):
            r_, th = np.sqrt(rng.random()), rng.uniform(0, 2*np.pi)
            x, y = cx + rx*r_*np.cos(th), cy + ry*r_*np.sin(th); ang = ang0 + rng.normal(0, 0.12); ln = rng.uniform(3, 14)
            dr.line([x, y, x+ln*np.cos(ang), y+ln*np.sin(ang)], fill=int(rng.uniform(70, 220)), width=1)
    paint((245, 243, 238), np.clip(haze, 0, 1)*(0.10 + 0.12*t)*(0.6 + 0.8*n_mid))
    paint((255, 255, 255), blur(sc, 0.5)*0.35)

    # 3. hairline scratches all over, slightly curved; deeper ones at the lower grades
    for deep in (False, True):
        n = int((4 + 140*t**1.6) if not deep else {4: 2, 5: 5, 6: 9}.get(L, 0))
        lt = Image.new('L', (W, H), 0); dk = Image.new('L', (W, H), 0); dl, dd = ImageDraw.Draw(lt), ImageDraw.Draw(dk)
        for _ in range(n):
            x, y = rng.uniform(20, W-20), rng.uniform(20, H-20); ang = rng.uniform(0, np.pi)
            ln = rng.uniform(40, 260) if not deep else rng.uniform(250, 900); bend = rng.normal(0, 0.0015 if not deep else 0.0006)
            pts = []
            for k in range(24):
                s_ = ln*k/23; th = ang + bend*s_
                pts.append((x + s_*np.cos(th), y + s_*np.sin(th)))
            v = int(rng.uniform(120, 255))
            dl.line(pts, fill=v, width=1 if not deep else 2)
            if deep: dd.line([(px+1.5, py+1.5) for px, py in pts], fill=200, width=2)
        if deep: paint((25, 20, 15), blur(dk, 1.0)*0.35)
        paint((255, 255, 255), blur(lt, 0.4)*(0.55 if not deep else 0.85))

    # 4. ink chips: small white flecks, most near the edges
    ch = Image.new('L', (W, H), 0); dc = ImageDraw.Draw(ch)
    for _ in range(int(10 + 420*t**1.5)):
        near = rng.random() < 0.8
        if near:
            side = rng.integers(0, 4); d = abs(rng.normal(0, 18 + 40*t))
            x, y = [(rng.uniform(0, W), d), (W-d, rng.uniform(0, H)), (rng.uniform(0, W), H-d), (d, rng.uniform(0, H))][side]
        else:
            x, y = rng.uniform(0, W), rng.uniform(0, H)
        r_ = rng.uniform(0.5, 1.4 + 1.6*t)
        dc.ellipse([x-r_, y-r_*rng.uniform(0.5, 1), x+r_, y+r_], fill=255)
    paint((250, 248, 242), blur(ch, 0.5)*BASE)

    # 5. edge wear: the ink worn through to the card stock. Not flat white: fibrous, dirty cream-grey stock, the wear
    #    thinning out inward, a faint shadow where the ink layer lifts at its broken edge
    band = (2.5 + 18*t**1.2 + (14 if L == 6 else 0))*(1 + (1.0 + 1.2*t)*np.exp(-TIP/(50 + 50*t)))   # wider at the corners
    reach = band*(0.25 + 1.5*n_mid)*(0.6 + 0.8*n_fine)
    on = np.clip((n_mid - (0.62 - 0.55*t))*7, 0, 1) + 0.8*np.exp(-TIP/(30 + 30*t))
    # fibres run along the edge: noise stretched along x near the top/bottom, along y near the sides
    raw = rng.random((H, W)).astype(np.float32)
    fx = nd.uniform_filter1d(nd.uniform_filter1d(raw, 15, axis=1), 2, axis=0)
    fy = nd.uniform_filter1d(nd.uniform_filter1d(raw, 15, axis=0), 2, axis=1)
    horiz = np.minimum(YY, H-YY) < np.minimum(XX, W-XX)
    fib = np.where(horiz, fx, fy); fib = (fib - fib.mean())/(fib.std() + 1e-6)
    depth = np.clip((reach - DIST)/np.maximum(reach, 1), 0, 1)               # 1 at the very edge, 0 at the wear line
    cover = np.clip(depth*1.6 + 0.18*fib, 0, 1)*np.clip((reach - DIST)/1.2, 0, 1)*on
    dirt = noise(rng, 18, 3)
    stock = np.dstack([236 - 40*dirt, 230 - 42*dirt, 216 - 46*dirt]) + 10*fib[..., None]   # cream to grubby grey
    lip = np.clip(1 - np.abs(DIST - reach - 1.2)/1.4, 0, 1)*on*(reach > 2)
    paint((40, 30, 22), lip*0.28)                                            # the broken ink edge
    al = np.clip(cover*(0.75 + 0.25*t), 0, 1)
    rgb = rgb*(1-al[..., None]) + stock.clip(0, 255)*al[..., None]; a = a + al*(1-a)
    specks = (rng.random((H, W)) > 0.9975 - 0.003*t) * (cover > 0.3)
    paint((95, 85, 72), nd.uniform_filter(specks.astype(np.float32), 2)*2.5)  # grime caught in the worn stock

    # 7. creases: a cracked white line where the ink broke along the bend, with a soft shadow beside it (one is
    #    always a bent corner)
    for k in range({4: 1, 5: 2, 6: 7}.get(L, 0)):
        if k == 0:   # bent corner: a short crease across one corner
            cx, cy = [(0, 0), (W, 0), (0, H), (W, H)][rng.integers(0, 4)]
            a_ = rng.uniform(150, 280); sx, sy = (1 if cx == 0 else -1), (1 if cy == 0 else -1)
            p0, p1 = (cx + sx*a_, cy), (cx, cy + sy*a_*rng.uniform(0.8, 1.25))
        else:
            side = rng.integers(0, 4)
            p0 = [(rng.uniform(0, W), 0), (W, rng.uniform(0, H)), (rng.uniform(0, W), H), (0, rng.uniform(0, H))][side]
            p1 = (rng.uniform(W*0.15, W*0.85), rng.uniform(H*0.15, H*0.85))
            if (k == 1 and L >= 5) or (k in (2, 3) and L == 6):   # one crease runs right across the card
                p1 = [(rng.uniform(0, W), H), (0, rng.uniform(0, H)), (rng.uniform(0, W), 0), (W, rng.uniform(0, H))][side]
        pts = [(p0[0] + (p1[0]-p0[0])*u + rng.normal(0, 3), p0[1] + (p1[1]-p0[1])*u + rng.normal(0, 3)) for u in np.linspace(0, 1, 40)]
        ln_, sh_ = Image.new('L', (W, H), 0), Image.new('L', (W, H), 0)
        ImageDraw.Draw(ln_).line(pts, fill=255, width=3); ImageDraw.Draw(sh_).line([(x+5, y+4) for x, y in pts], fill=255, width=8)
        paint((20, 15, 10), blur(sh_, 4)*0.22)
        crack = blur(ln_, 0.8)*np.clip((noise(rng, 5, 2) - 0.25)*3, 0, 1)
        paint((252, 250, 244), crack*0.9)

    # 8. dents: small pressed marks catching light on one side
    for _ in range({4: 2, 5: 4, 6: 7}.get(L, 0)):
        cx, cy, rr = rng.uniform(100, W-100), rng.uniform(100, H-100), rng.uniform(6, 16)
        d = np.hypot(XX-cx, YY-cy)
        ring = np.clip(1 - np.abs(d - rr)/2.5, 0, 1)
        paint((255, 255, 255), ring*((XX-cx) + (YY-cy) < 0)*0.6)
        paint((20, 15, 10), ring*((XX-cx) + (YY-cy) >= 0)*0.35)

    # 8b. ink rubbed off in patches across the face: grainy white where the print wore through (PDA 5-4 and below)
    if L >= 4:
        n_patch = noise(rng, 90, 3)
        grain = np.clip((noise(rng, 12, 3) - 0.3)*1.8, 0, 1)
        thr = {4: 0.76, 5: 0.71, 6: 0.58}[L]
        loss = np.clip((n_patch - thr)*7, 0, 1)**1.3*(0.35 + 0.65*grain)*np.clip(DIST/40, 0, 1)
        loss = np.array(Image.fromarray((loss*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32)/255
        paint((246, 243, 236), loss*0.75)
        paint((246, 243, 236), np.clip((n_patch - thr + 0.06)*8, 0, 1)*0.08)       # worn haze around each patch
    # 8c. impact cracks in the surface: short lines radiating from a point (PDA 3 and below)
    for _ in range({5: 1, 6: 4}.get(L, 0)):
        cx, cy = rng.uniform(W*0.2, W*0.8), rng.uniform(H*0.2, H*0.8)
        ck = Image.new('L', (W, H), 0); dk_ = ImageDraw.Draw(ck)
        for _ in range(int(rng.integers(6, 11))):
            th = rng.uniform(0, 2*np.pi); ln = rng.uniform(40, 170); x, y = cx, cy; pts = [(x, y)]
            for _ in range(8):
                th += rng.normal(0, 0.25); x += ln/8*np.cos(th); y += ln/8*np.sin(th); pts.append((x, y))
            dk_.line(pts, fill=255, width=2)
        paint((20, 15, 10), blur(ck, 1.2)*0.25)
        paint((255, 255, 255), blur(ck, 0.4)*0.75)
    # 9. light stains at the worst grades
    for _ in range({5: 1, 6: 5}.get(L, 0)):
        cx, cy, rr = rng.uniform(150, W-150), rng.uniform(150, H-150), rng.uniform(60, 140) * (2.2 if L == 6 else 1)
        d = np.hypot(XX-cx, YY-cy)/(rr*(0.75 + 0.5*n_mid))
        k_ = 1.8 if L == 6 else 1
        paint((140, 105, 60), np.clip(1-d, 0, 1)*0.10*k_ + np.clip(1 - np.abs(d-0.93)*14, 0, 1)*0.18*k_)
    if L == 6:
        # water damage: a big tide-marked area along one side, yellowed and grubby
        side = rng.integers(0, 4); e = [YY, W-XX, H-YY, XX][side]
        reachw = 380 + 260*noise(rng, 220, 3)
        wet = np.clip((reachw - e)/120, 0, 1)
        paint((150, 120, 70), wet*0.22)
        paint((110, 80, 45), np.clip(1 - np.abs(e - reachw)/6, 0, 1)*0.45)
        # grime over the whole face, darkest toward the edges
        paint((60, 48, 35), (0.10 + 0.25*np.clip((140 - DIST)/140, 0, 1))*noise(rng, 70, 3))
        # a pen scribble someone left on it
        pts, x, y, th = [], rng.uniform(W*0.55, W*0.8), rng.uniform(H*0.62, H*0.8), rng.uniform(0, 6)
        for _ in range(60):
            th += rng.normal(0, 0.6); x += 9*np.cos(th); y += 6*np.sin(th); pts.append((x, y))
        pen = Image.new('L', (W, H), 0); ImageDraw.Draw(pen).line(pts, fill=255, width=4)
        paint((25, 40, 110), blur(pen, 1.0)*0.75)

    a = a*BASE
    return np.dstack([rgb.clip(0, 255), a*255]).astype(np.uint8)

if __name__ == '__main__':
    import os
    out = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/wear'
    os.makedirs(out, exist_ok=True)
    for L in range(2, 7):
        Image.fromarray(level(L), 'RGBA').save(f'{out}/wear-l{L}.webp', lossless=True, quality=100, method=6)
        print(f'{out}/wear-l{L}.webp')
