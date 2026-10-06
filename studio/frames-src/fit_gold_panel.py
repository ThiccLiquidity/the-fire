"""The Gold frames were delivered with their bottom panel starting 45 px (at 750 x 1050) higher than every other
frame's, so the shared art window cut (y 148-770) trimmed off the gold bar between the art and the panel. The owner
approved this fix: the panel is moved down to start where every other frame's does, and the brushed panel interior
under it is squeezed to fit (the bottom rim and everything below it stay exactly as delivered). The side rails over the
freed rows are copied from just above.

  originals/delivered/gold/{clean,l2..l6}.png  (as delivered)  ->  originals[/wear/lN]/gold-holo.png

Run from studio/:  python3 frames-src/fit_gold_panel.py   then   python3 frames-src/clean_frames.py
"""
import os
import numpy as np
from PIL import Image

SRC = 'frames-src/originals/delivered/gold'
TOP = 770  # where every other frame's bottom panel starts (the art window's bottom edge)
RIM = 955  # from here down (the panel's bottom edge and the card rim) nothing moves


def fit(path):
    a = np.array(Image.open(path).convert('RGBA'))
    col = a[:, a.shape[1] // 2, 3]
    top = next(y for y in range(600, 800) if col[y] > 128)  # the delivered panel's top edge (~726)
    out = a.copy()
    panel = Image.fromarray(a[top:RIM]).resize((a.shape[1], RIM - TOP), Image.LANCZOS)
    out[TOP:RIM] = np.array(panel)
    # side rails with the window open between them, over the freed rows and the old window's rounded bottom corners
    for y in range(top - 30, TOP):
        out[y] = a[top - 40]
    return out


if __name__ == '__main__':
    for name in ['clean', 'l2', 'l3', 'l4', 'l5', 'l6']:
        dst = 'frames-src/originals/gold-holo.png' if name == 'clean' else f'frames-src/originals/wear/{name}/gold-holo.png'
        Image.fromarray(fit(os.path.join(SRC, name + '.png'))).save(dst)
        print('ok', dst)
