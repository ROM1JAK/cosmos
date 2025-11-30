// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
// Remplace par ton URI MongoDB
const MONGO_URI = process.env.MONGO_URI;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, '.')));

// --- MONGODB MODELS ---
mongoose.connect(MONGO_URI).then(() => console.log('MongoDB Connected'));

const UserSchema = new mongoose.Schema({
    pseudo: { type: String, unique: true, required: true },
    code: { type: String, required: true }, // Simple storage (hash in prod)
    isAdmin: { type: Boolean, default: false },
    online: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const CharacterSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    name: String,
    role: String,
    avatar: String,
    color: String,
    bio: String,
    subscribers: [mongoose.Schema.Types.ObjectId] // UserIds subscribed
});
const Character = mongoose.model('Character', CharacterSchema);

const MessageSchema = new mongoose.Schema({
    roomId: String,
    character: { name: String, avatar: String, color: String, id: String, userId: String },
    content: String,
    media: { type: String, url: String }, // type: 'image', 'video', 'audio'
    timestamp: { type: Date, default: Date.now },
    isPrivate: { type: Boolean, default: false },
    targetId: String // userId of recipient
});
const Message = mongoose.model('Message', MessageSchema);

const PostSchema = new mongoose.Schema({
    character: { name: String, avatar: String, color: String, id: String, userId: String },
    content: String,
    media: { type: String, url: String },
    likes: [String], // Array of Character IDs
    comments: [{ charId: String, charName: String, charAvatar: String, text: String, date: Date }],
    timestamp: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

const RoomSchema = new mongoose.Schema({ name: String });
const Room = mongoose.model('Room', RoomSchema);

// --- SOCKET LOGIC ---
let usersOnline = {}; // socketId -> {userId, pseudo, currentRoom}

io.on('connection', (socket) => {
    
    // 1. AUTH & INIT
    socket.on('login', async ({ pseudo, code }) => {
        try {
            let user = await User.findOne({ pseudo });
            if (user) {
                if (user.code !== code) return socket.emit('login_error', 'Mauvais code secret.');
            } else {
                const isAdmin = code === 'ADMIN';
                user = await User.create({ pseudo, code, isAdmin });
            }
            
            user.online = true;
            await user.save();
            
            usersOnline[socket.id] = { userId: user._id.toString(), pseudo: user.pseudo, isAdmin: user.isAdmin, currentRoom: 'Général' };
            socket.emit('login_success', { userId: user._id, pseudo: user.pseudo, isAdmin: user.isAdmin });
            
            io.emit('update_users', Object.values(usersOnline));
            
            // Send initial data
            const rooms = await Room.find();
            if(rooms.length === 0) await Room.create({ name: 'Général' });
            socket.emit('room_list', rooms.length ? rooms : [{name: 'Général'}]);
            
            const myChars = await Character.find({ userId: user._id });
            socket.emit('my_chars', myChars);

        } catch (e) { console.error(e); socket.emit('login_error', 'Erreur serveur'); }
    });

    socket.on('disconnect', async () => {
        if (usersOnline[socket.id]) {
            await User.findByIdAndUpdate(usersOnline[socket.id].userId, { online: false });
            delete usersOnline[socket.id];
            io.emit('update_users', Object.values(usersOnline));
        }
    });

    // 2. CHARACTERS
    socket.on('create_char', async (data) => {
        if (!usersOnline[socket.id]) return;
        const count = await Character.countDocuments({ userId: usersOnline[socket.id].userId });
        if (count >= 20) return socket.emit('error', 'Max 20 personnages.');
        
        const newChar = await Character.create({ ...data, userId: usersOnline[socket.id].userId });
        socket.emit('char_saved', newChar);
    });

    socket.on('get_char_details', async (charId) => {
        const char = await Character.findById(charId);
        if(char) {
            const user = await User.findById(char.userId);
            socket.emit('char_details', { char, playedBy: user ? user.pseudo : 'Inconnu' });
        }
    });

    socket.on('subscribe_char', async (charId) => {
        if (!usersOnline[socket.id]) return;
        const userId = usersOnline[socket.id].userId;
        await Character.findByIdAndUpdate(charId, { $addToSet: { subscribers: userId } });
        socket.emit('notification', { type: 'info', text: 'Abonné avec succès !' });
    });

    // 3. CHAT ROOMS
    socket.on('join_room', async (roomName) => {
        if (!usersOnline[socket.id]) return;
        socket.leave(usersOnline[socket.id].currentRoom);
        usersOnline[socket.id].currentRoom = roomName;
        socket.join(roomName);
        
        // Load messages (limit 50)
        const messages = await Message.find({ 
            roomId: roomName, 
            $or: [{ isPrivate: false }, { targetId: usersOnline[socket.id].userId }, { 'character.userId': usersOnline[socket.id].userId }]
        }).sort({ timestamp: 1 }).limit(100);
        
        socket.emit('load_messages', { room: roomName, messages });
    });

    socket.on('create_room', async (name) => {
        if (!usersOnline[socket.id] || !usersOnline[socket.id].isAdmin) return;
        await Room.create({ name });
        io.emit('room_list', await Room.find());
    });
    
    socket.on('delete_room', async (id) => {
        if (!usersOnline[socket.id] || !usersOnline[socket.id].isAdmin) return;
        await Room.findByIdAndDelete(id);
        io.emit('room_list', await Room.find());
    });

    // 4. MESSAGES
    socket.on('send_message', async (data) => {
        if (!usersOnline[socket.id]) return;
        const { roomId, charId, content, media, replyTo, isPrivate, targetId } = data;
        
        const char = await Character.findById(charId);
        if (!char) return;

        const msgData = {
            roomId,
            character: { name: char.name, avatar: char.avatar, color: char.color, id: char._id, userId: usersOnline[socket.id].userId },
            content,
            media,
            isPrivate: !!isPrivate,
            targetId: isPrivate ? targetId : null
        };

        const newMsg = await Message.create(msgData);

        if (isPrivate) {
            // Emit to sender and receiver only
            const targetSocket = Object.keys(usersOnline).find(sid => usersOnline[sid].userId === targetId);
            socket.emit('new_message', newMsg);
            if (targetSocket) io.to(targetSocket).emit('new_message', newMsg);
        } else {
            io.to(roomId).emit('new_message', newMsg);
            // Notify others
            socket.broadcast.emit('notify_message', { roomId });
        }
    });

    socket.on('delete_message', async (id) => {
        const msg = await Message.findById(id);
        if (!msg) return;
        const user = usersOnline[socket.id];
        if (user && (user.isAdmin || msg.character.userId === user.userId)) {
            await Message.findByIdAndDelete(id);
            io.emit('message_deleted', { id, roomId: msg.roomId });
        }
    });

    socket.on('typing', (data) => {
        socket.to(data.room).emit('user_typing', data);
    });

    // 5. SOCIAL FEED
    socket.on('get_feed', async () => {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(50);
        socket.emit('feed_data', posts);
    });

    socket.on('post_feed', async (data) => {
        if (!usersOnline[socket.id]) return;
        const char = await Character.findById(data.charId);
        if (!char) return;

        const newPost = await Post.create({
            character: { name: char.name, avatar: char.avatar, color: char.color, id: char._id, userId: usersOnline[socket.id].userId },
            content: data.content,
            media: data.media
        });

        io.emit('new_post', newPost);
        
        // Notify subscribers
        char.subscribers.forEach(subId => {
            const subSocket = Object.keys(usersOnline).find(sid => usersOnline[sid].userId === subId.toString());
            if (subSocket && subId.toString() !== usersOnline[socket.id].userId) {
                io.to(subSocket).emit('notification', { type: 'post', text: `${char.name} a posté !` });
            }
        });
    });

    socket.on('like_post', async ({ postId, charId }) => {
        const post = await Post.findById(postId);
        if (!post.likes.includes(charId)) {
            post.likes.push(charId);
            await post.save();
            io.emit('update_post', post);
            
            // Notify author
            const authorSocket = Object.keys(usersOnline).find(sid => usersOnline[sid].userId === post.character.userId);
            if (authorSocket) io.to(authorSocket).emit('notification', { type: 'like', text: `Nouveau like sur votre post` });
        }
    });

    socket.on('comment_post', async ({ postId, charId, text }) => {
        const char = await Character.findById(charId);
        const post = await Post.findByIdAndUpdate(postId, {
            $push: { comments: { charId, charName: char.name, charAvatar: char.avatar, text, date: new Date() } }
        }, { new: true });
        io.emit('update_post', post);
    });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


