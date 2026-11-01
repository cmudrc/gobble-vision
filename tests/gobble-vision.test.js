const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../handpose/main.js');

test('pointsFromPrediction mirrors model coordinates for the selfie view', () => {
    const modelPoints = Array.from({length: 21}, (_, index) => ({x: index * 2, y: index * 3}));
    const points = app.pointsFromPrediction(modelPoints, 100);
    assert.deepEqual(points[0], [100, 0]);
    assert.deepEqual(points[20], [60, 60]);
});

test('pointsFromPrediction accepts typed-array landmarks from browser model runtimes', () => {
    const modelPoints = Array.from({length: 21}, (_, index) => new Float32Array([index * 2, index * 3, 0]));
    const points = app.pointsFromPrediction(modelPoints, 100);
    assert.deepEqual(points[0], [100, 0]);
    assert.deepEqual(points[20], [60, 60]);
});

test('pointsFromPrediction rejects malformed landmarks instead of drawing a blank turkey', () => {
    const modelPoints = Array.from({length: 21}, () => ({}));
    assert.throws(() => app.pointsFromPrediction(modelPoints, 100), /invalid landmark/);
});

test('calculateTransform fits a hand inside the artboard', () => {
    const transform = app.calculateTransform(app.SAMPLE_KEYPOINTS, 1200, 900);
    assert.ok(transform.scale > 0);
    assert.ok(Number.isFinite(transform.offsetX));
    assert.ok(Number.isFinite(transform.offsetY));
});

test('camera errors are translated into useful next steps', () => {
    const error = new Error('Requested device not found');
    error.name = 'NotFoundError';
    assert.equal(app.cameraErrorMessage(error), 'No camera was found. Try the sample pose instead.');
});

test('renderStylizedTurkey paints a complete canvas without browser globals', () => {
    const calls = [];
    const context = new Proxy({}, {
        get(target, property) {
            if (!(property in target)) target[property] = (...args) => calls.push([property, ...args]);
            return target[property];
        },
        set(target, property, value) {
            target[property] = value;
            return true;
        },
    });
    app.renderStylizedTurkey(context, app.SAMPLE_KEYPOINTS, 1200, 900);
    assert.ok(calls.some(([name]) => name === 'ellipse'));
    assert.ok(calls.some(([name]) => name === 'fillText'));
});

test('stopping the experience cancels animation and camera tracks', () => {
    let cancelled = null;
    let stopped = 0;
    global.cancelAnimationFrame = (id) => { cancelled = id; };
    app.__setStreamForTesting({getTracks: () => [{stop: () => { stopped += 1; }}]});
    app.__setAnimationLoopStateForTesting({rafId: 42, isLoopActive: true});
    app.stopTurkeyExperience();
    assert.equal(cancelled, 42);
    assert.equal(stopped, 1);
    assert.deepEqual(app.__getAnimationLoopStateForTesting(), {rafID: null, isAnimationLoopActive: false});
});
