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

test('flock layout supports one to four hands without overlapping cells', () => {
    assert.equal(app.MAX_HANDS, 4);
    const two = app.calculateFlockRegions(2, 1200, 900);
    assert.equal(two.length, 2);
    assert.ok(two[0].x + two[0].width < two[1].x);

    const three = app.calculateFlockRegions(3, 1200, 900);
    assert.equal(three.length, 3);
    assert.equal(three[2].x, (1200 - three[2].width) / 2);

    const four = app.calculateFlockRegions(4, 1200, 900);
    assert.equal(four.length, 4);
    assert.ok(four[0].y + four[0].height < four[2].y);
});

test('thumb guide and turkey neck begin at the outward thumb knuckle', () => {
    assert.deepEqual(app.THUMB_PATH, [2, 3, 4]);
});

test('the same outward thumb knuckle defines the thumb-side palm boundary', () => {
    const palm = app.calculatePalmGeometry(app.SAMPLE_KEYPOINTS, 40);
    assert.deepEqual(palm.thumbJoint, app.SAMPLE_KEYPOINTS[app.THUMB_PATH[0]]);
    assert.deepEqual(palm.thumbBaseControl, app.SAMPLE_KEYPOINTS[1]);
});

test('rounded palm uses a full diameter stroke around the palm contour', () => {
    const calls = [];
    const context = new Proxy({}, {
        get(target, property) {
            if (!(property in target)) target[property] = (...args) => calls.push([property, ...args]);
            return target[property];
        },
        set(target, property, value) {
            calls.push([`set:${String(property)}`, value]);
            target[property] = value;
            return true;
        },
    });
    const palm = app.calculatePalmGeometry(app.SAMPLE_KEYPOINTS, 40);
    app.fillRoundedPalm(context, palm, 20);
    assert.ok(calls.some(([name, value]) => name === 'set:lineJoin' && value === 'round'));
    assert.ok(calls.some(([name, value]) => name === 'set:lineWidth' && value === 40));
    assert.ok(calls.some(([name]) => name === 'fill'));
});

test('turkey feet follow the palm direction and have three toes each', () => {
    const palm = app.calculatePalmGeometry(app.SAMPLE_KEYPOINTS, 40);
    const legs = app.calculateLegGeometry(palm, 40);
    assert.equal(legs.length, 2);
    legs.forEach((leg) => {
        assert.equal(leg.toes.length, 3);
        const awayFromPalm = [leg.ankle[0] - palm.wrist[0], leg.ankle[1] - palm.wrist[1]];
        const towardFingers = awayFromPalm[0] * palm.forward[0] + awayFromPalm[1] * palm.forward[1];
        assert.ok(towardFingers < 0);
    });
});

test('palm and feather radius controls scale independently', () => {
    assert.deepEqual(
        app.calculateShapeWidths(40, {palmRadius: 1.5, featherRadius: 0.5}),
        {palmRadius: 30, featherWidth: 20},
    );
    assert.deepEqual(
        app.calculateShapeWidths(40, {palmRadius: 0.5, featherRadius: 1.5}),
        {palmRadius: 10, featherWidth: 60},
    );
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
    assert.ok(calls.some(([name]) => name === 'bezierCurveTo'));
    assert.ok(calls.some(([name]) => name === 'quadraticCurveTo'));
    assert.ok(calls.some(([name]) => name === 'fillText'));
});

test('renderStylizedTurkeys draws one shared artboard and one turkey per detected hand', () => {
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
    const secondHand = app.SAMPLE_KEYPOINTS.map(([x, y]) => [640 - x, y]);
    const rendered = app.renderStylizedTurkeys(
        context,
        [app.SAMPLE_KEYPOINTS, secondHand],
        1200,
        900,
    );
    assert.equal(rendered.length, 2);
    assert.equal(calls.filter(([name]) => name === 'clearRect').length, 1);
    assert.equal(calls.filter(([name]) => name === 'translate').length, 2);
});

test('shareTurkeyContent shares the generated PNG when file sharing is supported', async () => {
    const payloads = [];
    const file = {name: 'gobblevision-turkey.png'};
    const result = await app.shareTurkeyContent({
        navigatorObject: {
            canShare: ({files}) => files[0] === file,
            share: async (payload) => payloads.push(payload),
        },
        file,
        url: 'https://cmudrc.github.io/gobble-vision/',
    });
    assert.equal(result, 'file');
    assert.deepEqual(payloads[0].files, [file]);
    assert.match(payloads[0].text, /cmudrc\.github\.io/);
});

test('shareTurkeyContent falls back to the page link when file sharing is unavailable', async () => {
    const payloads = [];
    const result = await app.shareTurkeyContent({
        navigatorObject: {
            canShare: () => false,
            share: async (payload) => payloads.push(payload),
        },
        file: {name: 'gobblevision-turkey.png'},
        url: 'https://cmudrc.github.io/gobble-vision/',
    });
    assert.equal(result, 'link');
    assert.equal(payloads[0].url, 'https://cmudrc.github.io/gobble-vision/');
});

test('shareTurkeyContent copies the page link without a native share sheet', async () => {
    const copied = [];
    const result = await app.shareTurkeyContent({
        navigatorObject: {clipboard: {writeText: async (value) => copied.push(value)}},
        file: null,
        url: 'https://cmudrc.github.io/gobble-vision/',
    });
    assert.equal(result, 'copy');
    assert.deepEqual(copied, ['https://cmudrc.github.io/gobble-vision/']);
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
