'use strict';

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 500;
const PAPER = '#fffaf2';
const INK = '#17383a';
const BODY = '#8c4a2f';
const FEATHER_COLORS = ['#7c3f58', '#e7592d', '#d8a126', '#d86e35', '#15646a'];
const FINGER_PATHS = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20],
];

const SAMPLE_KEYPOINTS = [
    [320, 454], [282, 406], [236, 352], [176, 320], [116, 300],
    [276, 330], [256, 245], [246, 150], [242, 64],
    [322, 308], [322, 206], [322, 112], [322, 36],
    [370, 323], [390, 229], [410, 144], [424, 76],
    [414, 355], [458, 291], [500, 231], [532, 177],
];

let stream = null;
let activeVideo = null;
let detector = null;
let modelLoadPromise = null;
let rafID = null;
let isTracking = false;
let currentKeypoints = null;
let artboard = null;
let artboardContext = null;
let artHistory = [];
let drawing = false;
let brushColor = '#123f43';
let brushSize = 12;
let toastTimer = null;

function pointsFromPrediction(keypoints, videoWidth) {
    if (!Array.isArray(keypoints) || keypoints.length < 21) {
        throw new Error('Expected 21 hand landmarks.');
    }
    return keypoints.map((point) => {
        const x = Array.isArray(point) ? point[0] : point.x;
        const y = Array.isArray(point) ? point[1] : point.y;
        return [videoWidth - x, y];
    });
}

function calculateTransform(keypoints, width, height) {
    if (!Array.isArray(keypoints) || keypoints.length < 21) {
        throw new Error('Expected 21 hand landmarks.');
    }
    const xs = keypoints.map((point) => point[0]);
    const ys = keypoints.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((width * 0.62) / spanX, (height * 0.68) / spanY);
    return {
        scale,
        offsetX: (width - spanX * scale) / 2 - minX * scale,
        offsetY: (height - spanY * scale) / 2 - minY * scale - height * 0.01,
    };
}

function mapPoint(point, transform) {
    return [
        point[0] * transform.scale + transform.offsetX,
        point[1] * transform.scale + transform.offsetY,
    ];
}

function tracePath(context, points, indices) {
    const first = points[indices[0]];
    context.beginPath();
    context.moveTo(first[0], first[1]);
    indices.slice(1).forEach((index) => context.lineTo(points[index][0], points[index][1]));
}

function fillCircle(context, x, y, radius, color) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
}

function renderStylizedTurkey(context, keypoints, width, height) {
    const transform = calculateTransform(keypoints, width, height);
    const points = keypoints.map((point) => mapPoint(point, transform));
    const scale = transform.scale;
    const wrist = points[0];
    const palmCenter = [
        (points[0][0] + points[5][0] + points[9][0] + points[13][0] + points[17][0]) / 5,
        (points[0][1] + points[5][1] + points[9][1] + points[13][1] + points[17][1]) / 5,
    ];
    const palmWidth = Math.max(Math.abs(points[5][0] - points[17][0]) * 1.35, 82 * scale);
    const palmHeight = Math.max(Math.abs(wrist[1] - points[9][1]) * 1.3, 90 * scale);
    const featherWidth = Math.max(22 * scale, width * 0.032);

    context.save();
    context.clearRect(0, 0, width, height);
    context.fillStyle = PAPER;
    context.fillRect(0, 0, width, height);

    context.fillStyle = 'rgba(11,79,84,0.055)';
    for (let row = 0; row < 7; row += 1) {
        for (let column = 0; column < 10; column += 1) {
            fillCircle(context, 45 + column * 128 + (row % 2) * 42, 44 + row * 132, 4, 'rgba(11,79,84,0.055)');
        }
    }

    const featherPaths = [FINGER_PATHS[4], FINGER_PATHS[3], FINGER_PATHS[2], FINGER_PATHS[1]];
    featherPaths.forEach((path, index) => {
        tracePath(context, points, path);
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = FEATHER_COLORS[index];
        context.lineWidth = featherWidth;
        context.stroke();
        fillCircle(context, points[path[path.length - 1]][0], points[path[path.length - 1]][1], featherWidth * 0.52, FEATHER_COLORS[index]);
    });

    context.beginPath();
    context.ellipse(palmCenter[0], palmCenter[1] + palmHeight * 0.08, palmWidth * 0.55, palmHeight * 0.62, 0, 0, Math.PI * 2);
    context.fillStyle = BODY;
    context.fill();

    tracePath(context, points, [2, 3, 4]);
    context.strokeStyle = BODY;
    context.lineWidth = featherWidth * 0.72;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    const head = points[4];
    fillCircle(context, head[0], head[1], featherWidth * 0.58, BODY);

    const direction = head[0] < palmCenter[0] ? -1 : 1;
    context.beginPath();
    context.moveTo(head[0] + direction * featherWidth * 0.52, head[1] - featherWidth * 0.12);
    context.lineTo(head[0] + direction * featherWidth * 1.18, head[1] + featherWidth * 0.08);
    context.lineTo(head[0] + direction * featherWidth * 0.5, head[1] + featherWidth * 0.35);
    context.closePath();
    context.fillStyle = '#d8a126';
    context.fill();
    fillCircle(context, head[0] + direction * featherWidth * 0.13, head[1] - featherWidth * 0.15, featherWidth * 0.11, '#fffaf2');
    fillCircle(context, head[0] + direction * featherWidth * 0.15, head[1] - featherWidth * 0.15, featherWidth * 0.045, INK);
    fillCircle(context, head[0] + direction * featherWidth * 0.45, head[1] + featherWidth * 0.52, featherWidth * 0.18, '#c63f32');

    const footY = Math.min(height - 78, wrist[1] + featherWidth * 1.8);
    [-0.22, 0.22].forEach((offset) => {
        const x = palmCenter[0] + palmWidth * offset;
        context.strokeStyle = '#d8a126';
        context.lineWidth = Math.max(7, featherWidth * 0.11);
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(x, palmCenter[1] + palmHeight * 0.55);
        context.lineTo(x, footY);
        context.lineTo(x - featherWidth * 0.25, footY + featherWidth * 0.2);
        context.moveTo(x, footY);
        context.lineTo(x + featherWidth * 0.25, footY + featherWidth * 0.2);
        context.stroke();
    });

    context.fillStyle = '#0b4f54';
    context.font = `700 ${Math.max(17, width * 0.018)}px system-ui, sans-serif`;
    context.letterSpacing = '0.08em';
    context.fillText('GOBBLEVISION', 42, height - 44);
    context.font = `500 ${Math.max(12, width * 0.012)}px system-ui, sans-serif`;
    context.fillStyle = '#627374';
    context.textAlign = 'right';
    context.fillText('A tiny Thanksgiving experiment from the DRC', width - 42, height - 44);
    context.restore();
    return points;
}

function drawPreview(context, video, points, width, height) {
    context.save();
    context.clearRect(0, 0, width, height);
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, width, height);
    context.restore();
    if (!points) return;
    FINGER_PATHS.forEach((path, index) => {
        tracePath(context, points, path);
        context.strokeStyle = FEATHER_COLORS[index];
        context.lineWidth = 9;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.stroke();
    });
    points.forEach((point) => fillCircle(context, point[0], point[1], 4, '#fffaf2'));
}

async function ensureModelLoaded() {
    if (detector) return detector;
    if (!modelLoadPromise) {
        modelLoadPromise = (async () => {
            if (typeof tf === 'undefined' || typeof handPoseDetection === 'undefined') {
                throw new Error('The hand-pose model could not load. Check your connection and try again.');
            }
            await tf.setBackend('webgl');
            await tf.ready();
            detector = await handPoseDetection.createDetector(
                handPoseDetection.SupportedModels.MediaPipeHands,
                {runtime: 'tfjs', modelType: 'lite', maxHands: 1},
            );
            return detector;
        })();
    }
    return modelLoadPromise;
}

async function setupCamera() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('This browser cannot access a camera. Try the sample pose instead.');
    }
    const video = document.getElementById('video');
    stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {facingMode: 'user', width: {ideal: VIDEO_WIDTH}, height: {ideal: VIDEO_HEIGHT}},
    });
    video.srcObject = stream;
    await new Promise((resolve) => { video.onloadedmetadata = resolve; });
    await video.play();
    activeVideo = video;
    return video;
}

function setCameraMessage(message, hasHand) {
    if (typeof document === 'undefined') return;
    const status = document.getElementById('camera-status');
    const capture = document.getElementById('capture');
    if (status) status.textContent = message;
    if (capture) capture.disabled = !hasHand;
}

function cameraErrorMessage(error) {
    if (!error) return 'The camera could not start. Try the sample pose instead.';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        return 'Camera access was blocked. Allow access in your browser, or try the sample pose.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        return 'No camera was found. Try the sample pose instead.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        return 'Another app may be using the camera. Close it and try again.';
    }
    return error.message || 'The camera could not start. Try the sample pose instead.';
}

async function frameLoop() {
    if (!isTracking || !activeVideo) return;
    const canvas = document.getElementById('preview');
    const context = canvas.getContext('2d');
    try {
        const predictions = await detector.estimateHands(activeVideo, {flipHorizontal: false});
        if (predictions.length) {
            currentKeypoints = pointsFromPrediction(predictions[0].keypoints, canvas.width);
            setCameraMessage('Hand found. Hold still, or make it weird.', true);
        } else {
            currentKeypoints = null;
            setCameraMessage('Open your hand and keep it inside the frame.', false);
        }
        drawPreview(context, activeVideo, currentKeypoints, canvas.width, canvas.height);
    } catch (error) {
        setCameraMessage('The model lost the thread. Try repositioning your hand.', false);
        console.error('Hand detection failed', error);
    }
    if (isTracking) rafID = requestAnimationFrame(frameLoop);
}

async function startTracking() {
    if (isTracking) return;
    const loading = typeof document !== 'undefined' ? document.getElementById('camera-loading') : null;
    if (loading) loading.classList.remove('is-hidden');
    setCameraMessage('Preparing the camera…', false);
    try {
        await ensureModelLoaded();
        const video = await setupCamera();
        const canvas = document.getElementById('preview');
        canvas.width = video.videoWidth || VIDEO_WIDTH;
        canvas.height = video.videoHeight || VIDEO_HEIGHT;
        if (loading) loading.classList.add('is-hidden');
        isTracking = true;
        await frameLoop();
    } catch (error) {
        if (loading) loading.classList.add('is-hidden');
        setCameraMessage(cameraErrorMessage(error), false);
        stopTracking();
        throw error;
    }
}

function stopCameraStream() {
    if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => track.stop());
    }
    stream = null;
}

function stopTracking() {
    isTracking = false;
    if (rafID !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafID);
    rafID = null;
    if (activeVideo) {
        activeVideo.pause();
        activeVideo.srcObject = null;
    }
    activeVideo = null;
    currentKeypoints = null;
    stopCameraStream();
}

function stopTurkeyExperience() {
    stopTracking();
}

function updateStudioControls() {
    if (typeof document === 'undefined') return;
    const hasArt = artHistory.length > 0;
    document.getElementById('undo').disabled = artHistory.length < 2;
    document.getElementById('clear').disabled = !hasArt;
    document.getElementById('download').disabled = !hasArt;
    document.getElementById('artboard-empty').classList.toggle('is-hidden', hasArt);
}

function pushHistory() {
    if (!artboardContext || !artboard) return;
    artHistory.push(artboardContext.getImageData(0, 0, artboard.width, artboard.height));
    if (artHistory.length > 10) artHistory.splice(1, 1);
    updateStudioControls();
}

function placeTurkey(keypoints, source) {
    if (!artboardContext) return;
    renderStylizedTurkey(artboardContext, keypoints, artboard.width, artboard.height);
    artHistory = [];
    pushHistory();
    document.getElementById('studio-status').textContent = `${source} turkey captured. Add a note, doodle, or finishing touch.`;
    document.getElementById('studio').scrollIntoView({behavior: 'smooth', block: 'center'});
}

function captureTurkey() {
    if (!currentKeypoints) return false;
    placeTurkey(currentKeypoints, 'Camera');
    stopTracking();
    return true;
}

function showToast(message) {
    if (typeof document === 'undefined') return;
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function canvasPoint(event) {
    const bounds = artboard.getBoundingClientRect();
    return [
        (event.clientX - bounds.left) * (artboard.width / bounds.width),
        (event.clientY - bounds.top) * (artboard.height / bounds.height),
    ];
}

function beginDrawing(event) {
    if (!artHistory.length) return;
    drawing = true;
    artboard.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    artboardContext.beginPath();
    artboardContext.moveTo(point[0], point[1]);
}

function continueDrawing(event) {
    if (!drawing) return;
    const point = canvasPoint(event);
    artboardContext.lineTo(point[0], point[1]);
    artboardContext.strokeStyle = brushColor;
    artboardContext.lineWidth = brushSize;
    artboardContext.lineCap = 'round';
    artboardContext.lineJoin = 'round';
    artboardContext.stroke();
}

function finishDrawing() {
    if (!drawing) return;
    drawing = false;
    pushHistory();
}

function openCamera() {
    if (!window.TurkeyToolHelper) return;
    window.TurkeyToolHelper.restartTurkeyCapture().catch(() => undefined);
}

function initializeApp() {
    artboard = document.getElementById('artboard');
    if (!artboard) return;
    artboardContext = artboard.getContext('2d', {willReadFrequently: true});
    artboardContext.fillStyle = PAPER;
    artboardContext.fillRect(0, 0, artboard.width, artboard.height);

    document.getElementById('start-camera').addEventListener('click', openCamera);
    document.getElementById('new-turkey').addEventListener('click', openCamera);
    document.getElementById('sample-pose').addEventListener('click', () => placeTurkey(SAMPLE_KEYPOINTS, 'Sample'));
    document.getElementById('capture').addEventListener('click', () => {
        if (captureTurkey() && window.TurkeyToolHelper) window.TurkeyToolHelper.closeTurkeyCapture();
    });
    ['close-dialog', 'cancel-camera'].forEach((id) => document.getElementById(id).addEventListener('click', () => window.TurkeyToolHelper.closeTurkeyCapture()));
    document.getElementById('turkey-dialog').addEventListener('cancel', () => stopTracking());

    document.querySelectorAll('.swatch').forEach((swatch) => swatch.addEventListener('click', () => {
        document.querySelectorAll('.swatch').forEach((item) => {
            item.classList.remove('is-selected');
            item.setAttribute('aria-checked', 'false');
        });
        swatch.classList.add('is-selected');
        swatch.setAttribute('aria-checked', 'true');
        brushColor = swatch.dataset.color;
    }));

    const sizeInput = document.getElementById('brush-size');
    sizeInput.addEventListener('input', () => {
        brushSize = Number(sizeInput.value);
        document.getElementById('brush-size-output').value = brushSize;
    });

    document.getElementById('undo').addEventListener('click', () => {
        if (artHistory.length < 2) return;
        artHistory.pop();
        artboardContext.putImageData(artHistory[artHistory.length - 1], 0, 0);
        updateStudioControls();
    });
    document.getElementById('clear').addEventListener('click', () => {
        if (!artHistory.length) return;
        artboardContext.putImageData(artHistory[0], 0, 0);
        artHistory = [artHistory[0]];
        updateStudioControls();
        showToast('Back to the original turkey.');
    });
    document.getElementById('download').addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'gobblevision-turkey.png';
        link.href = artboard.toDataURL('image/png');
        link.click();
        showToast('Turkey downloaded. Happy Thanksgiving!');
    });

    artboard.addEventListener('pointerdown', beginDrawing);
    artboard.addEventListener('pointermove', continueDrawing);
    artboard.addEventListener('pointerup', finishDrawing);
    artboard.addEventListener('pointercancel', finishDrawing);
    updateStudioControls();
}

if (typeof window !== 'undefined') {
    window.GobbleVision = {startTracking, stopTracking, captureTurkey, renderStylizedTurkey};
    window.TurkeyHandpose = {stop: stopTurkeyExperience};
    window.startTracking = startTracking;
    window.stopTracking = stopTracking;
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeApp);
        else initializeApp();
    }
}

function __setStreamForTesting(newStream) { stream = newStream; }
function __setRafID(newRafID) { rafID = newRafID; }
function __setAnimationLoopStateForTesting({rafId, isLoopActive}) {
    if (typeof rafId === 'number' || rafId === null) rafID = rafId;
    if (typeof isLoopActive === 'boolean') isTracking = isLoopActive;
}
function __getAnimationLoopStateForTesting() { return {rafID, isAnimationLoopActive: isTracking}; }

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SAMPLE_KEYPOINTS,
        pointsFromPrediction,
        cameraErrorMessage,
        calculateTransform,
        renderStylizedTurkey,
        stopCameraStream,
        stopTurkeyExperience,
        __setStream: __setStreamForTesting,
        __setStreamForTesting,
        __setRafID,
        __setAnimationLoopStateForTesting,
        __getAnimationLoopStateForTesting,
    };
}
