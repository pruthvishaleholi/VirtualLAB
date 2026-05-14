import { useState, useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════════
   Particle Field — subtle floating dots with faint connections.
   Light theme version: muted grays on white.
   ═══════════════════════════════════════════════════════════════════ */
function useParticleField(canvasRef) {
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

    const PARTICLE_COUNT = 70;
    const CONNECTION_DIST = 150;
    const particles = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 2 + 0.8,
      });
    }

    let animId;

    function draw() {
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }

      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const strength = 1 - dist / CONNECTION_DIST;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(15, 118, 110, ${strength * 0.1})`;
            ctx.lineWidth = strength * 0.8;
            ctx.stroke();
          }
        }
      }

      // Dots
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 118, 110, 0.18)';
        ctx.fill();
      }

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
   Lobby Screen
   ═══════════════════════════════════════════════════════════════════ */
const LobbyScreen = ({ onJoin }) => {
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);
  useParticleField(canvasRef);

  const handleJoin = () => {
    const room = roomId.trim().toLowerCase().replace(/\s+/g, '-');
    if (!room) { setError('Please enter a Room ID'); return; }
    if (room.length < 3) { setError('Room ID must be at least 3 characters'); return; }
    onJoin(room, userName.trim() || 'Scientist');
  };

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#f8f8f7',
        backgroundImage: 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >

      {/* ── Particle Canvas (background) ─────────────────────── */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* ── Center Card ──────────────────────────────────────── */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: '420px',
          padding: '0 24px',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(10px)',
          transition: 'all 0.5s ease-out',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e5e5e4',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)',
            padding: '44px 36px',
          }}
        >
          {/* ── Title ────────────────────────────────────────── */}
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <h1 style={{
              fontSize: '32px',
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              marginBottom: '8px',
              color: '#1a1a1a',
            }}>
              <span style={{ fontWeight: 700 }}>Virtual</span>
              <span style={{ fontWeight: 400, color: '#0f766e' }}>Lab</span>
            </h1>
            <p style={{
              fontSize: '14px',
              color: '#9a9a98',
              fontWeight: 400,
              letterSpacing: '0.01em',
            }}>
              Collaborative physics sandbox
            </p>
          </div>

          {/* ── Name Input ───────────────────────────────────── */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 500,
              color: '#555553',
              marginBottom: '8px',
            }}>
              Name
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Newton"
              maxLength={20}
              style={{
                width: '100%',
                background: '#ffffff',
                border: '1px solid #d4d4d3',
                borderRadius: '10px',
                padding: '12px 14px',
                fontSize: '15px',
                color: '#1a1a1a',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#0f766e'; }}
              onBlur={(e) => { e.target.style.borderColor = '#d4d4d3'; }}
            />
          </div>

          {/* ── Room ID Input ────────────────────────────────── */}
          <div style={{ marginBottom: '32px' }}>
            <label style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 500,
              color: '#555553',
              marginBottom: '8px',
            }}>
              Room ID
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => { setRoomId(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="alpha-lab"
              maxLength={30}
              style={{
                width: '100%',
                background: '#ffffff',
                border: '1px solid #d4d4d3',
                borderRadius: '10px',
                padding: '12px 14px',
                fontSize: '15px',
                color: '#1a1a1a',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => { e.target.style.borderColor = '#0f766e'; }}
              onBlur={(e) => { e.target.style.borderColor = '#d4d4d3'; }}
            />
            {error && (
              <p style={{
                color: '#dc2626',
                fontSize: '13px',
                marginTop: '8px',
              }}>{error}</p>
            )}
          </div>

          {/* ── Button ───────────────────────────────────────── */}
          <button
            onClick={handleJoin}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: '10px',
              border: 'none',
              fontSize: '15px',
              fontWeight: 600,
              color: '#ffffff',
              cursor: 'pointer',
              background: '#0f766e',
              transition: 'background 0.2s, transform 0.15s',
            }}
            onMouseEnter={(e) => { e.target.style.background = '#0d6d66'; }}
            onMouseLeave={(e) => { e.target.style.background = '#0f766e'; }}
            onMouseDown={(e) => { e.target.style.transform = 'scale(0.98)'; }}
            onMouseUp={(e) => { e.target.style.transform = 'scale(1)'; }}
          >
            Enter Lab
          </button>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <p style={{
          textAlign: 'center',
          fontSize: '12px',
          marginTop: '20px',
          color: '#b5b5b3',
        }}>
          Share the room ID with teammates to collaborate
        </p>
      </div>
    </div>
  );
};

export default LobbyScreen;
