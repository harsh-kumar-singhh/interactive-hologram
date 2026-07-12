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
// ONE EURO FILTER
// A speed-adaptive low-pass filter (Casiez et al.) — instead of a single
// fixed smoothing factor, it drops its cutoff frequency when the signal is
// nearly still (crushing pixel jitter) and raises it as speed increases
// (so a real, fast hand motion is followed with almost no added lag).
// This is what lets us fix "tiny movements shouldn't move the model" and
// "fast movement shouldn't feel laggy" at the same time — a fixed alpha
// can only ever pick one side of that tradeoff.
// Frame-rate independent: driven by wall-clock dt, not by tick count.
// -----------------------------------------------------------------
class OneEuroFilter {
    constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
        this.minCutoff = minCutoff; // Lower = smoother when the hand is nearly still
        this.beta = beta;           // Higher = less lag once the hand starts moving fast
        this.dCutoff = dCutoff;
        this.xPrev = null;
        this.dxPrev = 0;
        this.lastTime = null;
    }

    static smoothingAlpha(cutoff, dt) {
        const tau = 1.0 / (2 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / dt);
    }

    filter(x, timestamp = performance.now()) {
        if (this.lastTime === null) {
            this.lastTime = timestamp;
            this.xPrev = x;
            this.dxPrev = 0;
            return x;
        }

        let dt = (timestamp - this.lastTime) / 1000;
        if (dt <= 0) dt = 1 / 60; // Guard against duplicate/out-of-order timestamps
        this.lastTime = timestamp;

        // Estimate signal speed, itself lightly filtered to avoid noise driving the cutoff around
        const dx = (x - this.xPrev) / dt;
        const aD = OneEuroFilter.smoothingAlpha(this.dCutoff, dt);
        const dxHat = this.dxPrev + aD * (dx - this.dxPrev);

        // Adaptive cutoff: widens (less smoothing) as estimated speed increases
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        const a = OneEuroFilter.smoothingAlpha(cutoff, dt);
        const xHat = this.xPrev + a * (x - this.xPrev);

        this.xPrev = xHat;
        this.dxPrev = dxHat;
        return xHat;
    }

    // Snap instantly to a value with no smoothing — used on hand reacquire so
    // there's no "catch-up" glide when the hand reappears somewhere new.
    reset(x) {
        this.xPrev = x;
        this.dxPrev = 0;
        this.lastTime = null;
    }
}

// -----------------------------------------------------------------
// TRACKING FILTER
// One filter instance per signal, each tuned for what that signal is used for:
//  - position (x/y)   -> drives rotation: needs to feel immediate, some jitter cut
//  - pinch distance    -> drives zoom: needs to feel precise/stable above all
//  - finger extension -> drives open-palm/closed-fist: a fairly deliberate,
//                         binary gesture, so a touch more smoothing is fine
// Pinch (and now open palm / closed fist) additionally use hysteresis on top
// of their filtered signal, so the booleans themselves don't flicker right at
// the threshold boundary.
// -----------------------------------------------------------------
const TrackingFilter = {
    wasDetected: false,

    TRACKING_GRACE_PERIOD: 500, // Bridges brief single-frame dropouts so tracking doesn't "randomly" appear lost

    // Hysteresis band for the pinch on/off flag — keeps the boolean stable near the threshold.
    PINCH_START_THRESH: 0.32,
    PINCH_END_THRESH: 0.44,

    // Separate, wider reference for the continuous pinch strength (zoom amount).
    // Using the narrow hysteresis band here would make zoom jump from 0% to 100%
    // over a tiny finger movement — this keeps zoom smooth and predictable.
    PINCH_STRENGTH_REFERENCE: 0.42,

    // Hysteresis bands for open palm / closed fist, mirroring the pinch approach above,
    // so these booleans no longer flicker for a hand resting right at the boundary.
    OPEN_PALM_ENTER_EXT: 2.35,
    OPEN_PALM_EXIT_EXT: 2.05,
    CLOSED_FIST_ENTER_EXT: 1.25,
    CLOSED_FIST_EXIT_EXT: 1.55,

    // One filter per tracked signal.
    positionFilterX: new OneEuroFilter(1.0, 0.7, 1.0),
    positionFilterY: new OneEuroFilter(1.0, 0.7, 1.0),
    pinchDistFilter: new OneEuroFilter(0.8, 0.4, 1.0),
    extensionFilter: new OneEuroFilter(1.0, 0.3, 1.0),

    /**
     * Filters fingertip position. Snaps immediately on reacquire (no catch-up
     * lag when a hand reappears somewhere new) and smooths adaptively while
     * tracking continuously.
     */
    processPosition(rawX, rawY, justAcquired, now) {
        if (justAcquired) {
            this.positionFilterX.reset(rawX);
            this.positionFilterY.reset(rawY);
            return { x: rawX, y: rawY };
        }
        return {
            x: this.positionFilterX.filter(rawX, now),
            y: this.positionFilterY.filter(rawY, now)
        };
    },

    processPinchDistance(rawDist, justAcquired, now) {
        if (justAcquired) {
            this.pinchDistFilter.reset(rawDist);
            return rawDist;
        }
        return this.pinchDistFilter.filter(rawDist, now);
    },

    processExtension(rawExt, justAcquired, now) {
        if (justAcquired) {
            this.extensionFilter.reset(rawExt);
            return rawExt;
        }
        return this.extensionFilter.filter(rawExt, now);
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

    const now = performance.now();
    const justAcquired = !TrackingFilter.wasDetected;

    // Calculate a stable hand dimension scale using the distance from Wrist to Index Finger root
    const handScale = getDistance(landmarks[WRIST], landmarks[INDEX_MCP]);
    if (handScale === 0) return;

    // Pinch evaluation: Calculate relative distance between thumb and index finger tip,
    // then run it through the One Euro filter before it drives anything — this is what
    // makes pinch-to-zoom feel precise instead of twitchy, since both the hysteresis
    // boundary check AND the continuous zoom amount now read a stable signal.
    const rawPinchDist = getDistance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
    const normalizedPinchDist = rawPinchDist / handScale;
    const filteredPinchDist = TrackingFilter.processPinchDistance(normalizedPinchDist, justAcquired, now);

    // Hysteresis for the boolean pinch flag, evaluated against the filtered distance.
    let currentlyPinching = window.handState.pinch;
    if (currentlyPinching) {
        if (filteredPinchDist > TrackingFilter.PINCH_END_THRESH) {
            currentlyPinching = false;
        }
    } else {
        if (filteredPinchDist < TrackingFilter.PINCH_START_THRESH) {
            currentlyPinching = true;
        }
    }

    // Continuous zoom strength uses its own wide, stable range — independent
    // of the narrow hysteresis band above — so zoom feels smooth, not twitchy.
    const ref = TrackingFilter.PINCH_STRENGTH_REFERENCE;
    const pinchStrength = Math.max(0, Math.min(1, (ref - filteredPinchDist) / ref));

    // Measure overall finger extension vectors away from the wrist anchor
    const dIndex = getDistance(landmarks[INDEX_TIP], landmarks[WRIST]);
    const dMiddle = getDistance(landmarks[MIDDLE_TIP], landmarks[WRIST]);
    const dRing = getDistance(landmarks[RING_TIP], landmarks[WRIST]);
    const dPinky = getDistance(landmarks[PINKY_TIP], landmarks[WRIST]);

    const rawAvgExtension = (dIndex + dMiddle + dRing + dPinky) / (4 * handScale);
    const avgExtension = TrackingFilter.processExtension(rawAvgExtension, justAcquired, now);

    // Hysteresis for open palm / closed fist, mirroring the pinch flag above, so a hand
    // resting right at the boundary no longer flickers between states.
    let isOpenPalm = window.handState.openPalm;
    if (isOpenPalm) {
        if (avgExtension < TrackingFilter.OPEN_PALM_EXIT_EXT) isOpenPalm = false;
    } else {
        if (avgExtension > TrackingFilter.OPEN_PALM_ENTER_EXT) isOpenPalm = true;
    }

    let isClosedFist = window.handState.closedFist;
    if (isClosedFist) {
        if (avgExtension > TrackingFilter.CLOSED_FIST_EXIT_EXT) isClosedFist = false;
    } else {
        if (avgExtension < TrackingFilter.CLOSED_FIST_ENTER_EXT) isClosedFist = true;
    }
    // These two are mutually exclusive by construction (the enter thresholds don't overlap),
    // but guard against any edge case so the model never reads both flags true at once.
    if (isOpenPalm && isClosedFist) isClosedFist = false;

    // Extract raw positions using Index Finger Tip landmark, filtered for stability
    const finger = landmarks[INDEX_TIP];
    const smoothPosition = TrackingFilter.processPosition(finger.x, finger.y, justAcquired, now);
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