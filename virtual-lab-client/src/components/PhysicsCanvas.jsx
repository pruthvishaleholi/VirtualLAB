import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import { io } from 'socket.io-client';
import BodyAnalytics from './BodyAnalytics';
import MaterialsPanel from './MaterialsPanel';
import ConstraintConfigPopover from './ConstraintConfigPopover';
import ConstraintOverlay from './ConstraintOverlay';
import ConstraintInspector from './ConstraintInspector';
import { createConstraintFromConfig, updateConstraintProps, findBodyAtPoint, getConstraintsMeta, createWorldPivot } from '../utils/constraintHelpers';
import { spawnPendulum, spawnDominoes, spawnRamp } from '../blueprints';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const MAX_POINTS = 60;

const WORLD_W = 1400;  // Fixed world width — same for every client
const WORLD_H = 800;   // Fixed world height — same for every client

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
  } else if (data.type === 'platform') {
    const platform = Bodies.rectangle(data.x, data.y, data.w, data.h, {
      isStatic: true,
      label: data.label,
      _w: data.w, _h: data.h,
      render: { fillStyle: data.color || '#64748b' },
      friction: data.friction ?? 0.1,
      restitution: data.restitution ?? 0.6,
    });
    Matter.Body.setAngle(platform, data.angle || 0);
    items.push(platform);
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

// ── Full world serialization (bodies + constraints + motors) for cloud save ──
function serializeWorldFull(engine, bodyMotors, simRunning) {
  const { Composite } = Matter;
  const allBodies = Composite.allBodies(engine.world)
    .filter((b) => !b.label?.startsWith('wall') && b.label !== 'ground');
  const allConstraints = Composite.allConstraints(engine.world)
    .filter((c) => c.label !== 'Mouse Constraint');

  const bodies = allBodies.map((b) => {
    const isCircle = b.circleRadius > 0;
    let w = b._w, h = b._h;
    if (w == null || h == null) {
      const v = b.vertices;
      if (v && v.length >= 3) {
        w = Math.sqrt((v[1].x - v[0].x) ** 2 + (v[1].y - v[0].y) ** 2);
        h = Math.sqrt((v[2].x - v[1].x) ** 2 + (v[2].y - v[1].y) ** 2);
      } else {
        w = b.bounds.max.x - b.bounds.min.x;
        h = b.bounds.max.y - b.bounds.min.y;
      }
    }
    return {
      label: b.label, x: b.position.x, y: b.position.y,
      angle: b.angle, vx: b.velocity.x, vy: b.velocity.y,
      isCircle, circleRadius: b.circleRadius,
      width: w, height: h, mass: b.mass,
      isStatic: b.isStatic, color: b.render?.fillStyle || '#3b82f6',
      friction: b.friction, restitution: b.restitution, frictionAir: b.frictionAir,
    };
  });

  const constraints = allConstraints.map((c) => ({
    bodyALabel: c.bodyA?.label, bodyBLabel: c.bodyB?.label,
    length: c.length, stiffness: c.stiffness,
    strokeStyle: c.render?.strokeStyle, lineWidth: c.render?.lineWidth,
  }));

  return { bodies, constraints, bodyMotors: { ...bodyMotors }, simRunning };
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
  const simRunningRef = useRef(true);   // is the simulation playing?
  const receivedRoomState = useRef(false); // has the peer received the initial room state?
  const bodyHistoryRef = useRef({});     // { [label]: [{t, speed, angVel, x, y, ke, pe}] }
  const bodyNameCounterRef = useRef({ box: 0, circle: 0, other: 0 }); // for friendly names
  const bodyNamesRef = useRef({});       // { [label]: 'Box 1' }
  const selectedBodyIdxRef = useRef(0);
  const renderRef = useRef(null);

  const [perBodySnapshot, setPerBodySnapshot] = useState({ list: [], selected: null, systemStats: null });
  const [selectedBodyIdx, setSelectedBodyIdx] = useState(0);
  const [materials, setMaterials] = useState({ gravity: 1, friction: 0.1, restitution: 0.6, airFriction: 0.01 });
  const [userCount, setUserCount] = useState(1);
  const [isHost, setIsHost] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showMaterials, setShowMaterials] = useState(false);
  const [hasSave, setHasSave] = useState(!!localStorage.getItem('vlab_save'));
  const [simRunning, setSimRunning] = useState(true);

  // ── Cloud Save/Load state ──────────────────────────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [savedSims, setSavedSims] = useState([]);
  const [cloudMsg, setCloudMsg] = useState('');

  // ── Link Tool state ────────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState('select'); // 'select' | 'link' | 'pivot' | 'cut' | 'platform'
  const [linkBodyA, setLinkBodyA] = useState(null);       // { body, x, y }
  const [popover, setPopover] = useState(null);            // { posX, posY, bodyA, bodyB, autoLength }
  const [cursorPos, setCursorPos] = useState(null);
  const [constraintsMeta, setConstraintsMeta] = useState([]);
  const [selectedConstraint, setSelectedConstraint] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: WORLD_W, h: WORLD_H });
  const [platformStart, setPlatformStart] = useState(null); // { x, y } first click for platform tool
  const motorsRef = useRef(new Map());                     // uid -> { bodyB, angularVelocity }
  const bodyMotorsRef = useRef({});                         // label -> { angularVelocity, angularAcceleration, currentVel }
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

    // Use fixed world dimensions for a consistent coordinate system across all clients
    const container = sceneRef.current;
    const CANVAS_W = WORLD_W;
    const CANVAS_H = WORLD_H;

    const render = Render.create({
      element: container,
      engine,
      options: { width: CANVAS_W, height: CANVAS_H, wireframes: false, background: 'transparent', pixelRatio: 1 },
    });

    // CSS-scale the canvas to fit the container while keeping aspect ratio
    const fitCanvas = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (!cw || !ch) return;
      const worldAspect = CANVAS_W / CANVAS_H;
      const containerAspect = cw / ch;
      let dw, dh;
      if (containerAspect > worldAspect) {
        dh = ch;
        dw = ch * worldAspect;
      } else {
        dw = cw;
        dh = cw / worldAspect;
      }
      render.canvas.style.width = dw + 'px';
      render.canvas.style.height = dh + 'px';
      render.canvas.style.position = 'absolute';
      render.canvas.style.left = ((cw - dw) / 2) + 'px';
      render.canvas.style.top = ((ch - dh) / 2) + 'px';
    };
    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    // Helper: convert CSS pixel coords (relative to canvas rect) to world coords
    const cssToWorld = (cssX, cssY) => {
      const rect = render.canvas.getBoundingClientRect();
      return {
        x: (cssX / rect.width) * CANVAS_W,
        y: (cssY / rect.height) * CANVAS_H,
      };
    };

    // Walls + ground (fixed world coordinates — identical for every client)
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
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const { x, y } = cssToWorld(cssX, cssY);

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
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      setCursorPos(cssToWorld(cssX, cssY));
    });

    // ── Socket ─────────────────────────────────────────────────────────────
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_room', roomId);
      // If this is a reconnection, re-request state
      if (!receivedRoomState.current) {
        setTimeout(() => {
          if (!receivedRoomState.current) {
            console.log('State not received yet, re-requesting...');
            socket.emit('request_room_state');
          }
        }, 3000);
      }
    });
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
    socket.on('room_state', ({ bodies: bodyArr, constraints: constraintArr, bodyMotors: motorsData, simRunning: remoteSimRunning }) => {
      receivedRoomState.current = true;
      console.log(`Received room_state: ${bodyArr?.length || 0} bodies, ${constraintArr?.length || 0} constraints`);
      if (!bodyArr) return;
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
        // Apply mass if provided (otherwise default from area)
        if (b.mass != null && !b.isStatic) Body.setMass(body, b.mass);
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
      // Restore body motor configs
      if (motorsData) {
        Object.entries(motorsData).forEach(([label, motorConf]) => {
          bodyMotorsRef.current[label] = { ...motorConf };
        });
      }
      // Sync simulation running state from host
      if (remoteSimRunning != null) {
        simRunningRef.current = remoteSimRunning;
        setSimRunning(remoteSimRunning);
        if (remoteSimRunning) {
          engine.gravity.y = materialsRef.current.gravity;
        }
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
        // Compute true dimensions from vertices (edge lengths), not from AABB bounds
        // which are inflated for rotated bodies
        let w = b._w, h = b._h;
        if (w == null || h == null) {
          const v = b.vertices;
          if (v && v.length >= 3) {
            w = Math.sqrt((v[1].x - v[0].x) ** 2 + (v[1].y - v[0].y) ** 2);
            h = Math.sqrt((v[2].x - v[1].x) ** 2 + (v[2].y - v[1].y) ** 2);
          } else {
            w = b.bounds.max.x - b.bounds.min.x;
            h = b.bounds.max.y - b.bounds.min.y;
          }
        }
        return {
          label: b.label, x: b.position.x, y: b.position.y,
          angle: b.angle, vx: b.velocity.x, vy: b.velocity.y,
          isCircle, circleRadius: b.circleRadius,
          width: w, height: h, mass: b.mass,
          isStatic: b.isStatic, color: b.render?.fillStyle || '#3b82f6',
          friction: b.friction, restitution: b.restitution, frictionAir: b.frictionAir,
        };
      });

      const constraints = allConstraints.map((c) => ({
        bodyALabel: c.bodyA?.label, bodyBLabel: c.bodyB?.label,
        length: c.length, stiffness: c.stiffness,
        strokeStyle: c.render?.strokeStyle, lineWidth: c.render?.lineWidth,
      }));

      socket.emit('state_snapshot', {
        targetSocketId: requesterSocketId,
        bodies,
        constraints,
        bodyMotors: { ...bodyMotorsRef.current },
        simRunning: simRunningRef.current,
      });
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

    // ── Simulation start/stop sync ──────────────────────────────────────
    socket.on('receive_toggle_sim', ({ running }) => {
      simRunningRef.current = running;
      setSimRunning(running);
      if (running && engine) {
        engine.gravity.y = materialsRef.current.gravity;
      }
    });

    // ── Body property update sync ──────────────────────────────────────
    socket.on('receive_update_body', ({ label, prop, value }) => {
      const body = Composite.allBodies(engine.world).find(b => b.label === label);
      if (!body) return;

      switch (prop) {
        case 'mass':
          Body.setMass(body, Math.max(0.1, value));
          break;
        case 'radius': {
          const oldR = body.circleRadius || 30;
          if (oldR > 0 && value > 0) {
            const s = value / oldR;
            Body.scale(body, s, s);
            body.circleRadius = value;
          }
          break;
        }
        case 'width': {
          const oldW = body._w || 60;
          if (oldW > 0 && value > 0) {
            const savedAngle = body.angle;
            Body.setAngle(body, 0);
            Body.scale(body, value / oldW, 1);
            Body.setAngle(body, savedAngle);
            body._w = value;
          }
          break;
        }
        case 'height': {
          const oldH = body._h || 60;
          if (oldH > 0 && value > 0) {
            const savedAngle = body.angle;
            Body.setAngle(body, 0);
            Body.scale(body, 1, value / oldH);
            Body.setAngle(body, savedAngle);
            body._h = value;
          }
          break;
        }
        case 'friction':
          body.friction = Math.max(0, value);
          break;
        case 'restitution':
          body.restitution = Math.max(0, Math.min(1, value));
          break;
        case 'motor_toggle': {
          if (value) {
            bodyMotorsRef.current[label] = { angularVelocity: 0.1, angularAcceleration: 0, currentVel: 0.1 };
          } else {
            delete bodyMotorsRef.current[label];
            Body.setAngularVelocity(body, 0);
          }
          break;
        }
        case 'motor_angularVelocity': {
          const m = bodyMotorsRef.current[label];
          if (m) { m.angularVelocity = value; m.currentVel = value; }
          break;
        }
        case 'motor_angularAcceleration': {
          const m = bodyMotorsRef.current[label];
          if (m) m.angularAcceleration = value;
          break;
        }
        default:
          break;
      }
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

      // ── Pause mode: zero gravity, freeze all non-dragged bodies ────────
      if (!simRunningRef.current) {
        engine.gravity.y = 0;
        const allDyn = Composite.allBodies(engine.world).filter(b => !b.isStatic);
        allDyn.forEach(b => {
          if (b.label === draggedLabelRef.current) return; // let dragged body move
          Body.setVelocity(b, { x: 0, y: 0 });
          Body.setAngularVelocity(b, 0);
        });
      }

      // Drag sync: emit position of dragged body to other users
      if (isDragging && mc.body) {
        if (now - lastDragEmit.current >= 33) {
          lastDragEmit.current = now;
          const b = mc.body;
          socket.emit('drag_update', { label: b.label, x: b.position.x, y: b.position.y, vx: b.velocity.x, vy: b.velocity.y });
        }
      }

      // Host sync: periodically broadcast all body state to peers
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
            _w: b._w, _h: b._h, mass: b.mass,
            friction: b.friction, restitution: b.restitution,
            circleRadius: b.circleRadius || 0,
            color: b.render?.fillStyle || '#3b82f6',
            motor: bodyMotorsRef.current[b.label] || null,
          }));
          socket.emit('host_sync', syncData);
        }
      }

      // Motor tick: drive motorized joints (only when playing)
      if (simRunningRef.current) {
        motorsRef.current.forEach(({ bodyB, angularVelocity }) => {
          Body.setAngularVelocity(bodyB, angularVelocity);
        });

        // Per-body motors
        const allDynMotor = Composite.allBodies(engine.world).filter(b => !b.isStatic);
        allDynMotor.forEach(b => {
          const m = bodyMotorsRef.current[b.label];
          if (!m) return;
          // Apply acceleration
          m.currentVel = (m.currentVel || m.angularVelocity) + (m.angularAcceleration || 0) * (1/60);
          Body.setAngularVelocity(b, m.currentVel);
        });
      }
    });

    // ── Apply host sync + Analytics (both in afterUpdate) ──────────────────
    Events.on(engine, 'afterUpdate', () => {
      // Apply buffered host sync: snap positions so local engine continues from corrected state
      if (pendingHostSync.current && !isHostRef.current) {
        const syncData = pendingHostSync.current;
        pendingHostSync.current = null;

        // When paused, only apply property changes (dimensions/mass/motor), skip position snaps
        const applyPositions = simRunningRef.current;

        const allBodies = Composite.allBodies(engine.world);
        const bodyMap = {};
        allBodies.forEach((b) => { bodyMap[b.label] = b; });

        syncData.forEach((hb) => {
          let localBody = bodyMap[hb.label];

          // If this body doesn't exist locally, create it from the host data
          if (!localBody) {
            let newBody;
            if (hb.circleRadius > 0) {
              newBody = Bodies.circle(hb.x, hb.y, hb.circleRadius, {
                label: hb.label,
                render: { fillStyle: hb.color || '#3b82f6' },
                friction: hb.friction ?? 0.1,
                restitution: hb.restitution ?? 0.6,
              });
            } else if (hb._w && hb._h) {
              newBody = Bodies.rectangle(hb.x, hb.y, hb._w, hb._h, {
                label: hb.label,
                _w: hb._w, _h: hb._h,
                render: { fillStyle: hb.color || '#3b82f6' },
                friction: hb.friction ?? 0.1,
                restitution: hb.restitution ?? 0.6,
              });
            }
            if (newBody) {
              if (hb.mass != null) Body.setMass(newBody, hb.mass);
              Body.setAngle(newBody, hb.angle || 0);
              Body.setVelocity(newBody, { x: hb.vx || 0, y: hb.vy || 0 });
              Composite.add(engine.world, newBody);
              bodyMap[hb.label] = newBody;
              localBody = newBody;
            }
          }

          if (!localBody || localBody.isStatic) return;
          // Skip body being dragged locally — dragger owns it
          if (draggedLabelRef.current === hb.label) return;

          // Sync dimensions: scale body if host dimensions differ
          if (hb._w != null && localBody._w != null && Math.abs(hb._w - localBody._w) > 0.5) {
            const savedAngle = localBody.angle;
            Body.setAngle(localBody, 0);
            Body.scale(localBody, hb._w / localBody._w, 1);
            Body.setAngle(localBody, savedAngle);
            localBody._w = hb._w;
          }
          if (hb._h != null && localBody._h != null && Math.abs(hb._h - localBody._h) > 0.5) {
            const savedAngle = localBody.angle;
            Body.setAngle(localBody, 0);
            Body.scale(localBody, 1, hb._h / localBody._h);
            Body.setAngle(localBody, savedAngle);
            localBody._h = hb._h;
          }
          // Sync circle radius
          if (hb.circleRadius > 0 && localBody.circleRadius > 0 && Math.abs(hb.circleRadius - localBody.circleRadius) > 0.5) {
            const s = hb.circleRadius / localBody.circleRadius;
            Body.scale(localBody, s, s);
            localBody.circleRadius = hb.circleRadius;
          }
          // Sync mass
          if (hb.mass != null && Math.abs(hb.mass - localBody.mass) > 0.01) {
            Body.setMass(localBody, hb.mass);
          }
          // Sync friction / restitution
          if (hb.friction != null) localBody.friction = hb.friction;
          if (hb.restitution != null) localBody.restitution = hb.restitution;
          // Sync motor config
          if (hb.motor) {
            bodyMotorsRef.current[hb.label] = { ...hb.motor };
          } else if (bodyMotorsRef.current[hb.label]) {
            delete bodyMotorsRef.current[hb.label];
          }

          // Full snap: set exact position, velocity, angle from host (only when playing)
          if (applyPositions) {
            Body.setPosition(localBody, { x: hb.x, y: hb.y });
            Body.setVelocity(localBody, { x: hb.vx, y: hb.vy });
            Body.setAngle(localBody, hb.angle);
          }
        });
      }

      // Per-body analytics
      tickRef.current++;
      if (tickRef.current % 3 !== 0) return;
      const dyn = Composite.allBodies(engine.world).filter((b) => !b.isStatic);

      // Assign friendly names to new bodies
      dyn.forEach(b => {
        if (!bodyNamesRef.current[b.label]) {
          const kind = b.circleRadius ? 'circle' : 'box';
          bodyNameCounterRef.current[kind] = (bodyNameCounterRef.current[kind] || 0) + 1;
          const n = bodyNameCounterRef.current[kind];
          bodyNamesRef.current[b.label] = kind === 'circle' ? `Circle ${n}` : `Box ${n}`;
        }
      });

      // Collect per-body data
      const CANVAS_H_local = CANVAS_H;
      let totalKE = 0, totalPE = 0;
      const bodyList = [];

      dyn.forEach(b => {
        const speed = Math.hypot(b.velocity.x, b.velocity.y);
        const ke = 0.5 * b.mass * speed * speed;
        const pe = b.mass * Math.abs(engine.gravity.y) * Math.max(0, CANVAS_H_local - b.position.y);
        totalKE += ke;
        totalPE += pe;

        const point = {
          t: tickRef.current, speed: +speed.toFixed(2),
          angVel: +Math.abs(b.angularVelocity).toFixed(4),
          x: b.position.x, y: b.position.y, ke: +ke.toFixed(2), pe: +pe.toFixed(2),
        };

        if (!bodyHistoryRef.current[b.label]) bodyHistoryRef.current[b.label] = [];
        const hist = bodyHistoryRef.current[b.label];
        hist.push(point);
        if (hist.length > MAX_POINTS) hist.splice(0, hist.length - MAX_POINTS);

        bodyList.push({
          label: b.label,
          name: bodyNamesRef.current[b.label] || b.label,
          color: b.render?.fillStyle || '#3b82f6',
          type: b.circleRadius ? 'circle' : 'box',
          current: {
            x: b.position.x, y: b.position.y,
            vx: b.velocity.x, vy: b.velocity.y,
            speed, angle: b.angle, angVel: Math.abs(b.angularVelocity),
            mass: b.mass, ke, pe,
            radius: b.circleRadius || 0,
            width: b._w || 0,
            height: b._h || 0,
            friction: b.friction,
            restitution: b.restitution,
            motor: bodyMotorsRef.current[b.label] || null,
          },
          history: [...hist],
        });
      });

      // Clean up removed bodies
      const liveLabels = new Set(dyn.map(b => b.label));
      Object.keys(bodyHistoryRef.current).forEach(lbl => {
        if (!liveLabels.has(lbl)) {
          delete bodyHistoryRef.current[lbl];
          delete bodyNamesRef.current[lbl];
        }
      });

      // Clamp selected index
      let idx = selectedBodyIdxRef.current;
      if (bodyList.length > 0) {
        if (idx >= bodyList.length) idx = bodyList.length - 1;
        if (idx < 0) idx = 0;
      }

      setPerBodySnapshot({
        list: bodyList,
        selected: bodyList[idx] || null,
        selectedIndex: idx,
        systemStats: { totalBodies: dyn.length, totalKE, totalPE },
      });

      // Update constraint overlay metadata
      setConstraintsMeta(getConstraintsMeta(engine));
    });

    renderRef.current = render;

    // ── Highlight selected body on canvas ────────────────────────────────
    Events.on(render, 'afterRender', () => {
      const dyn = Composite.allBodies(engine.world).filter(b => !b.isStatic);
      if (dyn.length === 0) return;
      let idx = selectedBodyIdxRef.current;
      if (idx >= dyn.length) idx = dyn.length - 1;
      if (idx < 0) idx = 0;
      const body = dyn[idx];
      if (!body) return;

      const ctx = render.context;
      const verts = body.vertices;
      const cx = body.position.x;
      const cy = body.position.y;

      // ── Yellow highlight border ──────────────────────────────────────
      ctx.save();
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.9)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(234, 179, 8, 0.6)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // ── Floating name label ──────────────────────────────────────────
      const name = bodyNamesRef.current[body.label] || body.label;
      ctx.save();
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      const textW = ctx.measureText(name).width;
      const tagW = textW + 16;
      const tagH = 20;
      const tagX = cx - tagW / 2;
      const tagY = cy - 48;

      ctx.fillStyle = 'rgba(234, 179, 8, 0.95)';
      ctx.shadowColor = 'rgba(0,0,0,0.2)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 4);
      ctx.fill();

      // Pointer arrow
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(cx - 5, tagY + tagH);
      ctx.lineTo(cx, tagY + tagH + 6);
      ctx.lineTo(cx + 5, tagY + tagH);
      ctx.fill();

      // Text
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, cx, tagY + tagH / 2);
      ctx.restore();
    });

    Render.run(render);
    const runner = Runner.create();
    Runner.run(runner, engine);

    return () => {
      Render.stop(render);
      Runner.stop(runner);
      Engine.clear(engine);
      socket.disconnect();
      window.removeEventListener('resize', fitCanvas);
      if (render.canvas) render.canvas.remove();
    };
  }, [roomId]);

  // ── Keep activeToolRef in sync ─────────────────────────────────────────────
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // ── Keyboard navigation for body selector (← →) ─────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const list = perBodySnapshot.list;
        if (!list || list.length === 0) return;
        setSelectedBodyIdx(prev => {
          let next;
          if (e.key === 'ArrowLeft') next = prev <= 0 ? list.length - 1 : prev - 1;
          else next = prev >= list.length - 1 ? 0 : prev + 1;
          selectedBodyIdxRef.current = next;
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [perBodySnapshot.list]);

  // ── Sync selected body when index changes ─────────────────────────────────
  useEffect(() => {
    if (perBodySnapshot.list && perBodySnapshot.list.length > 0) {
      const idx = Math.min(selectedBodyIdx, perBodySnapshot.list.length - 1);
      setPerBodySnapshot(prev => ({
        ...prev,
        selected: prev.list[idx] || null,
        selectedIndex: idx,
      }));
    }
  }, [selectedBodyIdx]);

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
          _w: length, _h: 12,
          render: { fillStyle: '#64748b' },
          friction: materialsRef.current.friction,
          restitution: materialsRef.current.restitution,
        });
        Matter.Body.setAngle(platform, angle);
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

  const handleAddBox = () => { spawnAt('box', WORLD_W / 2, 60); };
  const handleAddCircle = () => { spawnAt('circle', WORLD_W / 2, 60); };
  const handleAddSpring = () => { spawnAt('spring', WORLD_W / 2, 60); };

  // ── Update individual body properties from inspector ────────────────────
  const handleUpdateBody = useCallback((label, prop, value) => {
    const engine = engineRef.current;
    if (!engine) return;
    const body = Matter.Composite.allBodies(engine.world).find(b => b.label === label);
    if (!body) return;
    const { Body } = Matter;

    switch (prop) {
      case 'mass':
        Body.setMass(body, Math.max(0.1, value));
        break;
      case 'radius': {
        // Scale circle to new radius
        const oldR = body.circleRadius || 30;
        if (oldR > 0 && value > 0) {
          const s = value / oldR;
          Body.scale(body, s, s);
          body.circleRadius = value;
        }
        break;
      }
      case 'width': {
        const oldW = body._w || 60;
        if (oldW > 0 && value > 0) {
          const savedAngle = body.angle;
          Body.setAngle(body, 0);
          Body.scale(body, value / oldW, 1);
          Body.setAngle(body, savedAngle);
          body._w = value;
        }
        break;
      }
      case 'height': {
        const oldH = body._h || 60;
        if (oldH > 0 && value > 0) {
          const savedAngle = body.angle;
          Body.setAngle(body, 0);
          Body.scale(body, 1, value / oldH);
          Body.setAngle(body, savedAngle);
          body._h = value;
        }
        break;
      }
      case 'friction':
        body.friction = Math.max(0, value);
        break;
      case 'restitution':
        body.restitution = Math.max(0, Math.min(1, value));
        break;
      case 'motor_toggle': {
        if (value) {
          bodyMotorsRef.current[label] = { angularVelocity: 0.1, angularAcceleration: 0, currentVel: 0.1 };
        } else {
          delete bodyMotorsRef.current[label];
          Body.setAngularVelocity(body, 0);
        }
        break;
      }
      case 'motor_angularVelocity': {
        const m = bodyMotorsRef.current[label];
        if (m) { m.angularVelocity = value; m.currentVel = value; }
        break;
      }
      case 'motor_angularAcceleration': {
        const m = bodyMotorsRef.current[label];
        if (m) m.angularAcceleration = value;
        break;
      }
      default:
        break;
    }

    // Sync to peers
    socketRef.current?.emit('update_body', { label, prop, value });
  }, []);

  const handleCanvasDrop = (e) => {
    e.preventDefault();
    const shapeType = e.dataTransfer.getData('shapeType');
    if (!shapeType) return;
    const canvas = sceneRef.current?.querySelector('canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const x = (cssX / rect.width) * WORLD_W;
    const y = (cssY / rect.height) * WORLD_H;
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
    bodyHistoryRef.current = {};
    bodyNamesRef.current = {};
    bodyNameCounterRef.current = { box: 0, circle: 0, other: 0 };
    bodyMotorsRef.current = {};
    selectedBodyIdxRef.current = 0;
    setSelectedBodyIdx(0);
    setPerBodySnapshot({ list: [], selected: null, systemStats: null });
    motorsRef.current.clear();
    constraintsMapRef.current.clear();
    setSelectedConstraint(null);
    setLinkBodyA(null);
    setPopover(null);
    setPlatformStart(null);
    socketRef.current?.emit('clear_canvas');
  };

  // ── Save / Restore (localStorage) ──────────────────────────────────────────
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

  // ── Cloud Save ─────────────────────────────────────────────────────────────
  const handleCloudSave = async () => {
    if (!saveName.trim()) return;
    setCloudSaving(true);
    setCloudMsg('');
    try {
      const { bodies, constraints, bodyMotors, simRunning: sr } = serializeWorldFull(
        engineRef.current, bodyMotorsRef.current, simRunningRef.current
      );
      const res = await fetch(`${SERVER_URL}/api/simulations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim(), roomId, createdBy: userName, bodies, constraints, bodyMotors, simRunning: sr }),
      });
      if (!res.ok) throw new Error('Save failed');
      setCloudMsg('Saved!');
      setSaveName('');
      setTimeout(() => { setShowSaveModal(false); setCloudMsg(''); }, 1200);
    } catch (err) {
      setCloudMsg('Error: ' + err.message);
    } finally {
      setCloudSaving(false);
    }
  };

  // ── Cloud Load ─────────────────────────────────────────────────────────────
  const handleOpenLoadModal = async () => {
    setShowLoadModal(true);
    setCloudLoading(true);
    setCloudMsg('');
    try {
      const res = await fetch(`${SERVER_URL}/api/simulations`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSavedSims(data);
    } catch (err) {
      setCloudMsg('Error: ' + err.message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleCloudLoad = async (simId) => {
    setCloudLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/simulations/${simId}`);
      if (!res.ok) throw new Error('Failed to load');
      const sim = await res.json();
      const { Bodies, Composite, Body, Constraint } = Matter;

      // Clear current canvas first
      const bodiesToRemove = Composite.allBodies(engineRef.current.world).filter((b) => {
        if (!b.isStatic) return true;
        if (b.label?.startsWith('wall') || b.label === 'ground') return false;
        return true;
      });
      Composite.remove(engineRef.current.world, bodiesToRemove);
      Composite.remove(engineRef.current.world, Composite.allConstraints(engineRef.current.world).filter((c) => c.label !== 'Mouse Constraint'));
      motorsRef.current.clear();
      constraintsMapRef.current.clear();
      bodyMotorsRef.current = {};
      bodyHistoryRef.current = {};
      bodyNamesRef.current = {};
      bodyNameCounterRef.current = { box: 0, circle: 0, other: 0 };

      // Restore bodies
      const labelToBody = {};
      (sim.bodies || []).forEach((b) => {
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
        if (!b.isStatic) {
          Body.setVelocity(body, { x: b.vx || 0, y: b.vy || 0 });
          if (b.mass != null) Body.setMass(body, b.mass);
        }
        labelToBody[b.label] = body;
        Composite.add(engineRef.current.world, body);
      });

      // Restore constraints
      (sim.constraints || []).forEach((c) => {
        const bodyA = labelToBody[c.bodyALabel];
        const bodyB = labelToBody[c.bodyBLabel];
        if (bodyA && bodyB) {
          Composite.add(engineRef.current.world, Constraint.create({
            bodyA, bodyB, length: c.length, stiffness: c.stiffness,
            render: { strokeStyle: c.strokeStyle, lineWidth: c.lineWidth },
          }));
        }
      });

      // Restore motors
      if (sim.bodyMotors) {
        Object.entries(sim.bodyMotors).forEach(([label, motorConf]) => {
          bodyMotorsRef.current[label] = { ...motorConf };
        });
      }

      // Restore sim running state
      if (sim.simRunning != null) {
        simRunningRef.current = sim.simRunning;
        setSimRunning(sim.simRunning);
      }

      setShowLoadModal(false);
      setCloudMsg('');
    } catch (err) {
      setCloudMsg('Error: ' + err.message);
    } finally {
      setCloudLoading(false);
    }
  };

  const handleCloudDelete = async (simId) => {
    try {
      await fetch(`${SERVER_URL}/api/simulations/${simId}`, { method: 'DELETE' });
      setSavedSims((prev) => prev.filter((s) => s._id !== simId));
    } catch (err) {
      setCloudMsg('Delete failed');
    }
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
          {/* ── Play / Stop ────────────────────────────────── */}
          <button id="btn-play" onClick={() => {
            if (engineRef.current) engineRef.current.gravity.y = materialsRef.current.gravity;
            simRunningRef.current = true;
            setSimRunning(true);
            socketRef.current?.emit('toggle_sim', { running: true });
          }} style={{
            padding: '6px 14px', borderRadius: '8px',
            border: simRunning ? '1px solid #bbf7d0' : '1px solid #e5e5e4',
            background: simRunning ? '#dcfce7' : '#fff',
            fontSize: '12px', fontWeight: 600,
            color: simRunning ? '#16a34a' : '#777',
            cursor: 'pointer', transition: 'all 0.2s',
          }}>▶ Play</button>
          <button id="btn-stop" onClick={() => {
            simRunningRef.current = false;
            setSimRunning(false);
            socketRef.current?.emit('toggle_sim', { running: false });
          }} style={{
            padding: '6px 14px', borderRadius: '8px',
            border: !simRunning ? '1px solid #fecaca' : '1px solid #e5e5e4',
            background: !simRunning ? '#fef2f2' : '#fff',
            fontSize: '12px', fontWeight: 600,
            color: !simRunning ? '#dc2626' : '#777',
            cursor: 'pointer', transition: 'all 0.2s',
          }}>⏹ Stop</button>
          <div style={{ width: '1px', height: '20px', background: '#e5e5e4', margin: '0 4px' }} />
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
          <div style={{ width: '1px', height: '20px', background: '#e5e5e4', margin: '0 4px' }} />
          <button onClick={() => { setShowSaveModal(true); setCloudMsg(''); setSaveName(''); }} style={{
            padding: '6px 14px', borderRadius: '8px', border: '1px solid #bfdbfe',
            background: '#eff6ff', fontSize: '12px', fontWeight: 500, color: '#2563eb',
            cursor: 'pointer', transition: 'all 0.2s',
          }}>☁ Save</button>
          <button onClick={handleOpenLoadModal} style={{
            padding: '6px 14px', borderRadius: '8px', border: '1px solid #bfdbfe',
            background: '#eff6ff', fontSize: '12px', fontWeight: 500, color: '#2563eb',
            cursor: 'pointer', transition: 'all 0.2s',
          }}>☁ Load</button>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
            <span style={{ ...sideBtnLabel, color: activeTool === 'select' ? '#0f766e' : '#555553' }}>Select</span>
          </button>

          <button id="btn-link-tool" onClick={() => { setActiveTool(activeTool === 'link' ? 'select' : 'link'); handleCancelLink(); }}
            style={{ ...sideBtn, borderColor: activeTool === 'link' ? '#0f766e' : '#e5e5e4', background: activeTool === 'link' ? '#ecfdf5' : '#fff' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span style={{ ...sideBtnLabel, color: activeTool === 'link' ? '#0f766e' : '#555553' }}>Link</span>
          </button>

          <button id="btn-pivot-tool" onClick={() => { setActiveTool(activeTool === 'pivot' ? 'select' : 'pivot'); handleCancelLink(); }}
            style={{ ...sideBtn, borderColor: activeTool === 'pivot' ? '#0f766e' : '#e5e5e4', background: activeTool === 'pivot' ? '#ecfdf5' : '#fff' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
            <span style={{ ...sideBtnLabel, color: activeTool === 'pivot' ? '#0f766e' : '#555553' }}>Pivot</span>
          </button>

          <button id="btn-cut-tool" onClick={() => { setActiveTool(activeTool === 'cut' ? 'select' : 'cut'); handleCancelLink(); }}
            style={{ ...sideBtn, borderColor: activeTool === 'cut' ? '#dc2626' : '#e5e5e4', background: activeTool === 'cut' ? '#fef2f2' : '#fff' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
            <span style={{ ...sideBtnLabel, color: activeTool === 'cut' ? '#dc2626' : '#555553' }}>Cut</span>
          </button>

          <button id="btn-platform-tool" onClick={() => { setActiveTool(activeTool === 'platform' ? 'select' : 'platform'); handleCancelLink(); setPlatformStart(null); }}
            style={{ ...sideBtn, borderColor: activeTool === 'platform' ? '#6366f1' : '#e5e5e4', background: activeTool === 'platform' ? '#eef2ff' : '#fff' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="10" width="18" height="4" rx="1"/></svg>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            <span style={sideBtnLabel}>Square</span>
          </button>

          <button id="btn-add-circle" draggable onClick={handleAddCircle} style={{...sideBtn, cursor: 'grab'}}
            onDragStart={(e) => { e.dataTransfer.setData('shapeType', 'circle'); }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/></svg>
            <span style={sideBtnLabel}>Circle</span>
          </button>

          {/* Divider */}
          <div style={{ height: '1px', background: '#e5e5e4', margin: '4px 0' }} />

          <p style={{ fontSize: '9px', fontWeight: 600, color: '#b5b5b3', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', margin: '0 0 2px 0' }}>Setups</p>

          <button id="btn-pendulum" onClick={() => handleBlueprint('pendulum')} style={sideBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="6" x2="12" y2="18"/><circle cx="12" cy="20" r="2"/></svg>
            <span style={sideBtnLabel}>Pendulum</span>
          </button>

          <button id="btn-add-spring" onClick={handleAddSpring} style={sideBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f766e'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e5e4'; }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0s4 3 6 0"/></svg>
            <span style={sideBtnLabel}>Spring</span>
          </button>
        </div>

        {/* ── CENTER: Physics Canvas (drop target) ─────────────────── */}
        <div
          className={(activeTool === 'link' || activeTool === 'pivot') ? 'link-mode-cursor' : ''}
          style={{ flex: 1, position: 'relative' }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={handleCanvasDrop}
        >
          <div ref={sceneRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
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
          <BodyAnalytics
            selectedBody={perBodySnapshot.selected}
            bodyList={perBodySnapshot.list}
            selectedIndex={perBodySnapshot.selectedIndex ?? 0}
            onPrev={() => {
              const list = perBodySnapshot.list;
              if (!list || list.length === 0) return;
              setSelectedBodyIdx(prev => {
                const next = prev <= 0 ? list.length - 1 : prev - 1;
                selectedBodyIdxRef.current = next;
                return next;
              });
            }}
            onNext={() => {
              const list = perBodySnapshot.list;
              if (!list || list.length === 0) return;
              setSelectedBodyIdx(prev => {
                const next = prev >= list.length - 1 ? 0 : prev + 1;
                selectedBodyIdxRef.current = next;
                return next;
              });
            }}
            systemStats={perBodySnapshot.systemStats}
            canvasH={canvasSize.h}
            onUpdateBody={handleUpdateBody}
          />
        </div>
      </div>

      {/* ── Cloud Save Modal ──────────────────────────────────────────── */}
      {showSaveModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowSaveModal(false)}>
          <div style={{
            background: '#fff', borderRadius: '16px', padding: '32px',
            width: '400px', maxWidth: '90vw',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            fontFamily: "'Inter', -apple-system, sans-serif",
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: '#1a1a1a' }}>
              ☁ Save to Cloud
            </h3>
            <p style={{ fontSize: '13px', color: '#9a9a98', marginBottom: '20px' }}>
              Save this simulation to MongoDB for access from any device.
            </p>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCloudSave()}
              placeholder="Simulation name (e.g. Pendulum Demo)"
              autoFocus
              style={{
                width: '100%', padding: '12px 14px', borderRadius: '10px',
                border: '1px solid #d4d4d3', fontSize: '14px', color: '#1a1a1a',
                outline: 'none', boxSizing: 'border-box', marginBottom: '16px',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#2563eb'; }}
              onBlur={(e) => { e.target.style.borderColor = '#d4d4d3'; }}
            />
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={handleCloudSave}
                disabled={cloudSaving || !saveName.trim()}
                style={{
                  padding: '10px 24px', borderRadius: '10px', border: 'none',
                  background: saveName.trim() ? '#2563eb' : '#bfdbfe',
                  color: '#fff', fontSize: '14px', fontWeight: 600,
                  cursor: saveName.trim() ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s',
                }}
              >
                {cloudSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setShowSaveModal(false)}
                style={{
                  padding: '10px 20px', borderRadius: '10px',
                  border: '1px solid #e5e5e4', background: '#fff',
                  color: '#777', fontSize: '14px', fontWeight: 500, cursor: 'pointer',
                }}
              >Cancel</button>
              {cloudMsg && (
                <span style={{
                  fontSize: '13px', fontWeight: 500, marginLeft: '8px',
                  color: cloudMsg.startsWith('Error') ? '#dc2626' : '#16a34a',
                }}>{cloudMsg}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Cloud Load Modal ──────────────────────────────────────────── */}
      {showLoadModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(4px)',
        }} onClick={() => setShowLoadModal(false)}>
          <div style={{
            background: '#fff', borderRadius: '16px', padding: '32px',
            width: '500px', maxWidth: '90vw', maxHeight: '70vh',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            fontFamily: "'Inter', -apple-system, sans-serif",
            display: 'flex', flexDirection: 'column',
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: '#1a1a1a' }}>
              ☁ Load from Cloud
            </h3>
            <p style={{ fontSize: '13px', color: '#9a9a98', marginBottom: '16px' }}>
              Select a saved simulation to restore.
            </p>
            {cloudMsg && (
              <p style={{ fontSize: '13px', color: '#dc2626', marginBottom: '12px' }}>{cloudMsg}</p>
            )}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
              {cloudLoading ? (
                <div style={{ textAlign: 'center', padding: '32px', color: '#9a9a98', fontSize: '14px' }}>
                  Loading...
                </div>
              ) : savedSims.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: '#9a9a98', fontSize: '14px' }}>
                  No saved simulations found.
                </div>
              ) : (
                savedSims.map((sim) => (
                  <div key={sim._id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderRadius: '10px', marginBottom: '6px',
                    border: '1px solid #e5e5e4', background: '#fafafa',
                    transition: 'background 0.15s, border-color 0.15s',
                    cursor: 'pointer',
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#bfdbfe'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fafafa'; e.currentTarget.style.borderColor = '#e5e5e4'; }}
                    onClick={() => handleCloudLoad(sim._id)}
                  >
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{sim.name}</div>
                      <div style={{ fontSize: '11px', color: '#9a9a98', marginTop: '2px' }}>
                        {sim.createdBy} · {sim.roomId || 'no room'} · {new Date(sim.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCloudDelete(sim._id); }}
                      style={{
                        padding: '4px 10px', borderRadius: '6px', border: '1px solid #fecaca',
                        background: '#fef2f2', fontSize: '11px', fontWeight: 500, color: '#dc2626',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >Delete</button>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => setShowLoadModal(false)}
              style={{
                padding: '10px 20px', borderRadius: '10px', alignSelf: 'flex-end',
                border: '1px solid #e5e5e4', background: '#fff',
                color: '#777', fontSize: '14px', fontWeight: 500, cursor: 'pointer',
              }}
            >Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhysicsCanvas;

