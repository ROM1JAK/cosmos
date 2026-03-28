const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const mongoose = require('mongoose');

const FRONTEND_URL = process.env.FRONTEND_URL;
const allowedOrigins = [
	FRONTEND_URL,
	'http://localhost:3000',
	'http://127.0.0.1:3000'
].filter(Boolean);

const io = require('socket.io')(http, {
	maxHttpBufferSize: 10e6,
	cors: {
		origin(origin, callback) {
			if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
			return callback(new Error('Origin non autorisee par Socket.IO'));
		},
		methods: ['GET', 'POST'],
		credentials: true
	}
});

app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

// CONFIGURATION
const ADMIN_CODE = 'ADMIN';
const mongoURI = process.env.MONGO_URI;

if (!mongoURI) console.error('ERREUR : Variable MONGO_URI manquante.');
else mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
	.then(() => console.log('Connecte a MongoDB.'))
	.catch(err => console.error('Erreur MongoDB:', err));

// --- MODELES ---
const User = require('./models/User');
const Character = require('./models/Character');
const Alert = require('./models/Alert');
const Message = require('./models/Message');
const MessageArchive = require('./models/MessageArchive');
const Room = require('./models/Room');
const Post = require('./models/Post');
const OmbraMessage = require('./models/OmbraMessage');
const Event = require('./models/Event');
const Notification = require('./models/Notification');
const AdminLog = require('./models/AdminLog');

// ========== [CITES] ==========
const City = require('./models/City');
const CityRelation = require('./models/CityRelation');

// ========== [BOURSE] ==========
const Stock = require('./models/Stock');

// ========== [WIKI] ==========
const WikiPage = require('./models/WikiPage');
const initSocketHandlers = require('./socketHandler');

const MESSAGE_ARCHIVE_AFTER_DAYS = Math.max(1, Number(process.env.MESSAGE_ARCHIVE_AFTER_DAYS || 45));
const MESSAGE_ARCHIVE_BATCH_SIZE = Math.max(100, Number(process.env.MESSAGE_ARCHIVE_BATCH_SIZE || 500));
const MESSAGE_ARCHIVE_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.MESSAGE_ARCHIVE_INTERVAL_MS || 6 * 60 * 60 * 1000));
const MESSAGE_ARCHIVE_PAGE_SIZE = Math.max(20, Number(process.env.MESSAGE_ARCHIVE_PAGE_SIZE || 50));

const CITIES_SEED = [
	{ name: 'Aguerta', archipel: 'Archipel Pacifique' },
	{ name: 'Arva', archipel: 'Archipel Pacifique' },
	{ name: 'Aurion', archipel: 'Archipel Pacifique' },
	{ name: 'Cellum', archipel: 'Archipel Pacifique' },
	{ name: 'Elvita', archipel: 'Archipel Pacifique' },
	{ name: 'Hoross', archipel: 'Archipel Pacifique' },
	{ name: 'Kama', archipel: 'Archipel Pacifique' },
	{ name: 'Lesetha', archipel: 'Archipel Pacifique' },
	{ name: 'Ofarno', archipel: 'Archipel Pacifique' },
	{ name: 'Orchadia', archipel: 'Archipel Pacifique' },
	{ name: 'Otima', archipel: 'Archipel Pacifique' },
	{ name: 'Qruving', archipel: 'Archipel Pacifique' },
	{ name: 'Shamballa', archipel: 'Archipel Pacifique' },
	{ name: 'Sioonok', archipel: 'Archipel Pacifique' },
	{ name: 'Tellos', archipel: 'Archipel Pacifique' },
	{ name: 'Tesmond', archipel: 'Archipel Pacifique' },
	{ name: 'Utopia', archipel: 'Archipel Pacifique' },
	{ name: 'Worford', archipel: 'Archipel Pacifique' },
	{ name: 'Burtharb', archipel: 'Ancienne Archipel' },
	{ name: 'Buswax', archipel: 'Ancienne Archipel' },
	{ name: 'Hertford', archipel: 'Ancienne Archipel' },
	{ name: 'Horsmouthia', archipel: 'Ancienne Archipel' },
	{ name: 'Panviles', archipel: 'Ancienne Archipel' },
	{ name: 'Alburg', archipel: 'Archipel Sableuse' },
	{ name: 'Bambeween', archipel: 'Archipel Sableuse' },
	{ name: 'Bireland', archipel: 'Archipel Sableuse' },
	{ name: 'Kirchia', archipel: 'Archipel Sableuse' },
	{ name: 'Pagoas Sud', archipel: 'Archipel Sableuse' },
	{ name: 'Pagoas Nord', archipel: 'Archipel Sableuse' },
];

async function getRecentMessages(query, limit = 200) {
	const messages = await Message.find(query).sort({ timestamp: -1 }).limit(limit).lean();
	return messages.reverse();
}

async function getLatestCharConversations(Model, myCharIds) {
	if (!myCharIds || !myCharIds.length) return [];
	const normalizedCharIds = myCharIds.map(String);
	return Model.aggregate([
		{
			$match: {
				isCharDm: true,
				$or: [
					{ senderCharId: { $in: normalizedCharIds } },
					{ targetCharId: { $in: normalizedCharIds } }
				]
			}
		},
		{
			$addFields: {
				myCharId: {
					$cond: [
						{ $in: ['$senderCharId', normalizedCharIds] },
						'$senderCharId',
						'$targetCharId'
					]
				},
				otherCharId: {
					$cond: [
						{ $in: ['$senderCharId', normalizedCharIds] },
						'$targetCharId',
						'$senderCharId'
					]
				},
				otherNameSnapshot: {
					$cond: [
						{ $in: ['$senderCharId', normalizedCharIds] },
						'$targetName',
						'$senderName'
					]
				},
				otherOwnerIdSnapshot: {
					$cond: [
						{ $in: ['$senderCharId', normalizedCharIds] },
						'$targetOwnerId',
						'$ownerId'
					]
				}
			}
		},
		{ $sort: { timestamp: -1 } },
		{
			$group: {
				_id: { myCharId: '$myCharId', otherCharId: '$otherCharId' },
				myCharId: { $first: '$myCharId' },
				otherCharId: { $first: '$otherCharId' },
				otherName: { $first: '$otherNameSnapshot' },
				otherOwnerId: { $first: '$otherOwnerIdSnapshot' },
				lastDate: { $first: '$timestamp' },
				lastContent: { $first: '$content' }
			}
		},
		{ $sort: { lastDate: -1 } }
	]);
}

async function getArchivedCharDmPage(senderCharId, targetCharId, page = 0, pageSize = MESSAGE_ARCHIVE_PAGE_SIZE) {
	const roomId = `char_dm_${[senderCharId, targetCharId].sort().join('_')}`;
	const safePage = Math.max(0, Number(page) || 0);
	const safePageSize = Math.max(20, Math.min(100, Number(pageSize) || MESSAGE_ARCHIVE_PAGE_SIZE));
	const query = { roomId, isCharDm: true };
	const [items, total] = await Promise.all([
		MessageArchive.find(query)
			.sort({ timestamp: -1 })
			.skip(safePage * safePageSize)
			.limit(safePageSize)
			.lean(),
		MessageArchive.countDocuments(query)
	]);

	return {
		roomId,
		items: items.reverse(),
		total,
		page: safePage,
		pageSize: safePageSize,
		hasMore: (safePage + 1) * safePageSize < total
	};
}

function mergeMessagesByTimestampDesc(left, right) {
	const merged = [];
	let leftIndex = 0;
	let rightIndex = 0;

	while (leftIndex < left.length && rightIndex < right.length) {
		const leftTime = new Date(left[leftIndex].timestamp || 0).getTime();
		const rightTime = new Date(right[rightIndex].timestamp || 0).getTime();
		if (leftTime >= rightTime) {
			merged.push(left[leftIndex]);
			leftIndex += 1;
		} else {
			merged.push(right[rightIndex]);
			rightIndex += 1;
		}
	}

	while (leftIndex < left.length) {
		merged.push(left[leftIndex]);
		leftIndex += 1;
	}

	while (rightIndex < right.length) {
		merged.push(right[rightIndex]);
		rightIndex += 1;
	}

	return merged;
}

let messageArchiveInProgress = false;

const BOURSE_LOG_ACTION_TYPES = [
	'stock_created',
	'stock_updated',
	'stock_trend_applied',
	'stock_custom_applied',
	'stock_deleted',
	'stock_history_reset',
	'trading_day_advanced',
	'company_revenue_set',
	'company_updated'
];

async function archiveOldMessages() {
	if (messageArchiveInProgress) return;

	messageArchiveInProgress = true;
	try {
		const cutoff = new Date(Date.now() - (MESSAGE_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000));
		let archivedCount = 0;

		while (true) {
			const oldMessages = await Message.find({ timestamp: { $lt: cutoff } })
				.sort({ timestamp: 1 })
				.limit(MESSAGE_ARCHIVE_BATCH_SIZE)
				.lean();

			if (!oldMessages.length) break;

			const archiveStamp = new Date();
			const archiveOperations = oldMessages.map(({ _id, ...message }) => ({
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
			await Message.deleteMany({ _id: { $in: oldMessages.map(message => message._id) } });
			archivedCount += oldMessages.length;

			if (oldMessages.length < MESSAGE_ARCHIVE_BATCH_SIZE) break;
		}

		if (archivedCount > 0) {
			console.log(`[messages] ${archivedCount} message(s) archives avant ${cutoff.toISOString()}`);
		}
	} catch (error) {
		console.error('Erreur archivage messages:', error);
	} finally {
		messageArchiveInProgress = false;
	}
}

async function purgeBourseAdminLogs() {
	await AdminLog.deleteMany({
		$or: [
			{ timelineType: 'market' },
			{ actionType: { $in: BOURSE_LOG_ACTION_TYPES } },
			{ 'meta.redirectView': 'bourse' }
		]
	});
}

mongoose.connection.once('open', async () => {
	try {
		await Message.createIndexes();
		await MessageArchive.createIndexes();
		await purgeBourseAdminLogs();
	} catch (error) {
		console.error('Erreur lors de la creation des index de messages:', error);
	}

	setTimeout(() => { archiveOldMessages(); }, 10 * 1000);
	setInterval(() => { archiveOldMessages(); }, MESSAGE_ARCHIVE_INTERVAL_MS);

	for (const c of CITIES_SEED) {
		const exists = await City.findOne({ name: c.name });
		if (!exists) await City.create({ ...c, baseEDC: 1000000000000, historyEDC: [{ value: 1000000000000 }] });
	}
});

let onlineUsers = {};

async function applyStockValueChange(stock, oldValue, newValue) {
	if (!stock.charId || !oldValue || oldValue === newValue) return;
	const pct = (newValue - oldValue) / oldValue;
	if (Math.abs(pct) < 0.00001) return;
	const amplifiedPct = pct;
	try {
		const char = await Character.findById(stock.charId);
		if (!char) return;
		let changed = false;
		if ((char.capital || 0) > 0) {
			char.capital = Math.round(char.capital * (1 + amplifiedPct) * 100) / 100;
			changed = true;
		}
		if (char.companies && char.companies.length > 0) {
			char.companies.forEach(co => {
				if (co.name === stock.companyName && (co.revenue || 0) > 0) {
					co.revenue = Math.round(co.revenue * (1 + amplifiedPct) * 100) / 100;
					changed = true;
				}
			});
		}
		if (changed) {
			char.markModified('companies');
			await char.save();
			io.emit('char_updated', char.toObject());
		}
	} catch (e) {
		console.error('applyStockValueChange error:', e);
	}
}

async function getEnrichedStocks() {
	const stocks = await Stock.find().sort({ companyName: 1 });
	const charIds = [...new Set(stocks.filter(s => s.charId).map(s => String(s.charId)))];
	if (!charIds.length) return stocks.map(s => s.toObject());
	const chars = await Character.find({ _id: { $in: charIds } }).select('_id companies capital');
	const charMap = {};
	chars.forEach(c => { charMap[String(c._id)] = c; });
	return stocks.map(s => {
		const obj = s.toObject();
		const char = charMap[String(s.charId)];
		if (char) {
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
	if (!targetId || targetId === ADMIN_CODE) return;
	const notif = new Notification({ targetOwnerId: targetId, type, content, fromName, redirectView, redirectData });
	await notif.save();
	io.emit('notification_dispatch', notif);
}

async function getSocketUser(socket) {
	const username = onlineUsers[socket.id];
	if (!username) return null;
	return User.findOne({ username });
}

async function emitToAdmins(eventName, payload) {
	const onlineNames = [...new Set(Object.values(onlineUsers).filter(Boolean))];
	if (!onlineNames.length) return;
	const admins = await User.find({ username: { $in: onlineNames }, isAdmin: true }).select('username');
	const adminNames = new Set(admins.map(user => user.username));
	Object.entries(onlineUsers).forEach(([socketId, username]) => {
		if (adminNames.has(username)) io.to(socketId).emit(eventName, payload);
	});
}

function extractArticleTitle(content = '') {
	const titleMatch = content.match(/^\[TITRE\](.*?)\[\/TITRE\]\n?([\s\S]*)/);
	if (titleMatch) return titleMatch[1].trim();
	return content.split(/\s+/).slice(0, 10).join(' ').trim();
}

function extractTextPreview(text = '', length = 120) {
	return String(text).replace(/\[TITRE\].*?\[\/TITRE\]\n?/g, '').replace(/\s+/g, ' ').trim().slice(0, length);
}

function getObjectDate(value) {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	if (typeof value === 'string' && value.length >= 8) {
		const timestamp = parseInt(value.slice(0, 8), 16);
		if (!Number.isNaN(timestamp)) return new Date(timestamp * 1000);
	}
	return new Date();
}

function buildDisplayPost(post, authorChar = null) {
	const displayPost = post.toObject ? post.toObject() : { ...post };
	if (displayPost.isAnonymous) {
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
	if (authorIds.length) {
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
	return AdminLog.find({ timelineType: { $ne: 'market' } }).sort({ createdAt: -1 }).limit(limit);
}

async function broadcastAdminLogs() {
	await emitToAdmins('admin_logs_data', await getRecentAdminLogs());
}

async function buildWorldTimeline(limit = 28) {
	const [posts, articles, events, logs] = await Promise.all([
		Post.find({ isArticle: { $ne: true } }).sort({ timestamp: -1 }).limit(12),
		Post.find({ isArticle: true }).sort({ isHeadline: -1, timestamp: -1 }).limit(10),
		Event.find().sort({ timestamp: -1, _id: -1 }).limit(10),
		AdminLog.find({ includeInTimeline: true, timelineType: { $ne: 'market' } }).sort({ createdAt: -1 }).limit(12)
	]);

	const items = [
		...posts.map(post => ({
			id: `post:${post._id}`,
			type: 'post',
			tone: post.isBreakingNews ? 'alert' : post.isAnonymous ? 'leak' : 'post',
			timestamp: post.timestamp || getObjectDate(String(post._id)),
			title: post.isBreakingNews
				? `${post.authorName || 'Un personnage'} publie une breaking news`
				: `${post.authorName || 'Un personnage'} publie sur le reseau`,
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
			title: event.evenement || 'Nouvel evenement',
			summary: [event.date, event.heure].filter(Boolean).join(' · ') || 'Actualite publiee',
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
	if (!actorUser || !message) return null;
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
	if (includeInTimeline) await broadcastWorldTimeline();
	return log;
}

initSocketHandlers({
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
	Stock,
	WikiPage,
	onlineUsers,
	getRecentMessages,
	getLatestCharConversations,
	getArchivedCharDmPage,
	getFeedPosts,
	buildWorldTimeline,
	getSocketUser,
	logAdminAction,
	buildDisplayPost,
	getEnrichedStocks,
	createNotification,
	extractArticleTitle,
	broadcastWorldTimeline,
	broadcastAdminLogs,
	getRecentAdminLogs,
	applyStockValueChange,
	broadcastUserList
});

http.listen(process.env.PORT || 3000, () => console.log('Serveur lance sur http://localhost:3000'));

module.exports = { app, http, io, mongoose };