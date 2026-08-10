const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const walletEl = document.getElementById('wallet');
const livesEl = document.getElementById('lives');
const startBtn = document.getElementById('startBtn');
const overlay = document.getElementById('gameOverlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const achievementItems = [...document.querySelectorAll('[data-achievement]')];
const shopButtons = [...document.querySelectorAll('[data-skin]')];
const shopPanel = document.getElementById('shopPanel');
const shopToggle = document.getElementById('shopToggle');
const closeShopBtn = document.getElementById('closeShop');
const STORAGE_KEY = 'ball-game-progress';

const ballSkins = {
  classic: { cost: 0, color: '#f5a88f', accent: '#ffffff' },
  rose: { cost: 120, color: '#ff9ab0', accent: '#ffe6ef' },
  mint: { cost: 220, color: '#8ae4c4', accent: '#e7fff7' },
  gold: { cost: 380, color: '#f5d05b', accent: '#fff7d6' },
  violet: { cost: 620, color: '#b992ff', accent: '#f1ebff' },
  lava: { cost: 980, color: '#ff7c5e', accent: '#ffe1d8' },
};

const audio = {
  ctx: null,
};

const paddle = {
  width: 180,
  height: 20,
  x: (canvas.width - 180) / 2,
  y: canvas.height - 35,
  speed: 12,
};

const ball = {
  radius: 16,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
};

const state = {
  running: false,
  score: 0,
  wallet: 0,
  totalEarned: 0,
  lives: 3,
  level: 1,
  lastTime: 0,
  enemies: [],
  stars: [],
  won: false,
  unlockedAchievements: new Set(),
  ownedSkins: new Set(['classic']),
  selectedSkin: 'classic',
};

const keys = {
  left: false,
  right: false,
};

const touchState = {
  active: false,
  pointerX: canvas.width / 2,
};

const achievementGoals = [80, 180, 320, 500, 760];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function ensureAudio() {
  if (!audio.ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audio.ctx = new AudioContextClass();
    }
  }

  if (audio.ctx && audio.ctx.state === 'suspended') {
    audio.ctx.resume();
  }
}

function playTone(frequency, duration = 0.12, type = 'sine', volume = 0.04) {
  if (!audio.ctx) {
    ensureAudio();
  }

  if (!audio.ctx) {
    return;
  }

  const oscillator = audio.ctx.createOscillator();
  const gainNode = audio.ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  gainNode.gain.value = volume;
  gainNode.gain.setValueAtTime(volume, audio.ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audio.ctx.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audio.ctx.destination);

  oscillator.start();
  oscillator.stop(audio.ctx.currentTime + duration);
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

function updateAchievements() {
  achievementItems.forEach((item) => {
    const target = Number(item.dataset.achievement);
    const unlocked = state.totalEarned >= target || state.unlockedAchievements.has(target);

    if (unlocked) {
      item.classList.add('unlocked');
      state.unlockedAchievements.add(target);
    } else {
      item.classList.remove('unlocked');
    }
  });
}

function saveProgress() {
  const progress = {
    wallet: state.wallet,
    totalEarned: state.totalEarned,
    ownedSkins: [...state.ownedSkins],
    selectedSkin: state.selectedSkin,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return;
  }

  try {
    const progress = JSON.parse(raw);
    if (Array.isArray(progress.ownedSkins)) {
      state.ownedSkins = new Set(progress.ownedSkins);
    }

    if (progress.selectedSkin && ballSkins[progress.selectedSkin]) {
      state.selectedSkin = progress.selectedSkin;
    }

    if (Number.isFinite(progress.wallet)) {
      state.wallet = progress.wallet;
    }

    if (Number.isFinite(progress.totalEarned)) {
      state.totalEarned = progress.totalEarned;
    }
  } catch (error) {
    console.warn('Local storage data was invalid and was ignored.', error);
  }
}

function toggleShop(forceOpen) {
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : shopPanel.classList.contains('hidden');
  shopPanel.classList.toggle('hidden', !shouldOpen);
}

function updateShopUI() {
  shopButtons.forEach((button) => {
    const skin = button.dataset.skin;
    const skinData = ballSkins[skin];
    const owned = state.ownedSkins.has(skin);
    const selected = state.selectedSkin === skin;

    if (owned && selected) {
      button.textContent = 'مختارة';
      button.disabled = true;
    } else if (owned) {
      button.textContent = 'اختيار';
      button.disabled = false;
    } else {
      button.textContent = `شراء ${skinData.cost}`;
      button.disabled = false;
    }
  });
}

function buyOrSelectSkin(skinKey) {
  const skin = ballSkins[skinKey];

  if (!skin) return;

  if (state.ownedSkins.has(skinKey)) {
    state.selectedSkin = skinKey;
    updateShopUI();
    playTone(540, 0.08, 'triangle', 0.04);
    return;
  }

  if (state.wallet >= skin.cost) {
    state.wallet -= skin.cost;
    state.ownedSkins.add(skinKey);
    state.selectedSkin = skinKey;
    saveProgress();
    updateHud();
    updateShopUI();
    updateAchievements();
    playTone(680, 0.12, 'triangle', 0.05);
  } else {
    playTone(180, 0.12, 'sawtooth', 0.03);
    if (!state.running) {
      showOverlay('رصيد غير كافٍ', `تحتاج إلى ${skin.cost} نقطة لشراء هذه الكرة.`);
    }
  }
}

function createStars() {
  state.stars = [];
  for (let i = 0; i < 40; i += 1) {
    state.stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 2.6 + 1,
      speed: Math.random() * 0.8 + 0.3,
      alpha: Math.random() * 0.6 + 0.2,
    });
  }
}

function updateStars() {
  for (const star of state.stars) {
    star.y += star.speed;
    if (star.y > canvas.height + 10) {
      star.y = -10;
      star.x = Math.random() * canvas.width;
    }
  }
}

function createEnemies() {
  state.enemies = [];
  const maxEnemies = 20;
  const totalEnemies = Math.min(maxEnemies, 4 + state.level * 2);
  const cols = Math.min(5, Math.ceil(Math.sqrt(totalEnemies)));
  const rows = Math.ceil(totalEnemies / cols);
  const enemyWidth = 80;
  const enemyHeight = 24;
  const gapX = 18;
  const gapY = 26;
  const startX = 110;
  const startY = 70;

  for (let index = 0; index < totalEnemies; index += 1) {
    const row = Math.floor(index / cols);
    const col = index % cols;

    state.enemies.push({
      x: startX + col * (enemyWidth + gapX),
      y: startY + row * (enemyHeight + gapY),
      width: enemyWidth,
      height: enemyHeight,
      vx: (1.1 + state.level * 0.18) * (col % 2 === 0 ? 1 : -1),
      alive: true,
      color: row % 2 === 0 ? '#f4a7a4' : '#f5d08c',
    });
  }
}

function resetBall() {
  const levelBoost = state.level * 0.2;
  ball.x = randomBetween(ball.radius + 10, canvas.width - ball.radius - 10);
  ball.y = 40;
  ball.radius = 15 + (state.level > 5 ? 1 : 0);
  ball.vx = randomBetween(-3.1, 3.1) + state.level * 0.12;
  ball.vy = randomBetween(3.2, 4.8) + levelBoost;
}

function updateHud() {
  scoreEl.textContent = state.score;
  walletEl.textContent = state.wallet;
  livesEl.textContent = state.lives;
}

function awardPoints(amount) {
  state.score += amount;
  state.wallet += amount;
  state.totalEarned += amount;
  saveProgress();
  updateHud();
  updateAchievements();
}

function startGame() {
  ensureAudio();
  state.running = true;
  state.score = 0;
  state.lives = 3;
  state.level = 1;
  state.won = false;
  paddle.width = 180;
  paddle.x = (canvas.width - paddle.width) / 2;
  createEnemies();
  updateHud();
  updateAchievements();
  resetBall();
  startBtn.textContent = 'إعادة اللعب';
  hideOverlay();
  playTone(420, 0.14, 'triangle', 0.05);
}

function endGame() {
  state.running = false;
  showOverlay('انتهت اللعبة', `النقاط النهائية: ${state.score}`);
  startBtn.textContent = 'ابدأ من جديد';
  playTone(160, 0.3, 'sawtooth', 0.045);
  setTimeout(() => playTone(120, 0.35, 'square', 0.04), 120);
}

function winGame() {
  state.running = false;
  state.won = true;
  showOverlay('أحسنت! فزت', `لقد أنكيت جميع المستويات بنجاح! النقاط: ${state.score}`);
  startBtn.textContent = 'لعب مرة أخرى';
  playTone(620, 0.12, 'triangle', 0.06);
  setTimeout(() => playTone(780, 0.12, 'triangle', 0.06), 110);
  setTimeout(() => playTone(980, 0.18, 'triangle', 0.06), 220);
}

function loseLife() {
  if (!state.running) {
    return;
  }

  state.lives -= 1;
  updateHud();
  playTone(190, 0.18, 'sawtooth', 0.045);

  if (state.lives <= 0) {
    endGame();
    return;
  }

  resetBall();
}

function updatePaddle() {
  if (keys.left) {
    paddle.x -= paddle.speed;
  }
  if (keys.right) {
    paddle.x += paddle.speed;
  }

  if (touchState.active) {
    paddle.x = touchState.pointerX - paddle.width / 2;
  }

  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
}

function handlePaddleBounce() {
  const hitPoint = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
  const nextVx = hitPoint * (4.8 + state.level * 0.35);
  const baseVy = Math.abs(ball.vy) || 5;
  const nextVy = -(baseVy + 0.55 + state.level * 0.16);

  ball.vx = Math.max(-8.5, Math.min(8.5, nextVx));
  ball.vy = Math.max(-12, Math.min(12, nextVy));
  ball.y = paddle.y - ball.radius - 2;

  state.score += 1;
  state.level = 1 + Math.floor(state.score / 7);

  if (state.level > 9) {
    state.level = 9;
  }

  if (state.score % 6 === 0) {
    paddle.width = Math.max(110, paddle.width - 2);
  }

  awardPoints(2 + Math.floor(state.level / 2));
  playTone(520 + state.level * 18, 0.08, 'triangle', 0.05);
}

function rectCircleCollide(circleX, circleY, radius, rect) {
  const nearestX = Math.max(rect.x, Math.min(circleX, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(circleY, rect.y + rect.height));
  const dx = circleX - nearestX;
  const dy = circleY - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function updateEnemies() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    enemy.x += enemy.vx;

    if (enemy.x <= 30 || enemy.x + enemy.width >= canvas.width - 30) {
      enemy.vx *= -1;
    }

    if (rectCircleCollide(ball.x, ball.y, ball.radius, enemy)) {
      enemy.alive = false;
      ball.vy *= -1;
      ball.vx += enemy.vx * 0.4;
      awardPoints(5 + state.level);
      playTone(670, 0.09, 'square', 0.04);
    }

    const enemyHitsPaddle = enemy.y + enemy.height >= paddle.y && enemy.x + enemy.width > paddle.x && enemy.x < paddle.x + paddle.width;
    if (enemyHitsPaddle && state.running) {
      enemy.alive = false;
      loseLife();
    }
  }

  if (!state.enemies.some((enemy) => enemy.alive)) {
    if (state.score >= 90) {
      winGame();
      return;
    }

    state.level += 1;
    createEnemies();
  }
}

function updateBall() {
  if (!state.running) {
    return;
  }

  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.x - ball.radius <= 0 || ball.x + ball.radius >= canvas.width) {
    ball.vx *= -1;
    playTone(260, 0.06, 'square', 0.025);
  }

  if (ball.y - ball.radius <= 0) {
    ball.vy *= -1;
    playTone(280, 0.06, 'square', 0.025);
  }

  const paddleTop = paddle.y;
  const paddleBottom = paddle.y + paddle.height;
  const inPaddleY = ball.y + ball.radius >= paddleTop && ball.y - ball.radius <= paddleBottom;
  const inPaddleX = ball.x >= paddle.x && ball.x <= paddle.x + paddle.width;

  if (inPaddleY && inPaddleX && ball.vy > 0) {
    handlePaddleBounce();
  }

  if (Math.abs(ball.vx) > 8.5) {
    ball.vx = Math.sign(ball.vx) * 8.5;
  }

  if (Math.abs(ball.vy) > 12) {
    ball.vy = Math.sign(ball.vy) * 12;
  }

  if (ball.y - ball.radius > canvas.height) {
    loseLife();
  }
}

function drawPaddle() {
  const gradient = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x + paddle.width, paddle.y + paddle.height);
  gradient.addColorStop(0, '#f7b693');
  gradient.addColorStop(1, '#f4d7a7');

  ctx.fillStyle = gradient;
  ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);

  ctx.fillStyle = '#fffaf4';
  ctx.fillRect(paddle.x + 12, paddle.y + 5, paddle.width - 24, 6);
}

function drawBall() {
  const skin = ballSkins[state.selectedSkin] || ballSkins.classic;

  ctx.beginPath();
  ctx.fillStyle = skin.color;
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = skin.accent;
  ctx.arc(ball.x - 5, ball.y - 5, 4, 0, Math.PI * 2);
  ctx.arc(ball.x + 5, ball.y - 5, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    ctx.fillStyle = enemy.color;
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(enemy.x, enemy.y, enemy.width, enemy.height);
  }
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#fffaf5');
  gradient.addColorStop(0.45, '#f7e4d2');
  gradient.addColorStop(1, '#f0d8c5');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const star of state.stars) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 18; i += 1) {
    const x = (i * 52 + (state.score * 2)) % canvas.width;
    const y = (i * 31 + state.level * 9) % canvas.height;
    ctx.fillStyle = 'rgba(244, 167, 164, 0.08)';
    ctx.fillRect(x, y, 22, 2);
  }
}

function drawStatusText() {
  if (!state.running) {
    return;
  }

  ctx.fillStyle = '#6a4638';
  ctx.font = '20px Segoe UI';
  ctx.textAlign = 'left';
  ctx.fillText(`المستوى: ${state.level}`, 18, 32);
}

function draw() {
  drawBackground();
  drawEnemies();
  drawPaddle();
  drawBall();
  drawStatusText();
}

function gameLoop() {
  if (state.running) {
    updatePaddle();
    updateBall();
    updateEnemies();
    updateStars();
  }

  draw();
  requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if (event.key === 'ArrowLeft' || key === 'a') {
    keys.left = true;
  }
  if (event.key === 'ArrowRight' || key === 'd') {
    keys.right = true;
  }
  if (event.key === ' ' && !state.running) {
    event.preventDefault();
    startGame();
  }
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();

  if (event.key === 'ArrowLeft' || key === 'a') {
    keys.left = false;
  }
  if (event.key === 'ArrowRight' || key === 'd') {
    keys.right = false;
  }
});

function setPaddleFromPointer(clientX) {
  const rect = canvas.getBoundingClientRect();
  const relativeX = ((clientX - rect.left) / rect.width) * canvas.width;
  touchState.pointerX = relativeX;
  touchState.active = true;
  paddle.x = relativeX - paddle.width / 2;
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

canvas.addEventListener('mousemove', (event) => {
  setPaddleFromPointer(event.clientX);
});

canvas.addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  if (touch) {
    setPaddleFromPointer(touch.clientX);
    event.preventDefault();
  }
}, { passive: false });

canvas.addEventListener('touchmove', (event) => {
  const touch = event.touches[0];
  if (touch) {
    setPaddleFromPointer(touch.clientX);
    event.preventDefault();
  }
}, { passive: false });

canvas.addEventListener('touchend', () => {
  touchState.active = false;
});

startBtn.addEventListener('click', () => {
  startGame();
});

shopToggle.addEventListener('click', () => {
  toggleShop();
});

closeShopBtn.addEventListener('click', () => {
  toggleShop(false);
});

shopButtons.forEach((button) => {
  button.addEventListener('click', () => {
    buyOrSelectSkin(button.dataset.skin);
    saveProgress();
  });
});

if (isMobileDevice()) {
  paddle.width = 150;
  paddle.speed = 16;
}

loadProgress();
createStars();
createEnemies();
updateHud();
updateAchievements();
updateShopUI();
resetBall();
showOverlay('كرة السعادة', 'ابدأ اللعبة، اجمع النقاط، واشتري كرات جديدة. كل كرة جديدة تضيف أسلوبًا خاصًا لك!');
requestAnimationFrame(gameLoop);
