
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 10e6 }); 
const mongoose = require('mongoose');

app.use(express.static(__dirname));

// CONFIGURATION
const ADMIN_CODE = "ADMIN"; 
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) console.error("ERREUR : Variable MONGO_URI manquante.");
else mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connecté à MongoDB.'))
    .catch(err => console.error("Erreur MongoDB:", err));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    secretCode: String, 
    isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, 
    ownerId: String, ownerUsername: String, description: String,
    followers: [String] 
});
const Character = mongoose.model('Character', CharacterSchema);

const MessageSchema = new mongoose.Schema({
    content: String, type: String, 
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String, ownerId: String,
    targetName: String, targetOwnerId: String,
    roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false },
    date: String, timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true }, creatorId: String, allowedCharacters: [String]
});
const Room = mongoose.model('Room', RoomSchema);

// STORY SCHEMA (TTL 24H)
const StorySchema = new mongoose.Schema({
    authorCharId: String,
    authorName: String,
    authorAvatar: String,
    mediaUrl: String,
    mediaType: String, // image/video
    ownerId: String,
    createdAt: { type: Date, default: Date.now, expires: 86400 } // 24h in seconds
});
const Story = mongoose.model('Story', StorySchema);

const PostSchema = new mongoose.Schema({
    content: String,
    mediaUrl: String,
    mediaType: String,
    authorCharId: String,
    authorName: String, authorAvatar: String, authorRole: String, authorColor: String, ownerId: String,
    likes: [String], 
    repostOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // REPOST FEATURE
    comments: [{
        id: String, authorCharId: String, authorName: String, authorAvatar: String, content: String, 
        mediaUrl: String, mediaType: String,
        ownerId: String, date: String,
        likes: [String] 
    }],
    date: String,
    timestamp: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

const NotificationSchema = new mongoose.Schema({
    targetOwnerId: String, 
    type: String, 
    content: String,
    fromName: String,
    isRead: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

// --- MUSIC SCHEMAS ---
const AlbumSchema = new mongoose.Schema({
    title: String, coverUrl: String, artistId: String, artistName: String, year: String, ownerId: String
});
const Album = mongoose.model('Album', AlbumSchema);

const TrackSchema = new mongoose.Schema({
    title: String, audioUrl: String, coverUrl: String, duration: Number, albumId: String,
    artistId: String, artistName: String, ownerId: String, plays: { type: Number, default: 0 },
    likes: [String], timestamp: { type: Date, default: Date.now }
});
const Track = mongoose.model('Track', TrackSchema);


let onlineUsers = {}; 

function broadcastUserList() {
    const uniqueNames = [...new Set(Object.values(onlineUsers))];
    io.emit('update_user_list', uniqueNames);
}

async function createNotification(targetId, type, content, fromName) {
    if(!targetId || targetId === ADMIN_CODE) return;
    const notif = new Notification({ targetOwnerId: targetId, type, content, fromName });
    await notif.save();
    io.emit('notification_dispatch', notif); 
}

io.on('connection', async (socket) => {
  
  // --- LOGIN ---
  socket.on('login_request', async ({ username, code }) => {
      try {
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);
          if (user) {
              if (user.secretCode !== code && !isAdmin) { socket.emit('login_error', "Mot de passe incorrect."); return; }
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              if(await User.findOne({ secretCode: code })) { socket.emit('login_error', "Code déjà pris."); return; }
              user = new User({ username, secretCode: code, isAdmin }); await user.save();
          }
          await Character.updateMany({ ownerId: code }, { ownerUsername: username });
          onlineUsers[socket.id] = user.username; broadcastUserList();
          socket.emit('login_success', { username: user.username, userId: user.secretCode, isAdmin: user.isAdmin });
      } catch (e) { console.error(e); socket.emit('login_error', "Erreur serveur."); }
  });

  socket.on('change_username', async ({ userId, newUsername }) => {
      try {
          if (await User.findOne({ username: newUsername })) return socket.emit('username_change_error', "Pseudo pris.");
          await User.findOneAndUpdate({ secretCode: userId }, { username: newUsername });
          await Character.updateMany({ ownerId: userId }, { ownerUsername: newUsername });
          onlineUsers[socket.id] = newUsername; broadcastUserList();
          socket.emit('username_change_success', newUsername);
      } catch (e) { socket.emit('username_change_error', "Erreur."); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastUserList(); });

  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      // Populate repostOf to display original content
      const posts = await Post.find().sort({ timestamp: -1 }).limit(50).populate('repostOf');
      socket.emit('feed_data', posts);
      
      if(userId) {
          const myChars = await Character.find({ ownerId: userId });
          socket.emit('my_chars_data', myChars);
          const notifs = await Notification.find({ targetOwnerId: userId }).sort({ timestamp: -1 }).limit(20);
          socket.emit('notifications_data', notifs);
      }
  });

  // --- CHARACTERS ---
  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id });
          const charData = char.toObject(); charData.postCount = postCount;
          socket.emit('char_profile_data', charData);
      }
  });
  socket.on('create_char', async (data) => {
    if (await Character.countDocuments({ ownerId: data.ownerId }) >= 20) return; 
    const user = await User.findOne({ secretCode: data.ownerId }); if (user) data.ownerUsername = user.username;
    await new Character(data).save(); socket.emit('char_created_success', data);
  });
  socket.on('edit_char', async (data) => {
      await Character.findByIdAndUpdate(data.charId, { name: data.newName, role: data.newRole, avatar: data.newAvatar, color: data.newColor, description: data.newDescription });
      await Message.updateMany({ senderName: data.originalName, ownerId: data.ownerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      await Post.updateMany({ authorName: data.originalName, ownerId: data.ownerId }, { $set: { authorName: data.newName, authorRole: data.newRole, authorAvatar: data.newAvatar, authorColor: data.newColor }});
      await Track.updateMany({ artistId: data.charId }, { $set: { artistName: data.newName }});
      socket.emit('my_chars_data', await Character.find({ ownerId: data.ownerId }));
      io.emit('force_history_refresh', { roomId: data.currentRoomId }); io.emit('reload_posts'); io.emit('reload_music');
  });
  socket.on('delete_char', async (charId) => { await Character.findByIdAndDelete(charId); socket.emit('char_deleted_success', charId); });
  
  socket.on('follow_character', async ({ followerCharId, targetCharId }) => {
      const target = await Character.findById(targetCharId); const follower = await Character.findById(followerCharId);
      if(!target || !follower || target.ownerId === follower.ownerId) return; // Prevent self-owner follow
      const idx = target.followers.indexOf(followerCharId);
      if(idx === -1) { target.followers.push(followerCharId); await createNotification(target.ownerId, 'follow', `(${follower.name}) vous suit`, follower.ownerUsername); } 
      else { target.followers.splice(idx, 1); }
      await target.save();
      const pCount = await Post.countDocuments({ authorCharId: target._id });
      const d = target.toObject(); d.postCount = pCount; socket.emit('char_profile_updated', d);
  });
  socket.on('get_followers_list', async (id) => {
      const char = await Character.findById(id);
      socket.emit('followers_list_data', char && char.followers.length > 0 ? await Character.find({ _id: { $in: char.followers } }).select('name avatar role ownerUsername') : []);
  });

  // --- ROOMS/MSG ---
  socket.on('create_room', async (d) => { await new Room(d).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (id) => { if (id === "global") return; await Room.findByIdAndDelete(id); await Message.deleteMany({ roomId: id }); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', id); });
  socket.on('join_room', (r) => socket.join(r)); socket.on('leave_room', (r) => socket.leave(r));
  socket.on('request_history', async (d) => {
      const r = (typeof d === 'object') ? d.roomId : d; const u = (typeof d === 'object') ? d.userId : null;
      const q = { roomId: r }; if (u) q.$or = [ { targetName: { $exists: false } }, { targetName: "" }, { ownerId: u }, { targetOwnerId: u } ]; else q.$or = [{ targetName: { $exists: false } }, { targetName: "" }];
      socket.emit('history_data', await Message.find(q).sort({ timestamp: 1 }).limit(200));
  });
  socket.on('request_dm_history', async ({ myUsername, targetUsername }) => {
      const m = await Message.find({ roomId: 'dm', $or: [ { senderName: myUsername, targetName: targetUsername }, { senderName: targetUsername, targetName: myUsername } ] }).sort({ timestamp: 1 });
      socket.emit('dm_history_data', { target: targetUsername, history: m });
  });
  socket.on('request_dm_contacts', async (u) => {
      const m = await Message.find({ roomId: 'dm', $or: [{ senderName: u }, { targetName: u }] });
      const c = new Set(); m.forEach(msg => c.add((msg.senderName === u) ? msg.targetName : msg.senderName));
      socket.emit('dm_contacts_data', Array.from(c));
  });
  socket.on('dm_delete_history', async ({ userId, targetName }) => { await Message.deleteMany({ $or: [ { ownerId: userId, targetName: targetName }, { targetName: targetName, ownerId: userId } ] }); io.emit('force_history_refresh', { roomId: 'global' }); });
  socket.on('send_dm', async (d) => {
      const s = await User.findOne({ username: d.sender }); const t = await User.findOne({ username: d.target });
      const m = await new Message({ content: d.content, type: d.type, senderName: d.sender, ownerId: s?.secretCode, targetName: d.target, targetOwnerId: t?.secretCode, roomId: 'dm', date: d.date }).save();
      const p = { _id: m._id, sender: m.senderName, target: m.targetName, content: m.content, type: m.type, date: m.date };
      const targets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === d.target || onlineUsers[id] === d.sender);
      [...new Set(targets)].forEach(id => io.to(id).emit('receive_dm', p));
      if (t) await createNotification(t.secretCode, 'reply', `vous a envoyé un MP`, d.sender);
  });
  socket.on('message_rp', async (d) => {
    if (!d.roomId) return; if (d.senderName === "Narrateur") { const u = await User.findOne({ secretCode: d.ownerId }); if (!u || !u.isAdmin) return; }
    if (d.targetName) { const t = await Character.findOne({ name: d.targetName }).sort({_id: -1}); if (t) d.targetOwnerId = t.ownerId; }
    const m = await new Message(d).save(); io.to(d.roomId).emit('message_rp', m);
    if (d.replyTo?.id) { const o = await Message.findById(d.replyTo.id); if (o && o.ownerId !== d.ownerId) await createNotification(o.ownerId, 'reply', `a répondu à votre message`, d.senderName); }
  });
  socket.on('delete_message', async (id) => { await Message.findByIdAndDelete(id); io.emit('message_deleted', id); });
  socket.on('edit_message', async (d) => { await Message.findByIdAndUpdate(d.id, { content: d.newContent, edited: true }); io.emit('message_updated', { id: d.id, newContent: d.newContent }); });
  socket.on('admin_clear_room', async (r) => { await Message.deleteMany({ roomId: r }); io.to(r).emit('history_cleared'); });

  // --- POSTS ---
  socket.on('create_post', async (d) => {
      const p = await new Post(d).save(); io.emit('new_post', p);
      if(d.authorCharId) {
          const author = await Character.findById(d.authorCharId);
          if(author && author.followers.length) {
              const followers = await Character.find({ _id: { $in: author.followers } });
              const notified = new Set();
              for(const f of followers) { if(!notified.has(f.ownerId)) { await createNotification(f.ownerId, 'follow', `(${d.authorName}) a posté`, "Feed"); notified.add(f.ownerId); } }
          }
      }
  });
  
  // REPOST HANDLER
  socket.on('repost_post', async ({ originalPostId, reposterCharId, reposterName, reposterAvatar, reposterRole, ownerId }) => {
      const original = await Post.findById(originalPostId);
      if(!original) return;
      // If original is already a repost, repost the source instead
      const sourceId = original.repostOf ? original.repostOf : original._id;
      
      const repost = new Post({
          content: "", // Content handled via population
          authorCharId: reposterCharId,
          authorName: reposterName,
          authorAvatar: reposterAvatar,
          authorRole: reposterRole,
          ownerId: ownerId,
          repostOf: sourceId,
          date: new Date().toLocaleDateString(),
          timestamp: Date.now()
      });
      const saved = await repost.save();
      // Populate for immediate display
      const populated = await Post.findById(saved._id).populate('repostOf');
      io.emit('new_post', populated);
      
      // Notify original author
      const sourcePost = await Post.findById(sourceId);
      if(sourcePost && sourcePost.ownerId !== ownerId) {
          await createNotification(sourcePost.ownerId, 'reply', `(${reposterName}) a reposté votre publication`, "Feed");
      }
  });

  socket.on('delete_post', async (id) => { await Post.findByIdAndDelete(id); io.emit('post_deleted', id); });
  socket.on('report_post', async (id) => console.log(`Report ${id}`));
  socket.on('like_post', async ({ postId, charId }) => { 
      const p = await Post.findById(postId); if(!p) return;
      const idx = p.likes.indexOf(charId);
      const action = (idx === -1) ? 'like' : 'unlike';
      if(idx === -1) p.likes.push(charId); else p.likes.splice(idx, 1);
      await p.save(); io.emit('post_updated', await p.populate('repostOf'));
      if (action === 'like' && p.ownerId) { const c = await Character.findById(charId); await createNotification(p.ownerId, 'like', `(${c?c.name:'?'}) a aimé`, "Feed"); }
  });
  socket.on('post_comment', async ({ postId, comment }) => {
      const p = await Post.findById(postId); if(!p) return;
      comment.id = new mongoose.Types.ObjectId().toString(); comment.likes = []; p.comments.push(comment);
      await p.save(); io.emit('post_updated', await p.populate('repostOf'));
      if (p.ownerId !== comment.ownerId) await createNotification(p.ownerId, 'reply', `(${comment.authorName}) a commenté`, "Feed");
  });
  socket.on('like_comment', async ({ postId, commentId, charId }) => {
      const p = await Post.findById(postId); if(!p) return;
      const c = p.comments.find(x => x.id === commentId); if(c) {
          const idx = c.likes.indexOf(charId); if(idx===-1) c.likes.push(charId); else c.likes.splice(idx,1);
          p.markModified('comments'); await p.save(); io.emit('post_updated', await p.populate('repostOf'));
      }
  });
  socket.on('delete_comment', async ({ postId, commentId }) => {
      const p = await Post.findById(postId); if(!p) return;
      p.comments = p.comments.filter(c => c.id !== commentId); await p.save(); io.emit('post_updated', await p.populate('repostOf'));
  });

  // --- STORIES ---
  socket.on('upload_story', async (data) => {
      const s = new Story(data);
      await s.save();
      // Notify followers (optional, simplified for now)
      io.emit('story_uploaded', s);
  });

  socket.on('get_stories', async () => {
      // Fetch all valid stories
      const stories = await Story.find().sort({ createdAt: 1 });
      // Group by Author
      const grouped = {};
      stories.forEach(s => {
          if (!grouped[s.authorCharId]) {
              grouped[s.authorCharId] = {
                  authorId: s.authorCharId,
                  authorName: s.authorName,
                  authorAvatar: s.authorAvatar,
                  stories: []
              };
          }
          grouped[s.authorCharId].stories.push(s);
      });
      socket.emit('stories_data', Object.values(grouped));
  });

  // --- MUSIC ---
  socket.on('upload_track', async (d) => {
      await new Track(d).save(); io.emit('track_uploaded', d);
      const a = await Character.findById(d.artistId);
      if(a && a.followers.length) {
          const f = await Character.find({ _id: { $in: a.followers } });
          const n = new Set(); for(const x of f) { if(!n.has(x.ownerId)) { await createNotification(x.ownerId, 'follow', `(${d.artistName}) new track!`, "Music"); n.add(x.ownerId); } }
      }
  });
  socket.on('get_music_feed', async () => socket.emit('music_feed_data', await Track.find().sort({ timestamp: -1 }).limit(50)));
  socket.on('like_track', async ({ trackId, charId }) => {
      const t = await Track.findById(trackId); if(!t) return;
      const i = t.likes.indexOf(charId); if(i===-1) t.likes.push(charId); else t.likes.splice(i,1);
      await t.save(); io.emit('track_updated', t);
  });
  socket.on('listen_track', async (id) => { await Track.findByIdAndUpdate(id, { $inc: { plays: 1 } }); io.emit('track_updated', await Track.findById(id)); });
  socket.on('delete_track', async (id) => { await Track.findByIdAndDelete(id); io.emit('track_deleted', id); });

  socket.on('mark_notifications_read', async (u) => { await Notification.updateMany({ targetOwnerId: u, isRead: false }, { isRead: true }); socket.emit('notifications_read_confirmed'); });
  socket.on('typing_start', (d) => socket.to(d.roomId).emit('display_typing', d));
  socket.on('typing_stop', (d) => socket.to(d.roomId).emit('hide_typing', d));
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
