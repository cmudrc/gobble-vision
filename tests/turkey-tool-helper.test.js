const test = require('node:test');
const assert = require('node:assert/strict');

function loadHelper({withTracker = true} = {}) {
    const path = require.resolve('../handpose/turkey-tool-helper.js');
    delete require.cache[path];
    const dialog = {
        open: false,
        showModal() { this.open = true; },
        close() { this.open = false; },
    };
    global.document = {getElementById: () => dialog};
    global.TurkeyHandpose = {stopCalled: false, stop() { this.stopCalled = true; }};
    if (withTracker) global.startTracking = async () => undefined;
    else delete global.startTracking;
    return {helper: require(path), dialog};
}

test('restartTurkeyCapture opens the native dialog and starts tracking', async () => {
    const {helper, dialog} = loadHelper();
    await helper.restartTurkeyCapture();
    assert.equal(dialog.open, true);
});

test('closeTurkeyCapture stops tracking and closes the dialog', async () => {
    const {helper, dialog} = loadHelper();
    await helper.restartTurkeyCapture();
    helper.closeTurkeyCapture();
    assert.equal(dialog.open, false);
    assert.equal(global.TurkeyHandpose.stopCalled, true);
});

test('restartTurkeyCapture reports a missing tracker', async () => {
    const {helper} = loadHelper({withTracker: false});
    await assert.rejects(helper.restartTurkeyCapture(), /startTracking/);
});
