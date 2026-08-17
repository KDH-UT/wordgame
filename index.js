const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        const roomId = 'ROOM-' + Math.floor(1000 + Math.random() * 9000);
        rooms[roomId] = { teams: {}, players: {}, scores: {}, allowSwitch: false };
        socket.join(roomId);
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinRoom', ({ roomId, name }) => {
        if (!rooms[roomId]) return socket.emit('error', '방이 존재하지 않습니다.');
        socket.join(roomId);
        rooms[roomId].players[socket.id] = { id: socket.id, name, roomId };
        socket.emit('joined', { roomId });
    });

    socket.on('submitHint', ({ roomId, hint }) => {
        io.to(roomId).emit('hintReceived', { sender: socket.id, hint });
    });

    socket.on('submitAnswer', ({ roomId, answer }) => {
        io.to(roomId).emit('answerReceived', { sender: socket.id, answer });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
