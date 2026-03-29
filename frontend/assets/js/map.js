(function initCosmosMaps() {
  if (window.__cosmosMapsModuleLoaded) return;
  window.__cosmosMapsModuleLoaded = true;

  const MAP_CONFIG = {
    'archipel-pacifique': {
      label: 'Archipel Pacifique',
      src: 'assets/maps/archipel-pacifique.html'
    },
    'ancienne-archipel': {
      label: 'Ancienne Archipel',
      src: 'assets/maps/ancienne-archipel.html'
    }
  };

  let currentWorldMapKey = 'archipel-pacifique';
  let worldMapMarkupCache = {};
  let mapMarkersData = [];
  let selectedMapMarkerId = null;
  let mapPlacementArmed = false;

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

  function getCityByName(name) {
    return (citiesData || []).find(city => normalizeLabel(city.name) === normalizeLabel(name)) || null;
  }

  function getCityById(cityId) {
    return (citiesData || []).find(city => String(city._id) === String(cityId)) || null;
  }

  function getMarkerById(markerId) {
    return mapMarkersData.find(marker => String(marker._id) === String(markerId)) || null;
  }

  function getCurrentMapMarkers() {
    return mapMarkersData.filter(marker => marker.mapKey === currentWorldMapKey);
  }

  function formatRelationSince(value) {
    if (!value) return '';
    return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
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
        ensureWorldMapLoaded(currentWorldMapKey);
        populateMapMarkerCitySelect();
        syncMapAdminPanel();
      }
    };
  }

  socket.on('city_relations_data', () => {
    if (currentCityId) {
      const currentCity = getCityById(currentCityId);
      if (currentCity) renderCityDetailRelations(currentCity);
    }
  });

  socket.on('cities_data', () => {
    populateMapMarkerCitySelect();
  });

  socket.on('map_markers_data', markers => {
    mapMarkersData = Array.isArray(markers) ? markers : [];
    if (selectedMapMarkerId && !getMarkerById(selectedMapMarkerId)) selectedMapMarkerId = null;
    renderWorldMapMarkers();
    renderMapMarkerList();
    renderSelectedMapMarker();
    syncMapMarkerDeleteButton();
  });

  socket.on('map_marker_save_success', () => {
    const message = document.getElementById('mapMarkerSaveMsg');
    if (!message) return;
    message.classList.remove('hidden');
    clearTimeout(message._hideTimer);
    message._hideTimer = setTimeout(() => message.classList.add('hidden'), 2600);
  });

  function loadMapMarkers() {
    socket.emit('request_map_markers');
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

  function handleWorldMapCityClick(event, cityName) {
    if (mapPlacementArmed) return;
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

    const stage = document.getElementById('worldMapStage');
    if (stage) {
      stage.onclick = event => {
        if (!mapPlacementArmed || !IS_ADMIN) return;
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
  }

  async function ensureWorldMapLoaded(mapKey) {
    const config = MAP_CONFIG[mapKey];
    const canvas = document.getElementById('worldMapCanvas');
    if (!config || !canvas) return;

    currentWorldMapKey = mapKey;
    updateMapTabs();
    updateMapHint();

    if (worldMapMarkupCache[mapKey]) {
      canvas.innerHTML = worldMapMarkupCache[mapKey];
      bindWorldMapInteractions();
      renderWorldMapMarkers();
      setWorldMapLoading(false);
      renderMapMarkerList();
      renderSelectedMapMarker();
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
    hint.textContent = mapPlacementArmed
      ? 'Placement actif : clique sur la carte pour enregistrer les coordonnées du marqueur.'
      : 'Astuce : les libellés et les territoires sont cliquables. Les marqueurs admin apparaissent par-dessus la carte.';
  }

  function renderWorldMapMarkers() {
    const layer = document.getElementById('worldMapMarkers');
    if (!layer) return;

    const markers = getCurrentMapMarkers();
    layer.innerHTML = markers.map(marker => {
      const selected = String(marker._id) === String(selectedMapMarkerId);
      const image = marker.imageUrl ? `<img src="${escapeHtml(marker.imageUrl)}" alt="">` : '<i class="fa-solid fa-location-dot"></i>';
      return `
        <button
          class="world-map-marker ${marker.imageUrl ? 'has-image' : ''}"
          data-marker-id="${escapeHtml(String(marker._id))}"
          style="left:${Number(marker.x).toFixed(2)}%;top:${Number(marker.y).toFixed(2)}%;${selected ? 'outline:2px solid #fff7cc;outline-offset:2px;' : ''}"
          title="${escapeHtml(marker.title)}"
          type="button"
        >${image}</button>`;
    }).join('');

    layer.querySelectorAll('.world-map-marker').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const markerId = button.getAttribute('data-marker-id');
        selectMapMarker(markerId);
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
    const imageBlock = marker.imageUrl ? `<img src="${escapeHtml(marker.imageUrl)}" class="map-marker-info-image" alt="">` : '';
    const meta = [getCurrentMapConfig().label, linkedCity?.name || 'Sans cité liée'].join(' · ');

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="map-marker-info-title">${escapeHtml(marker.title)}</div>
      <div class="map-marker-info-meta">${escapeHtml(meta)}</div>
      <div class="map-marker-info-body">
        ${imageBlock || '<div class="map-marker-info-image"></div>'}
        <div>
          <div class="map-marker-info-text">${marker.description ? escapeHtml(marker.description).replace(/\n/g, '<br>') : 'Aucune description.'}</div>
          ${linkedCity ? `<button id="mapMarkerOpenCity" class="map-marker-info-city" type="button">Ouvrir la cité ${escapeHtml(linkedCity.name)}</button>` : ''}
        </div>
      </div>`;

    const openCityButton = document.getElementById('mapMarkerOpenCity');
    if (openCityButton && linkedCity) {
      openCityButton.onclick = () => openCityDetail(linkedCity);
    }
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

  window.resetMapMarkerForm = function resetMapMarkerForm() {
    selectedMapMarkerId = null;
    mapPlacementArmed = false;
    updateMapHint();
    document.getElementById('mapMarkerId').value = '';
    document.getElementById('mapMarkerX').value = '';
    document.getElementById('mapMarkerY').value = '';
    document.getElementById('mapMarkerTitle').value = '';
    document.getElementById('mapMarkerCity').value = '';
    document.getElementById('mapMarkerDescription').value = '';
    document.getElementById('mapMarkerImage').value = '';
    setMapMarkerPreview('');
    renderWorldMapMarkers();
    renderSelectedMapMarker();
    syncMapMarkerDeleteButton();
  };

  function fillMapMarkerForm(marker) {
    document.getElementById('mapMarkerId').value = marker ? String(marker._id) : '';
    document.getElementById('mapMarkerX').value = marker ? Number(marker.x).toFixed(2) : '';
    document.getElementById('mapMarkerY').value = marker ? Number(marker.y).toFixed(2) : '';
    document.getElementById('mapMarkerTitle').value = marker?.title || '';
    document.getElementById('mapMarkerCity').value = marker?.cityId?._id ? String(marker.cityId._id) : '';
    document.getElementById('mapMarkerDescription').value = marker?.description || '';
    document.getElementById('mapMarkerImage').value = '';
    setMapMarkerPreview(marker?.imageUrl || '');
    syncMapMarkerDeleteButton();
  }

  function selectMapMarker(markerId) {
    selectedMapMarkerId = markerId;
    const marker = getMarkerById(markerId);
    if (marker && IS_ADMIN) fillMapMarkerForm(marker);
    renderWorldMapMarkers();
    renderSelectedMapMarker();
  }

  window.startMapMarkerPlacement = function startMapMarkerPlacement() {
    if (!IS_ADMIN) return;
    mapPlacementArmed = true;
    updateMapHint();
  };

  window.switchWorldMap = function switchWorldMap(mapKey) {
    if (!MAP_CONFIG[mapKey]) return;
    currentWorldMapKey = mapKey;
    const currentMarker = selectedMapMarkerId ? getMarkerById(selectedMapMarkerId) : null;
    if (currentMarker && currentMarker.mapKey !== mapKey) selectedMapMarkerId = null;
    ensureWorldMapLoaded(mapKey);
    renderMapMarkerList();
    renderSelectedMapMarker();
  };

  window.saveMapMarker = async function saveMapMarker() {
    if (!IS_ADMIN) return;

    const markerId = document.getElementById('mapMarkerId').value.trim();
    const title = document.getElementById('mapMarkerTitle').value.trim();
    const description = document.getElementById('mapMarkerDescription').value.trim();
    const x = Number(document.getElementById('mapMarkerX').value);
    const y = Number(document.getElementById('mapMarkerY').value);
    const cityId = document.getElementById('mapMarkerCity').value || null;
    const imageInput = document.getElementById('mapMarkerImage');
    const preview = document.getElementById('mapMarkerImagePreview');

    if (!title) return alert('Ajoute un titre au marqueur.');
    if (!Number.isFinite(x) || !Number.isFinite(y)) return alert('Place le marqueur sur la carte ou renseigne des coordonnées valides.');

    let imageUrl = preview && !preview.classList.contains('hidden') ? preview.src : '';
    if (imageInput?.files?.[0]) {
      imageUrl = await uploadToCloudinary(imageInput.files[0]);
      if (!imageUrl) return alert('Échec de l’upload de l’image.');
    }

    socket.emit('admin_save_map_marker', {
      markerId: markerId || null,
      mapKey: currentWorldMapKey,
      title,
      description,
      x,
      y,
      imageUrl,
      cityId
    });

    mapPlacementArmed = false;
    updateMapHint();
  };

  window.deleteSelectedMapMarker = function deleteSelectedMapMarker() {
    if (!IS_ADMIN) return;
    const markerId = document.getElementById('mapMarkerId').value;
    if (!markerId) return;
    socket.emit('admin_delete_map_marker', { markerId });
    resetMapMarkerForm();
  };

  window.editMapMarker = function editMapMarker(markerId) {
    const marker = getMarkerById(markerId);
    if (!marker) return;
    selectedMapMarkerId = markerId;
    fillMapMarkerForm(marker);
    renderWorldMapMarkers();
    renderSelectedMapMarker();
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
      const cityName = marker.cityId?.name ? ` · ${escapeHtml(marker.cityId.name)}` : '';
      return `
        <div class="map-marker-list-item">
          <div class="map-marker-list-head">
            <div class="map-marker-list-name">${escapeHtml(marker.title)}</div>
            <span class="diplo-status-badge diplo-badge-neutre">${Number(marker.x).toFixed(1)} / ${Number(marker.y).toFixed(1)}</span>
          </div>
          <div class="map-marker-list-meta">${escapeHtml(getCurrentMapConfig().label)}${cityName}</div>
          <div class="map-marker-list-actions">
            <button class="btn-secondary" onclick="editMapMarker('${escapeHtml(String(marker._id))}')"><i class="fa-solid fa-pen"></i> Éditer</button>
            <button class="btn-secondary" onclick="selectMapMarkerPublic('${escapeHtml(String(marker._id))}')"><i class="fa-solid fa-eye"></i> Voir</button>
          </div>
        </div>`;
    }).join('');
  }

  window.selectMapMarkerPublic = function selectMapMarkerPublic(markerId) {
    selectedMapMarkerId = markerId;
    renderWorldMapMarkers();
    renderSelectedMapMarker();
  };

  populateMapMarkerCitySelect();
  syncMapAdminPanel();
  syncMapMarkerDeleteButton();
})();