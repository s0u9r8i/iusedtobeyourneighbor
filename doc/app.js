const PAGE_TITLE = "\"I used to be your neighbor♡\" Bird Pit Solo Exhibition at Bungee Space | June 26 - August 23, 2026";
document.title = PAGE_TITLE;

const canvas = document.querySelector("#globe");
const pigeonLayer = document.querySelector("#pigeonLayer");
const cameraHeightSlider = document.querySelector("#cameraHeight");
const cameraHeightValue = document.querySelector("#cameraHeightValue");
const recallButton = document.querySelector("#recallButton");
const relocatedButton = document.querySelector("#relocatedButton");
const vault = document.querySelector("#vault");
const vaultBox = document.querySelector("#vaultBox");
const gl = canvas.getContext("webgl", {
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});

if (!gl) {
  document.body.textContent = "WebGL is not available in this browser.";
  throw new Error("WebGL unavailable");
}

const vertexShaderSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec2 aUv;

  uniform mat4 uProjection;
  uniform mat4 uModel;

  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vNormal = mat3(uModel) * aNormal;
    vUv = aUv;
    gl_Position = uProjection * uModel * vec4(aPosition, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  uniform sampler2D uTexture;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vec4 mapColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(mapColor.rgb, 1.0);
  }
`;

const state = {
  width: 0,
  height: 0,
  rotationX: 0.0,
  rotationY: Math.PI / 2,
  velocityX: 0,
  velocityY: 0.001,
  targetVelocityX: 0,
  targetVelocityY: 0.0006,
  dragging: false,
  lastX: 0,
  lastY: 0,
  recalled: false,
  vaultOpen: false,
  vaultDrag: null,
};
const INSIDE_GLOBE_SCALE = {
  x: 11,
  y: 15,
  z: 10,
};
const CAMERA_OFFSET = {
  x: 0,
  y: 0.5,
  z: 0,
};
const CAPSULE_STRAIGHT_RATIO = 0.82;
const CAPSULE_CAP_HEIGHT_MULTIPLIER = 5.76;
const CAPSULE_CAP_ROWS = 72;
const MAX_WHEEL_SPEED = 0.007;
const MAX_DRAG_SPEED = 0.01;
const WHEEL_ACCELERATION = 0.000025;
const WHEEL_EASE = 0.045;
const IDLE_FRICTION = 0.91;
const DRAG_FRICTION = 0.78;
const GRID_COLUMNS = 58;
const GRID_ROWS = 32;
const GRID_CELL_SIZE = 128;
const MAP_TEXTURE_ZOOM = 1;
const DOME_TEXTURE_ROWS = 3;
const TOP_DOME_TEXTURE_ROWS = 1;
const BOTTOM_DOME_TEXTURE_ROWS = DOME_TEXTURE_ROWS;
const TOTAL_TEXTURE_ROWS = GRID_ROWS + TOP_DOME_TEXTURE_ROWS + BOTTOM_DOME_TEXTURE_ROWS;
const DOME_SAMPLE_ROWS = 6;
const TOP_CAP_UV_BAND = TOP_DOME_TEXTURE_ROWS / TOTAL_TEXTURE_ROWS;
const MAP_UV_START = TOP_CAP_UV_BAND;
const MAP_UV_END = (TOP_DOME_TEXTURE_ROWS + GRID_ROWS) / TOTAL_TEXTURE_ROWS;
const TOP_DOME_VERTICAL_SHIFT_ROWS = 0;
const PIGEON_SPRING = 0.032;
const PIGEON_DAMPING = 0.7;
const PIGEON_MAX_LAG = 120;
const PIGEON_MAX_TILT = 10;
const PIGEON_RELEASE_DISTANCE = 12;
const PIGEON_RELEASE_TIMEOUT = 1800;
const RECALL_PIN_SIZE = 86;
const RECALL_PIN_TOTAL_HEIGHT = 104;
const RECALL_PIN_GAP = 16;
const RECALL_LEFT = 24;
const RECALL_TOP = 142;
const MOBILE_RECALL_BREAKPOINT = 700;
const MAP_PIN_JITTER_CELLS = 0.7;
const MAP_PIN_MIN_SEPARATION_CELLS = 1.18;
const MAP_PIN_MAX_OFFSET_CELLS = 1.5;
const MAP_PIN_RELAXATION_STEPS = 36;
const MAP_PIN_MAX_RANDOM_ROTATION = 5;

const program = createProgram(vertexShaderSource, fragmentShaderSource);
const locations = {
  aPosition: gl.getAttribLocation(program, "aPosition"),
  aNormal: gl.getAttribLocation(program, "aNormal"),
  aUv: gl.getAttribLocation(program, "aUv"),
  uProjection: gl.getUniformLocation(program, "uProjection"),
  uModel: gl.getUniformLocation(program, "uModel"),
  uTexture: gl.getUniformLocation(program, "uTexture"),
};

const sphere = createCapsulePanorama(1, 192);
const pigeonPins = createPigeonPins();
const vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, sphere.vertices, gl.STATIC_DRAW);

const indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texImage2D(
  gl.TEXTURE_2D,
  0,
  gl.RGBA,
  1,
  1,
  0,
  gl.RGBA,
  gl.UNSIGNED_BYTE,
  new Uint8Array([255, 255, 255, 255]),
);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

const mapImage = new Image();
const mapTextureState = {
  mapLoaded: false,
};

mapImage.crossOrigin = "anonymous";
mapImage.onload = () => {
  mapTextureState.mapLoaded = true;
  refreshMapTexture();
};
mapImage.onerror = () => {
  console.error("The map image could not be loaded.");
};
mapImage.src = pickRandomMapImage();

window.addEventListener("resize", resize);
canvas.addEventListener("wheel", onWheel, { passive: false });
canvas.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
cameraHeightSlider?.addEventListener("input", onCameraHeightInput);
cameraHeightSlider?.addEventListener("pointerdown", stopControlPointer);
cameraHeightSlider?.addEventListener("wheel", stopControlWheel, { passive: false });
recallButton?.addEventListener("click", toggleRecall);
relocatedButton?.addEventListener("click", toggleVault);
recallButton?.addEventListener("pointerdown", stopControlPointer);
relocatedButton?.addEventListener("pointerdown", stopControlPointer);
vault?.addEventListener("click", closeVaultOnBackdrop);
vaultBox?.addEventListener("pointerdown", stopControlPointer);
vaultBox?.addEventListener("click", stopControlPointer);

syncCameraHeightControl();
syncActionControls();
populateVault();
syncShopifyInventory();
resize();
requestAnimationFrame(render);

function pickRandomMapImage() {
  const sources = [
    "https://cdn.shopify.com/s/files/1/2263/4647/files/imagemap_pigeon_1.png?v=1782413213",
    "https://cdn.shopify.com/s/files/1/2263/4647/files/imagemap_pigeon_2.png?v=1782413213",
    "https://cdn.shopify.com/s/files/1/2263/4647/files/imagemap_pigeon_3.png?v=1782413213",
  ];
  let nextIndex = Math.floor(Math.random() * sources.length);

  if (sources.length > 1) {
    const lastIndex = Number(sessionStorage.getItem("lastMapImageIndex"));
    if (Number.isFinite(lastIndex) && nextIndex === lastIndex) {
      nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (sources.length - 1))) % sources.length;
    }
    sessionStorage.setItem("lastMapImageIndex", String(nextIndex));
  }

  return sources[nextIndex];
}

async function syncShopifyInventory() {
  const handles = [...new Set(pigeonPins.map((pin) => getShopifyProductHandle(pin.productLink)).filter(Boolean))];
  if (!handles.length) {
    console.info("Shopify inventory sync skipped. No product handles were found in pigeon links.");
    return;
  }

  try {
    const availability = await fetchPrivateAdminAvailability(handles);
    applyShopifyAvailability(availability, "Admin inventory");
    return;
  } catch (error) {
    console.info("Private Shopify inventory endpoint unavailable. Trying Storefront API fallback.", error);
  }

  const config = getShopifyConfig();
  if (!config) {
    console.info("Shopify Storefront sync skipped. Add a Storefront API token in shopify-config.js or SHOPIFY_ADMIN_ACCESS_TOKEN on the server.");
    return;
  }

  try {
    const availability = await fetchShopifyAvailability(handles, config);
    applyShopifyAvailability(availability, "Storefront availability");
  } catch (error) {
    console.error("Shopify inventory sync failed. Using inventory-data.js fallback.", error);
  }
}

function applyShopifyAvailability(availability, sourceLabel) {
  let relocatedCount = 0;

  for (const pin of pigeonPins) {
    const handle = getShopifyProductHandle(pin.productLink);
    if (!handle || !availability.has(handle)) continue;

    pin.inventory = availability.get(handle) ? 1 : 0;
    if (pin.inventory <= 0) relocatedCount += 1;
  }

  populateVault();
  console.info(`Shopify ${sourceLabel} sync complete. Relocated ${relocatedCount} of ${pigeonPins.length} pigeons.`);
}

function getShopifyConfig() {
  const config = window.SHOPIFY_CONFIG;
  const storeDomain = normalizeShopifyDomain(config?.storeDomain);
  const storefrontAccessToken = String(config?.storefrontAccessToken || "").trim();

  if (!storeDomain || !storefrontAccessToken) return null;

  return {
    storeDomain,
    storefrontAccessToken,
  };
}

function normalizeShopifyDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

async function fetchShopifyAvailability(handles, config) {
  const availability = new Map();
  const chunkSize = 20;

  for (let start = 0; start < handles.length; start += chunkSize) {
    const chunk = handles.slice(start, start + chunkSize);
    const query = `query {
${chunk.map((handle, index) => `  product${index}: product(handle: ${JSON.stringify(handle)}) {
    variants(first: 10) {
      nodes {
        availableForSale
      }
    }
  }`).join("\n")}
}`;

    const response = await fetch(`https://${config.storeDomain}/api/2026-04/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": config.storefrontAccessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Shopify responded with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    chunk.forEach((handle, index) => {
      const variants = payload.data?.[`product${index}`]?.variants?.nodes || [];
      if (!variants.length) {
        console.warn(`Shopify product ${handle}: no product/variants found, keeping inventory-data.js value`);
        return;
      }

      const isAvailable = variants.some((variant) => variant.availableForSale);
      availability.set(handle, isAvailable);
      console.info(`Shopify product ${handle}: ${isAvailable ? "on map" : "relocated"}`);
    });
  }

  return availability;
}

async function fetchPrivateAdminAvailability(handles) {
  const response = await fetch(`/api/shopify-inventory?handles=${encodeURIComponent(handles.join(","))}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Private inventory endpoint responded with ${response.status}`);
  }

  const payload = await response.json();
  const availability = new Map();

  for (const [handle, product] of Object.entries(payload.products || {})) {
    const inventory = Number(product.inventory);
    const quantity = Number(product.availableQuantity);
    const isAvailable = Number.isFinite(inventory)
      ? inventory > 0
      : Number.isFinite(quantity)
        ? quantity > 0
        : Boolean(product.availableForSale);
    availability.set(handle, isAvailable);
    console.info(`Shopify Admin product ${handle}: ${isAvailable ? "on map" : "relocated"} (${Number.isFinite(quantity) ? quantity : "unknown"} available)`);
  }

  return availability;
}

function getShopifyProductHandle(productLink) {
  try {
    const url = new URL(productLink);
    const parts = url.pathname.split("/").filter(Boolean);
    const productIndex = parts.indexOf("products");
    return productIndex >= 0 ? parts[productIndex + 1] || "" : "";
  } catch {
    return "";
  }
}

function onCameraHeightInput(event) {
  CAMERA_OFFSET.y = Number(event.target.value);
  syncCameraHeightControl();
}

function toggleRecall() {
  if (!state.recalled) {
    startRecallFlight();
    state.recalled = true;
  } else {
    startReleaseFlight();
    state.recalled = false;
  }
  state.vaultOpen = false;
  syncActionControls();
}

function toggleVault() {
  const nextVaultOpen = !state.vaultOpen;
  if (state.recalled) startReleaseFlight();
  state.recalled = false;
  state.vaultOpen = nextVaultOpen;
  populateVault();
  syncActionControls();
}

function closeVaultOnBackdrop(event) {
  if (event.target !== vault) return;
  state.vaultOpen = false;
  syncActionControls();
}

function refreshMapTexture() {
  if (!mapTextureState.mapLoaded) return;

  const preparedMap = prepareMapTexture(mapImage);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, preparedMap);
}

function syncCameraHeightControl() {
  if (!cameraHeightSlider || !cameraHeightValue) return;
  cameraHeightSlider.value = String(CAMERA_OFFSET.y);
  const min = Number(cameraHeightSlider.min);
  const max = Number(cameraHeightSlider.max);
  const progress = (max - CAMERA_OFFSET.y) / (max - min);
  cameraHeightSlider.parentElement?.style.setProperty("--slider-ratio", `${progress}`);
  cameraHeightValue.value = CAMERA_OFFSET.y.toFixed(2);
  cameraHeightValue.textContent = "⬇️";
}

function startRecallFlight() {
  const viewportWidth = state.width / Math.min(window.devicePixelRatio || 1, 2);
  const viewportHeight = state.height / Math.min(window.devicePixelRatio || 1, 2);

  if (pigeonLayer) pigeonLayer.scrollTop = 0;

  for (const pin of pigeonPins) {
    if (pin.inventory <= 0) continue;
    pin.releasing = false;
    const fallback = getFlatGridScreenTarget(pin, viewportWidth, viewportHeight);
    pin.screenX = Number.isFinite(pin.mapX) ? pin.mapX : fallback.x;
    pin.screenY = Number.isFinite(pin.mapY) ? pin.mapY : fallback.y;
    pin.velocityX *= 0.25;
    pin.velocityY *= 0.25;
    pin.element.style.opacity = "1";
    pin.element.style.pointerEvents = "auto";
  }
}

function startReleaseFlight() {
  const now = performance.now();
  const scrollTop = isMobileRecall() && pigeonLayer ? pigeonLayer.scrollTop : 0;

  for (const pin of pigeonPins) {
    if (pin.inventory <= 0) continue;
    pin.releasing = true;
    pin.releaseStartedAt = now;
    pin.screenY = Number.isFinite(pin.screenY) ? pin.screenY - scrollTop : pin.screenY;
    pin.velocityX *= 0.35;
    pin.velocityY *= 0.35;
    pin.element.style.opacity = "1";
    pin.element.style.pointerEvents = "auto";
  }

  if (pigeonLayer) pigeonLayer.scrollTop = 0;
}

function syncActionControls() {
  if (recallButton) recallButton.textContent = state.recalled ? "RELEASE" : "RECALL";
  if (vault) vault.hidden = !state.vaultOpen;
  document.body.classList.toggle("is-recalled", state.recalled);
}

function populateVault() {
  if (!vaultBox || !pigeonPins.length) return;

  vaultBox.textContent = "";
  const relocatedPins = pigeonPins.filter((pin) => pin.inventory <= 0);
  if (relocatedPins.length === 0) {
    const emptyMessage = document.createElement("a");
    emptyMessage.className = "vault__empty";
    emptyMessage.href = "https://3ssstudios.com/collections/bird-pit-artwork";
    emptyMessage.target = "_blank";
    emptyMessage.rel = "noopener noreferrer";
    emptyMessage.textContent = "FIND YOUR NEW ROOMIE at BUNGEE SPACE";
    vaultBox.appendChild(emptyMessage);
    return;
  }

  for (const pin of relocatedPins) {
    const linkElement = document.createElement("a");
    const imageElement = document.createElement("img");
    const placement = getVaultPlacement(pin.id);

    linkElement.className = "vault-pigeon";
    linkElement.href = pin.productLink;
    linkElement.target = "_blank";
    linkElement.rel = "noopener noreferrer";
    linkElement.ariaLabel = `Pigeon ${pin.id}`;
    linkElement.draggable = false;
    linkElement.style.left = `${placement.x}%`;
    linkElement.style.top = `${placement.y}%`;
    linkElement.style.transform = `translate(-50%, -50%) rotate(${placement.rotation}deg)`;
    linkElement.dataset.rotation = String(placement.rotation);
    linkElement.addEventListener("pointerdown", startVaultPigeonDrag);
    linkElement.addEventListener("click", onVaultPigeonClick);

    imageElement.src = pin.image;
    imageElement.alt = "";
    imageElement.loading = "eager";
    imageElement.draggable = false;
    linkElement.appendChild(imageElement);
    vaultBox.appendChild(linkElement);
  }
}

function startVaultPigeonDrag(event) {
  const element = event.currentTarget;
  const box = vaultBox?.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (!box) return;

  event.preventDefault();
  event.stopPropagation();
  element.setPointerCapture?.(event.pointerId);
  element.classList.add("is-dragging");
  state.vaultDrag = {
    element,
    pointerId: event.pointerId,
    offsetX: event.clientX - (rect.left + rect.width / 2),
    offsetY: event.clientY - (rect.top + rect.height / 2),
    moved: false,
  };
}

function onVaultPigeonClick(event) {
  event.preventDefault();
  event.stopPropagation();

  if (event.currentTarget.dataset.dragMoved !== "true") {
    window.open(event.currentTarget.href, "_blank", "noopener");
  } else {
    event.currentTarget.dataset.dragMoved = "false";
  }
}

function getVaultPlacement(id) {
  const random = seededRandom(id * 9173);
  return {
    x: 18 + random() * 64,
    y: 18 + random() * 64,
    rotation: -18 + random() * 36,
  };
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;

  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function stopControlPointer(event) {
  event.stopPropagation();
}

function stopControlWheel(event) {
  event.preventDefault();
  event.stopPropagation();
}

function onWheel(event) {
  event.preventDefault();
  state.targetVelocityY = clamp(
    state.targetVelocityY + event.deltaY * WHEEL_ACCELERATION,
    -MAX_WHEEL_SPEED,
    MAX_WHEEL_SPEED,
  );
  state.targetVelocityX = clamp(
    state.targetVelocityX + event.deltaX * WHEEL_ACCELERATION * 0.75,
    -MAX_WHEEL_SPEED,
    MAX_WHEEL_SPEED,
  );
}

function onPointerDown(event) {
  if (state.recalled && isMobileRecall()) return;
  state.dragging = true;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  canvas.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
  if (state.vaultDrag) {
    moveVaultPigeon(event);
    return;
  }

  if (!state.dragging) return;

  const dx = event.clientX - state.lastX;
  const dy = event.clientY - state.lastY;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  state.rotationY += dx * 0.0025;
  state.rotationX += dy * 0.0025;
  state.velocityY = clamp(dx * 0.00012, -MAX_DRAG_SPEED, MAX_DRAG_SPEED);
  state.velocityX = clamp(dy * 0.00012, -MAX_DRAG_SPEED, MAX_DRAG_SPEED);
  state.targetVelocityY = state.velocityY;
  state.targetVelocityX = state.velocityX;
}

function onPointerUp() {
  if (state.vaultDrag) {
    finishVaultPigeonDrag();
    return;
  }

  state.dragging = false;
}

function moveVaultPigeon(event) {
  const drag = state.vaultDrag;
  const box = vaultBox?.getBoundingClientRect();
  if (!drag || !box) return;

  event.preventDefault();
  const halfWidth = drag.element.offsetWidth / 2;
  const halfHeight = drag.element.offsetHeight / 2;
  const x = clamp(event.clientX - box.left - drag.offsetX, halfWidth, box.width - halfWidth);
  const y = clamp(event.clientY - box.top - drag.offsetY, halfHeight, box.height - halfHeight);
  const currentLeft = Number.parseFloat(drag.element.style.left);
  const currentTop = Number.parseFloat(drag.element.style.top);
  const moved = !Number.isFinite(currentLeft) || Math.abs(x - currentLeft) > 2 || Math.abs(y - currentTop) > 2;

  if (moved) drag.moved = true;
  drag.element.style.left = `${x}px`;
  drag.element.style.top = `${y}px`;
  drag.element.style.transform = `translate(-50%, -50%) rotate(${drag.element.dataset.rotation || 0}deg)`;
}

function finishVaultPigeonDrag() {
  const drag = state.vaultDrag;
  if (!drag) return;

  drag.element.classList.remove("is-dragging");
  drag.element.dataset.dragMoved = drag.moved ? "true" : "false";
  state.vaultDrag = null;
}

function resize() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  state.width = Math.floor(window.innerWidth * pixelRatio);
  state.height = Math.floor(window.innerHeight * pixelRatio);
  canvas.width = state.width;
  canvas.height = state.height;
  gl.viewport(0, 0, state.width, state.height);
}

function render() {
  state.velocityX += (state.targetVelocityX - state.velocityX) * WHEEL_EASE;
  state.velocityY += (state.targetVelocityY - state.velocityY) * WHEEL_EASE;
  state.rotationX += state.velocityX;
  state.rotationY += state.velocityY;
  state.rotationX = wrapRotation(state.rotationX);
  state.rotationY = wrapRotation(state.rotationY);
  state.velocityX *= state.dragging ? DRAG_FRICTION : IDLE_FRICTION;
  state.velocityY *= state.dragging ? DRAG_FRICTION : IDLE_FRICTION;
  state.targetVelocityX *= state.dragging ? DRAG_FRICTION : IDLE_FRICTION;
  state.targetVelocityY *= state.dragging ? DRAG_FRICTION : IDLE_FRICTION;

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

  const stride = 8 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(locations.aPosition);
  gl.vertexAttribPointer(locations.aPosition, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(locations.aNormal);
  gl.vertexAttribPointer(locations.aNormal, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
  gl.enableVertexAttribArray(locations.aUv);
  gl.vertexAttribPointer(locations.aUv, 2, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);

  const projectionMatrix = perspective(state.width, state.height);
  const currentModelMatrix = modelMatrix(INSIDE_GLOBE_SCALE, state.rotationX, state.rotationY, CAMERA_OFFSET);
  gl.uniformMatrix4fv(locations.uProjection, false, projectionMatrix);
  gl.uniformMatrix4fv(locations.uModel, false, currentModelMatrix);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(locations.uTexture, 0);

  gl.drawElements(gl.TRIANGLES, sphere.indices.length, gl.UNSIGNED_SHORT, 0);
  updatePigeonPins(currentModelMatrix, projectionMatrix);
  requestAnimationFrame(render);
}

function createPigeonPins() {
  if (!pigeonLayer || !Array.isArray(window.PIGEON_PLACEMENTS)) return [];

  const normalizedPlacements = window.PIGEON_PLACEMENTS.map((placement, index) =>
    normalizePigeonPlacement(placement, index),
  );
  const relaxedPositions = getRelaxedPinPositions(normalizedPlacements);

  return normalizedPlacements.map((normalized) => {
    const jitter = getPinJitter(normalized.id);
    const relaxedPosition = relaxedPositions.get(normalized.id);
    const pinnedCol = relaxedPosition?.col ?? null;
    const pinnedRow = relaxedPosition?.row ?? null;
    const linkElement = document.createElement("a");
    const imageElement = document.createElement("img");
    const labelElement = document.createElement("span");
    const numberElement = document.createElement("span");
    const nameElement = document.createElement("span");
    linkElement.className = "pigeon-pin";
    linkElement.href = normalized.productLink;
    linkElement.target = "_blank";
    linkElement.rel = "noopener noreferrer";
    linkElement.setAttribute("aria-label", `Pigeon ${normalized.id} ${normalized.name || ""}`.trim());
    linkElement.addEventListener("pointerdown", stopControlPointer);
    imageElement.src = normalized.image;
    imageElement.alt = "";
    imageElement.loading = "eager";
    labelElement.className = "pigeon-pin__label";
    numberElement.className = "pigeon-pin__number";
    numberElement.textContent = String(normalized.id).padStart(2, "0");
    nameElement.className = "pigeon-pin__name";
    nameElement.textContent = normalized.name || "";
    labelElement.append(numberElement, nameElement);
    linkElement.appendChild(imageElement);
    linkElement.appendChild(labelElement);
    pigeonLayer.appendChild(linkElement);

    return {
      ...normalized,
      element: linkElement,
      point: Number.isFinite(normalized.col) && Number.isFinite(normalized.row)
        ? gridToCylinderPoint(pinnedCol, pinnedRow)
        : { x: 1, y: 0, z: 0 },
      mapRotation: jitter.rotation,
      screenX: null,
      screenY: null,
      mapX: null,
      mapY: null,
      releasing: false,
      releaseStartedAt: 0,
      velocityX: 0,
      velocityY: 0,
    };
  }).sort((a, b) => a.id - b.id);
}

function getRelaxedPinPositions(placements) {
  const activePositions = placements
    .filter((placement) =>
      placement.inventory > 0 &&
      Number.isFinite(placement.col) &&
      Number.isFinite(placement.row),
    )
    .map((placement) => {
      const jitter = getPinJitter(placement.id);
      return {
        id: placement.id,
        originCol: placement.col,
        originRow: placement.row,
        col: clamp(
          placement.col + jitter.col,
          Math.max(-0.45, placement.col - MAP_PIN_MAX_OFFSET_CELLS),
          Math.min(GRID_COLUMNS - 0.55, placement.col + MAP_PIN_MAX_OFFSET_CELLS),
        ),
        row: clamp(
          placement.row + jitter.row,
          Math.max(-0.45, placement.row - MAP_PIN_MAX_OFFSET_CELLS),
          Math.min(GRID_ROWS - 0.55, placement.row + MAP_PIN_MAX_OFFSET_CELLS),
        ),
      };
    })
    .sort((a, b) => a.id - b.id);

  for (let step = 0; step < MAP_PIN_RELAXATION_STEPS; step += 1) {
    for (let aIndex = 0; aIndex < activePositions.length; aIndex += 1) {
      const a = activePositions[aIndex];
      for (let bIndex = aIndex + 1; bIndex < activePositions.length; bIndex += 1) {
        const b = activePositions[bIndex];
        const deltaCol = b.col - a.col;
        const deltaRow = b.row - a.row;
        const distance = Math.hypot(deltaCol, deltaRow);

        if (distance >= MAP_PIN_MIN_SEPARATION_CELLS) continue;

        const fallbackAngle = seededRandom((a.id + 13) * (b.id + 29))() * Math.PI * 2;
        const normalCol = distance > 0.001 ? deltaCol / distance : Math.cos(fallbackAngle);
        const normalRow = distance > 0.001 ? deltaRow / distance : Math.sin(fallbackAngle);
        const push = (MAP_PIN_MIN_SEPARATION_CELLS - distance) * 0.5;

        a.col -= normalCol * push;
        a.row -= normalRow * push;
        b.col += normalCol * push;
        b.row += normalRow * push;
        clampPinToAssignedGrid(a);
        clampPinToAssignedGrid(b);
      }
    }
  }

  return new Map(activePositions.map((position) => [position.id, position]));
}

function clampPinToAssignedGrid(position) {
  position.col = clamp(
    position.col,
    Math.max(-0.45, position.originCol - MAP_PIN_MAX_OFFSET_CELLS),
    Math.min(GRID_COLUMNS - 0.55, position.originCol + MAP_PIN_MAX_OFFSET_CELLS),
  );
  position.row = clamp(
    position.row,
    Math.max(-0.45, position.originRow - MAP_PIN_MAX_OFFSET_CELLS),
    Math.min(GRID_ROWS - 0.55, position.originRow + MAP_PIN_MAX_OFFSET_CELLS),
  );
}

function getPinJitter(id) {
  const random = seededRandom(id * 5831);

  return {
    col: (random() - 0.5) * MAP_PIN_JITTER_CELLS,
    row: (random() - 0.5) * MAP_PIN_JITTER_CELLS,
    rotation: (random() - 0.5) * MAP_PIN_MAX_RANDOM_ROTATION * 2,
  };
}

function normalizePigeonPlacement(placement, index) {
  const id = Number(placement.id ?? index + 1);
  const inventoryOverride = window.PIGEON_INVENTORY?.[id] ?? window.PIGEON_INVENTORY?.[String(id)];
  const inventory = parseInventoryValue(inventoryOverride);
  const productLink =
    placement.productLink ||
    placement["product link"] ||
    placement["Product link"] ||
    placement["Product Link"] ||
    placement.product_link ||
    placement.link ||
    placement.url ||
    placement.image;

  return {
    ...placement,
    id,
    name: placement.name || placement.Name || "",
    image: placement.image,
    productLink,
    inventory: Number.isFinite(inventory) ? inventory : 1,
    col: Number(placement.col),
    row: Number(placement.row),
  };
}

function parseInventoryValue(value) {
  if (value === undefined || value === null || value === "") return 1;
  const inventory = Number(value);
  return Number.isFinite(inventory) ? inventory : 1;
}

function gridToCylinderPoint(column, row) {
  const u = (column + 0.5) / GRID_COLUMNS;
  const v = (row + 0.5) / GRID_ROWS;
  const theta = u * Math.PI * 2;

  return {
    x: Math.cos(theta),
    y: 1 - v * 2,
    z: Math.sin(theta),
  };
}

function updatePigeonPins(model, projection) {
  if (!pigeonPins.length) return;

  const viewportWidth = state.width / Math.min(window.devicePixelRatio || 1, 2);
  const viewportHeight = state.height / Math.min(window.devicePixelRatio || 1, 2);
  const time = Date.now() * 0.0025;

  const activePins = pigeonPins.filter((pin) => pin.inventory > 0);
  if (state.recalled) {
    syncRecallScrollArea(activePins.length, viewportWidth, viewportHeight);
  }

  for (const pin of pigeonPins) {
    if (pin.inventory <= 0) {
      pin.element.style.opacity = "0";
      pin.element.style.pointerEvents = "none";
      continue;
    }

    const mapTarget = getProjectedMapTarget(pin, model, projection, viewportWidth, viewportHeight);
    if (mapTarget.remember) {
      pin.mapX = mapTarget.x;
      pin.mapY = mapTarget.y;
    }

    let visible = false;
    let targetX = 0;
    let targetY = 0;

    if (state.recalled) {
      const recallIndex = activePins.indexOf(pin);
      const recallTarget = getRecallTarget(recallIndex, viewportWidth);
      targetX = recallTarget.x;
      targetY = recallTarget.y;
      visible = true;
    } else {
      visible = mapTarget.visible || pin.releasing;
      targetX = mapTarget.x;
      targetY = mapTarget.y;
    }

    if (!visible && !state.recalled && !pin.releasing) {
      pin.element.style.opacity = "0";
      pin.element.style.pointerEvents = "none";
      continue;
    }

    if (pin.screenX === null || pin.screenY === null) {
      pin.screenX = targetX;
      pin.screenY = targetY;
    }

    const dx = clamp(targetX - pin.screenX, -PIGEON_MAX_LAG, PIGEON_MAX_LAG);
    const dy = clamp(targetY - pin.screenY, -PIGEON_MAX_LAG, PIGEON_MAX_LAG);
    pin.velocityX = (pin.velocityX + dx * PIGEON_SPRING) * PIGEON_DAMPING;
    pin.velocityY = (pin.velocityY + dy * PIGEON_SPRING) * PIGEON_DAMPING;
    pin.screenX += pin.velocityX;
    pin.screenY += pin.velocityY;

    const distanceToTarget = Math.hypot(targetX - pin.screenX, targetY - pin.screenY);
    if (
      pin.releasing &&
      (distanceToTarget < PIGEON_RELEASE_DISTANCE ||
        performance.now() - pin.releaseStartedAt > PIGEON_RELEASE_TIMEOUT)
    ) {
      pin.releasing = false;
      visible = mapTarget.visible;
    }

    const tilt = clamp(pin.velocityX * 0.35 + Math.sin(time + pin.id) * 1.4, -PIGEON_MAX_TILT, PIGEON_MAX_TILT);
    const bob = Math.sin(time * 0.55 + pin.id * 1.7) * 1.2;

    pin.element.style.opacity = visible ? "1" : "0";
    pin.element.style.pointerEvents = visible ? "auto" : "none";
    pin.element.style.left = `${pin.screenX}px`;
    pin.element.style.top = `${pin.screenY + bob}px`;
    pin.element.classList.toggle("is-recalled", state.recalled);
    pin.element.style.width = state.recalled ? `${RECALL_PIN_SIZE}px` : "";
    pin.element.style.height = state.recalled ? `${RECALL_PIN_TOTAL_HEIGHT}px` : "";
    pin.element.style.transform = state.recalled
      ? "translate(-50%, -50%) rotate(0deg)"
      : `translate(-50%, -50%) rotate(${tilt + pin.mapRotation}deg)`;
  }
}

function getProjectedMapTarget(pin, model, projection, viewportWidth, viewportHeight) {
  const world = transformPoint(model, pin.point);
  const clip = transformPoint4(projection, { ...world, w: 1 });
  const fallback = getFlatGridScreenTarget(pin, viewportWidth, viewportHeight);

  if (Math.abs(clip.w) < 0.0001) {
    return {
      ...fallback,
      visible: false,
      remember: false,
    };
  }

  const ndcX = clip.x / clip.w;
  const ndcY = clip.y / clip.w;
  const targetX = ((ndcX + 1) / 2) * viewportWidth;
  const targetY = ((1 - ndcY) / 2) * viewportHeight;
  const margin = 160;

  return {
    x: clamp(targetX, -margin, viewportWidth + margin),
    y: clamp(targetY, -margin, viewportHeight + margin),
    visible: clip.w > 0 && ndcX >= -1.12 && ndcX <= 1.12 && ndcY >= -1.12 && ndcY <= 1.12,
    remember: clip.w > 0 && Number.isFinite(targetX) && Number.isFinite(targetY),
  };
}

function getFlatGridScreenTarget(pin, viewportWidth, viewportHeight) {
  return {
    x: ((pin.col + 0.5) / GRID_COLUMNS) * viewportWidth,
    y: ((pin.row + 0.5) / GRID_ROWS) * viewportHeight,
  };
}

function getRecallTarget(index, viewportWidth) {
  const { columns } = getRecallGridMetrics(viewportWidth);
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: RECALL_LEFT + RECALL_PIN_SIZE / 2 + column * (RECALL_PIN_SIZE + RECALL_PIN_GAP),
    y: RECALL_TOP + RECALL_PIN_TOTAL_HEIGHT / 2 + row * (RECALL_PIN_TOTAL_HEIGHT + RECALL_PIN_GAP),
  };
}

function getRecallGridMetrics(viewportWidth) {
  const availableWidth = Math.max(RECALL_PIN_SIZE, viewportWidth - RECALL_LEFT * 2);
  const columns = Math.max(1, Math.floor((availableWidth + RECALL_PIN_GAP) / (RECALL_PIN_SIZE + RECALL_PIN_GAP)));

  return {
    columns,
    availableWidth,
  };
}

function syncRecallScrollArea(activeCount, viewportWidth, viewportHeight) {
  if (!pigeonLayer) return;

  const { columns } = getRecallGridMetrics(viewportWidth);
  const rows = Math.ceil(activeCount / columns);
  const contentHeight = RECALL_TOP + rows * RECALL_PIN_TOTAL_HEIGHT + Math.max(0, rows - 1) * RECALL_PIN_GAP + 32;
  pigeonLayer.style.setProperty("--recall-scroll-height", `${Math.max(viewportHeight, contentHeight)}px`);
}

function isMobileRecall() {
  return window.innerWidth <= MOBILE_RECALL_BREAKPOINT;
}

function createCapsulePanorama(radius, columns) {
  const vertices = [];
  const indices = [];
  const cylinderHalfHeight = 1;
  const cylinderTop = cylinderHalfHeight + (cylinderHalfHeight * 2 * TOP_DOME_VERTICAL_SHIFT_ROWS) / GRID_ROWS;
  const cylinderBottom = -cylinderHalfHeight;
  const capHeight = ((1 - CAPSULE_STRAIGHT_RATIO) / CAPSULE_STRAIGHT_RATIO) * CAPSULE_CAP_HEIGHT_MULTIPLIER;
  const rings = [];

  for (let row = 0; row < CAPSULE_CAP_ROWS; row += 1) {
    const t = row / CAPSULE_CAP_ROWS;
    const angle = t * Math.PI * 0.5;
    rings.push({
      radius: Math.sin(angle),
      y: cylinderTop + Math.cos(angle) * capHeight,
      normalY: Math.cos(angle),
      v: MAP_UV_START * t,
    });
  }

  for (let row = 0; row <= GRID_ROWS; row += 1) {
    const v = row / GRID_ROWS;
    rings.push({
      radius: 1,
      y: cylinderTop - v * (cylinderTop - cylinderBottom),
      normalY: 0,
      v: MAP_UV_START + v * (MAP_UV_END - MAP_UV_START),
    });
  }

  for (let row = 1; row <= CAPSULE_CAP_ROWS; row += 1) {
    const t = row / CAPSULE_CAP_ROWS;
    const angle = t * Math.PI * 0.5;
    rings.push({
      radius: Math.cos(angle),
      y: cylinderBottom - Math.sin(angle) * capHeight,
      normalY: -Math.sin(angle),
      v: MAP_UV_END + (1 - MAP_UV_END) * t,
    });
  }

  for (const ring of rings) {
    const ringRadius = radius * ring.radius;

    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const theta = u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const x = ringRadius * cosTheta;
      const z = ringRadius * sinTheta;
      const normalScale = Math.max(ringRadius / radius, 0.001);
      const normalX = normalScale * cosTheta;
      const normalZ = normalScale * sinTheta;

      vertices.push(x, ring.y * radius, z, normalX, ring.normalY, normalZ, u, ring.v);
    }
  }

  for (let row = 0; row < rings.length - 1; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
  };
}

function createProgram(vertexSource, fragmentSource) {
  const compiledVertex = createShader(gl.VERTEX_SHADER, vertexSource);
  const compiledFragment = createShader(gl.FRAGMENT_SHADER, fragmentSource);
  const linkedProgram = gl.createProgram();
  gl.attachShader(linkedProgram, compiledVertex);
  gl.attachShader(linkedProgram, compiledFragment);
  gl.linkProgram(linkedProgram);

  if (!gl.getProgramParameter(linkedProgram, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(linkedProgram));
  }

  return linkedProgram;
}

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }

  return shader;
}

function prepareMapTexture(sourceImage) {
  const textureWidth = GRID_COLUMNS * GRID_CELL_SIZE;
  const textureHeight = TOTAL_TEXTURE_ROWS * GRID_CELL_SIZE;
  const topDomeBandHeight = TOP_DOME_TEXTURE_ROWS * GRID_CELL_SIZE;
  const bottomDomeBandHeight = BOTTOM_DOME_TEXTURE_ROWS * GRID_CELL_SIZE;
  const mapY = topDomeBandHeight;
  const mapHeight = GRID_ROWS * GRID_CELL_SIZE;
  const paddedX = 0;
  const paddedY = 0;
  const paddedWidth = sourceImage.naturalWidth;
  const paddedHeight = sourceImage.naturalHeight;
  const rotatedMap = createRotatedMap(sourceImage, paddedX, paddedY, paddedWidth, paddedHeight);

  const textureCanvas = document.createElement("canvas");
  const textureContext = textureCanvas.getContext("2d");
  textureCanvas.width = textureWidth;
  textureCanvas.height = textureHeight;
  textureContext.fillStyle = "#ffec00";
  textureContext.fillRect(0, 0, textureWidth, textureHeight);

  drawMapWithDomeExtension(
    textureContext,
    rotatedMap,
    textureWidth,
    mapY,
    mapHeight,
    topDomeBandHeight,
    bottomDomeBandHeight,
  );
  drawGrid(textureContext, textureWidth, textureHeight, 0, 0, TOTAL_TEXTURE_ROWS);

  return textureCanvas;
}

function drawMapWithDomeExtension(
  context,
  imageToDraw,
  width,
  mapY,
  mapHeight,
  topDomeBandHeight,
  bottomDomeBandHeight,
) {
  const sourceRect = getCoverSourceRect(imageToDraw, width, mapHeight, MAP_TEXTURE_ZOOM);
  const domeSourceHeight = sourceRect.height * (DOME_SAMPLE_ROWS / GRID_ROWS);

  if (topDomeBandHeight > 0) {
    drawMirroredVerticalStrip(
      context,
      imageToDraw,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      domeSourceHeight,
      0,
      0,
      width,
      topDomeBandHeight,
      "top",
    );
  }

  context.drawImage(
    imageToDraw,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    0,
    mapY,
    width,
    mapHeight,
  );

  if (bottomDomeBandHeight > 0) {
    drawMirroredVerticalStrip(
      context,
      imageToDraw,
      sourceRect.x,
      sourceRect.y + sourceRect.height - domeSourceHeight,
      sourceRect.width,
      domeSourceHeight,
      0,
      mapY + mapHeight,
      width,
      bottomDomeBandHeight,
      "bottom",
    );
  }
}

function drawMirroredVerticalStrip(
  context,
  imageToDraw,
  sourceX,
  sourceY,
  sourceWidth,
  sourceHeight,
  targetX,
  targetY,
  targetWidth,
  targetHeight,
  edge,
) {
  context.save();
  if (edge === "top") {
    context.translate(0, targetY + targetHeight);
    context.scale(1, -1);
    context.drawImage(
      imageToDraw,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      targetX,
      0,
      targetWidth,
      targetHeight,
    );
  } else {
    context.translate(0, targetY);
    context.scale(1, -1);
    context.drawImage(
      imageToDraw,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      targetX,
      -targetHeight,
      targetWidth,
      targetHeight,
    );
  }
  context.restore();
}

function createRotatedMap(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight) {
  const rotatedCanvas = document.createElement("canvas");
  const rotatedContext = rotatedCanvas.getContext("2d");
  rotatedCanvas.width = Math.round(sourceHeight);
  rotatedCanvas.height = Math.round(sourceWidth);
  rotatedContext.translate(0, rotatedCanvas.height);
  rotatedContext.rotate(-Math.PI / 2);
  rotatedContext.drawImage(
    sourceImage,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  return rotatedCanvas;
}

function drawImageCover(context, imageToDraw, x, y, width, height, zoom = 1) {
  const sourceRect = getCoverSourceRect(imageToDraw, width, height, zoom);
  context.drawImage(
    imageToDraw,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    x,
    y,
    width,
    height,
  );
}

function getCoverSourceRect(imageToDraw, width, height, zoom = 1) {
  const sourceAspect = imageToDraw.width / imageToDraw.height;
  const targetAspect = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = imageToDraw.width;
  let sourceHeight = imageToDraw.height;

  if (sourceAspect > targetAspect) {
    sourceWidth = sourceHeight * targetAspect;
    sourceX = (imageToDraw.width - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / targetAspect;
    sourceY = (imageToDraw.height - sourceHeight) / 2;
  }

  const zoomedWidth = sourceWidth / zoom;
  const zoomedHeight = sourceHeight / zoom;
  sourceX += (sourceWidth - zoomedWidth) / 2;
  sourceY += (sourceHeight - zoomedHeight) / 2;
  sourceWidth = zoomedWidth;
  sourceHeight = zoomedHeight;

  return {
    x: sourceX,
    y: sourceY,
    width: sourceWidth,
    height: sourceHeight,
  };
}

function drawGrid(context, width, height, offsetX = 0, offsetY = 0, rows = GRID_ROWS) {
  const cellWidth = width / GRID_COLUMNS;
  const cellHeight = height / rows;

  context.save();
  context.globalCompositeOperation = "hard-light";
  context.lineCap = "square";
  context.strokeStyle = "rgba(255, 255, 255, 0.78)";
  context.lineWidth = 2.5;

  for (let column = 0; column <= GRID_COLUMNS; column += 1) {
    const x = offsetX + Math.round(column * cellWidth) + 0.5;
    context.beginPath();
    context.moveTo(x, offsetY);
    context.lineTo(x, offsetY + height);
    context.stroke();
  }

  for (let row = 0; row <= rows; row += 1) {
    const y = offsetY + Math.round(row * cellHeight) + 0.5;
    context.beginPath();
    context.moveTo(offsetX, y);
    context.lineTo(offsetX + width, y);
    context.stroke();
  }

  context.strokeStyle = "rgba(255, 255, 255, 0.92)";
  context.lineWidth = 1.5;

  for (let column = 0; column <= GRID_COLUMNS; column += 5) {
    const x = offsetX + Math.round(column * cellWidth) + 0.5;
    context.beginPath();
    context.moveTo(x, offsetY);
    context.lineTo(x, offsetY + height);
    context.stroke();
  }

  for (let row = 0; row <= rows; row += 5) {
    const y = offsetY + Math.round(row * cellHeight) + 0.5;
    context.beginPath();
    context.moveTo(offsetX, y);
    context.lineTo(offsetX + width, y);
    context.stroke();
  }

  context.restore();
}

function perspective(width, height) {
  const aspect = width / height;
  const fieldOfView = Math.PI * 0.46;
  const near = 0.01;
  const far = 60;
  const f = 1 / Math.tan(fieldOfView / 2);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

function modelMatrix(scale, rotationX, rotationY, cameraOffset) {
  const cx = Math.cos(rotationX);
  const sx = Math.sin(rotationX);
  const cy = Math.cos(rotationY);
  const sy = Math.sin(rotationY);
  const scaleX = scale.x;
  const scaleY = scale.y;
  const scaleZ = scale.z;

  return new Float32Array([
    scaleX * cy, scaleX * sx * sy, scaleX * cx * sy, 0,
    0, scaleY * cx, -scaleY * sx, 0,
    -scaleZ * sy, scaleZ * sx * cy, scaleZ * cx * cy, 0,
    -cameraOffset.x, -cameraOffset.y, -cameraOffset.z, 1,
  ]);
}

function transformPoint(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
    y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
    z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
  };
}

function transformPoint4(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12] * point.w,
    y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13] * point.w,
    z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14] * point.w,
    w: matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15] * point.w,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapRotation(value) {
  const fullTurn = Math.PI * 2;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}
