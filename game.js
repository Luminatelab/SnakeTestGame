// ============================================================
// SNAKE GAME — NEON ARCADE EDITION
// ============================================================
// The game is built around a simple grid: the canvas is divided
// into equal-sized square cells, and everything (snake segments,
// food) lives at a specific {x, y} cell position rather than a
// raw pixel position. This makes movement and collision checks
// much simpler than working with pixels directly.
//
// All of the visuals below are drawn procedurally with code —
// no image, sprite, or font files are loaded. Even the glow,
// scanlines and particles are just math + canvas drawing.
// ============================================================

// ---- Configuration ----------------------------------------
// Keeping all the "tunable" numbers together at the top makes it
// easy to tweak the game later (e.g. for difficulty levels).
const CELL_SIZE = 20;              // size of one grid cell, in pixels
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const GRID_WIDTH = canvas.width / CELL_SIZE;   // how many cells across
const GRID_HEIGHT = canvas.height / CELL_SIZE; // how many cells down
const STARTING_LENGTH = 3;         // how many segments the snake starts with
const STARTING_SPEED_MS = 120;     // milliseconds between moves (lower = faster)

// ---- Neon synthwave palette --------------------------------
// These are the bright, saturated colours that give the game its
// 80s-arcade look. We keep them named here so the whole mood can
// be re-tinted from one place.
const COLOR_BG_TOP = "#250b52";    // top of the background gradient (deep purple)
const COLOR_BG_BOTTOM = "#070016"; // bottom of the gradient (near-black)
const NEON_CYAN = "#00f0ff";
const NEON_MAGENTA = "#ff2e9a";
const NEON_GREEN = "#39ff14";
const NEON_YELLOW = "#ffe500";
const FOOD_HUE = 320;              // pink/magenta, in HSL "hue" degrees (0-360)

// Font families. We only ever use fonts that ship with the
// operating system, so nothing needs to be downloaded.
const FONT_DISPLAY = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const FONT_MONO = '"Courier New", ui-monospace, monospace';

// ---- DOM references -----------------------------------------
// We reuse the <p id="status"> element from index.html to show
// the score and any messages (like "Game Over"), so the canvas
// only has to worry about drawing the game itself.
const statusEl = document.getElementById("status");
const startButton = document.getElementById("startButton");
const muteButton = document.getElementById("muteButton");
const menuMusic = document.getElementById("menuMusic");
const gameplayMusic = document.getElementById("gameplayMusic");
const eatSound = document.getElementById("eatSound");
const gameOverSound = document.getElementById("gameOverSound");

// ---- Audio / mute -----------------------------------------
// All four <audio> elements live in index.html; here we just
// control *when* they play. Browsers refuse to play any sound
// until the user has clicked/tapped/pressed a key at least once —
// that's why music only starts from the Start button's click
// handler, never automatically on page load.
//
// menuMusic and gameplayMusic are the *same* tune, but rendered as
// two separate audio files at two different volumes (see
// scripts/generate_audio.py) — we switch from one to the other when
// gameplay begins. We do this instead of adjusting one file's
// volume in JavaScript because iOS Safari ignores the .volume
// property set from JavaScript on <audio> elements; baking the
// volume directly into the audio file is the one approach that
// reliably works everywhere.
const MUTE_KEY = "snakeMuted";
let isMuted = localStorage.getItem(MUTE_KEY) === "true";

function applyMuteState() {
  [menuMusic, gameplayMusic, eatSound, gameOverSound].forEach((audio) => {
    audio.muted = isMuted;
  });
  muteButton.textContent = isMuted ? "🔇 Unmute" : "🔊 Mute";
}
applyMuteState();

muteButton.addEventListener("click", () => {
  isMuted = !isMuted;
  localStorage.setItem(MUTE_KEY, String(isMuted));
  applyMuteState();
});

// Plays a short sound effect from the start, even if it was already
// playing a moment ago (e.g. eating food twice quickly).
function playSound(audio) {
  audio.currentTime = 0;
  audio.play().catch(() => {
    // Ignore errors here — e.g. the audio file is missing, or the
    // browser blocked it. The game should keep working either way.
  });
}

// iOS Safari only allows an <audio> element to play without a fresh
// user gesture if that *same* element has already been played
// successfully at least once *directly* inside a real tap/click.
// menuMusic and gameplayMusic get unlocked naturally, since they're
// played right inside the Start button handler / beginPlaying(). The
// short sound effects don't get their first play() call until much
// later (triggered from inside the game loop), so without this they
// get silently blocked forever. We "prime" them here — play silently,
// then immediately pause — right inside a real user gesture.
function primeAudio(audio) {
  audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
    })
    .catch(() => {});
}

// ---- Game state ------------------------------------------
// All of these change as the game is played. Keeping them as
// plain variables (rather than scattering state across the
// codebase) makes it easy to reset everything in resetGame().
let snake;        // array of {x, y} cells, snake[0] is the head
let direction;    // current movement direction: {x, y}
let nextDirection; // direction queued by the most recent keypress
let food;         // {x, y} position of the food
let score;
let isGameOver;
let loopIntervalId; // handle returned by setInterval, used to stop the loop
let isMenuActive = true; // true until the player's very first move

// ---- Visual-effect state -----------------------------------
// These power the procedural eye-candy and are independent of the
// game rules. `particles` are the little sparks that burst when you
// eat; `scorePops` are the floating "+1" texts; `flashAlpha` is a
// quick white screen flash on each bite that fades back to 0.
let particles = [];
let scorePops = [];
let flashAlpha = 0;

// The twinkling starfield is generated once at load and then just
// re-animated every frame, so the stars stay in fixed spots.
const stars = createStarfield(70);

function createStarfield(count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 1.6 + 0.4,     // radius in pixels
      twinkleSpeed: Math.random() * 0.004 + 0.001, // how fast it pulses
      phase: Math.random() * Math.PI * 2,  // random starting point in the pulse
    });
  }
  return result;
}

// ---- High score (persisted in the browser) -----------------------------------------
// localStorage saves simple key/value data directly in the browser,
// and it sticks around between visits (even after closing the tab
// or restarting the browser) until something clears it. It only
// stores strings, so we convert back to a number when reading it.
// This lives outside resetGame() because, unlike score, it should
// NOT reset when a new game starts.
const HIGH_SCORE_KEY = "snakeHighScore";
let highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;

function saveHighScoreIfBeaten() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
  }
}

// ---- Setup / reset -----------------------------------------

function resetGame() {
  // Place the snake in the middle of the grid, laid out horizontally.
  const startX = Math.floor(GRID_WIDTH / 2);
  const startY = Math.floor(GRID_HEIGHT / 2);
  snake = [];
  for (let i = 0; i < STARTING_LENGTH; i++) {
    snake.push({ x: startX - i, y: startY });
  }

  direction = { x: 1, y: 0 };   // start moving right
  nextDirection = direction;
  score = 0;
  isGameOver = false;

  // Clear any leftover visual effects from a previous game.
  particles = [];
  scorePops = [];
  flashAlpha = 0;

  placeFood();
  updateStatusText();

  // Clear any previous game loop before starting a new one, so we
  // never end up with two loops running at once after a restart.
  if (loopIntervalId) clearInterval(loopIntervalId);
  loopIntervalId = setInterval(gameLoop, STARTING_SPEED_MS);
}

// Picks a random empty cell for the food. We keep retrying if the
// random cell happens to land on the snake's body.
function placeFood() {
  let position;
  do {
    position = {
      x: Math.floor(Math.random() * GRID_WIDTH),
      y: Math.floor(Math.random() * GRID_HEIGHT),
    };
  } while (isOnSnake(position));
  food = position;
}

function isOnSnake(position) {
  return snake.some((segment) => segment.x === position.x && segment.y === position.y);
}

// ---- Input handling -----------------------------------------
// We don't change `direction` directly when a key is pressed or a
// swipe is detected. Instead we store the requested direction in
// `nextDirection` and only apply it on the next tick (in update()).
// This avoids bugs where a player could trigger two inputs between
// ticks and reverse directly into the snake's own neck.
//
// Both keyboard and touch input funnel through this single function,
// so the "is this a legal move?" rule only has to live in one place.
function setDirection(requested) {
  if (!requested) return;

  // The very first arrow key / swipe is what actually starts the
  // game, whether or not the player clicked the Start button first.
  if (isMenuActive) {
    beginPlaying(requested);
    return;
  }

  // Prevent reversing directly into yourself (e.g. pressing Left
  // while moving Right). Moving at a right angle is always fine.
  const isReverse =
    requested.x === -direction.x && requested.y === -direction.y;
  if (isReverse) return;

  nextDirection = requested;

  // Restart with a fresh game after a game over.
  if (isGameOver) {
    resetGame();
  }
}

// Called the moment the player actually starts playing: hide the
// Start button, switch from the menu track to the quieter gameplay
// track, and kick off a fresh game already moving in the requested
// direction.
function beginPlaying(requested) {
  isMenuActive = false;
  startButton.hidden = true;

  menuMusic.pause();
  menuMusic.currentTime = 0;
  gameplayMusic.play().catch(() => {});
  // Covers the case where the player moved before ever clicking
  // Start — this keypress/swipe is still a real user gesture, so
  // it can unlock the sound effects too.
  primeAudio(eatSound);
  primeAudio(gameOverSound);

  resetGame();
  nextDirection = requested;
}

startButton.addEventListener("click", () => {
  // This click is the "user interaction" browsers require before
  // any audio is allowed to play.
  menuMusic.play().catch(() => {});
  primeAudio(eatSound);
  primeAudio(gameOverSound);
  startButton.hidden = true;
  statusEl.textContent = "Press an arrow key or swipe to play!";
});

// ---- Keyboard controls -----------------------------------------
document.addEventListener("keydown", handleKeydown);

function handleKeydown(event) {
  const keyToDirection = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
  };

  const requested = keyToDirection[event.key];
  if (!requested) return; // ignore any key that isn't an arrow key

  setDirection(requested);
}

// ---- Touch / swipe controls -----------------------------------------
// We don't have arrow keys on a phone, so instead we track where a
// touch begins and where it ends, then work out the swipe direction
// from the difference between those two points.
const MIN_SWIPE_DISTANCE = 20; // pixels; filters out accidental taps/jitter
let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
canvas.addEventListener("touchend", handleTouchEnd, { passive: true });

// Some mobile browsers (notably iOS Safari) still try to scroll the
// page during a touch drag even with `touch-action: none` in CSS.
// Explicitly blocking the default action on touchmove is the
// reliable cross-browser way to stop that. This listener must be
// "non-passive" (passive: false) for preventDefault() to take effect.
canvas.addEventListener(
  "touchmove",
  (event) => event.preventDefault(),
  { passive: false }
);

function handleTouchStart(event) {
  const touch = event.changedTouches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}

function handleTouchEnd(event) {
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;

  // Ignore tiny movements so a simple tap doesn't get misread as a swipe.
  if (Math.abs(deltaX) < MIN_SWIPE_DISTANCE && Math.abs(deltaY) < MIN_SWIPE_DISTANCE) {
    return;
  }

  // Whichever axis moved further decides if this was a horizontal
  // or vertical swipe; the sign of that delta decides which way.
  let requested;
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    requested = deltaX > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }; // right : left
  } else {
    requested = deltaY > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 }; // down : up
  }

  setDirection(requested);
}

// ---- Game logic loop (movement + rules) ----------------------
// This runs on a slow, steady timer (every STARTING_SPEED_MS) and is
// only responsible for *what happens* — moving the snake one cell,
// checking collisions, eating food. The *drawing* is handled
// separately by the render loop further below, which runs much more
// often so the glow and particles can animate smoothly.
function gameLoop() {
  if (isGameOver) return;
  update();
}

function update() {
  direction = nextDirection;

  const head = snake[0];
  const newHead = { x: head.x + direction.x, y: head.y + direction.y };

  if (hasHitWall(newHead) || isOnSnake(newHead)) {
    endGame();
    return;
  }

  snake.unshift(newHead); // add the new head to the front

  const ateFood = newHead.x === food.x && newHead.y === food.y;
  if (ateFood) {
    score += 1;
    saveHighScoreIfBeaten();
    updateStatusText();
    spawnEatEffects(newHead); // sparks, "+1" pop, screen flash
    placeFood();
    playSound(eatSound);
    // Note: we don't remove the tail here, so the snake grows by one.
  } else {
    snake.pop(); // remove the tail so the snake stays the same length
  }
}

function hasHitWall(position) {
  return (
    position.x < 0 ||
    position.x >= GRID_WIDTH ||
    position.y < 0 ||
    position.y >= GRID_HEIGHT
  );
}

function endGame() {
  isGameOver = true;
  clearInterval(loopIntervalId);
  playSound(gameOverSound);
  statusEl.textContent =
    `Game Over! Score: ${score} | High Score: ${highScore} — press any arrow key to try again`;
}

function updateStatusText() {
  statusEl.textContent = `Score: ${score}  |  High Score: ${highScore}`;
}

// ============================================================
// VISUAL EFFECTS
// ============================================================

// Returns the pixel coordinate of the centre of a grid cell, which
// is where we want sparks and pop-text to appear.
function cellCenter(cell) {
  return {
    x: cell.x * CELL_SIZE + CELL_SIZE / 2,
    y: cell.y * CELL_SIZE + CELL_SIZE / 2,
  };
}

// Fired each time food is eaten: a burst of glowing sparks flying
// outward, a floating "+1", and a brief full-screen flash.
function spawnEatEffects(cell) {
  const center = cellCenter(cell);

  const SPARK_COUNT = 16;
  for (let i = 0; i < SPARK_COUNT; i++) {
    // Send each spark off in a random direction at a random speed.
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.18 + 0.05; // pixels per millisecond
    particles.push({
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,        // 1 = brand new, counts down to 0 = gone
      decay: Math.random() * 0.0018 + 0.0012, // how fast it fades per ms
      size: Math.random() * 2.5 + 1.5,
      // Alternate the spark colours between the two arcade accents.
      color: i % 2 === 0 ? NEON_YELLOW : NEON_MAGENTA,
    });
  }

  scorePops.push({ x: center.x, y: center.y, life: 1, text: "+1" });
  flashAlpha = 0.35; // the white flash starts here and fades each frame
}

// Moves every spark a little, fades it, then draws it as a glowing
// dot. `dt` is the number of milliseconds since the last frame, so
// motion looks the same regardless of the device's frame rate.
function updateAndDrawParticles(dt) {
  ctx.save();
  // "lighter" makes overlapping glows add up to brighter light,
  // which is exactly how real neon/CRT light behaves.
  ctx.globalCompositeOperation = "lighter";

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.97; // a touch of drag so sparks slow down as they age
    p.vy *= 0.97;
    p.life -= p.decay * dt;

    if (p.life <= 0) {
      particles.splice(i, 1); // remove dead sparks from the array
      continue;
    }

    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Draws the floating "+1" texts and slides them upward as they fade.
function updateAndDrawScorePops(dt) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = scorePops.length - 1; i >= 0; i--) {
    const pop = scorePops[i];
    pop.y -= 0.03 * dt;          // drift upward
    pop.life -= 0.0016 * dt;     // fade out

    if (pop.life <= 0) {
      scorePops.splice(i, 1);
      continue;
    }

    ctx.globalAlpha = Math.max(pop.life, 0);
    ctx.font = `bold 20px ${FONT_MONO}`;
    ctx.fillStyle = NEON_YELLOW;
    ctx.shadowColor = NEON_YELLOW;
    ctx.shadowBlur = 12;
    ctx.fillText(pop.text, pop.x, pop.y);
  }
  ctx.restore();
}

// A quick white wash over the whole screen the instant food is eaten.
function drawFlash(dt) {
  if (flashAlpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = flashAlpha;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  flashAlpha = Math.max(0, flashAlpha - 0.004 * dt); // fade back to nothing
}

// ============================================================
// DRAWING THE WORLD
// ============================================================

// The animated neon background: a vertical colour gradient, a
// twinkling starfield, and a glowing grid that lines up with the
// game's cells.
function drawBackground(now) {
  // 1) Gradient fill from deep purple at the top to near-black below.
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, COLOR_BG_TOP);
  gradient.addColorStop(1, COLOR_BG_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2) Twinkling stars. Each star's brightness rises and falls on a
  //    sine wave, offset by its own random "phase" so they don't all
  //    blink in sync.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const star of stars) {
    const twinkle = 0.5 + 0.5 * Math.sin(now * star.twinkleSpeed + star.phase);
    ctx.globalAlpha = 0.25 + twinkle * 0.6;
    ctx.fillStyle = "#bfefff";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 3) The glowing grid. A gentle pulse on its brightness keeps it
  //    feeling "alive" like a real neon sign.
  const gridPulse = 0.06 + 0.03 * Math.sin(now * 0.001);
  ctx.save();
  ctx.strokeStyle = `rgba(0, 240, 255, ${gridPulse})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += CELL_SIZE) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
  }
  for (let y = 0; y <= canvas.height; y += CELL_SIZE) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(canvas.width, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

// A rounded-rectangle helper. Modern browsers have ctx.roundRect
// built in, but we fall back to a manual path just in case, so the
// game never crashes on an older browser.
function fillRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  ctx.fill();
}

// Draws the snake as a row of glowing rounded tiles. The colour
// shifts smoothly from neon green at the head toward cyan at the
// tail, and the head gets a pair of little eyes facing the way it's
// moving.
function drawSnake(now) {
  const inset = 2;            // gap around each tile so the grid shows through
  const size = CELL_SIZE - inset * 2;
  const radius = 5;

  ctx.save();
  for (let i = snake.length - 1; i >= 0; i--) {
    // Draw tail-first so the head ends up on top where segments overlap.
    const segment = snake[i];
    const px = segment.x * CELL_SIZE + inset;
    const py = segment.y * CELL_SIZE + inset;

    // Hue 110 (green) at the head, sliding toward 175 (cyan) at the tail.
    const t = snake.length > 1 ? i / (snake.length - 1) : 0;
    const hue = 110 + t * 65;
    const isHead = i === 0;

    ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
    ctx.shadowBlur = isHead ? 18 : 12;
    ctx.fillStyle = `hsl(${hue}, 100%, ${isHead ? 62 : 52}%)`;
    fillRoundRect(px, py, size, size, radius);

    // A brighter inner core (drawn without glow) gives each tile a
    // lit-from-within look.
    ctx.shadowBlur = 0;
    ctx.fillStyle = `hsla(${hue}, 100%, 85%, 0.55)`;
    fillRoundRect(px + size * 0.22, py + size * 0.22, size * 0.56, size * 0.56, radius * 0.6);
  }
  ctx.restore();

  drawSnakeEyes();
}

// Two glowing eyes on the head, positioned toward whichever way the
// snake is currently heading.
function drawSnakeEyes() {
  const head = snake[0];
  const center = cellCenter(head);
  const eyeOffset = 4;   // how far apart the eyes sit
  const forward = 3;     // how far toward the front they sit

  // Pick the two eye positions based on travel direction.
  let e1, e2;
  if (direction.x !== 0) {
    // Moving left/right: eyes stacked vertically, nudged forward.
    const fx = center.x + direction.x * forward;
    e1 = { x: fx, y: center.y - eyeOffset };
    e2 = { x: fx, y: center.y + eyeOffset };
  } else {
    // Moving up/down: eyes side by side, nudged forward.
    const fy = center.y + direction.y * forward;
    e1 = { x: center.x - eyeOffset, y: fy };
    e2 = { x: center.x + eyeOffset, y: fy };
  }

  ctx.save();
  for (const eye of [e1, e2]) {
    ctx.fillStyle = "#06121a";
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // A tiny bright glint.
    ctx.fillStyle = NEON_CYAN;
    ctx.beginPath();
    ctx.arc(eye.x + 0.6, eye.y - 0.6, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The food: a pulsing magenta orb with a soft halo and a bright
// core, plus a slowly spinning diamond outline for a retro "gem" feel.
function drawFood(now) {
  if (!food) return;
  const center = cellCenter(food);
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.006); // 0..1, breathes in/out
  const baseRadius = CELL_SIZE * 0.32;
  const radius = baseRadius * (1 + pulse * 0.18);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Soft halo using a radial gradient (bright centre, fading to clear).
  const halo = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 2.4);
  halo.addColorStop(0, `hsla(${FOOD_HUE}, 100%, 70%, 0.9)`);
  halo.addColorStop(0.4, `hsla(${FOOD_HUE}, 100%, 55%, 0.35)`);
  halo.addColorStop(1, `hsla(${FOOD_HUE}, 100%, 50%, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Solid glowing orb.
  ctx.shadowColor = `hsl(${FOOD_HUE}, 100%, 60%)`;
  ctx.shadowBlur = 16;
  ctx.fillStyle = `hsl(${FOOD_HUE}, 100%, 60%)`;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Bright white-hot core.
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Spinning diamond outline around the orb.
  ctx.translate(center.x, center.y);
  ctx.rotate(now * 0.0015);
  ctx.strokeStyle = `hsla(${FOOD_HUE}, 100%, 75%, 0.8)`;
  ctx.lineWidth = 1.5;
  const d = radius * 1.7;
  ctx.beginPath();
  ctx.moveTo(0, -d);
  ctx.lineTo(d, 0);
  ctx.lineTo(0, d);
  ctx.lineTo(-d, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// The CRT "screen" overlay, drawn on top of everything: dark
// horizontal scanlines, a soft moving brightness band, and a vignette
// that darkens the corners like a real tube monitor.
function drawScanlines(now) {
  ctx.save();

  // Static scanlines: a thin dark line every few pixels.
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  for (let y = 0; y < canvas.height; y += 3) {
    ctx.fillRect(0, y, canvas.width, 1);
  }

  // A faint bright band that slowly sweeps down the screen.
  const bandY = (now * 0.05) % (canvas.height + 80) - 40;
  const band = ctx.createLinearGradient(0, bandY - 40, 0, bandY + 40);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.5, "rgba(120, 220, 255, 0.05)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, bandY - 40, canvas.width, 80);

  // Vignette: transparent in the middle, dark toward the edges.
  const vignette = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.height * 0.35,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.75
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.restore();
}

// A classic synthwave backdrop, drawn ONLY on the menu screen: a
// banded neon "sun" resting on a glowing horizon, with a perspective
// grid "floor" stretching toward it. We keep this off the actual
// gameplay board so the playing grid stays clean and easy to read.
function drawMenuScene(now) {
  const cx = canvas.width / 2;
  const horizonY = canvas.height * 0.66; // where the "ground" meets the "sky"

  ctx.save();

  // ---- The sun -------------------------------------------------
  // A circle filled top-to-bottom with a hot-yellow → magenta
  // gradient, then sliced by horizontal gaps to get the iconic
  // "venetian blind" banding.
  const sunR = canvas.width * 0.17;
  const sunY = horizonY - sunR * 0.55;

  ctx.save();
  // Clip to the area above the horizon so the sun's glow can't spill
  // onto the floor below.
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, horizonY);
  ctx.clip();

  const sunGrad = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
  sunGrad.addColorStop(0, "#fff2a8");
  sunGrad.addColorStop(0.5, NEON_YELLOW);
  sunGrad.addColorStop(1, NEON_MAGENTA);
  ctx.fillStyle = sunGrad;
  ctx.shadowColor = NEON_MAGENTA;
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(cx, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Punch transparent horizontal strips across the lower half of the
  // sun, getting thicker toward the bottom. "destination-out" erases
  // wherever we draw, leaving see-through gaps.
  ctx.globalCompositeOperation = "destination-out";
  ctx.shadowBlur = 0;
  let bandY = sunY + sunR * 0.12;
  let gap = 2;
  while (bandY < sunY + sunR) {
    ctx.fillRect(cx - sunR, bandY, sunR * 2, gap);
    bandY += gap + 5;
    gap += 0.9; // each gap a little wider than the last
  }
  ctx.restore();

  // ---- The glowing horizon line --------------------------------
  ctx.strokeStyle = NEON_CYAN;
  ctx.shadowColor = NEON_CYAN;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(canvas.width, horizonY);
  ctx.stroke();

  // ---- The perspective floor -----------------------------------
  // Below the horizon we draw a grid that appears to recede into the
  // distance, all converging on a single "vanishing point" at the
  // centre of the horizon — that convergence is what fakes 3D depth.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "hsla(190, 100%, 60%, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();

  // Lines fanning out from the vanishing point down to the bottom edge.
  for (let i = -6; i <= 6; i++) {
    const spread = i / 6;
    ctx.moveTo(cx, horizonY);
    ctx.lineTo(cx + spread * canvas.width * 1.4, canvas.height);
  }

  // Horizontal lines that bunch up toward the horizon and slowly
  // scroll toward the viewer, so the floor looks like it's moving.
  const scroll = (now * 0.00025) % 1;
  for (let i = 0; i < 12; i++) {
    // Squaring `t` packs the lines tightly near the horizon and spreads
    // them out near the bottom — the look of distance.
    const t = (i + scroll) / 12;
    const y = horizonY + (canvas.height - horizonY) * (t * t);
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  ctx.restore();
}

// The attract-mode menu shown before play: the synthwave backdrop
// above, plus a big glowing "SNAKE" title with a retro chromatic-split
// (offset magenta + cyan copies) and a blinking "press start" prompt.
function drawMenu(now) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  drawMenuScene(now); // sun + horizon + perspective floor

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold 60px ${FONT_DISPLAY}`;

  // Draw the title three times, slightly offset, in three colours.
  // The misaligned colour copies mimic the look of an old CRT.
  const wobble = Math.sin(now * 0.004) * 2; // gentle horizontal jitter
  ctx.shadowBlur = 24;

  ctx.fillStyle = NEON_MAGENTA;
  ctx.shadowColor = NEON_MAGENTA;
  ctx.fillText("SNAKE", cx - 3 + wobble, cy - 28);

  ctx.fillStyle = NEON_CYAN;
  ctx.shadowColor = NEON_CYAN;
  ctx.fillText("SNAKE", cx + 3 - wobble, cy - 28);

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 8;
  ctx.fillText("SNAKE", cx, cy - 28);

  // Blinking prompt below the title.
  const blink = 0.55 + 0.45 * Math.sin(now * 0.006);
  ctx.globalAlpha = blink;
  ctx.font = `bold 15px ${FONT_MONO}`;
  ctx.fillStyle = NEON_GREEN;
  ctx.shadowColor = NEON_GREEN;
  ctx.shadowBlur = 12;
  ctx.fillText("▶  PRESS START  /  ARROW KEY  /  SWIPE", cx, cy + 30);

  ctx.globalAlpha = 1;
  ctx.font = `12px ${FONT_MONO}`;
  ctx.fillStyle = NEON_YELLOW;
  ctx.shadowColor = NEON_YELLOW;
  ctx.shadowBlur = 8;
  ctx.fillText(`HI-SCORE  ${String(highScore).padStart(4, "0")}`, cx, cy + 70);
  ctx.restore();
}

// The game-over screen, drawn over the frozen final board.
function drawGameOver(now) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.save();
  // Dim the board behind the text so it reads clearly.
  ctx.fillStyle = "rgba(7, 0, 22, 0.6)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const blink = 0.6 + 0.4 * Math.sin(now * 0.006);
  ctx.font = `bold 40px ${FONT_DISPLAY}`;
  ctx.fillStyle = NEON_MAGENTA;
  ctx.shadowColor = NEON_MAGENTA;
  ctx.shadowBlur = 22 * blink + 6;
  ctx.fillText("GAME OVER", cx, cy - 34);

  ctx.font = `bold 18px ${FONT_MONO}`;
  ctx.fillStyle = NEON_CYAN;
  ctx.shadowColor = NEON_CYAN;
  ctx.shadowBlur = 10;
  ctx.fillText(`SCORE  ${String(score).padStart(4, "0")}`, cx, cy + 6);
  ctx.fillStyle = NEON_YELLOW;
  ctx.shadowColor = NEON_YELLOW;
  ctx.fillText(`HI-SCORE  ${String(highScore).padStart(4, "0")}`, cx, cy + 32);

  ctx.globalAlpha = blink;
  ctx.font = `13px ${FONT_MONO}`;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 8;
  ctx.fillText("PRESS ANY ARROW KEY TO RETRY", cx, cy + 64);
  ctx.restore();
}

// ============================================================
// THE RENDER LOOP
// ============================================================
// requestAnimationFrame asks the browser to call our function once
// before the next screen refresh — usually ~60 times a second. We do
// all drawing here so the glow, particles and background animate
// smoothly, completely separate from the slow game-logic tick above.
let lastFrameTime = performance.now();

function render(now) {
  // `dt` = milliseconds since the previous frame. Capping it stops
  // effects from "teleporting" if the tab was in the background and
  // a huge gap built up.
  const dt = Math.min(now - lastFrameTime, 50);
  lastFrameTime = now;

  drawBackground(now);

  if (isMenuActive) {
    drawMenu(now);
  } else {
    drawFood(now);
    drawSnake(now);
  }

  // Effects run no matter the state, so a final spark burst can
  // finish animating even after the game is over.
  updateAndDrawParticles(dt);
  updateAndDrawScorePops(dt);
  drawFlash(dt);

  drawScanlines(now);

  if (isGameOver) drawGameOver(now);

  requestAnimationFrame(render); // queue up the next frame
}

// ---- Start everything --------------------------------------
// We don't call resetGame() yet — the snake doesn't actually move
// until the player's first key press or swipe (see beginPlaying()).
// We just kick off the render loop, which shows the animated menu
// until then. This also lines up with audio autoplay rules: browsers
// block all sound until a real user interaction has happened.
requestAnimationFrame(render);
