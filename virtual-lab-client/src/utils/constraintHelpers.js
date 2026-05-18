import Matter from 'matter-js';

const { Constraint, Body, Composite, Query } = Matter;

export const CONSTRAINT_STYLES = {
  rope:   { strokeStyle: '#6366f1', lineWidth: 2.5 },
  spring: { strokeStyle: '#10b981', lineWidth: 3 },
  pivot:  { strokeStyle: '#f59e0b', lineWidth: 2 },
  motor:  { strokeStyle: '#ef4444', lineWidth: 2 },
};

export function createConstraintFromConfig(type, bodyA, bodyB, config, uid) {
  let constraint;
  const meta = { _constraintUid: uid, _constraintType: type, _constraintConfig: { ...config } };

  if (type === 'rope') {
    constraint = Constraint.create({
      bodyA, bodyB,
      length: config.length || dist(bodyA, bodyB),
      stiffness: 1, damping: 0,
      render: CONSTRAINT_STYLES.rope, ...meta,
    });
  } else if (type === 'spring') {
    constraint = Constraint.create({
      bodyA, bodyB,
      length: config.restLength || dist(bodyA, bodyB),
      stiffness: config.stiffness || 0.04,
      damping: config.damping || 0.02,
      render: CONSTRAINT_STYLES.spring, ...meta,
    });
  } else if (type === 'pivot') {
    constraint = Constraint.create({
      bodyA, bodyB,
      length: 0, stiffness: 1,
      render: CONSTRAINT_STYLES.pivot, ...meta,
    });
  } else if (type === 'motor') {
    constraint = Constraint.create({
      bodyA, bodyB,
      length: 0, stiffness: 1,
      render: CONSTRAINT_STYLES.motor, ...meta,
    });
  }
  return constraint;
}

export function updateConstraintProps(constraint, type, config, motorsMap, uid) {
  if (type === 'rope') {
    constraint.length = config.length;
  } else if (type === 'spring') {
    constraint.stiffness = config.stiffness;
    constraint.damping = config.damping;
    constraint.length = config.restLength;
  } else if (type === 'motor') {
    constraint._constraintConfig = { ...config };
    if (motorsMap.has(uid)) {
      motorsMap.get(uid).angularVelocity = config.angularVelocity;
    }
  }
}

export function findBodyAtPoint(engine, x, y) {
  const bodies = Composite.allBodies(engine.world).filter(b => {
    if (!b.isStatic) return true;                        // all dynamic bodies
    if (b._canLink) return true;                         // pivoted bodies
    if (b.label?.startsWith('wall') || b.label === 'ground') return false; // built-in walls
    return true;                                         // user-created platforms
  });
  return Query.point(bodies, { x, y })[0] || null;
}

function dist(a, b) {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function getConstraintsMeta(engine) {
  return Composite.allConstraints(engine.world)
    .filter(c => c._constraintUid)
    .map(c => ({
      uid: c._constraintUid,
      type: c._constraintType,
      ax: c.bodyA?.position.x || c.pointA?.x || 0,
      ay: c.bodyA?.position.y || c.pointA?.y || 0,
      bx: c.bodyB?.position.x || 0, by: c.bodyB?.position.y || 0,
      config: c._constraintConfig,
      bodyALabel: c.bodyA?.label || '_world_', bodyBLabel: c.bodyB?.label,
    }));
}

/** Pin a body to a fixed world point (single-body pivot) */
export function createWorldPivot(body, uid, pinX, pinY) {
  const px = pinX != null ? pinX : body.position.x;
  const py = pinY != null ? pinY : body.position.y;

  // Make body static — completely immovable
  Body.setStatic(body, true);
  Body.setPosition(body, { x: px, y: py });
  body._canLink = true;  // Allow link tool to still select this static body

  // We still create a constraint for visual rendering (the pin dot)
  return Matter.Constraint.create({
    pointA: { x: px, y: py },
    bodyB: body,
    length: 0,
    stiffness: 1,
    render: CONSTRAINT_STYLES.pivot,
    _constraintUid: uid,
    _constraintType: 'pivot',
    _constraintConfig: { px, py, bodyLabel: body.label },
  });
}
