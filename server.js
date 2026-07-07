const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000, // 接続維持のための設定
    pingInterval: 25000
});

app.use(express.static('public'));

let rooms = {}; // 部屋データ

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
                players: [], history: [], lastWord: "", turnIndex: 0, settings: { mode: 'point', targetValue: 15 }, isStarted: false, hostId: socket.id
            };
        }

        const room = rooms[roomId];
        // 既存のプレイヤーがいればIDを更新（再接続対策）
        const existingPlayer = room.players.find(p => p.name === name);
        if (existingPlayer) {
            existingPlayer.id = socket.id;
        } else if (!room.isStarted) {
            room.players.push({ id: socket.id, name, score: 0, isHost: socket.id === room.hostId });
        }

        io.to(roomId).emit('updatePlayers', room.players);
        socket.emit('assignedRole', { isHost: socket.id === room.hostId });
        
        // すでに開始していたら最新状態を送る
        if (room.isStarted) {
            socket.emit('gameStarted', room);
        }
    });

    socket.on('startGame', ({ roomId, settings }) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.hostId) return;
        room.settings = settings || { mode: 'point', targetValue: 15 };
        room.isStarted = true;
        room.lastWord = (settings && settings.startWordType === 'random') ? 
            Array.from({length:4}, () => "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ"[Math.floor(Math.random()*40)]).join('') : "しりとり";
        room.history = [room.lastWord];
        room.turnIndex = 0;
        io.to(roomId).emit('gameStarted', room);
    });

    socket.on('submitWord', ({ roomId, word }) => {
        const room = rooms[roomId];
        if (!room || !room.isStarted) return socket.emit('errorMsg', "部屋が存在しないか終了しています。再起動してください。");

        const player = room.players[room.turnIndex];
        if (!player || socket.id !== player.id) return socket.emit('errorMsg', "あなたの番ではありません");

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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running`));
