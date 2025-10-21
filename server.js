import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors({ origin: '*'}));

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;

// In-memory state
const rooms = new Map(); // roomCode -> { board, players, status }

function getRoomsSummary() {
  return Array.from(rooms.entries()).map(([code, room]) => ({
    code,
    playersCount: room.players.length,
    status: room.status
  }));
}
const BOARD_SIZE = 5;
const TOTAL_TILES = BOARD_SIZE * BOARD_SIZE;
const ALLOWED_COLORS = new Set(['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const phrasesPath = path.join(__dirname, 'data', 'phrases.json');

function loadPhrases() {
  try {
    const raw = fs.readFileSync(phrasesPath, 'utf-8');
    const arr = JSON.parse(raw);
    console.log("Loaded phrases:", arr.length, arr);
    return Array.isArray(arr) ? arr.filter(t => typeof t === 'string' && t.trim().length > 0) : [];
  } catch (e) {
    console.error("Error loading phrases:", e);
    return [];
  }
}

function pickUnique(items, count) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function generateBoard() {
  const phrases = loadPhrases();
  console.log("Phrases for board generation:", phrases.length);
  const labels = phrases.length >= TOTAL_TILES
    ? pickUnique(phrases, TOTAL_TILES)
    : phrases.concat(Array.from({ length: TOTAL_TILES - phrases.length }, (_, i) => `Task ${phrases.length + i + 1}`));
  console.log("Generated labels:", labels.length, labels);
  return labels.map(label => ({ label, ownerId: null, color: null }));
}

function getInitialRoomState() {
  return {
    board: generateBoard(),
    players: [], // { userId, color, score }
    status: 'waiting'
  };
}

function computeLines() {
  const lines = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    lines.push(Array.from({ length: BOARD_SIZE }, (_, c) => r * BOARD_SIZE + c));
  }
  for (let c = 0; c < BOARD_SIZE; c++) {
    lines.push(Array.from({ length: BOARD_SIZE }, (_, r) => r * BOARD_SIZE + c));
  }
  lines.push(Array.from({ length: BOARD_SIZE }, (_, i) => i * BOARD_SIZE + i));
  lines.push(Array.from({ length: BOARD_SIZE }, (_, i) => i * BOARD_SIZE + (BOARD_SIZE - 1 - i)));
  return lines;
}

const BINGO_LINES = computeLines();

function getPublicRoomState(room) {
  return {
    board: room.board.map(t => ({ label: t.label, color: t.color })),
    players: room.players.map(p => ({ userId: p.userId, name: p.name, color: p.color, score: p.score })),
    status: room.status
  };
}

io.on('connection', (socket) => {
  const userId = randomUUID();
  socket.data.userId = userId;

  socket.emit('hello', { userId });
  console.log(`[socket] connected userId=${userId} socketId=${socket.id}`);

  socket.on('createRoom', () => {
    let code;
    do { code = generateRoomCode(); } while (rooms.has(code));
    const room = getInitialRoomState();
    rooms.set(code, room);
    console.log(`[socket] createRoom userId=${socket.data.userId} code=${code}`);
    // Auto-join creator as first player
    const alreadyIn = room.players.find(p => p.userId === socket.data.userId);
    if (!alreadyIn) room.players.push({ userId: socket.data.userId, name: `Gracz-${String(socket.id).slice(-4)}`, color: null, score: 0 });
    socket.join(code);
    io.to(socket.id).emit('roomCreated', { roomCode: code });
    io.to(socket.id).emit('joined', { roomCode: code, state: getPublicRoomState(room) });
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
    io.emit('roomsUpdate', getRoomsSummary());
  });

  socket.on('joinRoom', ({ roomCode }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return io.to(socket.id).emit('error', { message: 'Room not found' });
    const alreadyIn = room.players.find(p => p.userId === socket.data.userId);
    if (!alreadyIn && room.players.length >= 2) return io.to(socket.id).emit('error', { message: 'Room full' });
    if (!alreadyIn) room.players.push({ userId: socket.data.userId, name: `Gracz-${String(socket.id).slice(-4)}`, color: null, score: 0 });
    console.log(`[socket] joinRoom userId=${socket.data.userId} code=${code}`);
    socket.join(code);
    io.to(socket.id).emit('joined', { roomCode: code, state: getPublicRoomState(room) });
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
    io.emit('roomsUpdate', getRoomsSummary());
  });

  socket.on('leaveRoom', ({ roomCode }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.userId !== socket.data.userId);
    try { socket.leave(code); } catch {}
    if (room.players.length === 0) {
      rooms.delete(code);
    } else {
      io.to(code).emit('stateUpdate', getPublicRoomState(room));
    }
    io.emit('roomsUpdate', getRoomsSummary());
  });

  socket.on('chooseColor', ({ roomCode, color }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    if (typeof color !== 'string' || !ALLOWED_COLORS.has(color)) return;
    const player = room.players.find(p => p.userId === socket.data.userId);
    if (!player) return;
    // prevent duplicate color selection by other player
    if (room.players.some(p => p.userId !== player.userId && p.color === color)) return;
    player.color = color;
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
  });

  socket.on('setName', ({ roomCode, name }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.userId === socket.data.userId);
    if (!player) return;
    const trimmed = String(name || '').trim().slice(0, 24);
    if (!trimmed) return;
    player.name = trimmed;
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
  });

  socket.on('clickTile', ({ roomCode, index }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    if (room.status === 'finished') return;
    const player = room.players.find(p => p.userId === socket.data.userId);
    if (!player || !player.color) return;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= TOTAL_TILES) return;
    const tile = room.board[i];
    // Toggle behavior: clicking own-colored tile undoes it
    if (tile.color && player.color && tile.color === player.color) {
      tile.ownerId = null;
      tile.color = null;
      if (player.score > 0) player.score -= 1;
      io.to(code).emit('stateUpdate', getPublicRoomState(room));
      return;
    }
    if (tile.ownerId) return; // already taken by other player

    tile.ownerId = player.userId;
    tile.color = player.color;
    player.score += 1;

    // Check bingo for this player
    const owned = new Set(room.board
      .map((t, idx) => (t.ownerId === player.userId ? idx : -1))
      .filter(idx => idx >= 0));
    const hasBingo = BINGO_LINES.some(line => line.every(idx => owned.has(idx)));
    if (hasBingo) {
      room.status = 'finished';
      io.to(code).emit('stateUpdate', getPublicRoomState(room));
      io.to(code).emit('gameOver', { winner: player.userId, reason: 'bingo' });
      return;
    }

    // If all tiles taken, decide by points
    const allTaken = room.board.every(t => t.ownerId);
    if (allTaken) {
      room.status = 'finished';
      const [p1 = { score: 0 }, p2 = { score: 0 }] = room.players;
    let winner = null;
      if (p1.score > p2.score) winner = p1.userId;
      else if (p2.score > p1.score) winner = p2.userId;
      io.to(code).emit('stateUpdate', getPublicRoomState(room));
      io.to(code).emit('gameOver', { winner, reason: 'points' });
      return;
    }

    io.to(code).emit('stateUpdate', getPublicRoomState(room));
  });

  socket.on('editTile', ({ roomCode, tileId, text }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    const i = Number(tileId);
    if (!Number.isInteger(i) || i < 0 || i >= TOTAL_TILES) return;
    const tile = room.board[i];
    if (tile.ownerId) return; // Cannot edit a tile that's already taken
    tile.label = String(text || '').trim().slice(0, 50); // Limit text length
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
  });

  socket.on('clearRoom', ({ roomCode }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    room.board = generateBoard(); // Reset board to initial state
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
  });

  socket.on('clearBoard', ({ roomCode }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    room.board = room.board.map(tile => ({ ...tile, label: "", color: null })); // Clear tile labels and colors
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
  });

  socket.on('startGame', ({ roomCode }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    room.status = 'started';
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
    io.to(code).emit('gameStarted'); // Powiadom frontend o rozpoczęciu gry
  });

  socket.on('undoTile', ({ roomCode, index }) => {
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return;
    if (room.status === 'finished') return;
    const player = room.players.find(p => p.userId === socket.data.userId);
    if (!player) return;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= TOTAL_TILES) return;
    const tile = room.board[i];
    if (!tile.color || !player.color || tile.color !== player.color) return; // can only undo own-colored tile
    tile.ownerId = null;
    tile.color = null;
    if (player.score > 0) player.score -= 1;
    io.to(code).emit('stateUpdate', getPublicRoomState(room));
  });

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected userId=${socket.data.userId} socketId=${socket.id}`);
    // Remove player from any rooms and delete empty rooms
    for (const [code, room] of rooms.entries()) {
      const before = room.players.length;
      room.players = room.players.filter(p => p.userId !== socket.data.userId);
      if (before !== room.players.length) {
        if (room.players.length === 0) {
          rooms.delete(code);
        } else {
          io.to(code).emit('stateUpdate', getPublicRoomState(room));
        }
      }
    }
    io.emit('roomsUpdate', getRoomsSummary());
  });
});

app.get('/', (_req, res) => {
  res.json({ ok: true });
});

// Simple HTTP endpoint to create a room (for diagnostics/testing)
app.post('/rooms', (_req, res) => {
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));
  const room = getInitialRoomState();
  rooms.set(code, room);
  console.log(`[http] createRoom code=${code}`);
  res.json({ roomCode: code });
});

// Rooms listing endpoint
app.get('/rooms', (_req, res) => {
  res.json(getRoomsSummary());
});

server.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
