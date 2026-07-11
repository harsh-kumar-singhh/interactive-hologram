// Global Configuration
const EXHIBITION_MODE = false; // Set to true to hide the camera view and canvas markers for the illusion

/**
 * handTracking.js
 * Responsible for Webcam capture, MediaPipe tracking, gesture isolation,
 * and pushing updates directly to window.handState.
 */

// Safe initialization: Don't overwrite if already initialized by another script
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

// Target DOM Elements from your existing HTML layout
const video = document.getElementById("webcam");
const canvas = document.getElementById("handCanvas");
const ctx = canvas.getContext("2d");

canvas.width = 640;
canvas.height = 480;

// Style the tracking output container for a cleaner appearance
if (EXHIBITION_MODE) {
    video.style.display = "none";
    canvas.style.display = "none";
} else {
    // Mirror layout elements to make matching movements user-intuitive
    video.style.transform = "scaleX(-1)";
    canvas.style.transform = "scaleX(-1)";

    // Position camera view container neatly out of the way
    canvas.style.position = "fixed";
    canvas.style.bottom = "20px";
    canvas.style.right = "20px";
    canvas.style.borderRadius = "8px";
    canvas.style.border = "2px solid #00ffff";
    canvas.style.boxShadow = "0 0 15px rgba(0, 255, 255, 0.4)";
    canvas.style.width = "200px";
    canvas.style.height = "auto";
    canvas.style.zIndex = "100";

    // Hide the raw background video to focus exclusively on the tracked canvas skeleton overlay
    video.style.position = "fixed";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
}

// -----------------------------------------------------------------
// LIGHT TRACKING FILTER
// Kept minimal and reliable: a fast position smoother to knock down
// pixel-level jitter, plus pinch hysteresis to stop the pinch flag
// flickering right at the threshold. Nothing here adds meaningful
// latency, and gesture booleans (open palm / closed fist) stay raw
// so they always respond immediately.
// -----------------------------------------------------------------
const TrackingFilter = {
    filteredX: 0.5,
    filteredY: 0.5,
    wasDetected: false,

    TRACKING_GRACE_PERIOD: 500, // Bridges brief single-frame dropouts so tracking doesn't "randomly" appear lost

    // Hysteresis band for the pinch on/off flag only — keeps the boolean stable near the threshold.
    PINCH_START_THRESH: 0.32,
    PINCH_END_THRESH: 0.44,

    // Separate, wider reference for the continuous pinch strength (zoom amount).
    // Using the narrow hysteresis band here would make zoom jump from 0% to 100%
    // over a tiny finger movement — this keeps zoom smooth and predictable.
    PINCH_STRENGTH_REFERENCE: 0.42,

    OPEN_PALM_MIN_EXT: 2.35,
    CLOSED_FIST_MAX_EXT: 1.25,

    /**
     * Fast exponential smoothing for fingertip position. Snaps immediately on
     * reacquire (no catch-up lag when a hand reappears somewhere new) and
     * smooths only while tracking continuously.
     */
    processKinematics(rawX, rawY, justAcquired) {
        if (justAcquired) {
            this.filteredX = rawX;
            this.filteredY = rawY;
        } else {
            const alpha = 0.5; // Fast enough to feel immediate, still knocks down pixel jitter
            this.filteredX += alpha * (rawX - this.filteredX);
            this.filteredY += alpha * (rawY - this.filteredY);
        }
        return { x: this.filteredX, y: this.filteredY };
    }
};

/**
 * Calculates Euclidean space distance between two tracking landmarks
 */
function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
}

/**
 * Maps specialized geometric hands structures into distinct gesture tracking variables
 */
function analyzeGestures(landmarks) {
    const WRIST = 0;
    const THUMB_TIP = 4;
    const INDEX_MCP = 5;
    const INDEX_TIP = 8;
    const MIDDLE_TIP = 12;
    const RING_TIP = 16;
    const PINKY_TIP = 20;

    // Calculate a stable hand dimension scale using the distance from Wrist to Index Finger root
    const handScale = getDistance(landmarks[WRIST], landmarks[INDEX_MCP]);
    if (handScale === 0) return;

    // Pinch evaluation: Calculate relative distance between thumb and index finger tip
    const rawPinchDist = getDistance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
    const normalizedPinchDist = rawPinchDist / handScale;

    // Hysteresis for the boolean pinch flag only, to stop it flickering at the edge
    let currentlyPinching = window.handState.pinch;
    if (currentlyPinching) {
        if (normalizedPinchDist > TrackingFilter.PINCH_END_THRESH) {
            currentlyPinching = false;
        }
    } else {
        if (normalizedPinchDist < TrackingFilter.PINCH_START_THRESH) {
            currentlyPinching = true;
        }
    }

    // Continuous zoom strength uses its own wide, stable range — independent
    // of the narrow hysteresis band above — so zoom feels smooth, not twitchy.
    const ref = TrackingFilter.PINCH_STRENGTH_REFERENCE;
    const pinchStrength = Math.max(0, Math.min(1, (ref - normalizedPinchDist) / ref));

    // Measure overall finger extension vectors away from the wrist anchor
    const dIndex = getDistance(landmarks[INDEX_TIP], landmarks[WRIST]);
    const dMiddle = getDistance(landmarks[MIDDLE_TIP], landmarks[WRIST]);
    const dRing = getDistance(landmarks[RING_TIP], landmarks[WRIST]);
    const dPinky = getDistance(landmarks[PINKY_TIP], landmarks[WRIST]);

    const avgExtension = (dIndex + dMiddle + dRing + dPinky) / (4 * handScale);

    // Differentiate states clearly via calculated dimension thresholds
    const isOpenPalm = avgExtension > TrackingFilter.OPEN_PALM_MIN_EXT;
    const isClosedFist = avgExtension < TrackingFilter.CLOSED_FIST_MAX_EXT;

    // Extract raw positions using Index Finger Tip landmark, lightly smoothed
    const finger = landmarks[INDEX_TIP];
    const justAcquired = !TrackingFilter.wasDetected;
    const smoothPosition = TrackingFilter.processKinematics(finger.x, finger.y, justAcquired);
    TrackingFilter.wasDetected = true;

    // Atomically stream updates straight into global space
    window.handState.detected = true;
    window.handState.x = smoothPosition.x;
    window.handState.y = smoothPosition.y;
    window.handState.pinch = currentlyPinching;
    window.handState.pinchStrength = pinchStrength;
    window.handState.openPalm = isOpenPalm;
    window.handState.closedFist = isClosedFist;
    window.handState.lastSeen = Date.now();
}

// ---------------- MediaPipe ----------------

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

// ---------------- Results Pipeline ----------------

hands.onResults((results) => {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render underlying camera stream image frame if tracking window is configured visible
    if (!EXHIBITION_MODE) {
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        analyzeGestures(landmarks);

        // Render skeleton tracking overlays strictly for off-stage debugging
        if (!EXHIBITION_MODE) {
            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "#00FFFF", lineWidth: 4 });
            drawLandmarks(ctx, landmarks, { color: "#FF0055", radius: 4 });
        }
    } else {
        // Grace period bridges a single dropped MediaPipe frame so a brief miss
        // doesn't read as the hand being "randomly" lost.
        const timeSinceLastSeen = Date.now() - window.handState.lastSeen;
        if (timeSinceLastSeen > TrackingFilter.TRACKING_GRACE_PERIOD) {
            window.handState.detected = false;
            TrackingFilter.wasDetected = false;
        }
    }
    ctx.restore();
});

// ---------------- Camera Engine ----------------
// Kept as a single stream request through MediaPipe's own Camera helper.
// (A previous variant manually called getUserMedia and then also let Camera
// request its own stream — two simultaneous camera streams competing for the
// same hardware, which is a plausible cause of intermittent freezing.)

const camera = new Camera(video, {
    onFrame: async () => {
        if (video.readyState >= 2) {
            await hands.send({ image: video });
        }
    },
    width: 640,
    height: 480
});

camera.start().catch(err => console.error("MediaPipe camera cycle failed:", err));