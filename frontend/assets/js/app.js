const backendUrl = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_URL) || window.location.origin;
var socket = io(backendUrl, { transports: ['websocket', 'polling'] });
const notifSound = new Audio('https://cdn.discordapp.com/attachments/1323488087288053821/1443747694408503446/notif.mp3?ex=692adb11&is=69298991&hm=8e0c05da67995a54740ace96a2e4630c367db762c538c2dffc11410e79678ed5&'); 

const CLOUDINARY_BASE_URL = 'https://api.cloudinary.com/v1_1/dllr3ugxz'; 
const CLOUDINARY_PRESET = 'Cosmos';

// --- DATA ---
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentDmTarget = null; 
let PLAYER_ID; 
let USERNAME; 
let IS_ADMIN = false;
let currentContext = null; 
let typingTimeout = null;
let unreadRooms = new Set();
let unreadDms = new Set(); 
let dmContacts = []; 
let firstUnreadMap = {}; 
let currentView = 'accueil'; 
let notificationsEnabled = true; 
let currentSelectedChar = null; 
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let allOnlineUsers = [];
let feedPostsCache = [];
const FEED_VISIBLE_POST_LIMIT = 10;
const FEED_VISIBLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_ACTIVITY_PAGE_SIZE = 6;
const RESEAU_RAIL_STORAGE_KEY = 'reseau_rail_state';
let eventsCache = [];
let presseArticlesCache = [];
let liveNewsCache = [];
let worldTimelineCache = [];
let adminLogsCache = [];
let presseJournalFilter = '';
let presseUxBound = false;
let expandedAdminUserId = localStorage.getItem('admin_expanded_user_id') || null;
let isBourseRankingCollapsed = localStorage.getItem('bourse_ranking_collapsed') === '1';
let currentAdminTab = localStorage.getItem('admin_current_tab') || 'overview';
let bourseFilter = localStorage.getItem('bourse_filter') || 'all';
let boursePulseTimeout = null;
let isAccueilTimelineCollapsed = localStorage.getItem('accueil_timeline_collapsed') === '1';
let isFeedFiltersPopoverOpen = false;
let isFeedProfileSearchPopoverOpen = false;
let feedFilters = (() => {
    try {
        return {
            official: false,
            following: false,
            anonymous: false,
            breaking: false,
            sponsored: false,
            companies: false,
            ...JSON.parse(localStorage.getItem('feed_filters') || '{}')
        };
    } catch (error) {
        return { official: false, following: false, anonymous: false, breaking: false, sponsored: false, companies: false };
    }
})();

// FEED IDENTITY
let currentFeedCharId = null;
let feedTypers = new Set();
let feedTypingTimeout = null;

let pendingAttachment = null; 
let pendingCommentAttachment = null;
let lastMessageData = { author: null, time: 0, ownerId: null };
const CHAT_PAGE_SIZE = 20;
let currentChatMessages = [];
let chatHistoryState = { mode: 'room', key: 'room:global', page: 0, hasMore: false, total: 0 };
let currentProfileActivityPage = 1;
let isReseauRailExpanded = localStorage.getItem(RESEAU_RAIL_STORAGE_KEY) === 'expanded';
let pollOptions = [];
let pollUIOpen = false; 
let isTopNavMenuOpen = false;
let currentRepostTarget = null;
let currentEditingPostId = null;
const quotedPostSnapshotCache = new Map();

// OMBRA
let ombraAlias = null;
let ombraHistory = [];

// PRESSE
let currentPresseCharId = null;
let currentPresseTheme = null;
let currentEditArticleTheme = null;
let currentArticleFullscreenId = null;
let isPresseComposerOpen = false;
let isLiveNewsComposerOpen = false;
let isLiveNewsPanelOpen = false;
let isCosmosTensionPanelOpen = false;
let liveNewsHasUnread = false;
let liveNewsBootstrapped = false;
let liveNewsUnreadIds = new Set();
let cosmosTensionCache = null;

function isJournalistCharacter(char) {
    const role = String(char?.role || '').toLowerCase();
    return role.includes('journaliste') || role.includes('presse');
}

function normalizeLiveNewsArticles(articles) {
    return (Array.isArray(articles) ? articles : [])
        .filter(article => article?.isLiveNews)
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0))
        .slice(0, LIVE_NEWS_MAX_ITEMS);
}

function openLiveNewsArticle(postId) {
    liveNewsHasUnread = false;
    isLiveNewsPanelOpen = false;
    renderLiveNewsTicker();
    const item = liveNewsCache.find(article => String(article._id) === String(postId));
    if(item && !item.isArticle) {
        openStandaloneLiveNewsModal(postId);
        return;
    }
    switchView('presse');
    setTimeout(() => openArticleFullscreen(postId), 90);
}

function openStandaloneLiveNewsModal(postId) {
    const item = liveNewsCache.find(article => String(article._id) === String(postId) && !article.isArticle);
    const modal = document.getElementById('live-news-standalone-modal');
    const title = document.getElementById('live-news-standalone-title');
    const meta = document.getElementById('live-news-standalone-meta');
    const body = document.getElementById('live-news-standalone-body');
    const actions = document.getElementById('live-news-standalone-actions');
    if(!item || !modal || !title || !meta || !body || !actions) return;
    liveNewsUnreadIds.delete(String(postId));
    title.textContent = String(item.liveNewsText || item.content || 'News en direct').trim() || 'News en direct';
    meta.innerHTML = [
        item.authorName ? `<span><i class="fa-solid fa-user-pen"></i> ${escapeHtml(item.authorName)}</span>` : '',
        item.journalName ? `<span><i class="fa-solid fa-newspaper"></i> ${escapeHtml(item.journalName)}</span>` : '',
        item.date ? `<span><i class="fa-regular fa-clock"></i> ${escapeHtml(item.date)}</span>` : ''
    ].filter(Boolean).join('');
    body.innerHTML = `<p>${escapeHtml(String(item.liveNewsText || item.content || '').trim())}</p>`;
    const canDelete = !item.isArticle && (IS_ADMIN || String(item.ownerId || '') === String(PLAYER_ID || ''));
    actions.classList.toggle('hidden', !canDelete);
    actions.innerHTML = canDelete
        ? `<button type="button" class="btn-secondary" onclick="deleteOwnLiveNews('${String(item._id).replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i> Supprimer cette info</button>`
        : '';
    modal.classList.remove('hidden');
}

function closeStandaloneLiveNewsModal() {
    document.getElementById('live-news-standalone-modal')?.classList.add('hidden');
    renderLiveNewsTicker();
}

function deleteOwnLiveNews(postId) {
    if(!postId) return;
    if(!confirm('Supprimer cette info du direct ?')) return;
    closeStandaloneLiveNewsModal();
    socket.emit('delete_post', { postId, ownerId: PLAYER_ID });
}

function renderCosmosTensionWidget() {
    const root = document.getElementById('cosmos-tension-widget');
    const fab = document.getElementById('cosmos-tension-fab');
    const panel = document.getElementById('cosmos-tension-panel');
    const value = document.getElementById('cosmos-tension-value');
    const level = document.getElementById('cosmos-tension-level');
    const risk = document.getElementById('cosmos-tension-risk');
    const summary = document.getElementById('cosmos-tension-summary');
    const factors = document.getElementById('cosmos-tension-factors');
    const updated = document.getElementById('cosmos-tension-updated');
    if(!root || !fab || !panel || !value || !level || !risk || !summary || !factors || !updated) return;
    if(!cosmosTensionCache || typeof cosmosTensionCache.value !== 'number') {
        root.classList.add('hidden');
        panel.classList.add('hidden');
        return;
    }

    root.classList.remove('hidden');
    panel.classList.toggle('hidden', !isCosmosTensionPanelOpen);
    fab.setAttribute('aria-expanded', isCosmosTensionPanelOpen ? 'true' : 'false');
    fab.classList.remove('is-low', 'is-guarded', 'is-elevated', 'is-high', 'is-critical');
    fab.classList.add(`is-${cosmosTensionCache.level || 'low'}`);
    fab.style.setProperty('--tension-progress', `${Math.max(0, Math.min(100, Number(cosmosTensionCache.value) || 0))}%`);

    value.textContent = cosmosTensionCache.label || `${Math.round(cosmosTensionCache.value)}%`;
    level.textContent = cosmosTensionCache.levelLabel || 'Tension du Cosmos';
    risk.textContent = cosmosTensionCache.riskLabel || '';
    summary.textContent = cosmosTensionCache.summary || '';

    const factorMarkup = (Array.isArray(cosmosTensionCache.factors) ? cosmosTensionCache.factors : []).map(factor => {
        const rawValue = Number(factor?.value || 0);
        const fillWidth = Math.max(0, Math.min(100, Math.abs(rawValue) * 4));
        const valueClass = rawValue < 0 ? 'is-negative' : 'is-positive';
        const sign = rawValue > 0 ? '+' : '';
        return `
            <div class="cosmos-tension-factor">
                <div class="cosmos-tension-factor-head">
                    <span class="cosmos-tension-factor-name">${escapeHtml(String(factor?.label || 'Facteur'))}</span>
                    <span class="cosmos-tension-factor-value ${valueClass}">${sign}${Math.round(rawValue)}</span>
                </div>
                <div class="cosmos-tension-factor-bar">
                    <div class="cosmos-tension-factor-fill" style="width:${fillWidth}%;"></div>
                </div>
                <div class="cosmos-tension-factor-detail">${escapeHtml(String(factor?.detail || ''))}</div>
            </div>`;
    }).join('');
    factors.innerHTML = factorMarkup || '<div class="cosmos-tension-factor"><div class="cosmos-tension-factor-detail">Aucun facteur disponible.</div></div>';

    const updatedAt = cosmosTensionCache.updatedAt ? new Date(cosmosTensionCache.updatedAt) : null;
    updated.textContent = updatedAt && !Number.isNaN(updatedAt.getTime())
        ? `Mise a jour ${updatedAt.toLocaleDateString('fr-FR')} a ${updatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        : '';
}

function toggleCosmosTensionPanel(forceOpen) {
    if(typeof forceOpen === 'boolean') isCosmosTensionPanelOpen = forceOpen;
    else isCosmosTensionPanelOpen = !isCosmosTensionPanelOpen;
    renderCosmosTensionWidget();
}

function renderLiveNewsTicker() {
    const root = document.getElementById('live-news-widget');
    const fab = document.getElementById('live-news-fab');
    const panel = document.getElementById('live-news-panel');
    const list = document.getElementById('live-news-list');
    const count = document.getElementById('live-news-fab-count');
    if(!root || !fab || !panel || !list || !count) return;
    if(!liveNewsCache.length) {
        root.classList.add('hidden');
        panel.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    root.classList.remove('hidden');
    fab.classList.toggle('is-lit', liveNewsHasUnread);
    fab.setAttribute('aria-expanded', isLiveNewsPanelOpen ? 'true' : 'false');
    panel.classList.toggle('hidden', !isLiveNewsPanelOpen);
    count.textContent = String(liveNewsCache.length);
    const itemsMarkup = liveNewsCache.map(article => {
        const liveLabel = String(article.liveNewsText || '').trim();
        const title = escapeHtml(liveLabel || article.journalName || 'News en direct');
        const meta = escapeHtml(article.journalName || article.authorName || 'Presse');
        const isUnread = liveNewsUnreadIds.has(String(article._id));
        const dateLabel = escapeHtml(article.date || '');
        const canDelete = !article.isArticle && (IS_ADMIN || String(article.ownerId || '') === String(PLAYER_ID || ''));
        return `
            <div class="live-news-row">
                <button type="button" class="live-news-item" onclick="openLiveNewsArticle('${String(article._id).replace(/'/g, "\\'")}')">
                    <span class="live-news-item-label">Live</span>
                    <i class="fa-solid fa-arrow-right live-news-item-icon"></i>
                    <span class="live-news-item-content">
                        <span class="live-news-item-title">${title}</span>
                        <span class="live-news-item-meta-row">
                            <span class="live-news-item-meta">${meta}</span>
                            ${dateLabel ? `<span class="live-news-item-time">${dateLabel}</span>` : ''}
                            ${isUnread ? '<span class="live-news-item-badge">Nouveau</span>' : ''}
                        </span>
                    </span>
                </button>
                ${canDelete ? `<button type="button" class="live-news-delete-btn" onclick="event.stopPropagation(); deleteOwnLiveNews('${String(article._id).replace(/'/g, "\\'")}')" title="Supprimer cette info"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>`;
    }).join('');
    list.innerHTML = itemsMarkup || '<div class="live-news-list-empty">Aucun direct en cours.</div>';
}

function updatePresseLiveToggleUI() {
    const toggle = document.getElementById('presse-live-compose-toggle');
    const box = document.getElementById('presse-live-compose-box');
    const count = document.getElementById('presse-live-news-count');
    const submitButton = document.getElementById('presse-live-submit');
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    const canUseLive = !!char && isJournalistCharacter(char);
    if(!toggle || !box || !count || !submitButton) return;
    toggle.classList.toggle('hidden', !canUseLive);
    box.classList.toggle('hidden', !canUseLive || !isLiveNewsComposerOpen);
    const liveCount = liveNewsCache.length;
    count.textContent = `${liveCount}/${LIVE_NEWS_MAX_ITEMS}`;
    count.classList.toggle('is-full', liveCount >= LIVE_NEWS_MAX_ITEMS);
    submitButton.disabled = liveCount >= LIVE_NEWS_MAX_ITEMS;
    toggle.innerHTML = isLiveNewsComposerOpen
        ? '<i class="fa-solid fa-xmark"></i> Fermer le direct'
        : '<i class="fa-solid fa-tower-broadcast"></i> Mettre en direct';
}

function toggleLiveNewsComposer() {
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    if(!char || !isJournalistCharacter(char)) return;
    isLiveNewsComposerOpen = !isLiveNewsComposerOpen;
    updatePresseLiveToggleUI();
}

function toggleLiveNewsPanel(forceOpen) {
    if(typeof forceOpen === 'boolean') isLiveNewsPanelOpen = forceOpen;
    else isLiveNewsPanelOpen = !isLiveNewsPanelOpen;
    if(isLiveNewsPanelOpen) liveNewsHasUnread = false;
    renderLiveNewsTicker();
    if(isLiveNewsPanelOpen && liveNewsUnreadIds.size) liveNewsUnreadIds.clear();
}

function toggleArticleLiveNews(postId, value) {
    if(!IS_ADMIN) return;
    socket.emit('set_live_news', { postId, value });
}

// ACTUALITÉS
let actuRequestPending = false;

const RECENT_VIEW_RESTORE_WINDOW_MS = Math.max(5000, Number((window.APP_CONFIG && window.APP_CONFIG.RECENT_VIEW_RESTORE_WINDOW_MS) || (2 * 60 * 1000)));

const COMMON_EMOJIS = ["😀", "😂", "😉", "😍", "😎", "🥳", "😭", "😡", "🤔", "👍", "👎", "❤️", "💔", "🔥", "✨", "🎉", "💩", "👻", "💀", "👽", "🤖", "👋", "🙌", "🙏", "💪", "👀", "🍕", "🍻", "🚀", "💯"];
const RECENT_ACTIVITY_STORAGE_KEY = 'recent_activity_v1';
const FAVORITES_STORAGE_KEY = 'favorites_v1';
const DRAFTS_STORAGE_KEY = 'drafts_v1';
const NOTIFICATION_FILTER_STORAGE_KEY = 'notif_filter_v1';
const GLOBAL_SEARCH_MAX_RESULTS = 24;
const LIVE_NEWS_MAX_ITEMS = 5;

let globalSearchFilter = 'all';
let currentNotificationFilter = localStorage.getItem(NOTIFICATION_FILTER_STORAGE_KEY) || 'all';
let recentActivity = loadJsonStorage(RECENT_ACTIVITY_STORAGE_KEY, []);
let favoritesState = normalizeFavoritesState(loadJsonStorage(FAVORITES_STORAGE_KEY, null));
let draftsState = loadJsonStorage(DRAFTS_STORAGE_KEY, {});

function loadJsonStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function saveJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function normalizeFavoritesState(value) {
    return {
        character: Array.isArray(value?.character) ? value.character : [],
        city: Array.isArray(value?.city) ? value.city : [],
        stock: Array.isArray(value?.stock) ? value.stock : [],
        wiki: Array.isArray(value?.wiki) ? value.wiki : [],
        article: Array.isArray(value?.article) ? value.article : [],
        post: Array.isArray(value?.post) ? value.post : []
    };
}

function saveFavoritesState() {
    saveJsonStorage(FAVORITES_STORAGE_KEY, favoritesState);
    if(currentView === 'accueil') renderAccueil();
}

function saveDraftsState() {
    saveJsonStorage(DRAFTS_STORAGE_KEY, draftsState);
}

function setDraftValue(key, value) {
    draftsState[key] = value;
    saveDraftsState();
}

function clearDraftValue(key) {
    delete draftsState[key];
    saveDraftsState();
}

function isFavoriteItem(type, id) {
    return normalizeFavoritesState(favoritesState)[type].some(item => String(item.id) === String(id));
}

function toggleFavoriteItem(type, id, label, meta = '') {
    const bucket = normalizeFavoritesState(favoritesState)[type];
    const existingIndex = bucket.findIndex(item => String(item.id) === String(id));
    if(existingIndex >= 0) bucket.splice(existingIndex, 1);
    else bucket.unshift({ id: String(id), label, meta, savedAt: Date.now() });
    favoritesState[type] = bucket.slice(0, 16);
    saveFavoritesState();
}

function addRecentActivity(entry) {
    if(!entry || !entry.type || entry.id == null) return;
    recentActivity = recentActivity.filter(item => !(item.type === entry.type && String(item.id) === String(entry.id)));
    recentActivity.unshift({ ...entry, id: String(entry.id), timestamp: Date.now() });
    recentActivity = recentActivity.slice(0, 14);
    saveJsonStorage(RECENT_ACTIVITY_STORAGE_KEY, recentActivity);
    if(currentView === 'accueil') renderAccueil();
}

function getRecentActivityItems() {
    return Array.isArray(recentActivity) ? recentActivity : [];
}

function openRecentItem(type, id) {
    if(type === 'character') {
        const char = myCharacters.find(item => String(item._id) === String(id));
        openProfile(char ? char.name : id);
        return;
    }
    if(type === 'post') {
        openTimelineTarget('feed', { postId: id });
        return;
    }
    if(type === 'article') {
        switchView('presse');
        setTimeout(() => openArticleFullscreen(id), 90);
        return;
    }
    if(type === 'city') {
        const city = citiesData.find(item => String(item._id) === String(id));
        if(city) {
            switchView('cites');
            setTimeout(() => openCityDetail(city), 90);
        }
        return;
    }
    if(type === 'stock') {
        switchView('bourse');
        setTimeout(() => openStockDetail(String(id)), 90);
        return;
    }
    if(type === 'wiki') {
        switchView('wiki');
        setTimeout(() => openWikiPage(String(id)), 90);
    }
}

function getFavoriteEntity(type, id) {
    if(type === 'character') return myCharacters.find(item => String(item._id) === String(id)) || null;
    if(type === 'city') return citiesData.find(item => String(item._id) === String(id)) || null;
    if(type === 'stock') return stocksData.find(item => String(item._id) === String(id)) || null;
    if(type === 'wiki') return wikiCache.find(item => String(item._id) === String(id)) || null;
    if(type === 'article') return presseArticlesCache.find(item => String(item._id) === String(id)) || null;
    if(type === 'post') return feedPostsCache.find(item => String(item._id) === String(id)) || null;
    return null;
}

function getSearchCollectionEntries() {
    const entries = [];
    myCharacters.forEach(char => entries.push({
        type: 'character',
        id: char._id,
        label: char.name,
        meta: char.role || 'Personnage',
        keywords: `${char.name} ${char.role || ''} ${char.partyName || ''} personnage profil`,
        color: char.color || 'white'
    }));
    feedPostsCache.forEach(post => entries.push({
        type: 'post',
        id: post._id,
        label: post.authorName || 'Post',
        meta: extractTextPreview(post.content || '', 92) || 'Post du réseau',
        keywords: `${post.authorName || ''} ${post.content || ''} ${post.linkedCompanyName || ''} post reseau`,
        color: post.authorColor || 'white'
    }));
    getVisiblePresseArticles().forEach(article => {
        const { titleText } = parseArticleContent(article.content || '');
        entries.push({
            type: 'article',
            id: article._id,
            label: titleText || article.journalName || 'Article',
            meta: article.journalName || article.authorName || 'Presse',
            keywords: `${titleText || ''} ${article.journalName || ''} ${article.authorName || ''} ${getArticleExcerpt(article.content || '', 140)} presse article`,
            color: 'white'
        });
    });
    citiesData.forEach(city => entries.push({
        type: 'city',
        id: city._id,
        label: city.name,
        meta: city.archipel || 'Cité',
        keywords: `${city.name} ${city.archipel || ''} ${city.president || ''} cite geopolitique`,
        color: 'white'
    }));
    stocksData.forEach(stock => entries.push({
        type: 'stock',
        id: stock._id,
        label: stock.companyName,
        meta: stock.charName || 'Entreprise',
        keywords: `${stock.companyName || ''} ${stock.charName || ''} ${stock.description || ''} bourse entreprise`,
        color: stock.charColor || 'white'
    }));
    wikiCache.forEach(page => entries.push({
        type: 'wiki',
        id: page._id,
        label: page.title,
        meta: page.category || 'Wiki',
        keywords: `${page.title || ''} ${page.category || ''} ${page.content || ''} wiki page`,
        color: 'white'
    }));
    return entries;
}

function getGlobalSearchTypes() {
    return {
        all: 'Tout',
        character: 'Persos',
        post: 'Posts',
        article: 'Presse',
        city: 'Cités',
        stock: 'Bourse',
        wiki: 'Wiki'
    };
}

function renderGlobalSearchChips() {
    const container = document.getElementById('global-search-chips');
    if(!container) return;
    const labels = getGlobalSearchTypes();
    container.innerHTML = Object.entries(labels).map(([key, label]) => `
        <button type="button" class="global-search-chip ${globalSearchFilter === key ? 'active' : ''}" onclick="setGlobalSearchFilter('${key}')">${label}</button>`).join('');
}

function setGlobalSearchFilter(filter) {
    globalSearchFilter = filter;
    renderGlobalSearchChips();
    handleGlobalSearchInput(document.getElementById('globalSearchInput')?.value || '');
}

function getFilteredGlobalSearchEntries(query) {
    const normalized = String(query || '').trim().toLowerCase();
    let entries = getSearchCollectionEntries();
    if(globalSearchFilter !== 'all') entries = entries.filter(item => item.type === globalSearchFilter);
    if(!normalized) return entries.slice(0, GLOBAL_SEARCH_MAX_RESULTS);
    return entries
        .map(item => ({
            ...item,
            score: item.label.toLowerCase().includes(normalized) ? 3 : item.meta.toLowerCase().includes(normalized) ? 2 : item.keywords.toLowerCase().includes(normalized) ? 1 : 0
        }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, 'fr'))
        .slice(0, GLOBAL_SEARCH_MAX_RESULTS);
}

function renderGlobalSearchResults(query) {
    const container = document.getElementById('global-search-results');
    if(!container) return;
    const items = getFilteredGlobalSearchEntries(query);
    if(!items.length) {
        container.innerHTML = '<div class="global-search-empty">Aucun résultat pour cette recherche.</div>';
        return;
    }
    const labels = {
        character: 'Perso',
        post: 'Post',
        article: 'Presse',
        city: 'Cité',
        stock: 'Bourse',
        wiki: 'Wiki'
    };
    container.innerHTML = items.map(item => `
        <div class="global-search-result">
            <button type="button" class="global-search-result-main" onclick="openGlobalSearchResult('${item.type}', '${String(item.id).replace(/'/g, "\\'")}')">
                <div class="global-search-result-type">${labels[item.type] || item.type}</div>
                <strong style="color:${item.color || 'white'}">${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(item.meta || '')}</span>
            </button>
            <button type="button" class="global-search-fav-btn ${isFavoriteItem(item.type, item.id) ? 'active' : ''}" onclick="toggleFavoriteFromSearch('${item.type}', '${String(item.id).replace(/'/g, "\\'")}')"><i class="fa-solid fa-star"></i></button>
        </div>`).join('');
}

function handleGlobalSearchInput(value) {
    renderGlobalSearchResults(value);
}

function openGlobalSearch() {
    closeTopNavMenu();
    const modal = document.getElementById('global-search-modal');
    if(!modal) return;
    modal.classList.remove('hidden');
    renderGlobalSearchChips();
    renderGlobalSearchResults(document.getElementById('globalSearchInput')?.value || '');
    requestAnimationFrame(() => document.getElementById('globalSearchInput')?.focus());
}

function closeGlobalSearch() {
    document.getElementById('global-search-modal')?.classList.add('hidden');
}

function handleGlobalSearchKeydown(event) {
    if(event.key === 'Escape') closeGlobalSearch();
}

function openGlobalSearchResult(type, id) {
    closeGlobalSearch();
    openRecentItem(type, id);
}

function toggleFavoriteFromSearch(type, id) {
    const entity = getFavoriteEntity(type, id);
    const label = entity?.name || entity?.title || entity?.companyName || entity?.journalName || id;
    const meta = entity?.role || entity?.archipel || entity?.category || entity?.charName || entity?.authorName || '';
    toggleFavoriteItem(type, id, label, meta);
    renderGlobalSearchResults(document.getElementById('globalSearchInput')?.value || '');
}

function getNotificationBucket(notification) {
    if(notification.redirectView === 'char-mp' || notification.redirectView === 'dm' || notification.redirectView === 'chat') return 'direct';
    if(notification.type === 'mention' || notification.type === 'reply' || notification.type === 'like' || notification.type === 'follow') return 'social';
    return 'monde';
}

function getFilteredNotifications() {
    return notifications.filter(notification => {
        if(currentNotificationFilter === 'all') return true;
        if(currentNotificationFilter === 'unread') return !notification.isRead;
        return getNotificationBucket(notification) === currentNotificationFilter;
    });
}

function getNotificationTimestampValue(notification) {
    const value = new Date(notification?.timestamp || 0).getTime();
    return Number.isFinite(value) ? value : 0;
}

function getNotificationPriority(notification) {
    let score = 20;
    let label = 'Info';

    if(notification.redirectView === 'char-mp' || notification.redirectView === 'dm' || notification.redirectView === 'chat') {
        score = 95;
        label = 'Direct';
    } else if(notification.type === 'mention' || notification.type === 'reply') {
        score = 82;
        label = 'Action';
    } else if(notification.type === 'follow') {
        score = 56;
        label = 'Social';
    } else if(notification.type === 'like') {
        score = 44;
        label = 'React';
    } else if(notification.redirectView === 'presse' || notification.redirectView === 'feed' || notification.redirectView === 'profile') {
        score = 34;
        label = 'Monde';
    }

    if(!notification.isRead) score += 18;
    return { score, label, tone: score >= 90 ? 'high' : (score >= 65 ? 'medium' : 'low') };
}

function getNotificationSectionKey(notification) {
    const timestamp = getNotificationTimestampValue(notification);
    const priority = getNotificationPriority(notification).score;
    const age = Date.now() - timestamp;
    if(!notification.isRead && priority >= 80) return 'priority';
    if(age <= 24 * 60 * 60 * 1000 || !notification.isRead) return 'recent';
    return 'earlier';
}

function getNotificationSectionMeta(sectionKey) {
    const meta = {
        priority: { title: 'A traiter maintenant', icon: 'fa-bolt', hint: 'Mentions, reponses et messages directs' },
        recent: { title: 'Recentes', icon: 'fa-clock', hint: 'Dernieres 24 heures et non lues' },
        earlier: { title: 'Plus ancien', icon: 'fa-box-archive', hint: 'Historique restant' }
    };
    return meta[sectionKey] || meta.earlier;
}

function formatNotificationTime(notification) {
    const timestamp = getNotificationTimestampValue(notification);
    if(!timestamp) return '';
    const age = Date.now() - timestamp;
    if(age < 60 * 1000) return 'A l\'instant';
    if(age < 60 * 60 * 1000) return `Il y a ${Math.max(1, Math.floor(age / (60 * 1000)))} min`;
    if(age < 24 * 60 * 60 * 1000) return `Il y a ${Math.max(1, Math.floor(age / (60 * 60 * 1000)))} h`;
    if(age < 7 * 24 * 60 * 60 * 1000) return new Date(timestamp).toLocaleDateString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return new Date(timestamp).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function getNotificationCtaLabel(notification) {
    if(notification.redirectView === 'char-mp') return 'Ouvrir MP';
    if(notification.redirectView === 'dm') return 'Ouvrir DM';
    if(notification.redirectView === 'chat') return 'Ouvrir chat';
    if(notification.redirectView === 'presse') return 'Voir article';
    if(notification.redirectView === 'feed') return 'Voir fil';
    if(notification.redirectView === 'profile') return 'Voir profil';
    return 'Ouvrir';
}

function buildNotificationCardMarkup(notification, indexInSection) {
    const meta = getNotificationMeta(notification);
    const priority = getNotificationPriority(notification);
    const title = getNotificationCtaLabel(notification);
    return `<button type="button" class="notif-item ${meta.cls} ${!notification.isRead ? 'unread' : ''} notif-enter" style="animation-delay:${Math.min(indexInSection * 0.035, 0.24)}s" onclick="openNotificationTarget('${notification._id}')" title="${title}">
        <div class="notif-icon"><i class="fa-solid ${meta.icon}"></i></div>
        <div class="notif-content">
            <div class="notif-topline">
                <span class="notif-label">${meta.label}</span>
                <span class="notif-time">${formatNotificationTime(notification)}</span>
            </div>
            <div class="notif-destination-row">
                <span class="notif-destination-chip">${meta.label}</span>
                <span class="notif-priority-chip notif-priority-${priority.tone}">${priority.label}</span>
                ${!notification.isRead ? '<span class="notif-unread-dot">Nouveau</span>' : ''}
            </div>
            <div class="notif-message"><strong>${escapeHtml(notification.fromName || 'Systeme')}</strong> ${escapeHtml(notification.content || '')}</div>
            <div class="notif-cta-row"><span class="notif-cta-label">${title}</span></div>
        </div>
    </button>`;
}

function getNotificationSections(items) {
    const groups = { priority: [], recent: [], earlier: [] };
    items
        .slice()
        .sort((left, right) => {
            const priorityDelta = getNotificationPriority(right).score - getNotificationPriority(left).score;
            if(priorityDelta !== 0) return priorityDelta;
            return getNotificationTimestampValue(right) - getNotificationTimestampValue(left);
        })
        .forEach(item => {
            groups[getNotificationSectionKey(item)].push(item);
        });
    return Object.entries(groups)
        .filter(([, sectionItems]) => sectionItems.length > 0)
        .map(([key, sectionItems]) => ({ key, meta: getNotificationSectionMeta(key), items: sectionItems }));
}

function renderNotificationsList() {
    const list = document.getElementById('notif-list');
    if(!list) return;
    const filteredNotifications = getFilteredNotifications();
    if(filteredNotifications.length === 0) {
        list.innerHTML = '<div class="notif-empty-state">Rien dans cette categorie.</div>';
        return;
    }
    const unreadCount = filteredNotifications.filter(item => !item.isRead).length;
    const directCount = filteredNotifications.filter(item => getNotificationBucket(item) === 'direct').length;
    const sections = getNotificationSections(filteredNotifications);
    list.innerHTML = `
        <div class="notif-summary-card">
            <div class="notif-summary-main">
                <strong>${filteredNotifications.length}</strong>
                <span>notifications dans cette vue</span>
            </div>
            <div class="notif-summary-stats">
                <span><i class="fa-solid fa-circle"></i> ${unreadCount} non lues</span>
                <span><i class="fa-solid fa-bolt"></i> ${directCount} directes</span>
            </div>
        </div>
        ${sections.map(section => `
            <section class="notif-section">
                <div class="notif-section-head">
                    <div class="notif-section-title"><i class="fa-solid ${section.meta.icon}"></i> ${section.meta.title}</div>
                    <div class="notif-section-hint">${section.meta.hint} · ${section.items.length}</div>
                </div>
                <div class="notif-section-list">
                    ${section.items.map((item, index) => buildNotificationCardMarkup(item, index)).join('')}
                </div>
            </section>`).join('')}`;
}

function renderNotificationFilters() {
    const bar = document.getElementById('notif-filter-bar');
    if(!bar) return;
    const counts = {
        all: notifications.length,
        unread: notifications.filter(item => !item.isRead).length,
        direct: notifications.filter(item => getNotificationBucket(item) === 'direct').length,
        social: notifications.filter(item => getNotificationBucket(item) === 'social').length,
        monde: notifications.filter(item => getNotificationBucket(item) === 'monde').length
    };
    const labels = { all: 'Tout', unread: 'Non lues', direct: 'Direct', social: 'Social', monde: 'Monde' };
    bar.innerHTML = Object.keys(labels).map(key => `
        <button type="button" class="notif-filter-chip ${currentNotificationFilter === key ? 'active' : ''}" onclick="setNotificationFilter('${key}')">${labels[key]} <span>${counts[key]}</span></button>`).join('');
}

function setNotificationFilter(filter) {
    currentNotificationFilter = filter;
    localStorage.setItem(NOTIFICATION_FILTER_STORAGE_KEY, filter);
    openNotifications();
}

function markAllNotificationsRead() {
    socket.emit('mark_notifications_read', PLAYER_ID);
    notifications.forEach(item => { item.isRead = true; });
    updateNotificationBadge();
    updateDestinationBadges();
    openNotifications();
}

function syncTopNavMenuUI() {
    const nav = document.getElementById('top-nav');
    const button = document.querySelector('.nav-hamburger-btn');
    if(!nav || !button) return;
    nav.classList.toggle('nav-open', isTopNavMenuOpen);
    button.setAttribute('aria-expanded', String(isTopNavMenuOpen));
    button.title = isTopNavMenuOpen ? 'Masquer le menu' : 'Afficher le menu';
    const icon = button.querySelector('i');
    if(icon) icon.className = `fa-solid ${isTopNavMenuOpen ? 'fa-xmark' : 'fa-bars'}`;
}

function closeTopNavMenu() {
    if(!isTopNavMenuOpen) return;
    isTopNavMenuOpen = false;
    syncTopNavMenuUI();
}

function toggleTopNavMenu(forceOpen) {
    isTopNavMenuOpen = typeof forceOpen === 'boolean' ? forceOpen : !isTopNavMenuOpen;
    syncTopNavMenuUI();
}

function switchView(view) {
    closeTopNavMenu();
    if(view === 'admin' && !IS_ADMIN) {
        switchView('accueil');
        return;
    }
    currentView = view;
    localStorage.setItem('last_tab', view);
    localStorage.setItem('last_tab_time', Date.now().toString());
    if(PLAYER_ID) localStorage.setItem('last_tab_user_id', PLAYER_ID);
    document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    const viewEl = document.getElementById(`view-${view}`);
    const btnEl = document.getElementById(`btn-view-${view}`);
    if(viewEl) { viewEl.classList.remove('hidden'); viewEl.classList.add('active'); }
    if(btnEl) btnEl.classList.add('active');
    if(view === 'reseau') {
        // Réactive le dernier sous-onglet
        const lastTab = localStorage.getItem('last_reseau_tab') || 'chat';
        switchReseauTab(lastTab, false);
    }
    // Redirections compatibilité
    if(view === 'chat')    { switchView('reseau'); switchReseauTab('chat', false); return; }
    if(view === 'feed')    { switchView('reseau'); switchReseauTab('flux', false); return; }
    if(view === 'char-mp') { switchView('reseau'); switchReseauTab('mp', false); return; }
    if(view === 'admin') { if(IS_ADMIN) { loadAdminData(); switchAdminTab(currentAdminTab); } }
    if(view === 'presse') { loadPresse(); }
    if(view === 'actualites') {
        loadActualites(); updateActuAdminForm();
        const actuBadge = document.getElementById('actu-badge');
        if(actuBadge) actuBadge.classList.add('hidden');
        const actuBtn = document.getElementById('btn-view-actualites');
        if(actuBtn) actuBtn.classList.remove('nav-notify');
    }
    if(view === 'cites') { loadCities(); loadCityRelations(); loadPoliticalParties(); }
    if(view === 'bourse') { loadBourse(); updateBourseAdminUI(); syncBourseRankingState(); syncBourseFilterUI(); restorePersistentScroll('bourse-scroll'); }
    if(view === 'wiki') { loadWiki(); }
    if(view === 'accueil') { renderAccueil(); socket.emit('request_feed'); socket.emit('request_events'); socket.emit('request_presse'); socket.emit('request_world_timeline'); if(!stocksData.length) socket.emit('request_stocks'); }
    if(view === 'mes-persos') { renderMesPersos(); }
}

let _reseauTabLoaded = { chat: false, flux: false, mp: false };
function setBadgeState(elementId, count, options = {}) {
    const badge = document.getElementById(elementId);
    if(!badge) return;
    const safeCount = Math.max(0, Number(count) || 0);
    if(safeCount > 0) {
        const label = options.maxLabel && safeCount > options.maxLabel ? `${options.maxLabel}+` : String(safeCount);
        badge.textContent = label;
        badge.classList.remove('hidden');
    } else {
        badge.textContent = '';
        badge.classList.add('hidden');
    }
}
function setButtonAlertState(buttonId, isActive, className = 'nav-notify') {
    const button = document.getElementById(buttonId);
    if(!button) return;
    button.classList.toggle(className, !!isActive);
}
function getUnreadNotificationCounts() {
    return notifications.filter(n => !n.isRead).reduce((counts, notification) => {
        const view = notification.redirectView || 'other';
        if(view === 'char-mp') counts.mp += 1;
        else if(view === 'chat' || view === 'dm') counts.chat += 1;
        else if(view === 'feed') counts.feed += 1;
        else if(view === 'presse') counts.presse += 1;
        else if(view === 'profile') counts.profile += 1;
        else counts.other += 1;
        return counts;
    }, { chat: 0, feed: 0, mp: 0, presse: 0, profile: 0, other: 0 });
}
function updateDestinationBadges() {
    const notificationCounts = getUnreadNotificationCounts();
    const fluxBadge = document.getElementById('reseau-flux-badge');
    const transientFeedCount = fluxBadge && !fluxBadge.classList.contains('hidden') ? Math.max(parseInt(fluxBadge.textContent, 10) || 0, 1) : 0;
    const chatCount = unreadRooms.size + unreadDms.size + notificationCounts.chat;
    const mpCount = Object.values(charMpConversations).filter(conv => conv && conv.unread).length + notificationCounts.mp;
    const feedCount = Math.max(transientFeedCount, notificationCounts.feed);
    const reseauCount = chatCount + mpCount + feedCount;
    const presseCount = notificationCounts.presse;

    setBadgeState('reseau-chat-badge', chatCount, { maxLabel: 99 });
    setBadgeState('reseau-flux-badge', feedCount, { maxLabel: 99 });
    setBadgeState('char-mp-badge', mpCount, { maxLabel: 99 });
    setBadgeState('reseau-nav-badge', reseauCount, { maxLabel: 99 });
    setBadgeState('presse-badge', presseCount, { maxLabel: 99 });

    document.getElementById('reseau-tab-chat')?.classList.toggle('reseau-tab-alert', chatCount > 0);
    document.getElementById('reseau-tab-flux')?.classList.toggle('reseau-tab-alert', feedCount > 0);
    document.getElementById('reseau-tab-mp')?.classList.toggle('reseau-tab-alert', mpCount > 0);

    setButtonAlertState('btn-view-reseau', reseauCount > 0, 'nav-notify');
    setButtonAlertState('btn-view-reseau', mpCount > 0, 'nav-char-mp-unread');
    setButtonAlertState('btn-view-presse', presseCount > 0, 'nav-notify');
    document.getElementById('btn-view-reseau')?.classList.toggle('nav-has-unread', reseauCount > 0);
    document.getElementById('btn-view-presse')?.classList.toggle('nav-has-unread', presseCount > 0);
}

function syncReseauRailUI() {
    const reseauView = document.getElementById('view-reseau');
    const toggleButton = document.getElementById('reseau-tab-toggle');
    const railHandle = document.getElementById('reseau-rail-handle');
    if(!reseauView || !toggleButton || !railHandle) return;

    reseauView.classList.toggle('reseau-rail-expanded', isReseauRailExpanded);
    reseauView.classList.toggle('reseau-rail-collapsed', !isReseauRailExpanded);
    toggleButton.setAttribute('aria-expanded', String(isReseauRailExpanded));
    toggleButton.title = 'Masquer les onglets réseau';
    railHandle.setAttribute('aria-expanded', String(isReseauRailExpanded));
    railHandle.title = isReseauRailExpanded ? 'Masquer les onglets réseau' : 'Afficher les onglets réseau';

    const toggleLabel = toggleButton.querySelector('.reseau-tab-label');
    if(toggleLabel) toggleLabel.textContent = 'Fermer';

    const handleIcon = railHandle.querySelector('i');
    if(handleIcon) {
        handleIcon.classList.toggle('fa-chevron-right', !isReseauRailExpanded);
        handleIcon.classList.toggle('fa-chevron-left', isReseauRailExpanded);
    }
}

function toggleReseauRail(forceExpanded) {
    isReseauRailExpanded = typeof forceExpanded === 'boolean' ? forceExpanded : !isReseauRailExpanded;
    localStorage.setItem(RESEAU_RAIL_STORAGE_KEY, isReseauRailExpanded ? 'expanded' : 'collapsed');
    syncReseauRailUI();
}

function switchReseauTab(tab, save = true) {
    if(save) localStorage.setItem('last_reseau_tab', tab);
    ['chat','flux','mp'].forEach(t => {
        const panel = document.getElementById(`reseau-panel-${t}`);
        const btn   = document.getElementById(`reseau-tab-${t}`);
        if(!panel || !btn) return;
        if(t === tab) {
            panel.classList.remove('hidden');
            panel.classList.add('reseau-panel-enter');
            btn.classList.add('active');
            setTimeout(() => panel.classList.remove('reseau-panel-enter'), 260);
        }
        else          { panel.classList.add('hidden');    btn.classList.remove('active'); }
    });
    if(tab === 'flux') {
        localStorage.setItem('last_feed_visit', Date.now().toString());
        if(!_reseauTabLoaded.flux) { loadFeed(); _reseauTabLoaded.flux = true; }
        const fluxPanel = document.getElementById('reseau-panel-flux');
        if(fluxPanel) requestAnimationFrame(() => { fluxPanel.scrollTop = 0; });
    }
    if(tab === 'mp') {
        if(!_reseauTabLoaded.mp) { initCharMpView(); _reseauTabLoaded.mp = true; }
    }
    if(save) {
        toggleReseauRail(false);
    }
    updateDestinationBadges();
}
syncReseauRailUI();
syncTopNavMenuUI();

function bindPersistentScroll(elementId, storageKey) {
    const el = document.getElementById(elementId);
    if(!el || el.dataset.scrollBound === '1') return;
    el.dataset.scrollBound = '1';
    el.addEventListener('scroll', () => {
        localStorage.setItem(storageKey, String(el.scrollTop));
    }, { passive: true });
}

function restorePersistentScroll(storageKey, elementId) {
    const fallbackMap = {
        'admin-users-scroll': 'admin-users-list',
        'admin-companies-scroll': 'admin-companies-list',
        'notif-list-scroll': 'notif-list',
        'bourse-scroll': 'view-bourse'
    };
    const target = document.getElementById(elementId || fallbackMap[storageKey]);
    if(!target) return;
    const saved = Number(localStorage.getItem(storageKey) || 0);
    requestAnimationFrame(() => { target.scrollTop = Number.isFinite(saved) ? saved : 0; });
}

function saveFeedFilters() {
    localStorage.setItem('feed_filters', JSON.stringify(feedFilters));
}

function knownCompanyNames() {
    return [...new Set(stocksData.map(stock => stock.companyName).filter(Boolean))];
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMentionName(value) {
    return String(value || '')
        .replace(/^@/, '')
        .replace(/[^\wÀ-ÿ\s'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function extractMentionCandidates(text) {
    if(!text || !String(text).includes('@')) return [];
    const words = String(text).split(/\s+/).filter(Boolean);
    const mentions = [];
    for(let i = 0; i < words.length; i++) {
        if(!words[i].startsWith('@')) continue;
        for(let len = 3; len >= 1; len--) {
            if(i + len > words.length) continue;
            const candidate = normalizeMentionName(words.slice(i, i + len).join(' '));
            if(!candidate) continue;
            mentions.push(candidate);
            i += len - 1;
            break;
        }
    }
    return mentions;
}

function textMentionsCurrentUser(text) {
    const mentions = extractMentionCandidates(text);
    if(!mentions.length) return false;
    const ownedNames = new Set(
        [USERNAME, ...myCharacters.map(char => char.name)]
            .map(normalizeMentionName)
            .filter(Boolean)
    );
    return mentions.some(name => ownedNames.has(name));
}

function isCompanyRelatedPost(post) {
    if(post.linkedCompanyName || post.isSponsored) return true;
    const companyNames = [...new Set([...knownCompanyNames(), ...(post.authorCompanyNames || [])].map(name => String(name || '').trim()).filter(Boolean))];
    if(!companyNames.length) return false;
    const haystack = [post.content, post.journalName].filter(Boolean).join(' ');
    if(!haystack.trim()) return false;
    return companyNames.some(name => new RegExp(`(^|[^\\wÀ-ÿ])${escapeRegExp(name)}(?=$|[^\\wÀ-ÿ])`, 'i').test(haystack));
}

function getFeedPostTimestampValue(post) {
    const timestamp = new Date(post?.timestamp || post?.date || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeFeedPosts(posts) {
    const cutoff = Date.now() - FEED_VISIBLE_WINDOW_MS;
    return (Array.isArray(posts) ? posts : [])
        .filter(post => getFeedPostTimestampValue(post) >= cutoff)
        .sort((left, right) => getFeedPostTimestampValue(right) - getFeedPostTimestampValue(left))
        .slice(0, FEED_VISIBLE_POST_LIMIT);
}

function getFilteredFeedPosts() {
    return feedPostsCache.filter(post => {
        if(feedFilters.official && !post.authorIsOfficial) return false;
        if(feedFilters.following && !(post.authorFollowers || []).includes(currentFeedCharId)) return false;
        if(feedFilters.anonymous && !post.isAnonymous) return false;
        if(feedFilters.breaking && !post.isBreakingNews) return false;
        if(feedFilters.sponsored && !(post.isSponsored || post.linkedCompanyName)) return false;
        if(feedFilters.companies && !isCompanyRelatedPost(post)) return false;
        return true;
    });
}

function syncFeedFiltersUI() {
    document.querySelectorAll('.feed-filter-btn').forEach(button => {
        button.classList.toggle('active', !!feedFilters[button.dataset.filter]);
    });
    const filterToggle = document.getElementById('feed-filter-toggle');
    const searchToggle = document.getElementById('feed-search-toggle');
    const filterPopover = document.getElementById('feed-filter-popover');
    const searchPopover = document.getElementById('feed-search-popover');
    if(filterToggle) {
        filterToggle.classList.toggle('is-open', isFeedFiltersPopoverOpen);
        filterToggle.setAttribute('aria-expanded', isFeedFiltersPopoverOpen ? 'true' : 'false');
    }
    if(searchToggle) {
        searchToggle.classList.toggle('is-open', isFeedProfileSearchPopoverOpen);
        searchToggle.setAttribute('aria-expanded', isFeedProfileSearchPopoverOpen ? 'true' : 'false');
    }
    if(filterPopover) filterPopover.classList.toggle('hidden', !isFeedFiltersPopoverOpen);
    if(searchPopover) searchPopover.classList.toggle('hidden', !isFeedProfileSearchPopoverOpen);
    const filteredCount = getFilteredFeedPosts().length;
    const meta = document.getElementById('feed-filter-meta');
    if(meta) {
        const active = Object.entries(feedFilters).filter(([, enabled]) => enabled).map(([name]) => name);
        const labels = {
            official: 'officiels',
            following: 'persos suivis',
            anonymous: 'anonymes',
            breaking: 'breaking news',
            sponsored: 'publicitaires',
            companies: 'liés aux entreprises'
        };
        meta.textContent = active.length
            ? `${filteredCount} post(s) • filtres: ${active.map(name => labels[name]).join(', ')}`
            : '10 derniers posts des 7 derniers jours';
    }
}

function toggleFeedFiltersPopover(forceOpen) {
    isFeedFiltersPopoverOpen = typeof forceOpen === 'boolean' ? forceOpen : !isFeedFiltersPopoverOpen;
    if(isFeedFiltersPopoverOpen) isFeedProfileSearchPopoverOpen = false;
    syncFeedFiltersUI();
}

function toggleFeedProfileSearchPopover(forceOpen) {
    isFeedProfileSearchPopoverOpen = typeof forceOpen === 'boolean' ? forceOpen : !isFeedProfileSearchPopoverOpen;
    if(isFeedProfileSearchPopoverOpen) isFeedFiltersPopoverOpen = false;
    syncFeedFiltersUI();
    if(isFeedProfileSearchPopoverOpen) {
        requestAnimationFrame(() => document.getElementById('feedProfileSearch')?.focus());
    }
}

function renderFeedStream() {
    const container = document.getElementById('feed-stream');
    if(!container) return;
    const posts = getFilteredFeedPosts();
    syncFeedFiltersUI();
    if(!posts.length) {
        container.innerHTML = '<div class="accueil-widget-empty" style="margin-top:6px;">Aucun post ne correspond aux filtres actifs.</div>';
        return;
    }
    container.innerHTML = '';
    posts.forEach(post => container.appendChild(createPostElement(post)));
}

function toggleFeedFilter(filterName) {
    if(!(filterName in feedFilters)) return;
    feedFilters[filterName] = !feedFilters[filterName];
    saveFeedFilters();
    renderFeedStream();
}

function resetFeedFilters() {
    Object.keys(feedFilters).forEach(key => { feedFilters[key] = false; });
    saveFeedFilters();
    renderFeedStream();
}

function getRecentReturnView() {
    const view = localStorage.getItem('last_tab') || 'accueil';
    const lastSeenAt = Number(localStorage.getItem('last_tab_time') || 0);
    const lastUserId = localStorage.getItem('last_tab_user_id') || '';
    const isRecent = Number.isFinite(lastSeenAt) && (Date.now() - lastSeenAt) <= RECENT_VIEW_RESTORE_WINDOW_MS;

    if(!isRecent) return 'accueil';
    if(lastUserId && PLAYER_ID && lastUserId !== PLAYER_ID) return 'accueil';
    if(view === 'admin' && !IS_ADMIN) return 'accueil';

    return view;
}

function openTimelineTarget(view, data = {}) {
    if(!view) return;
    if(view === 'feed' && data.postId && getFilteredFeedPosts().every(post => String(post._id) !== String(data.postId))) {
        Object.keys(feedFilters).forEach(key => { feedFilters[key] = false; });
        saveFeedFilters();
        renderFeedStream();
    }
    switchView(view);
    if(view === 'bourse' && data.stockId) {
        setTimeout(() => openStockDetail(String(data.stockId)), 80);
    }
    if(view === 'feed' && data.postId) {
        setTimeout(() => openPostDetail(String(data.postId)), 120);
    }
}

function renderWorldTimeline() {
    const container = document.getElementById('accueil-world-timeline');
    if(!container) return;
    if(!worldTimelineCache.length) {
        container.innerHTML = '<div class="accueil-widget-empty">Aucun signal récent du monde.</div>';
        return;
    }
    container.innerHTML = worldTimelineCache.map(item => {
        const when = formatRelativeDate(new Date(item.timestamp || Date.now()));
        const icon = {
            post: 'fa-bullhorn',
            article: 'fa-newspaper',
            event: 'fa-calendar-days',
            alert: 'fa-triangle-exclamation',
            market: 'fa-chart-line'
        }[item.type] || 'fa-wave-square';
        const clickable = item.relatedView ? ' timeline-clickable' : '';
        const action = item.relatedView
            ? `onclick="openTimelineTarget('${item.relatedView}', ${JSON.stringify(item.relatedData || {}).replace(/"/g, '&quot;')})"`
            : '';
        return `<div class="accueil-timeline-item accueil-timeline-${item.tone || 'post'}${clickable}" ${action}>
            <div class="accueil-timeline-icon"><i class="fa-solid ${icon}"></i></div>
            <div class="accueil-timeline-body">
                <div class="accueil-timeline-head"><span class="accueil-timeline-name">${escapeHtml(item.title || 'Événement')}</span><span class="accueil-timeline-time">${when}</span></div>
                <div class="accueil-timeline-text">${escapeHtml(item.summary || '')}</div>
            </div>
        </div>`;
    }).join('');
}

function syncAccueilTimelineUI() {
    const wrap = document.getElementById('accueil-timeline-wrap');
    const toggle = document.getElementById('accueil-timeline-toggle');
    if(!wrap || !toggle) return;
    wrap.classList.toggle('collapsed', isAccueilTimelineCollapsed);
    toggle.setAttribute('aria-expanded', String(!isAccueilTimelineCollapsed));
    const chevron = toggle.querySelector('.accueil-timeline-chevron i');
    if(chevron) chevron.className = `fa-solid fa-chevron-${isAccueilTimelineCollapsed ? 'down' : 'up'}`;
}

function toggleAccueilTimeline(force) {
    isAccueilTimelineCollapsed = typeof force === 'boolean' ? force : !isAccueilTimelineCollapsed;
    localStorage.setItem('accueil_timeline_collapsed', isAccueilTimelineCollapsed ? '1' : '0');
    syncAccueilTimelineUI();
}

async function toggleRecording(source) { 
    const btn = document.getElementById(`btn-record-${source}`); if (!btn) return; 
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = []; mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start(); isRecording = true; btn.classList.add('recording');
        } catch (err) { alert("Impossible d'accéder au micro : " + err); }
    } else {
        mediaRecorder.stop();
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            btn.classList.remove('recording'); isRecording = false;
            if (source === 'chat') { stageAttachment(audioBlob, 'audio'); } 
            else if (source === 'feed') {
                document.getElementById('postFileStatus').style.display = 'block'; document.getElementById('postFileStatus').innerHTML = 'Envoi audio...';
                const url = await uploadToCloudinary(audioBlob, 'video');
                if (url) { document.getElementById('postMediaUrl').value = url; document.getElementById('postFileStatus').innerHTML = 'Audio prêt <i class="fa-solid fa-check" style="color:#23a559"></i>'; } 
                else { document.getElementById('postFileStatus').innerHTML = 'Erreur envoi.'; }
            } else if (source === 'comment') { stageCommentMedia({ files: [audioBlob] }, 'audio'); }
        };
    }
}

function handleChatFileSelect(input, type) { if (input.files && input.files[0]) { stageAttachment(input.files[0], type); input.value = ""; } }
function stageAttachment(file, type) {
    pendingAttachment = { file, type };
    const stagingDiv = document.getElementById('chat-staging'); stagingDiv.classList.remove('hidden');
    let previewHTML = '';
    if (type === 'image') { const url = URL.createObjectURL(file); previewHTML = `<img src="${url}" class="staging-preview">`; } 
    else if (type === 'video') { previewHTML = `<div class="staging-preview" style="background:#000; color:white; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-video"></i></div>`; } 
    else if (type === 'audio') { previewHTML = `<div class="staging-preview" style="background:#222; color:white; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-microphone"></i></div>`; }
    stagingDiv.innerHTML = `${previewHTML}<span class="staging-info">${type === 'audio' ? 'Message Vocal' : file.name}</span><button class="btn-clear-stage" onclick="clearStaging()"><i class="fa-solid fa-xmark"></i></button>`;
}
function clearStaging() { pendingAttachment = null; document.getElementById('chat-staging').classList.add('hidden'); document.getElementById('chat-staging').innerHTML = ""; }

function setupEmojiPicker() {
    const picker = document.getElementById('emoji-picker'); picker.innerHTML = '';
    COMMON_EMOJIS.forEach(emoji => {
        const span = document.createElement('span'); span.className = 'emoji-item'; span.textContent = emoji;
        span.onclick = () => insertEmoji(emoji); picker.appendChild(span);
    });
}
function toggleEmojiPicker() { document.getElementById('emoji-picker').classList.toggle('hidden'); }
function insertEmoji(emoji) {
    const input = document.getElementById('txtInput');
    const start = input.selectionStart; const end = input.selectionEnd;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length; input.focus();
    document.getElementById('emoji-picker').classList.add('hidden');
}

document.getElementById('txtInput').addEventListener('input', function(e) {
    const input = e.target; const cursor = input.selectionStart; const textBefore = input.value.substring(0, cursor); const lastWord = textBefore.split(/\s/).pop();
    const suggestionsBox = document.getElementById('mention-suggestions');
    if (lastWord.startsWith('@')) {
        const query = lastWord.substring(1).toLowerCase();
        const matches = allOnlineUsers.filter(u => u.toLowerCase().startsWith(query));
        if (matches.length > 0) {
            suggestionsBox.innerHTML = '';
            matches.forEach(match => {
                const div = document.createElement('div'); div.className = 'mention-item'; div.textContent = match;
                div.onclick = () => {
                    const newText = textBefore.substring(0, textBefore.length - lastWord.length) + '@' + match + ' ' + input.value.substring(cursor);
                    input.value = newText; input.focus(); suggestionsBox.classList.add('hidden');
                }; suggestionsBox.appendChild(div);
            }); suggestionsBox.classList.remove('hidden');
        } else { suggestionsBox.classList.add('hidden'); }
    } else { suggestionsBox.classList.add('hidden'); }
});

socket.on('ombra_message', (data) => { appendOmbraMessage(data._id, data.alias, data.content, data.date, data.alias === ombraAlias); });
socket.on('ombra_history', (history) => {
    const messages = document.getElementById('ombra-messages');
    messages.innerHTML = '';
    history.forEach(m => appendOmbraMessage(m._id, m.alias, m.content, m.date, m.alias === ombraAlias));
});
socket.on('ombra_message_deleted', (msgId) => {
    const el = document.getElementById(`ombra-${msgId}`);
    if(el) el.remove();
});

socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username; PLAYER_ID = data.userId; IS_ADMIN = data.isAdmin;
    ombraAlias = data.ombraAlias || null;
    
    if(data.uiTheme) changeTheme(data.uiTheme);
    
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    document.getElementById('btn-account-main').innerHTML = '<i class="fa-solid fa-user"></i> Mon Profil';
    const navAccBtn = document.getElementById('btn-nav-account');
    if(navAccBtn) { navAccBtn.classList.add('logged-in'); document.getElementById('nav-account-label').textContent = USERNAME; }
    syncAdminNavVisibility();
    closeLoginModal(); socket.emit('request_initial_data', PLAYER_ID); socket.emit('request_dm_contacts', USERNAME);
    const savedRoom = localStorage.getItem('saved_room_id'); joinRoom(savedRoom || 'global');
    localStorage.setItem('last_tab_user_id', PLAYER_ID);
    switchView(getRecentReturnView());
});
socket.on('login_error', (msg) => { const el = document.getElementById('login-error-msg'); el.textContent = msg; el.style.display = 'block'; });
socket.on('post_error', (msg) => { if(msg) alert(msg); });
socket.on('username_change_success', (newName) => { USERNAME = newName; localStorage.setItem('rp_username', newName); document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`; document.getElementById('settings-msg').textContent = "OK !"; });
socket.on('username_change_error', (msg) => { document.getElementById('settings-msg').textContent = msg; });

socket.on('connect', () => { checkAutoLogin(); setupEmojiPicker(); socket.emit('request_live_news'); });
socket.on('update_user_list', (users) => {
    allOnlineUsers = users;
    document.getElementById('online-count').textContent = users.length;
    // Demander les personnages des users en ligne
    socket.emit('request_all_chars_online');
});

socket.on('all_chars_online', (chars) => {
    const listDiv = document.getElementById('online-users-list');
    if(!listDiv) return;
    listDiv.innerHTML = '';
    if(!chars.length) {
        listDiv.innerHTML = '<div style="padding:14px 12px;color:var(--text-dim);font-size:0.78rem;font-style:italic;">Aucun personnage en ligne.</div>';
        return;
    }
    // Grouper par ownerUsername
    const grouped = {};
    chars.forEach(c => {
        if(!grouped[c.ownerUsername]) grouped[c.ownerUsername] = [];
        grouped[c.ownerUsername].push(c);
    });
    Object.entries(grouped).forEach(([owner, ownerChars]) => {
        // Header du joueur
        const ownerDiv = document.createElement('div');
        ownerDiv.className = 'online-owner-header';
        ownerDiv.innerHTML = `<span class="status-dot"></span><span class="online-owner-name">${owner}</span>`;
        listDiv.appendChild(ownerDiv);
        // Bloc encadré avec ses personnages
        const block = document.createElement('div');
        block.className = 'online-chars-block';
        ownerChars.forEach(char => {
            const item = document.createElement('div');
            item.className = 'online-char-item';
            item.onclick = () => openProfile(char.name);
            item.innerHTML = `
                <img src="${char.avatar}" class="online-char-avatar" alt="${char.name}">
                <div class="online-char-info">
                    <span class="online-char-name" style="color:${char.color||'var(--text-normal)'};">${char.name}</span>
                    <span class="online-char-role">${char.role||''}</span>
                </div>`;
            block.appendChild(item);
        });
        listDiv.appendChild(block);
    });
});
socket.on('force_history_refresh', (data) => {
    if (currentRoomId === data.roomId && !currentDmTarget) {
        resetCurrentChatHistory('room', currentRoomId);
        socket.emit('request_history', { roomId: currentRoomId, userId: PLAYER_ID, page: 0, pageSize: CHAT_PAGE_SIZE });
    }
});

const txtInput = document.getElementById('txtInput');
txtInput.addEventListener('input', () => {
    if(currentDmTarget) return; 
    const name = currentSelectedChar ? currentSelectedChar.name : "Quelqu'un";
    socket.emit('typing_start', { roomId: currentRoomId, charName: name });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('typing_stop', { roomId: currentRoomId, charName: name }); }, 1000);
});
socket.on('display_typing', (data) => { if(data.roomId === currentRoomId && !currentDmTarget) { document.getElementById('typing-indicator').classList.remove('hidden'); document.getElementById('typing-text').textContent = `${data.charName} écrit...`; } });
socket.on('hide_typing', (data) => { if(data.roomId === currentRoomId) document.getElementById('typing-indicator').classList.add('hidden'); });

function createRoomPrompt() { const name = prompt("Nom du salon :"); if (name) socket.emit('create_room', { name, creatorId: PLAYER_ID, allowedCharacters: [] }); }
function deleteRoom(roomId) { if(confirm("ADMIN : Supprimer ?")) socket.emit('delete_room', roomId); }
function joinRoom(roomId) {
    if (allRooms.length > 0 && roomId !== 'global' && !allRooms.find(r => r._id === roomId)) roomId = 'global';
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId; lastMessageData = { author: null, time: 0 }; 
    localStorage.setItem('saved_room_id', roomId); currentDmTarget = null; socket.emit('join_room', currentRoomId);
    if (unreadRooms.has(currentRoomId)) unreadRooms.delete(currentRoomId);
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global';
    document.getElementById('currentRoomName').style.color = "var(--text-primary)";
    document.getElementById('messages').innerHTML = ""; document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('char-selector-wrapper').classList.remove('hidden'); document.getElementById('dm-header-actions').classList.add('hidden');
    resetCurrentChatHistory('room', currentRoomId);
    socket.emit('request_history', { roomId: currentRoomId, userId: PLAYER_ID, page: 0, pageSize: CHAT_PAGE_SIZE }); cancelContext(); clearStaging();
    scrollToBottom(true); scheduleScrollToBottom(true);
    updateDestinationBadges();
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
    updateRoomListUI(); updateDmListUI(); switchView('chat'); 
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });
socket.on('force_room_exit', (roomId) => { if(currentRoomId === roomId) joinRoom('global'); });
function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${(currentRoomId === 'global' && !currentDmTarget)?'active':''} ${unreadRooms.has('global')?'unread':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    allRooms.forEach(room => {
        const delBtn = IS_ADMIN ? `<button class="btn-del-room" onclick="event.stopPropagation(); deleteRoom('${room._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
        const isUnread = unreadRooms.has(String(room._id)) ? 'unread' : '';
        const isActive = (String(currentRoomId) === String(room._id) && !currentDmTarget) ? 'active' : '';
        list.innerHTML += `<div class="room-item ${isActive} ${isUnread}" onclick="joinRoom('${room._id}')"><span class="room-name">${room.name}</span>${delBtn}</div>`;
    });
}

function startDmFromList(target) { if (target !== USERNAME) openDm(target); }
socket.on('open_dm_ui', (target) => openDm(target));
function getChatHistoryKey(mode, key) {
    return `${mode}:${key || ''}`;
}
function resetCurrentChatHistory(mode, key) {
    currentChatMessages = [];
    chatHistoryState = { mode, key: getChatHistoryKey(mode, key), page: 0, hasMore: false, total: 0 };
    updateChatLoadMoreButton();
}
function updateChatLoadMoreButton() {
    const btn = document.getElementById('chat-load-more');
    if(!btn) return;
    btn.classList.toggle('hidden', !chatHistoryState.hasMore);
    btn.textContent = chatHistoryState.mode === 'dm' ? 'Charger plus de messages privés' : 'Charger plus de messages';
}
function renderCurrentChatMessages(scrollMode = 'bottom') {
    const container = document.getElementById('messages');
    if(!container) return;
    const previousHeight = container.scrollHeight;
    const previousTop = container.scrollTop;
    container.innerHTML = '';
    lastMessageData = { author: null, time: 0, ownerId: null };
    currentChatMessages.forEach(msg => displayMessage(msg, chatHistoryState.mode === 'dm'));
    if(scrollMode === 'preserve') {
        container.scrollTop = container.scrollHeight - previousHeight + previousTop;
    } else {
        scrollToBottom(true);
        scheduleScrollToBottom(true);
    }
}
function loadMoreCurrentChatMessages() {
    if(!chatHistoryState.hasMore) return;
    if(chatHistoryState.mode === 'dm' && currentDmTarget) {
        socket.emit('request_dm_history', {
            myUsername: USERNAME,
            targetUsername: currentDmTarget,
            page: (chatHistoryState.page || 0) + 1,
            pageSize: CHAT_PAGE_SIZE
        });
        return;
    }
    if(chatHistoryState.mode === 'room' && currentRoomId) {
        socket.emit('request_history', {
            roomId: currentRoomId,
            userId: PLAYER_ID,
            page: (chatHistoryState.page || 0) + 1,
            pageSize: CHAT_PAGE_SIZE
        });
    }
}
function openDm(target) {
    currentDmTarget = target; currentRoomId = null; lastMessageData = { author: null, time: 0 }; 
    if (!dmContacts.includes(target)) dmContacts.push(target);
    if (unreadDms.has(target)) unreadDms.delete(target);
    document.getElementById('currentRoomName').textContent = `@${target}`; document.getElementById('currentRoomName').style.color = "#9b59b6"; 
    document.getElementById('messages').innerHTML = ""; document.getElementById('char-selector-wrapper').classList.add('hidden'); document.getElementById('dm-header-actions').classList.remove('hidden'); 
    resetCurrentChatHistory('dm', target);
    cancelContext(); clearStaging(); socket.emit('request_dm_history', { myUsername: USERNAME, targetUsername: target, page: 0, pageSize: CHAT_PAGE_SIZE });
    scrollToBottom(true); scheduleScrollToBottom(true);
    updateDestinationBadges();
    updateRoomListUI(); updateDmListUI(); switchView('chat'); 
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
}
function closeCurrentDm() { if(currentDmTarget) { dmContacts = dmContacts.filter(c => c !== currentDmTarget); joinRoom('global'); } }
function deleteCurrentDmHistory() { if(currentDmTarget && confirm("Supprimer histo ?")) socket.emit('delete_dm_history', { myUsername: USERNAME, targetUsername: currentDmTarget }); }
socket.on('dm_history_deleted', (target) => { if(currentDmTarget === target) document.getElementById('messages').innerHTML = "<i>Historique supprimé.</i>"; });
socket.on('dm_contacts_data', (contacts) => { dmContacts = contacts; updateDmListUI(); });
function updateDmListUI() {
    const list = document.getElementById('dmList'); list.innerHTML = "";
    dmContacts.forEach(contact => {
        const isActive = (currentDmTarget === contact) ? 'active' : '';
        const isUnread = unreadDms.has(contact) ? 'unread' : '';
        const avatarUrl = `https://ui-avatars.com/api/?name=${contact}&background=random&color=fff&size=64`;
        list.innerHTML += `<div class="dm-item ${isActive} ${isUnread}" onclick="openDm('${contact}')"><img src="${avatarUrl}" class="dm-avatar"><span>${contact}</span></div>`;
    });
}
socket.on('dm_history_data', (data) => {
    if (currentDmTarget !== data.target) return;
    const history = Array.isArray(data.history) ? data.history : [];
    currentChatMessages = Number(data.page) > 0 ? [...history, ...currentChatMessages] : history;
    chatHistoryState = {
        mode: 'dm',
        key: getChatHistoryKey('dm', data.target),
        page: Number(data.page) || 0,
        hasMore: !!data.hasMore,
        total: Number(data.total) || currentChatMessages.length
    };
    renderCurrentChatMessages(Number(data.page) > 0 ? 'preserve' : 'bottom');
    updateChatLoadMoreButton();
});
socket.on('receive_dm', (msg) => {
    const other = (msg.sender === USERNAME) ? msg.target : msg.sender;
    if (!dmContacts.includes(other)) { dmContacts.push(other); updateDmListUI(); }
    if (currentDmTarget === other) {
        const existingIndex = currentChatMessages.findIndex(existing => String(existing._id || '') === String(msg._id || ''));
        if (existingIndex >= 0) currentChatMessages[existingIndex] = msg;
        else currentChatMessages.push(msg);
        chatHistoryState.total = Math.max(Number(chatHistoryState.total) || 0, currentChatMessages.length);
        renderCurrentChatMessages('bottom');
    } 
    else { unreadDms.add(other); updateDmListUI(); }
    updateDestinationBadges();
    if (msg.sender !== USERNAME && notificationsEnabled) notifSound.play().catch(e=>{});
});

async function createCharacter() {
    if (myCharacters.length >= 20) return alert("Limite 20 persos.");
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const partyName = document.getElementById('newCharPartyName').value.trim();
    const fileInput = document.getElementById('newCharFile');
    const partyFileInput = document.getElementById('newCharPartyFile');
    const capitalEl = document.getElementById('newCharCapital');
    const capital = capitalEl ? (parseFloat(capitalEl.value) || 0) : 0;
    const politicalRole = document.getElementById('newCharPoliticalRole')?.value || '';
    const partyFounder = document.getElementById('newCharPartyFounder')?.value.trim() || '';
    const partyCreationDate = document.getElementById('newCharPartyCreationDate')?.value.trim() || '';
    const partyMotto = document.getElementById('newCharPartyMotto')?.value.trim() || '';
    const partyDescription = document.getElementById('newCharPartyDescription')?.value.trim() || '';
    
    let avatar = fileInput.files[0] ? await uploadToCloudinary(fileInput.files[0]) : `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    let partyLogo = partyFileInput.files[0] ? await uploadToCloudinary(partyFileInput.files[0]) : null;
    if(!name || !role) return alert("Nom et rôle requis.");
    
    const isOfficial = role.includes('Journaliste') || role.includes('Gouvernement') || role.includes('Presse');
    _unsavedBypass = true;
    socket.emit('create_char', { 
        name, role, 
        color: document.getElementById('newCharColor').value, 
        avatar, 
        description: document.getElementById('newCharDesc').value.trim(), 
        ownerId: PLAYER_ID, 
        partyName: partyName || null, 
        partyLogo: partyLogo || null,
        partyFounder: partyFounder || null,
        partyCreationDate: partyCreationDate || null,
        partyMotto: partyMotto || null,
        partyDescription: partyDescription || null,
        isOfficial,
        companies: newCharCompanies || [],
        capital,
        politicalRole
    });
    toggleCreateForm();
    fileInput.value = ""; partyFileInput.value = "";
    document.getElementById('newCharPartyName').value = "";
    if(document.getElementById('newCharPartyFounder')) document.getElementById('newCharPartyFounder').value = '';
    if(document.getElementById('newCharPartyCreationDate')) document.getElementById('newCharPartyCreationDate').value = '';
    if(document.getElementById('newCharPartyMotto')) document.getElementById('newCharPartyMotto').value = '';
    if(document.getElementById('newCharPartyDescription')) document.getElementById('newCharPartyDescription').value = '';
    if(capitalEl) capitalEl.value = '';
    newCharCompanies = [];
    renderNewCharCompanies();
}
function prepareEditCharacter(id) {
    const char = myCharacters.find(c => c._id === id); if (!char) return;
    document.getElementById('editCharId').value = char._id;
    document.getElementById('editCharOriginalName').value = char.name;
    document.getElementById('editCharName').value = char.name;
    document.getElementById('editCharRole').value = char.role;
    document.getElementById('editCharDesc').value = char.description || '';
    document.getElementById('editCharColor').value = char.color || '#5c7cfa';
    document.getElementById('editCharBase64').value = char.avatar;
    document.getElementById('editCharPartyName').value = char.partyName || '';
    document.getElementById('editCharPartyBase64').value = char.partyLogo || '';
    document.getElementById('editCharCapital').value = char.capital || 0;
    if(document.getElementById('editCharPartyFounder')) document.getElementById('editCharPartyFounder').value = char.partyFounder || '';
    if(document.getElementById('editCharPartyCreationDate')) document.getElementById('editCharPartyCreationDate').value = char.partyCreationDate || '';
    if(document.getElementById('editCharPartyMotto')) document.getElementById('editCharPartyMotto').value = char.partyMotto || '';
    if(document.getElementById('editCharPartyDescription')) document.getElementById('editCharPartyDescription').value = char.partyDescription || '';
    const prEl = document.getElementById('editCharPoliticalRole');
    if(prEl) prEl.value = char.politicalRole || '';
    // Charger les entreprises existantes
    editCharCompanies = (char.companies || []).map(c => ({...c}));
    renderEditCharCompanies();
    openCharModal('edit');
}
function cancelEditCharacter() { closeCharModal(); }
async function submitEditCharacter() {
    const file = document.getElementById('editCharFile').files[0];
    const partyFile = document.getElementById('editCharPartyFile').files[0];
    let newAvatar = document.getElementById('editCharBase64').value;
    let newPartyLogo = document.getElementById('editCharPartyBase64').value;
    const newPartyName = document.getElementById('editCharPartyName').value.trim();
    const newCapital = parseFloat(document.getElementById('editCharCapital').value) || 0;
    if (file) { const url = await uploadToCloudinary(file); if (url) newAvatar = url; }
    if (partyFile) { const url = await uploadToCloudinary(partyFile); if (url) newPartyLogo = url; }
    const newRole = document.getElementById('editCharRole').value.trim();
    const isOfficial = newRole.includes('Journaliste') || newRole.includes('Gouvernement') || newRole.includes('Presse');
    socket.emit('edit_char', {
        charId: document.getElementById('editCharId').value,
        originalName: document.getElementById('editCharOriginalName').value,
        newName: document.getElementById('editCharName').value.trim(),
        newRole, newAvatar,
        newColor: document.getElementById('editCharColor').value,
        newDescription: document.getElementById('editCharDesc').value.trim(),
        ownerId: PLAYER_ID, currentRoomId,
        partyName: newPartyName || null,
        partyLogo: newPartyLogo || null,
        partyFounder: document.getElementById('editCharPartyFounder')?.value.trim() || null,
        partyCreationDate: document.getElementById('editCharPartyCreationDate')?.value.trim() || null,
        partyMotto: document.getElementById('editCharPartyMotto')?.value.trim() || null,
        partyDescription: document.getElementById('editCharPartyDescription')?.value.trim() || null,
        isOfficial,
        capital: newCapital,
        companies: editCharCompanies,
        politicalRole: document.getElementById('editCharPoliticalRole')?.value || ''
    });
    _unsavedBypass = true;
    closeCharModal();
    document.getElementById('editCharFile').value = '';
    document.getElementById('editCharPartyFile').value = '';
}
socket.on('my_chars_data', (chars) => { 
    myCharacters = chars; updateUI(); 
    const saved = localStorage.getItem('saved_char_id');
    if (saved && myCharacters.find(c => c._id === saved)) selectCharacter(saved);
    else if (IS_ADMIN && saved === 'narrateur') selectCharacter('narrateur');
    renderFeedStream();
    if(currentView === 'accueil') renderAccueil();
});
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); closeCharModal(); });
function deleteCharacter(id) { if(confirm('Supprimer ?')) socket.emit('delete_char', id); }
socket.on('char_deleted_success', (id) => { myCharacters = myCharacters.filter(c => c._id !== id); updateUI(); });
socket.on('char_updated', (char) => {
    const idx = myCharacters.findIndex(c => String(c._id) === String(char._id));
    if(idx >= 0) {
        Object.assign(myCharacters[idx], char);
        if(currentView === 'mes-persos') renderMesPersos();
        if(currentView === 'accueil') renderAccueil();
    }
    if(currentProfileChar && String(currentProfileChar._id) === String(char._id)) {
        Object.assign(currentProfileChar, char);
        if(document.getElementById('profile-slide-panel')?.classList.contains('open')) {
            socket.emit('get_char_profile', currentProfileChar.name);
        }
    }
});

function selectCharacter(id) {
    const narrateur = { _id: 'narrateur', name: 'Narrateur', role: 'Omniscient', color: '#ffffff', avatar: 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png' };
    currentSelectedChar = (id === 'narrateur') ? narrateur : myCharacters.find(c => c._id === id);
    if(currentSelectedChar) localStorage.setItem('saved_char_id', currentSelectedChar._id);
    document.querySelectorAll('.avatar-choice').forEach(el => el.classList.remove('selected'));
    const el = document.getElementById(`avatar-opt-${id}`); if(el) el.classList.add('selected');
}
function toggleCharBar() {
    const bar = document.getElementById('char-bar-horizontal'); const icon = document.getElementById('toggle-icon');
    bar.classList.toggle('hidden-bar');
    if (bar.classList.contains('hidden-bar')) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); } 
    else { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
}

function updateUI() {
    const list = document.getElementById('myCharList'); const bar = document.getElementById('char-bar-horizontal');
    list.innerHTML = ""; bar.innerHTML = "";
    if(IS_ADMIN) bar.innerHTML += `<img src="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" id="avatar-opt-narrateur" class="avatar-choice" title="Narrateur" onclick="selectCharacter('narrateur')">`;

    myCharacters.forEach((char, index) => {
        list.innerHTML += `<div class="char-item"><img src="${char.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${char.color}">${char.name}</div><div class="char-role-list">${char.role}</div></div><div class="char-actions"><button class="btn-mini-action" onclick="prepareEditCharacter('${char._id}')"><i class="fa-solid fa-gear"></i></button><button class="btn-mini-action" onclick="deleteCharacter('${char._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button></div></div>`;
        bar.innerHTML += `<img src="${char.avatar}" id="avatar-opt-${char._id}" class="avatar-choice" title="${char.name}" onclick="selectCharacter('${char._id}')">`;
        if (index === 0 && !currentFeedCharId) currentFeedCharId = char._id;
    });

    if (!currentSelectedChar) { if(myCharacters.length > 0) selectCharacter(myCharacters[0]._id); else if(IS_ADMIN) selectCharacter('narrateur'); }
    else selectCharacter(currentSelectedChar._id);

    updateFeedCharUI(); updatePresseCharUI(); updateBreakingNewsVisibility(); refreshFeedProfileDatalist();
    if(currentView === 'mes-persos') renderMesPersos();
    if(currentView === 'accueil') renderAccueil();
}

function refreshFeedProfileDatalist() {
    const datalist = document.getElementById('feed-profile-list');
    if(!datalist) return;
    const names = [...new Set([
        ...myCharacters.map(char => char?.name),
        ...feedPostsCache.map(post => post?.authorName),
        ...presseArticlesCache.map(article => article?.authorName)
    ].map(name => String(name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    datalist.innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
}

function openFeedProfileSearch() {
    const input = document.getElementById('feedProfileSearch');
    const value = input?.value?.trim() || '';
    if(!value) return alert('Entrez un nom de profil.');
    openProfile(value);
}

function clearFeedProfileSearch() {
    const input = document.getElementById('feedProfileSearch');
    if(input) input.value = '';
}

// FEED AVATAR SELECTOR
function updateFeedCharUI() {
    const container = document.getElementById('feed-char-avatar-wrapper'); if(!container) return;
    const char = currentFeedCharId ? myCharacters.find(c => c._id === currentFeedCharId) : null;
    const avatarSrc = char ? char.avatar : 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png';
    container.innerHTML = `
        <div class="feed-char-trigger" onclick="toggleFeedCharDropdown()" title="Changer de personnage pour le Feed">
            <img src="${avatarSrc}" class="feed-char-avatar-btn" id="feed-active-avatar">
            <i class="fa-solid fa-chevron-down feed-char-chevron"></i>
        </div>
        <div id="feed-char-dropdown" class="feed-char-dropdown hidden">
            ${myCharacters.map(c => `
                <div class="feed-char-option ${c._id === currentFeedCharId ? 'active' : ''}" onclick="selectFeedChar('${c._id}')">
                    <img src="${c.avatar}" class="feed-char-opt-avatar">
                    <div><div class="feed-char-opt-name" style="color:${c.color}">${c.name}</div><div class="feed-char-opt-role">${c.role}</div></div>
                    ${c._id === currentFeedCharId ? '<i class="fa-solid fa-check" style="margin-left:auto; color:var(--accent);"></i>' : ''}
                </div>`).join('')}
        </div>`;
}

function toggleFeedCharDropdown() { const dd = document.getElementById('feed-char-dropdown'); if(dd) dd.classList.toggle('hidden'); }
function selectFeedChar(charId) {
    currentFeedCharId = charId;
    const dd = document.getElementById('feed-char-dropdown'); if(dd) dd.classList.add('hidden');
    updateFeedCharUI(); updateBreakingNewsVisibility(); renderFeedStream(); loadFeed();
}

// PRESSE CHAR SELECTOR
function updatePresseCharUI() {
    const container = document.getElementById('presse-char-avatar-wrapper'); if(!container) return;
    const journalistChars = myCharacters.filter(c => c.role && (c.role.toLowerCase().includes('journaliste') || c.isOfficial));
    if(!currentPresseCharId && journalistChars.length > 0) currentPresseCharId = journalistChars[0]._id;
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    const avatarSrc = char ? char.avatar : 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png';
    container.innerHTML = `
        <div class="feed-char-trigger" onclick="togglePresseCharDropdown()" title="Changer de journaliste">
            <img src="${avatarSrc}" class="feed-char-avatar-btn">
            <i class="fa-solid fa-chevron-down feed-char-chevron"></i>
        </div>
        <div id="presse-char-dropdown" class="feed-char-dropdown hidden">
            ${journalistChars.length === 0 ? '<div style="padding:12px; color:#777; font-size:0.82rem;">Aucun journaliste</div>' : journalistChars.map(c => `
                <div class="feed-char-option ${c._id === currentPresseCharId ? 'active' : ''}" onclick="selectPresseChar('${c._id}')">
                    <img src="${c.avatar}" class="feed-char-opt-avatar">
                    <div><div class="feed-char-opt-name" style="color:${c.color}">${c.name}</div><div class="feed-char-opt-role">${c.role}</div></div>
                    ${c._id === currentPresseCharId ? '<i class="fa-solid fa-check" style="margin-left:auto; color:var(--accent);"></i>' : ''}
                </div>`).join('')}
        </div>`;
    // Afficher ou masquer la zone de rédaction
    updatePresseWriteBox();
    updatePresseLiveToggleUI();
}
function togglePresseCharDropdown() { const dd = document.getElementById('presse-char-dropdown'); if(dd) dd.classList.toggle('hidden'); }
function selectPresseChar(charId) {
    currentPresseCharId = charId;
    const dd = document.getElementById('presse-char-dropdown'); if(dd) dd.classList.add('hidden');
    updatePresseCharUI();
}

function isForbiddenPresseMode() {
    return normalizeForbiddenPressQuery(presseJournalFilter) === 'dossier kael';
}

function syncPresseComposerMode() {
    const writeBox = document.getElementById('presse-write-box');
    const title = document.getElementById('presseComposeTitle');
    const hint = document.getElementById('presseForbiddenHint');
    const isForbiddenMode = isForbiddenPresseMode() && IS_ADMIN;
    if(writeBox) writeBox.classList.toggle('presse-write-box-forbidden', isForbiddenMode);
    if(title) title.textContent = isForbiddenMode ? 'Rédiger un dossier Kael' : 'Rédiger un article';
    if(hint) hint.classList.toggle('hidden', !isForbiddenMode);
    updatePresseLiveToggleUI();
}

async function prepareForbiddenDossierComposer() {
    const titleInput = document.getElementById('presseTitle');
    const journalNameInput = document.getElementById('presseJournalName');
    const journalLogoInput = document.getElementById('presseJournalLogo');
    const logoPreview = document.getElementById('presseJournalLogoPreview');
    const urgencyInput = document.getElementById('presseUrgency');
    if(journalNameInput) journalNameInput.value = 'Dossier Kael';
    if(journalLogoInput) journalLogoInput.value = '';
    const logoFileInput = document.getElementById('presseJournalLogoFile');
    if(logoFileInput) logoFileInput.value = '';
    if(logoPreview) logoPreview.innerHTML = '<i class="fa-solid fa-file-shield"></i>';
    if(titleInput && !titleInput.value.trim()) titleInput.value = 'Dossier Kael — ';
    if(urgencyInput && !urgencyInput.value) urgencyInput.value = 'enquete';
    currentPresseTheme = normalizeArticleTheme(buildForbiddenDossierArticle().articleTheme);
    await hydrateArticleThemeChoices('', 'presseContentEditor', currentPresseTheme);
    syncPresseComposerMode();
    updatePresseComposerUX();
}

async function openForbiddenDossierComposer() {
    if(!IS_ADMIN || !isForbiddenPresseMode()) return;
    setPresseComposerOpen(true);
    await prepareForbiddenDossierComposer();
}

function setPresseComposerOpen(forceOpen) {
    isPresseComposerOpen = typeof forceOpen === 'boolean' ? forceOpen : !isPresseComposerOpen;
    updatePresseWriteBox();
    if(isPresseComposerOpen) {
        if(IS_ADMIN && isForbiddenPresseMode()) prepareForbiddenDossierComposer();
        else restorePresseDraft();
        requestAnimationFrame(() => {
            const titleInput = document.getElementById('presseTitle');
            if(titleInput) titleInput.focus();
        });
    }
}

function togglePresseComposer() {
    setPresseComposerOpen();
}

function closePresseComposer() {
    setPresseComposerOpen(false);
}

function syncFeedDraftFromComposer() {
    const contentNode = document.getElementById('postContent');
    if(!contentNode) return;
    setDraftValue('feed', {
        content: contentNode.value || '',
        isAnonymous: !!document.getElementById('postAnonymous')?.checked,
        isBreakingNews: !!document.getElementById('postBreakingNews')?.checked
    });
}

function restoreFeedDraft() {
    const draft = draftsState.feed;
    const contentNode = document.getElementById('postContent');
    if(!draft || !contentNode || currentEditingPostId) return;
    contentNode.value = draft.content || '';
    if(document.getElementById('postAnonymous')) document.getElementById('postAnonymous').checked = !!draft.isAnonymous;
    if(document.getElementById('postBreakingNews')) document.getElementById('postBreakingNews').checked = !!draft.isBreakingNews;
    const countNode = document.getElementById('char-count');
    if(countNode) countNode.textContent = `${contentNode.value.length}/1000`;
}

function syncPresseDraftFromComposer() {
    const editor = getPresseEditor('presseContentEditor');
    const titleInput = document.getElementById('presseTitle');
    if(!editor || !titleInput) return;
    setDraftValue('presse', {
        title: titleInput.value || '',
        journalName: document.getElementById('presseJournalName')?.value || '',
        journalLogo: document.getElementById('presseJournalLogo')?.value || '',
        urgency: document.getElementById('presseUrgency')?.value || '',
        contentHtml: editor.innerHTML || ''
    });
}

function restorePresseDraft() {
    const draft = draftsState.presse;
    if(!draft || isForbiddenPresseMode()) return;
    const titleInput = document.getElementById('presseTitle');
    const editor = getPresseEditor('presseContentEditor');
    if(titleInput && !titleInput.value) titleInput.value = draft.title || '';
    const journalInput = document.getElementById('presseJournalName');
    if(journalInput && !journalInput.value) journalInput.value = draft.journalName || '';
    const journalLogo = document.getElementById('presseJournalLogo');
    if(journalLogo && !journalLogo.value) journalLogo.value = draft.journalLogo || '';
    const urgency = document.getElementById('presseUrgency');
    if(urgency && !urgency.value) urgency.value = draft.urgency || '';
    if(editor && !editor.innerHTML.trim()) editor.innerHTML = draft.contentHtml || '';
    updatePresseComposerUX();
    updatePresseLiveToggleUI();
}

function syncWikiDraftFromComposer() {
    const title = document.getElementById('wikiPageTitle');
    const content = document.getElementById('wikiPageContent');
    if(!title || !content) return;
    setDraftValue('wiki', {
        pageId: document.getElementById('wikiPageId')?.value || '',
        title: title.value || '',
        category: document.getElementById('wikiPageCategory')?.value || 'histoire',
        content: content.value || '',
        coverImage: document.getElementById('wikiPageCoverUrl')?.value || ''
    });
}

function restoreWikiDraft() {
    const draft = draftsState.wiki;
    if(!draft || draft.pageId) return;
    if(document.getElementById('wikiPageTitle')) document.getElementById('wikiPageTitle').value = draft.title || '';
    if(document.getElementById('wikiPageCategory')) document.getElementById('wikiPageCategory').value = draft.category || 'histoire';
    if(document.getElementById('wikiPageContent')) document.getElementById('wikiPageContent').value = draft.content || '';
    if(document.getElementById('wikiPageCoverUrl')) document.getElementById('wikiPageCoverUrl').value = draft.coverImage || '';
    updateWikiWordCount();
}

function renderAccueilQuickActions() {
    const container = document.getElementById('accueil-quick-actions');
    if(!container) return;
    const latestRecent = getRecentActivityItems()[0];
    const unreadCount = notifications.filter(item => !item.isRead).length;
    const actions = [
        `<button type="button" class="accueil-quick-action accent" onclick="switchView('feed')"><i class="fa-solid fa-feather-pointed"></i><span>Publier</span></button>`,
        `<button type="button" class="accueil-quick-action" onclick="openGlobalSearch()"><i class="fa-solid fa-magnifying-glass"></i><span>Recherche</span></button>`,
        `<button type="button" class="accueil-quick-action" onclick="openNotifications()"><i class="fa-solid fa-bell"></i><span>Notifications${unreadCount ? ` (${unreadCount})` : ''}</span></button>`
    ];
    if(latestRecent) {
        actions.push(`<button type="button" class="accueil-quick-action" onclick="openRecentItem('${latestRecent.type}', '${String(latestRecent.id).replace(/'/g, "\\'")}')"><i class="fa-solid fa-clock-rotate-left"></i><span>Reprendre</span></button>`);
    }
    if(draftsState.feed?.content) {
        actions.push(`<button type="button" class="accueil-quick-action" onclick="switchView('feed')"><i class="fa-solid fa-bookmark"></i><span>Brouillon feed</span></button>`);
    }
    container.innerHTML = actions.join('');
}

function renderAccueilRecents() {
    const container = document.getElementById('accueil-recents-preview');
    if(!container) return;
    const items = getRecentActivityItems().slice(0, 6);
    if(!items.length) {
        container.innerHTML = '<div class="accueil-widget-empty">Tes derniers écrans, profils et lectures apparaîtront ici.</div>';
        return;
    }
    container.innerHTML = items.map(item => `
        <div class="accueil-post-item" onclick="openRecentItem('${item.type}', '${String(item.id).replace(/'/g, "\\'")}')">
            <span class="accueil-stock-icon"><i class="fa-solid fa-clock-rotate-left"></i></span>
            <div class="accueil-post-meta">
                <span class="accueil-post-author">${escapeHtml(item.label || 'Élément')}</span>
                <span class="accueil-post-content">${escapeHtml(item.meta || 'Reprise rapide')}</span>
            </div>
            <span class="accueil-post-date">${new Date(item.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
        </div>`).join('');
}

function renderAccueilFavorites() {
    const container = document.getElementById('accueil-favorites-preview');
    if(!container) return;
    const items = Object.entries(normalizeFavoritesState(favoritesState))
        .flatMap(([type, entries]) => entries.map(entry => ({ ...entry, type })))
        .sort((left, right) => (right.savedAt || 0) - (left.savedAt || 0))
        .slice(0, 6);
    if(!items.length) {
        container.innerHTML = '<div class="accueil-widget-empty">Ajoute des favoris depuis la recherche globale pour y revenir vite.</div>';
        return;
    }
    container.innerHTML = items.map(item => `
        <div class="accueil-post-item" onclick="openRecentItem('${item.type}', '${String(item.id).replace(/'/g, "\\'")}')">
            <span class="accueil-stock-icon"><i class="fa-solid fa-star"></i></span>
            <div class="accueil-post-meta">
                <span class="accueil-post-author">${escapeHtml(item.label || 'Favori')}</span>
                <span class="accueil-post-content">${escapeHtml(item.meta || 'Favori enregistré')}</span>
            </div>
            <span class="accueil-post-date">${escapeHtml(getGlobalSearchTypes()[item.type] || item.type)}</span>
        </div>`).join('');
}

function bindProductEnhancementInputs() {
    const feedInput = document.getElementById('postContent');
    if(feedInput && feedInput.dataset.draftBound !== '1') {
        feedInput.dataset.draftBound = '1';
        feedInput.addEventListener('input', syncFeedDraftFromComposer);
    }
    const presseTitle = document.getElementById('presseTitle');
    if(presseTitle && presseTitle.dataset.draftBound !== '1') {
        presseTitle.dataset.draftBound = '1';
        presseTitle.addEventListener('input', syncPresseDraftFromComposer);
    }
    const presseJournal = document.getElementById('presseJournalName');
    if(presseJournal && presseJournal.dataset.draftBound !== '1') {
        presseJournal.dataset.draftBound = '1';
        presseJournal.addEventListener('input', syncPresseDraftFromComposer);
    }
    const presseEditor = document.getElementById('presseContentEditor');
    if(presseEditor && presseEditor.dataset.draftBound !== '1') {
        presseEditor.dataset.draftBound = '1';
        presseEditor.addEventListener('input', syncPresseDraftFromComposer);
    }
    const presseLiveText = document.getElementById('presseLiveQuickText');
    if(presseLiveText && presseLiveText.dataset.liveBound !== '1') {
        presseLiveText.dataset.liveBound = '1';
        presseLiveText.addEventListener('keydown', event => {
            if(event.key === 'Enter') {
                event.preventDefault();
                submitLiveNews();
            }
        });
    }
    const wikiTitle = document.getElementById('wikiPageTitle');
    if(wikiTitle && wikiTitle.dataset.draftBound !== '1') {
        wikiTitle.dataset.draftBound = '1';
        wikiTitle.addEventListener('input', syncWikiDraftFromComposer);
    }
    const wikiContent = document.getElementById('wikiPageContent');
    if(wikiContent && wikiContent.dataset.draftBound !== '1') {
        wikiContent.dataset.draftBound = '1';
        wikiContent.addEventListener('input', syncWikiDraftFromComposer);
    }
}

function updatePresseWriteBox() {
    const composerModal = document.getElementById('presse-compose-modal');
    const notice = document.getElementById('presse-no-journalist');
    const toggleButton = document.getElementById('presse-compose-toggle');
    const liveToggleButton = document.getElementById('presse-live-compose-toggle');
    const liveComposeBox = document.getElementById('presse-live-compose-box');
    if(!composerModal || !notice || !toggleButton || !liveToggleButton || !liveComposeBox) return;
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    const isJournalist = char && (char.role && (char.role.toLowerCase().includes('journaliste') || char.isOfficial));
    const canWriteForbidden = IS_ADMIN && isForbiddenPresseMode();
    if(isJournalist || canWriteForbidden) {
        toggleButton.classList.remove('hidden');
        liveToggleButton.classList.toggle('hidden', !isJournalist);
        toggleButton.innerHTML = isPresseComposerOpen
            ? '<i class="fa-solid fa-xmark"></i> Fermer l\'éditeur'
            : (canWriteForbidden ? '<i class="fa-solid fa-file-shield"></i> Ouvrir Dossier Kael' : '<i class="fa-solid fa-feather-pointed"></i> Créer un article');
        composerModal.classList.toggle('hidden', !isPresseComposerOpen);
        liveComposeBox.classList.toggle('hidden', !isJournalist || !isLiveNewsComposerOpen);
        notice.classList.add('hidden');
    } else {
        isPresseComposerOpen = false;
        isLiveNewsComposerOpen = false;
        toggleButton.classList.add('hidden');
        liveToggleButton.classList.add('hidden');
        composerModal.classList.add('hidden');
        liveComposeBox.classList.add('hidden');
        notice.classList.remove('hidden');
    }
    syncPresseComposerMode();
    updatePresseLiveToggleUI();
}

function handlePresseJournalSearchKeydown(event) {
    if(event.key !== 'Enter') return;
    if(!IS_ADMIN || !isForbiddenPresseMode()) return;
    event.preventDefault();
    openForbiddenDossierComposer();
}

document.addEventListener('keydown', (event) => {
    if(event.key === 'Escape' && isPresseComposerOpen) {
        closePresseComposer();
    }
    if(event.key === 'Escape' && isLiveNewsPanelOpen) {
        toggleLiveNewsPanel(false);
    }
    if(event.key === 'Escape') {
        closeStandaloneLiveNewsModal();
    }
});

function updateBreakingNewsVisibility() {
    const label = document.getElementById('breakingNewsLabel'); if(!label) return;
    const char = myCharacters.find(c => c._id === currentFeedCharId);
    if(char && char.isOfficial) { label.style.display = 'flex'; } else { label.style.display = 'none'; document.getElementById('postBreakingNews').checked = false; }
}

// ==================== PROFILE PLEIN ÉCRAN ====================
// [NOUVEAU] State profil courant
let currentProfileChar = null;

function renderProfileActivityArchive() {
    const activityFeed = document.getElementById('profileActivityFeed');
    const activityMeta = document.getElementById('profileActivityMeta');
    const pagination = document.getElementById('profileActivityPagination');
    const prevButton = document.getElementById('profileActivityPrev');
    const nextButton = document.getElementById('profileActivityNext');
    const pageInfo = document.getElementById('profileActivityPageInfo');
    const posts = Array.isArray(currentProfileChar?.lastPosts) ? currentProfileChar.lastPosts : [];
    const totalPages = Math.max(1, Math.ceil(posts.length / PROFILE_ACTIVITY_PAGE_SIZE));

    if(activityMeta) {
        activityMeta.textContent = posts.length ? `${posts.length} post${posts.length > 1 ? 's' : ''}` : 'Aucun post';
        activityMeta.classList.remove('hidden');
    }

    if(!activityFeed) return;

    if(!posts.length) {
        activityFeed.innerHTML = '<div class="profile-activity-empty">Aucun post archivé pour ce personnage.</div>';
        if(pagination) pagination.classList.add('hidden');
        return;
    }

    currentProfileActivityPage = Math.min(Math.max(1, currentProfileActivityPage), totalPages);
    const startIndex = (currentProfileActivityPage - 1) * PROFILE_ACTIVITY_PAGE_SIZE;
    const pagePosts = posts.slice(startIndex, startIndex + PROFILE_ACTIVITY_PAGE_SIZE);

    activityFeed.innerHTML = '';
    pagePosts.forEach(post => {
        const mini = document.createElement('div');
        mini.className = 'profile-mini-post';
        mini.onclick = () => openPostDetail(String(post._id), post);
        mini.innerHTML = `
            <div class="profile-mini-post-content">${formatText(post.content || '')}</div>
            <div class="profile-mini-post-meta">
                <span><i class="fa-solid fa-heart" style="color:var(--danger);"></i> ${getPostLikeCountLabel(post)}</span>
                <span><i class="fa-regular fa-comment"></i> ${Array.isArray(post.comments) ? post.comments.length : 0}</span>
                <span style="color:var(--text-muted);">${post.date || ''}</span>
                <span class="profile-mini-post-open"><i class="fa-solid fa-up-right-from-square"></i> Ouvrir</span>
                ${IS_ADMIN ? `<button class="admin-stat-btn" onclick="event.stopPropagation(); openAdminStatsModal('${post._id}', '${getPostLikeCountLabel(post).replace(/'/g, "\\'")}')"><i class="fa-solid fa-pen"></i></button>` : ''}
            </div>`;
        activityFeed.appendChild(mini);
    });

    if(pagination && prevButton && nextButton && pageInfo) {
        pagination.classList.toggle('hidden', totalPages <= 1);
        prevButton.disabled = currentProfileActivityPage <= 1;
        nextButton.disabled = currentProfileActivityPage >= totalPages;
        pageInfo.textContent = `Page ${currentProfileActivityPage} / ${totalPages}`;
    }
}

function changeProfileActivityPage(delta) {
    const posts = Array.isArray(currentProfileChar?.lastPosts) ? currentProfileChar.lastPosts : [];
    if(!posts.length) return;
    const totalPages = Math.max(1, Math.ceil(posts.length / PROFILE_ACTIVITY_PAGE_SIZE));
    currentProfileActivityPage = Math.min(totalPages, Math.max(1, currentProfileActivityPage + delta));
    renderProfileActivityArchive();
}

function openProfile(name) {
    addRecentActivity({ type: 'character', id: name, label: name, meta: 'Profil personnage' });
    currentProfileChar = null;
    currentProfileActivityPage = 1;
    ['profileName','profileRole','profileDesc','profileOwner'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = ''; });
    ['profileFollowersCount','profilePostCount'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '0'; });
    const av = document.getElementById('profileAvatar'); if(av) av.src = '';
    const pb = document.getElementById('profilePartyBadge'); if(pb) pb.style.display = 'none';
    const af = document.getElementById('profileActivityFeed'); if(af) af.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:0.82rem;">Chargement...</div>';
    const am = document.getElementById('profileActivityMeta'); if(am) { am.textContent = ''; am.classList.add('hidden'); }
    const ap = document.getElementById('profileActivityPagination'); if(ap) ap.classList.add('hidden');
    const cg = document.getElementById('profileCompaniesGrid'); if(cg) cg.innerHTML = '';
    const cs = document.getElementById('profileCompaniesSection'); if(cs) cs.style.display = 'none';
    closeBioEdit();
    const overlay = document.getElementById('profile-overlay');
    const panel = document.getElementById('profile-slide-panel');
    overlay.classList.remove('hidden');
    overlay.onclick = closeProfileModal;
    if(panel) panel.onclick = event => event.stopPropagation();
    panel.classList.add('open');
    socket.emit('get_char_profile', name);
}
function closeProfileModal() { 
    document.getElementById('profile-slide-panel').classList.remove('open'); 
    document.getElementById('profile-overlay').classList.add('hidden');
    currentProfileChar = null;
    currentProfileActivityPage = 1;
}
function editMyCharFromProfile() {
    if(!currentProfileChar) return;
    const char = myCharacters.find(c => c._id === currentProfileChar._id);
    if(!char) return;
    closeProfileModal();
    prepareEditCharacter(char._id);
}

socket.on('char_profile_data', (char) => {
    const isSameProfile = currentProfileChar && String(currentProfileChar._id) === String(char._id);
    currentProfileChar = char;
    if(!isSameProfile) currentProfileActivityPage = 1;
    if(window.__pendingProfileEdit && String(window.__pendingProfileEdit) === String(char._id)) {
        window.__pendingProfileEdit = null;
        closeProfileModal();
        prepareEditAnyCharacter(char._id);
        return;
    }

    // En-tête héro
    document.getElementById('profileName').textContent = char.name;
    document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileAvatar').src = char.avatar;

    // Fond héro avec couleur du perso
    const heroBg = document.getElementById('profileHeroBg');
    if(heroBg) heroBg.style.background = `linear-gradient(135deg, ${char.color || 'var(--accent)'}33 0%, var(--bg-secondary) 100%)`;

    // Parti dans header
    const partyBadgeEl = document.getElementById('profilePartyBadge');
    if(char.partyName) {
        partyBadgeEl.style.display = 'block';
        partyBadgeEl.innerHTML = char.partyLogo 
            ? `<span class="profile-party-tag"><img src="${char.partyLogo}" class="party-logo" style="width:18px;height:18px;"> ${char.partyName}</span>`
            : `<span class="profile-party-tag">🏛️ ${char.partyName}</span>`;
    } else {
        partyBadgeEl.style.display = 'none';
    }

    // Stats
    const followersCount = getFollowerCountLabel(char);
    document.getElementById('profileFollowersCount').textContent = followersCount;
    document.getElementById('profilePostCount').textContent = char.postCount || 0;

    // Admin edit followers
    const adminFollowersBtn = document.getElementById('adminEditFollowers');
    if(adminFollowersBtn) { 
        if(IS_ADMIN) adminFollowersBtn.classList.remove('hidden'); 
        else adminFollowersBtn.classList.add('hidden'); 
    }

    // Voir abonnés
    document.getElementById('btn-view-followers').onclick = () => socket.emit('get_followers_list', char._id);

    // Bio
    setBioWithVoirPlus('profileDesc', char.description || '');
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "Inconnu"}`;
    if(char.partyName && char.partyLogo) {
        document.getElementById('profileOwner').innerHTML += ` <span class="party-badge" style="display:inline-flex;"><img src="${char.partyLogo}" class="party-logo"> ${char.partyName}</span>`;
    }

    // [CITÉS] Badge "Président de X" si ce perso est président d'une cité
    const presidedCity = citiesData.find(c => c.president && c.president.toLowerCase() === char.name.toLowerCase());
    const presidentBadgeEl = document.getElementById('profilePresidentBadge');
    if(presidedCity && presidentBadgeEl) {
        presidentBadgeEl.innerHTML = `<span class="president-badge"><i class="fa-solid fa-landmark"></i> Président de ${presidedCity.name}</span>`;
        presidentBadgeEl.style.display = 'block';
    } else if(presidentBadgeEl) {
        presidentBadgeEl.style.display = 'none';
        presidentBadgeEl.innerHTML = '';
    }

    // [NOUVEAU] Bouton modifier bio — visible seulement si c'est un de nos persos
    const btnEditBio = document.getElementById('btn-edit-bio');
    const isOwnChar = myCharacters.some(c => c._id === char._id);
    if(btnEditBio) {
        if(isOwnChar) { btnEditBio.classList.remove('hidden'); }
        else { btnEditBio.classList.add('hidden'); closeBioEdit(); }
    }

    // Bouton modifier personnage — visible seulement si c'est un de nos persos
    const btnEditMyChar = document.getElementById('btn-edit-my-char');
    if(btnEditMyChar) {
        if(isOwnChar) { btnEditMyChar.classList.remove('hidden'); }
        else { btnEditMyChar.classList.add('hidden'); }
    }

    // Bouton DM compte
    const btnDm = document.getElementById('btn-dm-profile');
    btnDm.onclick = function() { closeProfileModal(); if(char.ownerUsername) openDm(char.ownerUsername); };

    // [NOUVEAU] Bouton DM Personnage — visible si on a des persos et que c'est pas nous
    const btnCharDm = document.getElementById('btn-char-dm-profile');
    if(myCharacters.length > 0 && !isOwnChar && PLAYER_ID) {
        btnCharDm.classList.remove('hidden');
        btnCharDm.onclick = () => openCharDmModal(char);
    } else {
        btnCharDm.classList.add('hidden');
    }

    // Bouton suivre
    const btnSub = document.getElementById('btn-sub-profile');
    if(isOwnChar || currentFeedCharId === char._id) { btnSub.style.display = 'none'; }
    else {
        btnSub.style.display = 'block';
        const isSubbed = char.followers && currentFeedCharId && char.followers.includes(currentFeedCharId);
        updateSubButton(btnSub, isSubbed);
        btnSub.onclick = function() {
            if(!currentFeedCharId) return alert("Sélectionnez un personnage dans le Feed !");
            socket.emit('follow_character', { followerCharId: currentFeedCharId, targetCharId: char._id });
        };
    }

    // [NOUVEAU] Bouton admin entreprises
    const btnCompanies = document.getElementById('btn-manage-companies');
    if(IS_ADMIN && !isOwnChar) { btnCompanies.classList.remove('hidden'); }
    else { btnCompanies.classList.add('hidden'); }

    // [NOUVEAU] Section Entreprises
    const companiesSection = document.getElementById('profileCompaniesSection');
    const companiesGrid = document.getElementById('profileCompaniesGrid');
    if(char.companies && char.companies.length > 0) {
        companiesSection.style.display = 'block';
        companiesGrid.innerHTML = '';
        char.companies.forEach((co, idx) => {
            const delBtn = IS_ADMIN ? `<button class="company-card-del" onclick="adminRemoveCompany('${char._id}', ${idx})" title="Retirer"><i class="fa-solid fa-xmark"></i></button>` : '';
            companiesGrid.innerHTML += `
                <div class="company-card">
                    ${delBtn}
                    <div class="company-card-logo">${co.logo ? `<img src="${co.logo}" alt="${co.name}">` : `<i class="fa-solid fa-building"></i>`}</div>
                    <div class="company-card-name">${co.name}</div>
                    <div class="company-card-role">${co.role || ''}</div>
                    ${co.description ? `<div class="company-card-desc">${co.description}</div>` : ''}
                </div>`;
        });
    } else {
        companiesSection.style.display = IS_ADMIN ? 'block' : 'none';
        if(IS_ADMIN) companiesGrid.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem; font-style:italic;">Aucune entreprise. Cliquez sur "Entreprises" pour en ajouter.</div>';
    }

    renderProfileActivityArchive();
});

socket.on('char_profile_updated', (char) => { 
    if(document.getElementById('profile-slide-panel').classList.contains('open') && document.getElementById('profileName').textContent === char.name) {
        const isSubbed = char.followers && currentFeedCharId && char.followers.includes(currentFeedCharId);
        updateSubButton(document.getElementById('btn-sub-profile'), isSubbed); 
        document.getElementById('profileFollowersCount').textContent = getFollowerCountLabel(char);
    }
});
function updateSubButton(btn, subbed) { btn.innerHTML = subbed ? '<i class="fa-solid fa-check"></i> Abonné' : '<i class="fa-solid fa-rss"></i> S\'abonner'; btn.style.color = subbed ? '#23a559' : 'white'; }

// [NOUVEAU] Modifier bio
function openBioEdit() {
    document.getElementById('bio-edit-zone').classList.remove('hidden');
    document.getElementById('btn-edit-bio').classList.add('hidden');
    document.getElementById('bioEditInput').value = currentProfileChar ? (currentProfileChar.description || '') : '';
}
function closeBioEdit() {
    document.getElementById('bio-edit-zone').classList.add('hidden');
    const btn = document.getElementById('btn-edit-bio');
    const isOwnChar = currentProfileChar && myCharacters.some(c => c._id === currentProfileChar._id);
    if(btn && isOwnChar) btn.classList.remove('hidden');
}
function saveBio() {
    if(!currentProfileChar) return;
    const bio = document.getElementById('bioEditInput').value.trim();
    socket.emit('update_char_bio', { charId: currentProfileChar._id, bio, ownerId: PLAYER_ID });
    setBioWithVoirPlus('profileDesc', bio);
    closeBioEdit();
}

// [NOUVEAU] Admin — modale entreprise
function openCompanyModal() {
    if(!currentProfileChar) return;
    const list = document.getElementById('company-existing-list');
    list.innerHTML = '';
    if(currentProfileChar.companies && currentProfileChar.companies.length > 0) {
        currentProfileChar.companies.forEach((co, idx) => {
            const revenueHTML = IS_ADMIN
                ? `<span style="font-size:0.7rem;color:var(--accent-soft);margin-right:4px;">${(co.revenue||0)>0 ? formatStockValue(co.revenue)+' CA' : 'CA: —'}</span><button onclick="adminSetCompanyRevenue('${currentProfileChar._id}','${co.name.replace(/'/g,"&apos;")}',${co.revenue||0})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.85rem;" title="Modifier CA"><i class="fa-solid fa-coins"></i></button>`
                : `${(co.revenue||0)>0 ? `<span style="font-size:0.7rem;color:var(--accent-soft);">${formatStockValue(co.revenue)} CA</span>` : ''}`;
            list.innerHTML += `<div style="display:flex; align-items:center; gap:8px; padding:8px; background:var(--bg-primary); border-radius:var(--radius-sm); margin-bottom:6px;">
                ${co.logo ? `<img src="${co.logo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : '<i class="fa-solid fa-building" style="color:var(--text-muted);"></i>'}
                <span style="flex:1; font-weight:600;">${co.name}</span>
                ${revenueHTML}
                <span style="font-size:0.75rem; color:var(--text-muted);">${co.role}</span>
                <button onclick="adminRemoveCompany('${currentProfileChar._id}', ${idx}); closeCompanyModal();" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        });
    } else {
        list.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem; margin-bottom:8px;">Aucune entreprise associée.</div>';
    }
    document.getElementById('company-modal').classList.remove('hidden');
    snapForm('company-modal');
}
function closeCompanyModal() { guardClose('company-modal', () => { document.getElementById('company-modal').classList.add('hidden'); }); }

async function submitAddCompany() {
    if(!currentProfileChar || !IS_ADMIN) return;
    const name = document.getElementById('companyName').value.trim();
    const role = document.getElementById('companyRole').value.trim();
    const desc = document.getElementById('companyDesc').value.trim();
    const hq   = document.getElementById('companyHQ')?.value.trim() || null;
    const rev  = parseFloat(document.getElementById('companyRevenue')?.value) || 0;
    const logoFile = document.getElementById('companyLogoFile').files[0];
    if(!name) return alert("Nom de l'entreprise requis.");
    let logo = null;
    if(logoFile) logo = await uploadToCloudinary(logoFile);
    socket.emit('admin_add_company', { charId: currentProfileChar._id, company: { name, logo, role, description: desc, headquarters: hq, revenue: rev } });
    document.getElementById('companyName').value = '';
    document.getElementById('companyRole').value = '';
    document.getElementById('companyDesc').value = '';
    if(document.getElementById('companyHQ')) document.getElementById('companyHQ').value = '';
    if(document.getElementById('companyRevenue')) document.getElementById('companyRevenue').value = '';
    document.getElementById('companyLogoFile').value = '';
    _unsavedBypass = true;
    closeCompanyModal();
}
function adminRemoveCompany(charId, idx) {
    if(!IS_ADMIN) return;
    if(confirm('Retirer cette entreprise ?')) socket.emit('admin_remove_company', { charId, companyIndex: idx });
}

// [NOUVEAU] Admin — modifier stats abonnés
function adminEditFollowers() {
    if(!currentProfileChar || !IS_ADMIN) return;
    document.getElementById('adminStatsMode').value = 'followers';
    document.getElementById('adminStatsPostId').value = '';
    document.getElementById('adminStatsCharId').value = currentProfileChar._id;
    document.getElementById('adminStatsTitle').textContent = '⚙️ Modifier les abonnés';
    document.getElementById('adminStatsLabel').textContent = 'Nombre d’abonnés';
    document.getElementById('adminStatsLikes').value = getFollowerCountLabel(currentProfileChar);
    document.getElementById('admin-stats-modal').classList.remove('hidden');
}

// [NOUVEAU] Admin — modale stats post (likes)
function openAdminStatsModal(postId, currentLikes) {
    document.getElementById('adminStatsMode').value = 'likes';
    document.getElementById('adminStatsPostId').value = postId;
    document.getElementById('adminStatsCharId').value = '';
    document.getElementById('adminStatsTitle').textContent = '⚙️ Modifier les likes';
    document.getElementById('adminStatsLabel').textContent = 'Nombre de likes';
    document.getElementById('adminStatsLikes').value = currentLikes;
    document.getElementById('admin-stats-modal').classList.remove('hidden');
}
function closeAdminStatsModal() {
    document.getElementById('admin-stats-modal').classList.add('hidden');
    document.getElementById('adminStatsMode').value = '';
    document.getElementById('adminStatsPostId').value = '';
    document.getElementById('adminStatsCharId').value = '';
}
function submitAdminStats() {
    const mode = document.getElementById('adminStatsMode').value;
    const countDisplay = normalizeCompactCountStorage(document.getElementById('adminStatsLikes').value);
    if(!countDisplay) {
        alert('Format invalide. Exemples : 12500, 12k, 1m 46k');
        return;
    }
    if(mode === 'followers') {
        socket.emit('admin_edit_followers', { charId: document.getElementById('adminStatsCharId').value, countDisplay });
    } else {
        socket.emit('admin_edit_post_likes', { postId: document.getElementById('adminStatsPostId').value, countDisplay });
    }
    closeAdminStatsModal();
}

// ==================== MP PERSONNAGES (Refonte claire) ====================
/*
  Clé de conv : "monCharId|autreCharId"
  Chaque conversation est liée à UN de MES persos ↔ UN perso cible.
  La sidebar groupe les convos par MON perso pour une clarté totale.
*/

let charDmTarget = null;
let charMpConversations = {};
let charMpCurrentKey = null;
let charMpArchiveConversations = {};
let charMpArchiveCurrentKey = null;
let charMpArchiveLoaded = false;
let charMpArchiveInView = false;
let charMpTypingTimeout = null;
let charMpTypingState = { roomId: null, label: '' };
let charMpRemoteTypers = new Map();

function mpKey(a, b) { return `${a}|${b}`; }
function mpParse(key) { const [a, b] = key.split('|'); return { myCharId: a, otherCharId: b }; }
function getCharDmRoomId(senderCharId, targetCharId) { return `char_dm_${[senderCharId, targetCharId].sort().join('_')}`; }
function isCharMpVisible() {
    const panel = document.getElementById('reseau-panel-mp');
    return currentView === 'reseau' && !!panel && !panel.classList.contains('hidden');
}
function isCharMpTabActive() {
    return isCharMpVisible() && localStorage.getItem('last_reseau_tab') === 'mp';
}
function getCharMpConversation(key) { return charMpConversations[key] || null; }
function getArchivedCharMpConversation(key) { return charMpArchiveConversations[key] || null; }
function getMessageTimeValue(msg) {
    if(msg?.timestamp) {
        const value = new Date(msg.timestamp).getTime();
        if(!Number.isNaN(value)) return value;
    }
    return 0;
}
function setCharMpArchiveMode(enabled) {
    charMpArchiveInView = enabled;
    const liveEmpty = document.getElementById('char-mp-empty');
    const liveConvo = document.getElementById('char-mp-convo');
    const archives = document.getElementById('char-mp-archives');
    if(!liveEmpty || !liveConvo || !archives) return;
    if(enabled) {
        liveEmpty.classList.add('hidden');
        liveConvo.classList.add('hidden');
        archives.classList.remove('hidden');
        return;
    }
    archives.classList.add('hidden');
    if(charMpCurrentKey && charMpConversations[charMpCurrentKey]) {
        liveConvo.classList.remove('hidden');
        liveConvo.style.display = 'flex';
        liveEmpty.classList.add('hidden');
    } else {
        liveConvo.classList.add('hidden');
        liveEmpty.classList.remove('hidden');
    }
}
function hideCharMpTypingUI() {
    const mainTyping = document.getElementById('char-mp-typing');
    const modalTyping = document.getElementById('char-dm-typing');
    if(mainTyping) {
        mainTyping.textContent = '';
        mainTyping.classList.add('hidden');
    }
    if(modalTyping) {
        modalTyping.textContent = '';
        modalTyping.classList.add('hidden');
    }
}
function updateCharMpTypingUI() {
    const mainTyping = document.getElementById('char-mp-typing');
    const modalTyping = document.getElementById('char-dm-typing');
    const mainRoomId = charMpCurrentKey ? getCharDmRoomId(...Object.values(mpParse(charMpCurrentKey))) : null;
    const modalSenderId = document.getElementById('charDmSenderSelect')?.value || null;
    const modalRoomId = (charDmTarget && modalSenderId) ? getCharDmRoomId(modalSenderId, charDmTarget._id) : null;
    const mainLabel = mainRoomId ? charMpRemoteTypers.get(mainRoomId) : '';
    const modalLabel = modalRoomId ? charMpRemoteTypers.get(modalRoomId) : '';
    if(mainTyping) {
        if(mainLabel && !charMpArchiveInView) {
            mainTyping.textContent = `${mainLabel} écrit...`;
            mainTyping.classList.remove('hidden');
        } else {
            mainTyping.textContent = '';
            mainTyping.classList.add('hidden');
        }
    }
    if(modalTyping) {
        if(modalLabel && charDmTarget) {
            modalTyping.textContent = `${modalLabel} écrit...`;
            modalTyping.classList.remove('hidden');
        } else {
            modalTyping.textContent = '';
            modalTyping.classList.add('hidden');
        }
    }
}
function stopCharMpTyping() {
    if(charMpTypingState.roomId) {
        socket.emit('char_dm_typing_stop', { roomId: charMpTypingState.roomId, label: charMpTypingState.label });
    }
    charMpTypingState = { roomId: null, label: '' };
    if(charMpTypingTimeout) {
        clearTimeout(charMpTypingTimeout);
        charMpTypingTimeout = null;
    }
}
function emitCharMpTyping(roomId, label) {
    if(!roomId || !label) return;
    charMpTypingState = { roomId, label };
    socket.emit('char_dm_typing_start', { roomId, label });
    if(charMpTypingTimeout) clearTimeout(charMpTypingTimeout);
    charMpTypingTimeout = setTimeout(() => {
        socket.emit('char_dm_typing_stop', { roomId, label });
        charMpTypingState = { roomId: null, label: '' };
        charMpTypingTimeout = null;
    }, 1200);
}
function handleCharMpInputTyping() {
    if(!charMpCurrentKey) return;
    const conv = getCharMpConversation(charMpCurrentKey);
    const input = document.getElementById('charMpInput');
    if(!conv || !input) return;
    const roomId = getCharDmRoomId(conv.myChar._id, conv.otherChar._id);
    if(!input.value.trim()) {
        stopCharMpTyping();
        return;
    }
    emitCharMpTyping(roomId, conv.myChar.name || USERNAME || 'Quelqu’un');
}
function handleCharDmModalTyping() {
    if(!charDmTarget) return;
    const input = document.getElementById('charDmInput');
    const senderId = document.getElementById('charDmSenderSelect')?.value || null;
    const senderChar = myCharacters.find(char => String(char._id) === String(senderId));
    if(!input || !senderChar) return;
    const roomId = getCharDmRoomId(senderChar._id, charDmTarget._id);
    if(!input.value.trim()) {
        stopCharMpTyping();
        return;
    }
    emitCharMpTyping(roomId, senderChar.name || USERNAME || 'Quelqu’un');
}
function bindCharMpInputs() {
    const mainInput = document.getElementById('charMpInput');
    if(mainInput && mainInput.dataset.typingBound !== '1') {
        mainInput.dataset.typingBound = '1';
        mainInput.addEventListener('input', handleCharMpInputTyping);
    }
    const modalInput = document.getElementById('charDmInput');
    if(modalInput && modalInput.dataset.typingBound !== '1') {
        modalInput.dataset.typingBound = '1';
        modalInput.addEventListener('input', handleCharDmModalTyping);
    }
}
function groupCharMessages(messages, myCharId) {
    const groups = [];
    messages.forEach(msg => {
        const isSelf = String(msg.senderCharId) === String(myCharId);
        const lastGroup = groups[groups.length - 1];
        const canAppend = lastGroup
            && lastGroup.isSelf === isSelf
            && String(lastGroup.senderCharId) === String(msg.senderCharId)
            && Math.abs(getMessageTimeValue(msg) - lastGroup.lastTimestamp) <= 5 * 60 * 1000;
        if(canAppend) {
            lastGroup.items.push(msg);
            lastGroup.lastTimestamp = getMessageTimeValue(msg);
            return;
        }
        groups.push({
            isSelf,
            senderCharId: msg.senderCharId,
            senderName: msg.senderName || '',
            senderAvatar: msg.senderAvatar || '',
            senderColor: msg.senderColor || 'var(--accent)',
            items: [msg],
            lastTimestamp: getMessageTimeValue(msg)
        });
    });
    return groups;
}
function renderGroupedCharMessages(containerId, messages, myCharId, scrollMode = 'bottom') {
    const container = document.getElementById(containerId);
    if(!container) return;
    const previousHeight = container.scrollHeight;
    const previousTop = container.scrollTop;
    const fragment = document.createDocumentFragment();
    groupCharMessages(messages, myCharId).forEach(group => {
        const block = document.createElement('div');
        block.className = `cmp-block ${group.isSelf ? 'cmp-block-self' : 'cmp-block-other'}`;
        block.innerHTML = group.isSelf
            ? `
                <div class="cmp-block-body" style="--sender-color:${group.senderColor};">
                    <div class="cmp-block-head">${escapeHtml(group.senderName)}</div>
                    <div class="cmp-block-stack"></div>
                </div>
                <img src="${group.senderAvatar}" class="cmp-block-avatar" title="${escapeHtml(group.senderName)}" onerror="this.style.opacity=0">`
            : `
                <img src="${group.senderAvatar}" class="cmp-block-avatar" title="${escapeHtml(group.senderName)}" onerror="this.style.opacity=0">
                <div class="cmp-block-body" style="--sender-color:${group.senderColor};">
                    <div class="cmp-block-head">${escapeHtml(group.senderName)}</div>
                    <div class="cmp-block-stack"></div>
                </div>`;
        const stack = block.querySelector('.cmp-block-stack');
        const bubble = document.createElement('div');
        bubble.className = 'cmp-block-text';
        group.items.forEach(item => {
            const line = document.createElement('div');
            line.className = 'cmp-block-line';
            line.innerHTML = `
                <div class="cmp-block-line-text">${formatText(item.content || '')}</div>
                <span class="cmp-block-time">${escapeHtml(item.date || '')}</span>`;
            bubble.appendChild(line);
        });
        stack.appendChild(bubble);
        fragment.appendChild(block);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
    if(scrollMode === 'preserve') {
        container.scrollTop = container.scrollHeight - previousHeight + previousTop;
    } else if(scrollMode === 'top') {
        container.scrollTop = 0;
    } else {
        container.scrollTop = container.scrollHeight;
    }
}
function updateCharMpLoadMoreButton(key) {
    const conv = key ? getCharMpConversation(key) : null;
    const mainBtn = document.getElementById('char-mp-more');
    if(mainBtn) mainBtn.classList.toggle('hidden', !(conv && conv.hasMore && charMpCurrentKey === key && !charMpArchiveInView));
}
function updateCharDmModalLoadMoreButton(key) {
    const conv = key ? getCharMpConversation(key) : null;
    const btn = document.getElementById('char-dm-more');
    if(btn) btn.classList.toggle('hidden', !(conv && conv.hasMore && charDmTarget));
}
function requestCharMpHistoryPage(key, page) {
    const conv = getCharMpConversation(key);
    if(!conv) return;
    socket.emit('request_char_dm_history', {
        senderCharId: conv.myChar._id,
        targetCharId: conv.otherChar._id,
        page,
        pageSize: CHAT_PAGE_SIZE
    });
}
function renderCharMpThread(key, scrollMode = 'bottom') {
    const conv = getCharMpConversation(key);
    if(!conv) return;
    renderGroupedCharMessages('char-mp-messages', conv.msgs || [], conv.myChar._id, scrollMode);
    updateCharMpLoadMoreButton(key);
}
function renderCharDmModalMessages(scrollMode = 'bottom') {
    if(!charDmTarget) return;
    const senderId = document.getElementById('charDmSenderSelect')?.value || null;
    const key = senderId ? mpKey(senderId, charDmTarget._id) : null;
    const conv = key ? getCharMpConversation(key) : null;
    if(!conv) {
        updateCharDmModalLoadMoreButton(null);
        return;
    }
    renderGroupedCharMessages('char-dm-messages', conv.msgs || [], conv.myChar._id, scrollMode);
    updateCharDmModalLoadMoreButton(key);
}
function loadMyCharConvos() {
    const ids = myCharacters.map(c => c._id);
    if(!ids.length) return;
    socket.emit('request_my_char_convos', { myCharIds: ids });
}
function loadArchivedCharMpConvos(forceReload = false) {
    if(charMpArchiveLoaded && !forceReload) return;
    const ids = myCharacters.map(c => c._id);
    if(!ids.length) return;
    socket.emit('request_archived_char_convos', { myCharIds: ids });
}
function buildCharMpGroups(source, activeKey) {
    const groups = {};
    Object.entries(source).forEach(([key, conv]) => {
        const myId = String(conv.myChar._id);
        if(!groups[myId]) groups[myId] = { myChar: conv.myChar, convos: [] };
        groups[myId].convos.push({ key, ...conv });
    });
    Object.values(groups).forEach(group => group.convos.sort((a, b) => getMessageTimeValue({ timestamp: b.lastDate }) - getMessageTimeValue({ timestamp: a.lastDate })));
    return groups;
}
function renderCharMpSidebar() {
    const list = document.getElementById('char-mp-convo-list');
    if(!list) return;
    list.innerHTML = '';
    const groups = buildCharMpGroups(charMpConversations, charMpCurrentKey);
    if(!Object.keys(groups).length) {
        list.innerHTML = `<div class="char-mp-empty-list"><i class="fa-solid fa-inbox"></i><span>Aucun message</span></div>`;
        return;
    }
    myCharacters.forEach(myChar => {
        const group = groups[String(myChar._id)];
        if(!group) return;
        const groupEl = document.createElement('div');
        groupEl.className = 'char-mp-group';
        groupEl.innerHTML = `
            <div class="char-mp-group-header">
                <img src="${myChar.avatar || ''}" class="char-mp-group-avatar" onerror="this.style.opacity=0">
                <div class="char-mp-group-info">
                    <span class="char-mp-group-name" style="color:${myChar.color || 'white'};">${myChar.name}</span>
                    <span class="char-mp-group-role">${myChar.role || ''}</span>
                </div>
            </div>`;
        const convList = document.createElement('div');
        convList.className = 'char-mp-group-convos';
        group.convos.forEach(conv => {
            const item = document.createElement('div');
            const isActive = charMpCurrentKey === conv.key && !charMpArchiveInView;
            item.className = `char-mp-conv-item${isActive ? ' active' : ''}${conv.unread ? ' unread' : ''}`;
            item.onclick = () => openCharMpConvo(conv.key);
            item.innerHTML = `
                <img src="${conv.otherChar.avatar || ''}" class="char-mp-conv-avatar" onerror="this.style.opacity=0">
                <div class="char-mp-conv-info">
                    <div class="char-mp-conv-name" style="color:${conv.otherChar.color || 'var(--text-normal)'};">${conv.otherChar.name || 'Inconnu'}</div>
                    <div class="char-mp-conv-last">${conv.lastContent ? (conv.lastContent.length > 40 ? `${conv.lastContent.slice(0, 40)}…` : conv.lastContent) : ''}</div>
                </div>
                ${conv.unread ? '<span class="char-mp-unread-dot"></span>' : ''}`;
            convList.appendChild(item);
        });
        groupEl.appendChild(convList);
        list.appendChild(groupEl);
    });
}
function renderArchivedCharMpList() {
    const list = document.getElementById('char-mp-archive-list');
    if(!list) return;
    list.innerHTML = '';
    const groups = buildCharMpGroups(charMpArchiveConversations, charMpArchiveCurrentKey);
    if(!Object.keys(groups).length) {
        list.innerHTML = `<div class="char-mp-empty-list"><i class="fa-solid fa-box-archive"></i><span>Aucune archive trouvée</span></div>`;
        return;
    }
    myCharacters.forEach(myChar => {
        const group = groups[String(myChar._id)];
        if(!group) return;
        const wrap = document.createElement('div');
        wrap.className = 'char-mp-group';
        wrap.innerHTML = `
            <div class="char-mp-group-header">
                <img src="${myChar.avatar || ''}" class="char-mp-group-avatar" onerror="this.style.opacity=0">
                <div class="char-mp-group-info">
                    <span class="char-mp-group-name" style="color:${myChar.color || 'white'};">${myChar.name}</span>
                    <span class="char-mp-group-role">Archives</span>
                </div>
            </div>`;
        const convList = document.createElement('div');
        convList.className = 'char-mp-group-convos';
        group.convos.forEach(conv => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `char-mp-conv-item char-mp-archive-item${charMpArchiveCurrentKey === conv.key ? ' active' : ''}`;
            item.onclick = () => openArchivedCharMpConvo(conv.key);
            item.innerHTML = `
                <img src="${conv.otherChar.avatar || ''}" class="char-mp-conv-avatar" onerror="this.style.opacity=0">
                <div class="char-mp-conv-info">
                    <div class="char-mp-conv-name" style="color:${conv.otherChar.color || 'var(--text-normal)'};">${conv.otherChar.name || 'Inconnu'}</div>
                    <div class="char-mp-conv-last">${conv.lastContent ? (conv.lastContent.length > 40 ? `${conv.lastContent.slice(0, 40)}…` : conv.lastContent) : ''}</div>
                </div>`;
            convList.appendChild(item);
        });
        wrap.appendChild(convList);
        list.appendChild(wrap);
    });
}
function hydrateCharMpHeader(conv) {
    document.getElementById('mpMySenderAvatar').src = conv.myChar.avatar || '';
    document.getElementById('mpMySenderName').textContent = conv.myChar.name || '';
    document.getElementById('mpMySenderRole').textContent = conv.myChar.role || '';
    document.getElementById('mpTargetAvatar').src = conv.otherChar.avatar || '';
    document.getElementById('mpTargetName').textContent = conv.otherChar.name || '';
    document.getElementById('mpTargetRole').textContent = conv.otherChar.role || '';
    document.getElementById('mpMySenderAvatar').style.borderColor = conv.myChar.color || 'var(--border)';
    document.getElementById('mpTargetAvatar').style.borderColor = conv.otherChar.color || 'var(--border)';
    const inputAv = document.getElementById('mpInputSenderAvatar');
    if(inputAv) {
        inputAv.src = conv.myChar.avatar || '';
        inputAv.title = conv.myChar.name || '';
    }
}
function openCharMpConvo(key) {
    stopCharMpTyping();
    charMpCurrentKey = key;
    setCharMpArchiveMode(false);
    const conv = getCharMpConversation(key);
    if(!conv) return;
    conv.unread = false;
    hydrateCharMpHeader(conv);
    renderCharMpSidebar();
    renderCharMpThread(key, 'bottom');
    hideCharMpTypingUI();
    updateDestinationBadges();
    requestCharMpHistoryPage(key, 0);
}
function loadMoreCharMpMessages() {
    if(!charMpCurrentKey) return;
    const conv = getCharMpConversation(charMpCurrentKey);
    if(!conv || !conv.hasMore) return;
    requestCharMpHistoryPage(charMpCurrentKey, (conv.page || 0) + 1);
}
function loadMoreCharDmModalMessages() {
    if(!charDmTarget) return;
    const senderId = document.getElementById('charDmSenderSelect')?.value || null;
    const key = senderId ? mpKey(senderId, charDmTarget._id) : null;
    const conv = key ? getCharMpConversation(key) : null;
    if(!conv || !conv.hasMore) return;
    requestCharMpHistoryPage(key, (conv.page || 0) + 1);
}
function archiveCurrentCharMpConversation() {
    if(!charMpCurrentKey) return;
    const conv = getCharMpConversation(charMpCurrentKey);
    if(!conv) return;
    if(!confirm(`Archiver la conversation entre ${conv.myChar.name} et ${conv.otherChar.name} pour tout le monde ?`)) return;
    socket.emit('archive_char_dm_conversation', {
        senderCharId: conv.myChar._id,
        targetCharId: conv.otherChar._id
    });
}
function openCharMpArchivePage() {
    setCharMpArchiveMode(true);
    stopCharMpTyping();
    loadArchivedCharMpConvos(true);
    renderArchivedCharMpList();
}
function closeCharMpArchivePage() {
    setCharMpArchiveMode(false);
    renderCharMpSidebar();
}
function openArchivedCharMpConvo(key) {
    charMpArchiveCurrentKey = key;
    const conv = getArchivedCharMpConversation(key);
    if(!conv) return;
    conv.msgs = [];
    conv.page = -1;
    conv.hasMore = false;
    conv.total = 0;
    document.getElementById('char-mp-archive-empty').classList.add('hidden');
    document.getElementById('char-mp-archive-thread').classList.remove('hidden');
    document.getElementById('char-mp-archive-thread-title').textContent = `${conv.myChar.name} -> ${conv.otherChar.name}`;
    document.getElementById('char-mp-archive-thread-meta').textContent = 'Archives paginées';
    renderArchivedCharMpList();
    socket.emit('request_archived_char_dm_history', { senderCharId: conv.myChar._id, targetCharId: conv.otherChar._id, page: 0 });
}
function loadMoreArchivedCharMpMessages() {
    if(!charMpArchiveCurrentKey) return;
    const conv = getArchivedCharMpConversation(charMpArchiveCurrentKey);
    if(!conv || !conv.hasMore) return;
    socket.emit('request_archived_char_dm_history', {
        senderCharId: conv.myChar._id,
        targetCharId: conv.otherChar._id,
        page: (conv.page || 0) + 1
    });
}
function renderArchivedCharMpThread(key, scrollMode = 'bottom') {
    const conv = getArchivedCharMpConversation(key);
    if(!conv) return;
    renderGroupedCharMessages('char-mp-archive-messages', conv.msgs || [], conv.myChar._id, scrollMode);
    const moreBtn = document.getElementById('char-mp-archive-more');
    if(moreBtn) moreBtn.classList.toggle('hidden', !conv.hasMore);
    const meta = document.getElementById('char-mp-archive-thread-meta');
    if(meta) meta.textContent = `${conv.total || 0} message(s) archivés`;
}
function openProfileFromMp() {
    if(!charMpCurrentKey) return;
    const conv = charMpConversations[charMpCurrentKey];
    if(conv) openProfile(conv.otherChar.name);
}
function sendCharMpMessage() {
    if(!charMpCurrentKey || !PLAYER_ID) return;
    const content = document.getElementById('charMpInput').value.trim();
    if(!content) return;
    const conv = getCharMpConversation(charMpCurrentKey);
    if(!conv) return;
    socket.emit('send_char_dm', {
        senderCharId: conv.myChar._id, senderCharName: conv.myChar.name,
        senderAvatar: conv.myChar.avatar, senderColor: conv.myChar.color, senderRole: conv.myChar.role,
        senderOwnerUsername: USERNAME,
        targetCharId: conv.otherChar._id, targetCharName: conv.otherChar.name,
        targetAvatar: conv.otherChar.avatar || '', targetColor: conv.otherChar.color || '', targetRole: conv.otherChar.role || '',
        targetOwnerId: conv.otherChar.ownerId, targetOwnerUsername: conv.otherChar.ownerUsername || '',
        ownerId: PLAYER_ID, content,
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    document.getElementById('charMpInput').value = '';
    stopCharMpTyping();
    requestAnimationFrame(() => {
        const container = document.getElementById('char-mp-messages');
        if(container) container.scrollTop = container.scrollHeight;
    });
}
socket.on('my_char_convos', (convos) => {
    convos.forEach(c => {
        const myChar = myCharacters.find(ch => String(ch._id) === String(c.myCharId));
        if(!myChar) return;
        const key = mpKey(String(c.myCharId), String(c.otherCharId));
        const existing = charMpConversations[key] || { msgs: [], unread: false };
        charMpConversations[key] = {
            ...existing,
            myChar,
            otherChar: {
                _id: c.otherCharId,
                name: c.otherName,
                avatar: c.otherAvatar || '',
                color: c.otherColor || '',
                role: c.otherRole || '',
                ownerId: c.otherOwnerId || '',
                ownerUsername: c.otherOwnerUsername || ''
            },
            page: existing.page || 0,
            hasMore: existing.hasMore || false,
            total: existing.total || 0,
            lastContent: c.lastContent || existing.lastContent || '',
            lastDate: c.lastDate || existing.lastDate || null
        };
    });
    renderCharMpSidebar();
});
socket.on('archived_char_convos', (convos) => {
    charMpArchiveLoaded = true;
    charMpArchiveConversations = {};
    convos.forEach(c => {
        const myChar = myCharacters.find(ch => String(ch._id) === String(c.myCharId));
        if(!myChar) return;
        const key = mpKey(String(c.myCharId), String(c.otherCharId));
        charMpArchiveConversations[key] = {
            myChar,
            otherChar: {
                _id: c.otherCharId,
                name: c.otherName,
                avatar: c.otherAvatar || '',
                color: c.otherColor || '',
                role: c.otherRole || '',
                ownerId: c.otherOwnerId || '',
                ownerUsername: c.otherOwnerUsername || ''
            },
            msgs: [],
            page: -1,
            hasMore: false,
            total: 0,
            lastContent: c.lastContent || '',
            lastDate: c.lastDate || null
        };
    });
    renderArchivedCharMpList();
});
socket.on('char_dm_history', ({ senderCharId, targetCharId, page, total, hasMore, msgs }) => {
    const keys = [mpKey(String(senderCharId), String(targetCharId)), mpKey(String(targetCharId), String(senderCharId))];
    const activeKey = keys.find(key => charMpConversations[key]);
    if(activeKey) {
        const history = Array.isArray(msgs) ? msgs : [];
        charMpConversations[activeKey].msgs = Number(page) > 0 ? [...history, ...(charMpConversations[activeKey].msgs || [])] : history;
        charMpConversations[activeKey].page = Number(page) || 0;
        charMpConversations[activeKey].total = Number(total) || charMpConversations[activeKey].msgs.length;
        charMpConversations[activeKey].hasMore = !!hasMore;
        charMpConversations[activeKey].lastContent = charMpConversations[activeKey].msgs.length ? charMpConversations[activeKey].msgs[charMpConversations[activeKey].msgs.length - 1].content : (charMpConversations[activeKey].lastContent || '');
        charMpConversations[activeKey].lastDate = charMpConversations[activeKey].msgs.length ? (charMpConversations[activeKey].msgs[charMpConversations[activeKey].msgs.length - 1].timestamp || null) : (charMpConversations[activeKey].lastDate || null);
        if(charMpCurrentKey === activeKey) renderCharMpThread(activeKey, Number(page) > 0 ? 'preserve' : 'bottom');
        renderCharMpSidebar();
    }
    const modal = document.getElementById('char-dm-modal');
    if(modal && !modal.classList.contains('hidden')) renderCharDmModalMessages(Number(page) > 0 ? 'preserve' : 'bottom');
});
socket.on('archived_char_dm_history', ({ senderCharId, targetCharId, page, total, hasMore, msgs }) => {
    const key = mpKey(String(senderCharId), String(targetCharId));
    const conv = getArchivedCharMpConversation(key);
    if(!conv) return;
    conv.msgs = Number(page) > 0 ? [...(msgs || []), ...(conv.msgs || [])] : (msgs || []);
    conv.page = Number(page) || 0;
    conv.total = Number(total) || 0;
    conv.hasMore = !!hasMore;
    renderArchivedCharMpThread(key, Number(page) > 0 ? 'preserve' : 'bottom');
});
socket.on('display_char_dm_typing', ({ roomId, label }) => {
    if(!roomId) return;
    charMpRemoteTypers.set(roomId, label || 'Quelqu’un');
    updateCharMpTypingUI();
});
socket.on('hide_char_dm_typing', ({ roomId }) => {
    if(!roomId) return;
    charMpRemoteTypers.delete(roomId);
    updateCharMpTypingUI();
});
socket.on('receive_char_dm', (msg) => {
    const isForMe = String(msg.targetOwnerId || '') === String(PLAYER_ID || '') || String(msg.ownerId || '') === String(PLAYER_ID || '');
    if(!isForMe) return;
    const myCharIds = myCharacters.map(c => String(c._id));
    const isSenderMine = myCharIds.includes(String(msg.senderCharId));
    const myCharId = isSenderMine ? String(msg.senderCharId) : String(msg.targetCharId);
    const otherCharId = isSenderMine ? String(msg.targetCharId) : String(msg.senderCharId);
    const key = mpKey(myCharId, otherCharId);
    if(!charMpConversations[key]) {
        const myChar = myCharacters.find(c => String(c._id) === myCharId);
        if(!myChar) return;
        charMpConversations[key] = {
            myChar,
            otherChar: {
                _id: otherCharId,
                name: isSenderMine ? msg.targetName : msg.senderName,
                avatar: isSenderMine ? (msg.targetAvatar || '') : (msg.senderAvatar || ''),
                color: isSenderMine ? (msg.targetColor || '') : (msg.senderColor || ''),
                role: isSenderMine ? (msg.targetRole || '') : (msg.senderRole || ''),
                ownerId: isSenderMine ? msg.targetOwnerId : msg.ownerId,
                ownerUsername: isSenderMine ? (msg.targetOwnerUsername || '') : (msg.senderOwnerUsername || '')
            },
            msgs: [],
            unread: false,
            page: 0,
            hasMore: false,
            total: 0,
            lastContent: '',
            lastDate: null
        };
    }
    const conv = charMpConversations[key];
    const alreadyExists = (conv.msgs || []).some(existing => String(existing._id || '') === String(msg._id || ''));
    conv.msgs = alreadyExists ? (conv.msgs || []).map(existing => String(existing._id || '') === String(msg._id || '') ? msg : existing) : [...(conv.msgs || []), msg];
    conv.total = Math.max(Number(conv.total) || 0, conv.msgs.length);
    conv.lastContent = msg.content || '';
    conv.lastDate = msg.timestamp || null;
    if(isCharMpTabActive() && charMpCurrentKey === key && !charMpArchiveInView) {
        renderCharMpThread(key, 'bottom');
    }
    const isOnMp = isCharMpTabActive();
    if(!isOnMp && String(msg.ownerId || '') !== String(PLAYER_ID || '')) {
        conv.unread = true;
    }
    renderCharMpSidebar();
    updateDestinationBadges();
    const modal = document.getElementById('char-dm-modal');
    if(charDmTarget && String(charDmTarget._id) === String(otherCharId) && modal && !modal.classList.contains('hidden')) {
        renderCharDmModalMessages();
    }
    if(notificationsEnabled && msg.ownerId !== PLAYER_ID) notifSound.play().catch(() => {});
});
socket.on('char_dm_archived', ({ senderCharId, targetCharId }) => {
    const possibleKeys = [mpKey(String(senderCharId), String(targetCharId)), mpKey(String(targetCharId), String(senderCharId))];
    possibleKeys.forEach(key => {
        if(charMpConversations[key]) delete charMpConversations[key];
    });
    if(possibleKeys.includes(charMpCurrentKey)) {
        charMpCurrentKey = null;
        setCharMpArchiveMode(false);
        document.getElementById('char-mp-convo')?.classList.add('hidden');
        document.getElementById('char-mp-empty')?.classList.remove('hidden');
    }
    if(charDmTarget && possibleKeys.includes(mpKey(String(document.getElementById('charDmSenderSelect')?.value || ''), String(charDmTarget._id)))) {
        closeCharDmModal();
    }
    renderCharMpSidebar();
    updateCharMpLoadMoreButton(null);
    updateCharDmModalLoadMoreButton(null);
    loadArchivedCharMpConvos(true);
});

// ── Modale nouvelle conversation ──
function openNewConvModal() {
    const sel = document.getElementById('newConvMySender');
    if(sel) sel.innerHTML = myCharacters.map(c=>`<option value="${c._id}">${c.name}</option>`).join('') || '<option value="">— aucun —</option>';
    const inp = document.getElementById('newConvSearch'); if(inp) inp.value='';
    hideCharMpResults();
    document.getElementById('new-conv-modal').classList.remove('hidden');
}
function closeNewConvModal() { document.getElementById('new-conv-modal').classList.add('hidden'); }

function filterCharMpSearch(query) {
    if(!query||query.trim().length<1){ hideCharMpResults(); return; }
    socket.emit('search_chars', { query: query.trim() });
}
function hideCharMpResults() { const r=document.getElementById('newConvResults'); if(r) r.classList.add('hidden'); }

socket.on('chars_search_results', (results) => {
    const box = document.getElementById('newConvResults'); if(!box) return;
    const filtered = results.filter(c => !myCharacters.some(mc=>mc._id===c._id));
    if(!filtered.length) { box.innerHTML='<div class="char-mp-search-item" style="color:var(--text-muted);font-style:italic;padding:10px;">Aucun résultat</div>'; box.classList.remove('hidden'); return; }
    box.innerHTML = filtered.map(c=>`
        <div class="char-mp-search-item" onclick="startNewCharMpConvoFromModal('${c._id}','${(c.name||'').replace(/'/g,"\\'")}','${c.avatar||''}','${c.color||''}','${c.role||''}','${c.ownerId||''}','${c.ownerUsername||''}')">
            <img src="${c.avatar||''}" class="char-mp-search-avatar" onerror="this.style.opacity=0">
            <div>
                <div style="font-weight:700;font-size:0.85rem;color:${c.color||'white'};">${c.name}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">${c.role||''} · ${c.ownerUsername||''}</div>
            </div>
        </div>`).join('');
    box.classList.remove('hidden');
});

function startNewCharMpConvoFromModal(othId, othName, othAvatar, othColor, othRole, othOwnerId, othOwnerUsername) {
    const sel = document.getElementById('newConvMySender');
    const myCharId = sel ? sel.value : (myCharacters[0]?myCharacters[0]._id:null);
    if(!myCharId) return alert('Sélectionne d\'abord ton personnage.');
    closeNewConvModal();
    const myChar = myCharacters.find(c=>c._id===myCharId);
    if(!myChar) return;
    const otherChar = { _id:othId, name:othName, avatar:othAvatar, color:othColor, role:othRole, ownerId:othOwnerId, ownerUsername:othOwnerUsername };
    const key = mpKey(myCharId, othId);
    if(!charMpConversations[key]) charMpConversations[key] = { myChar, otherChar, msgs:[], unread:false, page:0, hasMore:false, total:0, lastContent:'', lastDate:null };
    switchView('char-mp');
    openCharMpConvo(key);
}

// ── openCharDmModal depuis le profil ──
function openCharDmModal(targetChar) {
    charDmTarget = targetChar;
    const sel = document.getElementById('charDmSenderSelect');
    if(sel) sel.innerHTML = myCharacters.map(c=>`<option value="${c._id}">${c.name}</option>`).join('');
    document.getElementById('charDmTargetAvatar').src = targetChar.avatar||'';
    document.getElementById('charDmTargetName').textContent = targetChar.name;
    loadCharDmHistory();
    document.getElementById('char-dm-modal').classList.remove('hidden');
    if(sel) sel.onchange = loadCharDmHistory;
}
function closeCharDmModal() { document.getElementById('char-dm-modal').classList.add('hidden'); charDmTarget=null; stopCharMpTyping(); hideCharMpTypingUI(); }

function loadCharDmHistory() {
    stopCharMpTyping();
    if(!charDmTarget) return;
    const sel = document.getElementById('charDmSenderSelect');
    const myCharId = sel ? sel.value : (myCharacters[0]?myCharacters[0]._id:null);
    if(!myCharId) return;
    const key = mpKey(myCharId, charDmTarget._id);
    if(!charMpConversations[key]) {
        const myChar = myCharacters.find(c => String(c._id) === String(myCharId));
        if(myChar) charMpConversations[key]={ myChar, otherChar:charDmTarget, msgs:[], unread:false, page:0, hasMore:false, total:0, lastContent:'', lastDate:null };
    }
    requestCharMpHistoryPage(key, 0);
}

function sendCharDm() {
    if(!charDmTarget || !PLAYER_ID) return;
    const content = document.getElementById('charDmInput').value.trim(); if(!content) return;
    const sel = document.getElementById('charDmSenderSelect');
    const senderChar = sel ? myCharacters.find(c=>c._id===sel.value) : null; if(!senderChar) return;
    socket.emit('send_char_dm', {
        senderCharId:senderChar._id, senderCharName:senderChar.name, senderAvatar:senderChar.avatar, senderColor:senderChar.color, senderRole:senderChar.role, senderOwnerUsername:USERNAME,
        targetCharId:charDmTarget._id, targetCharName:charDmTarget.name, targetAvatar:charDmTarget.avatar||'', targetColor:charDmTarget.color||'', targetRole:charDmTarget.role||'', targetOwnerId:charDmTarget.ownerId, targetOwnerUsername:charDmTarget.ownerUsername||'',
        ownerId:PLAYER_ID, content, date:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
    });
    document.getElementById('charDmInput').value='';
    stopCharMpTyping();
    requestAnimationFrame(() => {
        const container = document.getElementById('char-dm-messages');
        if(container) container.scrollTop = container.scrollHeight;
    });
}

function initCharMpView() { bindCharMpInputs(); loadMyCharConvos(); renderCharMpSidebar(); renderArchivedCharMpList(); }


socket.on('followers_list_data', (followers) => {
    const listDiv = document.getElementById('followers-list-container'); listDiv.innerHTML = "";
    if(followers.length === 0) listDiv.innerHTML = "<div style='padding:10px; color:#aaa;'>Aucun abonné.</div>";
    followers.forEach(f => {
        listDiv.innerHTML += `<div style="display:flex; align-items:center; padding:8px; border-bottom:1px solid #333;"><img src="${f.avatar}" style="width:30px; height:30px; border-radius:50%; margin-right:10px;"><div><div style="font-weight:bold;">${f.name}</div><div style="font-size:0.8em; color:#aaa;">${f.role}</div></div></div>`;
    });
    document.getElementById('followers-modal').classList.remove('hidden');
});

// --- ACTIONS MSG ---
function setContext(type, data) {
    currentContext = { type, data }; const bar = document.getElementById('context-bar');
    bar.className = 'visible';
    if(type === 'dm') bar.classList.add('dm-context'); else bar.classList.remove('dm-context');
    document.getElementById('txtInput').focus();
    if (type === 'reply') { document.getElementById('context-icon').innerHTML = '<i class="fa-solid fa-reply"></i>'; document.getElementById('context-text').innerHTML = `Répondre à <strong>${data.author}</strong>`; }
    else if (type === 'edit') { document.getElementById('context-icon').innerHTML = '<i class="fa-solid fa-pen"></i>'; document.getElementById('context-text').innerHTML = `Modifier message`; document.getElementById('txtInput').value = data.content; }
}
function cancelContext() { currentContext = null; document.getElementById('context-bar').className = 'hidden'; document.getElementById('txtInput').value = ""; }
function triggerReply(id, author, content) { setContext('reply', { id, author, content }); }
function triggerEdit(id, content) { setContext('edit', { id, content }); }
function triggerDelete(id) { if(confirm("Supprimer ?")) socket.emit('delete_message', id); }

async function sendMessage() {
    const txt = document.getElementById('txtInput'); const content = txt.value.trim();
    let finalMediaUrl = null, finalMediaType = null;
    if (pendingAttachment) {
        document.getElementById('chat-staging').innerHTML = 'Envoi...';
        let rType = undefined; if(pendingAttachment.type === 'audio') rType = 'video';
        finalMediaUrl = await uploadToCloudinary(pendingAttachment.file, rType); finalMediaType = pendingAttachment.type;
        clearStaging(); if (!finalMediaUrl) return alert("Echec envoi média.");
    }
    if (!content && !finalMediaUrl) return;
    if (currentDmTarget) {
        socket.emit('send_dm', { sender: USERNAME, target: currentDmTarget, content: content || finalMediaUrl, type: finalMediaType || "text", date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        txt.value = ''; cancelContext(); return;
    }
    if (content === "/clear" && !finalMediaUrl) { if(IS_ADMIN) socket.emit('admin_clear_room', currentRoomId); txt.value = ''; return; }
    if (currentContext && currentContext.type === 'edit') { socket.emit('edit_message', { id: currentContext.data.id, newContent: content }); txt.value = ''; cancelContext(); return; }
    if(!currentSelectedChar) return alert("Perso requis !");
    
    const baseMsg = { senderName: currentSelectedChar.name, senderColor: currentSelectedChar.color || "#fff", senderAvatar: currentSelectedChar.avatar, senderRole: currentSelectedChar.role, partyName: currentSelectedChar.partyName || null, partyLogo: currentSelectedChar.partyLogo || null, ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null };
    if (finalMediaUrl) socket.emit('message_rp', { ...baseMsg, content: finalMediaUrl, type: finalMediaType });
    if (content) socket.emit('message_rp', { ...baseMsg, content: content, type: "text" });
    txt.value = ''; cancelContext();
}

socket.on('history_data', (data) => { 
    if(currentDmTarget) return; 
    const msgs = Array.isArray(data?.msgs) ? data.msgs : (Array.isArray(data) ? data : []);
    const container = document.getElementById('messages');
    const previousHeight = container ? container.scrollHeight : 0;
    const previousTop = container ? container.scrollTop : 0;
    currentChatMessages = Number(data?.page) > 0 ? [...msgs, ...currentChatMessages] : msgs;
    chatHistoryState = {
        mode: 'room',
        key: getChatHistoryKey('room', currentRoomId),
        page: Number(data?.page) || 0,
        hasMore: !!data?.hasMore,
        total: Number(data?.total) || currentChatMessages.length
    };
    const splitId = firstUnreadMap[currentRoomId];
    container.innerHTML = "";
    lastMessageData = { author: null, time: 0 };
    currentChatMessages.forEach(msg => { if(splitId && msg._id === splitId) container.innerHTML += `<div class="new-msg-separator">-- Nouveaux --</div>`; displayMessage(msg); });
    if(firstUnreadMap[currentRoomId]) delete firstUnreadMap[currentRoomId];
    if(Number(data?.page) > 0) {
        requestAnimationFrame(() => { container.scrollTop = container.scrollHeight - previousHeight + previousTop; });
    } else {
        scrollToBottom(true); 
        scheduleScrollToBottom(true);
    }
    updateChatLoadMoreButton();
});
socket.on('message_rp', (msg) => { 
    if (msg.ownerId !== PLAYER_ID && notificationsEnabled) notifSound.play().catch(e => {});
    if(String(msg.roomId) === String(currentRoomId) && !currentDmTarget) {
        currentChatMessages.push(msg);
        displayMessage(msg);
        scrollToBottom();
    } 
    else { unreadRooms.add(String(msg.roomId)); if (!firstUnreadMap[msg.roomId]) firstUnreadMap[msg.roomId] = msg._id; updateRoomListUI(); }
    updateDestinationBadges();
});
socket.on('message_deleted', (msgId) => {
    currentChatMessages = currentChatMessages.filter(msg => String(msg._id) !== String(msgId));
    const el = document.getElementById(`msg-${msgId}`); if(el) el.remove();
});
socket.on('message_updated', (data) => {
    const target = currentChatMessages.find(msg => String(msg._id) === String(data.id));
    if(target) {
        target.content = data.newContent;
        target.edited = true;
    }
    const el = document.getElementById(`content-${data.id}`); if(el) { el.innerHTML = formatText(data.newContent); const meta = el.closest('.msg-col-content').querySelector('.timestamp'); if(meta && !meta.textContent.includes('(modifié)')) meta.textContent += ' (modifié)'; }
});

function formatText(text) { 
    if(!text) return ""; 
    const sourceText = String(text);
    // Détecter les messages cryptés AVANT tout autre traitement
    if(sourceText.includes('[CRYPTO]')) {
        return sourceText.replace(/\[CRYPTO\](.*?)\|(.*?)\[\/CRYPTO\]/g, (match, enc, glitch) => {
            const safeEnc = escapeHtml(enc).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const safeGlitch = escapeHtml(glitch);
            return `<div class="crypto-message"><span class="crypto-icon"><i class="fa-solid fa-lock"></i></span><span class="crypto-glitch">${safeGlitch}…</span><button class="crypto-unlock-btn" onclick="openDecryptModal(null,'${safeEnc}')"><i class="fa-solid fa-key"></i> Déchiffrer</button></div>`;
        });
    }
    return escapeHtml(sourceText)
        .replace(/@([\wÀ-ÿ][\wÀ-ÿ'-]*(?: [\wÀ-ÿ][\wÀ-ÿ'-]*){0,2})(?=$|[^\wÀ-ÿ'-])/g, '<span class="mention">@$1</span>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        .replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');
}
function getYoutubeId(url) { const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match && match[2].length === 11) ? match[2] : null; }

function createCustomAudioPlayer(src) {
    const wrapper = document.createElement('div'); wrapper.className = 'custom-audio-player';
    wrapper.innerHTML = `<button class="audio-btn play-btn"><i class="fa-solid fa-play"></i></button><div class="audio-progress"><div class="audio-progress-fill"></div></div><span class="audio-time">00:00</span>`;
    const audio = new Audio(src); const btn = wrapper.querySelector('.play-btn'); const fill = wrapper.querySelector('.audio-progress-fill'); const time = wrapper.querySelector('.audio-time');
    audio.addEventListener('loadedmetadata', () => { time.textContent = `${Math.floor(audio.duration/60)}:${Math.floor(audio.duration%60).toString().padStart(2,'0')}`; });
    audio.addEventListener('timeupdate', () => { fill.style.width = (audio.currentTime/audio.duration)*100 + '%'; time.textContent = `${Math.floor(audio.currentTime/60)}:${Math.floor(audio.currentTime%60).toString().padStart(2,'0')}`; });
    audio.addEventListener('ended', () => { btn.innerHTML = '<i class="fa-solid fa-play"></i>'; fill.style.width = '0%'; });
    btn.addEventListener('click', () => { if(audio.paused) { audio.play(); btn.innerHTML = '<i class="fa-solid fa-pause"></i>'; } else { audio.pause(); btn.innerHTML = '<i class="fa-solid fa-play"></i>'; } });
    return wrapper;
}

function displayMessage(msg, isDm = false) {
    const div = document.createElement('div'); div.className = 'message-container'; if(isDm) div.classList.add('dm-message'); div.id = `msg-${msg._id}`;
    let senderName, senderAvatar, senderColor, senderRole, canEdit = false, canDelete = false;
    if (isDm) { senderName = msg.sender || msg.senderName; senderAvatar = `https://ui-avatars.com/api/?name=${senderName}&background=random&color=fff&size=64`; senderColor = "#dbdee1"; senderRole = "Utilisateur"; } 
    else { senderName = msg.senderName; senderAvatar = msg.senderAvatar; senderColor = msg.senderColor; senderRole = msg.senderRole; canEdit = (msg.ownerId === PLAYER_ID); canDelete = (msg.ownerId === PLAYER_ID) || IS_ADMIN; }
    if (!isDm && textMentionsCurrentUser(msg.content)) { div.classList.add('mentioned'); }
    const msgTime = new Date(msg.timestamp || Date.now()).getTime(); const timeDiff = msgTime - lastMessageData.time;
    const isGroup = (!isDm && !msg.replyTo && senderName === lastMessageData.author && timeDiff < 120000 && msg.type !== 'image' && msg.type !== 'video'); 
    if (isGroup) { div.classList.add('msg-group-followup'); const stamp = document.createElement('span'); stamp.className = 'group-timestamp'; stamp.innerText = msg.date.substring(0, 5); div.appendChild(stamp); } 
    else { lastMessageData = { author: senderName, time: msgTime }; }
    let actionsHTML = "";
    if (!isDm) {
         actionsHTML += `<div class="msg-actions"><button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName.replace(/'/g, "\\'")}', '${(msg.type==='text'?msg.content:'Média').replace(/'/g, "\\'")}')" title="Répondre"><i class="fa-solid fa-reply"></i></button>`;
         if (msg.type === 'text' && canEdit) actionsHTML += `<button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>`;
         if (canDelete) actionsHTML += `<button class="action-btn" onclick="triggerDelete('${msg._id}')"><i class="fa-solid fa-trash"></i></button>`;
         actionsHTML += `</div>`;
    }
    let contentHTML = "";
    if (msg.type === "image") contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === "video") { const ytId = getYoutubeId(msg.content); if (ytId) contentHTML = `<iframe class="video-frame" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>`; else contentHTML = `<video class="video-direct" controls><source src="${msg.content}"></video>`; } 
    else if (msg.type === "audio") { contentHTML = `<div id="audio-placeholder-${msg._id}"></div>`; }
    else contentHTML = `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;
    const editedTag = (msg.edited && msg.type === 'text') ? '<span class="timestamp" style="font-size:0.65rem">(modifié)</span>' : '';
    const avatarClick = isDm ? "" : `onclick="openProfile('${senderName.replace(/'/g, "\\'")}')"`;
    if(isDm) {
        const isOwnDm = senderName === USERNAME;
        div.innerHTML = `
            <div class="dm-bubble-row ${isOwnDm ? 'dm-self' : 'dm-other'}">
                <img src="${senderAvatar}" class="dm-bubble-avatar" alt="${escapeHtml(senderName)}">
                <div class="dm-bubble-stack">
                    <div class="dm-bubble-meta">
                        <strong>${escapeHtml(senderName)}</strong>
                        <span>${escapeHtml(msg.date || '')}</span>
                    </div>
                    <div class="dm-bubble-card">${contentHTML}${editedTag}</div>
                </div>
            </div>`;
        document.getElementById('messages').appendChild(div);
        if (msg.type === 'audio') {
            const placeholder = document.getElementById(`audio-placeholder-${msg._id}`);
            if(placeholder) placeholder.replaceWith(createCustomAudioPlayer(msg.content));
        }
        return;
    }
    let replyHTML = "";
    if (msg.replyTo && msg.replyTo.author) { replyHTML = `<div class="reply-context-line"><div class="reply-spine"></div><span style="font-weight:600; cursor:pointer;">@${msg.replyTo.author}</span> <span style="font-style:italic; opacity:0.8;">${msg.replyTo.content}</span></div>`; }
    let innerHTML = ""; if(replyHTML) innerHTML += replyHTML; innerHTML += `<div style="display:flex; width:100%;"><div class="msg-col-avatar">`;
    if(!isGroup) { innerHTML += `<img src="${senderAvatar}" class="avatar-img" ${avatarClick}>`; }
    innerHTML += `</div><div class="msg-col-content">`;
    if(!isGroup) { 
        const partyBadgeHTML = (!isDm && msg.partyName && msg.partyLogo) ? `<span class="party-badge"><img src="${msg.partyLogo}" class="party-logo"> ${msg.partyName}</span>` : '';
        innerHTML += `<div class="msg-header"><span class="char-name" style="color:${senderColor}" ${avatarClick}>${senderName}</span>${partyBadgeHTML}${senderRole ? `<span class="char-role">${senderRole}</span>` : ''}<span class="timestamp">${msg.date}</span></div>`; 
    }
    innerHTML += contentHTML + editedTag + `</div>${actionsHTML}</div>`; div.innerHTML = innerHTML;
    document.getElementById('messages').appendChild(div);
    if (msg.type === 'audio') { const placeholder = document.getElementById(`audio-placeholder-${msg._id}`); if(placeholder) placeholder.replaceWith(createCustomAudioPlayer(msg.content)); }
}

function scrollToBottom(force = false) {
    const d = document.getElementById('messages');
    if (!d) return;
    const nearBottom = d.scrollHeight - d.scrollTop - d.clientHeight < 120;
    if (force || nearBottom) d.scrollTop = d.scrollHeight;
}
function scheduleScrollToBottom(force = false) {
    requestAnimationFrame(() => {
        scrollToBottom(force);
        setTimeout(() => scrollToBottom(force), 0);
        setTimeout(() => scrollToBottom(force), 120);
    });
}
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });

// --- FEED LOGIC & TYPING ---
function loadFeed() { socket.emit('request_feed'); }

document.getElementById('postContent').addEventListener('input', (e) => { 
    document.getElementById('char-count').textContent = `${e.target.value.length}/1000`; 
    syncFeedDraftFromComposer();
    if(!currentFeedCharId) return;
    const char = myCharacters.find(c => c._id === currentFeedCharId);
    const typingName = char ? char.name : USERNAME;
    socket.emit('typing_feed_start', { charName: typingName });
    clearTimeout(feedTypingTimeout);
    feedTypingTimeout = setTimeout(() => { socket.emit('typing_feed_stop', { charName: typingName }); }, 2000);
});

socket.on('display_feed_typing', (data) => { feedTypers.add(data.charName); updateFeedTypingUI(); });
socket.on('hide_feed_typing', (data) => { feedTypers.delete(data.charName); updateFeedTypingUI(); });
function updateFeedTypingUI() {
    const ind = document.getElementById('feed-typing-indicator');
    if(feedTypers.size > 0) { const names = Array.from(feedTypers).join(', '); ind.textContent = `${names} rédige un post...`; ind.classList.remove('hidden'); } 
    else { ind.classList.add('hidden'); }
}

async function handlePostMediaUpload(file, successLabel = 'Prêt !') {
    if(!file) return null;
    const statusNode = document.getElementById('postFileStatus');
    const mediaUrlNode = document.getElementById('postMediaUrl');
    if(statusNode) {
        statusNode.style.display = 'block';
        statusNode.textContent = 'Upload...';
    }
    const url = await uploadToCloudinary(file);
    if(url && mediaUrlNode) {
        mediaUrlNode.value = url;
        if(statusNode) statusNode.textContent = successLabel;
    }
    return url;
}

document.getElementById('postContent').addEventListener('paste', async (event) => {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageItem = clipboardItems.find(item => item.type && item.type.startsWith('image/'));
    if(!imageItem) return;
    const file = imageItem.getAsFile();
    if(!file) return;
    event.preventDefault();
    await handlePostMediaUpload(file, 'Image collée prête !');
});

function togglePollUI() {
    const ui = document.getElementById('poll-creation-ui'); pollUIOpen = !pollUIOpen;
    if(pollUIOpen) { ui.classList.remove('hidden'); pollOptions = []; addPollOption(); addPollOption(); } 
    else { ui.classList.add('hidden'); }
}
function addPollOption() { pollOptions.push(''); renderPollUI(); }
function renderPollUI() {
    const container = document.getElementById('pollOptions'); container.innerHTML = '';
    pollOptions.forEach((opt, idx) => {
        const div = document.createElement('div'); div.style.marginBottom = '8px';
        div.innerHTML = `<input type="text" placeholder="Option ${idx + 1}..." value="${opt}" onchange="pollOptions[${idx}] = this.value;" style="width:100%; background:#383a40; border:none; color:white; padding:8px; border-radius:4px; font-family:inherit;">`;
        container.appendChild(div);
    });
}
function closePollUI() { document.getElementById('poll-creation-ui').classList.add('hidden'); pollUIOpen = false; pollOptions = []; }

async function previewPostFile() {
    const file = document.getElementById('postMediaFile').files[0];
    if(file) await handlePostMediaUpload(file, 'Prêt !');
}

function findPostByIdInCaches(postId) {
    return feedPostsCache.find(post => String(post._id) === String(postId))
        || presseArticlesCache.find(post => String(post._id) === String(postId))
        || (Array.isArray(currentProfileChar?.lastPosts) ? currentProfileChar.lastPosts.find(post => String(post._id) === String(postId)) : null)
        || null;
}

function getQuotedPostDisplayAuthor(post) {
    if(!post) return { name: '', avatar: '', role: '', color: 'white', anonymous: false };
    if(post.isAnonymous) {
        return {
            name: 'Source Anonyme',
            avatar: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23383a40' width='100' height='100'/%3E%3Ctext x='50' y='55' font-size='50' fill='%23666' text-anchor='middle' dominant-baseline='middle'%3E%3F%3C/text%3E%3C/svg%3E",
            role: 'Leak',
            color: '#a6accd',
            anonymous: true
        };
    }
    return {
        name: post.authorName || '',
        avatar: post.authorAvatar || '',
        role: post.authorRole || '',
        color: post.authorColor || 'white',
        anonymous: false
    };
}

function openQuotedPost(postId) {
    const sourcePost = findPostByIdInCaches(postId) || quotedPostSnapshotCache.get(String(postId)) || null;
    if(sourcePost) openPostDetail(postId, sourcePost);
}

function buildQuotedPostMarkup(post, options = {}) {
    if(!post) return '';
    if(post._id) quotedPostSnapshotCache.set(String(post._id), post);
    const { preview = false, nested = false } = options;
    const author = getQuotedPostDisplayAuthor(post);
    const safeId = String(post._id || '').replace(/'/g, "\\'");
    let mediaHtml = '';
    if(post.mediaUrl) {
        if(post.mediaType === 'video' || String(post.mediaUrl).includes('/video/upload')) {
            const ytId = getYoutubeId(post.mediaUrl);
            mediaHtml = ytId
                ? `<iframe class="quoted-post-media" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen></iframe>`
                : `<video class="quoted-post-media" controls src="${post.mediaUrl}"></video>`;
        } else if(post.mediaType === 'audio') {
            mediaHtml = `<audio class="quoted-post-audio" controls src="${post.mediaUrl}"></audio>`;
        } else {
            mediaHtml = `<img src="${post.mediaUrl}" class="quoted-post-media" alt="media post cité">`;
        }
    }
    const badges = [
        post.isBreakingNews ? '<span class="quoted-post-badge breaking">Breaking</span>' : '',
        post.isSponsored ? `<span class="quoted-post-badge sponsored">${escapeHtml(post.linkedCompanyName || 'Pub')}</span>` : ''
    ].filter(Boolean).join('');
    const nestedQuote = !nested && post.quotedPost ? buildQuotedPostMarkup(post.quotedPost, { nested: true }) : '';
    const authorLine = author.name
        ? `<div class="quoted-post-author" style="color:${author.color}">${escapeHtml(author.name)}${post.partyName && post.partyLogo && !author.anonymous ? `<span class="party-badge"><img src="${post.partyLogo}" class="party-logo"> ${escapeHtml(post.partyName)}</span>` : ''}</div>`
        : '';
    const roleLine = author.role ? `<div class="quoted-post-role">${escapeHtml(author.role)}</div>` : '';
    const hasVisibleHeader = !!(author.avatar || authorLine || roleLine || post.date);
    const hasVisibleBody = !!(badges || post.content || mediaHtml || nestedQuote);
    if(!hasVisibleHeader && !hasVisibleBody) return '';
    return `
        <div class="quoted-post-card${preview ? ' quoted-post-card-preview' : ''}${nested ? ' quoted-post-card-nested' : ''}" ${safeId ? `onclick="event.stopPropagation(); openQuotedPost('${safeId}')"` : ''}>
            <div class="quoted-post-head">
                <img src="${author.avatar}" class="quoted-post-avatar" onerror="this.style.opacity=0">
                <div class="quoted-post-meta">
                    ${authorLine}
                    ${roleLine}
                </div>
                <span class="quoted-post-date">${escapeHtml(post.date || '')}</span>
            </div>
            ${badges ? `<div class="quoted-post-badges">${badges}</div>` : ''}
            ${post.content ? `<div class="quoted-post-content">${formatText(post.content)}</div>` : ''}
            ${mediaHtml}
            ${nestedQuote}
        </div>`;
}

function renderFeedRepostPreview() {
    const preview = document.getElementById('feed-repost-preview');
    const input = document.getElementById('repostPostId');
    if(!preview || !input) return;
    if(!currentRepostTarget) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
        input.value = '';
        return;
    }
    input.value = currentRepostTarget._id || '';
    preview.classList.remove('hidden');
    preview.innerHTML = `
        <div class="feed-repost-preview-head">
            <span><i class="fa-solid fa-retweet"></i> Repost avec commentaire</span>
            <button type="button" class="feed-repost-cancel" onclick="clearRepostComposer()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        ${buildQuotedPostMarkup(currentRepostTarget, { preview: true })}`;
}

function prepareRepost(postId) {
    const sourcePost = findPostByIdInCaches(postId);
    if(!sourcePost) return;
    currentRepostTarget = sourcePost;
    renderFeedRepostPreview();
    const textarea = document.getElementById('postContent');
    if(textarea) {
        textarea.focus();
        textarea.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function clearRepostComposer() {
    currentRepostTarget = null;
    renderFeedRepostPreview();
}

function updatePostComposerUi() {
    const editInput = document.getElementById('editPostId');
    const editPreview = document.getElementById('feed-edit-preview');
    const submitBtn = document.getElementById('submitPostBtn');
    const isEditing = !!currentEditingPostId;
    if(editInput) editInput.value = currentEditingPostId || '';
    if(submitBtn) submitBtn.textContent = isEditing ? 'Enregistrer' : 'Publier';
    if(!editPreview) return;
    if(!isEditing) {
        editPreview.classList.add('hidden');
        editPreview.innerHTML = '';
        return;
    }
    editPreview.classList.remove('hidden');
    editPreview.innerHTML = `
        <div class="feed-repost-preview-head">
            <span><i class="fa-solid fa-pen"></i> Edition du post</span>
            <button type="button" class="feed-repost-cancel" onclick="cancelPostEdit()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div style="font-size:0.82rem; color:var(--text-muted, #aaa);">Tu modifies le texte de ce post.</div>`;
}

function resetPostComposer() {
    const contentNode = document.getElementById('postContent');
    const mediaUrlNode = document.getElementById('postMediaUrl');
    const mediaFileNode = document.getElementById('postMediaFile');
    const statusNode = document.getElementById('postFileStatus');
    const anonymousNode = document.getElementById('postAnonymous');
    const breakingNode = document.getElementById('postBreakingNews');
    const countNode = document.getElementById('char-count');
    const pollNode = document.getElementById('poll-creation-ui');
    if(contentNode) contentNode.value = '';
    if(mediaUrlNode) mediaUrlNode.value = '';
    if(mediaFileNode) mediaFileNode.value = '';
    if(statusNode) {
        statusNode.style.display = 'none';
        statusNode.textContent = '';
    }
    if(anonymousNode) anonymousNode.checked = false;
    if(breakingNode) breakingNode.checked = false;
    if(countNode) countNode.textContent = '0/1000';
    pollOptions = [];
    if(pollNode) pollNode.classList.add('hidden');
    pollUIOpen = false;
    const pubCb = document.getElementById('postIsPub');
    if(pubCb) {
        pubCb.checked = false;
        toggleFeedPubSelect();
    }
    currentEditingPostId = null;
    clearRepostComposer();
    updatePostComposerUi();
    clearDraftValue('feed');
}

function cancelPostEdit() {
    resetPostComposer();
}

function startPostEdit(postId) {
    const post = findPostByIdInCaches(postId)
        || feedPostsCache.find(item => String(item._id) === String(postId))
        || null;
    if(!post || post.ownerId !== PLAYER_ID) return;
    currentEditingPostId = String(post._id);
    clearRepostComposer();
    const contentNode = document.getElementById('postContent');
    const mediaUrlNode = document.getElementById('postMediaUrl');
    const mediaFileNode = document.getElementById('postMediaFile');
    const statusNode = document.getElementById('postFileStatus');
    const countNode = document.getElementById('char-count');
    const anonymousNode = document.getElementById('postAnonymous');
    const breakingNode = document.getElementById('postBreakingNews');
    const repostNode = document.getElementById('repostPostId');
    if(contentNode) {
        contentNode.value = post.content || '';
        contentNode.focus();
        contentNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if(mediaUrlNode) mediaUrlNode.value = '';
    if(mediaFileNode) mediaFileNode.value = '';
    if(statusNode) {
        statusNode.style.display = 'none';
        statusNode.textContent = '';
    }
    if(countNode) countNode.textContent = `${(post.content || '').length}/1000`;
    if(anonymousNode) anonymousNode.checked = !!post.isAnonymous;
    if(breakingNode) breakingNode.checked = !!post.isBreakingNews;
    if(repostNode) repostNode.value = '';
    updatePostComposerUi();
}

function submitPost() {
    const content = document.getElementById('postContent').value.trim();
    const mediaUrl = document.getElementById('postMediaUrl').value.trim();
    const repostPostId = document.getElementById('repostPostId')?.value || '';
    const editPostId = document.getElementById('editPostId')?.value || '';
    const isAnonymous = document.getElementById('postAnonymous').checked;
    const isBreakingNews = document.getElementById('postBreakingNews').checked;
    const isPub = document.getElementById('postIsPub')?.checked;
    const pubStockId = isPub ? document.getElementById('postPubStockId')?.value : null;
    const linkedStock = pubStockId ? stocksData.find(stock => String(stock._id) === String(pubStockId)) : null;
    
    if(!editPostId && !content && !mediaUrl && !repostPostId) return alert("Contenu vide.");
    if(editPostId) {
        socket.emit('edit_post', {
            postId: editPostId,
            content,
            ownerId: PLAYER_ID
        });
        resetPostComposer();
        return;
    }
    if(!currentFeedCharId) return alert("Aucun perso sélectionné pour le Feed.");
    const char = myCharacters.find(c => c._id === currentFeedCharId);
    if(!char) return alert("Perso invalide.");

    let mediaType = null;
    if(mediaUrl) {
        if(getYoutubeId(mediaUrl) || mediaUrl.match(/\.(mp4|webm|ogg)$/i) || mediaUrl.includes('/video/upload')) mediaType = 'video';
        else if (mediaUrl.includes('.webm') || mediaUrl.includes('/raw/upload') && !mediaUrl.includes('image')) mediaType = 'audio';
        else mediaType = 'image';
        if(mediaUrl.endsWith('.webm') && !mediaType) mediaType = 'video'; 
    }
    
    let poll = null;
    if(pollOptions.length > 0) {
        const question = document.getElementById('pollQuestion').value.trim();
        if(question) { poll = { question, options: pollOptions.map(text => ({ text: text.trim(), voters: [] })) }; }
    }
    
    const postData = { 
        authorCharId: char._id, authorName: char.name, authorAvatar: char.avatar, authorRole: char.role, authorColor: char.color,
        partyName: char.partyName, partyLogo: char.partyLogo, content, mediaUrl, mediaType, 
        date: new Date().toLocaleDateString(), ownerId: PLAYER_ID, isAnonymous, isBreakingNews, poll,
        isSponsored: !!isPub,
        repostPostId,
        linkedStockId: pubStockId || '',
        linkedCompanyName: linkedStock?.companyName || ''
    };
    
    socket.emit('create_post', postData);
    socket.emit('typing_feed_stop', { charName: char.name });
    
    // Pub boost bourse
    if(isPub && pubStockId) socket.emit('pub_boost_stock', { stockId: pubStockId });
    
    resetPostComposer();
}

function votePoll(postId, optionIndex) {
    if(!currentFeedCharId) return alert("Sélectionnez un personnage dans le Feed !");
    socket.emit('vote_poll', { postId, optionIndex, charId: currentFeedCharId });
}

function adminInjectVote(postId, optionIndex, count) {
    if(!IS_ADMIN) return; socket.emit('admin_inject_vote', { postId, optionIndex, count });
}

function toggleLike(id) { 
    if(!PLAYER_ID) return; if(!currentFeedCharId) return alert("Sélectionnez un perso (Feed).");
    socket.emit('like_post', { postId: id, charId: currentFeedCharId }); 
}
async function openArticleEditModal(postId) {
    const post = presseArticlesCache.find(a => String(a._id) === postId);
    if(!post) return;
    const { titleText, bodyText, bodyHtml, isHtml } = parseArticleContent(post.content || '');
    document.getElementById('editArticleId').value = postId;
    document.getElementById('editArticleTitle').value = titleText;
    const editor = getPresseEditor('editArticleContentEditor');
    if(editor) editor.innerHTML = isHtml ? bodyHtml : legacyArticleTextToEditorHtml(bodyText);
    currentEditArticleTheme = normalizeArticleTheme(post.articleTheme || currentPresseTheme || DEFAULT_ARTICLE_THEME);
    await hydrateArticleThemeChoices(post.journalLogo || '', 'editArticleContentEditor', currentEditArticleTheme);
    document.getElementById('article-edit-modal').classList.remove('hidden');
    snapForm('article-edit-modal');
}

function closeArticleEditModal() {
    guardClose('article-edit-modal', () => { document.getElementById('article-edit-modal').classList.add('hidden'); });
}

function submitArticleEdit() {
    const postId = document.getElementById('editArticleId').value;
    const title = document.getElementById('editArticleTitle').value.trim();
    const body = editorHtmlToStorage(syncArticleEditor('editArticleContentEditor'));
    if(!postId) return;
    const newContent = title ? `[TITRE]${title}[/TITRE]\n${body}` : body;
    socket.emit('edit_post', {
        postId,
        content: newContent,
        ownerId: PLAYER_ID,
        articleTheme: normalizeArticleTheme(currentEditArticleTheme || DEFAULT_ARTICLE_THEME)
    });
    _unsavedBypass = true;
    closeArticleEditModal();
}

function deletePost(id) { if(confirm("Supprimer ?")) socket.emit('delete_post', { postId: id, ownerId: PLAYER_ID }); }

let currentDetailPostId = null;
function openPostDetail(id, fallbackPost = null) {
    const postEl = document.getElementById(`post-${id}`);
    const sourcePost = fallbackPost
        || feedPostsCache.find(post => String(post._id) === String(id))
        || (Array.isArray(currentProfileChar?.lastPosts) ? currentProfileChar.lastPosts.find(post => String(post._id) === String(id)) : null)
        || null;
    if(!postEl && !sourcePost) return;
    addRecentActivity({ type: 'post', id, label: sourcePost?.authorName || 'Post du réseau', meta: extractTextPreview(sourcePost?.content || '', 90) || 'Discussion' });
    currentDetailPostId = id;
    const clone = postEl ? postEl.cloneNode(true) : createPostElement(sourcePost);
    clone.onclick = null;
    clone.style.border = "none";
    clone.classList.remove('highlight-new');
    const old = clone.querySelector('.comments-section'); if(old) old.remove();
    const oldList = clone.querySelector('.comments-list'); if(oldList) oldList.remove();
    document.getElementById('post-detail-content').innerHTML = ""; document.getElementById('post-detail-content').appendChild(clone);
    document.getElementById('post-detail-comments-list').innerHTML = sourcePost
        ? generateCommentsHTML(sourcePost.comments, sourcePost._id)
        : postEl.querySelector('.comments-list')?.innerHTML || "";
    document.getElementById('post-detail-modal').classList.remove('hidden'); clearCommentStaging();
    
    document.getElementById('btn-detail-comment').onclick = async () => {
        const txt = document.getElementById('post-detail-comment-input').value.trim();
        let mediaUrl = null, mediaType = null;
        if(pendingCommentAttachment && pendingCommentAttachment.files[0]) {
             let rType = (pendingCommentAttachment.type === 'audio') ? 'video' : undefined;
             mediaUrl = await uploadToCloudinary(pendingCommentAttachment.files[0], rType); mediaType = pendingCommentAttachment.type;
        }
        if(!txt && !mediaUrl) return;
        if(!currentFeedCharId) return alert("Sélectionnez un perso (Feed).");
        const char = myCharacters.find(c => c._id === currentFeedCharId);
        
        socket.emit('post_comment', { 
            postId: id, 
            comment: { authorCharId: char._id, authorName: char.name, authorAvatar: char.avatar, content: txt, mediaUrl, mediaType, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), ownerId: PLAYER_ID } 
        });
        document.getElementById('post-detail-comment-input').value = ""; clearCommentStaging();
    };
}
function closePostDetail() { document.getElementById('post-detail-modal').classList.add('hidden'); currentDetailPostId = null; }
function stageCommentMedia(input, forcedType) {
    const file = input.files[0]; if(!file) return;
    let type = forcedType || (file.type.startsWith('image') ? 'image' : 'video');
    pendingCommentAttachment = { files: input.files, type };
    document.getElementById('comment-staging').classList.remove('hidden');
    document.getElementById('comment-staging').innerHTML = `<span class="staging-info">${type} prêt</span> <button class="btn-clear-stage" onclick="clearCommentStaging()">X</button>`;
}
function clearCommentStaging() { pendingCommentAttachment = null; document.getElementById('comment-staging').classList.add('hidden'); document.getElementById('comment-file-input').value = ""; }
function deleteComment(postId, commentId) { if(confirm("Supprimer ?")) socket.emit('delete_comment', { postId, commentId, ownerId: PLAYER_ID }); }

socket.on('feed_data', (posts) => {
    feedPostsCache = normalizeFeedPosts(posts);
    refreshFeedProfileDatalist();
    renderFeedStream();
    if(currentView === 'accueil') renderAccueil();
    buildAdminConsoleOverview();
});
socket.on('new_post', (post) => { 
    const isOnFlux = (currentView === 'reseau' && localStorage.getItem('last_reseau_tab') === 'flux');
    if(!isOnFlux) {
        const badge = document.getElementById('reseau-flux-badge');
        if(badge) { badge.classList.remove('hidden'); badge.textContent = '!'; }
        const btn = document.getElementById('btn-view-reseau');
        if(btn) btn.classList.add('nav-notify');
    }
    feedPostsCache = normalizeFeedPosts([post, ...feedPostsCache.filter(item => String(item._id) !== String(post._id))]);
    refreshFeedProfileDatalist();
    renderFeedStream();
    if(currentView === 'accueil') renderAccueil();
    buildAdminConsoleOverview();
    updateDestinationBadges();
});
socket.on('post_updated', (post) => {
    if(post.isLiveNews && !post.isArticle) {
        const existingLive = liveNewsCache.some(item => String(item._id) === String(post._id));
        liveNewsCache = normalizeLiveNewsArticles(existingLive
            ? liveNewsCache.map(item => String(item._id) === String(post._id) ? post : item)
            : [post, ...liveNewsCache]);
        renderLiveNewsTicker();
        updatePresseLiveToggleUI();
    } else if(post.isArticle) {
        const existingArticle = presseArticlesCache.some(item => String(item._id) === String(post._id));
        presseArticlesCache = existingArticle
            ? presseArticlesCache.map(item => String(item._id) === String(post._id) ? post : item)
            : [post, ...presseArticlesCache];
        refreshPresseJournalDatalist();
        refreshFeedProfileDatalist();
        renderPresseStream();
        syncLiveNewsFromArticles();
        if(currentArticleFullscreenId === String(post._id)) openArticleFullscreen(String(post._id));
    } else {
        feedPostsCache = feedPostsCache.map(item => String(item._id) === String(post._id) ? post : item);
        refreshFeedProfileDatalist();
        renderFeedStream();
    }
    if(currentDetailPostId === post._id) {
        document.getElementById('post-detail-comments-list').innerHTML = generateCommentsHTML(post.comments, post._id);
        const likeBtn = document.querySelector('#post-detail-content .action-item'); if(likeBtn) likeBtn.innerHTML = `<i class="fa-solid fa-heart"></i> ${getPostLikeCountLabel(post)}`;
    }
    if(currentView === 'accueil') renderAccueil();
    buildAdminConsoleOverview();
});
socket.on('post_deleted', (id) => {
    feedPostsCache = feedPostsCache.filter(post => String(post._id) !== String(id));
    presseArticlesCache = presseArticlesCache.filter(post => String(post._id) !== String(id));
    liveNewsCache = liveNewsCache.filter(post => String(post._id) !== String(id));
    liveNewsUnreadIds.delete(String(id));
    syncLiveNewsFromArticles();
    refreshFeedProfileDatalist();
    renderFeedStream();
    renderPresseStream();
    if(currentView === 'accueil') renderAccueil();
    if(currentDetailPostId === id) closePostDetail();
    if(currentArticleFullscreenId === String(id)) closeArticleFullscreen();
    buildAdminConsoleOverview();
});
socket.on('reload_posts', () => loadFeed());

function generateCommentsHTML(comments, postId) {
    if(!comments || comments.length === 0) return '<div class="comment-empty"><i class="fa-regular fa-comment"></i><p>Aucun commentaire pour l\'instant…</p></div>';
    let html = "";
    comments.forEach(c => {
        const delBtn = IS_ADMIN ? `<button class="comment-del-btn" onclick="deleteComment('${postId}', '${c.id}')"><i class="fa-solid fa-trash"></i></button>` : "";
        let mediaHtml = "";
        if(c.mediaUrl) {
            if(c.mediaType === 'image') mediaHtml = `<img src="${c.mediaUrl}" class="comment-media">`;
            if(c.mediaType === 'video') mediaHtml = `<video src="${c.mediaUrl}" controls class="comment-media"></video>`;
            if(c.mediaType === 'audio') mediaHtml = `<audio src="${c.mediaUrl}" controls style="width:100%; margin-top:5px;"></audio>`;
        }
        html += `<div class="comment-item"><img src="${c.authorAvatar}" class="comment-avatar" onclick="openProfile('${c.authorName.replace(/'/g, "\\'")}')"><div class="comment-bubble"><div class="comment-meta"><span class="comment-author">${c.authorName}</span><span class="comment-time">${c.date}</span>${delBtn}</div><div class="comment-text">${formatText(c.content)}${mediaHtml}</div></div></div>`;
    });
    return html;
}

function createPostElement(post) {
    const div = document.createElement('div'); div.className = 'post-card'; div.id = `post-${post._id}`;
    
    // NOUVEAU : MODE JOURNALISTE
    const isJournalistMode = post.content && (post.content.length > 300 || post.isBreakingNews);
    
    if(post.isBreakingNews) div.classList.add('post-breaking-news');
    if(post.isAnonymous) div.classList.add('post-anonymous');
    if(isJournalistMode) div.classList.add('post-article');
    
    const lastVisit = parseInt(localStorage.getItem('last_feed_visit') || '0');
    if (new Date(post.timestamp).getTime() > lastVisit && currentView === 'feed') div.classList.add('post-highlight');
    
    const isLiked = post.likes.includes(currentFeedCharId); 
    const delBtn = (IS_ADMIN || post.ownerId === PLAYER_ID) ? `<button class="action-item" style="position:absolute; top:16px; right:16px; color:#da373c;" onclick="event.stopPropagation(); deletePost('${post._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
    const editBtn = post.ownerId === PLAYER_ID ? `<button class="action-item" onclick="event.stopPropagation(); startPostEdit('${post._id}')"><i class="fa-solid fa-pen"></i> Modifier</button>` : '';
    const badges = [
        post.authorIsOfficial ? '<span class="post-smart-badge official"><i class="fa-solid fa-building-columns"></i> Officiel</span>' : '',
        post.isSponsored ? `<span class="post-smart-badge sponsored"><i class="fa-solid fa-badge-dollar"></i> ${escapeHtml(post.linkedCompanyName || 'Pub')}</span>` : '',
        isCompanyRelatedPost(post) && !post.isSponsored ? '<span class="post-smart-badge company"><i class="fa-solid fa-building"></i> Entreprise</span>' : ''
    ].filter(Boolean).join('');
    
    // GESTION MÉDIAS ET BANNIÈRE JOURNALISTE
    let mediaHTML = "";
    let bannerHTML = "";
    if(post.mediaUrl) {
        if(post.mediaType === 'video' || post.mediaUrl.includes('/video/upload')) {
             const ytId = getYoutubeId(post.mediaUrl);
             if(ytId) mediaHTML = `<iframe class="post-media" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen></iframe>`;
             else mediaHTML = `<video class="post-media" controls src="${post.mediaUrl}"></video>`;
        } else if (post.mediaType === 'audio') { mediaHTML = `<audio controls src="${post.mediaUrl}" style="width:100%; margin-top:10px;"></audio>`; } 
        else { 
             if(isJournalistMode) bannerHTML = `<img src="${post.mediaUrl}" class="post-banner">`;
             else mediaHTML = `<img src="${post.mediaUrl}" class="post-media">`; 
        }
    }
    
    let displayName = post.authorName; let displayAvatar = post.authorAvatar; let displayRole = post.authorRole;
    if(post.isAnonymous) { displayName = "Source Anonyme"; displayAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23383a40' width='100' height='100'/%3E%3Ctext x='50' y='55' font-size='50' fill='%23666' text-anchor='middle' dominant-baseline='middle'%3E%3F%3C/text%3E%3C/svg%3E"; displayRole = "Leak"; }
    
    let pollHTML = "";
    if(post.poll && post.poll.options && post.poll.options.length > 0) {
        const totalVoters = post.poll.options.reduce((sum, opt) => sum + opt.voters.length, 0);
        const hasVoted = post.poll.options.some(opt => opt.voters.includes(currentFeedCharId));
        pollHTML = `<div class="poll-container"><div class="poll-question"><i class="fa-solid fa-chart-column" style="margin-right:6px; color:var(--accent);"></i>${post.poll.question}</div>`;
        post.poll.options.forEach((opt, idx) => {
            const pct = totalVoters > 0 ? Math.round((opt.voters.length / totalVoters) * 100) : 0;
            const isVoted = opt.voters.includes(currentFeedCharId);
            const adminPopup = IS_ADMIN ? `<div class="poll-admin-popup"><button class="poll-admin-popup-btn" onclick="event.stopPropagation(); adminInjectVote('${post._id}', ${idx}, 1)">+1 Vote</button><button class="poll-admin-popup-btn" onclick="event.stopPropagation(); adminInjectVote('${post._id}', ${idx}, 10)">+10 Votes</button><button class="poll-admin-popup-btn" onclick="event.stopPropagation(); adminInjectVote('${post._id}', ${idx}, 100)">+100 Votes</button></div>` : '';
            if(hasVoted) {
                pollHTML += `<div class="poll-option poll-option-wrap"><div class="poll-results-bar ${isVoted ? 'poll-voted-bar' : ''}"><div class="poll-bar-fill" style="width:${pct}%"></div><div class="poll-result-text"><span>${isVoted ? '✓ ' : ''}${opt.text}</span><span><strong>${pct}%</strong> <span style="opacity:0.6">(${opt.voters.length})</span></span></div></div>${adminPopup}</div>`;
            } else {
                pollHTML += `<div class="poll-option poll-option-wrap"><button class="poll-option-btn" onclick="event.stopPropagation(); votePoll('${post._id}', ${idx})">${opt.text}</button>${adminPopup}</div>`;
            }
        });
        pollHTML += `<div class="poll-total">${totalVoters} vote${totalVoters !== 1 ? 's' : ''}</div></div>`;
    }
    
    const bodyWrapperStart = isJournalistMode ? `<div class="post-article-body">` : ``;
    const bodyWrapperEnd = isJournalistMode ? `</div>` : ``;
    const postContentHTML = post.content ? `<div class="post-content" onclick="openPostDetail('${post._id}')">${formatText(post.content)}</div>` : '';
    const quotedPostHTML = post.quotedPost ? buildQuotedPostMarkup(post.quotedPost) : '';

    div.innerHTML = `
        ${bannerHTML}
        ${bodyWrapperStart}
            ${delBtn}
            <div class="post-header" onclick="event.stopPropagation(); openProfile('${displayName.replace(/'/g, "\\'")}')">
                <img src="${displayAvatar}" class="post-avatar">
                <div class="post-meta">
                    <div class="post-author">${displayName}${post.partyName && post.partyLogo && !post.isAnonymous ? `<span class="party-badge"><img src="${post.partyLogo}" class="party-logo"> ${post.partyName}</span>` : ''}</div>
                    <div class="post-role">${displayRole}</div>
                </div>
                <span class="post-date">${post.date}</span>
            </div>
            ${badges ? `<div class="post-smart-badges">${badges}</div>` : ''}
            ${postContentHTML}
            ${quotedPostHTML}
            ${mediaHTML}
            ${pollHTML}
            <div class="post-actions">
                <button class="action-item ${isLiked?'liked':''}" onclick="event.stopPropagation(); toggleLike('${post._id}')"><i class="fa-solid fa-heart"></i> ${getPostLikeCountLabel(post)}</button>
                <button class="action-item" onclick="event.stopPropagation(); openPostDetail('${post._id}')"><i class="fa-solid fa-comment"></i> ${post.comments.length}</button>
                <button class="action-item" onclick="event.stopPropagation(); prepareRepost('${post._id}')"><i class="fa-solid fa-retweet"></i> Repost</button>
                ${editBtn}
                ${IS_ADMIN ? `<button class="action-item" onclick="event.stopPropagation(); openAdminStatsModal('${post._id}', '${getPostLikeCountLabel(post).replace(/'/g, "\\'")}')" title="Admin: modifier likes" style="color:var(--warning);"><i class="fa-solid fa-pen"></i></button>` : ''}
            </div>
        ${bodyWrapperEnd}
        <div class="comments-list hidden">${generateCommentsHTML(post.comments, post._id)}</div>`;
    return div;
}

let notifications = [];
socket.on('notifications_data', (d) => {
    notifications = d;
    updateNotificationBadge();
    updateDestinationBadges();
    if(currentView === 'accueil') renderAccueil();
    if(!document.getElementById('notifications-modal')?.classList.contains('hidden')) openNotifications();
});
socket.on('notification_dispatch', (n) => {
    if(n.targetOwnerId === PLAYER_ID) {
        notifications.unshift(n);
        updateNotificationBadge();
        updateDestinationBadges();
        if(currentView === 'accueil') renderAccueil();
        if(!document.getElementById('notifications-modal')?.classList.contains('hidden')) openNotifications();
        const btn = document.getElementById('btn-notifs');
        if(btn) {
            btn.classList.remove('notif-pop');
            void btn.offsetWidth;
            btn.classList.add('notif-pop');
        }
        if(notificationsEnabled) notifSound.play().catch(e=>{});
    }
});
function getNotificationMeta(notification) {
    const metaByType = {
        like:    { icon: 'fa-heart',              cls: 'notif-like',    label: 'Like' },
        mention: { icon: 'fa-at',                 cls: 'notif-mention', label: 'Mention' },
        follow:  { icon: 'fa-user-plus',          cls: 'notif-follow',  label: 'Suivi' },
        reply:   { icon: 'fa-reply',              cls: 'notif-reply',   label: 'Réponse' }
    };
    const base = metaByType[notification.type] || { icon: 'fa-bell', cls: 'notif-default', label: 'Notification' };
    if(notification.redirectView === 'char-mp') return { ...base, icon: 'fa-user-group', cls: 'notif-char-mp', label: 'MP perso' };
    if(notification.redirectView === 'dm') return { ...base, icon: 'fa-envelope', cls: 'notif-dm', label: 'Message privé' };
    if(notification.redirectView === 'chat') return { ...base, icon: 'fa-comments', cls: 'notif-chat', label: 'Chat' };
    if(notification.redirectView === 'feed') return { ...base, icon: 'fa-bullhorn', cls: 'notif-feed', label: 'Feed' };
    if(notification.redirectView === 'presse') return { ...base, icon: 'fa-newspaper', cls: 'notif-feed', label: 'Presse' };
    if(notification.redirectView === 'profile') return { ...base, icon: 'fa-user', cls: 'notif-profile', label: 'Profil' };
    return base;
}
function updateNotificationBadge() {
    const c = notifications.filter(n => !n.isRead).length; const b = document.getElementById('notif-badge');
    if(c > 0) { b.textContent = c; b.classList.remove('hidden'); } else b.classList.add('hidden');
}
function openNotifications() {
    document.getElementById('notifications-modal').classList.remove('hidden');
    renderNotificationFilters();
    renderNotificationsList();
    bindPersistentScroll('notif-list', 'notif-list-scroll');
    restorePersistentScroll('notif-list-scroll', 'notif-list');
}
function closeNotifications() { document.getElementById('notifications-modal').classList.add('hidden'); }
function openNotificationTarget(notificationId) {
    const notification = notifications.find(n => String(n._id) === String(notificationId));
    if(!notification) return;
    notification.isRead = true;
    updateNotificationBadge();
    updateDestinationBadges();
    closeNotifications();
    if(notification.redirectView === 'char-mp' && notification.redirectData) {
        const data = notification.redirectData;
        const myChar = myCharacters.find(c => String(c._id) === String(data.myCharId));
        if(!myChar) return;
        const key = mpKey(String(data.myCharId), String(data.otherCharId));
        if(!charMpConversations[key]) {
            charMpConversations[key] = {
                myChar,
                otherChar: {
                    _id: data.otherCharId,
                    name: data.otherCharName || '',
                    avatar: data.otherCharAvatar || '',
                    color: data.otherCharColor || '',
                    role: data.otherCharRole || '',
                    ownerId: data.otherOwnerId || '',
                    ownerUsername: data.otherOwnerUsername || ''
                },
                msgs: [],
                unread: false,
                page: 0,
                hasMore: false,
                total: 0,
                lastContent: ''
            };
        }
        switchView('reseau');
        switchReseauTab('mp');
        openCharMpConvo(key);
        return;
    }
    if(notification.redirectView === 'dm' && notification.redirectData?.username) {
        switchView('chat');
        openDm(notification.redirectData.username);
        return;
    }
    if(notification.redirectView === 'chat') {
        switchView('chat');
        joinRoom(notification.redirectData?.roomId || 'global');
        return;
    }
    if(notification.redirectView === 'feed') {
        switchView('reseau');
        switchReseauTab('flux');
        if(notification.redirectData?.postId) setTimeout(() => openPostDetail(notification.redirectData.postId), 150);
        return;
    }
    if(notification.redirectView === 'presse') {
        switchView('presse');
        if(notification.redirectData?.postId) setTimeout(() => openArticleFullscreen(notification.redirectData.postId), 150);
        return;
    }
    if(notification.redirectView === 'profile' && notification.redirectData?.charName) {
        openProfile(notification.redirectData.charName);
    }
}

function openProfileById(charId, editAfterLoad = false) {
    const localChar = myCharacters.find(c => String(c._id) === String(charId));
    if(localChar) {
        if(editAfterLoad) prepareEditAnyCharacter(localChar._id);
        else openProfile(localChar.name);
        return;
    }
    const match = adminUsersCache.flatMap(u => Array.isArray(u.characters) ? u.characters : []).find(c => String(c._id) === String(charId));
    if(match) {
        window.__pendingProfileEdit = editAfterLoad ? String(charId) : null;
        openProfile(match.name);
    }
}

function prepareEditAnyCharacter(id) {
    const char = myCharacters.find(c => String(c._id) === String(id)) || (currentProfileChar && String(currentProfileChar._id) === String(id) ? currentProfileChar : null);
    if(!char) {
        openProfileById(id, true);
        return;
    }
    document.getElementById('editCharId').value = char._id;
    document.getElementById('editCharOriginalName').value = char.name;
    document.getElementById('editCharName').value = char.name;
    document.getElementById('editCharRole').value = char.role;
    document.getElementById('editCharDesc').value = char.description || '';
    document.getElementById('editCharColor').value = char.color || '#5c7cfa';
    document.getElementById('editCharBase64').value = char.avatar;
    document.getElementById('editCharPartyName').value = char.partyName || '';
    document.getElementById('editCharPartyBase64').value = char.partyLogo || '';
    document.getElementById('editCharCapital').value = char.capital || 0;
    if(document.getElementById('editCharPartyFounder')) document.getElementById('editCharPartyFounder').value = char.partyFounder || '';
    if(document.getElementById('editCharPartyCreationDate')) document.getElementById('editCharPartyCreationDate').value = char.partyCreationDate || '';
    if(document.getElementById('editCharPartyMotto')) document.getElementById('editCharPartyMotto').value = char.partyMotto || '';
    if(document.getElementById('editCharPartyDescription')) document.getElementById('editCharPartyDescription').value = char.partyDescription || '';
    const prEl = document.getElementById('editCharPoliticalRole');
    if(prEl) prEl.value = char.politicalRole || '';
    editCharCompanies = (char.companies || []).map(c => ({...c}));
    renderEditCharCompanies();
    openCharModal('edit');
}

document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('feed-char-avatar-wrapper');
    if(wrapper && !wrapper.contains(e.target)) {
        const dd = document.getElementById('feed-char-dropdown');
        if(dd) dd.classList.add('hidden');
    }
    const pwrapper = document.getElementById('presse-char-avatar-wrapper');
    if(pwrapper && !pwrapper.contains(e.target)) {
        const pdd = document.getElementById('presse-char-dropdown');
        if(pdd) pdd.classList.add('hidden');
    }
});

// ==================== PRESSE ====================
const URGENCY_CONFIG = {
    urgent:   { label: '🚨 URGENT',               cls: 'urgency-urgent'   },
    enquete:  { label: '🔍 ENQUÊTE',              cls: 'urgency-enquete'  },
    officiel: { label: '📢 COMMUNIQUÉ OFFICIEL',  cls: 'urgency-officiel' },
    economie: { label: '📉 ÉCONOMIE',             cls: 'urgency-economie' }
};

const DEFAULT_ARTICLE_THEME = Object.freeze({
    name: 'edition',
    label: 'Édition',
    paper: '#f5f0e8',
    surface: '#efe4d1',
    ink: '#1a1008',
    muted: '#6b5c3e',
    accent: '#c0973b'
});

const FONT_SIZE_VALUE_MAP = {
    '1': 'small',
    '2': 'small',
    '3': 'normal',
    '4': 'large',
    '5': 'large',
    '6': 'xlarge',
    '7': 'xlarge'
};

function cloneArticleTheme(theme = DEFAULT_ARTICLE_THEME) {
    return {
        name: theme.name || DEFAULT_ARTICLE_THEME.name,
        label: theme.label || DEFAULT_ARTICLE_THEME.label,
        paper: theme.paper || DEFAULT_ARTICLE_THEME.paper,
        surface: theme.surface || DEFAULT_ARTICLE_THEME.surface,
        ink: theme.ink || DEFAULT_ARTICLE_THEME.ink,
        muted: theme.muted || DEFAULT_ARTICLE_THEME.muted,
        accent: theme.accent || DEFAULT_ARTICLE_THEME.accent
    };
}

function normalizeHexColor(color, fallback) {
    const value = String(color || '').trim();
    if(/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    if(/^#[0-9a-f]{3}$/i.test(value)) {
        return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
    }
    return fallback;
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex, '#000000');
    return {
        r: parseInt(normalized.slice(1, 3), 16),
        g: parseInt(normalized.slice(3, 5), 16),
        b: parseInt(normalized.slice(5, 7), 16)
    };
}

function rgbToHex(r, g, b) {
    return `#${[r, g, b].map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl(r, g, b) {
    const nr = r / 255;
    const ng = g / 255;
    const nb = b / 255;
    const max = Math.max(nr, ng, nb);
    const min = Math.min(nr, ng, nb);
    let h;
    let s;
    const l = (max + min) / 2;

    if(max === min) {
        h = 0;
        s = 0;
    } else {
        const delta = max - min;
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        switch(max) {
            case nr:
                h = ((ng - nb) / delta) + (ng < nb ? 6 : 0);
                break;
            case ng:
                h = ((nb - nr) / delta) + 2;
                break;
            default:
                h = ((nr - ng) / delta) + 4;
                break;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(100, s)) / 100;
    const light = Math.max(0, Math.min(100, l)) / 100;
    const chroma = (1 - Math.abs((2 * light) - 1)) * sat;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = light - (chroma / 2);
    let r = 0;
    let g = 0;
    let b = 0;

    if(hue < 60) [r, g, b] = [chroma, x, 0];
    else if(hue < 120) [r, g, b] = [x, chroma, 0];
    else if(hue < 180) [r, g, b] = [0, chroma, x];
    else if(hue < 240) [r, g, b] = [0, x, chroma];
    else if(hue < 300) [r, g, b] = [x, 0, chroma];
    else [r, g, b] = [chroma, 0, x];

    return rgbToHex((r + match) * 255, (g + match) * 255, (b + match) * 255);
}

function normalizeArticleTheme(theme) {
    const base = cloneArticleTheme(theme || DEFAULT_ARTICLE_THEME);
    return {
        name: base.name,
        label: base.label,
        paper: normalizeHexColor(base.paper, DEFAULT_ARTICLE_THEME.paper),
        surface: normalizeHexColor(base.surface, DEFAULT_ARTICLE_THEME.surface),
        ink: normalizeHexColor(base.ink, DEFAULT_ARTICLE_THEME.ink),
        muted: normalizeHexColor(base.muted, DEFAULT_ARTICLE_THEME.muted),
        accent: normalizeHexColor(base.accent, DEFAULT_ARTICLE_THEME.accent)
    };
}

function buildArticleThemeStyle(theme) {
    const palette = normalizeArticleTheme(theme);
    return `--article-paper:${palette.paper};--article-surface:${palette.surface};--article-ink:${palette.ink};--article-muted:${palette.muted};--article-accent:${palette.accent};`;
}

function getThemeStateForEditor(editorId) {
    return editorId === 'editArticleContentEditor' ? currentEditArticleTheme : currentPresseTheme;
}

function setThemeStateForEditor(editorId, theme) {
    if(editorId === 'editArticleContentEditor') currentEditArticleTheme = normalizeArticleTheme(theme);
    else currentPresseTheme = normalizeArticleTheme(theme);
}

function buildArticleThemeCandidates(accentHex) {
    const base = rgbToHsl(...Object.values(hexToRgb(normalizeHexColor(accentHex, DEFAULT_ARTICLE_THEME.accent))));
    const accent = normalizeHexColor(accentHex, DEFAULT_ARTICLE_THEME.accent);
    return [
        {
            name: 'logo',
            label: 'Logo',
            paper: hslToHex(base.h, Math.min(base.s * 0.45, 34), 95),
            surface: hslToHex(base.h, Math.min(base.s * 0.34, 26), 89),
            ink: hslToHex(base.h, 22, 15),
            muted: hslToHex(base.h, 16, 36),
            accent
        },
        {
            name: 'edition',
            label: 'Édition',
            paper: '#f5f0e8',
            surface: hslToHex(base.h, 28, 90),
            ink: '#1a1008',
            muted: '#6b5c3e',
            accent
        },
        {
            name: 'nuit',
            label: 'Nuit',
            paper: hslToHex(base.h, 18, 13),
            surface: hslToHex(base.h, 18, 18),
            ink: '#f7f1e7',
            muted: '#c3b8a6',
            accent: hslToHex(base.h, Math.max(base.s, 58), 62)
        }
    ].map(theme => normalizeArticleTheme(theme));
}

async function extractDominantColorFromImage(url) {
    return await new Promise(resolve => {
        if(!url) {
            resolve(DEFAULT_ARTICLE_THEME.accent);
            return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const size = 24;
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if(!ctx) {
                    resolve(DEFAULT_ARTICLE_THEME.accent);
                    return;
                }
                ctx.drawImage(img, 0, 0, size, size);
                const { data } = ctx.getImageData(0, 0, size, size);
                let totalR = 0;
                let totalG = 0;
                let totalB = 0;
                let count = 0;
                for(let index = 0; index < data.length; index += 4) {
                    const alpha = data[index + 3];
                    if(alpha < 140) continue;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    const lightness = rgbToHsl(r, g, b).l;
                    if(lightness > 97 || lightness < 5) continue;
                    totalR += r;
                    totalG += g;
                    totalB += b;
                    count += 1;
                }
                if(!count) {
                    resolve(DEFAULT_ARTICLE_THEME.accent);
                    return;
                }
                resolve(rgbToHex(totalR / count, totalG / count, totalB / count));
            } catch (error) {
                resolve(DEFAULT_ARTICLE_THEME.accent);
            }
        };
        img.onerror = () => resolve(DEFAULT_ARTICLE_THEME.accent);
        img.src = url;
    });
}

function renderArticleThemeChoices(containerId, themes, selectedTheme, editorId) {
    const container = document.getElementById(containerId);
    if(!container) return;
    const activeName = normalizeArticleTheme(selectedTheme).name;
    container.innerHTML = themes.map(theme => {
        const palette = normalizeArticleTheme(theme);
        const active = palette.name === activeName ? 'active' : '';
        return `
            <button
                type="button"
                class="presse-theme-choice ${active}"
                onclick="selectArticleTheme('${containerId}', '${editorId}', '${palette.name}')"
                style="${buildArticleThemeStyle(palette)} background:linear-gradient(135deg, color-mix(in srgb, var(--article-accent) 24%, transparent), transparent 55%), var(--article-paper); color:var(--article-ink);"
            >
                <span class="presse-theme-choice-label">
                    <strong>${escapeHtml(palette.label || palette.name)}</strong>
                    <span>${escapeHtml(palette.paper)} • ${escapeHtml(palette.accent)}</span>
                </span>
                <span class="presse-theme-choice-swatches">
                    <i style="background:${palette.paper};"></i>
                    <i style="background:${palette.surface};"></i>
                    <i style="background:${palette.accent};"></i>
                </span>
            </button>`;
    }).join('');
    container.dataset.themes = JSON.stringify(themes);
}

function selectArticleTheme(containerId, editorId, themeName) {
    const container = document.getElementById(containerId);
    if(!container) return;
    const themes = JSON.parse(container.dataset.themes || '[]');
    const theme = themes.find(item => item.name === themeName) || DEFAULT_ARTICLE_THEME;
    setThemeStateForEditor(editorId, theme);
    renderArticleThemeChoices(containerId, themes, theme, editorId);
    if(editorId === 'presseContentEditor') updatePresseComposerUX();
}

async function hydrateArticleThemeChoices(logoUrl, editorId, initialTheme = null) {
    const accent = await extractDominantColorFromImage(logoUrl);
    const themes = buildArticleThemeCandidates(accent);
    const theme = normalizeArticleTheme(initialTheme || themes[0] || DEFAULT_ARTICLE_THEME);
    setThemeStateForEditor(editorId, theme);
    renderArticleThemeChoices(
        editorId === 'editArticleContentEditor' ? 'editArticleThemeChoices' : 'presseThemeChoices',
        themes,
        theme,
        editorId
    );
    if(editorId === 'presseContentEditor') updatePresseComposerUX();
}

function getPresseEditor(editorId = 'presseContentEditor') {
    return document.getElementById(editorId);
}

function unwrapNode(node) {
    if(!node || !node.parentNode) return;
    while(node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
    node.parentNode.removeChild(node);
}

function normalizeEditorFonts(editor) {
    if(!editor) return;
    editor.querySelectorAll('font').forEach(node => {
        const mapped = FONT_SIZE_VALUE_MAP[node.getAttribute('size') || '3'];
        if(mapped && mapped !== 'normal') {
            const span = document.createElement('span');
            span.setAttribute('data-font-size', mapped);
            span.innerHTML = node.innerHTML;
            node.replaceWith(span);
        } else {
            unwrapNode(node);
        }
    });
}

function sanitizeArticleNode(node, documentRef) {
    const allowedTags = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'SPAN']);
    if(node.nodeType === Node.TEXT_NODE) return documentRef.createTextNode(node.textContent || '');
    if(node.nodeType !== Node.ELEMENT_NODE) return null;

    let tag = node.tagName.toUpperCase();
    if(tag === 'DIV') tag = 'P';
    if(tag === 'FONT') tag = 'SPAN';
    if(!allowedTags.has(tag)) {
        const fragment = documentRef.createDocumentFragment();
        Array.from(node.childNodes).forEach(child => {
            const sanitizedChild = sanitizeArticleNode(child, documentRef);
            if(sanitizedChild) fragment.appendChild(sanitizedChild);
        });
        return fragment;
    }

    const element = documentRef.createElement(tag.toLowerCase());
    if(tag === 'SPAN') {
        const size = node.getAttribute('data-font-size') || FONT_SIZE_VALUE_MAP[node.getAttribute('size') || '3'];
        if(size && size !== 'normal') element.setAttribute('data-font-size', size);
    }

    Array.from(node.childNodes).forEach(child => {
        const sanitizedChild = sanitizeArticleNode(child, documentRef);
        if(sanitizedChild) element.appendChild(sanitizedChild);
    });
    return element;
}

function sanitizeArticleHtml(html) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const wrapper = parsed.body.firstElementChild;
    const cleanRoot = parsed.createElement('div');
    Array.from(wrapper.childNodes).forEach(child => {
        const sanitizedChild = sanitizeArticleNode(child, parsed);
        if(sanitizedChild) cleanRoot.appendChild(sanitizedChild);
    });
    return cleanRoot.innerHTML
        .replace(/<p><\/p>/g, '')
        .replace(/(<br>){3,}/g, '<br><br>')
        .trim();
}

function getPlainTextFromHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html || '';
    return (temp.textContent || '').replace(/\s+/g, ' ').trim();
}

function editorHtmlToStorage(html) {
    const cleanHtml = sanitizeArticleHtml(html);
    return cleanHtml ? `[HTML]${cleanHtml}[/HTML]` : '';
}

function legacyArticleTextToEditorHtml(text) {
    let html = escapeHtml(text || '');
    html = html
        .replace(/\[H1\]([\s\S]*?)\[\/H1\]/g, '<h2>$1</h2>')
        .replace(/\[H2\]([\s\S]*?)\[\/H2\]/g, '<h3>$1</h3>')
        .replace(/\[SMALL\]([\s\S]*?)\[\/SMALL\]/g, '<p><span data-font-size="small">$1</span></p>')
        .replace(/\[QUOTE\]([\s\S]*?)\[\/QUOTE\]/g, '<blockquote>$1</blockquote>')
        .replace(/\[B\]([\s\S]*?)\[\/B\]/g, '<strong>$1</strong>')
        .replace(/\[I\]([\s\S]*?)\[\/I\]/g, '<em>$1</em>')
        .replace(/\[U\]([\s\S]*?)\[\/U\]/g, '<u>$1</u>')
        .replace(/\[SIZE=(small|normal|large|xlarge)\]([\s\S]*?)\[\/SIZE\]/g, (match, size, value) => size === 'normal' ? value : `<span data-font-size="${size}">${value}</span>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br>');
    return sanitizeArticleHtml(`<p>${html}</p>`);
}

function parseArticleContent(content) {
    let titleText = '';
    let bodyText = content || '';
    let bodyHtml = '';
    let isHtml = false;
    const titleMatch = content && content.match(/^\[TITRE\](.*?)\[\/TITRE\]\n?([\s\S]*)/);
    if(titleMatch) {
        titleText = titleMatch[1];
        bodyText = titleMatch[2] || '';
    } else {
        const words = (content || '').split(/\s+/);
        titleText = words.slice(0, 8).join(' ') + (words.length > 8 ? '...' : '');
    }

    const htmlMatch = String(bodyText || '').trim().match(/^\[HTML\]([\s\S]*)\[\/HTML\]$/);
    if(htmlMatch) {
        bodyHtml = sanitizeArticleHtml(htmlMatch[1]);
        isHtml = true;
    }
    return { titleText, bodyText, bodyHtml, isHtml };
}

function getArticleExcerpt(content, maxLength = 180) {
    const { bodyText, bodyHtml, isHtml } = parseArticleContent(content || '');
    const sourceText = isHtml ? getPlainTextFromHtml(bodyHtml || '') : String(bodyText || '');
    const cleanText = sourceText
        .replace(/\[(?:\/?)(?:H1|H2|SMALL|QUOTE|B|I|U)\]/g, ' ')
        .replace(/\[SIZE=(small|normal|large|xlarge)\]|\[\/SIZE\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if(cleanText.length <= maxLength) return cleanText;
    return `${cleanText.slice(0, maxLength).trimEnd()}…`;
}

function parseCompactCountInput(value) {
    if(typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    const rawValue = String(value ?? '').trim().toLowerCase();
    if(!rawValue) return NaN;
    const compact = rawValue.replace(/\s+/g, '');
    if(/^\d+(?:[.,]\d+)?$/.test(compact)) {
        return Math.max(0, Math.floor(Number(compact.replace(',', '.'))));
    }
    const factors = { k: 1e3, m: 1e6, b: 1e9 };
    const matches = compact.match(/\d+(?:[.,]\d+)?[kmb]?/g);
    if(!matches || matches.join('') !== compact) return NaN;
    const total = matches.reduce((sum, token) => {
        const match = token.match(/^(\d+(?:[.,]\d+)?)([kmb])?$/);
        if(!match) return NaN;
        const amount = Number(match[1].replace(',', '.'));
        if(!Number.isFinite(amount)) return NaN;
        return sum + (amount * (factors[match[2]] || 1));
    }, 0);
    return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : NaN;
}

function formatCompactCountLabel(value) {
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
}

function normalizeCompactCountStorage(value) {
    const parsed = parseCompactCountInput(value);
    return Number.isFinite(parsed) ? formatCompactCountLabel(parsed) : '';
}

function getDisplayCountValue(rawDisplay, fallbackValue = 0) {
    const parsed = parseCompactCountInput(rawDisplay);
    return Number.isFinite(parsed) ? parsed : Math.max(0, Number(fallbackValue) || 0);
}

function getDisplayCountLabel(rawDisplay, fallbackValue = 0) {
    const stored = String(rawDisplay || '').trim();
    if(stored) return stored;
    return formatCompactCountLabel(fallbackValue);
}

function getFollowerCountLabel(char) {
    return getDisplayCountLabel(char?.followerCountDisplay, char?.followers?.length || 0);
}

function getPostLikeCountLabel(post) {
    return formatCompactCountLabel(getPostLikeCountValue(post));
}

function getPostLikeCountValue(post) {
    return Math.max(0, getDisplayCountValue(post?.likeCountDisplay, 0) + (post?.likes?.length || 0));
}

function formatArticleDateTime(post) {
    const source = post.timestamp || post.date;
    const d = source ? new Date(source) : new Date();
    if(isNaN(d.getTime())) return post.date || '';
    return d.toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatArticleRichText(text) {
    const parsedBody = parseArticleContent(`[TITRE][/TITRE]\n${text || ''}`);
    if(parsedBody.isHtml) return parsedBody.bodyHtml;
    let html = escapeHtml(text || '');
    html = html
        .replace(/\[H1\]([\s\S]*?)\[\/H1\]/g, '<h3 class="article-inline-h1">$1</h3>')
        .replace(/\[H2\]([\s\S]*?)\[\/H2\]/g, '<h4 class="article-inline-h2">$1</h4>')
        .replace(/\[SMALL\]([\s\S]*?)\[\/SMALL\]/g, '<p class="article-inline-small">$1</p>')
        .replace(/\[QUOTE\]([\s\S]*?)\[\/QUOTE\]/g, '<blockquote class="article-inline-quote">$1</blockquote>')
        .replace(/\[B\]([\s\S]*?)\[\/B\]/g, '<strong>$1</strong>')
        .replace(/\[I\]([\s\S]*?)\[\/I\]/g, '<em>$1</em>')
        .replace(/\[U\]([\s\S]*?)\[\/U\]/g, '<u>$1</u>')
        .replace(/\[SIZE=(small|normal|large|xlarge)\]([\s\S]*?)\[\/SIZE\]/g, (match, size, value) => size === 'normal' ? value : `<span class="article-font-${size}">${value}</span>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    return html;
}

function syncArticleEditor(editorId) {
    const editor = getPresseEditor(editorId);
    if(!editor) return '';
    normalizeEditorFonts(editor);
    const cleanHtml = sanitizeArticleHtml(editor.innerHTML);
    if(editor.innerHTML !== cleanHtml) editor.innerHTML = cleanHtml;
    return cleanHtml;
}

function applyPresseFormat(tag, editorId = 'presseContentEditor') {
    const editor = getPresseEditor(editorId);
    if(!editor) return;
    editor.focus();
    if(tag === 'SMALL') {
        applyPresseFontSize('small', editorId);
        return;
    }
    if(tag === 'B') document.execCommand('bold', false);
    else if(tag === 'I') document.execCommand('italic', false);
    else if(tag === 'U') document.execCommand('underline', false);
    else if(tag === 'H1') document.execCommand('formatBlock', false, 'h2');
    else if(tag === 'H2') document.execCommand('formatBlock', false, 'h3');
    else if(tag === 'P') document.execCommand('formatBlock', false, 'p');
    else if(tag === 'QUOTE') document.execCommand('formatBlock', false, 'blockquote');
    else if(tag === 'LIST') document.execCommand('insertUnorderedList', false);
    syncArticleEditor(editorId);
    if(editorId === 'presseContentEditor') updatePresseComposerUX();
}

function applyPresseFontSize(size, editorId = 'presseContentEditor') {
    const editor = getPresseEditor(editorId);
    if(!editor || !size) return;
    editor.focus();
    const commandValue = size === 'small' ? '2' : size === 'large' ? '5' : size === 'xlarge' ? '6' : '3';
    document.execCommand('fontSize', false, commandValue);
    syncArticleEditor(editorId);
    if(editorId === 'presseContentEditor') updatePresseComposerUX();
}

function applyPressePreset() {
    const preset = document.getElementById('pressePreset')?.value;
    const titleInput = document.getElementById('presseTitle');
    const editor = getPresseEditor('presseContentEditor');
    if(!preset || !titleInput || !editor) return;
    const templates = {
        flash: {
            title: 'Flash info — ',
            content: '<h2>Information principale</h2><p><span data-font-size="small">Date, lieu, contexte</span></p><blockquote>Déclaration courte</blockquote><p>Détails factuels...</p>'
        },
        chronique: {
            title: 'Chronique — ',
            content: '<h3>Contexte</h3><p>Analyse de la situation...</p><h3>Conséquences</h3><p>Lecture politique et sociale...</p>'
        },
        interview: {
            title: 'Interview — ',
            content: '<h2>Entretien exclusif</h2><p><span data-font-size="small">Journaliste : ...</span></p><blockquote>Question 1</blockquote><p>Réponse...</p><blockquote>Question 2</blockquote><p>Réponse...</p>'
        },
        enquete: {
            title: 'Dossier enquête — ',
            content: '<h2>Ce que nous avons découvert</h2><h3>Pièce 1</h3><p>Faits vérifiés...</p><h3>Pièce 2</h3><p>Éléments complémentaires...</p><p><span data-font-size="small">Sources recoupées.</span></p>'
        }
    };
    const tpl = templates[preset];
    if(!tpl) return;
    if(!titleInput.value.trim()) titleInput.value = tpl.title;
    editor.innerHTML = sanitizeArticleHtml(tpl.content);
    updatePresseComposerUX();
}

function countWords(text) {
    const cleaned = String(text || '').replace(/\[(?:\/?)(?:H1|H2|SMALL|QUOTE|B|I|U|HTML|\/HTML)\]/g, ' ').trim();
    if(!cleaned) return 0;
    return cleaned.split(/\s+/).filter(Boolean).length;
}

function initPresseComposerUX() {
    if(presseUxBound) return;
    const ids = ['presseTitle', 'presseJournalName', 'presseUrgency'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', updatePresseComposerUX);
        if(el && el.tagName === 'SELECT') el.addEventListener('change', updatePresseComposerUX);
    });
    const editor = getPresseEditor('presseContentEditor');
    if(editor) {
        editor.addEventListener('input', () => updatePresseComposerUX());
        editor.addEventListener('blur', () => syncArticleEditor('presseContentEditor'));
    }
    hydrateArticleThemeChoices('', 'presseContentEditor', DEFAULT_ARTICLE_THEME);
    presseUxBound = true;
    updatePresseComposerUX();
}

function updatePresseComposerUX() {
    const title = document.getElementById('presseTitle')?.value?.trim() || '';
    const bodyHtml = syncArticleEditor('presseContentEditor');
    const body = getPlainTextFromHtml(bodyHtml);
    const journal = document.getElementById('presseJournalName')?.value?.trim() || 'Journal non défini';
    const urgency = document.getElementById('presseUrgency')?.value || '';
    const mediaUrl = document.getElementById('presseMediaUrl')?.value || '';
    const theme = normalizeArticleTheme(currentPresseTheme || DEFAULT_ARTICLE_THEME);
    const wc = countWords(body);
    const readMin = Math.max(1, Math.ceil(wc / 220));

    const wcEl = document.getElementById('presseWordCount');
    const rtEl = document.getElementById('presseReadTime');
    if(wcEl) wcEl.textContent = `${wc} mot${wc > 1 ? 's' : ''}`;
    if(rtEl) rtEl.textContent = `${readMin} min de lecture`;

    const preview = document.getElementById('presseLivePreview');
    if(!preview) return;
    if(!title && !body) {
        preview.innerHTML = '<div class="presse-live-label">Aperçu live</div><div class="presse-live-empty">Commence à écrire pour voir le rendu de ton article.</div>';
        return;
    }
    const urgencyLabel = urgency && URGENCY_CONFIG[urgency] ? URGENCY_CONFIG[urgency].label : 'Normal';
    const mediaHtml = mediaUrl
        ? (mediaUrl.match(/\.(mp4|webm|ogg)$/i) || mediaUrl.includes('/video/upload')
            ? `<video src="${mediaUrl}" controls style="width:100%; border-radius:8px; margin:8px 0;"></video>`
            : `<img src="${mediaUrl}" alt="preview" style="width:100%; border-radius:8px; margin:8px 0; max-height:220px; object-fit:cover;">`)
        : '';

    preview.innerHTML = `
        <div class="presse-live-label">Aperçu live</div>
        <div class="presse-live-card" style="${buildArticleThemeStyle(theme)}">
            <h4 class="presse-live-title">${escapeHtml(title || 'Titre de l\'article')}</h4>
            <div class="presse-live-meta">
                <span><i class="fa-solid fa-newspaper"></i> ${escapeHtml(journal)}</span>
                <span><i class="fa-regular fa-clock"></i> ${new Date().toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                <span><i class="fa-solid fa-bolt"></i> ${escapeHtml(urgencyLabel)}</span>
            </div>
            ${mediaHtml}
            <div class="presse-live-body">${bodyHtml || '<span class="presse-live-empty">Ajoute du contenu...</span>'}</div>
        </div>`;
}

async function previewPresseJournalLogo() {
    const file = document.getElementById('presseJournalLogoFile')?.files?.[0];
    if(!file) return;
    const preview = document.getElementById('presseJournalLogoPreview');
    if(preview) preview.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    const url = await uploadToCloudinary(file);
    if(url) {
        const hidden = document.getElementById('presseJournalLogo');
        if(hidden) hidden.value = url;
        if(preview) preview.innerHTML = `<img src="${url}" alt="logo journal">`;
        await hydrateArticleThemeChoices(url, 'presseContentEditor', currentPresseTheme || DEFAULT_ARTICLE_THEME);
    } else if(preview) {
        preview.innerHTML = '<i class="fa-solid fa-newspaper"></i>';
    }
    updatePresseComposerUX();
}

function onPresseJournalSearch(value) {
    presseJournalFilter = (value || '').trim().toLowerCase();
    updatePresseWriteBox();
    renderPresseStream();
}

function clearPresseJournalSearch() {
    const input = document.getElementById('presseJournalSearch');
    if(input) input.value = '';
    presseJournalFilter = '';
    updatePresseWriteBox();
    renderPresseStream();
}

function refreshPresseJournalDatalist() {
    const datalist = document.getElementById('presse-journal-list');
    if(!datalist) return;
    const journals = [...new Set(presseArticlesCache.map(a => (a.journalName || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    datalist.innerHTML = journals.map(j => `<option value="${escapeHtml(j)}"></option>`).join('');
}

async function previewPresseFile() {
    const file = document.getElementById('presseMediaFile').files[0];
    if(file) {
        const url = await uploadToCloudinary(file);
        if(url) document.getElementById('presseMediaUrl').value = url;
        updatePresseComposerUX();
    }
}

function submitArticle() {
    const isForbiddenMode = IS_ADMIN && isForbiddenPresseMode();
    const title = document.getElementById('presseTitle').value.trim();
    const editorHtml = syncArticleEditor('presseContentEditor');
    const content = editorHtmlToStorage(editorHtml);
    const contentText = getPlainTextFromHtml(editorHtml);
    const mediaUrl = document.getElementById('presseMediaUrl').value.trim();
    const journalName = document.getElementById('presseJournalName').value.trim();
    const journalLogo = document.getElementById('presseJournalLogo').value.trim();
    const urgencyLevel = document.getElementById('presseUrgency').value || null;
    const isPresseP = document.getElementById('presseIsPub')?.checked;
    const pressePubId = isPresseP ? document.getElementById('pressePubStockId')?.value : null;
    const linkedStock = pressePubId ? stocksData.find(stock => String(stock._id) === String(pressePubId)) : null;
    if(!title && !contentText) return alert("Article vide.");
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    if(!isForbiddenMode && !currentPresseCharId) return alert("Aucun journaliste sélectionné.");
    if(!isForbiddenMode && !char) return alert("Personnage introuvable.");

    let mediaType = null;
    if(mediaUrl) {
        if(getYoutubeId(mediaUrl) || mediaUrl.match(/\.(mp4|webm|ogg)$/i) || mediaUrl.includes('/video/upload')) mediaType = 'video';
        else if(mediaUrl.includes('.webm') || mediaUrl.includes('/raw/upload')) mediaType = 'audio';
        else mediaType = 'image';
    }

    const articleAuthor = isForbiddenMode
        ? {
            authorCharId: '',
            authorName: 'Cellule Archive',
            authorAvatar: 'assets/img/icone.png',
            authorRole: 'Source non reconnue',
            authorColor: '#c84f4f',
            partyName: '',
            partyLogo: ''
        }
        : {
            authorCharId: char._id,
            authorName: char.name,
            authorAvatar: char.avatar,
            authorRole: char.role,
            authorColor: char.color,
            partyName: char.partyName,
            partyLogo: char.partyLogo
        };

    const articleTheme = isForbiddenMode
        ? normalizeArticleTheme(buildForbiddenDossierArticle().articleTheme)
        : normalizeArticleTheme(currentPresseTheme || DEFAULT_ARTICLE_THEME);

    const articleData = {
        ...articleAuthor,
        content: `[TITRE]${title}[/TITRE]\n${content}`,
        mediaUrl, mediaType,
        date: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), ownerId: PLAYER_ID,
        journalName: isForbiddenMode ? 'Dossier Kael' : journalName,
        journalLogo: isForbiddenMode ? '' : journalLogo,
        isAnonymous: false, isBreakingNews: urgencyLevel === 'urgent',
        urgencyLevel: isForbiddenMode ? 'enquete' : urgencyLevel,
        articleTheme,
        isArticle: true, poll: null,
        isSponsored: !!isPresseP,
        linkedStockId: pressePubId || '',
        linkedCompanyName: linkedStock?.companyName || ''
    };

    socket.emit('create_post', articleData);
    
    // Pub boost bourse
    if(isPresseP && pressePubId) socket.emit('pub_boost_stock', { stockId: pressePubId });

    document.getElementById('presseTitle').value = '';
    const editor = getPresseEditor('presseContentEditor');
    if(editor) editor.innerHTML = '';
    document.getElementById('presseMediaUrl').value = '';
    document.getElementById('presseMediaFile').value = '';
    document.getElementById('presseUrgency').value = '';
    const presseP = document.getElementById('presseIsPub'); if(presseP) { presseP.checked = false; togglePressePubSelect(); }
    hydrateArticleThemeChoices(journalLogo, 'presseContentEditor', currentPresseTheme || DEFAULT_ARTICLE_THEME);
    updatePresseComposerUX();
    updatePresseLiveToggleUI();
    clearDraftValue('presse');
    setPresseComposerOpen(false);
}

function submitLiveNews() {
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    const textInput = document.getElementById('presseLiveQuickText');
    const liveNewsText = textInput?.value?.trim() || '';
    if(!char || !isJournalistCharacter(char)) return alert('Aucun journaliste sélectionné.');
    if(!liveNewsText) return alert('Ajoute une phrase pour le direct.');
    socket.emit('create_post', {
        authorCharId: char._id,
        authorName: char.name,
        authorAvatar: char.avatar,
        authorRole: char.role,
        authorColor: char.color,
        partyName: char.partyName,
        partyLogo: char.partyLogo,
        content: liveNewsText,
        liveNewsText,
        date: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        ownerId: PLAYER_ID,
        journalName: '',
        journalLogo: '',
        isAnonymous: false,
        isBreakingNews: false,
        isLiveNews: true,
        isArticle: false,
        poll: null,
        isSponsored: false,
        linkedStockId: '',
        linkedCompanyName: ''
    });
    if(textInput) textInput.value = '';
}

function renderArticleBodyMarkup(post) {
    const { bodyText, bodyHtml, isHtml } = parseArticleContent(post.content || '');
    if(isHtml) {
        return `<div class="article-content article-content-rich">${bodyHtml || '<p></p>'}</div>`;
    }
    if(bodyText && bodyText.trim().length > 0) {
        const firstChar = bodyText.trim().charAt(0);
        const rest = bodyText.trim().slice(1);
        return `<div class="article-content"><span class="article-dropcap">${escapeHtml(firstChar)}</span>${formatArticleRichText(rest)}</div>`;
    }
    return '<div class="article-content"></div>';
}

function getArticleMentionedCities(post) {
    const source = [post?.content, post?.authorRole, post?.journalName].filter(Boolean).join(' ').toLowerCase();
    return citiesData.filter(city => city?.name && source.includes(String(city.name).toLowerCase())).slice(0, 4);
}

function buildArticleCardMarkup(post) {
    const { titleText } = parseArticleContent(post.content || '');
    const mentionedCities = getArticleMentionedCities(post);
    const isForbiddenDossier = isForbiddenDossierArticle(post);
    const delBtn = !isForbiddenDossier && (IS_ADMIN || post.ownerId === PLAYER_ID) ? `<button class="article-del-btn" onclick="event.stopPropagation(); deletePost('${post._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
    const editBtn = !isForbiddenDossier && (post.ownerId === PLAYER_ID || IS_ADMIN) ? `<button class="article-edit-btn" onclick="event.stopPropagation(); openArticleEditModal('${post._id}')"><i class="fa-solid fa-pen"></i></button>` : '';
    const headlineBtn = !isForbiddenDossier && IS_ADMIN ? `<button class="article-headline-btn" onclick="event.stopPropagation(); toggleHeadline('${post._id}', ${!post.isHeadline})" title="${post.isHeadline ? 'Retirer de la Une' : 'Mettre à la Une'}"><i class="fa-solid fa-star"></i> ${post.isHeadline ? 'Retirer la Une' : 'La Une'}</button>` : '';
    const liveBtn = !isForbiddenDossier && IS_ADMIN && post.isLiveNews ? `<button class="article-headline-btn article-live-toggle-btn" onclick="event.stopPropagation(); toggleArticleLiveNews('${post._id}', false)" title="Retirer du direct"><i class="fa-solid fa-tower-broadcast"></i> Retirer du direct</button>` : '';

    let bannerHTML = '';
    if(post.mediaUrl && post.mediaType === 'image') bannerHTML = `<img src="${post.mediaUrl}" class="article-banner">`;

    const partyHTML = post.partyName && post.partyLogo ? `<span class="party-badge"><img src="${post.partyLogo}" class="party-logo"> ${post.partyName}</span>` : '';

    let urgencyHTML = '';
    if(post.urgencyLevel && URGENCY_CONFIG[post.urgencyLevel]) {
        const uc = URGENCY_CONFIG[post.urgencyLevel];
        urgencyHTML = `<span class="article-urgency-tag ${uc.cls}">${uc.label}</span>`;
    }

    const journalBlock = post.journalName
        ? `<div class="article-journal-chip">${post.journalLogo ? `<img src="${post.journalLogo}" class="article-journal-logo" alt="logo">` : '<i class="fa-solid fa-newspaper"></i>'}<span>${escapeHtml(post.journalName)}</span></div>`
        : '';
    const publishedAt = formatArticleDateTime(post);

    return `
        ${bannerHTML}
        <div class="article-body">
            ${delBtn}
            ${editBtn}
            ${headlineBtn}
            ${liveBtn}
            ${urgencyHTML}
            ${journalBlock}
            <h2 class="article-title">${escapeHtml(titleText)}</h2>
            <div class="article-published-at"><i class="fa-regular fa-clock"></i> ${escapeHtml(publishedAt)}</div>
            <div class="article-separator"></div>
            ${renderArticleBodyMarkup(post)}
            ${mentionedCities.length ? `<div class="article-linked-modules"><div class="article-linked-title">Cités citées</div><div class="article-linked-list">${mentionedCities.map(city => `<button class="article-linked-chip module-cites" onclick="event.stopPropagation(); openCityDetailById('${city._id}')">${escapeHtml(city.name)}</button>`).join('')}</div></div>` : ''}
            <div class="article-footer-signature" onclick="event.stopPropagation(); openProfile('${post.authorName.replace(/'/g, "\\'")}')">
                <img src="${post.authorAvatar}" class="article-sig-avatar">
                <div>
                    <div class="article-sig-name">${post.authorName}</div>
                    <div class="article-sig-role">${post.authorRole}${partyHTML}</div>
                </div>
            </div>
            <div class="article-actions">
                <button class="action-item ${post.likes.includes(currentFeedCharId)?'liked':''}" onclick="event.stopPropagation(); toggleLike('${post._id}')"><i class="fa-solid fa-heart"></i> ${getPostLikeCountLabel(post)}</button>
                ${IS_ADMIN ? `<button class="action-item" onclick="event.stopPropagation(); openAdminStatsModal('${post._id}', '${getPostLikeCountLabel(post).replace(/'/g, "\\'")}')" title="Admin: modifier likes" style="color:var(--warning);"><i class="fa-solid fa-pen"></i></button>` : ''}
            </div>
        </div>`;
}

function createArticleElement(post, options = {}) {
    const div = document.createElement('div');
    div.className = 'article-card';
    if(post.isHeadline) div.classList.add('article-headline');
    if(post.urgencyLevel === 'urgent') div.classList.add('article-breaking');
    if(isForbiddenDossierArticle(post)) div.classList.add('article-forbidden');
    div.id = options.id || `article-${post._id}`;
    div.style.cssText = buildArticleThemeStyle(post.articleTheme || DEFAULT_ARTICLE_THEME);
    div.innerHTML = buildArticleCardMarkup(post);
    if(options.interactive !== false) {
        div.addEventListener('click', event => {
            if(event.target.closest('button, a, input, label, video, audio')) return;
            openArticleFullscreen(post._id);
        });
    }
    return div;
}

function normalizeForbiddenPressQuery(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

    function isForbiddenDossierArticle(post) {
        if(!post) return false;
        return !!post.isForbiddenDossier
        || normalizeForbiddenPressQuery(post.journalName) === 'dossier kael'
        || normalizeForbiddenPressQuery(post.articleTheme?.name) === 'forbidden-dossier';
    }

function buildForbiddenDossierArticle() {
    return {
        _id: 'forbidden-dossier-kael',
        isArticle: true,
        isForbiddenDossier: true,
        isHeadline: false,
        urgencyLevel: 'enquete',
        authorName: 'Cellule Archive',
        authorAvatar: 'assets/img/icone.png',
        authorRole: 'Source non reconnue',
        authorColor: '#c84f4f',
        partyName: '',
        partyLogo: '',
        journalName: 'Archives Ombra',
        journalLogo: '',
        mediaUrl: '',
        mediaType: '',
        likes: [],
        comments: [],
        likeCountLabel: '0',
        likeCountValue: 0,
        date: '00/00/2084 03:13',
        timestamp: new Date('2084-01-01T03:13:00Z'),
        content: `[TITRE]Dossier Kael[/TITRE]\n[HTML]<p><strong>Document saisi</strong> dans une archive non indexee.</p><blockquote>Le sujet KAEL n'a jamais existe officiellement.</blockquote><p><span data-font-size="small">Reference: Chambre noire // Niveau de diffusion: interdit</span></p><p>Temoignages contradictoires, cartes retouchees, registres diplomatiques incomplets. Plusieurs sources mentionnent une intervention avant l'effacement total du dossier.</p><p>[DONNEE SUPPRIMEE] [TEMOIN REDACTED] [LOCALISATION SOUS SCELLES]</p>[/HTML]`,
        articleTheme: {
            name: 'forbidden-dossier',
            label: 'Dossier interdit',
            paper: '#221715',
            surface: '#2d1b18',
            ink: '#f3d6c9',
            muted: '#b88d80',
            accent: '#b31217'
        }
    };
}

function getVisiblePresseArticles() {
    if(isForbiddenPresseMode()) {
        return [buildForbiddenDossierArticle(), ...presseArticlesCache.filter(isForbiddenDossierArticle)];
    }
    let articles = [...presseArticlesCache];
    if(presseJournalFilter) {
        articles = articles.filter(a => (a.journalName || '').toLowerCase().includes(presseJournalFilter));
    }
    return articles;
}

function openArticleFullscreen(postId) {
    const post = getVisiblePresseArticles().find(item => String(item._id) === String(postId));
    if(!post) return;
    const { titleText } = parseArticleContent(post.content || '');
    addRecentActivity({ type: 'article', id: postId, label: titleText || post.journalName || 'Article', meta: post.journalName || post.authorName || 'Presse' });
    currentArticleFullscreenId = String(postId);
    const content = document.getElementById('article-fullscreen-content');
    const label = document.getElementById('articleFullscreenLabel');
    if(!content || !label) return;
    label.textContent = titleText || 'Article';
    content.innerHTML = '';
    content.appendChild(createArticleElement(post, { interactive: false, id: `article-fullscreen-${post._id}` }));
    document.getElementById('article-fullscreen-modal')?.classList.remove('hidden');
}

function closeArticleFullscreen() {
    currentArticleFullscreenId = null;
    document.getElementById('article-fullscreen-modal')?.classList.add('hidden');
}

function toggleHeadline(postId, value) {
    if(!IS_ADMIN) return;
    socket.emit('set_headline', { postId, value });
}

function loadPresse() { socket.emit('request_presse'); }

function renderPresseStream() {
    const c = document.getElementById('presse-stream');
    if(!c) return;
    c.innerHTML = '';
    const articles = getVisiblePresseArticles();
    if(articles.length === 0) {
        c.innerHTML = presseJournalFilter
            ? '<div style="text-align:center; padding:40px; color:#555;"><i class="fa-solid fa-filter-circle-xmark" style="font-size:2rem; margin-bottom:12px; display:block;"></i>Aucun article pour ce journal.</div>'
            : '<div style="text-align:center; padding:40px; color:#555;"><i class="fa-solid fa-newspaper" style="font-size:2.5rem; margin-bottom:12px; display:block;"></i>Aucun article publié.</div>';
        return;
    }
    articles.forEach(p => c.appendChild(createArticleElement(p)));
}

socket.on('presse_data', (articles) => {
    presseArticlesCache = articles;
    syncLiveNewsFromArticles();
    if(currentView === 'accueil') renderAccueil();
    refreshPresseJournalDatalist();
    refreshFeedProfileDatalist();
    initPresseComposerUX();
    renderPresseStream();
    buildAdminConsoleOverview();
});

socket.on('world_timeline_data', (items) => {
    worldTimelineCache = Array.isArray(items) ? items : [];
    if(currentView === 'accueil') renderAccueil();
});

socket.on('cosmos_tension_data', (payload) => {
    cosmosTensionCache = payload && typeof payload.value === 'number' ? payload : null;
    renderCosmosTensionWidget();
});

socket.on('new_article', (post) => {
    presseArticlesCache = [post, ...presseArticlesCache.filter(item => String(item._id) !== String(post._id))];
    syncLiveNewsFromArticles();
    if(currentView === 'presse') {
        loadPresse();
    } else {
        document.getElementById('btn-view-presse').classList.add('nav-notify');
    }
});

socket.on('live_news_data', (articles) => {
    const previousIds = new Set(liveNewsCache.map(article => String(article._id)));
    const normalizedArticles = normalizeLiveNewsArticles(articles);
    const hasNewItem = liveNewsBootstrapped && normalizedArticles.some(article => !previousIds.has(String(article._id)));
    normalizedArticles.forEach(article => {
        const articleId = String(article._id);
        if(liveNewsBootstrapped && !previousIds.has(articleId)) liveNewsUnreadIds.add(articleId);
    });
    liveNewsUnreadIds = new Set([...liveNewsUnreadIds].filter(articleId => normalizedArticles.some(article => String(article._id) === articleId)));
    if(hasNewItem) liveNewsHasUnread = true;
    liveNewsBootstrapped = true;
    liveNewsCache = normalizedArticles;
    renderLiveNewsTicker();
    updatePresseLiveToggleUI();
});

bindProductEnhancementInputs();
restoreFeedDraft();

// ==================== ACTUALITÉS ====================
function updateActuAdminForm() {
    const form = document.getElementById('actu-admin-form');
    if(form) { if(IS_ADMIN) form.classList.remove('hidden'); else form.classList.add('hidden'); }
    const dateInput = document.getElementById('actuDate');
    if(dateInput) { dateInput.max = new Date().toISOString().split('T')[0]; }
}
function loadActualites() { actuRequestPending = true; socket.emit('request_events'); }
function submitEvent() {
    const dateRaw = document.getElementById('actuDate').value;
    const heure = document.getElementById('actuHeure').value;
    const minuteEl = document.getElementById('actuMinute');
    const minute = minuteEl ? minuteEl.value : '00';
    const evenement = document.getElementById('actuEvenement').value.trim();
    if(!evenement) return;
    // Bloquer les dates dans le futur
    if(dateRaw) {
        const today = new Date(); today.setHours(23,59,59,999);
        const sel = new Date(dateRaw + 'T23:59:59');
        if(sel > today) return alert('Impossible de planifier un événement dans le futur.');
    }
    const heureFormatted = heure ? `${heure}h${minute}` : '';
    let dateFormatted = dateRaw;
    if(dateRaw) {
        const d = new Date(dateRaw + 'T12:00:00');
        if(!isNaN(d)) dateFormatted = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
    }
    socket.emit('create_event', { jour: '', date: dateFormatted, heure: heureFormatted, evenement });
    document.getElementById('actuDate').value = '';
    document.getElementById('actuHeure').value = '';
    if(minuteEl) minuteEl.value = '00';
    document.getElementById('actuEvenement').value = '';
}
function deleteEvent(id) { if(confirm('Supprimer cet événement ?')) socket.emit('delete_event', id); }

socket.on('events_data', (events) => {
    // Show notification badge if this is a real-time push (not our own request)
    if (!actuRequestPending && currentView !== 'actualites') {
        const badge = document.getElementById('actu-badge');
        if(badge) badge.classList.remove('hidden');
        const btn = document.getElementById('btn-view-actualites');
        if(btn) btn.classList.add('nav-notify');
    }
    actuRequestPending = false;

    const c = document.getElementById('events-list'); if(!c) return;
    c.innerHTML = '';
    if(events.length === 0) {
        c.innerHTML = '<div class="actu-empty"><i class="fa-solid fa-calendar-xmark"></i><p>Aucun événement planifié.</p></div>';
        return;
    }
    // Sort: futurs/aujourd'hui en premier (asc = le plus proche d'abord), puis passé (desc = le plus récent d'abord)
    const parseEventDate = (d) => {
        if(!d) return 0;
        const p = d.split('/');
        if(p.length === 3) return new Date(p[2]+'-'+p[1]+'-'+p[0]).getTime();
        return new Date(d).getTime() || 0;
    };
    const todayMs = new Date(new Date().toDateString()).getTime();
    const futureEvts = events.filter(e => parseEventDate(e.date) >= todayMs);
    const pastEvts   = events.filter(e => parseEventDate(e.date) <  todayMs);
    futureEvts.sort((a, b) => { const d = parseEventDate(a.date)-parseEventDate(b.date); return d !== 0 ? d : (a.heure||'').localeCompare(b.heure||''); });
    pastEvts.sort((a, b) => { const d = parseEventDate(b.date)-parseEventDate(a.date); return d !== 0 ? d : (b.heure||'').localeCompare(a.heure||''); });
    const sortedEvents = [...futureEvts, ...pastEvts];
    eventsCache = sortedEvents.slice(0, 10);
    if(currentView === 'accueil') renderAccueil();
    buildAdminConsoleOverview();
    let lastDate = null;
    sortedEvents.forEach(ev => {
        if(ev.date !== lastDate) {
            lastDate = ev.date;
            c.innerHTML += `<div class="actu-date-header"><span>${ev.jour ? ev.jour + ' · ' : ''}${ev.date}</span></div>`;
        }
        const delBtn = IS_ADMIN ? `<button class="actu-del-btn" onclick="deleteEvent('${ev._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
        c.innerHTML += `
            <div class="actu-event-item">
                <div class="actu-time">${ev.heure || '—'}</div>
                <div class="actu-dot-line"><div class="actu-dot"></div><div class="actu-line"></div></div>
                <div class="actu-event-body">
                    <span class="actu-event-text">${escapeHtml(ev.evenement)}</span>
                    ${delBtn}
                </div>
            </div>`;
    });
});

// ==================== BANDEAU D'ALERTE GLOBAL [NOUVEAU] ====================
socket.on('alert_data', (alert) => {
    const banner = document.getElementById('global-alert-banner');
    if(!banner) return;
    document.getElementById('global-alert-text').textContent = alert.message;
    banner.className = `global-alert-banner alert-${alert.color}`;
    banner.classList.remove('hidden');
    document.body.setAttribute('data-alert', alert.color);
    buildAdminConsoleOverview();
});
socket.on('alert_cleared', () => {
    const banner = document.getElementById('global-alert-banner');
    if(banner) banner.classList.add('hidden');
    document.body.removeAttribute('data-alert');
    buildAdminConsoleOverview();
});
function dismissAlert() { document.getElementById('global-alert-banner').classList.add('hidden'); }

let selectedAlertColor = 'red';
function selectAlertColor(color) {
    selectedAlertColor = color;
    document.getElementById('alertColor').value = color;
    document.querySelectorAll('.alert-color-btn').forEach(b => b.classList.remove('active-alert-btn'));
    const btn = document.querySelector(`.alert-color-btn[data-color="${color}"]`);
    if(btn) btn.classList.add('active-alert-btn');
}
function submitAlert(active) {
    const message = document.getElementById('alertMessage').value.trim();
    socket.emit('admin_set_alert', { message, color: selectedAlertColor, active });
    document.getElementById('admin-alert-modal').classList.add('hidden');
}
function closeAdminAlertModal() { document.getElementById('admin-alert-modal').classList.add('hidden'); }

// [FIX] La logique admin-alert est désormais directement dans openUserSettingsModal ci-dessus

// ==================== CAPITAL ADMIN [NOUVEAU] ====================
function adminEditCapital(charId, currentCapital) {
    if(!IS_ADMIN) return;
    const val = prompt(`Capital actuel : ${Number(currentCapital).toLocaleString('fr-FR')} crédits\nNouveau capital :`, currentCapital);
    if(val !== null && !isNaN(parseFloat(val))) {
        socket.emit('admin_edit_capital', { charId, capital: parseFloat(val) });
    }
}

// ==================== MESSAGES CRYPTÉS [NOUVEAU] ====================
function simpleEncrypt(text, password) {
    let result = '';
    for(let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
    }
    return btoa(unescape(encodeURIComponent(result)));
}
function simpleDecrypt(encoded, password) {
    try {
        const text = decodeURIComponent(escape(atob(encoded)));
        let result = '';
        for(let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
        }
        return result;
    } catch(e) { return null; }
}
function generateGlitch(text) {
    const glitchChars = '▓█▒░⣿⣶⣤⣀◆◇■□▪▫';
    return text.split('').map(() => glitchChars[Math.floor(Math.random() * glitchChars.length)]).join('');
}
function openCryptoModal() {
    if(!currentSelectedChar) return alert("Sélectionnez un personnage d'abord.");
    document.getElementById('cryptoContent').value = '';
    document.getElementById('cryptoPassword').value = '';
    document.getElementById('crypto-modal').classList.remove('hidden');
}
function closeCryptoModal() { document.getElementById('crypto-modal').classList.add('hidden'); }
function sendCryptoMessage() {
    const content = document.getElementById('cryptoContent').value.trim();
    const password = document.getElementById('cryptoPassword').value.trim();
    if(!content) return alert("Message vide.");
    if(!password) return alert("Mot de passe requis.");
    if(!currentSelectedChar) return alert("Perso requis !");
    const encrypted = simpleEncrypt(content, password);
    const glitch = generateGlitch(content.substring(0, 25));
    const payload = `[CRYPTO]${encrypted}|${glitch}[/CRYPTO]`;
    const baseMsg = { 
        senderName: currentSelectedChar.name, senderColor: currentSelectedChar.color || "#fff", 
        senderAvatar: currentSelectedChar.avatar, senderRole: currentSelectedChar.role, 
        partyName: currentSelectedChar.partyName || null, partyLogo: currentSelectedChar.partyLogo || null, 
        ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, 
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: null 
    };
    socket.emit('message_rp', { ...baseMsg, content: payload, type: 'text' });
    closeCryptoModal();
}
function openDecryptModal(msgId, encryptedData) {
    document.getElementById('decryptMsgId').value = encryptedData;
    document.getElementById('decryptPassword').value = '';
    document.getElementById('decryptResult').innerHTML = '';
    document.getElementById('decrypt-modal').classList.remove('hidden');
}
function closeDecryptModal() { document.getElementById('decrypt-modal').classList.add('hidden'); }
function tryDecrypt() {
    const password = document.getElementById('decryptPassword').value.trim();
    const encrypted = document.getElementById('decryptMsgId').value;
    if(!password) return;
    const result = simpleDecrypt(encrypted, password);
    const resultEl = document.getElementById('decryptResult');
    if(result && result.length > 0) {
        resultEl.innerHTML = `<div style="background:var(--accent-muted);border:1px solid var(--accent);padding:10px;border-radius:var(--radius-sm);margin-top:8px;"><i class="fa-solid fa-unlock" style="color:var(--accent);"></i> <strong>Déchiffré :</strong><br>${escapeHtml(result)}</div>`;
    } else {
        resultEl.innerHTML = `<div style="color:var(--danger);margin-top:8px;"><i class="fa-solid fa-lock"></i> Mot de passe incorrect.</div>`;
    }
}

// ==================== CRÉATION PERSO — ENTREPRISES [NOUVEAU] ====================
let newCharCompanies = [];
async function addCompanyToNewChar() {
    const name = document.getElementById('newCompanyName').value.trim();
    const role = document.getElementById('newCompanyRole').value.trim();
    const logoFile = document.getElementById('newCompanyLogoFile').files[0];
    if(!name) return;
    let logo = null;
    if(logoFile) logo = await uploadToCloudinary(logoFile);
    newCharCompanies.push({ name, role: role || '', logo, description: '' });
    renderNewCharCompanies();
    document.getElementById('newCompanyName').value = '';
    document.getElementById('newCompanyRole').value = '';
    document.getElementById('newCompanyLogoFile').value = '';
}
function renderNewCharCompanies() {
    const list = document.getElementById('newCharCompaniesList');
    if(!list) return;
    list.innerHTML = newCharCompanies.map((co, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-tertiary);border-radius:var(--radius-sm);margin-bottom:5px;border:1px solid var(--border);">
            ${co.logo ? `<img src="${co.logo}" style="width:22px;height:22px;border-radius:4px;object-fit:cover;">` : '<i class="fa-solid fa-building" style="color:var(--text-muted);"></i>'}
            <span style="flex:1;font-size:0.82rem;font-weight:600;">${co.name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${co.role}</span>
            <button onclick="removeNewCharCompany(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');
}
function removeNewCharCompany(i) { newCharCompanies.splice(i, 1); renderNewCharCompanies(); }

// [NOUVEAU] Entreprises dans modification
let editCharCompanies = [];
async function addCompanyToEditChar() {
    const name = document.getElementById('editCompanyName').value.trim();
    const role = document.getElementById('editCompanyRole').value.trim();
    const logoFile = document.getElementById('editCompanyLogoFile').files[0];
    if(!name) return;
    let logo = null;
    if(logoFile) logo = await uploadToCloudinary(logoFile);
    editCharCompanies.push({ name, role: role || '', logo, description: '' });
    renderEditCharCompanies();
    document.getElementById('editCompanyName').value = '';
    document.getElementById('editCompanyRole').value = '';
    document.getElementById('editCompanyLogoFile').value = '';
}
function renderEditCharCompanies() {
    const list = document.getElementById('editCharCompaniesList');
    if(!list) return;
    list.innerHTML = editCharCompanies.map((co, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-tertiary);border-radius:var(--radius-sm);margin-bottom:5px;border:1px solid var(--border);">
            ${co.logo ? `<img src="${co.logo}" style="width:22px;height:22px;border-radius:4px;object-fit:cover;">` : '<i class="fa-solid fa-building" style="color:var(--text-muted);"></i>'}
            <span style="flex:1;font-size:0.82rem;font-weight:600;">${co.name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${co.role}</span>
            <button onclick="removeEditCharCompany(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');
}
function removeEditCharCompany(i) { editCharCompanies.splice(i, 1); renderEditCharCompanies(); }

// ==================== [MES PERSONNAGES] ====================
function openAdminFromMesPersos(target) {
    if(!IS_ADMIN) return;
    if(target === 'alert') {
        document.getElementById('admin-alert-modal')?.classList.remove('hidden');
        return;
    }
    switchView(target);
}

function refreshAdminQuickData() {
    if(!IS_ADMIN) return;
    socket.emit('request_feed');
    socket.emit('request_presse');
    socket.emit('request_events');
    socket.emit('request_stocks');
}

function renderMesPersos() {
    const adminPanel = document.getElementById('mes-persos-admin-panel');
    const adminStats = document.getElementById('mp-admin-stats');
    if(adminPanel) {
        if(IS_ADMIN) {
            adminPanel.classList.remove('hidden');
            if(adminStats) {
                adminStats.innerHTML = `
                    <span><i class="fa-solid fa-people-group"></i> ${myCharacters.length} persos</span>
                    <span><i class="fa-solid fa-newspaper"></i> ${presseArticlesCache.length} articles</span>
                    <span><i class="fa-solid fa-chart-line"></i> ${stocksData.length} actions</span>
                    <span><i class="fa-solid fa-calendar-days"></i> ${eventsCache.length} actus</span>`;
            }
        } else {
            adminPanel.classList.add('hidden');
        }
    }

    const container = document.getElementById('mes-persos-list');
    if(!container) return;
    if(!myCharacters.length) {
        container.innerHTML = `<div class="mp-empty"><i class="fa-solid fa-user-slash"></i><p>Aucun personnage créé.</p><button class="btn-primary" onclick="openCharModal('create')"><i class="fa-solid fa-plus"></i> Créer un personnage</button></div>`;
        return;
    }
    container.innerHTML = '';
    myCharacters.forEach(char => {
        const card = document.createElement('div');
        card.className = 'mp-char-card';
        card.style.borderLeft = `4px solid ${char.color || 'var(--accent)'}`;
        const companies = char.companies || [];
        let compHTML = '';
        if (companies.length > 0) {
            const first = companies[0];
            compHTML = `<div class="mp-company-item">
                <div class="mp-company-logo-wrap">${first.logo ? `<img src="${first.logo}" class="mp-company-logo">` : '<i class="fa-solid fa-building"></i>'}</div>
                <div>
                    <div class="mp-company-name">${escapeHtml(first.name)}</div>
                    <div class="mp-company-role">${escapeHtml(first.role || '')}</div>
                    ${first.headquarters ? `<div class="mp-company-hq"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(first.headquarters)}</div>` : ''}
                    ${(first.revenue||0) > 0 ? `<div class="mp-company-revenue"><i class="fa-solid fa-coins"></i> CA : ${formatStockValue(first.revenue)}</div>` : ''}
                </div>
            </div>`;
            if (companies.length > 1) compHTML += `<div class="mp-companies-more">et ${companies.length - 1} autre${companies.length - 1 > 1 ? 's' : ''}</div>`;
        }
        const partyHTML = char.partyName ? `<div class="mp-char-party">${char.partyLogo ? `<img src="${char.partyLogo}" class="party-logo" style="width:14px;height:14px;">` : ''} ${escapeHtml(char.partyName)}</div>` : '';
        card.innerHTML = `
            <div class="mp-char-header">
                <img src="${char.avatar}" class="mp-char-avatar" onclick="openProfile('${char.name.replace(/'/g, "\\'")}')">
                <div class="mp-char-info">
                    <div class="mp-char-name" style="color:${char.color || 'white'}">${escapeHtml(char.name)}</div>
                    <div class="mp-char-role">${escapeHtml(char.role)}</div>
                    ${partyHTML}
                    ${char.description ? `<div class="mp-char-desc">${escapeHtml(char.description)}</div>` : ''}
                </div>
                <div class="mp-char-actions">
                    <button onclick="openProfile('${char.name.replace(/'/g, "\\'")}');" class="btn-mini-action" title="Profil"><i class="fa-solid fa-user"></i></button>
                    <button onclick="prepareEditCharacter('${char._id}')" class="btn-mini-action" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteCharacter('${char._id}')" class="btn-mini-action" title="Supprimer" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="mp-char-stats">
                <div class="mp-stat"><span>${getFollowerCountLabel(char)}</span><span>Abonnés</span></div>
                <div class="mp-stat"><span>${char.capital ? formatStockValue(char.capital) : '0'}</span><span>Capital</span></div>
                <div class="mp-stat"><span>${companies.length}</span><span>Entreprise${companies.length !== 1 ? 's' : ''}</span></div>
            </div>
            ${companies.length ? `<div class="mp-char-companies"><div class="mp-section-label"><i class="fa-solid fa-building"></i> Entreprises</div><div class="mp-companies-list">${compHTML}</div></div>` : ''}
        `;
        container.appendChild(card);
    });
}

// ==================== [PUB BOOST] ====================
// Voir plus pour les bios
function setBioWithVoirPlus(elementId, text) {
    const el = document.getElementById(elementId);
    if(!el) return;
    el.innerHTML = '';
    if(!text) { el.textContent = 'Aucune description.'; return; }
    const MAX_CHARS = 240;
    if(text.length <= MAX_CHARS) { el.textContent = text; return; }
    const shortSpan = document.createElement('span');
    shortSpan.textContent = text.slice(0, MAX_CHARS);
    const dotsSpan = document.createElement('span');
    dotsSpan.textContent = '…';
    const fullSpan = document.createElement('span');
    fullSpan.style.display = 'none';
    fullSpan.textContent = text;
    const btn = document.createElement('button');
    btn.className = 'bio-voir-plus-btn';
    btn.textContent = 'Voir plus';
    btn.onclick = () => {
        const isExpanded = fullSpan.style.display !== 'none';
        shortSpan.style.display = isExpanded ? 'inline' : 'none';
        dotsSpan.style.display = isExpanded ? 'inline' : 'none';
        fullSpan.style.display = isExpanded ? 'none' : 'inline';
        btn.textContent = isExpanded ? 'Voir plus' : 'Voir moins';
    };
    el.appendChild(shortSpan);
    el.appendChild(dotsSpan);
    el.appendChild(fullSpan);
    el.appendChild(document.createElement('br'));
    el.appendChild(btn);
}

function adminSetCompanyRevenue(charId, companyName, currentRevenue) {
    if(!IS_ADMIN) return;
    const val = prompt(`Chiffre d'affaires — "${companyName}"\nActuel : ${Number(currentRevenue).toLocaleString('fr-FR')} cr\n\nNouveau CA :`, currentRevenue);
    if(val !== null && !isNaN(parseFloat(val))) {
        socket.emit('admin_set_company_revenue', { charId, companyName, revenue: parseFloat(val) });
    }
}

// ==================== [ACCUEIL] ====================
function renderAccueil() {
    syncAccueilTimelineUI();
    renderAccueilQuickActions();
    renderAccueilRecents();
    renderAccueilFavorites();
    // Article a la une
    const headlinePrev = document.getElementById('accueil-headline-preview');
    if(headlinePrev) {
        if(presseArticlesCache.length) {
            const headline = presseArticlesCache.find(a => a.isHeadline) || presseArticlesCache[0];
            const { titleText } = parseArticleContent(headline.content || '');
            const excerpt = getArticleExcerpt(headline.content || '', 180);
            headlinePrev.innerHTML = `
                <div onclick="openArticleFullscreen('${headline._id}')">
                    <span class="accueil-headline-tag"><i class="fa-solid fa-star"></i> La Une</span>
                    <h3 class="accueil-headline-item-title">${escapeHtml(titleText)}</h3>
                    <p class="accueil-headline-item-excerpt">${escapeHtml(excerpt)}</p>
                    <div class="accueil-headline-item-meta">
                        <span class="accueil-headline-item-author"><i class="fa-solid fa-feather-pointed"></i> ${escapeHtml(headline.authorName || 'Redaction')}</span>
                        <span>${escapeHtml(headline.date || '')}</span>
                    </div>
                </div>`;
        } else {
            headlinePrev.innerHTML = '<div class="accueil-headline-empty">Aucun article pour le moment.</div>';
        }
    }

    renderWorldTimeline();

    // Derniers posts
    const feedPrev = document.getElementById('accueil-feed-preview');
    if(feedPrev) {
        if(feedPostsCache.length) {
            feedPrev.innerHTML = feedPostsCache.slice(0, 6).map(p => {
                const name = p.isAnonymous ? 'Anonyme' : escapeHtml(p.authorName);
                const rawText = (p.content||'').replace(/\[TITRE\](.*?)\[\/TITRE\]\n?/, '$1 — ');
                const text = rawText.slice(0, 90);
                const avatarSrc = p.isAnonymous ? '' : p.authorAvatar;
                return `<div class="accueil-post-item" onclick="openTimelineTarget('feed', { postId: '${p._id}' })">
                    ${avatarSrc ? `<img src="${avatarSrc}" class="accueil-post-avatar" onerror="this.style.opacity=0">` : `<span class="accueil-post-avatar" style="background:var(--bg-tertiary);display:inline-flex;align-items:center;justify-content:center;font-size:0.8rem;color:var(--text-dim);flex-shrink:0;border-radius:50%;">?</span>`}
                    <div class="accueil-post-meta">
                        <span class="accueil-post-author" style="color:${p.isAnonymous?'#888':p.authorColor||'white'}">${name}</span>
                        <span class="accueil-post-content">${escapeHtml(text)}${rawText.length > 90 ? '…' : ''}</span>
                    </div>
                    <span class="accueil-post-date">${p.date}</span>
                </div>`;
            }).join('');
        } else {
            feedPrev.innerHTML = '<div class="accueil-widget-empty">Chargement…</div>';
        }
    }
    // Prochains événements
    const eventsPrev = document.getElementById('accueil-events-preview');
    if(eventsPrev) {
        if(eventsCache.length) {
            eventsPrev.innerHTML = eventsCache.slice(0, 5).map(ev => `
                <div class="accueil-event-item" onclick="switchView('actualites')">
                    ${ev.date ? `<div class="accueil-event-date">${ev.jour ? ev.jour+' · ' : ''}${ev.date}</div>` : ''}
                    <div class="accueil-event-main">
                        <span class="accueil-event-time">${ev.heure || ''}</span>
                        <span class="accueil-event-text">${escapeHtml(ev.evenement)}</span>
                    </div>
                </div>`).join('');
        } else {
            eventsPrev.innerHTML = '<div class="accueil-widget-empty">Aucun événement.</div>';
        }
    }
    // Bourse Top 5
    const stocksPrev = document.getElementById('accueil-stocks-preview');
    if(stocksPrev) {
        if(stocksData.length) {
            const top5 = [...stocksData].sort((a,b) => b.currentValue - a.currentValue).slice(0, 5);
            stocksPrev.innerHTML = top5.map(s => {
                const hist = s.history || [];
                const prev = hist.length >= 2 ? hist[hist.length-2].value : s.currentValue;
                const pct = prev ? ((s.currentValue - prev)/prev*100) : 0;
                const col = pct > 0 ? '#23a559' : pct < 0 ? '#da373c' : '#888';
                return `<div class="accueil-stock-item" onclick="switchView('bourse'); setTimeout(() => openStockDetail('${s._id}'), 90);">
                    ${s.companyLogo ? `<img src="${s.companyLogo}" class="accueil-stock-logo">` : `<span class="accueil-stock-icon"><i class="fa-solid fa-building"></i></span>`}
                    <div class="accueil-stock-info">
                        <span class="accueil-stock-name">${escapeHtml(s.companyName)}</span>
                        <span class="accueil-stock-char">${escapeHtml(s.charName||'')}</span>
                    </div>
                    <div class="accueil-stock-val-wrap">
                        <span class="accueil-stock-val">${formatStockValue(s.currentValue)}</span>
                        <span class="accueil-stock-pct" style="color:${col}">${pct>=0?'▲':'▼'} ${Math.abs(pct).toFixed(2)}%</span>
                    </div>
                </div>`;
            }).join('');
        } else {
            stocksPrev.innerHTML = '<div class="accueil-widget-empty">Aucune donnée bourse.</div>';
        }
    }
    // Mes personnages
    const charsPrev = document.getElementById('accueil-chars-preview');
    if(charsPrev) {
        if(myCharacters.length) {
            charsPrev.innerHTML = myCharacters.map(c =>
                `<div class="accueil-char-item" onclick="openProfile('${c.name.replace(/'/g,"\\'")}')">
                    <img src="${c.avatar}" class="accueil-char-avatar" style="border-color:${c.color||'var(--accent)'}">
                    <div class="accueil-char-info">
                        <span class="accueil-char-name" style="color:${c.color||'white'}">${escapeHtml(c.name)}</span>
                        <span class="accueil-char-role">${escapeHtml(c.role||'')}</span>
                    </div>
                    ${c.capital > 0 ? `<span class="accueil-char-capital">${formatStockValue(c.capital)}</span>` : ''}
                </div>`
            ).join('');
        } else {
            charsPrev.innerHTML = `<div class="accueil-widget-empty">Aucun personnage. <button class="btn-primary" onclick="openCharModal('create')" style="font-size:0.73rem;padding:4px 10px;margin-left:6px;"><i class="fa-solid fa-plus"></i> Créer</button></div>`;
        }
    }
}

function ensurePubStockOptionsLoaded() {
    if(stocksData.length) {
        populatePubStockSelects();
        return;
    }
    ['postPubStockId', 'pressePubStockId'].forEach(selId => {
        const sel = document.getElementById(selId);
        if(!sel) return;
        sel.innerHTML = '<option value="">Chargement des entreprises...</option>';
    });
    socket.emit('request_stocks');
}

function toggleFeedPubSelect() {
    const cb = document.getElementById('postIsPub');
    const wrap = document.getElementById('feed-pub-stock-wrap');
    if(wrap) wrap.classList.toggle('hidden', !cb?.checked);
    if(cb?.checked) ensurePubStockOptionsLoaded();
}
function togglePressePubSelect() {
    const cb = document.getElementById('presseIsPub');
    const wrap = document.getElementById('presse-pub-stock-wrap');
    if(wrap) wrap.classList.toggle('hidden', !cb?.checked);
    if(cb?.checked) ensurePubStockOptionsLoaded();
}
function populatePubStockSelects() {
    ['postPubStockId', 'pressePubStockId'].forEach(selId => {
        const sel = document.getElementById(selId);
        if(!sel) return;
        const cur = sel.value;
        sel.innerHTML = stocksData.length
            ? '<option value="">— Choisir une entreprise —</option>'
            : '<option value="">Aucune entreprise disponible</option>';
        stocksData.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s._id;
            opt.textContent = s.companyName;
            sel.appendChild(opt);
        });
        if(cur) sel.value = cur;
    });
}

// ==================== [CITÉS] SYSTÈME GÉOPOLITIQUE ====================

let citiesData = [];      // cache local
let currentCityId = null; // cité ouverte dans le panneau
let prevEdcRanks = {};    // cityId → rang EDC (pour les flèches)
let prevPopRanks = {};    // cityId → rang Population

// --- Formatage abrégé (cartes + stats) ---
// EDC : en MMd (milliers de milliards = 10^12) ou Md (milliards = 10^9)
function formatEDC(value) {
    if(value == null) return '—';
    const abs = Math.abs(value);
    if(abs >= 1e15)       return `${(value/1e15).toLocaleString('fr-FR',{maximumFractionDigits:2})} Qd`;   // quadrillions
    if(abs >= 1e12)       return `${(value/1e12).toLocaleString('fr-FR',{maximumFractionDigits:2})} MMd`;  // milliers de milliards
    if(abs >= 1e9)        return `${(value/1e9).toLocaleString('fr-FR',{maximumFractionDigits:2})} Md`;    // milliards
    if(abs >= 1e6)        return `${(value/1e6).toLocaleString('fr-FR',{maximumFractionDigits:2})} M`;     // millions
    return value.toLocaleString('fr-FR', {maximumFractionDigits:0});
}

// EDC valeur entière complète (panneau de détail)
function formatEDCFull(value) {
    if(value == null) return '—';
    return Math.round(value).toLocaleString('fr-FR');
}

// Population avec abréviations : 175 100 000 → 175,1 M
function formatPop(value) {
    if(value == null) return '—';
    const abs = Math.abs(value);
    if(abs >= 1e9)  return `${(value/1e9).toLocaleString('fr-FR',{maximumFractionDigits:2})} Md`;
    if(abs >= 1e6)  return `${(value/1e6).toLocaleString('fr-FR',{maximumFractionDigits:1})} M`;
    if(abs >= 1e3)  return `${(value/1e3).toLocaleString('fr-FR',{maximumFractionDigits:1})} k`;
    return Math.round(value).toLocaleString('fr-FR');
}

function calcEDCEvolution(historyEDC) {
    if(!historyEDC || historyEDC.length < 2) return null;
    const recent = historyEDC.slice(-7);
    const oldest = recent[0].value;
    const newest = recent[recent.length - 1].value;
    if(!oldest) return null;
    return ((newest - oldest) / oldest) * 100;
}

function trendLabel(trend) {
    return { croissance_forte:'📈 Croissance Forte', croissance:'↗ Croissance', stable:'→ Stable', baisse:'↘ Baisse', chute:'📉 Chute Libre' }[trend] || '→ Stable';
}
function trendClass(trend) {
    if(!trend || trend === 'stable') return 'trend-neutral';
    if(trend === 'croissance_forte' || trend === 'croissance') return 'trend-positive';
    return 'trend-negative';
}

// --- Charger ---
function loadCities() { socket.emit('request_cities'); }

socket.on('cities_data', (cities) => {
    citiesData = cities;
    renderCitiesGrid(cities);
    renderCitiesRankings(cities);
    populateDiploFilters();
    if(currentCityId) {
        const updated = cities.find(c => c._id === currentCityId);
        if(updated) renderCityDetailContent(updated);
    }
});

// --- Grille ---
function renderCitiesGrid(cities) {
    const container = document.getElementById('cites-grid-container');
    if(!container) return;
    container.innerHTML = '';
    const ARCHIPORDER = ['Archipel Pacifique', 'Ancienne Archipel', 'Archipel Sableuse'];
    const groups = {};
    cities.forEach(c => { if(!groups[c.archipel]) groups[c.archipel] = []; groups[c.archipel].push(c); });

    ARCHIPORDER.forEach(archip => {
        const group = groups[archip]; if(!group || !group.length) return;
        const section = document.createElement('div');
        section.className = 'cites-section';
        section.innerHTML = `<div class="cites-section-title">${archip}</div>`;
        const grid = document.createElement('div');
        grid.className = 'cites-grid';

        group.forEach(city => {
            const evol = calcEDCEvolution(city.historyEDC);
            const evolHTML = evol !== null
                ? `<span class="city-card-evol ${evol >= 0 ? 'evol-pos' : 'evol-neg'}">${evol >= 0 ? '▲ +' : '▼ '}${evol.toFixed(1)}%</span>`
                : '';
            const flagHTML = city.flag ? `<img src="${city.flag}" class="city-card-flag" alt="drapeau">` : '';
            const card = document.createElement('div');
            card.className = `city-card ${trendClass(city.trend)}`;
            card.onclick = () => openCityDetail(city);
            card.innerHTML = `
                ${flagHTML}
                <div class="city-card-name">${city.name}</div>
                <div class="city-card-edc-row">
                    <span class="city-card-edc-label">EDC</span>
                    <span class="city-card-edc-value">${formatEDC(city.baseEDC)}</span>
                    ${evolHTML}
                </div>
                <div class="city-card-pop"><i class="fa-solid fa-users"></i> ${formatPop(city.population)}</div>
                <div class="city-card-trend ${trendClass(city.trend)}">${trendLabel(city.trend)}</div>`;
            grid.appendChild(card);
        });
        section.appendChild(grid);
        container.appendChild(section);
    });
}

// --- Panneau détail ---
function openCityDetail(city) {
    addRecentActivity({ type: 'city', id: city._id, label: city.name, meta: city.archipel || 'Cité' });
    currentCityId = city._id;
    document.getElementById('city-detail-overlay').classList.remove('hidden');
    document.getElementById('city-detail-overlay').onclick = closeCityDetail;
    document.getElementById('city-detail-panel').classList.add('open');
    renderCityDetailContent(city);
}

function openCityDetailById(cityId) {
    const city = citiesData.find(item => String(item._id) === String(cityId));
    if(city) openCityDetail(city);
}

function openDiplomacyForCity(cityId) {
    switchView('cites');
    switchCitesTab('diplo');
    const scopeSel = document.getElementById('diplo-filter-scope');
    if(scopeSel) scopeSel.value = 'city';
    populateDiploFilters();
    const entitySel = document.getElementById('diplo-filter-entity');
    if(entitySel) entitySel.value = String(cityId);
    renderDiplomacy();
}

function getCityRelatedEntries(city) {
    const searchParts = [city?.name, city?.capitale, city?.archipel]
        .filter(Boolean)
        .map(value => String(value).toLowerCase());
    const matchesCityText = value => {
        const text = String(value || '').toLowerCase();
        return searchParts.some(part => part && text.includes(part));
    };

    return {
        relatedPosts: feedPostsCache.filter(post => matchesCityText([post.content, post.authorRole, post.linkedCompanyName].filter(Boolean).join(' '))).slice(0, 4),
        relatedArticles: presseArticlesCache.filter(article => matchesCityText([article.content, article.journalName, article.authorRole].filter(Boolean).join(' '))).slice(0, 4),
        relatedTimeline: worldTimelineCache.filter(item => matchesCityText([item.title, item.summary].filter(Boolean).join(' '))).slice(0, 4),
        relatedRelations: cityRelationsData.filter(rel => (rel.relationScope || 'city') === 'city').filter(rel => String(rel.cityA?._id) === String(city._id) || String(rel.cityB?._id) === String(city._id)).slice(0, 4)
    };
}

function renderCityConnections(city) {
    const linksSection = document.getElementById('cityDetailModuleLinks');
    const relatedSection = document.getElementById('cityDetailRelated');
    if(!linksSection || !relatedSection) return;

    const { relatedPosts, relatedArticles, relatedTimeline, relatedRelations } = getCityRelatedEntries(city);
    linksSection.innerHTML = `
        <button class="city-link-card module-reseau" onclick="${relatedPosts.length ? `openTimelineTarget('feed', { postId: '${relatedPosts[0]._id}' })` : `switchView('feed')`}"><span>Réseau</span><strong>Voir les posts liés</strong></button>
        <button class="city-link-card module-presse" onclick="switchView('presse')"><span>Presse</span><strong>Voir la couverture liée</strong></button>
        <button class="city-link-card module-cites" onclick="openDiplomacyForCity('${city._id}')"><span>Diplomatie</span><strong>Ouvrir la fiche diplomatique</strong></button>
        <button class="city-link-card module-map" onclick="switchView('map')"><span>Map</span><strong>Retour à la carte</strong></button>`;

    relatedSection.innerHTML = `
        <div class="city-related-card">
            <div class="city-related-card-head module-reseau"><span>Réseau</span><strong>${relatedPosts.length}</strong></div>
            ${relatedPosts.length ? relatedPosts.map(post => `<button class="city-related-item" onclick="openTimelineTarget('feed', { postId: '${post._id}' })"><span>${escapeHtml(post.authorName || 'Source')}</span><strong>${escapeHtml(extractTextPreview(post.content || '', 88))}</strong></button>`).join('') : '<div class="city-related-empty">Aucun post lié.</div>'}
        </div>
        <div class="city-related-card">
            <div class="city-related-card-head module-presse"><span>Presse</span><strong>${relatedArticles.length}</strong></div>
            ${relatedArticles.length ? relatedArticles.map(article => `<button class="city-related-item" onclick="openArticleFullscreen('${article._id}')"><span>${escapeHtml(article.journalName || 'Presse')}</span><strong>${escapeHtml(extractArticleTitle(article.content || ''))}</strong></button>`).join('') : '<div class="city-related-empty">Aucun article lié.</div>'}
        </div>
        <div class="city-related-card">
            <div class="city-related-card-head module-cites"><span>Diplomatie</span><strong>${relatedRelations.length}</strong></div>
            ${relatedRelations.length ? relatedRelations.map(rel => {
                const otherCity = String(rel.cityA?._id) === String(city._id) ? rel.cityB : rel.cityA;
                return `<button class="city-related-item" onclick="openDiplomacyForCity('${city._id}')"><span>${escapeHtml(DIPLO_STATUS_META[rel.status]?.label || 'Relation')}</span><strong>${escapeHtml(otherCity?.name || 'Autre cité')}</strong></button>`;
            }).join('') : '<div class="city-related-empty">Aucune relation active.</div>'}
        </div>
        <div class="city-related-card">
            <div class="city-related-card-head module-map"><span>Monde</span><strong>${relatedTimeline.length}</strong></div>
            ${relatedTimeline.length ? relatedTimeline.map(item => `<button class="city-related-item" onclick="openTimelineTarget('${item.relatedView || 'cites'}', ${JSON.stringify(item.relatedData || { cityId: city._id }).replace(/"/g, '&quot;')})"><span>${escapeHtml(item.title || 'Signal')}</span><strong>${escapeHtml(item.summary || '')}</strong></button>`).join('') : '<div class="city-related-empty">Aucun signal monde.</div>'}
        </div>`;
}

function renderCityDetailContent(city) {
    // Hero
    document.getElementById('cityDetailName').textContent = city.name;
    document.getElementById('cityDetailArchipel').textContent = city.archipel;
    const heroEl = document.getElementById('cityDetailHero');
    heroEl.className = `city-hero city-hero-${trendClass(city.trend)}`;

    // Drapeau
    const flagEl = document.getElementById('cityDetailFlag');
    if(flagEl) { flagEl.src = city.flag || ''; flagEl.style.display = city.flag ? 'block' : 'none'; }

    // Stats
    document.getElementById('cityDetailPop').textContent = formatPop(city.population);
    // EDC : valeur abrégée + valeur entière en dessous
    const edcEl = document.getElementById('cityDetailEDC');
    edcEl.innerHTML = `${formatEDC(city.baseEDC)}<div class="city-edc-full">${formatEDCFull(city.baseEDC)}</div>`;
    document.getElementById('cityDetailPresident').textContent = city.president || 'Vacant';
    const trendEl = document.getElementById('cityDetailTrend');
    trendEl.textContent = trendLabel(city.trend);
    trendEl.className = `city-stat-value ${trendClass(city.trend)}`;

    // Capitale
    const capitaleEl = document.getElementById('cityDetailCapitale');
    if(capitaleEl) capitaleEl.textContent = city.capitale || 'Non définie';

    // Évolution 7j
    const evol = calcEDCEvolution(city.historyEDC);
    const evolEl = document.getElementById('cityDetailEvol');
    if(evol !== null) {
        evolEl.textContent = `${evol >= 0 ? '▲ +' : '▼ '}${evol.toFixed(2)}% sur 7 valeurs`;
        evolEl.className = `city-edc-evol ${evol >= 0 ? 'evol-pos' : 'evol-neg'}`;
    } else {
        evolEl.textContent = 'Données insuffisantes'; evolEl.className = 'city-edc-evol trend-neutral';
    }

    // Bar chart
    renderCityMiniChart(city.historyEDC);

    // Admin panel
    const adminPanel = document.getElementById('cityAdminPanel');
    if(IS_ADMIN) {
        adminPanel.classList.remove('hidden');
        document.getElementById('adminCityId').value = city._id;
        document.getElementById('adminCityPresident').value = city.president || '';
        document.getElementById('adminCityCapitale').value = city.capitale || '';
        document.getElementById('adminCityPop').value = city.population || '';
        document.getElementById('adminCityEDC').value = city.baseEDC || '';
        // Préview drapeau admin
        const prevFlag = document.getElementById('adminFlagPreview');
        if(prevFlag) { prevFlag.src = city.flag || ''; prevFlag.style.display = city.flag ? 'block' : 'none'; }
        // Reset save message
        const saveMsg = document.getElementById('cityAdminSaveMsg');
        if(saveMsg) saveMsg.classList.add('hidden');
        snapForm('cityAdminPanel');
    } else {
        adminPanel.classList.add('hidden');
    }

    renderCityConnections(city);
}

function closeCityDetail() {
    guardClose('cityAdminPanel', () => {
        document.getElementById('city-detail-overlay').classList.add('hidden');
        document.getElementById('city-detail-panel').classList.remove('open');
        currentCityId = null;
    });
}

function renderCityMiniChart(historyEDC) {
    const chart = document.getElementById('cityEDCChart');
    if(!chart) return;
    const data = (historyEDC || []).slice(-7);
    if(!data.length) { chart.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">Aucun historique.</span>'; return; }
    const maxVal = Math.max(...data.map(d => d.value));
    const minVal = Math.min(...data.map(d => d.value));
    const range = maxVal - minVal || 1;
    chart.style.overflow = 'visible';
    chart.innerHTML = data.map((d, i) => {
        const pct = Math.max(10, ((d.value - minVal) / range) * 100);
        const isLast = i === data.length - 1;
        const dateStr = d.date ? new Date(d.date).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'}) : `J-${data.length - 1 - i}`;
        return `<div class="chart-bar-wrap" data-value="${formatEDC(d.value)}" data-full="${formatEDCFull(d.value)}" data-date="${dateStr}">
            <div class="chart-bar ${isLast ? 'chart-bar-last' : ''}" style="height:${pct}%"></div>
            <div class="chart-bar-label">${dateStr}</div>
            <div class="chart-bar-tooltip">${formatEDC(d.value)}</div>
        </div>`;
    }).join('');
}

// --- Classements ---
function resetRankEvolutions() {
    prevEdcRanks = {};
    prevPopRanks = {};
    if(citiesData.length) renderCitiesRankings(citiesData);
    const btn = document.getElementById('btn-reset-rank-evol');
    if(btn) {
        btn.textContent = '\u2705 Réinitialisé';
        btn.style.color = '#23a559';
        setTimeout(() => { btn.textContent = '\u21ba Réinit. évolutions'; btn.style.color = ''; }, 2000);
    }
}

function renderCitiesRankings(cities) {
    const byEdc = [...cities].filter(c => c.baseEDC != null).sort((a, b) => b.baseEDC - a.baseEDC);
    const byPop = [...cities].filter(c => c.population != null).sort((a, b) => b.population - a.population);

    // Nouveaux rangs
    const newEdcRanks = {};
    byEdc.forEach((city, i) => { newEdcRanks[city._id] = i + 1; });
    const newPopRanks = {};
    byPop.forEach((city, i) => { newPopRanks[city._id] = i + 1; });

    function rankArrow(prevRanks, cityId, currentRank) {
        const prev = prevRanks[cityId];
        if(prev == null || prev === currentRank) return '';
        const diff = prev - currentRank;
        if(diff > 0) return `<span class="rank-arrow rank-up">▲ +${diff}</span>`;
        return `<span class="rank-arrow rank-down">▼ ${Math.abs(diff)}</span>`;
    }

    function rankNumClass(rank) {
        if(rank === 1) return 'rank-n1';
        if(rank === 2) return 'rank-n2';
        if(rank === 3) return 'rank-n3';
        return 'rank-n';
    }

    function buildRow(city, rank, prevRanks, valueHTML) {
        const flagHTML = city.flag ? `<img src="${city.flag}" class="rank-flag" alt="">` : '<span class="rank-flag-ph"></span>';
        const arrow = rankArrow(prevRanks, city._id, rank);
        return `<div class="rank-row" style="animation-delay:${rank * 0.04}s">
            <span class="rank-num ${rankNumClass(rank)}">${rank}</span>
            ${flagHTML}
            <span class="rank-name">${city.name}</span>
            ${arrow}
            <span class="rank-value">${valueHTML}</span>
        </div>`;
    }

    const edcEl = document.getElementById('ranking-edc');
    if(edcEl) edcEl.innerHTML = byEdc.length
        ? byEdc.map((city, i) => buildRow(city, i + 1, prevEdcRanks, formatEDC(city.baseEDC))).join('')
        : '<div class="rank-empty">Aucune donnée.</div>';

    const popEl = document.getElementById('ranking-pop');
    if(popEl) popEl.innerHTML = byPop.length
        ? byPop.map((city, i) => buildRow(city, i + 1, prevPopRanks, formatPop(city.population))).join('')
        : '<div class="rank-empty">Aucune donnée.</div>';

    // Mémoriser les rangs actuels pour la prochaine mise à jour
    prevEdcRanks = newEdcRanks;
    prevPopRanks = newPopRanks;
}

// --- Admin actions ---
function adminSaveCityInfo() {
    const id        = document.getElementById('adminCityId').value;
    const president = document.getElementById('adminCityPresident').value.trim() || null;
    const capitale  = document.getElementById('adminCityCapitale').value.trim() || null;
    const pop       = document.getElementById('adminCityPop').value;
    const edc       = document.getElementById('adminCityEDC').value;
    socket.emit('admin_update_city', {
        cityId: id,
        president,
        capitale,
        population: pop ? Number(pop) : null,
        baseEDC:    edc ? Number(edc) : null
    });
    snapForm('cityAdminPanel');
}

socket.on('city_save_success', () => {
    const msg = document.getElementById('cityAdminSaveMsg');
    if(msg) {
        msg.classList.remove('hidden');
        msg.style.animation = 'none';
        void msg.offsetWidth;
        msg.style.animation = 'fadeInUp 0.3s ease';
        clearTimeout(msg._hideTimer);
        msg._hideTimer = setTimeout(() => msg.classList.add('hidden'), 3000);
    }
});

function adminApplyTrend(trend) {
    const id = document.getElementById('adminCityId').value;
    if(!id) return;
    socket.emit('admin_update_city', { cityId: id, trend });
}

// Appliquer un pourcentage personnalisé (entre -100 et +100, décimales autorisées)
function adminApplyCustomPct() {
    const id  = document.getElementById('adminCityId').value;
    const pct = parseFloat(document.getElementById('adminCustomPct').value);
    if(!id) return;
    if(isNaN(pct) || pct < -100 || pct > 100) return alert('Entrez un pourcentage entre -100 et 100 (décimales acceptées).');
    socket.emit('admin_update_city', { cityId: id, customPct: pct });
}

// Upload drapeau (Cloudinary)
async function adminUploadFlag() {
    const input = document.getElementById('adminFlagFile');
    if(!input || !input.files || !input.files[0]) return alert('Choisissez une image.');
    const btn = document.getElementById('adminFlagUploadBtn');
    if(btn) btn.textContent = '⏳ Upload...';
    const url = await uploadToCloudinary(input.files[0]);
    if(btn) btn.textContent = '📤 Uploader';
    if(!url) return alert('Échec upload');
    const id = document.getElementById('adminCityId').value;
    const prevFlag = document.getElementById('adminFlagPreview');
    if(prevFlag) { prevFlag.src = url; prevFlag.style.display = 'block'; }
    socket.emit('admin_update_city', { cityId: id, flag: url });
    input.value = '';
}
// ==================== [FIN CITÉS] ====================

// ==================== [DIPLOMATIE] ====================
let cityRelationsData = [];
let politicalPartiesData = [];
let renderedDiplomacyRelationsCache = [];
let currentDiploTab = 'geo';
const expandedDiploAllianceIds = new Set();
const DIPLO_GROUPABLE_STATUSES = new Set(['allie', 'pacte_defensif', 'axe_economique', 'coalition_gouvernementale', 'coalition_electorale', 'soutien_strategique']);
const DIPLO_COLLECTIVE_CONFLICT_STATUSES = new Set(['tension', 'sanction', 'guerre_commerciale', 'blocus', 'hostile', 'contentieux_territorial', 'conflit_froid', 'insurrection_proxy', 'guerre']);

const DIPLO_STATUS_META = {
    allie:                     { label: 'Allié', icon: '🤝', tier: 0 },
    pacte_defensif:           { label: 'Pacte défensif', icon: '🛡️', tier: 1 },
    axe_economique:           { label: 'Axe économique', icon: '💹', tier: 2 },
    coalition_gouvernementale:{ label: 'Coalition gouvernementale', icon: '🏛️', tier: 3 },
    coalition_electorale:     { label: 'Coalition électorale', icon: '🗳️', tier: 4 },
    soutien_strategique:      { label: 'Soutien stratégique', icon: '🛰️', tier: 5 },
    pacte_non_agression:      { label: 'Pacte de Non-Agression', icon: '🤍', tier: 6 },
    partenariat:              { label: 'Partenariat économique', icon: '💼', tier: 7 },
    neutre:                   { label: 'Neutre', icon: '⚪', tier: 8 },
    observateur:              { label: 'Sous surveillance', icon: '👁️', tier: 9 },
    tension:                  { label: 'Tension diplomatique', icon: '⚠️', tier: 10 },
    opposition_parlementaire: { label: 'Opposition parlementaire', icon: '🏛️', tier: 11 },
    rivalite_electorale:      { label: 'Rivalité électorale', icon: '🗳️', tier: 12 },
    rivalite_ideologique:     { label: 'Rivalité idéologique', icon: '🧭', tier: 13 },
    sanction:                 { label: 'Sanctions économiques', icon: '🚫', tier: 14 },
    guerre_commerciale:       { label: 'Guerre commerciale', icon: '📉', tier: 15 },
    blocus:                   { label: 'Blocus', icon: '⛔', tier: 16 },
    hostile:                  { label: 'Relations hostiles', icon: '☠️', tier: 17 },
    contentieux_territorial:  { label: 'Contentieux territorial', icon: '🗺️', tier: 18 },
    conflit_froid:            { label: 'Conflit froid', icon: '❄️', tier: 19 },
    insurrection_proxy:       { label: 'Conflit par procuration', icon: '🔥', tier: 20 },
    guerre:                   { label: 'En guerre ouverte', icon: '💥', tier: 21 }
};

const DIPLO_SCOPE_META = {
    city: { label: 'Cités', empty: 'Aucune cité disponible.' },
    party: { label: 'Partis politiques', empty: 'Aucun parti politique disponible.' }
};

function loadCityRelations() {
    socket.emit('request_city_relations');
}

function loadPoliticalParties() {
    socket.emit('request_political_parties');
}

socket.on('political_parties_data', (parties) => {
    politicalPartiesData = Array.isArray(parties) ? parties : [];
    populateDiploFilters();
    populateDiploModalSelects();
});

socket.on('city_relations_data', (relations) => {
    cityRelationsData = Array.isArray(relations) ? relations : [];
    populateDiploFilters();
    renderDiplomacy();
    if(IS_ADMIN) {
        const btn = document.getElementById('diplo-admin-btn');
        if(btn) btn.classList.remove('hidden');
    }
});

function switchCitesTab(tab) {
    currentDiploTab = tab;
    document.getElementById('cites-tab-geo').classList.toggle('hidden', tab !== 'geo');
    document.getElementById('cites-tab-diplo').classList.toggle('hidden', tab !== 'diplo');
    document.getElementById('subtab-geo').classList.toggle('active', tab === 'geo');
    document.getElementById('subtab-diplo').classList.toggle('active', tab === 'diplo');
    if(tab === 'diplo') {
        if(!cityRelationsData.length) loadCityRelations();
        if(!politicalPartiesData.length) loadPoliticalParties();
    }
}

function getDiploEntitiesForScope(scope) {
    if(scope === 'party') {
        return politicalPartiesData.map(party => ({
            scope: 'party',
            key: String(party.key),
            id: `party:${party.key}`,
            name: party.name,
            logo: party.logo || ''
        }));
    }
    return citiesData.map(city => ({
        scope: 'city',
        key: String(city._id),
        id: `city:${city._id}`,
        name: city.name,
        logo: city.flag || ''
    }));
}

function getDiploRelationEntities(relation) {
    if(relation.relationScope === 'mixed') {
        return [...(relation.sourceEntities || []), ...(relation.targetEntity ? [relation.targetEntity] : [])]
            .filter(Boolean);
    }
    if(relation.relationScope === 'party') {
        return [relation.partyA, relation.partyB]
            .filter(Boolean)
            .map(party => ({
                scope: 'party',
                key: String(party.key),
                id: `party:${party.key}`,
                name: party.name,
                logo: party.logo || ''
            }));
    }
    return [relation.cityA, relation.cityB]
        .filter(Boolean)
        .map(city => ({
            scope: 'city',
            key: String(city._id),
            id: `city:${city._id}`,
            name: city.name,
            logo: city.flag || ''
        }));
}

function populateDiploFilters() {
    const scopeSel = document.getElementById('diplo-filter-scope');
    const entitySel = document.getElementById('diplo-filter-entity');
    if(!scopeSel || !entitySel) return;

    const currentScope = scopeSel.value || '';
    const currentEntity = entitySel.value || '';
    const scopeOptions = currentScope ? [currentScope] : ['city', 'party'];
    const entities = scopeOptions.flatMap(scope => getDiploEntitiesForScope(scope));
        
    entitySel.innerHTML = '<option value="">Toutes les entités</option>';
    entities.sort((left, right) => left.name.localeCompare(right.name, 'fr')).forEach(entity => {
        const opt = document.createElement('option');
        opt.value = entity.id;
        opt.textContent = `${entity.name} · ${DIPLO_SCOPE_META[entity.scope]?.label || entity.scope}`;
        if(entity.id === currentEntity) opt.selected = true;
        entitySel.appendChild(opt);
    });

    populateDiploModalSelects();
}

function populateDiploModalSelects() {
    const sel = document.getElementById('diploEntityIds');
    const scope = document.getElementById('diploRelationScope')?.value || 'city';
    const help = document.getElementById('diplo-modal-help');
    const allianceSel = document.getElementById('diploExistingAlliance');
    const targetSel = document.getElementById('diploAllianceTargetCity');
    if(!sel) return;

    const previousValues = new Set(Array.from(sel.selectedOptions).map(opt => String(opt.value)));
    const entities = getDiploEntitiesForScope(scope).sort((left, right) => left.name.localeCompare(right.name, 'fr'));

    sel.innerHTML = '';
    entities.forEach(entity => {
        const opt = document.createElement('option');
        opt.value = entity.key;
        opt.textContent = entity.name;
        if(previousValues.has(String(entity.key))) opt.selected = true;
        sel.appendChild(opt);
    });

    if(help) {
        help.textContent = `Sélectionne 2 ${scope === 'party' ? 'partis' : 'cités'} pour une relation classique. Avec un statut d'alliance, tu peux en sélectionner 3 ou plus pour créer ou modifier une alliance collective.`;
    }

    if(allianceSel) {
        const previousAllianceKey = allianceSel.value || '';
        const groupedAlliances = getAllianceCatalog(scope)
            .sort((left, right) => String(left.allianceGroupName || '').localeCompare(String(right.allianceGroupName || ''), 'fr'));

        allianceSel.innerHTML = '<option value="">Aucune, saisie manuelle classique</option>';
        groupedAlliances.forEach(relation => {
            const opt = document.createElement('option');
            opt.value = String(relation.allianceGroupKey || '');
            const label = String(relation.allianceGroupName || '').trim() || 'Alliance collective';
            opt.textContent = `${label} (${relation.entities.length} ${scope === 'party' ? 'partis' : 'cités'})`;
            if(opt.value === previousAllianceKey) opt.selected = true;
            allianceSel.appendChild(opt);
        });
    }

    if(targetSel) {
        const previousTarget = targetSel.value || '';
        const targetLabel = document.getElementById('diploAllianceTargetLabel');
        const targetEntities = [...getDiploEntitiesForScope('city'), ...getDiploEntitiesForScope('party')]
            .sort((left, right) => left.name.localeCompare(right.name, 'fr'));
        if(targetLabel) targetLabel.textContent = 'Entité cible';
        targetSel.innerHTML = '<option value="">Choisir une cité ou un parti</option>';
        targetEntities.forEach(entity => {
            const opt = document.createElement('option');
            opt.value = entity.id;
            opt.textContent = `${entity.name} · ${DIPLO_SCOPE_META[entity.scope]?.label || entity.scope}`;
            if(String(entity.id) === previousTarget) opt.selected = true;
            targetSel.appendChild(opt);
        });
    }

    updateDiploCollectiveConflictUI();
    updateDiploAllianceModeUI();
}

function getAllianceCatalog(scope = 'city') {
    const buckets = new Map();

    cityRelationsData.forEach(relation => {
        if((relation.relationScope || 'city') !== scope || !relation.allianceGroupKey) return;

        const bucketKey = String(relation.allianceGroupKey);
        if(!buckets.has(bucketKey)) {
            buckets.set(bucketKey, {
                allianceGroupKey: bucketKey,
                allianceGroupName: relation.allianceGroupName || '',
                relationScope: scope,
                status: relation.status,
                entities: []
            });
        }

        const bucket = buckets.get(bucketKey);
        const entityMap = new Map(bucket.entities.map(entity => [entity.id, entity]));
        getDiploRelationEntities(relation).forEach(entity => entityMap.set(entity.id, entity));
        bucket.entities = [...entityMap.values()].sort((left, right) => left.name.localeCompare(right.name, 'fr'));
        if(!bucket.allianceGroupName && relation.allianceGroupName) bucket.allianceGroupName = relation.allianceGroupName;
        bucket.status = relation.status || bucket.status;
    });

    return [...buckets.values()].filter(bucket => bucket.entities.length >= 2);
}

function getAllianceMembersByGroupKey(allianceGroupKey) {
    if(!allianceGroupKey) return [];
    const scope = document.getElementById('diploRelationScope')?.value || 'city';
    const groupedAlliance = getAllianceCatalog(scope)
        .find(relation => String(relation.allianceGroupKey) === String(allianceGroupKey));
    return groupedAlliance?.entities || [];
}

function updateDiploAllianceModeUI() {
    const scope = document.getElementById('diploRelationScope')?.value || 'city';
    const entitySelect = document.getElementById('diploEntityIds');
    const help = document.getElementById('diplo-modal-help');
    const allianceSection = document.getElementById('diploAllianceRelationSection');
    const allianceSelect = document.getElementById('diploExistingAlliance');
    const targetSelect = document.getElementById('diploAllianceTargetCity');
    if(!entitySelect || !help || !allianceSection || !allianceSelect || !targetSelect) return;

    const allianceGroupKey = String(allianceSelect.value || '');
    const members = getAllianceMembersByGroupKey(allianceGroupKey);
    const targetEntityKey = String(targetSelect.value || '');
    const isAllianceMode = Boolean(allianceGroupKey && targetEntityKey);

    allianceSection.classList.toggle('hidden', !['city', 'party'].includes(scope));

    if(!allianceGroupKey) {
        entitySelect.disabled = false;
        Array.from(entitySelect.options).forEach(opt => { opt.disabled = false; });
        help.textContent = `Sélectionne 2 ${scope === 'party' ? 'partis' : 'cités'} pour une relation classique. Avec un statut d'alliance, tu peux en sélectionner 3 ou plus pour créer ou modifier une alliance collective.`;
        updateDiploCollectiveConflictUI();
        return;
    }

    const memberSet = new Set(members.map(member => String(member.key)));
    const memberIdSet = new Set(members.map(member => String(member.id)));
    Array.from(entitySelect.options).forEach(opt => {
        opt.selected = memberSet.has(String(opt.value));
        opt.disabled = true;
    });
    entitySelect.disabled = true;

    Array.from(targetSelect.options).forEach(opt => {
        if(!opt.value) return;
        opt.disabled = memberIdSet.has(String(opt.value));
    });

    const allianceName = String(allianceSelect.options[allianceSelect.selectedIndex]?.textContent || 'Alliance collective');
    help.textContent = isAllianceMode
    ? `Le statut choisi sera applique a ${allianceName} contre l'entité cible selectionnee.`
    : `Alliance preselectionnee: ${allianceName}. Choisis maintenant une cité ou un parti cible pour appliquer le statut a toute l'alliance.`;

    updateDiploCollectiveConflictUI();
}

function getDiploCollectiveAllianceMemberKeys() {
    return Array.from(document.getElementById('diploEntityIds')?.selectedOptions || []).map(opt => String(opt.value));
}

function getCollectiveConflictTargetsForAlliance(memberKeys, statusFilter = '') {
    if(!Array.isArray(memberKeys) || memberKeys.length < 2) return [];

    const memberSet = new Set(memberKeys.map(key => String(key)));
    const matchCountByTarget = new Map();
    const statusByTarget = new Map();
    const entityByTarget = new Map();

    cityRelationsData.forEach(relation => {
        if((relation.relationScope || 'city') !== 'city' || relation.allianceGroupKey) return;
        const entities = getDiploRelationEntities(relation);
        if(entities.length !== 2) return;

        const inside = entities.find(entity => memberSet.has(String(entity.key)));
        const outside = entities.find(entity => !memberSet.has(String(entity.key)));
        if(!inside || !outside) return;

        const targetKey = String(outside.key);
        if(statusFilter && relation.status !== statusFilter) return;
        if(statusByTarget.has(targetKey) && statusByTarget.get(targetKey) !== relation.status) return;

        statusByTarget.set(targetKey, relation.status);
        entityByTarget.set(targetKey, outside);
        matchCountByTarget.set(targetKey, (matchCountByTarget.get(targetKey) || 0) + 1);
    });

    return [...matchCountByTarget.entries()]
        .filter(([, count]) => count === memberSet.size)
        .map(([targetKey]) => ({
            key: targetKey,
            entity: entityByTarget.get(targetKey),
            status: statusByTarget.get(targetKey)
        }))
        .filter(entry => entry.entity)
        .sort((left, right) => {
            const leftTier = DIPLO_STATUS_META[left.status]?.tier ?? 99;
            const rightTier = DIPLO_STATUS_META[right.status]?.tier ?? 99;
            return rightTier - leftTier || left.entity.name.localeCompare(right.entity.name, 'fr');
        });
}

function updateDiploCollectiveConflictUI(prefill = null) {
    const section = document.getElementById('diploCollectiveConflictSection');
    const allianceNameWrap = document.getElementById('diploAllianceNameWrap');
    const targetSelect = document.getElementById('diploCollectiveConflictTargets');
    const statusSelect = document.getElementById('diploCollectiveConflictStatus');
    const help = document.getElementById('diploCollectiveConflictHelp');
    const scope = document.getElementById('diploRelationScope')?.value || 'city';
    const relationStatus = document.getElementById('diploStatus')?.value || 'neutre';
    const allianceGroupKey = document.getElementById('diploAllianceGroupKey')?.value || '';
    const allianceNameValue = document.getElementById('diploAllianceName')?.value.trim() || '';
    const memberKeys = getDiploCollectiveAllianceMemberKeys();
    const isAllianceDefinition = scope === 'city' && memberKeys.length >= 2 && (DIPLO_GROUPABLE_STATUSES.has(relationStatus) || allianceGroupKey || allianceNameValue);

    if(allianceNameWrap) {
        allianceNameWrap.classList.toggle('hidden', !(scope === 'city' && memberKeys.length >= 2));
    }

    if(!section || !targetSelect || !statusSelect || !help) return;

    section.classList.toggle('hidden', !isAllianceDefinition);
    if(!isAllianceDefinition) {
        targetSelect.innerHTML = '';
        targetSelect.value = '';
        statusSelect.value = '';
        return;
    }

    const previousSelectedTargets = new Set(prefill?.targetKeys || Array.from(targetSelect.selectedOptions).map(opt => String(opt.value)));
    const preferredStatus = prefill?.status || statusSelect.value || '';
    const memberSet = new Set(memberKeys.map(key => String(key)));
    const targetEntities = getDiploEntitiesForScope('city')
        .filter(entity => !memberSet.has(String(entity.key)))
        .sort((left, right) => left.name.localeCompare(right.name, 'fr'));

    targetSelect.innerHTML = '';
    targetEntities.forEach(entity => {
        const opt = document.createElement('option');
        opt.value = entity.key;
        opt.textContent = entity.name;
        if(previousSelectedTargets.has(String(entity.key))) opt.selected = true;
        targetSelect.appendChild(opt);
    });

    let collectiveConflicts = [];
    if(preferredStatus) {
        collectiveConflicts = getCollectiveConflictTargetsForAlliance(memberKeys, preferredStatus);
        if(!previousSelectedTargets.size && collectiveConflicts.length) {
            const preselected = new Set(collectiveConflicts.map(item => item.key));
            Array.from(targetSelect.options).forEach(opt => {
                opt.selected = preselected.has(String(opt.value));
            });
        }
    } else {
        collectiveConflicts = getCollectiveConflictTargetsForAlliance(memberKeys);
        const firstConflict = collectiveConflicts[0];
        if(firstConflict) {
            statusSelect.value = firstConflict.status;
            const preselected = new Set(collectiveConflicts.filter(item => item.status === firstConflict.status).map(item => item.key));
            Array.from(targetSelect.options).forEach(opt => {
                opt.selected = preselected.has(String(opt.value));
            });
        }
    }

    help.textContent = 'Applique le meme conflit a chaque membre de l\'alliance contre les cites selectionnees. Les relations internes de l\'alliance ne sont pas modifiees.';
}

function getGroupedAllianceCollectiveConflicts(relation) {
    if((relation?.relationScope || 'city') !== 'city') return [];
    const memberKeys = (relation.entities || []).map(entity => String(entity.key));
    if(memberKeys.length < 2) return [];
    return getCollectiveConflictTargetsForAlliance(memberKeys);
}

function groupDiplomacyRelations(relations) {
    const grouped = [];
    const groupedBuckets = new Map();

    relations.forEach(relation => {
        const entities = getDiploRelationEntities(relation);
        if(!relation.allianceGroupKey || entities.length !== 2) {
            grouped.push(relation);
            return;
        }
        const bucketKey = `${relation.relationScope || 'city'}::${relation.allianceGroupKey}`;
        if(!groupedBuckets.has(bucketKey)) groupedBuckets.set(bucketKey, []);
        groupedBuckets.get(bucketKey).push(relation);
    });

    groupedBuckets.forEach(bucket => {
        const entityMap = new Map();
        bucket.forEach(relation => {
            getDiploRelationEntities(relation).forEach(entity => entityMap.set(entity.id, entity));
        });
        const entities = [...entityMap.values()].sort((left, right) => left.name.localeCompare(right.name, 'fr'));
        if(entities.length < 3) {
            grouped.push(...bucket);
            return;
        }
        const sample = bucket[0];
        grouped.push({
            _id: `diplo-group:${sample.relationScope}:${sample.allianceGroupKey}`,
            relationScope: sample.relationScope || 'city',
            status: sample.status,
            since: sample.since || null,
            initiatedBy: sample.initiatedBy || '',
            description: sample.description || '',
            allianceGroupKey: sample.allianceGroupKey || '',
            allianceGroupName: sample.allianceGroupName || '',
            entities,
            isGroupedAlliance: true
        });
    });

    return grouped;
}

function renderDiplomacy() {
    const grid = document.getElementById('diplo-relations-grid');
    if(!grid) return;

    const filterScope = document.getElementById('diplo-filter-scope')?.value || '';
    const filterEntity = document.getElementById('diplo-filter-entity')?.value || '';
    const filterStatus = document.getElementById('diplo-filter-status')?.value || '';

    let list = groupDiplomacyRelations(cityRelationsData);

    if(filterScope) {
        list = list.filter(relation => {
            if((relation.relationScope || 'city') === filterScope) return true;
            if((relation.relationScope || 'city') !== 'mixed') return false;
            const entities = getDiploRelationEntities(relation);
            return entities.some(entity => entity.scope === filterScope);
        });
    }
    if(filterEntity) {
        list = list.filter(relation => {
            const entities = relation.isGroupedAlliance ? (relation.entities || []) : getDiploRelationEntities(relation);
            return entities.some(entity => entity.id === filterEntity);
        });
    }
    if(filterStatus) list = list.filter(relation => relation.status === filterStatus);

    list.sort((left, right) => {
        const leftTier = DIPLO_STATUS_META[left.status]?.tier ?? 99;
        const rightTier = DIPLO_STATUS_META[right.status]?.tier ?? 99;
        const leftName = (left.isGroupedAlliance ? left.entities?.[0]?.name : getDiploRelationEntities(left)[0]?.name) || '';
        const rightName = (right.isGroupedAlliance ? right.entities?.[0]?.name : getDiploRelationEntities(right)[0]?.name) || '';
        return rightTier - leftTier || leftName.localeCompare(rightName, 'fr');
    });

    renderedDiplomacyRelationsCache = list;

    if(!list.length) {
        grid.innerHTML = '<div class="rank-empty" style="grid-column:1/-1;">Aucune relation diplomatique correspondante.</div>';
        return;
    }

    grid.innerHTML = list.map(relation => renderDiploCard(relation)).join('');
}

function renderDiploEntityToken(entity) {
    const media = entity.logo
        ? `<img src="${escapeHtml(entity.logo)}" class="diplo-city-flag" alt="">`
        : `<div class="diplo-city-flag-ph"><i class="fa-solid ${entity.scope === 'party' ? 'fa-flag' : 'fa-city'}"></i></div>`;
    return `
        <div class="diplo-alliance-city">
            ${media}
            <div class="diplo-city-name">${escapeHtml(entity.name || '—')}</div>
        </div>`;
}

function toggleDiploAllianceExpanded(relationId) {
    const safeId = String(relationId || '');
    if(!safeId) return;
    if(expandedDiploAllianceIds.has(safeId)) expandedDiploAllianceIds.delete(safeId);
    else expandedDiploAllianceIds.add(safeId);
    renderDiplomacy();
}

function renderDiploCard(relation) {
    const meta = DIPLO_STATUS_META[relation.status] || { label: relation.status, icon: '❓' };
    const since = relation.since ? new Date(relation.since).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const scopeLabel = DIPLO_SCOPE_META[relation.relationScope || 'city']?.label || 'Relation';
    const adminActions = IS_ADMIN ? `
        <div class="diplo-card-actions">
            <button class="diplo-card-btn" onclick="openDiploModal('${String(relation._id).replace(/'/g, "\\'")}')"><i class="fa-solid fa-pen"></i> Modifier</button>
            <button class="diplo-card-btn danger" onclick="deleteDiploRelation('${String(relation._id).replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i> Supprimer</button>
        </div>` : '';

    if(relation.isGroupedAlliance) {
        const expanded = expandedDiploAllianceIds.has(String(relation._id));
        const maxVisible = 4;
        const visibleEntities = expanded ? (relation.entities || []) : (relation.entities || []).slice(0, maxVisible);
        const remainingCount = Math.max(0, (relation.entities || []).length - visibleEntities.length);
        const collectiveConflicts = getGroupedAllianceCollectiveConflicts(relation);
        const allianceName = String(relation.allianceGroupName || '').trim();
        const expandButton = remainingCount > 0 || expanded
            ? `<button class="diplo-alliance-more" onclick="event.stopPropagation(); toggleDiploAllianceExpanded('${String(relation._id).replace(/'/g, "\\'")}')">${expanded ? 'Réduire' : `et ${remainingCount} ${relation.relationScope === 'party' ? 'partis' : 'cités'}`}</button>`
            : '';
        const conflictSummary = collectiveConflicts.length
            ? `<div class="diplo-card-meta"><i class="fa-solid fa-burst"></i> Conflits collectifs : ${collectiveConflicts.map(item => `${DIPLO_STATUS_META[item.status]?.icon || '❓'} ${escapeHtml(item.entity.name || '—')}`).join(', ')}</div>`
            : '';
        return `
        <div class="diplo-card diplo-card-grouped-alliance">
            <div class="diplo-card-banner diplo-banner-${relation.status}"></div>
            <div class="diplo-card-body">
                <div class="diplo-alliance-head">
                    <div>
                        <div class="diplo-alliance-title">${escapeHtml(allianceName || 'Alliance collective')}</div>
                        <div class="diplo-scope-label">${escapeHtml(scopeLabel)}</div>
                    </div>
                    <div class="diplo-alliance-count">${relation.entities.length} ${relation.relationScope === 'party' ? 'partis' : 'cités'}</div>
                </div>
                <div class="diplo-alliance-grid">${visibleEntities.map(renderDiploEntityToken).join('')}</div>
                ${expandButton}
                <div class="diplo-card-tags"><span class="diplo-status-badge diplo-badge-${relation.status}">${meta.icon} ${meta.label}</span></div>
                ${conflictSummary}
                ${since ? `<div class="diplo-card-meta"><i class="fa-regular fa-calendar"></i> Depuis le ${since}</div>` : ''}
                ${relation.initiatedBy ? `<div class="diplo-card-meta"><i class="fa-solid fa-user"></i> ${escapeHtml(relation.initiatedBy)}</div>` : ''}
                ${relation.description ? `<div class="diplo-card-desc">${escapeHtml(relation.description)}</div>` : ''}
                ${adminActions}
            </div>
        </div>`;
    }

    if(relation.relationScope === 'mixed') {
        const sourceEntities = relation.sourceEntities || [];
        const targetEntity = relation.targetEntity;
        const allianceName = String(relation.sourceAllianceGroupName || '').trim() || 'Alliance collective';
        return `
        <div class="diplo-card diplo-card-grouped-alliance">
            <div class="diplo-card-banner diplo-banner-${relation.status}"></div>
            <div class="diplo-card-body">
                <div class="diplo-alliance-head">
                    <div>
                        <div class="diplo-alliance-title">${escapeHtml(allianceName)}</div>
                        <div class="diplo-scope-label">Alliance de ${relation.sourceAllianceScope === 'party' ? 'partis' : 'cités'} contre ${targetEntity?.scope === 'party' ? 'un parti' : 'une cité'}</div>
                    </div>
                    <div class="diplo-alliance-count">${sourceEntities.length} ${relation.sourceAllianceScope === 'party' ? 'partis' : 'cités'}</div>
                </div>
                <div class="diplo-alliance-grid">${sourceEntities.slice(0, 4).map(renderDiploEntityToken).join('')}</div>
                <div class="diplo-card-cities">
                    <div class="diplo-cities-pair">
                        <div class="diplo-vs">VS</div>
                        ${renderDiploEntityToken(targetEntity || { scope: 'city', name: '—', logo: '' })}
                    </div>
                </div>
                <div class="diplo-card-tags"><span class="diplo-status-badge diplo-badge-${relation.status}">${meta.icon} ${meta.label}</span></div>
                ${since ? `<div class="diplo-card-meta"><i class="fa-regular fa-calendar"></i> Depuis le ${since}</div>` : ''}
                ${relation.initiatedBy ? `<div class="diplo-card-meta"><i class="fa-solid fa-user"></i> ${escapeHtml(relation.initiatedBy)}</div>` : ''}
                ${relation.description ? `<div class="diplo-card-desc">${escapeHtml(relation.description)}</div>` : ''}
                ${adminActions}
            </div>
        </div>`;
    }

    const entities = getDiploRelationEntities(relation);
    const [entityA, entityB] = entities;
    return `
    <div class="diplo-card">
        <div class="diplo-card-banner diplo-banner-${relation.status}"></div>
        <div class="diplo-card-body">
            <div class="diplo-card-cities">
                <div class="diplo-cities-pair">
                    ${renderDiploEntityToken(entityA || { scope: relation.relationScope || 'city', name: '—', logo: '' })}
                    <div class="diplo-vs">${relation.relationScope === 'party' ? 'Face à' : 'VS'}</div>
                    ${renderDiploEntityToken(entityB || { scope: relation.relationScope || 'city', name: '—', logo: '' })}
                </div>
            </div>
            <div class="diplo-scope-label">${escapeHtml(scopeLabel)}</div>
            <div class="diplo-card-tags"><span class="diplo-status-badge diplo-badge-${relation.status}">${meta.icon} ${meta.label}</span></div>
            ${since ? `<div class="diplo-card-meta"><i class="fa-regular fa-calendar"></i> Depuis le ${since}</div>` : ''}
            ${relation.initiatedBy ? `<div class="diplo-card-meta"><i class="fa-solid fa-user"></i> ${escapeHtml(relation.initiatedBy)}</div>` : ''}
            ${relation.description ? `<div class="diplo-card-desc">${escapeHtml(relation.description)}</div>` : ''}
            ${adminActions}
        </div>
    </div>`;
}

function openDiploModal(relationId) {
    const relation = relationId
        ? renderedDiplomacyRelationsCache.find(item => String(item._id) === String(relationId)) || cityRelationsData.find(item => String(item._id) === String(relationId))
        : null;
    const scopeInput = document.getElementById('diploRelationScope');
    const entitySelect = document.getElementById('diploEntityIds');
    const collectiveConflictStatus = document.getElementById('diploCollectiveConflictStatus');
    const allianceNameInput = document.getElementById('diploAllianceName');
    const existingAllianceSelect = document.getElementById('diploExistingAlliance');
    const allianceTargetSelect = document.getElementById('diploAllianceTargetCity');

    document.getElementById('diploRelationId').value = '';
    document.getElementById('diploAllianceGroupKey').value = '';
    scopeInput.value = relation?.relationScope === 'mixed' ? (relation.sourceAllianceScope || 'city') : (relation?.relationScope || 'city');
    populateDiploModalSelects();
    Array.from(entitySelect.options).forEach(opt => { opt.selected = false; });
    entitySelect.disabled = false;
    Array.from(entitySelect.options).forEach(opt => { opt.disabled = false; });
    document.getElementById('diploStatus').value = 'neutre';
    if(collectiveConflictStatus) collectiveConflictStatus.value = '';
    if(allianceNameInput) allianceNameInput.value = '';
    if(existingAllianceSelect) existingAllianceSelect.value = '';
    if(allianceTargetSelect) allianceTargetSelect.value = '';
    document.getElementById('diploInitiatedBy').value = '';
    document.getElementById('diploDesc').value = '';
    document.getElementById('diploSince').value = new Date().toISOString().split('T')[0];

    if(relation) {
        const selectedValues = new Set((relation.relationScope === 'mixed' ? (relation.sourceEntities || []) : (relation.isGroupedAlliance ? relation.entities : getDiploRelationEntities(relation))).map(entity => String(entity.key)));
        Array.from(entitySelect.options).forEach(opt => {
            opt.selected = selectedValues.has(String(opt.value));
        });
        if(!relation.isGroupedAlliance) document.getElementById('diploRelationId').value = String(relation._id);
        if(relation.allianceGroupKey) document.getElementById('diploAllianceGroupKey').value = relation.allianceGroupKey;
        if(existingAllianceSelect && relation.relationScope === 'mixed') existingAllianceSelect.value = relation.sourceAllianceGroupKey || '';
        if(allianceTargetSelect && relation.relationScope === 'mixed' && relation.targetEntity?.id) allianceTargetSelect.value = relation.targetEntity.id;
        if(allianceNameInput) allianceNameInput.value = relation.allianceGroupName || '';
        document.getElementById('diploStatus').value = relation.status || 'neutre';
        document.getElementById('diploInitiatedBy').value = relation.initiatedBy || '';
        document.getElementById('diploDesc').value = relation.description || '';
        if(relation.since) document.getElementById('diploSince').value = new Date(relation.since).toISOString().split('T')[0];
    }

    const prefillConflicts = relation?.isGroupedAlliance
        ? getGroupedAllianceCollectiveConflicts(relation)
        : [];
    updateDiploCollectiveConflictUI(prefillConflicts.length
        ? {
            status: prefillConflicts[0].status,
            targetKeys: prefillConflicts.filter(item => item.status === prefillConflicts[0].status).map(item => item.key)
        }
        : null);
    updateDiploAllianceModeUI();

    document.getElementById('diplo-modal').classList.remove('hidden');
    snapForm('diplo-modal');
}

function closeDiploModal() {
    guardClose('diplo-modal', () => { document.getElementById('diplo-modal').classList.add('hidden'); });
}

function submitDiploRelation() {
    const relationScope = document.getElementById('diploRelationScope').value || 'city';
    const existingAllianceGroupKey = document.getElementById('diploExistingAlliance')?.value || '';
    const allianceTargetEntityId = document.getElementById('diploAllianceTargetCity')?.value || '';
    const selectedIds = Array.from(document.getElementById('diploEntityIds').selectedOptions).map(opt => String(opt.value));
    const status = document.getElementById('diploStatus').value;
    const allianceGroupName = document.getElementById('diploAllianceName')?.value.trim() || '';
    const collectiveConflictStatus = document.getElementById('diploCollectiveConflictStatus')?.value || '';
    const collectiveConflictTargets = Array.from(document.getElementById('diploCollectiveConflictTargets')?.selectedOptions || []).map(opt => String(opt.value));
    const initiatedBy = document.getElementById('diploInitiatedBy').value.trim();
    const description = document.getElementById('diploDesc').value.trim();
    const since = document.getElementById('diploSince').value;
    const relationId = document.getElementById('diploRelationId').value;
    let allianceGroupKey = document.getElementById('diploAllianceGroupKey').value;
    const useExistingAllianceMode = Boolean(existingAllianceGroupKey && allianceTargetEntityId);

    if(useExistingAllianceMode) {
        if(!DIPLO_STATUS_META[status]) return alert('Le statut diplomatique est invalide.');
        const [targetEntityScope = 'city', targetEntityKey = ''] = String(allianceTargetEntityId).split(':');
        if(!targetEntityKey) return alert('Choisissez une entité cible valide.');
        socket.emit('admin_upsert_collective_relation_to_entity', {
            relationScope,
            allianceGroupKey: existingAllianceGroupKey,
            targetEntityScope,
            targetEntityKey,
            relationId: relationId || null,
            status,
            initiatedBy,
            description,
            since
        });
        _unsavedBypass = true;
        closeDiploModal();
        return;
    }

    if(selectedIds.length < 2) return alert(`Sélectionnez au moins deux ${relationScope === 'party' ? 'partis' : 'cités'}.`);
    if(!allianceGroupKey && relationId && selectedIds.length !== 2) return alert('Une relation simple ne peut concerner que deux entités.');
    if(!DIPLO_GROUPABLE_STATUSES.has(status) && selectedIds.length !== 2) return alert('Les relations hors alliance collective doivent concerner exactement deux entités.');
    if(selectedIds.length >= 2 && allianceGroupName && !allianceGroupKey) {
        allianceGroupKey = `city:${[...selectedIds].sort().join('|')}:${Date.now()}`;
    }
    if(DIPLO_GROUPABLE_STATUSES.has(status) && selectedIds.length >= 3 && !allianceGroupName) return alert('Donnez un nom à l\'alliance collective pour la retrouver plus facilement.');
    if(collectiveConflictStatus && !DIPLO_COLLECTIVE_CONFLICT_STATUSES.has(collectiveConflictStatus)) return alert('Le statut de conflit collectif est invalide.');
    if(collectiveConflictTargets.length && (relationScope !== 'city' || selectedIds.length < 2 || (!DIPLO_GROUPABLE_STATUSES.has(status) && !allianceGroupKey && !allianceGroupName))) {
        return alert('Le conflit collectif externe est réservé aux alliances collectives entre cités.');
    }
    if(collectiveConflictStatus && !collectiveConflictTargets.length) return alert('Sélectionnez au moins une cité opposée pour créer un conflit collectif.');

    if(!allianceGroupKey && relationScope === 'city' && DIPLO_GROUPABLE_STATUSES.has(status) && selectedIds.length > 2) {
        allianceGroupKey = `city:${[...selectedIds].sort().join('|')}:${Date.now()}`;
    }

    socket.emit('admin_upsert_city_relation', {
        relationId: relationId || null,
        relationScope,
        allianceGroupKey: allianceGroupKey || '',
        allianceGroupName: allianceGroupName || '',
        cityIds: relationScope === 'city' ? selectedIds : [],
        cityAId: relationScope === 'city' ? (selectedIds[0] || '') : '',
        cityBId: relationScope === 'city' ? (selectedIds[1] || '') : '',
        partyKeys: relationScope === 'party' ? selectedIds : [],
        status,
        initiatedBy,
        description,
        since
    });

    if(relationScope === 'city' && collectiveConflictStatus && collectiveConflictTargets.length) {
        socket.emit('admin_upsert_collective_conflict', {
            allianceGroupKey,
            sourceCityIds: selectedIds,
            targetCityIds: collectiveConflictTargets,
            status: collectiveConflictStatus,
            initiatedBy,
            description,
            since
        });
    }
    _unsavedBypass = true;
    closeDiploModal();
}

function deleteDiploRelation(relationId) {
    const relation = renderedDiplomacyRelationsCache.find(item => String(item._id) === String(relationId)) || cityRelationsData.find(item => String(item._id) === String(relationId));
    if(!relation) return;
    if(!confirm(relation.allianceGroupKey ? 'Supprimer toute cette alliance collective ?' : 'Supprimer cette relation diplomatique ?')) return;
    socket.emit('admin_delete_city_relation', {
        relationId: relation.isGroupedAlliance ? null : relationId,
        relationScope: relation.relationScope || 'city',
        allianceGroupKey: relation.allianceGroupKey || ''
    });
}
// ==================== [FIN DIPLOMATIE] ====================

// ==================== [BOURSE] ====================
let stocksData = [];
let bourseSearch = '';
let currentStockEdit = null;
let currentStockDetailId = null;
let bourseSort = localStorage.getItem('bourse_sort') || 'marketCapDesc';
let boursePage = 1;
let bourseLayout = localStorage.getItem('bourse_layout') || 'cards';

const BOURSE_PAGE_SIZE = 12;

function getStockDeltaPct(stock) {
    const hist = stock.history || [];
    const prev = hist.length >= 2 ? hist[hist.length - 2].value : stock.currentValue;
    return prev ? ((stock.currentValue - prev) / prev) * 100 : 0;
}

function getBourseSortedStocks(stocks) {
    const sorted = [...stocks];
    const sorters = {
        marketCapDesc: (a, b) => (b.currentValue || 0) - (a.currentValue || 0),
        marketCapAsc: (a, b) => (a.currentValue || 0) - (b.currentValue || 0),
        perfDesc: (a, b) => getStockDeltaPct(b) - getStockDeltaPct(a),
        perfAsc: (a, b) => getStockDeltaPct(a) - getStockDeltaPct(b),
        revenueDesc: (a, b) => (b.revenue || 0) - (a.revenue || 0),
        alpha: (a, b) => String(a.companyName || '').localeCompare(String(b.companyName || ''), 'fr', { sensitivity: 'base' })
    };
    sorted.sort(sorters[bourseSort] || sorters.marketCapDesc);
    return sorted;
}

function getVisibleBourseStocks(stocks) {
    const source = applyBourseFilter(stocks);
    const query = bourseSearch;
    const filtered = query ? source.filter(s =>
        (s.companyName || '').toLowerCase().includes(query) ||
        (s.charName || '').toLowerCase().includes(query) ||
        (s.description || '').toLowerCase().includes(query) ||
        (s.headquarters || '').toLowerCase().includes(query)
    ) : source;
    return getBourseSortedStocks(filtered);
}

function applyBourseFilter(stocks) {
    if(bourseFilter === 'gainers') return [...stocks].filter(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        return prev && s.currentValue > prev;
    }).sort((a, b) => {
        const pct = stock => { const hist = stock.history || []; const prev = hist.length >= 2 ? hist[hist.length - 2].value : stock.currentValue; return prev ? ((stock.currentValue - prev) / prev) * 100 : 0; };
        return pct(b) - pct(a);
    });
    if(bourseFilter === 'losers') return [...stocks].filter(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        return prev && s.currentValue < prev;
    }).sort((a, b) => {
        const pct = stock => { const hist = stock.history || []; const prev = hist.length >= 2 ? hist[hist.length - 2].value : stock.currentValue; return prev ? ((stock.currentValue - prev) / prev) * 100 : 0; };
        return pct(a) - pct(b);
    });
    if(bourseFilter === 'topRevenue') return [...stocks].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    return stocks;
}

function syncBourseFilterUI() {
    document.querySelectorAll('.bourse-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === bourseFilter);
    });
    const sortSelect = document.getElementById('bourse-sort-select');
    if(sortSelect) sortSelect.value = bourseSort;
    document.querySelectorAll('.bourse-layout-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === bourseLayout);
    });
    const meta = document.getElementById('bourse-filter-meta');
    if(meta) {
        meta.textContent = ({
            all: 'Affichage complet',
            gainers: 'Tri sur les meilleures hausses',
            losers: 'Tri sur les plus fortes baisses',
            topRevenue: 'Tri sur le chiffre d\'affaires'
        })[bourseFilter] || 'Affichage complet';
    }
}

function setBourseFilter(filter) {
    bourseFilter = filter;
    localStorage.setItem('bourse_filter', filter);
    boursePage = 1;
    syncBourseFilterUI();
    renderStockGrid(stocksData);
}

function setBourseSort(sortKey) {
    bourseSort = sortKey || 'marketCapDesc';
    localStorage.setItem('bourse_sort', bourseSort);
    boursePage = 1;
    syncBourseFilterUI();
    renderStockGrid(stocksData);
}

function setBourseLayout(layout) {
    bourseLayout = layout === 'compact' ? 'compact' : 'cards';
    localStorage.setItem('bourse_layout', bourseLayout);
    syncBourseFilterUI();
    renderStockGrid(stocksData);
}

function changeBoursePage(nextPage) {
    if(nextPage === boursePage || nextPage < 1) return;
    boursePage = nextPage;
    renderStockGrid(stocksData);
    const container = document.getElementById('bourse-stocks-grid');
    if(container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderBoursePagination(totalPages) {
    const pagination = document.getElementById('bourse-pagination');
    if(!pagination) return;
    if(totalPages <= 1) {
        pagination.innerHTML = '';
        pagination.classList.add('hidden');
        return;
    }
    const startPage = Math.max(1, boursePage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    const pages = [];
    for(let page = startPage; page <= endPage; page += 1) pages.push(page);
    pagination.classList.remove('hidden');
    pagination.innerHTML = `
        <button class="bourse-page-btn" ${boursePage === 1 ? 'disabled' : ''} onclick="changeBoursePage(${boursePage - 1})">
            <i class="fa-solid fa-chevron-left"></i>
        </button>
        ${pages.map(page => `
            <button class="bourse-page-btn ${page === boursePage ? 'active' : ''}" onclick="changeBoursePage(${page})">${page}</button>
        `).join('')}
        <button class="bourse-page-btn" ${boursePage === totalPages ? 'disabled' : ''} onclick="changeBoursePage(${boursePage + 1})">
            <i class="fa-solid fa-chevron-right"></i>
        </button>
    `;
}

function buildStockAdminControls(stock, compact = false) {
    if(!IS_ADMIN) return '';
    const rowClass = compact ? 'stock-admin-row stock-admin-row-compact' : 'stock-admin-row';
    const inputClass = compact ? 'stock-pct-input stock-pct-input-compact' : 'stock-pct-input';
    return `
        <div class="${rowClass}">
            <button class="stock-trend-btn stock-trend-up2" onclick="event.stopPropagation(); adminStockTrend('${stock._id}','croissance_forte')" title="+1.3~1.6%"><i class="fa-solid fa-angles-up"></i></button>
            <button class="stock-trend-btn stock-trend-up1" onclick="event.stopPropagation(); adminStockTrend('${stock._id}','croissance')" title="+0.5~0.9%"><i class="fa-solid fa-angle-up"></i></button>
            <button class="stock-trend-btn stock-trend-stable" onclick="event.stopPropagation(); adminStockTrend('${stock._id}','stable')" title="±0.1%"><i class="fa-solid fa-minus"></i></button>
            <button class="stock-trend-btn stock-trend-down1" onclick="event.stopPropagation(); adminStockTrend('${stock._id}','baisse')" title="-0.5~0.9%"><i class="fa-solid fa-angle-down"></i></button>
            <button class="stock-trend-btn stock-trend-down2" onclick="event.stopPropagation(); adminStockTrend('${stock._id}','chute')" title="-1.2~1.6%"><i class="fa-solid fa-angles-down"></i></button>
            <input type="number" id="cpct-${stock._id}" class="${inputClass}" placeholder="%" step="0.1" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.stopPropagation();applyCustomPctCard('${stock._id}');}">
            <button class="stock-trend-btn" onclick="event.stopPropagation(); applyCustomPctCard('${stock._id}')" title="Appliquer %" style="background:rgba(108,99,255,0.2);color:var(--accent);border-color:rgba(108,99,255,0.3);"><i class="fa-solid fa-percent"></i></button>
            <button class="stock-trend-btn stock-admin-reset" onclick="event.stopPropagation(); if(confirm('Réinitialiser l\'historique de cette action ?')) adminResetStockHistory('${stock._id}')" title="Réinitialiser l'historique"><i class="fa-solid fa-clock-rotate-left"></i></button>
            <button class="stock-admin-edit" onclick="event.stopPropagation(); openStockEditModal('${stock._id}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>
            <button class="stock-admin-del" onclick="event.stopPropagation(); if(confirm('Supprimer cette action ?')) adminDeleteStock('${stock._id}')" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
        </div>`;
}

function renderStockCard(stock, index) {
    const hist = stock.history || [];
    const prev = hist.length >= 2 ? hist[hist.length - 2].value : stock.currentValue;
    const pct = prev ? ((stock.currentValue - prev) / prev * 100) : 0;
    const isUp = pct > 0;
    const isDown = pct < 0;
    const hist7 = hist.slice(-7);
    const hi7 = hist7.length ? Math.max(...hist7.map(h => h.value)) : null;
    const lo7 = hist7.length ? Math.min(...hist7.map(h => h.value)) : null;
    const card = document.createElement('div');
    card.className = `stock-card ${isUp ? 'stock-up' : isDown ? 'stock-down' : 'stock-neutral'}`;
    card.id = `stock-${stock._id}`;
    card.style.animationDelay = `${index * 0.05}s`;
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => openStockDetail(String(stock._id)));
    card.innerHTML = `
        <div class="stock-header">
            <div class="stock-logo-wrap" style="border-color:${stock.stockColor || 'var(--accent)'}">
                ${stock.companyLogo ? `<img src="${stock.companyLogo}" class="stock-logo" alt="">` : `<i class="fa-solid fa-building"></i>`}
                ${stock.companyLogo ? `<div class="stock-logo-popup"><img src="${stock.companyLogo}" alt="${escapeHtml(stock.companyName)}"></div>` : ''}
            </div>
            <div class="stock-info">
                <div class="stock-name">${escapeHtml(stock.companyName)}</div>
                <div class="stock-char" style="color:${stock.charColor || 'var(--text-muted)'}"><i class="fa-solid fa-user"></i> ${escapeHtml(stock.charName || '')}${stock.headquarters ? ` <span class="stock-hq"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(stock.headquarters)}</span>` : ''}</div>
            </div>
            <div class="stock-badge ${isUp ? 'badge-up' : isDown ? 'badge-down' : 'badge-neutral'}">
                ${isUp ? '▲' : isDown ? '▼' : '—'} ${Math.abs(pct).toFixed(2)}%
            </div>
        </div>
        <div class="stock-value-row">
            <span class="stock-current-value" style="color:${isUp ? '#23a559' : isDown ? '#da373c' : 'white'}">${formatStockValue(stock.currentValue)}</span>
            <span class="stock-prev-value">Préc: ${formatStockValue(prev)}</span>
        </div>
        ${(hi7 !== null && lo7 !== null) ? `<div class="stock-highlow-row"><span class="stock-low7"><i class="fa-solid fa-arrow-down"></i> ${formatStockValue(lo7)}</span><span class="stock-hl-label">7j bas/haut</span><span class="stock-high7"><i class="fa-solid fa-arrow-up"></i> ${formatStockValue(hi7)}</span></div>` : ''}
        <div class="stock-chart-container" id="schart-${stock._id}"></div>
        ${stock.description ? `<div class="stock-desc">${escapeHtml(stock.description)}</div>` : ''}
        <div class="stock-trend-badge ${trendClass(stock.trend)}">${trendLabel(stock.trend)}</div>
        ${buildStockAdminControls(stock)}
    `;
    return { element: card, history: hist.slice(-7), currentValue: stock.currentValue, color: stock.stockColor || '#6c63ff', isPositive: pct >= 0 };
}

function renderCompactStockRow(stock, index) {
    const hist = stock.history || [];
    const prev = hist.length >= 2 ? hist[hist.length - 2].value : stock.currentValue;
    const pct = prev ? ((stock.currentValue - prev) / prev * 100) : 0;
    const isUp = pct > 0;
    const isDown = pct < 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `stock-row ${isUp ? 'stock-up' : isDown ? 'stock-down' : 'stock-neutral'}`;
    row.id = `stock-${stock._id}`;
    row.style.animationDelay = `${index * 0.03}s`;
    row.addEventListener('click', () => openStockDetail(String(stock._id)));
    row.innerHTML = `
        <span class="stock-row-main">
            <span class="stock-row-logo" style="border-color:${stock.stockColor || 'var(--accent)'}">
                ${stock.companyLogo ? `<img src="${stock.companyLogo}" class="stock-row-logo-img" alt="">` : `<i class="fa-solid fa-building"></i>`}
            </span>
            <span class="stock-row-ident">
                <span class="stock-row-name">${escapeHtml(stock.companyName)}</span>
                <span class="stock-row-meta" style="color:${stock.charColor || 'var(--text-muted)'}">${escapeHtml(stock.charName || 'Sans dirigeant')}${stock.headquarters ? ` · ${escapeHtml(stock.headquarters)}` : ''}</span>
            </span>
        </span>
        <span class="stock-row-trend ${isUp ? 'is-up' : isDown ? 'is-down' : 'is-flat'}">${isUp ? '▲' : isDown ? '▼' : '—'} ${Math.abs(pct).toFixed(2)}%</span>
        <span class="stock-row-value">${formatStockValue(stock.currentValue)}</span>
        <span class="stock-row-revenue">${stock.revenue ? formatStockValue(stock.revenue) : '—'}</span>
        <span class="stock-row-badge ${trendClass(stock.trend)}">${trendLabel(stock.trend)}</span>
        <span class="stock-row-admin-wrap">${IS_ADMIN ? buildStockAdminControls(stock, true) : '<span class="stock-row-admin-placeholder"></span>'}</span>
    `;
    return row;
}

function renderCompactStockHeader() {
    return `
        <div class="stock-row stock-row-header" aria-hidden="true">
            <span class="stock-row-head stock-row-head-main">Entreprise</span>
            <span class="stock-row-head">Perf.</span>
            <span class="stock-row-head">Cours</span>
            <span class="stock-row-head">CA</span>
            <span class="stock-row-head">Tendance</span>
            <span class="stock-row-head stock-row-head-admin">${IS_ADMIN ? 'Admin' : ''}</span>
        </div>
    `;
}

function loadBourse() { socket.emit('request_stocks'); }

function updateBourseAdminUI() {
    const adminHeader = document.getElementById('bourse-admin-header');
    if(adminHeader) { if(IS_ADMIN) adminHeader.classList.remove('hidden'); else adminHeader.classList.add('hidden'); }
}

function formatStockValue(v) {
    if(v == null) return '—';
    if(v >= 1e9) return (v/1e9).toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' Md';
    if(v >= 1e6) return (v/1e6).toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' M';
    if(v >= 1e3) return (v/1e3).toLocaleString('fr-FR', {maximumFractionDigits:1}) + ' k';
    return v.toLocaleString('fr-FR', {maximumFractionDigits:2});
}

socket.on('stocks_data', (stocks) => {
    stocksData = stocks;
    renderStockTicker(stocks);
    renderStockGrid(stocks);
    renderBourseSummary(stocks);
    renderBourseCompChart(stocks);
    updateBourseCustomSelect(stocks);
    updateBourseAdminUI();
    populatePubStockSelects();
    renderBourseRanking(stocks);
    buildAdminConsoleOverview();
});
socket.on('stocks_updated', (stocks) => {
    stocksData = stocks;
    renderStockTicker(stocks);
    renderStockGrid(stocks);
    renderBourseSummary(stocks);
    renderBourseCompChart(stocks);
    updateBourseCustomSelect(stocks);
    populatePubStockSelects();
    renderBourseRanking(stocks);
    buildAdminConsoleOverview();
    const section = document.getElementById('bourse-ranking-section');
    if(section) {
        section.classList.remove('ranking-updated');
        void section.offsetWidth;
        section.classList.add('ranking-updated');
        clearTimeout(boursePulseTimeout);
        boursePulseTimeout = setTimeout(() => section.classList.remove('ranking-updated'), 650);
    }
    if(currentView === 'admin') loadAdminCompanies();
});

function renderStockTicker(stocks) {
    const ticker = document.getElementById('bourse-ticker');
    if(!ticker) return;
    if(!stocks.length) { ticker.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;padding:0 16px;">Aucune action cotée.</span>'; return; }
    const items = stocks.map(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        const pct = prev ? ((s.currentValue - prev) / prev * 100) : 0;
        const color = pct > 0 ? '#23a559' : pct < 0 ? '#da373c' : '#888';
        const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
        const logoHTML = s.companyLogo
            ? `<span class="ticker-logo-wrap"><img src="${s.companyLogo}" class="ticker-logo" alt=""><div class="ticker-logo-popup"><img src="${s.companyLogo}" alt="${escapeHtml(s.companyName)}"></div></span>`
            : '';
        return `<span class="ticker-item">
            ${logoHTML}
            <span class="ticker-name">${escapeHtml(s.companyName)}</span>
            <span class="ticker-value">${formatStockValue(s.currentValue)}</span>
            <span class="ticker-change" style="color:${color}">${arrow} ${Math.abs(pct).toFixed(2)}%</span>
        </span>`;
    }).join('<span class="ticker-sep">·</span>');
    ticker.innerHTML = items + '<span class="ticker-sep" style="margin:0 20px">·</span>' + items;
}

function renderBourseSummary(stocks) {
    const row = document.getElementById('bourse-summary-row');
    if(!row) return;
    if(!stocks.length) { row.innerHTML = ''; return; }
    const totalCap = stocks.reduce((s, st) => s + (st.currentValue || 0), 0);
    const winners = stocks.filter(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        return prev && s.currentValue > prev;
    }).length;
    const losers = stocks.filter(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        return prev && s.currentValue < prev;
    }).length;
    const bestStock = [...stocks].sort((a, b) => {
        const pH = (st) => { const h = st.history||[]; const p = h.length>=2?h[h.length-2].value:st.currentValue; return p?((st.currentValue-p)/p*100):0; };
        return pH(b) - pH(a);
    })[0];
    row.innerHTML = `
        <div class="bourse-summary-card">
            <div class="bourse-summary-label"><i class="fa-solid fa-landmark"></i> Capitalisation totale</div>
            <div class="bourse-summary-value">${formatStockValue(totalCap)}</div>
            <div class="bourse-summary-sub">${stocks.length} action${stocks.length>1?'s':''} cotée${stocks.length>1?'s':''}</div>
        </div>
        <div class="bourse-summary-card" style="border-color:rgba(35,165,89,0.3)">
            <div class="bourse-summary-label" style="color:#23a559"><i class="fa-solid fa-arrow-trend-up"></i> Hausse</div>
            <div class="bourse-summary-value" style="color:#23a559">${winners}</div>
            <div class="bourse-summary-sub">actions en progression</div>
        </div>
        <div class="bourse-summary-card" style="border-color:rgba(218,55,60,0.3)">
            <div class="bourse-summary-label" style="color:#da373c"><i class="fa-solid fa-arrow-trend-down"></i> Baisse</div>
            <div class="bourse-summary-value" style="color:#da373c">${losers}</div>
            <div class="bourse-summary-sub">actions en recul</div>
        </div>
        ${bestStock ? (() => {
            const hist = bestStock.history||[];
            const prev = hist.length>=2?hist[hist.length-2].value:bestStock.currentValue;
            const pct = prev?((bestStock.currentValue-prev)/prev*100):0;
            return `<div class="bourse-summary-card" style="border-color:rgba(108,99,255,0.3)">
                <div class="bourse-summary-label" style="color:var(--accent)"><i class="fa-solid fa-trophy"></i> Meilleure perf.</div>
                <div class="bourse-summary-value" style="font-size:0.9rem;">${escapeHtml(bestStock.companyName)}</div>
                <div class="bourse-summary-sub" style="color:#23a559">▲ +${pct.toFixed(2)}%</div>
            </div>`;
        })() : ''}
    `;
}

function renderStockGrid(stocks) {
    const grid = document.getElementById('bourse-stocks-grid');
    const count = document.getElementById('bourse-results-count');
    const compactHead = document.getElementById('bourse-compact-head');
    if(!grid) return;
    const _bq = bourseSearch;
    const filtered = getVisibleBourseStocks(stocks);
    syncBourseFilterUI();
    grid.classList.toggle('compact', bourseLayout === 'compact');
    if(compactHead) {
        const compactEnabled = bourseLayout === 'compact' && filtered.length > 0;
        compactHead.classList.toggle('hidden', !compactEnabled);
        compactHead.innerHTML = compactEnabled ? renderCompactStockHeader() : '';
    }
    if(!filtered.length) {
        if(count) count.textContent = '0 résultat';
        renderBoursePagination(0);
        grid.innerHTML = _bq
            ? '<div class="bourse-empty"><i class="fa-solid fa-magnifying-glass"></i><p>Aucune action ne correspond à votre recherche.</p></div>'
            : '<div class="bourse-empty"><i class="fa-solid fa-chart-line"></i><p>Aucune action cotée.</p><span>Un admin peut coter les entreprises des personnages.</span></div>';
        return;
    }
    const totalPages = Math.max(1, Math.ceil(filtered.length / BOURSE_PAGE_SIZE));
    if(boursePage > totalPages) boursePage = totalPages;
    const startIndex = (boursePage - 1) * BOURSE_PAGE_SIZE;
    const visibleStocks = filtered.slice(startIndex, startIndex + BOURSE_PAGE_SIZE);
    if(count) {
        const rangeStart = startIndex + 1;
        const rangeEnd = startIndex + visibleStocks.length;
        count.textContent = `${filtered.length} résultat${filtered.length > 1 ? 's' : ''} · ${rangeStart}-${rangeEnd}`;
    }
    grid.innerHTML = '';
    visibleStocks.forEach((s, idx) => {
        if(bourseLayout === 'compact') {
            grid.appendChild(renderCompactStockRow(s, idx));
            return;
        }
        const rendered = renderStockCard(s, idx);
        grid.appendChild(rendered.element);
        renderStockMiniChart(rendered.history, rendered.currentValue, `schart-${s._id}`, rendered.color, rendered.isPositive);
    });
    renderBoursePagination(totalPages);
}

function renderStockMiniChart(history, liveValue, containerId, color, isUp) {
    const container = document.getElementById(containerId);
    if(!container) return;
    // Build display data: committed history + optional live (pending) point
    let displayData = [...(history || [])];
    const lastHistVal = displayData.length > 0 ? displayData[displayData.length - 1].value : null;
    const hasLive = liveValue != null;
    // Ajouter toujours un point "en direct" pour montrer la valeur actuelle
    if(hasLive && (lastHistVal === null || Math.abs(liveValue - lastHistVal) > 0.001)) {
        displayData = [...displayData, { value: liveValue, live: true }];
    } else if(hasLive && displayData.length > 0) {
        // Même valeur : marquer le dernier point comme "actuel"
        displayData = [...displayData.slice(0, -1), { ...displayData[displayData.length - 1], live: true }];
    }

    if(!displayData || displayData.length < 2) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:0.7rem;text-align:center;padding:8px 0;">Données insuffisantes</div>';
        return;
    }
    const vals = displayData.map(d => d.value);
    const maxV = Math.max(...vals);
    const minV = Math.min(...vals);
    const range = maxV - minV || 1;
    const W = 240, H = 52;
    const pts = displayData.map((d, i) => ({
        x: parseFloat(((i / (displayData.length - 1)) * (W - 4) + 2).toFixed(1)),
        y: parseFloat((H - 3 - ((d.value - minV) / range) * (H - 10)).toFixed(1)),
        value: d.value, date: d.date, live: d.live
    }));
    const lineColor = isUp ? '#23a559' : '#da373c';
    const uid = containerId.replace(/[^a-z0-9]/gi, '');
    const committedPts = hasLive ? pts.slice(0, -1) : pts;
    const committedStr = committedPts.map(p => `${p.x},${p.y}`).join(' ');
    const livePt = hasLive ? pts[pts.length - 1] : null;
    const prevPt = hasLive ? pts[pts.length - 2] : null;
    container.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" class="stock-svg-chart" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <defs>
                <linearGradient id="sg-${uid}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="M${committedStr} L${(W-2)},${H} L2,${H} Z" fill="url(#sg-${uid})"/>
            <polyline points="${committedStr}" fill="none" stroke="${lineColor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            ${hasLive && prevPt ? `<line x1="${prevPt.x}" y1="${prevPt.y}" x2="${livePt.x}" y2="${livePt.y}" stroke="${lineColor}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.75"/>` : ''}
            ${pts.map(p => {
                const dateStr = p.date ? new Date(p.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : 'Live';
                if(p.live) return `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${lineColor}" stroke="var(--bg-secondary)" stroke-width="1.5" style="cursor:pointer" data-tip="En direct — ${formatStockValue(p.value)}" onmouseover="showChartTooltip(event,this.dataset.tip)" onmouseout="hideChartTooltip()"><animate attributeName="r" values="3;5.5;3" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.5;1" dur="1.8s" repeatCount="indefinite"/></circle>`;
                return `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${lineColor}" stroke="var(--bg-secondary)" stroke-width="1.5" style="cursor:pointer" class="stock-chart-dot" data-tip="${dateStr} — ${formatStockValue(p.value)}" onmouseover="showChartTooltip(event,this.dataset.tip)" onmouseout="hideChartTooltip()"></circle>`;
            }).join('')}
        </svg>`;
}

// Graphique comparatif top 10
function renderBourseCompChart(stocks) {
    const container = document.getElementById('bourse-comp-chart');
    if(!container) return;
    const top10 = [...stocks]
        .filter(s => s.history && s.history.length >= 2)
        .sort((a, b) => b.currentValue - a.currentValue)
        .slice(0, 10);
    if(top10.length < 2) {
        container.innerHTML = '';
        return;
    }
    const W = 600, H = 80, xPad = 60, yPad = 8;
    const chartW = W - xPad * 2, chartH = H - yPad * 2;
    const maxPts = 7;
    // Collect all history values for Y scale
    let allVals = [];
    const lines = top10.map(s => {
        const hist = (s.history || []).slice(-maxPts);
        const vals = hist.map(h => h.value);
        allVals.push(...vals);
        return { name: s.companyName, color: s.stockColor || '#6c63ff', vals, hist };
    });
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);
    const valRange = maxVal - minVal || 1;
    const linesSVG = lines.map(line => {
        if(line.vals.length < 2) return '';
        const pts = line.vals.map((v, i) => {
            const x = xPad + (i / Math.max(line.vals.length - 1, 1)) * chartW;
            const y = yPad + chartH - ((v - minVal) / valRange) * chartH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return `<polyline points="${pts}" fill="none" stroke="${line.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.88"/>`;
    }).join('');
    // Y axis labels: 3 ticks (min, mid, max)
    const ticks = [minVal, (minVal + maxVal) / 2, maxVal];
    const gridLines = ticks.map(v => {
        const y = yPad + chartH - ((v - minVal) / valRange) * chartH;
        return `<line x1="${xPad}" y1="${y.toFixed(1)}" x2="${W-xPad}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.09)" stroke-width="1" stroke-dasharray="3,3"/>
        <text x="${xPad-5}" y="${(y+3.5).toFixed(1)}" fill="rgba(255,255,255,0.35)" font-size="8" text-anchor="end">${formatStockValue(v)}</text>`;
    }).join('');
    const legendHTML = lines.map(l =>
        `<span class="bourse-comp-legend-item"><span class="bourse-comp-legend-dot" style="background:${l.color}"></span>${escapeHtml(l.name)}</span>`
    ).join('');
    container.innerHTML = `
        <div class="bourse-comp-header">
            <div class="bourse-section-title"><i class="fa-solid fa-chart-mixed"></i> Top 10 — Performance comparative (7 dernières valeurs)</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" class="bourse-comp-svg" xmlns="http://www.w3.org/2000/svg">
            ${gridLines}
            ${linesSVG}
        </svg>
        <div class="bourse-comp-legend">${legendHTML}</div>`;
}

function updateBourseCustomSelect(stocks) {    const sel = document.getElementById('bourseCustomStockId');
    if(!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">— Choisir une action —</option>';
    stocks.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s._id;
        opt.textContent = `${s.companyName} (${s.charName||''})`;
        sel.appendChild(opt);
    });
    if(currentVal) sel.value = currentVal;
}

// Admin — Modal ajout/modif stock
function openStockAddModal() {
    currentStockEdit = null;
    document.getElementById('bourseStockId').value = '';
    document.getElementById('bourseStockValue').value = '';
    document.getElementById('bourseStockColor').value = '#6c63ff';
    document.getElementById('bourseStockDesc').value = '';
    const hqEl = document.getElementById('bourseStockHQ'); if(hqEl) hqEl.value = '';
    const logoUrlEl = document.getElementById('bourseStockLogoUrl'); if(logoUrlEl) logoUrlEl.value = '';
    const logoFileEl = document.getElementById('bourseStockLogoFile'); if(logoFileEl) logoFileEl.value = '';
    const logoPreview = document.getElementById('bourseStockLogoPreview'); if(logoPreview) logoPreview.style.display = 'none';
    const sel = document.getElementById('bourseStockCharSelect');
    if(sel) sel.value = '';
    document.getElementById('bourse-stock-modal-title').textContent = '📈 Coter une action';
    document.getElementById('bourse-stock-modal').classList.remove('hidden');
    snapForm('bourse-stock-modal');
    socket.emit('request_all_chars_companies');
}

function openStockEditModal(stockId) {
    const stock = stocksData.find(s => String(s._id) === stockId);
    if(!stock) return;
    currentStockEdit = stock;
    document.getElementById('bourseStockId').value = stockId;
    document.getElementById('bourseStockValue').value = stock.currentValue || '';
    document.getElementById('bourseStockColor').value = stock.stockColor || '#6c63ff';
    document.getElementById('bourseStockDesc').value = stock.description || '';
    const hqEl2 = document.getElementById('bourseStockHQ'); if(hqEl2) hqEl2.value = stock.headquarters || '';
    const logoUrlEl2 = document.getElementById('bourseStockLogoUrl'); if(logoUrlEl2) logoUrlEl2.value = stock.companyLogo || '';
    const logoFileEl2 = document.getElementById('bourseStockLogoFile'); if(logoFileEl2) logoFileEl2.value = '';
    const logoPreview2 = document.getElementById('bourseStockLogoPreview');
    if(logoPreview2) { logoPreview2.src = stock.companyLogo || ''; logoPreview2.style.display = stock.companyLogo ? 'block' : 'none'; }
    document.getElementById('bourse-stock-modal-title').textContent = '✏️ Modifier l\'action';
    document.getElementById('bourse-stock-modal').classList.remove('hidden');
    snapForm('bourse-stock-modal');
    socket.emit('request_all_chars_companies');
}

function closeStockModal() { guardClose('bourse-stock-modal', () => { document.getElementById('bourse-stock-modal').classList.add('hidden'); }); }

socket.on('all_chars_companies', (data) => {
    const select = document.getElementById('bourseStockCharSelect');
    if(!select) return;
    const prevVal = select.value;
    select.innerHTML = '<option value="">— Choisir une entreprise —</option>';
    data.forEach(c => {
        if(c.companies && c.companies.length > 0) {
            const og = document.createElement('optgroup');
            og.label = `${c.charName}`;
            c.companies.forEach(co => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ charId: c.charId, charName: c.charName, charColor: c.charColor, companyName: co.name, companyLogo: co.logo || '' });
                opt.textContent = co.name;
                og.appendChild(opt);
            });
            select.appendChild(og);
        }
    });
    if(pendingAdminStockSelection) {
        const wanted = JSON.stringify(pendingAdminStockSelection);
        const wantedOption = [...select.options].find(opt => opt.value === wanted);
        if(wantedOption) select.value = wanted;
        pendingAdminStockSelection = null;
    } else if(currentStockEdit) {
        const targetVal = JSON.stringify({ charId: currentStockEdit.charId, charName: currentStockEdit.charName, charColor: currentStockEdit.charColor, companyName: currentStockEdit.companyName, companyLogo: currentStockEdit.companyLogo || '' });
        const option = [...select.options].find(o => o.value === targetVal);
        if(option) select.value = targetVal;
    } else if(prevVal) {
        select.value = prevVal;
    }
});

async function submitStockAdmin() {
    const idVal = document.getElementById('bourseStockId').value;
    const selectVal = document.getElementById('bourseStockCharSelect').value;
    const value = parseFloat(document.getElementById('bourseStockValue').value);
    const color = document.getElementById('bourseStockColor').value;
    const desc = document.getElementById('bourseStockDesc').value.trim();
    const hq = document.getElementById('bourseStockHQ')?.value.trim() || null;
    if(!value || isNaN(value)) return alert('Valeur boursière requise.');
    let companyData = {};
    if(selectVal) {
        try { companyData = JSON.parse(selectVal); } catch(e) {}
    } else if(currentStockEdit) {
        companyData = { charId: currentStockEdit.charId, charName: currentStockEdit.charName, charColor: currentStockEdit.charColor, companyName: currentStockEdit.companyName, companyLogo: currentStockEdit.companyLogo };
    }
    if(!companyData.companyName) return alert('Sélectionnez une entreprise.');
    const logoFile = document.getElementById('bourseStockLogoFile')?.files[0];
    const logoUrlVal = document.getElementById('bourseStockLogoUrl')?.value.trim();
    if(logoFile) {
        const uploaded = await uploadToCloudinary(logoFile);
        if(uploaded) companyData.companyLogo = uploaded;
    } else if(logoUrlVal) {
        companyData.companyLogo = logoUrlVal;
    }
    socket.emit('admin_save_stock', { stockId: idVal || null, ...companyData, stockColor: color, currentValue: value, description: desc, headquarters: hq });
    _unsavedBypass = true;
    closeStockModal();
}

function adminStockTrend(stockId, trend) {
    socket.emit('admin_apply_stock_trend', { stockId, trend });
}

function onBourseSearch(val) {
    bourseSearch = val.toLowerCase().trim();
    localStorage.setItem('bourse_search', val || '');
    boursePage = 1;
    renderStockGrid(stocksData);
}

function previewStockLogo(input) {
    const preview = document.getElementById('bourseStockLogoPreview');
    if(!preview || !input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
    reader.readAsDataURL(input.files[0]);
    const urlEl = document.getElementById('bourseStockLogoUrl');
    if(urlEl) urlEl.value = '';
}

function showChartTooltip(evt, text) {
    let tip = document.getElementById('stock-chart-tooltip');
    if(!tip) {
        tip = document.createElement('div');
        tip.id = 'stock-chart-tooltip';
        tip.className = 'stock-chart-tooltip';
        document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.left = (evt.clientX + 12) + 'px';
    tip.style.top = (evt.clientY - 36) + 'px';
}

function hideChartTooltip() {
    const tip = document.getElementById('stock-chart-tooltip');
    if(tip) tip.style.display = 'none';
}

function adminApplyStockCustomPct() {
    const pct = parseFloat(document.getElementById('bourseCustomPct').value);
    const stockId = document.getElementById('bourseCustomStockId').value;
    if(!stockId) return alert('Sélectionnez une action.');
    if(isNaN(pct) || pct < -100 || pct > 100) return alert('Pourcentage invalide (entre -100 et +100).');
    socket.emit('admin_apply_stock_custom', { stockId, pct });
    document.getElementById('bourseCustomPct').value = '';
}

function adminDeleteStock(stockId) {
    socket.emit('admin_delete_stock', { stockId });
}

function adminResetStockHistory(stockId) {
    if(!IS_ADMIN || !stockId) return;
    socket.emit('admin_reset_stock_history', { stockId });
    closeStockDetail();
    showToast('Historique réinitialisé !');
}
function applyCustomPctCard(stockId) {
    const input = document.getElementById(`cpct-${stockId}`);
    if(!input) return;
    const pct = parseFloat(input.value);
    if(isNaN(pct)) return;
    socket.emit('admin_apply_stock_custom', { stockId, pct });
    input.value = '';
}

function getCompanyRelatedEntries(stock) {
    const companyName = String(stock.companyName || '').toLowerCase();
    const authorCharId = String(stock.charId || '');
    const relatedPosts = feedPostsCache.filter(post => {
        const text = [post.content, post.linkedCompanyName].filter(Boolean).join(' ').toLowerCase();
        return String(post.linkedStockId || '') === String(stock._id)
            || String(post.authorCharId || '') === authorCharId
            || text.includes(companyName);
    }).slice(0, 4);
    const relatedArticles = presseArticlesCache.filter(article => {
        const text = [article.content, article.linkedCompanyName, article.journalName].filter(Boolean).join(' ').toLowerCase();
        return String(article.linkedStockId || '') === String(stock._id) || text.includes(companyName);
    }).slice(0, 4);
    const relatedTimeline = worldTimelineCache.filter(item => {
        const summary = [item.title, item.summary].filter(Boolean).join(' ').toLowerCase();
        return summary.includes(companyName) || String(item.relatedData?.stockId || '') === String(stock._id);
    }).slice(0, 5);
    return { relatedPosts, relatedArticles, relatedTimeline };
}

function openStockDetail(stockId) {
    const stock = stocksData.find(s => String(s._id) === stockId);
    if(!stock) return;
    addRecentActivity({ type: 'stock', id: stockId, label: stock.companyName, meta: stock.charName || 'Entreprise' });
    const hist = stock.history || [];
    const prev = hist.length >= 2 ? hist[hist.length - 2].value : (hist.length === 1 ? hist[0].value : stock.currentValue);
    const pct = prev ? ((stock.currentValue - prev) / prev * 100) : 0;
    const isUp = pct > 0, isDown = pct < 0;
    const revenue = stock.revenue || 0;
    const hi14 = hist.length ? Math.max(...hist.slice(-14).map(point => point.value)) : stock.currentValue;
    const lo14 = hist.length ? Math.min(...hist.slice(-14).map(point => point.value)) : stock.currentValue;
    const { relatedPosts, relatedArticles, relatedTimeline } = getCompanyRelatedEntries(stock);
    document.getElementById('stock-detail-content').innerHTML = `
        <div class="stock-detail-hero">
            ${stock.companyLogo ? `<img src="${escapeHtml(stock.companyLogo)}" class="stock-detail-logo" alt="">` : `<div class="stock-detail-logo-placeholder"><i class="fa-solid fa-building"></i></div>`}
            <div class="stock-detail-info">
                <div class="stock-detail-name">${escapeHtml(stock.companyName)}</div>
                <div class="stock-detail-char" style="color:${stock.charColor||'var(--text-muted)'}"><i class="fa-solid fa-user"></i> ${escapeHtml(stock.charName||'')}</div>
                ${stock.headquarters ? `<div class="stock-detail-meta"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(stock.headquarters)}</div>` : ''}
                ${stock.charId ? `<div class="stock-detail-links"><button class="btn-secondary" onclick="openProfile('${String(stock.charName || '').replace(/'/g, "\\'")}')"><i class="fa-solid fa-user"></i> Ouvrir le profil</button></div>` : ''}
            </div>
        </div>
        <div class="stock-detail-value-row">
            <span class="stock-detail-value" style="color:${isUp?'#23a559':isDown?'#da373c':'white'}">${formatStockValue(stock.currentValue)}</span>
            <span class="stock-badge ${isUp?'badge-up':isDown?'badge-down':'badge-neutral'}">${isUp?'▲':isDown?'▼':'—'} ${Math.abs(pct).toFixed(2)}%</span>
        </div>
        <div class="stock-detail-metrics">
            ${revenue > 0 ? `<div class="stock-detail-stat-card"><span class="stock-detail-stat-label">CA</span><strong>${formatStockValue(revenue)}</strong></div>` : ''}
            <div class="stock-detail-stat-card"><span class="stock-detail-stat-label">14j haut</span><strong>${formatStockValue(hi14)}</strong></div>
            <div class="stock-detail-stat-card"><span class="stock-detail-stat-label">14j bas</span><strong>${formatStockValue(lo14)}</strong></div>
            ${stock.capital ? `<div class="stock-detail-stat-card"><span class="stock-detail-stat-label">Capital perso</span><strong>${formatStockValue(stock.capital)}</strong></div>` : ''}
        </div>
        ${stock.description ? `<div class="stock-detail-desc">${escapeHtml(stock.description)}</div>` : ''}
        <div class="stock-detail-chart-wrap" id="stock-detail-chart"></div>
        <div class="stock-detail-sections">
            <div class="stock-detail-section">
                <div class="stock-detail-section-title"><i class="fa-solid fa-bullhorn"></i> Réseau lié</div>
                ${relatedPosts.length ? relatedPosts.map(post => `<button class="stock-detail-related-item" onclick="openTimelineTarget('feed', { postId: '${post._id}' })"><span>${escapeHtml(post.authorName || 'Source')}</span><strong>${escapeHtml(extractTextPreview(post.content || '', 96))}</strong></button>`).join('') : '<div class="stock-detail-empty">Aucun post lié récemment.</div>'}
            </div>
            <div class="stock-detail-section">
                <div class="stock-detail-section-title"><i class="fa-solid fa-newspaper"></i> Couverture presse</div>
                ${relatedArticles.length ? relatedArticles.map(article => `<button class="stock-detail-related-item" onclick="openArticleFullscreen('${article._id}')"><span>${escapeHtml(article.journalName || 'Presse')}</span><strong>${escapeHtml(extractArticleTitle(article.content || ''))}</strong></button>`).join('') : '<div class="stock-detail-empty">Aucun article presse lié.</div>'}
            </div>
            <div class="stock-detail-section">
                <div class="stock-detail-section-title"><i class="fa-solid fa-wave-square"></i> Impact monde</div>
                ${relatedTimeline.length ? relatedTimeline.map(item => `<button class="stock-detail-related-item" onclick="openTimelineTarget('${item.relatedView || 'bourse'}', ${JSON.stringify(item.relatedData || { stockId }).replace(/"/g, '&quot;')})"><span>${escapeHtml(item.title || 'Signal')}</span><strong>${escapeHtml(item.summary || '')}</strong></button>`).join('') : '<div class="stock-detail-empty">Aucun signal récent lié à cette entreprise.</div>'}
            </div>
        </div>
    `;
    renderStockMiniChart(hist.slice(-14), stock.currentValue, 'stock-detail-chart', stock.stockColor || '#6c63ff', pct >= 0);
    const adminEl = document.getElementById('stock-detail-admin');
    if(IS_ADMIN) {
        document.getElementById('stockDetailCharId').value = stock.charId || '';
        document.getElementById('stockDetailCompanyName').value = stock.companyName || '';
        document.getElementById('stockDetailRevenue').value = revenue > 0 ? revenue : '';
        adminEl.classList.remove('hidden');
    } else {
        adminEl.classList.add('hidden');
    }
    currentStockDetailId = stockId;
    document.getElementById('stock-detail-overlay').classList.remove('hidden');
    document.getElementById('stock-detail-panel').classList.add('open');
}

function closeStockDetail() {
    document.getElementById('stock-detail-overlay').classList.add('hidden');
    document.getElementById('stock-detail-panel').classList.remove('open');
}

function adminSetStockRevenue() {
    if(!IS_ADMIN) return;
    const charId = document.getElementById('stockDetailCharId').value;
    const companyName = document.getElementById('stockDetailCompanyName').value;
    const revenue = parseFloat(document.getElementById('stockDetailRevenue').value);
    if(!charId || !companyName || isNaN(revenue)) return;
    socket.emit('admin_set_company_revenue', { charId, companyName, revenue });
    showToast('Chiffre d\'affaires mis à jour !');
}

// ==================== [FIN BOURSE] ====================

// ==================== [TOAST] ====================
function showToast(message, duration = 2500) {
    let toast = document.getElementById('cosmos-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cosmos-toast';
        toast.className = 'cosmos-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ==================== [WIKI] ====================
let wikiCache = [];
let currentWikiPageId = null;

function loadWiki() {
    socket.emit('request_wiki_pages');
}

socket.on('wiki_pages_data', (pages) => {
    wikiCache = pages;
    renderWikiList(pages);
    updateWikiAdminUI();
});

function updateWikiAdminUI() {
    const header = document.getElementById('wiki-admin-header');
    if(header) { if(IS_ADMIN) header.classList.remove('hidden'); else header.classList.add('hidden'); }
}

function renderWikiList(pages) {
    const container = document.getElementById('wiki-categories-container');
    if(!container) return;

    // On ne réaffiche la liste que si on est sur la vue liste
    if(!document.getElementById('wiki-list-view').classList.contains('hidden')) {
        const categories = { histoire: [], personnages: [], lore: [] };
        pages.forEach(p => {
            const cat = p.category || 'histoire';
            if(!categories[cat]) categories[cat] = [];
            categories[cat].push(p);
        });
        const LABELS = { histoire: '📜 Histoire', personnages: '👤 Personnages', lore: '🌍 Lore' };
        let html = '';
        for(const [cat, items] of Object.entries(categories)) {
            if(!items.length) continue;
            html += `<div class="wiki-category-section">
                <div class="wiki-category-title">${LABELS[cat] || cat}</div>
                <div class="wiki-cards-grid">
                    ${items.map(p => `
                        <div class="wiki-card" onclick="openWikiPage('${p._id}')">
                            ${p.coverImage ? `<img src="${escapeHtml(p.coverImage)}" class="wiki-card-cover" alt="">` : `<div class="wiki-card-cover wiki-card-cover-placeholder"><i class="fa-solid fa-book-open"></i></div>`}
                            <div class="wiki-card-body">
                                <div class="wiki-card-title">${escapeHtml(p.title)}</div>
                                <div class="wiki-card-meta">${escapeHtml(p.authorName || 'Admin')} · ${new Date(p.updatedAt).toLocaleDateString('fr-FR')}</div>
                            </div>
                            ${IS_ADMIN ? `<div class="wiki-card-admin">
                                <button onclick="event.stopPropagation(); openWikiEditModal('${p._id}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                                <button onclick="event.stopPropagation(); deleteWikiPage('${p._id}')" title="Supprimer" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>
                            </div>` : ''}
                        </div>`).join('')}
                </div>
            </div>`;
        }
        if(!html) html = '<div class="wiki-empty"><i class="fa-solid fa-book-open"></i><p>Le Wiki est vide pour l\'instant.</p></div>';
        container.innerHTML = html;
    }
}

function openWikiPage(id) {
    const page = wikiCache.find(p => String(p._id) === String(id));
    if(!page) return;
    addRecentActivity({ type: 'wiki', id, label: page.title, meta: page.category || 'Wiki' });
    currentWikiPageId = id;

    document.getElementById('wiki-list-view').classList.add('hidden');
    document.getElementById('wiki-page-view').classList.remove('hidden');

    const content = document.getElementById('wiki-page-content');
    const coverHTML = page.coverImage
        ? `<img src="${escapeHtml(page.coverImage)}" class="wiki-full-cover" alt="">`
        : '';
    const LABELS = { histoire: '📜 Histoire', personnages: '👤 Personnages', lore: '🌍 Lore' };
    const adminButtons = IS_ADMIN
        ? `<div style="display:flex;gap:8px;margin-bottom:16px;">
               <button class="btn-secondary" onclick="openWikiEditModal('${page._id}')"><i class="fa-solid fa-pen"></i> Modifier</button>
               <button class="btn-secondary" style="color:#da373c;" onclick="deleteWikiPage('${page._id}')"><i class="fa-solid fa-trash"></i> Supprimer</button>
           </div>`
        : '';
    content.innerHTML = `
        ${coverHTML}
        <div class="wiki-page-header">
            <span class="wiki-page-cat">${LABELS[page.category] || page.category}</span>
            <h1 class="wiki-page-title">${escapeHtml(page.title)}</h1>
            <div class="wiki-page-meta">Par ${escapeHtml(page.authorName || 'Admin')} · Mis à jour le ${new Date(page.updatedAt).toLocaleDateString('fr-FR')}</div>
        </div>
        ${adminButtons}
        <div class="wiki-page-body">${renderWikiMarkdown(page.content || '')}</div>`;
}

function closeWikiPage() {
    currentWikiPageId = null;
    document.getElementById('wiki-list-view').classList.remove('hidden');
    document.getElementById('wiki-page-view').classList.add('hidden');
}

function renderWikiMarkdown(text) {
    if(!text) return '';
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
        .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
        .replace(/^#{1} (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// --- Admin Wiki ---
function openWikiCreateModal() {
    document.getElementById('wikiPageId').value = '';
    document.getElementById('wikiPageTitle').value = '';
    document.getElementById('wikiPageCategory').value = 'histoire';
    document.getElementById('wikiPageCoverUrl').value = '';
    document.getElementById('wikiPageContent').value = '';
    document.getElementById('wiki-modal-title').innerHTML = '<i class="fa-solid fa-plus"></i> Nouvelle page Wiki';
    document.getElementById('wiki-edit-modal').classList.remove('hidden');
    restoreWikiDraft();
    updateWikiWordCount();
    snapForm('wiki-edit-modal');
}

function openWikiEditModal(id) {
    const page = wikiCache.find(p => String(p._id) === String(id));
    if(!page) return;
    document.getElementById('wikiPageId').value = page._id;
    document.getElementById('wikiPageTitle').value = page.title || '';
    document.getElementById('wikiPageCategory').value = page.category || 'histoire';
    document.getElementById('wikiPageCoverUrl').value = page.coverImage || '';
    document.getElementById('wikiPageContent').value = page.content || '';
    document.getElementById('wiki-modal-title').innerHTML = '<i class="fa-solid fa-pen"></i> Modifier la page';
    document.getElementById('wiki-edit-modal').classList.remove('hidden');
    snapForm('wiki-edit-modal');
}

function closeWikiModal() {
    guardClose('wiki-edit-modal', () => { document.getElementById('wiki-edit-modal').classList.add('hidden'); });
}

async function uploadWikiCover(input) {
    const file = input.files[0];
    if(!file) return;
    const url = await uploadToCloudinary(file);
    if(url) document.getElementById('wikiPageCoverUrl').value = url;
}

function submitWikiPage() {
    const pageId = document.getElementById('wikiPageId').value;
    const title = document.getElementById('wikiPageTitle').value.trim();
    const category = document.getElementById('wikiPageCategory').value;
    const content = document.getElementById('wikiPageContent').value;
    const coverImage = document.getElementById('wikiPageCoverUrl').value.trim() || null;
    if(!title) return alert('Un titre est requis.');
    if(pageId) {
        socket.emit('edit_wiki_page', { pageId, title, category, content, coverImage });
    } else {
        socket.emit('create_wiki_page', { title, category, content, coverImage, authorName: USERNAME });
    }
    _unsavedBypass = true;
    clearDraftValue('wiki');
    closeWikiModal();
}

function deleteWikiPage(id) {
    if(!confirm('Supprimer cette page wiki ?')) return;
    socket.emit('delete_wiki_page', { pageId: id });
    if(currentWikiPageId === id) closeWikiPage();
}
// ==================== [FIN WIKI] ====================

// ==================== [BOURSE RANKING] ====================
function syncBourseRankingState() {
    const section = document.getElementById('bourse-ranking-section');
    const toggle = document.getElementById('bourse-ranking-toggle');
    if(!section || !toggle) return;
    section.classList.toggle('collapsed', isBourseRankingCollapsed);
    toggle.setAttribute('aria-expanded', String(!isBourseRankingCollapsed));
    toggle.title = isBourseRankingCollapsed ? 'Déplier le classement' : 'Replier le classement';
    toggle.innerHTML = `<i class="fa-solid fa-chevron-${isBourseRankingCollapsed ? 'down' : 'up'}"></i>`;
}
function toggleBourseRanking(force) {
    isBourseRankingCollapsed = typeof force === 'boolean' ? force : !isBourseRankingCollapsed;
    localStorage.setItem('bourse_ranking_collapsed', isBourseRankingCollapsed ? '1' : '0');
    syncBourseRankingState();
}
function renderBourseRanking(stocks) {
    const list = document.getElementById('bourse-ranking-list');
    if(!list) return;
    syncBourseRankingState();
    if(!stocks || !stocks.length) { list.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0;">Aucune entreprise.</div>'; return; }
    const sorted = [...stocks].sort((a,b) => (b.revenue||0) - (a.revenue||0));
    list.innerHTML = sorted.map((s, i) => {
        const rev = typeof s.revenue === 'number' ? s.revenue.toLocaleString('fr-FR') + ' UC' : '—';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
        const logo = s.companyLogo ? `<img src="${escapeHtml(s.companyLogo)}" class="bourse-ranking-logo" alt="">` : `<div class="bourse-ranking-logo" style="background:var(--bg-3);display:flex;align-items:center;justify-content:center;font-size:1.1rem;">🏢</div>`;
        return `<div class="bourse-ranking-row">
            <span class="bourse-ranking-medal">${medal}</span>
            ${logo}
            <span class="bourse-ranking-name">${escapeHtml(s.companyName || s.symbol)}</span>
            <span class="bourse-ranking-rev">${rev}</span>
        </div>`;
    }).join('');
}

// ==================== [WIKI SEARCH & EDITOR] ====================
function onWikiSearch(query) {
    const q = (query || '').toLowerCase().trim();
    if(!q) { renderWikiList(wikiCache); return; }
    const filtered = wikiCache.filter(p =>
        (p.title||'').toLowerCase().includes(q) ||
        (p.content||'').toLowerCase().includes(q) ||
        (p.category||'').toLowerCase().includes(q)
    );
    renderWikiList(filtered);
}
function clearWikiSearch() {
    const inp = document.getElementById('wiki-search-input');
    if(inp) inp.value = '';
    renderWikiList(wikiCache);
}
function applyWikiFormat(type) {
    const ta = document.getElementById('wikiPageContent');
    if(!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.slice(start, end);
    const line = ta.value.slice(0, start).split('\n').pop() + sel;
    let replacement = '';
    if(type === 'H1')    replacement = `\n# ${sel || 'Titre'}\n`;
    if(type === 'H2')    replacement = `\n## ${sel || 'Sous-titre'}\n`;
    if(type === 'H3')    replacement = `\n### ${sel || 'Section'}\n`;
    if(type === 'B')     replacement = `**${sel || 'texte'}**`;
    if(type === 'I')     replacement = `*${sel || 'texte'}*`;
    if(type === 'QUOTE') replacement = `\n> ${sel || 'Citation'}\n`;
    if(type === 'SEP')   replacement = `\n---\n`;
    ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(end);
    const newPos = start + replacement.length;
    ta.selectionStart = ta.selectionEnd = newPos;
    ta.focus();
    updateWikiWordCount();
}
function updateWikiWordCount() {
    const ta = document.getElementById('wikiPageContent');
    const counter = document.getElementById('wiki-word-count');
    if(!ta || !counter) return;
    const words = ta.value.trim().split(/\s+/).filter(w => w.length > 0).length;
    counter.textContent = `${words} mot(s)`;
}
function toggleWikiPreview() {
    const ta      = document.getElementById('wikiPageContent');
    const preview = document.getElementById('wiki-live-preview');
    if(!ta || !preview) return;
    if(preview.classList.contains('hidden')) {
        preview.innerHTML = renderWikiMarkdown(ta.value);
        preview.classList.remove('hidden');
        ta.style.display = 'none';
    } else {
        preview.classList.add('hidden');
        ta.style.display = '';
    }
}
function renderWikiMarkdown(md) {
    if(!md) return '';
    let html = escapeHtml(md)
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^---$/gm, '<hr>')
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    return html;
}

function buildAdminConsoleOverview() {
    const recentUsers = [...adminUsersCache]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 6);
    const flaggedPosts = [...feedPostsCache]
        .filter(post => post && (post.isBreakingNews || post.isAnonymous || (post.comments || []).length >= 3 || getPostLikeCountValue(post) >= 8))
        .sort((a, b) => new Date(b.timestamp || objectIdToDate(b._id) || 0) - new Date(a.timestamp || objectIdToDate(a._id) || 0))
        .slice(0, 6);
    const stockMoves = [...stocksData]
        .map(stock => {
            const hist = stock.history || [];
            const prev = hist.length >= 2 ? hist[hist.length - 2].value : stock.currentValue;
            const pct = prev ? ((stock.currentValue - prev) / prev) * 100 : 0;
            return {
                stock,
                pct,
                updatedAt: hist.length ? new Date(hist[hist.length - 1].date || objectIdToDate(stock._id) || Date.now()) : objectIdToDate(stock._id)
            };
        })
        .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
        .slice(0, 6);
    const recentEvents = [...eventsCache].slice(0, 6);

    const activity = [
        ...recentUsers.slice(0, 3).map(user => ({
            when: new Date(user.createdAt || objectIdToDate(user._id) || Date.now()),
            icon: 'fa-user-plus',
            tone: 'user',
            text: `${escapeHtml(user.username)} a créé son compte`
        })),
        ...flaggedPosts.slice(0, 3).map(post => ({
            when: new Date(post.timestamp || objectIdToDate(post._id) || Date.now()),
            icon: post.isBreakingNews ? 'fa-burst' : 'fa-bullhorn',
            tone: post.isBreakingNews ? 'alert' : 'post',
            text: `${escapeHtml(post.authorName || 'Auteur inconnu')} a publié un post à surveiller`
        })),
        ...stockMoves.slice(0, 3).map(item => ({
            when: item.updatedAt || new Date(),
            icon: item.pct >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
            tone: item.pct >= 0 ? 'up' : 'down',
            text: `${escapeHtml(item.stock.companyName || 'Action')} ${item.pct >= 0 ? 'progresse' : 'recule'} de ${Math.abs(item.pct).toFixed(2)}%`
        }))
    ].sort((a, b) => (b.when?.getTime?.() || 0) - (a.when?.getTime?.() || 0)).slice(0, 8);

    renderConsoleList('admin-console-activity', activity.map(item => `
        <div class="admin-console-item admin-console-${item.tone}">
            <div class="admin-console-icon"><i class="fa-solid ${item.icon}"></i></div>
            <div class="admin-console-body">
                <div class="admin-console-text">${item.text}</div>
                <div class="admin-console-meta">${formatRelativeDate(item.when)}</div>
            </div>
        </div>`), 'Aucune activité récente.');

    renderConsoleList('admin-console-users', recentUsers.map(user => `
        <button class="admin-console-item admin-console-clickable" onclick="switchAdminTab('users'); expandedAdminUserId='${user._id}'; localStorage.setItem('admin_expanded_user_id','${user._id}'); renderAdminUsers(getFilteredAdminUsers(document.getElementById('admin-user-search')?.value || ''));">
            <div class="admin-console-icon"><i class="fa-solid fa-user"></i></div>
            <div class="admin-console-body">
                <div class="admin-console-text">${escapeHtml(user.username)} <span class="admin-console-badge">${(user.characters || []).length} perso${(user.characters || []).length > 1 ? 's' : ''}</span></div>
                <div class="admin-console-meta">Créé ${formatRelativeDate(new Date(user.createdAt || objectIdToDate(user._id) || Date.now()))}</div>
            </div>
        </button>`), 'Aucun compte récent.');

    renderConsoleList('admin-console-posts', flaggedPosts.map(post => `
        <div class="admin-console-item admin-console-post">
            <div class="admin-console-icon"><i class="fa-solid ${post.isBreakingNews ? 'fa-burst' : post.isAnonymous ? 'fa-user-secret' : 'fa-comment-dots'}"></i></div>
            <div class="admin-console-body">
                <div class="admin-console-text">${escapeHtml(post.authorName || 'Auteur inconnu')} • ${escapeHtml((post.content || '').slice(0, 88) || 'Post sans texte')}${(post.content || '').length > 88 ? '…' : ''}</div>
                <div class="admin-console-meta">${(post.comments || []).length} commentaires • ${getPostLikeCountLabel(post)} likes</div>
            </div>
        </div>`), 'Aucun post à surveiller.');

    renderConsoleList('admin-console-bourse', stockMoves.map(item => `
        <div class="admin-console-item admin-console-${item.pct >= 0 ? 'up' : 'down'}">
            <div class="admin-console-icon"><i class="fa-solid ${item.pct >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i></div>
            <div class="admin-console-body">
                <div class="admin-console-text">${escapeHtml(item.stock.companyName || 'Action')} • ${formatStockValue(item.stock.currentValue)}</div>
                <div class="admin-console-meta">${item.pct >= 0 ? '+' : '−'}${Math.abs(item.pct).toFixed(2)}% • ${formatRelativeDate(item.updatedAt || new Date())}</div>
            </div>
        </div>`), 'Aucune variation bourse disponible.');

    renderConsoleList('admin-console-events', recentEvents.map(event => `
        <div class="admin-console-item admin-console-event">
            <div class="admin-console-icon"><i class="fa-solid fa-calendar-day"></i></div>
            <div class="admin-console-body">
                <div class="admin-console-text">${escapeHtml(event.evenement || 'Événement')}</div>
                <div class="admin-console-meta">${escapeHtml(event.date || 'date inconnue')}${event.heure ? ` • ${escapeHtml(event.heure)}` : ''}</div>
            </div>
        </div>`), 'Aucun événement récent.');

    renderConsoleList('admin-console-audit', adminLogsCache.map(log => `
        <div class="admin-console-item admin-console-${log.timelineTone || 'admin'}">
            <div class="admin-console-icon"><i class="fa-solid fa-scroll"></i></div>
            <div class="admin-console-body">
                <div class="admin-console-text">${escapeHtml(log.message || 'Action admin')}</div>
                <div class="admin-console-meta">${escapeHtml(log.actorUsername || 'admin')} • ${formatRelativeDate(new Date(log.createdAt || Date.now()))}</div>
            </div>
        </div>`), 'Aucune entrée dans le journal admin.');
}

// ==================== [ADMIN PANEL] ====================
let adminUsersCache = [];
let adminCompaniesCache = [];
let pendingAdminStockSelection = null;
function getAdminCharactersCatalog() {
    return adminUsersCache
        .flatMap(user => (Array.isArray(user.characters) ? user.characters.map(char => ({ ...char, ownerUsername: user.username || char.ownerUsername || '' })) : []))
        .filter(char => char && char._id)
        .sort((left, right) => `${left.name || ''}`.localeCompare(`${right.name || ''}`, 'fr'));
}
function populateAdminCompanyOwnerSelect(selectedCharId = '') {
    const select = document.getElementById('admin-company-owner');
    if(!select) return;
    const chars = getAdminCharactersCatalog();
    select.innerHTML = chars.length
        ? chars.map(char => `<option value="${char._id}">${escapeHtml(char.name || 'Sans nom')} · ${escapeHtml(char.ownerUsername || 'n/a')}</option>`).join('')
        : '<option value="">Aucun personnage disponible</option>';
    if(selectedCharId) select.value = selectedCharId;
}
function resetAdminCompanyEditor() {
    ['admin-company-char-id', 'admin-company-index', 'admin-company-old-name', 'admin-company-name', 'admin-company-role', 'admin-company-hq', 'admin-company-revenue', 'admin-company-logo', 'admin-company-description'].forEach(id => {
        const field = document.getElementById(id);
        if(field) field.value = '';
    });
    populateAdminCompanyOwnerSelect('');
    const hint = document.getElementById('admin-company-editor-hint');
    if(hint) hint.textContent = 'Sélectionne une entreprise dans la liste pour la modifier.';
}
function getFilteredAdminUsers(query) {
    const q = (query || '').toLowerCase();
    if(!q) return adminUsersCache;
    return adminUsersCache.filter(u => {
        if((u.username || '').toLowerCase().includes(q)) return true;
        return (u.characters || []).some(char =>
            (char.name || '').toLowerCase().includes(q) ||
            (char.role || '').toLowerCase().includes(q)
        );
    });
}
function toggleAdminUserExpand(userId) {
    expandedAdminUserId = expandedAdminUserId === userId ? null : userId;
    if(expandedAdminUserId) localStorage.setItem('admin_expanded_user_id', expandedAdminUserId);
    else localStorage.removeItem('admin_expanded_user_id');
    renderAdminUsers(getFilteredAdminUsers(document.getElementById('admin-user-search')?.value || ''));
}
function switchAdminTab(tab) {
    currentAdminTab = tab;
    localStorage.setItem('admin_current_tab', tab);
    ['overview', 'users', 'companies', 'site'].forEach(name => {
        const panel = document.getElementById(`admin-panel-${name}`);
        const btn = document.getElementById(`admin-tab-${name}`);
        if(panel) panel.classList.toggle('hidden', name !== tab);
        if(btn) btn.classList.toggle('active', name === tab);
    });
    if(tab === 'users') restorePersistentScroll('admin-users-scroll');
    if(tab === 'companies') restorePersistentScroll('admin-companies-scroll');
    if(tab === 'companies' && !adminCompaniesCache.length) loadAdminCompanies();
}
function loadAdminData() {
    socket.emit('request_admin_stats');
    socket.emit('admin_get_users');
    socket.emit('request_admin_logs');
    loadAdminCompanies();
}
function loadAdminCompanies() {
    socket.emit('request_admin_companies');
}
socket.on('admin_stats_data', (data) => {
    const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    set('stat-users',    data.userCount    ?? '—');
    set('stat-chars',    data.charCount    ?? '—');
    set('stat-posts',    data.postCount    ?? '—');
    set('stat-articles', data.articleCount ?? '—');
    set('stat-msgs',     data.msgCount     ?? '—');
    set('stat-online',   data.onlineCount  ?? '—');
    // Online users list
    const onlineList = document.getElementById('admin-online-list');
    if(onlineList && data.onlineUsers) {
        onlineList.innerHTML = data.onlineUsers.length
            ? data.onlineUsers.map(u => `<span class="admin-online-chip"><i class="fa-solid fa-circle" style="font-size:0.55rem;color:#23a559;"></i> ${escapeHtml(u)}</span>`).join('')
            : '<span style="color:var(--text-muted);font-size:0.82rem;">Aucun utilisateur connecté.</span>';
    }
    buildAdminConsoleOverview();
});
socket.on('admin_users_data', (users) => {
    adminUsersCache = users;
    if(expandedAdminUserId && !users.some(u => u._id === expandedAdminUserId)) expandedAdminUserId = null;
    populateAdminCompanyOwnerSelect(document.getElementById('admin-company-char-id')?.value || '');
    renderAdminUsers(users);
    buildAdminConsoleOverview();
});
socket.on('admin_logs_data', (logs) => {
    adminLogsCache = Array.isArray(logs) ? logs : [];
    buildAdminConsoleOverview();
});
socket.on('admin_companies_data', (companies) => {
    adminCompaniesCache = companies;
    populateAdminCompanyOwnerSelect(document.getElementById('admin-company-char-id')?.value || '');
    renderAdminCompanies(companies);
});
socket.on('admin_action_result', (data) => {
    if(data.success || data.ok) {
        if(data.msg) alert(data.msg);
        loadAdminData();
    }
    else { alert('Erreur : ' + (data.error || 'inconnue')); }
});
function renderAdminUsers(users) {
    const list = document.getElementById('admin-users-list');
    if(!list) return;
    bindPersistentScroll('admin-users-list', 'admin-users-scroll');
    if(!users.length) { list.innerHTML = '<div style="color:var(--text-muted);padding:8px;">Aucun utilisateur.</div>'; return; }
    list.innerHTML = users.map(u => {
        const since = u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr-FR') : '?';
        const adminBadge = u.isAdmin ? '<span class="admin-user-badge admin-badge-admin">admin</span>' : '<span class="admin-user-badge">user</span>';
        const chars = Array.isArray(u.characters) ? u.characters : [];
        const isExpanded = expandedAdminUserId === u._id;
        const safeUsername = String(u.username || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const charsHtml = chars.length
            ? `<div class="admin-user-characters">${chars.map(char => `<span class="admin-char-chip"><img src="${char.avatar || ''}" class="admin-char-chip-avatar" alt=""><button class="admin-char-chip-main" onclick="openProfileById('${char._id}')"><span class="admin-char-chip-name" style="color:${char.color || 'white'}">${escapeHtml(char.name || '')}</span><span class="admin-char-chip-role">${escapeHtml(char.role || '')}</span></button><button class="admin-char-chip-action" onclick="event.stopPropagation(); openProfileById('${char._id}')" title="Profil"><i class="fa-solid fa-user"></i></button><button class="admin-char-chip-action" onclick="event.stopPropagation(); prepareEditAnyCharacter('${char._id}')" title="Modifier"><i class="fa-solid fa-pen"></i></button></span>`).join('')}</div>`
            : '<div class="admin-user-nochars">Aucun personnage</div>';
        return `<div class="admin-user-row ${isExpanded ? 'is-open' : ''}">
            <div class="admin-user-summary ${isExpanded ? 'is-open' : ''}" role="button" tabindex="0" aria-expanded="${isExpanded ? 'true' : 'false'}" onclick="toggleAdminUserExpand('${u._id}')" onkeydown="if(event.key==='Enter' || event.key===' '){ event.preventDefault(); toggleAdminUserExpand('${u._id}'); }">
                <div class="admin-user-info">
                    <span class="admin-user-name">${escapeHtml(u.username)}</span>
                    ${adminBadge}
                    <span class="admin-user-since">depuis ${since}</span>
                    <span class="admin-user-count">${chars.length} perso${chars.length > 1 ? 's' : ''}</span>
                </div>
                <div class="admin-user-actions">
                    <button class="btn-secondary" type="button" style="padding:4px 8px;font-size:0.75rem;" onclick="event.stopPropagation(); adminToggleAdmin('${u._id}',${!u.isAdmin})">
                        ${u.isAdmin ? '<i class="fa-solid fa-user-minus"></i> Retirer admin' : '<i class="fa-solid fa-user-plus"></i> Rendre admin'}
                    </button>
                    <button type="button" style="background:rgba(218,55,60,0.13);color:#da373c;border:1px solid rgba(218,55,60,0.25);padding:4px 8px;font-size:0.75rem;border-radius:var(--radius-sm);cursor:pointer;" onclick="event.stopPropagation(); adminDeleteUser('${u._id}','${safeUsername}')">
                        <i class="fa-solid fa-trash"></i> Supprimer
                    </button>
                    <span class="admin-user-chevron"><i class="fa-solid fa-chevron-down"></i></span>
                </div>
            </div>
            <div class="admin-user-details">
                <div class="admin-user-details-inner">
                    ${charsHtml}
                </div>
            </div>
        </div>`;
    }).join('');
}
function renderAdminCompanies(companies) {
    const list = document.getElementById('admin-companies-list');
    const meta = document.getElementById('admin-companies-meta');
    if(!list) return;
    bindPersistentScroll('admin-companies-list', 'admin-companies-scroll');
    if(meta) {
        const withStock = companies.filter(c => c.stock).length;
        meta.textContent = `${companies.length} entreprise(s) • ${withStock} cotée(s)`;
    }
    if(!companies.length) {
        list.innerHTML = '<div class="admin-empty-state">Aucune entreprise enregistrée.</div>';
        return;
    }
    list.innerHTML = companies.map(item => {
        const company = item.company || {};
        const revenue = Number(company.revenue || 0).toLocaleString('fr-FR');
        const stockBlock = item.stock
            ? `<span class="admin-company-pill"><i class="fa-solid fa-chart-line"></i> Action : ${Number(item.stock.currentValue || 0).toLocaleString('fr-FR')}</span>`
            : '<span class="admin-company-pill muted"><i class="fa-solid fa-chart-line"></i> Non cotée</span>';
        const logo = company.logo
            ? `<img src="${escapeHtml(company.logo)}" class="admin-company-logo" alt="">`
            : '<div class="admin-company-logo admin-company-logo-fallback"><i class="fa-solid fa-building"></i></div>';
        const safeName = String(company.name || '').replace(/'/g, '&#39;');
        return `<div class="admin-company-card">
            <div class="admin-company-head">
                ${logo}
                <div class="admin-company-head-text">
                    <div class="admin-company-name">${escapeHtml(company.name || 'Entreprise sans nom')}</div>
                    <div class="admin-company-owner">${escapeHtml(item.charName)} • ${escapeHtml(item.ownerUsername || 'n/a')}</div>
                </div>
            </div>
            <div class="admin-company-tags">
                <span class="admin-company-pill"><i class="fa-solid fa-coins"></i> CA : ${revenue}</span>
                ${company.headquarters ? `<span class="admin-company-pill"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(company.headquarters)}</span>` : ''}
                ${stockBlock}
            </div>
            ${company.role ? `<div class="admin-company-role">${escapeHtml(company.role)}</div>` : ''}
            ${company.description ? `<div class="admin-company-desc">${escapeHtml(company.description)}</div>` : ''}
            <div class="admin-company-actions">
                <button class="btn-secondary" onclick="editAdminCompany('${item.charId}', ${item.companyIndex})"><i class="fa-solid fa-pen"></i> Modifier</button>
                <button class="btn-secondary" onclick="adminSetCompanyRevenue('${item.charId}', '${safeName}', ${Number(company.revenue || 0)})"><i class="fa-solid fa-sack-dollar"></i> CA</button>
                ${item.stock ? `<button class="btn-secondary" onclick="openStockEditModal('${item.stock.stockId}')"><i class="fa-solid fa-chart-line"></i> Action</button>` : `<button class="btn-secondary" onclick="openStockAddModalForCompany('${item.charId}', '${String(item.charName || '').replace(/'/g, '&#39;')}', '${String(item.charColor || '').replace(/'/g, '&#39;')}', '${safeName}', '${String(company.logo || '').replace(/'/g, '&#39;')}')"><i class="fa-solid fa-plus"></i> Coter</button>`}
                <button class="admin-danger-btn" onclick="adminRemoveCompany('${item.charId}', ${item.companyIndex})"><i class="fa-solid fa-trash"></i> Supprimer</button>
            </div>
        </div>`;
    }).join('');
}
function filterAdminCompanies(query) {
    const q = (query || '').trim().toLowerCase();
    localStorage.setItem('admin_company_search', query || '');
    if(!q) return renderAdminCompanies(adminCompaniesCache);
    renderAdminCompanies(adminCompaniesCache.filter(item => {
        const company = item.company || {};
        return [company.name, company.role, company.headquarters, company.description, item.charName, item.ownerUsername]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(q));
    }));
}
function editAdminCompany(charId, companyIndex) {
    const item = adminCompaniesCache.find(entry => String(entry.charId) === String(charId) && Number(entry.companyIndex) === Number(companyIndex));
    if(!item) return;
    populateAdminCompanyOwnerSelect(item.charId);
    document.getElementById('admin-company-char-id').value = item.charId;
    document.getElementById('admin-company-index').value = item.companyIndex;
    document.getElementById('admin-company-old-name').value = item.company.name || '';
    document.getElementById('admin-company-name').value = item.company.name || '';
    document.getElementById('admin-company-role').value = item.company.role || '';
    document.getElementById('admin-company-hq').value = item.company.headquarters || '';
    document.getElementById('admin-company-revenue').value = item.company.revenue || 0;
    document.getElementById('admin-company-logo').value = item.company.logo || '';
    document.getElementById('admin-company-description').value = item.company.description || '';
    const hint = document.getElementById('admin-company-editor-hint');
    if(hint) hint.textContent = `Édition de ${item.company.name} rattachée à ${item.charName}.`;
    switchAdminTab('companies');
}
function transferAdminCompanyOwner() {
    const fromCharId = document.getElementById('admin-company-char-id')?.value;
    const toCharId = document.getElementById('admin-company-owner')?.value;
    const companyIndex = Number(document.getElementById('admin-company-index')?.value);
    if(!fromCharId || Number.isNaN(companyIndex)) return alert('Sélectionne une entreprise à transférer.');
    if(!toCharId || String(toCharId) === String(fromCharId)) return alert('Choisis un autre personnage propriétaire.');
    socket.emit('admin_transfer_company', { fromCharId, toCharId, companyIndex });
}
function saveAdminCompanyEdit() {
    const charId = document.getElementById('admin-company-char-id')?.value;
    const companyIndex = Number(document.getElementById('admin-company-index')?.value);
    const company = {
        name: document.getElementById('admin-company-name')?.value?.trim() || '',
        role: document.getElementById('admin-company-role')?.value?.trim() || '',
        headquarters: document.getElementById('admin-company-hq')?.value?.trim() || '',
        revenue: Number(document.getElementById('admin-company-revenue')?.value) || 0,
        logo: document.getElementById('admin-company-logo')?.value?.trim() || '',
        description: document.getElementById('admin-company-description')?.value?.trim() || ''
    };
    if(!charId || Number.isNaN(companyIndex)) return alert('Sélectionne une entreprise à modifier.');
    if(!company.name) return alert('Nom de l\'entreprise requis.');
    socket.emit('admin_update_company', {
        charId,
        companyIndex,
        oldCompanyName: document.getElementById('admin-company-old-name')?.value || company.name,
        company
    });
}
function openStockAddModalForCompany(charId, charName, charColor, companyName, companyLogo) {
    pendingAdminStockSelection = { charId, charName, charColor, companyName, companyLogo };
    openStockAddModal();
}
function openStockAddModalForAdminCompany() {
    const charId = document.getElementById('admin-company-char-id')?.value;
    const companyIndex = Number(document.getElementById('admin-company-index')?.value);
    if(!charId || Number.isNaN(companyIndex)) return alert('Sélectionne une entreprise à coter.');
    const item = adminCompaniesCache.find(entry => String(entry.charId) === String(charId) && Number(entry.companyIndex) === companyIndex);
    if(!item) return;
    openStockAddModalForCompany(item.charId, item.charName, item.charColor || '', item.company.name || '', item.company.logo || '');
}
function adminToggleAdmin(userId, makeAdmin) {
    if(!confirm(`${makeAdmin ? 'Rendre admin' : 'Retirer admin'} cet utilisateur ?`)) return;
    socket.emit('admin_set_admin', { targetUserId: userId, makeAdmin });
}
function adminDeleteUser(userId, username) {
    if(!confirm(`Supprimer définitivement le compte « ${username} » et tous ses personnages ?`)) return;
    socket.emit('admin_delete_user', { targetUserId: userId });
}
function adminClearAllPosts() {
    socket.emit('admin_clear_all_posts');
}

function normalizeSpaButtons(root = document) {
    if(!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('button:not([type])').forEach((button) => {
        button.type = 'button';
    });
}

function preventNativeSpaReloads() {
    normalizeSpaButtons();

    document.addEventListener('submit', (event) => {
        const form = event.target;
        if(form instanceof HTMLFormElement && !form.hasAttribute('data-allow-native-submit')) {
            event.preventDefault();
        }
    });

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if(!(node instanceof HTMLElement)) return;
                if(node.matches('button:not([type])')) node.type = 'button';
                normalizeSpaButtons(node);
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

window.addEventListener('DOMContentLoaded', () => {
    preventNativeSpaReloads();
    const bourseInput = document.getElementById('bourse-search-input');
    if(bourseInput) bourseInput.value = localStorage.getItem('bourse_search') || '';
    bourseSearch = (localStorage.getItem('bourse_search') || '').trim().toLowerCase();
    bourseSort = localStorage.getItem('bourse_sort') || 'marketCapDesc';

    const adminUserSearch = document.getElementById('admin-user-search');
    if(adminUserSearch) adminUserSearch.value = localStorage.getItem('admin_user_search') || '';

    const adminCompanySearch = document.getElementById('admin-company-search');
    if(adminCompanySearch) adminCompanySearch.value = localStorage.getItem('admin_company_search') || '';

    bindPersistentScroll('admin-users-list', 'admin-users-scroll');
    bindPersistentScroll('admin-companies-list', 'admin-companies-scroll');
    bindPersistentScroll('notif-list', 'notif-list-scroll');
    bindPersistentScroll('view-bourse', 'bourse-scroll');
    syncBourseFilterUI();
});
function adminSetAlertQuick(active) {
    const msg   = document.getElementById('adminAlertMsgQuick')?.value?.trim() || '';
    const color = document.getElementById('adminAlertColorQuick')?.value || 'orange';
    socket.emit('admin_set_alert', { active, message: msg, color });
}
function adminNextTradingDay() {
    if(!confirm('Avancer au prochain jour de trading ? Les actions non modifiées recevront automatiquement une variation stable entre -0,1% et 0,1%.')) return;
    socket.emit('admin_next_trading_day');
}
