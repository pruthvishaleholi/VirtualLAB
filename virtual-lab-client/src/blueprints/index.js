// Blueprints: factory functions that return { bodies, constraints }
// Each body gets a caller-supplied uid prefix for multiplayer tracking.

/**
 * Pendulum: static pivot + swinging ball
 */
export function spawnPendulum(Matter, uid, options = {}) {
  const { Bodies, Constraint } = Matter;
  const x = options.x || 450;
  const pivot = Bodies.rectangle(x, 80, 20, 20, {
    isStatic: true,
    label: uid + '_pivot',
    _w: 20, _h: 20,
    render: { fillStyle: '#475569' },
  });
  const ball = Bodies.circle(x, 250, 25, {
    label: uid + '_ball',
    restitution: 0.8,
    render: { fillStyle: '#ef4444' },
  });
  const string = Constraint.create({
    bodyA: pivot,
    bodyB: ball,
    length: 170,
    stiffness: 0.95,
    render: { strokeStyle: '#94a3b8', lineWidth: 2 },
  });
  return { bodies: [pivot, ball], constraints: [string] };
}

/**
 * Double Pendulum: two-segment pendulum with two constraints
 */
export function spawnDoublePendulum(Matter, uid, options = {}) {
  const { Bodies, Constraint } = Matter;
  const x = options.x || 500;
  const pivot = Bodies.rectangle(x, 60, 20, 20, {
    isStatic: true,
    label: uid + '_dpivot',
    _w: 20, _h: 20,
    render: { fillStyle: '#334155' },
  });
  const ball1 = Bodies.circle(x, 180, 18, {
    label: uid + '_dball1',
    restitution: 0.3,
    render: { fillStyle: '#6366f1' },
  });
  const ball2 = Bodies.circle(x, 300, 18, {
    label: uid + '_dball2',
    restitution: 0.3,
    render: { fillStyle: '#a855f7' },
  });
  const seg1 = Constraint.create({
    bodyA: pivot, bodyB: ball1,
    length: 120, stiffness: 0.95,
    render: { strokeStyle: '#64748b', lineWidth: 2 },
  });
  const seg2 = Constraint.create({
    bodyA: ball1, bodyB: ball2,
    length: 120, stiffness: 0.95,
    render: { strokeStyle: '#64748b', lineWidth: 2 },
  });
  return { bodies: [pivot, ball1, ball2], constraints: [seg1, seg2] };
}

/**
 * Mass-Spring-Damper: fixed anchor + mass connected by a spring
 */
export function spawnMassSpringDamper(Matter, uid, options = {}) {
  const { Bodies, Constraint } = Matter;
  const x = options.x || 400;
  const anchor = Bodies.rectangle(x, 100, 24, 24, {
    isStatic: true,
    label: uid + '_anchor',
    _w: 24, _h: 24,
    render: { fillStyle: '#475569' },
  });
  const mass = Bodies.rectangle(x, 280, 50, 50, {
    label: uid + '_mass',
    _w: 50, _h: 50,
    frictionAir: 0.02,
    render: { fillStyle: '#0ea5e9' },
  });
  const spring = Constraint.create({
    bodyA: anchor, bodyB: mass,
    length: 160, stiffness: 0.02,
    damping: 0.02,
    render: { strokeStyle: '#f59e0b', lineWidth: 3 },
  });
  return { bodies: [anchor, mass], constraints: [spring] };
}

/**
 * Projectile: a ball launched at an angle
 */
export function spawnProjectile(Matter, uid, options = {}) {
  const { Bodies, Body } = Matter;
  const x = options.x || 100;
  const y = options.y || 500;
  const ball = Bodies.circle(x, y, 16, {
    label: uid + '_proj',
    restitution: 0.5,
    friction: 0.02,
    render: { fillStyle: '#f97316' },
  });
  // Launch at 45 degrees with speed 12
  Body.setVelocity(ball, { x: 8, y: -10 });
  return { bodies: [ball], constraints: [] };
}

/**
 * Domino row: 8 thin standing rectangles
 */
export function spawnDominoes(Matter, uid, options = {}) {
  const { Bodies } = Matter;
  const startX = options.x || 160;
  const bodies = [];
  for (let i = 0; i < 8; i++) {
    bodies.push(
      Bodies.rectangle(startX + i * 75, 510, 16, 80, {
        label: uid + '_d' + i,
        _w: 16, _h: 80,
        friction: 0.8,
        restitution: 0.2,
        render: { fillStyle: `hsl(${260 + i * 8}, 70%, 60%)` },
      })
    );
  }
  return { bodies, constraints: [] };
}

/**
 * Ramp + ball: angled static ramp with a rolling ball above it
 */
export function spawnRamp(Matter, uid, options = {}) {
  const { Bodies } = Matter;
  const ramp = Bodies.rectangle(370, 430, 320, 18, {
    isStatic: true,
    angle: -0.28,
    label: uid + '_ramp',
    _w: 320, _h: 18,
    render: { fillStyle: '#334155' },
  });
  const ball = Bodies.circle(230, 330, 22, {
    label: uid + '_rball',
    restitution: 0.5,
    friction: 0.05,
    render: { fillStyle: '#f59e0b' },
  });
  return { bodies: [ramp, ball], constraints: [] };
}

/**
 * Serialize blueprint data for socket emission
 */
export function blueprintToSocketData(uid, type, bodies, constraints) {
  return {
    type: 'blueprint',
    blueprintType: type,
    uid,
    bodies: bodies.map((b) => ({
      label: b.label,
      x: b.position.x,
      y: b.position.y,
      angle: b.angle,
      isStatic: b.isStatic,
      render: b.render,
      friction: b.friction,
      restitution: b.restitution,
    })),
  };
}
