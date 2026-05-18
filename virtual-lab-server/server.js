const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

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
  socket.on('state_snapshot', ({ targetSocketId, bodies, constraints }) => {
    io.to(targetSocketId).emit('room_state', { bodies, constraints });
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

server.listen(3001, () => {
  console.log('SERVER RUNNING ON PORT 3001');
});