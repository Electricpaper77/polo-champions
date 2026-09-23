import http from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Polo Champions Server OK');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Polo player client connected');
  ws.on('message', (message) => {
    console.log('Received:', message.toString());
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
