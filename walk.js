import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createHarbourLighting } from './assets/harbour-lighting.js';

const $ = (id) => document.getElementById(id);
const canvas = $('city');
const EYE = 1.65;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const keys = new Set();
const worldPoint = ([x, y, z]) => new THREE.Vector3(x, z, -y);
const clamp = THREE.MathUtils.clamp;
const forward = new THREE.Vector3();
const intended = new THREE.Vector3();
const temp = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const facingMatrix = new THREE.Matrix4();
const targetRotation = new THREE.Quaternion();
const mouseAngles = new THREE.Euler(0, 0, 0, 'YXZ');
const camera = new THREE.PerspectiveCamera(61, 1, .085, 1000);
const scene = new THREE.Scene();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (error) {
  $('load-text').textContent = '当前浏览器无法启用 WebGL 2';
  $('loading-bar').hidden = true;
  $('retry').hidden = false;
  throw error;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = .99;
renderer.info.autoReset = false;
const gl = renderer.getContext();
const debugGPU = gl.getExtension('WEBGL_debug_renderer_info');
const hardware = {
  renderer: String(debugGPU ? gl.getParameter(debugGPU.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
  cores: navigator.hardwareConcurrency ?? 4,
  memory: navigator.deviceMemory ?? null,
  maxTextureSize: renderer.capabilities.maxTextureSize,
};
const params = new URLSearchParams(location.search);
const modelTier = params.get('quality')==='light' ? 'light' : 'standard';
const modelURL = modelTier==='light' ? './assets/harbour-light.glb' : './assets/harbour.glb';
$('quality').value=modelTier;

const pointer = new PointerLockControls(camera, canvas);
pointer.minPolarAngle = .23;
pointer.maxPolarAngle = Math.PI - .23;
pointer.pointerSpeed = .80;
const orbit = new OrbitControls(camera, canvas);
orbit.enabled = false;
orbit.enableDamping = true;
orbit.minDistance = 12;
orbit.maxDistance = 170;
orbit.maxPolarAngle = Math.PI * .48;

const lighting = createHarbourLighting(scene, renderer);
const frame = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: Math.min(4, renderer.capabilities.maxSamples),
});
const composer = new EffectComposer(renderer, frame);
composer.addPass(new RenderPass(scene, camera));
const contactShadows = new GTAOPass(scene, camera);
contactShadows.updateGtaoMaterial({ radius: .55, thickness: .64, distanceFallOff: .65, samples: 16 });
contactShadows.blendIntensity = .62;
composer.addPass(contactShadows);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), .17, .38, 2.25));
composer.addPass(new OutputPass());

let nav, trail, total = 0, walkGrid, cityRoot;
let mode = 'loading';
let playing = false;
let distance = 0;
let ground = 0;
let walkingDistance = 0;
let activeChapter = null;
let routeButtons = [];
let previous = 0, frameTimes = [], frameCount = 0;
let firstFrameShown = false;
let sourceMeshCount = 0;
let batchedMeshCount = 0;
const lods = [];
const tracked = { fps: 0, calls: 0, triangles: 0 };

function resize() {
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(box.width, box.height, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(box.width, box.height);
  lighting.resize(box.width * pixelRatio, box.height * pixelRatio);
  camera.aspect = box.width / box.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

function status(text, amount) {
  $('load-text').textContent = text;
  if (amount == null) $('loading-bar').removeAttribute('value');
  else $('loading-bar').value = amount;
}

function syncUI() {
  $('panel').hidden = mode === 'loading' || mode === 'failed';
  $('aim').hidden = mode !== 'walk';
  $('touch-controls').hidden = mode !== 'walk' || !TOUCH;
  $('overview').textContent = mode === 'overview' ? '回到街道' : '俯瞰';
  $('play').textContent = playing && mode === 'tour' ? '暂停漫游' : distance >= total-.01 ? '重新漫游' : '自动漫游';
  $('walk').textContent = mode === 'walk' ? '退出行走' : '自由行走';
  $('walk').setAttribute('aria-pressed', String(mode === 'walk'));
  $('controls-hint').textContent = mode === 'walk'
    ? (TOUCH ? '滑动看向四周 · 使用方向键行走' : 'WASD 行走 · 拖动视角 · 点击场景锁定鼠标')
    : mode === 'overview' ? '拖动旋转 · 滚轮缩放' : '空格 暂停 · 可跳到沿途地标';
  if (mode === 'walk') $('place-name').textContent = '自由行走';
  if (mode === 'overview') $('place-name').textContent = '全城俯瞰';
  updateProgress(true);
}
function updateProgress(force=false) {
  if (!nav) return;
  const percent = total ? distance / total : 0;
  if (document.activeElement !== $('scrub') || force) $('scrub').value = String(Math.round(percent*1000));
  $('scrub').style.setProperty('--progress', (percent*100).toFixed(1)+'%');
  if (mode==='tour') {
    const chapter = nav.chapters.findLast(ch => distance+1e-3 >= ch.metres) ?? nav.chapters[0];
    if (chapter.id !== activeChapter || force) {
      activeChapter = chapter.id;
      $('place-name').textContent = chapter.title;
      for (const [el,id] of routeButtons) {
        if (id===chapter.id) el.setAttribute('aria-current','step');
        else el.removeAttribute('aria-current');
      }
    }
  }
}

function floorAt(x, y) {
  const j = Math.round((x-nav.origin[0])/nav.step);
  const i = Math.round((y-nav.origin[1])/nav.step);
  if (j<0 || i<0 || j>=nav.width || i>=nav.height) return null;
  const value = walkGrid.getInt16((i*nav.width+j)*2, true);
  return value === nav.blocked ? null : value*.01;
}

function prepareNavigation(data) {
  nav = data;
  const bytes = Uint8Array.from(atob(nav.grid), c => c.charCodeAt(0));
  walkGrid = new DataView(bytes.buffer);
  total = 0;
  trail = nav.points.map((p,i) => {
    if (i) total += Math.hypot(p[0]-nav.points[i-1][0], p[1]-nav.points[i-1][1]);
    return { p, length: total };
  });
  for (const ch of nav.chapters) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = ch.title;
    btn.addEventListener('click', () => seek(ch.metres, true));
    $('chapters').append(btn);
    routeButtons.push([btn,ch.id]);
  }
}

function sample(s) {
  const d = clamp(s,0,total);
  let lo=0, hi=trail.length-1;
  while (hi-lo>1) {
    const mid=(lo+hi)>>1;
    if (trail[mid].length <= d) lo=mid;
    else hi=mid;
  }
  const a=trail[lo], b=trail[hi];
  const t = b.length === a.length ? 0 : (d-a.length)/(b.length-a.length);
  const x=THREE.MathUtils.lerp(a.p[0],b.p[0],t);
  const y=THREE.MathUtils.lerp(a.p[1],b.p[1],t);
  return [x,y,floorAt(x,y) ?? THREE.MathUtils.lerp(a.p[2],b.p[2],t)];
}

function orient(t, dt, quick=false) {
  const p = sample(t);
  const next = sample(Math.min(total,t+1.42));
  const prior = sample(Math.max(0,t-.55));
  forward.set(next[0]-p[0], 0, p[1]-next[1]);
  if (forward.lengthSq()<.003) forward.set(p[0]-prior[0],0,prior[1]-p[1]);
  if (forward.lengthSq()<.001) forward.set(0,0,-1);
  forward.normalize();
  intended.copy(forward);
  intended.y = .08 + clamp((next[2]-p[2])*.9,-.30,.29);
  const ch = nav.chapters.findLast(c => t+.01>=c.metres) ?? nav.chapters[0];
  temp.copy(worldPoint(ch.look)).sub(camera.position).normalize();
  const ahead=forward.dot(temp);
  let mix=ch.id==='dock'?.58:ch.id==='church'?.41:ch.id==='bridge'?.33:.38;
  mix *= THREE.MathUtils.smoothstep(ahead,-.36,.28);
  if (t >= total-3) mix = Math.max(mix,THREE.MathUtils.smoothstep(t,total-3,total)*.88);
  intended.lerp(temp,mix).normalize();
  facingMatrix.lookAt(camera.position,temp.copy(camera.position).add(intended),up);
  targetRotation.setFromRotationMatrix(facingMatrix);
  camera.quaternion.slerp(targetRotation,quick?1:1-Math.exp(-dt*4.1));
}
function poseTour(s, dt, instant = false) {
  const p=sample(s);
  ground = instant ? p[2] : THREE.MathUtils.lerp(ground, p[2], 1-Math.exp(-dt*9));
  const bob = playing && !REDUCED_MOTION ? Math.sin(s*8.9)*.024 : 0;
  camera.position.set(p[0],ground+EYE+bob,-p[1]);
  orient(s,dt,instant);
}
function seek(s, run=false) {
  if (!nav) return;
  if (pointer.isLocked) pointer.unlock();
  if (mode==='overview') {
    orbit.enabled=false;
    camera.fov=61;
    camera.updateProjectionMatrix();
  }
  mode='tour';
  playing=run;
  distance=clamp(s,0,total);
  poseTour(distance,0,true);
  syncUI();
}
function nearestTrail() {
  let nearest=0,best=Infinity;
  for (const point of trail) {
    const score=(point.p[0]-camera.position.x)**2+(point.p[1]+camera.position.z)**2;
    if (score<best) { best=score; nearest=point.length; }
  }
  return nearest;
}
function toggleTour() {
  if (!nav) return;
  if (mode !== 'tour') {
    seek(mode==='walk' ? nearestTrail() : distance,true);
  } else {
    if (distance>=total-.01) seek(0,true);
    else { playing=!playing; syncUI(); }
  }
}
function toggleWalk() {
  if (!nav) return;
  if (mode==='walk') {
    seek(nearestTrail());
    return;
  }
  if (mode==='overview') seek(distance);
  playing=false;
  mode='walk';
  ground=floorAt(camera.position.x,-camera.position.z) ?? sample(distance)[2];
  camera.position.y=ground+EYE;
  canvas.focus();
  syncUI();
}
function toggleOverview() {
  if (!nav) return;
  if (mode==='overview') {
    seek(distance);
    return;
  }
  if (mode==='walk') distance=nearestTrail();
  if (pointer.isLocked) pointer.unlock();
  playing=false;
  mode='overview';
  camera.position.set(34, 24, 68);
  orbit.target.set(-4, 9, -7);
  camera.fov=45;
  camera.updateProjectionMatrix();
  orbit.enabled=true;
  orbit.update();
  syncUI();
}
function changeQuality(value) {
  const at=mode==='walk'?nearestTrail():distance;
  sessionStorage.setItem('harbour-quality-resume',JSON.stringify({fraction:at/total,playing}));
  const locationNext=new URL(location.href);
  if (value==='standard') locationNext.searchParams.delete('quality');
  else locationNext.searchParams.set('quality',value);
  if (locationNext.href===location.href) location.reload();
  else location.href=locationNext.href;
}
function keyActive(...names) { return names.some(k=>keys.has(k)); }
function walkStep(dt) {
  const fb = Number(keyActive('KeyW','ArrowUp'))-Number(keyActive('KeyS','ArrowDown'));
  const lr = Number(keyActive('KeyD','ArrowRight'))-Number(keyActive('KeyA','ArrowLeft'));
  const fast = keyActive('ShiftLeft','ShiftRight');
  if (fb || lr) {
    camera.getWorldDirection(forward);
    forward.y=0;
    forward.normalize();
    temp.copy(forward).cross(up);
    intended.copy(forward).multiplyScalar(fb).addScaledVector(temp,lr).normalize();
    const travel=dt*(fast?3.6:2.18);
    const steps=Math.max(1,Math.ceil(travel/.060));
    for (let i=0;i<steps;i++) {
      const a=camera.position.x,b=-camera.position.z;
      const from=floorAt(a,b);
      if (from===null) break;
      const x=a+intended.x*travel/steps;
      const y=b-intended.z*travel/steps;
      for (const [u,v] of [[x,y],[x,b],[a,y]]) {
        const h=floorAt(u,v);
        if (h!==null && Math.abs(h-from)<=.24) {
          camera.position.x=u; camera.position.z=-v;
          walkingDistance+=Math.hypot(u-a,v-b);
          break;
        }
      }
    }
  }
  const h=floorAt(camera.position.x,-camera.position.z) ?? ground;
  ground=THREE.MathUtils.lerp(ground,h,1-Math.exp(-dt*12));
  camera.position.y=ground+EYE+(fb||lr?Math.sin(walkingDistance*9)*.020:0);
}

function keyboard(event, pressed) {
  const field = event.target instanceof HTMLInputElement;
  if (!pressed) { keys.delete(event.code); return; }
  if (field) return;
  if (MOVE_KEYS.has(event.code)) {
    if (mode==='walk') { event.preventDefault(); keys.add(event.code); }
    return;
  }
  if (event.code==='Space' && !event.repeat && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    toggleTour();
  }
}
addEventListener('keydown', event=>keyboard(event,true));
addEventListener('keyup', event=>keyboard(event,false));
addEventListener('blur', ()=>keys.clear());
$('retry').addEventListener('click',()=>location.reload());
$('play').addEventListener('click',toggleTour);
$('walk').addEventListener('click',toggleWalk);
$('overview').addEventListener('click',toggleOverview);
$('quality').addEventListener('change',event=>changeQuality(event.currentTarget.value));
$('scrub').addEventListener('input',event=>seek(Number(event.currentTarget.value)*total/1000));
for (const btn of $('touch-controls').querySelectorAll('button')) {
  const k=btn.dataset.key;
  btn.addEventListener('pointerdown',ev=>{ ev.preventDefault(); btn.setPointerCapture(ev.pointerId); keys.add(k); });
  for (const type of ['pointercancel','pointerup','lostpointercapture']) btn.addEventListener(type,()=>keys.delete(k));
}
let drag;
canvas.addEventListener('pointerdown',event=>{
  if (mode!=='walk'||pointer.isLocked) return;
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
  if (!drag||drag.id!==event.pointerId||pointer.isLocked||mode!=='walk') return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if (Math.abs(dx)+Math.abs(dy)>1) drag.moved=true;
  drag.x=event.clientX;drag.y=event.clientY;
  mouseAngles.setFromQuaternion(camera.quaternion);
  mouseAngles.y-=dx*.005;
  mouseAngles.x=clamp(mouseAngles.x-dy*.005,-1.29,1.29);
  camera.quaternion.setFromEuler(mouseAngles);
});
canvas.addEventListener('pointerup',event=>{
  if (!drag||drag.id!==event.pointerId) return;
  if (!drag.moved && !TOUCH && mode==='walk' && canvas.requestPointerLock) pointer.lock();
  drag=null;
});
canvas.addEventListener('pointercancel',()=>{drag=null;});
pointer.addEventListener('unlock',()=>keys.clear());

function setupLOD(root) {
  const groups=new Map();
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    const group=o.userData.runtime_lod_group;
    if(typeof group!=='string') return;
    if(!groups.has(group)) groups.set(group,[]);
    groups.get(group)[o.userData.runtime_lod_level]=o;
  });
  for(const [label,[near,far]] of groups) {
    if(!near || !far || !near.parent || near.parent!==far.parent) continue;
    const parent=near.parent;
    const center=new THREE.Box3().setFromObject(near).getCenter(new THREE.Vector3());
    parent.worldToLocal(center);
    const lod=new THREE.LOD();
    lod.name=label+' / distance LOD';
    lod.position.copy(center);
    parent.add(lod);
    near.position.sub(center);
    far.position.sub(center);
    if(Array.isArray(far.userData.runtime_lod_scale)) far.scale.fromArray(far.userData.runtime_lod_scale);
    lod.addLevel(near,0);
    lod.addLevel(far,19,.15);
    far.visible=false;
    lods.push(lod);
  }
}

function groupMeshes(root) {
  const meshList=[];
  root.updateMatrixWorld(true);
  root.traverse(o=>{if(o.isMesh) meshList.push(o);});
  sourceMeshCount=meshList.length;
  const container=new THREE.Group();
  container.name='Harbour static render batches';
  const groups=new Map();

  for (const o of meshList) {
    const material=o.material;
    const g=o.geometry;
    if (Array.isArray(material)) continue;
    const isWater=material.name==='water';
    const plant=material.name.startsWith('leaves') || material.name.startsWith('petal');
    const casting = !isWater && !plant && material.name!=='lamp' && !/^cliff|^distance/.test(material.name);
    o.castShadow=casting;
    o.receiveShadow=!isWater && material.name!=='lamp' && material.name!=='amber';
    if (isWater || !g.index || !g.attributes.uv || !g.attributes.normal) continue;
    let level=o.parent;
    while(level && !level.isLOD) level=level.parent;
    if(level) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingSphere.radius>16) continue;
    temp.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const cellWidth=modelTier==='light'?14:9;
    const tile=Math.floor(temp.x/cellWidth)+','+Math.floor(temp.z/cellWidth);
    const token=material.uuid+tile+(casting?'1':'0')+(o.receiveShadow?'1':'0');
    if(!groups.has(token)) groups.set(token,[]);
    groups.get(token).push(o);
  }
  for (const list of groups.values()) {
    if(list.length<(modelTier==='light'?2:3)) continue;
    const prepared=list.map(o=>{
      const g=o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      return g;
    });
    const g=mergeGeometries(prepared,false);
    for(const p of prepared) p.dispose();
    if(!g) continue;
    const first=list[0];
    const o=new THREE.Mesh(g,first.material);
    o.castShadow=first.castShadow; o.receiveShadow=first.receiveShadow;
    container.add(o);
    for(const src of list) src.removeFromParent();
  }
  root.add(container);
  let count=0;
  root.traverse(o=>{if(o.isMesh) count++;});
  batchedMeshCount=count;
}

function animate(now) {
  const raw=previous?(now-previous)*.001:0;
  const dt=Math.min(.11,raw||.016);
  previous=now;
  if (mode==='tour'&&playing) {
    distance=Math.min(total,distance+Math.min(.32,raw||.016)*1.62);
    poseTour(distance,dt);
    updateProgress();
    if(distance===total){playing=false;syncUI();}
  } else if (mode==='walk') walkStep(dt);
  else if (mode==='overview') orbit.update();
  lighting.update(camera,now);
  renderer.info.reset();
  composer.render(dt);
  if (mode==='loading'||mode==='failed') return;
  if (firstFrameShown && raw>0 && raw<5) {
    frameTimes.push(raw);
    if(frameTimes.length>90) frameTimes.shift();
  }
  firstFrameShown=true;
  frameCount++;
  if (frameCount%20===0) {
    tracked.fps=frameTimes.length / Math.max(1e-4,frameTimes.reduce((a,b)=>a+b,0));
    tracked.calls=renderer.info.render.calls;
    tracked.triangles=renderer.info.render.triangles;
  }
}

async function start() {
  const draco=new DRACOLoader();
  draco.setDecoderPath('./node_modules/three/examples/jsm/libs/draco/gltf/');
  draco.setWorkerLimit(4);
  const loader=new GLTFLoader().setDRACOLoader(draco);
  const [data,gltf]=await Promise.all([
    fetch('./assets/walk.json').then(r=>{if(!r.ok) throw new Error('Walk data '+r.status);return r.json();}),
    loader.loadAsync(modelURL,event=>{
      if(event.lengthComputable) {
        const percent=Math.min(100,Math.round(100*event.loaded/event.total));
        status(percent>=100?'正在解码城市模型':`正在载入港城 ${percent}%`,percent);
      }
    }),
  ]);
  status('正在准备漫游');
  prepareNavigation(data);
  cityRoot=gltf.scene;
  setupLOD(cityRoot);
  lighting.prepare(cityRoot);
  groupMeshes(cityRoot);
  scene.add(cityRoot);
  resize();
  const resume=JSON.parse(sessionStorage.getItem('harbour-quality-resume') || 'null');
  sessionStorage.removeItem('harbour-quality-resume');
  seek((resume?.fraction??0)*total,resume?.playing??!REDUCED_MOTION);
  // Prime the initial sun and local lamp shadow maps.
  renderer.shadowMap.needsUpdate=true;
  lighting.update(camera,performance.now());
  composer.render(0);
  draco.dispose();
  $('loading').hidden=true;
  $('overview').disabled=false;
  $('quality').disabled=false;
  canvas.dataset.ready='true';
  renderer.setAnimationLoop(animate);
  window.harbourViewer = {
    state:()=>({mode,playing,distance,total,chapter:activeChapter,position:camera.position.toArray(),
      modelTier,qualityPreference:modelTier,hardware,
      lodGroups:lods.length,activeNearLOD:lods.filter(lod=>lod.getCurrentLevel()===0).length,
      render:{...tracked,sourceMeshCount,batchedMeshCount,pixelRatio:renderer.getPixelRatio(),
        reflectionWidth:lighting.reflectionSize(),contactShadows:contactShadows.enabled}}),
    seek: (value,run=false)=>seek(clamp(value,0,1)*total,run),
  };
}
start().catch(error=>{
  console.error(error);
  mode='failed';
  status('港城加载失败。可重新载入。');
  $('loading-bar').hidden=true;
  $('retry').hidden=false;
  syncUI();
});
