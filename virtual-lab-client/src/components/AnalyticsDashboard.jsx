import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area,
  ScatterChart, Scatter,
} from 'recharts';
import EnergyBarChart from './EnergyBarChart';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:'#fff', border:'1px solid #f1f5f9', borderRadius:8,
      padding:'6px 10px', fontSize:10, fontWeight:500, boxShadow:'0 2px 8px rgba(0,0,0,0.06)',
    }}>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color:p.color, margin:0 }}>
          {p.name}: {typeof p.value==='number'?p.value.toFixed(2):p.value}
        </p>
      ))}
    </div>
  );
};

const tabStyle = (active) => ({
  flex:1, padding:'6px 0', fontSize:10, fontWeight:active?600:500,
  color:active?'#0f766e':'#aaa', background:active?'#ecfdf5':'transparent',
  border:'none', borderBottom:active?'2px solid #0f766e':'2px solid transparent',
  cursor:'pointer', transition:'all 0.15s', borderRadius:'6px 6px 0 0',
  fontFamily:"'Inter',system-ui,sans-serif", letterSpacing:'0.02em',
});

const AnalyticsDashboard = ({ data, energyData, phaseData, currentEnergy }) => {
  const [tab, setTab] = useState('kinematics');
  const hasData = data && data.length > 1;
  const hasEnergy = energyData && energyData.length > 1;
  const hasPhase = phaseData && phaseData.length > 1;

  return (
    <div style={{
      background:'#fff', borderRadius:14, padding:'14px', border:'1px solid #f1f5f9',
      fontFamily:"'Inter',system-ui,sans-serif",
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
        <span style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e' }}/>
        <span style={{ fontSize:10, fontWeight:600, color:'#999', textTransform:'uppercase', letterSpacing:'0.08em' }}>
          Live Analytics
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginBottom:10, borderBottom:'1px solid #f1f5f9' }}>
        <button style={tabStyle(tab==='kinematics')} onClick={()=>setTab('kinematics')}>Kinematics</button>
        <button style={tabStyle(tab==='energy')} onClick={()=>setTab('energy')}>Energy</button>
        <button style={tabStyle(tab==='phase')} onClick={()=>setTab('phase')}>Phase Space</button>
      </div>

      {/* Kinematics Tab */}
      {tab==='kinematics' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <p style={{ fontSize:9, color:'#6366f1', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Speed</p>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={hasData?data:[{t:0,speed:0}]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
                <XAxis dataKey="t" hide />
                <YAxis stroke="#f1f5f9" tick={{ fontSize:8, fill:'#94a3b8' }} width={24} />
                <Tooltip content={<CustomTooltip/>} />
                <Line type="monotone" dataKey="speed" name="Speed" stroke="#6366f1" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p style={{ fontSize:9, color:'#8b5cf6', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Angular Velocity</p>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={hasData?data:[{t:0,angularVel:0}]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
                <XAxis dataKey="t" hide />
                <YAxis stroke="#f1f5f9" tick={{ fontSize:8, fill:'#94a3b8' }} width={24} />
                <Tooltip content={<CustomTooltip/>} />
                <Line type="monotone" dataKey="angularVel" name="Angular Vel" stroke="#8b5cf6" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Energy Tab */}
      {tab==='energy' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <EnergyBarChart ke={currentEnergy?.ke||0} pe={currentEnergy?.pe||0} />
          <div>
            <p style={{ fontSize:9, color:'#3b82f6', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Energy Over Time</p>
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={hasEnergy?energyData:[{t:0,ke:0,pe:0}]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
                <XAxis dataKey="t" hide />
                <YAxis stroke="#f1f5f9" tick={{ fontSize:8, fill:'#94a3b8' }} width={24} />
                <Tooltip content={<CustomTooltip/>} />
                <Area type="monotone" dataKey="ke" name="KE" stackId="1" stroke="#3b82f6" fill="#3b82f680" isAnimationActive={false} />
                <Area type="monotone" dataKey="pe" name="PE" stackId="1" stroke="#f59e0b" fill="#f59e0b80" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Phase Space Tab */}
      {tab==='phase' && (
        <div>
          <p style={{ fontSize:9, color:'#14b8a6', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Position vs Velocity</p>
          <ResponsiveContainer width="100%" height={160}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
              <XAxis dataKey="px" name="x" stroke="#f1f5f9" tick={{ fontSize:8, fill:'#94a3b8' }} />
              <YAxis dataKey="vx" name="vx" stroke="#f1f5f9" tick={{ fontSize:8, fill:'#94a3b8' }} />
              <Tooltip content={<CustomTooltip/>} />
              <Scatter data={hasPhase?phaseData:[{px:0,vx:0}]} fill="#14b8a6" isAnimationActive={false}
                line={{ stroke:'#14b8a640', strokeWidth:1 }} lineType="joint" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
