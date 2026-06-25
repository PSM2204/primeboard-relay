const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('PrimeBoard Relay Server is running!');
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // ==========================================
      // HANDLE EMAIL INVITES VIA BREVO
      // ==========================================
      if (data.type === 'email-invites') {
        console.log(`Sending Brevo invites to room ${data.room}...`);

        const BREVO_API_KEY = process.env.BREVO_API_KEY;
        const SENDER_EMAIL = 'primespiritmentors@gmail.com';

        const recipients = data.emails.map(email => ({ email: email }));

        const emailPayload = {
          sender: { name: "Prime Spirit Mentors", email: SENDER_EMAIL },
          to: recipients,
          subject: `PrimeBoard Invitation - Room: ${data.room}`,
          htmlContent: `
            <div style="font-family: sans-serif; padding: 20px; background: #f4f4f4;">
              <h2 style="color: #00C6FF;">PrimeBoard Invitation</h2>
              <p>Hello!</p>
              <p>Your teacher, <strong>${data.teacherName || data.teacher || 'your teacher'}</strong>, has invited you to join a live class on PrimeBoard.</p>
              <p><strong>Room Code:</strong> ${data.room}</p>
              <a href="${data.inviteUrl}" style="background: #00C6FF; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; margin-top: 10px;">Join Live Board</a>
              <p style="margin-top: 20px; font-size: 12px; color: #777;">Prime Spirit Mentors</p>
            </div>
          `
        };

        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json'
          },
          body: JSON.stringify(emailPayload)
        })
        .then(response => response.json())
        .then(result => {
          console.log('Brevo Success:', result);
          ws.send(JSON.stringify({ type: 'email-sent', success: true }));
        })
        .catch(error => {
          console.error('Brevo Error:', error);
          ws.send(JSON.stringify({ type: 'email-sent', success: false, error: error.message }));
        });

        return;
      }

      // ==========================================
      // HANDLE JOIN ROOM
      // ==========================================
      if (data.type === 'join') {
        const room = data.room;
        if (!rooms.has(room)) {
          rooms.set(room, new Set());
        }
        rooms.get(room).add(ws);

        ws.room = room;
        ws.userName = data.name;
        ws.userRole = data.role;

        ws.send(JSON.stringify({ type: 'state', locked: false }));
        broadcastRoster(room);
        console.log(`${data.name} joined room ${room}`);
        return;
      }

      // ==========================================
      // HANDLE SCENE UPDATES (Drawing sync)
      // ==========================================
      if (ws.room && data.type === 'scene-update') {
        rooms.get(ws.room).forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
        return;
      }

      // ==========================================
      // HANDLE LOCK/UNLOCK BOARD
      // ==========================================
      if (ws.room && data.type === 'set-lock') {
        rooms.get(ws.room).forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'lock-changed', locked: data.locked }));
          }
        });
        return;
      }

      // ==========================================
      // HANDLE TIMER SYNC
      // ==========================================
      if (ws.room && data.type === 'timer-update') {
        rooms.get(ws.room).forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'timer-update',
              action: data.action,
              timeLeft: data.timeLeft
            }));
          }
        });
        return;
      }

    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
      if (rooms.get(ws.room).size === 0) {
        rooms.delete(ws.room);
      } else {
        broadcastRoster(ws.room);
      }
    }
  });
});

function broadcastRoster(room) {
  if (!rooms.has(room)) return;
  const users = Array.from(rooms.get(room)).map(client => ({
    name: client.userName || 'Anonymous',
    role: client.userRole || 'student'
  }));
  const message = JSON.stringify({ type: 'roster', users: users });
  rooms.get(room).forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
