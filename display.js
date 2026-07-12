/**
 * display.js
 * Handles the Three.js rendering cycle, interpolation algorithms,
 * dynamic environmental assets, and smooth cinematic glow effects.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// ---------------- Initializing Shared Hand State ----------------
window.handState = window.handState || {
    detected: false, x: 0, y: 0, pinch: false, pinchStrength: 0, 
    openPalm: false, closedFist: false, lastSeen: Date.now()
};

// ---------------- Monument Audio Setup ----------------
const monumentAudio = {
    arc: new Audio("music/arc.mp3"),
    bigben: new Audio("music/big_ben.mp3"),
    burjkhalifa: new Audio("music/burj_khalifa.mp3"),
    christ: new Audio("music/christ.mp3"),
    eiffel: new Audio("music/eiffel_tower.mp3"),
    statue: new Audio("music/liberty.mp3"),
    opera: new Audio("music/opera.mp3"),
    leaningtower: new Audio("music/pisa.mp3")
};

let currentAudio = null;
let isAudioUnlocked = false;

// Initialize configuration
Object.values(monumentAudio).forEach(audio => {
    if (audio) {
        audio.preload = "auto";
        audio.loop = false;
        audio.volume = 0.35;
    }
});

// Unlock audio on first interaction
function unlockAudioSystem() {
    if (isAudioUnlocked) return;
    
    Object.values(monumentAudio).forEach(audio => {
        if (audio) {
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
                console.log("Audio system unlocked successfully.");
            }).catch(() => {});
        }
    });
    isAudioUnlocked = true;
    document.removeEventListener('click', unlockAudioSystem);
    document.removeEventListener('touchstart', unlockAudioSystem);
}

document.addEventListener('click', unlockAudioSystem, { once: true });
document.addEventListener('touchstart', unlockAudioSystem, { once: true });

function stopCurrentAudio() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
}

function playMonumentAudio(modelName) {
    console.log("Selected model (raw):", modelName);
    
    // Standardize key to match object keys (remove underscores)
    const key = modelName.replace(/_/g, "").toLowerCase(); 
    const audio = monumentAudio[key];
    
    console.log("Audio object found:", !!audio, "for key:", key);

    stopCurrentAudio();

    if (audio) {
        console.log("Calling play() for:", key);
        audio.play()
            .then(() => {
                console.log("Playback started for:", key);
                currentAudio = audio;
            })
            .catch(err => {
                console.error("Playback failed for", key, ":", err);
            });
    } else {
        console.warn("No audio file mapped for key:", key);
    }
}

// ---------------- Core Configuration ----------------
const IDLE_TIMEOUT = 5000;
const ZOOM_MIN = 1.0;
const ZOOM_MAX = 4.0;
const CAMERA_SAFETY_MARGIN = 2.0;

// ---------------- Motion Feel Tuning ----------------
const ROTATION_SMOOTH_TIME = 0.22;
const IDLE_ROTATION_SMOOTH_TIME = 0.9;
const SCALE_SMOOTH_TIME = 0.28;
const IDLE_YAW_SPEED = 0.12;
const IDLE_PITCH_SPEED = 0.25;
const IDLE_PITCH_AMPLITUDE = 0.15;

// ---------------- Independent Session Anchors ----------------
const rotationSession = { active: false, startX: 0, startY: 0, startRotX: 0, startRotY: 0 };
const zoomSession = { active: false, startDistance: 0, startScale: 1.0 };

const MODEL_CONFIGS = {
    "arc": { zoomMinFactor: 1.0, zoomMaxFactor: 2.6, minRotationX: -0.25, maxRotationX: 0.25, minRotationY: -0.9, maxRotationY: 0.9 },
    "opera": { zoomMinFactor: 0.4, zoomMaxFactor: 7.0, cameraSafetyMargin: 0.35, minRotationX: -0.8, maxRotationX: 0.8, minRotationY: -2.5, maxRotationY: 2.5 },
    "bigben": { 
        zoomMinFactor: 1.0, 
        zoomMaxFactor: 3.5, 
        accentHemiLight: { sky: 0xffb84d, ground: 0x4d3319, intensity: 1.2 },
        minRotationX: -0.3, maxRotationX: 0.3, minRotationY: -3.14, maxRotationY: 3.14 
    },
    "burj_khalifa": { zoomMinFactor: 0.8, zoomMaxFactor: 4.5, cameraSafetyMargin: 0.5, customLightIntensity: 5.0, customTargetHeight: 1.5625, scaleMultiplier: 3.2, minRotationX: -0.2, maxRotationX: 0.4, minRotationY: -3.14, maxRotationY: 3.14 },
    "leaning_tower": { customTargetWidth: 10, zoomMinFactor: 0.3, zoomMaxFactor: 5.5, cameraSafetyMargin: 0.2, rotationScale: 0.45, accentHemiLight: { sky: 0xffe9c2, ground: 0x35492f, intensity: 1.1 }, minRotationX: -0.35, maxRotationX: 0.35, minRotationY: -3.14, maxRotationY: 3.14 }
};

let activeModelName = "eiffel";
let currentTransform = { rotationX: 0, rotationY: 0, scale: 1.0 };
let targetTransform = { rotationX: 0, rotationY: 0, scale: 1.0 };
let transformVelocity = { rotationX: 0, rotationY: 0, scale: 0 };
let baseScale = 1.0;
let zoomMaxForModel = ZOOM_MAX;
let zoomMinForModel = ZOOM_MIN;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 12);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.domElement.style.position = "fixed";
renderer.domElement.style.zIndex = "1";
renderer.domElement.style.pointerEvents = "none";
document.body.appendChild(renderer.domElement);

// ---------------- Subtle Particle Atmosphere ----------------
const PARTICLE_COUNT = 150;
const particlesGeom = new THREE.BufferGeometry();
const posArray = new Float32Array(PARTICLE_COUNT * 3);
for (let i = 0; i < PARTICLE_COUNT * 3; i++) posArray[i] = (Math.random() - 0.5) * 20;
particlesGeom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
const particlesMat = new THREE.PointsMaterial({
    size: 0.06, color: 0xBFEFFF, transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
});
const particleSystem = new THREE.Points(particlesGeom, particlesMat);
particleSystem.position.set(0, 0, 0);
scene.add(particleSystem);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const neutralEnvMap = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();

const ambient = new THREE.AmbientLight(0x445566, 1.0);
scene.add(ambient);
const orbitLight1 = new THREE.PointLight(0x00ffff, 4, 30);
scene.add(orbitLight1);
const orbitLight2 = new THREE.PointLight(0xff00aa, 3.5, 30);
scene.add(orbitLight2);
const topLight = new THREE.DirectionalLight(0xffffff, 3.0);
topLight.position.set(0, 10, 0);
scene.add(topLight);
const accentHemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
scene.add(accentHemiLight);

const modelPivot = new THREE.Group();
scene.add(modelPivot);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

let monument = null;
let isInternalLoading = false;

async function loadModel(modelName) {
    if (isInternalLoading) return;
    isInternalLoading = true;
    activeModelName = modelName;
    const loadingDiv = document.getElementById("loading-overlay");
    if (loadingDiv) loadingDiv.style.display = "flex";

    loader.load(`./models/${modelName}.glb`, (gltf) => {
        const incomingMonument = gltf.scene;
        incomingMonument.scale.setScalar(1);
        incomingMonument.position.set(0, 0, 0);
        const box = new THREE.Box3().setFromObject(incomingMonument);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);

        const config = MODEL_CONFIGS[modelName];
        let scaleFactor = config?.customTargetWidth !== undefined ? (config.customTargetWidth / Math.max(size.x, size.z)) : ((config?.customTargetHeight || 5.0) / (size.y || 1.0));
        if (config?.scaleMultiplier) scaleFactor *= config.scaleMultiplier;

        incomingMonument.scale.setScalar(scaleFactor);
        incomingMonument.position.set(-center.x * scaleFactor, -box.min.y * scaleFactor - 1.0, -center.z * scaleFactor);
        incomingMonument.userData.floorY = incomingMonument.position.y;

        if (config?.customLightIntensity) { topLight.intensity = config.customLightIntensity; ambient.intensity = config.customLightIntensity * 0.4; }
        else { topLight.intensity = 3.0; ambient.intensity = 1.0; }
        
        accentHemiLight.intensity = config?.accentHemiLight ? config.accentHemiLight.intensity : 0;
        if (config?.accentHemiLight) { accentHemiLight.color.set(config.accentHemiLight.sky); accentHemiLight.groundColor.set(config.accentHemiLight.ground); }

        if (modelName === "burj_khalifa") {
            incomingMonument.traverse((child) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(mat => { mat.envMap = neutralEnvMap; mat.envMapIntensity = 1.4; mat.needsUpdate = true; });
                }
            });
        }

        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        const modelCenterWorld = new THREE.Vector3(incomingMonument.position.x, incomingMonument.userData.floorY + (size.y * scaleFactor) / 2, incomingMonument.position.z);
        const maxZoomFactor = (camera.position.distanceTo(modelCenterWorld) - (config?.cameraSafetyMargin ?? CAMERA_SAFETY_MARGIN)) / (sphere.radius * scaleFactor);
        zoomMinForModel = config?.zoomMinFactor ?? ZOOM_MIN;
        zoomMaxForModel = Math.min(config?.zoomMaxFactor ?? ZOOM_MAX, Math.max(zoomMinForModel, maxZoomFactor));

        baseScale = scaleFactor;
        targetTransform.scale = currentTransform.scale = scaleFactor;
        targetTransform.rotationX = targetTransform.rotationY = currentTransform.rotationX = currentTransform.rotationY = 0;
        transformVelocity.rotationX = transformVelocity.rotationY = transformVelocity.scale = 0;
        rotationSession.active = zoomSession.active = false;

        if (monument) { modelPivot.remove(monument); monument.traverse(c => { if(c.isMesh) { c.geometry?.dispose(); (Array.isArray(c.material)?c.material.forEach(m=>m.dispose()):c.material.dispose()); } }); }
        monument = incomingMonument;
        modelPivot.add(monument);
        
        playMonumentAudio(modelName);

        if (loadingDiv) loadingDiv.style.display = "none";
        isInternalLoading = false;
    });
}
window.loadModel = loadModel;

function getFingerDistance(state) {
    if (typeof state.pinchDistance === 'number') return state.pinchDistance;
    if (state.thumb && state.index) return Math.sqrt((state.index.x-state.thumb.x)**2 + (state.index.y-state.thumb.y)**2 + ((state.index.z||0)-(state.thumb.z||0))**2);
    return 1.0 - (state.pinchStrength || 0);
}

function applyDeadZone(delta, threshold) { return Math.abs(delta) < threshold ? 0 : Math.sign(delta) * (Math.abs(delta) - threshold); }

function smoothDampScalar(current, target, velocityState, key, smoothTime, deltaTime) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime, x = omega * deltaTime, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target, temp = (velocityState[key] + omega * change) * deltaTime;
    velocityState[key] = (velocityState[key] - omega * temp) * exp;
    let output = target + (change + temp) * exp;
    if ((target - current > 0) === (output > target)) { output = target; velocityState[key] = (output - target) / deltaTime; }
    return output;
}

const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = Math.min(clock.getDelta(), 0.1), elapsedTime = clock.elapsedTime, state = window.handState;
    const isIdle = !state.detected || (Date.now() - state.lastSeen > IDLE_TIMEOUT);

    if (!isIdle && !state.closedFist && !state.openPalm) {
        const config = MODEL_CONFIGS[activeModelName], rotMult = config?.rotationScale ?? 1.0;

        if (!rotationSession.active) { rotationSession.active = true; rotationSession.startX = state.x; rotationSession.startY = state.y; rotationSession.startRotX = targetTransform.rotationX; rotationSession.startRotY = targetTransform.rotationY; }
        let dX = applyDeadZone(state.x - rotationSession.startX, 0.012), dY = applyDeadZone(state.y - rotationSession.startY, 0.012);
        let tY = rotationSession.startRotY + (dX * Math.PI * 1.16 * rotMult), tX = rotationSession.startRotX - (dY * Math.PI * 0.65 * rotMult);
        if (config) { tX = Math.max(config.minRotationX ?? -Infinity, Math.min(config.maxRotationX ?? Infinity, tX)); tY = Math.max(config.minRotationY ?? -Infinity, Math.min(config.maxRotationY ?? Infinity, tY)); }
        if (Math.abs(tY - targetTransform.rotationY) > 0.008) targetTransform.rotationY = tY;
        if (Math.abs(tX - targetTransform.rotationX) > 0.008) targetTransform.rotationX = tX;

        if (state.pinch) {
            const dist = getFingerDistance(state);
            if (!zoomSession.active) { zoomSession.active = true; zoomSession.startDistance = dist; zoomSession.startScale = currentTransform.scale; }
            let dDist = applyDeadZone(dist - zoomSession.startDistance, 0.015);
            let zoomRatio = 1.0 + (dDist * 2.0);
            let nS = Math.max(baseScale * zoomMinForModel, Math.min(baseScale * zoomMaxForModel, zoomSession.startScale * zoomRatio));
            if (Math.abs(nS - targetTransform.scale) > 0.008) targetTransform.scale = nS;
        } else { zoomSession.active = false; }
    } else {
        rotationSession.active = zoomSession.active = false;
        if (state.openPalm) { targetTransform.rotationX = targetTransform.rotationY = 0; targetTransform.scale = baseScale; }
        else if (isIdle) {
            targetTransform.rotationY += IDLE_YAW_SPEED * deltaTime;
            targetTransform.rotationX = Math.sin(elapsedTime * IDLE_PITCH_SPEED) * IDLE_PITCH_AMPLITUDE;
            targetTransform.scale = baseScale + Math.sin(elapsedTime * 0.6) * (baseScale * 0.03);
        }
    }

    const positions = particlesGeom.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        let i3 = i * 3;
        positions[i3 + 1] += Math.sin(elapsedTime * 0.2 + i) * 0.001;
        positions[i3] += Math.cos(elapsedTime * 0.2 + i) * 0.001;
    }
    particlesGeom.attributes.position.needsUpdate = true;

    currentTransform.rotationY = smoothDampScalar(currentTransform.rotationY, targetTransform.rotationY, transformVelocity, "rotationY", isIdle ? IDLE_ROTATION_SMOOTH_TIME : ROTATION_SMOOTH_TIME, deltaTime);
    currentTransform.rotationX = smoothDampScalar(currentTransform.rotationX, targetTransform.rotationX, transformVelocity, "rotationX", isIdle ? IDLE_ROTATION_SMOOTH_TIME : ROTATION_SMOOTH_TIME, deltaTime);
    currentTransform.scale = smoothDampScalar(currentTransform.scale, targetTransform.scale, transformVelocity, "scale", SCALE_SMOOTH_TIME, deltaTime);

    if (monument) {
        modelPivot.rotation.set(currentTransform.rotationX, currentTransform.rotationY, 0);
        monument.scale.setScalar(currentTransform.scale);
        monument.position.y = (monument.userData.floorY ?? 0) + Math.sin(elapsedTime * 1.6) * 0.08;
    }

    renderer.render(scene, camera);
}
animate();