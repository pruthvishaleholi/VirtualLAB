const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── MongoDB connection ──────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/virtuallab';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✔ MongoDB connected'))
  .catch((err) => console.error('✘ MongoDB connection error:', err.message));

// ── Simulation Model ────────────────────────────────────────────────────────
const simulationSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  roomId:      { type: String, default: '' },
  createdBy:   { type: String, default: 'Scientist' },
  createdAt:   { type: Date, default: Date.now },
  bodies:      { type: Array, default: [] },
  constraints: { type: Array, default: [] },
  bodyMotors:  { type: Object, default: {} },
  simRunning:  { type: Boolean, default: true },
});

const Simulation = mongoose.model('Simulation', simulationSchema);

// ── REST API — Simulation Persistence ───────────────────────────────────────

// Save a simulation
app.post('/api/simulations', async (req, res) => {
  try {
    const { name, roomId, createdBy, bodies, constraints, bodyMotors, simRunning } = req.body;
    if (!name) return res.status(400).json({ error: 'Simulation name is required' });
    const sim = await Simulation.create({ name, roomId, createdBy, bodies, constraints, bodyMotors, simRunning });
    res.status(201).json({ id: sim._id, name: sim.name, createdAt: sim.createdAt });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: 'Failed to save simulation' });
  }
});

// List saved simulations (optional ?roomId= filter)
app.get('/api/simulations', async (req, res) => {
  try {
    const filter = req.query.roomId ? { roomId: req.query.roomId } : {};
    const sims = await Simulation.find(filter)
      .select('name roomId createdBy createdAt')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(sims);
  } catch (err) {
    console.error('List error:', err.message);
    res.status(500).json({ error: 'Failed to list simulations' });
  }
});

// Load a specific simulation
app.get('/api/simulations/:id', async (req, res) => {
  try {
    const sim = await Simulation.findById(req.params.id);
    if (!sim) return res.status(404).json({ error: 'Simulation not found' });
    res.json(sim);
  } catch (err) {
    console.error('Load error:', err.message);
    res.status(500).json({ error: 'Failed to load simulation' });
  }
});

// Delete a simulation
app.delete('/api/simulations/:id', async (req, res) => {
  try {
    const result = await Simulation.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Simulation not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete simulation' });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ── Host tracking per room ──────────────────────────────────────────────────
const roomHosts = {}; // { roomId: socketId }

function assignHost(roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room || room.size === 0) {
    delete roomHosts[roomId];
    return;
  }
  // Pick the first socket in the room as host
  const newHostId = room.values().next().value;
  roomHosts[roomId] = newHostId;
  // Notify everyone in the room of the new roles
  for (const id of room) {
    io.to(id).emit('role', { isHost: id === newHostId });
  }
  console.log(`  ★ Host for "${roomId}" is now ${newHostId}`);
}

io.on('connection', (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // ── Room Logic ─────────────────────────────────────────────────
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    socket.roomId = roomId;
    const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    io.to(roomId).emit('room_user_count', count);
    console.log(`${socket.id} joined room "${roomId}" (${count} users)`);

    // Assign host if there isn't one yet
    if (!roomHosts[roomId]) {
      assignHost(roomId);
    } else {
      // Tell the new joiner they are a peer
      socket.emit('role', { isHost: false });
    }

    // Ask the host for a live world snapshot (instead of any random peer)
    if (count > 1 && roomHosts[roomId] && roomHosts[roomId] !== socket.id) {
      io.to(roomHosts[roomId]).emit('request_state', socket.id);
      console.log(`  → Asked host ${roomHosts[roomId]} for state snapshot for ${socket.id}`);
    }
  });

  // ── Relay live state snapshot to the new joiner ────────────────
  socket.on('state_snapshot', ({ targetSocketId, bodies, constraints, bodyMotors, simRunning }) => {
    io.to(targetSocketId).emit('room_state', { bodies, constraints, bodyMotors, simRunning });
    console.log(`  → Relayed snapshot (${bodies.length} bodies) to ${targetSocketId}`);
  });

  // ── Host periodic sync: relay authoritative state to all peers ─
  socket.on('host_sync', (data) => {
    if (socket.roomId && roomHosts[socket.roomId] === socket.id) {
      socket.to(socket.roomId).emit('host_sync', data);
    }
  });

  // ── Spawn sync ────────────────────────────────────────────────
  socket.on('spawn_item', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_item', data);
  });

  // ── Drag sync ─────────────────────────────────────────────────
  socket.on('drag_update', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_drag', data);
  });

  // ── Constraint sync ────────────────────────────────────────
  socket.on('spawn_constraint', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_constraint', data);
  });

  socket.on('delete_constraint', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_delete_constraint', data);
  });

  socket.on('update_constraint', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_update_constraint', data);
  });

  // ── Body deletion (cut tool) ─────────────────────────────
  socket.on('delete_body', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_delete_body', data);
  });

  // ── Clear canvas ──────────────────────────────────────────
  socket.on('clear_canvas', () => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_clear');
  });

  // ── Simulation start/stop sync ────────────────────────────
  socket.on('toggle_sim', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_toggle_sim', data);
  });

  // ── Body property update sync ─────────────────────────────
  socket.on('update_body', (data) => {
    if (socket.roomId) socket.to(socket.roomId).emit('receive_update_body', data);
  });

  socket.on('disconnect', () => {
    console.log('User Disconnected', socket.id);
    const roomId = socket.roomId;
    if (roomId) {
      const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      io.to(roomId).emit('room_user_count', count);

      // If the host left, promote a new host
      if (roomHosts[roomId] === socket.id) {
        console.log(`  ★ Host ${socket.id} left room "${roomId}", re-assigning...`);
        assignHost(roomId);
      }
    }
  });
});

server.listen(process.env.PORT || 3001, () => {
  console.log('SERVER RUNNING ON PORT 3001');
});