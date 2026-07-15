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

// ---------------- Monument Audio Setup (Matched to your folder files) ----------------
const monumentAudio = {
    arc: new Audio("music/arc.mp3"),
    bigben: new Audio("music/big_ben.mp3"),
    burjkhalifa: new Audio("music/burj_khalifa.mp3"),
    christ: new Audio("music/christ.mp3"),
    eiffel: new Audio("music/eiffel_tower.mp3"),
    statue: new Audio("music/liberty.mp3"),
    opera: new Audio("music/opera.mp3"),
    leaningtower: new Audio("music/pisa.mp3"),
    lotustemple: new Audio("music/lotus_temple.mp3"), // Matched to lotus_temple.mp3
    atlantisthepalm: new Audio("music/atlantis.mp3"), // Matched to atlantis.mp3
    dubaimuseumofthefuture: new Audio("music/museum.mp3"), // Matched to museum.mp3
    gardensbythebaytest: new Audio("music/garden.mp3"), // Matched to garden.mp3
    saintbasilscathedral: new Audio("music/cathedral.mp3") // Matched to cathedral.mp3
};

let currentAudio = null;
let isAudioUnlocked = false;

Object.values(monumentAudio).forEach(audio => {
    if (audio) {
        audio.preload = "auto";
        audio.loop = false;
        audio.volume = 0.35;
    }
});

function unlockAudioSystem() {
    if (isAudioUnlocked) return;
    Object.values(monumentAudio).forEach(audio => {
        if (audio) {
            audio.play().then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
        }
    });
    isAudioUnlocked = true;
}
document.addEventListener('click', unlockAudioSystem, { once: true });
document.addEventListener('touchstart', unlockAudioSystem, { once: true });

function stopCurrentAudio() {
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
}

function playMonumentAudio(modelName) {
    const key = modelName.replace(/_/g, "").toLowerCase(); 
    const audio = monumentAudio[key];
    stopCurrentAudio();
    if (audio) { audio.play().then(() => { currentAudio = audio; }).catch(() => {}); }
}

// ---------------- Core Configuration ----------------
const IDLE_TIMEOUT = 5000;
const ZOOM_MIN = 1.0;
const ZOOM_MAX = 4.0;

const ROTATION_SMOOTH_TIME = 0.22;
const SCALE_SMOOTH_TIME = 0.28;
const RECOVERY_SMOOTH_TIME = 0.45; 

// Baseline rotation speed
const IDLE_YAW_SPEED = 0.20; 
const IDLE_PITCH_SPEED = 0.25;
const IDLE_PITCH_AMPLITUDE = 0.15;

const rotationSession = { active: false, startX: 0, startY: 0, startRotX: 0, startRotY: 0 };
const zoomSession = { active: false, startDistance: 0, startScale: 1.0 };

// ---------------- Fine-Tuned Monument Constraints ----------------
const MODEL_CONFIGS = {
    "eiffel": { zoomMinFactor: 1.0, zoomMaxFactor: 4.0, customTargetHeight: 5.5, isEiffel: true },
    "bigben": { zoomMinFactor: 1.0, zoomMaxFactor: 3.5, customLightIntensity: 6.0, minRotationX: -0.3, maxRotationX: 0.3, dynamicGlowScale: true },
    "statue": { zoomMinFactor: 1.0, zoomMaxFactor: 4.0, initialRotationY: Math.PI, customIdleYawSpeed: 0.35 }, 
    "christ": { zoomMinFactor: 1.0, zoomMaxFactor: 4.0, initialRotationY: 0, customIdleYawSpeed: 0.35 },       
    "arc": { zoomMinFactor: 0.8, zoomMaxFactor: 2.0, minRotationX: -0.05, maxRotationX: 0.05 },
    "opera": { zoomMinFactor: 0.6, zoomMaxFactor: 4.0, customTargetHeight: 8.5 },
    "burj_khalifa": { 
        zoomMinFactor: 0.8, 
        zoomMaxFactor: 3.5, 
        customTargetHeight: 6.5,   
        scaleMultiplier: 1.2,       
        customLightIntensity: 12.0, 
        dynamicGlowScale: true,
        isBurj: true
    },
    "leaning_tower": { zoomMinFactor: 0.5, zoomMaxFactor: 4.0, minRotationX: 0.0, maxRotationX: 0.4 }, 
    "lotus_temple": { zoomMinFactor: 0.8, zoomMaxFactor: 4.0, customTargetHeight: 3.2 }, 
    "atlantis_the_palm": { 
        zoomMinFactor: 0.5, 
        zoomMaxFactor: 3.0, 
        customLightIntensity: 7.0,
        isAtlantis: true
    },
    "dubai_museum_of_the_future": { 
        zoomMinFactor: 0.6, 
        zoomMaxFactor: 3.5, 
        customLightIntensity: 6.5,
        customTargetHeight: 4.0
    },
    "gardensbythebaytest": { 
        zoomMinFactor: 0.35,            
        zoomMaxFactor: 1.8,             
        minRotationX: -0.02,            
        maxRotationX: 0.28,             
        customTargetHeight: 2.2,        
        customLightIntensity: 4.0
    },
    "saint_basils_cathedral": { 
        zoomMinFactor: 0.6, 
        zoomMaxFactor: 3.5, 
        customTargetHeight: 8.5, 
        customLightIntensity: 8.0, 
        isStBasil: true 
    }
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
renderer.domElement.style.position = "fixed";
renderer.domElement.style.zIndex = "1";
renderer.domElement.style.pointerEvents = "none";
document.body.appendChild(renderer.domElement);

const PARTICLE_COUNT = 150;
const particlesGeom = new THREE.BufferGeometry();
const posArray = new Float32Array(PARTICLE_COUNT * 3);
for (let i = 0; i < PARTICLE_COUNT * 3; i++) posArray[i] = (Math.random() - 0.5) * 20;
particlesGeom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
const particlesMat = new THREE.PointsMaterial({ size: 0.06, color: 0xBFEFFF, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending });
const particleSystem = new THREE.Points(particlesGeom, particlesMat);
scene.add(particleSystem);

const ambient = new THREE.AmbientLight(0x445566, 1.0);
scene.add(ambient);

// Top ambient overhead light
const topLight = new THREE.DirectionalLight(0xffffff, 3.0);
topLight.position.set(0, 10, 0);
scene.add(topLight);

// Right wing front light
const fillLight = new THREE.DirectionalLight(0xddf0ff, 1.5);
fillLight.position.set(5, 3, 5);
scene.add(fillLight);

// Left wing front light
const leftFillLight = new THREE.DirectionalLight(0xddf0ff, 0.0); 
leftFillLight.position.set(-5, 3, 5);
scene.add(leftFillLight);

// Rotation Pivot Group
const modelPivot = new THREE.Group();
scene.add(modelPivot);

// Centralizer Inner Group
const centralizerGroup = new THREE.Group();
modelPivot.add(centralizerGroup);

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

    let sanitizedPath = modelName;
    if (modelName.toLowerCase() === "burj_khalifa") sanitizedPath = "burj_khalifa";

    loader.load(`./models/${sanitizedPath}.glb`, (gltf) => {
        const incomingMonument = gltf.scene;
        
        // Reset scale/position so calculation starts fresh
        incomingMonument.scale.set(1, 1, 1);
        incomingMonument.position.set(0, 0, 0);

        // Strip helper/bounding box lines
        const itemsToRemove = [];
        incomingMonument.traverse((child) => {
            if (child.isLine || child.isLineSegments || child.name.toLowerCase().includes("helper") || child.name.toLowerCase().includes("border")) {
                itemsToRemove.push(child);
            }
        });
        itemsToRemove.forEach(item => {
            if (item.parent) {
                item.parent.remove(item);
            }
        });

        // Get bounding box dimensions after helper lines are stripped
        const box = new THREE.Box3().setFromObject(incomingMonument);
        const center = new THREE.Vector3();
        box.getCenter(center);
        
        const config = MODEL_CONFIGS[modelName];
        let scaleFactor = (config?.customTargetHeight || 5.0) / (box.max.y - box.min.y);
        if (config?.scaleMultiplier) scaleFactor *= config.scaleMultiplier;

        // Apply scale factor to the centralizer group
        centralizerGroup.scale.setScalar(scaleFactor);
        
        // Offset the model inside the centralizer to force its center onto (0, 0, 0)
        const pivotYOffset = config?.isBurj ? -2.2 : -1.0;
        incomingMonument.position.set(
            -center.x, 
            -box.min.y + (pivotYOffset / scaleFactor), 
            -center.z
        );
        incomingMonument.userData.floorY = incomingMonument.position.y;

        // Custom lighting configurations
        if (config?.isAtlantis) {
            topLight.intensity = 2.0;
            ambient.intensity = 1.5;
            fillLight.intensity = config.customLightIntensity * 0.65;     
            leftFillLight.intensity = config.customLightIntensity * 0.65; 
            topLight.position.set(0, 10, 0);
        } else if (config?.customLightIntensity) {
            topLight.intensity = config.customLightIntensity;
            ambient.intensity = config.customLightIntensity * 0.45;
            fillLight.intensity = config.customLightIntensity * 0.5;
            leftFillLight.intensity = 0.0; 
            topLight.position.set(0, config.isBurj ? 25 : 10, 5);
        } else {
            topLight.intensity = 3.0;
            ambient.intensity = 1.0;
            fillLight.intensity = 1.5;
            leftFillLight.intensity = 0.0; 
            topLight.position.set(0, 10, 0);
        }

        incomingMonument.traverse((child) => {
            if (child.isMesh && child.material) {
                if (config?.isEiffel) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x0088ff,
                        emissive: 0x002288,
                        roughness: 0.1,
                        metalness: 0.8
                    });
                }
                if (config?.isStBasil) {
                    child.material.roughness = 0.4; 
                    child.material.metalness = 0.2;
                }
                if (config?.isBurj) {
                    child.material.roughness = 0.2;
                    child.material.metalness = 0.6;
                    child.material.emissive = new THREE.Color(0x0d2b45); 
                    child.material.emissiveIntensity = 1.2;
                }
            }
        });

        baseScale = scaleFactor;
        
        const startingZoomFactor = config?.zoomMinFactor ?? 1.0;
        targetTransform.scale = currentTransform.scale = scaleFactor * startingZoomFactor;
        
        const initialRotY = config?.initialRotationY ?? 0;
        targetTransform.rotationY = currentTransform.rotationY = initialRotY; 
        targetTransform.rotationX = currentTransform.rotationX = 0;

        transformVelocity.rotationX = transformVelocity.rotationY = transformVelocity.scale = 0;
        rotationSession.active = zoomSession.active = false;

        zoomMinForModel = config?.zoomMinFactor ?? ZOOM_MIN;
        zoomMaxForModel = config?.zoomMaxFactor ?? ZOOM_MAX;

        // Clear existing monument out of centralizerGroup
        while(centralizerGroup.children.length > 0){ 
            centralizerGroup.remove(centralizerGroup.children[0]); 
        }
        
        monument = incomingMonument;
        centralizerGroup.add(monument);
        
        playMonumentAudio(modelName);
        if (loadingDiv) loadingDiv.style.display = "none";
        isInternalLoading = false;
    }, undefined, (err) => {
        console.error("Failed to parse resource target asset engine bundle link:", err);
        if (loadingDiv) loadingDiv.style.display = "none";
        isInternalLoading = false;
    });
}
window.loadModel = loadModel;

function getFingerDistance(state) {
    if (state.thumb && state.index) return Math.sqrt((state.index.x - state.thumb.x) ** 2 + (state.index.y - state.thumb.y) ** 2);
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
        const config = MODEL_CONFIGS[activeModelName];

        // --- ROTATION LOGIC ---
        if (!rotationSession.active) { 
            rotationSession.active = true; 
            rotationSession.startX = state.x; 
            rotationSession.startY = state.y; 
            rotationSession.startRotX = targetTransform.rotationX; 
            rotationSession.startRotY = targetTransform.rotationY; 
        }
        
        let dX = applyDeadZone(state.x - rotationSession.startX, 0.012), dY = applyDeadZone(state.y - rotationSession.startY, 0.012);
        let tY = rotationSession.startRotY + (dX * Math.PI * 1.16);
        let tX = rotationSession.startRotX - (dY * Math.PI * 0.65);

        if (config) {
            if (config.minRotationX !== undefined) tX = Math.max(config.minRotationX, tX);
            if (config.maxRotationX !== undefined) tX = Math.min(config.maxRotationX, tX);
            if (config.minRotationY !== undefined) tY = Math.max(config.minRotationY, tY);
            if (config.maxRotationY !== undefined) tY = Math.min(config.maxRotationY, tY);
        }

        targetTransform.rotationY = tY;
        targetTransform.rotationX = tX;

        // --- SYMMETRIC PINCH ZOOM LOGIC ---
        if (state.pinch) {
            const dist = getFingerDistance(state);
            if (!zoomSession.active) { 
                zoomSession.active = true; 
                zoomSession.startDistance = dist; 
                zoomSession.startScale = currentTransform.scale; 
            }
            
            const diff = (dist - zoomSession.startDistance) * 3.0; 
            let zoomRatio = 1.0;
            if (diff >= 0) {
                zoomRatio = 1.0 + diff;
            } else {
                zoomRatio = 1.0 / (1.0 + Math.abs(diff));
            }
            
            targetTransform.scale = Math.max(baseScale * zoomMinForModel, Math.min(baseScale * zoomMaxForModel, zoomSession.startScale * zoomRatio));
        } else { 
            zoomSession.active = false; 
        }
    } else {
        rotationSession.active = zoomSession.active = false;
        
        // --- HAND OUT OF FRAME / IDLE SYSTEM ---
        if (isIdle) { 
            const config = MODEL_CONFIGS[activeModelName];
            const targetHomeX = 0;

            const targetScale = baseScale * (config?.zoomMinFactor ?? 1.0);
            const scaleDiff = Math.abs(targetTransform.scale - targetScale);
            const pitchDiff = Math.abs(targetTransform.rotationX - targetHomeX);

            if (scaleDiff > 0.05 || pitchDiff > 0.05) {
                targetTransform.rotationX = targetHomeX;
                targetTransform.scale = targetScale;
            } else {
                const currentYawSpeed = config?.customIdleYawSpeed ?? IDLE_YAW_SPEED;
                targetTransform.rotationY += currentYawSpeed * deltaTime; 
                targetTransform.rotationX = Math.sin(elapsedTime * IDLE_PITCH_SPEED) * IDLE_PITCH_AMPLITUDE; 
            }
        }
    }

    const activeSmoothTime = isIdle ? RECOVERY_SMOOTH_TIME : ROTATION_SMOOTH_TIME;
    currentTransform.rotationY = smoothDampScalar(currentTransform.rotationY, targetTransform.rotationY, transformVelocity, "rotationY", activeSmoothTime, deltaTime);
    currentTransform.rotationX = smoothDampScalar(currentTransform.rotationX, targetTransform.rotationX, transformVelocity, "rotationX", activeSmoothTime, deltaTime);
    currentTransform.scale = smoothDampScalar(currentTransform.scale, targetTransform.scale, transformVelocity, "scale", SCALE_SMOOTH_TIME, deltaTime);

    // --- DYNAMIC GLOW INTENSITY ADJUSTMENT ---
    const config = MODEL_CONFIGS[activeModelName];
    if (config?.dynamicGlowScale && baseScale > 0) {
        const currentZoomRatio = currentTransform.scale / baseScale;
        const baseGlow = config.customLightIntensity ?? 6.0;
        
        topLight.intensity = baseGlow * currentZoomRatio;
        ambient.intensity = (baseGlow * 0.45) * currentZoomRatio;
        fillLight.intensity = (baseGlow * 0.5) * currentZoomRatio;
    }

    if (monument) {
        modelPivot.rotation.set(currentTransform.rotationX, currentTransform.rotationY, 0);
        centralizerGroup.scale.setScalar(currentTransform.scale);
        monument.position.y = (monument.userData.floorY || 0) + Math.sin(elapsedTime * 1.6) * (0.08 / currentTransform.scale);
    }

    renderer.render(scene, camera);
}
animate();