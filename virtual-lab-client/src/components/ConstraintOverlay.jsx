import { useEffect, useRef } from 'react';

/**
 * ConstraintOverlay — SVG layer rendered on top of the Matter.js canvas.
 *
 * Draws:
 * - Link preview line (dashed) from bodyA to cursor while in link mode
 * - Selection glow ring around bodyA
 * - Constraint type visual markers at midpoints
 */
const ConstraintOverlay = ({
  width, height,
  linkBodyA,         // { x, y } of first selected body (or null)
  cursorPos,         // { x, y } of mouse cursor (only in link mode)
  isLinkMode,
  constraintsMeta,   // [{ uid, type, ax, ay, bx, by, config }]
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // ── Selection glow ring on bodyA ──────────────────────────────────
    if (isLinkMode && linkBodyA) {
      const { x, y } = linkBodyA;
      // Outer glow
      ctx.beginPath();
      ctx.arc(x, y, 36, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(15, 118, 110, 0.25)';
      ctx.lineWidth = 8;
      ctx.stroke();
      // Inner ring
      ctx.beginPath();
      ctx.arc(x, y, 32, 0, Math.PI * 2);
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();

      // Dashed line from bodyA to cursor
      if (cursorPos) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cursorPos.x, cursorPos.y);
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = 'rgba(15, 118, 110, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── Constraint midpoint markers ────────────────────────────────────
    if (constraintsMeta) {
      constraintsMeta.forEach(({ type, ax, ay, bx, by }) => {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;

        if (type === 'rope') {
          // Small knot icon — two small circles
          ctx.fillStyle = '#6366f1';
          ctx.beginPath();
          ctx.arc(mx - 3, my, 3, 0, Math.PI * 2);
          ctx.arc(mx + 3, my, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (type === 'spring') {
          // Zigzag marker
          drawSpringLine(ctx, ax, ay, bx, by);
        } else if (type === 'pivot') {
          // Dot at joint point
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (type === 'motor') {
          // Gear-like icon
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(mx, my, 7, 0, Math.PI * 2);
          ctx.fill();
          // Inner circle
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(mx, my, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }, [width, height, linkBodyA, cursorPos, isLinkMode, constraintsMeta]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
};

/** Draw a zigzag (spring) line between two points */
function drawSpringLine(ctx, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 10) return;

  const coils = Math.max(6, Math.floor(dist / 20));
  const amp = 6;
  const ux = dx / dist;
  const uy = dy / dist;
  const nx = -uy;
  const ny = ux;

  ctx.beginPath();
  ctx.moveTo(x1, y1);

  // Straight lead-in (10% of length)
  const leadIn = dist * 0.1;
  ctx.lineTo(x1 + ux * leadIn, y1 + uy * leadIn);

  const coilLength = dist * 0.8;
  const coilStart = leadIn;
  for (let i = 0; i < coils; i++) {
    const t = (i + 0.5) / coils;
    const sign = i % 2 === 0 ? 1 : -1;
    const cx = x1 + ux * (coilStart + t * coilLength) + nx * amp * sign;
    const cy = y1 + uy * (coilStart + t * coilLength) + ny * amp * sign;
    ctx.lineTo(cx, cy);
  }

  // Straight lead-out
  ctx.lineTo(x2, y2);

  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.stroke();
}

export default ConstraintOverlay;
