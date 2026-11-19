import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(project, 'dist');
const threeFiles = [
  'LICENSE',
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/loaders/DRACOLoader.js',
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/controls/PointerLockControls.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/objects/Reflector.js',
  'examples/jsm/objects/Sky.js',
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/GTAOPass.js',
  'examples/jsm/postprocessing/MaskPass.js',
  'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/postprocessing/Pass.js',
  'examples/jsm/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/ShaderPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/shaders/CopyShader.js',
  'examples/jsm/shaders/GTAOShader.js',
  'examples/jsm/shaders/LuminosityHighPassShader.js',
  'examples/jsm/shaders/OutputShader.js',
  'examples/jsm/shaders/PoissonDenoiseShader.js',
  'examples/jsm/math/SimplexNoise.js',
  'examples/jsm/libs/draco/gltf/draco_decoder.js',
  'examples/jsm/libs/draco/gltf/draco_decoder.wasm',
  'examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js',
];
const files = [
  'index.html',
  'style.css',
  'walk.js',
  'assets/harbour-lighting.js',
  'assets/harbour-water.js',
  'assets/harbour-coast.js',
  'assets/harbour.glb',
  'assets/harbour-light.glb',
  'assets/walk.json',
  ...threeFiles.map(file => `node_modules/three/${file}`),
];

for (const file of files) {
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(project, file), destination);
}

console.log(`Built GitHub Pages site in ${output}`);
