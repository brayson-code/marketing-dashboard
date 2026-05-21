# Mascot sprite assets

Drop your GIFs / frame images here and tell Claude the filenames.

```
public/sprites/
├── claude.gif        ← a single whole-animation GIF works as the bar mascot
├── flag/             ← Flag Waver frames:  frame-01.png … frame-12.png  (12 frames)
├── stomp/            ← Confetti/Stomp frames: frame-01.png … frame-08.png (8 frames)
└── gym/              ← Gym/Lifting frames:  frame-01.png … frame-36.png  (36 frames)
```

- **Whole-animation GIF** → used directly as the dancing mascot on the usage bar.
- **Frame sequences** (PNG, transparent background) → fed into the GSAP sprite-frame
  components (FlagWaver / ConfettiClaude / GymClaude). Frames extracted from a GIF also work.

Reference the path in code as `/sprites/<name>` (the `public/` prefix is dropped at runtime).
