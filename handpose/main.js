'use strict';

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 500;
const PAPER = '#fffaf2';
const INK = '#17383a';
const BODY = '#8c4a2f';
const FEATHER_COLORS = ['#7c3f58', '#e7592d', '#d8a126', '#d86e35', '#15646a'];
const THUMB_PATH = [2, 3, 4];
const FINGER_PATHS = [
    THUMB_PATH,
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20],
];
const TAIL_PATHS = [
    [17, 18, 19, 20],
    [13, 14, 15, 16],
    [9, 10, 11, 12],
    [5, 6, 7, 8],
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
let isStarting = false;
let startupRequestId = 0;
let detectionErrorCount = 0;
let currentKeypoints = null;
let placedKeypoints = null;
let placedSource = null;
let artboard = null;
let artboardContext = null;
let artHistory = [];
let drawing = false;
let brushColor = '#123f43';
let brushSize = 12;
let palmRadiusScale = 1;
let featherRadiusScale = 1;
let toastTimer = null;

function pointsFromPrediction(keypoints, videoWidth) {
    if (!Array.isArray(keypoints) || keypoints.length < 21) {
        throw new Error('Expected 21 hand landmarks.');
    }
    return keypoints.map((point) => {
        const x = Number(point && point.x !== undefined ? point.x : point && point[0]);
        const y = Number(point && point.y !== undefined ? point.y : point && point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error('The hand model returned an invalid landmark.');
        }
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
        offsetY: (height - spanY * scale) / 2 - minY * scale - height * 0.04,
    };
}

function mapPoint(point, transform) {
    return [
        point[0] * transform.scale + transform.offsetX,
        point[1] * transform.scale + transform.offsetY,
    ];
}

function distanceBetween(first, second) {
    return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

function averagePoints(points) {
    return points.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0])
        .map((value) => value / points.length);
}

function interpolatePoint(first, second, amount) {
    return [
        first[0] + (second[0] - first[0]) * amount,
        first[1] + (second[1] - first[1]) * amount,
    ];
}

function addVector(point, vector, amount) {
    return [point[0] + vector[0] * amount, point[1] + vector[1] * amount];
}

function normalizeVector(vector, fallback = [0, -1]) {
    const length = Math.hypot(vector[0], vector[1]);
    if (length < 0.0001) return [...fallback];
    return [vector[0] / length, vector[1] / length];
}

function traceSmoothPoints(context, pathPoints) {
    context.beginPath();
    context.moveTo(pathPoints[0][0], pathPoints[0][1]);
    for (let index = 1; index < pathPoints.length - 1; index += 1) {
        const midpoint = interpolatePoint(pathPoints[index], pathPoints[index + 1], 0.5);
        context.quadraticCurveTo(pathPoints[index][0], pathPoints[index][1], midpoint[0], midpoint[1]);
    }
    const last = pathPoints[pathPoints.length - 1];
    context.lineTo(last[0], last[1]);
}

function strokeRoundedPoints(context, pathPoints, color, width) {
    traceSmoothPoints(context, pathPoints);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(23,56,58,.34)';
    context.lineWidth = width + Math.max(5, width * 0.14);
    context.stroke();
    traceSmoothPoints(context, pathPoints);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
}

function strokeRoundedPath(context, points, indices, color, width) {
    strokeRoundedPoints(context, indices.map((index) => points[index]), color, width);
}

function calculatePalmGeometry(points, fingerWidth) {
    const wrist = points[0];
    const thumbBaseControl = points[1];
    const thumbJoint = points[THUMB_PATH[0]];
    const indexKnuckle = points[5];
    const middleKnuckle = points[9];
    const ringKnuckle = points[13];
    const pinkyKnuckle = points[17];
    const knuckleCenter = averagePoints([indexKnuckle, middleKnuckle, ringKnuckle, pinkyKnuckle]);
    const forward = normalizeVector([knuckleCenter[0] - wrist[0], knuckleCenter[1] - wrist[1]]);
    const rawAcross = [indexKnuckle[0] - pinkyKnuckle[0], indexKnuckle[1] - pinkyKnuckle[1]];
    const projection = rawAcross[0] * forward[0] + rawAcross[1] * forward[1];
    const perpendicularAcross = [
        rawAcross[0] - forward[0] * projection,
        rawAcross[1] - forward[1] * projection,
    ];
    const across = normalizeVector(perpendicularAcross, [-forward[1], forward[0]]);
    const palmWidth = Math.max(distanceBetween(indexKnuckle, pinkyKnuckle), fingerWidth * 3.5);
    const palmLength = Math.max(distanceBetween(wrist, knuckleCenter), fingerWidth * 2.7);
    const sidePadding = fingerWidth * 0.38;
    const wristHalfWidth = palmWidth * 0.3;
    const indexOuter = addVector(indexKnuckle, across, sidePadding);
    const pinkyOuter = addVector(pinkyKnuckle, across, -sidePadding);
    const thumbWebControl = interpolatePoint(thumbJoint, indexOuter, 0.56);
    const pinkySide = addVector(interpolatePoint(pinkyKnuckle, wrist, 0.55), across, -sidePadding * 0.8);
    const wristIndex = addVector(addVector(wrist, across, wristHalfWidth), forward, -fingerWidth * 0.18);
    const wristPinky = addVector(addVector(wrist, across, -wristHalfWidth), forward, -fingerWidth * 0.18);
    const cuffCenter = addVector(wrist, forward, -fingerWidth * 0.42);
    const palmCenter = interpolatePoint(wrist, knuckleCenter, 0.52);
    return {
        wrist,
        thumbBaseControl,
        thumbJoint,
        thumbWebControl,
        indexKnuckle,
        middleKnuckle,
        ringKnuckle,
        pinkyKnuckle,
        knuckleCenter,
        forward,
        across,
        palmWidth,
        palmLength,
        palmCenter,
        indexOuter,
        pinkyOuter,
        pinkySide,
        wristIndex,
        wristPinky,
        cuffCenter,
    };
}

function tracePalm(context, palm) {
    context.beginPath();
    context.moveTo(palm.indexOuter[0], palm.indexOuter[1]);
    context.quadraticCurveTo(
        palm.indexKnuckle[0], palm.indexKnuckle[1],
        palm.middleKnuckle[0], palm.middleKnuckle[1],
    );
    context.quadraticCurveTo(
        palm.ringKnuckle[0], palm.ringKnuckle[1],
        palm.pinkyOuter[0], palm.pinkyOuter[1],
    );
    context.bezierCurveTo(
        palm.pinkySide[0], palm.pinkySide[1],
        palm.wristPinky[0], palm.wristPinky[1],
        palm.wristPinky[0], palm.wristPinky[1],
    );
    context.quadraticCurveTo(
        palm.cuffCenter[0], palm.cuffCenter[1],
        palm.wristIndex[0], palm.wristIndex[1],
    );
    context.quadraticCurveTo(
        palm.thumbBaseControl[0], palm.thumbBaseControl[1],
        palm.thumbJoint[0], palm.thumbJoint[1],
    );
    context.quadraticCurveTo(
        palm.thumbWebControl[0], palm.thumbWebControl[1],
        palm.indexOuter[0], palm.indexOuter[1],
    );
    context.closePath();
}

function fillRoundedPalm(context, palm, radius) {
    const outlinePadding = Math.max(5, radius * 0.28);
    tracePalm(context, palm);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(23,56,58,.34)';
    context.lineWidth = radius * 2 + outlinePadding;
    context.stroke();
    tracePalm(context, palm);
    context.strokeStyle = BODY;
    context.lineWidth = radius * 2;
    context.stroke();
    tracePalm(context, palm);
    context.fillStyle = BODY;
    context.fill();
}

function calculateLegGeometry(palm, fingerWidth) {
    const down = [-palm.forward[0], -palm.forward[1]];
    const legLength = fingerWidth * 1.22;
    const toeLength = fingerWidth * 0.5;
    return [-1, 1].map((side) => {
        const start = addVector(
            addVector(palm.wrist, palm.across, side * palm.palmWidth * 0.16),
            down,
            fingerWidth * 0.18,
        );
        const ankle = addVector(start, down, legLength);
        const knee = addVector(
            interpolatePoint(start, ankle, 0.52),
            palm.across,
            side * fingerWidth * 0.07,
        );
        const toes = [-1, 0, 1].map((spread) => {
            const direction = normalizeVector([
                down[0] * 0.55 + palm.across[0] * spread,
                down[1] * 0.55 + palm.across[1] * spread,
            ]);
            return addVector(ankle, direction, toeLength);
        });
        return {start, knee, ankle, toes};
    });
}

function traceTurkeyLeg(context, leg) {
    context.beginPath();
    context.moveTo(leg.start[0], leg.start[1]);
    context.quadraticCurveTo(leg.knee[0], leg.knee[1], leg.ankle[0], leg.ankle[1]);
    leg.toes.forEach((toe) => {
        context.moveTo(leg.ankle[0], leg.ankle[1]);
        context.lineTo(toe[0], toe[1]);
    });
}

function drawTurkeyLegs(context, palm, fingerWidth) {
    const legWidth = Math.max(7, fingerWidth * 0.15);
    const legs = calculateLegGeometry(palm, fingerWidth);
    legs.forEach((leg) => {
        traceTurkeyLeg(context, leg);
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = 'rgba(23,56,58,.34)';
        context.lineWidth = legWidth + Math.max(3, legWidth * 0.45);
        context.stroke();
        traceTurkeyLeg(context, leg);
        context.strokeStyle = '#d8a126';
        context.lineWidth = legWidth;
        context.stroke();
    });
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

function calculateShapeWidths(baseFingerWidth, options = {}) {
    const clampScale = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(1.5, Math.max(0.5, number)) : 1;
    };
    return {
        featherWidth: baseFingerWidth * clampScale(options.featherRadius),
        palmRadius: baseFingerWidth * 0.5 * clampScale(options.palmRadius),
    };
}

function renderStylizedTurkey(context, keypoints, width, height, shapeOptions = {}) {
    const transform = calculateTransform(keypoints, width, height);
    const points = keypoints.map((point) => mapPoint(point, transform));
    const measuredPalmWidth = distanceBetween(points[5], points[17]);
    const fingerWidth = Math.min(
        Math.max(measuredPalmWidth * 0.22, width * 0.026),
        width * 0.058,
    );
    const shapeWidths = calculateShapeWidths(fingerWidth, shapeOptions);
    const palm = calculatePalmGeometry(points, fingerWidth);

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

    TAIL_PATHS.forEach((path, index) => {
        strokeRoundedPath(context, points, path, FEATHER_COLORS[index], shapeWidths.featherWidth);
    });

    drawTurkeyLegs(context, palm, fingerWidth);
    strokeRoundedPath(context, points, THUMB_PATH, BODY, fingerWidth * 0.84);

    fillRoundedPalm(context, palm, shapeWidths.palmRadius);

    const head = points[4];
    const headRadius = fingerWidth * 0.56;
    fillCircle(context, head[0], head[1], headRadius, BODY);

    const thumbDirection = normalizeVector(
        [head[0] - points[3][0], head[1] - points[3][1]],
        normalizeVector([head[0] - palm.palmCenter[0], head[1] - palm.palmCenter[1]], [-1, 0]),
    );
    let faceNormal = [-thumbDirection[1], thumbDirection[0]];
    if (faceNormal[1] > 0) faceNormal = [-faceNormal[0], -faceNormal[1]];
    const beakBase = addVector(head, thumbDirection, headRadius * 0.5);
    const beakTip = addVector(head, thumbDirection, headRadius * 1.55);
    const beakTop = addVector(beakBase, faceNormal, headRadius * 0.38);
    const beakBottom = addVector(beakBase, faceNormal, -headRadius * 0.38);
    context.beginPath();
    context.moveTo(beakTop[0], beakTop[1]);
    context.lineTo(beakTip[0], beakTip[1]);
    context.lineTo(beakBottom[0], beakBottom[1]);
    context.closePath();
    context.fillStyle = '#d8a126';
    context.fill();
    const eye = addVector(addVector(head, thumbDirection, headRadius * 0.18), faceNormal, headRadius * 0.28);
    fillCircle(context, eye[0], eye[1], headRadius * 0.2, '#fffaf2');
    fillCircle(context, eye[0] + thumbDirection[0] * headRadius * 0.04, eye[1] + thumbDirection[1] * headRadius * 0.04, headRadius * 0.08, INK);
    const wattle = addVector(addVector(head, thumbDirection, headRadius * 0.34), faceNormal, -headRadius * 0.62);
    fillCircle(context, wattle[0], wattle[1], headRadius * 0.25, '#c63f32');

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
            if (typeof tf === 'undefined' || typeof Hands === 'undefined' || typeof handPoseDetection === 'undefined') {
                throw new Error('The hand-pose model could not load. Check your connection and try again.');
            }
            detector = await handPoseDetection.createDetector(
                handPoseDetection.SupportedModels.MediaPipeHands,
                {
                    runtime: 'mediapipe',
                    solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240',
                    modelType: 'full',
                    maxHands: 1,
                },
            );
            return detector;
        })();
    }
    try {
        return await modelLoadPromise;
    } catch (error) {
        modelLoadPromise = null;
        detector = null;
        throw error;
    }
}

function makeStartupCancelledError() {
    const error = new Error('Camera startup was cancelled.');
    error.name = 'AbortError';
    return error;
}

function assertCurrentStartup(requestId) {
    if (requestId !== startupRequestId) throw makeStartupCancelledError();
}

function stopMediaStream(mediaStream) {
    if (mediaStream && typeof mediaStream.getTracks === 'function') {
        mediaStream.getTracks().forEach((track) => track.stop());
    }
}

async function setupCamera(requestId) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('This browser cannot access a camera. Try the sample pose instead.');
    }
    const video = document.getElementById('video');
    const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {facingMode: 'user', width: {ideal: VIDEO_WIDTH}, height: {ideal: VIDEO_HEIGHT}},
    });
    if (requestId !== startupRequestId) {
        stopMediaStream(cameraStream);
        throw makeStartupCancelledError();
    }
    stream = cameraStream;
    video.srcObject = cameraStream;
    if (video.readyState < 1) {
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve;
            video.onerror = () => reject(new Error('The camera feed could not be read.'));
        });
    }
    assertCurrentStartup(requestId);
    await video.play();
    assertCurrentStartup(requestId);
    activeVideo = video;
    return video;
}

function setCameraOverlay({title, detail, state = 'loading', hasPreview = false}) {
    if (typeof document === 'undefined') return;
    const loading = document.getElementById('camera-loading');
    const titleElement = document.getElementById('camera-loading-title');
    const detailElement = document.getElementById('camera-loading-detail');
    if (!loading) return;
    loading.classList.remove('is-hidden', 'is-error', 'has-preview');
    loading.classList.toggle('is-error', state === 'error');
    loading.classList.toggle('has-preview', hasPreview);
    if (titleElement) titleElement.textContent = title;
    if (detailElement) detailElement.textContent = detail;
}

function hideCameraOverlay() {
    if (typeof document === 'undefined') return;
    const loading = document.getElementById('camera-loading');
    if (loading) loading.classList.add('is-hidden');
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
        if (!isTracking || !activeVideo) return;
        if (predictions.length) {
            currentKeypoints = pointsFromPrediction(predictions[0].keypoints, canvas.width);
            setCameraMessage('Hand found. Hold still, or make it weird.', true);
        } else {
            currentKeypoints = null;
            setCameraMessage('Open your hand and keep it inside the frame.', false);
        }
        drawPreview(context, activeVideo, currentKeypoints, canvas.width, canvas.height);
        detectionErrorCount = 0;
    } catch (error) {
        if (!isTracking) return;
        detectionErrorCount += 1;
        setCameraMessage('The model lost the thread. Try repositioning your hand.', false);
        console.warn('Hand detection failed', error);
        if (detectionErrorCount >= 5) {
            setCameraOverlay({
                title: 'Hand tracking paused',
                detail: 'Close the camera and try again, or continue with the sample pose.',
                state: 'error',
                hasPreview: true,
            });
            setCameraMessage('Hand tracking stopped after repeated errors.', false);
            stopTracking();
            return;
        }
    }
    if (isTracking) rafID = requestAnimationFrame(frameLoop);
}

async function startTracking() {
    if (isTracking || isStarting) return true;
    const requestId = ++startupRequestId;
    isStarting = true;
    detectionErrorCount = 0;
    setCameraOverlay({
        title: 'Waiting for your camera…',
        detail: 'Your browser may ask for permission.',
    });
    setCameraMessage('Allow camera access to begin.', false);
    try {
        const video = await setupCamera(requestId);
        assertCurrentStartup(requestId);
        const canvas = document.getElementById('preview');
        canvas.width = video.videoWidth || VIDEO_WIDTH;
        canvas.height = video.videoHeight || VIDEO_HEIGHT;
        drawPreview(canvas.getContext('2d'), video, null, canvas.width, canvas.height);
        setCameraOverlay({
            title: 'Camera connected. Finding the flock…',
            detail: 'Loading hand tracking. The first visit can take a few seconds.',
            hasPreview: true,
        });
        setCameraMessage('Camera ready. Warming up hand tracking…', false);
        await ensureModelLoaded();
        assertCurrentStartup(requestId);
        hideCameraOverlay();
        isTracking = true;
        isStarting = false;
        await frameLoop();
        return true;
    } catch (error) {
        if (error && error.name === 'AbortError') return false;
        if (requestId !== startupRequestId) return false;
        const message = cameraErrorMessage(error);
        setCameraOverlay({
            title: 'Camera setup hit a snag',
            detail: message,
            state: 'error',
            hasPreview: Boolean(activeVideo),
        });
        setCameraMessage(message, false);
        stopTracking();
        return false;
    } finally {
        if (requestId === startupRequestId) isStarting = false;
    }
}

function stopCameraStream() {
    stopMediaStream(stream);
    stream = null;
}

function stopTracking() {
    startupRequestId += 1;
    isStarting = false;
    isTracking = false;
    if (typeof document !== 'undefined') {
        const capture = document.getElementById('capture');
        if (capture) capture.disabled = true;
    }
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
    placedKeypoints = keypoints.map((point) => [...point]);
    placedSource = source;
    renderStylizedTurkey(artboardContext, placedKeypoints, artboard.width, artboard.height, {
        palmRadius: palmRadiusScale,
        featherRadius: featherRadiusScale,
    });
    artHistory = [];
    pushHistory();
    document.getElementById('studio-status').textContent = `${source} turkey captured. Add a note, doodle, or finishing touch.`;
}

function reshapePlacedTurkey() {
    if (!artboardContext || !placedKeypoints) return false;
    renderStylizedTurkey(artboardContext, placedKeypoints, artboard.width, artboard.height, {
        palmRadius: palmRadiusScale,
        featherRadius: featherRadiusScale,
    });
    artHistory = [];
    pushHistory();
    document.getElementById('studio-status').textContent = `${placedSource} turkey reshaped. Add a note, doodle, or finishing touch.`;
    return true;
}

function placeSampleTurkey() {
    placeTurkey(SAMPLE_KEYPOINTS, 'Sample');
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
    window.TurkeyToolHelper.restartTurkeyCapture().catch((error) => {
        if (!error || error.name !== 'AbortError') console.warn('Camera startup failed', error);
    });
}

function initializeApp() {
    artboard = document.getElementById('artboard');
    if (!artboard) return;
    artboardContext = artboard.getContext('2d', {willReadFrequently: true});
    artboardContext.fillStyle = PAPER;
    artboardContext.fillRect(0, 0, artboard.width, artboard.height);

    document.getElementById('start-camera').addEventListener('click', openCamera);
    document.getElementById('new-turkey').addEventListener('click', openCamera);
    document.getElementById('sample-pose').addEventListener('click', placeSampleTurkey);
    document.getElementById('use-sample-camera').addEventListener('click', () => {
        if (window.TurkeyToolHelper) window.TurkeyToolHelper.closeTurkeyCapture();
        placeSampleTurkey();
    });
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

    const bindShapeSlider = (id, outputId, setScale) => {
        const input = document.getElementById(id);
        input.addEventListener('input', () => {
            setScale(Number(input.value) / 100);
            document.getElementById(outputId).value = `${input.value}%`;
            reshapePlacedTurkey();
        });
        input.addEventListener('change', () => {
            if (placedKeypoints) showToast('Turkey shape updated. Fresh canvas, ready to decorate.');
        });
    };
    bindShapeSlider('palm-radius', 'palm-radius-output', (value) => { palmRadiusScale = value; });
    bindShapeSlider('feather-radius', 'feather-radius-output', (value) => { featherRadiusScale = value; });

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
        THUMB_PATH,
        calculateShapeWidths,
        calculatePalmGeometry,
        fillRoundedPalm,
        calculateLegGeometry,
        drawTurkeyLegs,
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
