#!/usr/bin/env bash
# Κατεβάζει όλες τις βιβλιοθήκες και τα μοντέλα AI μέσα στο vendor/ ώστε η εφαρμογή
# να δουλεύει 100% χωρίς internet. Τρέχει μία φορά (ή όταν θέλουμε αναβάθμιση).
set -euo pipefail
cd "$(dirname "$0")/.."
V=vendor
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p $V/mediapipe/wasm $V/models $V/face-api/model $V/tesseract

pack() { (cd "$TMP" && npm pack "$1" --silent >/dev/null && mkdir -p "x_$2" && tar -xzf ./*"$2"*.tgz -C "x_$2" --strip-components=1 && rm -f ./*.tgz); }

pack @mediapipe/tasks-vision@1.2.3 tasks-vision
cp $TMP/x_tasks-vision/vision_bundle.mjs $V/mediapipe/
cp $TMP/x_tasks-vision/wasm/* $V/mediapipe/wasm/

pack @vladmandic/face-api@1.7.15 face-api
cp $TMP/x_face-api/dist/face-api.js $V/face-api/
for m in tiny_face_detector face_landmark_68_tiny face_recognition; do
  cp $TMP/x_face-api/model/${m}_model* $V/face-api/model/
done

pack tesseract.js@7.0.0 tesseract.js
cp $TMP/x_tesseract.js/dist/tesseract.min.js $TMP/x_tesseract.js/dist/worker.min.js $V/tesseract/
pack tesseract.js-core@7.0.0 tesseract.js-core
cp $TMP/x_tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js $TMP/x_tesseract.js-core/tesseract-core-simd-lstm.wasm.js $TMP/x_tesseract.js-core/tesseract-core-lstm.wasm.js $V/tesseract/
pack @tesseract.js-data/ell@1.0.0 data-ell
cp $TMP/x_data-ell/4.0.0_best_int/ell.traineddata.gz $V/tesseract/
pack @tesseract.js-data/eng@1.0.0 data-eng
cp $TMP/x_data-eng/4.0.0_best_int/eng.traineddata.gz $V/tesseract/

G=https://storage.googleapis.com/mediapipe-models
curl -fsSL -o $V/models/efficientdet_lite0.tflite $G/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite
curl -fsSL -o $V/models/efficientdet_lite2.tflite $G/object_detector/efficientdet_lite2/float16/latest/efficientdet_lite2.tflite
curl -fsSL -o $V/models/mobilenet_v3_small.tflite $G/image_embedder/mobilenet_v3_small/float32/latest/mobilenet_v3_small.tflite
echo "OK"; du -sh $V
