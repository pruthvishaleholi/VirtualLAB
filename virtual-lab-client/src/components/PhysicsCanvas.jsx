import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import { io } from 'socket.io-client';
import AnalyticsDashboard from './AnalyticsDashboard';
import MaterialsPanel from './MaterialsPanel';
import ConstraintConfigPopover from './ConstraintConfigPopover';
import ConstraintOverlay from './ConstraintOverlay';
import ConstraintInspector from './ConstraintInspector';
import { createConstraintFromConfig, updateConstraintProps, findBodyAtPoint, getConstraintsMeta, createWorldPivot } from '../utils/constraintHelpers';
import { spawnPendulum, spawnDominoes, spawnRamp } from '../blueprints';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const MAX_POINTS = 60;

const HOST_SYNC_INTERVAL = 150; // ms between host state broadcasts

const genUID = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── Helper: build a body from socket data sent by another client ──────────────
function receiveBodyFromData(data, Matter) {
  const { Bodies, Constraint, Composite } = Matter;
  const items = [];

  if (data.type === 'box') {
    items.push(Bodies.rectangle(data.x, data.y, data.w, data.h, {
      label: data.label, _w: data.w, _h: data.h,
      render: { fillStyle: data.color },
      friction: data.friction ?? 0.1, restitution: data.restitution ?? 0.6,
      frictionAir: data.frictionAir ?? 0.01,
    }));
  } else if (data.type === 'circle') {
    items.push(Bodies.circle(data.x, data.y, data.radius, {
      label: data.label, render: { fillStyle: data.color },
      friction: data.friction ?? 0.1, restitution: data.restitution ?? 0.6,
      frictionAir: data.frictionAir ?? 0.01,
    }));
  } else if (data.type === 'spring') {
    const b1 = Bodies.rectangle(data.x1, data.y1, 40, 40, { label: data.label + '_a', _w: 40, _h: 40, render: { fillStyle: '#f59e0b' } });
    const b2 = Bodies.rectangle(data.x2, data.y2, 40, 40, { label: data.label + '_b', _w: 40, _h: 40, render: { fillStyle: '#a855f7' } });
    const spring = Constraint.create({ bodyA: b1, bodyB: b2, stiffness: 0.05, render: { strokeStyle: '#9ca3af', lineWidth: 3 } });
    items.push(b1, b2, spring);
  } else if (data.type === 'pendulum') {
    const { bodies, constraints } = spawnPendulum(Matter, data.label);
    items.push(...bodies, ...constraints);
  } else if (data.type === 'dominoes') {
    const { bodies } = spawnDominoes(Matter, data.label);
    items.push(...bodies);
  } else if (data.type === 'ramp') {
    const { bodies } = spawnRamp(Matter, data.label);
    items.push(...bodies);
  }

  return items;
}

// ── Serialise world for localStorage save ────────────────────────────────────
function serializeWorld(engine) {
  const { Composite } = Matter;
  return Composite.allBodies(engine.world)
    .filter((b) => !b.isStatic && !b.label?.startsWith('wall'))
    .map((b) => ({
      label: b.label,
      x: b.position.x, y: b.position.y,
      vx: b.velocity.x, vy: b.velocity.y,
      angle: b.angle, angularVelocity: b.angularVelocity,
      color: b.render.fillStyle,
      isCircle: b.circleRadius != null,
      circleRadius: b.circleRadius,
      width: b.bounds.max.x - b.bounds.min.x,
      height: b.bounds.max.y - b.bounds.min.y,
    }));
}


// ── PhysicsCanvas component ───────────────────────────────────────────────────
const PhysicsCanvas = ({ roomId, userName, onLeave }) => {
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const socketRef = useRef(null);
  const materialsRef = useRef({ gravity: 1, friction: 0.1, restitution: 0.6, airFriction: 0.01 });
  const lastDragEmit = useRef(0);
  const lastHostSync = useRef(0);
  const tickRef = useRef(0);
  const isHostRef = useRef(false);
  const draggedLabelRef = useRef(null); // label of body currently being dragged locally
  const pendingHostSync = useRef(null); // buffered host state, applied in afterUpdate

  const [analyticsData, setAnalyticsData] = useState([]);
  const [materials, setMaterials] = useState({ gravity: 1, friction: 0.1, restitution: 0.6, airFriction: 0.01 });
  const [userCount, setUserCount] = useState(1);
  const [isHost, setIsHost] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showMaterials, setShowMaterials] = useState(false);
  const [hasSave, setHasSave] = useState(!!localStorage.getItem('vlab_save'));

  // ── Link Tool state ────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState('select'); // 'select' | 'link' | 'pivot' | 'cut' | 'platform'
  const [linkBodyA, setLinkBodyA] = useState(null);       // { body, x, y }
  const [popover, setPopover] = useState(null);            // { posX, posY, bodyA, bodyB, autoLength }
  const [cursorPos, setCursorPos] = useState(null);
  const [constraintsMeta, setConstraintsMeta] = useState([]);
  const [selectedConstraint, setSelectedConstraint] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [platformStart, setPlatformStart] = useState(null); // { x, y } first click for platform tool
  const motorsRef = useRef(new Map());                     // uid -> { bodyB, angularVelocity }
  const constraintsMapRef = useRef(new Map());             // uid -> { constraint, type, config }
  const activeToolRef = useRef('select');
  const mcRef = useRef(null);

  // ── Engine & Socket setup ──────────────────────────────────────────────────
  useEffect(() => {
    const { Engine, Render, Runner, Bodies, Body, Composite, Mouse, MouseConstraint, Events, Constraint } = Matter;

    const engine = Engine.create();
    engine.gravity.y = materialsRef.current.gravity;
    engineRef.current = engine;
    engine.constraintIterations = 10;  // default is 2 — higher = more rigid constraints
    engine.positionIterations = 10;    // helps prevent bodies from passing through each other

    // Measure container to fill it
    const container = sceneRef.current;
    const CANVAS_W = container.clientWidth;
    const CANVAS_H = container.clientHeight;

    const render = Render.create({
      element: container,
      engine,
      options: { width: CANVAS_W, height: CANVAS_H, wireframes: false, background: 'transparent' },
    });

    // Walls + ground (sized to fill the container)
    const ground = Bodies.rectangle(CANVAS_W / 2, CANVAS_H + 10, CANVAS_W + 20, 40, { isStatic: true, label: 'ground', render: { fillStyle: '#d4d4d3' } });
    const wallL = Bodies.rectangle(-10, CANVAS_H / 2, 20, CANVAS_H, { isStatic: true, label: 'wallL', render: { fillStyle: 'transparent' } });
    const wallR = Bodies.rectangle(CANVAS_W + 10, CANVAS_H / 2, 20, CANVAS_H, { isStatic: true, label: 'wallR', render: { fillStyle: 'transparent' } });
    Composite.add(engine.world, [ground, wallL, wallR]);

    // Mouse
    const mouse = Mouse.create(render.canvas);
    const mc = MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2, render: { visible: false } } });
    Composite.add(engine.world, mc);
    mcRef.current = mc;

    setCanvasSize({ w: CANVAS_W, h: CANVAS_H });

    // ── Tool click handler (Link / Pivot / Cut / Platform) ────────────────
    render.canvas.addEventListener('mousedown', (e) => {
      const tool = activeToolRef.current;
      if (tool !== 'link' && tool !== 'pivot' && tool !== 'cut' && tool !== 'platform') return;
      const rect = render.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Platform tool doesn't need a body
      if (tool === 'platform') {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('platform-click', { detail: { x, y } }));
        return;
      }

      const body = findBodyAtPoint(engine, x, y);
      if (!body) return;
      e.stopPropagation();

      if (tool === 'pivot') {
        window.dispatchEvent(new CustomEvent('pivot-click', { detail: { body } }));
      } else if (tool === 'cut') {
        window.dispatchEvent(new CustomEvent('cut-click', { detail: { body } }));
      } else {
        window.dispatchEvent(new CustomEvent('link-click', { detail: { body, x: body.position.x, y: body.position.y } }));
      }
    });

    // Track cursor for link/platform preview line
    render.canvas.addEventListener('mousemove', (e) => {
      const tool = activeToolRef.current;
      if (tool !== 'link' && tool !== 'platform') return;
      const rect = render.canvas.getBoundingClientRect();
      setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    });

    // ── Socket ─────────────────────────────────────────────────────────────
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join_room', roomId));
    socket.on('room_user_count', (count) => setUserCount(count));

    // ── Role assignment from server ─────────────────────────────────────
    socket.on('role', ({ isHost: hostFlag }) => {
      isHostRef.current = hostFlag;
      setIsHost(hostFlag);
      console.log(`Role: ${hostFlag ? '★ HOST' : '○ PEER'}`);
    });

    socket.on('receive_item', (data) => {
      const items = receiveBodyFromData(data, Matter);
      Composite.add(engine.world, items);
    });

    // ── Room state sync: receive all existing items when joining ──────
    socket.on('room_state', ({ bodies: bodyArr, constraints: constraintArr }) => {
      const labelToBody = {};
      bodyArr.forEach((b) => {
        let body;
        if (b.isCircle) {
          body = Bodies.circle(b.x, b.y, b.circleRadius, {
            label: b.label, isStatic: b.isStatic,
            render: { fillStyle: b.color },
            friction: b.friction, restitution: b.restitution, frictionAir: b.frictionAir,
          });
        } else {
          body = Bodies.rectangle(b.x, b.y, b.width, b.height, {
            label: b.label, isStatic: b.isStatic,
            _w: b.width, _h: b.height,
            render: { fillStyle: b.color },
            friction: b.friction, restitution: b.restitution, frictionAir: b.frictionAir,
          });
        }
        Body.setAngle(body, b.angle || 0);
        if (!b.isStatic) Body.setVelocity(body, { x: b.vx || 0, y: b.vy || 0 });
        labelToBody[b.label] = body;
        Composite.add(engine.world, body);
      });
      if (constraintArr) {
        constraintArr.forEach((c) => {
          const bodyA = labelToBody[c.bodyALabel];
          const bodyB = labelToBody[c.bodyBLabel];
          if (bodyA && bodyB) {
            Composite.add(engine.world, Constraint.create({
              bodyA, bodyB, length: c.length, stiffness: c.stiffness,
              render: { strokeStyle: c.strokeStyle, lineWidth: c.lineWidth },
            }));
          }
        });
      }
    });

    // ── Provide live state snapshot to a new joiner ──────────────────
    socket.on('request_state', (requesterSocketId) => {
      const allBodies = Composite.allBodies(engine.world)
        .filter((b) => !b.label?.startsWith('wall') && b.label !== 'ground');
      const allConstraints = Composite.allConstraints(engine.world)
        .filter((c) => c.label !== 'Mouse Constraint');

      const bodies = allBodies.map((b) => {
        const isCircle = b.circleRadius > 0;
        return {
          label: b.label, x: b.position.x, y: b.position.y,
          angle: b.angle, vx: b.velocity.x, vy: b.velocity.y,
          isCircle, circleRadius: b.circleRadius,
          width: b._w ?? (b.bounds.max.x - b.bounds.min.x),
          height: b._h ?? (b.bounds.max.y - b.bounds.min.y),
          isStatic: b.isStatic, color: b.render?.fillStyle || '#3b82f6',
          friction: b.friction, restitution: b.restitution, frictionAir: b.frictionAir,
        };
      });

      const constraints = allConstraints.map((c) => ({
        bodyALabel: c.bodyA?.label, bodyBLabel: c.bodyB?.label,
        length: c.length, stiffness: c.stiffness,
        strokeStyle: c.render?.strokeStyle, lineWidth: c.render?.lineWidth,
      }));

      socket.emit('state_snapshot', { targetSocketId: requesterSocketId, bodies, constraints });
    });

    // ── Host sync: buffer incoming state, apply in afterUpdate ──────────
    socket.on('host_sync', (hostBodies) => {
      if (isHostRef.current) return;
      pendingHostSync.current = hostBodies;
    });

    socket.on('receive_drag', ({ label, x, y, vx, vy }) => {
      const body = Composite.allBodies(engine.world).find((b) => b.label === label);
      if (body) {
        Body.setPosition(body, { x, y });
        Body.setVelocity(body, { x: vx ?? 0, y: vy ?? 0 });
      }
    });

    socket.on('receive_clear', () => {
      const bodiesToRemove = Composite.allBodies(engine.world).filter((b) => {
        if (!b.isStatic) return true;
        if (b.label?.startsWith('wall') || b.label === 'ground') return false;
        return true;
      });
      Composite.remove(engine.world, bodiesToRemove);
      Composite.remove(engine.world, Composite.allConstraints(engine.world).filter((c) => c.label !== 'Mouse Constraint'));
      motorsRef.current.clear();
      constraintsMapRef.current.clear();
    });

    // ── Constraint sync (receive from peers) ──────────────────────────────
    socket.on('receive_constraint', (data) => {
      const allBodies = Composite.allBodies(engine.world);
      let c;

      if (data.type === 'pivot' && data.bodyALabel === '_world_') {
        // World pivot: pin body to a fixed point
        const bodyB = allBodies.find(b => b.label === data.bodyBLabel);
        if (!bodyB) return;
        c = createWorldPivot(bodyB, data.uid, data.config.px, data.config.py);
      } else {
        const bodyA = allBodies.find(b => b.label === data.bodyALabel);
        const bodyB = allBodies.find(b => b.label === data.bodyBLabel);
        if (!bodyA || !bodyB) return;
        c = createConstraintFromConfig(data.type, bodyA, bodyB, data.config, data.uid);
      }

      if (c) {
        Composite.add(engine.world, c);
        constraintsMapRef.current.set(data.uid, { constraint: c, type: data.type, config: data.config });
        if (data.type === 'motor') {
          const bodyB = allBodies.find(b => b.label === data.bodyBLabel);
          motorsRef.current.set(data.uid, { bodyB, angularVelocity: data.config.angularVelocity });
        }
      }
    });

    socket.on('receive_delete_constraint', ({ uid }) => {
      const entry = constraintsMapRef.current.get(uid);
      if (entry) {
        Composite.remove(engine.world, entry.constraint);
        constraintsMapRef.current.delete(uid);
        motorsRef.current.delete(uid);
      }
    });

    socket.on('receive_update_constraint', ({ uid, config }) => {
      const entry = constraintsMapRef.current.get(uid);
      if (entry) {
        updateConstraintProps(entry.constraint, entry.type, config, motorsRef.current, uid);
        entry.config = config;
      }
    });

    socket.on('receive_delete_body', ({ label }) => {
      const body = Composite.allBodies(engine.world).find(b => b.label === label);
      if (!body) return;
      // Remove constraints attached to this body
      const toDelete = [];
      constraintsMapRef.current.forEach((entry, uid) => {
        if (entry.constraint.bodyA === body || entry.constraint.bodyB === body) {
          toDelete.push(uid);
        }
      });
      toDelete.forEach(uid => {
        const entry = constraintsMapRef.current.get(uid);
        if (entry) {
          Composite.remove(engine.world, entry.constraint);
          constraintsMapRef.current.delete(uid);
          motorsRef.current.delete(uid);
        }
      });
      Composite.remove(engine.world, body);
    });

    // ── Drag tracking ──────────────────────────────────────────────
    let isDragging = false;
    Events.on(mc, 'startdrag', (e) => {
      if (activeToolRef.current !== 'select') { mc.body = null; return; }
      isDragging = true;
      draggedLabelRef.current = e.body?.label || null;
    });
    Events.on(mc, 'enddrag', () => {
      isDragging = false;
      draggedLabelRef.current = null;
    });

    // ── Drag sync + Host sync (both run on beforeUpdate) ───────────────────
    Events.on(engine, 'beforeUpdate', () => {
      const now = Date.now();

      // Drag sync: emit position of dragged body to other users
      if (isDragging && mc.body) {
        if (now - lastDragEmit.current >= 33) {
          lastDragEmit.current = now;
          const b = mc.body;
          socket.emit('drag_update', { label: b.label, x: b.position.x, y: b.position.y, vx: b.velocity.x, vy: b.velocity.y });
        }
      }

      // Host sync: periodically broadcast all body positions to peers
      if (isHostRef.current && now - lastHostSync.current >= HOST_SYNC_INTERVAL) {
        lastHostSync.current = now;
        const dynamicBodies = Composite.allBodies(engine.world)
          .filter((b) => !b.isStatic && !b.label?.startsWith('wall') && b.label !== 'ground');

        if (dynamicBodies.length > 0) {
          const syncData = dynamicBodies.map((b) => ({
            label: b.label,
            x: b.position.x, y: b.position.y,
            vx: b.velocity.x, vy: b.velocity.y,
            angle: b.angle,
          }));
          socket.emit('host_sync', syncData);
        }
      }

      // Motor tick: drive motorized joints
      motorsRef.current.forEach(({ bodyB, angularVelocity }) => {
        Body.setAngularVelocity(bodyB, angularVelocity);
      });
    });

    // ── Apply host sync + Analytics (both in afterUpdate) ──────────────────
    Events.on(engine, 'afterUpdate', () => {
      // Apply buffered host sync: snap positions so local engine continues from corrected state
      if (pendingHostSync.current && !isHostRef.current) {
        const syncData = pendingHostSync.current;
        pendingHostSync.current = null;

        const allBodies = Composite.allBodies(engine.world);
        const bodyMap = {};
        allBodies.forEach((b) => { bodyMap[b.label] = b; });

        syncData.forEach((hb) => {
          const localBody = bodyMap[hb.label];
          if (!localBody || localBody.isStatic) return;
          // Skip body being dragged locally — dragger owns it
          if (draggedLabelRef.current === hb.label) return;

          // Full snap: set exact position, velocity, angle from host
          Body.setPosition(localBody, { x: hb.x, y: hb.y });
          Body.setVelocity(localBody, { x: hb.vx, y: hb.vy });
          Body.setAngle(localBody, hb.angle);
        });
      }

      // Analytics
      tickRef.current++;
      if (tickRef.current % 3 !== 0) return;
      const dyn = Composite.allBodies(engine.world).filter((b) => !b.isStatic);
      if (dyn.length === 0) return;
      const avgSpeed = dyn.reduce((s, b) => s + Math.hypot(b.velocity.x, b.velocity.y), 0) / dyn.length;
      const avgAng = dyn.reduce((s, b) => s + Math.abs(b.angularVelocity), 0) / dyn.length;
      setAnalyticsData((prev) => {
        const next = [...prev, { t: tickRef.current, speed: +avgSpeed.toFixed(2), angularVel: +avgAng.toFixed(4) }];
        return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
      });

      // Update constraint overlay metadata
      setConstraintsMeta(getConstraintsMeta(engine));
    });

    Render.run(render);
    const runner = Runner.create();
    Runner.run(runner, engine);

    return () => {
      Render.stop(render);
      Runner.stop(runner);
      Engine.clear(engine);
      socket.disconnect();
      if (render.canvas) render.canvas.remove();
    };
  }, [roomId]);

  // ── Keep activeToolRef in sync ─────────────────────────────────────────────
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // ── Link tool click listener ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const { body, x, y } = e.detail;
      if (!linkBodyA) {
        setLinkBodyA({ body, x, y });
      } else {
        if (body === linkBodyA.body) return;
        const dx = linkBodyA.x - x;
        const dy = linkBodyA.y - y;
        const autoLen = Math.sqrt(dx * dx + dy * dy);
        const midX = (linkBodyA.x + x) / 2;
        const midY = (linkBodyA.y + y) / 2;
        setPopover({ posX: midX, posY: midY, bodyA: linkBodyA.body, bodyB: body, autoLength: autoLen });
        setLinkBodyA(null);
        setCursorPos(null);
      }
    };
    window.addEventListener('link-click', handler);
    return () => window.removeEventListener('link-click', handler);
  }, [linkBodyA]);

  // ── Pivot tool click listener (single-body pin) ───────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const { body } = e.detail;
      if (!engineRef.current) return;
      const uid = genUID();
      const c = createWorldPivot(body, uid);
      Matter.Composite.add(engineRef.current.world, c);
      constraintsMapRef.current.set(uid, { constraint: c, type: 'pivot', config: c._constraintConfig });
      socketRef.current?.emit('spawn_constraint', {
        uid, type: 'pivot', bodyALabel: '_world_', bodyBLabel: body.label,
        config: c._constraintConfig,
      });
      setActiveTool('select');
    };
    window.addEventListener('pivot-click', handler);
    return () => window.removeEventListener('pivot-click', handler);
  }, []);

  // ── Platform tool click listener (draw static surface) ────────────────────
  useEffect(() => {
    const handler = (e) => {
      const { x, y } = e.detail;
      if (!engineRef.current) return;

      if (!platformStart) {
        setPlatformStart({ x, y });
      } else {
        // Second click: create the platform
        const dx = x - platformStart.x;
        const dy = y - platformStart.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 10) { setPlatformStart(null); return; } // too short
        const angle = Math.atan2(dy, dx);
        const cx = (platformStart.x + x) / 2;
        const cy = (platformStart.y + y) / 2;
        const uid = genUID();

        const platform = Matter.Bodies.rectangle(cx, cy, length, 12, {
          isStatic: true,
          label: uid,
          angle,
          render: { fillStyle: '#64748b' },
          friction: materialsRef.current.friction,
          restitution: materialsRef.current.restitution,
        });
        Matter.Composite.add(engineRef.current.world, platform);

        socketRef.current?.emit('spawn_item', {
          type: 'platform', label: uid,
          x: cx, y: cy, w: length, h: 12, angle,
          color: '#64748b',
          friction: materialsRef.current.friction,
          restitution: materialsRef.current.restitution,
        });

        setPlatformStart(null);
        setCursorPos(null);
        setActiveTool('select');
      }
    };
    window.addEventListener('platform-click', handler);
    return () => window.removeEventListener('platform-click', handler);
  }, [platformStart]);

  // ── Cut tool click listener (remove body + its constraints) ───────────────
  useEffect(() => {
    const handler = (e) => {
      const { body } = e.detail;
      if (!engineRef.current) return;

      // Remove all constraints attached to this body (tracked in our map)
      const toDelete = [];
      constraintsMapRef.current.forEach((entry, uid) => {
        const c = entry.constraint;
        if (c.bodyA === body || c.bodyB === body) {
          toDelete.push(uid);
        }
      });
      toDelete.forEach(uid => {
        const entry = constraintsMapRef.current.get(uid);
        if (entry) {
          Matter.Composite.remove(engineRef.current.world, entry.constraint);
          constraintsMapRef.current.delete(uid);
          motorsRef.current.delete(uid);
          socketRef.current?.emit('delete_constraint', { uid });
        }
      });

      // Also remove any untracked Matter.js constraints (blueprint constraints, etc.)
      const allConstraints = Matter.Composite.allConstraints(engineRef.current.world);
      allConstraints.forEach(c => {
        if (c.bodyA === body || c.bodyB === body) {
          Matter.Composite.remove(engineRef.current.world, c);
        }
      });

      // Remove the body itself
      Matter.Composite.remove(engineRef.current.world, body);
      socketRef.current?.emit('delete_body', { label: body.label });

      setSelectedConstraint(null);
    };
    window.addEventListener('cut-click', handler);
    return () => window.removeEventListener('cut-click', handler);
  }, []);

  // ── Constraint creation (from popover) ────────────────────────────────────
  const handleCreateConstraint = useCallback((type, config) => {
    if (!popover || !engineRef.current) return;
    const uid = genUID();
    const c = createConstraintFromConfig(type, popover.bodyA, popover.bodyB, config, uid);
    if (c) {
      Matter.Composite.add(engineRef.current.world, c);
      constraintsMapRef.current.set(uid, { constraint: c, type, config });
      if (type === 'motor') {
        motorsRef.current.set(uid, { bodyB: popover.bodyB, angularVelocity: config.angularVelocity });
      }
      socketRef.current?.emit('spawn_constraint', {
        uid, type, bodyALabel: popover.bodyA.label, bodyBLabel: popover.bodyB.label, config,
      });
    }
    setPopover(null);
    setLinkBodyA(null);
    setCursorPos(null);
    setActiveTool('select');
  }, [popover]);

  const handleCancelLink = useCallback(() => {
    setPopover(null);
    setLinkBodyA(null);
    setCursorPos(null);
  }, []);

  // ── Constraint update (from inspector) ────────────────────────────────────
  const handleUpdateConstraint = useCallback((uid, newConfig) => {
    const entry = constraintsMapRef.current.get(uid);
    if (!entry) return;
    updateConstraintProps(entry.constraint, entry.type, newConfig, motorsRef.current, uid);
    entry.config = newConfig;
    setSelectedConstraint(prev => prev && prev.uid === uid ? { ...prev, config: newConfig } : prev);
    socketRef.current?.emit('update_constraint', { uid, config: newConfig });
  }, []);

  // ── Constraint deletion ───────────────────────────────────────────────────
  const handleDeleteConstraint = useCallback((uid) => {
    const entry = constraintsMapRef.current.get(uid);
    if (entry && engineRef.current) {
      Matter.Composite.remove(engineRef.current.world, entry.constraint);
      constraintsMapRef.current.delete(uid);
      motorsRef.current.delete(uid);
    }
    setSelectedConstraint(null);
    socketRef.current?.emit('delete_constraint', { uid });
  }, []);

  // ── Materials sync to engine ───────────────────────────────────────────────
  const handleMaterialChange = (key, value) => {
    const next = { ...materials, [key]: value };
    setMaterials(next);
    materialsRef.current = next;
    if (key === 'gravity' && engineRef.current) engineRef.current.gravity.y = value;
  };

  // ── Spawn helpers ──────────────────────────────────────────────────────────
  const addToWorld = (socketData, items) => {
    Matter.Composite.add(engineRef.current.world, items);
    socketRef.current?.emit('spawn_item', socketData);
  };

  const spawnAt = (type, x, y) => {
    const uid = genUID();
    const m = materialsRef.current;
    if (type === 'box') {
      const data = { type: 'box', label: uid, x, y, w: 60, h: 60, color: '#3b82f6', friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction };
      const box = Matter.Bodies.rectangle(x, y, 60, 60, { label: uid, _w: 60, _h: 60, render: { fillStyle: '#3b82f6' }, friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction });
      addToWorld(data, [box]);
    } else if (type === 'circle') {
      const data = { type: 'circle', label: uid, x, y, radius: 30, color: '#10b981', friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction };
      const circle = Matter.Bodies.circle(x, y, 30, { label: uid, render: { fillStyle: '#10b981' }, friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction });
      addToWorld(data, [circle]);
    } else if (type === 'spring') {
      const data = { type: 'spring', label: uid, x1: x - 60, y1: y, x2: x + 60, y2: y };
      const b1 = Matter.Bodies.rectangle(x - 60, y, 40, 40, { label: uid + '_a', _w: 40, _h: 40, render: { fillStyle: '#f59e0b' }, friction: m.friction, restitution: m.restitution });
      const b2 = Matter.Bodies.rectangle(x + 60, y, 40, 40, { label: uid + '_b', _w: 40, _h: 40, render: { fillStyle: '#a855f7' }, friction: m.friction, restitution: m.restitution });
      const spring = Matter.Constraint.create({ bodyA: b1, bodyB: b2, stiffness: 0.05, render: { strokeStyle: '#9ca3af', lineWidth: 3 } });
      addToWorld(data, [b1, b2, spring]);
    }
  };

  const handleAddBox = () => { spawnAt('box', (sceneRef.current?.clientWidth || 800) / 2, 60); };
  const handleAddCircle = () => { spawnAt('circle', (sceneRef.current?.clientWidth || 800) / 2, 60); };
  const handleAddSpring = () => { spawnAt('spring', (sceneRef.current?.clientWidth || 800) / 2, 60); };

  const handleCanvasDrop = (e) => {
    e.preventDefault();
    const shapeType = e.dataTransfer.getData('shapeType');
    if (!shapeType) return;
    const canvas = sceneRef.current?.querySelector('canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (shapeType === 'pendulum' || shapeType === 'dominoes' || shapeType === 'ramp') {
      handleBlueprint(shapeType);
    } else {
      spawnAt(shapeType, x, y);
    }
  };

  // ── Blueprint handlers ─────────────────────────────────────────────────────
  const handleBlueprint = (type) => {
    const uid = genUID();
    let items = [], socketData = { type, label: uid };

    if (type === 'pendulum') {
      const { bodies, constraints } = spawnPendulum(Matter, uid);
      items = [...bodies, ...constraints];
    } else if (type === 'dominoes') {
      const { bodies } = spawnDominoes(Matter, uid);
      items = bodies;
    } else if (type === 'ramp') {
      const { bodies } = spawnRamp(Matter, uid);
      items = bodies;
    }

    addToWorld(socketData, items);
  };

  // ── Clear ─────────────────────────────────────────────────────────────────
  const handleClear = () => {
    const { Composite } = Matter;
    // Remove all bodies except built-in walls and ground
    const bodiesToRemove = Composite.allBodies(engineRef.current.world).filter((b) => {
      if (!b.isStatic) return true;                                          // all dynamic bodies
      if (b.label?.startsWith('wall') || b.label === 'ground') return false; // keep built-in walls
      return true;                                                           // remove user-created platforms
    });
    Composite.remove(engineRef.current.world, bodiesToRemove);
    Composite.remove(engineRef.current.world, Composite.allConstraints(engineRef.current.world).filter((c) => c.label !== 'Mouse Constraint'));
    setAnalyticsData([]);
    motorsRef.current.clear();
    constraintsMapRef.current.clear();
    setSelectedConstraint(null);
    setLinkBodyA(null);
    setPopover(null);
    setPlatformStart(null);
    socketRef.current?.emit('clear_canvas');
  };

  // ── Save / Restore ─────────────────────────────────────────────────────────
  const handleSave = () => {
    const data = serializeWorld(engineRef.current);
    localStorage.setItem('vlab_save', JSON.stringify(data));
    setHasSave(true);
  };

  const handleRestore = () => {
    const raw = localStorage.getItem('vlab_save');
    if (!raw) return;
    const saved = JSON.parse(raw);
    const { Bodies, Composite, Body } = Matter;
    saved.forEach((s) => {
      const body = s.isCircle
        ? Bodies.circle(s.x, s.y, s.circleRadius, { label: s.label, render: { fillStyle: s.color } })
        : Bodies.rectangle(s.x, s.y, s.width, s.height, { label: s.label, render: { fillStyle: s.color } });
      Body.setAngle(body, s.angle);
      Body.setVelocity(body, { x: s.vx, y: s.vy });
      Composite.add(engineRef.current.world, body);
    });
  };

  // ── Sidebar button style helper ─────────────────────────────────────────────
  const sideBtn = {
    width: '100%',
    padding: '14px 12px',
    border: '1px solid #e5e5e4',
    borderRadius: '12px',
    background: '#ffffff',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    transition: 'border-color 0.2s, background 0.15s',
    fontFamily: "'Inter', -apple-system, sans-serif",
  };

  const sideBtnIcon = {
    fontSize: '24px',
    lineHeight: 1,
  };

  const sideBtnLabel = {
    fontSize: '11px',
    fontWeight: 500,
    color: '#555553',
    letterSpacing: '0.01em',
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#f8f8f7',
      backgroundImage: 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
      backgroundSize: '32px 32px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>

      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        borderBottom: '1px solid #e5e5e4',
        background: '#ffffff',
      }}>
        {/* Left: Logo + Room */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.02em' }}>
            Virtual<span style={{ fontWeight: 400, color: '#0f766e' }}>Lab</span>
          </span>
          <span style={{
            fontSize: '11px',
            fontWeight: 500,
            color: '#9a9a98',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            padding: '3px 8px',
            background: '#f3f3f2',
            borderRadius: '6px',
          }}>{roomId}</span>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: '#0f766e',
            display: 'inline-block',
          }} />
          <span style={{ fontSize: '12px', color: '#9a9a98' }}>{userCount} online</span>
          {isHost && (
            <span style={{
              fontSize: '10px',
              fontWeight: 600,
              color: '#0f766e',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '2px 8px',
              background: '#ecfdf5',
              borderRadius: '6px',
              border: '1px solid #d1fae5',
            }}>Host</span>
          )}
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={handleSave} style={{
            padding: '6px 14px', borderRadius: '8px', border: '1px solid #e5e5e4',
            background: '#fff', fontSize: '12px', fontWeight: 500, color: '#777',
            cursor: 'pointer', transition: 'border-color 0.2s',
          }}>Save</button>
          {hasSave && (
            <button onClick={handleRestore} style={{
              padding: '6px 14px', borderRadius: '8px', border: '1px solid #d1fae5',
              background: '#ecfdf5', fontSize: '12px', fontWeight: 500, color: '#0f766e',
              cursor: 'pointer',
            }}>Restore</button>
          )}
          <button onClick={handleClear} style={{
            padding: '6px 14px', borderRadius: '8px', border: '1px solid #fecaca',
            background: '#fef2f2', fontSize: '12px', fontWeight: 500, color: '#dc2626',
            cursor: 'pointer',
          }}>Clear</button>
          <div style={{ width: '1px', height: '20px', background: '#e5e5e4', margin: '0 4px' }} />
          <button onClick={onLeave} style={{
            padding: '6px 14px', borderRadius: '8px', border: '1px solid #e5e5e4',
            background: '#fff', fontSize: '12px', fontWeight: 500, color: '#777',
            cursor: 'pointer',
          }}>← Leave</button>
        </div>
      </div>

      {/* ── Main 3-column layout ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── LEFT: Shape Toolbar (vertical) ──────────────────────────────── */}
        <div style={{
          width: '100px',
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          overflowY: 'auto',
          borderRight: '1px solid #e5e5e4',
          background: 'rgba(255,255,255,0.6)',
        }}>
          {/* Tools section */}
          <p style={{ fontSize: '9px', fontWeight: 600, color: '#b5b5b3', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', margin: '0 0 2px 0' }}>Tools</p>

          <button id="btn-select-tool" onClick={() => { setActiveTool('select'); handleCancelLink(); }}
            style={{ ...sideBtn, borderColor: activeTool === 'select' ? '#0f766e' : '#e5e5e4', background: activeTool === 'select' ? '#ecfdf5' : '#fff' }}>
            <span style={sideBtnIcon}>↖</span>
            <span style={{ ...sideBtnLabel, color: activeTool === 'select' ? '#0f766e' : '#555553' }}>Select</span>
          </button>

          <button id="btn-link-tool" onClick={() => { setActiveTool(activeTool === 'link' ? 'select' : 'link'); handleCancelLink(); }}
            style={{ ...sideBtn, borderColor: activeTool === 'link' ? '#0f766e' : '#e5e5e4', background: activeTool === 'link' ? '#ecfdf5' : '#fff' }}>
            <span style={sideBtnIcon}>🔗</span>
            <span style={{ ...sideBtnLabel, color: activeTool === 'link' ? '#0f766e' : '#555553' }}>Link</span>
          </button>

          <button id="btn-pivot-tool" onClick={() => { setActiveTool(activeTool === 'pivot' ? 'select' : 'pivot'); handleCancelLink(); }}
            style={{ ...sideBtn, borderColor: activeTool === 'pivot' ? '#0f766e' : '#e5e5e4', background: activeTool === 'pivot' ? '#ecfdf5' : '#fff' }}>
            <span style={sideBtnIcon}>📌</span>
            <span style={{ ...sideBtnLabel, color: activeTool === 'pivot' ? '#0f766e' : '#555553' }}>Pivot</span>
          </button>

          <button id="btn-cut-tool" onClick={() => { setActiveTool(activeTool === 'cut' ? 'select' : 'cut'); handleCancelLink(); }}
            style={{ ...sideBtn, borderColor: activeTool === 'cut' ? '#dc2626' : '#e5e5e4', background: activeTool === 'cut' ? '#fef2f2' : '#fff' }}>
            <span style={sideBtnIcon}>✂️</span>
            <span style={{ ...sideBtnLabel, color: activeTool === 'cut' ? '#dc2626' : '#555553' }}>Cut</span>
          </button>

          <button id="btn-platform-tool" onClick={() => { setActiveTool(activeTool === 'platform' ? 'select' : 'platform'); handleCancelLink(); setPlatformStart(null); }}
            style={{ ...sideBtn, borderColor: activeTool === 'platform' ? '#6366f1' : '#e5e5e4', background: activeTool === 'platform' ? '#eef2ff' : '#fff' }}>
            <span style={sideBtnIcon}>▁</span>
            <span style={{ ...sideBtnLabel, color: activeTool === 'platform' ? '#6366f1' : '#555553' }}>Platform</span>
          </button>

          {/* Divider */}
          <div style={{ height: '1px', background: '#e5e5e4', margin: '4px 0' }} />

          {/* Shapes section */}
          <p style={{ fontSize: '9px', fontWeight: 600, color: '#b5b5b3', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', margin: '0 0 2px 0' }}>Shapes</p>

          <button id="btn-add-square" draggable onClick={handleAddBox} style={{...sideBtn, cursor: 'grab'}}
            onDragStart={(e) => { e.dataTransfer.setData('shapeType', 'box'); }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <span style={sideBtnIcon}>□</span>
            <span style={sideBtnLabel}>Square</span>
          </button>

          <button id="btn-add-circle" draggable onClick={handleAddCircle} style={{...sideBtn, cursor: 'grab'}}
            onDragStart={(e) => { e.dataTransfer.setData('shapeType', 'circle'); }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <span style={sideBtnIcon}>○</span>
            <span style={sideBtnLabel}>Circle</span>
          </button>

          {/* Divider */}
          <div style={{ height: '1px', background: '#e5e5e4', margin: '4px 0' }} />

          <p style={{ fontSize: '9px', fontWeight: 600, color: '#b5b5b3', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', margin: '0 0 2px 0' }}>Setups</p>

          <button id="btn-pendulum" onClick={() => handleBlueprint('pendulum')} style={sideBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <span style={sideBtnIcon}>⏚</span>
            <span style={sideBtnLabel}>Pendulum</span>
          </button>

          <button id="btn-dominoes" onClick={() => handleBlueprint('dominoes')} style={sideBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <span style={sideBtnIcon}>▮</span>
            <span style={sideBtnLabel}>Dominoes</span>
          </button>

          <button id="btn-ramp" onClick={() => handleBlueprint('ramp')} style={sideBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <span style={sideBtnIcon}>◢</span>
            <span style={sideBtnLabel}>Ramp</span>
          </button>

          {/* Divider */}
          <div style={{ height: '1px', background: '#e5e5e4', margin: '4px 0' }} />

          <button id="btn-toggle-materials" onClick={() => setShowMaterials((v) => !v)}
            style={{ ...sideBtn, borderColor: showMaterials ? '#0f766e' : '#e5e5e4', background: showMaterials ? '#ecfdf5' : '#ffffff' }}
            onMouseEnter={(e) => { if (!showMaterials) e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { if (!showMaterials) e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <span style={sideBtnIcon}>⚙</span>
            <span style={{ ...sideBtnLabel, color: showMaterials ? '#0f766e' : '#555553' }}>Physics</span>
          </button>
        </div>

        {/* ── CENTER: Physics Canvas (drop target) ─────────────────── */}
        <div
          className={(activeTool === 'link' || activeTool === 'pivot') ? 'link-mode-cursor' : ''}
          style={{ flex: 1, position: 'relative' }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={handleCanvasDrop}
        >
          <div ref={sceneRef} style={{ position: 'absolute', inset: 0 }} />
          <ConstraintOverlay
            width={canvasSize.w}
            height={canvasSize.h}
            linkBodyA={linkBodyA}
            cursorPos={cursorPos}
            isLinkMode={activeTool === 'link'}
            constraintsMeta={constraintsMeta}
          />
          {popover && (
            <ConstraintConfigPopover
              posX={popover.posX}
              posY={popover.posY}
              autoLength={popover.autoLength}
              onConfirm={handleCreateConstraint}
              onCancel={handleCancelLink}
            />
          )}
          {/* Tool mode status indicator */}
          {activeTool === 'link' && !popover && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              padding: '6px 16px', borderRadius: 20,
              background: 'rgba(15,118,110,0.9)', color: '#fff',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
              backdropFilter: 'blur(8px)', zIndex: 10,
              boxShadow: '0 2px 12px rgba(15,118,110,0.3)',
            }}>
              {linkBodyA ? '🔗 Click second body to connect' : '🔗 Click first body'}
            </div>
          )}
          {activeTool === 'pivot' && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              padding: '6px 16px', borderRadius: 20,
              background: 'rgba(245,158,11,0.9)', color: '#fff',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
              backdropFilter: 'blur(8px)', zIndex: 10,
              boxShadow: '0 2px 12px rgba(245,158,11,0.3)',
            }}>
              📌 Click a body to pin it in place
            </div>
          )}
          {activeTool === 'cut' && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              padding: '6px 16px', borderRadius: 20,
              background: 'rgba(220,38,38,0.9)', color: '#fff',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
              backdropFilter: 'blur(8px)', zIndex: 10,
              boxShadow: '0 2px 12px rgba(220,38,38,0.3)',
            }}>
              ✂️ Click a body to remove it
            </div>
          )}
        </div>

        {/* ── RIGHT: Analytics + Materials + Constraint Inspector ──────── */}
        <div style={{
          width: '280px',
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          borderLeft: '1px solid #e5e5e4',
          background: 'rgba(255,255,255,0.6)',
        }}>
          {selectedConstraint && (
            <ConstraintInspector
              constraint={selectedConstraint}
              onUpdate={handleUpdateConstraint}
              onDelete={handleDeleteConstraint}
            />
          )}
          {showMaterials && (
            <MaterialsPanel materials={materials} onChange={handleMaterialChange} />
          )}
          <AnalyticsDashboard data={analyticsData} />
        </div>
      </div>
    </div>
  );
};

export default PhysicsCanvas;

