#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Script complet de restructuration HTML pour Cosmos"""

import re
import shutil

# Backup original
shutil.copy('public/index.html', 'public/index.html.bak')

with open('public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# ── Find key positions ──────────────────────────────────────────────────────
VIEW_CHAT_START = content.find('<div id="view-chat" class="view-section hidden">')
PRESSE_MARKER   = content.find('<!-- PRESSE VIEW -->')
CHAR_MP_COMMENT = content.find('<!-- ===== VUE MP PERSONNAGES (Refonte) ===== -->')
NEW_CONV_MODAL  = content.find('<!-- Modale Nouvelle Conversation -->')

print(f"view-chat start: {VIEW_CHAT_START}, presse: {PRESSE_MARKER}, char-mp: {CHAR_MP_COMMENT}, new-conv: {NEW_CONV_MODAL}")

# ── Extract content segments ─────────────────────────────────────────────────
chat_feed_segment = content[VIEW_CHAT_START:PRESSE_MARKER]

VIEW_FEED_POS = chat_feed_segment.find('<div id="view-feed"')
chat_only = chat_feed_segment[:VIEW_FEED_POS]
feed_only = chat_feed_segment[VIEW_FEED_POS:]

# Strip outer div wrappers
def strip_outer_div(html):
    html = re.sub(r'^<div[^>]*>\s*', '', html.strip(), count=1)
    html = re.sub(r'\s*</div>\s*$', '', html)
    return html.strip()

chat_inner = strip_outer_div(chat_only)
feed_inner = strip_outer_div(feed_only)

# Extract char-mp inner content
char_mp_raw = content[CHAR_MP_COMMENT:NEW_CONV_MODAL]
# Remove the outer comment and view-char-mp div
char_mp_inner_match = re.search(r'<div id="view-char-mp"[^>]*>(.*)</div>\s*$', char_mp_raw, re.DOTALL)
if char_mp_inner_match:
    char_mp_inner = char_mp_inner_match.group(1).strip()
else:
    char_mp_inner_match = re.search(r'(<div class="char-mp-layout">.*)', char_mp_raw, re.DOTALL)
    char_mp_inner = char_mp_inner_match.group(1).strip() if char_mp_inner_match else ""

print(f"Chat inner: {len(chat_inner)}, Feed inner: {len(feed_inner)}, MP inner: {len(char_mp_inner)}")

# ── view-reseau HTML ─────────────────────────────────────────────────────────
def re_indent(text, n=16):
    return '\n'.join((' ' * n + l) if l.strip() else l for l in text.split('\n'))

view_reseau_html = f"""        <!-- ===== [RÉSEAU] : Chat | Flux Social | MP Perso ===== -->
        <div id="view-reseau" class="view-section hidden" style="flex-direction:column;">

            <!-- Barre d'onglets réseau -->
            <div class="reseau-tabbar">
                <button class="reseau-tab active" id="reseau-tab-chat" onclick="switchReseauTab('chat')">
                    <i class="fa-solid fa-comments"></i><span class="reseau-tab-label"> Chat</span>
                </button>
                <button class="reseau-tab" id="reseau-tab-flux" onclick="switchReseauTab('flux')" style="position:relative;">
                    <i class="fa-solid fa-bullhorn"></i><span class="reseau-tab-label"> Flux Social</span>
                    <span id="reseau-flux-badge" class="reseau-tab-badge hidden"></span>
                </button>
                <button class="reseau-tab" id="reseau-tab-mp" onclick="switchReseauTab('mp')" style="position:relative;">
                    <i class="fa-solid fa-user-group"></i><span class="reseau-tab-label"> MP Perso</span>
                    <span id="char-mp-badge" class="reseau-tab-badge hidden"></span>
                </button>
            </div>

            <!-- Panel Chat -->
            <div id="reseau-panel-chat" class="reseau-panel">
{re_indent(chat_inner, 16)}
            </div>

            <!-- Panel Flux Social -->
            <div id="reseau-panel-flux" class="reseau-panel hidden">
{re_indent(feed_inner, 16)}
            </div>

            <!-- Panel MP Perso -->
            <div id="reseau-panel-mp" class="reseau-panel hidden">
{re_indent(char_mp_inner, 16)}
            </div>

        </div>
        <!-- ===== [FIN RÉSEAU] ===== -->

        <!-- PRESSE VIEW -->"""

# ── Apply change 1: Replace view-chat + view-feed with view-reseau ───────────
content = content[:VIEW_CHAT_START] + view_reseau_html + content[PRESSE_MARKER:]
print("✅ view-reseau applied")

# ── Apply change 2: Remove standalone view-char-mp ───────────────────────────
C2  = content.find('<!-- ===== VUE MP PERSONNAGES (Refonte) ===== -->')
NC2 = content.find('<!-- Modale Nouvelle Conversation -->')
if C2 >= 0 and NC2 > C2:
    content = content[:C2] + content[NC2:]
    print("✅ Standalone view-char-mp removed")
else:
    print(f"⚠️  char-mp at {C2}, new-conv at {NC2}")

# ── Apply change 3: Bourse ranking section ───────────────────────────────────
ranking_block = """                <!-- Classement entreprises / CA -->
                <div id="bourse-ranking-section" class="bourse-ranking-section">
                    <div class="bourse-ranking-title"><i class="fa-solid fa-trophy"></i> Classement Entreprises par CA</div>
                    <div id="bourse-ranking-list" class="bourse-ranking-list"></div>
                </div>

                <!-- Stocks grid -->"""
old_stocks = '                <!-- Stocks grid -->'
if old_stocks in content:
    content = content.replace(old_stocks, ranking_block, 1)
    print("✅ Bourse ranking added")
else:
    print("⚠️  stocks grid comment not found")

# ── Apply change 4: Wiki search bar ──────────────────────────────────────────
wiki_h_old = """                <div class="wiki-header">
                    <div>
                        <h2 class="wiki-title"><i class="fa-solid fa-book-open"></i> Wiki</h2>
                        <div class="wiki-subtitle">Encyclopédie collaborative du monde de Cosmos</div>
                    </div>
                    <div id="wiki-admin-header" class="hidden">
                        <button class="btn-primary" onclick="openWikiCreateModal()"><i class="fa-solid fa-plus"></i> Nouvelle page</button>
                    </div>
                </div>"""
wiki_h_new = """                <div class="wiki-header">
                    <div>
                        <h2 class="wiki-title"><i class="fa-solid fa-book-open"></i> Wiki</h2>
                        <div class="wiki-subtitle">Encyclopédie collaborative du monde de Cosmos</div>
                    </div>
                    <div class="wiki-search-wrap">
                        <i class="fa-solid fa-magnifying-glass wiki-search-icon"></i>
                        <input type="text" id="wiki-search-input" class="wiki-search-input" placeholder="Rechercher une page…" oninput="onWikiSearch(this.value)">
                        <button class="btn-secondary" style="padding:6px 10px;" onclick="clearWikiSearch()"><i class="fa-solid fa-eraser"></i></button>
                    </div>
                    <div id="wiki-admin-header" class="hidden">
                        <button class="btn-primary" onclick="openWikiCreateModal()"><i class="fa-solid fa-plus"></i> Nouvelle page</button>
                    </div>
                </div>"""
if wiki_h_old in content:
    content = content.replace(wiki_h_old, wiki_h_new, 1)
    print("✅ Wiki search bar added")
else:
    print("⚠️  Wiki header not found")

# ── Apply change 5: Wiki modal format toolbar ─────────────────────────────────
wiki_m_old = '            <label class="cfl" style="margin-top:10px;">Contenu</label>\n            <textarea id="wikiPageContent"'
wiki_m_new = """            <label class="cfl" style="margin-top:10px;">Contenu</label>
            <div class="wiki-format-toolbar">
                <button type="button" class="btn-secondary" onclick="applyWikiFormat('H1')">H1</button>
                <button type="button" class="btn-secondary" onclick="applyWikiFormat('H2')">H2</button>
                <button type="button" class="btn-secondary" onclick="applyWikiFormat('H3')">H3</button>
                <button type="button" class="btn-secondary" onclick="applyWikiFormat('B')"><b>Gras</b></button>
                <button type="button" class="btn-secondary" onclick="applyWikiFormat('I')"><em>Italique</em></button>
                <button type="button" class="btn-secondary" onclick="applyWikiFormat('QUOTE')">❝ Citation</button>
                <button type="button" class="btn-secondary" onclick="applyWikiFormat('SEP')">── Sépar.</button>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:0.75rem;color:var(--text-muted);">
                <span id="wiki-word-count">0 mot(s)</span>
                <button type="button" class="btn-secondary" style="padding:3px 8px;font-size:0.72rem;" onclick="toggleWikiPreview()"><i class="fa-solid fa-eye"></i> Prévisualiser</button>
            </div>
            <textarea id="wikiPageContent\""""
if wiki_m_old in content:
    content = content.replace(wiki_m_old, wiki_m_new, 1)
    print("✅ Wiki format toolbar added")
else:
    print("⚠️  Wiki modal not found:", wiki_m_old[:60])

# ── Apply change 6: Wiki live preview (after textarea) ───────────────────────
wiki_ta_old = 'rows="10" style="resize:vertical; font-family:monospace; font-size:0.82rem;"></textarea>'
wiki_ta_new = 'rows="10" style="resize:vertical; font-family:monospace; font-size:0.82rem;" oninput="updateWikiWordCount()"></textarea>\n            <div id="wiki-live-preview" class="wiki-live-preview hidden"></div>'
if wiki_ta_old in content:
    content = content.replace(wiki_ta_old, wiki_ta_new, 1)
    print("✅ Wiki live preview added")
else:
    print("⚠️  Wiki textarea old string not found")

# ── Apply change 7: view-admin ────────────────────────────────────────────────
view_admin_html = """
        <!-- ===== [ADMIN] VUE ===== -->
        <div id="view-admin" class="view-section hidden" style="flex-direction:column;">
            <div class="admin-container">
                <div class="admin-header">
                    <div>
                        <h2 class="admin-title"><i class="fa-solid fa-shield-halved"></i> Panneau Admin</h2>
                        <div class="admin-subtitle">Tableau de bord — ConvSmos</div>
                    </div>
                    <button class="btn-primary" onclick="loadAdminData()"><i class="fa-solid fa-rotate"></i> Actualiser</button>
                </div>

                <div class="admin-section">
                    <div class="admin-section-title"><i class="fa-solid fa-chart-bar"></i> Statistiques</div>
                    <div class="admin-stats-grid">
                        <div class="admin-stat-card"><div class="admin-stat-icon"><i class="fa-solid fa-users"></i></div><div class="admin-stat-value" id="stat-users">—</div><div class="admin-stat-label">Utilisateurs</div></div>
                        <div class="admin-stat-card"><div class="admin-stat-icon"><i class="fa-solid fa-id-card"></i></div><div class="admin-stat-value" id="stat-chars">—</div><div class="admin-stat-label">Personnages</div></div>
                        <div class="admin-stat-card"><div class="admin-stat-icon"><i class="fa-solid fa-message"></i></div><div class="admin-stat-value" id="stat-posts">—</div><div class="admin-stat-label">Posts Feed</div></div>
                        <div class="admin-stat-card"><div class="admin-stat-icon"><i class="fa-solid fa-newspaper"></i></div><div class="admin-stat-value" id="stat-articles">—</div><div class="admin-stat-label">Articles Presse</div></div>
                        <div class="admin-stat-card"><div class="admin-stat-icon"><i class="fa-solid fa-comments"></i></div><div class="admin-stat-value" id="stat-msgs">—</div><div class="admin-stat-label">Messages Chat</div></div>
                        <div class="admin-stat-card admin-stat-online-card"><div class="admin-stat-icon online-icon"><i class="fa-solid fa-circle"></i></div><div class="admin-stat-value admin-stat-online-val" id="stat-online">—</div><div class="admin-stat-label">En ligne</div></div>
                    </div>
                </div>

                <div class="admin-section">
                    <div class="admin-section-title"><i class="fa-solid fa-circle-dot" style="color:#23a559;"></i> Connectés maintenant</div>
                    <div id="admin-online-list" class="admin-online-list"></div>
                </div>

                <div class="admin-section">
                    <div class="admin-section-title"><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> Bandeau d'Alerte Global</div>
                    <div class="admin-alert-quick">
                        <input type="text" id="adminAlertMsgQuick" class="modal-input" placeholder="Message du bandeau d'alerte…" style="flex:1;margin:0;">
                        <select id="adminAlertColorQuick" class="modal-input" style="width:auto;margin:0;">
                            <option value="red">🔴 Rouge</option>
                            <option value="orange">🟠 Orange</option>
                            <option value="yellow">🟡 Jaune</option>
                            <option value="blue">🔵 Bleu</option>
                            <option value="green">🟢 Vert</option>
                        </select>
                        <button class="btn-primary" onclick="adminSetAlertQuick(true)"><i class="fa-solid fa-check"></i> Activer</button>
                        <button class="btn-secondary" onclick="adminSetAlertQuick(false)"><i class="fa-solid fa-xmark"></i> Désactiver</button>
                    </div>
                </div>

                <div class="admin-section">
                    <div class="admin-section-title"><i class="fa-solid fa-users-gear"></i> Gestion des Utilisateurs</div>
                    <input type="text" id="admin-user-search" class="modal-input" placeholder="Filtrer par pseudo…" oninput="filterAdminUsers(this.value)" style="margin-bottom:10px;">
                    <div id="admin-users-list" class="admin-users-list"></div>
                </div>

                <div class="admin-section">
                    <div class="admin-section-title"><i class="fa-solid fa-bolt"></i> Actions Rapides</div>
                    <div class="admin-actions-grid">
                        <button class="btn-primary" onclick="adminNextTradingDay()"><i class="fa-solid fa-forward-step"></i> Avancer Bourse</button>
                        <button class="btn-secondary" onclick="loadAdminData()"><i class="fa-solid fa-rotate"></i> Rafraîchir</button>
                        <button class="btn-secondary" onclick="switchView('bourse')"><i class="fa-solid fa-chart-line"></i> Bourse</button>
                        <button class="btn-secondary" onclick="switchView('wiki')"><i class="fa-solid fa-book-open"></i> Wiki</button>
                        <button class="btn-secondary" onclick="switchView('presse')"><i class="fa-solid fa-newspaper"></i> Presse</button>
                        <button class="btn-secondary" onclick="switchView('cites')"><i class="fa-solid fa-city"></i> Cités</button>
                        <button style="background:rgba(218,55,60,0.15);color:#da373c;border:1px solid rgba(218,55,60,0.3);padding:9px 14px;border-radius:var(--radius-sm);cursor:pointer;font-weight:600;font-family:var(--font-main);" onclick="if(confirm('Supprimer TOUS les posts du feed ?')) adminClearAllPosts()"><i class="fa-solid fa-trash"></i> Vider les posts</button>
                    </div>
                </div>
            </div>
        </div>
        <!-- ===== [FIN ADMIN] ===== -->
"""
fin_wiki = '        <!-- ===== [FIN WIKI] ===== -->'
if fin_wiki in content:
    content = content.replace(fin_wiki, view_admin_html + fin_wiki, 1)
    print("✅ view-admin added")
else:
    print("⚠️  FIN WIKI not found")

# ── Write output ──────────────────────────────────────────────────────────────
with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

orig_size = len(open('public/index.html.bak', 'r', encoding='utf-8').read())
print(f"\n✅ Done! File: {len(content)} chars (was {orig_size})")

