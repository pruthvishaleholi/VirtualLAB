import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ScatterChart, Scatter,
} from 'recharts';
import EnergyBarChart from './EnergyBarChart';

const font = "'Inter', system-ui, sans-serif";

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #f1f5f9', borderRadius: 8,
      padding: '6px 10px', fontSize: 10, fontWeight: 500, boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color, margin: 0 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
};

const StatRow = ({ label, value, unit, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
    <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>{label}</span>
    <span style={{ fontSize: 11, fontWeight: 600, color: color || '#1e293b', fontVariantNumeric: 'tabular-nums' }}>
      {value}<span style={{ fontSize: 9, color: '#cbd5e1', fontWeight: 400, marginLeft: 2 }}>{unit}</span>
    </span>
  </div>
);

const inputStyle = {
  width: '64px', padding: '3px 6px', fontSize: 11, fontWeight: 500,
  border: '1px solid #e2e8f0', borderRadius: 6, outline: 'none',
  fontFamily: font, fontVariantNumeric: 'tabular-nums', textAlign: 'right',
  background: '#f8fafc', color: '#1e293b',
};

const EditRow = ({ label, value, unit, onChange, step = 1, min = 0 }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
    <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>{label}</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        style={inputStyle}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        onClick={(e) => e.stopPropagation()}
      />
      <span style={{ fontSize: 9, color: '#cbd5e1', fontWeight: 400, width: 18 }}>{unit}</span>
    </div>
  </div>
);

const BodyAnalytics = ({ selectedBody, bodyList, selectedIndex, onPrev, onNext, systemStats, canvasH, onUpdateBody }) => {
  const hasBody = selectedBody && selectedBody.current;
  const history = selectedBody?.history || [];
  const hasHistory = history.length > 1;

  const ke = hasBody ? selectedBody.current.ke : 0;
  const pe = hasBody ? selectedBody.current.pe : 0;

  const trajectoryData = useMemo(() => {
    return history.map(h => ({ x: +h.x.toFixed(1), y: +(canvasH - h.y).toFixed(1) }));
  }, [history, canvasH]);

  if (!bodyList || bodyList.length === 0) {
    return (
      <div style={{
        background: '#fff', borderRadius: 14, padding: 20, border: '1px solid #f1f5f9',
        fontFamily: font, textAlign: 'center',
      }}>
        <span style={{ fontSize: 28 }}>📊</span>
        <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
          Drop shapes onto the canvas to see their analytics
        </p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: font, display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Body Selector ──────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          <span style={{
            fontSize: 9, fontWeight: 600, color: '#999', textTransform: 'uppercase',
            letterSpacing: '0.08em', flex: 1,
          }}>Body Inspector</span>
          <span style={{ fontSize: 9, color: '#cbd5e1', fontWeight: 500 }}>
            ← → keys
          </span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#f8fafc', borderRadius: 8, padding: '8px 10px',
        }}>
          <button onClick={onPrev} style={{
            border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 14, color: '#64748b', padding: '0 4px', lineHeight: 1,
          }}>◀</button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              background: selectedBody?.color || '#3b82f6',
              border: '1px solid rgba(0,0,0,0.1)',
            }} />
            <span style={{
              fontSize: 12, fontWeight: 600, color: '#1e293b',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{selectedBody?.name || '—'}</span>
          </div>
          <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 500, flexShrink: 0 }}>
            {selectedIndex + 1}/{bodyList.length}
          </span>
          <button onClick={onNext} style={{
            border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 14, color: '#64748b', padding: '0 4px', lineHeight: 1,
          }}>▶</button>
        </div>
      </div>

      {/* ── Body Properties (Editable) ─────────────────────────────── */}
      {hasBody && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
        }}>
          <p style={{
            fontSize: 9, fontWeight: 600, color: '#f59e0b', textTransform: 'uppercase',
            letterSpacing: '0.08em', margin: '0 0 6px 0',
          }}>Body Properties</p>
          <EditRow label="Mass" value={+selectedBody.current.mass.toFixed(2)} unit="kg" step={0.5} min={0.1}
            onChange={(v) => onUpdateBody?.(selectedBody.label, 'mass', v)} />
          {selectedBody.type === 'circle' ? (
            <EditRow label="Radius" value={+selectedBody.current.radius.toFixed(1)} unit="px" step={5} min={5}
              onChange={(v) => onUpdateBody?.(selectedBody.label, 'radius', v)} />
          ) : (
            <>
              <EditRow label="Width" value={+selectedBody.current.width.toFixed(1)} unit="px" step={5} min={10}
                onChange={(v) => onUpdateBody?.(selectedBody.label, 'width', v)} />
              <EditRow label="Height" value={+selectedBody.current.height.toFixed(1)} unit="px" step={5} min={10}
                onChange={(v) => onUpdateBody?.(selectedBody.label, 'height', v)} />
            </>
          )}
          <div style={{ height: 1, background: '#f1f5f9', margin: '6px 0' }} />
          <EditRow label="Friction" value={+selectedBody.current.friction.toFixed(2)} unit="" step={0.05} min={0}
            onChange={(v) => onUpdateBody?.(selectedBody.label, 'friction', v)} />
          <EditRow label="Restitution" value={+selectedBody.current.restitution.toFixed(2)} unit="" step={0.05} min={0}
            onChange={(v) => onUpdateBody?.(selectedBody.label, 'restitution', v)} />
        </div>
      )}

      {/* ── Motor Controls ─────────────────────────────────────────── */}
      {hasBody && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <p style={{
              fontSize: 9, fontWeight: 600, color: '#6366f1', textTransform: 'uppercase',
              letterSpacing: '0.08em', margin: 0,
            }}>Motor</p>
            <button
              onClick={() => onUpdateBody?.(selectedBody.label, 'motor_toggle', !selectedBody.current.motor)}
              style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                border: selectedBody.current.motor ? '1px solid #fecaca' : '1px solid #bbf7d0',
                background: selectedBody.current.motor ? '#fef2f2' : '#f0fdf4',
                color: selectedBody.current.motor ? '#dc2626' : '#16a34a',
                transition: 'all 0.2s',
              }}
            >
              {selectedBody.current.motor ? 'Stop' : 'Start'}
            </button>
          </div>
          {selectedBody.current.motor && (
            <>
              <EditRow
                label="ω (ang. vel.)"
                value={+(selectedBody.current.motor.angularVelocity || 0).toFixed(3)}
                unit="rad/s"
                step={0.01}
                onChange={(v) => onUpdateBody?.(selectedBody.label, 'motor_angularVelocity', v)}
              />
              <EditRow
                label="α (ang. accel.)"
                value={+(selectedBody.current.motor.angularAcceleration || 0).toFixed(3)}
                unit="rad/s²"
                step={0.005}
                onChange={(v) => onUpdateBody?.(selectedBody.label, 'motor_angularAcceleration', v)}
              />
              <div style={{ marginTop: 4, fontSize: 9, color: '#94a3b8' }}>
                Current: {(selectedBody.current.motor.currentVel || 0).toFixed(3)} rad/s
              </div>
            </>
          )}
        </div>
      )}
      {hasBody && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
        }}>
          <p style={{
            fontSize: 9, fontWeight: 600, color: '#999', textTransform: 'uppercase',
            letterSpacing: '0.08em', margin: '0 0 6px 0',
          }}>Live Stats</p>
          <StatRow label="Position" value={`(${selectedBody.current.x.toFixed(0)}, ${selectedBody.current.y.toFixed(0)})`} unit="px" />
          <StatRow label="Velocity" value={`(${selectedBody.current.vx.toFixed(1)}, ${selectedBody.current.vy.toFixed(1)})`} unit="px/s" />
          <StatRow label="Speed" value={selectedBody.current.speed.toFixed(2)} unit="px/s" color="#6366f1" />
          <StatRow label="Angle" value={selectedBody.current.angle.toFixed(3)} unit="rad" />
          <StatRow label="KE" value={ke.toFixed(1)} unit="J" color="#3b82f6" />
          <StatRow label="PE" value={pe.toFixed(1)} unit="J" color="#f59e0b" />
        </div>
      )}

      {/* ── Speed Chart ────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
      }}>
        <p style={{
          fontSize: 9, color: '#6366f1', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px 0',
        }}>Speed Over Time</p>
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={hasHistory ? history : [{ t: 0, speed: 0 }]}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
            <XAxis dataKey="t" hide />
            <YAxis stroke="#f1f5f9" tick={{ fontSize: 8, fill: '#94a3b8' }} width={28} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="speed" name="Speed" stroke="#6366f1" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Energy ─────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
      }}>
        <p style={{
          fontSize: 9, color: '#3b82f6', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px 0',
        }}>Energy</p>
        <EnergyBarChart ke={ke} pe={pe} />
      </div>

      {/* ── Trajectory ─────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
      }}>
        <p style={{
          fontSize: 9, color: '#14b8a6', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px 0',
        }}>Trajectory</p>
        <ResponsiveContainer width="100%" height={120}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
            <XAxis dataKey="x" name="x" stroke="#f1f5f9" tick={{ fontSize: 8, fill: '#94a3b8' }} />
            <YAxis dataKey="y" name="y" stroke="#f1f5f9" tick={{ fontSize: 8, fill: '#94a3b8' }} />
            <Tooltip content={<CustomTooltip />} />
            <Scatter data={trajectoryData.length > 1 ? trajectoryData : [{ x: 0, y: 0 }]}
              fill="#14b8a6" isAnimationActive={false}
              line={{ stroke: '#14b8a640', strokeWidth: 1 }} lineType="joint" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* ── System Overview ────────────────────────────────────────── */}
      {systemStats && (
        <div style={{
          background: '#f8fafc', borderRadius: 12, padding: '10px 12px', border: '1px solid #f1f5f9',
        }}>
          <p style={{
            fontSize: 9, fontWeight: 600, color: '#999', textTransform: 'uppercase',
            letterSpacing: '0.08em', margin: '0 0 6px 0',
          }}>System Overview</p>
          <StatRow label="Dynamic Bodies" value={systemStats.totalBodies} unit="" />
          <StatRow label="Total KE" value={systemStats.totalKE.toFixed(1)} unit="J" color="#3b82f6" />
          <StatRow label="Total PE" value={systemStats.totalPE.toFixed(1)} unit="J" color="#f59e0b" />
          <StatRow label="Total Energy" value={(systemStats.totalKE + systemStats.totalPE).toFixed(1)} unit="J" color="#0f766e" />
        </div>
      )}
    </div>
  );
};

export default BodyAnalytics;
