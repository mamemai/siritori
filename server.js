const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rooms = {}; 

const smallMap = { 'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','ゃ':'や','ゅ':'ゆ','ょ':'よ','っ':'つ' };
const dakutenMap = {
    'が':'か','ぎ':'き','ぐ':'く','げ':'け','ご':'こ','ざ':'さ','じ':'し','ず':'す','ぜ':'せ','ぞ':'そ',
    'だ':'た','ぢ':'ち','づ':'つ','で':'て','ど':'と','ば':'は','び':'ひ','ぶ':'ふ','べ':'ほ','ぼ':'ほ',
    'ぱ':'は','ぴ':'ひ','ぷ':'ふ','ぺ':'ほ','ぽ':'ほ','ヴ':'う'
};

function normalize(str, settings) {
    if (!str) return "";
    let res = str;
    if (!settings || settings.ignoreDakuten !== false) res = res.split('').map(c => dakutenMap[c] || c).join('');
    if (!settings || settings.smallToBig !== false) res = res.split('').map(c => smallMap[c] || c).join('');
    return res;
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomId, name }) => {
        if (!roomId || !name) return;
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [], history: [], lastWord: "", turnIndex: 0, settings: {}, isStarted: false, hostId: socket.id
            };
        }

        const room = rooms[roomId];
        const existingPlayer = room.players.find(p => p.name === name);
        
        if (existingPlayer) {
            existingPlayer.id = socket.id; // 再接続
        } else {
            room.players.push({ id: socket.id, name, score: 0, isHost: socket.id === room.hostId });
        }

        io.to(roomId).emit('updatePlayers', room.players);
        socket.emit('assignedRole', { isHost: socket.id === room.hostId });
        
        if (room.isStarted) {
            socket.emit('gameStarted', room);
        }
    });

    socket.on('startGame', ({ roomId, settings }) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.hostId) return;
        
        room.settings = settings;
        room.isStarted = true;
        room.players.forEach(p => p.score = 0); // スコアリセット
        
        room.lastWord = (settings.startWordType === 'random') ? 
            Array.from({length:4}, () => "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ"[Math.floor(Math.random()*40)]).join('') : "しりとり";
        
        room.history = [room.lastWord];
        room.turnIndex = 0;
        io.to(roomId).emit('gameStarted', room);
    });

    // ★ 新しく追加：ロビーに戻る処理
    socket.on('backToLobby', (roomId) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.hostId) return;
        room.isStarted = false;
        io.to(roomId).emit('returnToLobby');
    });

    socket.on('submitWord', ({ roomId, word }) => {
        const room = rooms[roomId];
        if (!room || !room.isStarted) return;

        const player = room.players[room.turnIndex];
        if (!player || socket.id !== player.id) return;

        if (room.history.includes(word)) return socket.emit('errorMsg', "すでに使われています");

        const normPrev = normalize(room.lastWord, room.settings);
        const normNext = normalize(word, room.settings);
        let overlap = 0;
        for (let i = Math.min(normPrev.length, normNext.length); i > 0; i--) {
            if (normPrev.endsWith(normNext.substring(0, i))) { overlap = i; break; }
        }

        if (overlap > 0) {
            player.score += overlap;
            room.lastWord = word;
            room.history.push(word);
            
            if (room.settings.mode === 'point' && player.score >= room.settings.targetValue) {
                return io.to(roomId).emit('gameOver', { winner: player.name, state: room });
            } 
            
            room.turnIndex = (room.turnIndex + 1) % room.players.length;

            if (room.settings.mode === 'turn' && room.history.length > room.players.length * room.settings.targetValue) {
                const max = Math.max(...room.players.map(p => p.score));
                const winner = room.players.filter(p => p.score === max).map(p => p.name).join(' & ');
                return io.to(roomId).emit('gameOver', { winner, state: room });
            }
            io.to(roomId).emit('updateState', room);
        } else {
            socket.emit('errorMsg', "つながっていません");
        }
    });

    socket.on('disconnect', () => {
        for (const id in rooms) {
            const room = rooms[id];
            const p = room.players.find(p => p.id === socket.id);
            if (p) {
                // ホストがいなくなったら次の人をホストにする（任意）
                if (p.isHost && room.players.length > 1) {
                    const nextHost = room.players.find(p => p.id !== socket.id);
                    if(nextHost) {
                        room.hostId = nextHost.id;
                        nextHost.isHost = true;
                        io.to(nextHost.id).emit('assignedRole', { isHost: true });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started`));
