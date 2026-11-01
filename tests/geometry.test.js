const test = require('node:test');
const assert = require('node:assert/strict');
const geometry = require('../handpose/geometry.js');

test('computeFingerRadius returns half the distance between palm anchors', () => {
    const keypoints = Array.from({length: 21}, (_, index) => [index, index]);
    keypoints[5] = [0, 0];
    keypoints[9] = [6, 8];
    assert.equal(geometry.computeFingerRadius(keypoints), 5);
});

test('computeFingerRadius rejects empty input', () => {
    assert.throws(() => geometry.computeFingerRadius([]), /non-empty/);
});

test('extractPolygonPoints preserves the requested order', () => {
    const points = [[1, 2], [3, 4], [5, 6], [7, 8]];
    assert.deepEqual(geometry.extractPolygonPoints(points, [3, 1]), [[7, 8], [3, 4]]);
});
