const express = require('express');
const path    = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 10e6 }); 
const mongoose = require('mongoose');

app.use(express.static(path.join(__dirname, 'public')));

// CONFIGURATION
const ADMIN_CODE = "ADMIN"; 
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) console.error("ERREUR : Variable MONGO_URI manquante.");
else mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connecté à MongoDB.'))
    .catch(err => console.error("Erreur MongoDB:", err));

// --- MODÈLES ---
const User =         require('./src/models/User');
const Character =    require('./src/models/Character');
const Alert =        require('./src/models/Alert');
const Message =      require('./src/models/Message');
const Room =         require('./src/models/Room');
const Post =         require('./src/models/Post');
const OmbraMessage = require('./src/models/OmbraMessage');
const Event =        require('./src/models/Event');
const Notification = require('./src/models/Notification');
const AdminLog =     require('./src/models/AdminLog');

// ========== [CITÉS] ==========
const City = require('./src/models/City');
const CityRelation = require('./src/models/CityRelation');

// ========== [BOURSE] ==========
const Stock = require('./src/models/Stock');

// ========== [WIKI] ==========
const WikiPage = require('./src/models/WikiPage');

const CITIES_SEED = [
    { name: 'Aguerta',    archipel: 'Archipel Pacifique' },
    { name: 'Arva',       archipel: 'Archipel Pacifique' },
    { name: 'Aurion',     archipel: 'Archipel Pacifique' },
    { name: 'Cellum',     archipel: 'Archipel Pacifique' },
    { name: 'Elvita',     archipel: 'Archipel Pacifique' },
    { name: 'Hoross',     archipel: 'Archipel Pacifique' },
    { name: 'Kama',       archipel: 'Archipel Pacifique' },
    { name: 'Lesetha',    archipel: 'Archipel Pacifique' },
    { name: 'Ofarno',     archipel: 'Archipel Pacifique' },
    { name: 'Orchadia',   archipel: 'Archipel Pacifique' },
    { name: 'Otima',      archipel: 'Archipel Pacifique' },
    { name: 'Qruving',    archipel: 'Archipel Pacifique' },
    { name: 'Shamballa',  archipel: 'Archipel Pacifique' },
    { name: 'Sioonok',    archipel: 'Archipel Pacifique' },
    { name: 'Tellos',     archipel: 'Archipel Pacifique' },
    { name: 'Tesmond',    archipel: 'Archipel Pacifique' },
    { name: 'Utopia',     archipel: 'Archipel Pacifique' },
    { name: 'Worford',    archipel: 'Archipel Pacifique' },
    { name: 'Burtharb',    archipel: 'Ancienne Archipel' },
    { name: 'Buswax',      archipel: 'Ancienne Archipel' },
    { name: 'Hertford',    archipel: 'Ancienne Archipel' },
    { name: 'Horsmouthia', archipel: 'Ancienne Archipel' },
    { name: 'Panviles',    archipel: 'Ancienne Archipel' },
    { name: 'Alburg',      archipel: 'Archipel Sableuse' },
    { name: 'Bambeween',   archipel: 'Archipel Sableuse' },
    { name: 'Bireland',    archipel: 'Archipel Sableuse' },
    { name: 'Kirchia',     archipel: 'Archipel Sableuse' },
    { name: 'Pagoas Sud',  archipel: 'Archipel Sableuse' },
    { name: 'Pagoas Nord', archipel: 'Archipel Sableuse' },
];
mongoose.connection.once('open', async () => {
    for(const c of CITIES_SEED) {
        const exists = await City.findOne({ name: c.name });
        if(!exists) await City.create({ ...c, baseEDC: 1000000000000, historyEDC: [{ value: 1000000000000 }] });
    }
});
// ========== [FIN CITÉS SCHÉMA] ==========

let onlineUsers = {};

// [BOURSE] Helper — propage la variation de prix aux actifs du personnage lié
async function applyStockValueChange(stock, oldValue, newValue) {
    if(!stock.charId || !oldValue || oldValue === newValue) return;
    const pct = (newValue - oldValue) / oldValue;
    if(Math.abs(pct) < 0.00001) return;
    // Amplifier l'effet sur le capital (x1 pour un impact réaliste)
    const amplifiedPct = pct;
    try {
        const char = await Character.findById(stock.charId);
        if(!char) return;
        let changed = false;
        if((char.capital || 0) > 0) {
            char.capital = Math.round(char.capital * (1 + amplifiedPct) * 100) / 100;
            changed = true;
        }
        if(char.companies && char.companies.length > 0) {
            char.companies.forEach(co => {
                if(co.name === stock.companyName && (co.revenue || 0) > 0) {
                    co.revenue = Math.round(co.revenue * (1 + amplifiedPct) * 100) / 100;
                    changed = true;
                }
            });
        }
        if(changed) {
            char.markModified('companies');
            await char.save();
            io.emit('char_updated', char.toObject());
        }
    } catch(e) { console.error('applyStockValueChange error:', e); }
}

async function getEnrichedStocks() {
    const stocks = await Stock.find().sort({ companyName: 1 });
    const charIds = [...new Set(stocks.filter(s => s.charId).map(s => String(s.charId)))];
    if(!charIds.length) return stocks.map(s => s.toObject());
    const chars = await Character.find({ _id: { $in: charIds } }).select('_id companies capital');
    const charMap = {};
    chars.forEach(c => { charMap[String(c._id)] = c; });
    return stocks.map(s => {
        const obj = s.toObject();
        const char = charMap[String(s.charId)];
        if(char) {
            const co = (char.companies || []).find(c => c.name === s.companyName);
            obj.revenue = co ? (co.revenue || 0) : 0;
            obj.capital = char.capital || 0;
        } else {
            obj.revenue = 0;
        }
        return obj;
    });
}

function broadcastUserList() {
    const uniqueNames = [...new Set(Object.values(onlineUsers))];
    io.emit('update_user_list', uniqueNames);
}

async function createNotification(targetId, type, content, fromName, redirectView = null, redirectData = null) {
    if(!targetId || targetId === ADMIN_CODE) return;
    const notif = new Notification({ targetOwnerId: targetId, type, content, fromName, redirectView, redirectData });
    await notif.save();
    io.emit('notification_dispatch', notif); 
}

async function getSocketUser(socket) {
    const username = onlineUsers[socket.id];
    if(!username) return null;
    return User.findOne({ username });
}

async function emitToAdmins(eventName, payload) {
    const onlineNames = [...new Set(Object.values(onlineUsers).filter(Boolean))];
    if(!onlineNames.length) return;
    const admins = await User.find({ username: { $in: onlineNames }, isAdmin: true }).select('username');
    const adminNames = new Set(admins.map(user => user.username));
    Object.entries(onlineUsers).forEach(([socketId, username]) => {
        if(adminNames.has(username)) io.to(socketId).emit(eventName, payload);
    });
}

function extractArticleTitle(content = '') {
    const titleMatch = content.match(/^\[TITRE\](.*?)\[\/TITRE\]\n?([\s\S]*)/);
    if(titleMatch) return titleMatch[1].trim();
    return content.split(/\s+/).slice(0, 10).join(' ').trim();
}

function extractTextPreview(text = '', length = 120) {
    return String(text).replace(/\[TITRE\].*?\[\/TITRE\]\n?/g, '').replace(/\s+/g, ' ').trim().slice(0, length);
}

function getObjectDate(value) {
    if(value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if(typeof value === 'string' && value.length >= 8) {
        const timestamp = parseInt(value.slice(0, 8), 16);
        if(!Number.isNaN(timestamp)) return new Date(timestamp * 1000);
    }
    return new Date();
}

function buildDisplayPost(post, authorChar = null) {
    const displayPost = post.toObject ? post.toObject() : { ...post };
    if(displayPost.isAnonymous) {
        displayPost.authorName = 'Source Anonyme';
        displayPost.authorAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23383a40' width='100' height='100'/%3E%3Ctext x='50' y='55' font-size='50' fill='%23666' text-anchor='middle' dominant-baseline='middle'%3E%3F%3C/text%3E%3C/svg%3E";
        displayPost.authorRole = 'Leak';
    }
    displayPost.authorIsOfficial = !!authorChar?.isOfficial;
    displayPost.authorFollowers = Array.isArray(authorChar?.followers) ? authorChar.followers : [];
    displayPost.authorCompanyNames = Array.isArray(authorChar?.companies) ? authorChar.companies.map(company => company.name).filter(Boolean) : [];
    return displayPost;
}

async function enrichPostsForDisplay(posts) {
    const authorIds = [...new Set(posts.map(post => String(post.authorCharId || '')).filter(Boolean))];
    const authorMap = new Map();
    if(authorIds.length) {
        const authors = await Character.find({ _id: { $in: authorIds } }).select('_id isOfficial followers companies');
        authors.forEach(author => authorMap.set(String(author._id), author));
    }
    return posts.map(post => buildDisplayPost(post, authorMap.get(String(post.authorCharId || ''))));
}

async function getFeedPosts(limit = 50) {
    const posts = await Post.find({ isArticle: { $ne: true } }).sort({ timestamp: -1 }).limit(limit);
    return enrichPostsForDisplay(posts);
}

async function getRecentAdminLogs(limit = 18) {
    return AdminLog.find().sort({ createdAt: -1 }).limit(limit);
}

async function broadcastAdminLogs() {
    await emitToAdmins('admin_logs_data', await getRecentAdminLogs());
}

async function buildWorldTimeline(limit = 28) {
    const [posts, articles, events, logs] = await Promise.all([
        Post.find({ isArticle: { $ne: true } }).sort({ timestamp: -1 }).limit(12),
        Post.find({ isArticle: true }).sort({ isHeadline: -1, timestamp: -1 }).limit(10),
        Event.find().sort({ timestamp: -1, _id: -1 }).limit(10),
        AdminLog.find({ includeInTimeline: true }).sort({ createdAt: -1 }).limit(12)
    ]);

    const items = [
        ...posts.map(post => ({
            id: `post:${post._id}`,
            type: 'post',
            tone: post.isBreakingNews ? 'alert' : post.isAnonymous ? 'leak' : 'post',
            timestamp: post.timestamp || getObjectDate(String(post._id)),
            title: post.isBreakingNews
                ? `${post.authorName || 'Un personnage'} publie une breaking news`
                : `${post.authorName || 'Un personnage'} publie sur le réseau`,
            summary: extractTextPreview(post.content || '', 140) || 'Nouveau message sur le flux social.',
            relatedView: 'feed',
            relatedData: { postId: String(post._id) }
        })),
        ...articles.map(article => ({
            id: `article:${article._id}`,
            type: 'article',
            tone: article.urgencyLevel === 'urgent' ? 'alert' : article.isSponsored ? 'market' : 'article',
            timestamp: article.timestamp || getObjectDate(String(article._id)),
            title: extractArticleTitle(article.content || '') || 'Nouvel article de presse',
            summary: article.journalName
                ? `${article.journalName} · ${extractTextPreview(article.content || '', 140)}`
                : extractTextPreview(article.content || '', 140),
            relatedView: 'presse',
            relatedData: { articleId: String(article._id) }
        })),
        ...events.map(event => ({
            id: `event:${event._id}`,
            type: 'event',
            tone: 'event',
            timestamp: event.timestamp || getObjectDate(String(event._id)),
            title: event.evenement || 'Nouvel événement',
            summary: [event.date, event.heure].filter(Boolean).join(' · ') || 'Actualité publiée',
            relatedView: 'actualites',
            relatedData: { eventId: String(event._id) }
        })),
        ...logs.map(log => ({
            id: `log:${log._id}`,
            type: log.timelineType || 'admin',
            tone: log.timelineTone || 'admin',
            timestamp: log.createdAt || getObjectDate(String(log._id)),
            title: log.targetLabel ? `${log.targetLabel}` : log.message,
            summary: log.message,
            relatedView: log.meta?.redirectView || (log.timelineType === 'market' ? 'bourse' : null),
            relatedData: log.meta?.redirectData || (log.targetType === 'stock' && log.targetId ? { stockId: log.targetId } : null)
        }))
    ];

    return items
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
}

async function broadcastWorldTimeline() {
    io.emit('world_timeline_data', await buildWorldTimeline());
}

async function logAdminAction({ actorUser, actionType, targetType, targetId = '', targetLabel = '', message, meta = {}, includeInTimeline = false, timelineType = '', timelineTone = '' }) {
    if(!actorUser || !message) return null;
    const log = await new AdminLog({
        actorUsername: actorUser.username || '',
        actorUserId: actorUser.secretCode || '',
        actionType,
        targetType,
        targetId: targetId ? String(targetId) : '',
        targetLabel,
        message,
        meta,
        includeInTimeline,
        timelineType,
        timelineTone
    }).save();
    await broadcastAdminLogs();
    if(includeInTimeline) await broadcastWorldTimeline();
    return log;
}

io.on('connection', async (socket) => {
  
  socket.on('login_request', async ({ username, code }) => {
      try {
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);
          if (user) {
              if (user.secretCode !== code && !isAdmin) return socket.emit('login_error', "Mot de passe incorrect.");
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              const existingCode = await User.findOne({ secretCode: code });
              if(existingCode) return socket.emit('login_error', "Code déjà pris.");
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }
          await Character.updateMany({ ownerId: code }, { ownerUsername: username });
          // Générer alias Ombra persistant si absent
          if (!user.ombraAlias) {
              const num = Math.floor(Math.random() * 900) + 100;
              user.ombraAlias = `User#${num}`;
              await user.save();
          }
          onlineUsers[socket.id] = user.username;
          broadcastUserList();
          socket.emit('login_success', { username: user.username, userId: user.secretCode, isAdmin: user.isAdmin, uiTheme: user.uiTheme || 'default', ombraAlias: user.ombraAlias });
      } catch (e) { console.error(e); socket.emit('login_error', "Erreur serveur."); }
  });

  socket.on('change_username', async ({ userId, newUsername }) => {
      try {
          const existing = await User.findOne({ username: newUsername });
          if (existing) return socket.emit('username_change_error', "Pseudo pris.");
          await User.findOneAndUpdate({ secretCode: userId }, { username: newUsername });
          await Character.updateMany({ ownerId: userId }, { ownerUsername: newUsername });
          onlineUsers[socket.id] = newUsername;
          broadcastUserList();
          socket.emit('username_change_success', newUsername);
      } catch (e) { socket.emit('username_change_error', "Erreur."); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastUserList(); });

  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      socket.emit('feed_data', await getFeedPosts());
      socket.emit('world_timeline_data', await buildWorldTimeline());
      // [NOUVEAU] Envoyer alerte active si existante
      const activeAlert = await Alert.findOne({ active: true }).sort({ timestamp: -1 });
      if(activeAlert) socket.emit('alert_data', activeAlert);
      
      if(userId) {
          const myChars = await Character.find({ ownerId: userId });
          socket.emit('my_chars_data', myChars);
          const notifs = await Notification.find({ targetOwnerId: userId }).sort({ timestamp: -1 }).limit(20);
          socket.emit('notifications_data', notifs);
      }
  });

  socket.on('request_feed', async () => {
      socket.emit('feed_data', await getFeedPosts());
  });

  socket.on('request_world_timeline', async () => {
      socket.emit('world_timeline_data', await buildWorldTimeline());
  });

  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
          const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
          const charData = char.toObject(); 
          charData.postCount = postCount;
          charData.lastPosts = lastPosts;
          socket.emit('char_profile_data', charData);
      }
  });

  socket.on('create_char', async (data) => {
    const count = await Character.countDocuments({ ownerId: data.ownerId });
    if (count >= 20) return; 
    const user = await User.findOne({ secretCode: data.ownerId });
    if (user) data.ownerUsername = user.username;
    const newChar = new Character(data);
    await newChar.save();
    socket.emit('char_created_success', newChar);
  });
  
  socket.on('edit_char', async (data) => {
      const existingChar = await Character.findById(data.charId);
      if(!existingChar) return;
      const effectiveOwnerId = existingChar.ownerId || data.ownerId;
      const updateData = { 
          name: data.newName, role: data.newRole, avatar: data.newAvatar, color: data.newColor, 
          description: data.newDescription, partyName: data.partyName, partyLogo: data.partyLogo,
          partyFounder: data.partyFounder || null,
          partyCreationDate: data.partyCreationDate || null,
          partyMotto: data.partyMotto || null,
          partyDescription: data.partyDescription || null,
          isOfficial: data.isOfficial
      };
      // Sauvegarder capital, entreprises, et grade politique si fournis
      if(data.capital !== undefined) updateData.capital = Number(data.capital) || 0;
      if(data.companies !== undefined) updateData.companies = data.companies;
      if(data.politicalRole !== undefined) updateData.politicalRole = data.politicalRole;
      await Character.findByIdAndUpdate(data.charId, updateData);
      await Message.updateMany({ senderName: data.originalName, ownerId: effectiveOwnerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      await Post.updateMany({ authorName: data.originalName, ownerId: effectiveOwnerId }, { $set: { authorName: data.newName, authorRole: data.newRole, authorAvatar: data.newAvatar, authorColor: data.newColor }});
      socket.emit('my_chars_data', await Character.find({ ownerId: data.ownerId }));
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
      io.emit('reload_posts'); 
  });

  socket.on('delete_char', async (charId) => { await Character.findByIdAndDelete(charId); socket.emit('char_deleted_success', charId); });

  // [NOUVEAU] Admin ajoute une entreprise à un personnage
  socket.on('admin_add_company', async ({ charId, company }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const char = await Character.findByIdAndUpdate(
          charId,
          { $push: { companies: company } },
          { new: true }
      );
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
          const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
          const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
          io.emit('char_profile_data', charData);
      }
  });

  // [NOUVEAU] Admin supprime une entreprise d'un personnage
  socket.on('admin_remove_company', async ({ charId, companyIndex }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const char = await Character.findById(charId);
      if(!char) return;
      const removed = char.companies[companyIndex];
      char.companies.splice(companyIndex, 1);
      await char.save();
      if(removed?.name) await Stock.deleteOne({ charId: String(char._id), companyName: removed.name });
      const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
      const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
      const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
      io.emit('char_profile_data', charData);
      io.emit('char_updated', char.toObject());
      io.emit('stocks_updated', await getEnrichedStocks());
      socket.emit('admin_action_result', { success: true, msg: 'Entreprise supprimée.' });
  });

  // [NOUVEAU] Joueur modifie sa propre bio
  socket.on('update_char_bio', async ({ charId, bio, ownerId }) => {
      await Character.findOneAndUpdate({ _id: charId, ownerId: ownerId }, { description: bio });
      socket.emit('char_bio_updated', { charId, bio });
  });

  // [NOUVEAU] Admin modifie les stats (followers, likes)
  socket.on('admin_edit_followers', async ({ charId, count }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const char = await Character.findById(charId);
      if(!char) return;
      const current = char.followers.length;
      const diff = count - current;
      if(diff > 0) { for(let i=0;i<diff;i++) char.followers.push('fake_'+Date.now()+'_'+i); }
      else { char.followers = char.followers.slice(0, count < 0 ? 0 : count); }
      await char.save();
      socket.emit('char_profile_data', { ...char.toObject(), postCount: await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } }), lastPosts: [] });
      await logAdminAction({
          actorUser: user,
          actionType: 'followers_edited',
          targetType: 'character',
          targetId: String(char._id),
          targetLabel: char.name,
          message: `${user.username} a ajusté les abonnés de ${char.name} à ${Math.max(0, Number(count) || 0)}`,
          meta: { redirectView: 'profile', redirectData: { charId: String(char._id) } }
      });
  });

  socket.on('admin_edit_post_likes', async ({ postId, count }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const post = await Post.findById(postId);
      if(!post) return;
      const current = post.likes.length;
      const diff = count - current;
      if(diff > 0) { for(let i=0;i<diff;i++) post.likes.push('fake_like_'+Date.now()+'_'+i); }
      else { post.likes = post.likes.slice(0, count < 0 ? 0 : count); }
      await post.save();
      io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers companies') : null));
      await logAdminAction({
          actorUser: user,
          actionType: 'post_likes_edited',
          targetType: post.isArticle ? 'article' : 'post',
          targetId: String(post._id),
          targetLabel: post.authorName || 'Publication',
          message: `${user.username} a fixé les likes de ${post.authorName || 'une publication'} à ${Math.max(0, Number(count) || 0)}`,
          meta: { redirectView: post.isArticle ? 'presse' : 'feed', redirectData: { postId: String(post._id) } }
      });
  });

  // [NOUVEAU] Admin modifie le capital d'un personnage
  socket.on('admin_edit_capital', async ({ charId, capital }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      await Character.findByIdAndUpdate(charId, { capital: Number(capital) || 0 });
      const char = await Character.findById(charId);
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
          const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
          const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
          socket.emit('char_profile_data', charData);
          await logAdminAction({
              actorUser: user,
              actionType: 'capital_edited',
              targetType: 'character',
              targetId: String(char._id),
              targetLabel: char.name,
              message: `${user.username} a fixé le capital de ${char.name} à ${Number(capital) || 0}`,
              meta: { redirectView: 'profile', redirectData: { charId: String(char._id) } },
              includeInTimeline: true,
              timelineType: 'market',
              timelineTone: 'market'
          });
      }
  });

  // [NOUVEAU] Bandeau d'alerte global (Admin)
  socket.on('admin_set_alert', async ({ message, color, active }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      await Alert.deleteMany({});
      if(active && message) {
          const alert = new Alert({ message, color: color || 'red', active: true });
          await alert.save();
          io.emit('alert_data', alert);
          await logAdminAction({
              actorUser: user,
              actionType: 'alert_set',
              targetType: 'alert',
              targetId: String(alert._id),
              targetLabel: 'Alerte globale',
              message: `${user.username} a activé une alerte ${alert.color || 'red'}: ${message}`,
              meta: { redirectView: 'accueil', redirectData: null },
              includeInTimeline: true,
              timelineType: 'alert',
              timelineTone: 'alert'
          });
      } else {
          io.emit('alert_cleared');
          await logAdminAction({
              actorUser: user,
              actionType: 'alert_cleared',
              targetType: 'alert',
              targetLabel: 'Alerte globale',
              message: `${user.username} a retiré l'alerte globale`,
              includeInTimeline: true,
              timelineType: 'alert',
              timelineTone: 'alert'
          });
      }
  });

  // [NOUVEAU] DM entre personnages
  socket.on('send_char_dm', async (data) => {
      // data: { senderCharId, senderCharName, senderAvatar, senderColor, senderRole, targetCharId, targetCharName, targetOwnerId, ownerId, content, date }
      const roomId = `char_dm_${[data.senderCharId, data.targetCharId].sort().join('_')}`;
      const msg = new Message({
          content: data.content, type: 'text',
          senderName: data.senderCharName, senderColor: data.senderColor, senderAvatar: data.senderAvatar, senderRole: data.senderRole,
          ownerId: data.ownerId, targetName: data.targetCharName, targetOwnerId: data.targetOwnerId,
          roomId, isCharDm: true, senderCharId: data.senderCharId, targetCharId: data.targetCharId,
          date: data.date, timestamp: new Date()
      });
      const saved = await msg.save();
      const payload = saved.toObject();
    payload.senderOwnerUsername = data.senderOwnerUsername || '';
      payload.targetAvatar = data.targetAvatar || '';
      payload.targetColor = data.targetColor || '';
      payload.targetRole = data.targetRole || '';
      payload.targetOwnerUsername = data.targetOwnerUsername || '';
      const targetSockets = Object.entries(onlineUsers).filter(([,u]) => {
          return u === data.targetOwnerUsername;
      }).map(([id]) => id);
      const senderSockets = Object.entries(onlineUsers).filter(([,u]) => u === data.senderOwnerUsername).map(([id]) => id);
      [...new Set([...targetSockets, ...senderSockets])].forEach(sid => io.to(sid).emit('receive_char_dm', payload));
      await createNotification(
          data.targetOwnerId,
          'reply',
          `(${data.senderCharName}) vous a envoyé un message`,
          data.senderCharName,
          'char-mp',
          {
              myCharId: data.targetCharId,
              otherCharId: data.senderCharId,
              otherCharName: data.senderCharName,
              otherCharAvatar: data.senderAvatar || '',
              otherCharColor: data.senderColor || '',
              otherCharRole: data.senderRole || '',
              otherOwnerId: data.ownerId || '',
              otherOwnerUsername: data.senderOwnerUsername || ''
          }
      );
  });

  socket.on('request_char_dm_history', async ({ senderCharId, targetCharId }) => {
      const roomId = `char_dm_${[senderCharId, targetCharId].sort().join('_')}`;
      const msgs = await Message.find({ roomId, isCharDm: true }).sort({ timestamp: 1 }).limit(200);
      socket.emit('char_dm_history', { roomId, senderCharId, targetCharId, msgs });
  });

  // Récupérer tous les interlocuteurs d'un perso donné
  socket.on('request_my_char_convos', async ({ myCharIds }) => {
      if(!myCharIds || !myCharIds.length) return socket.emit('my_char_convos', []);
      // Chercher tous les messages impliquant n'importe lequel de mes persos
      const msgs = await Message.find({
          isCharDm: true,
          $or: [
              { senderCharId: { $in: myCharIds } },
              { targetCharId: { $in: myCharIds } }
          ]
      }).sort({ timestamp: 1 });

      // Regrouper par paire (monCharId, autreCharId) → dernière info utile
      const convMap = {}; // clé: "myCharId|otherCharId"
      const otherCharIds = new Set();
      for(const m of msgs) {
          const myId   = myCharIds.includes(String(m.senderCharId)) ? String(m.senderCharId) : String(m.targetCharId);
          const othId  = myCharIds.includes(String(m.senderCharId)) ? String(m.targetCharId) : String(m.senderCharId);
          const key    = `${myId}|${othId}`;
          otherCharIds.add(othId);
          if(!convMap[key]) {
              convMap[key] = {
                  myCharId:      myId,
                  otherCharId:   othId,
                  otherName:     myCharIds.includes(String(m.senderCharId)) ? m.targetName   : m.senderName,
                  otherAvatar:   myCharIds.includes(String(m.senderCharId)) ? (m.targetAvatar || '') : (m.senderAvatar || ''),
                  otherColor:    myCharIds.includes(String(m.senderCharId)) ? (m.targetColor  || '') : (m.senderColor  || ''),
                  otherRole:     myCharIds.includes(String(m.senderCharId)) ? (m.targetRole   || '') : (m.senderRole   || ''),
                  otherOwnerId:  myCharIds.includes(String(m.senderCharId)) ? m.targetOwnerId : m.ownerId,
                  otherOwnerUsername: myCharIds.includes(String(m.senderCharId)) ? (m.targetOwnerUsername || '') : (m.senderOwnerUsername || ''),
                  lastDate:      m.timestamp,
                  lastContent:   m.content
              };
          } else {
              convMap[key].lastDate    = m.timestamp;
              convMap[key].lastContent = m.content;
          }
      }
      const chars = await Character.find({ _id: { $in: [...otherCharIds] } }).select('_id name avatar color role ownerId ownerUsername');
      const charMap = new Map(chars.map(char => [String(char._id), char]));
      Object.values(convMap).forEach(conv => {
          const otherChar = charMap.get(String(conv.otherCharId));
          if(!otherChar) return;
          conv.otherName = otherChar.name || conv.otherName;
          conv.otherAvatar = otherChar.avatar || conv.otherAvatar;
          conv.otherColor = otherChar.color || conv.otherColor;
          conv.otherRole = otherChar.role || conv.otherRole;
          conv.otherOwnerId = otherChar.ownerId || conv.otherOwnerId;
          conv.otherOwnerUsername = otherChar.ownerUsername || conv.otherOwnerUsername;
      });
      socket.emit('my_char_convos', Object.values(convMap));
  });

  socket.on('follow_character', async ({ followerCharId, targetCharId }) => {
      const targetChar = await Character.findById(targetCharId);
      const followerChar = await Character.findById(followerCharId);
      if(!targetChar || !followerChar || String(followerChar._id) === String(targetChar._id)) return;
      const index = targetChar.followers.indexOf(followerCharId);
      if(index === -1) {
          targetChar.followers.push(followerCharId);
          await createNotification(targetChar.ownerId, 'follow', `(${followerChar.name}) vous suit désormais`, followerChar.ownerUsername, 'profile', {
              charName: followerChar.name
          });
      } 
      else { targetChar.followers.splice(index, 1); }
      await targetChar.save();
      const charData = targetChar.toObject(); charData.postCount = await Post.countDocuments({ authorCharId: targetChar._id });
      socket.emit('char_profile_updated', charData);
  });

  socket.on('get_followers_list', async (targetCharId) => {
      const char = await Character.findById(targetCharId);
      if(char && char.followers.length > 0) socket.emit('followers_list_data', await Character.find({ _id: { $in: char.followers } }).select('name avatar role ownerUsername'));
      else socket.emit('followers_list_data', []);
  });

  socket.on('create_room', async (roomData) => { await new Room(roomData).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (roomId) => { if (roomId === "global") return; await Room.findByIdAndDelete(roomId); await Message.deleteMany({ roomId: roomId }); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', roomId); });
  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  
  socket.on('request_history', async (data) => {
      const roomId = (typeof data === 'object') ? data.roomId : data;
      const requesterId = (typeof data === 'object') ? data.userId : null;
      const query = { roomId: roomId };
      if (requesterId) query.$or = [ { targetName: { $exists: false } }, { targetName: "" }, { ownerId: requesterId }, { targetOwnerId: requesterId } ];
      else query.$or = [{ targetName: { $exists: false } }, { targetName: "" }];
      socket.emit('history_data', await Message.find(query).sort({ timestamp: 1 }).limit(200));
  });
  socket.on('request_dm_history', async ({ myUsername, targetUsername }) => {
      const messages = await Message.find({ roomId: 'dm', $or: [ { senderName: myUsername, targetName: targetUsername }, { senderName: targetUsername, targetName: myUsername } ] }).sort({ timestamp: 1 });
      socket.emit('dm_history_data', { target: targetUsername, history: messages });
  });
  socket.on('request_dm_contacts', async (username) => {
      const messages = await Message.find({ roomId: 'dm', $or: [{ senderName: username }, { targetName: username }] });
      const contacts = new Set(); messages.forEach(msg => { const other = (msg.senderName === username) ? msg.targetName : msg.senderName; if(other) contacts.add(other); });
      socket.emit('dm_contacts_data', Array.from(contacts));
  });
  socket.on('dm_delete_history', async ({ userId, targetName }) => {
      await Message.deleteMany({ $or: [ { ownerId: userId, targetName: targetName }, { targetName: targetName, ownerId: userId } ] }); 
      io.emit('force_history_refresh', { roomId: 'global' }); 
  });

  socket.on('send_dm', async (data) => {
      const senderUser = await User.findOne({ username: data.sender });
      const targetUser = await User.findOne({ username: data.target });
      const newMessage = new Message({ content: data.content, type: data.type, senderName: data.sender, ownerId: senderUser ? senderUser.secretCode : null, targetName: data.target, targetOwnerId: targetUser ? targetUser.secretCode : null, roomId: 'dm', date: data.date });
      const savedMsg = await newMessage.save();
      const payload = { _id: savedMsg._id, sender: savedMsg.senderName, target: savedMsg.targetName, content: savedMsg.content, type: savedMsg.type, date: savedMsg.date };
      const targetSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.target);
      const senderSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.sender);
      [...new Set([...targetSockets, ...senderSockets])].forEach(sockId => { io.to(sockId).emit('receive_dm', payload); });
    if (targetUser) await createNotification(targetUser.secretCode, 'reply', `vous a envoyé un message privé`, data.sender, 'dm', { username: data.sender });
  });

  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    if (msgData.senderName === "Narrateur") { const user = await User.findOne({ secretCode: msgData.ownerId }); if (!user || !user.isAdmin) return; }
    if (msgData.targetName) { const targetChar = await Character.findOne({ name: msgData.targetName }).sort({_id: -1}); if (targetChar) msgData.targetOwnerId = targetChar.ownerId; }
    const savedMsg = await new Message(msgData).save();
    io.to(msgData.roomId).emit('message_rp', savedMsg);
    if (msgData.replyTo && msgData.replyTo.id) {
        const originalMsg = await Message.findById(msgData.replyTo.id);
        if (originalMsg && originalMsg.ownerId !== msgData.ownerId) await createNotification(originalMsg.ownerId, 'reply', `a répondu à votre message`, msgData.senderName, 'chat', { roomId: msgData.roomId });
    }
    // Détection des mentions @
    if (msgData.content && msgData.content.includes('@')) {
        const words = msgData.content.split(/\s+/);
        const notifiedOwners = new Set();
        let i = 0;
        while (i < words.length) {
            if (words[i].startsWith('@')) {
                for (let len = 3; len >= 1; len--) {
                    if (i + len > words.length) continue;
                    const potentialName = words.slice(i, i + len).join(' ').replace(/^@/, '').replace(/[^\wÀ-ÿ\s]/g, '').trim();
                    if (!potentialName) continue;
                    const mc = await Character.findOne({ name: new RegExp(`^${potentialName}$`, 'i') });
                    if (mc && mc.ownerId !== msgData.ownerId && !notifiedOwners.has(mc.ownerId)) {
                        await createNotification(mc.ownerId, 'mention', `(${msgData.senderName}) vous a mentionné dans le chat`, msgData.senderName, 'chat', { roomId: msgData.roomId });
                        notifiedOwners.add(mc.ownerId);
                        i += len - 1;
                        break;
                    }
                }
            }
            i++;
        }
    }
  });
  socket.on('delete_message', async (msgId) => { await Message.findByIdAndDelete(msgId); io.emit('message_deleted', msgId); });
  socket.on('edit_message', async (data) => { await Message.findByIdAndUpdate(data.id, { content: data.newContent, edited: true }); io.emit('message_updated', { id: data.id, newContent: data.newContent }); });
  socket.on('admin_clear_room', async (roomId) => { await Message.deleteMany({ roomId: roomId }); io.to(roomId).emit('history_cleared'); });

  socket.on('create_post', async (postData) => {
      const savedPost = await new Post(postData).save();
      let authorChar = postData.authorCharId ? await Character.findById(postData.authorCharId) : null;
      let displayPost = buildDisplayPost(savedPost, authorChar);
      if(displayPost.isArticle) {
          io.emit('new_article', displayPost);
      } else {
          io.emit('new_post', displayPost);
          await broadcastWorldTimeline();
      }
      
      if(authorChar && authorChar.followers.length > 0) {
          const followersChars = await Character.find({ _id: { $in: authorChar.followers } });
          const notifiedOwners = new Set();
          for(const f of followersChars) {
              if(!notifiedOwners.has(f.ownerId)) {
                  await createNotification(f.ownerId, 'follow', `(${postData.authorName}) a publié un post`, "Feed", 'feed', { postId: String(savedPost._id) });
                  notifiedOwners.add(f.ownerId);
              }
          }
      }
      // Détection des mentions @ dans les posts
      if (postData.content && postData.content.includes('@') && !postData.isAnonymous) {
          const words = postData.content.split(/\s+/);
          const notifiedOwners = new Set();
          let i = 0;
          while (i < words.length) {
              if (words[i].startsWith('@')) {
                  for (let len = 3; len >= 1; len--) {
                      if (i + len > words.length) continue;
                      const potentialName = words.slice(i, i + len).join(' ').replace(/^@/, '').replace(/[^\wÀ-ÿ\s]/g, '').trim();
                      if (!potentialName) continue;
                      const mc = await Character.findOne({ name: new RegExp(`^${potentialName}$`, 'i') });
                      if (mc && mc.ownerId !== postData.ownerId && !notifiedOwners.has(mc.ownerId)) {
                          await createNotification(mc.ownerId, 'mention', `(${postData.authorName}) vous a mentionné dans un post`, postData.authorName, 'feed', { postId: String(savedPost._id) });
                          notifiedOwners.add(mc.ownerId);
                          i += len - 1;
                          break;
                      }
                  }
              }
              i++;
          }
      }
      if(displayPost.isArticle) await broadcastWorldTimeline();
  });

  socket.on('delete_post', async (payload) => {
      const postId = typeof payload === 'string' ? payload : payload?.postId;
      const ownerId = typeof payload === 'string' ? null : payload?.ownerId;
      const post = await Post.findById(postId);
      if(!post) return;
      const requester = ownerId ? await User.findOne({ secretCode: ownerId }) : null;
      const isAdmin = !!requester?.isAdmin;
      if(post.ownerId !== ownerId && !isAdmin) return;
      await Post.findByIdAndDelete(postId);
      io.emit('post_deleted', postId);
      await broadcastWorldTimeline();
      if(isAdmin && requester) {
          await logAdminAction({
              actorUser: requester,
              actionType: 'post_deleted',
              targetType: post.isArticle ? 'article' : 'post',
              targetId: String(post._id),
              targetLabel: post.isArticle ? extractArticleTitle(post.content || '') : (post.authorName || 'Post'),
              message: `${requester.username} a supprimé ${post.isArticle ? 'un article' : 'un post'} de ${post.authorName || 'source inconnue'}`,
              meta: { redirectView: post.isArticle ? 'presse' : 'feed', redirectData: { postId: String(post._id) } },
              includeInTimeline: false
          });
      }
  });

  socket.on('edit_post', async ({ postId, content, ownerId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      if(post.ownerId !== ownerId && !(await User.findOne({ secretCode: ownerId, isAdmin: true }))) return;
      post.content = content;
      post.edited = true;
      await post.save();
      io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers companies') : null));
      await broadcastWorldTimeline();
  });

  socket.on('like_post', async ({ postId, charId }) => { 
      const post = await Post.findById(postId);
      if(!post) return;
      const index = post.likes.indexOf(charId);
      let action = 'unlike';
      if(index === -1) { post.likes.push(charId); action = 'like'; } 
      else { post.likes.splice(index, 1); }
      await post.save();
    io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers companies') : null));
      if (action === 'like' && post.ownerId) {
           const likerChar = await Character.findById(charId);
           await createNotification(post.ownerId, 'like', `(${likerChar ? likerChar.name : "Inconnu"}) a aimé votre post`, "Feed", 'feed', { postId: String(post._id) });
      }
  });

  socket.on('post_comment', async ({ postId, comment }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      comment.id = new mongoose.Types.ObjectId().toString();
      post.comments.push(comment);
      await post.save();
      io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers companies') : null));
    if (post.ownerId !== comment.ownerId) await createNotification(post.ownerId, 'reply', `(${comment.authorName}) a commenté votre post`, "Feed", 'feed', { postId: String(post._id) });
  });
  socket.on('delete_comment', async ({ postId, commentId, ownerId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      const comment = post.comments.find(c => c.id === commentId);
      if(!comment) return;
      const requester = ownerId ? await User.findOne({ secretCode: ownerId }) : null;
      const isAdmin = !!requester?.isAdmin;
      if(comment.ownerId !== ownerId && post.ownerId !== ownerId && !isAdmin) return;
      post.comments = post.comments.filter(c => c.id !== commentId);
      await post.save();
      io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers companies') : null));
      if(isAdmin && requester) {
          await logAdminAction({
              actorUser: requester,
              actionType: 'comment_deleted',
              targetType: 'comment',
              targetId: commentId,
              targetLabel: post.authorName || 'Commentaire',
              message: `${requester.username} a supprimé un commentaire sur le post de ${post.authorName || 'source inconnue'}`,
              meta: { redirectView: 'feed', redirectData: { postId: String(post._id) } }
          });
      }
  });

  socket.on('vote_poll', async ({ postId, optionIndex, charId }) => {
      const post = await Post.findById(postId);
      if(!post || !post.poll || !post.poll.options[optionIndex]) return;
      const option = post.poll.options[optionIndex];
      const voterIndex = option.voters.indexOf(charId);
      if(voterIndex === -1) option.voters.push(charId); else option.voters.splice(voterIndex, 1);
      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('admin_inject_vote', async ({ postId, optionIndex, count }) => {
      const post = await Post.findById(postId);
      if(!post || !post.poll || !post.poll.options[optionIndex]) return;
      const loopCount = count || 1;
      for (let i = 0; i < loopCount; i++) {
          const fakeId = 'injected_' + Date.now() + '_' + Math.random().toString(36).substr(2,5) + i;
          post.poll.options[optionIndex].voters.push(fakeId);
      }
      await post.save();
      io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers companies') : null));
  });
  
  socket.on('mark_notifications_read', async (userId) => { await Notification.updateMany({ targetOwnerId: userId, isRead: false }, { isRead: true }); socket.emit('notifications_read_confirmed'); });
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
  
  socket.on('save_theme', async ({ userId, theme }) => {
      await User.findOneAndUpdate({ secretCode: userId }, { uiTheme: theme });
      socket.emit('theme_saved', theme);
  });

  socket.on('typing_feed_start', (data) => { socket.broadcast.emit('display_feed_typing', data); });
  socket.on('typing_feed_stop', (data) => { socket.broadcast.emit('hide_feed_typing', data); });

  // PRESSE
  socket.on('request_presse', async () => {
      const articles = await Post.find({ isArticle: true }).sort({ isHeadline: -1, timestamp: -1 }).limit(50);
      socket.emit('presse_data', articles);
  });

  socket.on('set_headline', async ({ postId, value }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      await Post.updateMany({ isHeadline: true }, { isHeadline: false });
      if(value) await Post.findByIdAndUpdate(postId, { isHeadline: true });
      const articles = await Post.find({ isArticle: true }).sort({ isHeadline: -1, timestamp: -1 }).limit(50);
      io.emit('presse_data', articles);
      const headline = value ? await Post.findById(postId) : null;
      await logAdminAction({
          actorUser: user,
          actionType: 'headline_set',
          targetType: 'article',
          targetId: postId || '',
          targetLabel: headline ? extractArticleTitle(headline.content || '') : 'Une presse',
          message: value
              ? `${user.username} a défini une nouvelle Une: ${extractArticleTitle(headline?.content || '')}`
              : `${user.username} a retiré la Une actuelle`,
          meta: { redirectView: 'presse', redirectData: { articleId: postId } },
          includeInTimeline: true,
          timelineType: 'article',
          timelineTone: 'article'
      });
  });

  // ACTUALITÉS
  socket.on('request_events', async () => {
      const events = await Event.find().sort({ date: 1, heure: 1 });
      socket.emit('events_data', events);
  });
  socket.on('create_event', async (data) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const ev = new Event(data);
      await ev.save();
      io.emit('events_data', await Event.find().sort({ date: 1, heure: 1 }));
      await logAdminAction({
          actorUser: user,
          actionType: 'event_created',
          targetType: 'event',
          targetId: String(ev._id),
          targetLabel: ev.evenement || 'Événement',
          message: `${user.username} a publié un événement: ${ev.evenement}`,
          meta: { redirectView: 'actualites', redirectData: { eventId: String(ev._id) } },
          includeInTimeline: true,
          timelineType: 'event',
          timelineTone: 'event'
      });
  });
  socket.on('delete_event', async (id) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const event = await Event.findById(id);
      await Event.findByIdAndDelete(id);
      io.emit('events_data', await Event.find().sort({ date: 1, heure: 1 }));
      await broadcastWorldTimeline();
      if(event) {
          await logAdminAction({
              actorUser: user,
              actionType: 'event_deleted',
              targetType: 'event',
              targetId: String(event._id),
              targetLabel: event.evenement || 'Événement',
              message: `${user.username} a supprimé l'événement: ${event.evenement}`,
              meta: { redirectView: 'actualites', redirectData: { eventId: String(event._id) } }
          });
      }
  });

  // OMBRA
  socket.on('ombra_join', async ({ alias }) => {
      socket.join('ombra');
      const history = await OmbraMessage.find().sort({ timestamp: -1 }).limit(60);
      socket.emit('ombra_history', history.reverse());
  });
  socket.on('ombra_leave', () => { socket.leave('ombra'); });
  socket.on('ombra_message', async ({ alias, content, date, ownerId }) => {
      if(!alias || !content) return;
      const msg = new OmbraMessage({ alias, content, date, ownerId: ownerId || null });
      await msg.save();
      io.to('ombra').emit('ombra_message', { _id: msg._id.toString(), alias, content, date, ownerId: msg.ownerId });
  });
  socket.on('ombra_delete_message', async ({ msgId, requesterId }) => {
      const msg = await OmbraMessage.findById(msgId);
      if(!msg) return;
      const user = await User.findOne({ secretCode: requesterId });
      if(!user) return;
      if(msg.ownerId === requesterId || user.isAdmin) {
          await OmbraMessage.findByIdAndDelete(msgId);
          io.to('ombra').emit('ombra_message_deleted', msgId);
      }
  });

  // Personnages de tous les utilisateurs en ligne (pour sidebar droite)
  socket.on('request_all_chars_online', async () => {
      const onlineNames = new Set(Object.values(onlineUsers));
      const chars = await Character.find({ ownerUsername: { $in: Array.from(onlineNames) } });
      const result = chars.map(c => ({
          _id: c._id, name: c.name, avatar: c.avatar, color: c.color,
          role: c.role, ownerUsername: c.ownerUsername
      }));
      socket.emit('all_chars_online', result);
  });

  // Chercher des personnages (pour nouvelle conversation MP)
  socket.on('search_chars', async ({ query }) => {
      if(!query || query.length < 1) return socket.emit('chars_search_results', []);
      const chars = await Character.find({ name: { $regex: query, $options: 'i' } }).limit(10);
      socket.emit('chars_search_results', chars.map(c => ({
          _id: c._id, name: c.name, avatar: c.avatar, color: c.color,
          role: c.role, ownerId: c.ownerId, ownerUsername: c.ownerUsername
      })));
  });

  // ========== [CITÉS] SOCKET EVENTS ==========
  socket.on('request_cities', async () => {
      const cities = await City.find().sort({ archipel: 1, name: 1 });
      socket.emit('cities_data', cities);
  });

  socket.on('admin_update_city', async ({ cityId, president, population, baseEDC, trend, flag, customPct, capitale }) => {
      // Vérifier que l'expéditeur est admin
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      // Multiplicateurs réalistes (variations douces sur gros chiffres)
      const TREND_MULT = {
          croissance_forte: 1.015,  // +1,5 %
          croissance:       1.007,  // +0,7 %
          stable:           1.000,  // 0 %
          baisse:           0.993,  // -0,7 %
          chute:            0.985   // -1,5 %
      };

      const city = await City.findById(cityId);
      if(!city) return;

      if(president !== undefined && president !== null) city.president = president;
      if(population !== undefined && population !== null) city.population = Number(population);
      if(flag       !== undefined && flag !== null)       city.flag = flag;
      if(capitale   !== undefined)                        city.capitale = capitale || null;

      if(baseEDC !== undefined && baseEDC !== null) {
          city.baseEDC = Number(baseEDC);
          city.historyEDC.push({ value: Number(baseEDC), date: new Date() });
          if(city.historyEDC.length > 30) city.historyEDC.shift();
      }

      // Variation par tendance prédéfinie
      if(trend !== undefined && trend !== null) {
          city.trend = trend;
          const mult = TREND_MULT[trend] || 1;
          const newEDC = Math.round(city.baseEDC * mult);
          city.baseEDC = newEDC;
          city.historyEDC.push({ value: newEDC, date: new Date() });
          if(city.historyEDC.length > 30) city.historyEDC.shift();
      }

      // Variation par pourcentage personnalisé
      if(customPct !== undefined && customPct !== null) {
          const mult = 1 + (Number(customPct) / 100);
          const newEDC = Math.round(city.baseEDC * mult);
          city.baseEDC = Math.max(0, newEDC);
          city.historyEDC.push({ value: city.baseEDC, date: new Date() });
          if(city.historyEDC.length > 30) city.historyEDC.shift();
      }

      city.updatedAt = new Date();
      await city.save();
      socket.emit('city_save_success');

      const cities = await City.find().sort({ archipel: 1, name: 1 });
      io.emit('cities_data', cities);
  });
  // ========== [FIN CITÉS SOCKET] ==========

  // ========== [DIPLOMATIE] SOCKET EVENTS ==========
  socket.on('request_city_relations', async () => {
      const relations = await CityRelation.find()
          .populate('cityA', 'name flag archipel')
          .populate('cityB', 'name flag archipel')
          .sort({ updatedAt: -1 });
      socket.emit('city_relations_data', relations);
  });

  socket.on('admin_upsert_city_relation', async ({ relationId, cityAId, cityBId, status, description, initiatedBy, since }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      if(!cityAId || !cityBId || cityAId === cityBId) return;

      // Normaliser l'ordre pour garantir l'unicité bidirectionnelle
      const [idA, idB] = [cityAId, cityBId].sort();

      let rel;
      if(relationId) {
          rel = await CityRelation.findById(relationId);
          if(!rel) return;
      } else {
          rel = await CityRelation.findOne({
              $or: [
                  { cityA: idA, cityB: idB },
                  { cityA: idB, cityB: idA }
              ]
          });
          if(!rel) rel = new CityRelation({ cityA: idA, cityB: idB });
      }

      rel.cityA        = idA;
      rel.cityB        = idB;
      rel.status       = status || 'neutre';
      rel.description  = description || '';
      rel.initiatedBy  = initiatedBy || '';
      if(since) rel.since = new Date(since);

      await rel.save();

      const relations = await CityRelation.find()
          .populate('cityA', 'name flag archipel')
          .populate('cityB', 'name flag archipel')
          .sort({ updatedAt: -1 });
      io.emit('city_relations_data', relations);
  });

  socket.on('admin_delete_city_relation', async ({ relationId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      await CityRelation.findByIdAndDelete(relationId);

      const relations = await CityRelation.find()
          .populate('cityA', 'name flag archipel')
          .populate('cityB', 'name flag archipel')
          .sort({ updatedAt: -1 });
      io.emit('city_relations_data', relations);
  });
  // ========== [FIN DIPLOMATIE SOCKET] ==========

  // ========== [BOURSE] SOCKET EVENTS ==========
  socket.on('request_stocks', async () => {
      const enriched = await getEnrichedStocks();
      socket.emit('stocks_data', enriched);
  });

  socket.on('request_all_chars_companies', async () => {
      const chars = await Character.find({ 'companies.0': { $exists: true } }).select('_id name color companies');
      const result = chars.map(c => ({
          charId: String(c._id),
          charName: c.name,
          charColor: c.color,
          companies: (c.companies || []).map(co => ({ name: co.name, logo: co.logo || '' }))
      }));
      socket.emit('all_chars_companies', result);
  });

  socket.on('request_admin_companies', async () => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const [chars, stocks] = await Promise.all([
          Character.find({ 'companies.0': { $exists: true } }).select('_id name color companies ownerUsername'),
          Stock.find().select('_id charId companyName currentValue stockColor updatedAt')
      ]);
      const stockMap = new Map(stocks.map(s => [`${String(s.charId)}::${s.companyName}`, s]));
      const result = chars.flatMap(char => (char.companies || []).map((company, index) => {
          const stock = stockMap.get(`${String(char._id)}::${company.name}`);
          return {
              charId: String(char._id),
              charName: char.name,
              charColor: char.color,
              ownerUsername: char.ownerUsername || '',
              companyIndex: index,
              company: {
                  name: company.name || '',
                  logo: company.logo || '',
                  role: company.role || '',
                  description: company.description || '',
                  headquarters: company.headquarters || '',
                  revenue: Number(company.revenue) || 0
              },
              stock: stock ? {
                  stockId: String(stock._id),
                  currentValue: Number(stock.currentValue) || 0,
                  stockColor: stock.stockColor || '#6c63ff',
                  updatedAt: stock.updatedAt || null
              } : null
          };
      }));
      socket.emit('admin_companies_data', result);
  });

  socket.on('admin_save_stock', async ({ stockId, companyName, companyLogo, charId, charName, charColor, stockColor, currentValue, description, headquarters }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const isCreation = !stockId;
      let stock = stockId ? await Stock.findById(stockId) : null;
      if(!stock) stock = await Stock.findOne({ companyName, charId });
      if(!stock) {
          stock = new Stock({ companyName, companyLogo, charId, charName, charColor, stockColor: stockColor || '#6c63ff', currentValue: Number(currentValue) || 0, description, headquarters });
          // Premier point d'historique à la création seulement
          stock.history.push({ value: Number(currentValue) || 0 });
      } else {
          if(companyName)  stock.companyName  = companyName;
          if(companyLogo !== undefined) stock.companyLogo = companyLogo;
          if(charId)       stock.charId       = charId;
          if(charName)     stock.charName     = charName;
          if(charColor)    stock.charColor    = charColor;
          stock.stockColor   = stockColor || stock.stockColor;
          const oldVal = stock.currentValue;
          stock.currentValue = Number(currentValue) || 0;
          // Ne pas pousser à l'historique ici — le bouton Jour suivant le fera
          if(description !== undefined) stock.description = description;
          if(headquarters !== undefined) stock.headquarters = headquarters;
          await applyStockValueChange(stock, oldVal, stock.currentValue);
      }
      stock.updatedAt = new Date();
      await stock.save();
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
      await logAdminAction({
          actorUser: user,
          actionType: isCreation ? 'stock_created' : 'stock_updated',
          targetType: 'stock',
          targetId: String(stock._id),
          targetLabel: stock.companyName || companyName || 'Action',
          message: `${user.username} a ${isCreation ? 'coté' : 'mis à jour'} l'action ${stock.companyName || companyName}`,
          meta: { redirectView: 'bourse', redirectData: { stockId: String(stock._id) } },
          includeInTimeline: true,
          timelineType: 'market',
          timelineTone: 'market'
      });
  });

  socket.on('admin_apply_stock_trend', async ({ stockId, trend }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const TREND_RANGES = {
          croissance_forte: [1.3, 1.6],
          croissance:       [0.5, 0.9],
          stable:           [-0.1, 0.1],
          baisse:           [-0.9, -0.5],
          chute:            [-1.6, -1.2]
      };
      const stock = await Stock.findById(stockId);
      if(!stock) return;
      stock.trend = trend;
      const oldTrendVal = stock.currentValue;
      const range = TREND_RANGES[trend] || [0, 0];
      const randPct = parseFloat((range[0] + Math.random() * (range[1] - range[0])).toFixed(2));
      const mult = 1 + randPct / 100;
      const newVal = Math.round(stock.currentValue * mult * 100) / 100;
      stock.currentValue = newVal;
      // Ne pas pousser à l'historique ici — le bouton Jour suivant le fera
      stock.updatedAt = new Date();
      await stock.save();
      await applyStockValueChange(stock, oldTrendVal, newVal);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
      await logAdminAction({
          actorUser: user,
          actionType: 'stock_trend_applied',
          targetType: 'stock',
          targetId: String(stock._id),
          targetLabel: stock.companyName || 'Action',
          message: `${user.username} a appliqué la tendance ${trend} à ${stock.companyName || 'une action'} (${oldTrendVal} → ${newVal})`,
          meta: { redirectView: 'bourse', redirectData: { stockId: String(stock._id) }, trend, oldValue: oldTrendVal, newValue: newVal },
          includeInTimeline: true,
          timelineType: 'market',
          timelineTone: newVal >= oldTrendVal ? 'up' : 'down'
      });
  });

  socket.on('admin_apply_stock_custom', async ({ stockId, pct }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const stock = await Stock.findById(stockId);
      if(!stock) return;
      const oldCustomVal = stock.currentValue;
      const mult = 1 + (Number(pct) / 100);
      const newVal = Math.max(0, Math.round(stock.currentValue * mult * 100) / 100);
      stock.currentValue = newVal;
      // Ne pas pousser à l'historique ici — le bouton Jour suivant le fera
      stock.updatedAt = new Date();
      await stock.save();
      await applyStockValueChange(stock, oldCustomVal, newVal);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
      await logAdminAction({
          actorUser: user,
          actionType: 'stock_custom_applied',
          targetType: 'stock',
          targetId: String(stock._id),
          targetLabel: stock.companyName || 'Action',
          message: `${user.username} a appliqué ${Number(pct).toFixed(2)}% à ${stock.companyName || 'une action'}`,
          meta: { redirectView: 'bourse', redirectData: { stockId: String(stock._id) }, pct, oldValue: oldCustomVal, newValue: newVal },
          includeInTimeline: true,
          timelineType: 'market',
          timelineTone: newVal >= oldCustomVal ? 'up' : 'down'
      });
  });

  socket.on('admin_delete_stock', async ({ stockId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const stock = await Stock.findById(stockId);
      await Stock.findByIdAndDelete(stockId);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
      if(stock) {
          await logAdminAction({
              actorUser: user,
              actionType: 'stock_deleted',
              targetType: 'stock',
              targetId: String(stock._id),
              targetLabel: stock.companyName || 'Action',
              message: `${user.username} a supprimé l'action ${stock.companyName || ''}`,
              meta: { redirectView: 'bourse', redirectData: { stockId: String(stock._id) } }
          });
      }
  });

  socket.on('admin_reset_stock_history', async ({ stockId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const stock = await Stock.findById(stockId);
      if(!stock) return;
      stock.history = [{ value: stock.currentValue, date: new Date() }];
      stock.updatedAt = new Date();
      await stock.save();
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
      await logAdminAction({
          actorUser: user,
          actionType: 'stock_history_reset',
          targetType: 'stock',
          targetId: String(stock._id),
          targetLabel: stock.companyName || 'Action',
          message: `${user.username} a réinitialisé l'historique de ${stock.companyName || 'une action'}`,
          meta: { redirectView: 'bourse', redirectData: { stockId: String(stock._id) } }
      });
  });

  // Boost bourse via publication pub (Feed / Presse)
  socket.on('pub_boost_stock', async ({ stockId }) => {
      if(!stockId) return;
      const stock = await Stock.findById(stockId).catch(() => null);
      if(!stock) return;
      const oldPubVal = stock.currentValue;
      const pct = parseFloat((0.1 + Math.random() * 0.4).toFixed(2)); // 0.10 – 0.50%
      const mult = 1 + pct / 100;
      const newVal = Math.round(stock.currentValue * mult * 100) / 100;
      stock.currentValue = newVal;
      // Ne pas pousser à l'historique ici — le bouton Jour suivant le fera
      stock.updatedAt = new Date();
      await stock.save();
      await applyStockValueChange(stock, oldPubVal, newVal);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
  });

  // Jour suivant — commit de tous les currentValues vers l'historique
  socket.on('admin_next_trading_day', async () => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const allStocks = await Stock.find();
      const now = new Date();
      for(const stock of allStocks) {
          stock.history.push({ value: stock.currentValue, date: now });
          if(stock.history.length > 30) stock.history.shift();
          stock.updatedAt = now;
          await stock.save();
      }
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
      await logAdminAction({
          actorUser: user,
          actionType: 'trading_day_advanced',
          targetType: 'market',
          targetLabel: 'Bourse de ConvSmos',
          message: `${user.username} a validé le jour de cotation suivant pour ${allStocks.length} action(s)`,
          meta: { redirectView: 'bourse', redirectData: null, stockCount: allStocks.length },
          includeInTimeline: true,
          timelineType: 'market',
          timelineTone: 'market'
      });
  });

  // Admin — définir le chiffre d'affaires d'une entreprise
  socket.on('admin_set_company_revenue', async ({ charId, companyName, revenue }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const char = await Character.findById(charId);
      if(!char) return;
      const idx = char.companies ? char.companies.findIndex(co => co.name === companyName) : -1;
      if(idx < 0) return;
      char.companies[idx].revenue = Math.max(0, Number(revenue) || 0);
      char.markModified('companies');
      await char.save();
      io.emit('char_updated', char.toObject());
      const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
      const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
      const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
      io.emit('char_profile_data', charData);
      const stocksRefresh = await getEnrichedStocks();
      io.emit('stocks_updated', stocksRefresh);
      await logAdminAction({
          actorUser: user,
          actionType: 'company_revenue_set',
          targetType: 'company',
          targetId: String(char._id),
          targetLabel: companyName,
          message: `${user.username} a fixé le chiffre d'affaires de ${companyName} à ${Math.max(0, Number(revenue) || 0)}`,
          meta: { redirectView: 'bourse', redirectData: { stockId: stocksRefresh.find(stock => String(stock.charId) === String(char._id) && stock.companyName === companyName)?._id || null } },
          includeInTimeline: true,
          timelineType: 'market',
          timelineTone: 'market'
      });
  });

  socket.on('admin_update_company', async ({ charId, companyIndex, company, oldCompanyName }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const char = await Character.findById(charId);
      if(!char || !Array.isArray(char.companies) || companyIndex < 0 || companyIndex >= char.companies.length) {
          socket.emit('admin_action_result', { success: false, error: 'Entreprise introuvable.' });
          return;
      }
      const nextCompany = {
          name: (company?.name || '').trim(),
          logo: company?.logo || '',
          role: company?.role || '',
          description: company?.description || '',
          headquarters: company?.headquarters || '',
          revenue: Math.max(0, Number(company?.revenue) || 0)
      };
      if(!nextCompany.name) {
          socket.emit('admin_action_result', { success: false, error: 'Nom de l\'entreprise requis.' });
          return;
      }
      const previousName = oldCompanyName || char.companies[companyIndex].name;
      char.companies[companyIndex] = nextCompany;
      char.markModified('companies');
      await char.save();

      const stock = await Stock.findOne({ charId: String(char._id), companyName: previousName });
      if(stock) {
          stock.companyName = nextCompany.name;
          stock.companyLogo = nextCompany.logo || '';
          stock.headquarters = nextCompany.headquarters || null;
          stock.updatedAt = new Date();
          await stock.save();
      }

      io.emit('char_updated', char.toObject());
      const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
      const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
      const charData = char.toObject();
      charData.postCount = postCount;
      charData.lastPosts = lastPosts;
      io.emit('char_profile_data', charData);
      io.emit('stocks_updated', await getEnrichedStocks());
      socket.emit('admin_action_result', { success: true, msg: 'Entreprise mise à jour.' });
      await logAdminAction({
          actorUser: user,
          actionType: 'company_updated',
          targetType: 'company',
          targetId: String(char._id),
          targetLabel: nextCompany.name,
          message: `${user.username} a mis à jour l'entreprise ${nextCompany.name} de ${char.name}`,
          meta: { redirectView: 'bourse', redirectData: null },
          includeInTimeline: true,
          timelineType: 'market',
          timelineTone: 'market'
      });
  });
  // ========== [FIN BOURSE SOCKET] ==========
  // ========== [WIKI] SOCKET EVENTS ==========
  socket.on('request_wiki_pages', async () => {
      const pages = await WikiPage.find().sort({ category: 1, createdAt: -1 });
      socket.emit('wiki_pages_data', pages);
  });

  socket.on('create_wiki_page', async ({ title, category, content, coverImage, authorName }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const page = new WikiPage({ title, category: category || 'histoire', content, coverImage: coverImage || null, authorName: authorName || user.username });
      await page.save();
      const pages = await WikiPage.find().sort({ category: 1, createdAt: -1 });
      io.emit('wiki_pages_data', pages);
  });

  socket.on('edit_wiki_page', async ({ pageId, title, category, content, coverImage }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const update = { updatedAt: new Date() };
      if(title !== undefined) update.title = title;
      if(category !== undefined) update.category = category;
      if(content !== undefined) update.content = content;
      if(coverImage !== undefined) update.coverImage = coverImage;
      await WikiPage.findByIdAndUpdate(pageId, update);
      const pages = await WikiPage.find().sort({ category: 1, createdAt: -1 });
      io.emit('wiki_pages_data', pages);
  });

  socket.on('delete_wiki_page', async ({ pageId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      await WikiPage.findByIdAndDelete(pageId);
      const pages = await WikiPage.find().sort({ category: 1, createdAt: -1 });
      io.emit('wiki_pages_data', pages);
  });
  // ========== [FIN WIKI SOCKET] ==========

  // ========== [ADMIN PANEL] SOCKET EVENTS ==========
  socket.on('request_admin_stats', async () => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const [userCount, charCount, postCount, articleCount, msgCount, roomCount] = await Promise.all([
          User.countDocuments(),
          Character.countDocuments(),
          Post.countDocuments({ isArticle: { $ne: true } }),
          Post.countDocuments({ isArticle: true }),
          Message.countDocuments({ roomId: { $nin: ['dm'] }, isCharDm: { $ne: true } }),
          Room.countDocuments()
      ]);
      const onlineUsersList = [...new Set(Object.values(onlineUsers))].sort((a, b) => a.localeCompare(b, 'fr'));
      socket.emit('admin_stats_data', {
          userCount, charCount, postCount, articleCount, msgCount, roomCount,
          onlineCount: Object.keys(onlineUsers).length,
          onlineUsers: onlineUsersList
      });
  });

  socket.on('request_admin_logs', async () => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      socket.emit('admin_logs_data', await getRecentAdminLogs());
  });

  socket.on('admin_get_users', async () => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const users = await User.find({}, 'username isAdmin createdAt secretCode').sort({ username: 1 });
      const chars = await Character.find({ ownerId: { $in: users.map(u => u.secretCode) } }).select('name role ownerId avatar color');
      const charsByOwner = new Map();
      chars.forEach(char => {
          const key = char.ownerId || '';
          if(!charsByOwner.has(key)) charsByOwner.set(key, []);
          charsByOwner.get(key).push({
              _id: String(char._id),
              name: char.name,
              role: char.role || '',
              avatar: char.avatar || '',
              color: char.color || ''
          });
      });
      socket.emit('admin_users_data', users.map(u => ({
          _id: String(u._id),
          username: u.username,
          isAdmin: !!u.isAdmin,
          createdAt: u.createdAt,
          characters: charsByOwner.get(u.secretCode) || []
      })));
  });

  socket.on('admin_set_admin', async ({ targetUsername, targetUserId, value, makeAdmin }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const target = targetUserId
          ? await User.findById(targetUserId)
          : await User.findOne({ username: targetUsername });
      if(!target) {
          socket.emit('admin_action_result', { success: false, error: 'Utilisateur introuvable.' });
          return;
      }
      if(target.username === username) {
          socket.emit('admin_action_result', { success: false, error: 'Impossible de modifier votre propre rôle admin.' });
          return;
      }
      target.isAdmin = typeof makeAdmin === 'boolean' ? makeAdmin : !!value;
      await target.save();
      socket.emit('admin_action_result', { success: true });
      const users = await User.find({}, 'username isAdmin createdAt').sort({ username: 1 });
      socket.emit('admin_users_data', users);
      await logAdminAction({
          actorUser: user,
          actionType: target.isAdmin ? 'admin_granted' : 'admin_revoked',
          targetType: 'user',
          targetId: String(target._id),
          targetLabel: target.username,
          message: `${user.username} a ${target.isAdmin ? 'accordé' : 'retiré'} les droits admin à ${target.username}`,
          meta: { redirectView: 'admin', redirectData: { userId: String(target._id) } }
      });
  });

  socket.on('admin_delete_user', async ({ targetUsername, targetUserId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const target = targetUserId
          ? await User.findById(targetUserId)
          : await User.findOne({ username: targetUsername });
      if(!target) {
          socket.emit('admin_action_result', { success: false, error: 'Utilisateur introuvable.' });
          return;
      }
      if(target.username === username) {
          socket.emit('admin_action_result', { success: false, error: 'Impossible de supprimer votre propre compte.' });
          return;
      }
      // Remove user's characters
      await Character.deleteMany({ ownerId: target.secretCode });
      await User.deleteOne({ _id: target._id });
      socket.emit('admin_action_result', { success: true, msg: `Utilisateur "${target.username}" supprimé.` });
      const users = await User.find({}, 'username isAdmin createdAt').sort({ username: 1 });
      socket.emit('admin_users_data', users);
      await logAdminAction({
          actorUser: user,
          actionType: 'user_deleted',
          targetType: 'user',
          targetId: String(target._id),
          targetLabel: target.username,
          message: `${user.username} a supprimé l'utilisateur ${target.username}`,
          meta: { redirectView: 'admin', redirectData: null }
      });
  });

  socket.on('admin_clear_all_posts', async () => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      await Post.deleteMany({ isArticle: { $ne: true } });
      io.emit('reload_posts');
      socket.emit('admin_action_result', { success: true, msg: 'Tous les posts supprimés.' });
      await broadcastWorldTimeline();
      await logAdminAction({
          actorUser: user,
          actionType: 'posts_cleared',
          targetType: 'feed',
          targetLabel: 'Flux social',
          message: `${user.username} a vidé tout le flux social`,
          meta: { redirectView: 'feed', redirectData: null }
      });
  });
  // ========== [FIN ADMIN PANEL SOCKET] ==========
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
