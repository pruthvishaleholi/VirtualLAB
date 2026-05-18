const EnergyBarChart = ({ ke, pe }) => {
  const total = ke + pe || 1;
  const kePct = (ke / total) * 100;
  const pePct = (pe / total) * 100;

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#3b82f6', display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>KE</span>
          <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600 }}>{ke.toFixed(1)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>PE</span>
          <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>{pe.toFixed(1)}</span>
        </div>
      </div>

      {/* Bar */}
      <div style={{
        display: 'flex', height: 18, borderRadius: 6, overflow: 'hidden',
        background: '#f1f5f9', border: '1px solid #e2e8f0',
      }}>
        <div style={{
          width: `${kePct}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
          transition: 'width 0.2s ease', minWidth: kePct > 0 ? 2 : 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {kePct > 15 && <span style={{ fontSize: 8, color: '#fff', fontWeight: 700 }}>{kePct.toFixed(0)}%</span>}
        </div>
        <div style={{
          width: `${pePct}%`, background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
          transition: 'width 0.2s ease', minWidth: pePct > 0 ? 2 : 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {pePct > 15 && <span style={{ fontSize: 8, color: '#fff', fontWeight: 700 }}>{pePct.toFixed(0)}%</span>}
        </div>
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 500 }}>
          Total: {(ke + pe).toFixed(1)} J
        </span>
      </div>
    </div>
  );
};

export default EnergyBarChart;
