import { useState } from 'react';

const rodIcon = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><circle cx="5" cy="5" r="2" fill="currentColor"/><circle cx="19" cy="19" r="2" fill="currentColor"/></svg>;
const springIcon = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="12" r="2" fill="currentColor"/><path d="M6 12c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0"/><circle cx="20" cy="12" r="2" fill="currentColor"/></svg>;

const TYPES = [
  { key: 'rope',   icon: rodIcon,    label: 'Rod',    desc: 'Fixed distance, no elasticity' },
  { key: 'spring', icon: springIcon,  label: 'Spring', desc: 'Elastic with stiffness & damping' },
];

const DEFAULT_CONFIGS = {
  rope:   { length: 0 },                               // 0 = auto-measure
  spring: { stiffness: 0.04, damping: 0.02, restLength: 0 },
  pivot:  {},
  motor:  { angularVelocity: 3, direction: 1 },        // 1=CW, -1=CCW
};

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

const ConstraintConfigPopover = ({ posX, posY, autoLength, onConfirm, onCancel }) => {
  const [selectedType, setSelectedType] = useState('rope');
  const [config, setConfig] = useState(() => {
    const cfgs = {};
    Object.keys(DEFAULT_CONFIGS).forEach(k => {
      cfgs[k] = { ...DEFAULT_CONFIGS[k] };
    });
    return cfgs;
  });

  // Set auto-measured length once we know it
  const getLength = (type) => {
    const c = config[type];
    if (type === 'rope')   return c.length || autoLength;
    if (type === 'spring') return c.restLength || autoLength;
    return 0;
  };

  const updateConfig = (type, key, value) => {
    setConfig(prev => ({
      ...prev,
      [type]: { ...prev[type], [key]: value },
    }));
  };

  const handleCreate = () => {
    const cfg = { ...config[selectedType] };
    if (selectedType === 'rope' && (!cfg.length || cfg.length === 0)) cfg.length = autoLength;
    if (selectedType === 'spring' && (!cfg.restLength || cfg.restLength === 0)) cfg.restLength = autoLength;
    if (selectedType === 'motor') cfg.angularVelocity = cfg.angularVelocity * cfg.direction;
    onConfirm(selectedType, cfg);
  };

  const activeConfig = config[selectedType];

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 340,
        zIndex: 1000,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        padding: 16,
        fontFamily: "'Inter', -apple-system, sans-serif",
        animation: 'popoverIn 0.2s ease-out',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#0f766e' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            New Constraint
          </span>
        </div>
        <button
          onClick={onCancel}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#aaa',
            width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#f3f3f2'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >×</button>
      </div>

      {/* Type Selection Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {TYPES.map(({ key, icon, label, desc }) => (
          <button
            key={key}
            onClick={() => setSelectedType(key)}
            style={{
              padding: '10px 8px',
              border: `1.5px solid ${selectedType === key ? '#0f766e' : '#e5e5e4'}`,
              borderRadius: 12,
              background: selectedType === key ? '#ecfdf5' : '#fff',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              transition: 'all 0.15s',
              outline: 'none',
            }}
            onMouseEnter={e => { if (selectedType !== key) e.currentTarget.style.borderColor = '#0f766e40'; }}
            onMouseLeave={e => { if (selectedType !== key) e.currentTarget.style.borderColor = '#e5e5e4'; }}
          >
            <span style={{ fontSize: 22, lineHeight: 1, color: selectedType === key ? '#0f766e' : '#888' }}>{icon}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: selectedType === key ? '#0f766e' : '#555' }}>
              {label}
            </span>
            <span style={{ fontSize: 9, color: '#aaa', lineHeight: 1.3, textAlign: 'center' }}>{desc}</span>
          </button>
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#f1f1f0', marginBottom: 12 }} />

      {/* Type-specific configuration */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {selectedType === 'rope' && (
          <SliderRow
            label="Length" value={getLength('rope')} min={20} max={400} step={5}
            unit="px" color="#6366f1"
            onChange={(v) => updateConfig('rope', 'length', v)}
          />
        )}

        {selectedType === 'spring' && (
          <>
            <SliderRow
              label="Stiffness" value={activeConfig.stiffness} min={0.001} max={0.5} step={0.005}
              unit="" color="#10b981"
              onChange={(v) => updateConfig('spring', 'stiffness', v)}
            />
            <SliderRow
              label="Damping" value={activeConfig.damping} min={0} max={0.15} step={0.005}
              unit="" color="#f59e0b"
              onChange={(v) => updateConfig('spring', 'damping', v)}
            />
            <SliderRow
              label="Rest Length" value={getLength('spring')} min={10} max={400} step={5}
              unit="px" color="#6366f1"
              onChange={(v) => updateConfig('spring', 'restLength', v)}
            />
          </>
        )}
      </div>

      {/* Distance info */}
      <div style={{ fontSize: 10, color: '#bbb', marginBottom: 12, textAlign: 'center' }}>
        Distance between bodies: {Math.round(autoLength)}px
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10,
            border: '1px solid #e5e5e4', background: '#fff',
            cursor: 'pointer', fontSize: 12, fontWeight: 500, color: '#888',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#ccc'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e5e4'}
        >Cancel</button>
        <button
          onClick={handleCreate}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 10,
            border: '1px solid #0f766e', background: '#0f766e',
            cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff',
            transition: 'all 0.15s',
            boxShadow: '0 2px 8px rgba(15,118,110,0.3)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#0d6b63'}
          onMouseLeave={e => e.currentTarget.style.background = '#0f766e'}
        >Create Constraint</button>
      </div>
    </div>
  );
};

export default ConstraintConfigPopover;
