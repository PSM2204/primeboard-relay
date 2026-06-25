// PrimeBoard Relay Server
// -------------------------------------------------------------
// A tiny WebSocket relay. It does two jobs only:
//   1. Forward drawing events between everyone in the same room.
//   2. Remember each room's "locked" state and who the teacher is,
//      so the lock survives even if students refresh their page.
//
// It does NOT store drawings permanently, run a database, or know
// anything about Excalidraw's internal format -- it just relays
// whatever JSON messages clients send it. This keeps it small,
// cheap to host, and easy to understand.
// -------------------------------------------------------------

const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// rooms: roomCode -> {
//   locked: boolean,            // true = only teacher can draw
//   teacherSocket: ws | null,   // the socket that owns the lock switch
//   clients: Map<ws, { name, role }>
// }
const rooms = new Map();

function getRoom(code) {
    if (!rooms.has(code)) {
        rooms.set(code, { locked: false, teacherSocket: null, clients: new Map() });
    }
    return rooms.get(code);
}

function broadcast(room, payload, exceptSocket) {
    const msg = JSON.stringify(payload);
    for (const client of room.clients.keys()) {
        if (client !== exceptSocket && client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}

function roster(room) {
    return Array.from(room.clients.values()).map(c => ({ name: c.name, role: c.role }));
}

wss.on('connection', (ws) => {
    let joinedRoom = null;
    let roomCode = null;

    ws.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        // --- JOIN: first message a client sends ---
        if (data.type === 'join') {
            roomCode = String(data.room || '').trim();
            if (!roomCode) return;
            joinedRoom = getRoom(roomCode);

            const role = data.role === 'teacher' ? 'teacher' : 'student';
            const name = (data.name || 'Guest').toString().slice(0, 40);
            joinedRoom.clients.set(ws, { name, role });

            if (role === 'teacher') {
                joinedRoom.teacherSocket = ws;
            }

            // Tell the new client the current lock state + who else is here
            ws.send(JSON.stringify({
                type: 'state',
                locked: joinedRoom.locked,
                roster: roster(joinedRoom)
            }));

            // Tell everyone else the roster changed
            broadcast(joinedRoom, { type: 'roster', roster: roster(joinedRoom) }, ws);
            return;
        }

        if (!joinedRoom) return; // ignore anything before join

        // --- TEACHER toggles the lock ---
        if (data.type === 'set-lock') {
            const me = joinedRoom.clients.get(ws);
            if (!me || me.role !== 'teacher') return; // only teacher may lock/unlock
            joinedRoom.locked = !!data.locked;
            broadcast(joinedRoom, { type: 'lock-changed', locked: joinedRoom.locked }, null);
            return;
        }

        // --- DRAWING EVENTS: relay to everyone else in the room ---
        if (data.type === 'scene-update' || data.type === 'pointer-update') {
            const me = joinedRoom.clients.get(ws);
            if (!me) return;

            // Enforce the lock server-side: students can't sneak drawing
            // events through even if they tamper with their own client.
            if (data.type === 'scene-update' && joinedRoom.locked && me.role !== 'teacher') {
                return; // silently drop
            }
            broadcast(joinedRoom, data, ws);
            return;
        }
    });

    ws.on('close', () => {
        if (!joinedRoom) return;
        joinedRoom.clients.delete(ws);
        if (joinedRoom.teacherSocket === ws) {
            joinedRoom.teacherSocket = null;
        }
        broadcast(joinedRoom, { type: 'roster', roster: roster(joinedRoom) }, null);
        // Clean up empty rooms so memory doesn't grow forever
        if (joinedRoom.clients.size === 0 && roomCode) {
            rooms.delete(roomCode);
        }
    });
});

console.log(`PrimeBoard relay server running on port ${PORT}`);
