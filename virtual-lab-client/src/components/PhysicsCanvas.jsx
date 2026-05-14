import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { io } from 'socket.io-client';
import AnalyticsDashboard from './AnalyticsDashboard';
import MaterialsPanel from './MaterialsPanel';
import { spawnPendulum, spawnDominoes, spawnRamp } from '../blueprints';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const MAX_POINTS = 60;
const CANVAS_W = 1200;
const CANVAS_H = 700;
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

  // ── Engine & Socket setup ──────────────────────────────────────────────────
  useEffect(() => {
    const { Engine, Render, Runner, Bodies, Body, Composite, Mouse, MouseConstraint, Events, Constraint } = Matter;

    const engine = Engine.create();
    engine.gravity.y = materialsRef.current.gravity;
    engineRef.current = engine;

    const render = Render.create({
      element: sceneRef.current,
      engine,
      options: { width: CANVAS_W, height: CANVAS_H, wireframes: false, background: '#FFFFFF' },
    });

    // Walls + ground
    const ground = Bodies.rectangle(CANVAS_W / 2, CANVAS_H + 10, CANVAS_W + 20, 40, { isStatic: true, label: 'ground', render: { fillStyle: '#f1f5f9' } });
    const wallL = Bodies.rectangle(-10, CANVAS_H / 2, 20, CANVAS_H, { isStatic: true, label: 'wallL', render: { fillStyle: '#f1f5f9' } });
    const wallR = Bodies.rectangle(CANVAS_W + 10, CANVAS_H / 2, 20, CANVAS_H, { isStatic: true, label: 'wallR', render: { fillStyle: '#f1f5f9' } });
    Composite.add(engine.world, [ground, wallL, wallR]);

    // Mouse
    const mouse = Mouse.create(render.canvas);
    const mc = MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2, render: { visible: false } } });
    Composite.add(engine.world, mc);

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
      Composite.remove(engine.world, Composite.allBodies(engine.world).filter((b) => !b.isStatic));
      Composite.remove(engine.world, Composite.allConstraints(engine.world).filter((c) => c.label !== 'Mouse Constraint'));
    });

    // ── Drag tracking ──────────────────────────────────────────────────────
    let isDragging = false;
    Events.on(mc, 'startdrag', (e) => {
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

  const handleAddBox = () => {
    const uid = genUID();
    const m = materialsRef.current;
    const data = { type: 'box', label: uid, x: CANVAS_W / 2, y: 60, w: 60, h: 60, color: '#3b82f6', friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction };
    const box = Matter.Bodies.rectangle(data.x, data.y, data.w, data.h, { label: uid, _w: 60, _h: 60, render: { fillStyle: data.color }, friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction });
    addToWorld(data, [box]);
  };

  const handleAddCircle = () => {
    const uid = genUID();
    const m = materialsRef.current;
    const data = { type: 'circle', label: uid, x: CANVAS_W / 2, y: 60, radius: 30, color: '#10b981', friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction };
    const circle = Matter.Bodies.circle(data.x, data.y, data.radius, { label: uid, render: { fillStyle: data.color }, friction: m.friction, restitution: m.restitution, frictionAir: m.airFriction });
    addToWorld(data, [circle]);
  };

  const handleAddSpring = () => {
    const uid = genUID();
    const m = materialsRef.current;
    const data = { type: 'spring', label: uid, x1: CANVAS_W / 2 - 60, y1: 60, x2: CANVAS_W / 2 + 60, y2: 60 };
    const b1 = Matter.Bodies.rectangle(data.x1, data.y1, 40, 40, { label: uid + '_a', _w: 40, _h: 40, render: { fillStyle: '#f59e0b' }, friction: m.friction, restitution: m.restitution });
    const b2 = Matter.Bodies.rectangle(data.x2, data.y2, 40, 40, { label: uid + '_b', _w: 40, _h: 40, render: { fillStyle: '#a855f7' }, friction: m.friction, restitution: m.restitution });
    const spring = Matter.Constraint.create({ bodyA: b1, bodyB: b2, stiffness: 0.05, render: { strokeStyle: '#9ca3af', lineWidth: 3 } });
    addToWorld(data, [b1, b2, spring]);
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
    Composite.remove(engineRef.current.world, Composite.allBodies(engineRef.current.world).filter((b) => !b.isStatic));
    Composite.remove(engineRef.current.world, Composite.allConstraints(engineRef.current.world).filter((c) => c.label !== 'Mouse Constraint'));
    setAnalyticsData([]);
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

  // ── Toolbar button style helper ────────────────────────────────────────────
  const tbtn = (active = false) =>
    `px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 active:scale-95 ` +
    (active
      ? 'text-indigo-600 bg-indigo-50'
      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50');

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Top Toolbar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-white border-b border-gray-100">

        {/* Logo + Room + Host badge */}
        <div className="flex items-center gap-2 mr-4 pr-4 border-r border-gray-100">
          <span className="text-base">⚗️</span>
          <span className="text-sm font-semibold text-gray-800 tracking-tight">VirtualLab</span>
          <span className="text-[10px] text-gray-300 font-medium uppercase tracking-wider ml-1">{roomId}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1" />
          <span className="text-[11px] text-gray-300 font-medium">{userCount}</span>
          {isHost && (
            <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-amber-50 text-amber-500 rounded border border-amber-200">
              Host
            </span>
          )}
        </div>

        {/* Shapes */}
        <button id="btn-add-square" onClick={handleAddBox} className={tbtn()}>□ Square</button>
        <button id="btn-add-circle" onClick={handleAddCircle} className={tbtn()}>○ Circle</button>
        <button id="btn-add-spring" onClick={handleAddSpring} className={tbtn()}>⌇ Spring</button>

        <div className="w-px h-4 bg-gray-100 mx-1" />

        <button id="btn-pendulum" onClick={() => handleBlueprint('pendulum')} className={tbtn()}>⏚ Pendulum</button>
        <button id="btn-dominoes" onClick={() => handleBlueprint('dominoes')} className={tbtn()}>▮ Dominoes</button>
        <button id="btn-ramp" onClick={() => handleBlueprint('ramp')} className={tbtn()}>◢ Ramp</button>

        <div className="w-px h-4 bg-gray-100 mx-1" />

        <button id="btn-toggle-materials" onClick={() => setShowMaterials((v) => !v)} className={tbtn(showMaterials)}>⚙ Physics</button>
        <button id="btn-toggle-analytics" onClick={() => setShowAnalytics((v) => !v)} className={tbtn(showAnalytics)}>◎ Analytics</button>

        <div className="ml-auto flex items-center gap-1">
          <button id="btn-save" onClick={handleSave}
            className="px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:text-gray-500 hover:bg-gray-50 rounded-lg transition">Save</button>
          {hasSave && (
            <button id="btn-restore" onClick={handleRestore}
              className="px-2.5 py-1.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-50 rounded-lg transition">Restore</button>
          )}
          <button id="btn-clear" onClick={handleClear}
            className="px-2.5 py-1.5 text-[11px] font-medium text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition">Clear</button>
          <div className="w-px h-4 bg-gray-100 mx-1" />
          <button onClick={onLeave}
            className="px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:text-gray-500 hover:bg-gray-50 rounded-lg transition">← Leave</button>
        </div>
      </div>

      {/* ── Main: full-screen canvas + optional sidebar ───────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas fills all available space */}
        <div className="flex-1 relative">
          <div ref={sceneRef} className="absolute inset-0" />
        </div>

        {/* Right sidebar */}
        {(showAnalytics || showMaterials) && (
          <div className="w-[280px] overflow-y-auto p-3 flex flex-col gap-3 border-l border-gray-100 bg-gray-50/50">
            {showMaterials && (
              <MaterialsPanel materials={materials} onChange={handleMaterialChange} />
            )}
            {showAnalytics && <AnalyticsDashboard data={analyticsData} />}
          </div>
        )}
      </div>
    </div>
  );
};

export default PhysicsCanvas;
