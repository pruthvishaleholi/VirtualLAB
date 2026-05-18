const TimeScaleControl = ({ isPaused, timeScale, onPauseToggle, onStep, onTimeScaleChange, onReset }) => {
  const marks = [0.1, 0.25, 0.5, 1, 2, 3];

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)',
      border: '1px solid #e5e5e4', borderRadius: 14, padding: '8px 18px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.06)', zIndex: 20,
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Reset */}
      <button onClick={onReset} title="Reset" style={iconBtn}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>

      <div style={divider} />

      {/* Play / Pause */}
      <button onClick={onPauseToggle} title={isPaused ? 'Play' : 'Pause'} style={{
        ...iconBtn, background: isPaused ? '#ecfdf5' : '#fff',
        border: isPaused ? '1px solid #a7f3d0' : '1px solid #e5e5e4',
      }}>
        {isPaused ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#0f766e" stroke="none"><polygon points="5 3 19 12 5 21" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#555" stroke="none">
            <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        )}
      </button>

      {/* Step Forward */}
      <button onClick={onStep} disabled={!isPaused} title="Step" style={{ ...iconBtn, opacity: isPaused ? 1 : 0.35 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#555" stroke="none">
          <polygon points="5 3 15 12 5 21" /><rect x="16" y="4" width="3" height="16" rx="1" />
        </svg>
      </button>

      <div style={divider} />

      {/* Time Scale Slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: '#aaa', fontWeight: 500, whiteSpace: 'nowrap' }}>Speed</span>
        <input
          type="range" min={0.1} max={3} step={0.05} value={timeScale}
          onChange={(e) => onTimeScaleChange(parseFloat(e.target.value))}
          style={{ width: 90 }}
        />
        <span style={{
          fontSize: 11, fontWeight: 600, color: '#0f766e',
          minWidth: 36, textAlign: 'center',
          background: '#ecfdf5', padding: '2px 6px', borderRadius: 6,
        }}>
          {timeScale.toFixed(1)}x
        </span>
      </div>

      {/* Quick marks */}
      <div style={{ display: 'flex', gap: 3 }}>
        {marks.filter(m => [0.1, 0.5, 1, 2].includes(m)).map(m => (
          <button key={m} onClick={() => onTimeScaleChange(m)} style={{
            padding: '2px 6px', fontSize: 9, fontWeight: 500, borderRadius: 5,
            border: timeScale === m ? '1px solid #a7f3d0' : '1px solid #eee',
            background: timeScale === m ? '#ecfdf5' : '#fafafa',
            color: timeScale === m ? '#0f766e' : '#aaa',
            cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {m}x
          </button>
        ))}
      </div>
    </div>
  );
};

const iconBtn = {
  width: 32, height: 32, borderRadius: 8,
  border: '1px solid #e5e5e4', background: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', transition: 'all 0.15s',
};

const divider = {
  width: 1, height: 20, background: '#eee',
};

export default TimeScaleControl;
