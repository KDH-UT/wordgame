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
    socket.on('createRoom', ({ teamsCount }) => {
        const roomId = 'ROOM-' + Math.floor(1000 + Math.random() * 9000);
        rooms[roomId] = {
            teamsCount: teamsCount,
            teams: {},
            players: {},
            teamScores: {},
            teamHistories: {},
            roundStartTime: null,
            startTime: null,
            currentWord: '',
            currentImage: '',
            allowTeamSwitch: false,
            hostSocketId: socket.id,
            masters: {}
        };
        for(let i=1; i<=teamsCount; i++) {
            rooms[roomId].teams[i] = [];
            rooms[roomId].teamScores[i] = 0;
            rooms[roomId].teamHistories[i] = [];
        }
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, gameState: rooms[roomId] });
    });

    socket.on('masterLogin', ({ roomId, masterName }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('masterKicked', '방이 존재하지 않습니다.');
        socket.join(roomId);
        room.masters[socket.id] = { id: socket.id, name: masterName };
        socket.emit('masterAck', { gameState: room });
        io.to(room.hostSocketId).emit('updateMasters', room.masters);
    });

    socket.on('kickMaster', ({ roomId, masterId }) => {
        const room = rooms[roomId];
        if (!room) return;
        if (room.masters[masterId]) {
            io.to(masterId).emit('masterKicked', '방장에 의해 퇴출되었습니다!');
            delete room.masters[masterId];
            io.to(room.hostSocketId).emit('updateMasters', room.masters);
        }
    });

    socket.on('getRoomInfo', ({ roomId, isChanging }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', '방이 존재하지 않습니다.');
        socket.join(roomId);
        const teamCounts = {};
        for (let i=1; i<=room.teamsCount; i++) teamCounts[i] = room.teams[i].length;
        socket.emit('roomInfo', { teamsCount: room.teamsCount, teamCounts, allowSwitch: room.allowTeamSwitch, isChanging });
        socket.emit('leaderboardUpdate', { teamsCount: room.teamsCount, teamScores: room.teamScores });
    });

    socket.on('joinTeam', ({ roomId, team, name }) => {
        const room = rooms[roomId];
        if (!room) return;
        // Remove from other teams
        for (let i=1; i<=room.teamsCount; i++) {
            const idx = room.teams[i].indexOf(socket.id);
            if (idx !== -1) room.teams[i].splice(idx, 1);
        }
        room.players[socket.id] = {
            id: socket.id, name, team, isGuesser: false, isSpy: false,
            targetTeamForSpy: null, hint: '', hintDuration: null,
            isApproved: false, answer: '', pendingScore: null, isCorrect: false
        };
        room.teams[team].push(socket.id);
        socket.emit('joinAck', { team, name });
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('toggleSwitch', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.allowTeamSwitch = !room.allowTeamSwitch;
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('startRound', ({ roomId, qKey, isSpyEnabled, qData }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.currentWord = qData.word;
        room.currentImage = qData.image;
        room.roundStartTime = Date.now();
        room.startTime = null;

        for (let t = 1; t <= room.teamsCount; t++) {
            const members = room.teams[t];
            if (members.length === 0) continue;
            const guesserIndex = Math.floor(Math.random() * members.length);
            let spyIndex = -1;
            if (isSpyEnabled && members.length > 1) {
                const candidateIndices = [];
                for (let i = 0; i < members.length; i++) { if (i !== guesserIndex) candidateIndices.push(i); }
                spyIndex = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
            }

            members.forEach((id, idx) => {
                const isGuesser = (idx === guesserIndex);
                const isSpy = (idx === spyIndex);
                let spyTarget = null;
                if (isSpy) {
                    const otherTeams = [];
                    for (let ot = 1; ot <= room.teamsCount; ot++) { if (ot !== t) otherTeams.push(ot); }
                    if (otherTeams.length > 0) spyTarget = otherTeams[Math.floor(Math.random() * otherTeams.length)];
                }

                const p = room.players[id];
                if (p) {
                    p.isGuesser = isGuesser;
                    p.isSpy = isSpy;
                    p.targetTeamForSpy = spyTarget;
                    p.hint = '';
                    p.hintDuration = null;
                    p.isApproved = false;
                    p.answer = '';
                    p.pendingScore = null;
                    p.isCorrect = false;
                }

                io.to(id).emit('roundStart', {
                    word: isGuesser ? '???' : qData.word,
                    image: isGuesser ? null : qData.image,
                    isGuesser,
                    isSpy
                });
            });
        }
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('submitHint', ({ roomId, hint }) => {
        const room = rooms[roomId];
        if (!room) return;
        const p = room.players[socket.id];
        if (p) {
            p.hint = hint;
            p.isApproved = false;
            if (room.roundStartTime) {
                p.hintDuration = ((Date.now() - room.roundStartTime) / 1000).toFixed(1);
            }
        }
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('approveHint', ({ roomId, playerId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const p = room.players[playerId];
        if (p) p.isApproved = true;
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('rejectHint', ({ roomId, playerId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const p = room.players[playerId];
        if (p) {
            p.hint = ''; p.hintDuration = null; p.isApproved = false;
        }
        io.to(playerId).emit('hintRejected');
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('revealHints', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const now = Date.now();
        room.startTime = now;

        Object.keys(room.players).forEach(id => {
            const p = room.players[id];
            if (p.hint && !p.isApproved) p.isApproved = true;
        });

        for (let targetTeam = 1; targetTeam <= room.teamsCount; targetTeam++) {
            const members = room.teams[targetTeam];
            const guesserId = members.find(id => room.players[id].isGuesser);
            if (!guesserId) continue;

            const hintsList = [];
            
            // 1. 해당 조 소속 일반 팀원들의 승인된 힌트 수집
            members.forEach(id => {
                const p = room.players[id];
                if (!p.isGuesser && !p.isSpy && p.hint && p.isApproved) {
                    hintsList.push(p.hint);
                }
            });

            // 2. 다른 조에서 이 조(targetTeam)로 침투한 스파이의 승인된 힌트 수집
            Object.keys(room.players).forEach(id => {
                const p = room.players[id];
                if (p.isSpy && p.targetTeamForSpy === targetTeam && p.hint && p.isApproved) {
                    hintsList.push(p.hint);
                }
            });

            hintsList.sort(() => Math.random() - 0.5);
            io.to(guesserId).emit('hintsRevealed', { hints: hintsList, startTime: now });
        }
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('submitAnswer', ({ roomId, answer, score }) => {
        const room = rooms[roomId];
        if (!room || !room.startTime) return;
        const player = room.players[socket.id];
        if (!player) return;

        player.answer = answer;
        player.pendingScore = score;
        const cleanSubmitted = answer.replace(/\s+/g, '').toLowerCase();
        const cleanTarget = room.currentWord.replace(/\s+/g, '').toLowerCase();
        const isMatched = (cleanTarget && cleanSubmitted === cleanTarget);

        if (isMatched) {
            player.isCorrect = true;
            room.teamScores[player.team] += score;
            socket.emit('answerAutoCorrect', { score });
            io.to(roomId).emit('leaderboardUpdate', { teamsCount: room.teamsCount, teamScores: room.teamScores });
        } else {
            socket.emit('answerPending');
        }

        room.teamHistories[player.team].push({
            id: 'HIST-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            playerId: player.id, playerName: player.name, team: player.team,
            targetWord: room.currentWord, submittedAnswer: answer, score: score, isCorrect: isMatched, timestamp: new Date().toLocaleTimeString()
        });

        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('approveAnswer', ({ roomId, playerId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[playerId];
        if (!player || player.isCorrect) return;
        player.isCorrect = true;
        const gainedScore = player.pendingScore || 0;
        room.teamScores[player.team] += gainedScore;

        const teamHist = room.teamHistories[player.team];
        if (teamHist) {
            const entry = teamHist.slice().reverse().find(h => h.playerId === playerId && h.submittedAnswer === player.answer);
            if (entry) entry.isCorrect = true;
        }

        io.to(playerId).emit('answerApproved', { score: gainedScore });
        io.to(roomId).emit('leaderboardUpdate', { teamsCount: room.teamsCount, teamScores: room.teamScores });
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('rejectAnswer', ({ roomId, playerId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players[playerId];
        if (!player) return;
        if (player.isCorrect) {
            const deductedScore = player.pendingScore || 0;
            room.teamScores[player.team] = Math.max(0, room.teamScores[player.team] - deductedScore);
        }
        player.isCorrect = false;

        const teamHist = room.teamHistories[player.team];
        if (teamHist) {
            const entry = teamHist.slice().reverse().find(h => h.playerId === playerId && h.submittedAnswer === player.answer);
            if (entry) entry.isCorrect = false;
        }

        io.to(playerId).emit('answerRejected');
        io.to(roomId).emit('leaderboardUpdate', { teamsCount: room.teamsCount, teamScores: room.teamScores });
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('toggleHistoryStatus', ({ roomId, teamNum, historyId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const entry = room.teamHistories[teamNum].find(h => h.id === historyId);
        if (!entry) return;

        if (entry.isCorrect) {
            entry.isCorrect = false;
            room.teamScores[teamNum] = Math.max(0, room.teamScores[teamNum] - entry.score);
            io.to(entry.playerId).emit('answerRejected');
        } else {
            entry.isCorrect = true;
            room.teamScores[teamNum] += entry.score;
            io.to(entry.playerId).emit('answerApproved', { score: entry.score });
        }
        io.to(roomId).emit('leaderboardUpdate', { teamsCount: room.teamsCount, teamScores: room.teamScores });
        io.to(roomId).emit('syncState', { gameState: room });
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.masters[socket.id]) {
                delete room.masters[socket.id];
                io.to(room.hostSocketId).emit('updateMasters', room.masters);
            }
            for (let i = 1; i <= room.teamsCount; i++) {
                const idx = room.teams[i].indexOf(socket.id);
                if (idx !== -1) {
                    room.teams[i].splice(idx, 1);
                    delete room.players[socket.id];
                    io.to(roomId).emit('syncState', { gameState: room });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
