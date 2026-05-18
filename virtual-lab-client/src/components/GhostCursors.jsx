const CURSOR_COLORS = ['#ef4444','#8b5cf6','#06b6d4','#f59e0b','#ec4899','#14b8a6'];

const GhostCursors = ({ cursors }) => {
  const now = Date.now();
  return (
    <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:15 }}>
      {Object.entries(cursors).map(([id, c]) => {
        const age = (now - (c.lastUpdate||0))/1000;
        if (age > 4) return null;
        const opacity = age > 3 ? Math.max(0,1-(age-3)) : 0.7;
        return (
          <div key={id} style={{
            position:'absolute', left:c.x, top:c.y,
            transform:'translate(-2px,-2px)',
            transition:'left 0.08s linear,top 0.08s linear,opacity 0.3s',
            opacity, pointerEvents:'none',
          }}>
            <svg width="18" height="22" viewBox="0 0 18 22" fill="none" style={{filter:'drop-shadow(0 1px 3px rgba(0,0,0,0.15))'}}>
              <path d="M1 1L7 20L9.5 12.5L17 10L1 1Z" fill={c.color||CURSOR_COLORS[0]} stroke="#fff" strokeWidth="1.2"/>
            </svg>
            <span style={{
              position:'absolute', left:16, top:14,
              background:c.color||CURSOR_COLORS[0], color:'#fff',
              fontSize:9, fontWeight:600, padding:'2px 7px', borderRadius:5,
              whiteSpace:'nowrap', fontFamily:"'Inter',system-ui,sans-serif",
              boxShadow:'0 1px 4px rgba(0,0,0,0.12)',
            }}>{c.userName||'User'}</span>
          </div>
        );
      })}
    </div>
  );
};

export { CURSOR_COLORS };
export default GhostCursors;
