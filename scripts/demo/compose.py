"""Turn raw VS Code window captures into README images.

Usage:
    python3 compose.py still <raw.png> <out.png>
    python3 compose.py gif <frames_dir> <events.jsonl> <cursor.png> <hotspot-x> <hotspot-y> <cursor-width> <out_dir>

`gif` renders evenly timed frames. Each frame uses the latest capture at that moment,
then draws the cursor, click ripples, key badges, and camera zoom from the input.swift log.
Capture times come from the frame files' modification times.
"""

import bisect
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PAD = 120  # white margin around the window, in capture pixels
STILL_WIDTH = 1800
GIF_WIDTH = 1200
GIF_FPS = 15
ZOOM_MS = 750
CURSOR_SCALE = 1.5  # a little larger than life so it reads at GIF size
RIPPLE_MS = 450
BADGE_MS = 1400
FONT = "/System/Library/Fonts/LucidaGrande.ttc"  # SFNS has no ↩ glyph


def window_rect(cap):
    """Bounding box of the opaque window body, without the macOS shadow."""
    return cap.getchannel("A").point(lambda a: 255 if a >= 250 else 0).getbbox()


def make_base(cap):
    """White canvas with a soft shadow, plus where the capture goes on it."""
    l, t, r, b = window_rect(cap)
    canvas = Image.new("RGBA", (r - l + 2 * PAD, b - t + 2 * PAD + 40), "#FFFFFF")
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (PAD, PAD + 24, PAD + r - l, PAD + b - t + 24), radius=24, fill=(20, 24, 32, 110))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(36)))
    return canvas, (PAD - l, PAD - t)


def still(src, dst):
    cap = Image.open(src).convert("RGBA")
    canvas, offset = make_base(cap)
    canvas.alpha_composite(cap, offset)
    w, h = canvas.size
    canvas.convert("RGB").resize((STILL_WIDTH, round(h * STILL_WIDTH / w)), Image.Resampling.LANCZOS).save(dst, optimize=True)


def ease(p):
    p = min(max(p, 0.0), 1.0)
    return p * p * (3 - 2 * p)


def gif(frames_dir, events_path, cursor_path, hot_x, hot_y, cursor_w, out_dir):
    paths = sorted(os.path.join(frames_dir, f) for f in os.listdir(frames_dir) if f.endswith(".png"))
    times = [os.path.getmtime(p) * 1000 for p in paths]
    events = [json.loads(line) for line in open(events_path)]

    first = Image.open(paths[0])
    scale = first.info.get("dpi", (144, 144))[0] / 72  # capture pixels per point
    first = first.convert("RGBA")
    base, (ox, oy) = make_base(first)
    wl, wt, _, _ = window_rect(first)
    W, H = base.size
    out_size = (GIF_WIDTH, round(H * GIF_WIDTH / W))

    def to_canvas(x, y):
        return ox + wl + x * scale, oy + wt + y * scale

    cursor = Image.open(cursor_path).convert("RGBA")
    cw = round(cursor_w * scale * CURSOR_SCALE)
    cursor = cursor.resize((cw, round(cursor.height * cw / cursor.width)), Image.Resampling.LANCZOS)
    hot = (hot_x / cursor_w * cw, hot_y / cursor_w * cw)

    moves = [(e["t"], *to_canvas(*e["cursor"])) for e in events if "cursor" in e]
    move_times = [m[0] for m in moves]
    clicks = [(e["t"], *to_canvas(*e["click"])) for e in events if "click" in e]
    keys = [(e["t"], e["keys"]) for e in events if "keys" in e]

    # Each zoom step eases from wherever the camera is to its target.
    full = (W / 2, H / 2, 1.0)
    shots = []

    def camera(t):
        i = bisect.bisect_right([s[0] for s in shots], t) - 1
        if i < 0:
            return full
        t0, a, b = shots[i]
        k = ease((t - t0) / ZOOM_MS)
        return tuple(a[j] + (b[j] - a[j]) * k for j in range(3))

    for e in events:
        if "zoom" in e:
            x, y, s = e["zoom"]
            shots.append((e["t"], camera(e["t"]), (*to_canvas(x, y), s)))

    def cursor_at(t):
        i = bisect.bisect_right(move_times, t)
        if i == 0:
            return moves[0][1:]
        if i == len(moves):
            return moves[-1][1:]
        (t0, x0, y0), (t1, x1, y1) = moves[i - 1], moves[i]
        k = (t - t0) / max(t1 - t0, 1)
        return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k

    font = ImageFont.truetype(FONT, 34)
    os.makedirs(out_dir, exist_ok=True)
    end = max(times[-1], events[-1]["t"])
    cached = (None, None)
    n = 0
    t = times[0]
    while t <= end:
        i = max(bisect.bisect_right(times, t) - 1, 0)
        if cached[0] != i:
            cached = (i, Image.open(paths[i]).convert("RGBA"))
        frame = base.copy()
        frame.alpha_composite(cached[1], (ox, oy))

        draw = ImageDraw.Draw(frame)
        for tc, x, y in clicks:
            p = (t - tc) / RIPPLE_MS
            if 0 <= p <= 1:
                r = (12 + 30 * ease(p)) * scale
                draw.ellipse((x - r, y - r, x + r, y + r), outline=(60, 140, 255, round(220 * (1 - p))), width=round(3 * scale))
        if moves:
            x, y = cursor_at(t)
            frame.alpha_composite(cursor, (round(x - hot[0]), round(y - hot[1])))

        cx, cy, s = camera(t)
        vw, vh = W / s, H / s
        left = min(max(cx - vw / 2, 0), W - vw)
        top = min(max(cy - vh / 2, 0), H - vh)
        out = frame.resize(out_size, Image.Resampling.LANCZOS, box=(left, top, left + vw, top + vh))

        for tk, label in keys:
            p = (t - tk) / BADGE_MS
            if 0 <= p <= 1:
                fade = min(1.0, (1 - p) * 4)
                overlay = Image.new("RGBA", out.size, (0, 0, 0, 0))
                d = ImageDraw.Draw(overlay)
                tw = d.textlength(label, font=font)
                bx, by = (out.width - tw) / 2, out.height - 110
                d.rounded_rectangle((bx - 26, by - 16, bx + tw + 26, by + 56), radius=18, fill=(30, 30, 30, round(215 * fade)))
                d.text((bx, by), label, font=font, fill=(255, 255, 255, round(255 * fade)))
                out.alpha_composite(overlay)

        out.convert("RGB").save(os.path.join(out_dir, f"{n:05d}.png"))
        n += 1
        t += 1000 / GIF_FPS


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "still":
        still(*sys.argv[2:4])
    elif cmd == "gif":
        a = sys.argv[2:]
        gif(a[0], a[1], a[2], float(a[3]), float(a[4]), float(a[5]), a[6])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
