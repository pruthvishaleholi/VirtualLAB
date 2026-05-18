import { useState } from 'react';

const SliderRow = ({ label, value, min, max, step, unit, color, onChange }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#888', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{value.toFixed(step < 0.1 ? 3 : 1)}{unit}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        width: '100%',
        background: `linear-gradient(to right, ${color} 0%, ${color} ${((value - min) / (max - min)) * 100}%, #e2e8f0 ${((value - min) / (max - min)) * 100}%, #e2e8f0 100%)`,
      }}
    />
  </div>
);

const TYPE_COLORS = {
  rope: '#6366f1',
  spring: '#10b981',
  pivot: '#f59e0b',
  motor: '#ef4444',
};

const TYPE_ICONS = {
  rope: '🪢',
  spring: '⌇',
  pivot: '📌',
  motor: '⚙',
};

const ConstraintInspector = ({ constraint, onUpdate, onDelete }) => {
  // constraint: { uid, type, bodyALabel, bodyBLabel, config }
  if (!constraint) return null;

  const { uid, type, bodyALabel, bodyBLabel, config } = constraint;
  const color = TYPE_COLORS[type] || '#999';

  const handleConfigChange = (key, value) => {
    onUpdate(uid, { ...config, [key]: value });
  };

  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      padding: 14,
      border: '1px solid #f1f5f9',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>{TYPE_ICONS[type]}</span>
          <div>
            <span style={{
              fontSize: 10, fontWeight: 600, color,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              padding: '2px 8px', borderRadius: 6,
              background: `${color}15`, border: `1px solid ${color}30`,
            }}>{type}</span>
          </div>
        </div>
        <button
          onClick={() => onDelete(uid)}
          style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: '4px 10px',
            cursor: 'pointer', fontSize: 10, fontWeight: 600,
            color: '#dc2626', transition: 'all 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'}
          onMouseLeave={e => e.currentTarget.style.background = '#fef2f2'}
        >Delete</button>
      </div>

      {/* Connected Bodies */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
        <span style={{
          fontSize: 9, fontWeight: 500, color: '#aaa',
          padding: '3px 8px', background: '#f8f8f7', borderRadius: 6,
          maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{bodyALabel}</span>
        <span style={{ fontSize: 12, color: '#ddd' }}>→</span>
        <span style={{
          fontSize: 9, fontWeight: 500, color: '#aaa',
          padding: '3px 8px', background: '#f8f8f7', borderRadius: 6,
          maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{bodyBLabel}</span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#f1f1f0', marginBottom: 12 }} />

      {/* Type-specific properties */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {type === 'rope' && (
          <SliderRow
            label="Length" value={config.length || 100} min={20} max={400} step={5}
            unit="px" color={color}
            onChange={(v) => handleConfigChange('length', v)}
          />
        )}

        {type === 'spring' && (
          <>
            <SliderRow
              label="Stiffness" value={config.stiffness || 0.04} min={0.001} max={0.5} step={0.005}
              unit="" color="#10b981"
              onChange={(v) => handleConfigChange('stiffness', v)}
            />
            <SliderRow
              label="Damping" value={config.damping || 0} min={0} max={0.15} step={0.005}
              unit="" color="#f59e0b"
              onChange={(v) => handleConfigChange('damping', v)}
            />
            <SliderRow
              label="Rest Length" value={config.restLength || 100} min={10} max={400} step={5}
              unit="px" color="#6366f1"
              onChange={(v) => handleConfigChange('restLength', v)}
            />
          </>
        )}

        {type === 'pivot' && (
          <div style={{ padding: '8px 0', textAlign: 'center' }}>
            <span style={{ fontSize: 11, color: '#bbb' }}>
              Zero-length hinge — no editable properties.
            </span>
          </div>
        )}

        {type === 'motor' && (
          <>
            <SliderRow
              label="Angular Velocity" value={Math.abs(config.angularVelocity || 3)}
              min={0.5} max={20} step={0.5}
              unit=" rad/s" color={color}
              onChange={(v) => handleConfigChange('angularVelocity', v * Math.sign(config.angularVelocity || 1))}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { dir: 1,  label: '↻ CW' },
                { dir: -1, label: '↺ CCW' },
              ].map(({ dir, label }) => {
                const currentDir = Math.sign(config.angularVelocity || 1);
                return (
                  <button
                    key={dir}
                    onClick={() => handleConfigChange('angularVelocity', Math.abs(config.angularVelocity || 3) * dir)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8,
                      border: `1.5px solid ${currentDir === dir ? '#0f766e' : '#e5e5e4'}`,
                      background: currentDir === dir ? '#ecfdf5' : '#fff',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      color: currentDir === dir ? '#0f766e' : '#888',
                      transition: 'all 0.15s',
                    }}
                  >{label}</button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ConstraintInspector;
