const fs = require('fs');
const path = require('path');

const backendUrl = (process.env.BACKEND_URL || '').trim() || 'http://localhost:3000';
const targetPath = path.join(__dirname, '..', 'frontend', 'assets', 'js', 'render-config.js');

const content = [
	'window.APP_CONFIG = window.APP_CONFIG || {};',
	`window.APP_CONFIG.BACKEND_URL = ${JSON.stringify(backendUrl)};`,
	''
].join('\n');

fs.writeFileSync(targetPath, content, 'utf8');
console.log(`Config frontend ecrite dans ${targetPath} avec BACKEND_URL=${backendUrl}`);