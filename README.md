<div align="center">

# 🔬 VirtualLab

**Real-time collaborative physics sandbox for interactive simulations**

[![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socketdotio&logoColor=white)](https://socket.io/)
[![Matter.js](https://img.shields.io/badge/Matter.js-0.20-4B5562)](https://brm.io/matter-js/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)

---

*Drop shapes, wire constraints, tweak physics — and watch it all sync live across every browser in the room.*

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Set Up the Server](#2-set-up-the-server)
  - [3. Set Up the Client](#3-set-up-the-client)
  - [4. Open in Browser](#4-open-in-browser)
- [Environment Variables](#-environment-variables)
- [Usage Guide](#-usage-guide)
- [Multiplayer Architecture](#-multiplayer-architecture)
- [Deployment](#-deployment)
- [Contributing](#-contributing)

---

## 🧭 Overview

**VirtualLab** is a browser-based, multi-user physics simulation workbench built for education and experimentation. Users join shared rooms, spawn rigid bodies, connect them with constraints (rods, springs, motors, pivots), and observe real-time physics — all synchronized across every connected peer via WebSockets.

It is designed as a professional-grade engineering sandbox suitable for college-level physics demonstrations, featuring per-body analytics, energy tracking, a property inspector, and drag-and-drop interaction.

---

## ✨ Features

### Physics Engine
- 2D rigid-body simulation powered by **Matter.js**
- Configurable **gravity**, **friction**, **restitution**, and **air resistance**
- Play / Pause controls with full state freeze

### Shapes & Blueprints
| Primitives | Pre-built Setups |
|---|---|
| Box (rectangle) | Pendulum |
| Circle | Domino chain |
| Spring (two masses + constraint) | Ramp + rolling ball |

- Drag-and-drop from the sidebar or click to spawn
- Each body can be resized (width, height, radius) and recolored

### Constraint System
| Tool | Description |
|---|---|
| **Link** | Connect two bodies — choose Rod, Spring, or Motor |
| **Pivot** | Pin a body to its current position (world anchor) |
| **Cut** | Remove any body or static platform (and its attached constraints) |
| **Platform** | Draw custom static surfaces at any angle |

- Rod, Spring, Motor parameters are editable via a constraint inspector
- Per-body **motor system** with angular velocity & acceleration controls

### Real-time Collaboration
- Room-based multiplayer — join by entering a shared Room ID
- **Host-authoritative sync**: the first user in a room becomes the host; the host's physics state is broadcast at 150 ms intervals
- Late joiners receive a full world snapshot from the host
- Automatic host re-election when the host disconnects
- Live drag sync, spawn sync, constraint sync, property update sync, simulation toggle sync, clear/delete sync

### Analytics & Inspection
- **Per-body analytics panel** — velocity, angular velocity, kinetic energy, potential energy, mass
- Speed & energy history graphs (last 60 samples)
- System-wide totals (total KE, total PE, body count)
- **Property Inspector** — edit mass, dimensions, friction, restitution, and motor settings per body
- Keyboard navigation (← →) to cycle through bodies; selected body is highlighted with a yellow outline and floating name tag

### Workspace
- Save / Restore simulation state to `localStorage`
- Clear canvas (synced across peers)
- Clean, grid-based UI with the **Inter** typeface

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend Framework** | React 19 (Vite 8) |
| **Physics Engine** | Matter.js 0.20 |
| **Styling** | Tailwind CSS 4 + Inline styles |
| **Real-time Communication** | Socket.IO 4 (client + server) |
| **Backend** | Node.js + Express 5 |
| **Charts** | Recharts 3 |
| **Math Rendering** | KaTeX |
| **Build Tool** | Vite 8 |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (Client)                   │
│                                                         │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Lobby     │→ │ PhysicsCanvas│← │ Analytics Panel │  │
│  │  Screen    │  │  (Matter.js) │  │ (Recharts)      │  │
│  └────────────┘  └──────┬───────┘  └────────────────┘  │
│                         │ Socket.IO Client              │
└─────────────────────────┼───────────────────────────────┘
                          │ WebSocket
┌─────────────────────────┼───────────────────────────────┐
│                  Node.js Server                         │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐    │
│  │              Socket.IO Server                    │    │
│  │  • Room management    • Host tracking            │    │
│  │  • State relay        • Spawn / drag / sync      │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
VirtualWorld-Pranjal/
├── virtual-lab-client/          # React frontend (Vite)
│   ├── public/
│   │   ├── favicon.svg
│   │   └── icons.svg
│   ├── src/
│   │   ├── assets/
│   │   ├── blueprints/
│   │   │   └── index.js         # Pendulum, Dominoes, Ramp, etc.
│   │   ├── components/
│   │   │   ├── AnalyticsDashboard.jsx
│   │   │   ├── BodyAnalytics.jsx        # Per-body stats + property inspector
│   │   │   ├── ConstraintConfigPopover.jsx
│   │   │   ├── ConstraintInspector.jsx
│   │   │   ├── ConstraintOverlay.jsx
│   │   │   ├── EnergyBarChart.jsx
│   │   │   ├── EquationPanel.jsx
│   │   │   ├── GhostCursors.jsx
│   │   │   ├── LobbyScreen.jsx          # Room join screen
│   │   │   ├── MaterialsPanel.jsx
│   │   │   ├── PhysicsCanvas.jsx        # Main simulation canvas
│   │   │   ├── PropertyInspector.jsx
│   │   │   └── TimeScaleControl.jsx
│   │   ├── utils/
│   │   │   ├── constraintHelpers.js     # Rod, Spring, Motor, Pivot creation
│   │   │   └── vectorRenderer.js        # Force/velocity vector overlays
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── eslint.config.js
│   └── vite.config.js
│
├── virtual-lab-server/          # Node.js WebSocket server
│   ├── server.js                # Express + Socket.IO entry point
│   └── package.json
│
└── README.md                    ← You are here
```

---

## ✅ Prerequisites

Make sure you have the following installed on your machine:

| Tool | Minimum Version | Check Command |
|---|---|---|
| **Node.js** | v18.0.0+ | `node -v` |
| **npm** | v9.0.0+ | `npm -v` |
| **Git** | any | `git --version` |

> **Tip:** We recommend using [nvm](https://github.com/nvm-sh/nvm) to manage Node.js versions.

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/<your-username>/VirtualWorld-Pranjal.git
cd VirtualWorld-Pranjal
```

---

### 2. Set Up the Server

```bash
# Navigate to the server directory
cd virtual-lab-server

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on **http://localhost:3001** and print:

```
SERVER RUNNING ON PORT 3001
```

> ⚠️ **Keep this terminal running.** The server must be active for the client to connect.

---

### 3. Set Up the Client

Open a **new terminal** tab/window:

```bash
# Navigate to the client directory
cd virtual-lab-client

# Install dependencies
npm install

# Create your environment file
cp .env.example .env
```

The default `.env` points to the local server — no changes needed for local development:

```env
VITE_SERVER_URL=http://localhost:3001
```

Now start the development server:

```bash
npm run dev
```

Vite will output a local URL (typically **http://localhost:5173**).

---

### 4. Open in Browser

1. Open **http://localhost:5173** in your browser.
2. Enter a **Name** (optional — defaults to "Scientist").
3. Enter a **Room ID** (e.g., `physics-101`).
4. Click **Enter Lab**.
5. To test multiplayer, open the same URL in a second browser tab and join the same Room ID.

---

### Quick-Start Summary

```bash
# Terminal 1 — Server
cd virtual-lab-server && npm install && npm start

# Terminal 2 — Client
cd virtual-lab-client && npm install && cp .env.example .env && npm run dev
```

---

## 🔑 Environment Variables

### Client (`virtual-lab-client/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_SERVER_URL` | `http://localhost:3001` | URL of the Socket.IO server. Change this when deploying the server to a cloud provider. |

---

## 📚 Usage Guide

### Toolbar (Left Sidebar)

| Section | Button | Action |
|---|---|---|
| **Tools** | Select | Default mode — drag bodies around the canvas |
| | Link | Click two bodies to connect them (Rod / Spring / Motor) |
| | Pivot | Click a body to pin it at its current position |
| | Cut | Click a body or platform to delete it |
| | Platform | Click two points to draw a static surface |
| **Shapes** | Square | Spawn a 60×60 dynamic box |
| | Circle | Spawn a circle (radius 30) |
| **Setups** | Pendulum | Static pivot + swinging ball |
| | Spring | Two boxes connected by a spring constraint |

### Top Bar

| Button | Action |
|---|---|
| ▶ Play | Resume physics simulation |
| ⏹ Stop | Freeze all motion (bodies can still be dragged) |
| Save | Persist current bodies to `localStorage` |
| Restore | Load previously saved state |
| Clear | Remove all bodies and constraints (synced to all peers) |
| ← Leave | Return to the lobby |

### Analytics Panel (Right Sidebar)

- Navigate between bodies with ← → arrow keys or the prev/next buttons.
- View real-time velocity, angular velocity, kinetic energy, potential energy.
- Edit **mass**, **dimensions**, **friction**, **restitution** via the property inspector.
- Toggle per-body **motors** with angular velocity and acceleration controls.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `←` | Select previous body |
| `→` | Select next body |

---

## 🌐 Multiplayer Architecture

VirtualLab uses a **host-authoritative** sync model:

1. **First user** in a room is assigned as the **Host**.
2. The host runs the authoritative physics simulation and broadcasts body positions every **150 ms** to all peers.
3. **Peers** apply the host's state snapshot to correct local drift.
4. When a user **drags** a body, that user temporarily "owns" it — the host skips overriding that body until the drag ends.
5. **Spawns, constraints, property changes, and simulation toggles** are relayed to all peers via targeted Socket.IO events.
6. If the host **disconnects**, the server automatically promotes the next peer.
7. **Late joiners** receive a full snapshot (bodies + constraints + motors + simulation state) from the current host.

### Socket Events

| Event | Direction | Description |
|---|---|---|
| `join_room` | Client → Server | Join a named room |
| `role` | Server → Client | Notify host/peer assignment |
| `request_state` | Server → Host | Ask host for snapshot |
| `state_snapshot` | Host → Server → Client | Full world state for late joiners |
| `host_sync` | Host → Server → Peers | Periodic authoritative state |
| `spawn_item` | Client → Peers | New body created |
| `drag_update` | Client → Peers | Body being dragged |
| `spawn_constraint` | Client → Peers | New constraint created |
| `delete_constraint` | Client → Peers | Constraint removed |
| `update_constraint` | Client → Peers | Constraint config changed |
| `delete_body` | Client → Peers | Body removed (cut tool) |
| `clear_canvas` | Client → Peers | All bodies/constraints cleared |
| `toggle_sim` | Client → Peers | Play/Stop state change |
| `update_body` | Client → Peers | Body property modified |

---

## ☁️ Deployment

### Server

Deploy `virtual-lab-server/` to any Node.js hosting platform:

- [Render](https://render.com) — set **Build Command** to `npm install` and **Start Command** to `npm start`
- [Railway](https://railway.app)
- [Fly.io](https://fly.io)

The server listens on port `3001` by default. Most platforms will auto-assign a port via `process.env.PORT`; if needed, update `server.js` to use `process.env.PORT || 3001`.

### Client

Build the production bundle:

```bash
cd virtual-lab-client
npm run build
```

This outputs optimized static files to `dist/`. Deploy to:

- [Vercel](https://vercel.com)
- [Netlify](https://netlify.com)
- Any static file host

> **Important:** Set the `VITE_SERVER_URL` environment variable in your hosting platform to point to your deployed server URL **before** building.

---

## 🤝 Contributing

1. **Fork** this repository.
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a **Pull Request**.

Please follow existing code style and test multiplayer sync when modifying socket events.

---

<div align="center">

**Built by Pruthvi Haleholi, Pranjal Bisen & Sree Vaishnava Harshith**

</div>
