const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());

// In-memory state: map of roomId -> array of Express response objects
const clients = new Map();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim());

const INGEST_SECRET = process.env.INGEST_SECRET;
const PORT = process.env.PORT || 4000;

if (!INGEST_SECRET) {
  console.warn('WARNING: INGEST_SECRET is not set. The relay will reject all ingest requests.');
}

// Restrict CORS explicitly to the allowed domains
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    // or if the origin is in our allowed list
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Healthcheck
app.get('/', (req, res) => {
  res.status(200).send('Mentatry SSE Relay is running.');
});

/**
 * GET /subscribe/:roomId
 * Client endpoint to open an SSE connection
 */
app.get('/subscribe/:roomId', (req, res) => {
  const { roomId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send an initial connected message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  if (!clients.has(roomId)) {
    clients.set(roomId, []);
  }
  
  const roomClients = clients.get(roomId);
  roomClients.push(res);

  // Remove client on disconnect
  req.on('close', () => {
    const updatedClients = clients.get(roomId)?.filter(client => client !== res) || [];
    if (updatedClients.length === 0) {
      clients.delete(roomId);
    } else {
      clients.set(roomId, updatedClients);
    }
  });
});

/**
 * POST /ingest/:roomId
 * Server endpoint to ingest events and push them to subscribed clients
 */
app.post('/ingest/:roomId', (req, res) => {
  const { roomId } = req.params;

  // Authorize using the shared ingest secret
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${INGEST_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;
  
  const roomClients = clients.get(roomId) || [];
  let sentCount = 0;
  
  // Push the event to all connected clients for this room
  roomClients.forEach(client => {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
    sentCount++;
  });

  res.status(200).json({ success: true, sentTo: sentCount });
});

app.listen(PORT, () => {
  console.log(`Mentatry SSE Relay listening on port ${PORT}`);
  console.log(`Allowed CORS origin: ${ALLOWED_ORIGIN}`);
});
