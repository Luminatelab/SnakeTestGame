"""
Generates simple retro/chiptune-style sound effects and a looping
background track for the Snake game.

How it works: a square wave (a tone that flips between +1 and -1
many times per second) is the classic building block of old game
console sound chips, which is why it instantly sounds "retro" /
"8-bit." We build each note as a short square wave at a specific
pitch (frequency), and string notes together into simple melodies.

No external libraries or audio files are used — everything here is
generated purely from math, so there's nothing to download and no
licensing to worry about.

Run with: python3 scripts/generate_audio.py
(run it from inside the snake-game folder, so the output paths below
line up with assets/audio/)
"""

import math
import struct
import wave

SAMPLE_RATE = 44100  # samples per second; 44100 is standard CD-quality audio

# Frequencies (in Hz) for a handful of musical notes, using standard
# equal-temperament tuning. Feel free to add more notes here and use
# them in the melodies below if you want to experiment.
NOTES = {
    "A3": 220.00, "C4": 261.63, "D4": 293.66, "E4": 329.63,
    "F4": 349.23, "G4": 392.00, "A4": 440.00, "B4": 493.88,
    "C5": 523.25, "D5": 587.33, "E5": 659.25, "G5": 783.99,
}


def square_wave_samples(freq, duration_sec, volume=0.25, fade_sec=0.01):
    """Builds one note as a list of samples (floats from -1.0 to 1.0)."""
    n_samples = int(SAMPLE_RATE * duration_sec)
    fade_samples = max(1, int(SAMPLE_RATE * fade_sec))
    samples = []

    for i in range(n_samples):
        t = i / SAMPLE_RATE
        # A square wave is +1 for the first half of each cycle and -1
        # for the second half — sin's sign tells us which half we're in.
        value = 1.0 if math.sin(2 * math.pi * freq * t) >= 0 else -1.0

        # Fade in/out briefly at the start/end of the note. Without
        # this, notes "click" audibly when they start and stop.
        if i < fade_samples:
            value *= i / fade_samples
        elif i > n_samples - fade_samples:
            value *= (n_samples - i) / fade_samples

        samples.append(value * volume)

    return samples


def build_melody(note_names, note_duration, volume=0.25):
    """Builds a melody by playing each note in note_names one after another."""
    samples = []
    for name in note_names:
        samples.extend(square_wave_samples(NOTES[name], note_duration, volume=volume))
    return samples


def write_wav(filename, samples):
    """Writes a list of float samples out as a 16-bit mono WAV file."""
    with wave.open(filename, "w") as wav_file:
        wav_file.setnchannels(1)        # mono
        wav_file.setsampwidth(2)        # 16-bit
        wav_file.setframerate(SAMPLE_RATE)
        frames = b"".join(
            struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767))
            for s in samples
        )
        wav_file.writeframes(frames)


OUTPUT_DIR = "assets/audio"

# Same tune for both the menu and in-game tracks (so it's recognizably
# "the same vibe"), just rendered at two different volumes. We bake
# the volume difference directly into the audio samples rather than
# adjusting it in JavaScript at playback time — iOS Safari ignores
# an <audio> element's .volume property set from JavaScript, so this
# is the one approach guaranteed to actually sound quieter everywhere.
MELODY_NOTES = ["A4", "C5", "D4", "E4", "D4", "C5", "A4", "G4"] * 2
NOTE_DURATION = 0.22

# ---- Menu music: full volume -----------------
# `loop` is set in index.html, so this phrase repeats endlessly —
# it just needs to sound good played back-to-back with itself.
menu_melody = build_melody(MELODY_NOTES, NOTE_DURATION, volume=0.25)
write_wav(f"{OUTPUT_DIR}/menu-music.wav", menu_melody)

# ---- Gameplay music: same tune, 75% quieter -----------------
gameplay_melody = build_melody(MELODY_NOTES, NOTE_DURATION, volume=0.0625)
write_wav(f"{OUTPUT_DIR}/gameplay-music.wav", gameplay_melody)

# ---- Eat sound: a quick rising blip -----------------
eat_sound = build_melody(["C5", "E5", "G5"], note_duration=0.09)
write_wav(f"{OUTPUT_DIR}/eat.wav", eat_sound)

# ---- Game-over sound: a short descending tone -----------------
game_over_sound = build_melody(["G4", "E4", "C4", "A3"], note_duration=0.18)
write_wav(f"{OUTPUT_DIR}/game-over.wav", game_over_sound)

print("Done! Generated menu-music.wav, gameplay-music.wav, eat.wav, and game-over.wav in", OUTPUT_DIR)
