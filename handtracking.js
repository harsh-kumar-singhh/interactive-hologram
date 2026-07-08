const video = document.getElementById("webcam");

const canvas = document.getElementById("handCanvas");

canvas.width = 640;

canvas.height = 480;

const ctx = canvas.getContext("2d");

// ---------------- MediaPipe ----------------

const hands = new Hands({

locateFile:(file)=>{

return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;

}

});

hands.setOptions({

maxNumHands:1,

modelComplexity:1,

minDetectionConfidence:0.7,

minTrackingConfidence:0.7

});

// ---------------- Results ----------------

hands.onResults((results)=>{

ctx.save();

ctx.clearRect(

0,

0,

canvas.width,

canvas.height

);

ctx.drawImage(

results.image,

0,

0,

canvas.width,

canvas.height

);

if(results.multiHandLandmarks.length>0){

const landmarks = results.multiHandLandmarks[0];

// Draw Skeleton

drawConnectors(

ctx,

landmarks,

HAND_CONNECTIONS,

{

color:"#00FFFF",

lineWidth:3

}

);

drawLandmarks(

ctx,

landmarks,

{

color:"#00FF00",

radius:4

}

);

// Use Index Finger Tip

const finger = landmarks[8];

window.handState.detected = true;

window.handState.x = finger.x;

window.handState.y = finger.y;

}else{

window.handState.detected = false;

}

ctx.restore();

});

// ---------------- Camera ----------------

const camera = new Camera(video,{

onFrame:async()=>{

await hands.send({

image:video

});

},

width:640,

height:480

});

camera.start();