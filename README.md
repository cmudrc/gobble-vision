# GobbleVision

**Hold up a hand. Make a turkey.**

GobbleVision is a browser-based Thanksgiving experiment from the [Design Research Collective](https://cmudrc.github.io/) at Carnegie Mellon University. It uses MediaPipe Hands through the TensorFlow.js hand-pose-detection API to turn 21 landmarks into a stylized digital turkey. You can decorate the result and download it as a PNG.

## Try it

Open [cmudrc.github.io/gobble-vision](https://cmudrc.github.io/gobble-vision/).

No camera? Choose **Try a sample pose**. The complete art studio works without camera access.

## What changed in version 2

- Camera access begins only after an explicit click.
- Video and hand landmarks stay in the browser. Nothing is uploaded.
- The hand-pose model uses the current hand-pose-detection API with MediaPipe's browser runtime.
- A generated turkey replaces the raw camera capture, keeping the artwork playful and the background private.
- A native canvas studio provides drawing, color, brush-size, undo, reset, and PNG download controls.
- The interface works on phones, tablets, and desktops and includes reduced-motion and keyboard-focus support.
- The project has no npm runtime or test dependencies.

## Local development

The app is static. Serve the repository from a local web server because browsers require a secure context or localhost for camera access.

```bash
ruby -run -e httpd . -p 4173
```

Then open `http://127.0.0.1:4173`.

Run the dependency-free test suite with Node.js 20 or newer:

```bash
npm test
```

## How it works

1. `@tensorflow-models/hand-pose-detection` and MediaPipe Hands estimate 21 hand landmarks in the live video.
2. GobbleVision mirrors and scales those landmarks into an artboard coordinate system.
3. Finger paths become feathers, the palm becomes a body, and the thumb becomes the head.
4. The generated bird is placed on a native canvas for annotation and export.

The browser downloads the model and WebAssembly assets from jsDelivr on first use. Camera frames, landmarks, drawings, and downloaded images remain local to the device.

## Project structure

```text
index.html                      Page structure and accessible controls
style.css                       Responsive DRC visual system
handpose/main.js                Model, camera, rendering, and artboard logic
handpose/geometry.js            Reusable geometry helpers
handpose/turkey-tool-helper.js  Native dialog controls
tests/                          Node.js unit tests
```

## Credits

- [TensorFlow.js hand pose detection](https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection)
- The hand-turkey makers who have been tracing, decorating, and reinventing this form for generations

GobbleVision is released under the [MIT License](LICENSE).
