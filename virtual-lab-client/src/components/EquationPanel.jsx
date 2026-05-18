import { useEffect, useRef } from 'react';
import katex from 'katex';

const tex = (str) => {
  try { return katex.renderToString(str, { throwOnError:false, displayMode:false }); }
  catch { return str; }
};

const EquationPanel = ({ body, engine, canvasH }) => {
  if (!body || !engine) return null;

  const speed = Math.hypot(body.velocity.x, body.velocity.y);
  const mass = body.mass;
  const g = engine.gravity.y;
  const h = Math.max(0, (canvasH||600) - body.position.y);
  const ke = 0.5 * mass * speed * speed;
  const pe = mass * g * h * 0.001;
  const angle = (body.angle * 180 / Math.PI).toFixed(1);
  const omega = body.angularVelocity.toFixed(4);

  // Detect body type for specialized equations
  const label = body.label || '';
  const isPendulum = label.includes('ball') || label.includes('pendulum');
  const isSpring = label.includes('spring') || label.includes('_a') || label.includes('_b');

  const equations = [
    { label:'Newton\'s 2nd Law', tex:`\\vec{F}_{net}=m\\vec{a}=(${mass.toFixed(2)})(${(body._accelX||0).toFixed(2)},${(body._accelY||0).toFixed(2)})` },
    { label:'Kinetic Energy', tex:`KE=\\frac{1}{2}mv^2=${ke.toFixed(2)}\\,J` },
    { label:'Potential Energy', tex:`PE=mgh=${pe.toFixed(2)}\\,J` },
    { label:'Momentum', tex:`\\vec{p}=m\\vec{v}=(${(mass*body.velocity.x).toFixed(2)},${(mass*body.velocity.y).toFixed(2)})` },
  ];

  if (isPendulum) {
    equations.push(
      { label:'Period', tex:`T=2\\pi\\sqrt{\\frac{L}{g}}` },
      { label:'Angular Position', tex:`\\theta=${angle}°,\\;\\omega=${omega}\\,rad/s` },
    );
  }
  if (isSpring) {
    equations.push(
      { label:'Hooke\'s Law', tex:`F=-kx` },
      { label:'SHM Frequency', tex:`\\omega=\\sqrt{\\frac{k}{m}}` },
    );
  }

  return (
    <div style={{
      position:'absolute', bottom:70, left:16, zIndex:18,
      background:'rgba(255,255,255,0.94)', backdropFilter:'blur(12px)',
      border:'1px solid #e5e5e4', borderRadius:14, padding:'14px 18px',
      maxWidth:360, boxShadow:'0 4px 20px rgba(0,0,0,0.06)',
      fontFamily:"'Inter',system-ui,sans-serif",
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
        <span style={{ width:6, height:6, borderRadius:'50%', background:'#0f766e' }}/>
        <span style={{ fontSize:10, fontWeight:600, color:'#999', textTransform:'uppercase', letterSpacing:'0.08em' }}>
          Live Equations — {body.label}
        </span>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {equations.map((eq, i) => (
          <div key={i}>
            <p style={{ fontSize:9, color:'#aaa', fontWeight:500, marginBottom:2, textTransform:'uppercase', letterSpacing:'0.06em' }}>{eq.label}</p>
            <div
              style={{ fontSize:13, color:'#1a1a1a', lineHeight:1.5 }}
              dangerouslySetInnerHTML={{ __html: tex(eq.tex) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default EquationPanel;
