const {
  APP_NAME,
  APP_VERSION,
  PROJECT_SCHEMA_VERSION,
  STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  NATURAL_SORT
} = globalThis.SystemCoreConfig;

let project = normalizeProject(loadProject());
let activeOutput = "diagram";
let rackViewMode = "front";
let elevationViewMode = "front";
let selectedRackId = "";
let selectedElevationDeviceId = "";
let portCompatibilityDriver = "from";
let outputTemplatePreview = false;

const els = globalThis.SystemCoreDom.getElements();

function loadProject() {
  const storageKeys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  for (const key of storageKeys) {
    const stored = localStorage.getItem(key);
    if (!stored) continue;
    try {
      return JSON.parse(stored);
    } catch {
      continue;
    }
  }
  return createBlankProject();
}

function createBlankProject() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    name: "New Project",
    version: `${APP_NAME} ${APP_VERSION}`,
    author: APP_NAME,
    updated: new Date().toISOString(),
    template: defaultTemplate(),
    shapeStandards: defaultShapeStandards(),
    rooms: [],
    racks: [],
    devices: [],
    connections: []
  };
}

function normalizeProject(input) {
  const normalized = structuredClone(input || createBlankProject());
  const legacyPrototypeVersion = !normalized.schemaVersion && normalized.version === "0.2 structured prototype";
  normalized.schemaVersion = PROJECT_SCHEMA_VERSION;
  normalized.appVersion = APP_VERSION;
  normalized.version = legacyPrototypeVersion ? `${APP_NAME} ${APP_VERSION}` : String(normalized.version || `${APP_NAME} ${APP_VERSION}`).trim();
  normalized.author = String(normalized.author || APP_NAME).replace("SystemCore prototype", APP_NAME).trim();
  normalized.name = String(normalized.name || "New Project").trim();
  normalized.updated = normalized.updated || new Date().toISOString();
  normalized.rooms = normalized.rooms || [];
  normalized.racks = normalized.racks || [];
  normalized.devices = normalized.devices || [];
  normalized.connections = normalized.connections || [];
  normalized.diagramLayoutRank = 0;
  delete normalized.diagramLayoutVariant;
  normalized.template = normalizeTemplate(normalized.template);
  normalized.shapeStandards = normalizeShapeStandards(normalized.shapeStandards);

  const roomIds = new Set(normalized.rooms.map((room) => room.id));
  normalized.racks = normalized.racks.map((rack) => ({
    ...rack,
    roomId: roomIds.has(rack.roomId) ? rack.roomId : "",
    sizeU: Math.max(1, Number(rack.sizeU) || 42)
  })).filter((rack) => rack.roomId);

  const rackIds = new Set(normalized.racks.map((rack) => rack.id));
  normalized.devices = normalized.devices.map((device) => {
    const category = String(device.category || "Other").trim() || "Other";
    const legacyRack = inferRackFromLocation(normalized.racks, device.location);
    const roomId = roomIds.has(device.roomId) ? device.roomId : legacyRack?.roomId || "";
    const rackId = rackIds.has(device.rackId) ? device.rackId : legacyRack?.id || "";
    let mount = normalizeMount(device.mount || (rackId ? "rack" : "room"), category);
    if (mount !== "room" && !rackId) mount = "room";
    const portProfile = normalizePortProfile(device.portProfile || inferPortProfile(category, device.ports));
    const portFaces = normalizePortFaces(device.portFaces, category);
    return {
      ...device,
      name: String(device.name || "").trim(),
      category,
      roomId,
      mount,
      rackId: mount === "room" ? "" : rackId,
      rackU: mount === "rack" ? normalizeRackU(device.rackU) : "",
      rackSpan: mount === "rack" ? Math.max(1, Number(device.rackSpan) || 1) : 1,
      maker: String(device.maker || "").trim(),
      model: String(device.model || "").trim(),
      serial: String(device.serial || "").trim(),
      asset: String(device.asset || "").trim(),
      deviceColour: normalizeDeviceColour(device.deviceColour),
      deviceLineWeight: normalizeLineWeight(device.deviceLineWeight),
      portProfile,
      portFaces,
      ports: generatePorts(category, portProfile, mount)
    };
  }).filter((device) => device.roomId);

  normalized.connections = normalized.connections
    .map((connection) => ({
      ...connection,
      cableColour: normalizeCableColour(connection.cableColour),
      lineWeight: normalizeLineWeight(connection.lineWeight),
      fromFace: normalizeFace(connection.fromFace),
      toFace: normalizeFace(connection.toFace)
    }))
    .filter((connection) => {
      return getDeviceFrom(normalized, connection.fromDevice) && getDeviceFrom(normalized, connection.toDevice);
    });
  return normalized;
}

function defaultTemplate() {
  return {
    source: "built-in",
    customSvg: "",
    customSvgName: "",
    marginTop: 5,
    marginRight: 5,
    marginBottom: 18,
    marginLeft: 5,
    sheetSize: "A3",
    orientation: "Landscape",
    company: "Company Name",
    logoText: "LOGO",
    title: "ICT system drawing",
    subtitle: "Generated from controlled SystemCore inputs",
    drawingNumber: "ICT-DRG-001",
    revision: "1.0",
    releaseStatus: "Draft",
    sensitivity: "Internal",
    drawnBy: "",
    checkedBy: "",
    approvedBy: "",
    copyright: "Copyright and ownership controlled by the issuing company.",
    notes: "Do not manually edit generated drawing outputs.\nAll drawing content is derived from SystemCore source data."
  };
}

function normalizeTemplate(template) {
  const defaults = defaultTemplate();
  const { revisions: ignoredRevisions, ...source } = template || {};
  const normalizedRevision = normalizeRevisionValue(source.revision || defaults.revision);
  const customSvg = String(source.customSvg || "").trim();
  return {
    ...defaults,
    ...source,
    source: source.source === "custom" && customSvg ? "custom" : "built-in",
    customSvg,
    customSvgName: String(source.customSvgName || "").trim(),
    marginTop: normalizeTemplateMargin(source.marginTop, defaults.marginTop),
    marginRight: normalizeTemplateMargin(source.marginRight, defaults.marginRight),
    marginBottom: normalizeTemplateMargin(source.marginBottom, defaults.marginBottom),
    marginLeft: normalizeTemplateMargin(source.marginLeft, defaults.marginLeft),
    sheetSize: ["A3", "A4"].includes(source.sheetSize) ? source.sheetSize : defaults.sheetSize,
    orientation: ["Landscape", "Portrait"].includes(source.orientation) ? source.orientation : defaults.orientation,
    releaseStatus: ["Draft", "Issued for review", "Issued for construction", "As built"].includes(source.releaseStatus)
      ? source.releaseStatus
      : defaults.releaseStatus,
    sensitivity: ["Internal", "Confidential", "Commercial in confidence", "Public"].includes(source.sensitivity)
      ? source.sensitivity
      : defaults.sensitivity,
    company: String(source.company || defaults.company).trim(),
    logoText: String(source.logoText || defaults.logoText).trim(),
    title: String(source.title || defaults.title).trim(),
    subtitle: String(source.subtitle || defaults.subtitle).trim(),
    drawingNumber: String(source.drawingNumber || defaults.drawingNumber).trim(),
    revision: normalizedRevision,
    drawnBy: String(source.drawnBy || "").trim(),
    checkedBy: String(source.checkedBy || "").trim(),
    approvedBy: String(source.approvedBy || "").trim(),
    copyright: String(source.copyright || defaults.copyright).trim(),
    notes: String(source.notes || defaults.notes).trim()
  };
}

function normalizeTemplateMargin(value, fallback) {
  const numeric = Number(value);
  return Math.max(0, Math.min(35, Number.isFinite(numeric) ? numeric : fallback));
}

function normalizeRevisionValue(value) {
  const revision = String(value || "1.0").trim();
  const letterMatch = revision.match(/^[A-Z]$/i);
  if (letterMatch) return `${revision.toUpperCase().charCodeAt(0) - 64}.0`;
  return revision || "1.0";
}

function defaultShapeStandards() {
  return {
    devices: {
      "Network Switch": { colour: "Blue", lineWeight: "Standard" },
      Server: { colour: "Green", lineWeight: "Standard" },
      "Patch Panel": { colour: "Orange", lineWeight: "Standard" },
      Display: { colour: "Purple", lineWeight: "Standard" },
      "Media Converter": { colour: "Teal", lineWeight: "Standard" },
      Storage: { colour: "Grey", lineWeight: "Standard" },
      Power: { colour: "Red", lineWeight: "Standard" },
      Other: { colour: "Grey", lineWeight: "Standard" }
    },
    cables: {
      copper: { colour: "Black", lineWeight: "Standard" },
      fiber: { colour: "Pink", lineWeight: "Standard" },
      display: { colour: "Black", lineWeight: "Standard" },
      coax: { colour: "Orange", lineWeight: "Standard" },
      power: { colour: "Red", lineWeight: "Standard" },
      hybrid: { colour: "Green", lineWeight: "Standard" },
      other: { colour: "Grey", lineWeight: "Standard" }
    }
  };
}

function normalizeShapeStandards(shapeStandards) {
  const defaults = defaultShapeStandards();
  const source = shapeStandards || {};
  const normalized = { devices: {}, cables: {} };
  Object.keys(defaults.devices).forEach((category) => {
    const style = source.devices?.[category] || {};
    const colour = normalizeDeviceColour(style.colour || defaults.devices[category].colour);
    normalized.devices[category] = {
      colour: colour === "Auto" ? defaults.devices[category].colour : colour,
      lineWeight: normalizeLineWeight(style.lineWeight || defaults.devices[category].lineWeight)
    };
  });
  Object.keys(defaults.cables).forEach((family) => {
    const style = source.cables?.[family] || {};
    const colour = normalizeCableColour(style.colour || defaults.cables[family].colour);
    normalized.cables[family] = {
      colour: colour === "Auto" ? defaults.cables[family].colour : colour,
      lineWeight: normalizeLineWeight(style.lineWeight || defaults.cables[family].lineWeight)
    };
  });
  return normalized;
}

function saveProject() {
  project.updated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function getRoom(id) {
  return project.rooms.find((room) => room.id === id);
}

function getRack(id) {
  return project.racks.find((rack) => rack.id === id);
}

function getDevice(id) {
  return getDeviceFrom(project, id);
}

function getDeviceFrom(source, id) {
  return source.devices.find((device) => device.id === id);
}

function isDrawableDiagramDevice(device) {
  return Boolean(
    device &&
      String(device.id || "").trim() &&
      String(device.name || "").trim() &&
      String(device.category || "").trim()
  );
}

function roomLabel(id) {
  const room = getRoom(id);
  return room ? `${room.name}${room.code ? ` (${room.code})` : ""}` : "Unknown room";
}

function rackLabel(id) {
  const rack = getRack(id);
  return rack ? `${rack.name} (${rack.sizeU}U)` : "Room mounted";
}

function deviceLabel(id) {
  const device = getDevice(id);
  return device ? device.name : "Unknown device";
}

function deviceLocation(device) {
  const room = roomLabel(device.roomId);
  const rack = getRack(device.rackId);
  if (!rack) return `${room} / room mounted`;
  return `${room} / ${rack.name}${isRackRail(device) ? ` / ${mountLabel(device.mount)}` : ""}`;
}

function rawMount(value) {
  return ["room", "rack", "rail-left", "rail-right"].includes(value) ? value : "room";
}

function normalizeMount(value, category = "") {
  const mount = rawMount(value);
  if (["rail-left", "rail-right"].includes(mount) && category !== "Power") return "rack";
  return mount;
}

function isRackMounted(device) {
  return normalizeMount(device.mount, device.category) === "rack";
}

function isRackRail(device) {
  return ["rail-left", "rail-right"].includes(normalizeMount(device.mount, device.category));
}

function mountLabel(value) {
  return (
    {
      room: "Room mounted",
      rack: "Rack mounted",
      "rail-left": "Left power rail",
      "rail-right": "Right power rail"
    }[rawMount(value)] || "Room mounted"
  );
}

function getFormValue(id) {
  return document.getElementById(id).value.trim();
}

function setFormValue(id, value) {
  document.getElementById(id).value = value ?? "";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function render() {
  project = normalizeProject(project);
  renderStats();
  renderStructure();
  renderCategoryFilter();
  renderDevicePlacementSelectors();
  renderDeviceSelectors();
  renderPortSelectors();
  renderPortPreview();
  renderDevices();
  renderConnections();
  renderTemplate();
  renderShapeStandards();
  renderDiagram();
  renderOutput();
  saveProject();
}

function renderStats() {
  const bom = buildBom();
  const completeness = calculateCompleteness();
  els.projectName.textContent = project.name;
  els.projectNameInput.value = project.name;
  els.deviceCount.textContent = project.devices.length;
  els.cableCount.textContent = project.connections.length;
  els.bomCount.textContent = bom.length;
  els.rackCount.textContent = `${project.rooms.length} / ${project.racks.length}`;
  els.completeness.textContent = `${completeness}%`;
  els.completenessBar.style.width = `${completeness}%`;
}

function calculateCompleteness() {
  const required = ["name", "category", "roomId", "maker", "model", "serial", "ports"];
  const total = project.devices.length * required.length || 1;
  const scored = project.devices.reduce((sum, device) => {
    return (
      sum +
      required.filter((field) => {
        const value = device[field];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
      }).length
    );
  }, 0);
  return Math.round((scored / total) * 100);
}

function renderStructure() {
  renderRackSizeOptions();
  renderRoomOptions(els.rackRoom, els.rackRoom.value || project.rooms[0]?.id);
  if (!project.rooms.length) {
    els.structureList.innerHTML = `
      <article class="structure-card empty-state">
        <h4>No rooms yet</h4>
        <p class="muted">Create a room first, then add racks and devices inside it.</p>
      </article>
    `;
    return;
  }
  els.structureList.innerHTML = project.rooms
    .map((room) => {
      const racks = project.racks.filter((rack) => rack.roomId === room.id);
      const devices = project.devices.filter((device) => device.roomId === room.id);
      return `
        <article class="structure-card">
          <header>
            <h4>${escapeHtml(room.name)}</h4>
            <span class="pill">${escapeHtml(room.code || "No code")}</span>
          </header>
          <div class="structure-actions">
            <button class="text-button" data-edit-room="${room.id}">Edit room</button>
            <button class="text-button" data-delete-room="${room.id}">Delete room</button>
          </div>
          <div class="structure-nested">
            ${racks
              .map(
                (rack) => `
                <div class="structure-row">
                  <strong>${escapeHtml(rack.name)}</strong>
                  <span>${rack.sizeU}U rack</span>
                  <button class="text-button" data-edit-rack="${rack.id}">Edit</button>
                  <button class="text-button" data-delete-rack="${rack.id}">Delete</button>
                </div>
              `
              )
              .join("") || `<p class="muted">No racks in this room yet.</p>`}
          </div>
          <p class="muted">${devices.length} device${devices.length === 1 ? "" : "s"} assigned to this room.</p>
        </article>
      `;
    })
    .join("");
}

function renderRackSizeOptions() {
  const current = els.rackSize.value || "42";
  const sizes = [6, 9, 12, 18, 24, 27, 32, 38, 42, 45, 48, 52];
  els.rackSize.innerHTML = sizes.map((size) => `<option value="${size}">${size}U</option>`).join("");
  els.rackSize.value = sizes.includes(Number(current)) ? current : "42";
}

function renderRoomOptions(select, preferredValue = select.value) {
  if (!project.rooms.length) {
    select.innerHTML = `<option value="">Create a room first</option>`;
    select.value = "";
    return;
  }
  select.innerHTML = project.rooms
    .map((room) => `<option value="${room.id}">${escapeHtml(roomLabel(room.id))}</option>`)
    .join("");
  select.value = project.rooms.some((room) => room.id === preferredValue) ? preferredValue : project.rooms[0]?.id || "";
}

function renderCategoryFilter() {
  const categories = Array.from(new Set(project.devices.map((device) => device.category))).sort();
  const current = els.categoryFilter.value || "All";
  els.categoryFilter.innerHTML = `<option value="All">All categories</option>${categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("")}`;
  els.categoryFilter.value = categories.includes(current) ? current : "All";
}

function renderDevicePlacementSelectors() {
  renderRoomOptions(els.deviceRoom, els.deviceRoom.value || project.rooms[0]?.id);
  renderMountOptions();
  renderRackOptions();
  renderRackUOptions();
  renderMountingFields();
}

function renderMountOptions(preferredValue = els.deviceMount.value) {
  const category = getFormValue("device-category");
  const options = [
    ["room", "Room mounted / no rack"],
    ["rack", "Rack mounted (uses RU)"],
    ...(category === "Power"
      ? [
          ["rail-left", "Rack power rail - left"],
          ["rail-right", "Rack power rail - right"]
        ]
      : [])
  ];
  els.deviceMount.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  const mount = normalizeMount(preferredValue, category);
  els.deviceMount.value = options.some(([value]) => value === mount) ? mount : "room";
}

function renderRackOptions(preferredValue = els.deviceRack.value) {
  const racks = project.racks.filter((rack) => rack.roomId === els.deviceRoom.value);
  els.deviceRack.innerHTML = `<option value="">Room mounted / no rack</option>${racks
    .map((rack) => `<option value="${rack.id}">${escapeHtml(rack.name)} (${rack.sizeU}U)</option>`)
    .join("")}`;
  els.deviceRack.value = racks.some((rack) => rack.id === preferredValue)
    ? preferredValue
    : normalizeMount(els.deviceMount.value, getFormValue("device-category")) === "room"
      ? ""
      : racks[0]?.id || "";
}

function renderRackUOptions(preferredValue = els.deviceRackU.value) {
  if (normalizeMount(els.deviceMount.value, getFormValue("device-category")) !== "rack") {
    els.deviceRackU.innerHTML = `<option value="">N/A</option>`;
    els.deviceRackU.value = "";
    els.deviceRackU.disabled = true;
    return;
  }
  const rack = getRack(els.deviceRack.value);
  if (!rack) {
    els.deviceRackU.innerHTML = `<option value="">N/A</option>`;
    els.deviceRackU.value = "";
    els.deviceRackU.disabled = true;
    return;
  }
  els.deviceRackU.disabled = false;
  const span = Math.min(rack.sizeU, Math.max(1, Number(getFormValue("device-rack-span")) || 1));
  const candidateBase = {
    id: getFormValue("device-id") || "__new_device__",
    rackId: rack.id,
    mount: "rack",
    rackSpan: span
  };
  const options = [];
  for (let u = rack.sizeU; u >= span; u -= 1) {
    const conflict = rackPlacementConflict({ ...candidateBase, rackU: u }, rack);
    const disabled = conflict ? " disabled" : "";
    const suffix = conflict ? ` - overlaps ${conflict.name}` : "";
    options.push(`<option value="${u}"${disabled}>U${u}${escapeHtml(suffix)}</option>`);
  }
  els.deviceRackU.innerHTML = options.join("");
  const preferredOption = Array.from(els.deviceRackU.options).find((option) => option.value === String(preferredValue) && !option.disabled);
  const fallbackOption = Array.from(els.deviceRackU.options).find((option) => !option.disabled);
  els.deviceRackU.value = preferredOption?.value || fallbackOption?.value || "";
}

function renderMountingFields() {
  const mount = normalizeMount(els.deviceMount.value, getFormValue("device-category"));
  const rackRequired = mount !== "room";
  els.deviceRack.disabled = !rackRequired;
  els.deviceRackU.disabled = mount !== "rack";
  document.getElementById("device-rack-span").disabled = mount !== "rack";
  if (!rackRequired) {
    els.deviceRack.value = "";
    els.deviceRackU.value = "";
  }
  if (mount !== "rack") {
    setFormValue("device-rack-span", "1");
  }
}

function renderDeviceSelectors() {
  if (!project.devices.length) {
    els.fromDevice.innerHTML = `<option value="">Add a device first</option>`;
    els.toDevice.innerHTML = `<option value="">Add a device first</option>`;
    els.fromDevice.value = "";
    els.toDevice.value = "";
    return;
  }
  const options = project.devices
    .map((device) => `<option value="${device.id}">${escapeHtml(device.name)}</option>`)
    .join("");
  const fromCurrent = els.fromDevice.value;
  const toCurrent = els.toDevice.value;
  els.fromDevice.innerHTML = options;
  els.toDevice.innerHTML = options;
  els.fromDevice.value = project.devices.some((device) => device.id === fromCurrent) ? fromCurrent : project.devices[0]?.id || "";
  els.toDevice.value = project.devices.some((device) => device.id === toCurrent)
    ? toCurrent
    : project.devices[1]?.id || project.devices[0]?.id || "";
}

function renderPortSelectors(driver = portCompatibilityDriver) {
  portCompatibilityDriver = driver;
  const fromPreferred = els.fromPort.value;
  const toPreferred = els.toPort.value;
  if (driver === "to") {
    renderPortSelector(els.toPort, els.toDevice.value, toPreferred, "", els.toFace.value);
    renderPortSelector(els.fromPort, els.fromDevice.value, fromPreferred, els.toPort.value, els.fromFace.value);
  } else {
    renderPortSelector(els.fromPort, els.fromDevice.value, fromPreferred, "", els.fromFace.value);
    renderPortSelector(els.toPort, els.toDevice.value, toPreferred, els.fromPort.value, els.toFace.value);
  }
  syncConnectionConductor();
}

function renderPortSelector(select, deviceId, preferredValue = select.value, compatibleWithPort = "", face = "Unspecified") {
  const device = getDevice(deviceId);
  const ports = device?.ports?.length ? device.ports : ["Unspecified"];
  const currentConnectionId = getFormValue("connection-id");
  const usedPorts = getUsedPorts(deviceId, currentConnectionId, face);
  select.innerHTML = ports
    .map((port) => {
      const inUse = usedPorts.has(port) && port !== preferredValue;
      const incompatible = compatibleWithPort && !arePortsCompatible(port, compatibleWithPort);
      const disabled = inUse || incompatible ? " disabled" : "";
      const notes = [];
      if (inUse) notes.push("in use");
      if (incompatible) notes.push(`not ${portFamilyLabel(portFamily(compatibleWithPort))}`);
      const suffix = notes.length ? ` (${notes.join(", ")})` : "";
      return `<option value="${escapeHtml(port)}"${disabled}>${escapeHtml(port + suffix)}</option>`;
    })
    .join("");
  const isValidPreferred =
    ports.includes(preferredValue) &&
    !usedPorts.has(preferredValue) &&
    (!compatibleWithPort || arePortsCompatible(preferredValue, compatibleWithPort));
  const fallback = ports.find((port) => !usedPorts.has(port) && (!compatibleWithPort || arePortsCompatible(port, compatibleWithPort))) || ports[0];
  select.value = isValidPreferred ? preferredValue : fallback;
}

function getUsedPorts(deviceId, excludeConnectionId = "", face = "Unspecified") {
  const used = new Set();
  project.connections.forEach((connection) => {
    if (connection.id === excludeConnectionId) return;
    if (connection.fromDevice === deviceId && portUseConflicts(deviceId, connection.fromPort, connection.fromFace, connection.fromPort, face)) used.add(connection.fromPort);
    if (connection.toDevice === deviceId && portUseConflicts(deviceId, connection.toPort, connection.toFace, connection.toPort, face)) used.add(connection.toPort);
  });
  return used;
}

function isPortInUse(deviceId, port, excludeConnectionId = "", face = "Unspecified") {
  return getUsedPorts(deviceId, excludeConnectionId, face).has(port);
}

function portUseConflicts(deviceId, existingPort, existingFace, candidatePort, candidateFace) {
  if (existingPort !== candidatePort) return false;
  const device = getDevice(deviceId);
  if (device?.category !== "Patch Panel") return true;
  const firstFace = normalizeFace(existingFace);
  const secondFace = normalizeFace(candidateFace);
  return firstFace === "Unspecified" || secondFace === "Unspecified" || firstFace === secondFace;
}

function portFamily(port) {
  const value = String(port || "").trim().toUpperCase();
  if (!value || value === "UNSPECIFIED") return "unknown";
  if (/^\d+$/.test(value)) return "power";
  if (/^(SFP|QSFP|GBIC|LC|SC|ST|FC|TE)/.test(value) || value.includes("FIBER") || value.includes("FIBRE")) return "fiber";
  if (/^(HDMI|DP|DISPLAYPORT|DVI|SDI)/.test(value)) return "display";
  if (/^(PWR|POWER|IEC|MAINS)/.test(value)) return "power";
  if (/^(GI|FA|ETH|NIC|IDRAC|LAN|RJ45)/.test(value) || /^[A-Z]\d{2}$/.test(value)) return "copper";
  return "unknown";
}

function arePortsCompatible(firstPort, secondPort) {
  const firstFamily = portFamily(firstPort);
  const secondFamily = portFamily(secondPort);
  if (firstFamily === "unknown" || secondFamily === "unknown") return true;
  return firstFamily === secondFamily;
}

function portFamilyLabel(family) {
  return (
    {
      copper: "copper",
      fiber: "fiber",
      display: "display",
      power: "power",
      coax: "coax"
    }[family] || "known"
  );
}

function syncConnectionConductor(source = "ports") {
  const family = source === "cable" ? cableTypeFamily(getFormValue("cable-type")) : matchingEndpointFamily();
  const conductor = {
    copper: "Copper",
    fiber: "Fiber",
    coax: "Coax",
    power: "Power"
  }[family];
  if (conductor) setFormValue("conductor-type", conductor);
}

function matchingEndpointFamily() {
  const fromFamily = portFamily(els.fromPort.value);
  const toFamily = portFamily(els.toPort.value);
  if (fromFamily === "unknown" || toFamily === "unknown" || fromFamily !== toFamily) return "";
  return fromFamily;
}

function cableTypeFamily(cableType) {
  const value = String(cableType || "").trim().toUpperCase();
  if (!value || value === "OTHER") return "unknown";
  if (value.includes("OM") || value.includes("LC") || value.includes("FIBER") || value.includes("FIBRE")) return "fiber";
  if (value.includes("SDI") || value.includes("COAX")) return "coax";
  if (value.includes("IEC") || value.includes("POWER")) return "power";
  if (value.includes("CAT") || value.includes("HDMI")) return "copper";
  return "unknown";
}

function conductorFamily(conductor) {
  const value = String(conductor || "").trim().toUpperCase();
  if (value === "COPPER") return "copper";
  if (value === "FIBER" || value === "FIBRE") return "fiber";
  if (value === "COAX") return "coax";
  if (value === "POWER") return "power";
  return "unknown";
}

function areCableDetailsCompatible(cableType, conductor) {
  const cableFamily = cableTypeFamily(cableType);
  const conductorType = conductorFamily(conductor);
  if (cableFamily === "unknown" || conductorType === "unknown") return true;
  return cableFamily === conductorType;
}

function renderPortPreview() {
  const category = getFormValue("device-category");
  const profile = readPortProfile();
  const faces = readPortFaces();
  const mount = normalizeMount(getFormValue("device-mount"), category);
  const ports = generatePorts(category, profile, mount);
  const labelledPorts = ports.map((port) => `${port} (${normalizeFace(faces[portFamily(port)] || "Front")})`);
  els.portPreview.textContent = labelledPorts.length ? labelledPorts.join(", ") : "No ports generated yet.";
}

function renderDevices() {
  const query = els.deviceSearch.value.trim().toLowerCase();
  const category = els.categoryFilter.value;
  const devices = project.devices.filter((device) => {
    const haystack = [
      device.name,
      device.category,
      deviceLocation(device),
      formatRackRange(device),
      device.maker,
      device.model,
      device.serial,
      device.asset,
      device.notes,
      ...(device.ports || [])
    ]
      .join(" ")
      .toLowerCase();
    return (!query || haystack.includes(query)) && (category === "All" || device.category === category);
  });

  if (!devices.length) {
    els.deviceList.innerHTML = `
      <article class="device-card empty-state">
        <h4>No devices yet</h4>
        <p class="muted">Add a room in Structure, then create your first device here.</p>
      </article>
    `;
    return;
  }

  els.deviceList.innerHTML = devices
    .map(
      (device) => `
        <article class="device-card">
          <header>
            <h4>${escapeHtml(device.name)}</h4>
            <span class="pill">${escapeHtml(device.category)}</span>
          </header>
          <div class="device-meta">
            <span>${escapeHtml(deviceLocation(device))}</span>
            <span>${escapeHtml(formatRackRange(device))}</span>
            <span>${escapeHtml(device.maker || "Unknown maker")} ${escapeHtml(device.model || "")}</span>
          </div>
          <div class="device-meta">
            <span>Serial: ${escapeHtml(device.serial || "TBC")}</span>
            <span>Ports: ${(device.ports || []).length}</span>
          </div>
          <div class="card-actions">
            <button class="text-button" data-edit-device="${device.id}">Edit</button>
            <button class="text-button" data-delete-device="${device.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderConnections() {
  if (!project.connections.length) {
    els.connectionTable.innerHTML = `
      <tr>
        <td colspan="5" class="muted">No connections yet. Add at least two devices, then create a connection.</td>
      </tr>
    `;
    return;
  }
  els.connectionTable.innerHTML = project.connections
    .map(
      (connection) => `
      <tr>
        <td><button class="text-button" data-edit-connection="${connection.id}">${escapeHtml(connection.label)}</button></td>
        <td>${escapeHtml(deviceLabel(connection.fromDevice))}<br><span class="muted">${escapeHtml(connection.fromPort)}</span></td>
        <td>${escapeHtml(deviceLabel(connection.toDevice))}<br><span class="muted">${escapeHtml(connection.toPort)}</span></td>
        <td>${escapeHtml(connection.cableType)}<br><span class="muted">${escapeHtml(connection.conductor)} / ${escapeHtml(connection.length)}</span></td>
        <td>
          <span class="pill">${escapeHtml(connection.status)}</span>
          <button class="text-button" data-delete-connection="${connection.id}">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");
}

function renderDiagram() {
  els.overviewDiagram.innerHTML = buildDiagramSvg();
}

function realignDiagram() {
  const optionCount = diagramLayoutOptionCount();
  project.diagramLayoutRank = ((Number(project.diagramLayoutRank) || 0) + 1) % optionCount;
  renderDiagram();
  if (activeOutput === "diagram") renderOutput();
  saveProject();
  showToast(project.diagramLayoutRank === 0 ? "Best automatic diagram restored" : `Showing ranked diagram option ${project.diagramLayoutRank + 1} of ${optionCount}`);
}

function resetDiagramOptimization() {
  project.diagramLayoutRank = 0;
}

function renderTemplate() {
  const template = project.template;
  els.templateSource.value = template.source;
  els.customTemplateFields.classList.toggle("hidden", template.source !== "custom");
  els.customTemplateName.textContent = template.customSvgName || "No template imported";
  els.templateMarginTop.value = template.marginTop;
  els.templateMarginRight.value = template.marginRight;
  els.templateMarginBottom.value = template.marginBottom;
  els.templateMarginLeft.value = template.marginLeft;
  els.templateSheetSize.value = template.sheetSize;
  els.templateOrientation.value = template.orientation;
  els.templateCompany.value = template.company;
  els.templateLogoText.value = template.logoText;
  els.templateTitle.value = template.title;
  els.templateSubtitle.value = template.subtitle;
  els.templateDrawingNumber.value = template.drawingNumber;
  els.templateRevision.value = template.revision;
  els.templateReleaseStatus.value = template.releaseStatus;
  els.templateSensitivity.value = template.sensitivity;
  els.templateDrawnBy.value = template.drawnBy;
  els.templateCheckedBy.value = template.checkedBy;
  els.templateApprovedBy.value = template.approvedBy;
  els.templateCopyright.value = template.copyright;
  els.templateNotes.value = template.notes;
  els.templatePreview.innerHTML = buildSheetSvg(buildTemplatePlaceholderSvg(), "Template Preview");
}

function renderShapeStandards() {
  const standards = normalizeShapeStandards(project.shapeStandards);
  document.querySelectorAll("[data-device-style-colour]").forEach((select) => {
    const category = select.dataset.deviceStyleColour;
    renderSelectOptions(select, colourOptions(), standards.devices[category]?.colour || "Grey");
  });
  document.querySelectorAll("[data-device-style-weight]").forEach((select) => {
    const category = select.dataset.deviceStyleWeight;
    renderSelectOptions(select, lineWeightOptions(), standards.devices[category]?.lineWeight || "Standard");
  });
  document.querySelectorAll("[data-cable-style-colour]").forEach((select) => {
    const family = select.dataset.cableStyleColour;
    renderSelectOptions(select, colourOptions(), standards.cables[family]?.colour || "Grey");
  });
  document.querySelectorAll("[data-cable-style-weight]").forEach((select) => {
    const family = select.dataset.cableStyleWeight;
    renderSelectOptions(select, lineWeightOptions(), standards.cables[family]?.lineWeight || "Standard");
  });
  els.shapeStandardsPreview.innerHTML = buildShapeStandardsPreview(standards);
}

function renderSelectOptions(select, options, selected) {
  select.innerHTML = options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
  select.value = options.includes(selected) ? selected : options[0];
}

function buildShapeStandardsPreview(standards) {
  const devices = Object.entries(standards.devices)
    .map(([category, style]) => {
      const strokeWidth = {
        Thin: 1,
        Standard: 1.6,
        Heavy: 2.6
      }[style.lineWeight];
      return `
        <article class="style-preview-device">
          <svg viewBox="0 0 260 76" role="img" aria-label="${escapeHtml(category)} style preview">
            <rect x="8" y="10" width="244" height="56" rx="8" fill="#ffffff" stroke="#cbd5cf" stroke-width="${strokeWidth}" />
            <rect x="8" y="10" width="10" height="56" rx="5" fill="${cableColourHex(style.colour)}" />
            <text x="34" y="34" font-size="14" font-weight="800" fill="#17211d">${escapeHtml(category)}</text>
            <text x="34" y="53" font-size="11" fill="#65726c">${escapeHtml(style.colour)} / ${escapeHtml(style.lineWeight)}</text>
          </svg>
        </article>
      `;
    })
    .join("");
  const cables = Object.entries(standards.cables)
    .filter(([family]) => family !== "other")
    .map(([family, style]) => {
      const strokeWidth = {
        Thin: 2,
        Standard: 3,
        Heavy: 4.5
      }[style.lineWeight];
      return `
        <article class="style-preview-cable">
          <svg viewBox="0 0 310 48" role="img" aria-label="${escapeHtml(family)} cable style preview">
            <path d="M12 24 H292" fill="none" stroke="${cableColourHex(style.colour)}" stroke-width="${strokeWidth}" stroke-linecap="round" />
            <circle cx="12" cy="24" r="6" fill="#ffffff" stroke="${cableColourHex(style.colour)}" stroke-width="2" />
            <circle cx="292" cy="24" r="6" fill="#ffffff" stroke="${cableColourHex(style.colour)}" stroke-width="2" />
            <rect x="120" y="8" width="82" height="20" rx="5" fill="#fbfcfa" stroke="#d6ddd8" />
            <text x="161" y="23" font-size="11" text-anchor="middle" fill="#44514a">${escapeHtml(style.colour)}</text>
          </svg>
          <strong>${escapeHtml(titleCase(family))}</strong>
          <span>${escapeHtml(style.lineWeight)} line</span>
        </article>
      `;
    })
    .join("");
  return `
    <div class="style-preview-group">
      <h4>Device shapes</h4>
      <div class="style-preview-device-grid">${devices}</div>
    </div>
    <div class="style-preview-group">
      <h4>Cable lines</h4>
      <div class="style-preview-cable-grid">${cables}</div>
    </div>
  `;
}

function renderOutput() {
  els.outputSelectionControl.innerHTML = buildOutputSelectionControl();
  els.rackViewControl.classList.toggle("hidden", activeOutput !== "rack");
  els.realignDiagram.classList.toggle("hidden", activeOutput !== "diagram" || diagramLayoutOptionCount() < 2);
  els.rackViewButtons.forEach((button) => button.classList.toggle("active", button.dataset.rackView === rackViewMode));
  els.templateOutputToggle.checked = outputTemplatePreview;
  if (outputTemplatePreview) {
    els.outputPanel.innerHTML = `${buildDiagramCapacityNotice()}<div class="sheet-frame">${buildActiveOutputSheetSvg()}</div>`;
    return;
  }
  if (activeOutput === "diagram") {
    els.outputPanel.innerHTML = `${buildDiagramCapacityNotice()}<div class="diagram-frame">${buildDiagramSvg()}</div>`;
  }
  if (activeOutput === "rack") {
    els.outputPanel.innerHTML = buildRackLayout();
  }
  if (activeOutput === "elevations") {
    els.outputPanel.innerHTML = buildDeviceElevations();
  }
  if (activeOutput === "cables") {
    els.outputPanel.innerHTML = buildCableSchedule();
  }
  if (activeOutput === "bom") {
    els.outputPanel.innerHTML = buildBomHtml();
  }
  if (activeOutput === "version") {
    els.outputPanel.innerHTML = buildVersionHtml();
  }
}

function buildOutputSelectionControl() {
  if (activeOutput === "elevations") return buildElevationOutputControls();
  if (activeOutput === "rack") return buildRackOutputControls();
  return "";
}

function buildElevationOutputControls() {
  const devices = project.devices.filter(isDrawableDiagramDevice);
  if (!devices.length) return "";
  if (!devices.some((device) => device.id === selectedElevationDeviceId)) {
    selectedElevationDeviceId = devices[0].id;
  }
  const selectedDevice = getDevice(selectedElevationDeviceId) || devices[0];
  const options = devices
    .map((device) => `<option value="${device.id}" ${device.id === selectedDevice.id ? "selected" : ""}>${escapeHtml(device.name)} - ${escapeHtml(device.category)}</option>`)
    .join("");
  return `
    <label class="output-select-label">
      Device
      <select id="elevation-device-select">${options}</select>
    </label>
    <div class="segmented" role="tablist" aria-label="Elevation view">
      <button class="${elevationViewMode === "front" ? "active" : ""}" data-elevation-view="front">Front</button>
      <button class="${elevationViewMode === "rear" ? "active" : ""}" data-elevation-view="rear">Rear</button>
      <button class="${elevationViewMode === "both" ? "active" : ""}" data-elevation-view="both">Both</button>
    </div>
  `;
}

function buildRackOutputControls() {
  const racks = project.racks;
  if (!racks.length) return "";
  if (!racks.some((rack) => rack.id === selectedRackId)) {
    selectedRackId = racks[0].id;
  }
  const selectedRack = getRack(selectedRackId) || racks[0];
  const options = racks
    .map((rack) => `<option value="${rack.id}" ${rack.id === selectedRack.id ? "selected" : ""}>${escapeHtml(roomLabel(rack.roomId))} / ${escapeHtml(rack.name)} (${rack.sizeU}U)</option>`)
    .join("");
  return `
    <label class="output-select-label">
      Rack
      <select id="rack-output-select">${options}</select>
    </label>
  `;
}

function buildDiagramSvg(options = {}) {
  const trimToContent = Boolean(options.trimToContent);
  const layout = buildDiagramLayout();
  if (!layout.positions.length) {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" class="system-diagram" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Empty system block diagram">
        <rect width="${layout.width}" height="${layout.height}" fill="#fbfcfa" />
        <text x="34" y="34" font-size="18" font-weight="800" fill="#17211d">${escapeHtml(project.name)} block diagram</text>
        <text x="34" y="92" font-size="15" fill="#65726c">No devices yet. Add rooms, racks, and equipment to generate this diagram.</text>
      </svg>
    `;
  }

  const cablePathSvg = layout.routes
    .map((route) => {
      const style = cableStyle(route.connection);
      return `
        <path d="${route.path}" fill="none" stroke="#fbfcfa" stroke-width="${style.width + 5}" stroke-linecap="round" stroke-linejoin="round" />
        <path d="${route.path}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linecap="round" stroke-linejoin="round" />
      `;
    })
    .join("");
  const cableLabelSvg = layout.routes
    .map(
      (route) => `
        <g>
          <rect x="${route.labelX - route.labelWidth / 2}" y="${route.labelY - 14}" width="${route.labelWidth}" height="18" rx="5" fill="#fbfcfa" stroke="#d6ddd8" />
          <text x="${route.labelX}" y="${route.labelY}" font-size="12" fill="#44514a" text-anchor="middle">${escapeHtml(route.connection.label)}</text>
        </g>
      `
    )
    .join("");

  const nodeSvg = layout.positions
    .map((position) => {
      const device = getDevice(position.id);
      const deviceColor = deviceAccentColor(device);
      const deviceLine = deviceOutlineWidth(device);
      const leftPortReserve = position.ports
        .filter((port) => port.side === "left")
        .reduce((max, port) => Math.max(max, port.labelRectX + port.labelWidth - position.x), 0);
      const rightPortReserve = position.ports
        .filter((port) => port.side === "right")
        .reduce((max, port) => Math.max(max, position.x + position.w - port.labelRectX), 0);
      const contentX = position.x + Math.max(22, leftPortReserve + 18);
      const contentRightPadding = Math.max(18, rightPortReserve + 18);
      const contentWidth = Math.max(80, position.x + position.w - contentX - contentRightPadding);
      const titleLines = wrapTextLines(device.name, Math.floor(contentWidth / 8.5), 1);
      const subtitleLines = wrapTextLines(`${device.category} / ${deviceLocation(device)}`, Math.floor(contentWidth / 6.2), 2);
      const modelLines = wrapTextLines(device.model || "Model TBC", Math.floor(contentWidth / 5.8), 1);
      const portSvg = position.ports
        .map(
          (port) => `
          <g>
            <rect x="${port.labelRectX}" y="${port.labelRectY}" width="${port.labelWidth}" height="${port.labelHeight}" rx="5" fill="#fbfcfa" stroke="#cbd5cf" />
            <circle cx="${port.x}" cy="${port.y}" r="6" fill="#ffffff" stroke="${deviceColor}" stroke-width="${Math.max(2.4, deviceLine)}" />
            <text x="${port.labelX}" y="${port.labelY}" font-size="10" font-weight="800" fill="#26352f" text-anchor="${port.textAnchor}">${escapeHtml(port.port)}</text>
          </g>
        `
        )
        .join("");
      return `
        <g>
          <rect x="${position.x}" y="${position.y}" width="${position.w}" height="${position.h}" rx="8" fill="#ffffff" stroke="#cbd5cf" stroke-width="${deviceLine}" />
          <rect x="${position.x}" y="${position.y}" width="10" height="${position.h}" rx="5" fill="${deviceColor}" />
          ${svgTextLines(titleLines, contentX, position.y + 28, 16, 18, { weight: 800, fill: "#17211d" })}
          ${svgTextLines(subtitleLines, contentX, position.y + 50, 12, 15, { fill: "#65726c" })}
          ${svgTextLines(modelLines, contentX, position.y + 82, 11, 14, { fill: "#65726c" })}
          ${portSvg}
        </g>
      `;
    })
    .join("");

  const fullBounds = diagramFullBounds(layout);
  const viewBox = trimToContent ? diagramContentViewBox(layout) : boundsViewBox(fullBounds);

  return `
    <svg xmlns="http://www.w3.org/2000/svg" class="system-diagram" viewBox="${viewBox}" role="img" aria-label="Generated system block diagram">
      <rect x="${fullBounds.x}" y="${fullBounds.y}" width="${fullBounds.w}" height="${fullBounds.h}" fill="#fbfcfa" />
      <text x="34" y="34" font-size="18" font-weight="800" fill="#17211d">${escapeHtml(project.name)} block diagram</text>
      ${cablePathSvg}
      ${nodeSvg}
      ${cableLabelSvg}
    </svg>
  `;
}

function diagramFullBounds(layout) {
  const routePoints = layout.routes.flatMap((route) => route.segments.flatMap((segment) => [
    { x: segment.x1, y: segment.y1 },
    { x: segment.x2, y: segment.y2 }
  ]));
  const minX = Math.min(0, ...routePoints.map((point) => point.x - 24));
  const minY = Math.min(0, ...routePoints.map((point) => point.y - 24));
  const maxX = Math.max(layout.width, ...routePoints.map((point) => point.x + 24));
  const maxY = Math.max(layout.height, ...routePoints.map((point) => point.y + 24));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function boundsViewBox(bounds) {
  return `${Math.round(bounds.x)} ${Math.round(bounds.y)} ${Math.round(bounds.w)} ${Math.round(bounds.h)}`;
}

function diagramContentViewBox(layout) {
  const boxes = [
    { x: 20, y: 12, w: Math.max(260, project.name.length * 10 + 150), h: 34 },
    ...layout.positions,
    ...layout.routes.map((route) => route.labelBox)
  ];
  layout.routes.forEach((route) => {
    route.segments.forEach((segment) => {
      boxes.push({
        x: Math.min(segment.x1, segment.x2),
        y: Math.min(segment.y1, segment.y2),
        w: Math.abs(segment.x2 - segment.x1),
        h: Math.abs(segment.y2 - segment.y1)
      });
    });
  });
  const minX = Math.min(...boxes.map((box) => box.x)) - 46;
  const minY = Math.min(...boxes.map((box) => box.y)) - 42;
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + 46;
  const maxY = Math.max(...boxes.map((box) => box.y + box.h)) + 46;
  return `${Math.round(minX)} ${Math.round(minY)} ${Math.round(Math.max(240, maxX - minX))} ${Math.round(Math.max(180, maxY - minY))}`;
}

function buildTemplatePlaceholderSvg() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" class="system-diagram" viewBox="0 0 900 430" role="img" aria-label="Template drawing area preview">
      <rect width="900" height="430" fill="#fbfcfa" />
      <text x="450" y="188" font-size="28" font-weight="800" fill="#d6ddd8" text-anchor="middle">Generated drawing area</text>
      <text x="450" y="224" font-size="15" fill="#8b9791" text-anchor="middle">Diagrams, rack layouts, elevations, schedules, and BOMs fit inside this controlled sheet</text>
    </svg>
  `;
}

function buildActiveOutputSheetSvg() {
  const outputNames = {
    diagram: "Block Diagram",
    rack: `${rackViewMode === "rear" ? "Rear" : "Front"} Rack Layout`,
    elevations: "Device Elevation",
    cables: "Cable Schedule",
    bom: "Bill of Materials",
    version: "Version Snapshot"
  };
  return buildSheetSvg(buildActiveOutputContentSvg({ forTemplate: true }), outputNames[activeOutput] || "Generated Output");
}

function buildActiveOutputContentSvg(options = {}) {
  if (activeOutput === "diagram") return buildDiagramSvg({ trimToContent: Boolean(options.forTemplate) });
  if (activeOutput === "elevations") return buildSelectedElevationSheetSvg();
  if (activeOutput === "rack") return buildRackSheetSvg();
  if (activeOutput === "cables") return buildCableScheduleSheetSvg();
  if (activeOutput === "bom") return buildBomSheetSvg();
  return buildVersionSheetSvg();
}

function buildSheetSvg(contentSvg, drawingType = "Drawing") {
  const template = normalizeTemplate(project.template);
  if (template.source === "custom" && template.customSvg) {
    return buildCustomTemplateSheetSvg(contentSvg, template);
  }
  const sheet = sheetDimensions(template);
  const margin = template.sheetSize === "A4" ? 28 : 34;
  const titleBlockH = template.orientation === "Landscape" ? 156 : 172;
  const drawingX = margin + 14;
  const drawingY = margin + 26;
  const drawingW = sheet.width - margin * 2 - 28;
  const drawingH = sheet.height - drawingY - titleBlockH - margin - 18;
  const parsed = parseSvgContent(contentSvg);
  const contentPad = template.sheetSize === "A4" ? 24 : 30;
  const noteLines = String(template.notes || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  const notesReserveH = noteLines.length ? 34 + noteLines.length * 15 + 36 : 0;
  const contentFrameX = drawingX + contentPad;
  const contentFrameY = drawingY + contentPad;
  const contentFrameW = Math.max(100, drawingW - contentPad * 2);
  const contentFrameH = Math.max(100, drawingH - contentPad * 2 - notesReserveH);
  const scale = Math.min(contentFrameW / parsed.width, contentFrameH / parsed.height);
  const contentW = parsed.width * scale;
  const contentH = parsed.height * scale;
  const contentX = contentFrameX + (contentFrameW - contentW) / 2;
  const contentY = contentFrameY + (contentFrameH - contentH) / 2;
  const generatedDate = new Date(project.updated || Date.now()).toLocaleDateString();

  return `
    <svg xmlns="http://www.w3.org/2000/svg" class="drawing-sheet" viewBox="0 0 ${sheet.width} ${sheet.height}" role="img" aria-label="${escapeHtml(template.title)} drawing sheet">
      <rect width="${sheet.width}" height="${sheet.height}" fill="#f7f8f6" />
      <rect x="${margin}" y="${margin}" width="${sheet.width - margin * 2}" height="${sheet.height - margin * 2}" fill="#ffffff" stroke="#1f2924" stroke-width="1.4" />
      <rect x="${margin + 12}" y="${margin + 12}" width="${sheet.width - margin * 2 - 24}" height="${sheet.height - margin * 2 - 24}" fill="none" stroke="#707b75" stroke-width="0.8" />
      <rect x="${drawingX}" y="${drawingY}" width="${drawingW}" height="${drawingH}" fill="#fbfcfa" stroke="#d6ddd8" stroke-width="0.8" />
      <svg x="${contentX}" y="${contentY}" width="${contentW}" height="${contentH}" viewBox="${parsed.viewBox}" preserveAspectRatio="xMidYMid meet">
        ${parsed.inner}
      </svg>
      ${buildSheetNotes(template, drawingX, drawingY, drawingW, drawingH)}
      ${buildSheetTitleBlock(template, sheet, margin, titleBlockH, generatedDate)}
    </svg>
  `;
}

function buildCustomTemplateSheetSvg(contentSvg, template) {
  const sheet = sheetDimensions(template);
  const background = parseSvgContent(template.customSvg);
  const content = parseSvgContent(contentSvg);
  const drawingX = (template.marginLeft / 100) * sheet.width;
  const drawingY = (template.marginTop / 100) * sheet.height;
  const drawingW = Math.max(100, sheet.width * (1 - (template.marginLeft + template.marginRight) / 100));
  const drawingH = Math.max(100, sheet.height * (1 - (template.marginTop + template.marginBottom) / 100));
  const pad = template.sheetSize === "A4" ? 18 : 24;
  const frameW = Math.max(80, drawingW - pad * 2);
  const frameH = Math.max(80, drawingH - pad * 2);
  const scale = Math.min(frameW / content.width, frameH / content.height);
  const contentW = content.width * scale;
  const contentH = content.height * scale;
  const contentX = drawingX + (drawingW - contentW) / 2;
  const contentY = drawingY + (drawingH - contentH) / 2;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" class="drawing-sheet" viewBox="0 0 ${sheet.width} ${sheet.height}" role="img" aria-label="${escapeHtml(template.title)} custom drawing sheet">
      <rect width="${sheet.width}" height="${sheet.height}" fill="#ffffff" />
      <svg x="0" y="0" width="${sheet.width}" height="${sheet.height}" viewBox="${background.viewBox}" preserveAspectRatio="none">
        ${background.inner}
      </svg>
      <svg x="${contentX}" y="${contentY}" width="${contentW}" height="${contentH}" viewBox="${content.viewBox}" preserveAspectRatio="xMidYMid meet">
        ${content.inner}
      </svg>
    </svg>
  `;
}

function buildSheetNotes(template, drawingX, drawingY, drawingW, drawingH) {
  const notes = template.notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!notes.length) return "";
  const boxW = Math.max(230, Math.min(390, drawingW * 0.32));
  const boxH = 34 + notes.length * 15;
  const boxX = drawingX + 18;
  const boxY = drawingY + drawingH - boxH - 18;
  const noteLimit = Math.max(26, Math.floor((boxW - 32) / 5.5));
  return `
    <g class="sheet-notes">
      <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="3" fill="#ffffff" stroke="#707b75" stroke-width="0.7" />
      <text x="${boxX + 14}" y="${boxY + 20}" font-size="10.5" font-weight="800" fill="#17211d">NOTES</text>
      ${notes
        .map((note, index) => `<text x="${boxX + 14}" y="${boxY + 39 + index * 15}" font-size="9.5" fill="#44514a">${index + 1}. ${escapeHtml(truncateText(note, noteLimit))}</text>`)
        .join("")}
    </g>
  `;
}

function buildSheetTitleBlock(template, sheet, margin, titleBlockH, generatedDate) {
  const y = sheet.height - margin - titleBlockH;
  const usableW = sheet.width - margin * 2;
  const leftW = Math.max(160, Math.min(225, usableW * 0.22));
  const approvalX = margin + leftW;
  const approvalW = Math.max(230, Math.min(310, usableW * 0.3));
  const titleX = approvalX + approvalW;
  const titleW = sheet.width - margin - titleX;
  const rowH = titleBlockH / 4;
  const metaY = y + rowH * 2.25;
  const sizeW = Math.max(54, Math.min(74, titleW * 0.14));
  const dwgW = Math.max(116, Math.min(180, titleW * 0.28));
  const revW = Math.max(52, Math.min(70, titleW * 0.12));
  const projectW = titleW - sizeW - dwgW - revW;
  const dwgX = titleX + sizeW;
  const projectX = dwgX + dwgW;
  const revX = titleX + titleW - revW;
  const titleTextLimit = Math.max(22, Math.floor((titleW - 92) / 8));
  const subtitleLimit = Math.max(28, Math.floor((titleW - 92) / 5.8));
  const projectLimit = Math.max(12, Math.floor((projectW - 18) / 7));
  return `
    <g class="sheet-title-block">
      <rect x="${margin}" y="${y}" width="${sheet.width - margin * 2}" height="${titleBlockH}" fill="#ffffff" stroke="#1f2924" stroke-width="0.9" />
      <rect x="${margin}" y="${y}" width="${leftW}" height="${titleBlockH}" fill="none" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${margin}" y1="${y + rowH}" x2="${margin + leftW}" y2="${y + rowH}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${margin}" y1="${y + rowH * 2}" x2="${margin + leftW}" y2="${y + rowH * 2}" stroke="#1f2924" stroke-width="0.8" />
      <text x="${margin + 16}" y="${y + 23}" font-size="10" font-weight="800">REVISION</text>
      <text x="${margin + leftW - 24}" y="${y + 23}" font-size="16" font-weight="800" text-anchor="end">${escapeHtml(template.revision)}</text>
      <text x="${margin + 16}" y="${y + rowH + 23}" font-size="10" font-weight="800">RELEASE LEVEL</text>
      <text x="${margin + leftW - 16}" y="${y + rowH + 23}" font-size="12" font-weight="800" text-anchor="end">${escapeHtml(truncateText(template.releaseStatus, 18))}</text>
      <text x="${margin + 16}" y="${y + rowH * 2 + 23}" font-size="10" font-weight="800">SENSITIVITY</text>
      <text x="${margin + leftW - 16}" y="${y + rowH * 2 + 23}" font-size="11" font-weight="800" text-anchor="end">${escapeHtml(truncateText(template.sensitivity, 22))}</text>
      <text x="${margin + 16}" y="${y + titleBlockH - 14}" font-size="9">${escapeHtml(truncateText(template.copyright, 36))}</text>

      <rect x="${approvalX}" y="${y}" width="${approvalW}" height="${titleBlockH}" fill="none" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${approvalX}" y1="${y + rowH}" x2="${approvalX + approvalW}" y2="${y + rowH}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${approvalX}" y1="${y + rowH * 2}" x2="${approvalX + approvalW}" y2="${y + rowH * 2}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${approvalX}" y1="${y + rowH * 3}" x2="${approvalX + approvalW}" y2="${y + rowH * 3}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${approvalX + 78}" y1="${y}" x2="${approvalX + 78}" y2="${y + rowH * 3}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${approvalX + approvalW - 82}" y1="${y}" x2="${approvalX + approvalW - 82}" y2="${y + rowH * 3}" stroke="#1f2924" stroke-width="0.8" />
      ${approvalRow(approvalX, y, rowH, 0, "DRAWN", template.drawnBy, generatedDate)}
      ${approvalRow(approvalX, y, rowH, 1, "CHECK", template.checkedBy, "")}
      ${approvalRow(approvalX, y, rowH, 2, "APPROVE", template.approvedBy, "")}
      <text x="${approvalX + 18}" y="${y + rowH * 3 + 23}" font-size="10" font-weight="800">SOURCE</text>
      <text x="${approvalX + 84}" y="${y + rowH * 3 + 23}" font-size="10">SystemCore generated output</text>

      <rect x="${titleX}" y="${y}" width="${titleW}" height="${titleBlockH}" fill="none" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${titleX}" y1="${y + rowH}" x2="${titleX + titleW}" y2="${y + rowH}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${titleX}" y1="${metaY}" x2="${titleX + titleW}" y2="${metaY}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${dwgX}" y1="${metaY}" x2="${dwgX}" y2="${y + titleBlockH}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${projectX}" y1="${metaY}" x2="${projectX}" y2="${y + titleBlockH}" stroke="#1f2924" stroke-width="0.8" />
      <line x1="${revX}" y1="${metaY}" x2="${revX}" y2="${y + titleBlockH}" stroke="#1f2924" stroke-width="0.8" />
      <text x="${titleX + 16}" y="${y + 23}" font-size="11" font-weight="800">${escapeHtml(truncateText(template.company, 46))}</text>
      <text x="${titleX + titleW - 18}" y="${y + 24}" font-size="18" font-weight="900" text-anchor="end">${escapeHtml(truncateText(template.logoText, 14))}</text>
      <text x="${titleX + 16}" y="${y + rowH + 24}" font-size="10" font-weight="800">TITLE</text>
      <text x="${titleX + 74}" y="${y + rowH + 24}" font-size="15" font-weight="800">${escapeHtml(truncateText(template.title, titleTextLimit))}</text>
      <text x="${titleX + 74}" y="${y + rowH + 43}" font-size="9.5" fill="#65726c">${escapeHtml(truncateText(template.subtitle, subtitleLimit))}</text>
      <text x="${titleX + 12}" y="${metaY + 18}" font-size="9" font-weight="800">SIZE</text>
      <text x="${titleX + sizeW / 2}" y="${y + titleBlockH - 16}" font-size="18" font-weight="900" text-anchor="middle">${escapeHtml(template.sheetSize)}</text>
      <text x="${dwgX + 14}" y="${metaY + 18}" font-size="9" font-weight="800">DWG NO</text>
      <text x="${dwgX + 14}" y="${y + titleBlockH - 16}" font-size="11.5" font-weight="800">${escapeHtml(truncateText(template.drawingNumber, Math.max(10, Math.floor((dwgW - 22) / 7))))}</text>
      <text x="${projectX + 14}" y="${metaY + 18}" font-size="9" font-weight="800">PROJECT</text>
      <text x="${projectX + 14}" y="${y + titleBlockH - 16}" font-size="11.5">${escapeHtml(truncateText(project.name, projectLimit))}</text>
      <text x="${revX + revW / 2}" y="${metaY + 18}" font-size="9" font-weight="800" text-anchor="middle">REV</text>
      <text x="${revX + revW / 2}" y="${y + titleBlockH - 16}" font-size="16" font-weight="900" text-anchor="middle">${escapeHtml(template.revision)}</text>
    </g>
  `;
}

function approvalRow(x, y, rowH, index, label, value, date) {
  const rowY = y + rowH * index;
  return `
    <text x="${x + 12}" y="${rowY + 22}" font-size="9" font-weight="800">${label}</text>
    <text x="${x + 88}" y="${rowY + 22}" font-size="10">${escapeHtml(truncateText(value || "-", 18))}</text>
    <text x="${x + 238}" y="${rowY + 22}" font-size="10">${escapeHtml(date || "-")}</text>
  `;
}

function buildSelectedElevationSheetSvg() {
  const devices = project.devices.filter(isDrawableDiagramDevice);
  const selectedDevice = devices.find((device) => device.id === selectedElevationDeviceId) || devices[0];
  if (!selectedDevice) {
    return buildNoticeSvg("Device Elevation", ["No devices captured yet."]);
  }
  if (elevationViewMode === "both") {
    const front = buildElevationFaceSvg(selectedDevice, "front").match(/<svg[\s\S]*?<\/svg>/i)?.[0];
    const rear = buildElevationFaceSvg(selectedDevice, "rear").match(/<svg[\s\S]*?<\/svg>/i)?.[0];
    return buildCombinedElevationSheetSvg(selectedDevice, front, rear);
  }
  const face = elevationViewMode === "rear" ? "rear" : "front";
  const elevationHtml = buildElevationFaceSvg(selectedDevice, face);
  const svgMatch = elevationHtml.match(/<svg[\s\S]*?<\/svg>/i);
  if (svgMatch) return svgMatch[0];
  return buildNoticeSvg(`${selectedDevice.name} ${faceLabel(face)} elevation`, [`No ${faceLabel(face).toLowerCase()} ports captured for this device.`]);
}

function buildCombinedElevationSheetSvg(device, frontSvg, rearSvg) {
  if (!frontSvg && !rearSvg) return buildNoticeSvg(`${device.name} elevation`, ["No front or rear ports captured for this device."]);
  const front = frontSvg ? parseSvgContent(frontSvg) : null;
  const rear = rearSvg ? parseSvgContent(rearSvg) : null;
  const width = 1500;
  const height = 900;
  const panelX = 56;
  const panelW = width - panelX * 2;
  const panelH = 394;
  const renderPanel = (parsed, y, title) => {
    if (!parsed) {
      return `
        <rect x="${panelX}" y="${y}" width="${panelW}" height="${panelH}" rx="8" fill="#fbfcfa" stroke="#d6ddd8" />
        <text x="${panelX + 26}" y="${y + 38}" font-size="18" font-weight="800" fill="#17211d">${escapeHtml(title)}</text>
        <text x="${panelX + 26}" y="${y + 74}" font-size="14" fill="#65726c">No ports captured for this view.</text>
      `;
    }
    const focused = focusCombinedElevationViewBox(parsed);
    const titleH = 34;
    const contentHMax = panelH - titleH;
    const scale = Math.min(panelW / focused.width, contentHMax / focused.height);
    const contentW = focused.width * scale;
    const contentH = focused.height * scale;
    return `
      <text x="${panelX}" y="${y + 22}" font-size="18" font-weight="800" fill="#17211d">${escapeHtml(title)}</text>
      <svg x="${panelX + (panelW - contentW) / 2}" y="${y + titleH + (contentHMax - contentH) / 2}" width="${contentW}" height="${contentH}" viewBox="${focused.viewBox}" preserveAspectRatio="xMidYMid meet">
        ${parsed.inner}
      </svg>
    `;
  };
  return `
    <svg class="system-diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(device.name)} front and rear elevation">
      <rect width="${width}" height="${height}" fill="#fbfcfa" />
      <text x="44" y="42" font-size="22" font-weight="800" fill="#17211d">${escapeHtml(device.name)} elevations</text>
      ${renderPanel(front, 72, "Front elevation")}
      ${renderPanel(rear, 474, "Rear elevation")}
    </svg>
  `;
}

function focusCombinedElevationViewBox(parsed) {
  if (!parsed) return parsed;
  const trimTop = parsed.height <= 460 ? 30 : 24;
  const trimBottom = parsed.height <= 460 ? 32 : 24;
  const height = Math.max(220, parsed.height - trimTop - trimBottom);
  return {
    ...parsed,
    viewBox: `0 ${trimTop} ${parsed.width} ${height}`,
    height
  };
}

function buildRackSheetSvg() {
  const rack = selectedRack();
  if (!rack) return buildNoticeSvg("Rack Layout", ["No racks captured yet."]);
  const room = getRoom(rack.roomId);
  return buildRackSvg(room, rack);
}

function buildCableScheduleSheetSvg() {
  const rows = project.connections.map((connection) => [
    connection.label,
    `${deviceLabel(connection.fromDevice)} ${connection.fromPort}`,
    `${deviceLabel(connection.toDevice)} ${connection.toPort}`,
    connection.cableType,
    connection.status
  ]);
  return buildSheetTableContentSvg("Cable Schedule", ["Cable", "From", "To", "Type", "Status"], rows.length ? rows : [["No cables", "", "", "", ""]]);
}

function buildBomSheetSvg() {
  const rows = buildBom().map((line) => [line.item, `${line.qty} ${line.unit}`, line.source, line.description]);
  return buildSheetTableContentSvg("Bill of Materials", ["Item", "Qty", "Source", "Description"], rows.length ? rows : [["No BOM lines", "", "", ""]]);
}

function buildVersionSheetSvg() {
  const rows = [
    ["Project", project.name],
    ["Version", project.version],
    ["Updated", new Date(project.updated).toLocaleString()],
    ["Rooms", String(project.rooms.length)],
    ["Racks", String(project.racks.length)],
    ["Devices", String(project.devices.length)],
    ["Connections", String(project.connections.length)],
    ["Completeness", `${calculateCompleteness()}%`]
  ];
  return buildSheetTableContentSvg("Version Snapshot", ["Field", "Value"], rows);
}

function buildNoticeSvg(title, lines) {
  const safeLines = lines.length ? lines : ["No output available."];
  return `
    <svg class="system-diagram" viewBox="0 0 900 430" role="img" aria-label="${escapeHtml(title)}">
      <rect width="900" height="430" fill="#fbfcfa" />
      <text x="44" y="56" font-size="22" font-weight="800" fill="#17211d">${escapeHtml(title)}</text>
      ${safeLines.map((line, index) => `<text x="44" y="${104 + index * 28}" font-size="16" fill="#65726c">${escapeHtml(line)}</text>`).join("")}
    </svg>
  `;
}

function buildSheetTableContentSvg(title, columns, rows) {
  const width = 1100;
  const rowH = 34;
  const headerY = 78;
  const height = Math.max(430, headerY + rowH * (Math.min(rows.length, 18) + 2) + 40);
  const colW = width / columns.length;
  const visibleRows = rows.slice(0, 18);
  return `
    <svg class="system-diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
      <rect width="${width}" height="${height}" fill="#fbfcfa" />
      <text x="34" y="42" font-size="22" font-weight="800" fill="#17211d">${escapeHtml(title)}</text>
      <rect x="34" y="${headerY}" width="${width - 68}" height="${rowH}" fill="#eef2ef" stroke="#cbd5cf" />
      ${columns.map((column, index) => `<text x="${46 + index * colW}" y="${headerY + 22}" font-size="12" font-weight="800" fill="#17211d">${escapeHtml(truncateText(column, Math.max(10, Math.floor(colW / 8))))}</text>`).join("")}
      ${visibleRows
        .map((row, rowIndex) => {
          const y = headerY + rowH * (rowIndex + 1);
          return `
            <rect x="34" y="${y}" width="${width - 68}" height="${rowH}" fill="${rowIndex % 2 ? "#ffffff" : "#fbfcfa"}" stroke="#d6ddd8" />
            ${row
              .map((cell, colIndex) => `<text x="${46 + colIndex * colW}" y="${y + 22}" font-size="11" fill="#44514a">${escapeHtml(truncateText(cell, Math.max(10, Math.floor(colW / 7.5))))}</text>`)
              .join("")}
          `;
        })
        .join("")}
      ${
        rows.length > visibleRows.length
          ? `<text x="34" y="${height - 24}" font-size="12" fill="#65726c">${rows.length - visibleRows.length} more rows in source data</text>`
          : ""
      }
    </svg>
  `;
}

function sheetDimensions(template) {
  const landscape = template.orientation === "Landscape";
  const base = template.sheetSize === "A4" ? { width: 1123, height: 794 } : { width: 1587, height: 1123 };
  return landscape ? base : { width: base.height, height: base.width };
}

function parseSvgContent(svg) {
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : "0 0 1000 700";
  const [, , width = 1000, height = 700] = viewBox.split(/\s+/).map(Number);
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  return { viewBox, width: width || 1000, height: height || 700, inner };
}

function buildDiagramLayout() {
  const optionCount = diagramLayoutOptionCount();
  const requestedRank = Math.max(0, Math.min(optionCount - 1, Number(project.diagramLayoutRank) || 0));
  const candidates = Array.from({ length: optionCount }, (_, layoutVariant) => {
    const layout = buildDiagramLayoutCandidate(layoutVariant);
    return {
      ...layout,
      layoutVariant,
      qualityScore: scoreDiagramLayout(layout)
    };
  }).sort((first, second) => first.qualityScore - second.qualityScore || first.layoutVariant - second.layoutVariant);
  return candidates[Math.min(requestedRank, candidates.length - 1)];
}

function drawableDiagramConnectionCount() {
  const deviceIds = new Set(project.devices.filter(isDrawableDiagramDevice).map((device) => device.id));
  return project.connections.filter((connection) => deviceIds.has(connection.fromDevice) && deviceIds.has(connection.toDevice)).length;
}

function diagramLayoutOptionCount() {
  const connectionCount = drawableDiagramConnectionCount();
  if (connectionCount > 160) return 1;
  if (connectionCount > 80) return 3;
  return 6;
}

function buildDiagramLayoutCandidate(layoutVariant) {
  const devices = project.devices
    .filter(isDrawableDiagramDevice)
    .sort((first, second) => diagramDeviceSortKey(first).localeCompare(diagramDeviceSortKey(second)));
  const deviceIds = new Set(devices.map((device) => device.id));
  const drawableConnections = project.connections
    .filter((connection) => deviceIds.has(connection.fromDevice) && deviceIds.has(connection.toDevice))
    .sort((first, second) => diagramConnectionSortKey(first).localeCompare(diagramConnectionSortKey(second)));
  const portUsage = buildDiagramPortUsage(drawableConnections);
  const maxConnectedPorts = Math.max(0, ...devices.map((device) => portUsage.get(device.id)?.length || 0));
  const nodeW = 320;
  const columns = buildDiagramColumns(devices, drawableConnections, layoutVariant);
  const columnCount = columns.groups.length;
  const baseWidth = columns.rackAware || columnCount > 2 ? 1540 : 1240;
  const width = Math.max(baseWidth, baseWidth + Math.max(0, maxConnectedPorts - 4) * 30 + Math.max(0, drawableConnections.length - 8) * 10);
  const minNodeH = 104;
  const top = 74;
  const rowGap = columnCount > 2 ? 96 : 104;
  const nodeHeights = new Map(
    devices.map((device) => [device.id, Math.max(minNodeH, 92 + Math.max(0, portUsage.get(device.id)?.length || 0) * 20)])
  );
  const columnXs = diagramColumnXs(columnCount, width, nodeW);
  const laidOutColumns = columns.groups.map((group, index) =>
    layoutDiagramColumn(group, columnXs[index], top, rowGap, nodeW, nodeHeights, index)
  );
  const positions = laidOutColumns.flatMap((column) => column.positions);
  const positionMap = new Map(positions.map((position) => [position.id, position]));
  const validConnections = drawableConnections.filter((connection) => {
    return positionMap.has(connection.fromDevice) && positionMap.has(connection.toDevice);
  });
  const fastRouting = validConnections.length > 120;
  relaxDiagramPositions(positions, validConnections, columns.hubId, top);
  const contentHeight = Math.max(...positions.map((position) => position.y + position.h), top) + 46;
  const height = Math.max(420, contentHeight, Math.ceil(width / Math.SQRT2));
  const endpoints = buildDiagramEndpoints(validConnections, positionMap);
  positions.forEach((position) => {
    position.ports = endpoints.portsByDevice.get(position.id) || [];
  });
  const pairTotals = new Map();
  validConnections.forEach((connection) => {
    const pairKey = [connection.fromDevice, connection.toDevice].sort().join("::");
    pairTotals.set(pairKey, (pairTotals.get(pairKey) || 0) + 1);
  });
  const pairCounts = new Map();
  const sideLaneCounts = new Map();
  const routedSegments = [];
  const routeDrafts = validConnections.map((connection, index) => {
    const from = positionMap.get(connection.fromDevice);
    const to = positionMap.get(connection.toDevice);
    const start = endpoints.endpointPoints.get(`${connection.id}:from`);
    const end = endpoints.endpointPoints.get(`${connection.id}:to`);
    const startDirection = sideDirection(start.side);
    const endDirection = sideDirection(end.side);
    const startLaneKey = `${connection.fromDevice}:${start.side}`;
    const endLaneKey = `${connection.toDevice}:${end.side}`;
    const startLaneIndex = sideLaneCounts.get(startLaneKey) || 0;
    sideLaneCounts.set(startLaneKey, startLaneIndex + 1);
    const endLaneIndex = sideLaneCounts.get(endLaneKey) || 0;
    sideLaneCounts.set(endLaneKey, endLaneIndex + 1);
    const laneIndex = Math.max(startLaneIndex, endLaneIndex);
    const pairKey = [connection.fromDevice, connection.toDevice].sort().join("::");
    const pairIndex = pairCounts.get(pairKey) || 0;
    pairCounts.set(pairKey, pairIndex + 1);
    const pairTotal = pairTotals.get(pairKey) || 1;
    const sameColumn = Math.abs(from.x - to.x) < 10;
    const facingDevices = !sameColumn && startDirection !== endDirection;
    const routeLaneIndex = sameColumn ? Math.min(laneIndex, 4) : laneIndex;
    const pairOffset = facingDevices ? 0 : (pairIndex - (pairTotal - 1) / 2) * 42;
    const startLeadLength = facingDevices ? 16 : 62 + startLaneIndex * 22;
    const endLeadLength = facingDevices ? 16 : 62 + endLaneIndex * 22;
    const startLead = { x: start.x + startDirection * startLeadLength, y: start.y };
    const endLead = { x: end.x + endDirection * endLeadLength, y: end.y };
    const midX = sameColumn
      ? start.x + startDirection * (160 + routeLaneIndex * 64)
      : (startLead.x + endLead.x) / 2 + pairOffset + (startLaneIndex - endLaneIndex) * 12;
    const obstacles = positions.filter((position) => ![connection.fromDevice, connection.toDevice].includes(position.id));
    const segments = buildDiagramRouteSegments({
      start,
      end,
      startLead,
      endLead,
      midX,
      laneIndex: routeLaneIndex,
      sameColumn,
      facingDevices,
      previousSegments: routedSegments,
      obstacles,
      fastMode: fastRouting
    });
    const path = buildJumpPath(segments, routedSegments);
    routedSegments.push(...segments);
    return {
      connection,
      start,
      end,
      segments,
      path
    };
  });
  const labelBoxes = [];
  const nodeBoxes = positions.map((position) => ({
    x: position.x,
    y: position.y,
    w: position.w,
    h: position.h
  }));
  const routes = routeDrafts.map((route) => {
    const labelWidth = Math.max(34, route.connection.label.length * 7 + 14);
    const otherCableSegments = routedSegments.filter((segment) => !route.segments.includes(segment));
    const preferredSide = route.start.side === "left" || route.start.side === "bottom" ? -1 : 1;
    const label = placeRouteLabel(route.segments, labelWidth, labelBoxes, otherCableSegments, preferredSide, { width, height }, nodeBoxes, fastRouting);
    return {
      ...route,
      labelX: label.x,
      labelY: label.y,
      labelAnchorX: label.anchorX,
      labelAnchorY: label.anchorY,
      labelLeader: label.leader,
      labelWidth,
      labelBox: label.box
    };
  });
  return { width, height, positions, routes };
}

function scoreDiagramLayout(layout) {
  const previousSegments = [];
  let routeLength = 0;
  let bends = 0;
  let crossings = 0;
  let overlaps = 0;
  let nodeIntersections = 0;
  let nodeNearMisses = 0;
  let labelNodeIntersections = 0;
  let labelNodeNearMisses = 0;
  let labelCableIntersections = 0;
  let labelOverlaps = 0;
  let labelOutOfBounds = 0;
  let labelLeaders = 0;
  let labelOffset = 0;
  let labelsOffCable = 0;
  let verticalLabels = 0;

  layout.routes.forEach((route) => {
    routeLength += route.segments.reduce((total, segment) => total + segmentLength(segment), 0);
    bends += Math.max(0, route.segments.length - 1);
    route.segments.forEach((segment) => {
      crossings += segmentCrossings(segment, previousSegments).length;
      overlaps += parallelOverlapPenalty(segment, previousSegments);
      layout.positions.forEach((position) => {
        if ([route.connection.fromDevice, route.connection.toDevice].includes(position.id)) return;
        if (segmentIntersectsBox(segment, position, 12)) {
          nodeIntersections += 1;
        } else if (segmentIntersectsBox(segment, position, 30)) {
          nodeNearMisses += 1;
        }
      });
    });
    previousSegments.push(...route.segments);
  });

  layout.routes.forEach((route) => {
    if (route.labelBox.x < 12 || route.labelBox.y < 48 || route.labelBox.x + route.labelBox.w > layout.width - 12 || route.labelBox.y + route.labelBox.h > layout.height - 12) {
      labelOutOfBounds += 1;
    }
    layout.positions.forEach((position) => {
      if (boxesOverlapWithMargin(route.labelBox, position, 6)) {
        labelNodeIntersections += 1;
      } else if (boxesOverlapWithMargin(route.labelBox, position, 22)) {
        labelNodeNearMisses += 1;
      }
    });
    if (route.labelLeader) labelLeaders += 1;
    labelOffset += Math.abs(route.labelX - route.labelAnchorX) + Math.abs(route.labelY - route.labelAnchorY);
    const supportingSegment = route.segments.find((segment) => segmentIntersectsBox(segment, route.labelBox, 1));
    if (!supportingSegment) {
      labelsOffCable += 1;
    } else if (supportingSegment.orientation === "vertical") {
      verticalLabels += 1;
    }
    layout.routes.forEach((otherRoute) => {
      if (otherRoute === route) return;
      if (boxesOverlapWithMargin(route.labelBox, otherRoute.labelBox, 2)) labelOverlaps += 1;
      otherRoute.segments.forEach((segment) => {
        if (segmentIntersectsBox(segment, route.labelBox, 2)) labelCableIntersections += 1;
      });
    });
  });

  return (
    nodeIntersections * 12000 +
    nodeNearMisses * 1600 +
    labelOutOfBounds * 5000 +
    labelOverlaps * 4200 +
    overlaps * 3200 +
    labelNodeIntersections * 2600 +
    labelNodeNearMisses * 950 +
    labelsOffCable * 850 +
    labelLeaders * 520 +
    verticalLabels * 380 +
    labelCableIntersections * 700 +
    crossings * 850 +
    bends * 150 +
    labelOffset * 4 +
    routeLength * 0.22 +
    layout.height * 0.08
  );
}

function segmentIntersectsBox(segment, box, padding = 0) {
  const left = box.x - padding;
  const right = box.x + box.w + padding;
  const top = box.y - padding;
  const bottom = box.y + box.h + padding;
  if (segment.orientation === "horizontal") {
    return segment.y1 >= top && segment.y1 <= bottom && overlapLength(segment.x1, segment.x2, left, right) > 1;
  }
  return segment.x1 >= left && segment.x1 <= right && overlapLength(segment.y1, segment.y2, top, bottom) > 1;
}

function buildDiagramColumns(devices, connections, layoutVariant = 0) {
  if (!devices.length) return { groups: [], hubId: "" };
  const degree = new Map(devices.map((device) => [device.id, 0]));
  connections.forEach((connection) => {
    if (degree.has(connection.fromDevice)) degree.set(connection.fromDevice, degree.get(connection.fromDevice) + 1);
    if (degree.has(connection.toDevice)) degree.set(connection.toDevice, degree.get(connection.toDevice) + 1);
  });
  const rackAwareColumns = buildRackAwareDiagramColumns(devices, layoutVariant, degree);
  if (rackAwareColumns) return rackAwareColumns;
  const hub = devices.reduce((best, device) => {
    const difference = (degree.get(device.id) || 0) - (degree.get(best.id) || 0);
    if (difference > 0) return device;
    if (difference < 0) return best;
    return diagramDeviceSortKey(device).localeCompare(diagramDeviceSortKey(best)) < 0 ? device : best;
  }, devices[0]);
  if ((degree.get(hub.id) || 0) < 3) {
    const ordered = orderDiagramDevices(devices, layoutVariant, degree);
    return {
      groups: [ordered.filter((_, index) => index % 2 === 0), ordered.filter((_, index) => index % 2 === 1)],
      hubId: ""
    };
  }

  const neighborIds = [];
  connections.forEach((connection) => {
    if (connection.fromDevice === hub.id && !neighborIds.includes(connection.toDevice)) neighborIds.push(connection.toDevice);
    if (connection.toDevice === hub.id && !neighborIds.includes(connection.fromDevice)) neighborIds.push(connection.fromDevice);
  });
  const byId = new Map(devices.map((device) => [device.id, device]));
  const orderedNeighbors = orderDiagramDevices(neighborIds.map((id) => byId.get(id)).filter(Boolean), layoutVariant, degree);
  const neighborSet = new Set(orderedNeighbors.map((device) => device.id));
  const centralHub = neighborIds.length >= 5 || hub.category === "Patch Panel";
  if (centralHub) {
    const groups = [[], [hub], []];
    orderedNeighbors.forEach((device, index) => {
      groups[index % 2 === 0 ? 2 : 0].push(device);
    });
    orderDiagramDevices(
      devices.filter((device) => device.id !== hub.id && !neighborSet.has(device.id)),
      layoutVariant,
      degree
    )
      .forEach((device) => {
        const target = groups[0].length <= groups[2].length ? groups[0] : groups[2];
        target.push(device);
      });
    return { groups, hubId: hub.id };
  }
  const rightColumnCount = neighborIds.length > 12 ? 2 : 1;
  const groups = [[hub], ...Array.from({ length: rightColumnCount }, () => [])];
  orderedNeighbors.forEach((device, index) => {
      groups[1 + (index % rightColumnCount)].push(device);
  });
  orderDiagramDevices(
    devices.filter((device) => device.id !== hub.id && !neighborSet.has(device.id)),
    layoutVariant,
    degree
  )
    .forEach((device) => {
      const target = groups.slice(1).sort((first, second) => first.length - second.length)[0] || groups[0];
      target.push(device);
    });
  return { groups, hubId: hub.id };
}

function buildRackAwareDiagramColumns(devices, layoutVariant, degree) {
  const rackIds = [...new Set(devices.map((device) => device.rackId).filter(Boolean))];
  if (rackIds.length !== 2 || devices.some((device) => !device.rackId)) return null;
  const rackGroups = rackIds
    .map((rackId) => ({
      rackId,
      devices: devices.filter((device) => device.rackId === rackId)
    }))
    .filter((group) => group.devices.length >= 2)
    .sort((first, second) => diagramRackSortKey(first.rackId).localeCompare(diagramRackSortKey(second.rackId)));
  if (rackGroups.length !== 2) return null;
  return {
    groups: rackGroups.map((group) => orderRackClusterDevices(group.devices, layoutVariant, degree)),
    hubId: "",
    rackAware: true
  };
}

function orderRackClusterDevices(devices, layoutVariant, degree) {
  return [...devices].sort((first, second) => {
    const priorityDifference = rackClusterPriority(first) - rackClusterPriority(second);
    if (priorityDifference) return priorityDifference;
    if (layoutVariant === 3) {
      const degreeDifference = (degree.get(second.id) || 0) - (degree.get(first.id) || 0);
      if (degreeDifference) return degreeDifference;
    }
    const nameOrder = first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" });
    return layoutVariant === 5 ? -nameOrder : nameOrder;
  });
}

function rackClusterPriority(device) {
  return {
    "Patch Panel": 0,
    "Network Switch": 1,
    Server: 2,
    Storage: 3,
    Display: 4,
    "Media Converter": 5,
    Power: 6
  }[device.category] ?? 5;
}

function diagramRackSortKey(rackId) {
  const rack = getRack(rackId);
  return `${rack?.roomId || ""}:${rack?.name || rackId}`;
}

function orderDiagramDevices(devices, layoutVariant, degree = new Map()) {
  const ordered = [...devices];
  const variant = Math.max(0, Math.min(5, Number(layoutVariant) || 0));
  ordered.sort((first, second) => {
    if (variant === 1) {
      return `${first.category}:${first.name}`.localeCompare(`${second.category}:${second.name}`);
    }
    if (variant === 2) {
      return `${first.roomId}:${first.rackId}:${String(999 - (Number(first.rackU) || 0)).padStart(3, "0")}:${first.name}`
        .localeCompare(`${second.roomId}:${second.rackId}:${String(999 - (Number(second.rackU) || 0)).padStart(3, "0")}:${second.name}`);
    }
    if (variant === 3) {
      const difference = (degree.get(second.id) || 0) - (degree.get(first.id) || 0);
      return difference || diagramDeviceSortKey(first).localeCompare(diagramDeviceSortKey(second));
    }
    if (variant === 4) {
      return cableFacingPriority(first) - cableFacingPriority(second) || diagramDeviceSortKey(first).localeCompare(diagramDeviceSortKey(second));
    }
    return diagramDeviceSortKey(first).localeCompare(diagramDeviceSortKey(second));
  });
  if (variant === 5) ordered.reverse();
  return ordered;
}

function diagramDeviceSortKey(device) {
  return `${device.roomId || ""}:${device.rackId || ""}:${device.category || ""}:${device.name || ""}:${device.id || ""}`;
}

function diagramConnectionSortKey(connection) {
  const endpoints = [
    `${deviceLabel(connection.fromDevice)}:${connection.fromPort || ""}`,
    `${deviceLabel(connection.toDevice)}:${connection.toPort || ""}`
  ].sort();
  return `${endpoints.join("::")}:${connection.label || ""}:${connection.id || ""}`;
}

function portCompare(first, second) {
  return NATURAL_SORT.compare(String(first || ""), String(second || ""));
}

function cableFacingPriority(device) {
  return {
    "Network Switch": 0,
    "Patch Panel": 1,
    Server: 2,
    Storage: 3,
    "Media Converter": 4,
    Display: 5,
    Power: 6
  }[device.category] ?? 7;
}

function diagramColumnXs(columnCount, width, nodeW) {
  if (columnCount <= 1) return [(width - nodeW) / 2];
  if (columnCount === 2) {
    const sideGutter = 80 + Math.min(360, Math.max(0, width - 1240) / 2);
    return [sideGutter, width - nodeW - sideGutter];
  }
  const left = 70 + Math.min(360, Math.max(0, width - 1540) / 2);
  const adjustedRight = width - nodeW - left;
  const middleStep = (adjustedRight - left) / (columnCount - 1);
  return Array.from({ length: columnCount }, (_, index) => left + middleStep * index);
}

function layoutDiagramColumn(devices, x, top, rowGap, nodeW, nodeHeights, columnIndex = 0) {
  let y = top;
  const positions = devices.map((device) => {
    const h = nodeHeights.get(device.id) || 104;
    const position = {
      id: device.id,
      columnIndex,
      x,
      y,
      w: nodeW,
      h,
      ports: []
    };
    y += h + rowGap;
    return position;
  });
  return { positions, bottom: y - rowGap };
}

function relaxDiagramPositions(positions, connections, hubId, top) {
  if (positions.length < 3 || !connections.length) return;
  const fixedIds = new Set(hubId ? [hubId] : []);
  const minGap = 44;

  for (let pass = 0; pass < 7; pass += 1) {
    alignBundledDiagramPairs(positions, connections, fixedIds, top, minGap);
    const positionMap = new Map(positions.map((position) => [position.id, position]));
    const endpoints = buildDiagramEndpoints(connections, positionMap);
    const shifts = new Map();

    connections.forEach((connection) => {
      const from = positionMap.get(connection.fromDevice);
      const to = positionMap.get(connection.toDevice);
      const fromPoint = endpoints.endpointPoints.get(`${connection.id}:from`);
      const toPoint = endpoints.endpointPoints.get(`${connection.id}:to`);
      if (!from || !to || !fromPoint || !toPoint) return;

      const verticalDelta = toPoint.y - fromPoint.y;
      if (Math.abs(verticalDelta) < 12) return;

      const sameColumn = from.columnIndex === to.columnIndex;
      const sourceWeight = sameColumn ? 0.28 : 0.18;
      const targetWeight = sameColumn ? 0.38 : 0.32;
      addDiagramShift(shifts, connection.fromDevice, fixedIds.has(connection.fromDevice) ? 0 : verticalDelta * sourceWeight);
      addDiagramShift(shifts, connection.toDevice, fixedIds.has(connection.toDevice) ? 0 : -verticalDelta * targetWeight);
    });

    if (!shifts.size) break;
    positions.forEach((position) => {
      if (fixedIds.has(position.id)) return;
      const shift = shifts.get(position.id);
      if (!shift) return;
      position.y += clamp(shift.total / shift.count, -78, 78);
    });
    packDiagramColumns(positions, top, minGap);
  }
  alignBundledDiagramPairs(positions, connections, fixedIds, top, minGap);
}

function alignBundledDiagramPairs(positions, connections, fixedIds, top, minGap) {
  const positionMap = new Map(positions.map((position) => [position.id, position]));
  const endpoints = buildDiagramEndpoints(connections, positionMap);
  const pairs = new Map();
  const degree = new Map();
  connections.forEach((connection) => {
    degree.set(connection.fromDevice, (degree.get(connection.fromDevice) || 0) + 1);
    degree.set(connection.toDevice, (degree.get(connection.toDevice) || 0) + 1);
  });

  connections.forEach((connection) => {
    const from = positionMap.get(connection.fromDevice);
    const to = positionMap.get(connection.toDevice);
    const fromPoint = endpoints.endpointPoints.get(`${connection.id}:from`);
    const toPoint = endpoints.endpointPoints.get(`${connection.id}:to`);
    if (!from || !to || !fromPoint || !toPoint || from.columnIndex === to.columnIndex) return;
    const key = [connection.fromDevice, connection.toDevice].sort().join("::");
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push({
      from,
      to,
      delta: toPoint.y - fromPoint.y
    });
  });

  pairs.forEach((entries) => {
    if (entries.length < 2 && Math.min(degree.get(entries[0].from.id) || 0, degree.get(entries[0].to.id) || 0) > 1) return;
    const averageDelta = entries.reduce((total, entry) => total + entry.delta, 0) / entries.length;
    if (Math.abs(averageDelta) < 8) return;
    const { from, to } = entries[0];
    const fromFixed = fixedIds.has(from.id);
    const toFixed = fixedIds.has(to.id);

    if (fromFixed && !toFixed) {
      to.y -= clamp(averageDelta, -120, 120);
    } else if (!fromFixed && toFixed) {
      from.y += clamp(averageDelta, -120, 120);
    } else if (!fromFixed && !toFixed) {
      const adjustment = clamp(averageDelta / 2, -72, 72);
      from.y += adjustment;
      to.y -= adjustment;
    }
  });

  packDiagramColumns(positions, top, minGap);
}

function addDiagramShift(shifts, deviceId, amount) {
  if (!amount) return;
  if (!shifts.has(deviceId)) shifts.set(deviceId, { total: 0, count: 0 });
  const shift = shifts.get(deviceId);
  shift.total += amount;
  shift.count += 1;
}

function packDiagramColumns(positions, top, minGap) {
  const columns = new Map();
  positions.forEach((position) => {
    if (!columns.has(position.columnIndex)) columns.set(position.columnIndex, []);
    columns.get(position.columnIndex).push(position);
  });

  columns.forEach((column) => {
    column.sort((first, second) => first.y - second.y);
    let cursor = top;
    column.forEach((position) => {
      position.y = Math.max(position.y, cursor);
      cursor = position.y + position.h + minGap;
    });

    for (let index = column.length - 2; index >= 0; index -= 1) {
      const current = column[index];
      const next = column[index + 1];
      const allowedY = next.y - current.h - minGap;
      if (current.y > allowedY) current.y = Math.max(top, allowedY);
    }
  });
}

function buildDiagramRouteSegments({ start, end, startLead, endLead, midX, laneIndex, sameColumn, facingDevices, previousSegments, obstacles = [], fastMode = false }) {
  const verticalDelta = end.y - start.y;
  if (facingDevices) {
    return chooseBestFacingRoute(start, end, previousSegments, obstacles);
  }

  if (sameColumn) {
    const outward = sideDirection(start.side);
    const xOffsets = fastMode
      ? [0, outward * 116, outward * 232]
      : [0, outward * 58, outward * 116, outward * 174, outward * 232];
    const candidates = xOffsets.map((offset) => buildRouteSegments(start, { x: midX + offset, y: start.y }, { x: midX + offset, y: end.y }, end));
    return chooseLowestScoreRoute(candidates, previousSegments, obstacles);
  }

  if (Math.abs(verticalDelta) < 26) {
    const xOffsets = fastMode ? [0, 92, -92] : [0, 46, -46, 92, -92];
    const candidates = xOffsets.map((offset) => buildRouteSegments(start, startLead, { x: midX + offset, y: start.y }, { x: midX + offset, y: end.y }, endLead, end));
    candidates.push(buildRouteSegments(start, startLead, endLead, end));
    return chooseLowestScoreRoute(candidates, previousSegments, obstacles);
  }

  const directionY = verticalDelta > 0 ? 1 : -1;
  const departureOffset = directionY * (30 + laneIndex * 16);
  const arrivalOffset = -directionY * (24 + laneIndex * 12);
  const departureY = start.y + departureOffset;
  const arrivalY = end.y + arrivalOffset;
  const xOffsets = fastMode ? [0, 108, -108] : [0, 54, -54, 108, -108];
  const spineYs = fastMode
    ? [departureY, arrivalY, (departureY + arrivalY) / 2]
    : [departureY, arrivalY, (departureY + arrivalY) / 2, start.y + directionY * 54, end.y - directionY * 54];
  const candidates = [];
  xOffsets.forEach((xOffset) => {
    spineYs.forEach((spineY) => {
      const x = midX + xOffset;
      candidates.push(buildRouteSegments(
        start,
        startLead,
        { x: startLead.x, y: departureY },
        { x, y: spineY },
        { x, y: arrivalY },
        { x: endLead.x, y: arrivalY },
        endLead,
        end
      ));
    });
  });
  return chooseLowestScoreRoute(candidates, previousSegments, obstacles);
}

function chooseBestFacingRoute(start, end, previousSegments = [], obstacles = []) {
  const gap = Math.abs(end.x - start.x);
  if (gap < 80) return buildRouteSegments(start, end);
  const direction = end.x >= start.x ? 1 : -1;
  const verticalDelta = Math.abs(end.y - start.y);
  const candidates = [];

  if (verticalDelta < 10) {
    candidates.push(buildRouteSegments(start, end));
  }

  const fractions = verticalDelta < 70 ? [0.82, 0.7, 0.9, 0.55, 0.35] : [0.55, 0.7, 0.4, 0.82, 0.25];
  fractions.forEach((fraction) => {
    const doglegX = start.x + direction * clamp(gap * fraction, 44, gap - 44);
    candidates.push(buildRouteSegments(start, { x: doglegX, y: start.y }, { x: doglegX, y: end.y }, end));
  });

  return candidates
    .filter((segments) => segments.length)
    .sort((first, second) => routeScore(first, previousSegments, obstacles) - routeScore(second, previousSegments, obstacles))[0];
}

function chooseLowestScoreRoute(candidates, previousSegments = [], obstacles = []) {
  return candidates
    .filter((segments) => segments.length)
    .sort((first, second) => routeScore(first, previousSegments, obstacles) - routeScore(second, previousSegments, obstacles))[0] || [];
}

function routeScore(segments, previousSegments = [], obstacles = []) {
  const length = segments.reduce((total, segment) => total + segmentLength(segment), 0);
  const bends = Math.max(0, segments.length - 1);
  const crossings = segments.reduce((total, segment) => total + segmentCrossings(segment, previousSegments).length, 0);
  const overlaps = segments.reduce((total, segment) => total + parallelOverlapPenalty(segment, previousSegments), 0);
  const intrusions = segments.reduce((total, segment) => {
    return total + obstacles.filter((obstacle) => segmentIntersectsBox(segment, obstacle, 10)).length;
  }, 0);
  const closePasses = segments.reduce((total, segment) => {
    return total + obstacles.filter((obstacle) => !segmentIntersectsBox(segment, obstacle, 10) && segmentIntersectsBox(segment, obstacle, 32)).length;
  }, 0);
  return length + bends * 28 + crossings * 180 + overlaps * 760 + closePasses * 650 + intrusions * 3600;
}

function parallelOverlapPenalty(segment, previousSegments = []) {
  return previousSegments.reduce((total, previous) => {
    if (segment.orientation !== previous.orientation) return total;
    if (segment.orientation === "horizontal") {
      if (Math.abs(segment.y1 - previous.y1) > 10) return total;
      return total + overlapLength(segment.x1, segment.x2, previous.x1, previous.x2) / 80;
    }
    if (Math.abs(segment.x1 - previous.x1) > 10) return total;
    return total + overlapLength(segment.y1, segment.y2, previous.y1, previous.y2) / 80;
  }, 0);
}

function overlapLength(firstStart, firstEnd, secondStart, secondEnd) {
  const start = Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd));
  const end = Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd));
  return Math.max(0, end - start);
}

function buildRouteSegments(...points) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (Math.abs(start.x - end.x) < 0.1 && Math.abs(start.y - end.y) < 0.1) continue;
    if (Math.abs(start.x - end.x) < 0.1 || Math.abs(start.y - end.y) < 0.1) {
      segments.push({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        orientation: Math.abs(start.y - end.y) < 0.1 ? "horizontal" : "vertical"
      });
      continue;
    }
    const elbow = { x: end.x, y: start.y };
    segments.push({
      x1: start.x,
      y1: start.y,
      x2: elbow.x,
      y2: elbow.y,
      orientation: "horizontal"
    });
    segments.push({
      x1: elbow.x,
      y1: elbow.y,
      x2: end.x,
      y2: end.y,
      orientation: "vertical"
    });
  }
  return segments;
}

function buildJumpPath(segments, previousSegments) {
  if (!segments.length) return "";
  let path = `M ${segments[0].x1} ${segments[0].y1}`;
  segments.forEach((segment) => {
    const jumps = segmentCrossings(segment, previousSegments);
    if (segment.orientation === "horizontal") {
      path += horizontalSegmentPath(segment, jumps);
    } else {
      path += verticalSegmentPath(segment, jumps);
    }
  });
  return path;
}

function horizontalSegmentPath(segment, jumps) {
  const direction = segment.x2 >= segment.x1 ? 1 : -1;
  const radius = 7;
  const height = 9;
  const ordered = jumps
    .map((jump) => jump.x)
    .filter((x) => Math.abs(x - segment.x1) > radius * 2 && Math.abs(x - segment.x2) > radius * 2)
    .sort((a, b) => (a - b) * direction);
  let path = "";
  ordered.forEach((x) => {
    path += ` L ${x - direction * radius} ${segment.y1}`;
    path += ` Q ${x} ${segment.y1 - height} ${x + direction * radius} ${segment.y1}`;
  });
  path += ` L ${segment.x2} ${segment.y2}`;
  return path;
}

function verticalSegmentPath(segment, jumps) {
  const direction = segment.y2 >= segment.y1 ? 1 : -1;
  const radius = 7;
  const width = 9;
  const ordered = jumps
    .map((jump) => jump.y)
    .filter((y) => Math.abs(y - segment.y1) > radius * 2 && Math.abs(y - segment.y2) > radius * 2)
    .sort((a, b) => (a - b) * direction);
  let path = "";
  ordered.forEach((y) => {
    path += ` L ${segment.x1} ${y - direction * radius}`;
    path += ` Q ${segment.x1 + width} ${y} ${segment.x1} ${y + direction * radius}`;
  });
  path += ` L ${segment.x2} ${segment.y2}`;
  return path;
}

function segmentCrossings(segment, previousSegments) {
  const seen = new Set();
  return previousSegments
    .map((previous) => segmentCrossing(segment, previous))
    .filter((crossing) => {
      if (!crossing) return false;
      const key = `${Math.round(crossing.x)}:${Math.round(crossing.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function segmentCrossing(segment, previous) {
  if (segment.orientation === previous.orientation) return null;
  const horizontal = segment.orientation === "horizontal" ? segment : previous;
  const vertical = segment.orientation === "vertical" ? segment : previous;
  const x = vertical.x1;
  const y = horizontal.y1;
  if (!isBetween(x, horizontal.x1, horizontal.x2, 10) || !isBetween(y, vertical.y1, vertical.y2, 10)) return null;
  return segment.orientation === "horizontal" ? { x, y } : { x, y };
}

function isBetween(value, first, second, margin = 0) {
  return value > Math.min(first, second) + margin && value < Math.max(first, second) - margin;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function placeRouteLabel(segments, labelWidth, labelBoxes, cableSegments = [], preferredSide = 1, bounds = null, nodeBoxes = [], fastMode = false) {
  const viableSegments = segments.filter((segment) => segmentLength(segment) >= 22);
  const orderedSegments = viableSegments.length ? viableSegments : segments;
  const fractions = fastMode ? [0.5, 0.32, 0.68] : [0.5, 0.42, 0.58, 0.32, 0.68, 0.22, 0.78, 0.12, 0.88];
  const offsets = fastMode ? [0, -32, 32] : [0, -20, 20, -40, 40, -64, 64, -88, 88];
  let best = null;

  orderedSegments.forEach((segment) => {
    const length = segmentLength(segment);
    fractions.forEach((fraction) => {
      offsets.forEach((offset) => {
        const label = labelForSegment(segment, labelWidth, offset, preferredSide, fraction);
        const insideBounds = !bounds || (
          label.box.x >= 8 &&
          label.box.y >= 48 &&
          label.box.x + label.box.w <= bounds.width - 8 &&
          label.box.y + label.box.h <= bounds.height - 8
        );
        const labelOverlaps = labelBoxes.filter((box) => boxesOverlapWithMargin(box, label.box, 2)).length;
        const nodeOverlaps = nodeBoxes.filter((box) => boxesOverlapWithMargin(box, label.box, 10)).length;
        const cableHits = cableSegments.filter((cableSegment) => segmentIntersectsBox(cableSegment, label.box, 1)).length;
        const isOnCable = segment.orientation === "horizontal" && offset === 0;
        const score =
          (insideBounds ? 0 : 1000000) +
          labelOverlaps * 100000 +
          nodeOverlaps * 85000 +
          cableHits * (isOnCable ? 45 : 450) +
          Math.abs(offset) * 18 +
          (segment.orientation === "vertical" ? 260 : 0) +
          Math.abs(fraction - 0.5) * 90 -
          Math.min(length, 420) * (segment.orientation === "horizontal" ? 1.6 : 0.55) -
          (isOnCable ? 420 : 0);
        if (!best || score < best.score) best = { label, score, labelOverlaps };
      });
    });
  });

  if (best) {
    labelBoxes.push(best.label.box);
    return best.label;
  }

  const fallback = labelForSegment(segments[Math.max(0, Math.floor(segments.length / 2))], labelWidth, 0, preferredSide);
  labelBoxes.push(fallback.box);
  return fallback;
}

function labelForSegment(segment, labelWidth, offset, preferredSide, fraction = 0.5) {
  const midpoint = {
    x: segment.x1 + (segment.x2 - segment.x1) * fraction,
    y: segment.y1 + (segment.y2 - segment.y1) * fraction
  };
  const label =
    segment.orientation === "horizontal"
      ? { x: midpoint.x, y: midpoint.y + 4 + offset }
      : { x: midpoint.x + preferredSide * (labelWidth / 2 + 14 + Math.abs(offset) / 4), y: midpoint.y + offset };
  return {
    ...label,
    anchorX: midpoint.x,
    anchorY: midpoint.y,
    leader: Math.abs(label.x - midpoint.x) > labelWidth / 2 + 8 || Math.abs(label.y - midpoint.y) > 18,
    box: {
      x: label.x - labelWidth / 2,
      y: label.y - 14,
      w: labelWidth,
      h: 18
    }
  };
}

function segmentLength(segment) {
  return Math.abs(segment.x2 - segment.x1) + Math.abs(segment.y2 - segment.y1);
}

function boxesOverlap(first, second) {
  return boxesOverlapWithMargin(first, second, 6);
}

function boxesOverlapWithMargin(first, second, margin = 0) {
  return !(
    first.x + first.w + margin < second.x ||
    second.x + second.w + margin < first.x ||
    first.y + first.h + margin < second.y ||
    second.y + second.h + margin < first.y
  );
}

function buildDiagramPortUsage(connections = project.connections) {
  const usage = new Map();
  connections.forEach((connection) => {
    addPortUsage(usage, connection.fromDevice, connection.fromPort, connection.fromFace);
    addPortUsage(usage, connection.toDevice, connection.toPort, connection.toFace);
  });
  return usage;
}

function addPortUsage(usage, deviceId, port, face = "Unspecified") {
  if (!usage.has(deviceId)) usage.set(deviceId, []);
  const key = getDevice(deviceId)?.category === "Patch Panel" ? `${port}::${normalizeFace(face)}` : port;
  if (!usage.get(deviceId).includes(key)) usage.get(deviceId).push(key);
}

function buildDiagramEndpoints(connections, positionMap) {
  const groups = new Map();
  const portEntries = new Map();
  const panelOrientations = buildPatchPanelOrientations(connections, positionMap);
  connections.forEach((connection) => {
    const from = positionMap.get(connection.fromDevice);
    const to = positionMap.get(connection.toDevice);
    const sides = connectionSides(from, to, connection, panelOrientations);
    addEndpointGroup(groups, portEntries, connection.fromDevice, connection.fromPort, connection.fromFace, sides.fromSide, `${connection.id}:from`);
    addEndpointGroup(groups, portEntries, connection.toDevice, connection.toPort, connection.toFace, sides.toSide, `${connection.id}:to`);
  });

  const endpointPoints = new Map();
  const portsByDevice = new Map();
  groups.forEach((entries, groupKey) => {
    const [deviceId, side] = groupKey.split(":");
    const position = positionMap.get(deviceId);
    entries.sort((first, second) => portCompare(first.port, second.port) || first.face.localeCompare(second.face));
    entries.forEach((entry, index) => {
      const point = anchorPoint(position, side, index, entries.length);
      const device = getDevice(deviceId);
      const displayPort = device?.category === "Patch Panel"
        ? `${entry.port} ${entry.face === "Rear" ? "back" : "front"}`
        : entry.port;
      const labelWidth = Math.max(44, displayPort.length * 6.4 + 14);
      const labelHeight = 18;
      const isRightSide = side === "right";
      const portMarker = {
        ...point,
        port: displayPort,
        rawPort: entry.port,
        face: entry.face,
        side,
        labelWidth,
        labelHeight,
        labelRectX: isRightSide ? point.x - labelWidth - 10 : point.x + 10,
        labelRectY: point.y - labelHeight / 2,
        labelX: isRightSide ? point.x - 16 : point.x + 16,
        labelY: point.y + 4,
        textAnchor: isRightSide ? "end" : "start"
      };
      if (!portsByDevice.has(deviceId)) portsByDevice.set(deviceId, []);
      portsByDevice.get(deviceId).push(portMarker);
      entry.endpointIds.forEach((endpointId) => endpointPoints.set(endpointId, { ...point, side, port: entry.port, face: entry.face }));
    });
  });
  return { endpointPoints, portsByDevice };
}

function addEndpointGroup(groups, portEntries, deviceId, port, face, side, endpointId) {
  const key = `${deviceId}:${side}`;
  if (!groups.has(key)) groups.set(key, []);
  const normalizedFace = normalizeFace(face);
  const faceKey = getDevice(deviceId)?.category === "Patch Panel" ? normalizedFace : "";
  const portKey = `${key}:${port}:${faceKey}`;
  if (!portEntries.has(portKey)) {
    const entry = { port, face: normalizedFace, endpointIds: [] };
    portEntries.set(portKey, entry);
    groups.get(key).push(entry);
  }
  portEntries.get(portKey).endpointIds.push(endpointId);
}

function connectionSides(from, to, connection = null, panelOrientations = new Map()) {
  const geometric = geometricConnectionSides(from, to, connection);
  let fromSide = preferredEndpointSide(connection?.fromDevice, connection?.fromFace, geometric.fromSide, panelOrientations);
  let toSide = preferredEndpointSide(connection?.toDevice, connection?.toFace, geometric.toSide, panelOrientations);
  if (Math.abs(from.x - to.x) < 10) {
    const fromPanelOriented = getDevice(connection?.fromDevice)?.category === "Patch Panel" && panelOrientations.has(connection?.fromDevice);
    const toPanelOriented = getDevice(connection?.toDevice)?.category === "Patch Panel" && panelOrientations.has(connection?.toDevice);
    if (fromPanelOriented && !toPanelOriented) toSide = fromSide;
    if (toPanelOriented && !fromPanelOriented) fromSide = toSide;
  }
  return { fromSide, toSide };
}

function geometricConnectionSides(from, to, connection = null) {
  if (Math.abs(from.x - to.x) < 10) {
    const powerRoute = cableTypeFamily(connection?.cableType) === "power" || [connection?.fromDevice, connection?.toDevice].some((deviceId) => getDevice(deviceId)?.category === "Power");
    const side = powerRoute
      ? from.columnIndex === 0 ? "left" : "right"
      : from.columnIndex === 0 ? "right" : "left";
    return { fromSide: side, toSide: side };
  }
  return {
    fromSide: to.x > from.x ? "right" : "left",
    toSide: from.x > to.x ? "right" : "left"
  };
}

function preferredEndpointSide(deviceId, face, fallbackSide, panelOrientations = new Map()) {
  const device = getDevice(deviceId);
  if (device?.category !== "Patch Panel") return fallbackSide;
  const normalizedFace = normalizeFace(face);
  const orientation = panelOrientations.get(deviceId);
  if (!orientation) return fallbackSide;
  if (normalizedFace === "Rear") return orientation.rearSide;
  if (normalizedFace === "Front") return orientation.frontSide;
  return fallbackSide;
}

function buildPatchPanelOrientations(connections, positionMap) {
  const orientationScores = new Map();
  connections.forEach((connection) => {
    [
      { deviceId: connection.fromDevice, face: connection.fromFace, otherId: connection.toDevice },
      { deviceId: connection.toDevice, face: connection.toFace, otherId: connection.fromDevice }
    ].forEach((endpoint) => {
      if (getDevice(endpoint.deviceId)?.category !== "Patch Panel") return;
      const position = positionMap.get(endpoint.deviceId);
      const other = positionMap.get(endpoint.otherId);
      if (!position || !other) return;
      const face = normalizeFace(endpoint.face);
      if (!orientationScores.has(endpoint.deviceId)) orientationScores.set(endpoint.deviceId, { Front: 0, Rear: 0, frontCount: 0, rearCount: 0 });
      const scores = orientationScores.get(endpoint.deviceId);
      const horizontalDirection = Math.abs(other.x - position.x) < 10 ? 0 : other.x > position.x ? 1 : -1;
      if (face === "Rear") {
        scores.Rear += horizontalDirection;
        scores.rearCount += 1;
      } else if (face === "Front") {
        scores.Front += horizontalDirection;
        scores.frontCount += 1;
      }
    });
  });

  const orientations = new Map();
  orientationScores.forEach((scores, deviceId) => {
    if (!scores.rearCount) return;
    let rearSide;
    if (scores.Rear) rearSide = scores.Rear > 0 ? "right" : "left";
    else if (scores.Front) rearSide = scores.Front > 0 ? "left" : "right";
    else rearSide = (positionMap.get(deviceId)?.columnIndex || 0) === 0 ? "right" : "left";
    orientations.set(deviceId, {
      rearSide,
      frontSide: rearSide === "right" ? "left" : "right"
    });
  });
  return orientations;
}

function sideDirection(side) {
  return side === "right" ? 1 : -1;
}

function anchorPoint(position, side, index, total) {
  const usableHeight = Math.max(24, position.h - 28);
  const step = usableHeight / (total + 1);
  return {
    x: side === "right" ? position.x + position.w : position.x,
    y: position.y + 14 + step * (index + 1)
  };
}

function buildRackLayout() {
  if (!project.rooms.length) {
    return `<article class="revision-card"><h4>No rooms yet</h4><p>Create rooms and racks in the Structure tab to generate rack layouts.</p></article>`;
  }
  const rack = selectedRack();
  if (!rack) return `<article class="revision-card"><h4>No racks yet</h4><p>Create a rack in the Structure tab to generate rack layouts.</p></article>`;
  const room = getRoom(rack.roomId);
  return `
    <section class="rack-room">
      <h4>${escapeHtml(room ? roomLabel(room.id) : "Unknown room")}</h4>
      <div class="rack-layout">${buildSingleRack(room, rack)}</div>
    </section>
  `;
}

function selectedRack() {
  if (!project.racks.length) return null;
  if (!project.racks.some((rack) => rack.id === selectedRackId)) {
    selectedRackId = project.racks[0].id;
  }
  return getRack(selectedRackId) || project.racks[0];
}

function buildSingleRack(room, rack) {
  const devices = project.devices.filter((device) => device.roomId === room.id && device.rackId === rack.id);
  const ruDevices = devices.filter(isRackMounted).slice().sort((a, b) => rackTop(b) - rackTop(a));
  const leftRails = devices.filter((device) => normalizeMount(device.mount, device.category) === "rail-left");
  const rightRails = devices.filter((device) => normalizeMount(device.mount, device.category) === "rail-right");
  const rackContents = buildRackRows(ruDevices, rack.sizeU);
  const rackView =
    rackViewMode === "rear"
      ? `
      <div class="rack-body">
        ${buildRackRail(leftRails, "Left rail")}
        <div class="rack-stack">${rackContents}</div>
        ${buildRackRail(rightRails, "Right rail")}
      </div>
    `
      : `<div class="rack-stack">${rackContents}</div>`;
  return `
    <article class="rack">
      <h4>${escapeHtml(rack.name)} <span class="muted">${rack.sizeU}U / ${rackViewMode === "rear" ? "rear view" : "front view"}</span></h4>
      ${rackView}
    </article>
  `;
}

function buildRackRail(devices, label) {
  return `
    <div class="rack-rail">
      <span>${escapeHtml(label)}</span>
      ${
        devices
          .map(
            (device) => `
          <strong>
            ${escapeHtml(device.name)}
            <small>${escapeHtml(device.model || device.category)}</small>
          </strong>
        `
          )
          .join("") || `<em>Available</em>`
      }
    </div>
  `;
}

function buildRackRows(devices, maxU) {
  const byTop = new Map(devices.map((device) => [rackTop(device), device]));
  const rows = [];
  let skipUntil = 0;
  for (let u = maxU; u >= 1; u -= 1) {
    if (skipUntil && u >= skipUntil) continue;
    const device = byTop.get(u);
    if (device) {
      const span = rackSpan(device);
      const bottom = Math.max(1, u - span + 1);
      skipUntil = bottom;
      rows.push(`
        <div class="rack-row rack-row-device" style="min-height: ${span * 30}px">
          <span>${escapeHtml(formatRackRange(device))}</span>
          <strong>
            ${escapeHtml(device.name)}
            <small>${escapeHtml(device.category)} / ${escapeHtml(device.model || "Model TBC")}</small>
          </strong>
        </div>
      `);
    } else {
      rows.push(`
        <div class="rack-row rack-row-empty">
          <span>U${u}</span>
          <strong></strong>
        </div>
      `);
    }
  }
  return rows.join("");
}

function buildRackSvg(room, rack) {
  const devices = project.devices.filter((device) => device.roomId === rack.roomId && device.rackId === rack.id);
  const ruDevices = devices.filter(isRackMounted).slice().sort((a, b) => rackTop(b) - rackTop(a));
  const leftRails = devices.filter((device) => normalizeMount(device.mount, device.category) === "rail-left");
  const rightRails = devices.filter((device) => normalizeMount(device.mount, device.category) === "rail-right");
  const width = rackViewMode === "rear" ? 980 : 760;
  const rackX = rackViewMode === "rear" ? 334 : 216;
  const rackY = 104;
  const rackW = 390;
  const rackH = Math.max(640, rack.sizeU * 18);
  const stackInsetX = 18;
  const stackInsetY = 16;
  const stackX = rackX + stackInsetX;
  const stackY = rackY + stackInsetY;
  const stackW = rackW - stackInsetX * 2;
  const stackH = rackH - stackInsetY * 2;
  const height = rackY + rackH + 80;
  const ruH = stackH / rack.sizeU;
  const roomName = room ? roomLabel(room.id) : "Unknown room";
  const conflicts = rackPlacementConflicts(ruDevices, rack);
  const conflictIds = new Set(conflicts.flatMap((conflict) => [conflict.first.id, conflict.second.id]));
  const deviceBlocks = ruDevices.map((device) => rackDeviceSvg(device, rack, stackX, stackY, stackW, ruH, conflictIds.has(device.id))).join("");
  const conflictWarning = conflicts.length
    ? `
      <g>
        <rect x="${rackX}" y="${rackY + rackH + 16}" width="${rackW}" height="34" rx="5" fill="#fff8f5" stroke="#9b4e45" stroke-width="1" />
        <text x="${rackX + 12}" y="${rackY + rackH + 38}" font-size="10" font-weight="800" fill="#9b4e45">${escapeHtml(`${conflicts.length} rack placement conflict${conflicts.length === 1 ? "" : "s"} detected`)}</text>
      </g>
    `
    : "";
  const ruLines = Array.from({ length: rack.sizeU + 1 }, (_, index) => {
    const y = stackY + index * ruH;
    const u = rack.sizeU - index;
    return `
      <line x1="${stackX}" y1="${y}" x2="${stackX + stackW}" y2="${y}" stroke="#e1e7e2" stroke-width="0.6" />
      ${index < rack.sizeU ? `<text x="${rackX - 18}" y="${y + ruH * 0.68}" font-size="8" fill="#65726c" text-anchor="end">U${u}</text>` : ""}
    `;
  }).join("");
  const rearRails =
    rackViewMode === "rear"
      ? `
        ${rackRailSvg(leftRails, rackX - 106, rackY, 58, rackH, "Left power rail")}
        ${rackRailSvg(rightRails, rackX + rackW + 48, rackY, 58, rackH, "Right power rail")}
      `
      : "";
  return `
    <svg class="rack-output-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(rack.name)} rack layout">
      <rect width="${width}" height="${height}" fill="#fbfcfa" />
      <text x="42" y="42" font-size="22" font-weight="800" fill="#17211d">${escapeHtml(rack.name)}</text>
      <text x="42" y="68" font-size="13" fill="#65726c">${escapeHtml(roomName)} / ${rack.sizeU}U / ${rackViewMode === "rear" ? "rear view" : "front view"}</text>
      <rect x="${rackX}" y="${rackY}" width="${rackW}" height="${rackH}" rx="8" fill="#ffffff" stroke="#44514a" stroke-width="2" />
      <rect x="${stackX}" y="${stackY}" width="${stackW}" height="${stackH}" fill="#f8faf7" stroke="#cbd5cf" stroke-width="0.8" />
      ${ruLines}
      ${deviceBlocks}
      ${rearRails}
      ${conflictWarning}
    </svg>
  `;
}

function rackDeviceSvg(device, rack, rackX, rackY, rackW, ruH, hasConflict = false) {
  const top = rackTop(device);
  const span = Math.min(rack.sizeU, rackSpan(device));
  if (!Number.isFinite(top)) return "";
  const y = rackY + (rack.sizeU - top) * ruH;
  const h = ruH * span;
  const rectY = y + 1;
  const rectH = Math.max(8, h - 2);
  const color = deviceAccentColor(device);
  const labelLimit = Math.max(14, Math.floor((rackW - 60) / 7));
  const compact = rectH < 20;
  const detail = rackDeviceDetail(device);
  const secondary = rackDeviceSecondary(device);
  const nameY = rectY + (compact ? rectH / 2 + 3 : 14);
  const detailY = compact ? nameY : rectY + 27;
  const nameLines = wrapTextLines(device.name, labelLimit, compact ? 1 : 2);
  const detailLines = wrapTextLines(detail, labelLimit + 14, rectH > 48 ? 2 : 1);
  const stroke = hasConflict ? "#9b4e45" : color;
  return `
    <g>
      <title>${escapeHtml(`${device.name} / ${detail}`)}</title>
      <rect x="${rackX + 8}" y="${rectY}" width="${rackW - 16}" height="${rectH}" rx="3" fill="${hasConflict ? "#fff8f5" : "#ffffff"}" stroke="${stroke}" stroke-width="${hasConflict ? 2.6 : compact ? 1.4 : 2}" />
      <rect x="${rackX + 8}" y="${rectY}" width="8" height="${rectH}" rx="3" fill="${color}" />
      ${svgTextLines(nameLines, rackX + 24, nameY, compact ? 8 : 11, compact ? 9 : 13, { weight: 800, fill: "#17211d" })}
      ${
        compact
          ? `<text x="${rackX + rackW - 18}" y="${detailY}" font-size="7" fill="#65726c" text-anchor="end">${escapeHtml(truncateText(secondary, 24))}</text>`
          : svgTextLines(detailLines, rackX + 24, detailY + (nameLines.length - 1) * 12, 8.5, 11, { fill: "#65726c" })
      }
    </g>
  `;
}

function rackRailSvg(devices, x, y, width, height, label) {
  const items = devices
    .map((device, index) => {
      const itemY = y + 54 + index * 56;
      return `
        <rect x="${x + 8}" y="${itemY}" width="${width - 16}" height="42" rx="5" fill="#ffffff" stroke="${deviceAccentColor(device)}" stroke-width="1.2" />
        <text x="${x + width / 2}" y="${itemY + 18}" font-size="8" font-weight="800" text-anchor="middle">${escapeHtml(truncateText(device.name, 9))}</text>
        <text x="${x + width / 2}" y="${itemY + 32}" font-size="7" fill="#65726c" text-anchor="middle">${escapeHtml(truncateText(device.model || device.category, 9))}</text>
      `;
    })
    .join("");
  const labelX = x + width / 2;
  const labelY = y + height / 2;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#f8faf7" stroke="#d6ddd8" stroke-width="0.9" />
      <text x="${labelX}" y="${labelY}" font-size="9" font-weight="800" text-anchor="middle" transform="rotate(-90 ${labelX} ${labelY})">${escapeHtml(label)}</text>
      ${items}
    </g>
  `;
}

function rackDeviceDetail(device) {
  const details = [device.model || "Model TBC", device.serial && device.serial !== "TBC" ? `SN ${device.serial}` : "", device.asset ? `Asset ${device.asset}` : ""].filter(Boolean);
  return details.join(" / ");
}

function rackDeviceSecondary(device) {
  return [device.model || "Model TBC", device.serial && device.serial !== "TBC" ? device.serial : ""].filter(Boolean).join(" / ");
}

function buildCableSchedule() {
  const rows = project.connections
    .map(
      (connection) => `
      <tr>
        <td>${escapeHtml(connection.label)}</td>
        <td>${escapeHtml(deviceLabel(connection.fromDevice))}</td>
        <td>${escapeHtml(connection.fromPort)}</td>
        <td>${escapeHtml(deviceLabel(connection.toDevice))}</td>
        <td>${escapeHtml(connection.toPort)}</td>
        <td>${escapeHtml(connection.cableType)}</td>
        <td>${escapeHtml(connection.conductor)}</td>
        <td>${escapeHtml(cableStyleLabel(connection))}</td>
        <td>${escapeHtml(connection.length)}</td>
        <td>${escapeHtml(connection.fromFace || "Front")} to ${escapeHtml(connection.toFace || "Front")}</td>
        <td>${escapeHtml(connection.route)}</td>
        <td>${escapeHtml(connection.status)}</td>
      </tr>
    `
    )
    .join("");
  return `
    <table>
      <thead>
        <tr>
          <th>Label</th><th>From</th><th>Port</th><th>To</th><th>Port</th>
          <th>Type</th><th>Conductor</th><th>Colour</th><th>Length</th><th>Faces</th><th>Route</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildDeviceElevations() {
  const devices = project.devices.filter(isDrawableDiagramDevice);
  if (!devices.length) {
    return `<div class="empty-state"><h4>No device elevations yet</h4><p class="muted">Add devices and ports to generate close-up front or rear connection views.</p></div>`;
  }
  if (!devices.some((device) => device.id === selectedElevationDeviceId)) {
    selectedElevationDeviceId = devices[0].id;
  }
  const selectedDevice = getDevice(selectedElevationDeviceId) || devices[0];
  return `
    <div class="elevation-output">
      ${buildDeviceElevationDetail(selectedDevice)}
    </div>
  `;
}

function buildDeviceElevationDetail(device) {
  const ports = device.ports || [];
  const connectedCount = ports.filter((port) => connectionForDevicePort(device.id, port)).length;
  const faces = elevationViewMode === "both" ? ["front", "rear"] : [elevationViewMode];
  return `
    <article class="elevation-card elevation-detail">
      <header>
        <div>
          <h4>${escapeHtml(device.name)}</h4>
          <p>${escapeHtml(device.category)} / ${escapeHtml(deviceLocation(device))}</p>
        </div>
        <span class="pill">${connectedCount}/${ports.length} connected</span>
      </header>
      ${faces.map((face) => buildElevationFaceSvg(device, face)).join("")}
    </article>
  `;
}

function buildElevationFaceSvg(device, face) {
  const entries = elevationPortEntries(device, face);
  const shellEntries = elevationPortEntries(device, face, { includeAllFaces: true });
  if (!entries.length) {
    return `<div class="empty-state"><h4>${faceLabel(face)} elevation</h4><p class="muted">No ports captured for this device.</p></div>`;
  }
  if (isPanelElevationDevice(device, shellEntries)) {
    return buildPanelElevationFaceSvg(device, face, entries, shellEntries);
  }
  const portCount = Math.max(entries.length, shellEntries.length);
  const bankCount = portCount > 16 ? 2 : 1;
  const rowsPerBank = Math.ceil(portCount / bankCount);
  const rowH = portCount > 36 ? 34 : portCount > 16 ? 38 : 46;
  const top = 94;
  const height = Math.max(275, top + rowsPerBank * rowH + 48);
  const width = bankCount === 1 ? 980 : 1520;
  const deviceX = bankCount === 1 ? 56 : 392;
  const deviceY = 58;
  const deviceW = bankCount === 1 ? 480 : 620;
  const deviceH = Math.max(160, rowsPerBank * rowH + 30);
  const portW = bankCount === 1 ? 118 : 102;
  const calloutW = bankCount === 1 ? 340 : 280;
  const firstPortX = deviceX + deviceW - (bankCount * (portW + 50)) + 16;
  const color = deviceAccentColor(device);
  const portRows = entries
    .map((entry, index) => {
      const bankIndex = Math.floor(index / rowsPerBank);
      const rowIndex = index % rowsPerBank;
      const portX = firstPortX + bankIndex * (portW + 50);
      const exitSide = bankCount === 2 && bankIndex === 0 ? "left" : "right";
      const calloutRectX = exitSide === "left" ? 60 : deviceX + deviceW + 78;
      return buildElevationPortSvg(device, entry, {
        y: top + rowIndex * rowH,
        portX,
        portW,
        markerX: exitSide === "left" ? portX - 24 : portX + portW + 24,
        calloutX: calloutRectX + 14,
        calloutRectX,
        calloutW,
        exitSide,
        compact: bankCount > 1
      });
    })
    .join("");
  return `
    <div class="elevation-face">
      <h5>${faceLabel(face)} elevation</h5>
      <svg class="elevation-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(device.name)} ${faceLabel(face)} elevation">
        <rect width="${width}" height="${height}" fill="#fbfcfa" />
        <rect x="${deviceX}" y="${deviceY}" width="${deviceW}" height="${deviceH}" rx="10" fill="#ffffff" stroke="#cbd5cf" stroke-width="${deviceOutlineWidth(device)}" />
        <rect x="${deviceX}" y="${deviceY}" width="14" height="${deviceH}" rx="7" fill="${color}" />
        <text x="${deviceX + 34}" y="${deviceY + 34}" font-size="18" font-weight="800" fill="#17211d">${escapeHtml(device.name)}</text>
        <text x="${deviceX + 34}" y="${deviceY + 56}" font-size="12" fill="#65726c">${escapeHtml(device.category)} / ${escapeHtml(device.model || "Model TBC")}</text>
        ${portRows}
      </svg>
    </div>
  `;
}

function buildPanelElevationFaceSvg(device, face, entries, shellEntries = entries) {
  const topEntries = entries.filter((entry) => isTopPanelPort(entry.port, entry.index));
  const bottomEntries = entries.filter((entry) => !isTopPanelPort(entry.port, entry.index));
  const shellTopEntries = shellEntries.filter((entry) => isTopPanelPort(entry.port, entry.index));
  const shellBottomEntries = shellEntries.filter((entry) => !isTopPanelPort(entry.port, entry.index));
  const maxRowCount = Math.max(shellTopEntries.length, shellBottomEntries.length, topEntries.length, bottomEntries.length, 1);
  const width = Math.max(1040, Math.min(1560, 500 + maxRowCount * 190));
  const deviceW = Math.max(660, Math.min(980, width - 360));
  const deviceX = (width - deviceW) / 2;
  const deviceY = 170;
  const deviceH = 128;
  const titleReserve = 190;
  const portsStartX = deviceX + titleReserve;
  const portsEndX = deviceX + deviceW - 54;
  const portLaneW = Math.max(260, portsEndX - portsStartX);
  const portW = maxRowCount > 10 ? 62 : maxRowCount > 5 ? 76 : 92;
  const portH = 20;
  const portGap = maxRowCount <= 1 ? 0 : Math.min(170, portLaneW / Math.max(1, maxRowCount - 1));
  const firstPortCenterX = maxRowCount <= 1 ? portsStartX + portLaneW / 2 : portsStartX;
  const calloutW = maxRowCount > 10 ? 126 : maxRowCount > 5 ? 150 : 210;
  const color = deviceAccentColor(device);
  const panelHeight = Math.max(420, deviceY + deviceH + 132 + Math.max(0, Math.ceil(maxRowCount / 3) - 1) * 40);
  const renderRow = (rowEntries, row) => {
    const rowSlots = row === "top" ? shellTopEntries : shellBottomEntries;
    const calloutLanes = [];
    return rowEntries
      .map((entry, index) => {
        const slotIndex = rowSlots.findIndex((slot) => slot.port === entry.port);
        const portCenterX = firstPortCenterX + (slotIndex >= 0 ? slotIndex : index) * portGap;
        const portX = portCenterX - portW / 2;
        const portY = row === "top" ? deviceY + 34 : deviceY + 74;
        const markerY = row === "top" ? portY - 10 : portY + portH + 10;
        const calloutRectX = portCenterX - calloutW / 2;
        const lane = entry.connection && entry.visible ? panelCalloutLane(calloutLanes, calloutRectX, calloutW) : 0;
        const laneGap = 40;
        const calloutRectY = row === "top" ? 36 + lane * laneGap : deviceY + deviceH + 48 + lane * laneGap;
        return buildPanelElevationPortSvg(device, entry, {
          portX,
          portY,
          portW,
          portH,
          markerX: portCenterX,
          markerY,
          calloutRectX,
          calloutRectY,
          calloutW,
          row,
          compact: maxRowCount > 5
        });
      })
      .join("");
  };
  return `
    <div class="elevation-face">
      <h5>${faceLabel(face)} elevation</h5>
      <svg class="elevation-svg" viewBox="0 0 ${width} ${panelHeight}" role="img" aria-label="${escapeHtml(device.name)} ${faceLabel(face)} elevation">
        <rect width="${width}" height="${panelHeight}" fill="#fbfcfa" />
        <rect x="${deviceX}" y="${deviceY}" width="${deviceW}" height="${deviceH}" rx="10" fill="#ffffff" stroke="#cbd5cf" stroke-width="${deviceOutlineWidth(device)}" />
        <rect x="${deviceX}" y="${deviceY}" width="14" height="${deviceH}" rx="7" fill="${color}" />
        <text x="${deviceX + 32}" y="${deviceY + 30}" font-size="18" font-weight="800" fill="#17211d">${escapeHtml(device.name)}</text>
        <text x="${deviceX + 32}" y="${deviceY + 52}" font-size="12" fill="#65726c">${escapeHtml(device.category)} / ${escapeHtml(device.model || "Model TBC")}</text>
        ${renderRow(topEntries, "top")}
        ${renderRow(bottomEntries, "bottom")}
      </svg>
    </div>
  `;
}

function buildPanelElevationPortSvg(device, entry, geometry) {
  if (!entry.connection || !entry.visible) {
    return `
    <rect x="${geometry.portX}" y="${geometry.portY}" width="${geometry.portW}" height="${geometry.portH}" rx="4" fill="#f8faf7" stroke="#d6ddd8" />
    <text x="${geometry.portX + geometry.portW / 2}" y="${geometry.portY + 14}" font-size="${geometry.compact ? 8 : 9}" font-weight="800" fill="#26352f" text-anchor="middle">${escapeHtml(entry.port)}</text>
  `;
  }
  const connection = entry.connection;
  const style = cableStyle(connection);
  const endpoint = entry.endpoint;
  const otherId = endpoint.side === "from" ? connection.toDevice : connection.fromDevice;
  const otherPort = endpoint.side === "from" ? connection.toPort : connection.fromPort;
  const destinationLabel = truncateText(`${connection.label} to ${deviceLabel(otherId)} ${otherPort}`, geometry.compact ? 22 : 28);
  const detailLabel = truncateText(connection.cableType, geometry.compact ? 24 : 30);
  const calloutRectH = 38;
  const calloutX = geometry.calloutRectX + 12;
  const cablePath =
    geometry.row === "top"
      ? `M ${geometry.markerX} ${geometry.markerY} V ${geometry.calloutRectY + calloutRectH}`
      : `M ${geometry.markerX} ${geometry.markerY} V ${geometry.calloutRectY}`;
  return `
    <rect x="${geometry.portX}" y="${geometry.portY}" width="${geometry.portW}" height="${geometry.portH}" rx="4" fill="#ffffff" stroke="#cbd5cf" />
    <text x="${geometry.portX + geometry.portW / 2}" y="${geometry.portY + 14}" font-size="${geometry.compact ? 8 : 9}" font-weight="800" fill="#26352f" text-anchor="middle">${escapeHtml(entry.port)}</text>
    <circle cx="${geometry.markerX}" cy="${geometry.markerY}" r="5.5" fill="#ffffff" stroke="${style.color}" stroke-width="2.4" />
    <path d="${cablePath}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linecap="round" />
    <rect x="${geometry.calloutRectX}" y="${geometry.calloutRectY}" width="${geometry.calloutW}" height="${calloutRectH}" rx="7" fill="#ffffff" stroke="#d6ddd8" />
    <text x="${calloutX}" y="${geometry.calloutRectY + 15}" font-size="${geometry.compact ? 9 : 10}" font-weight="800" fill="#17211d">${escapeHtml(destinationLabel)}</text>
    <text x="${calloutX}" y="${geometry.calloutRectY + 29}" font-size="9" fill="#65726c">${escapeHtml(detailLabel)}</text>
  `;
}

function panelCalloutLane(lanes, x, width) {
  const padding = 8;
  for (let index = 0; index < lanes.length; index += 1) {
    const overlaps = lanes[index].some((box) => x < box.x + box.w + padding && x + width + padding > box.x);
    if (!overlaps) {
      lanes[index].push({ x, w: width });
      return index;
    }
  }
  lanes.push([{ x, w: width }]);
  return lanes.length - 1;
}

function buildElevationPortSvg(device, entry, geometry) {
  const connection = entry.connection;
  const port = entry.port;
  const portX = geometry.portX;
  const portY = geometry.y;
  const portW = geometry.portW;
  const portH = geometry.compact ? 24 : 28;
  const centerY = portY + portH / 2;
  const markerX = geometry.markerX;
  const calloutRectX = geometry.calloutRectX;
  const calloutRectW = geometry.calloutW;
  const calloutRectH = geometry.compact ? 32 : 38;
  const portFont = geometry.compact ? 10 : 11;
  if (!connection || !entry.visible) {
    return `
      <rect x="${portX}" y="${portY}" width="${portW}" height="${portH}" rx="5" fill="#f8faf7" stroke="#d6ddd8" />
      <circle cx="${markerX}" cy="${centerY}" r="5.5" fill="#ffffff" stroke="#cbd5cf" stroke-width="2" />
      <text x="${portX + portW / 2}" y="${centerY + 4}" font-size="${portFont}" font-weight="800" fill="#26352f" text-anchor="middle">${escapeHtml(port)}</text>
    `;
  }
  const endpoint = entry.endpoint;
  const otherId = endpoint.side === "from" ? connection.toDevice : connection.fromDevice;
  const otherPort = endpoint.side === "from" ? connection.toPort : connection.fromPort;
  const style = cableStyle(connection);
  const destinationLabel = truncateText(`${connection.label} to ${deviceLabel(otherId)} ${otherPort}`, geometry.compact ? 30 : 42);
  const detailLabel = truncateText(connection.cableType, geometry.compact ? 34 : 48);
  const cablePath =
    geometry.exitSide === "left"
      ? `M ${markerX - 6} ${centerY} H ${calloutRectX + calloutRectW}`
      : `M ${markerX + 6} ${centerY} H ${calloutRectX}`;
  return `
      <rect x="${portX}" y="${portY}" width="${portW}" height="${portH}" rx="5" fill="#ffffff" stroke="#cbd5cf" />
      <circle cx="${markerX}" cy="${centerY}" r="5.5" fill="#ffffff" stroke="${style.color}" stroke-width="2.4" />
      <text x="${portX + portW / 2}" y="${centerY + 4}" font-size="${portFont}" font-weight="800" fill="#26352f" text-anchor="middle">${escapeHtml(port)}</text>
      <path d="${cablePath}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linecap="round" />
      <rect x="${calloutRectX}" y="${centerY - calloutRectH / 2}" width="${calloutRectW}" height="${calloutRectH}" rx="7" fill="#ffffff" stroke="#d6ddd8" />
      <text x="${geometry.calloutX}" y="${centerY - 3}" font-size="${geometry.compact ? 10 : 12}" font-weight="800" fill="#17211d">${escapeHtml(destinationLabel)}</text>
      <text x="${geometry.calloutX}" y="${centerY + 11}" font-size="${geometry.compact ? 9 : 10}" fill="#65726c">${escapeHtml(detailLabel)}</text>
  `;
}

function elevationPortEntries(device, face, options = {}) {
  const includeAllFaces = Boolean(options.includeAllFaces);
  const showPortsOnBothFaces = device.category === "Patch Panel";
  const viewFace = normalizeFace(face).toLowerCase();
  return (device.ports || [])
    .map((port, index) => {
      const portFace = normalizeFace(devicePortFace(device, port)).toLowerCase();
      if (!includeAllFaces && !showPortsOnBothFaces && portFace !== "unspecified" && portFace !== viewFace) return null;
      const connection = connectionForDevicePort(device.id, port, viewFace);
      if (!connection) return { port, index, connection: null, endpoint: null, visible: false };
      const endpoint = endpointForDevice(connection, device.id);
      const endpointFace = normalizeFace(endpoint.face).toLowerCase();
      const visible = showPortsOnBothFaces
        ? endpointFace === "unspecified" || endpointFace === viewFace
        : endpointFace === "unspecified" || endpointFace === viewFace || endpointFace === portFace;
      return { port, index, connection, endpoint, visible };
    })
    .filter(Boolean);
}

function devicePortFace(device, port) {
  const faces = normalizePortFaces(device.portFaces, device.category);
  const family = portFamily(port);
  return faces[family] || "Front";
}

function isPanelElevationDevice(device, entries) {
  return ["Network Switch", "Patch Panel"].includes(device.category) || entries.length > 12;
}

function isTopPanelPort(port, fallbackIndex) {
  const ordinal = portOrdinal(port);
  return Number.isFinite(ordinal) ? ordinal % 2 === 1 : fallbackIndex % 2 === 0;
}

function portOrdinal(port) {
  const matches = String(port || "").match(/\d+/g);
  if (!matches) return Number.NaN;
  return Number(matches[matches.length - 1]);
}

function connectionForDevicePort(deviceId, port, face = "Unspecified") {
  const device = getDevice(deviceId);
  const normalizedFace = normalizeFace(face);
  return project.connections.find((connection) => {
    if (connection.fromDevice === deviceId && connection.fromPort === port) {
      return device?.category === "Patch Panel" ? portUseConflicts(deviceId, port, connection.fromFace, port, normalizedFace) : true;
    }
    if (connection.toDevice === deviceId && connection.toPort === port) {
      return device?.category === "Patch Panel" ? portUseConflicts(deviceId, port, connection.toFace, port, normalizedFace) : true;
    }
    return false;
  });
}

function endpointForDevice(connection, deviceId) {
  if (connection.fromDevice === deviceId) {
    return { side: "from", port: connection.fromPort, face: normalizeFace(connection.fromFace) };
  }
  return { side: "to", port: connection.toPort, face: normalizeFace(connection.toFace) };
}

function faceLabel(face) {
  return {
    front: "Front",
    rear: "Rear",
    unspecified: "Unspecified",
    Front: "Front",
    Rear: "Rear",
    Unspecified: "Unspecified"
  }[face] || "Front";
}

function buildBom() {
  const devices = project.devices.map((device) => ({
    item: device.category,
    qty: 1,
    unit: "ea",
    description: `${device.maker || "Unknown"} ${device.model || device.name}`,
    source: `${device.name} / ${deviceLocation(device)}`
  }));

  const cableGroups = Object.values(
    project.connections.reduce((acc, connection) => {
      const key = `${connection.cableType}|${connection.conductor}`;
      if (!acc[key]) {
        acc[key] = {
          item: connection.cableType,
          qty: 0,
          unit: "runs",
          description: `${connection.conductor} cable assemblies`,
          source: []
        };
      }
      acc[key].qty += 1;
      acc[key].source.push(connection.label);
      return acc;
    }, {})
  ).map((line) => ({ ...line, source: line.source.join(", ") }));

  return [...devices, ...cableGroups];
}

function buildBomHtml() {
  const rows = buildBom()
    .map(
      (line) => `
      <div class="bom-row">
        <strong>${escapeHtml(line.item)}</strong>
        <span>${escapeHtml(String(line.qty))} ${escapeHtml(line.unit)}</span>
        <span>${escapeHtml(line.source)}</span>
        <span>${escapeHtml(line.description)}</span>
      </div>
    `
    )
    .join("");
  return `<div class="bom-list">${rows}</div>`;
}

function buildVersionHtml() {
  const snapshot = {
    project: project.name,
    version: project.version,
    updated: new Date(project.updated).toLocaleString(),
    devices: project.devices.length,
    connections: project.connections.length,
    rooms: project.rooms.length,
    racks: project.racks.length,
    completeness: `${calculateCompleteness()}%`
  };
  return `
    <div class="revision-grid">
      <article class="revision-card">
        <h4>Revision snapshot</h4>
        <p>Project: ${escapeHtml(snapshot.project)}</p>
        <p>Version: ${escapeHtml(snapshot.version)}</p>
        <p>Updated: ${escapeHtml(snapshot.updated)}</p>
      </article>
      <article class="revision-card">
        <h4>Release checks</h4>
        <p>${snapshot.rooms} rooms and ${snapshot.racks} racks defined</p>
        <p>${snapshot.devices} devices captured</p>
        <p>${snapshot.connections} interconnects captured</p>
        <p>${snapshot.completeness} input completeness</p>
      </article>
      <article class="revision-card">
        <h4>Visio strategy</h4>
        <p>The browser app emits a native .vsdx package. Future versions can enrich the drawing with company stencils, masters, and title blocks.</p>
      </article>
      <article class="revision-card">
        <h4>Template layer</h4>
        <p>Company title blocks, copyright, sensitivity labels, logos, revision metadata, and issue status can be applied at export time.</p>
      </article>
    </div>
  `;
}

function saveProjectName() {
  const value = els.projectNameInput.value.trim();
  if (!value) return showToast("Project name is required");
  project.name = value;
  render();
  showToast("Project saved");
}

function saveTemplate(event) {
  event.preventDefault();
  project.template = normalizeTemplate({
    source: els.templateSource.value,
    customSvg: project.template.customSvg,
    customSvgName: project.template.customSvgName,
    marginTop: els.templateMarginTop.value,
    marginRight: els.templateMarginRight.value,
    marginBottom: els.templateMarginBottom.value,
    marginLeft: els.templateMarginLeft.value,
    sheetSize: els.templateSheetSize.value,
    orientation: els.templateOrientation.value,
    company: els.templateCompany.value,
    logoText: els.templateLogoText.value,
    title: els.templateTitle.value,
    subtitle: els.templateSubtitle.value,
    drawingNumber: els.templateDrawingNumber.value,
    revision: els.templateRevision.value,
    releaseStatus: els.templateReleaseStatus.value,
    sensitivity: els.templateSensitivity.value,
    drawnBy: els.templateDrawnBy.value,
    checkedBy: els.templateCheckedBy.value,
    approvedBy: els.templateApprovedBy.value,
    copyright: els.templateCopyright.value,
    notes: els.templateNotes.value
  });
  render();
  showToast("Template saved");
}

async function importCustomTemplate(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".svg")) {
    event.target.value = "";
    return showToast("Export the Visio template as SVG first");
  }
  if (file.size > 1500000) {
    event.target.value = "";
    return showToast("Template SVG must be smaller than 1.5 MB");
  }

  try {
    const customSvg = sanitizeCustomTemplateSvg(await file.text());
    project.template = normalizeTemplate({
      ...project.template,
      source: "custom",
      customSvg,
      customSvgName: file.name
    });
    render();
    showToast("Custom template imported");
  } catch {
    event.target.value = "";
    showToast("That SVG template could not be imported");
  }
}

function clearCustomTemplate() {
  project.template = normalizeTemplate({
    ...project.template,
    source: "built-in",
    customSvg: "",
    customSvgName: ""
  });
  els.customTemplateFile.value = "";
  render();
  showToast("Custom template removed");
}

function sanitizeCustomTemplateSvg(source) {
  const documentNode = new DOMParser().parseFromString(String(source || ""), "image/svg+xml");
  if (documentNode.querySelector("parsererror")) throw new Error("Invalid SVG");
  const svg = documentNode.documentElement;
  if (!svg || svg.localName.toLowerCase() !== "svg") throw new Error("Missing SVG root");

  svg.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((element) => element.remove());
  svg.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      const embeddedRaster = /^data:image\/(?:png|jpe?g|gif|webp);/i.test(value);
      if (["href", "xlink:href"].includes(name) && !value.startsWith("#") && !embeddedRaster) {
        element.removeAttribute(attribute.name);
      }
      if (name === "style" && /(?:https?:|javascript:|@import)/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  svg.querySelectorAll("style").forEach((style) => {
    style.textContent = String(style.textContent || "")
      .replace(/@import[\s\S]*?;/gi, "")
      .replace(/url\((?![\"']?#)[^)]+\)/gi, "none");
  });

  if (!svg.getAttribute("viewBox")) {
    const width = Number.parseFloat(svg.getAttribute("width")) || 1000;
    const height = Number.parseFloat(svg.getAttribute("height")) || 700;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return new XMLSerializer().serializeToString(svg);
}

function saveShapeStandards(event) {
  event.preventDefault();
  const standards = normalizeShapeStandards(project.shapeStandards);
  document.querySelectorAll("[data-device-style-colour]").forEach((select) => {
    const category = select.dataset.deviceStyleColour;
    standards.devices[category] = standards.devices[category] || {};
    standards.devices[category].colour = normalizeDeviceColour(select.value);
  });
  document.querySelectorAll("[data-device-style-weight]").forEach((select) => {
    const category = select.dataset.deviceStyleWeight;
    standards.devices[category] = standards.devices[category] || {};
    standards.devices[category].lineWeight = normalizeLineWeight(select.value);
  });
  document.querySelectorAll("[data-cable-style-colour]").forEach((select) => {
    const family = select.dataset.cableStyleColour;
    standards.cables[family] = standards.cables[family] || {};
    standards.cables[family].colour = normalizeCableColour(select.value);
  });
  document.querySelectorAll("[data-cable-style-weight]").forEach((select) => {
    const family = select.dataset.cableStyleWeight;
    standards.cables[family] = standards.cables[family] || {};
    standards.cables[family].lineWeight = normalizeLineWeight(select.value);
  });
  project.shapeStandards = normalizeShapeStandards(standards);
  render();
  showToast("Shape parameters saved");
}

function saveRoom(event) {
  event.preventDefault();
  const id = getFormValue("room-id") || uid("room");
  const room = {
    id,
    name: getFormValue("room-name"),
    code: getFormValue("room-code")
  };
  if (!room.name) return showToast("Room name is required");
  project.rooms = project.rooms.some((item) => item.id === id)
    ? project.rooms.map((item) => (item.id === id ? room : item))
    : [...project.rooms, room];
  resetDiagramOptimization();
  clearRoomForm();
  render();
  showToast("Room saved");
}

function editRoom(id) {
  const room = getRoom(id);
  if (!room) return;
  setFormValue("room-id", room.id);
  setFormValue("room-name", room.name);
  setFormValue("room-code", room.code);
}

function deleteRoom(id) {
  const used = project.racks.some((rack) => rack.roomId === id) || project.devices.some((device) => device.roomId === id);
  if (used) return showToast("Room has racks or devices");
  project.rooms = project.rooms.filter((room) => room.id !== id);
  resetDiagramOptimization();
  render();
  showToast("Room deleted");
}

function clearRoomForm() {
  els.roomForm.reset();
  setFormValue("room-id", "");
}

function saveRack(event) {
  event.preventDefault();
  const id = getFormValue("rack-id") || uid("rack");
  const rack = {
    id,
    roomId: getFormValue("rack-room"),
    name: getFormValue("rack-name"),
    sizeU: Math.max(1, Number(getFormValue("rack-size")) || 42)
  };
  if (!rack.roomId) return showToast("Rack needs a room");
  if (!rack.name) return showToast("Rack name is required");
  project.racks = project.racks.some((item) => item.id === id)
    ? project.racks.map((item) => (item.id === id ? rack : item))
    : [...project.racks, rack];
  resetDiagramOptimization();
  clearRackForm();
  render();
  showToast("Rack saved");
}

function editRack(id) {
  const rack = getRack(id);
  if (!rack) return;
  setFormValue("rack-id", rack.id);
  setFormValue("rack-room", rack.roomId);
  setFormValue("rack-name", rack.name);
  setFormValue("rack-size", rack.sizeU);
}

function deleteRack(id) {
  const used = project.devices.some((device) => device.rackId === id);
  if (used) return showToast("Rack has devices");
  project.racks = project.racks.filter((rack) => rack.id !== id);
  resetDiagramOptimization();
  render();
  showToast("Rack deleted");
}

function clearRackForm() {
  els.rackForm.reset();
  setFormValue("rack-id", "");
  renderRackSizeOptions();
  renderRoomOptions(els.rackRoom);
}

function editDevice(id) {
  const device = getDevice(id);
  if (!device) return;
  setFormValue("device-id", device.id);
  setFormValue("device-name", device.name);
  setFormValue("device-category", device.category);
  renderDevicePlacementSelectors();
  setFormValue("device-room", device.roomId);
  setFormValue("device-mount", normalizeMount(device.mount, device.category));
  setFormValue("device-rack-span", rackSpan(device));
  renderRackOptions(device.rackId);
  renderRackUOptions(device.rackU);
  renderMountingFields();
  setFormValue("device-maker", device.maker);
  setFormValue("device-model", device.model);
  setFormValue("device-serial", device.serial);
  setFormValue("device-asset", device.asset);
  writePortProfile(device.portProfile);
  writePortFaces(device.portFaces, device.category);
  setFormValue("device-notes", device.notes);
  renderPortPreview();
}

function clearDeviceForm() {
  els.deviceForm.reset();
  setFormValue("device-id", "");
  setFormValue("device-mount", "room");
  setFormValue("device-rack-span", "1");
  const category = getFormValue("device-category");
  writePortProfile(defaultPortProfile(category));
  writePortFaces(defaultPortFaces(category), category);
  renderDevicePlacementSelectors();
  renderPortPreview();
}

function saveDevice(event) {
  event.preventDefault();
  const existingId = getFormValue("device-id");
  const portProfile = readPortProfile();
  const category = getFormValue("device-category");
  const portFaces = readPortFaces();
  const mount = normalizeMount(getFormValue("device-mount"), category);
  const device = {
    id: existingId || uid("dev"),
    name: getFormValue("device-name"),
    category,
    roomId: getFormValue("device-room"),
    mount,
    rackId: mount === "room" ? "" : getFormValue("device-rack"),
    rackU: mount === "rack" ? normalizeRackU(getFormValue("device-rack-u")) : "",
    rackSpan: mount === "rack" ? Math.max(1, Number(getFormValue("device-rack-span")) || 1) : 1,
    maker: getFormValue("device-maker"),
    model: getFormValue("device-model"),
    serial: getFormValue("device-serial"),
    asset: getFormValue("device-asset"),
    portProfile,
    portFaces,
    ports: generatePorts(category, portProfile, mount),
    notes: getFormValue("device-notes")
  };

  if (!device.name) return showToast("Device name is required");
  if (!device.roomId) return showToast("Device needs a room");
  if (device.mount !== "room" && !device.rackId) return showToast("Rack placement needs a rack");
  if (device.mount === "rack" && !device.rackU) return showToast("Rack device needs a top U");
  if (device.mount === "rack") {
    const rack = getRack(device.rackId);
    const conflict = rackPlacementConflict(device, rack);
    if (conflict) return showToast(`${device.name} overlaps ${conflict.name} at ${formatRackRange(conflict)}`);
  }
  if (!device.ports.length) return showToast("Device needs at least one port");

  project.devices = project.devices.some((item) => item.id === device.id)
    ? project.devices.map((item) => (item.id === device.id ? device : item))
    : [...project.devices, device];
  resetDiagramOptimization();
  clearDeviceForm();
  render();
  showToast("Device saved");
}

function deleteDevice(id) {
  const used = project.connections.some((connection) => connection.fromDevice === id || connection.toDevice === id);
  if (used) return showToast("Remove related connections first");
  project.devices = project.devices.filter((device) => device.id !== id);
  resetDiagramOptimization();
  render();
  showToast("Device deleted");
}

function editConnection(id) {
  const connection = project.connections.find((item) => item.id === id);
  if (!connection) return;
  setFormValue("connection-id", connection.id);
  setFormValue("from-device", connection.fromDevice);
  setFormValue("to-device", connection.toDevice);
  renderPortSelector(els.fromPort, connection.fromDevice, connection.fromPort, connection.toPort);
  renderPortSelector(els.toPort, connection.toDevice, connection.toPort, connection.fromPort);
  setFormValue("cable-type", connection.cableType);
  setFormValue("conductor-type", connection.conductor);
  setFormValue("from-face", normalizeFace(connection.fromFace));
  setFormValue("to-face", normalizeFace(connection.toFace));
  setFormValue("cable-length", connection.length);
  setFormValue("cable-label", connection.label);
  setFormValue("cable-route", connection.route);
  setFormValue("connection-status", connection.status);
}

function deleteConnection(id) {
  project.connections = project.connections.filter((connection) => connection.id !== id);
  resetDiagramOptimization();
  render();
  showToast("Connection deleted");
}

function clearConnectionForm() {
  els.connectionForm.reset();
  setFormValue("connection-id", "");
  renderDeviceSelectors();
  renderPortSelectors();
}

function saveConnection(event) {
  event.preventDefault();
  if (project.devices.length < 2) return showToast("Add at least two devices first");
  const existingId = getFormValue("connection-id");
  const connection = {
    id: existingId || uid("con"),
    fromDevice: getFormValue("from-device"),
    fromPort: getFormValue("from-port"),
    toDevice: getFormValue("to-device"),
    toPort: getFormValue("to-port"),
    cableType: getFormValue("cable-type"),
    conductor: getFormValue("conductor-type"),
    fromFace: normalizeFace(getFormValue("from-face")),
    toFace: normalizeFace(getFormValue("to-face")),
    length: getFormValue("cable-length"),
    label: getFormValue("cable-label") || `CBL-${project.connections.length + 1}`,
    route: getFormValue("cable-route"),
    status: getFormValue("connection-status")
  };

  if (connection.fromDevice === connection.toDevice && connection.fromPort === connection.toPort) {
    return showToast("Connection needs two different endpoints");
  }
  if (isPortInUse(connection.fromDevice, connection.fromPort, existingId, connection.fromFace)) {
    return showToast(`${deviceLabel(connection.fromDevice)} ${connection.fromPort} ${connection.fromFace.toLowerCase()} is already connected`);
  }
  if (isPortInUse(connection.toDevice, connection.toPort, existingId, connection.toFace)) {
    return showToast(`${deviceLabel(connection.toDevice)} ${connection.toPort} ${connection.toFace.toLowerCase()} is already connected`);
  }
  if (!arePortsCompatible(connection.fromPort, connection.toPort)) {
    const fromType = portFamilyLabel(portFamily(connection.fromPort));
    const toType = portFamilyLabel(portFamily(connection.toPort));
    return showToast(`Port types do not match: ${connection.fromPort} is ${fromType}, ${connection.toPort} is ${toType}`);
  }
  if (!areCableDetailsCompatible(connection.cableType, connection.conductor)) {
    const cableType = portFamilyLabel(cableTypeFamily(connection.cableType));
    const conductorType = portFamilyLabel(conductorFamily(connection.conductor));
    return showToast(`Cable details do not match: ${connection.cableType} is ${cableType}, conductor is ${conductorType}`);
  }

  project.connections = project.connections.some((item) => item.id === connection.id)
    ? project.connections.map((item) => (item.id === connection.id ? connection : item))
    : [...project.connections, connection];
  resetDiagramOptimization();
  clearConnectionForm();
  render();
  showToast("Connection saved");
}

function exportJson() {
  downloadFile(`${slug(project.name)}-systemcore.json`, JSON.stringify(projectSnapshot(), null, 2), "application/json");
}

function buildDiagramCapacityNotice() {
  if (activeOutput !== "diagram") return "";
  const connectionCount = drawableDiagramConnectionCount();
  if (connectionCount <= 80) return "";
  const message = connectionCount > 160
    ? "This is an extreme block diagram. SystemCore is using its fastest deterministic layout; split the design by room or system for a more readable drawing."
    : "This is a dense block diagram. SystemCore is evaluating fewer layout alternatives to keep generation responsive; split by room or system if the drawing becomes difficult to read.";
  return `<div class="output-capacity-notice"><strong>${connectionCount} drawable connections.</strong> ${message}</div>`;
}

function preparePrintLayout() {
  const template = normalizeTemplate(project.template);
  const landscape = template.orientation === "Landscape";
  const dimensions = template.sheetSize === "A4" ? { width: 210, height: 297 } : { width: 297, height: 420 };
  const pageWidth = landscape ? dimensions.height : dimensions.width;
  const pageHeight = landscape ? dimensions.width : dimensions.height;
  const pageMargin = 5;
  const style = document.getElementById("systemcore-print-page") || document.createElement("style");
  style.id = "systemcore-print-page";
  style.textContent = `@page { size: ${template.sheetSize} ${template.orientation.toLowerCase()}; margin: ${pageMargin}mm; }`;
  document.head.appendChild(style);
  document.body.style.setProperty("--print-sheet-width", `${pageWidth - pageMargin * 2}mm`);
  document.body.style.setProperty("--print-sheet-height", `${pageHeight - pageMargin * 2}mm`);
  document.body.classList.add("print-output-only");
}

function clearPrintLayout() {
  document.body.classList.remove("print-output-only");
  document.body.style.removeProperty("--print-sheet-width");
  document.body.style.removeProperty("--print-sheet-height");
  document.getElementById("systemcore-print-page")?.remove();
}

function validateImportedProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("That file does not contain a SystemCore project");
  }
  const collections = ["rooms", "racks", "devices", "connections"];
  for (const key of collections) {
    if (!Array.isArray(input[key])) {
      throw new Error(`SystemCore project is missing its ${key} list`);
    }
    if (input[key].some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      throw new Error(`SystemCore project contains an invalid ${key} entry`);
    }
  }
  return normalizeProject(input);
}

async function importJson(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;

  try {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("SystemCore JSON files must be smaller than 5 MB");
    }
    const imported = validateImportedProject(JSON.parse(await file.text()));
    const confirmed = window.confirm(
      `Replace the current workspace with “${imported.name}”?\n\n` +
        `${imported.rooms.length} rooms, ${imported.racks.length} racks, ` +
        `${imported.devices.length} devices, and ${imported.connections.length} connections will be imported.`
    );
    if (!confirmed) return;

    const previousProject = structuredClone(project);
    try {
      project = imported;
      activeOutput = "diagram";
      rackViewMode = "front";
      elevationViewMode = "front";
      selectedRackId = "";
      selectedElevationDeviceId = "";
      outputTemplatePreview = false;
      render();
    } catch {
      project = previousProject;
      render();
      throw new Error("The project could not be stored in this browser");
    }
    showToast(`Imported ${project.name}`);
  } catch (error) {
    showToast(error instanceof SyntaxError ? "That file is not valid JSON" : error.message || "Project import failed");
  } finally {
    input.value = "";
  }
}

function projectSnapshot() {
  return normalizeProject({
    ...project,
    exportedAt: new Date().toISOString()
  });
}

function downloadCsv() {
  const csv = activeOutput === "bom" ? bomCsv() : connectionCsv();
  downloadFile(`${slug(project.name)}-${activeOutput}.csv`, csv, "text/csv");
}

function downloadSvg() {
  const svg = (outputTemplatePreview ? buildActiveOutputSheetSvg() : buildActiveOutputContentSvg()).trim();
  downloadFile(`${slug(project.name)}-${activeOutput}${outputTemplatePreview ? "-sheet" : ""}.svg`, svg, "image/svg+xml");
}

function downloadVsdx() {
  const blob = buildVsdxPackage();
  downloadBlob(`${slug(project.name)}-block-diagram.vsdx`, blob);
}

function connectionCsv() {
  const header = [
    "Label",
    "From Device",
    "From Port",
    "From Face",
    "To Device",
    "To Port",
    "To Face",
    "Type",
    "Conductor",
    "Colour",
    "Line Weight",
    "Length",
    "Route",
    "Status"
  ];
  const rows = project.connections.map((connection) => [
    connection.label,
    deviceLabel(connection.fromDevice),
    connection.fromPort,
    normalizeFace(connection.fromFace),
    deviceLabel(connection.toDevice),
    connection.toPort,
    normalizeFace(connection.toFace),
    connection.cableType,
    connection.conductor,
    cableStyleLabel(connection),
    cableStyleWeightLabel(connection),
    connection.length,
    connection.route,
    connection.status
  ]);
  return toCsv([header, ...rows]);
}

function bomCsv() {
  const header = ["Item", "Quantity", "Unit", "Source", "Description"];
  const rows = buildBom().map((line) => [line.item, line.qty, line.unit, line.source, line.description]);
  return toCsv([header, ...rows]);
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\n");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Export generated");
}

function buildVsdxPackage() {
  const layout = buildDiagramLayout();
  const pageWidth = Math.max(11, layout.width / 96);
  const pageHeight = Math.max(8.5, layout.height / 96);
  const files = {
    "[Content_Types].xml": xmlHeader(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
</Types>`),
    "_rels/.rels": xmlHeader(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`),
    "visio/document.xml": buildVsdxDocumentXml(pageWidth, pageHeight),
    "visio/_rels/document.xml.rels": xmlHeader(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
</Relationships>`),
    "visio/pages/pages.xml": xmlHeader(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Page ID="0" Name="Page-1" NameU="Page-1" ViewScale="1" ViewCenterX="${formatNumber(pageWidth / 2)}" ViewCenterY="${formatNumber(pageHeight / 2)}">
    <Rel r:id="rId1"/>
  </Page>
</Pages>`),
    "visio/pages/_rels/pages.xml.rels": xmlHeader(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`),
    "visio/pages/page1.xml": buildVsdxPageXml(layout, pageWidth, pageHeight)
  };
  return new Blob([createZip(files)], {
    type: "application/vnd.ms-visio.drawing"
  });
}

function buildVsdxDocumentXml(pageWidth, pageHeight) {
  return xmlHeader(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">
  <DocumentSettings/>
  <Colors/>
  <FaceNames/>
  <StyleSheets/>
  <DocumentSheet>
    <PageProps>
      <PageWidth>${formatNumber(pageWidth)}</PageWidth>
      <PageHeight>${formatNumber(pageHeight)}</PageHeight>
    </PageProps>
  </DocumentSheet>
  <Pages>
    <Page ID="0" Name="Page-1" NameU="Page-1" ViewScale="1" ViewCenterX="${formatNumber(pageWidth / 2)}" ViewCenterY="${formatNumber(pageHeight / 2)}">
      <Rel r:id="rId1"/>
    </Page>
  </Pages>
</VisioDocument>`);
}

function buildVsdxPageXml(layout, pageWidth, pageHeight) {
  const shapes = [];
  layout.positions.forEach((position, index) => {
    const device = getDevice(position.id);
    const shapeId = index + 1;
    const pin = toVisioPoint(position.x + position.w / 2, position.y + position.h / 2, pageHeight);
    const width = position.w / 96;
    const height = position.h / 96;
    shapes.push(`
    <Shape ID="${shapeId}" NameU="${xmlEscape(device.name)}" Type="Shape">
      <XForm>
        <PinX>${formatNumber(pin.x)}</PinX>
        <PinY>${formatNumber(pin.y)}</PinY>
        <Width>${formatNumber(width)}</Width>
        <Height>${formatNumber(height)}</Height>
        <LocPinX>${formatNumber(width / 2)}</LocPinX>
        <LocPinY>${formatNumber(height / 2)}</LocPinY>
      </XForm>
      <Text>${xmlEscape(`${device.name}\n${device.category} / ${deviceLocation(device)}\n${device.model || "Model TBC"}`)}</Text>
    </Shape>`);
  });

  layout.routes.forEach((route, index) => {
    const shapeId = layout.positions.length + index + 1;
    const start = toVisioPoint(route.start.x, route.start.y, pageHeight);
    const end = toVisioPoint(route.end.x, route.end.y, pageHeight);
    shapes.push(`
    <Shape ID="${shapeId}" NameU="${xmlEscape(route.connection.label)}" Type="Shape">
      <XForm1D>
        <BeginX>${formatNumber(start.x)}</BeginX>
        <BeginY>${formatNumber(start.y)}</BeginY>
        <EndX>${formatNumber(end.x)}</EndX>
        <EndY>${formatNumber(end.y)}</EndY>
      </XForm1D>
      <Text>${xmlEscape(`${route.connection.label}\n${route.connection.fromPort} to ${route.connection.toPort}`)}</Text>
    </Shape>`);
  });

  return xmlHeader(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Shapes>${shapes.join("")}
  </Shapes>
</PageContents>`);
}

function toVisioPoint(x, y, pageHeight) {
  return {
    x: x / 96,
    y: pageHeight - y / 96
  };
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, Object.keys(files).length, true);
  endView.setUint16(10, Object.keys(files).length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function concatUint8Arrays(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function xmlHeader(value) {
  return value.trim();
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function readPortProfile() {
  return normalizePortProfile({
    copper: getFormValue("port-copper-count"),
    fiber: getFormValue("port-fiber-count"),
    display: getFormValue("port-display-count"),
    power: getFormValue("port-power-count")
  });
}

function writePortProfile(profile) {
  const normalized = normalizePortProfile(profile);
  setFormValue("port-copper-count", normalized.copper);
  setFormValue("port-fiber-count", normalized.fiber);
  setFormValue("port-display-count", normalized.display);
  setFormValue("port-power-count", normalized.power);
}

function readPortFaces() {
  return normalizePortFaces({
    copper: getFormValue("port-copper-face"),
    fiber: getFormValue("port-fiber-face"),
    display: getFormValue("port-display-face"),
    power: getFormValue("port-power-face")
  }, getFormValue("device-category"));
}

function writePortFaces(portFaces, category = getFormValue("device-category")) {
  const normalized = normalizePortFaces(portFaces, category);
  setFormValue("port-copper-face", normalized.copper);
  setFormValue("port-fiber-face", normalized.fiber);
  setFormValue("port-display-face", normalized.display);
  setFormValue("port-power-face", normalized.power);
}

function normalizePortProfile(profile) {
  return {
    copper: Math.max(0, Number(profile?.copper) || 0),
    fiber: Math.max(0, Number(profile?.fiber) || 0),
    display: Math.max(0, Number(profile?.display) || 0),
    power: Math.max(0, Number(profile?.power) || 0)
  };
}

function normalizePortFaces(portFaces, category = "") {
  const defaults = defaultPortFaces(category);
  return {
    copper: normalizeFace(portFaces?.copper || defaults.copper),
    fiber: normalizeFace(portFaces?.fiber || defaults.fiber),
    display: normalizeFace(portFaces?.display || defaults.display),
    power: normalizeFace(portFaces?.power || defaults.power)
  };
}

function defaultPortProfile(category) {
  return {
    "Network Switch": { copper: 24, fiber: 4, display: 0, power: 2 },
    Server: { copper: 3, fiber: 2, display: 1, power: 2 },
    "Patch Panel": { copper: 24, fiber: 0, display: 0, power: 0 },
    Display: { copper: 1, fiber: 0, display: 2, power: 1 },
    "Media Converter": { copper: 2, fiber: 2, display: 0, power: 1 },
    Storage: { copper: 2, fiber: 4, display: 0, power: 2 },
    Power: { copper: 0, fiber: 0, display: 0, power: 8 },
    Other: { copper: 1, fiber: 0, display: 0, power: 1 }
  }[category] || { copper: 1, fiber: 0, display: 0, power: 1 };
}

function defaultPortFaces(category) {
  if (category === "Power") return { copper: "Front", fiber: "Front", display: "Front", power: "Front" };
  return { copper: "Front", fiber: "Front", display: "Front", power: "Rear" };
}

function inferPortProfile(category, ports = []) {
  if (!ports.length) return defaultPortProfile(category);
  return ports.reduce(
    (profile, port) => {
      const value = String(port).toUpperCase();
      if (value.includes("SFP") || value.includes("LC") || value.startsWith("TE")) profile.fiber += 1;
      else if (value.includes("HDMI") || value.includes("DP") || value.includes("SDI")) profile.display += 1;
      else if ((category === "Power" && /^\d+$/.test(value)) || value.includes("PWR") || value.includes("POWER") || value.includes("IEC")) profile.power += 1;
      else profile.copper += 1;
      return profile;
    },
    { copper: 0, fiber: 0, display: 0, power: 0 }
  );
}

function generatePorts(category, profile, mount = "room") {
  const normalized = normalizePortProfile(profile);
  return [
    ...generatePortType(category, "copper", normalized.copper, mount),
    ...generatePortType(category, "fiber", normalized.fiber, mount),
    ...generatePortType(category, "display", normalized.display, mount),
    ...generatePortType(category, "power", normalized.power, mount)
  ];
}

function generatePortType(category, type, count, mount) {
  const ports = [];
  for (let index = 1; index <= count; index += 1) {
    ports.push(portName(category, type, index, mount));
  }
  return ports;
}

function portName(category, type, index, mount = "room") {
  const padded = String(index).padStart(2, "0");
  if (category === "Power" && type === "power" && ["rail-left", "rail-right"].includes(mount)) return String(index);
  if (category === "Network Switch" && type === "copper") return `Gi1/0/${index}`;
  if (category === "Network Switch" && type === "fiber") return `Te1/1/${index}`;
  if (category === "Patch Panel" && type === "copper") return `A${padded}`;
  if (category === "Patch Panel" && type === "fiber") return `LC${padded}`;
  if (category === "Server" && type === "copper") return index === 3 ? "iDRAC" : `NIC${index}`;
  if (category === "Display" && type === "copper") return `LAN-${index}`;
  if (category === "Media Converter" && type === "copper") return `LAN${index}`;
  if (category === "Media Converter" && type === "display") return index === 1 ? "HDMI-IN" : `HDMI-${index}`;
  if (type === "fiber") return `SFP-${padded}`;
  if (type === "display") return `HDMI-${index}`;
  if (type === "power") return countPowerPort(index);
  return `RJ45-${padded}`;
}

function countPowerPort(index) {
  return index === 1 ? "PWR-A" : index === 2 ? "PWR-B" : `PWR-${index}`;
}

function inferRackFromLocation(racks, location = "") {
  const value = String(location).toLowerCase();
  return racks.find((rack) => value.includes(rack.name.toLowerCase())) || null;
}

function normalizeRackU(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : "";
}

function rackTop(device) {
  return Number(device.rackU) || Number.NaN;
}

function rackSpan(device) {
  return Math.max(1, Number(device.rackSpan) || 1);
}

function rackRange(device, rack = getRack(device.rackId)) {
  const top = rackTop(device);
  if (!Number.isFinite(top)) return null;
  const rackSize = Math.max(1, Number(rack?.sizeU) || top);
  const span = Math.min(rackSize, rackSpan(device));
  const bottom = Math.max(1, top - span + 1);
  return { top: Math.min(rackSize, top), bottom };
}

function rackRangesOverlap(first, second) {
  if (!first || !second) return false;
  return first.bottom <= second.top && second.bottom <= first.top;
}

function rackPlacementConflict(candidate, rack = getRack(candidate.rackId)) {
  if (!rack) return null;
  const rawTop = rackTop(candidate);
  if (!Number.isFinite(rawTop)) return null;
  const rawBottom = rawTop - rackSpan(candidate) + 1;
  if (rawTop > rack.sizeU || rawBottom < 1) return { name: `${rack.name} bounds`, rackU: rawTop, rackSpan: rackSpan(candidate) };
  const candidateRange = rackRange(candidate, rack);
  return project.devices.find((device) => {
    if (device.id === candidate.id || device.rackId !== candidate.rackId || !isRackMounted(device)) return false;
    return rackRangesOverlap(candidateRange, rackRange(device, rack));
  }) || null;
}

function rackPlacementConflicts(devices, rack) {
  const conflicts = [];
  const rackDevices = devices.filter(isRackMounted);
  rackDevices.forEach((device, index) => {
    const rawTop = rackTop(device);
    const rawBottom = rawTop - rackSpan(device) + 1;
    const range = rackRange(device, rack);
    if (!range) return;
    if (rawTop > rack.sizeU || rawBottom < 1) {
      conflicts.push({ first: device, second: { id: "__rack_bounds__", name: `${rack.name} bounds` } });
    }
    rackDevices.slice(index + 1).forEach((other) => {
      if (rackRangesOverlap(range, rackRange(other, rack))) conflicts.push({ first: device, second: other });
    });
  });
  return conflicts;
}

function formatRackRange(device) {
  if (isRackRail(device)) return mountLabel(device.mount);
  const range = rackRange(device);
  if (!range) return "Room mounted";
  if (range.top === range.bottom) return `U${range.top}`;
  return `U${range.top}-U${range.bottom}`;
}

function normalizeCableColour(value) {
  const colour = String(value || "Auto").trim();
  return colourOptions(true).includes(colour) ? colour : "Auto";
}

function normalizeDeviceColour(value) {
  const colour = String(value || "Auto").trim();
  return colourOptions(true).includes(colour) ? colour : "Auto";
}

function normalizeLineWeight(value) {
  const weight = String(value || "Standard").trim();
  return ["Thin", "Standard", "Heavy"].includes(weight) ? weight : "Standard";
}

function normalizeFace(value) {
  const face = String(value || "Front").trim().toLowerCase();
  if (face === "rear") return "Rear";
  if (face === "unspecified") return "Unspecified";
  return "Front";
}

function cableStyle(connection) {
  const standard = cableStyleStandard(connection);
  const color = cableColourHex(standard.colour);
  const width = {
    Thin: 2,
    Standard: 3,
    Heavy: 4.5
  }[standard.lineWeight];
  return { color, width };
}

function cableStyleStandard(connection) {
  const family = cableTypeFamily(connection?.cableType);
  const conductor = conductorFamily(connection?.conductor);
  const standards = normalizeShapeStandards(project.shapeStandards).cables;
  return standards[family] || standards[conductor] || standards.other;
}

function cableStyleLabel(connection) {
  return cableStyleStandard(connection).colour;
}

function cableStyleWeightLabel(connection) {
  return cableStyleStandard(connection).lineWeight;
}

function cableColourHex(colour) {
  return {
    Black: "#202522",
    Blue: "#315f82",
    Pink: "#c0528d",
    Red: "#a24a44",
    Purple: "#7a5d9a",
    Teal: "#3f766f",
    Green: "#557c55",
    Orange: "#a7652a",
    Grey: "#65726c"
  }[colour] || "#65726c";
}

function deviceAccentColor(device) {
  return cableColourHex(deviceStyleStandard(device).colour);
}

function deviceOutlineWidth(device) {
  return {
    Thin: 1,
    Standard: 1.4,
    Heavy: 2.4
  }[deviceStyleStandard(device).lineWeight];
}

function deviceStyleStandard(device) {
  const standards = normalizeShapeStandards(project.shapeStandards).devices;
  return standards[device?.category] || standards.Other;
}

function colourOptions(includeAuto = false) {
  const colours = ["Black", "Blue", "Pink", "Red", "Purple", "Teal", "Green", "Orange", "Grey"];
  return includeAuto ? ["Auto", ...colours] : colours;
}

function lineWeightOptions() {
  return ["Thin", "Standard", "Heavy"];
}

function categoryColor(category) {
  return {
    "Network Switch": "#315f82",
    Server: "#557c55",
    "Patch Panel": "#a7652a",
    Display: "#7a5d9a",
    "Media Converter": "#3f766f",
    Storage: "#5f6f86",
    Power: "#a24a44"
  }[category] || "#65726c";
}

function slug(value) {
  return String(value || "systemcore").replace(/\s+/g, "-").toLowerCase();
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  const limit = Math.max(4, maxLength);
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function wrapTextLines(value, maxChars, maxLines = 2) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  const limit = Math.max(5, maxChars);
  const lines = [];
  words.forEach((word) => {
    const safeWord = word.length > limit ? truncateText(word, limit) : word;
    const current = lines[lines.length - 1] || "";
    if (!current || `${current} ${safeWord}`.length > limit) {
      lines.push(safeWord);
    } else {
      lines[lines.length - 1] = `${current} ${safeWord}`;
    }
  });
  if (!lines.length) lines.push("");
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = truncateText([kept[maxLines - 1], ...lines.slice(maxLines)].join(" "), limit);
    return kept;
  }
  return lines;
}

function svgTextLines(lines, x, y, fontSize, lineHeight, options = {}) {
  const weight = options.weight ? ` font-weight="${options.weight}"` : "";
  const fill = options.fill || "#17211d";
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : "";
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-size="${fontSize}"${weight} fill="${fill}"${anchor}>${escapeHtml(line)}</text>`)
    .join("");
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("click", (event) => {
  const navButton = event.target.closest(".nav-button");
  if (navButton) {
    els.navButtons.forEach((button) => button.classList.toggle("active", button === navButton));
    els.sections.forEach((section) => section.classList.toggle("active", section.id === `${navButton.dataset.section}-section`));
  }

  const outputButton = event.target.closest("[data-output]");
  if (outputButton) {
    activeOutput = outputButton.dataset.output;
    els.outputTabs.forEach((button) => button.classList.toggle("active", button === outputButton));
    renderOutput();
  }

  const rackViewButton = event.target.closest("[data-rack-view]");
  if (rackViewButton) {
    rackViewMode = rackViewButton.dataset.rackView;
    renderOutput();
  }

  const elevationViewButton = event.target.closest("[data-elevation-view]");
  if (elevationViewButton) {
    elevationViewMode = elevationViewButton.dataset.elevationView;
    renderOutput();
  }

  const actions = [
    ["editRoom", editRoom],
    ["deleteRoom", deleteRoom],
    ["editRack", editRack],
    ["deleteRack", deleteRack],
    ["editDevice", editDevice],
    ["deleteDevice", deleteDevice],
    ["editConnection", editConnection],
    ["deleteConnection", deleteConnection]
  ];
  actions.forEach(([name, handler]) => {
    const id = event.target.dataset[name];
    if (id) handler(id);
  });
});

document.addEventListener("change", (event) => {
  if (event.target.id === "elevation-device-select") {
    selectedElevationDeviceId = event.target.value;
    renderOutput();
  }
  if (event.target.id === "rack-output-select") {
    selectedRackId = event.target.value;
    renderOutput();
  }
});

document.getElementById("save-project-name").addEventListener("click", saveProjectName);
document.getElementById("add-device").addEventListener("click", clearDeviceForm);
document.getElementById("add-connection").addEventListener("click", clearConnectionForm);
document.getElementById("reset-demo").addEventListener("click", () => {
  project = normalizeProject(createBlankProject());
  [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].forEach((key) => localStorage.removeItem(key));
  render();
  showToast("Workspace reset");
});
document.getElementById("export-json").addEventListener("click", exportJson);
document.getElementById("import-json").addEventListener("click", () => document.getElementById("import-json-file").click());
document.getElementById("import-json-file").addEventListener("change", importJson);
document.getElementById("download-csv").addEventListener("click", downloadCsv);
document.getElementById("download-svg").addEventListener("click", downloadSvg);
document.getElementById("download-vsdx").addEventListener("click", downloadVsdx);
els.realignDiagram.addEventListener("click", realignDiagram);
els.templateOutputToggle.addEventListener("change", (event) => {
  outputTemplatePreview = event.target.checked;
  renderOutput();
});
document.getElementById("print-output").addEventListener("click", () => {
  preparePrintLayout();
  window.print();
  window.setTimeout(clearPrintLayout, 500);
});
window.addEventListener("afterprint", clearPrintLayout);
els.roomForm.addEventListener("submit", saveRoom);
els.rackForm.addEventListener("submit", saveRack);
els.deviceForm.addEventListener("submit", saveDevice);
els.connectionForm.addEventListener("submit", saveConnection);
els.templateForm.addEventListener("submit", saveTemplate);
els.templateSource.addEventListener("change", (event) => {
  const wantsCustom = event.target.value === "custom";
  els.customTemplateFields.classList.toggle("hidden", !wantsCustom);
  if (!wantsCustom || project.template.customSvg) {
    project.template.source = wantsCustom ? "custom" : "built-in";
    renderTemplate();
    renderOutput();
    saveProject();
  }
});
els.customTemplateFile.addEventListener("change", importCustomTemplate);
els.clearCustomTemplate.addEventListener("click", clearCustomTemplate);
els.shapeStandardsForm.addEventListener("submit", saveShapeStandards);
els.deviceSearch.addEventListener("input", renderDevices);
els.categoryFilter.addEventListener("change", renderDevices);
els.deviceRoom.addEventListener("change", () => {
  renderRackOptions();
  renderRackUOptions();
  renderMountingFields();
});
els.deviceMount.addEventListener("change", () => {
  renderRackOptions();
  renderRackUOptions();
  renderMountingFields();
  renderPortPreview();
});
els.deviceRack.addEventListener("change", () => {
  renderRackUOptions();
  renderMountingFields();
});
els.deviceCategory.addEventListener("change", () => {
  const category = getFormValue("device-category");
  writePortProfile(defaultPortProfile(category));
  writePortFaces(defaultPortFaces(category), category);
  renderMountOptions();
  renderRackOptions();
  renderRackUOptions();
  renderMountingFields();
  renderPortPreview();
});
["port-copper-count", "port-fiber-count", "port-display-count", "port-power-count"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderPortPreview);
});
["port-copper-face", "port-fiber-face", "port-display-face", "port-power-face"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderPortPreview);
});
document.getElementById("cable-type").addEventListener("change", () => syncConnectionConductor("cable"));
document.getElementById("device-rack-span").addEventListener("input", () => renderRackUOptions());
els.fromDevice.addEventListener("change", () => renderPortSelectors("from"));
els.toDevice.addEventListener("change", () => renderPortSelectors("to"));
els.fromPort.addEventListener("change", () => renderPortSelectors("from"));
els.toPort.addEventListener("change", () => renderPortSelectors("to"));
els.fromFace.addEventListener("change", () => renderPortSelectors("from"));
els.toFace.addEventListener("change", () => renderPortSelectors("to"));

render();
