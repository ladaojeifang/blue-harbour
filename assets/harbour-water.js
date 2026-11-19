import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { breakwaters } from './harbour-coast.js';

// Gravity-wave dispersion keeps the longer swells faster than the short surface waves.
const waves = `
  vec3 gravityWave(vec2 p, vec2 dir, float k, float amplitude, float t) {
    float phase = dot(p, dir) * k - sqrt(9.81 * k) * t;
    return vec3(amplitude * sin(phase), dir * (amplitude * k * cos(phase)));
  }
  vec3 swell(vec2 p, float t) {
    float shelter = .29 + .71 * smoothstep(0.0, 17.0, max(abs(p.x) - 30.0, p.y - 24.0));
    return shelter * (gravityWave(p, vec2(.82, .5724), 1.04, .085, t)
         + gravityWave(p, vec2(-.332, .9433), 1.81, .045, t)
         + gravityWave(p, vec2(.21, .9777), 2.72, .024, t)
         + gravityWave(p, vec2(.976, -.2178), 4.67, .012, t));
  }
`;

const shader = {
  name: 'Planar harbour sea',
  uniforms: {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...Reflector.ReflectorShader.uniforms,
    time: { value: 0 },
    sunDirection: { value: null },
    sunRadiance: { value: null },
    deepWater: { value: new THREE.Color('#082e49') },
    scattering: { value: new THREE.Color('#1e8791') },
    reefs: { value: breakwaters.map(reef => new THREE.Vector4(...reef)) },
  },
  vertexShader: `
    #include <fog_pars_vertex>
    uniform mat4 textureMatrix;
    uniform float time;
    varying vec3 worldPosition;
    varying vec4 reflectionCoord;
    ${waves}
    void main() {
      reflectionCoord = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      float fade = 1.0 - smoothstep(32.0, 63.0, max(abs(world.x), abs(world.z - 11.0)));
      world.y += swell(world.xz, time).x * fade;
      worldPosition = world.xyz;
      vec4 mvPosition = viewMatrix * world;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: `
    #include <fog_pars_fragment>
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec3 sunDirection, sunRadiance, deepWater, scattering;
    uniform vec4 reefs[${breakwaters.length}];
    varying vec3 worldPosition;
    varying vec4 reflectionCoord;
    ${waves}
    vec2 windRipple(vec2 p, vec2 direction, float k, float amplitude) {
      float spatial = dot(p, direction) * k;
      float ripple = cos(spatial - sqrt(9.81 * k) * time);
      return direction * amplitude * ripple * (1.0 - smoothstep(.67, 2.8, fwidth(spatial)));
    }
    float waterlineFoam(vec2 p) {
      float distanceToEye = length(cameraPosition - worldPosition);
      if (distanceToEye > 190.0 || abs(p.x) > 63.0 || abs(p.y) > 45.0) return 0.0;
      float tide = .06 * sin(time * 1.42 + p.x * .76 + p.y * 1.12);
      float eddy = .035 * sin(p.x * 3.9 + p.y * 4.7 - time * 1.3)
                 + .07 * sin(p.x * 1.7 - p.y * 2.3 + time * .51);
      float broken = smoothstep(-.47, .60, sin(p.x * 1.3 + sin(p.y * 2.5) + time * .45));
      float foam = 0.0;
      for (int i = 0; i < ${breakwaters.length}; i++) {
        float shore = length((p - reefs[i].xy) / reefs[i].zw);
        foam = max(foam, (1.0 - smoothstep(.025, .14, abs(shore - .95 + tide + eddy))) * broken);
      }
      return foam * (1.0 - smoothstep(85.0, 190.0, distanceToEye));
    }
    void main() {
      vec2 p = worldPosition.xz;
      vec3 view = normalize(cameraPosition - worldPosition);
      vec2 slope = swell(p, time).yz;
      slope *= 1.0 - smoothstep(.55, 2.1, length(fwidth(p)));
      vec2 warped = p + .11 * sin(p.yx * .73 + vec2(time * .4, -time * .62));
      slope += windRipple(warped, vec2(.963, .2695), 12.8, .047)
             + windRipple(warped, vec2(.48, .8773), 19.0, .038)
             + windRipple(warped, vec2(-.27, .9629), 29.0, .024)
             + windRipple(warped, vec2(.887, -.4617), 39.0, .018);
      vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
      float facing = clamp(dot(view, normal), 0.0, 1.0);
      // Air to seawater (IOR ≈ 1.34).
      float fresnel = .021 + .979 * pow(1.0 - facing, 5.0);
      vec2 uv = reflectionCoord.xy / reflectionCoord.w;
      vec2 viewSlope = (mat3(viewMatrix) * vec3(-slope.x, 0.0, -slope.y)).xy;
      float edge = smoothstep(0.0, .037, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
      uv += viewSlope * (.075 + .066 * (1.0 - facing)) * edge;
      vec3 reflection = texture2D(tDiffuse, clamp(uv, .001, .999)).rgb;

      float depth = .7 + smoothstep(1.0, 34.0, max(abs(p.x) - 31.0, p.y - 21.0)) * 3.3;
      vec3 transmittance = exp(-vec3(.96, .37, .25) * depth / max(.25, facing));
      vec3 body = deepWater + scattering * transmittance * (.18 + .38 * max(dot(normal, sunDirection), 0.0));

      vec3 halfVector = normalize(view + sunDirection);
      float nh = max(dot(normal, halfVector), 0.0);
      float roughness = .077;
      float a2 = roughness * roughness;
      float denom = nh * nh * (a2 - 1.0) + 1.0;
      float glint = a2 / (3.14159 * denom * denom);
      float lit = max(dot(normal, sunDirection), 0.0);
      float vh = max(dot(view, halfVector), 0.0);
      float solarFresnel = .021 + .979 * pow(1.0 - vh, 5.0);
      vec3 color = mix(body, reflection, fresnel) + sunRadiance * glint * lit * solarFresnel * .54;
      color = mix(color, vec3(.53, .69, .74), waterlineFoam(p) * .48);
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};

function seaGeometry(bounds) {
  const x = [bounds.min.x], z = [bounds.min.z];
  for (let i = -68; i <= 68; i += .48) x.push(i);
  for (let i = -53; i <= 91; i += .48) z.push(i);
  x.push(bounds.max.x);
  z.push(bounds.max.z);
  const geometry = new THREE.PlaneGeometry(1, 1, x.length - 1, z.length - 1);
  const positions = geometry.attributes.position;
  const center = bounds.getCenter(new THREE.Vector3());
  for (let row = 0; row < z.length; row++) {
    for (let col = 0; col < x.length; col++) {
      positions.setXY(row * x.length + col, x[col] - center.x, center.z - z[row]);
    }
  }
  geometry.computeBoundingSphere();
  return { geometry, center };
}

export function replaceSeaSurface(source, sun) {
  const { geometry, center } = seaGeometry(new THREE.Box3().setFromObject(source));
  const sea = new Reflector(geometry, { shader, clipBias: .00025, multisample: 2 });
  sea.name = 'Harbour water with planar reflections';
  sea.rotation.x = -Math.PI / 2;
  sea.position.copy(center);
  sea.material.name = 'water';
  sea.material.fog = true;
  sea.material.uniforms.sunDirection.value = sun.position.clone().sub(sun.target.position).normalize();
  sea.material.uniforms.sunRadiance.value = sun.color.clone().multiplyScalar(sun.intensity);
  const renderReflection = sea.onBeforeRender;
  sea.onBeforeRender = function (renderer, scene, camera, ...args) {
    if (!scene.overrideMaterial) renderReflection.call(this, renderer, scene, camera, ...args);
  };
  return sea;
}
