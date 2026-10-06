// ==================== CONFIG ====================
const GRID = 10;
const CELL = 48;           // canvas = 10*48 = 480
const MAX_ACTIONS = 10;
const BOT_HP = 100;
const BULLET_DMG = 25;
const MOVE_SPEED = 3.5;    // cells per second (animation)
const BULLET_SPEED = 10;   // cells per second

const COLORS = {
  blue:   { fill: '#3b82f6', light: '#93c5fd', name: 'Blue' },
  red:    { fill: '#ef4444', light: '#fca5a5', name: 'Red' },
  green:  { fill: '#22c55e', light: '#86efac', name: 'Green' },
  yellow: { fill: '#eab308', light: '#fde047', name: 'Yellow' }
};
const PLAYER_KEYS = ['blue', 'red', 'green', 'yellow'];

// ==================== STATE ====================
const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');

let playerCount = 2;
let bots = [];
let obstacles = new Set();
let bullets = [];
let phase = 'program'; // program | running | gameover
let currentIdx = 0;    // who is programming
let round = 1;
let queues = {};       // key -> array of {type, dir?, steps?}
let animQueue = [];    // during running: per-bot remaining actions
let scores = {};
let startTime = null;
let totalTurns = 0;
let winnerInfo = null;

// Direction helpers: 0=N, 1=E, 2=S, 3=W
const DIRS = [
  { dx: 0, dy: -1, name: 'Forward' }, // will be relative
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 }
];
// Absolute facing: 0=up, 1=right, 2=down, 3=left
function dirVec(facing) {
  return [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}][facing];
}

// ==================== INIT ====================
function createObstacles() {
  obstacles.clear();
  // Compact obstacles for 10×10
  const blocks = [
    // center block
    [4,4],[5,4],[4,5],[5,5],
    // side pillars
    [2,2],[7,2],
    [2,7],[7,7],
    // small barriers
    [4,1],[5,1],
    [4,8],[5,8],
    [1,4],[1,5],
    [8,4],[8,5]
  ];
  blocks.forEach(([x,y]) => obstacles.add(x + ',' + y));
}

function spawnBots() {
  bots = [];
  const spawns = [
    {x: 0, y: 0, facing: 1},          // blue top-left facing right
    {x: 9, y: 9, facing: 3},          // red bottom-right facing left
    {x: 9, y: 0, facing: 2},          // green top-right facing down
    {x: 0, y: 9, facing: 0}           // yellow bottom-left facing up
  ];
  for (let i = 0; i < playerCount; i++) {
    const key = PLAYER_KEYS[i];
    const s = spawns[i];
    bots.push({
      id: key,
      x: s.x, y: s.y,
      px: s.x, py: s.y,          // pixel/render position (for smooth move)
      facing: s.facing,
      hp: BOT_HP,
      alive: true,
      color: COLORS[key],
      damageDealt: 0,
      kills: 0
    });
    queues[key] = [];
    scores[key] = 0;
  }
}

function resetMatch() {
  playerCount = parseInt(document.getElementById('playerCount').value);
  createObstacles();
  spawnBots();
  phase = 'program';
  currentIdx = 0;
  round = 1;
  bullets = [];
  animQueue = [];
  startTime = Date.now();
  totalTurns = 0;
  winnerInfo = null;
  updateUI();
  log('New match started — ' + playerCount + ' players', '#38bdf8');
  log('Blue programs first. Build up to 10 actions.', '#94a3b8');
}

// ==================== PROGRAMMING ====================
function currentKey() {
  return PLAYER_KEYS[currentIdx];
}

function addMove(relDir) {
  // relDir: 0=forward, 1=right, 2=back, 3=left  (relative to current facing)
  const steps = Math.max(1, Math.min(10, parseInt(document.getElementById('stepNum').value) || 1));
  const q = queues[currentKey()];
  if (q.length >= MAX_ACTIONS) {
    log('Queue full (10/10)', '#f59e0b');
    return;
  }
  // We store the relative command; absolute facing is resolved at runtime
  const names = ['Forward', 'Right', 'Back', 'Left'];
  q.push({ type: 'move', rel: relDir, steps, label: `Move ${names[relDir]} ${steps}` });
  renderQueue();
}

function addShoot() {
  const shots = Math.max(1, Math.min(5, parseInt(document.getElementById('shootNum').value) || 1));
  const q = queues[currentKey()];
  if (q.length >= MAX_ACTIONS) {
    log('Queue full (10/10)', '#f59e0b');
    return;
  }
  q.push({ type: 'shoot', shots, label: `Shoot ×${shots}` });
  renderQueue();
}

function renderQueue() {
  const q = queues[currentKey()] || [];
  const el = document.getElementById('cmdList');
  document.getElementById('queueCount').textContent = `(${q.length}/${MAX_ACTIONS})`;
  if (q.length === 0) {
    el.innerHTML = '<span style="color:#64748b">No commands yet</span>';
    return;
  }
  el.innerHTML = q.map((c, i) =>
    `<div class="cmd-item">
      <span>${i+1}. ${c.label}</span>
      <button class="remove" data-i="${i}">×</button>
    </div>`
  ).join('');
  el.querySelectorAll('.remove').forEach(btn => {
    btn.onclick = () => {
      q.splice(parseInt(btn.dataset.i), 1);
      renderQueue();
    };
  });
}

function undoCmd() {
  const q = queues[currentKey()];
  if (q.length) { q.pop(); renderQueue(); }
}

function clearQueue() {
  queues[currentKey()] = [];
  renderQueue();
}

function playerDone() {
  const q = queues[currentKey()];
  log(`${COLORS[currentKey()].name} locked in ${q.length} actions`, COLORS[currentKey()].fill);
  currentIdx++;
  if (currentIdx >= playerCount) {
    // all done → enable Run
    phase = 'ready';
    currentIdx = 0;
    document.getElementById('btnRun').disabled = false;
    document.getElementById('phaseBanner').textContent = 'All programmed — Press RUN ROUND';
    document.getElementById('phaseBanner').style.background = '#166534';
    log('Everyone ready. Press ▶ RUN ROUND', '#22c55e');
  } else {
    renderQueue();
    updateUI();
    log(`Now programming: ${COLORS[currentKey()].name}`, COLORS[currentKey()].fill);
  }
  updateUI();
}

// ==================== EXECUTION ====================
function startRun() {
  if (phase !== 'ready' && phase !== 'program') return;
  phase = 'running';
  document.getElementById('btnRun').disabled = true;
  document.getElementById('phaseBanner').textContent = 'Executing…';
  document.getElementById('phaseBanner').style.background = '#9a3412';
  totalTurns++;
  round++;

  // Prepare animation state for each bot
  animQueue = bots.map(b => ({
    bot: b,
    cmds: [...(queues[b.id] || [])],
    cmdIdx: 0,
    stepLeft: 0,
    shootLeft: 0,
    cooldown: 0,
    moving: false,
    targetX: b.x,
    targetY: b.y
  }));

  // Clear queues for next round
  PLAYER_KEYS.forEach(k => queues[k] = []);
  log(`--- Round ${round-1} executing ---`, '#f59e0b');
}

function isBlocked(x, y) {
  if (x < 0 || x >= GRID || y < 0 || y >= GRID) return true;
  if (obstacles.has(x + ',' + y)) return true;
  // other living bots
  for (const b of bots) {
    if (b.alive && Math.round(b.x) === x && Math.round(b.y) === y) return true;
  }
  return false;
}

function tryMove(bot, dx, dy) {
  const nx = Math.round(bot.x) + dx;
  const ny = Math.round(bot.y) + dy;
  if (isBlocked(nx, ny)) return false;
  // temporarily ignore self in isBlocked by checking after
  bot.x = nx;
  bot.y = ny;
  return true;
}

function fireBullet(bot) {
  const v = dirVec(bot.facing);
  bullets.push({
    x: bot.x + 0.5,
    y: bot.y + 0.5,
    dx: v.x,
    dy: v.y,
    owner: bot.id,
    alive: true
  });
}

function updateRunning(dt) {
  // Advance each bot's command queue
  let anyActive = false;

  for (const a of animQueue) {
    const bot = a.bot;
    if (!bot.alive) continue;

    // Smooth movement interpolation
    const dist = Math.hypot(a.targetX - bot.px, a.targetY - bot.py);
    if (dist > 0.02) {
      const spd = MOVE_SPEED * dt;
      const mx = (a.targetX - bot.px) / dist * Math.min(spd, dist);
      const my = (a.targetY - bot.py) / dist * Math.min(spd, dist);
      bot.px += mx;
      bot.py += my;
      anyActive = true;
      continue; // wait until arrived before next sub-step
    } else {
      bot.px = a.targetX;
      bot.py = a.targetY;
      bot.x = a.targetX;
      bot.y = a.targetY;
    }

    // Process current command
    if (a.cmdIdx >= a.cmds.length) continue;
    anyActive = true;
    const cmd = a.cmds[a.cmdIdx];

    if (cmd.type === 'move') {
      if (a.stepLeft <= 0) {
        // start this move command: compute new facing
        // rel: 0=fwd, 1=right, 2=back, 3=left
        bot.facing = (bot.facing + cmd.rel) % 4;
        a.stepLeft = cmd.steps;
      }
      if (a.stepLeft > 0) {
        const v = dirVec(bot.facing);
        const nx = Math.round(bot.x) + v.x;
        const ny = Math.round(bot.y) + v.y;
        // check collision ignoring self
        let blocked = (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) || obstacles.has(nx+','+ny);
        if (!blocked) {
          for (const other of bots) {
            if (other.alive && other !== bot && Math.round(other.x) === nx && Math.round(other.y) === ny) {
              blocked = true; break;
            }
          }
        }
        if (!blocked) {
          a.targetX = nx;
          a.targetY = ny;
        }
        a.stepLeft--;
        if (a.stepLeft <= 0) a.cmdIdx++;
      }
    } else if (cmd.type === 'shoot') {
      if (a.shootLeft <= 0) a.shootLeft = cmd.shots;
      if (a.cooldown > 0) {
        a.cooldown -= dt;
      } else if (a.shootLeft > 0) {
        fireBullet(bot);
        a.shootLeft--;
        a.cooldown = 0.25;
        if (a.shootLeft <= 0) a.cmdIdx++;
      }
    }
  }

  // Update bullets
  for (const b of bullets) {
    if (!b.alive) continue;
    b.x += b.dx * BULLET_SPEED * dt;
    b.y += b.dy * BULLET_SPEED * dt;

    const cx = Math.floor(b.x);
    const cy = Math.floor(b.y);
    if (cx < 0 || cx >= GRID || cy < 0 || cy >= GRID || obstacles.has(cx+','+cy)) {
      b.alive = false;
      continue;
    }
    for (const bot of bots) {
      if (!bot.alive || bot.id === b.owner) continue;
      if (Math.abs(bot.px + 0.5 - b.x) < 0.45 && Math.abs(bot.py + 0.5 - b.y) < 0.45) {
        bot.hp -= BULLET_DMG;
        const owner = bots.find(o => o.id === b.owner);
        if (owner) {
          owner.damageDealt += BULLET_DMG;
          scores[owner.id] = (scores[owner.id] || 0) + BULLET_DMG;
        }
        if (bot.hp <= 0) {
          bot.hp = 0;
          bot.alive = false;
          if (owner) owner.kills++;
          log(`${bot.color.name} destroyed by ${owner ? owner.color.name : '?'}!`, bot.color.fill);
        }
        b.alive = false;
        break;
      }
    }
  }
  bullets = bullets.filter(b => b.alive);

  // Check end of round / game
  if (!anyActive && bullets.length === 0) {
    endRound();
  }

  // Win check
  const alive = bots.filter(b => b.alive);
  if (alive.length <= 1) {
    phase = 'gameover';
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (alive.length === 1) {
      winnerInfo = { winner: alive[0].color.name, time: elapsed, turns: totalTurns };
      log(`${alive[0].color.name} WINS! (${elapsed}s, ${totalTurns} rounds)`, '#22c55e');
    } else {
      winnerInfo = { winner: 'Draw', time: elapsed, turns: totalTurns };
      log(`DRAW — all eliminated (${elapsed}s)`, '#f59e0b');
    }
    document.getElementById('phaseBanner').textContent = winnerInfo.winner === 'Draw' ? 'DRAW' : winnerInfo.winner + ' WINS!';
    document.getElementById('phaseBanner').style.background = '#14532d';
  }
}

function endRound() {
  phase = 'program';
  currentIdx = 0;
  document.getElementById('btnRun').disabled = true;
  document.getElementById('phaseBanner').textContent = 'Programming Phase — Round ' + round;
  document.getElementById('phaseBanner').style.background = '#1e40af';
  // reset render positions
  bots.forEach(b => { b.px = b.x; b.py = b.y; });
  renderQueue();
  updateUI();
  log('Round complete. Next programming phase.', '#94a3b8');
}

// ==================== RENDER ====================
function draw() {
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, GRID * CELL);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(GRID * CELL, i * CELL);
    ctx.stroke();
  }

  // Obstacles
  ctx.fillStyle = '#475569';
  for (const key of obstacles) {
    const [x, y] = key.split(',').map(Number);
    ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
  }

  // Bots
  for (const bot of bots) {
    const cx = (bot.px + 0.5) * CELL;
    const cy = (bot.py + 0.5) * CELL;
    const r = CELL * 0.38;

    ctx.globalAlpha = bot.alive ? 1 : 0.3;
    // body
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bot.color.fill;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // facing nose
    const v = dirVec(bot.facing);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + v.x * r * 1.3, cy + v.y * r * 1.3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // HP bar
    if (bot.alive) {
      const bw = CELL * 0.8;
      const bh = 4;
      const bx = cx - bw / 2;
      const by = cy - r - 8;
      ctx.fillStyle = '#334155';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = bot.hp > 40 ? '#22c55e' : bot.hp > 20 ? '#eab308' : '#ef4444';
      ctx.fillRect(bx, by, bw * (bot.hp / BOT_HP), bh);
    }
    ctx.globalAlpha = 1;
  }

  // Bullets
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x * CELL, b.y * CELL, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[b.owner]?.light || '#fff';
    ctx.fill();
  }

  // Game over overlay
  if (phase === 'gameover' && winnerInfo) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(winnerInfo.winner === 'Draw' ? 'DRAW!' : winnerInfo.winner + ' WINS!', canvas.width/2, canvas.height/2 - 20);
    ctx.font = '16px Segoe UI';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Time: ${winnerInfo.time}s   •   Rounds: ${winnerInfo.turns}`, canvas.width/2, canvas.height/2 + 20);
  }
}

// ==================== UI HELPERS ====================
function updateUI() {
  document.getElementById('roundNum').textContent = round;
  const key = currentKey();
  const nameEl = document.getElementById('currentPlayer');
  nameEl.textContent = COLORS[key].name;
  nameEl.style.background = COLORS[key].fill;
  nameEl.style.color = '#fff';

  // Scoreboard
  const sb = document.getElementById('scoreBoard');
  const sorted = [...bots].sort((a,b) => (scores[b.id]||0) - (scores[a.id]||0));
  sb.innerHTML = sorted.map((b, i) => {
    const place = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : '4th';
    return `<div class="stat">
      <span style="color:${b.color.fill}">${place} ${b.color.name} ${b.alive?'':'💀'}</span>
      <span>${scores[b.id]||0} pts • ${b.hp} HP</span>
    </div>`;
  }).join('');

  // Disable programming controls while running
  const progDisabled = phase === 'running' || phase === 'gameover';
  ['btnFwd','btnBack','btnLeft','btnRight','btnAddShoot','btnUndo','btnClear','btnDone'].forEach(id => {
    document.getElementById(id).disabled = progDisabled;
  });
  document.getElementById('playerCount').disabled = phase !== 'program' && phase !== 'ready';
}

function log(msg, color = '#e2e8f0') {
  const el = document.getElementById('log');
  const div = document.createElement('div');
  div.style.color = color;
  div.textContent = msg;
  el.prepend(div);
  while (el.children.length > 40) el.removeChild(el.lastChild);
}

// ==================== EVENTS ====================
document.getElementById('btnFwd').onclick = () => addMove(0);
document.getElementById('btnBack').onclick = () => addMove(2);
document.getElementById('btnLeft').onclick = () => addMove(3);
document.getElementById('btnRight').onclick = () => addMove(1);
document.getElementById('btnAddShoot').onclick = addShoot;
document.getElementById('btnUndo').onclick = undoCmd;
document.getElementById('btnClear').onclick = clearQueue;
document.getElementById('btnDone').onclick = playerDone;
document.getElementById('btnRun').onclick = startRun;
document.getElementById('btnReset').onclick = resetMatch;
document.getElementById('playerCount').onchange = resetMatch;

// ==================== LOOP ====================
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (phase === 'running') updateRunning(dt);
  draw();
  requestAnimationFrame(loop);
}

// Start
resetMatch();
requestAnimationFrame(loop);
    
