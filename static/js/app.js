const input = document.getElementById('image-input');
const dropZone = document.getElementById('drop-zone');
const sourceActions = document.getElementById('source-actions');
const previewWrap = document.getElementById('preview-wrap');
const preview = document.getElementById('preview');
const overlay = document.getElementById('box-overlay');
const cameraPanel = document.getElementById('camera-panel');
const cameraVideo = document.getElementById('camera-video');
const cameraStage = document.getElementById('camera-stage');
const cameraOverlay = document.getElementById('camera-overlay');
const liveStatus = document.getElementById('live-status');
const startLiveButton = document.getElementById('start-live');
const stopLiveButton = document.getElementById('stop-live');
const button = document.getElementById('detect-button');
const status = document.getElementById('status');
const results = document.getElementById('results');
const filter = document.getElementById('confidence-filter');
let selectedFile = null;
let previewUrl = null;
let predictions = [];
let cameraStream = null;
let realtimeActive = false;
let realtimePredictions = [];

function setFile(file) {
  if (!file) return;
  status.textContent = '';
  results.hidden = true;
  selectedFile = null;
  predictions = [];
  button.disabled = true;
  previewWrap.hidden = true;
  cameraPanel.hidden = true;
  dropZone.hidden = false;
  sourceActions.hidden = false;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const allowedExtensions = ['jpg', 'jpeg', 'png', 'webp'];
  const extension = file.name.split('.').pop().toLowerCase();
  if ((!allowedTypes.includes(file.type) && file.type !== '') || !allowedExtensions.includes(extension)) {
    status.textContent = 'Formato inválido. Selecciona JPG, JPEG, PNG o WEBP.';
    input.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    status.textContent = 'La imagen supera el límite de 10 MB.';
    input.value = '';
    return;
  }
  selectedFile = file;
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  document.getElementById('image-name').textContent = file.name;
  dropZone.hidden = true;
  sourceActions.hidden = true;
  previewWrap.hidden = false;
  button.disabled = false;
}

input.addEventListener('change', () => setFile(input.files[0]));

function clearImage() {
  selectedFile = null;
  predictions = [];
  stopCamera();
  input.value = '';
  preview.src = '';
  previewWrap.hidden = true;
  dropZone.hidden = false;
  sourceActions.hidden = false;
  button.disabled = true;
  results.hidden = true;
  status.textContent = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function stopCamera() {
  stopRealtime();
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraPanel.hidden = true;
  if (!selectedFile) {
    dropZone.hidden = false;
    sourceActions.hidden = false;
  }
}

function stopRealtime() {
  realtimeActive = false;
  startLiveButton.hidden = false;
  stopLiveButton.hidden = true;
  cameraOverlay.getContext('2d').clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);
  if (cameraVideo.videoWidth) liveStatus.textContent = 'Detección detenida.';
}

function drawLiveBoxes(items) {
  const videoBounds = cameraVideo.getBoundingClientRect();
  const stageBounds = cameraStage.getBoundingClientRect();
  const width = cameraStage.clientWidth;
  const height = cameraStage.clientHeight;
  if (!width || !height || !cameraVideo.videoWidth || !cameraVideo.videoHeight) return;
  const ratio = window.devicePixelRatio || 1;
  cameraOverlay.width = Math.round(width * ratio);
  cameraOverlay.height = Math.round(height * ratio);
  cameraOverlay.style.width = `${width}px`;
  cameraOverlay.style.height = `${height}px`;
  const context = cameraOverlay.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const offsetX = videoBounds.left - stageBounds.left;
  const offsetY = videoBounds.top - stageBounds.top;
  const scaleX = videoBounds.width / cameraVideo.videoWidth;
  const scaleY = videoBounds.height / cameraVideo.videoHeight;
  items.forEach((item) => {
    if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(item[key])))) return;
    const x = offsetX + (Number(item.x) - Number(item.width) / 2) * scaleX;
    const y = offsetY + (Number(item.y) - Number(item.height) / 2) * scaleY;
    const boxWidth = Number(item.width) * scaleX;
    const boxHeight = Number(item.height) * scaleY;
    context.strokeStyle = '#4667f5';
    context.lineWidth = 2;
    context.strokeRect(x, y, boxWidth, boxHeight);
    const label = `${item.class} ${Math.round(Number(item.confidence || 0) * 100)}%`;
    context.font = '600 12px sans-serif';
    const labelWidth = context.measureText(label).width + 12;
    context.fillStyle = '#3154d8';
    context.fillRect(x, Math.max(0, y - 22), labelWidth, 22);
    context.fillStyle = '#fff';
    context.fillText(label, x + 6, Math.max(15, y - 7));
  });
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function realtimeLoop() {
  while (realtimeActive && cameraStream) {
    const started = Date.now();
    try {
      if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
        liveStatus.textContent = 'Esperando imagen de la cámara…';
        await wait(250);
        continue;
      }
      const scale = Math.min(1, 640 / cameraVideo.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cameraVideo.videoWidth * scale);
      canvas.height = Math.round(cameraVideo.videoHeight * scale);
      canvas.getContext('2d').drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.68));
      if (!blob) throw new Error('No se pudo capturar un cuadro de la cámara.');
      const body = new FormData();
      body.append('image', blob, 'camera-frame.jpg');
      const response = await fetch('/api/detect-frame', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Roboflow no pudo analizar el cuadro.');
      realtimePredictions = data.predictions || [];
      drawLiveBoxes(realtimePredictions);
      const summary = realtimePredictions.slice(0, 4)
        .map((item) => `${item.class} ${Math.round(Number(item.confidence || 0) * 100)}%`);
      liveStatus.textContent = summary.length
        ? `En vivo · ${summary.join(' · ')}${realtimePredictions.length > 4 ? ` · +${realtimePredictions.length - 4}` : ''}`
        : 'En vivo · No se detectan objetos en este cuadro.';
    } catch (error) {
      stopRealtime();
      liveStatus.textContent = error.message || 'Error al analizar el cuadro de cámara.';
      break;
    }
    await wait(Math.max(0, 1500 - (Date.now() - started)));
  }
}

function startRealtime() {
  if (!cameraStream) return;
  realtimePredictions = [];
  realtimeActive = true;
  startLiveButton.hidden = true;
  stopLiveButton.hidden = false;
  liveStatus.textContent = 'Conectando con Roboflow…';
  realtimeLoop();
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'Este navegador no permite usar la cámara aquí. Abre ObjectVision en localhost o mediante HTTPS.';
    return;
  }
  status.textContent = '';
  dropZone.hidden = true;
  sourceActions.hidden = true;
  cameraPanel.hidden = false;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
  } catch (error) {
    stopCamera();
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      status.textContent = 'No se concedió acceso a la cámara. Permite el uso de cámara en el navegador e inténtalo de nuevo.';
    } else if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      status.textContent = 'No se encontró una cámara disponible en este dispositivo.';
    } else if (error.name === 'NotReadableError') {
      status.textContent = 'La cámara está ocupada por otra aplicación. Ciérrala e inténtalo de nuevo.';
    } else {
      status.textContent = 'No se pudo iniciar la cámara. Comprueba los permisos del navegador.';
    }
  }
}

function takePhoto() {
  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    status.textContent = 'Espera a que aparezca la imagen de la cámara.';
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;
  canvas.getContext('2d').drawImage(cameraVideo, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) {
      status.textContent = 'No se pudo capturar la foto. Inténtalo de nuevo.';
      return;
    }
    const photo = new File([blob], `objectvision-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    stopCamera();
    setFile(photo);
  }, 'image/jpeg', 0.92);
}

document.getElementById('open-camera').addEventListener('click', openCamera);
startLiveButton.addEventListener('click', startRealtime);
stopLiveButton.addEventListener('click', stopRealtime);
document.getElementById('take-photo').addEventListener('click', takePhoto);
document.getElementById('close-camera').addEventListener('click', stopCamera);

document.getElementById('remove-image').addEventListener('click', clearImage);
document.getElementById('change-image').addEventListener('click', () => input.click());
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  setFile(event.dataTransfer.files[0]);
});

function addText(parent, tag, value, className = '') {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function visiblePredictions() {
  const minConfidence = Number(filter.value) / 100;
  return [...predictions]
    .filter((item) => Number(item.confidence || 0) >= minConfidence)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function drawBoxes() {
  const stage = document.getElementById('image-stage');
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height || !preview.naturalWidth || !preview.naturalHeight) return;
  const ratio = window.devicePixelRatio || 1;
  overlay.width = Math.round(width * ratio);
  overlay.height = Math.round(height * ratio);
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  const context = overlay.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const imageBounds = preview.getBoundingClientRect();
  const stageBounds = stage.getBoundingClientRect();
  const offsetX = imageBounds.left - stageBounds.left;
  const offsetY = imageBounds.top - stageBounds.top;
  const scaleX = imageBounds.width / preview.naturalWidth;
  const scaleY = imageBounds.height / preview.naturalHeight;

  visiblePredictions().forEach((item) => {
    if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(item[key])))) return;
    const x = offsetX + (Number(item.x) - Number(item.width) / 2) * scaleX;
    const y = offsetY + (Number(item.y) - Number(item.height) / 2) * scaleY;
    const boxWidth = Number(item.width) * scaleX;
    const boxHeight = Number(item.height) * scaleY;
    context.strokeStyle = '#4667f5';
    context.lineWidth = 2;
    context.strokeRect(x, y, boxWidth, boxHeight);
    const label = `${item.class} ${Math.round(Number(item.confidence || 0) * 100)}%`;
    context.font = '600 12px sans-serif';
    const labelWidth = context.measureText(label).width + 12;
    context.fillStyle = '#3154d8';
    context.fillRect(x, Math.max(0, y - 22), labelWidth, 22);
    context.fillStyle = '#fff';
    context.fillText(label, x + 6, Math.max(15, y - 7));
  });
}

function renderPredictions() {
  const list = document.getElementById('prediction-list');
  list.replaceChildren();
  const filtered = visiblePredictions();
  document.getElementById('result-count').textContent = `${filtered.length} de ${predictions.length} objetos`;
  if (!filtered.length) addText(list, 'li', 'No hay detecciones sobre ese nivel de confianza.');

  filtered.forEach((item) => {
    const row = document.createElement('li');
    row.className = 'prediction-item';
    const details = document.createElement('div');
    details.className = 'prediction-details';
    addText(details, 'span', item.class, 'prediction-name');
    const confidence = Number(item.confidence);
    addText(details, 'span', `Confianza: ${Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : 'No disponible'}`, 'prediction-meta');
    const box = ['x', 'y', 'width', 'height'].filter((key) => Number.isFinite(Number(item[key])))
      .map((key) => `${key}: ${item[key]}`).join(' · ');
    if (box) addText(details, 'span', `Caja: ${box}`, 'prediction-meta');
    row.appendChild(details);
    const lookup = addText(row, 'button', 'Buscar info', 'lookup-button');
    lookup.type = 'button';
    lookup.addEventListener('click', () => lookupInfo(item.class));
    list.appendChild(row);
  });
  drawBoxes();
}

function renderInfo(external, objectName) {
  const info = document.getElementById('external-info');
  info.replaceChildren();
  document.getElementById('info-for').textContent = objectName ? `Búsqueda: ${objectName}` : '';
  if (!external || !external.success) {
    addText(info, 'p', external?.message || 'No hay información adicional disponible.');
    return;
  }
  const data = external.data || {};
  if (data.summary) addText(info, 'p', data.summary, 'wiki-summary');
  const items = Array.isArray(data.results) ? data.results : [];
  if (items.length) {
    const links = document.createElement('ul');
    links.className = 'wiki-results';
    items.forEach((item) => {
      if (!item.title || !item.url) return;
      const li = document.createElement('li');
      const link = addText(li, 'a', item.title);
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      links.appendChild(li);
    });
    info.appendChild(links);
  } else if (!data.summary) {
    addText(info, 'p', 'No se encontraron artículos relacionados.');
  }
}

async function lookupInfo(objectName) {
  document.getElementById('info-for').textContent = `Buscando: ${objectName}…`;
  const info = document.getElementById('external-info');
  info.replaceChildren();
  try {
    const response = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class: objectName }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo buscar información.');
    renderInfo(data.external_info, objectName);
  } catch (error) {
    renderInfo({ success: false, message: error.message || 'No se pudo consultar Wikipedia.' }, objectName);
  }
}

filter.addEventListener('input', () => {
  document.getElementById('confidence-label').textContent = `${filter.value}%`;
  renderPredictions();
});
preview.addEventListener('load', drawBoxes);
window.addEventListener('resize', drawBoxes);

button.addEventListener('click', async () => {
  if (!selectedFile) return;
  button.disabled = true;
  document.getElementById('spinner').hidden = false;
  document.getElementById('button-label').textContent = 'Analizando imagen…';
  status.textContent = '';
  results.hidden = true;
  try {
    const body = new FormData();
    body.append('image', selectedFile);
    const response = await fetch('/api/detect', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo analizar la imagen.');
    predictions = data.predictions || [];
    renderPredictions();
    results.hidden = false;
    renderInfo(data.external_info, data.top_prediction?.class || '');
  } catch (error) {
    status.textContent = error.message || 'Ocurrió un error. Inténtalo de nuevo.';
  } finally {
    document.getElementById('spinner').hidden = true;
    document.getElementById('button-label').textContent = 'Detectar objetos';
    button.disabled = !selectedFile;
  }
});
