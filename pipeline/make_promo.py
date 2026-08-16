"""Render the Chrome Web Store promotional tiles.

    python pipeline/make_promo.py

Produces both sizes the store accepts:
  screenshots/promo-440x280.png    small tile
  screenshots/promo-1400x560.png   marquee tile

Both are written as 24-bit RGB with NO alpha channel, which the store requires
of promotional images (unlike the extension icons, which keep their alpha).

Reuses the icon's identity: jade ground, cinnabar rule, Batang myeongjo. The
tiles show 國 resolving to its Korean reading, the concept that was too detailed
for a 16px icon but is the clearest one-glance statement of what the extension
does at this size.

Strokes are thickened by square-kernel dilation, never PIL's stroke_width,
which round-caps the myeongjo serifs into sausages. The dilation here is far
lighter than the icons' because 國 has eleven strokes to 玉's five, so the same
ratio would close its counters.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "screenshots"

BATANG = r"C:\Windows\Fonts\batang.ttc"
MALGUN = r"C:\Windows\Fonts\malgun.ttf"
MALGUN_BD = r"C:\Windows\Fonts\malgunbd.ttf"

SS = 4

JADE = (46, 107, 87)
CINNABAR = (184, 64, 47)
WHITE = (255, 255, 255)
MIST = (198, 224, 213)
MIST_DIM = (150, 190, 172)

GLYPH = "\u570b"          # 國
EUMHUN = "\ub098\ub77c \uad6d"   # 나라 국


def paste_glyph(img, xy, text, font, k, colour):
    """Draw text through a dilated single-channel mask, so the square kernel
    thickens strokes without round-capping the serifs."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=font, fill=255)
    if k > 0:
        mask = mask.filter(ImageFilter.MaxFilter(2 * k + 1))
    img.paste(Image.new("RGB", img.size, colour), (0, 0), mask)


def render(width, height, spec):
    w, h = width * SS, height * SS
    img = Image.new("RGB", (w, h), JADE)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=CINNABAR, width=round(spec["rule"] * SS))

    hanja = ImageFont.truetype(BATANG, round(spec["glyph"] * SS), index=0)
    eumhun = ImageFont.truetype(BATANG, round(spec["eumhun"] * SS), index=0)
    name = ImageFont.truetype(MALGUN_BD, round(spec["name"] * SS))
    tag = ImageFont.truetype(MALGUN, round(spec["tag"] * SS))

    # Left: 國 with its eumhun beneath, the extension's own worked example.
    gx, gy = round(spec["gx"] * SS), round(spec["gy"] * SS)
    k = round(spec["dilate"] * SS)
    box = d.textbbox((0, 0), GLYPH, font=hanja)
    paste_glyph(img, (gx - box[0], gy - box[1]), GLYPH, hanja, k, WHITE)
    # Dilation grows the glyph by k on every side, so its visual centre and
    # baseline both sit k outside the measured ink box.
    gw = (box[2] - box[0]) + 2 * k
    gbottom = gy + (box[3] - box[1]) + k
    ebox = d.textbbox((0, 0), EUMHUN, font=eumhun)
    d.text(((gx - k) + (gw - (ebox[2] - ebox[0])) / 2 - ebox[0],
            gbottom + round(spec["gap"] * SS) - ebox[1]),
           EUMHUN, font=eumhun, fill=MIST)

    # Right: wordmark and what it is.
    tx = round(spec["tx"] * SS)
    d.text((tx, round(spec["name_y"] * SS)), "Okpyeon", font=name, fill=WHITE)
    for i, line in enumerate(("Hanja popup dictionary", "for Korean learners")):
        d.text((tx, round((spec["tag_y"] + i * spec["tag_lh"]) * SS)),
               line, font=tag, fill=MIST)

    # Marquee only: room for a line of real vocabulary the character builds.
    if spec.get("examples_y"):
        ex = ImageFont.truetype(MALGUN, round(spec["ex"] * SS))
        d.text((tx, round(spec["examples_y"] * SS)),
               "\uad6d\ubbfc \u570b\u6c11   \u00b7   \ud55c\uad6d \u97d3\u570b"
               "   \u00b7   \uad6d\uac00 \u570b\u5bb6   \u00b7   \uc678\uad6d \u5916\u570b",
               font=ex, fill=MIST_DIM)

    return img.resize((width, height), Image.LANCZOS)


SMALL = dict(rule=7, glyph=96, eumhun=23, name=34, tag=15.5, dilate=0.7,
             gx=46, gy=88, gap=18, tx=196, name_y=96, tag_y=140, tag_lh=23)

MARQUEE = dict(rule=14, glyph=210, eumhun=50, name=76, tag=34, dilate=1.4,
               gx=150, gy=160, gap=38, tx=560, name_y=175, tag_y=278, tag_lh=48,
               examples_y=400, ex=28)


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for (wd, ht, spec) in ((440, 280, SMALL), (1400, 560, MARQUEE)):
        path = OUT_DIR / f"promo-{wd}x{ht}.png"
        img = render(wd, ht, spec)
        assert img.mode == "RGB", f"promo images must have no alpha, got {img.mode}"
        img.save(path, "PNG", optimize=True)
        print(f"{path.name:22s} {img.size[0]}x{img.size[1]}  {img.mode}  "
              f"{path.stat().st_size:,} B")
