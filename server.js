const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

const smallMap = { 'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','ゃ':'や','ゅ':'ゆ','ょ':'よ','っ':'つ' };
const dakutenMap = {
    'が':'か','ぎ':'き','ぐ':'く','げ':'け','ご':'こ','ざ':'さ','じ':'し','ず':'す','ぜ':'せ','ぞ':'そ',
    'だ':'た','ぢ':'ち','づ':'つ','で':'て','ど':'と','ば':'は','び':'ひ','ぶ':'ふ','べ':'ほ','ぼ':'ほ',
    'ぱ':'は','ぴ':'ひ','ぷ':'ふ','ぺ':'ほ','ぽ':'ほ','ヴ':'う'
};

function normalize(str, settings) {
    let res = str;
    if (settings.ignoreDakuten) res = res.split('').map(c => dakutenMap[c] || c).join('');
    if (settings.smallToBig) res = res.split('').map(c => smallMap[c] || c).join('');
    return res;
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomId, name }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                history: [],
                lastWord: "",
                turnIndex: 0,
                settings: {},
                isStarted: false,
                hostId: socket.id
            };
        }

        const room = rooms[roomId];
        const isHost = socket.id === room.hostId;
        room.players.push({ id: socket.id, name, score: 0, isHost });

        io.to(roomId).emit('updatePlayers', room.players);
        socket.emit('assignedRole', { isHost });
    });

    socket.on('startGame', ({ roomId, settings }) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.hostId) return;

        room.settings = settings;
        room.isStarted = true;
        
        if(settings.startWordType === 'random') {
             const hira = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ";
             room.lastWord = Array.from({length:4}, () => hira[Math.floor(Math.random()*hira.length)]).join('');
        } else {
            room.lastWord = "しりとり";
        }
        
        room.history = [room.lastWord];
        room.turnIndex = 0;
        io.to(roomId).emit('gameStarted', room);
    });

    socket.on('submitWord', ({ roomId, word }) => {
        const room = rooms[roomId];
        if (!room || !room.isStarted) return;

        const player = room.players[room.turnIndex];
        if (socket.id !== player.id) return;

        const normPrev = normalize(room.lastWord, room.settings);
        const normNext = normalize(word, room.settings);
        let overlap = 0;
        for (let i = Math.min(normPrev.length, normNext.length); i > 0; i--) {
            if (normPrev.endsWith(normNext.substring(0, i))) { overlap = i; break; }
        }

        if (overlap > 0 && !room.history.includes(word)) {
            player.score += overlap;
            room.lastWord = word;
            room.history.push(word);
            room.turnIndex = (room.turnIndex + 1) % room.players.length;

            if (room.settings.mode === 'point' && player.score >= room.settings.targetValue) {
                io.to(roomId).emit('gameOver', { winner: player.name, state: room });
            } else if (room.settings.mode === 'turn' && room.history.length > room.players.length * room.settings.targetValue) {
                const max = Math.max(...room.players.map(p => p.score));
                const winners = room.players.filter(p => p.score === max).map(p => p.name).join(' & ');
                io.to(roomId).emit('gameOver', { winner: winners, state: room });
            } else {
                io.to(roomId).emit('updateState', room);
            }
        } else {
            socket.emit('errorMsg', "つながらないか、既出の単語です");
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                room.players.splice(pIndex, 1);
                io.to(roomId).emit('updatePlayers', room.players);
                if (room.players.length === 0) delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`http://localhost:${PORT}`));