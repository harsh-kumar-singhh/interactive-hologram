/**
 * display.js
 * Handles the Three.js rendering cycle, interpolation algorithms,
 * dynamic environmental assets, and smooth cinematic glow effects.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ---------------- Initializing Shared Hand State ----------------
window.handState = window.handState || {
    detected: false,
    x: 0,
    y: 0,
    pinch: false,
    pinchStrength: 0,
    openPalm: false,
    closedFist: false,
    lastSeen: Date.now()
};

// ---------------- Core Graphics Configuration ----------------
const LERP_FACTOR = 0.045;
const IDLE_TIMEOUT = 5000;
const ZOOM_MIN = 1.0;
const ZOOM_MAX = 4.0; // Upper bound requested by design — actual usable max is clamped per-model below
const CAMERA_SAFETY_MARGIN = 2.0; // Minimum distance to keep between the camera and the model's surface at max zoom

// Model-Specific Interaction Matrix Configuration
const MODEL_CONFIGS = {
    "arc": {
        zoomMinFactor: 1.0,
        zoomMaxFactor: 2.6,
        minRotationX: -0.25,
        maxRotationX: 0.25,
        minRotationY: -0.9,
        maxRotationY: 0.9
    },
    "opera": {
        zoomMinFactor: 0.4, // Allows zooming further out to capture the wide footprint
        zoomMaxFactor: 7.0,
        cameraSafetyMargin: 0.35, // Tailored safety clearance allowing closer structural inspection without mesh clipping
        minRotationX: -0.8,
        maxRotationX: 0.8,
        minRotationY: -2.5,
        maxRotationY: 2.5
    }
};

// Tracks currently active model key globally for conditional tracking logic inside loop
let activeModelName = "eiffel";

// Persistent tracking transforms
let currentTransform = { rotationX: 0, rotationY: 0, scale: 1.0 };
let targetTransform = { rotationX: 0, rotationY: 0, scale: 1.0 };
let baseScale = 1.0; // Anchors structural baseline scaling per-model to prevent compounding feedback loops
let zoomMaxForModel = ZOOM_MAX; // Recomputed per model so the camera can never end up inside hollow geometry
let zoomMinForModel = ZOOM_MIN;

const scene = new THREE.Scene();

// Immersive neon cyber-blue environment color spaces
scene.background = new THREE.Color(0x000000);
//scene.fog = new THREE.FogExp2(0x000000, 0.025);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 12);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Explicit, correct color management: sRGB output and no tone-mapping curve,
// so textures/base colors baked into the GLBs come through as authored
// instead of being shifted by an implicit/default renderer setting.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

// Pull the canvas to the front layer so it is never covered by the HTML body element
renderer.domElement.style.position = "fixed";
renderer.domElement.style.top = "0";
renderer.domElement.style.left = "0";
renderer.domElement.style.width = "100vw";
renderer.domElement.style.height = "100vh";
renderer.domElement.style.zIndex = "1";
renderer.domElement.style.pointerEvents = "none";
document.body.appendChild(renderer.domElement);

// ---------------- Dynamic Ambient & Orbiting Lights ----------------
// Rebalanced from a saturated blue ambient + very intense cyan/magenta point
// lights (which were strong enough to wash pale/white monuments toward cyan)
// to a more neutral ambient and toned-down accent lights. Same lights, same
// hues, same orbit motion — just weighted so true material color reads
// through instead of being overpowered.
const ambient = new THREE.AmbientLight(0x445566, 1.0);
scene.add(ambient);
const orbitLight1 = new THREE.PointLight(0x00ffff, 4, 30);
scene.add(orbitLight1);
const orbitLight2 = new THREE.PointLight(0xff00aa, 3.5, 30);
scene.add(orbitLight2);
const topLight = new THREE.DirectionalLight(0xffffff, 3.0);
topLight.position.set(0, 10, 0);
scene.add(topLight);

// ---------------- Interactive Particles System ----------------
const particleCount = 200;
const particleGeometry = new THREE.BufferGeometry();
const particlePositions = new Float32Array(particleCount * 3);
const particleSpeeds = new Float32Array(particleCount);
for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.2 + Math.random() * 3.0;

    particlePositions[i * 3] = Math.cos(angle) * radius;
    particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 6;
    particlePositions[i * 3 + 2] = Math.sin(angle) * radius;

    particleSpeeds[i] = 0.4 + Math.random() * 0.6;
}
particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
const particleMaterial = new THREE.PointsMaterial({
    color: 0x33ccff,
    size: 0.06,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particleSystem);

// ---------------- Model Parsing Routine ----------------
const loader = new GLTFLoader();
let monument = null;
let isInternalLoading = false; // Prevents race conditions during simultaneous dynamic requests

/**
 * Reusable loadModel function supporting explicit resource cleanup and pipeline binding.
 * Exposed globally so a Supabase listener can trigger model swaps.
 */
async function loadModel(modelName) {
    if (isInternalLoading) return;
    isInternalLoading = true;
    activeModelName = modelName;

    const loadingDiv = document.getElementById("loading-overlay");
    if (loadingDiv) loadingDiv.style.display = "flex";

    // 1. Fetch the target model in the background before removing the current one
    loader.load(
        `./models/${modelName}.glb`,
        (gltf) => {
            const incomingMonument = gltf.scene;

            // Materials are left exactly as authored in the GLB — original base
            // color, textures, PBR maps (metalness/roughness/normal), and vertex
            // colors all come through untouched.

            // Measure the model at its native, unscaled size FIRST.
            incomingMonument.scale.setScalar(1);
            incomingMonument.position.set(0, 0, 0);

            const box = new THREE.Box3().setFromObject(incomingMonument);
            const center = new THREE.Vector3();
            const size = new THREE.Vector3();
            box.getCenter(center);
            box.getSize(size);

            // Normalized structural scaling applied perfectly across all future assets
            const targetHeight = 5.0;
            const scaleFactor = targetHeight / (size.y || 1.0);

            // Apply scale, THEN derive position offsets in the same (scaled) units.
            document.body.appendChild(renderer.domElement); // Retain original layout integrity
            incomingMonument.scale.setScalar(scaleFactor);
            incomingMonument.position.x = -center.x * scaleFactor;
            incomingMonument.position.z = -center.z * scaleFactor;

            const floorY = -box.min.y * scaleFactor - 1.0;
            incomingMonument.position.y = floorY;

            // Cache the resting floor height once. The render loop uses this instead
            // of recomputing a world-space bounding box every frame
            incomingMonument.userData.floorY = floorY;

            // ---- Safe zoom cap ----
            const config = MODEL_CONFIGS[modelName];
            const activeSafetyMargin = config && config.cameraSafetyMargin !== undefined ? config.cameraSafetyMargin : CAMERA_SAFETY_MARGIN;

            const sphere = new THREE.Sphere();
            box.getBoundingSphere(sphere); // computed on the unscaled box
            const modelCenterWorld = new THREE.Vector3(
                incomingMonument.position.x,
                floorY + (size.y * scaleFactor) / 2,
                incomingMonument.position.z
            );
            const cameraDistance = camera.position.distanceTo(modelCenterWorld);
            const baseRadius = sphere.radius * scaleFactor; // bounding sphere radius at baseScale

            const maxZoomFactor = (cameraDistance - activeSafetyMargin) / baseRadius;
            
            // Set dynamic baseline limits based on individual properties or calculated safety dimensions
            const defaultMaxZoom = config && config.zoomMaxFactor ? config.zoomMaxFactor : ZOOM_MAX;
            const defaultMinZoom = config && config.zoomMinFactor ? config.zoomMinFactor : ZOOM_MIN;
            
            zoomMinForModel = defaultMinZoom;
            zoomMaxForModel = Math.min(defaultMaxZoom, Math.max(zoomMinForModel, maxZoomFactor));

            baseScale = scaleFactor;
            targetTransform.scale = scaleFactor;
            currentTransform.scale = scaleFactor;

            // Reset target rotations on hot-swaps to avoid transferring clamps downstream
            targetTransform.rotationX = 0;
            targetTransform.rotationY = 0;
            currentTransform.rotationX = 0;
            currentTransform.rotationY = 0;

            // Clean up the previous model to free GPU memory now that the next one is ready
            if (monument) {
                scene.remove(monument);
                monument.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(mat => mat.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                    }
                });
            }

            // Bind the incoming asset to the active display slot
            monument = incomingMonument;
            scene.add(monument);

            if (loadingDiv) loadingDiv.style.display = "none";
            isInternalLoading = false;
        },
        undefined,
        (error) => {
            console.error("Asset Loader Failure Exception: ", error);
            if (loadingDiv) loadingDiv.style.display = "none";
            isInternalLoading = false;
        }
    );
}

window.loadModel = loadModel;

// ---------------- Event Resizing Handler ----------------
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- Animation Render Loop ----------------
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();
    const state = window.handState;
    const isIdle = !state.detected || (Date.now() - state.lastSeen > IDLE_TIMEOUT);

    if (!isIdle) {
        if (!state.closedFist) {
            if (state.openPalm) {
                targetTransform.rotationX = 0;
                targetTransform.rotationY = 0;
                targetTransform.scale = baseScale;
            } else {
                let rawRotationY = (state.x - 0.5) * 2.4;
                let rawRotationX = -(state.y - 0.5) * 1.4;

                // Apply specific bounding parameters conditionally if config restrictions exist
                const currentConfig = MODEL_CONFIGS[activeModelName];
                if (currentConfig) {
                    if (currentConfig.minRotationX !== undefined && currentConfig.minRotationX !== null) {
                        rawRotationX = Math.max(currentConfig.minRotationX, Math.min(currentConfig.maxRotationX, rawRotationX));
                    }
                    if (currentConfig.minRotationY !== undefined && currentConfig.minRotationY !== null) {
                        rawRotationY = Math.max(currentConfig.minRotationY, Math.min(currentConfig.maxRotationY, rawRotationY));
                    }
                }

                targetTransform.rotationY = rawRotationY;
                targetTransform.rotationX = rawRotationX;

                if (state.pinch) {
                    // Inverted signals: pinch strength close to 1.0 reduces target scale toward zoomMinForModel, 
                    // while opening the hand (strength close to 0.0) scales up toward zoomMaxForModel.
                    const invertedStrength = 1.0 - state.pinchStrength;
                    const scaleTargetFactor = zoomMinForModel + (invertedStrength * (zoomMaxForModel - zoomMinForModel));
                    targetTransform.scale = baseScale * scaleTargetFactor;
                } else {
                    targetTransform.scale = baseScale;
                }
            }
        }
        // If a closed fist is active, targets stay put — rotation/zoom freezes in place.
    } else {
        let rawIdleY = targetTransform.rotationY + 0.005;
        let rawIdleX = Math.sin(elapsedTime * 0.4) * 0.2;
        
        const currentConfig = MODEL_CONFIGS[activeModelName];
        if (currentConfig) {
            if (currentConfig.minRotationX !== undefined && currentConfig.minRotationX !== null) {
                rawIdleX = Math.max(currentConfig.minRotationX, Math.min(currentConfig.maxRotationX, rawIdleX));
            }
            if (currentConfig.minRotationY !== undefined && currentConfig.minRotationY !== null) {
                rawIdleY = Math.max(currentConfig.minRotationY, Math.min(currentConfig.maxRotationY, rawIdleY));
            }
        }
        
        targetTransform.rotationY = rawIdleY;
        targetTransform.rotationX = rawIdleX;
        targetTransform.scale = baseScale + Math.sin(elapsedTime * 0.6) * (baseScale * 0.03);
    }

    currentTransform.rotationY += (targetTransform.rotationY - currentTransform.rotationY) * LERP_FACTOR;
    currentTransform.rotationX += (targetTransform.rotationX - currentTransform.rotationX) * LERP_FACTOR;
    currentTransform.scale     += (targetTransform.scale     - currentTransform.scale)     * LERP_FACTOR;

    if (monument) {
        monument.rotation.y = currentTransform.rotationY;
        monument.rotation.x = currentTransform.rotationX;
        monument.scale.setScalar(currentTransform.scale);

        // Gentle float on top of the cached floor height — no per-frame bounding
        // box recompute, so this no longer couples to rotation.
        const floorY = monument.userData.floorY ?? 0;
        monument.position.y = floorY + Math.sin(elapsedTime * 1.6) * 0.08;
    }

    const radius = 6.0;
    orbitLight1.position.x = Math.cos(elapsedTime * 0.7) * radius;
    orbitLight1.position.z = Math.sin(elapsedTime * 0.7) * radius;
    orbitLight1.position.y = Math.sin(elapsedTime * 0.5) * 2;
    orbitLight2.position.x = Math.cos(elapsedTime * -0.5) * radius;
    orbitLight2.position.z = Math.sin(elapsedTime * -0.5) * radius;
    orbitLight2.position.y = Math.cos(elapsedTime * 0.8) * 2;

    const positions = particleSystem.geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3 + 1] += 0.008 * particleSpeeds[i];
        if (positions[i * 3 + 1] > 3) {
            positions[i * 3 + 1] = -3;
        }
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.rotation.y += 0.001;

    renderer.render(scene, camera);
}
animate();