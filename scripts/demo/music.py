"""Background music for video.py, synthesized so the repo needs no audio files or licenses.

Usage:
    python3 music.py <style> <seconds> <out.wav>

Styles:
    upbeat  124 BPM house: four-on-the-floor kick, claps, offbeat bass, pumping chords, arpeggio
    lofi    80 BPM lo-fi hip-hop: swung drums, electric piano 7th chords, soft bass, vinyl crackle
"""

import math
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
rng = np.random.default_rng(7)


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def times(seconds):
    return np.arange(int(seconds * SR)) / SR


def filt(x, kind, freq):
    return sosfilt(butter(2, freq, kind, fs=SR, output="sos"), x)


def saw(f, t, harmonics=16):
    k = np.arange(1, min(harmonics, int(SR / 2 / f)) + 1)[:, None]
    return (np.sin(2 * np.pi * k * f * t) / k).sum(0) * 0.6


def kick(top, decay):
    t = times(0.4)
    return np.sin(2 * np.pi * np.cumsum(45 + top * np.exp(-t / 0.03)) / SR) * np.exp(-t / decay)


def noise_hit(seconds, kind, freq, decay):
    t = times(seconds)
    return filt(rng.standard_normal(len(t)), kind, freq) * np.exp(-t / decay)


def add(buf, x, at, gain=1.0):
    i = int(at * SR)
    if i < len(buf):
        x = x[: len(buf) - i]
        buf[i:i + len(x)] += x * gain


def upbeat(seconds):
    beat = 60 / 124
    bar = 4 * beat
    n = int(seconds * SR)
    drums, synth = np.zeros(n), np.zeros(n)
    k, clap = kick(110, 0.12), noise_hit(0.25, "bandpass", [900, 3000], 0.05)
    hat, open_hat = noise_hit(0.06, "highpass", 7000, 0.012), noise_hit(0.25, "highpass", 6000, 0.06)
    # Am F C G
    chords = [(45, [69, 72, 76]), (41, [69, 72, 77]), (48, [67, 72, 76]), (43, [67, 71, 74])]
    for b in range(math.ceil(seconds / bar)):
        t0 = b * bar
        root, chord = chords[b % 4]
        pad = sum(saw(hz(m) * d, times(bar)) for m in chord for d in (0.995, 1.0, 1.005))
        add(synth, filt(pad, "lowpass", 2600), t0, 0.05)
        for i in range(4):
            add(drums, k, t0 + i * beat, 0.9)
            add(drums, open_hat, t0 + (i + 0.5) * beat, 0.18)
            if i % 2:
                add(drums, clap, t0 + i * beat, 0.45)
            t = times(beat * 0.45)
            add(synth, filt(saw(hz(root), t, 8), "lowpass", 700) * np.exp(-t / 0.12), t0 + (i + 0.5) * beat, 0.5)
        for i in range(16):
            add(drums, hat, t0 + i * beat / 4, 0.08 + 0.05 * (i % 2))
            t = times(0.2)
            note = chord[[0, 1, 2, 1][i % 4]] + 12
            add(synth, saw(hz(note), t, 10) * np.exp(-t / 0.05), t0 + i * beat / 4, 0.05)
    since_beat = (np.arange(n) / SR) % beat
    pump = 1 - 0.7 * np.exp(-since_beat / 0.09)
    return drums + synth * pump


def epiano(f, seconds):
    t = times(seconds)
    tone = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.4)
            + 0.08 * np.sin(6 * np.pi * f * t) * np.exp(-t / 0.15))
    return tone * (1 - np.exp(-t / 0.005)) * np.exp(-t / 1.6) * (1 + 0.08 * np.sin(2 * np.pi * 4.5 * t))


def lofi(seconds):
    beat = 60 / 80
    bar = 4 * beat
    n = int(seconds * SR)
    out = np.zeros(n)
    k = kick(70, 0.2)
    snare = noise_hit(0.3, "bandpass", [1500, 6000], 0.09) * 0.8
    snare[: int(0.3 * SR)] += np.sin(2 * np.pi * 180 * times(0.3)) * np.exp(-times(0.3) / 0.05)
    hat = noise_hit(0.05, "highpass", 6000, 0.018)
    # Fmaj7 Em7 Dm7 Cmaj7
    chords = [(41, [65, 69, 72, 76]), (40, [64, 67, 71, 74]), (38, [62, 65, 69, 72]), (36, [60, 64, 67, 71])]
    for b in range(math.ceil(seconds / bar)):
        t0 = b * bar
        root, chord = chords[b % 4]
        for j, m in enumerate(chord):
            add(out, epiano(hz(m), bar), t0 + j * 0.018, 0.09)
            add(out, epiano(hz(m), 1.5 * beat), t0 + 2.5 * beat + j * 0.018, 0.05)
        for at in (0, 2.5):
            t = times(1.5 * beat)
            add(out, (np.sin(2 * np.pi * hz(root) * t) + 0.2 * np.sin(4 * np.pi * hz(root) * t)) * np.exp(-t / 0.7),
                t0 + at * beat, 0.35)
            add(out, k, t0 + at * beat, 0.6)
        for at in (1, 3):
            add(out, snare, t0 + at * beat, 0.3)
        for i in range(8):
            swing = 0.62 if i % 2 else 0
            add(out, hat, t0 + (i // 2 + swing) * beat, rng.uniform(0.04, 0.08))
    out = filt(out, "lowpass", 4500)
    crackle = np.zeros(n)
    crackle[rng.integers(0, n, int(seconds * 6))] = rng.uniform(0.05, 0.25, int(seconds * 6))
    hiss = filt(rng.standard_normal(n) * 0.004, "bandpass", [1000, 6000])
    return out + filt(crackle, "highpass", 2000) + hiss


def write(style, seconds, path):
    x = np.tanh({"upbeat": upbeat, "lofi": lofi}[style](seconds) * 1.2)
    x = x / np.abs(x).max() * 0.89
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    write(sys.argv[1], float(sys.argv[2]), sys.argv[3])
