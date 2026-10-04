"""Cut a narrated demo video from the clips that make-videos.sh records.

Usage:
    python3 video.py <storyboard.json> <clips_dir> <out.mp4>

A storyboard (see videos/*.json) has a "style" ("short" is 1080x1920 with big headlines and
word-by-word captions, "long" is 1920x1080 with chapter titles and subtitles), an edge-tts
"voice" and "rate", optional "min_seconds" / "max_seconds" limits, and "segments".
"music" is an audio file (path relative to the storyboard) or a music.py style name;
"music_volume" scales it.

Each segment plays <clips_dir>/<clip>.mp4 from "start" to "end" (source seconds, default:
whole clip) at "speed" while the voice reads "say". The segment lasts until both are done;
a clip that ends first holds its last frame. "title" is the headline, and *words* in it get
the accent color. "focus": [x, y, scale] zooms into the clip, x and y as fractions of it.
Narration is cached in <clips_dir>/tts, so only changed lines are fetched again.
"""

import asyncio
import functools
import hashlib
import json
import os
import re
import subprocess
import sys

import edge_tts
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import music

FPS = 60
LEAD, TAIL = 0.2, 0.5  # seconds of quiet before and after each line
FONT = "/System/Library/Fonts/SFNS.ttf"
ICON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "images", "icon.png")

STYLES = {
    "short": {"size": (1080, 1920), "box": (24, 650, 1056, 1267), "radius": 28,
              "bg": ((10, 12, 28), (44, 16, 84)), "shadow": (0, 0, 0, 170)},
    "long": {"size": (1920, 1080), "box": (190, 20, 1730, 940), "radius": 14,
             "bg": ((250, 251, 253), (230, 234, 242)), "shadow": (20, 24, 32, 90)},
}
YELLOW = (255, 214, 10)
PURPLE = (98, 70, 214)


@functools.lru_cache(None)
def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name(weight)
    return f


def ease(p):
    p = min(max(p, 0.0), 1.0)
    return p * p * (3 - 2 * p)


def ease_out_back(p):
    p = min(max(p, 0.0), 1.0) - 1
    return 1 + 2.70158 * p ** 3 + 1.70158 * p ** 2


def probe(path):
    info = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", path]))
    return float(info["format"]["duration"]), next((s for s in info["streams"] if "width" in s), {})


def narrate(text, voice, rate, cache):
    """Returns (mp3 path, seconds, [(start, end, word)]), fetching from edge-tts once per line."""
    key = hashlib.sha1(f"{voice}|{rate}|{text}".encode()).hexdigest()[:16]
    mp3, meta = os.path.join(cache, key + ".mp3"), os.path.join(cache, key + ".json")
    if not os.path.exists(meta):
        async def fetch():
            words = []
            with open(mp3, "wb") as f:
                async for c in edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary").stream():
                    if c["type"] == "audio":
                        f.write(c["data"])
                    elif c["type"] == "WordBoundary":
                        words.append((c["offset"] / 1e7, (c["offset"] + c["duration"]) / 1e7, c["text"]))
            return words
        os.makedirs(cache, exist_ok=True)
        words = asyncio.run(fetch())
        with open(meta, "w") as f:
            json.dump({"seconds": probe(mp3)[0], "words": words}, f)
    m = json.load(open(meta))
    return mp3, m["seconds"], m["words"]


def phrases(text, words, max_words, max_chars):
    """Groups timed words into caption chunks. Each word keeps the punctuation after it in `text`."""
    low, pos, starts = text.lower(), 0, []
    for _, _, w in words:
        i = low.find(w.lower(), pos)
        starts.append(i if i >= 0 else pos)
        pos = starts[-1] + (len(w) if i >= 0 else 0)
    tokens = [text[a:b].strip() for a, b in zip(starts, starts[1:] + [len(text)])]
    chunks, cur = [], []
    for (t0, t1, _), tok in zip(words, tokens):
        if cur and (len(cur) == max_words or len(" ".join(c[2] for c in cur) + tok) >= max_chars):
            chunks.append(cur)
            cur = []
        cur.append((t0, t1, tok))
        if re.search(r"[.?!]$", tok) or (max_words < 6 and re.search(r"[,:;]$", tok)):
            chunks.append(cur)
            cur = []
    return chunks + [cur] * bool(cur)


class Clip:
    """Reads one clip's frames in order."""

    def __init__(self, path, start):
        _, v = probe(path)
        self.size = (v["width"], v["height"])
        num, den = map(int, v["r_frame_rate"].split("/"))
        self.fps = num / den
        self.proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-ss", str(start), "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            stdout=subprocess.PIPE)
        self.n, self.frame = -1, None

    def at(self, t):
        """Frame at t seconds after start. Past the end, the last frame."""
        size = self.size[0] * self.size[1] * 3
        while self.proc and self.n < int(t * self.fps):
            buf = self.proc.stdout.read(size)
            if len(buf) < size:
                self.close()
                break
            self.frame, self.n = Image.frombytes("RGB", self.size, buf), self.n + 1
        return self.frame

    def close(self):
        if self.proc:
            self.proc.kill()
            self.proc.wait()
            self.proc = None


def background(style):
    st = STYLES[style]
    W, H = st["size"]
    top, bottom = st["bg"]
    bg = Image.composite(Image.new("RGB", (W, H), bottom), Image.new("RGB", (W, H), top),
                         Image.linear_gradient("L").resize((W, H))).convert("RGBA")
    l, t, r, b = st["box"]
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    if style == "short":
        d.ellipse((l - 160, t - 260, r + 160, b + 260), fill=(124, 58, 237, 120))
        glow = glow.filter(ImageFilter.GaussianBlur(140))
        d = ImageDraw.Draw(glow)
    d.rounded_rectangle((l, t + 18, r, b + 18), st["radius"], fill=st["shadow"])
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(28)))
    if style == "short":
        icon = Image.open(ICON).convert("RGBA").resize((76, 76), Image.Resampling.LANCZOS)
        f = font(44, "Bold")
        label = "Fluid Diff  ·  VS Code"
        x = (W - 76 - 20 - f.getlength(label)) / 2
        bg.alpha_composite(icon, (round(x), 186))
        ImageDraw.Draw(bg).text((x + 96, 224), label, font=f, fill=(220, 222, 240), anchor="lm")
    return bg.convert("RGB")


def place(frame, img, box, mask, focus, zoom):
    """Draws img into box, cover-fit, scaled by focus[2] * zoom around (focus[0], focus[1])."""
    l, t, r, b = box
    bw, bh = r - l, b - t
    w, h = img.size
    k = max(bw / w, bh / h) * focus[2] * zoom
    vw, vh = bw / k, bh / k
    x0 = min(max(focus[0] * w - vw / 2, 0), w - vw)
    y0 = min(max(focus[1] * h - vh / 2, 0), h - vh)
    frame.paste(img.resize((bw, bh), Image.Resampling.BICUBIC, box=(x0, y0, x0 + vw, y0 + vh)), (l, t), mask)


@functools.lru_cache(None)
def headline(title):
    """The short's headline as an RGBA image, *accent* words in yellow, wrapped to 980 px."""
    f = font(92, "Heavy")
    space = f.getlength(" ")
    words = [(w, i % 2) for i, part in enumerate(title.split("*")) for w in part.split()]
    lines, cur = [], []
    for w in words:
        if cur and sum(f.getlength(x) for x, _ in cur + [w]) + space * len(cur) > 980:
            lines.append(cur)
            cur = []
        cur.append(w)
    lines.append(cur)
    lh = 112
    layer = Image.new("RGBA", (1080, lh * len(lines) + 40), (0, 0, 0, 0))
    shadow = layer.copy()
    for n, line in enumerate(lines):
        x = (1080 - sum(f.getlength(w) for w, _ in line) - space * (len(line) - 1)) / 2
        for w, accent in line:
            ImageDraw.Draw(shadow).text((x, 20 + n * lh + 8), w, font=f, fill=(0, 0, 0, 200))
            ImageDraw.Draw(layer).text((x, 20 + n * lh), w, font=f, fill=YELLOW if accent else (255, 255, 255))
            x += f.getlength(w) + space
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    shadow.alpha_composite(layer)
    return shadow


def draw_short(frame, seg, lt, title_t, t):
    p = (t - title_t) / 0.28
    layer = headline(seg["title"])
    s = 0.6 + 0.4 * ease_out_back(p)
    if s != 1:
        layer = layer.resize((round(layer.width * s), round(layer.height * s)), Image.Resampling.BILINEAR)
    frame.paste(layer, (round((1080 - layer.width) / 2), round(330 + (264 - layer.height) / 2)), layer)

    chunk = current(seg["chunks"], t)
    if not chunk:
        return
    f = font(80, "Heavy")
    words = [re.sub(r"[.,;:]$", "", w).upper() for _, _, w in chunk]
    space = f.getlength(" ")
    width = sum(f.getlength(w) for w in words) + space * (len(words) - 1)
    x = (1080 - width) / 2
    d = ImageDraw.Draw(frame)
    for (t0, _, _), w in zip(chunk, words):
        lit = t0 <= t
        d.text((x, 1420), w, font=f, anchor="ls", fill=YELLOW if lit else (255, 255, 255),
               stroke_width=7, stroke_fill=(0, 0, 0))
        x += f.getlength(w) + space


def draw_long(frame, seg, lt, title_t, t):
    d = ImageDraw.Draw(frame)
    d.text((960, 974), seg["title"].replace("*", ""), font=font(28, "Bold"), fill=PURPLE, anchor="mm")
    chunk = current(seg["chunks"], t)
    if chunk:
        d.text((960, 1028), " ".join(w for _, _, w in chunk), font=font(38, "Medium"), fill=(36, 40, 50), anchor="mm")


def current(chunks, t):
    """The caption chunk on screen at t: from its first word until the next chunk starts."""
    shown = None
    for i, c in enumerate(chunks):
        end = chunks[i + 1][0][0] if i + 1 < len(chunks) else c[-1][1] + 0.6
        if c[0][0] - 0.05 <= t < end:
            shown = c
    return shown


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    board_path, clips, out = sys.argv[1:]
    board = json.load(open(board_path))
    style = board["style"]
    st = STYLES[style]
    max_words, max_chars = (3, 18) if style == "short" else (14, 72)

    segs, t = [], 0.0
    for s in board["segments"]:
        path = os.path.join(clips, s["clip"] + ".mp4")
        mp3, said, words = narrate(s["say"], board["voice"], board.get("rate", "+0%"), os.path.join(clips, "tts"))
        start, speed = s.get("start", 0), s.get("speed", 1)
        end = s.get("end", probe(path)[0])
        length = max((end - start) / speed, LEAD + said + TAIL)
        timed = [(t + LEAD + a, t + LEAD + b, w) for a, b, w in words]
        segs.append(dict(s, path=path, t0=t, length=length, start=start, speed=speed, end=end, mp3=mp3,
                         chunks=phrases(s["say"], timed, max_words, max_chars)))
        t += length
    total = t
    print(f"{os.path.basename(out)}: {total:.1f}s, {len(segs)} segments")
    if not board.get("min_seconds", 0) <= total <= board.get("max_seconds", 1e9):
        sys.exit(f"{total:.1f}s is outside {board.get('min_seconds', 0)}-{board.get('max_seconds')}s: edit {board_path}")

    W, H = st["size"]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    song = os.path.join(os.path.dirname(board_path), board["music"])
    if not os.path.isfile(song):
        song = os.path.join(clips, f"music-{board['music']}.wav")
        music.write(board["music"], total + 1, song)
    m = len(segs) + 1
    mix = "".join(f"[{i + 1}:a]adelay={round((s['t0'] + LEAD) * 1000)}:all=1[a{i}];" for i, s in enumerate(segs))
    mix += "".join(f"[a{i}]" for i in range(len(segs))) + f"amix=inputs={len(segs)}:normalize=0[voice];"
    # The music stays at one level under the voice, fading in and out only at the ends.
    mix += (f"[{m}:a]volume={board.get('music_volume', 0.15)},afade=t=in:d=0.8,"
            f"afade=t=out:st={max(total - 3, 0):.3f}:d=3[bed];"
            "[voice][bed]amix=inputs=2:normalize=0,apad[a]")
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
        + sum((["-i", s["mp3"]] for s in segs), []) + ["-stream_loop", "-1", "-i", song]
        + ["-filter_complex", mix, "-map", "0:v", "-map", "[a]", "-t", f"{total:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out],
        stdin=subprocess.PIPE)

    bg = background(style)
    l, tp, r, b = st["box"]
    mask = Image.new("L", (r - l, b - tp), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, r - l - 1, b - tp - 1), st["radius"], fill=255)
    draw = draw_short if style == "short" else draw_long

    i, clip, title_t = -1, None, 0.0
    for n in range(round(total * FPS)):
        t = n / FPS
        if i + 1 < len(segs) and t >= segs[i + 1]["t0"]:
            i += 1
            if clip:
                clip.close()
            seg = segs[i]
            clip = Clip(seg["path"], seg["start"])
            if i == 0 or seg["title"] != segs[i - 1]["title"]:
                title_t = seg["t0"]
        lt = t - seg["t0"]
        frame = bg.copy()
        punch = 1 + 0.07 * (1 - ease(lt / 0.3)) if style == "short" else 1
        place(frame, clip.at(min(lt * seg["speed"], seg["end"] - seg["start"])), st["box"], mask,
              seg.get("focus", [0.5, 0.5, 1]), punch)
        draw(frame, seg, lt, title_t, t)
        enc.stdin.write(frame.tobytes())
        if n % (FPS * 10) == 0:
            print(f"  {t:5.1f}s / {total:.1f}s", flush=True)
    clip.close()
    enc.stdin.close()
    if enc.wait():
        sys.exit("ffmpeg failed")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
