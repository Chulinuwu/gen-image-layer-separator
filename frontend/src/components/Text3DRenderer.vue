<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

const props = withDefaults(defineProps<{
  text: string;
  text3dStyle?: string;
  text3dDepth?: number;
  text3dBevel?: number;
  text3dMaterial?: string;
  text3dLightAngle?: number;
  text3dColor?: string;
  text3dSideColor?: string;
  width?: number;
  height?: number;
}>(), {
  text3dStyle: 'extruded',
  text3dDepth: 20,
  text3dBevel: 3,
  text3dMaterial: 'metallic',
  text3dLightAngle: 45,
  text3dColor: '#FFFFFF',
  text3dSideColor: '#888888',
  width: 400,
  height: 120,
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let loadedFont: InstanceType<typeof FontLoader> extends { parse(json: any): infer F } ? F : any;
let animFrameId: number = 0;

const getMaterial = (color: string, type: string): THREE.Material => {
  const c = new THREE.Color(color);
  switch (type) {
    case 'metallic':
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0.8, roughness: 0.2 });
    case 'glossy':
      return new THREE.MeshPhongMaterial({ color: c, shininess: 100, specular: new THREE.Color('#FFFFFF') });
    case 'matte':
      return new THREE.MeshLambertMaterial({ color: c });
    case 'neon':
      return new THREE.MeshBasicMaterial({ color: c });
    case 'glass':
      return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0, transmission: 0.6, thickness: 5 });
    case 'wood':
      return new THREE.MeshLambertMaterial({ color: new THREE.Color('#8B4513').lerp(c, 0.3) });
    default:
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0.3, roughness: 0.5 });
  }
};

const buildScene = () => {
  if (!canvasRef.value || !loadedFont) return;

  while (scene.children.length > 0) scene.remove(scene.children[0]);

  const lightRad = props.text3dLightAngle * Math.PI / 180;
  const lightX = Math.cos(lightRad) * 200;
  const lightY = Math.sin(lightRad) * 200 + 100;

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(lightX, lightY, 200);
  scene.add(dirLight);

  const ambLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambLight);

  if (props.text3dMaterial === 'neon') {
    const neonColor = new THREE.Color(props.text3dColor);
    const pointLight = new THREE.PointLight(neonColor, 2, 300);
    pointLight.position.set(0, 0, 50);
    scene.add(pointLight);
  }

  const depth = props.text3dStyle === 'engraved' ? props.text3dDepth * 0.5 : props.text3dDepth;
  const bevelEnabled = props.text3dBevel > 0;

  const geometry = new TextGeometry(props.text, {
    font: loadedFont,
    size: 40,
    depth: depth,
    curveSegments: 12,
    bevelEnabled: bevelEnabled,
    bevelThickness: props.text3dBevel,
    bevelSize: props.text3dBevel * 0.5,
    bevelOffset: 0,
    bevelSegments: 5,
  });

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const centerX = (bbox.max.x - bbox.min.x) / 2;
  const centerY = (bbox.max.y - bbox.min.y) / 2;

  const faceMat = getMaterial(props.text3dColor, props.text3dMaterial);
  const sideMat = getMaterial(props.text3dSideColor, props.text3dMaterial);

  const mesh = new THREE.Mesh(geometry, [faceMat, sideMat]);
  mesh.position.set(-centerX, -centerY, 0);

  if (props.text3dStyle === 'floating') {
    mesh.position.z = 10;
    const planeGeo = new THREE.PlaneGeometry(centerX * 3, centerY * 3);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.position.z = -5;
    scene.add(plane);
  }

  scene.add(mesh);

  const textWidth = bbox.max.x - bbox.min.x;
  const textHeight = bbox.max.y - bbox.min.y;
  const maxDim = Math.max(textWidth, textHeight);
  camera.position.z = maxDim * 1.2;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
};

const init = () => {
  if (!canvasRef.value) return;

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(50, props.width / props.height, 1, 1000);
  camera.position.z = 200;

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    alpha: true,
    antialias: true,
  });
  renderer.setSize(props.width, props.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const loader = new FontLoader();
  loader.load(
    'https://cdn.jsdelivr.net/npm/three@0.176.0/examples/fonts/helvetiker_bold.typeface.json',
    (font) => {
      loadedFont = font;
      buildScene();
    },
    undefined,
    (err) => {
      console.error('Font load failed:', err);
    },
  );
};

watch(
  () => [props.text, props.text3dStyle, props.text3dDepth, props.text3dBevel,
         props.text3dMaterial, props.text3dLightAngle, props.text3dColor, props.text3dSideColor],
  () => { if (loadedFont) buildScene(); },
);

watch(
  () => [props.width, props.height],
  () => {
    if (renderer && props.width > 0 && props.height > 0) {
      renderer.setSize(props.width, props.height);
      camera.aspect = props.width / props.height;
      camera.updateProjectionMatrix();
      if (loadedFont) buildScene();
    }
  },
);

onMounted(() => nextTick(init));

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (renderer) renderer.dispose();
});

const getDataURL = (): string => {
  if (!renderer) return '';
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
};

defineExpose({ getDataURL });
</script>

<template>
  <canvas
    ref="canvasRef"
    class="text3d-canvas"
    :width="width"
    :height="height"
  />
</template>

<style scoped>
.text3d-canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
