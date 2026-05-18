import Matter from 'matter-js';

const row = { display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11 };
const lbl = { color:'#94a3b8', fontWeight:500, fontSize:10 };
const val = { color:'#1e293b', fontWeight:600, fontSize:11, textAlign:'right' };
const inp = {
  width:64, padding:'3px 6px', fontSize:11, fontWeight:500,
  border:'1px solid #e2e8f0', borderRadius:6, outline:'none',
  fontFamily:"'Inter',system-ui,sans-serif", textAlign:'right',
};
const secHdr = {
  fontSize:9, fontWeight:600, color:'#b5b5b3', textTransform:'uppercase',
  letterSpacing:'0.1em', marginTop:10, marginBottom:6,
};

const PropertyInspector = ({ body, onDelete, onDuplicate, onToggleStatic, canvasH, gravityY }) => {
  if (!body) return (
    <div style={{ padding:16, textAlign:'center' }}>
      <p style={{ fontSize:11, color:'#bbb', fontStyle:'italic' }}>Click a body on the canvas to inspect its properties</p>
    </div>
  );

  const speed = Math.hypot(body.velocity.x, body.velocity.y);
  const mass = body.mass;
  const ke = 0.5 * mass * speed * speed;
  const h = Math.max(0, (canvasH||600) - body.position.y);
  const pe = mass * (gravityY||1) * h * 0.001;
  const momentum = mass * speed;

  const setVal = (key, v) => {
    if (key === 'x') Matter.Body.setPosition(body, { x:v, y:body.position.y });
    else if (key === 'y') Matter.Body.setPosition(body, { x:body.position.x, y:v });
    else if (key === 'angle') Matter.Body.setAngle(body, v * Math.PI / 180);
    else if (key === 'vx') Matter.Body.setVelocity(body, { x:v, y:body.velocity.y });
    else if (key === 'vy') Matter.Body.setVelocity(body, { x:body.velocity.x, y:v });
    else if (key === 'mass') Matter.Body.setMass(body, Math.max(0.01,v));
    else if (key === 'friction') { body.friction = v; }
    else if (key === 'restitution') { body.restitution = v; }
    else if (key === 'frictionAir') { body.frictionAir = v; }
  };

  const Field = ({ label:l, value:v, k, step=1 }) => (
    <div style={row}>
      <span style={lbl}>{l}</span>
      <input type="number" step={step} defaultValue={typeof v==='number'?v.toFixed(step<1?3:1):v}
        style={inp} onBlur={(e)=>setVal(k,parseFloat(e.target.value)||0)}
        onKeyDown={(e)=>{ if(e.key==='Enter') e.target.blur(); }}
      />
    </div>
  );

  const Readout = ({ label:l, value:v, color }) => (
    <div style={row}>
      <span style={lbl}>{l}</span>
      <span style={{ ...val, color:color||val.color }}>{v}</span>
    </div>
  );

  const actionBtn = (label, color, bg, onClick) => (
    <button onClick={onClick} style={{
      flex:1, padding:'6px 0', fontSize:10, fontWeight:600,
      border:`1px solid ${color}22`, borderRadius:8, cursor:'pointer',
      background:bg, color, transition:'all 0.15s',
    }}>{label}</button>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:2, fontFamily:"'Inter',system-ui,sans-serif" }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
        <div style={{
          width:12, height:12, borderRadius:3,
          background: body.render?.fillStyle || '#3b82f6',
        }}/>
        <span style={{ fontSize:11, fontWeight:600, color:'#333' }}>{body.label}</span>
        <span style={{
          fontSize:9, padding:'1px 6px', borderRadius:4,
          background: body.isStatic?'#fef3c7':'#ecfdf5',
          color: body.isStatic?'#d97706':'#0f766e',
          fontWeight:600, marginLeft:'auto',
        }}>{body.isStatic?'STATIC':'DYNAMIC'}</span>
      </div>

      {/* Transform */}
      <p style={secHdr}>Transform</p>
      <Field label="X" value={body.position.x} k="x" />
      <Field label="Y" value={body.position.y} k="y" />
      <Field label="Angle°" value={body.angle*180/Math.PI} k="angle" />
      <Field label="Vel X" value={body.velocity.x} k="vx" step={0.1} />
      <Field label="Vel Y" value={body.velocity.y} k="vy" step={0.1} />

      {/* Physics */}
      <p style={secHdr}>Physics</p>
      <Field label="Mass" value={body.mass} k="mass" step={0.1} />
      <Field label="Friction" value={body.friction} k="friction" step={0.01} />
      <Field label="Bounce" value={body.restitution} k="restitution" step={0.01} />
      <Field label="Air Drag" value={body.frictionAir} k="frictionAir" step={0.001} />

      {/* Live Readouts */}
      <p style={secHdr}>Live Readout</p>
      <Readout label="Speed" value={speed.toFixed(2)+" px/f"} color="#3b82f6" />
      <Readout label="KE" value={ke.toFixed(2)+" J"} color="#6366f1" />
      <Readout label="PE" value={pe.toFixed(2)+" J"} color="#f59e0b" />
      <Readout label="Momentum" value={momentum.toFixed(2)} color="#8b5cf6" />

      {/* Actions */}
      <div style={{ display:'flex', gap:6, marginTop:10 }}>
        {actionBtn(body.isStatic?'Unpin':'Pin', '#0f766e', '#ecfdf5', onToggleStatic)}
        {actionBtn('Duplicate', '#6366f1', '#eef2ff', onDuplicate)}
        {actionBtn('Delete', '#dc2626', '#fef2f2', onDelete)}
      </div>
    </div>
  );
};

export default PropertyInspector;
