module.exports = function initSocketHandlers(deps) {
  const {
    io,
    mongoose,
    ADMIN_CODE,
    MESSAGE_ARCHIVE_PAGE_SIZE,
    User,
    Character,
    Alert,
    Message,
    MessageArchive,
    Room,
    Post,
    OmbraMessage,
    Event,
    Notification,
    AdminLog,
    City,
    CityRelation,
    PartyRelation,
    MixedRelation,
    MapMarker,
    MapOverlay,
    Stock,
    WikiPage,
    onlineUsers,
    getRecentMessages,
    getMessagePage,
    getLatestCharConversations,
    getArchivedCharDmPage,
    getFeedPosts,
    buildWorldTimeline,
    getSocketUser,
    logAdminAction,
    buildDisplayPost,
    buildAutoLikeCountDisplay,
    getEnrichedStocks,
    createNotification,
    extractArticleTitle,
    broadcastWorldTimeline,
    broadcastCosmosTension,
    broadcastAdminLogs,
    getRecentAdminLogs,
    buildCosmosTension,
    applyStockValueChange,
        syncCharacterStocksWithCompanies,
        syncCharacterCompanyFromStock,
    broadcastUserList
  } = deps;

        async function getCharacterProfilePosts(charId) {
            if(!charId) return [];
            return Post.find({ authorCharId: charId, isArticle: { $ne: true }, isLiveNews: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 });
        }

    const LIVE_NEWS_LIMIT = 5;

    function isJournalistCharacter(char) {
        const role = String(char?.role || '').toLowerCase();
        return role.includes('journaliste') || role.includes('presse');
    }

    async function getLiveNewsArticles() {
        return Post.find({ isLiveNews: true }).sort({ timestamp: -1 }).limit(LIVE_NEWS_LIMIT);
    }

    async function broadcastLiveNews() {
        io.emit('live_news_data', await getLiveNewsArticles());
    }

    async function trimLiveNewsOverflow() {
        const overflowItems = await Post.find({ isLiveNews: true })
            .sort({ timestamp: -1, _id: -1 })
            .skip(LIVE_NEWS_LIMIT)
            .select('_id');
        if(!overflowItems.length) return;
        await Post.deleteMany({ _id: { $in: overflowItems.map(item => item._id) } });
    }

    async function emitCharacterProfileData(char) {
            if(!char?._id) return;
            const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true }, isLiveNews: { $ne: true } });
            const lastPosts = await getCharacterProfilePosts(char._id);
            const charData = char.toObject();
            charData.postCount = postCount;
            charData.lastPosts = lastPosts;
            io.emit('char_profile_data', charData);
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
              if(existingCode) return socket.emit('login_error', "Code dÃ©jÃ  pris.");
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }
          await Character.updateMany({ ownerId: code }, { ownerUsername: username });
          // GÃ©nÃ©rer alias Ombra persistant si absent
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
      socket.emit('live_news_data', await getLiveNewsArticles());
      socket.emit('cosmos_tension_data', await buildCosmosTension());
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

  socket.on('request_live_news', async () => {
      socket.emit('live_news_data', await getLiveNewsArticles());
  });

  socket.on('request_cosmos_tension', async () => {
      socket.emit('cosmos_tension_data', await buildCosmosTension());
  });

  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true }, isLiveNews: { $ne: true } });
          const lastPosts = await getCharacterProfilePosts(char._id);
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
      const previousCompanies = Array.isArray(existingChar.companies)
          ? existingChar.companies.map(company => (company?.toObject ? company.toObject() : { ...company }))
          : [];
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
      const updatedChar = await Character.findByIdAndUpdate(data.charId, updateData, { new: true });
      await Message.updateMany({ senderName: data.originalName, ownerId: effectiveOwnerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      await Post.updateMany({ authorName: data.originalName, ownerId: effectiveOwnerId }, { $set: { authorName: data.newName, authorRole: data.newRole, authorAvatar: data.newAvatar, authorColor: data.newColor }});
      if(updatedChar) {
          await syncCharacterStocksWithCompanies(updatedChar, previousCompanies);
          io.emit('char_updated', updatedChar.toObject());
          io.emit('stocks_updated', await getEnrichedStocks());
      }
      socket.emit('my_chars_data', await Character.find({ ownerId: data.ownerId }));
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
      io.emit('reload_posts'); 
  });

  socket.on('delete_char', async (charId) => { await Character.findByIdAndDelete(charId); socket.emit('char_deleted_success', charId); });

  // [NOUVEAU] Admin ajoute une entreprise Ã  un personnage
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
          io.emit('char_updated', char.toObject());
          await emitCharacterProfileData(char);
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
      await emitCharacterProfileData(char);
      io.emit('char_updated', char.toObject());
      io.emit('stocks_updated', await getEnrichedStocks());
      socket.emit('admin_action_result', { success: true, msg: 'Entreprise supprimÃ©e.' });
  });

  // [NOUVEAU] Joueur modifie sa propre bio
  socket.on('update_char_bio', async ({ charId, bio, ownerId }) => {
      await Character.findOneAndUpdate({ _id: charId, ownerId: ownerId }, { description: bio });
      socket.emit('char_bio_updated', { charId, bio });
  });

  const parseCompactCountValue = (value) => {
      if(typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
      const rawValue = String(value ?? '').trim().toLowerCase();
      if(!rawValue) return NaN;
      const compact = rawValue.replace(/\s+/g, '');
      if(/^\d+(?:[.,]\d+)?$/.test(compact)) return Math.max(0, Math.floor(Number(compact.replace(',', '.'))));
      const factors = { k: 1e3, m: 1e6, b: 1e9 };
      const matches = compact.match(/\d+(?:[.,]\d+)?[kmb]?/g);
      if(!matches || matches.join('') !== compact) return NaN;
      const total = matches.reduce((sum, token) => {
          const match = token.match(/^(\d+(?:[.,]\d+)?)([kmb])?$/);
          if(!match) return NaN;
          const amount = Number(match[1].replace(',', '.'));
          return Number.isFinite(amount) ? sum + (amount * (factors[match[2]] || 1)) : NaN;
      }, 0);
      return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : NaN;
  };

  const formatCompactCountLabel = (value) => {
      const safeValue = Math.max(0, Number(value) || 0);
      if(safeValue < 1000) return String(Math.floor(safeValue));
      const units = [
          { suffix: 'B', value: 1e9 },
          { suffix: 'M', value: 1e6 },
          { suffix: 'K', value: 1e3 }
      ];
      for(const unit of units) {
          if(safeValue >= unit.value) {
              const scaled = safeValue / unit.value;
              const digits = scaled >= 100 ? 0 : 1;
              return `${scaled.toFixed(digits).replace(/\.0$/, '')}${unit.suffix}`;
          }
      }
      return String(Math.floor(safeValue));
  };

  const normalizeAdminCountLabel = (value) => {
      const parsed = parseCompactCountValue(value);
      if(!Number.isFinite(parsed)) return '';
      return formatCompactCountLabel(parsed);
  };

  const getValidFollowerIds = (followers) => {
      if(!Array.isArray(followers)) return [];
      return followers.filter(followerId => mongoose.Types.ObjectId.isValid(followerId));
  };

  const cleanupCharacterFollowers = async (char) => {
      if(!char || !Array.isArray(char.followers)) return [];
      const validFollowerIds = getValidFollowerIds(char.followers);
      if(validFollowerIds.length !== char.followers.length) {
          char.followers = validFollowerIds;
          await char.save();
      }
      return validFollowerIds;
  };

  // [NOUVEAU] Admin modifie les stats (followers, likes)
  socket.on('admin_edit_followers', async ({ charId, count, countDisplay }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const char = await Character.findById(charId);
      if(!char) return;
      const storedLabel = normalizeAdminCountLabel(countDisplay ?? count);
      if(!storedLabel) return;
      char.followerCountDisplay = storedLabel;
      await char.save();
      socket.emit('char_profile_data', { ...char.toObject(), postCount: await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true }, isLiveNews: { $ne: true } }), lastPosts: await getCharacterProfilePosts(char._id) });
      await logAdminAction({
          actorUser: user,
          actionType: 'followers_edited',
          targetType: 'character',
          targetId: String(char._id),
          targetLabel: char.name,
          message: `${user.username} a ajustÃ© les abonnÃ©s de ${char.name} Ã  ${storedLabel}`,
          meta: { redirectView: 'profile', redirectData: { charId: String(char._id) } }
      });
  });

  socket.on('admin_edit_post_likes', async ({ postId, count, countDisplay }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const post = await Post.findById(postId);
      if(!post) return;
      const storedLabel = normalizeAdminCountLabel(countDisplay ?? count);
      if(!storedLabel) return;
      post.likeCountDisplay = storedLabel;
      await post.save();
	  io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers followerCountDisplay companies') : null));
      await logAdminAction({
          actorUser: user,
          actionType: 'post_likes_edited',
          targetType: post.isArticle ? 'article' : 'post',
          targetId: String(post._id),
          targetLabel: post.authorName || 'Publication',
          message: `${user.username} a fixÃ© les likes de ${post.authorName || 'une publication'} Ã  ${storedLabel}`,
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
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true }, isLiveNews: { $ne: true } });
          const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isLiveNews: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
          const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
          socket.emit('char_profile_data', charData);
          await logAdminAction({
              actorUser: user,
              actionType: 'capital_edited',
              targetType: 'character',
              targetId: String(char._id),
              targetLabel: char.name,
              message: `${user.username} a fixÃ© le capital de ${char.name} Ã  ${Number(capital) || 0}`,
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
              message: `${user.username} a activÃ© une alerte ${alert.color || 'red'}: ${message}`,
              meta: { redirectView: 'accueil', redirectData: null },
              includeInTimeline: true,
              timelineType: 'alert',
              timelineTone: 'alert'
          });
          await broadcastCosmosTension();
      } else {
          io.emit('alert_cleared');
          await logAdminAction({
              actorUser: user,
              actionType: 'alert_cleared',
              targetType: 'alert',
              targetLabel: 'Alerte globale',
              message: `${user.username} a retirÃ© l'alerte globale`,
              includeInTimeline: true,
              timelineType: 'alert',
              timelineTone: 'alert'
          });
          await broadcastCosmosTension();
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
          `(${data.senderCharName}) vous a envoyÃ© un message`,
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

  socket.on('archive_char_dm_conversation', async ({ senderCharId, targetCharId }) => {
      if(!senderCharId || !targetCharId) return;
      const user = await getSocketUser(socket);
      if(!user) return;
      const [senderChar, targetChar] = await Promise.all([
          Character.findById(senderCharId).select('_id ownerId ownerUsername'),
          Character.findById(targetCharId).select('_id ownerId ownerUsername')
      ]);
      if(!senderChar || !targetChar) return;
      const ownsConversation = user.isAdmin || senderChar.ownerId === user.secretCode || targetChar.ownerId === user.secretCode;
      if(!ownsConversation) return;

      const roomId = `char_dm_${[senderCharId, targetCharId].sort().join('_')}`;
      const liveMessages = await Message.find({ roomId, isCharDm: true }).sort({ timestamp: 1 }).lean();
      if(!liveMessages.length) {
          socket.emit('char_dm_archived', { senderCharId: String(senderCharId), targetCharId: String(targetCharId), archivedCount: 0 });
          return;
      }

      const archiveStamp = new Date();
      const archiveOperations = liveMessages.map(({ _id, ...message }) => ({
          updateOne: {
              filter: { originalMessageId: String(_id) },
              update: {
                  $setOnInsert: {
                      ...message,
                      originalMessageId: String(_id),
                      archivedAt: archiveStamp
                  }
              },
              upsert: true
          }
      }));

      await MessageArchive.bulkWrite(archiveOperations, { ordered: false });
      await Message.deleteMany({ _id: { $in: liveMessages.map(message => message._id) } });

      const usernames = [senderChar.ownerUsername, targetChar.ownerUsername].filter(Boolean);
      const targetSockets = Object.entries(onlineUsers)
          .filter(([, username]) => usernames.includes(username))
          .map(([socketId]) => socketId);
      const payload = {
          senderCharId: String(senderCharId),
          targetCharId: String(targetCharId),
          archivedCount: liveMessages.length
      };
      [...new Set(targetSockets)].forEach(socketId => io.to(socketId).emit('char_dm_archived', payload));
      if(!targetSockets.length) socket.emit('char_dm_archived', payload);
  });

  socket.on('request_char_dm_history', async ({ senderCharId, targetCharId, page = 0, pageSize = 20 }) => {
      const roomId = `char_dm_${[senderCharId, targetCharId].sort().join('_')}`;
      const result = await getMessagePage({ roomId, isCharDm: true }, page, pageSize);
      socket.emit('char_dm_history', {
          roomId,
          senderCharId,
          targetCharId,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: result.hasMore,
          msgs: result.items
      });
  });

  socket.on('request_archived_char_convos', async ({ myCharIds }) => {
      if(!myCharIds || !myCharIds.length) return socket.emit('archived_char_convos', []);
      const convos = await getLatestCharConversations(MessageArchive, myCharIds);
      const otherCharIds = [...new Set(convos.map(conv => String(conv.otherCharId)).filter(Boolean))];
      const chars = await Character.find({ _id: { $in: otherCharIds } }).select('_id name avatar color role ownerId ownerUsername');
      const charMap = new Map(chars.map(char => [String(char._id), char]));
      const enriched = convos.map(conv => {
          const otherChar = charMap.get(String(conv.otherCharId));
          return {
              myCharId: conv.myCharId,
              otherCharId: conv.otherCharId,
              otherName: otherChar?.name || conv.otherName || 'Inconnu',
              otherAvatar: otherChar?.avatar || '',
              otherColor: otherChar?.color || '',
              otherRole: otherChar?.role || '',
              otherOwnerId: otherChar?.ownerId || conv.otherOwnerId || '',
              otherOwnerUsername: otherChar?.ownerUsername || '',
              lastDate: conv.lastDate,
              lastContent: conv.lastContent || ''
          };
      });
      socket.emit('archived_char_convos', enriched);
  });

  socket.on('request_archived_char_dm_history', async ({ senderCharId, targetCharId, page = 0, pageSize = MESSAGE_ARCHIVE_PAGE_SIZE }) => {
      if(!senderCharId || !targetCharId) return;
      const result = await getArchivedCharDmPage(senderCharId, targetCharId, page, pageSize);
      socket.emit('archived_char_dm_history', {
          senderCharId,
          targetCharId,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: result.hasMore,
          msgs: result.items
      });
  });

  // RÃ©cupÃ©rer tous les interlocuteurs d'un perso donnÃ©
  socket.on('request_my_char_convos', async ({ myCharIds }) => {
      if(!myCharIds || !myCharIds.length) return socket.emit('my_char_convos', []);
      const convos = await getLatestCharConversations(Message, myCharIds);
      const otherCharIds = [...new Set(convos.map(conv => String(conv.otherCharId)).filter(Boolean))];
      const chars = await Character.find({ _id: { $in: otherCharIds } }).select('_id name avatar color role ownerId ownerUsername');
      const charMap = new Map(chars.map(char => [String(char._id), char]));
      const enriched = convos.map(conv => {
          const otherChar = charMap.get(String(conv.otherCharId));
          return {
              myCharId: conv.myCharId,
              otherCharId: conv.otherCharId,
              otherName: otherChar?.name || conv.otherName || 'Inconnu',
              otherAvatar: otherChar?.avatar || '',
              otherColor: otherChar?.color || '',
              otherRole: otherChar?.role || '',
              otherOwnerId: otherChar?.ownerId || conv.otherOwnerId || '',
              otherOwnerUsername: otherChar?.ownerUsername || '',
              lastDate: conv.lastDate,
              lastContent: conv.lastContent || ''
          };
      });
      socket.emit('my_char_convos', enriched);
  });

  socket.on('char_dm_typing_start', (data) => {
      if(!data || !data.roomId) return;
      socket.broadcast.emit('display_char_dm_typing', data);
  });

  socket.on('char_dm_typing_stop', (data) => {
      if(!data || !data.roomId) return;
      socket.broadcast.emit('hide_char_dm_typing', data);
  });

  socket.on('follow_character', async ({ followerCharId, targetCharId }) => {
      const targetChar = await Character.findById(targetCharId);
      const followerChar = await Character.findById(followerCharId);
      if(!targetChar || !followerChar || String(followerChar._id) === String(targetChar._id)) return;
      targetChar.followers = getValidFollowerIds(targetChar.followers);
      const index = targetChar.followers.indexOf(followerCharId);
      if(index === -1) {
          targetChar.followers.push(followerCharId);
          await createNotification(targetChar.ownerId, 'follow', `(${followerChar.name}) vous suit dÃ©sormais`, followerChar.ownerUsername, 'profile', {
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
      const validFollowerIds = await cleanupCharacterFollowers(char);
      if(char && validFollowerIds.length > 0) socket.emit('followers_list_data', await Character.find({ _id: { $in: validFollowerIds } }).select('name avatar role ownerUsername'));
      else socket.emit('followers_list_data', []);
  });

  socket.on('create_room', async (roomData) => { await new Room(roomData).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (roomId) => { if (roomId === "global") return; await Room.findByIdAndDelete(roomId); await Message.deleteMany({ roomId: roomId }); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', roomId); });
  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  
  socket.on('request_history', async (data) => {
      const roomId = (typeof data === 'object') ? data.roomId : data;
      const requesterId = (typeof data === 'object') ? data.userId : null;
      const page = (typeof data === 'object') ? data.page : 0;
      const pageSize = (typeof data === 'object') ? data.pageSize : 20;
      const query = { roomId: roomId };
      if (requesterId) query.$or = [ { targetName: { $exists: false } }, { targetName: "" }, { ownerId: requesterId }, { targetOwnerId: requesterId } ];
      else query.$or = [{ targetName: { $exists: false } }, { targetName: "" }];
      const result = await getMessagePage(query, page, pageSize);
      socket.emit('history_data', {
          roomId,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: result.hasMore,
          msgs: result.items
      });
  });
  socket.on('request_dm_history', async ({ myUsername, targetUsername, page = 0, pageSize = 20 }) => {
      const result = await getMessagePage({ roomId: 'dm', $or: [ { senderName: myUsername, targetName: targetUsername }, { senderName: targetUsername, targetName: myUsername } ] }, page, pageSize);
      socket.emit('dm_history_data', {
          target: targetUsername,
          history: result.items,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: result.hasMore
      });
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
            const payload = { _id: savedMsg._id, sender: savedMsg.senderName, target: savedMsg.targetName, content: savedMsg.content, type: savedMsg.type, date: savedMsg.date, timestamp: savedMsg.timestamp };
      const targetSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.target);
      const senderSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.sender);
      [...new Set([...targetSockets, ...senderSockets])].forEach(sockId => { io.to(sockId).emit('receive_dm', payload); });
    if (targetUser) await createNotification(targetUser.secretCode, 'reply', `vous a envoyÃ© un message privÃ©`, data.sender, 'dm', { username: data.sender });
  });

  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    if (msgData.senderName === "Narrateur") { const user = await User.findOne({ secretCode: msgData.ownerId }); if (!user || !user.isAdmin) return; }
    if (msgData.targetName) { const targetChar = await Character.findOne({ name: msgData.targetName }).sort({_id: -1}); if (targetChar) msgData.targetOwnerId = targetChar.ownerId; }
    const savedMsg = await new Message(msgData).save();
    io.to(msgData.roomId).emit('message_rp', savedMsg);
    if (msgData.replyTo && msgData.replyTo.id) {
        const originalMsg = await Message.findById(msgData.replyTo.id);
        if (originalMsg && originalMsg.ownerId !== msgData.ownerId) await createNotification(originalMsg.ownerId, 'reply', `a rÃ©pondu Ã  votre message`, msgData.senderName, 'chat', { roomId: msgData.roomId });
    }
    // DÃ©tection des mentions @
    if (msgData.content && msgData.content.includes('@')) {
        const words = msgData.content.split(/\s+/);
        const notifiedOwners = new Set();
        let i = 0;
        while (i < words.length) {
            if (words[i].startsWith('@')) {
                for (let len = 3; len >= 1; len--) {
                    if (i + len > words.length) continue;
                        const potentialName = words.slice(i, i + len).join(' ').replace(/^@/, '').replace(/[^\w\u00C0-\u00FF\s]/g, '').trim();
                    if (!potentialName) continue;
                    const mc = await Character.findOne({ name: new RegExp(`^${potentialName}$`, 'i') });
                    if (mc && mc.ownerId !== msgData.ownerId && !notifiedOwners.has(mc.ownerId)) {
                        await createNotification(mc.ownerId, 'mention', `(${msgData.senderName}) vous a mentionnÃ© dans le chat`, msgData.senderName, 'chat', { roomId: msgData.roomId });
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
      let authorChar = postData.authorCharId ? await Character.findById(postData.authorCharId) : null;
      postData.isLiveNews = !!postData.isLiveNews;
      postData.liveNewsText = String(postData.liveNewsText || '').trim().slice(0, 80);
      if(postData.isLiveNews) {
          if(!authorChar || !isJournalistCharacter(authorChar)) {
              return socket.emit('post_error', 'Seuls les journalistes peuvent mettre une news en direct.');
          }
          if(!postData.liveNewsText) {
              return socket.emit('post_error', 'Ajoute un texte court pour le bandeau du direct.');
          }
          if(!postData.isArticle) {
              postData.content = postData.liveNewsText;
              postData.mediaUrl = '';
              postData.mediaType = '';
              postData.isBreakingNews = false;
              postData.isSponsored = false;
          }
      }
      if(postData.repostPostId) {
          const sourcePost = await Post.findById(postData.repostPostId).lean();
          if(sourcePost && !sourcePost.isArticle) {
              const sourceAuthorChar = sourcePost.authorCharId ? await Character.findById(sourcePost.authorCharId).lean() : null;
              postData.quotedPost = {
                  _id: String(sourcePost._id),
                  content: sourcePost.content || '',
                  mediaUrl: sourcePost.mediaUrl || '',
                  mediaType: sourcePost.mediaType || '',
                  authorCharId: sourcePost.authorCharId || '',
                  authorName: sourcePost.authorName || sourceAuthorChar?.name || '',
                  authorAvatar: sourcePost.authorAvatar || sourceAuthorChar?.avatar || '',
                  authorRole: sourcePost.authorRole || sourceAuthorChar?.role || '',
                  authorColor: sourcePost.authorColor || sourceAuthorChar?.color || '',
                  partyName: sourcePost.partyName || sourceAuthorChar?.partyName || '',
                  partyLogo: sourcePost.partyLogo || sourceAuthorChar?.partyLogo || '',
                  date: sourcePost.date || '',
                  timestamp: sourcePost.timestamp || null,
                  isAnonymous: !!sourcePost.isAnonymous,
                  isBreakingNews: !!sourcePost.isBreakingNews,
                  isSponsored: !!sourcePost.isSponsored,
                  linkedCompanyName: sourcePost.linkedCompanyName || ''
              };
          } else {
              postData.repostPostId = '';
              postData.quotedPost = null;
          }
      }
      if(!postData.isArticle && !String(postData.likeCountDisplay || '').trim()) {
          postData.likeCountDisplay = buildAutoLikeCountDisplay(authorChar, postData);
      }
      const savedPost = await new Post(postData).save();
      if(postData.isLiveNews) await trimLiveNewsOverflow();
      let displayPost = buildDisplayPost(savedPost, authorChar);
      if(displayPost.isLiveNews && !displayPost.isArticle) {
          await broadcastLiveNews();
          await broadcastCosmosTension();
      } else if(displayPost.isArticle) {
          io.emit('new_article', displayPost);
          await broadcastLiveNews();
          await broadcastCosmosTension();
      } else {
          io.emit('new_post', displayPost);
          await broadcastWorldTimeline();
          await broadcastCosmosTension();
      }
      
      const validFollowerIds = await cleanupCharacterFollowers(authorChar);
      if(!postData.isLiveNews && authorChar && validFollowerIds.length > 0) {
          const followersChars = await Character.find({ _id: { $in: validFollowerIds } });
          const notifiedOwners = new Set();
          for(const f of followersChars) {
              if(!notifiedOwners.has(f.ownerId)) {
                  await createNotification(f.ownerId, 'follow', `(${postData.authorName}) a publiÃ© un post`, "Feed", 'feed', { postId: String(savedPost._id) });
                  notifiedOwners.add(f.ownerId);
              }
          }
      }
      // DÃ©tection des mentions @ dans les posts
    if (!postData.isLiveNews && postData.content && postData.content.includes('@') && !postData.isAnonymous) {
          const words = postData.content.split(/\s+/);
          const notifiedOwners = new Set();
          let i = 0;
          while (i < words.length) {
              if (words[i].startsWith('@')) {
                  for (let len = 3; len >= 1; len--) {
                      if (i + len > words.length) continue;
                      const potentialName = words.slice(i, i + len).join(' ').replace(/^@/, '').replace(/[^\w\u00C0-\u00FF\s]/g, '').trim();
                      if (!potentialName) continue;
                      const mc = await Character.findOne({ name: new RegExp(`^${potentialName}$`, 'i') });
                      if (mc && mc.ownerId !== postData.ownerId && !notifiedOwners.has(mc.ownerId)) {
                          await createNotification(mc.ownerId, 'mention', `(${postData.authorName}) vous a mentionnÃ© dans un post`, postData.authorName, 'feed', { postId: String(savedPost._id) });
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
            if(post.isArticle || post.isLiveNews) await broadcastLiveNews();
      await broadcastWorldTimeline();
    await broadcastCosmosTension();
      if(isAdmin && requester) {
          await logAdminAction({
              actorUser: requester,
              actionType: 'post_deleted',
              targetType: post.isArticle ? 'article' : 'post',
              targetId: String(post._id),
              targetLabel: post.isArticle ? extractArticleTitle(post.content || '') : (post.authorName || 'Post'),
              message: `${requester.username} a supprimÃ© ${post.isArticle ? 'un article' : 'un post'} de ${post.authorName || 'source inconnue'}`,
              meta: { redirectView: post.isArticle ? 'presse' : 'feed', redirectData: { postId: String(post._id) } },
              includeInTimeline: false
          });
      }
  });

  socket.on('edit_post', async ({ postId, content, ownerId, articleTheme }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      if(post.ownerId !== ownerId && !(await User.findOne({ secretCode: ownerId, isAdmin: true }))) return;
      post.content = content;
      if(articleTheme && typeof articleTheme === 'object') {
          post.articleTheme = {
              ...post.articleTheme,
              ...articleTheme
          };
      }
      post.edited = true;
      await post.save();
    io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers followerCountDisplay companies') : null));
        if(post.isArticle || post.isLiveNews) await broadcastLiveNews();
      await broadcastWorldTimeline();
            await broadcastCosmosTension();
  });

  socket.on('like_post', async ({ postId, charId }) => { 
      const post = await Post.findById(postId);
      if(!post) return;
      const index = post.likes.indexOf(charId);
      let action = 'unlike';
      if(index === -1) { post.likes.push(charId); action = 'like'; } 
      else { post.likes.splice(index, 1); }
      await post.save();
    io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers followerCountDisplay companies') : null));
      if (action === 'like' && post.ownerId) {
           const likerChar = await Character.findById(charId);
           await createNotification(post.ownerId, 'like', `(${likerChar ? likerChar.name : "Inconnu"}) a aimÃ© votre post`, "Feed", 'feed', { postId: String(post._id) });
      }
  });

  socket.on('post_comment', async ({ postId, comment }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      comment.id = new mongoose.Types.ObjectId().toString();
      post.comments.push(comment);
      await post.save();
    io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers followerCountDisplay companies') : null));
    if (post.ownerId !== comment.ownerId) await createNotification(post.ownerId, 'reply', `(${comment.authorName}) a commentÃ© votre post`, "Feed", 'feed', { postId: String(post._id) });
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
    io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers followerCountDisplay companies') : null));
      if(isAdmin && requester) {
          await logAdminAction({
              actorUser: requester,
              actionType: 'comment_deleted',
              targetType: 'comment',
              targetId: commentId,
              targetLabel: post.authorName || 'Commentaire',
              message: `${requester.username} a supprimÃ© un commentaire sur le post de ${post.authorName || 'source inconnue'}`,
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
    io.emit('post_updated', await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers followerCountDisplay companies') : null));
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
              ? `${user.username} a dÃ©fini une nouvelle Une: ${extractArticleTitle(headline?.content || '')}`
              : `${user.username} a retirÃ© la Une actuelle`,
          meta: { redirectView: 'presse', redirectData: { articleId: postId } },
          includeInTimeline: true,
          timelineType: 'article',
          timelineTone: 'article'
      });
  });

  socket.on('set_live_news', async ({ postId, value }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const post = await Post.findById(postId);
      if(!post || !post.isArticle) return;
      post.isLiveNews = !!value;
      await post.save();
      const displayPost = await buildDisplayPost(post, post.authorCharId ? await Character.findById(post.authorCharId).select('isOfficial followers followerCountDisplay companies') : null);
      io.emit('post_updated', displayPost);
      await broadcastLiveNews();
      await broadcastCosmosTension();
  });

  // ACTUALITÃ‰S
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
          targetLabel: ev.evenement || 'Ã‰vÃ©nement',
          message: `${user.username} a publiÃ© un Ã©vÃ©nement: ${ev.evenement}`,
          meta: { redirectView: 'actualites', redirectData: { eventId: String(ev._id) } },
          includeInTimeline: true,
          timelineType: 'event',
          timelineTone: 'event'
      });
      await broadcastCosmosTension();
  });
  socket.on('delete_event', async (id) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      const event = await Event.findById(id);
      await Event.findByIdAndDelete(id);
      io.emit('events_data', await Event.find().sort({ date: 1, heure: 1 }));
      await broadcastWorldTimeline();
    await broadcastCosmosTension();
      if(event) {
          await logAdminAction({
              actorUser: user,
              actionType: 'event_deleted',
              targetType: 'event',
              targetId: String(event._id),
              targetLabel: event.evenement || 'Ã‰vÃ©nement',
              message: `${user.username} a supprimÃ© l'Ã©vÃ©nement: ${event.evenement}`,
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

  // ========== [CITÃ‰S] SOCKET EVENTS ==========
  socket.on('request_cities', async () => {
      const cities = await City.find().sort({ archipel: 1, name: 1 });
      socket.emit('cities_data', cities);
  });

  socket.on('admin_update_city', async ({ cityId, president, population, baseEDC, trend, flag, customPct, capitale }) => {
      // VÃ©rifier que l'expÃ©diteur est admin
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      // Multiplicateurs rÃ©alistes (variations douces sur gros chiffres)
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

      // Variation par tendance prÃ©dÃ©finie
      if(trend !== undefined && trend !== null) {
          city.trend = trend;
          const mult = TREND_MULT[trend] || 1;
          const newEDC = Math.round(city.baseEDC * mult);
          city.baseEDC = newEDC;
          city.historyEDC.push({ value: newEDC, date: new Date() });
          if(city.historyEDC.length > 30) city.historyEDC.shift();
      }

      // Variation par pourcentage personnalisÃ©
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
  // ========== [FIN CITÃ‰S SOCKET] ==========

  // ========== [DIPLOMATIE] SOCKET EVENTS ==========
    const DIPLO_STATUS_VALUES = new Set(['allie', 'pacte_defensif', 'axe_economique', 'coalition_gouvernementale', 'coalition_electorale', 'soutien_strategique', 'pacte_non_agression', 'partenariat', 'neutre', 'observateur', 'tension', 'opposition_parlementaire', 'rivalite_electorale', 'rivalite_ideologique', 'sanction', 'guerre_commerciale', 'blocus', 'hostile', 'contentieux_territorial', 'conflit_froid', 'insurrection_proxy', 'guerre']);
    const DIPLO_GROUPABLE_STATUSES = new Set(['allie', 'pacte_defensif', 'axe_economique', 'coalition_gouvernementale', 'coalition_electorale', 'soutien_strategique']);
    const DIPLO_COLLECTIVE_CONFLICT_STATUSES = new Set(['tension', 'sanction', 'guerre_commerciale', 'blocus', 'hostile', 'contentieux_territorial', 'conflit_froid', 'insurrection_proxy', 'guerre']);
  const DIPLO_CONTEXT_VALUES = new Set(['general', 'pacte_defensif', 'axe_economique', 'coalition_gouvernementale', 'coalition_electorale', 'soutien_strategique', 'mediation', 'opposition_parlementaire', 'rivalite_electorale', 'rivalite_ideologique', 'guerre_commerciale', 'contentieux_territorial', 'insurrection_proxy']);

  function normalizePartyKey(name = '') {
      return String(name || '').trim().toLowerCase().replace(/\s+/g, '-');
  }

  function buildDiploGroupKey(scope, entityKeys) {
      return `${scope}:${entityKeys.join('|')}:${Date.now()}`;
  }

  function buildPairList(items) {
      const pairs = [];
      for(let i = 0; i < items.length - 1; i++) {
          for(let j = i + 1; j < items.length; j++) pairs.push([items[i], items[j]]);
      }
      return pairs;
  }

  async function getPoliticalPartiesCatalog() {
      const chars = await Character.find({ partyName: { $exists: true, $ne: '' } }).select('partyName partyLogo').lean();
      const catalog = new Map();
      chars.forEach(char => {
          const name = String(char.partyName || '').trim();
          if(!name) return;
          const key = normalizePartyKey(name);
          const current = catalog.get(key) || { key, name, logo: '' };
          if(!current.logo && char.partyLogo) current.logo = char.partyLogo;
          catalog.set(key, current);
      });
      return [...catalog.values()].sort((left, right) => left.name.localeCompare(right.name, 'fr'));
  }

  async function getCitySnapshotsByIds(cityIds = []) {
      const ids = [...new Set((Array.isArray(cityIds) ? cityIds : []).map(id => String(id || '').trim()).filter(Boolean))];
      if(!ids.length) return [];
      const cities = await City.find({ _id: { $in: ids } }).select('name flag').lean();
      const cityMap = new Map(cities.map(city => [String(city._id), city]));
      return ids.map(id => {
          const city = cityMap.get(id);
          if(!city) return null;
          return {
              scope: 'city',
              key: id,
              id: `city:${id}`,
              name: city.name,
              logo: city.flag || ''
          };
      }).filter(Boolean);
  }

  async function getPartySnapshotsByKeys(partyKeys = []) {
      const keys = [...new Set((Array.isArray(partyKeys) ? partyKeys : []).map(key => String(key || '').trim()).filter(Boolean))];
      if(!keys.length) return [];
      const catalog = await getPoliticalPartiesCatalog();
      const partyMap = new Map(catalog.map(party => [party.key, party]));
      return keys.map(key => {
          const party = partyMap.get(key);
          if(!party) return null;
          return {
              scope: 'party',
              key,
              id: `party:${key}`,
              name: party.name,
              logo: party.logo || ''
          };
      }).filter(Boolean);
  }

  async function getDiplomacyRelationsPayload() {
      const [cityRelations, partyRelations, mixedRelations] = await Promise.all([
          CityRelation.find()
              .populate('cityA', 'name flag archipel')
              .populate('cityB', 'name flag archipel')
              .sort({ updatedAt: -1 }),
          PartyRelation.find().sort({ updatedAt: -1 }).lean(),
          MixedRelation.find().sort({ updatedAt: -1 }).lean()
      ]);

      const cityPayload = cityRelations.map(relation => ({
          ...(relation.toObject ? relation.toObject() : relation),
          relationScope: 'city'
      }));
      const partyPayload = partyRelations.map(relation => ({
          ...relation,
          relationScope: 'party'
      }));

      const mixedPayload = mixedRelations.map(relation => ({
          ...relation,
          relationScope: 'mixed'
      }));

      return [...cityPayload, ...partyPayload, ...mixedPayload]
          .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
  }

  async function emitDiplomacyRelations(target) {
      target.emit('city_relations_data', await getDiplomacyRelationsPayload());
  }

    async function saveCityRelationPair(idA, idB, payload, relationId = null) {
      const [safeA, safeB] = [String(idA), String(idB)].sort();
      let relation;
      if(relationId) {
          relation = await CityRelation.findById(relationId);
      } else {
          relation = await CityRelation.findOne({
              $or: [
                  { cityA: safeA, cityB: safeB },
                  { cityA: safeB, cityB: safeA }
              ]
          });
      }
      if(!relation) relation = new CityRelation({ cityA: safeA, cityB: safeB });
      relation.cityA = safeA;
      relation.cityB = safeB;
      relation.status = payload.status;
      relation.contextCategory = payload.contextCategory;
      relation.description = payload.description;
      relation.initiatedBy = payload.initiatedBy;
      relation.allianceGroupKey = payload.allianceGroupKey || '';
      relation.allianceGroupName = payload.allianceGroupName || '';
      if(payload.sinceDate) relation.since = payload.sinceDate;
      await relation.save();
  }

    async function savePartyRelationPair(partyA, partyB, payload, relationId = null) {
      const [leftParty, rightParty] = [partyA, partyB].sort((left, right) => left.key.localeCompare(right.key));
      let relation;
      if(relationId) {
          relation = await PartyRelation.findById(relationId);
      } else {
          relation = await PartyRelation.findOne({
              $or: [
                  { 'partyA.key': leftParty.key, 'partyB.key': rightParty.key },
                  { 'partyA.key': rightParty.key, 'partyB.key': leftParty.key }
              ]
          });
      }
      if(!relation) relation = new PartyRelation({ partyA: leftParty, partyB: rightParty });
      relation.partyA = leftParty;
      relation.partyB = rightParty;
      relation.status = payload.status;
      relation.contextCategory = payload.contextCategory;
      relation.description = payload.description;
      relation.initiatedBy = payload.initiatedBy;
      relation.allianceGroupKey = payload.allianceGroupKey || '';
      relation.allianceGroupName = payload.allianceGroupName || '';
      if(payload.sinceDate) relation.since = payload.sinceDate;
      await relation.save();
  }

  async function resolveAllianceMemberCityIds(allianceGroupKey, fallbackCityIds = []) {
      if(allianceGroupKey) {
          const allianceRelations = await CityRelation.find({ allianceGroupKey }).select('cityA cityB').lean();
          const memberIds = new Set();
          allianceRelations.forEach(relation => {
              if(relation.cityA) memberIds.add(String(relation.cityA));
              if(relation.cityB) memberIds.add(String(relation.cityB));
          });
          if(memberIds.size >= 2) return [...memberIds].sort();
      }

      return [...new Set((Array.isArray(fallbackCityIds) ? fallbackCityIds : [])
          .map(id => String(id || '').trim())
          .filter(Boolean))].sort();
  }

  async function resolveAllianceMemberPartyKeys(allianceGroupKey, fallbackPartyKeys = []) {
      if(allianceGroupKey) {
          const allianceRelations = await PartyRelation.find({ allianceGroupKey }).select('partyA partyB').lean();
          const memberKeys = new Set();
          allianceRelations.forEach(relation => {
              if(relation.partyA?.key) memberKeys.add(String(relation.partyA.key));
              if(relation.partyB?.key) memberKeys.add(String(relation.partyB.key));
          });
          if(memberKeys.size >= 2) return [...memberKeys].sort();
      }

      return [...new Set((Array.isArray(fallbackPartyKeys) ? fallbackPartyKeys : [])
          .map(key => String(key || '').trim())
          .filter(Boolean))].sort();
  }

  async function saveMixedRelation(payload, relationId = null) {
      let relation;
      if(relationId) {
          relation = await MixedRelation.findById(relationId);
      } else {
          relation = await MixedRelation.findOne({
              sourceAllianceGroupKey: payload.sourceAllianceGroupKey,
              'targetEntity.scope': payload.targetEntity.scope,
              'targetEntity.key': payload.targetEntity.key
          });
      }
      if(!relation) relation = new MixedRelation();
      relation.sourceAllianceScope = payload.sourceAllianceScope;
      relation.sourceAllianceGroupKey = payload.sourceAllianceGroupKey;
      relation.sourceAllianceGroupName = payload.sourceAllianceGroupName || '';
      relation.sourceEntities = payload.sourceEntities || [];
      relation.targetEntity = payload.targetEntity;
      relation.status = payload.status;
      relation.contextCategory = payload.contextCategory;
      relation.description = payload.description;
      relation.initiatedBy = payload.initiatedBy;
      if(payload.sinceDate) relation.since = payload.sinceDate;
      await relation.save();
  }

  async function syncMixedRelationsForAlliance(scope, allianceGroupKey, allianceGroupName = '') {
      const safeGroupKey = String(allianceGroupKey || '').trim();
      if(!safeGroupKey) return;

      const sourceEntities = scope === 'party'
          ? await getPartySnapshotsByKeys(await resolveAllianceMemberPartyKeys(safeGroupKey, []))
          : await getCitySnapshotsByIds(await resolveAllianceMemberCityIds(safeGroupKey, []));

      if(!sourceEntities.length) {
          await MixedRelation.deleteMany({ sourceAllianceGroupKey: safeGroupKey });
          return;
      }

      await MixedRelation.updateMany(
          { sourceAllianceGroupKey: safeGroupKey },
          {
              $set: {
                  sourceAllianceScope: scope,
                  sourceAllianceGroupName: allianceGroupName || '',
                  sourceEntities
              }
          }
      );
  }

  socket.on('request_city_relations', async () => {
      await emitDiplomacyRelations(socket);
  });

  socket.on('request_political_parties', async () => {
      socket.emit('political_parties_data', await getPoliticalPartiesCatalog());
  });

    socket.on('admin_upsert_city_relation', async ({ relationId, relationScope, cityAId, cityBId, cityIds, partyKeys, status, contextCategory, description, initiatedBy, since, allianceGroupKey, allianceGroupName }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      const scope = relationScope === 'party' ? 'party' : 'city';
      const safeStatus = DIPLO_STATUS_VALUES.has(status) ? status : 'neutre';
      const safeContext = DIPLO_CONTEXT_VALUES.has(contextCategory) ? contextCategory : 'general';
      const payload = {
          status: safeStatus,
          contextCategory: safeContext,
          description: description || '',
          initiatedBy: initiatedBy || '',
          sinceDate: since ? new Date(since) : null,
          allianceGroupKey: '',
          allianceGroupName: ''
      };

      if(scope === 'party') {
          const partyCatalog = await getPoliticalPartiesCatalog();
          const catalogMap = new Map(partyCatalog.map(party => [party.key, party]));
          const normalizedPartyKeys = [...new Set((Array.isArray(partyKeys) ? partyKeys : []).map(key => String(key || '').trim()).filter(Boolean))]
              .sort();
          const parties = normalizedPartyKeys.map(key => catalogMap.get(key)).filter(Boolean);
          if(parties.length < 2) return;
          if(!DIPLO_GROUPABLE_STATUSES.has(safeStatus) && parties.length !== 2) return;

          const shouldPersistAllianceGroup = parties.length >= 2 && (
              Boolean(String(allianceGroupName || '').trim())
              || Boolean(String(allianceGroupKey || '').trim())
              || (DIPLO_GROUPABLE_STATUSES.has(safeStatus) && parties.length > 2)
          );
          const groupKey = shouldPersistAllianceGroup
              ? (allianceGroupKey || buildDiploGroupKey('party', parties.map(party => party.key)))
              : '';
          payload.allianceGroupKey = groupKey;
          payload.allianceGroupName = groupKey ? String(allianceGroupName || '').trim() : '';

          if(allianceGroupKey) await PartyRelation.deleteMany({ allianceGroupKey });

          if(groupKey) {
              const pairs = buildPairList(parties);
              for(const [partyA, partyB] of pairs) {
                  await savePartyRelationPair(partyA, partyB, payload);
              }
              await syncMixedRelationsForAlliance('party', groupKey, payload.allianceGroupName);
          } else {
              await savePartyRelationPair(parties[0], parties[1], payload, relationId || null);
          }

          await emitDiplomacyRelations(io);
              await broadcastCosmosTension();
          return;
      }

      const normalizedCityIds = [...new Set(
          (Array.isArray(cityIds) && cityIds.length ? cityIds : [cityAId, cityBId])
              .map(id => String(id || '').trim())
              .filter(Boolean)
      )].sort();
      if(normalizedCityIds.length < 2) return;
      if(!DIPLO_GROUPABLE_STATUSES.has(safeStatus) && normalizedCityIds.length !== 2) return;

      const shouldPersistAllianceGroup = normalizedCityIds.length >= 2 && (
          Boolean(String(allianceGroupName || '').trim())
          || Boolean(String(allianceGroupKey || '').trim())
          || (DIPLO_GROUPABLE_STATUSES.has(safeStatus) && normalizedCityIds.length > 2)
      );
      const groupKey = shouldPersistAllianceGroup
          ? (allianceGroupKey || buildDiploGroupKey('city', normalizedCityIds))
          : '';
      payload.allianceGroupKey = groupKey;
      payload.allianceGroupName = groupKey ? String(allianceGroupName || '').trim() : '';

      if(allianceGroupKey) await CityRelation.deleteMany({ allianceGroupKey });

      if(groupKey) {
          const pairs = buildPairList(normalizedCityIds);
          for(const [idA, idB] of pairs) {
              await saveCityRelationPair(idA, idB, payload);
          }
          await syncMixedRelationsForAlliance('city', groupKey, payload.allianceGroupName);
      } else {
          await saveCityRelationPair(normalizedCityIds[0], normalizedCityIds[1], payload, relationId || null);
      }

      await emitDiplomacyRelations(io);
      await broadcastCosmosTension();
  });

  socket.on('admin_delete_city_relation', async ({ relationId, relationScope, allianceGroupKey }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      const scope = relationScope === 'party' ? 'party' : 'city';
      const Model = scope === 'party' ? PartyRelation : CityRelation;

      if(allianceGroupKey) {
          await Model.deleteMany({ allianceGroupKey });
          await MixedRelation.deleteMany({ sourceAllianceGroupKey: allianceGroupKey });
      } else if(relationId) {
          const deleted = await Model.findByIdAndDelete(relationId);
          if(!deleted) await MixedRelation.findByIdAndDelete(relationId);
      }

      await emitDiplomacyRelations(io);
      await broadcastCosmosTension();
  });

  socket.on('admin_upsert_collective_conflict', async ({ allianceGroupKey, sourceCityIds, targetCityIds, status, contextCategory, description, initiatedBy, since }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      const safeStatus = DIPLO_COLLECTIVE_CONFLICT_STATUSES.has(status) ? status : '';
      if(!safeStatus) return;

      const allianceMemberIds = await resolveAllianceMemberCityIds(allianceGroupKey, sourceCityIds);
      if(allianceMemberIds.length < 2) return;

      const allianceMemberSet = new Set(allianceMemberIds);
      const normalizedTargetIds = [...new Set((Array.isArray(targetCityIds) ? targetCityIds : [])
          .map(id => String(id || '').trim())
          .filter(id => id && !allianceMemberSet.has(id)))].sort();
      if(!normalizedTargetIds.length) return;

      const payload = {
          status: safeStatus,
          contextCategory: DIPLO_CONTEXT_VALUES.has(contextCategory) ? contextCategory : 'general',
          description: description || '',
          initiatedBy: initiatedBy || '',
          sinceDate: since ? new Date(since) : null,
          allianceGroupKey: ''
      };

      for(const memberId of allianceMemberIds) {
          for(const targetId of normalizedTargetIds) {
              await saveCityRelationPair(memberId, targetId, payload);
          }
      }

      await emitDiplomacyRelations(io);
      await broadcastCosmosTension();
  });

  socket.on('admin_upsert_collective_relation_to_entity', async ({ relationScope, allianceGroupKey, targetEntityScope, targetEntityKey, relationId, status, contextCategory, description, initiatedBy, since }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      const scope = relationScope === 'party' ? 'party' : 'city';
      const safeStatus = DIPLO_STATUS_VALUES.has(status) ? status : '';
      const safeTargetEntityScope = targetEntityScope === 'party' ? 'party' : 'city';
      const safeTargetEntityKey = String(targetEntityKey || '').trim();
      if(!safeStatus || !safeTargetEntityKey) return;

      const payload = {
          status: safeStatus,
          contextCategory: DIPLO_CONTEXT_VALUES.has(contextCategory) ? contextCategory : 'general',
          description: description || '',
          initiatedBy: initiatedBy || '',
          sinceDate: since ? new Date(since) : null,
          allianceGroupKey: '',
          allianceGroupName: ''
      };

      if(scope !== safeTargetEntityScope) {
          const sourceEntities = scope === 'party'
              ? await getPartySnapshotsByKeys(await resolveAllianceMemberPartyKeys(allianceGroupKey, []))
              : await getCitySnapshotsByIds(await resolveAllianceMemberCityIds(allianceGroupKey, []));
          if(sourceEntities.length < 2) return;

          const sourceEntityIds = new Set(sourceEntities.map(entity => entity.id));
          const targetEntity = safeTargetEntityScope === 'party'
              ? (await getPartySnapshotsByKeys([safeTargetEntityKey]))[0]
              : (await getCitySnapshotsByIds([safeTargetEntityKey]))[0];
          if(!targetEntity || sourceEntityIds.has(targetEntity.id)) return;

          const sourceAllianceName = scope === 'party'
              ? (await PartyRelation.findOne({ allianceGroupKey }).select('allianceGroupName').lean())?.allianceGroupName || ''
              : (await CityRelation.findOne({ allianceGroupKey }).select('allianceGroupName').lean())?.allianceGroupName || '';

          await saveMixedRelation({
              sourceAllianceScope: scope,
              sourceAllianceGroupKey: allianceGroupKey,
              sourceAllianceGroupName: sourceAllianceName,
              sourceEntities,
              targetEntity,
              status: safeStatus,
              contextCategory: payload.contextCategory,
              description: payload.description,
              initiatedBy: payload.initiatedBy,
              sinceDate: payload.sinceDate
          }, relationId || null);

          await emitDiplomacyRelations(io);
          await broadcastCosmosTension();
          return;
      }

      if(scope === 'party') {
          const partyCatalog = await getPoliticalPartiesCatalog();
          const catalogMap = new Map(partyCatalog.map(party => [party.key, party]));
          const allianceMemberKeys = await resolveAllianceMemberPartyKeys(allianceGroupKey, []);
          if(allianceMemberKeys.length < 2) return;
          if(allianceMemberKeys.includes(safeTargetEntityKey)) return;

          const targetParty = catalogMap.get(safeTargetEntityKey);
          if(!targetParty) return;

          for(const memberKey of allianceMemberKeys) {
              const memberParty = catalogMap.get(memberKey);
              if(!memberParty) continue;
              await savePartyRelationPair(memberParty, targetParty, payload);
          }

          await emitDiplomacyRelations(io);
          await broadcastCosmosTension();
          return;
      }

      const allianceMemberIds = await resolveAllianceMemberCityIds(allianceGroupKey, []);
      if(allianceMemberIds.length < 2) return;
      if(allianceMemberIds.includes(safeTargetEntityKey)) return;

      for(const memberId of allianceMemberIds) {
          await saveCityRelationPair(memberId, safeTargetEntityKey, payload);
      }

      await emitDiplomacyRelations(io);
      await broadcastCosmosTension();
  });
  // ========== [FIN DIPLOMATIE SOCKET] ==========

  // ========== [CARTES] SOCKET EVENTS ==========
  const allowedMapKeys = new Set(['archipel-pacifique', 'ancienne-archipel', 'archipel-sableuse']);
  const allowedMarkerCategories = new Set(['general', 'port', 'airport', 'company', 'military', 'breaking-news']);
  const allowedOverlayModes = new Set(['territory', 'danger']);

  function sanitizeHexColor(value, fallback) {
      const normalized = String(value || '').trim();
      return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
  }

  function sanitizeOverlayTargetIds(targetIds) {
      return [...new Set((Array.isArray(targetIds) ? targetIds : [])
          .map(value => String(value || '').trim())
          .filter(value => /^[A-Za-z][\w:-]{0,63}$/.test(value)))];
  }

  async function emitMapMarkers(target) {
      const markers = await MapMarker.find()
          .populate('cityId', 'name flag archipel')
          .populate('postId', '_id content isBreakingNews createdAt journalName')
          .sort({ updatedAt: -1, createdAt: -1 });
      target.emit('map_markers_data', markers);
  }

  async function emitMapOverlays(target) {
      const overlays = await MapOverlay.find().sort({ updatedAt: -1, createdAt: -1 });
      target.emit('map_overlays_data', overlays);
  }

  socket.on('request_map_markers', async () => {
      await emitMapMarkers(socket);
  });

  socket.on('request_map_overlays', async () => {
      await emitMapOverlays(socket);
  });

  socket.on('admin_save_map_marker', async ({ markerId, mapKey, category, title, description, x, y, imageUrl, cityId, postId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      const safeMapKey = String(mapKey || '').trim();
      const safeCategory = String(category || 'general').trim();
      const safeTitle = String(title || '').trim();
      const safeDescription = String(description || '').trim();
      const parsedX = Number(x);
      const parsedY = Number(y);
      const safePostId = String(postId || '').trim();

      if(!allowedMapKeys.has(safeMapKey)) return;
      if(!allowedMarkerCategories.has(safeCategory)) return;
      if(!safeTitle) return;
      if(!Number.isFinite(parsedX) || !Number.isFinite(parsedY)) return;

      let linkedPostId = null;
      if(safePostId) {
          const post = await Post.findById(safePostId).select('_id');
          if(!post) return;
          linkedPostId = post._id;
      }

      let marker = null;
      if(markerId) marker = await MapMarker.findById(markerId);
      if(!marker) {
          marker = new MapMarker({
              createdBy: user.username,
              updatedBy: user.username
          });
      }

      marker.mapKey = safeMapKey;
    marker.category = safeCategory;
      marker.title = safeTitle;
      marker.description = safeDescription;
      marker.x = Math.max(0, Math.min(100, parsedX));
      marker.y = Math.max(0, Math.min(100, parsedY));
      marker.imageUrl = String(imageUrl || '').trim();
      marker.cityId = cityId || null;
    marker.postId = linkedPostId;
      marker.updatedBy = user.username;

      await marker.save();
      socket.emit('map_marker_save_success', { markerId: String(marker._id) });
      await emitMapMarkers(io);
  });

  socket.on('admin_delete_map_marker', async ({ markerId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      if(!markerId) return;

      await MapMarker.findByIdAndDelete(markerId);
      await emitMapMarkers(io);
  });

  socket.on('admin_save_map_overlay', async ({ overlayId, mapKey, label, description, mode, targetIds, fillColor, fillOpacity, strokeColor, strokeWidth, blink }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      const safeMapKey = String(mapKey || '').trim();
      const safeLabel = String(label || '').trim();
      const safeDescription = String(description || '').trim();
      const safeMode = String(mode || 'territory').trim();
      const safeTargetIds = sanitizeOverlayTargetIds(targetIds);
      const safeFillColor = sanitizeHexColor(fillColor, '#f59e0b');
      const safeStrokeColor = sanitizeHexColor(strokeColor, '#ef4444');
      const safeFillOpacity = Math.max(0, Math.min(1, Number(fillOpacity)));
      const safeStrokeWidth = Math.max(0, Math.min(12, Number(strokeWidth)));

      if(!allowedMapKeys.has(safeMapKey)) return;
      if(!allowedOverlayModes.has(safeMode)) return;
      if(!safeLabel) return;
      if(!safeTargetIds.length) return;

      let overlay = null;
      if(overlayId) overlay = await MapOverlay.findById(overlayId);
      if(!overlay) {
          overlay = new MapOverlay({
              createdBy: user.username,
              updatedBy: user.username
          });
      }

      overlay.mapKey = safeMapKey;
      overlay.label = safeLabel;
      overlay.description = safeDescription;
      overlay.mode = safeMode;
      overlay.targetIds = safeTargetIds;
      overlay.fillColor = safeFillColor;
      overlay.fillOpacity = Number.isFinite(safeFillOpacity) ? safeFillOpacity : 0.35;
      overlay.strokeColor = safeStrokeColor;
      overlay.strokeWidth = Number.isFinite(safeStrokeWidth) ? safeStrokeWidth : 2;
      overlay.blink = !!blink;
      overlay.updatedBy = user.username;

      await overlay.save();
      socket.emit('map_overlay_save_success', { overlayId: String(overlay._id) });
      await emitMapOverlays(io);
  });

  socket.on('admin_delete_map_overlay', async ({ overlayId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      if(!overlayId) return;

      await MapOverlay.findByIdAndDelete(overlayId);
      await emitMapOverlays(io);
  });
  // ========== [FIN CARTES] SOCKET EVENTS ==========

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
      let stock = stockId ? await Stock.findById(stockId) : null;
      const previousCompanyName = stock?.companyName || companyName;
      if(!stock) stock = await Stock.findOne({ companyName, charId });
      if(!stock) {
          stock = new Stock({ companyName, companyLogo, charId, charName, charColor, stockColor: stockColor || '#6c63ff', currentValue: Number(currentValue) || 0, description, headquarters });
          // Premier point d'historique Ã  la crÃ©ation seulement
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
          // Ne pas pousser Ã  l'historique ici â€” le bouton Jour suivant le fera
          if(description !== undefined) stock.description = description;
          if(headquarters !== undefined) stock.headquarters = headquarters;
          await applyStockValueChange(stock, oldVal, stock.currentValue);
      }
      stock.updatedAt = new Date();
      await stock.save();
      const syncedChar = await syncCharacterCompanyFromStock(stock, previousCompanyName);
      if(syncedChar) io.emit('char_updated', syncedChar.toObject());
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
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
      // Ne pas pousser Ã  l'historique ici â€” le bouton Jour suivant le fera
      stock.updatedAt = new Date();
      await stock.save();
      await applyStockValueChange(stock, oldTrendVal, newVal);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
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
      // Ne pas pousser Ã  l'historique ici â€” le bouton Jour suivant le fera
      stock.updatedAt = new Date();
      await stock.save();
      await applyStockValueChange(stock, oldCustomVal, newVal);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
  });

  socket.on('admin_delete_stock', async ({ stockId }) => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const stock = await Stock.findById(stockId);
      await Stock.findByIdAndDelete(stockId);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
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
  });

  // Boost bourse via publication pub (Feed / Presse)
  socket.on('pub_boost_stock', async ({ stockId }) => {
      if(!stockId) return;
      const stock = await Stock.findById(stockId).catch(() => null);
      if(!stock) return;
      const oldPubVal = stock.currentValue;
      const pct = parseFloat((0.1 + Math.random() * 0.4).toFixed(2)); // 0.10 â€“ 0.50%
      const mult = 1 + pct / 100;
      const newVal = Math.round(stock.currentValue * mult * 100) / 100;
      stock.currentValue = newVal;
      // Ne pas pousser Ã  l'historique ici â€” le bouton Jour suivant le fera
      stock.updatedAt = new Date();
      await stock.save();
      await applyStockValueChange(stock, oldPubVal, newVal);
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
  });

  // Jour suivant â€” commit de tous les currentValues vers l'historique
  socket.on('admin_next_trading_day', async () => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      const allStocks = await Stock.find();
      const now = new Date();
      const STABLE_RANGE = [-0.1, 0.1];
      for(const stock of allStocks) {
          const lastCommitted = stock.history && stock.history.length ? stock.history[stock.history.length - 1].value : null;
          const oldValue = stock.currentValue;
          const hasPendingChange = lastCommitted === null ? false : Math.abs((stock.currentValue || 0) - lastCommitted) > 0.001;
          if(!hasPendingChange) {
              const randPct = parseFloat((STABLE_RANGE[0] + Math.random() * (STABLE_RANGE[1] - STABLE_RANGE[0])).toFixed(2));
              const mult = 1 + randPct / 100;
              stock.currentValue = Math.max(0, Math.round(stock.currentValue * mult * 100) / 100);
              stock.trend = 'stable';
          }
          stock.history.push({ value: stock.currentValue, date: now });
          if(stock.history.length > 30) stock.history.shift();
          stock.updatedAt = now;
          if(Math.abs((stock.currentValue || 0) - oldValue) > 0.001) {
              await applyStockValueChange(stock, oldValue, stock.currentValue);
          }
          await stock.save();
      }
      const stocks = await getEnrichedStocks();
      io.emit('stocks_updated', stocks);
  });

  // Admin â€” dÃ©finir le chiffre d'affaires d'une entreprise
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
      await emitCharacterProfileData(char);
      const stocksRefresh = await getEnrichedStocks();
      io.emit('stocks_updated', stocksRefresh);
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
      await emitCharacterProfileData(char);
      io.emit('stocks_updated', await getEnrichedStocks());
      socket.emit('admin_action_result', { success: true, msg: 'Entreprise mise Ã  jour.' });
  });

  socket.on('admin_transfer_company', async ({ fromCharId, toCharId, companyIndex }) => {
      const user = await getSocketUser(socket);
      if(!user || !user.isAdmin) return;
      if(!fromCharId || !toCharId || String(fromCharId) === String(toCharId)) {
          socket.emit('admin_action_result', { success: false, error: 'Choisis un autre personnage propriétaire.' });
          return;
      }
      const [fromChar, toChar] = await Promise.all([
          Character.findById(fromCharId),
          Character.findById(toCharId)
      ]);
      if(!fromChar || !toChar) {
          socket.emit('admin_action_result', { success: false, error: 'Personnage introuvable.' });
          return;
      }
      if(!Array.isArray(fromChar.companies) || companyIndex < 0 || companyIndex >= fromChar.companies.length) {
          socket.emit('admin_action_result', { success: false, error: 'Entreprise introuvable.' });
          return;
      }

      const company = { ...(fromChar.companies[companyIndex].toObject?.() || fromChar.companies[companyIndex]) };
      if((toChar.companies || []).some(entry => String(entry?.name || '').toLowerCase() === String(company.name || '').toLowerCase())) {
          socket.emit('admin_action_result', { success: false, error: 'Ce personnage possède déjà une entreprise du même nom.' });
          return;
      }

      fromChar.companies.splice(companyIndex, 1);
      toChar.companies.push(company);
      fromChar.markModified('companies');
      toChar.markModified('companies');
      await Promise.all([fromChar.save(), toChar.save()]);

      const stock = await Stock.findOne({ charId: String(fromChar._id), companyName: company.name });
      if(stock) {
          stock.charId = String(toChar._id);
          stock.charName = toChar.name || stock.charName;
          stock.charColor = toChar.color || stock.charColor;
          stock.companyLogo = company.logo || '';
          stock.description = company.description || '';
          stock.headquarters = company.headquarters || null;
          stock.updatedAt = new Date();
          await stock.save();
      }

      io.emit('char_updated', fromChar.toObject());
      io.emit('char_updated', toChar.toObject());
      await Promise.all([
          emitCharacterProfileData(fromChar),
          emitCharacterProfileData(toChar)
      ]);
      io.emit('stocks_updated', await getEnrichedStocks());
      socket.emit('admin_action_result', { success: true, msg: 'Propriétaire de l\'entreprise modifié.' });
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
          socket.emit('admin_action_result', { success: false, error: 'Impossible de modifier votre propre rÃ´le admin.' });
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
          message: `${user.username} a ${target.isAdmin ? 'accordÃ©' : 'retirÃ©'} les droits admin Ã  ${target.username}`,
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
      socket.emit('admin_action_result', { success: true, msg: `Utilisateur "${target.username}" supprimÃ©.` });
      const users = await User.find({}, 'username isAdmin createdAt').sort({ username: 1 });
      socket.emit('admin_users_data', users);
      await logAdminAction({
          actorUser: user,
          actionType: 'user_deleted',
          targetType: 'user',
          targetId: String(target._id),
          targetLabel: target.username,
          message: `${user.username} a supprimÃ© l'utilisateur ${target.username}`,
          meta: { redirectView: 'admin', redirectData: null }
      });
  });

  socket.on('admin_clear_all_posts', async () => {
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;
      await Post.deleteMany({ isArticle: { $ne: true } });
      io.emit('reload_posts');
      socket.emit('admin_action_result', { success: true, msg: 'Tous les posts supprimÃ©s.' });
      await broadcastWorldTimeline();
      await logAdminAction({
          actorUser: user,
          actionType: 'posts_cleared',
          targetType: 'feed',
          targetLabel: 'Flux social',
          message: `${user.username} a vidÃ© tout le flux social`,
          meta: { redirectView: 'feed', redirectData: null }
      });
  });
  // ========== [FIN ADMIN PANEL SOCKET] ==========
  });
};
