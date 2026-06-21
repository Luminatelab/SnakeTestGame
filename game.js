// ============================================================
// SNAKE GAME
// ============================================================
// The game is built around a simple grid: the canvas is divided
// into equal-sized square cells, and everything (snake segments,
// food) lives at a specific {x, y} cell position rather than a
// raw pixel position. This makes movement and collision checks
// much simpler than working with pixels directly.
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

const COLOR_SNAKE = "#4caf50";
const COLOR_FOOD = "#e53935";
const COLOR_BACKGROUND = "#000000";

// ---- DOM references -----------------------------------------
// We reuse the <p id="status"> element from index.html to show
// the score and any messages (like "Game Over"), so the canvas
// only has to worry about drawing the game itself.
const statusEl = document.getElementById("status");

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

// ---- Main loop -----------------------------------------
// Each tick: move the snake, check what happened, then redraw.
function gameLoop() {
  if (isGameOver) return;

  update();
  draw();
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
    placeFood();
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
  statusEl.textContent =
    `Game Over! Score: ${score} | High Score: ${highScore} — press any arrow key to try again`;
}

function updateStatusText() {
  statusEl.textContent = `Score: ${score}  |  High Score: ${highScore}`;
}

// ---- Drawing -----------------------------------------
function draw() {
  // Clear the whole canvas, then redraw everything from scratch.
  // This is simple and fast enough for a grid this size.
  ctx.fillStyle = COLOR_BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawCell(food, COLOR_FOOD);
  snake.forEach((segment) => drawCell(segment, COLOR_SNAKE));
}

function drawCell(cell, color) {
  ctx.fillStyle = color;
  ctx.fillRect(
    cell.x * CELL_SIZE,
    cell.y * CELL_SIZE,
    CELL_SIZE,
    CELL_SIZE
  );
}

// ---- Start the game -----------------------------------------
resetGame();
draw();
