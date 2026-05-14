import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-2 text-xs font-medium shadow-lg">
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

const AnalyticsDashboard = ({ data }) => {
  const hasData = data && data.length > 1;

  return (
    <div className="w-full bg-white rounded-xl p-4 border border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <h2 className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold">
          Live Analytics
        </h2>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[10px] text-indigo-400 font-semibold mb-1 tracking-wider uppercase">Speed</p>
          <ResponsiveContainer width="100%" height={70}>
            <LineChart data={hasData ? data : [{ t: 0, speed: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="t" hide />
              <YAxis stroke="#e2e8f0" tick={{ fontSize: 8, fill: '#94a3b8' }} width={24} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="speed" name="Speed" stroke="#6366f1" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-[10px] text-violet-400 font-semibold mb-1 tracking-wider uppercase">Angular Vel</p>
          <ResponsiveContainer width="100%" height={70}>
            <LineChart data={hasData ? data : [{ t: 0, angularVel: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="t" hide />
              <YAxis stroke="#e2e8f0" tick={{ fontSize: 8, fill: '#94a3b8' }} width={24} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="angularVel" name="Angular Vel" stroke="#8b5cf6" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
