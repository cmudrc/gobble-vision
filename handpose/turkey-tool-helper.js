(function initTurkeyToolHelper(root) {
    'use strict';
    const globalObject = root || (typeof window !== 'undefined' ? window : globalThis);

    function getDialog() {
        const documentObject = globalObject && globalObject.document ? globalObject.document : globalThis.document;
        const dialog = documentObject && documentObject.getElementById('turkey-dialog');
        if (!dialog || typeof dialog.showModal !== 'function') {
            throw new Error('The GobbleVision camera dialog is unavailable.');
        }
        return dialog;
    }

    function getTracker() {
        const tracker = globalObject && globalObject.startTracking;
        if (typeof tracker !== 'function') throw new Error('startTracking is not available.');
        return tracker;
    }

    async function restartTurkeyCapture() {
        const dialog = getDialog();
        if (!dialog.open) dialog.showModal();
        await getTracker()();
    }

    function closeTurkeyCapture() {
        const dialog = getDialog();
        const controls = globalObject && globalObject.TurkeyHandpose;
        if (controls && typeof controls.stop === 'function') controls.stop();
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
    }

    const helper = {restartTurkeyCapture, closeTurkeyCapture};
    if (globalObject) globalObject.TurkeyToolHelper = helper;
    if (typeof module === 'object' && module.exports) module.exports = helper;
    return helper;
})(typeof window !== 'undefined' ? window : globalThis);
