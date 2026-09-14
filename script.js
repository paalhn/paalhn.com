document.getElementById('year').textContent = new Date().getFullYear();

/* ---------------- contact form ---------------- */
const form = document.getElementById('contactForm');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('formStatus');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = '';
  statusEl.className = 'status';

  if (document.getElementById('company').value) return; // honeypot tripped, silently drop

  if (APPS_SCRIPT_URL.includes('PASTE_YOUR')) {
    statusEl.textContent = 'Form isn\'t connected yet — see setup notes.';
    statusEl.className = 'status err';
    return;
  }

  const payload = {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim(),
    message: document.getElementById('message').value.trim()
  };

  sendBtn.disabled = true;
  statusEl.textContent = 'Sending…';

  try {
    // text/plain avoids a CORS preflight against Apps Script
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    statusEl.textContent = 'Thanks — message sent.';
    statusEl.className = 'status ok';
    form.reset();
  } catch (err) {
    statusEl.textContent = 'Something went wrong. Try again shortly.';
    statusEl.className = 'status err';
  } finally {
    sendBtn.disabled = false;
  }
});

/* ---------------- pong ---------------- */
const canvas = document.getElementById('pong');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const stage = document.getElementById('stage');
const panelEl = document.getElementById('panel');
const panelHead = document.getElementById('panelHead');
const welcome = document.getElementById('welcome');
const welcomeHeading = document.getElementById('welcomeHeading');
const welcomeSub = document.getElementById('welcomeSub');
const playBtn = document.getElementById('playBtn');
const unlimitedBtn = document.getElementById('unlimitedBtn');
const pauseMsg = document.getElementById('pauseMsg');
const pauseBtn = document.getElementById('pauseBtn');
const hint = document.getElementById('hint');
const contactSection = document.getElementById('contact');
const playAgainBtn = document.getElementById('playAgainBtn');

const PADDLE_W = 12, PADDLE_H = 78, BALL_R = 9, CORNER = 5;
const NET_GAP = 10; // keeps paddles from crossing the halfway line
const PLAYER_MIN_X = 8;
const PLAYER_MAX_X = W/2 - PADDLE_W - NET_GAP;
const CPU_MIN_X = W/2 + NET_GAP;
const CPU_MAX_X = W - 18 - PADDLE_W;
let player = { y: H/2 - PADDLE_H/2, x: 18 };
let cpu = { y: H/2 - PADDLE_H/2, x: CPU_MAX_X };
let ball = { x: W/2, y: H/2, vx: 5, vy: 3 };
let scoreP = 0, scoreC = 0;
let running = false;    // ball/paddles only move while a round is active
let paused = false;     // manual pause, independent of round state
let phase = 'welcome';  // 'welcome' -> 'single' -> 'ended' -> 'unlimited'

function resetBall(dir){
  ball.x = W/2; ball.y = H/2;
  ball.vx = 5 * dir;
  ball.vy = (Math.random() * 4) - 2;
}

/* ---------------- sound fx (soft synth tones, no audio files) ---------------- */
let audioCtx = null;
function ensureAudio(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    audioCtx = new AC();
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, duration, gainPeak, delay){
  if(!audioCtx) return;
  const t0 = audioCtx.currentTime + (delay || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

function hitSound(hit){
  const freq = 470 + (hit || 0) * 70;
  playTone(freq, 0.11, 0.09, 0);
}

function goalSound(playerScored){
  if(playerScored){
    playTone(392, 0.16, 0.11, 0);      // G4
    playTone(523.25, 0.26, 0.10, 0.1); // C5 — ascends
  } else {
    playTone(392, 0.16, 0.10, 0);      // G4
    playTone(293.66, 0.28, 0.09, 0.1); // D4 — descends
  }
}

function roundRect(x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r);
  ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h);
  ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r);
  ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
  ctx.fill();
}

function draw(){
  ctx.clearRect(0,0,W,H);

  // center dashed line
  ctx.strokeStyle = '#E9E8E4';
  ctx.lineWidth = 1;
  ctx.setLineDash([5,9]);
  ctx.beginPath();
  ctx.moveTo(W/2,0); ctx.lineTo(W/2,H);
  ctx.stroke();
  ctx.setLineDash([]);

  // paddles — rounded corners
  ctx.fillStyle = '#1A1A1A';
  roundRect(player.x, player.y, PADDLE_W, PADDLE_H, CORNER);
  roundRect(cpu.x, cpu.y, PADDLE_W, PADDLE_H, CORNER);

  // ball — matches the site icon: outer ring with a filled center dot
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R - 0.8, 0, Math.PI*2);
  ctx.stroke();

  ctx.fillStyle = '#1A1A1A';
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R * 0.42, 0, Math.PI*2);
  ctx.fill();
}

function update(){
  if(!running || paused) return;

  ball.x += ball.vx;
  ball.y += ball.vy;

  if(ball.y - BALL_R < 0){ ball.y = BALL_R; ball.vy *= -1; }
  if(ball.y + BALL_R > H){ ball.y = H - BALL_R; ball.vy *= -1; }

  // player paddle collision
  if(ball.x - BALL_R < player.x + PADDLE_W &&
     ball.x - BALL_R > player.x - 10 &&
     ball.y > player.y && ball.y < player.y + PADDLE_H && ball.vx < 0){
    ball.vx *= -1.06;
    const hit = (ball.y - (player.y + PADDLE_H/2)) / (PADDLE_H/2);
    ball.vy = hit * 6;
    ball.x = player.x + PADDLE_W + BALL_R;
    hitSound(hit);
  }

  // cpu paddle collision
  if(ball.x + BALL_R > cpu.x &&
     ball.x + BALL_R < cpu.x + 10 &&
     ball.y > cpu.y && ball.y < cpu.y + PADDLE_H && ball.vx > 0){
    ball.vx *= -1.06;
    const hit = (ball.y - (cpu.y + PADDLE_H/2)) / (PADDLE_H/2);
    ball.vy = hit * 6;
    ball.x = cpu.x - BALL_R;
    hitSound(hit);
  }

  // cpu ai — imperfect tracking, vertical and sideways
  const target = ball.y - PADDLE_H/2;
  cpu.y += (target - cpu.y) * 0.085;
  cpu.y = Math.max(0, Math.min(H - PADDLE_H, cpu.y));

  const cpuTargetX = ball.vx > 0
    ? CPU_MAX_X - Math.max(0, (ball.x - W/2) / (W/2)) * (CPU_MAX_X - CPU_MIN_X) * 0.4
    : CPU_MAX_X;
  cpu.x += (cpuTargetX - cpu.x) * 0.04;
  cpu.x = Math.max(CPU_MIN_X, Math.min(CPU_MAX_X, cpu.x));

  // scoring
  if(ball.x < -20){ scoreC++; updateScore(); goalSound(false); onPoint(); }
  if(ball.x > W + 20){ scoreP++; updateScore(); goalSound(true); onPoint(); }

  // cap speed
  const speed = Math.hypot(ball.vx, ball.vy);
  const maxSpeed = 13;
  if(speed > maxSpeed){
    ball.vx = (ball.vx/speed) * maxSpeed;
    ball.vy = (ball.vy/speed) * maxSpeed;
  }
}

function updateScore(){
  document.getElementById('scoreP').textContent = scoreP;
  document.getElementById('scoreC').textContent = scoreC;
}

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}

function setPlayerY(clientY){
  const rect = canvas.getBoundingClientRect();
  const scale = H / rect.height;
  const y = (clientY - rect.top) * scale - PADDLE_H/2;
  player.y = Math.max(0, Math.min(H - PADDLE_H, y));
}

canvas.addEventListener('mousemove', (e) => setPlayerY(e.clientY));
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  setPlayerY(e.touches[0].clientY);
}, { passive:false });

const keys = {};
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA') return; // let normal typing through
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','s','a','d'].includes(e.key)) e.preventDefault();
  keys[e.key] = true;
});
window.addEventListener('keyup', (e) => {
  const tag = e.target && e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;
  keys[e.key] = false;
});
setInterval(() => {
  const speed = 9;
  if(keys['ArrowUp'] || keys['w']) player.y = Math.max(0, player.y - speed);
  if(keys['ArrowDown'] || keys['s']) player.y = Math.min(H - PADDLE_H, player.y + speed);
  if(keys['ArrowLeft'] || keys['a']) player.x = Math.max(PLAYER_MIN_X, player.x - speed);
  if(keys['ArrowRight'] || keys['d']) player.x = Math.min(PLAYER_MAX_X, player.x + speed);
}, 16);

/* ---- flow: welcome -> one point -> panel disappears -> contact appears in its place ---- */

function onPoint(){
  if(phase === 'unlimited'){
    // continuous play — points no longer stop the game
    resetBall(Math.random() > 0.5 ? 1 : -1);
    return;
  }

  // first-visit single point: the round ends here, replaced by a result screen
  phase = 'ended';
  running = false;
  pauseBtn.style.display = 'none';

  const win = scoreP > scoreC;
  welcomeHeading.textContent = win ? 'Well done! You win.' : 'Too bad.';
  welcomeSub.textContent = win ? 'The opportunity to get in touch.' : 'You can still get in touch.';
  welcomeSub.style.display = 'block';
  playBtn.textContent = 'Contact';
  unlimitedBtn.style.display = 'inline-block';
  unlimitedBtn.classList.add('show');

  canvas.classList.remove('show');
  welcome.classList.remove('hide');
}

function hidePanel(){
  pauseBtn.style.display = 'none';
  panelEl.classList.add('hide');
  setTimeout(() => { panelEl.style.display = 'none'; }, 420);
}

function showPanel(){
  panelEl.style.display = '';
  requestAnimationFrame(() => panelEl.classList.remove('hide'));
}

function hideContact(){
  contactSection.classList.remove('show');
  setTimeout(() => contactSection.classList.remove('revealed'), 420);
}

function revealContact(){
  if(!contactSection.classList.contains('revealed')){
    contactSection.classList.add('revealed');
    requestAnimationFrame(() => contactSection.classList.add('show'));
  }
  contactSection.scrollIntoView({ behavior:'smooth', block:'start' });
  contactSection.classList.add('pulse');
  setTimeout(() => contactSection.classList.remove('pulse'), 1200);
}

function startUnlimited(){
  phase = 'unlimited';
  scoreP = 0; scoreC = 0; updateScore();
  panelHead.style.display = 'flex';
  welcomeHeading.textContent = 'Welcome';
  welcomeSub.style.display = 'none';
  welcomeSub.textContent = '';
  playBtn.textContent = 'Play';
  unlimitedBtn.style.display = 'none';
  unlimitedBtn.classList.remove('show');
  paused = false;
  pauseBtn.textContent = 'Pause';
  pauseBtn.style.display = '';
  welcome.classList.add('hide');
  canvas.classList.add('show');
  hint.textContent = 'Unlimited — keep going as long as you like.';
  resetBall(Math.random() > 0.5 ? 1 : -1);
  running = true;
}

playBtn.addEventListener('click', () => {
  ensureAudio();
  if(phase === 'welcome'){
    phase = 'single';
    welcome.classList.add('hide');
    canvas.classList.add('show');
    hint.textContent = 'Mouse/drag to move, arrows or WASD to slide sideways.';
    pauseBtn.style.display = '';
    resetBall(Math.random() > 0.5 ? 1 : -1);
    running = true;
  } else if(phase === 'ended'){
    hidePanel();
    revealContact();
  }
});

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseMsg.classList.toggle('show', paused);
});

unlimitedBtn.addEventListener('click', () => {
  ensureAudio();
  startUnlimited();
});

playAgainBtn.addEventListener('click', () => {
  ensureAudio();
  hideContact();
  setTimeout(() => {
    showPanel();
    startUnlimited();
  }, 450);
});

document.getElementById('navContact').addEventListener('click', (e) => {
  e.preventDefault();
  running = false;
  if(panelEl.style.display !== 'none'){
    hidePanel();
  }
  revealContact();
});

// Play button fades in one second after the page is ready
setTimeout(() => playBtn.classList.add('show'), 1000);

draw();
loop();

