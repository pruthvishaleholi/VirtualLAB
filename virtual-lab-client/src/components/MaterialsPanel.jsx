const SliderRow = ({ label, value, min, max, step, unit, accentColor, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-gray-400 font-medium">{label}</span>
      <span className="text-[11px] font-semibold" style={{ color: accentColor }}>
        {value.toFixed(step < 0.1 ? 3 : 2)}{unit}
      </span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full"
      style={{
        background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${((value - min) / (max - min)) * 100}%, #e2e8f0 ${((value - min) / (max - min)) * 100}%, #e2e8f0 100%)`,
      }}
    />
  </div>
);

const MaterialsPanel = ({ materials, onChange }) => (
  <div className="bg-white rounded-xl p-4 border border-gray-100">
    <div className="flex items-center gap-2 mb-3">
      <span className="text-gray-300 text-xs">⚙</span>
      <h2 className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold">Physics</h2>
    </div>

    <div className="flex flex-col gap-3">
      <SliderRow label="Gravity" value={materials.gravity} min={0} max={3} step={0.05} unit="g" accentColor="#6366f1" onChange={(v) => onChange('gravity', v)} />
      <SliderRow label="Friction" value={materials.friction} min={0} max={1} step={0.05} unit="" accentColor="#f59e0b" onChange={(v) => onChange('friction', v)} />
      <SliderRow label="Bounciness" value={materials.restitution} min={0} max={1} step={0.05} unit="" accentColor="#10b981" onChange={(v) => onChange('restitution', v)} />
      <SliderRow label="Air Resist" value={materials.airFriction} min={0} max={0.1} step={0.002} unit="" accentColor="#8b5cf6" onChange={(v) => onChange('airFriction', v)} />
    </div>

    <div className="mt-3 pt-3 border-t border-gray-50">
      <p className="text-[10px] text-gray-300 mb-2 uppercase tracking-wider font-semibold">Presets</p>
      <div className="flex gap-1.5 flex-wrap">
        {[
          { label: 'Earth', vals: { gravity: 1, friction: 0.3, restitution: 0.3, airFriction: 0.01 } },
          { label: 'Moon', vals: { gravity: 0.17, friction: 0.05, restitution: 0.5, airFriction: 0.001 } },
          { label: 'Bouncy', vals: { gravity: 1, friction: 0.05, restitution: 0.95, airFriction: 0.005 } },
          { label: 'Heavy', vals: { gravity: 2.5, friction: 0.8, restitution: 0.05, airFriction: 0.05 } },
        ].map(({ label, vals }) => (
          <button key={label} onClick={() => Object.entries(vals).forEach(([k, v]) => onChange(k, v))}
            className="px-2.5 py-1 bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-lg text-[10px] font-medium text-gray-400 hover:text-gray-600 transition">
            {label}
          </button>
        ))}
      </div>
    </div>
  </div>
);

export default MaterialsPanel;
