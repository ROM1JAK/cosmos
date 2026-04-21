(function initCosmosMaps() {
  if (window.__cosmosMapsModuleLoaded) return;
  window.__cosmosMapsModuleLoaded = true;

  const MAP_CONFIG = {
    'archipel-pacifique': {
      label: 'Archipel Pacifique',
      src: 'assets/maps/archipel-pacifique.html'
    },
    'archipel-sableuse': {
      label: 'Archipel Sableuse',
      src: 'assets/maps/archipel-sableuse.html'
    },
    'ancienne-archipel': {
      label: 'Ancienne Archipel',
      src: 'assets/maps/ancienne-archipel.html'
    }
  };

  const CITY_NAME_ALIASES = {
    pagoass: 'Pagoas Sud',
    pagoasn: 'Pagoas Nord',
    bilerland: 'Bireland',
    'diktat kirchia': 'Kirchia',
    bambewen: 'Bambeween'
  };

  const MAP_MARKER_CATEGORY_META = {
    general: { label: 'Repères', icon: 'fa-location-dot', color: '#f97316' },
    port: { label: 'Ports', icon: 'fa-anchor', color: '#0ea5e9' },
    airport: { label: 'Avions', icon: 'fa-plane', color: '#8b5cf6' },
    company: { label: 'Entreprises', icon: 'fa-building', color: '#10b981' },
    military: { label: 'Militaire', icon: 'fa-shield-halved', color: '#ef4444' },
    'breaking-news': { label: 'Breaking News', icon: 'fa-bullhorn', color: '#facc15' }
  };

  const MAP_CATEGORY_FILTERS_STORAGE_KEY = 'cosmos_map_category_filters_v1';

  let currentWorldMapKey = 'archipel-pacifique';
  let worldMapMarkupCache = {};
  let mapMarkersData = [];
  let mapOverlaysData = [];
  let selectedMapMarkerId = null;
  let selectedMapOverlayId = null;
  let mapPlacementArmed = false;
  let mapRegionSelectionArmed = false;
  let selectedRegionIds = [];
  let mapCategoryFilters = loadSavedMapCategoryFilters();

  function normalizeLabel(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function getCurrentMapConfig() {
    return MAP_CONFIG[currentWorldMapKey] || MAP_CONFIG['archipel-pacifique'];
  }

  function getMarkerMeta(category) {
    return MAP_MARKER_CATEGORY_META[category] || MAP_MARKER_CATEGORY_META.general;
  }

  function loadSavedMapCategoryFilters() {
    const defaults = Object.fromEntries(Object.keys(MAP_MARKER_CATEGORY_META).map(key => [key, true]));
    try {
      const raw = localStorage.getItem(MAP_CATEGORY_FILTERS_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return Object.keys(defaults).reduce((acc, key) => {
        acc[key] = parsed[key] !== false;
        return acc;
      }, {});
    } catch (_error) {
      return defaults;
    }
  }

  function saveMapCategoryFilters() {
    localStorage.setItem(MAP_CATEGORY_FILTERS_STORAGE_KEY, JSON.stringify(mapCategoryFilters));
  }

  function getCityByName(name) {
    const normalizedName = normalizeLabel(name);
    const canonicalName = CITY_NAME_ALIASES[normalizedName] || name;
    return (citiesData || []).find(city => normalizeLabel(city.name) === normalizeLabel(canonicalName)) || null;
  }

  function getCityById(cityId) {
    return (citiesData || []).find(city => String(city._id) === String(cityId)) || null;
  }

  function getMarkerById(markerId) {
    return mapMarkersData.find(marker => String(marker._id) === String(markerId)) || null;
  }

  function getOverlayById(overlayId) {
    return mapOverlaysData.find(overlay => String(overlay._id) === String(overlayId)) || null;
  }

  function getCurrentMapMarkers() {
    return mapMarkersData.filter(marker => marker.mapKey === currentWorldMapKey);
  }

  function getVisibleMapMarkers() {
    return getCurrentMapMarkers().filter(marker => mapCategoryFilters[marker.category] !== false);
  }

  function getCurrentMapOverlays() {
    return mapOverlaysData.filter(overlay => overlay.mapKey === currentWorldMapKey);
  }

  function formatRelationSince(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatMapMarkerMeta(marker) {
    const meta = getMarkerMeta(marker.category);
    const parts = [getCurrentMapConfig().label, meta.label];
    if (marker.cityId?.name) parts.push(marker.cityId.name);
    return parts.join(' · ');
  }

  function renderCityDetailRelations(city) {
    const container = document.getElementById('cityDetailRelations');
    if (!container || !city) return;

    if (!cityRelationsData || !cityRelationsData.length) {
      container.innerHTML = '<div class="city-relations-empty">Chargement des relations diplomatiques…</div>';
      if (typeof loadCityRelations === 'function') loadCityRelations();
      return;
    }

    const related = cityRelationsData
      .filter(rel => (rel.relationScope || 'city') === 'city')
      .filter(rel => String(rel.cityA?._id) === String(city._id) || String(rel.cityB?._id) === String(city._id))
      .sort((left, right) => {
        const leftTier = DIPLO_STATUS_META[left.status]?.tier ?? 99;
        const rightTier = DIPLO_STATUS_META[right.status]?.tier ?? 99;
        return rightTier - leftTier;
      });

    if (!related.length) {
      container.innerHTML = '<div class="city-relations-empty">Aucune relation diplomatique enregistrée pour cette cité.</div>';
      return;
    }

    container.innerHTML = related.map(rel => {
      const otherCity = String(rel.cityA?._id) === String(city._id) ? rel.cityB : rel.cityA;
      const meta = DIPLO_STATUS_META[rel.status] || { label: rel.status || 'Inconnue', icon: '❓' };
      const otherFlag = otherCity?.flag
        ? `<img src="${escapeHtml(otherCity.flag)}" class="city-relations-flag" alt="">`
        : '<div class="diplo-city-flag-ph city-relations-flag"><i class="fa-solid fa-flag"></i></div>';
      const since = formatRelationSince(rel.since);
      const openAction = otherCity?._id ? `onclick="openCityFromMapRelation('${escapeHtml(String(otherCity._id))}')"` : '';

      return `
        <div class="city-relations-item" ${openAction}>
          ${otherFlag}
          <div class="city-relations-content">
            <div class="city-relations-head">
              <div class="city-relations-name">${escapeHtml(otherCity?.name || '—')}</div>
              <span class="diplo-status-badge diplo-badge-${escapeHtml(rel.status || 'neutre')}">${meta.icon} ${escapeHtml(meta.label)}</span>
            </div>
            ${since ? `<div class="city-relations-meta">Depuis le ${escapeHtml(since)}</div>` : ''}
            ${rel.description ? `<div class="city-relations-desc">${escapeHtml(rel.description)}</div>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function openFeedPostFromMarker(postId) {
    if (!postId) return;
    const safePostId = String(postId);
    if (typeof loadFeed === 'function') loadFeed();
    if (typeof openTimelineTarget === 'function') openTimelineTarget('feed', { postId: safePostId });
    else if (typeof switchView === 'function') switchView('feed');

    let remainingAttempts = 10;
    const tryOpen = () => {
      const postEl = document.getElementById(`post-${safePostId}`);
      if (postEl && typeof openPostDetail === 'function') {
        openPostDetail(safePostId);
        return;
      }
      if (remainingAttempts <= 0) return;
      remainingAttempts -= 1;
      if (typeof loadFeed === 'function') loadFeed();
      setTimeout(tryOpen, 250);
    };

    setTimeout(tryOpen, 180);
  }

  function getSvgRegionElement(targetId) {
    return targetId ? document.getElementById(String(targetId)) : null;
  }

  function renderMapCategoryFilters() {
    const container = document.getElementById('mapCategoryFilters');
    if (!container) return;

    container.innerHTML = Object.entries(MAP_MARKER_CATEGORY_META).map(([category, meta]) => {
      const active = mapCategoryFilters[category] !== false;
      return `
        <button
          class="map-filter-chip ${active ? 'active' : ''}"
          type="button"
          data-category="${escapeHtml(category)}"
        >
          <i class="fa-solid ${escapeHtml(meta.icon)}"></i>
          <span>${escapeHtml(meta.label)}</span>
        </button>`;
    }).join('');

    container.querySelectorAll('.map-filter-chip').forEach(button => {
      button.onclick = () => window.toggleMapCategoryFilter(button.dataset.category);
    });
  }

  function renderRegionSelectionHint() {
    const hint = document.getElementById('worldMapRegionsHint');
    if (!hint) return;

    if (!IS_ADMIN || !mapRegionSelectionArmed) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }

    hint.classList.remove('hidden');
    hint.textContent = selectedRegionIds.length
      ? `Sélection en cours : ${selectedRegionIds.join(', ')}`
      : 'Sélection en cours : clique sur un territoire pour l’ajouter à la zone.';
  }

  function renderCityOverlayAugmentations() {
    if (currentCityId) {
      const currentCity = getCityById(currentCityId);
      if (currentCity) renderCityDetailRelations(currentCity);
    }
  }

  window.openCityFromMapRelation = function openCityFromMapRelation(cityId) {
    const city = getCityById(cityId);
    if (city) openCityDetail(city);
  };

  const originalRenderCityDetailContent = typeof renderCityDetailContent === 'function' ? renderCityDetailContent : null;
  if (originalRenderCityDetailContent) {
    renderCityDetailContent = function wrappedRenderCityDetailContent(city) {
      originalRenderCityDetailContent(city);
      renderCityDetailRelations(city);
    };
  }

  const originalSwitchView = typeof switchView === 'function' ? switchView : null;
  if (originalSwitchView) {
    switchView = function wrappedSwitchView(view) {
      originalSwitchView(view);
      if (view === 'map') {
        if (typeof loadCities === 'function') loadCities();
        if (typeof loadCityRelations === 'function') loadCityRelations();
        loadMapMarkers();
        loadMapOverlays();
        ensureWorldMapLoaded(currentWorldMapKey);
        populateMapMarkerCitySelect();
        syncMapAdminPanel();
        renderMapCategoryFilters();
        renderMapOverlayList();
      }
    };
  }

  socket.on('city_relations_data', () => {
    renderCityOverlayAugmentations();
  });

  socket.on('cities_data', () => {
    populateMapMarkerCitySelect();
  });

  socket.on('map_markers_data', markers => {
    mapMarkersData = Array.isArray(markers) ? markers : [];
    if (selectedMapMarkerId && !getMarkerById(selectedMapMarkerId)) selectedMapMarkerId = null;
    renderMapCategoryFilters();
    renderWorldMapMarkers();
    renderMapMarkerList();
    renderSelectedMapMarker();
    syncMapMarkerDeleteButton();
  });

  socket.on('map_overlays_data', overlays => {
    mapOverlaysData = Array.isArray(overlays) ? overlays : [];
    if (selectedMapOverlayId && !getOverlayById(selectedMapOverlayId)) selectedMapOverlayId = null;
    renderWorldMapOverlays();
    renderMapOverlayList();
    syncMapOverlayDeleteButton();
  });

  socket.on('map_marker_save_success', () => {
    const message = document.getElementById('mapMarkerSaveMsg');
    if (!message) return;
    message.classList.remove('hidden');
    clearTimeout(message._hideTimer);
    message._hideTimer = setTimeout(() => message.classList.add('hidden'), 2600);
  });

  socket.on('map_overlay_save_success', () => {
    const message = document.getElementById('mapOverlaySaveMsg');
    if (!message) return;
    message.classList.remove('hidden');
    clearTimeout(message._hideTimer);
    message._hideTimer = setTimeout(() => message.classList.add('hidden'), 2600);
  });

  function loadMapMarkers() {
    socket.emit('request_map_markers');
  }

  function loadMapOverlays() {
    socket.emit('request_map_overlays');
  }

  function setWorldMapLoading(isLoading, text) {
    const loadingEl = document.getElementById('worldMapLoading');
    if (!loadingEl) return;
    loadingEl.textContent = text || 'Chargement de la carte…';
    loadingEl.style.display = isLoading ? 'flex' : 'none';
  }

  function extractCityNameFromHref(href) {
    const match = String(href || '').match(/Cites[\\/](.+?)\.html/i);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function toggleRegionSelection(targetId) {
    if (!IS_ADMIN || !mapRegionSelectionArmed || !targetId) return;
    const id = String(targetId);
    if (selectedRegionIds.includes(id)) selectedRegionIds = selectedRegionIds.filter(value => value !== id);
    else selectedRegionIds = [...selectedRegionIds, id];
    document.getElementById('mapOverlayTargetIds').value = selectedRegionIds.join(', ');
    renderRegionSelectionHint();
    renderWorldMapOverlays();
  }

  function handleWorldMapCityClick(event, cityName) {
    if (mapPlacementArmed || mapRegionSelectionArmed) return;
    event.preventDefault();
    event.stopPropagation();
    const city = getCityByName(cityName);
    if (city) {
      if (!cityRelationsData || !cityRelationsData.length) loadCityRelations();
      openCityDetail(city);
    }
  }

  function bindWorldMapInteractions() {
    const canvas = document.getElementById('worldMapCanvas');
    const svg = canvas?.querySelector('svg');
    if (!svg) return;

    if (!svg.getAttribute('viewBox')) {
      const width = Number(svg.getAttribute('width')) || 1000;
      const height = Number(svg.getAttribute('height')) || 700;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    svg.classList.add('world-map-svg');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    svg.querySelectorAll('a').forEach(anchor => {
      const cityName = extractCityNameFromHref(anchor.getAttribute('href'));
      anchor.removeAttribute('href');
      if (!cityName || !getCityByName(cityName)) return;
      anchor.classList.add('world-map-city-target');
      anchor.dataset.cityName = cityName;
      anchor.addEventListener('click', event => handleWorldMapCityClick(event, cityName));
    });

    svg.querySelectorAll('text[id^="stateLabel"], text[id^="burgLabel"]').forEach(label => {
      const cityName = String(label.textContent || '').trim();
      if (!cityName || !getCityByName(cityName)) return;
      label.classList.add('world-map-city-label');
      label.dataset.cityName = cityName;
      label.addEventListener('click', event => handleWorldMapCityClick(event, cityName));
    });

    svg.querySelectorAll('[id^="state"]').forEach(region => {
      if (/^stateLabel/i.test(region.id)) return;
      region.classList.add('world-map-region-target');
      region.addEventListener('click', event => {
        if (!IS_ADMIN || !mapRegionSelectionArmed) return;
        event.preventDefault();
        event.stopPropagation();
        toggleRegionSelection(region.id);
      });
    });

    const stage = document.getElementById('worldMapStage');
    if (stage) {
      stage.onclick = event => {
        if (!mapPlacementArmed || !IS_ADMIN || mapRegionSelectionArmed) return;
        if (event.target.closest('.world-map-marker')) return;

        const svgRect = svg.getBoundingClientRect();
        if (!svgRect.width || !svgRect.height) return;

        const x = Math.max(0, Math.min(100, ((event.clientX - svgRect.left) / svgRect.width) * 100));
        const y = Math.max(0, Math.min(100, ((event.clientY - svgRect.top) / svgRect.height) * 100));

        document.getElementById('mapMarkerX').value = x.toFixed(2);
        document.getElementById('mapMarkerY').value = y.toFixed(2);
        mapPlacementArmed = false;
        updateMapHint();
      };
    }

    renderWorldMapOverlays();
  }

  async function ensureWorldMapLoaded(mapKey) {
    const config = MAP_CONFIG[mapKey];
    const canvas = document.getElementById('worldMapCanvas');
    if (!config || !canvas) return;

    currentWorldMapKey = mapKey;
    updateMapTabs();
    updateMapHint();
    renderRegionSelectionHint();

    if (worldMapMarkupCache[mapKey]) {
      canvas.innerHTML = worldMapMarkupCache[mapKey];
      bindWorldMapInteractions();
      renderWorldMapMarkers();
      setWorldMapLoading(false);
      renderMapMarkerList();
      renderSelectedMapMarker();
      renderMapOverlayList();
      return;
    }

    setWorldMapLoading(true, `Chargement de ${config.label}…`);
    try {
      const response = await fetch(config.src, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const svg = parsed.querySelector('svg#fantasyMap') || parsed.querySelector('svg');
      if (!svg) throw new Error('SVG introuvable');
      worldMapMarkupCache[mapKey] = svg.outerHTML;
      canvas.innerHTML = worldMapMarkupCache[mapKey];
      bindWorldMapInteractions();
      renderWorldMapMarkers();
      renderMapMarkerList();
      renderSelectedMapMarker();
      renderMapOverlayList();
    } catch (error) {
      console.error(error);
      canvas.innerHTML = '<div class="rank-empty" style="padding:18px;">Impossible de charger la carte.</div>';
    } finally {
      setWorldMapLoading(false);
    }
  }

  function updateMapTabs() {
    Object.keys(MAP_CONFIG).forEach(mapKey => {
      const button = document.getElementById(`map-tab-${mapKey}`);
      if (!button) return;
      button.classList.toggle('active', mapKey === currentWorldMapKey);
    });
  }

  function updateMapHint() {
    const hint = document.getElementById('worldMapHint');
    if (!hint) return;
    if (mapRegionSelectionArmed) {
      hint.textContent = 'Sélection de zones active : clique sur les territoires à ajouter, puis enregistre la zone.';
      return;
    }
    hint.textContent = mapPlacementArmed
      ? 'Placement actif : clique sur la carte pour enregistrer les coordonnées du marqueur.'
      : 'Astuce : les libellés et les territoires sont cliquables. Les marqueurs admin apparaissent par-dessus la carte.';
  }

  function renderWorldMapMarkers() {
    const layer = document.getElementById('worldMapMarkers');
    if (!layer) return;

    const markers = getVisibleMapMarkers();
    layer.innerHTML = markers.map(marker => {
      const selected = String(marker._id) === String(selectedMapMarkerId);
      const meta = getMarkerMeta(marker.category);
      const image = marker.imageUrl
        ? `<img src="${escapeHtml(marker.imageUrl)}" alt="">`
        : `<i class="fa-solid ${escapeHtml(meta.icon)}"></i>`;
      const border = selected ? 'outline:2px solid #fff7cc;outline-offset:2px;' : '';
      const markerStyle = `left:${Number(marker.x).toFixed(2)}%;top:${Number(marker.y).toFixed(2)}%;--marker-accent:${escapeHtml(meta.color)};${border}`;
      const classes = [
        'world-map-marker',
        marker.imageUrl ? 'has-image' : '',
        marker.category ? `marker-category-${marker.category}` : '',
        marker.category === 'breaking-news' ? 'is-breaking-news' : ''
      ].filter(Boolean).join(' ');
      return `
        <button
          class="${classes}"
          data-marker-id="${escapeHtml(String(marker._id))}"
          style="${markerStyle}"
          title="${escapeHtml(marker.title)}"
          type="button"
        >${image}</button>`;
    }).join('');

    layer.querySelectorAll('.world-map-marker').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const markerId = button.getAttribute('data-marker-id');
        const marker = getMarkerById(markerId);
        selectMapMarker(markerId);
        if (marker?.category === 'breaking-news' && marker.postId?._id) {
          openFeedPostFromMarker(marker.postId._id);
        }
      });
    });
  }

  function renderSelectedMapMarker() {
    const container = document.getElementById('mapMarkerInfo');
    if (!container) return;

    const marker = selectedMapMarkerId ? getMarkerById(selectedMapMarkerId) : null;
    if (!marker) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }

    const linkedCity = marker.cityId?._id ? getCityById(marker.cityId._id) || marker.cityId : null;
    const linkedPostId = marker.postId?._id || marker.postId || '';
    const imageBlock = marker.imageUrl ? `<img src="${escapeHtml(marker.imageUrl)}" class="map-marker-info-image" alt="">` : '<div class="map-marker-info-image"></div>';
    const postButton = linkedPostId
      ? `<button id="mapMarkerOpenPost" class="map-marker-info-city map-marker-info-post" type="button">Ouvrir le post lié</button>`
      : '';

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="map-marker-info-title">${escapeHtml(marker.title)}</div>
      <div class="map-marker-info-meta">${escapeHtml(formatMapMarkerMeta(marker))}</div>
      <div class="map-marker-info-body">
        ${imageBlock}
        <div>
          <div class="map-marker-info-text">${marker.description ? escapeHtml(marker.description).replace(/\n/g, '<br>') : 'Aucune description.'}</div>
          ${linkedCity ? `<button id="mapMarkerOpenCity" class="map-marker-info-city" type="button">Ouvrir la cité ${escapeHtml(linkedCity.name)}</button>` : ''}
          ${postButton}
        </div>
      </div>`;

    const openCityButton = document.getElementById('mapMarkerOpenCity');
    if (openCityButton && linkedCity) {
      openCityButton.onclick = () => openCityDetail(linkedCity);
    }

    const openPostButton = document.getElementById('mapMarkerOpenPost');
    if (openPostButton && linkedPostId) {
      openPostButton.onclick = () => openFeedPostFromMarker(linkedPostId);
    }
  }

  function renderWorldMapOverlays() {
    const canvas = document.getElementById('worldMapCanvas');
    const svg = canvas?.querySelector('svg');
    if (!svg) return;

    svg.querySelectorAll('.world-map-overlay-applied').forEach(element => {
      element.classList.remove('world-map-overlay-applied', 'world-map-danger-blink', 'world-map-region-selected');
      element.style.fill = '';
      element.style.fillOpacity = '';
      element.style.stroke = '';
      element.style.strokeWidth = '';
      element.style.strokeDasharray = '';
      element.style.filter = '';
    });

    getCurrentMapOverlays().slice().reverse().forEach(overlay => {
      overlay.targetIds.forEach(targetId => {
        const element = getSvgRegionElement(targetId);
        if (!element) return;
        element.classList.add('world-map-overlay-applied');
        element.style.fill = overlay.fillColor || '#f59e0b';
        element.style.fillOpacity = String(overlay.fillOpacity ?? (overlay.mode === 'danger' ? 0.14 : 0.35));
        element.style.stroke = overlay.strokeColor || '#ef4444';
        element.style.strokeWidth = String(overlay.strokeWidth ?? 2);
        element.style.strokeDasharray = overlay.mode === 'danger' ? '10 6' : '';
        element.style.filter = overlay.mode === 'danger' ? 'drop-shadow(0 0 6px rgba(239,68,68,0.55))' : '';
        if (overlay.blink || overlay.mode === 'danger') element.classList.add('world-map-danger-blink');
      });
    });

    selectedRegionIds.forEach(targetId => {
      const element = getSvgRegionElement(targetId);
      if (element) element.classList.add('world-map-region-selected', 'world-map-overlay-applied');
    });
  }

  function populateMapMarkerCitySelect() {
    const select = document.getElementById('mapMarkerCity');
    if (!select) return;

    const currentValue = select.value;
    const options = ['<option value="">Aucune cité liée</option>'];
    [...(citiesData || [])]
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach(city => {
        options.push(`<option value="${escapeHtml(String(city._id))}">${escapeHtml(city.name)}</option>`);
      });

    select.innerHTML = options.join('');
    select.value = currentValue || '';
  }

  function syncMapAdminPanel() {
    const panel = document.getElementById('mapAdminPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !IS_ADMIN);
  }

  function syncMapMarkerDeleteButton() {
    const button = document.getElementById('mapMarkerDeleteBtn');
    if (!button) return;
    button.disabled = !document.getElementById('mapMarkerId')?.value;
    button.style.opacity = button.disabled ? '0.55' : '1';
  }

  function syncMapOverlayDeleteButton() {
    const button = document.getElementById('mapOverlayDeleteBtn');
    if (!button) return;
    button.disabled = !document.getElementById('mapOverlayId')?.value;
    button.style.opacity = button.disabled ? '0.55' : '1';
  }

  function setMapMarkerPreview(url) {
    const preview = document.getElementById('mapMarkerImagePreview');
    if (!preview) return;
    if (url) {
      preview.src = url;
      preview.classList.remove('hidden');
    } else {
      preview.src = '';
      preview.classList.add('hidden');
    }
  }

  function fillMapMarkerForm(marker) {
    document.getElementById('mapMarkerId').value = marker ? String(marker._id) : '';
    document.getElementById('mapMarkerX').value = marker ? Number(marker.x).toFixed(2) : '';
    document.getElementById('mapMarkerY').value = marker ? Number(marker.y).toFixed(2) : '';
    document.getElementById('mapMarkerCategory').value = marker?.category || 'general';
    document.getElementById('mapMarkerTitle').value = marker?.title || '';
    document.getElementById('mapMarkerPostId').value = marker?.postId?._id ? String(marker.postId._id) : '';
    document.getElementById('mapMarkerCity').value = marker?.cityId?._id ? String(marker.cityId._id) : '';
    document.getElementById('mapMarkerDescription').value = marker?.description || '';
    document.getElementById('mapMarkerImage').value = '';
    setMapMarkerPreview(marker?.imageUrl || '');
    syncMapMarkerDeleteButton();
  }

  function fillMapOverlayForm(overlay) {
    selectedRegionIds = Array.isArray(overlay?.targetIds) ? [...overlay.targetIds] : [];
    document.getElementById('mapOverlayId').value = overlay ? String(overlay._id) : '';
    document.getElementById('mapOverlayLabel').value = overlay?.label || '';
    document.getElementById('mapOverlayMode').value = overlay?.mode || 'territory';
    document.getElementById('mapOverlayTargetIds').value = selectedRegionIds.join(', ');
    document.getElementById('mapOverlayDescription').value = overlay?.description || '';
    document.getElementById('mapOverlayFillColor').value = overlay?.fillColor || '#f59e0b';
    document.getElementById('mapOverlayFillOpacity').value = Number(overlay?.fillOpacity ?? 0.35).toFixed(2);
    document.getElementById('mapOverlayStrokeColor').value = overlay?.strokeColor || '#ef4444';
    document.getElementById('mapOverlayStrokeWidth').value = Number(overlay?.strokeWidth ?? 2).toFixed(1);
    document.getElementById('mapOverlayBlink').checked = !!overlay?.blink;
    syncMapOverlayDeleteButton();
    renderRegionSelectionHint();
    renderWorldMapOverlays();
  }

  function selectMapMarker(markerId) {
    selectedMapMarkerId = markerId;
    const marker = getMarkerById(markerId);
    if (marker && IS_ADMIN) fillMapMarkerForm(marker);
    renderWorldMapMarkers();
    renderSelectedMapMarker();
  }

  function selectMapOverlay(overlayId) {
    selectedMapOverlayId = overlayId;
    const overlay = getOverlayById(overlayId);
    if (overlay && IS_ADMIN) fillMapOverlayForm(overlay);
    renderMapOverlayList();
  }

  window.resetMapMarkerForm = function resetMapMarkerForm() {
    selectedMapMarkerId = null;
    mapPlacementArmed = false;
    updateMapHint();
    document.getElementById('mapMarkerId').value = '';
    document.getElementById('mapMarkerX').value = '';
    document.getElementById('mapMarkerY').value = '';
    document.getElementById('mapMarkerCategory').value = 'general';
    document.getElementById('mapMarkerTitle').value = '';
    document.getElementById('mapMarkerPostId').value = '';
    document.getElementById('mapMarkerCity').value = '';
    document.getElementById('mapMarkerDescription').value = '';
    document.getElementById('mapMarkerImage').value = '';
    setMapMarkerPreview('');
    renderWorldMapMarkers();
    renderSelectedMapMarker();
    syncMapMarkerDeleteButton();
  };

  window.resetMapOverlayForm = function resetMapOverlayForm() {
    selectedMapOverlayId = null;
    mapRegionSelectionArmed = false;
    selectedRegionIds = [];
    document.getElementById('mapOverlayId').value = '';
    document.getElementById('mapOverlayLabel').value = '';
    document.getElementById('mapOverlayMode').value = 'territory';
    document.getElementById('mapOverlayTargetIds').value = '';
    document.getElementById('mapOverlayDescription').value = '';
    document.getElementById('mapOverlayFillColor').value = '#f59e0b';
    document.getElementById('mapOverlayFillOpacity').value = '0.35';
    document.getElementById('mapOverlayStrokeColor').value = '#ef4444';
    document.getElementById('mapOverlayStrokeWidth').value = '2';
    document.getElementById('mapOverlayBlink').checked = false;
    updateMapHint();
    renderRegionSelectionHint();
    renderWorldMapOverlays();
    syncMapOverlayDeleteButton();
  };

  window.startMapMarkerPlacement = function startMapMarkerPlacement() {
    if (!IS_ADMIN) return;
    mapRegionSelectionArmed = false;
    mapPlacementArmed = true;
    updateMapHint();
    renderRegionSelectionHint();
  };

  window.startMapRegionSelection = function startMapRegionSelection() {
    if (!IS_ADMIN) return;
    mapPlacementArmed = false;
    mapRegionSelectionArmed = true;
    updateMapHint();
    renderRegionSelectionHint();
  };

  window.onMapOverlayModeChange = function onMapOverlayModeChange() {
    const mode = document.getElementById('mapOverlayMode')?.value || 'territory';
    if (mode === 'danger') {
      document.getElementById('mapOverlayFillColor').value = '#7f1d1d';
      document.getElementById('mapOverlayFillOpacity').value = '0.16';
      document.getElementById('mapOverlayStrokeColor').value = '#ef4444';
      document.getElementById('mapOverlayStrokeWidth').value = '3';
      document.getElementById('mapOverlayBlink').checked = true;
    }
  };

  window.switchWorldMap = function switchWorldMap(mapKey) {
    if (!MAP_CONFIG[mapKey]) return;
    currentWorldMapKey = mapKey;
    const currentMarker = selectedMapMarkerId ? getMarkerById(selectedMapMarkerId) : null;
    const currentOverlay = selectedMapOverlayId ? getOverlayById(selectedMapOverlayId) : null;
    if (currentMarker && currentMarker.mapKey !== mapKey) selectedMapMarkerId = null;
    if (currentOverlay && currentOverlay.mapKey !== mapKey) selectedMapOverlayId = null;
    ensureWorldMapLoaded(mapKey);
    renderMapMarkerList();
    renderSelectedMapMarker();
    renderMapOverlayList();
  };

  window.toggleMapCategoryFilter = function toggleMapCategoryFilter(category) {
    if (!(category in MAP_MARKER_CATEGORY_META)) return;
    mapCategoryFilters[category] = mapCategoryFilters[category] === false;
    saveMapCategoryFilters();
    renderMapCategoryFilters();
    renderWorldMapMarkers();
    renderMapMarkerList();
  };

  window.resetMapCategoryFilters = function resetMapCategoryFilters() {
    mapCategoryFilters = Object.fromEntries(Object.keys(MAP_MARKER_CATEGORY_META).map(key => [key, true]));
    saveMapCategoryFilters();
    renderMapCategoryFilters();
    renderWorldMapMarkers();
    renderMapMarkerList();
  };

  window.saveMapMarker = async function saveMapMarker() {
    if (!IS_ADMIN) return;

    const markerId = document.getElementById('mapMarkerId').value.trim();
    const category = document.getElementById('mapMarkerCategory').value;
    const title = document.getElementById('mapMarkerTitle').value.trim();
    const postId = document.getElementById('mapMarkerPostId').value.trim();
    const description = document.getElementById('mapMarkerDescription').value.trim();
    const x = Number(document.getElementById('mapMarkerX').value);
    const y = Number(document.getElementById('mapMarkerY').value);
    const cityId = document.getElementById('mapMarkerCity').value || null;
    const imageInput = document.getElementById('mapMarkerImage');
    const preview = document.getElementById('mapMarkerImagePreview');

    if (!title) return alert('Ajoute un titre au marqueur.');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return alert('Place le marqueur sur la carte ou renseigne des coordonnées valides.');
    if (category === 'breaking-news' && !postId) return alert('Un marqueur Breaking News doit pointer vers un post du Feed.');

    let imageUrl = preview && !preview.classList.contains('hidden') ? preview.src : '';
    if (imageInput?.files?.[0]) {
      imageUrl = await uploadToCloudinary(imageInput.files[0]);
      if (!imageUrl) return alert('Échec de l’upload de l’image.');
    }

    socket.emit('admin_save_map_marker', {
      markerId: markerId || null,
      mapKey: currentWorldMapKey,
      category,
      title,
      description,
      x,
      y,
      imageUrl,
      cityId,
      postId: postId || null
    });

    mapPlacementArmed = false;
    updateMapHint();
  };

  window.saveMapOverlay = function saveMapOverlay() {
    if (!IS_ADMIN) return;

    const overlayId = document.getElementById('mapOverlayId').value.trim();
    const label = document.getElementById('mapOverlayLabel').value.trim();
    const mode = document.getElementById('mapOverlayMode').value;
    const description = document.getElementById('mapOverlayDescription').value.trim();
    const fillColor = document.getElementById('mapOverlayFillColor').value;
    const fillOpacity = Number(document.getElementById('mapOverlayFillOpacity').value);
    const strokeColor = document.getElementById('mapOverlayStrokeColor').value;
    const strokeWidth = Number(document.getElementById('mapOverlayStrokeWidth').value);
    const blink = document.getElementById('mapOverlayBlink').checked;

    if (!label) return alert('Ajoute un nom à la zone.');
    if (!selectedRegionIds.length) return alert('Sélectionne au moins un territoire sur la carte.');

    socket.emit('admin_save_map_overlay', {
      overlayId: overlayId || null,
      mapKey: currentWorldMapKey,
      label,
      description,
      mode,
      targetIds: selectedRegionIds,
      fillColor,
      fillOpacity,
      strokeColor,
      strokeWidth,
      blink
    });

    mapRegionSelectionArmed = false;
    updateMapHint();
    renderRegionSelectionHint();
  };

  window.deleteSelectedMapMarker = function deleteSelectedMapMarker() {
    if (!IS_ADMIN) return;
    const markerId = document.getElementById('mapMarkerId').value;
    if (!markerId) return;
    socket.emit('admin_delete_map_marker', { markerId });
    resetMapMarkerForm();
  };

  window.deleteSelectedMapOverlay = function deleteSelectedMapOverlay() {
    if (!IS_ADMIN) return;
    const overlayId = document.getElementById('mapOverlayId').value;
    if (!overlayId) return;
    socket.emit('admin_delete_map_overlay', { overlayId });
    resetMapOverlayForm();
  };

  window.editMapMarker = function editMapMarker(markerId) {
    const marker = getMarkerById(markerId);
    if (!marker) return;
    selectedMapMarkerId = markerId;
    fillMapMarkerForm(marker);
    renderWorldMapMarkers();
    renderSelectedMapMarker();
  };

  window.editMapOverlay = function editMapOverlay(overlayId) {
    const overlay = getOverlayById(overlayId);
    if (!overlay) return;
    selectMapOverlay(overlayId);
  };

  function renderMapMarkerList() {
    const list = document.getElementById('mapMarkerList');
    if (!list) return;

    const markers = getCurrentMapMarkers();
    if (!markers.length) {
      list.innerHTML = '<div class="rank-empty">Aucun marqueur sur cette carte.</div>';
      return;
    }

    list.innerHTML = markers.map(marker => {
      const meta = getMarkerMeta(marker.category);
      const cityName = marker.cityId?.name ? ` · ${escapeHtml(marker.cityId.name)}` : '';
      const postFlag = marker.postId?._id ? ' · post lié' : '';
      const hidden = mapCategoryFilters[marker.category] === false ? ' · masqué par filtre' : '';
      return `
        <div class="map-marker-list-item">
          <div class="map-marker-list-head">
            <div class="map-marker-list-name"><i class="fa-solid ${escapeHtml(meta.icon)}"></i> ${escapeHtml(marker.title)}</div>
            <span class="diplo-status-badge diplo-badge-neutre">${Number(marker.x).toFixed(1)} / ${Number(marker.y).toFixed(1)}</span>
          </div>
          <div class="map-marker-list-meta">${escapeHtml(meta.label)}${cityName}${postFlag}${hidden}</div>
          <div class="map-marker-list-actions">
            <button class="btn-secondary" onclick="editMapMarker('${escapeHtml(String(marker._id))}')"><i class="fa-solid fa-pen"></i> Éditer</button>
            <button class="btn-secondary" onclick="selectMapMarkerPublic('${escapeHtml(String(marker._id))}')"><i class="fa-solid fa-eye"></i> Voir</button>
          </div>
        </div>`;
    }).join('');
  }

  function renderMapOverlayList() {
    const list = document.getElementById('mapOverlayList');
    if (!list) return;

    const overlays = getCurrentMapOverlays();
    if (!overlays.length) {
      list.innerHTML = '<div class="rank-empty">Aucune zone active sur cette carte.</div>';
      return;
    }

    list.innerHTML = overlays.map(overlay => {
      const selected = String(overlay._id) === String(selectedMapOverlayId);
      const modeLabel = overlay.mode === 'danger' ? 'Danger' : 'Territoire';
      const classes = `map-marker-list-item${selected ? ' map-overlay-list-item-selected' : ''}`;
      return `
        <div class="${classes}">
          <div class="map-marker-list-head">
            <div class="map-marker-list-name">${escapeHtml(overlay.label)}</div>
            <span class="diplo-status-badge diplo-badge-${overlay.mode === 'danger' ? 'guerre' : 'partenariat'}">${escapeHtml(modeLabel)}</span>
          </div>
          <div class="map-marker-list-meta">${escapeHtml((overlay.targetIds || []).join(', '))}</div>
          <div class="map-marker-list-actions">
            <button class="btn-secondary" onclick="editMapOverlay('${escapeHtml(String(overlay._id))}')"><i class="fa-solid fa-pen"></i> Éditer</button>
            <button class="btn-secondary" onclick="focusMapOverlay('${escapeHtml(String(overlay._id))}')"><i class="fa-solid fa-eye"></i> Voir</button>
          </div>
        </div>`;
    }).join('');
  }

  window.focusMapOverlay = function focusMapOverlay(overlayId) {
    const overlay = getOverlayById(overlayId);
    if (!overlay) return;
    selectedMapOverlayId = overlayId;
    selectedRegionIds = [...(overlay.targetIds || [])];
    renderRegionSelectionHint();
    renderWorldMapOverlays();
    renderMapOverlayList();
  };

  window.selectMapMarkerPublic = function selectMapMarkerPublic(markerId) {
    selectedMapMarkerId = markerId;
    renderWorldMapMarkers();
    renderSelectedMapMarker();
  };

  populateMapMarkerCitySelect();
  renderMapCategoryFilters();
  syncMapAdminPanel();
  syncMapMarkerDeleteButton();
  syncMapOverlayDeleteButton();
})();
