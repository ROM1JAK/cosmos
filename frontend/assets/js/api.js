window.CosmosModules = window.CosmosModules || {};
window.CosmosModules.api = { scope: 'api', mode: 'module' };

async function uploadToCloudinary(file, resourceType) {
	if (!file) return null;
	if (!resourceType) {
		if (file.type.startsWith('image/')) resourceType = 'image';
		else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) resourceType = 'video';
		else resourceType = 'auto';
	}
	const formData = new FormData();
	if (file instanceof Blob && !file.name) {
		const ext = file.type.split('/')[1] || 'dat';
		formData.append('file', file, `upload.${ext}`);
	} else {
		formData.append('file', file);
	}
	formData.append('upload_preset', CLOUDINARY_PRESET);
	const uploadUrl = `${CLOUDINARY_BASE_URL}/${resourceType}/upload`;
	try {
		const response = await fetch(uploadUrl, { method: 'POST', body: formData });
		if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
		const data = await response.json();
		return data.secure_url;
	} catch (error) {
		console.error('Erreur Upload:', error);
		alert(`Erreur envoi média : ${error.message}`);
		return null;
	}
}

function objectIdToDate(id) {
	if (!id || typeof id !== 'string' || id.length < 8) return null;
	const timestamp = parseInt(id.slice(0, 8), 16);
	if (Number.isNaN(timestamp)) return null;
	return new Date(timestamp * 1000);
}

function extractArticleTitle(content = '') {
	const match = String(content).match(/^\[TITRE\](.*?)\[\/TITRE\]\n?([\s\S]*)/);
	if (match) return match[1].trim();
	return String(content).split(/\s+/).slice(0, 10).join(' ').trim();
}

function extractTextPreview(text = '', length = 120) {
	return String(text).replace(/\[TITRE\].*?\[\/TITRE\]\n?/g, '').replace(/\s+/g, ' ').trim().slice(0, length);
}

function formatRelativeDate(date) {
	if (!date) return 'date inconnue';
	const diffMs = Date.now() - date.getTime();
	const minutes = Math.max(1, Math.round(diffMs / 60000));
	if (minutes < 60) return `il y a ${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `il y a ${hours} h`;
	const days = Math.round(hours / 24);
	if (days < 7) return `il y a ${days} j`;
	return date.toLocaleDateString('fr-FR');
}

function renderConsoleList(targetId, items, emptyText) {
	const target = document.getElementById(targetId);
	if (!target) return;
	if (!items.length) {
		target.innerHTML = `<div class="admin-console-empty">${emptyText}</div>`;
		return;
	}
	target.innerHTML = items.join('');
}

function previewImg(input, previewId) {
	const preview = document.getElementById(previewId);
	if (!preview || !input.files || !input.files[0]) return;
	const reader = new FileReader();
	reader.onload = e => {
		preview.src = e.target.result;
		preview.classList.remove('hidden');
	};
	reader.readAsDataURL(input.files[0]);
}

function escapeHtml(text) {
	const d = document.createElement('div');
	d.appendChild(document.createTextNode(text));
	return d.innerHTML;
}
