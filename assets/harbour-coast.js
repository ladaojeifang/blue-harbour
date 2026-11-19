import * as THREE from 'three';

const { lerp, smoothstep } = THREE.MathUtils;
const gaussian = (x, width) => Math.exp(-((x / width) ** 2));
const seaLevel = -2.365;
const limestone = new THREE.Color('#a7a2a0');
const darkStone = new THREE.Color('#666979');
const shale = new THREE.Color('#8f8177');
const grass = new THREE.Color('#667649');
const scrub = new THREE.Color('#3c5238');
const pine = new THREE.Color('#526c3f');
const brush = new THREE.Color('#788347');
const boulderColor = new THREE.Color('#91877a');
const headland = { minX: -73, maxX: 66, columns: 173, rows: 110 };
// X and depth follow the terrain grid, so groves can follow its shelves.
const groves = [
  [-55, .31, 7, .105], [-44, .48, 7, .105], [-31, .30, 6, .085],
  [-25, .53, 9, .075], [-9, .40, 9, .145], [9, .53, 11, .11],
  [25, .40, 8, .095], [40, .37, 8, .135], [51, .26, 6, .11],
];

export const breakwaters = [
  [-34.5, 18.8, 6.6, 2.7], [-30.8, 7.7, 4.0, 6.0],
  [30.9, 7.4, 4.1, 6.0], [34.3, -7.0, 6.4, 4.5],
  [-43, -5.4, 9.2, 4.3], [45.5, -20.7, 8.1, 5.0],
];

function randomGenerator() {
  let seed = 8275449;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function bluffPoint(x, depth) {
  const west = 1 - smoothstep(x, -37, -30);
  const east = smoothstep(x, 28, 37);
  const edge = -36.0 + 23 * west + 21 * east
    - 8 * gaussian(x + 59, 13) - 8 * gaussian(x - 56, 14)
    + (west + east) * (2.4 * Math.sin(x * .27) + 1.2 * Math.sin(x * .81));
  const z = edge - depth * 50;
  const ridge = 32 * gaussian(x + 33, 17) + 20 * gaussian(x + 9, 20)
    + 17 * gaussian(x - 20, 19) + 13 * gaussian(x - 45, 10);
  const crest = ridge * (.24 * smoothstep(depth, .01, .12)
    + .39 * smoothstep(depth, .12, .24) + .37 * smoothstep(depth, .31, .44));
  const envelope = smoothstep(x, -73, -50) * (1 - smoothstep(x, 41, 66)) * (1 - smoothstep(depth, .60, 1));
  const irregular = 1.6 * Math.sin(x * .43 + z * .25) + .83 * Math.sin(x * .94 - z * .77)
    + .33 * Math.sin(x * 2.1 + z * .91);
  const y = seaLevel - 1.3 + (5.7 * smoothstep(depth, 0, .13) + crest + irregular * smoothstep(depth, .02, .24)) * envelope;
  return [x, y, z];
}

function plantableSurface(x, depth) {
  const { minX, maxX, columns, rows } = headland;
  const u = (x - minX) / (maxX - minX) * columns;
  const v = depth * rows;
  const col = Math.floor(u), row = Math.floor(v);
  const left = lerp(minX, maxX, col / columns);
  const right = lerp(minX, maxX, (col + 1) / columns);
  const a = new THREE.Vector3(...bluffPoint(left, row / rows));
  const b = new THREE.Vector3(...bluffPoint(right, row / rows));
  const c = new THREE.Vector3(...bluffPoint(left, (row + 1) / rows));
  const d = new THREE.Vector3(...bluffPoint(right, (row + 1) / rows));
  const along = u - col, across = v - row;
  const normal = new THREE.Vector3();
  // Sample the same triangle that the browser renders.
  if (along + across <= 1) {
    b.sub(a);
    c.sub(a);
    normal.crossVectors(b, c).normalize();
    a.addScaledVector(b, along).addScaledVector(c, across);
    return { point: a, up: normal.y };
  }
  c.sub(d);
  b.sub(d);
  normal.crossVectors(c, b).normalize();
  d.addScaledVector(c, 1 - along).addScaledVector(b, 1 - across);
  return { point: d, up: normal.y };
}

function landscapeMesh(name, pointAt, columns, rows, tint, castShadow) {
  const positions = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      positions.push(...pointAt(col / columns, row / rows));
      if (row === rows || col === columns) continue;
      const i = row * (columns + 1) + col;
      const next = i + columns + 1;
      indices.push(i, i + 1, next, next, i + 1, next + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < normals.count; i++) {
    tint(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], normals.getY(i)).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .91,
  }));
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = castShadow;
  return mesh;
}

function addHeadland(scene, random) {
  const color = new THREE.Color();
  const { minX, maxX, columns, rows } = headland;
  const strata = landscapeMesh('Stratified limestone headland',
    (u, v) => bluffPoint(lerp(minX, maxX, u), v),
    columns, rows, (x, y, z, up) => {
      const mineral = .50 + .29 * Math.sin(y * 1.88 + x * .091 + z * .072)
        + .17 * Math.sin(x * 1.67 + z * .81);
      const depth = (bluffPoint(x, 0)[2] - z) / 50;
      let cover = 0;
      for (const [gx, gd, width, length] of groves) {
        cover = Math.max(cover, gaussian(x - gx, width) * gaussian(depth - gd, length));
      }
      const growth = smoothstep(up + .13 * Math.sin(x * .29 + z * .58) + .16 * cover, .47, .86)
        * smoothstep(y, seaLevel + 1.0, seaLevel + 4.4);
      color.copy(darkStone).lerp(limestone, mineral).lerp(shale, .16 + .12 * Math.sin(z * .66));
      color.lerp(grass, growth * (.55 + .25 * cover + .12 * Math.sin(x * .31 - z * .51)));
      return color.multiplyScalar(.88 + random() * .24);
    }, true);
  scene.add(strata);
}

function addReefs(scene, random) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const vertices = geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const scale = 1 + .17 * Math.sin(9.7 * x + 12.2 * y + 5.8 * z);
    vertices.setXYZ(i, x * scale, y * scale, z * scale);
  }
  geometry.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({
    roughness: .94, flatShading: true,
  }), breakwaters.length * 34);
  rocks.name = 'Breakwaters and tidal boulders';
  rocks.receiveShadow = rocks.castShadow = true;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  let index = 0;
  for (const [x, z, width, depth] of breakwaters) {
    for (let i = 0; i < 34; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * .85;
      const size = i < 6 ? 1.7 + random() * 1.2 : .45 + random() * 1.5;
      transform.position.set(x + Math.cos(angle) * radius * width, seaLevel - .14 + (1 - radius) * .96,
        z + Math.sin(angle) * radius * depth);
      transform.rotation.set(random() * .75, angle, random() * .45);
      transform.scale.set(size * (1 + random() * .6), size * (.50 + random() * .37), size);
      transform.updateMatrix();
      rocks.setMatrixAt(index, transform.matrix);
      rocks.setColorAt(index++, color.copy(boulderColor).lerp(darkStone, random() * .65).multiplyScalar(.73 + random() * .40));
    }
  }
  scene.add(rocks);
}

function addVegetation(scene, random) {
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  const greenery = [];
  const trunks = [];
  const trees = [];
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();

  function addCrown(x, y, z, width, height, length, color) {
    transform.position.set(x, y, z);
    transform.rotation.set(random() * .30, random() * Math.PI * 2, random() * .32 - .16);
    transform.scale.set(width, height, length);
    transform.updateMatrix();
    greenery.push([transform.matrix.clone(), color.clone().multiplyScalar(lerp(.77, 1.21, random()))]);
  }

  function addBranch(start, end, width) {
    direction.subVectors(end, start);
    transform.position.copy(start).lerp(end, .5);
    transform.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    transform.scale.set(width, direction.length(), width);
    transform.updateMatrix();
    trunks.push(transform.matrix.clone());
  }

  for (const [x, depth, width, length] of groves) {
    for (let i = 0; i < 92; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random());
      const px = x + Math.cos(angle) * radius * width;
      const pd = depth + Math.sin(angle) * radius * length;
      const { point, up: slope } = plantableSurface(px, pd);
      if (point.y < 2.4 || slope < .42 || (Math.abs(px) < 29 && point.z > -42)) continue;
      const growTree = i < 34 && slope > .65 && trees.every(tree => tree.distanceToSquared(point) > 7.2);
      if (!growTree) {
        const size = lerp(.35, .97, random()) * (1.14 - radius * .31);
        tint.copy(scrub).lerp(brush, random() * .82);
        addCrown(point.x, point.y + size * .19, point.z, size, size * .47, size * .83, tint);
        addCrown(point.x + size * .33, point.y + size * .38, point.z - size * .17,
          size * .62, size * .51, size * .65, tint);
        continue;
      }
      trees.push(point);
      const cypress = random() < .37;
      const height = cypress ? lerp(2.8, 4.8, random()) : lerp(2.4, 4.2, random());
      const crown = point.clone().add(new THREE.Vector3((random() - .32) * .77, height, (random() - .5) * .54));
      const base = point.clone().addScaledVector(up, -.13);
      addBranch(base, crown, cypress ? .86 : 1.31);
      if (cypress) {
        const diameter = height * .16;
        tint.copy(scrub).lerp(pine, .35 + random() * .45);
        addCrown(crown.x, point.y + height * .64, crown.z, diameter, height * .42, diameter * .86, tint);
        addCrown(crown.x + .12, point.y + height * .92, crown.z, diameter * .58, height * .27, diameter * .57, tint);
        continue;
      }
      const spread = height * lerp(.34, .50, random());
      tint.copy(pine).lerp(brush, random() * .50);
      addCrown(crown.x, crown.y, crown.z, spread, spread * .47, spread * .94, tint);
      for (let lobe = 0; lobe < 5; lobe++) {
        const theta = angle + lobe * (Math.PI * 2 / 5);
        const tip = crown.clone().add(new THREE.Vector3(
          spread * .82 * Math.cos(theta), lerp(-.44, .32, random()), spread * .82 * Math.sin(theta),
        ));
        addBranch(base.clone().lerp(crown, .62), tip, .55);
        addCrown(tip.x, tip.y, tip.z, spread * .64, spread * .37, spread * .56, tint);
      }
    }
  }
  const canopy = new THREE.IcosahedronGeometry(1, 2);
  const positions = canopy.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const contour = 1 + .12 * Math.sin(12 * x + 8 * z) * Math.sin(9 * y - 6 * z);
    positions.setXYZ(i, x * contour, y * contour, z * contour);
  }
  canopy.computeBoundingSphere();
  const foliage = new THREE.InstancedMesh(canopy, new THREE.MeshStandardMaterial({ roughness: .92 }), greenery.length);
  foliage.name = 'Cypress, umbrella pines and cliff scrub';
  foliage.castShadow = foliage.receiveShadow = true;
  greenery.forEach(([matrix, color], i) => {
    foliage.setMatrixAt(i, matrix);
    foliage.setColorAt(i, color);
  });
  const wood = new THREE.InstancedMesh(new THREE.CylinderGeometry(.048, .115, 1, 7),
    new THREE.MeshStandardMaterial({ color: '#514335', roughness: .93 }), trunks.length);
  wood.name = 'Headland trunks and branches';
  wood.castShadow = wood.receiveShadow = true;
  trunks.forEach((matrix, i) => wood.setMatrixAt(i, matrix));
  scene.add(foliage);
  scene.add(wood);
}

function addFarHeadlands(scene) {
  const color = new THREE.Color();
  const distantStone = new THREE.Color('#697d94');
  for (const [cx, cz, span, depth, height] of [[-157,-144,104,48,29],[127,-202,147,83,46],[243,-378,208,112,68]]) {
    scene.add(landscapeMesh('Headland across the bay', (u, v) => {
      const x = (u - .5) * 2;
      const z = (v - .5) * 2;
      const profile = Math.max(0, 1 - Math.abs(x) ** 1.42 - (z * 1.04) ** 2);
      const relief = .65 + .23 * Math.cos(x * 8.1 + z * 2.8) + .12 * Math.sin(x * 16.5);
      return [cx + x * span, seaLevel - 1.0 + height * profile ** 1.23 * relief, cz - z * depth];
    }, 78, 36, (x, y, z, up) => color.copy(distantStone)
      .multiplyScalar(.93 + .14 * up + .08 * Math.sin(x * .28 + z * .13 + y * .81)), false));
  }
}

export function addHarbourCoast(scene, city) {
  const obsolete = [];
  city.traverse(mesh => {
    if (mesh.isMesh && (/^cliff[0-5]$/.test(mesh.material.name) || mesh.material.name === 'distance'
      || /^N01.*Scrub_and_cypress/.test(mesh.name))) obsolete.push(mesh);
  });
  for (const mesh of obsolete) mesh.removeFromParent();
  const random = randomGenerator();
  addHeadland(scene, random);
  addReefs(scene, random);
  addVegetation(scene, random);
  addFarHeadlands(scene);
}
