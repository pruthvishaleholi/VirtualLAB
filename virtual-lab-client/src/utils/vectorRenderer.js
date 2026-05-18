// ── Vector Rendering Utilities ─────────────────────────────────────────────────
// Pure drawing functions for physics overlays on the Matter.js canvas context.

const ARROW_HEAD = 10;
const MIN_LEN = 4;

const COLORS = {
  force:        '#ef4444',
  velocity:     '#3b82f6',
  acceleration: '#22c55e',
  selection:    '#0f766e',
};

const SCALE = {
  velocity:     12,
  acceleration: 60,
};

/* ── Core arrow ──────────────────────────────────────────────────────────────── */
export function drawArrow(ctx, fx, fy, tx, ty, color, lw = 2) {
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy);
  if (len < MIN_LEN) return;

  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.globalAlpha = 0.85;

  // Shaft
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - ARROW_HEAD * Math.cos(angle - Math.PI / 7), ty - ARROW_HEAD * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(tx - ARROW_HEAD * Math.cos(angle + Math.PI / 7), ty - ARROW_HEAD * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ── Label ───────────────────────────────────────────────────────────────────── */
function drawLabel(ctx, x, y, text, color) {
  ctx.save();
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, x + 6, y - 6);
  ctx.restore();
}

/* ── Velocity Vectors ────────────────────────────────────────────────────────── */
export function drawVelocityVectors(ctx, bodies) {
  for (const b of bodies) {
    if (b.isStatic) continue;
    const { x, y } = b.position;
    const vx = b.velocity.x * SCALE.velocity;
    const vy = b.velocity.y * SCALE.velocity;
    if (Math.hypot(vx, vy) < MIN_LEN) continue;
    drawArrow(ctx, x, y, x + vx, y + vy, COLORS.velocity);
    const mag = Math.hypot(b.velocity.x, b.velocity.y).toFixed(1);
    drawLabel(ctx, x + vx, y + vy, `v=${mag}`, COLORS.velocity);
  }
}

/* ── Acceleration Vectors ────────────────────────────────────────────────────── */
export function drawAccelerationVectors(ctx, bodies) {
  for (const b of bodies) {
    if (b.isStatic || !b._accelX) continue;
    const { x, y } = b.position;
    const ax = b._accelX * SCALE.acceleration;
    const ay = b._accelY * SCALE.acceleration;
    if (Math.hypot(ax, ay) < MIN_LEN) continue;
    drawArrow(ctx, x, y, x + ax, y + ay, COLORS.acceleration, 2.5);
    const mag = Math.hypot(b._accelX, b._accelY).toFixed(2);
    drawLabel(ctx, x + ax, y + ay, `a=${mag}`, COLORS.acceleration);
  }
}

/* ── Force Vectors (gravity + applied) ───────────────────────────────────────── */
export function drawForceVectors(ctx, bodies, gravityY) {
  for (const b of bodies) {
    if (b.isStatic) continue;
    const { x, y } = b.position;
    // Net force ≈ mass * acceleration
    const fx = (b._accelX || 0) * b.mass * 50;
    const fy = (b._accelY || 0) * b.mass * 50;
    if (Math.hypot(fx, fy) < MIN_LEN) continue;
    drawArrow(ctx, x, y, x + fx, y + fy, COLORS.force, 2.5);
    const mag = (Math.hypot(b._accelX || 0, b._accelY || 0) * b.mass).toFixed(2);
    drawLabel(ctx, x + fx, y + fy, `F=${mag}N`, COLORS.force);
  }
}

/* ── Constraint Stress Colors ────────────────────────────────────────────────── */
export function drawConstraintStress(ctx, constraints) {
  for (const c of constraints) {
    if (!c.bodyA || !c.bodyB || c.label === 'Mouse Constraint') continue;
    const a = c.bodyA.position;
    const b = c.bodyB.position;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const strain = Math.abs(dist - (c.length || dist)) / Math.max(c.length || 1, 1);
    // 0 = green (relaxed), 1 = red (max stress)
    const t = Math.min(strain * 8, 1);
    const r = Math.round(34 + t * 221);
    const g = Math.round(197 - t * 160);
    const col = `rgb(${r}, ${g}, 50)`;

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 3 + t * 3;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

/* ── Selection Highlight ─────────────────────────────────────────────────────── */
export function drawSelectionHighlight(ctx, body) {
  if (!body) return;
  const { x, y } = body.position;
  const r = body.circleRadius || Math.max(
    (body.bounds.max.x - body.bounds.min.x) / 2,
    (body.bounds.max.y - body.bounds.min.y) / 2
  );

  ctx.save();
  ctx.strokeStyle = COLORS.selection;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, r + 8, 0, Math.PI * 2);
  ctx.stroke();

  // Corner markers
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.selection;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
    ctx.beginPath();
    ctx.arc(x + (r + 8) * Math.cos(a), y + (r + 8) * Math.sin(a), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ── Snap Grid Highlight ─────────────────────────────────────────────────────── */
export function drawSnapGrid(ctx, w, h, gridSize) {
  ctx.save();
  ctx.strokeStyle = 'rgba(15,118,110,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();
}
