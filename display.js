import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ---------------- Shared Hand State ----------------

window.handState = {

    detected: false,

    x: 0,

    y: 0

};

// ---------------- Scene ----------------

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x9fdcff);

// ---------------- Camera ----------------

const camera = new THREE.PerspectiveCamera(

45,

window.innerWidth / window.innerHeight,

0.1,

1000

);

camera.position.set(0, 2, 12);

// ---------------- Renderer ----------------

const renderer = new THREE.WebGLRenderer({

antialias: true

});

renderer.setSize(window.innerWidth, window.innerHeight);

renderer.setPixelRatio(window.devicePixelRatio);

document.body.appendChild(renderer.domElement);

// ---------------- Lights ----------------

const ambient = new THREE.AmbientLight(0xffffff, 2);

scene.add(ambient);

const light1 = new THREE.DirectionalLight(0xffffff, 3);

light1.position.set(5, 5, 5);

scene.add(light1);

const light2 = new THREE.DirectionalLight(0x88ccff, 2);

light2.position.set(-5, 4, -5);

scene.add(light2);

// ---------------- Model ----------------

const loader = new GLTFLoader();

let monument = null;

loader.load(

"./models/eiffel.glb",

(gltf)=>{

    monument = gltf.scene;

    monument.scale.set(2.5,2.5,2.5);

    monument.position.set(0,-1,0);

    scene.add(monument);

},

undefined,

(error)=>{

    console.error(error);

}

);

// ---------------- Webcam ----------------

const webcam = document.getElementById("webcam");

navigator.mediaDevices.getUserMedia({

video:true

})

.then(stream=>{

webcam.srcObject=stream;

})

.catch(err=>{

console.error(err);

});

// ---------------- Resize ----------------

window.addEventListener("resize",()=>{

camera.aspect = window.innerWidth/window.innerHeight;

camera.updateProjectionMatrix();

renderer.setSize(window.innerWidth,window.innerHeight);

});

// ---------------- Animation ----------------

const clock = new THREE.Clock();

function animate(){

requestAnimationFrame(animate);

const t = clock.getElapsedTime();

if(monument){

    monument.position.y = -1 + Math.sin(t*1.5)*0.08;

    if(window.handState.detected){

        const targetY = (window.handState.x-0.5)*4;

        const targetX = -(window.handState.y-0.5)*2;

        monument.rotation.y +=

        (targetY-monument.rotation.y)*0.08;

        monument.rotation.x +=

        (targetX-monument.rotation.x)*0.08;

    }

}

renderer.render(scene,camera);

}

animate();