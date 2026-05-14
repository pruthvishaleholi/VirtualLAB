import { useState, useEffect, useRef, useCallback } from 'react';

const ROOM_SUGGESTIONS = ['alpha-lab', 'beta-lab', 'quantum-01', 'gravity-test'];

/* ═══════════════════════════════════════════════════════════════════
   Double Pendulum Simulation (Lagrangian mechanics)
   ═══════════════════════════════════════════════════════════════════ */
function useDoublePendulum(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let w, h;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Physics constants
    const g = 9.81;
    const m1 = 10, m2 = 10;
    const L1 = Math.min(w, h) * 0.16;
    const L2 = Math.min(w, h) * 0.16;
    const dt = 0.03;

    // Initial state
    let θ1 = Math.PI / 2 + 0.3;
    let θ2 = Math.PI / 2 - 0.1;
    let ω1 = 0;
    let ω2 = 0;

    // Trail buffer
    const MAX_TRAIL = 600;
    const trail = [];

    // Color palette for the trail (soft pastels)
    const trailColors = [
      [167, 139, 250], // violet
      [129, 140, 248], // indigo
      [99, 102, 241],  // blue
      [96, 165, 250],  // sky
      [147, 197, 253], // light blue
      [167, 139, 250], // back to violet
    ];

    function lerpColor(i, total) {
      const t = (i / total) * (trailColors.length - 1);
      const idx = Math.floor(t);
      const frac = t - idx;
      const c1 = trailColors[Math.min(idx, trailColors.length - 1)];
      const c2 = trailColors[Math.min(idx + 1, trailColors.length - 1)];
      return [
        c1[0] + (c2[0] - c1[0]) * frac,
        c1[1] + (c2[1] - c1[1]) * frac,
        c1[2] + (c2[2] - c1[2]) * frac,
      ];
    }

    // Equations of motion for double pendulum
    function computeAccelerations() {
      const Δ = θ1 - θ2;
      const sinΔ = Math.sin(Δ);
      const cosΔ = Math.cos(Δ);
      const den = 2 * m1 + m2 - m2 * Math.cos(2 * Δ);

      const α1 = (
        -g * (2 * m1 + m2) * Math.sin(θ1)
        - m2 * g * Math.sin(θ1 - 2 * θ2)
        - 2 * sinΔ * m2 * (ω2 * ω2 * L2 + ω1 * ω1 * L1 * cosΔ)
      ) / (L1 * den);

      const α2 = (
        2 * sinΔ * (
          ω1 * ω1 * L1 * (m1 + m2)
          + g * (m1 + m2) * Math.cos(θ1)
          + ω2 * ω2 * L2 * m2 * cosΔ
        )
      ) / (L2 * den);

      return [α1, α2];
    }

    // RK4 integration step
    function step() {
      const state = [θ1, ω1, θ2, ω2];

      function derivs(s) {
        const origθ1 = θ1, origω1 = ω1, origθ2 = θ2, origω2 = ω2;
        θ1 = s[0]; ω1 = s[1]; θ2 = s[2]; ω2 = s[3];
        const [a1, a2] = computeAccelerations();
        θ1 = origθ1; ω1 = origω1; θ2 = origθ2; ω2 = origω2;
        return [s[1], a1, s[3], a2];
      }

      const k1 = derivs(state);
      const k2 = derivs(state.map((v, i) => v + dt / 2 * k1[i]));
      const k3 = derivs(state.map((v, i) => v + dt / 2 * k2[i]));
      const k4 = derivs(state.map((v, i) => v + dt * k3[i]));

      θ1 += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      ω1 += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      θ2 += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      ω2 += (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    }

    // Pivot point (center-ish, slightly above center)
    const pivotX = () => w / 2;
    const pivotY = () => h * 0.38;

    let animId;
    function draw() {
      // Run multiple physics steps per frame for smoother motion
      for (let i = 0; i < 3; i++) step();

      const px = pivotX();
      const py = pivotY();
      const x1 = px + L1 * Math.sin(θ1);
      const y1 = py + L1 * Math.cos(θ1);
      const x2 = x1 + L2 * Math.sin(θ2);
      const y2 = y1 + L2 * Math.cos(θ2);

      // Store trail point
      trail.push({ x: x2, y: y2 });
      if (trail.length > MAX_TRAIL) trail.shift();

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Draw trail — fading multi-colored line segments
      if (trail.length > 1) {
        for (let i = 1; i < trail.length; i++) {
          const age = i / trail.length; // 0=oldest, 1=newest
          const opacity = age * age * 0.35;
          const [r, g, b] = lerpColor(i, trail.length);
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.strokeStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${opacity})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Draw pendulum arms — visible, medium grey
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Pivot dot
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fill();

      // Joint bob (bob 1) — larger, medium grey
      ctx.beginPath();
      ctx.arc(x1, y1, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100, 100, 120, 0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(100, 100, 120, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // End bob (bob 2) — largest, muted purple
      ctx.beginPath();
      ctx.arc(x2, y2, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef]);
}

/* ═══════════════════════════════════════════════════════════════════
   Domino Topple Animation (bottom strip)
   ═══════════════════════════════════════════════════════════════════ */
function useCollisionAnimation(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const BALL_R = 26;
    const DOMINO_COUNT = 11;
    const DOMINO_W = 14;
    const DOMINO_H = 90;
    const DOMINO_GAP = 75;
    const GROUND_Y = H - 40;
    const LOOP = 5000; // 5-second loop

    // Center the domino row
    const totalDominoWidth = (DOMINO_COUNT - 1) * DOMINO_GAP;
    const startDominoX = (W - totalDominoWidth) / 2;

    // Single domino color
    const DOMINO_COLOR = '#94a3b8';

    // Ball impact X = just left of first domino
    const FIRST_DOMINO_X = startDominoX;
    const IMPACT_X = FIRST_DOMINO_X - BALL_R - 4;

    let startTime = null;
    let animId;

    function draw(timestamp) {
      if (!startTime) startTime = timestamp;
      const elapsed = (timestamp - startTime) % LOOP;
      const t = elapsed / LOOP;

      ctx.clearRect(0, 0, W, H);

      // Fade at loop edges
      let globalAlpha = 1;
      if (t > 0.92) globalAlpha = 1 - (t - 0.92) / 0.08;
      if (t < 0.04) globalAlpha = t / 0.04;
      ctx.globalAlpha = globalAlpha;

      // Ground line — thin grey surface
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.lineTo(W, GROUND_Y);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Phase: ball rolls in 0.04 → 0.25, then dominos fall 0.25 → 0.85
      const rollStart = 0.04;
      const rollEnd = 0.25;

      // ── Red ball ──
      let ballX, ballY;
      ballY = GROUND_Y - BALL_R;
      if (t < rollStart) {
        ballX = -BALL_R * 2;
      } else if (t < rollEnd) {
        const p = (t - rollStart) / (rollEnd - rollStart);
        const eased = p * p * (3 - 2 * p);
        ballX = -BALL_R * 2 + (IMPACT_X - (-BALL_R * 2)) * eased;
      } else {
        ballX = IMPACT_X;
      }

      // Draw ball
      ctx.beginPath();
      ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();

      // ── Dominoes ──
      const cascadeStart = rollEnd;
      const cascadeDuration = 0.55;
      const staggerDelay = cascadeDuration / DOMINO_COUNT;

      for (let i = 0; i < DOMINO_COUNT; i++) {
        const dominoX = startDominoX + i * DOMINO_GAP;
        const fallStart = cascadeStart + i * staggerDelay;

        let angle = 0; // upright
        if (t > fallStart) {
          const fallProgress = Math.min((t - fallStart) / (staggerDelay * 2.5), 1);
          // Ease-out bounce feel
          const eased = 1 - (1 - fallProgress) * (1 - fallProgress);
          angle = eased * (Math.PI / 2.2); // fall ~82 degrees
        }

        ctx.save();
        ctx.translate(dominoX, GROUND_Y);
        ctx.rotate(angle);

        // Draw domino (pivot at bottom-center)
        ctx.fillStyle = DOMINO_COLOR;
        ctx.fillRect(-DOMINO_W / 2, -DOMINO_H, DOMINO_W, DOMINO_H);

        // Subtle rounded top
        ctx.beginPath();
        ctx.arc(0, -DOMINO_H, DOMINO_W / 2, 0, Math.PI, true);
        ctx.fillStyle = DOMINO_COLOR;
        ctx.fill();

        ctx.restore();
      }

      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [canvasRef]);
}

/* ═══════════════════════════════════════════════════════════════════
   Lobby Screen
   ═══════════════════════════════════════════════════════════════════ */
const LobbyScreen = ({ onJoin }) => {
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef(null);
  const collisionRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);
  useDoublePendulum(canvasRef);
  useCollisionAnimation(collisionRef);

  const handleJoin = () => {
    const room = roomId.trim().toLowerCase().replace(/\s+/g, '-');
    if (!room) { setError('Please enter a Room ID'); return; }
    if (room.length < 3) { setError('Room ID must be at least 3 characters'); return; }
    onJoin(room, userName.trim() || 'Scientist');
  };

  return (
    <div className="h-screen w-screen relative flex items-center justify-center bg-white overflow-hidden">

      {/* ── Double Pendulum Canvas (background) ──────────────── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
      />

      {/* ── Centered Content ─────────────────────────────────── */}
      <div
        className="relative z-10 w-full max-w-3xl px-8"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(12px)',
          transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Title */}
        <div className="text-center mb-12">
          <h1 className="text-7xl font-bold tracking-tight text-gray-900 mb-5">
            Virtual<span className="text-indigo-500">Lab</span>
          </h1>
          <p className="text-xl text-gray-300 font-normal leading-relaxed tracking-wide">
            Collaborative physics experiments in real-time
          </p>
        </div>

        {/* Form Card */}
        <div
          className="rounded-2xl px-12 py-10"
          style={{
            background: '#f3f4f6',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
            border: '1px solid #d1d5db',
          }}
        >
          {/* Name Input */}
          <div className="mb-8">
            <label className="block text-sm font-semibold text-gray-400 uppercase tracking-[0.14em] mb-3">
              Your Name
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="e.g. Newton"
              maxLength={20}
              className="w-full bg-white rounded-xl px-5 py-4 text-gray-800 text-base focus:outline-none focus:border-indigo-300 focus:ring-3 focus:ring-indigo-50 transition"
              style={{ border: '1.5px solid #dfe1e6' }}
            />
          </div>

          {/* Room ID Input */}
          <div className="mb-10">
            <label className="block text-sm font-semibold text-gray-400 uppercase tracking-[0.14em] mb-3">
              Room ID
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => { setRoomId(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="e.g. alpha-lab"
              maxLength={30}
              className="w-full bg-white rounded-xl px-5 py-4 text-gray-800 text-base focus:outline-none focus:border-indigo-300 focus:ring-3 focus:ring-indigo-50 transition"
              style={{ border: '1.5px solid #dfe1e6' }}
            />
            {error && <p className="text-red-400 text-sm mt-3 pl-0.5">{error}</p>}
          </div>

          {/* CTA Button */}
          <button
            onClick={handleJoin}
            className="w-full py-4 rounded-xl text-white text-lg font-semibold tracking-wide transition-all duration-200 active:scale-[0.98] cursor-pointer"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.28)',
            }}
            onMouseEnter={(e) => e.target.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.38)'}
            onMouseLeave={(e) => e.target.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.28)'}
          >
            Enter Lab →
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-6 tracking-wide" style={{ color: '#c0c4cc' }}>
          Share the Room ID with teammates to collaborate
        </p>
      </div>

      {/* ── Ball Collision Animation (bottom) ────────────────── */}
      <canvas
        ref={collisionRef}
        className="absolute bottom-0 left-0 pointer-events-none"
        style={{ width: '100%', height: '220px', zIndex: 1 }}
      />
    </div>
  );
};

export default LobbyScreen;
