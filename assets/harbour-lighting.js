import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { replaceSeaSurface } from './harbour-water.js';
import { addHarbourCoast } from './harbour-coast.js';

const sunDirection = new THREE.Vector3(-36, 16, 34).normalize();

function findEmitters(mesh, minimumSize) {
  const positions = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const parents = Array.from({ length: positions.count }, (_, i) => i);
  const shared = new Map();
  const root = i => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const connect = (a, b) => { parents[root(a)] = root(b); };
  for (let i = 0; i < positions.count; i++) {
    // Reconnect seams duplicated by Draco for normals and texture coordinates.
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => Math.round(v * 500)).join(',');
    if (shared.has(key)) connect(i, shared.get(key));
    else shared.set(key, i);
  }
  const count = index?.count ?? positions.count;
  const vertex = i => index ? index.getX(i) : i;
  for (let i = 0; i < count; i += 3) {
    connect(vertex(i), vertex(i + 1));
    connect(vertex(i), vertex(i + 2));
  }
  const bounds = new Map();
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const component = root(i);
    if (!bounds.has(component)) bounds.set(component, new THREE.Box3());
    bounds.get(component).expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
  }
  return Array.from(bounds.values())
    .filter(box => box.getSize(point).length() > minimumSize)
    .map(box => box.getCenter(new THREE.Vector3()));
}


function surfaceGrain(wood) {
  const size = 128;
  const grain = new Uint8Array(size * size);
  let seed = 349183;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const x = col * 2 * Math.PI / size, y = row * 2 * Math.PI / size;
      const strata = wood
        ? Math.sin(x * 23 + .9 * Math.sin(y * 2) + .5 * Math.sin(y * 5)) * 33
        : Math.sin(x * 17 + y * 13) * Math.sin(x * 9 - y * 19) * 20;
      grain[row * size + col] = 128 + strata + ((seed >>> 24) - 128) * .38;
    }
  }
  const texture = new THREE.DataTexture(grain, size, size, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(wood ? 8 : 11, wood ? 4 : 11);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const atmosphereNoise = `
  float harbourNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec4 d = vec4(i.x + i.y * 183.3) + vec4(0.0, 1.0, 183.3, 184.3);
    vec4 r = fract(sin(d * 12.9898) * 43758.5453);
    return mix(mix(r.x, r.y, f.x), mix(r.z, r.w, f.x), f.y);
  }
  float harbourFbm(vec2 p) {
    mat2 turn = mat2(.82, .57, -.57, .82);
    float value = .54 * harbourNoise(p);
    p = turn * p * 2.01;
    value += .24 * harbourNoise(p);
    p = turn * p * 2.21;
    value += .134 * harbourNoise(p) + .086 * harbourNoise(p * 2.13);
    return value;
  }
`;

function weatherSurface(material, roof) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 surfaceLocation;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nsurfaceLocation = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    const surfaceTint = roof
      ? 'mix(vec3(.68,.61,.58), vec3(1.2,1.05,.96), weatherPatch) * (.94 + .12 * grain)'
      : '(0.78 + 0.37 * weatherPatch) * (0.92 + 0.14 * streak) * (0.97 + 0.07 * grain)';
    shader.fragmentShader = 'varying vec3 surfaceLocation;\n' + atmosphereNoise + shader.fragmentShader.replace(
      '#include <color_fragment>', `
      #include <color_fragment>
      vec3 surface = surfaceLocation;
      vec2 pattern = vec2(surface.x + surface.z * .87, ${roof ? 'surface.z' : 'surface.y'});
      float weatherPatch = harbourFbm(pattern * ${roof ? '.36' : '.64'} + vec2(surface.z * .41, 0.0));
      float streak = harbourNoise(vec2(pattern.x * 2.5, pattern.y * .47));
      float grain = harbourNoise(pattern * 13.0);
      diffuseColor.rgb *= ${surfaceTint};
      `,
    );
  };
  material.customProgramCacheKey = () => roof ? 'weathered-clay' : 'weathered-lime';
}

function createShadowedLamp(scene) {
  const lamp = new THREE.SpotLight('#ffb563', 0, 10, .92, .77, 2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.setScalar(1024);
  lamp.shadow.camera.near = .12;
  lamp.shadow.bias = -.00025;
  lamp.shadow.normalBias = .032;
  lamp.shadow.autoUpdate = false;
  scene.add(lamp, lamp.target);
  return lamp;
}

export function createHarbourLighting(scene, renderer) {
  scene.fog = new THREE.FogExp2('#9fbcd9', .0036);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const sky = new Sky();
  sky.scale.setScalar(1500);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  const atmosphere = sky.material.uniforms;
  atmosphere.turbidity.value = 3.0;
  atmosphere.rayleigh.value = 1.28;
  atmosphere.mieCoefficient.value = .004;
  atmosphere.mieDirectionalG.value = .78;
  atmosphere.sunPosition.value.copy(sunDirection).multiplyScalar(100000);
  // Keep a cool sky fill and a dark ground hemisphere in the HDR environment.
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('void main() {', `${atmosphereNoise}\nvoid main() {`)
    .replace('gl_FragColor = vec4( retColor, 1.0 );', `
      vec3 air = min(retColor * vec3(.43, .65, 1.04), vec3(9.0));
      vec2 cloudRay = direction.xz / (max(0.0, direction.y) + .12) * 1.02 + vec2(-2.8, 5.5);
      float density = harbourFbm(cloudRay);
      float lightEdge = max(0.0, density - harbourFbm(cloudRay + vSunDirection.xz * .17));
      float veil = smoothstep(.51, .68, density) * smoothstep(.016, .15, direction.y);
      float evening = pow(clamp(.5 + .5 * cosTheta, 0.0, 1.0), 2.4);
      vec3 cloudLight = mix(vec3(.44, .55, .70), vec3(1.28, .79, .49), .22 + .78 * evening);
      vec3 cloud = mix(vec3(.19, .27, .43), cloudLight, clamp(.35 + lightEdge * 6.0, 0.0, 1.0));
      air = mix(air, cloud, veil * .89);
      gl_FragColor = vec4(mix(vec3(.031, .039, .055), air, smoothstep(-.16, .008, direction.y)), 1.0);
    `);

  const sun = new THREE.DirectionalLight('#ffb775', 4.12);
  sun.target.position.set(0, 3, -4);
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, 76);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(4096);
  Object.assign(sun.shadow.camera, { left: -47, right: 47, top: 43, bottom: -43, near: 15, far: 143 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -.00015;
  sun.shadow.normalBias = .034;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#8cbaff', '#8b8bab', .44));

  const spots = Array.from({ length: 2 }, () => createShadowedLamp(scene));
  const fillLights = Array.from({ length: 6 }, () => {
    const light = new THREE.PointLight('#ffc482', 0, 6.3, 2);
    scene.add(light);
    return light;
  });
  const stoneGrain = surfaceGrain(false);
  const woodGrain = surfaceGrain(true);
  const lanterns = [];
  const windows = [];
  let sea;
  let nextLightUpdate = -Infinity;

  function prepare(root) {
    addHarbourCoast(scene, root);
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(skyScene, .018, .1, 1800, { size: 256 });
    pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = .39;
    scene.add(sky);

    const materials = new Set();
    let originalWater;
    root.updateMatrixWorld(true);
    root.traverse(mesh => {
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const material = mesh.material;
      if (material.name === 'lamp') lanterns.push(...findEmitters(mesh, .09));
      if (material.name === 'amber') windows.push(...findEmitters(mesh, .46).filter(p => p.y < 12));
      if (material.name === 'water') originalWater = mesh;
      if (materials.has(material)) return;
      materials.add(material);
      if (material.map) material.map.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
      if (material.name === 'lamp' || material.name === 'amber') {
        const lamp = material.name === 'lamp';
        material.emissive.set(lamp ? '#ffce89' : '#ffc271');
        material.emissiveIntensity = lamp ? 4.7 : 2.55;
        return;
      }
      if (/^(glass|iron|cerulean\d|teal\d|cobalt\d)$/.test(material.name)) {
        material.roughness = material.name === 'glass' ? .19 : material.name === 'iron' ? .4 : .29;
      }
      const isWood = /^(dock|wood|teak)$/.test(material.name);
      const roof = /^terra\d$/.test(material.name);
      if (roof || /^(cream|plaster|ivory|pink|salmon|ochre|mint|lavender|brick)$/.test(material.name)) {
        weatherSurface(material, roof);
      }
      if (mesh.geometry.attributes.uv && (isWood || /^(brick|paving|quay|stone|plaster|cream|terra\d)$/.test(material.name))) {
        material.bumpMap = isWood ? woodGrain : stoneGrain;
        material.bumpScale = isWood ? .017 : .023;
      }
    });
    if (originalWater) {
      sea = replaceSeaSurface(originalWater, sun);
      originalWater.removeFromParent();
      scene.add(sea);
    }
  }

  function resize(width, height) {
    if (!sea) return;
    const fraction = Math.min(.84, 2048 / Math.max(width, height));
    sea.getRenderTarget().setSize(Math.max(1, Math.round(width * fraction)), Math.max(1, Math.round(height * fraction)));
  }

  function update(camera, now) {
    if (sea) sea.material.uniforms.time.value = now * .001;
    if (now < nextLightUpdate) return;
    nextLightUpdate = now + 280;
    const distanceOrder = (a, b) => a.distanceToSquared(camera.position) - b.distanceToSquared(camera.position);
    const selected = [];
    for (const lantern of [...lanterns].sort(distanceOrder)) {
      if (selected.every(position => position.distanceToSquared(lantern) > 2.0)) selected.push(lantern);
      if (selected.length === 4) break;
    }
    const windowNear = [...windows].sort(distanceOrder);
    for (let i = 0; i < fillLights.length; i++) {
      const lamp = i < 4;
      const position = lamp ? selected[i] : windowNear[i - 4];
      const light = fillLights[i];
      light.intensity = position ? (lamp ? 20 : 14) : 0;
      if (position) light.position.copy(position);
    }
    for (let i = 0; i < spots.length; i++) {
      const light = spots[i];
      const anchor = selected[i];
      if (!anchor || light.userData.anchor === anchor) continue;
      light.userData.anchor = anchor;
      light.position.copy(anchor);
      light.position.y -= .20;
      light.target.position.copy(anchor);
      light.target.position.y -= 3;
      light.intensity = 43;
      light.shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
    }
  }

  return { prepare, resize, update, reflectionSize: () => sea?.getRenderTarget().width ?? 0 };
}
