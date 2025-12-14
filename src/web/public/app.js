const $ = (sel) => document.querySelector(sel);

let config = null;
let selectedHubId = null;

function toast(el, kind, msg) {
  el.innerHTML = `<div class="toast ${kind === 'ok' ? 'ok' : 'err'}">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? {'Content-Type':'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed: ${method} ${url}`);
  }
  return json;
}

async function loadConfig() {
  config = await api('GET', '/api/config');
  $('#artnetBindIp').value = config.artnet?.bindIp || '0.0.0.0';
  renderHubsList();
  if (config.hubs.length && !selectedHubId) {
    selectedHubId = config.hubs[0].id;
  }
  renderHubEditor();
}

function renderDiscoverList(items) {
  const root = $('#discoverList');
  root.innerHTML = '';
  if (!items.length) {
    root.innerHTML = `<div class="muted">No hubs found.</div>`;
    return;
  }
  for (const b of items) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="item-title">
        <div>
          <strong>${escapeHtml(b.name || 'Hue Bridge')}</strong>
          <span class="pill">${escapeHtml(b.ip)}</span>
        </div>
        <button class="btn" data-ip="${escapeHtml(b.ip)}">Use IP</button>
      </div>
      <div class="muted">Press the link button on the hub, then pair.</div>
    `;
    div.querySelector('button').addEventListener('click', () => {
      $('#pairHost').value = b.ip;
      $('#pairName').value = b.name || '';
    });
    root.appendChild(div);
  }
}

function renderHubsList() {
  const root = $('#hubsList');
  root.innerHTML = '';
  if (!config.hubs.length) {
    root.innerHTML = `<div class="muted">No hubs paired yet.</div>`;
    return;
  }
  for (const hub of config.hubs) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="item-title">
        <div>
          <strong>${escapeHtml(hub.name || hub.id)}</strong>
          <span class="pill">${escapeHtml(hub.id)}</span>
        </div>
        <div class="row">
          <button class="btn" data-act="edit">Edit</button>
          <button class="btn danger" data-act="remove">Remove</button>
        </div>
      </div>
      <div class="muted">Host: ${escapeHtml(hub.host)} · Universe: ${escapeHtml(hub.artNetUniverse)}</div>
    `;
    div.querySelector('[data-act="edit"]').addEventListener('click', () => {
      selectedHubId = hub.id;
      renderHubEditor();
    });
    div.querySelector('[data-act="remove"]').addEventListener('click', () => {
      if (!confirm(`Remove hub "${hub.name || hub.id}"?`)) return;
      config.hubs = config.hubs.filter(h => h.id !== hub.id);
      if (selectedHubId === hub.id) selectedHubId = config.hubs[0]?.id || null;
      renderHubsList();
      renderHubEditor();
    });
    root.appendChild(div);
  }
}

function renderHubEditor() {
  const card = $('#hubEditorCard');
  const root = $('#hubEditor');
  root.innerHTML = '';

  const hub = config.hubs.find(h => h.id === selectedHubId);
  if (!hub) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const entId = hub.entertainmentRoomId ?? '';
  root.innerHTML = `
    <div class="grid2">
      <div class="panel">
        <div class="panel-title">Connection</div>
        <div class="panel-body form">
          <label><span>Hub id</span><input id="hubId" disabled value="${escapeHtml(hub.id)}" /></label>
          <label><span>Name</span><input id="hubName" value="${escapeHtml(hub.name || '')}" /></label>
          <label><span>Host</span><input id="hubHost" value="${escapeHtml(hub.host)}" /></label>
          <label><span>Art-Net universe</span><input id="hubUniverse" type="number" min="0" max="32767" value="${escapeHtml(hub.artNetUniverse)}" /></label>
          <div class="row">
            <button id="btnLoadRooms" class="btn">Load entertainment rooms</button>
            <button id="btnLoadLights" class="btn">Load lights</button>
          </div>
          <div id="hubConnStatus"></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Entertainment room</div>
        <div class="panel-body form">
          <label>
            <span>Selected room id</span>
            <input id="hubRoomId" placeholder="Pick a room below" value="${escapeHtml(entId)}" />
          </label>
          <div id="roomsList" class="list"></div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="panel">
      <div class="panel-title">Lights (DMX mapping)</div>
      <div class="panel-body">
        <div class="row">
          <button id="btnAutoMap" class="btn">Auto-map (sequential RGB)</button>
          <button id="btnAutoMapDimmable" class="btn">Auto-map (dimmable)</button>
        </div>
        <div id="lightsTableWrap" class="muted" style="margin-top:10px;">Load rooms, pick a room, then map lights.</div>
      </div>
    </div>
  `;

  $('#hubName').addEventListener('input', (e) => hub.name = e.target.value);
  $('#hubHost').addEventListener('input', (e) => hub.host = e.target.value);
  $('#hubUniverse').addEventListener('input', (e) => hub.artNetUniverse = Number(e.target.value || 0));
  $('#hubRoomId').addEventListener('input', (e) => {
    const v = String(e.target.value || '').trim();
    hub.entertainmentRoomId = v.length ? v : undefined;
  });

  $('#btnLoadRooms').addEventListener('click', async () => {
    const status = $('#hubConnStatus');
    try {
      status.innerHTML = `<div class="muted">Loading rooms…</div>`;
      const rooms = await api('GET', `/api/hubs/${encodeURIComponent(hub.id)}/rooms`);
      renderRoomsList(hub, rooms);
      toast(status, 'ok', 'Rooms loaded.');
    } catch (e) {
      toast(status, 'err', e.message);
    }
  });

  $('#btnLoadLights').addEventListener('click', async () => {
    const status = $('#hubConnStatus');
    try {
      status.innerHTML = `<div class="muted">Loading lights…</div>`;
      const lights = await api('GET', `/api/hubs/${encodeURIComponent(hub.id)}/lights`);
      hub._allLights = lights;
      toast(status, 'ok', 'Lights loaded.');
    } catch (e) {
      toast(status, 'err', e.message);
    }
  });

  $('#btnAutoMap').addEventListener('click', () => autoMap(hub, '8bit'));
  $('#btnAutoMapDimmable').addEventListener('click', () => autoMap(hub, '8bit-dimmable'));

  // If we already have a room id, render lights table from current config
  renderLightsTable(hub);
}

function renderRoomsList(hub, rooms) {
  const root = $('#roomsList');
  root.innerHTML = '';
  if (!rooms.length) {
    root.innerHTML = `<div class="muted">No entertainment rooms found.</div>`;
    return;
  }
  for (const r of rooms) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="item-title">
        <div>
          <strong>${escapeHtml(r.name || `Room ${r.id}`)}</strong>
          <span class="pill">id ${escapeHtml(r.id)}</span>
        </div>
        <button class="btn" data-act="select">Select</button>
      </div>
      <div class="muted">Lights: ${escapeHtml((r.lights || []).join(', '))}</div>
    `;
    div.querySelector('[data-act="select"]').addEventListener('click', () => {
      hub.entertainmentRoomId = String(r.id);
      $('#hubRoomId').value = String(r.id);
      hub._selectedRoomLights = r.lights || [];
      renderLightsTable(hub);
    });
    root.appendChild(div);
  }
}

function autoMap(hub, mode) {
  const roomLights = hub._selectedRoomLights || [];
  if (!roomLights.length) {
    alert('Select an entertainment room first (Load rooms → Select).');
    return;
  }
  const width = mode === '8bit-dimmable' ? 4 : mode === '16bit' ? 6 : 3;
  hub.lights = roomLights.map((id, idx) => ({
    lightId: String(id),
    dmxStart: (idx * width) + 1,
    channelMode: mode,
  }));
  renderLightsTable(hub);
}

function renderLightsTable(hub) {
  const wrap = $('#lightsTableWrap');
  const roomLights = hub._selectedRoomLights || [];
  const hasRoom = !!hub.entertainmentRoomId;
  if (!hasRoom) {
    wrap.innerHTML = `<div class="muted">Select an entertainment room to map lights.</div>`;
    return;
  }

  // If we don't know the room's lights list yet, still show current config.
  const lightIds = roomLights.length ? roomLights.map(String) : (hub.lights || []).map(l => String(l.lightId));
  if (!lightIds.length) {
    wrap.innerHTML = `<div class="muted">No lights available. Load rooms and select one, then auto-map.</div>`;
    return;
  }

  // Ensure every room light has a mapping row.
  const byId = new Map((hub.lights || []).map(l => [String(l.lightId), l]));
  const rows = lightIds.map(id => byId.get(String(id)) || {lightId: String(id), dmxStart: '', channelMode: '8bit-dimmable'});

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Light id</th>
          <th>DMX start</th>
          <th>Mode</th>
          <th>Test</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr data-id="${escapeHtml(r.lightId)}">
            <td><span class="pill">${escapeHtml(r.lightId)}</span></td>
            <td><input class="dmxStart" type="number" min="1" max="512" value="${escapeHtml(r.dmxStart)}" placeholder="e.g. 1" /></td>
            <td>
              <select class="mode">
                <option value="8bit" ${r.channelMode === '8bit' ? 'selected' : ''}>8bit (RGB)</option>
                <option value="8bit-dimmable" ${r.channelMode === '8bit-dimmable' ? 'selected' : ''}>8bit dimmable (Dim+RGB)</option>
                <option value="16bit" ${r.channelMode === '16bit' ? 'selected' : ''}>16bit (RGB fine)</option>
              </select>
            </td>
            <td><button class="btn ping">Ping</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="muted">Remember to click <strong>Save</strong> after editing.</div>
  `;

  wrap.querySelectorAll('tr[data-id]').forEach(tr => {
    const id = tr.getAttribute('data-id');
    const dmxInput = tr.querySelector('.dmxStart');
    const modeSel = tr.querySelector('.mode');
    const pingBtn = tr.querySelector('.ping');

    const ensure = () => {
      if (!hub.lights) hub.lights = [];
      const idx = hub.lights.findIndex(l => String(l.lightId) === String(id));
      if (idx === -1) {
        hub.lights.push({lightId: String(id), dmxStart: 1, channelMode: '8bit-dimmable'});
        return hub.lights[hub.lights.length - 1];
      }
      return hub.lights[idx];
    };

    dmxInput.addEventListener('input', () => {
      const l = ensure();
      l.dmxStart = Number(dmxInput.value || 0);
    });
    modeSel.addEventListener('change', () => {
      const l = ensure();
      l.channelMode = modeSel.value;
    });
    pingBtn.addEventListener('click', async () => {
      try {
        await api('POST', `/api/hubs/${encodeURIComponent(hub.id)}/ping`, {lightId: id});
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

async function save() {
  $('#btnSave').disabled = true;
  try {
    config.artnet.bindIp = $('#artnetBindIp').value || '0.0.0.0';
    await api('PUT', '/api/config', config);
    alert('Saved.');
  } catch (e) {
    alert(e.message);
  } finally {
    $('#btnSave').disabled = false;
  }
}

async function discover() {
  const status = $('#discoverStatus');
  status.textContent = 'Searching…';
  try {
    const hubs = await api('GET', '/api/hubs/discover');
    renderDiscoverList(hubs);
    status.textContent = `Found ${hubs.length}.`;
  } catch (e) {
    status.textContent = e.message;
  }
}

async function pair() {
  const host = $('#pairHost').value.trim();
  const name = $('#pairName').value.trim();
  const status = $('#pairStatus');
  if (!host) {
    status.textContent = 'Enter hub IP first.';
    return;
  }
  status.textContent = 'Pairing… (press link button)';
  try {
    const res = await api('POST', '/api/hubs/pair', {host, name: name || undefined});
    status.textContent = `Paired: ${res.hub.id}`;
    await loadConfig();
    selectedHubId = res.hub.id;
    renderHubEditor();
  } catch (e) {
    status.textContent = e.message;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  $('#btnDiscover').addEventListener('click', discover);
  $('#btnPair').addEventListener('click', pair);
  $('#btnSave').addEventListener('click', save);
  $('#btnReload').addEventListener('click', loadConfig);
  $('#artnetBindIp').addEventListener('input', (e) => {
    if (config?.artnet) config.artnet.bindIp = e.target.value;
  });
  await loadConfig();
});


