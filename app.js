/* ============================================================
   The Pilot's Logbook · app.js
   ============================================================ */

(() => {
'use strict';

// ============================================================
// State
// ============================================================
const state = {
  folderHandle: null,        // FileSystemDirectoryHandle
  imagesHandle: null,        // FileSystemDirectoryHandle for images/
  data: null,                // Parsed logbook.json
  filters: {
    search: '',
    category: '',
    status: ''
  },
  saveTimer: null,
  map: null,
  markers: {}                // missionId -> Leaflet marker
};

// Browser support check
const FSA_SUPPORTED = 'showDirectoryPicker' in window;

// ============================================================
// Utilities
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (type === 'error' ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 2400);
}

function setSaveStatus(text, kind = 'idle') {
  const el = $('#save-status');
  el.textContent = text;
  el.className = 'save-status' + (kind === 'saving' ? ' saving' : kind === 'error' ? ' error' : '');
}

function debounce(fn, ms = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ============================================================
// File System Access
// ============================================================

async function pickFolder(forNew = false) {
  if (!FSA_SUPPORTED) {
    toast('File System Access API not supported in this browser', 'error');
    return false;
  }
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'pilots-logbook'
    });
    state.folderHandle = handle;

    // Verify or request permission
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await handle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') {
        toast('Read/write permission denied', 'error');
        return false;
      }
    }

    if (forNew) {
      // Create starter logbook.json + images/ inside this folder
      await createStarterFolder(handle);
    }

    return await loadFolder(handle);
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error(e);
      toast('Could not open folder: ' + e.message, 'error');
    }
    return false;
  }
}

async function loadFolder(handle) {
  try {
    // Look for logbook.json
    let fileHandle;
    try {
      fileHandle = await handle.getFileHandle('logbook.json');
    } catch (e) {
      toast('No logbook.json in this folder. Use "Create New Logbook" instead.', 'error');
      return false;
    }
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);

    // Validate / migrate
    if (!data.schemaVersion) data.schemaVersion = 1;
    if (!data.missions) data.missions = [];
    if (!data.categories) data.categories = [];
    if (!data.journal) data.journal = { freeform: '', entries: [] };

    state.data = data;

    // Get or create images/ subdirectory
    try {
      state.imagesHandle = await handle.getDirectoryHandle('images', { create: true });
    } catch (e) {
      console.warn('Could not access images/ subdirectory', e);
    }

    $('#folder-name').textContent = handle.name;
    showApp();
    renderAll();
    setSaveStatus('Loaded · ' + new Date().toLocaleTimeString());
    return true;
  } catch (e) {
    console.error(e);
    toast('Failed to load logbook: ' + e.message, 'error');
    return false;
  }
}

async function createStarterFolder(handle) {
  // Fetch the starter logbook.json from the same directory as the app
  let starterData;
  try {
    const resp = await fetch('logbook.json');
    if (resp.ok) {
      starterData = await resp.json();
    }
  } catch (e) {
    // No starter file available, create minimal
  }

  if (!starterData) {
    starterData = {
      schemaVersion: 1,
      title: 'My Logbook',
      subtitle: '',
      createdAt: new Date().toISOString(),
      journal: { freeform: '', entries: [] },
      categories: [
        { id: 'natural', name: 'Natural Wonders', color: '#4a6d3a' },
        { id: 'mountain', name: 'Mountain', color: '#2d4a6b' },
        { id: 'city', name: 'Cities', color: '#b04a1f' },
        { id: 'custom', name: 'My Missions', color: '#7a3d6b' }
      ],
      missions: []
    };
  }

  // Write logbook.json
  const fileHandle = await handle.getFileHandle('logbook.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(starterData, null, 2));
  await writable.close();

  // Create images/ subdirectory
  await handle.getDirectoryHandle('images', { create: true });

  toast('New logbook created');
}

const saveDebounced = debounce(async () => {
  if (!state.folderHandle || !state.data) return;
  setSaveStatus('Saving…', 'saving');
  try {
    const fileHandle = await state.folderHandle.getFileHandle('logbook.json');
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(state.data, null, 2));
    await writable.close();
    setSaveStatus('Saved · ' + new Date().toLocaleTimeString());
  } catch (e) {
    console.error(e);
    setSaveStatus('Save failed', 'error');
    toast('Could not save: ' + e.message, 'error');
  }
}, 600);

function markDirty() { saveDebounced(); }

// ============================================================
// Image handling
// ============================================================

async function compressImage(file, maxWidth = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / img.width);
        const w = img.width * ratio;
        const h = img.height * ratio;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Compression failed'));
        }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoForMission(missionId, file) {
  if (!state.imagesHandle) {
    toast('Images folder not available', 'error');
    return;
  }
  try {
    const blob = await compressImage(file);
    const id = uuid();
    const filename = `${missionId}-${id}.jpg`;
    const fileHandle = await state.imagesHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    const mission = state.data.missions.find((m) => m.id === missionId);
    if (!mission) return;
    mission.photos = mission.photos || [];
    mission.photos.push({
      id,
      filename,
      caption: '',
      uploadedAt: new Date().toISOString()
    });
    markDirty();
    renderMission(missionId);
    toast('Photo added');
  } catch (e) {
    console.error(e);
    toast('Upload failed: ' + e.message, 'error');
  }
}

async function deletePhoto(missionId, photoId) {
  const mission = state.data.missions.find((m) => m.id === missionId);
  if (!mission) return;
  const photo = mission.photos.find((p) => p.id === photoId);
  if (!photo) return;
  if (!confirm('Delete this photo?')) return;
  try {
    if (state.imagesHandle && photo.filename) {
      await state.imagesHandle.removeEntry(photo.filename).catch(() => { /* ignore if file missing */ });
    }
    mission.photos = mission.photos.filter((p) => p.id !== photoId);
    markDirty();
    renderMission(missionId);
    toast('Photo deleted');
  } catch (e) {
    console.error(e);
    toast('Delete failed', 'error');
  }
}

async function getPhotoUrl(filename) {
  if (!state.imagesHandle) return null;
  try {
    const fileHandle = await state.imagesHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch (e) {
    return null;
  }
}

// ============================================================
// Rendering
// ============================================================

function showApp() {
  $('#welcome').style.display = 'none';
  $('#app').style.display = 'block';
}

function showWelcome() {
  $('#welcome').style.display = 'block';
  $('#app').style.display = 'none';
}

function renderAll() {
  if (!state.data) return;
  $('#logbook-title').innerHTML = state.data.title
    ? `${escapeHtml(state.data.title.split(' ')[0])} <em>${escapeHtml(state.data.title.split(' ').slice(1).join(' ')) || ''}</em>`
    : 'The <em>Logbook</em>';
  $('#logbook-subtitle').textContent = state.data.subtitle || '';
  renderCategoryFilter();
  renderMissions();
  renderMap();
  updateProgress();
}

function renderCategoryFilter() {
  const select = $('#filter-category');
  const current = select.value;
  select.innerHTML = '<option value="">All categories</option>';
  (state.data.categories || []).forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
  select.value = current;
}

function getFilteredMissions() {
  const { search, category, status } = state.filters;
  return state.data.missions.filter((m) => {
    if (category && m.category !== category) return false;
    if (status === 'completed' && !m.completed) return false;
    if (status === 'todo' && m.completed) return false;
    if (search) {
      const hay = (m.title + ' ' + (m.subtitle || '') + ' ' + (m.description || '') + ' ' + (m.aircraft || '') + ' ' + (m.notes || '')).toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
}

function renderMissions() {
  const container = $('#missions-container');
  const missions = getFilteredMissions();

  // Group by category
  const byCategory = {};
  missions.forEach((m) => {
    const cat = m.category || 'uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  });

  // Maintain category order from data.categories
  const orderedCats = (state.data.categories || []).map((c) => c.id);
  const allCats = Object.keys(byCategory).sort((a, b) => {
    const ai = orderedCats.indexOf(a);
    const bi = orderedCats.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  if (missions.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 60px 20px; color: var(--muted);">
        <p style="font-style: italic; font-size: 18px;">No missions match these filters.</p>
        <button class="btn" onclick="document.getElementById('search-input').value=''; document.getElementById('filter-category').value=''; document.getElementById('filter-status').value=''; window.dispatchEvent(new Event('filters-changed'));">Clear filters</button>
      </div>`;
    return;
  }

  container.innerHTML = '';
  allCats.forEach((catId, idx) => {
    const catDef = (state.data.categories || []).find((c) => c.id === catId)
      || { id: catId, name: catId, color: '#1a1612' };
    const sec = document.createElement('section');
    sec.className = 'chapter';
    sec.dataset.category = catId;
    if (idx === 0) sec.style.borderTop = 'none';
    sec.innerHTML = `
      <div class="chapter-head">
        <div class="chapter-num" style="border-color:${catDef.color};color:${catDef.color}">${(idx + 1).toString().padStart(2, '0')}</div>
        <h2 class="chapter-title">${escapeHtml(catDef.name)}</h2>
        <div class="chapter-count">${byCategory[catId].length} mission${byCategory[catId].length === 1 ? '' : 's'}</div>
      </div>
      <div class="chapter-missions"></div>
    `;
    const missionsDiv = sec.querySelector('.chapter-missions');
    byCategory[catId].forEach((m) => {
      missionsDiv.appendChild(buildMissionElement(m));
    });
    container.appendChild(sec);
  });
}

function buildMissionElement(m) {
  const el = document.createElement('div');
  el.className = 'mission' + (m.completed ? ' completed' : '');
  el.dataset.missionId = m.id;
  el.innerHTML = `
    <div class="mission-header">
      <div class="mission-title-block">
        <h3 class="mission-title">${escapeHtml(m.title)}</h3>
        ${m.subtitle ? `<div class="mission-subtitle">${escapeHtml(m.subtitle)}</div>` : ''}
        <div class="mission-meta">
          ${m.flightTime ? `<span class="pill">${escapeHtml(m.flightTime)}</span>` : ''}
          ${m.aircraft ? `<span class="pill acc">${escapeHtml(m.aircraft)}</span>` : ''}
          ${(m.tags || []).map((t) => `<span class="pill warn">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <label class="mission-check">
        <span>Flown</span>
        <input type="checkbox" ${m.completed ? 'checked' : ''} data-action="toggle-complete">
      </label>
    </div>
    <div class="mission-body">
      ${m.description ? `<p>${escapeHtml(m.description)}</p>` : ''}
      ${m.brief ? `<p class="brief">${escapeHtml(m.brief)}</p>` : ''}
    </div>
    <div class="mission-actions">
      <button class="mission-action-link" data-action="toggle-notes">📝 Notes${m.notes ? ' (filled)' : ''}</button>
      <button class="mission-action-link" data-action="add-photo">📷 + Photo</button>
      ${m.isCustom ? `<button class="mission-action-link" data-action="edit-mission">✎ Edit</button>` : ''}
      ${m.isCustom ? `<button class="mission-action-link" data-action="delete-mission" style="color:var(--stamp);">🗑 Delete</button>` : ''}
    </div>
    <div class="mission-notes-area" data-notes-area>
      <div class="mission-notes-label">Notes</div>
      <textarea data-action="edit-notes" placeholder="Anything you want to remember about this flight…">${escapeHtml(m.notes || '')}</textarea>
    </div>
    <div class="mission-photos" data-photos></div>
  `;

  // Wire up handlers
  el.querySelector('[data-action="toggle-complete"]').addEventListener('change', (e) => {
    m.completed = e.target.checked;
    m.completedDate = m.completed ? new Date().toISOString() : null;
    el.classList.toggle('completed', m.completed);
    markDirty();
    updateProgress();
    updateMarker(m.id);
  });

  el.querySelector('[data-action="toggle-notes"]').addEventListener('click', () => {
    el.querySelector('[data-notes-area]').classList.toggle('expanded');
  });

  el.querySelector('[data-action="edit-notes"]').addEventListener('input', debounce((e) => {
    m.notes = e.target.value;
    markDirty();
  }, 400));

  el.querySelector('[data-action="add-photo"]').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        await uploadPhotoForMission(m.id, f);
      }
    });
    input.click();
  });

  const editBtn = el.querySelector('[data-action="edit-mission"]');
  if (editBtn) editBtn.addEventListener('click', () => openMissionEditor(m));
  const deleteBtn = el.querySelector('[data-action="delete-mission"]');
  if (deleteBtn) deleteBtn.addEventListener('click', () => deleteMission(m.id));

  // Auto-expand notes if they have content
  if (m.notes) {
    el.querySelector('[data-notes-area]').classList.add('expanded');
  }

  // Render photos async
  renderPhotosForMission(el, m);

  return el;
}

async function renderPhotosForMission(el, m) {
  const container = el.querySelector('[data-photos]');
  if (!container) return;
  container.innerHTML = '';
  if (!m.photos || m.photos.length === 0) return;
  for (const photo of m.photos) {
    const url = await getPhotoUrl(photo.filename);
    if (!url) continue;
    const div = document.createElement('div');
    div.className = 'mission-photo';
    div.innerHTML = `
      <img src="${url}" alt="">
      ${photo.caption ? `<div class="mission-photo-caption">${escapeHtml(photo.caption)}</div>` : ''}
      <button class="mission-photo-delete" title="Delete photo">×</button>
    `;
    div.querySelector('img').addEventListener('click', () => openLightbox(url, photo, m.id));
    div.querySelector('.mission-photo-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deletePhoto(m.id, photo.id);
    });
    container.appendChild(div);
  }
}

function renderMission(missionId) {
  const m = state.data.missions.find((x) => x.id === missionId);
  if (!m) return;
  const el = document.querySelector(`[data-mission-id="${CSS.escape(missionId)}"]`);
  if (!el) return;
  const newEl = buildMissionElement(m);
  el.replaceWith(newEl);
}

function updateProgress() {
  const total = state.data.missions.length;
  const done = state.data.missions.filter((m) => m.completed).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  $('#completed-count').textContent = done;
  $('#total-count').textContent = total;
  $('#completed-pct').textContent = pct;
  $('#progress-fill').style.width = pct + '%';
}

// ============================================================
// Map
// ============================================================
function renderMap() {
  if (state.map) {
    state.map.remove();
    state.map = null;
    state.markers = {};
  }

  const map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    pane: 'shadowPane'
  }).addTo(map);

  const catColors = {};
  (state.data.categories || []).forEach((c) => { catColors[c.id] = c.color; });

  state.data.missions.forEach((m) => {
    if (typeof m.lat !== 'number' || typeof m.lng !== 'number') return;
    const baseColor = catColors[m.category] || '#1a1612';
    const fillColor = m.completed ? '#1f4d3f' : baseColor;
    const marker = L.circleMarker([m.lat, m.lng], {
      radius: 7,
      fillColor,
      color: '#1a1612',
      weight: m.completed ? 2 : 1.5,
      opacity: 1,
      fillOpacity: 0.85
    }).addTo(map);
    marker.bindPopup(`<b>${escapeHtml(m.title)}</b>${m.subtitle ? escapeHtml(m.subtitle) + '<br>' : ''}${m.lat.toFixed(2)}, ${m.lng.toFixed(2)}`);
    marker.on('click', () => {
      const el = document.querySelector(`[data-mission-id="${CSS.escape(m.id)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    state.markers[m.id] = { marker, baseColor };
  });

  // Legend
  const legend = L.control({ position: 'topright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = (state.data.categories || []).map((c) =>
      `<div class="legend-row"><span class="dot" style="background:${c.color}"></span> ${escapeHtml(c.name)}</div>`
    ).join('') + `<div class="legend-row" style="margin-top:6px;border-top:1px solid var(--rule);padding-top:6px;"><span class="dot" style="background:#1f4d3f"></span> Flown</div>`;
    return div;
  };
  legend.addTo(map);

  state.map = map;
}

function updateMarker(missionId) {
  const m = state.data.missions.find((x) => x.id === missionId);
  const ref = state.markers[missionId];
  if (!m || !ref) return;
  ref.marker.setStyle({
    fillColor: m.completed ? '#1f4d3f' : ref.baseColor,
    weight: m.completed ? 2 : 1.5
  });
}

// ============================================================
// Mission editor modal
// ============================================================
function openMissionEditor(mission = null) {
  const isNew = !mission;
  const m = mission || {
    id: '',
    title: '',
    subtitle: '',
    category: 'custom',
    flightTime: '',
    aircraft: '',
    tags: [],
    description: '',
    brief: '',
    lat: 0,
    lng: 0,
    completed: false,
    notes: '',
    photos: [],
    isCustom: true
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2>${isNew ? 'New Mission' : 'Edit Mission'}</h2>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label>Title</label>
          <input type="text" data-field="title" value="${escapeHtml(m.title)}" placeholder="The Denali Job">
        </div>
        <div class="form-row">
          <label>Subtitle</label>
          <input type="text" data-field="subtitle" value="${escapeHtml(m.subtitle || '')}" placeholder="Talkeetna → Summit → Talkeetna">
        </div>
        <div class="form-row-group">
          <div class="form-row">
            <label>Category</label>
            <select data-field="category">
              ${(state.data.categories || []).map((c) =>
                `<option value="${c.id}" ${m.category === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>Flight Time</label>
            <input type="text" data-field="flightTime" value="${escapeHtml(m.flightTime || '')}" placeholder="~1H 45M">
          </div>
        </div>
        <div class="form-row">
          <label>Aircraft</label>
          <input type="text" data-field="aircraft" value="${escapeHtml(m.aircraft || '')}" placeholder="PC-6 Porter">
        </div>
        <div class="form-row-group">
          <div class="form-row">
            <label>Latitude</label>
            <input type="number" step="0.0001" data-field="lat" value="${m.lat || 0}">
          </div>
          <div class="form-row">
            <label>Longitude</label>
            <input type="number" step="0.0001" data-field="lng" value="${m.lng || 0}">
          </div>
        </div>
        <div class="form-row">
          <label>Tags (comma-separated)</label>
          <input type="text" data-field="tags" value="${escapeHtml((m.tags || []).join(', '))}" placeholder="SIGNATURE, TIGHT MARGINS">
        </div>
        <div class="form-row">
          <label>Description</label>
          <textarea data-field="description" placeholder="The full mission brief.">${escapeHtml(m.description || '')}</textarea>
        </div>
        <div class="form-row">
          <label>Brief Note (italic, secondary)</label>
          <textarea data-field="brief" placeholder="Caveats, tips, alternatives.">${escapeHtml(m.brief || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" data-save>${isNew ? 'Create' : 'Save'}</button>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => backdrop.remove()));

  backdrop.querySelector('[data-save]').addEventListener('click', () => {
    const get = (field) => backdrop.querySelector(`[data-field="${field}"]`).value;
    const updated = {
      ...m,
      title: get('title').trim(),
      subtitle: get('subtitle').trim(),
      category: get('category'),
      flightTime: get('flightTime').trim(),
      aircraft: get('aircraft').trim(),
      lat: parseFloat(get('lat')) || 0,
      lng: parseFloat(get('lng')) || 0,
      tags: get('tags').split(',').map((t) => t.trim()).filter(Boolean),
      description: get('description').trim(),
      brief: get('brief').trim(),
      isCustom: true
    };

    if (!updated.title) {
      toast('Title is required', 'error');
      return;
    }

    if (isNew) {
      // Generate unique ID
      let id = slugify(updated.title) || 'mission-' + Date.now();
      let n = 1;
      while (state.data.missions.some((x) => x.id === id)) {
        id = slugify(updated.title) + '-' + (++n);
      }
      updated.id = id;
      state.data.missions.push(updated);
      toast('Mission created');
    } else {
      const idx = state.data.missions.findIndex((x) => x.id === m.id);
      if (idx >= 0) state.data.missions[idx] = updated;
      toast('Mission saved');
    }

    markDirty();
    renderAll();
    backdrop.remove();
  });

  document.body.appendChild(backdrop);
}

async function deleteMission(missionId) {
  const m = state.data.missions.find((x) => x.id === missionId);
  if (!m) return;
  if (!confirm(`Delete "${m.title}" and all its photos? This cannot be undone.`)) return;

  // Delete photos from disk
  if (m.photos && state.imagesHandle) {
    for (const p of m.photos) {
      try {
        await state.imagesHandle.removeEntry(p.filename);
      } catch (e) { /* ignore */ }
    }
  }

  state.data.missions = state.data.missions.filter((x) => x.id !== missionId);
  markDirty();
  renderAll();
  toast('Mission deleted');
}

// ============================================================
// Lightbox
// ============================================================
function openLightbox(url, photo, missionId) {
  const backdrop = document.createElement('div');
  backdrop.className = 'lightbox-backdrop';
  backdrop.innerHTML = `<img src="${url}" alt=""><div class="lightbox-caption">${photo.caption ? escapeHtml(photo.caption) : ''}</div>`;
  backdrop.addEventListener('click', () => backdrop.remove());
  document.body.appendChild(backdrop);
}

// ============================================================
// Journal drawer
// ============================================================
function openJournal() {
  $('#journal-drawer').classList.add('open');
  renderJournal('freeform');
}
function closeJournal() {
  $('#journal-drawer').classList.remove('open');
}

function renderJournal(tab) {
  const body = $('#journal-body');
  $$('.drawer-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  if (tab === 'freeform') {
    body.innerHTML = `<textarea class="freeform-editor" placeholder="Captain's notes…">${escapeHtml(state.data.journal.freeform || '')}</textarea>`;
    body.querySelector('textarea').addEventListener('input', debounce((e) => {
      state.data.journal.freeform = e.target.value;
      markDirty();
    }, 400));
  } else {
    body.innerHTML = `
      <div class="journal-add-entry">
        <textarea id="new-entry-text" placeholder="What happened today in the cockpit?"></textarea>
        <div style="margin-top: 10px; text-align: right;">
          <button class="btn btn-primary btn-small" id="add-entry-btn">+ Add Entry</button>
        </div>
      </div>
      <div id="journal-entries"></div>
    `;

    body.querySelector('#add-entry-btn').addEventListener('click', () => {
      const ta = body.querySelector('#new-entry-text');
      const text = ta.value.trim();
      if (!text) return;
      const entry = {
        id: uuid(),
        date: new Date().toISOString(),
        body: text
      };
      state.data.journal.entries = state.data.journal.entries || [];
      state.data.journal.entries.unshift(entry);
      markDirty();
      ta.value = '';
      renderJournalEntries();
      toast('Entry added');
    });

    renderJournalEntries();
  }
}

function renderJournalEntries() {
  const div = $('#journal-entries');
  if (!div) return;
  const entries = state.data.journal.entries || [];
  if (entries.length === 0) {
    div.innerHTML = `<p style="color: var(--muted); font-style: italic; text-align: center; margin: 30px 0;">No entries yet.</p>`;
    return;
  }
  div.innerHTML = '';
  entries.forEach((e) => {
    const date = new Date(e.date);
    const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const el = document.createElement('div');
    el.className = 'journal-entry';
    el.innerHTML = `
      <div class="journal-entry-header">
        <div class="journal-entry-date">${dateStr}</div>
        <div class="journal-entry-actions">
          <button class="mission-action-link" data-edit>Edit</button>
          <button class="mission-action-link" style="color:var(--stamp);" data-delete>Delete</button>
        </div>
      </div>
      <div class="journal-entry-body">${escapeHtml(e.body)}</div>
    `;
    el.querySelector('[data-delete]').addEventListener('click', () => {
      if (!confirm('Delete this entry?')) return;
      state.data.journal.entries = state.data.journal.entries.filter((x) => x.id !== e.id);
      markDirty();
      renderJournalEntries();
    });
    el.querySelector('[data-edit]').addEventListener('click', () => {
      const ta = document.createElement('textarea');
      ta.value = e.body;
      ta.style.cssText = 'width:100%;min-height:120px;font-family:Fraunces,serif;font-size:14px;padding:10px;background:var(--paper);border:1px solid var(--rule);';
      const bodyDiv = el.querySelector('.journal-entry-body');
      bodyDiv.replaceWith(ta);
      ta.focus();
      ta.addEventListener('blur', () => {
        e.body = ta.value;
        markDirty();
        renderJournalEntries();
      });
    });
    div.appendChild(el);
  });
}

// ============================================================
// Wire-up
// ============================================================

function init() {
  // Browser support warning
  if (!FSA_SUPPORTED) {
    $('#browser-warning').style.display = 'block';
    $('#open-folder-btn').disabled = true;
    $('#create-folder-btn').disabled = true;
  }

  // Welcome screen actions
  $('#open-folder-btn').addEventListener('click', () => pickFolder(false));
  $('#create-folder-btn').addEventListener('click', () => pickFolder(true));

  // Header actions
  $('#journal-btn').addEventListener('click', openJournal);
  $('#journal-close').addEventListener('click', closeJournal);
  $('#add-mission-btn').addEventListener('click', () => openMissionEditor());
  $('#close-folder-btn').addEventListener('click', () => {
    state.folderHandle = null;
    state.imagesHandle = null;
    state.data = null;
    showWelcome();
  });
  $('#settings-btn').addEventListener('click', openSettings);

  // Drawer tabs
  $$('.drawer-tab').forEach((t) => {
    t.addEventListener('click', () => renderJournal(t.dataset.tab));
  });

  // Filters
  $('#search-input').addEventListener('input', debounce((e) => {
    state.filters.search = e.target.value;
    renderMissions();
  }, 200));
  $('#filter-category').addEventListener('change', (e) => {
    state.filters.category = e.target.value;
    renderMissions();
  });
  $('#filter-status').addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    renderMissions();
  });
  window.addEventListener('filters-changed', () => {
    state.filters.search = $('#search-input').value;
    state.filters.category = $('#filter-category').value;
    state.filters.status = $('#filter-status').value;
    renderMissions();
  });

  // Map toggle
  $('#map-toggle').addEventListener('click', () => {
    const map = $('#map');
    const collapsed = map.classList.toggle('collapsed');
    $('#map-toggle').textContent = collapsed ? '▶ Show map' : '▼ Hide map';
    if (!collapsed && state.map) setTimeout(() => state.map.invalidateSize(), 320);
  });

  // ESC closes drawer/modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const lightbox = document.querySelector('.lightbox-backdrop');
      if (lightbox) { lightbox.remove(); return; }
      const modal = document.querySelector('.modal-backdrop');
      if (modal) { modal.remove(); return; }
      if ($('#journal-drawer').classList.contains('open')) closeJournal();
    }
  });
}

function openSettings() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2>Logbook Settings</h2>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label>Logbook Title</label>
          <input type="text" data-field="title" value="${escapeHtml(state.data.title || '')}">
        </div>
        <div class="form-row">
          <label>Subtitle</label>
          <input type="text" data-field="subtitle" value="${escapeHtml(state.data.subtitle || '')}">
        </div>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--rule);">
          <h3 style="font-family: 'Fraunces', serif; font-size: 16px; margin: 0 0 12px;">Export</h3>
          <button class="btn" data-export>Download logbook.json</button>
          <p style="color: var(--muted); font-size: 12px; margin-top: 8px;">Useful for backups or sharing your logbook with others.</p>
        </div>
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--rule);">
          <h3 style="font-family: 'Fraunces', serif; font-size: 16px; margin: 0 0 12px;">AI Mission Generator</h3>
          <p style="color: var(--muted); font-size: 13px; margin-bottom: 12px;">Coming soon: paste an Anthropic API key, answer a few questions, and have Claude generate a custom set of missions tailored to your interests.</p>
          <button class="btn" disabled>Generate Missions (Coming Soon)</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" data-save>Save</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => backdrop.remove()));
  backdrop.querySelector('[data-save]').addEventListener('click', () => {
    state.data.title = backdrop.querySelector('[data-field="title"]').value;
    state.data.subtitle = backdrop.querySelector('[data-field="subtitle"]').value;
    markDirty();
    renderAll();
    backdrop.remove();
  });
  backdrop.querySelector('[data-export]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'logbook.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  document.body.appendChild(backdrop);
}

document.addEventListener('DOMContentLoaded', init);

})();
