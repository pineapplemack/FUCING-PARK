// ==========================================================
// 操逼乐园 - Core Game Logic V2.2.3 PRO (Safe Parse & Strict Local Loader)
// ==========================================================

// Global Screen Error Logger
window.onerror = function(msg, src, line, col, err) {
    const div = document.createElement('div');
    div.style = 'position:absolute;top:10px;left:10px;width:calc(100% - 20px);background:rgba(220,0,0,0.95);color:#fff;padding:15px;z-index:99999;font-family:monospace;border-radius:6px;border:2px solid #fff;';
    div.innerHTML = `<h3>🚨 JS Error (画面加载异常调试):</h3><p><b>Message:</b> ${msg}</p><p><b>Line:</b> ${line} | <b>Col:</b> ${col}</p><p><b>Stack:</b> ${err ? err.stack : 'N/A'}</p>`;
    document.body.appendChild(div);
    return false;
};

// Global variables (No top-level instantiations using THREE to prevent parsing crashes)
let scene, camera, renderer, player, playerVelocity, clock;
const GRAVITY = 30, JUMP_FORCE = 12, MOVE_SPEED = 12, NPC_COUNT = 45;
const keys = { w: false, a: false, s: false, d: false, space: false, e: false, v: false };
let isGameStarted = false, cameraYaw = 0, cameraPitch = 0.2, isMouseDragging = false, previousMousePosition = { x: 0, y: 0 };
let playerCash = 50, isTicketPurchased = false, currentRide = null, coasterCameraMode = 'third', nearbyInteractable = null, npcs = [];

// Ride settings with array positions to prevent top-level THREE.Vector3 call
let rides = {
    coaster: { cart: null, curve: null, progress: 0, isActive: false, posArray: [60, 0, 20], pos: null, cost: 20, name: "操逼过山车" },
    droptower: { tower: null, cabin: null, state: 'idle', height: 0, maxHeight: 45, timer: 0, speed: 0, shakeTime: 0, posArray: [0, 0, -60], pos: null, cost: 20, name: "操逼跳楼机" },
    ferris: { wheel: null, cabins: [], angle: 0, posArray: [-60, 0, -20], pos: null, cost: 20, name: "霓虹摩天轮" },
    pendulum: { base: null, arm: null, ring: null, swingAngle: 0, swingSpeed: 2, rotAngle: 0, posArray: [30, 0, -10], pos: null, cost: 20, name: "寄吧大摆锤" },
    jetski: { ski: null, water: null, speed: 0, angle: 0, posArray: [60, 0, -60], pos: null, cost: 20, name: "吵币水上摩托" },
    catapult: { capsule: null, state: 'idle', launchSpeed: 0, launchHeight: 0, timer: 0, posArray: [-25, 0, 10], pos: null, cost: 20, name: "机霸铠甲弹射装置" },
    spinner: { wheel: null, angle: 0, tilt: 0.3, posArray: [-60, 0, 30], pos: null, cost: 20, name: "超碧大转盘" },
    bumper: { car: null, speed: 0, angle: 0, posArray: [0, 0, 30], pos: null, cost: 20, name: "大屁飞车" }
};

let entranceGatePos;
let shopBurgerPos, shopJuicePos, shopCryptoPos;
let fireworks = [], sparks = [], audioCtx = null, bgMusicNode = null, isAudioPlaying = false, activeJob = null, jobProgress = 0, jobCount = 0;
let concreteTex, waterTex, hazardTex, gateLeftBarrier, gateRightBarrier;

function initUI() {
    document.getElementById('start-btn').addEventListener('click', () => {
        document.getElementById('welcome-screen').classList.add('fade-out');
        document.getElementById('hud').classList.remove('hidden');
        isGameStarted = true;
        initAudio();
        updateCashHUD();
        document.body.requestPointerLock?.();
    });

    document.getElementById('exit-ride-btn').addEventListener('click', () => exitRide());
    document.getElementById('view-toggle-btn').addEventListener('click', () => toggleCoasterCamera());

    const teleports = { spawn:[0,0,125], plaza:[0,0,70], coaster:[60,0,20], droptower:[0,0,-60], ferriswheel:[-60,0,-20], pendulum:[30,0,-10], jetski:[60,0,-60], catapult:[-25,0,10], spinner:[-60,0,30], bumper:[0,0,30] };
    for (let key in teleports) {
        document.getElementById(`tp-${key}`).addEventListener('click', () => {
            exitRide();
            if (key !== 'spawn' && key !== 'plaza') {
                if (!isTicketPurchased) return showCenterPrompt("入园需先在门口购买 $100 门票！");
                if (playerCash < 20) return showCenterPrompt("余额不足 $20 无法传送游玩！");
                playerCash -= 20;
                updateCashHUD();
                playSoundEffect('cash');
            }
            player.position.set(teleports[key][0], 0, teleports[key][2] + (key==='spawn'||key==='plaza'?0:10));
            playerVelocity.set(0,0,0);
            if (key !== 'spawn' && key !== 'plaza') boardRide(key==='ferriswheel'?'ferris':key);
        });
    }

    window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === ' ' || k === 'spacebar') keys.space = true;
        if (k === 'w' || e.key === 'ArrowUp') keys.w = true;
        if (k === 's' || e.key === 'ArrowDown') keys.s = true;
        if (k === 'a' || e.key === 'ArrowLeft') keys.a = true;
        if (k === 'd' || e.key === 'ArrowRight') keys.d = true;
        if (k === 'e') handleInteractionKeyPress();
        if (k === 'v') toggleCoasterCamera();
    });

    window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        if (k === ' ' || k === 'spacebar') keys.space = false;
        if (k === 'w' || e.key === 'ArrowUp') keys.w = false;
        if (k === 's' || e.key === 'ArrowDown') keys.s = false;
        if (k === 'a' || e.key === 'ArrowLeft') keys.a = false;
        if (k === 'd' || e.key === 'ArrowRight') keys.d = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isGameStarted || activeJob) return;
        if (currentRide === 'coaster' && coasterCameraMode === 'first') return;
        if (document.pointerLockElement === document.body) {
            cameraYaw -= e.movementX * 0.0025;
            cameraPitch = Math.max(-0.5, Math.min(0.8, cameraPitch - e.movementY * 0.0025));
        } else if (isMouseDragging) {
            cameraYaw -= (e.clientX - previousMousePosition.x) * 0.0025;
            cameraPitch = Math.max(-0.5, Math.min(0.8, cameraPitch - (e.clientY - previousMousePosition.y) * 0.0025));
            previousMousePosition = { x: e.clientX, y: e.clientY };
        }
    });

    window.addEventListener('mousedown', (e) => { isMouseDragging = true; previousMousePosition = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mouseup', () => isMouseDragging = false);
    document.getElementById('music-btn').addEventListener('click', toggleAudio);

    setupBurgerJobEvents();
    setupJuiceJobEvents();
    document.getElementById('quit-crypto-btn').addEventListener('click', () => quitJob());
    init3D();
}

function updateCashHUD() {
    document.getElementById('cash-meter').innerText = `$${playerCash}`;
    const status = document.getElementById('ticket-status');
    status.innerText = isTicketPurchased ? "已购门票" : "未购票";
    status.className = isTicketPurchased ? "text-green" : "text-red";
}

// Procedural Audio
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function toggleAudio() {
    initAudio();
    const btn = document.getElementById('music-btn');
    if (isAudioPlaying) {
        bgMusicNode?.stop();
        bgMusicNode = null;
        isAudioPlaying = false;
        btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else {
        audioCtx.resume().then(() => {
            playProceduralBGMusic();
            isAudioPlaying = true;
            btn.innerHTML = '<i class="fa-solid fa-volume-high text-pink"></i>';
        });
    }
}
function playProceduralBGMusic() {
    const notes = [130.81, 146.83, 164.81, 196.00, 220.00, 261.63, 293.66, 329.63, 392.00, 440.00];
    let noteIdx = 0;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    osc.type = 'sawtooth'; osc.frequency.value = 130.81; gain.gain.value = 0.04; filter.type = 'lowpass'; filter.frequency.value = 500;
    osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination); osc.start(); bgMusicNode = osc;
    
    let lastTime = audioCtx.currentTime;
    function sched() {
        if (!isAudioPlaying || !bgMusicNode) return;
        while (lastTime < audioCtx.currentTime + 0.1) {
            noteIdx = (noteIdx + (Math.random() > 0.5 ? 1 : -1) + notes.length) % notes.length;
            osc.frequency.setValueAtTime(notes[noteIdx], lastTime);
            lastTime += 0.22;
        }
        requestAnimationFrame(sched);
    }
    sched();
}
function playSnareDrum(time) {
    if (!audioCtx) return;
    const bufferSize = audioCtx.sampleRate * 0.08;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;
    
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1200;
    
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.015, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    
    noiseNode.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    
    noiseNode.start(time);
}
function playSoundEffect(type) {
    if (!audioCtx || !isAudioPlaying) return;
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (type === 'jump') {
        osc.frequency.setValueAtTime(200, now); osc.frequency.exponentialRampToValueAtTime(700, now + 0.12);
        gain.gain.setValueAtTime(0.08, now); gain.gain.linearRampToValueAtTime(0.001, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);
    } else if (type === 'click') {
        osc.frequency.setValueAtTime(500, now); gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0.001, now + 0.04);
        osc.start(now); osc.stop(now + 0.04);
    } else if (type === 'cash') {
        osc.frequency.setValueAtTime(880, now); osc.frequency.setValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.12, now); gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    } else if (type === 'error') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now); osc.frequency.linearRampToValueAtTime(100, now + 0.25);
        gain.gain.setValueAtTime(0.15, now); gain.gain.linearRampToValueAtTime(0.001, now + 0.25);
        osc.start(now); osc.stop(now + 0.25);
    } else if (type === 'squirt') {
        osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(150, now + 0.2);
        gain.gain.setValueAtTime(0.12, now); gain.gain.linearRampToValueAtTime(0.001, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
    }
}

// Procedural Textures
function generateCanvasTexture(color1, color2, drawFn) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color1; ctx.fillRect(0,0,256,256);
    drawFn(ctx);
    const tex = new THREE.CanvasTexture(canvas); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// 3D Engine Setup
function init3D() {
    // Safety check for THREE library
    if (typeof THREE === 'undefined') {
        alert("3D 引擎库 (three.min.js) 加载失败。请确保 index.html 所在的目录下存在 three.min.js 文件！");
        return;
    }

    // Safe instance initialization
    playerVelocity = new THREE.Vector3();
    clock = new THREE.Clock();
    entranceGatePos = new THREE.Vector3(0, 0, 95);
    shopBurgerPos = new THREE.Vector3(-25, 0, 120);
    shopJuicePos = new THREE.Vector3(25, 0, 120);
    shopCryptoPos = new THREE.Vector3(-45, 0, 130);

    for (let key in rides) {
        const arr = rides[key].posArray;
        rides[key].pos = new THREE.Vector3(arr[0], arr[1], arr[2]);
    }

    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0f1026); scene.fog = new THREE.FogExp2(0x0f1026, 0.0035);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch(e) {
        alert("浏览器不支持 WebGL 硬件加速！"); return;
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35; // Increased exposure for brightness and clarity
    container.appendChild(renderer.domElement);

    concreteTex = generateCanvasTexture('#202028', '#202028', (ctx) => {
        ctx.fillStyle = '#22222a';
        for(let i=0;i<8000;i++) ctx.fillRect(Math.random()*256, Math.random()*256, 1.5, 1.5);
        ctx.strokeStyle = 'rgba(5,5,10,0.3)'; ctx.lineWidth=1;
        for(let i=0;i<=256;i+=32) { ctx.strokeRect(i, 0, i, 256); ctx.strokeRect(0, i, 256, i); }
    });
    concreteTex.repeat.set(16,16);

    waterTex = generateCanvasTexture('#021222', '#021222', (ctx) => {
        ctx.strokeStyle = 'rgba(0, 190, 255, 0.1)'; ctx.lineWidth = 2;
        for(let i=0;i<30;i++) { ctx.beginPath(); ctx.arc(Math.random()*256, Math.random()*256, Math.random()*30+10, 0, Math.PI*2); ctx.stroke(); }
    });
    waterTex.repeat.set(4,4);

    hazardTex = generateCanvasTexture('#ccaa00', '#ccaa00', (ctx) => {
        ctx.strokeStyle = '#111'; ctx.lineWidth = 14;
        for(let i=-4;i<16;i++) { ctx.beginPath(); ctx.moveTo(i*24, -10); ctx.lineTo(i*24+48, 266); ctx.stroke(); }
    });

    // Global lighting reset: brighter ambient and secondary fill lights to lift dead black shadows
    scene.add(new THREE.AmbientLight(0x40405c, 0.85)); // Much brighter ambient light
    const hemi = new THREE.HemisphereLight(0xfff7e6, 0x222238, 0.65); scene.add(hemi);
    
    // Main directional light (soft golden white moon/sunset light)
    const dir = new THREE.DirectionalLight(0xfff0dd, 0.95); dir.position.set(80,160,40); dir.castShadow=true;
    dir.shadow.mapSize.width = 1024; dir.shadow.mapSize.height = 1024; dir.shadow.bias = -0.0005;
    scene.add(dir);

    // Secondary fill light from opposite angle to prevent dark back-faces/dead black spots
    const fillLight = new THREE.DirectionalLight(0x8a92b2, 0.45);
    fillLight.position.set(-80, 80, -40);
    scene.add(fillLight);

    // Realistic Sky Dome with sunset/twilight horizon gradient and stars
    const skyGeo = new THREE.SphereGeometry(280, 32, 15);
    const skyCanvas = document.createElement('canvas'); skyCanvas.width = 256; skyCanvas.height = 512;
    const skyCtx = skyCanvas.getContext('2d');
    const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#090a15'); // Deep night sky
    skyGrad.addColorStop(0.5, '#17182e'); // Sunset purple transition
    skyGrad.addColorStop(0.85, '#2e2640'); // Twilight horizon glow
    skyGrad.addColorStop(1.0, '#3f385c'); // Warm boundary glow
    skyCtx.fillStyle = skyGrad; skyCtx.fillRect(0, 0, 256, 512);
    
    // Stars
    skyCtx.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
        skyCtx.fillRect(Math.random() * 256, Math.random() * 260, 1.2, 1.2);
    }
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    const skyDome = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
    scene.add(skyDome);

    // Ground plane
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshStandardMaterial({ map:concreteTex, roughness:0.25, metalness:0.5 }));
    floor.rotation.x = -Math.PI/2; floor.receiveShadow=true; scene.add(floor);

    // Build elements
    createGate();
    createShops();
    createRides();
    createPlayer();
    spawnNPCs();
    createRideSpotlights();

    setInterval(spawnFirework, 2800);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    animate();
}

function createRideSpotlights() {
    const spots = [
        new THREE.Vector3(60, 0, 20),
        new THREE.Vector3(0, 0, -60),
        new THREE.Vector3(-60, 0, -20),
        new THREE.Vector3(30, 0, -10),
        new THREE.Vector3(-25, 0, 10),
        new THREE.Vector3(-60, 0, 30)
    ];

    spots.forEach(pos => {
        const spotLight = new THREE.SpotLight(0xff00c8, 5, 80, Math.PI / 6, 0.5, 1);
        spotLight.position.set(pos.x, 0.5, pos.z);
        
        const target = new THREE.Object3D();
        target.position.set(pos.x, 80, pos.z);
        scene.add(target);
        spotLight.target = target;
        
        scene.add(spotLight);
    });
}

// Entrance Gate
function createGate() {
    const gate = new THREE.Group(); gate.position.copy(entranceGatePos);
    const colMat = new THREE.MeshStandardMaterial({ color:0x2d2d3d, metalness:0.8, roughness:0.2 });
    const colL = new THREE.Mesh(new THREE.BoxGeometry(2.4,14,2.4), colMat); colL.position.set(-8.5, 7, 0); colL.castShadow=true;
    const colR = colL.clone(); colR.position.x = 8.5;
    const arch = new THREE.Mesh(new THREE.BoxGeometry(20,2,2), colMat); arch.position.set(0, 15, 0);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(16,1.8,0.3), new THREE.MeshBasicMaterial({color:0xff0080})); sign.position.set(0, 15, 1.1);
    gate.add(colL, colR, arch, sign);

    const armMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.7 });
    gateLeftBarrier = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7.8), armMat);
    gateLeftBarrier.rotation.z = Math.PI/2; gateLeftBarrier.position.set(-4.2, 2, 0); gateLeftBarrier.castShadow=true;
    gateRightBarrier = gateLeftBarrier.clone(); gateRightBarrier.rotation.z = -Math.PI/2; gateRightBarrier.position.x = 4.2;

    gate.add(gateLeftBarrier, gateRightBarrier); scene.add(gate);
}

// Shops outside
function createShops() {
    const makeShop = (pos, color) => {
        const gp = new THREE.Group(); gp.position.copy(pos);
        const b = new THREE.Mesh(new THREE.BoxGeometry(9,8,8), new THREE.MeshStandardMaterial({color:0x24242e, roughness:0.4})); b.position.y=4; b.castShadow=true;
        const awn = new THREE.Mesh(new THREE.BoxGeometry(9.6,0.4,4), new THREE.MeshStandardMaterial({color:0x4a4a5a, metalness:0.8})); awn.position.set(0,6,2.5);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(8,1.4,0.3), new THREE.MeshBasicMaterial({color:color})); sign.position.set(0, 9, 4.1);
        gp.add(b, awn, sign); scene.add(gp);
    };
    makeShop(shopBurgerPos, 0xff9900);
    makeShop(shopJuicePos, 0x00aaff);

    // Crypto office
    const crypto = new THREE.Group(); crypto.position.copy(shopCryptoPos);
    const b = new THREE.Mesh(new THREE.BoxGeometry(11,15,9), new THREE.MeshStandardMaterial({color:0x1c1c24, metalness:0.8, roughness:0.2})); b.position.y=7.5; b.castShadow=true;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(9,2,0.3), new THREE.MeshBasicMaterial({color:0x22ff22})); sign.position.set(0, 16.2, 4.6);
    crypto.add(b, sign); scene.add(crypto);
}

// 8 Suggestive/NSFW Remodeled Rides Builder
function createRides() {
    // 1. Coaster
    const cPoints = [
        new THREE.Vector3(0, 5, 0), new THREE.Vector3(20, 15, 20), new THREE.Vector3(40, 30, 10), new THREE.Vector3(30, 40, -20),
        new THREE.Vector3(10, 48, -40), new THREE.Vector3(-10, 35, -50), new THREE.Vector3(-30, 18, -40), new THREE.Vector3(-40, 5, -10),
        new THREE.Vector3(-30, 2, 20), new THREE.Vector3(-10, 8, 40), new THREE.Vector3(0, 5, 0)
    ];
    rides.coaster.curve = new THREE.CatmullRomCurve3(cPoints); rides.coaster.curve.closed = true;
    
    const cg = new THREE.Group(); cg.position.copy(rides.coaster.pos);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x00d2ff, metalness: 0.9 });
    const spineMat = new THREE.MeshStandardMaterial({ color: 0x1b1b22, metalness: 0.9 });
    cg.add(new THREE.Mesh(new THREE.TubeGeometry(rides.coaster.curve, 100, 0.18, 5, true), railMat));
    cg.add(new THREE.Mesh(new THREE.TubeGeometry(rides.coaster.curve, 100, 0.25, 5, true), spineMat));

    cPoints.forEach((p, idx) => {
        if (idx % 3 === 0) {
            const h = Math.max(0.2, p.y);
            const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, h, 6), spineMat);
            pil.position.set(p.x, h/2, p.z); pil.castShadow=true; cg.add(pil);
        }
    });

    const cart = new THREE.Group();
    const cBody = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 3.2, 12), new THREE.MeshStandardMaterial({color:0xff0080, metalness:0.9, roughness:0.1}));
    cBody.rotation.x = Math.PI/2; cBody.position.y = 0.55; cBody.castShadow=true; cart.add(cBody);
    const capF = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 12), cBody.material); capF.position.set(0, 0.55, 1.6); cart.add(capF);
    
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xff0080, metalness: 0.9, roughness: 0.15 });
    const bL = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 12), bulbMat); bL.position.set(-0.6, 0.55, -1.6);
    const bR = bL.clone(); bR.position.x = 0.6; cart.add(bL, bR);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), new THREE.MeshStandardMaterial({color:0x08080c})); seat.position.set(0, 0.9, 0.1); cart.add(seat);
    cg.add(cart); rides.coaster.cart = cart; scene.add(cg);

    // 2. Drop Tower (NSFW: base spheres + tall cylinder + dome)
    const dtg = new THREE.Group(); dtg.position.copy(rides.droptower.pos);
    const dtBaseMat = new THREE.MeshStandardMaterial({ color: 0x22222a, metalness: 0.9, roughness: 0.15 });
    const sBaseL = new THREE.Mesh(new THREE.SphereGeometry(5.8, 24, 24), dtBaseMat); sBaseL.position.set(-4.8, 3.5, 0); sBaseL.castShadow=true;
    const sBaseR = sBaseL.clone(); sBaseR.position.x = 4.8; dtg.add(sBaseL, sBaseR);
    
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 54, 16), new THREE.MeshStandardMaterial({color:0x1a1a24, metalness:0.9})); shaft.position.y = 27; shaft.castShadow=true; dtg.add(shaft);
    const capDT = new THREE.Mesh(new THREE.SphereGeometry(2.7, 16, 16), new THREE.MeshStandardMaterial({color:0xff0055, metalness:0.9})); capDT.position.y = 54; dtg.add(capDT);

    const cabRing = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.8, 1.8, 8, 1, true), new THREE.MeshStandardMaterial({color:0x2d2d3d, metalness:0.9})); ring.castShadow=true; cabRing.add(ring);
    for(let i=0;i<8;i++) {
        const a = (i/8)*Math.PI*2;
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.1, 0.75), new THREE.MeshStandardMaterial({color:0xff003c}));
        seat.position.set(Math.cos(a)*3.4, 0, Math.sin(a)*3.4); seat.rotation.y = -a + Math.PI/2; cabRing.add(seat);
    }
    cabRing.position.y = 8; dtg.add(cabRing); rides.droptower.tower = dtg; rides.droptower.cabin = cabRing; scene.add(dtg);

    // 3. Ferris Wheel
    const fw = new THREE.Group(); fw.position.copy(rides.ferris.pos);
    const legBMat = new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.9 });
    const fl = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 12), legBMat); fl.position.set(-8, 1, 0);
    const fr = fl.clone(); fr.position.x = 8; fw.add(fl, fr);

    const standMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, metalness: 0.9, roughness: 0.2 });
    const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.75, 36, 6), standMat); leg1.position.set(0, 18, 4); leg1.rotation.z = 0.22; leg1.rotation.x = -0.15;
    const leg2 = leg1.clone(); leg2.position.z = -4; leg2.rotation.x = 0.15; fw.add(leg1, leg2);

    const wgp = new THREE.Group(); wgp.position.set(0, 32, 0);
    const rMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.95 });
    wgp.add(new THREE.Mesh(new THREE.TorusGeometry(20, 0.4, 6, 24), rMat));
    wgp.add(new THREE.Mesh(new THREE.TorusGeometry(8, 0.2, 6, 16), rMat));

    const spokeCount = 10;
    for(let i=0;i<spokeCount;i++) {
        const a = (i/spokeCount)*Math.PI*2;
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 40, 4), standMat); sp.rotation.z = a; wgp.add(sp);
        const cab = new THREE.Group(); cab.position.set(Math.cos(a)*20, Math.sin(a)*20, 0);
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), new THREE.MeshStandardMaterial({color:0x00bbee, metalness:0.9, transparent:true, opacity:0.75}));
        cab.add(box); wgp.add(cab); rides.ferris.cabins.push(cab);
    }
    fw.add(wgp); rides.ferris.wheel = wgp; scene.add(fw);

    // 4. Pendulum (NSFW: dual sphere base + central pointer + bulbous seats)
    const pen = new THREE.Group(); pen.position.copy(rides.pendulum.pos);
    const fL = new THREE.Mesh(new THREE.SphereGeometry(3.0, 12, 12), legBMat); fL.position.set(-9.5, 1, 0);
    const fR = fL.clone(); fR.position.x = 9.5; pen.add(fL, fR);
    
    const pLegMat = new THREE.MeshStandardMaterial({ color: 0x22222d, metalness: 0.9 });
    const pl1 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.0, 38, 6), pLegMat); pl1.position.set(-9.5, 18, 0); pl1.rotation.z = -0.28;
    const pl2 = pl1.clone(); pl2.position.x = 9.5; pl2.rotation.z = 0.28; pen.add(pl1, pl2);

    const arm = new THREE.Group(); arm.position.set(0, 32, 0);
    const shaftP = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 25), new THREE.MeshStandardMaterial({color:0x8888aa, metalness:0.95})); shaftP.position.y = -12.5; arm.add(shaftP);
    
    const pRingMat = new THREE.MeshStandardMaterial({ color: 0xff00b7, metalness: 0.9, roughness: 0.1 });
    const ringP = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.6, 6, 18), pRingMat); ringP.rotation.x = Math.PI/2; ringP.position.y = -25; arm.add(ringP);
    const bulbP = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 12), pRingMat); bulbP.position.y = -25; arm.add(bulbP);
    
    pen.add(arm); rides.pendulum.arm = arm; rides.pendulum.ring = ringP; scene.add(pen);

    // 5. Jet Ski (NSFW: long front nose + spheres tip)
    const js = new THREE.Group(); js.position.copy(rides.jetski.pos);
    const wWall = new THREE.Mesh(new THREE.BoxGeometry(47, 1.6, 47), new THREE.MeshStandardMaterial({map:concreteTex})); wWall.position.y=0.8; js.add(wWall);
    const wPool = new THREE.Mesh(new THREE.BoxGeometry(45, 1, 45), new THREE.MeshStandardMaterial({map:waterTex, roughness:0.05, metalness:0.9, transparent:true, opacity:0.85})); wPool.position.y=1.0; js.add(wPool); rides.jetski.water = wPool;

    const ski = new THREE.Group();
    const skiMat = new THREE.MeshStandardMaterial({ color: 0x00ffd2, metalness: 0.9, roughness: 0.1 });
    const skiB = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 2.6), skiMat); skiB.position.y = 1.2; ski.add(skiB);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.2), skiMat); nose.rotation.x = Math.PI/2; nose.position.set(0,1.2,1.6); ski.add(nose);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({color:0xff0080})); tip.position.set(0,1.2,2.2); ski.add(tip);
    const jseat = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.35,1.1), new THREE.MeshStandardMaterial({color:0x1c1c1c})); jseat.position.set(0,1.5,-0.2); ski.add(jseat);
    js.add(ski); rides.jetski.ski = ski; scene.add(js);

    // 6. Catapult
    const cat = new THREE.Group(); cat.position.copy(rides.catapult.pos);
    const catFoot = new THREE.Mesh(new THREE.BoxGeometry(20,1,6), new THREE.MeshStandardMaterial({map:concreteTex})); catFoot.position.y=0.5; cat.add(catFoot);
    const cTowerMat = new THREE.MeshStandardMaterial({ color: 0x1c1c24, metalness: 0.9 });
    const ctL = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.7, 38, 6), cTowerMat); ctL.position.set(-8,19,0);
    const ctR = ctL.clone(); ctR.position.x = 8; cat.add(ctL, ctR);

    const capGroup = new THREE.Group();
    const capMat = new THREE.MeshStandardMaterial({ color: 0xff9900, metalness: 0.9, transparent: true, opacity: 0.75 });
    const capB = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.2, 12), capMat); capB.rotation.x = Math.PI/2; capGroup.add(capB);
    const capT = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 12), capMat); capT.position.z = 1.6; capGroup.add(capT);
    const capBot = capT.clone(); capBot.position.z = -1.6; capGroup.add(capBot);
    const bSpL = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), capMat); bSpL.position.set(-0.6, -0.6, -1.2);
    const bSpR = bSpL.clone(); bSpR.position.x = 0.6; capGroup.add(bSpL, bSpR);
    capGroup.position.y = 2.4; cat.add(capGroup); rides.catapult.capsule = capGroup; scene.add(cat);

    // 7. Spinner
    const sp = new THREE.Group(); sp.position.copy(rides.spinner.pos);
    const spPivotMat = new THREE.MeshStandardMaterial({ color: 0x333, metalness: 0.9 });
    const sp1 = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 12), spPivotMat); sp1.position.set(-1.8, 1, 0);
    const sp2 = sp1.clone(); sp2.position.x = 1.8; sp.add(sp1, sp2);
    const spAx = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 4), spPivotMat); spAx.position.y = 2.8; sp.add(spAx);

    const discGroup = new THREE.Group(); discGroup.position.set(0, 4.8, 0); discGroup.rotation.x = rides.spinner.tilt;
    const discB = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.5, 0.8, 24), new THREE.MeshStandardMaterial({color:0x1b1c2b, metalness:0.9})); discB.castShadow=true; discGroup.add(discB);
    const dRing = new THREE.Mesh(new THREE.TorusGeometry(11.6, 0.15, 6, 24), new THREE.MeshStandardMaterial({color:0x00ffd2, metalness:0.95})); dRing.rotation.x = Math.PI/2; discGroup.add(dRing);

    for(let i=0;i<8;i++) {
        const a = (i/8)*Math.PI*2;
        const cabS = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 8), new THREE.MeshStandardMaterial({color:0xbd00ff, metalness:0.85}));
        cabS.position.set(Math.cos(a)*9.5, 1.0, Math.sin(a)*9.5); discGroup.add(cabS);
    }
    sp.add(discGroup); rides.spinner.wheel = discGroup; scene.add(sp);

    // 8. Bumper Cars (NSFW: wide double spherical car rear)
    const bp = new THREE.Group(); bp.position.copy(rides.bumper.pos);
    const bpFl = new THREE.Mesh(new THREE.BoxGeometry(45,0.4,45), new THREE.MeshStandardMaterial({map:concreteTex, metalness:0.6})); bpFl.position.y=0.2; bpFl.receiveShadow=true; bp.add(bpFl);
    
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(47,1.4,1), new THREE.MeshStandardMaterial({map:concreteTex}));
    const wallN = wallB.clone(); wallN.position.set(0,0.9,-23);
    const wallS = wallB.clone(); wallS.position.set(0,0.9,23);
    const wallW = new THREE.Mesh(new THREE.BoxGeometry(1,1.4,47), wallB.material); wallW.position.set(-23,0.9,0);
    const wallE = wallW.clone(); wallE.position.set(23,0.9,0);
    bp.add(wallN, wallS, wallW, wallE);

    const hzN = new THREE.Mesh(new THREE.BoxGeometry(46.8, 0.6, 1.1), new THREE.MeshStandardMaterial({map:hazardTex})); hzN.position.set(0,0.9,-23);
    const hzS = hzN.clone(); hzS.position.set(0,0.9,23); bp.add(hzN, hzS);

    const car = new THREE.Group();
    const carMat = new THREE.MeshStandardMaterial({ color: 0xff0066, metalness: 0.95, roughness: 0.1 });
    const carB = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 2.4), carMat); carB.position.y=0.55; carB.castShadow=true; car.add(carB);
    const carN = new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.7,1.2), carMat); carN.rotation.x = Math.PI/2; carN.position.set(0,0.55,1.4); car.add(carN);
    const buttL = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 12), carMat); buttL.position.set(-0.62,0.55,-1.2);
    const buttR = buttL.clone(); buttR.position.x = 0.62; car.add(buttL, buttR);
    
    const spL = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.15,0.6), new THREE.MeshStandardMaterial({color:0x222, metalness:0.99})); spL.position.set(0,1.1,-1.3); car.add(spL);
    car.position.set(0,0.4,0); bp.add(car); rides.bumper.car = car; scene.add(bp);
}

function updateCoasterPosition(progress) {
    if (!rides.coaster.curve || !rides.coaster.cart) return;
    const pos = rides.coaster.curve.getPointAt(progress);
    const nextPos = rides.coaster.curve.getPointAt((progress + 0.002) % 1);
    
    rides.coaster.cart.position.copy(pos);
    rides.coaster.cart.lookAt(nextPos);
}

function updateDropTower(delta) {
    const tower = rides.droptower;
    const cabin = tower.cabin;
    if (!cabin) return;

    switch (tower.state) {
        case 'climbing':
            tower.speed = 4.5;
            tower.height += tower.speed * delta;
            cabin.position.y = 8 + tower.height;
            if (tower.height >= tower.maxHeight) {
                tower.height = tower.maxHeight;
                tower.state = 'waiting';
                tower.timer = 2.0;
            }
            break;
        case 'waiting':
            cabin.position.y = 8 + tower.height;
            tower.timer -= delta;
            if (tower.timer <= 0.5) {
                cabin.position.x = (Math.random() - 0.5) * 0.15;
            }
            if (tower.timer <= 0) {
                cabin.position.x = 0;
                tower.state = 'dropping';
                tower.speed = 0;
                playSoundEffect('error');
            }
            break;
        case 'dropping':
            tower.speed += 95 * delta;
            tower.height -= tower.speed * delta;
            cabin.position.y = 8 + tower.height;
            if (currentRide === 'droptower') tower.shakeTime = 0.35;
            if (tower.height <= 0) {
                tower.state = 'braking';
            }
            break;
        case 'braking':
            tower.speed -= (tower.speed * 6.5) * delta;
            tower.height -= tower.speed * delta;
            cabin.position.y = 8 + tower.height;
            if (Math.random() > 0.4) {
                const spPos = new THREE.Vector3();
                cabin.getWorldPosition(spPos);
                createSpark(spPos);
            }
            if (tower.height <= 0.1 || tower.speed < 0.25) {
                tower.height = 0;
                cabin.position.y = 8; 
                tower.state = 'idle';
            }
            break;
    }
}


// Player
function createPlayer() {
    player = new THREE.Group(); player.position.set(0, 0, 125);
    
    // High-gloss neon highlighted body material
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.1,1.7,0.7), new THREE.MeshStandardMaterial({
        color: 0x00d2ff, 
        metalness: 0.9, 
        roughness: 0.1,
        emissive: 0x00aaff,
        emissiveIntensity: 0.4
    })); 
    b.position.y = 1.55; b.castShadow = true;
    
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.75,0.75,0.75), new THREE.MeshStandardMaterial({
        color: 0x111122, 
        metalness: 0.8,
        emissive: 0x00ffd2,
        emissiveIntensity: 0.15
    })); 
    h.position.y = 2.7; h.castShadow = true;
    
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.65,0.12,0.1), new THREE.MeshStandardMaterial({
        color: 0x00ffd2,
        emissive: 0x00ffd2,
        emissiveIntensity: 1.8
    })); 
    eyes.position.set(0, 2.7, 0.38);
    
    player.add(b, h, eyes);

    // Cyan glowing pointlight cast on the ground around the player
    const glowLight = new THREE.PointLight(0x00ffd2, 1.8, 8, 1.5);
    glowLight.position.set(0, 1.0, 0);
    player.add(glowLight);

    scene.add(player);
}

// Roaming NPCs
function spawnNPCs() {
    const colors = [0xff0055, 0x00aaff, 0xffd200, 0xbd00ff, 0x00ffd2, 0x55ff00, 0xff8800];
    const legGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18), legMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c });

    for(let i=0;i<NPC_COUNT;i++) {
        const gp = new THREE.Group();
        let x = (Math.random()-0.5)*220, z = (Math.random()-0.5)*180;
        if (i < 12) { x = (Math.random()-0.5)*80; z = 105+Math.random()*30; }
        else if (x>38 && x<82 && z>-82 && z<-38) { x -= 40; }
        gp.position.set(x,0,z);

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.45), new THREE.MeshStandardMaterial({color:colors[i%colors.length], roughness:0.3})); body.position.y=1.0; body.castShadow=true; gp.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshStandardMaterial({color:0xffd2aa})); head.position.y=1.85; gp.add(head);
        
        const lL = new THREE.Mesh(legGeo, legMat); lL.position.set(-0.2, 0.3, 0); lL.castShadow=true;
        const lR = lL.clone(); lR.position.x = 0.2;
        gp.add(lL, lR); scene.add(gp);

        npcs.push({ mesh: gp, legL: lL, legR: lR, speed: 3+Math.random()*2, target: new THREE.Vector3(x,0,z), outside:(i<12) });
    }
}

// NPC AI Loop
function updateNPCs(delta) {
    const t = clock.getElapsedTime();
    npcs.forEach(npc => {
        const m = npc.mesh;
        if (m.position.distanceTo(npc.target) < 2) {
            let tx = (Math.random()-0.5)*(npc.outside?80:220), tz = npc.outside?(105+Math.random()*30):((Math.random()-0.5)*165 - 10);
            if (!npc.outside && tx>38 && tx<82 && tz>-82 && tz<-38) tx -= 40;
            npc.target.set(tx, 0, tz);
        }
        const dir = new THREE.Vector3().subVectors(npc.target, m.position); dir.y=0; dir.normalize();
        m.position.addScaledVector(dir, npc.speed*delta);
        
        const targetRot = Math.atan2(dir.x, dir.z);
        let diff = Math.atan2(Math.sin(targetRot - m.rotation.y), Math.cos(targetRot - m.rotation.y));
        m.rotation.y += diff * 0.12;

        const cycle = Math.sin(t * npc.speed * 2.2);
        npc.legL.rotation.x = cycle * 0.45;
        npc.legR.rotation.x = -cycle * 0.45;
        m.children[0].position.y = 1.0 + Math.abs(cycle)*0.08;
    });
}

// Game Loops
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    if (isGameStarted) {
        // Gate Physics
        if (isTicketPurchased) {
            if (gateLeftBarrier.rotation.z > 0) { gateLeftBarrier.rotation.z -= 0.05; gateLeftBarrier.position.set(-8, 5.5, 0); }
            if (gateRightBarrier.rotation.z < 0) { gateRightBarrier.rotation.z += 0.05; gateRightBarrier.position.set(8, 5.5, 0); }
        } else if (player.position.z < 97 && player.position.z > 90) {
            player.position.z = 98; playerVelocity.z = 0;
            showCenterPrompt("购买门票 ($100) 以进入操逼乐园！按 E 购买。");
        }

        // Player physics
        if (!currentRide && !activeJob) {
            if (player.position.y > 0) playerVelocity.y -= GRAVITY*delta;
            else { playerVelocity.y = 0; player.position.y = 0; }
            if (keys.space && player.position.y === 0) { playerVelocity.y = JUMP_FORCE; playSoundEffect('jump'); }

            const fwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), cameraYaw);
            const rgt = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), cameraYaw);
            const mv = new THREE.Vector3();
            if (keys.w) mv.add(fwd); if (keys.s) mv.add(fwd.clone().negate());
            if (keys.a) mv.add(rgt.clone().negate()); if (keys.d) mv.add(rgt);
            mv.normalize(); playerVelocity.x = mv.x*MOVE_SPEED; playerVelocity.z = mv.z*MOVE_SPEED;
            player.position.addScaledVector(playerVelocity, delta);

            if (mv.lengthSq() > 0.01) {
                const tr = Math.atan2(mv.x, mv.z);
                player.rotation.y += Math.atan2(Math.sin(tr - player.rotation.y), Math.cos(tr - player.rotation.y))*0.15;
            }
            player.position.x = Math.max(-145, Math.min(145, player.position.x));
            player.position.z = Math.max(-145, Math.min(145, player.position.z));
            document.getElementById('speed-meter').innerText = Math.round(new THREE.Vector2(playerVelocity.x, playerVelocity.z).length()*3.6);
        }

        updateNPCs(delta);
        if (waterTex) { waterTex.offset.x += 0.04*delta; waterTex.offset.y += 0.02*delta; }

        // Coaster Progress
        const coaster = rides.coaster;
        const cFactor = coaster.isActive ? 0.04 : 0.015;
        coaster.progress = (coaster.progress + cFactor * delta) % 1;
        updateCoasterPosition(coaster.progress);

        // Drop Tower update
        updateDropTower(delta);

        // Ferris wheel update
        const ferris = rides.ferris;
        ferris.angle += 0.18 * delta; if (ferris.wheel) ferris.wheel.rotation.z = ferris.angle;
        ferris.cabins.forEach(c => c.rotation.z = -ferris.angle);

        // Pendulum arm update
        const pen = rides.pendulum;
        pen.swingAngle += pen.swingSpeed * delta;
        if (pen.arm) pen.arm.rotation.z = Math.sin(pen.swingAngle) * 1.1;
        pen.rotAngle += 3 * delta; if (pen.ring) pen.ring.rotation.z = pen.rotAngle;

        // Jetski update
        const js = rides.jetski;
        if (currentRide === 'jetski') {
            js.speed = THREE.MathUtils.lerp(js.speed, keys.w ? 20 : (keys.s ? -10 : 0), 0.05);
            if (keys.a) js.angle += 2 * delta; if (keys.d) js.angle -= 2 * delta;
            js.ski.position.addScaledVector(new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0), js.angle), js.speed*delta);
            js.ski.rotation.y = js.angle;
            js.ski.position.clamp(new THREE.Vector3(-20,1.2,-20), new THREE.Vector3(20,1.2,20));
            if (Math.abs(js.speed)>2 && Math.random()>0.4) {
                const p = new THREE.Vector3(); js.ski.getWorldPosition(p); createSpark(p);
            }
        } else if (js.ski) js.ski.position.y = 1.15 + Math.sin(clock.getElapsedTime()*2)*0.08;

        // Catapult update
        const cat = rides.catapult;
        if (cat.state === 'launching') {
            cat.launchSpeed += 80*delta; cat.launchHeight += cat.launchSpeed*delta; cat.capsule.position.y = 2.4+cat.launchHeight;
            if (cat.launchHeight >= 45) { cat.state = 'bouncing'; cat.launchSpeed = -20; }
        } else if (cat.state === 'bouncing') {
            cat.launchSpeed -= 32*delta; cat.launchHeight += cat.launchSpeed*delta; cat.capsule.position.y = 2.4+cat.launchHeight;
            if (cat.launchHeight < 0.1) {
                cat.launchHeight = 0.1; cat.launchSpeed = -cat.launchSpeed * 0.55;
                if (Math.abs(cat.launchSpeed) < 3) { cat.state = 'idle'; cat.launchHeight = 0; cat.capsule.position.y = 2.4; }
            }
        }

        // Spinner update
        const sp = rides.spinner;
        sp.angle += 1.8*delta; if (sp.wheel) { sp.wheel.rotation.y = sp.angle; sp.wheel.rotation.x = sp.tilt + Math.sin(clock.getElapsedTime()*2)*0.15; }

        // Bumper Cars update
        const bp = rides.bumper;
        if (currentRide === 'bumper') {
            bp.speed = THREE.MathUtils.lerp(bp.speed, keys.w ? 24 : (keys.s ? -12 : 0), 0.05);
            if (keys.a) bp.angle += 3*delta; if (keys.d) bp.angle -= 3*delta;
            bp.car.position.addScaledVector(new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0), bp.angle), bp.speed*delta);
            bp.car.rotation.y = bp.angle;
            bp.car.position.x = Math.max(-21.5, Math.min(21.5, bp.car.position.x));
            bp.car.position.z = Math.max(-21.5, Math.min(21.5, bp.car.position.z));
            if (Math.abs(bp.speed)>2 && Math.random()>0.4) {
                const p = new THREE.Vector3(); bp.car.getWorldPosition(p); createSpark(p);
            }
        }

        checkInteractions();
        updateVFX(delta);
        updateCamera();
        drawMinimap();
    }
    renderer.render(scene, camera);
}

// Interaction
function checkInteractions() {
    if (!isGameStarted || currentRide || activeJob) return;
    const prompt = document.getElementById('interaction-prompt');
    const txt = document.getElementById('prompt-text');

    if (!isTicketPurchased && player.position.distanceTo(entranceGatePos) < 7) { nearbyInteractable = 'buy_ticket'; txt.innerText = "按 E 购买门票 (花费 $100)"; prompt.classList.remove('hidden'); return; }
    if (player.position.distanceTo(shopBurgerPos) < 6) { nearbyInteractable = 'job_burger'; txt.innerText = "按 E 打工：制作乳液汉堡 (赚 $50)"; prompt.classList.remove('hidden'); return; }
    if (player.position.distanceTo(shopJuicePos) < 6) { nearbyInteractable = 'job_juice'; txt.innerText = "按 E 打工：制作香肠果汁 (赚 $80)"; prompt.classList.remove('hidden'); return; }
    if (player.position.distanceTo(shopCryptoPos) < 6) { nearbyInteractable = 'job_crypto'; txt.innerText = "按 E 进入二楼炒币打工 (赚 $300)"; prompt.classList.remove('hidden'); return; }

    if (isTicketPurchased) {
        for (let key in rides) {
            const rd = rides[key]; const p = new THREE.Vector3();
            if (key === 'coaster') rd.cart.getWorldPosition(p);
            else if (key === 'droptower') rd.cabin.getWorldPosition(p);
            else if (key === 'ferris') rd.wheel.getWorldPosition(p);
            else if (key === 'pendulum') rd.ring.getWorldPosition(p);
            else if (key === 'jetski') rd.ski.getWorldPosition(p);
            else if (key === 'catapult') rd.capsule.getWorldPosition(p);
            else if (key === 'spinner') rd.wheel.getWorldPosition(p);
            else if (key === 'bumper') rd.car.getWorldPosition(p);

            if (player.position.distanceTo(p) < 6) {
                nearbyInteractable = `ride_${key}`; txt.innerText = `乘坐 ${rd.name} (花费 $20)`; prompt.classList.remove('hidden'); return;
            }
        }
    }
    nearbyInteractable = null; prompt.classList.add('hidden');
}

function handleInteractionKeyPress() {
    if (!nearbyInteractable) return;
    playSoundEffect('click');
    if (nearbyInteractable === 'buy_ticket') {
        if (playerCash >= 100) { playerCash -= 100; isTicketPurchased = true; playSoundEffect('cash'); updateCashHUD(); showCenterPrompt("购票成功！闸机开启。"); }
        else { playSoundEffect('error'); showCenterPrompt("现金不足 $100！请前往店铺打工赚钱。"); }
    } else if (nearbyInteractable.startsWith('job_')) {
        startJob(nearbyInteractable.split('_')[1]);
    } else if (nearbyInteractable.startsWith('ride_')) {
        const rKey = nearbyInteractable.split('_')[1];
        if (playerCash >= 20) { playerCash -= 20; updateCashHUD(); playSoundEffect('cash'); boardRide(rKey); }
        else { playSoundEffect('error'); showCenterPrompt("余额不足！每次游玩项目需要 $20！"); }
    }
}

function boardRide(rideName) {
    currentRide = rideName; nearbyInteractable = null;
    document.getElementById('interaction-prompt').classList.add('hidden');
    const overlay = document.getElementById('ride-overlay'), title = document.getElementById('ride-title'), view = document.getElementById('view-toggle-btn');
    overlay.classList.remove('hidden'); player.visible = false;
    
    view.classList.add('hidden');
    if (rideName === 'coaster') { title.innerText = '正在乘坐：操逼过山车 🎢'; view.classList.remove('hidden'); rides.coaster.isActive = true; }
    else if (rideName === 'droptower') { title.innerText = '正在挑战：操逼跳楼机 🚀'; rides.droptower.state = 'climbing'; rides.droptower.height = 0; }
    else if (rideName === 'ferris') { title.innerText = '正在乘坐：霓虹摩天轮 🎡'; }
    else if (rideName === 'pendulum') { title.innerText = '正在乘坐：寄吧大摆锤 🎡'; }
    else if (rideName === 'jetski') { title.innerText = '正在驾驶：吵币水上摩托 🚤'; }
    else if (rideName === 'catapult') { title.innerText = '正在弹射：机霸铠甲弹射装置 🚀'; rides.catapult.state = 'launching'; }
    else if (rideName === 'spinner') { title.innerText = '正在乘坐：超碧大转盘 🎡'; }
    else if (rideName === 'bumper') { title.innerText = '正在驾驶：大屁飞车 🏎️'; }
    document.getElementById('player-status').innerText = `乘坐：${rides[rideName==='ferris'?'ferris':rideName].name}`;
}

function exitRide() {
    if (!currentRide) return;
    playSoundEffect('click'); player.visible = true;
    rides.jetski.speed = 0; rides.bumper.speed = 0;
    const rd = rides[currentRide]; player.position.copy(rd.pos).add(new THREE.Vector3(0,0,10)); player.position.y=0;
    if (currentRide === 'coaster') rides.coaster.isActive = false;
    if (currentRide === 'droptower') rides.droptower.state = 'idle';
    if (currentRide === 'catapult') rides.catapult.state = 'idle';
    currentRide = null; document.getElementById('ride-overlay').classList.add('hidden');
    document.getElementById('player-status').innerText = "自由探索中";
}

function toggleCoasterCamera() {
    if (currentRide !== 'coaster') return;
    playSoundEffect('click');
    coasterCameraMode = coasterCameraMode==='third' ? 'first' : (coasterCameraMode==='first' ? 'cinematic' : 'third');
}

function showCenterPrompt(txt) {
    const p = document.getElementById('interaction-prompt'), t = document.getElementById('prompt-text');
    t.innerText = txt; p.classList.remove('hidden');
    setTimeout(() => p.classList.add('hidden'), 3500);
}

// Jobs logic
function startJob(job) {
    activeJob = job; jobProgress = 0; jobCount = 0; playerVelocity.set(0,0,0);
    if (job === 'burger') {
        document.getElementById('job-burger-screen').classList.remove('hidden');
        document.getElementById('burger-progress').style.width = '0%';
        document.getElementById('burger-count').innerText = '0';
    } else if (job === 'juice') {
        document.getElementById('job-juice-screen').classList.remove('hidden');
        document.getElementById('juice-count').innerText = '0'; resetJuiceStage();
    } else if (job === 'crypto') {
        document.getElementById('job-crypto-screen').classList.remove('hidden');
        let tLeft = 20; const div = document.getElementById('crypto-console'), timer = document.getElementById('crypto-timer');
        div.innerHTML = "[SYSTEM] 二楼疯狂炒币交易终端就绪...<br>";
        const trades = ["📈 DOGE 币翻倍！大赚！", "📉 插针瞬间归零！追投保证金！", "🚀 金狗操逼币暴涨 500倍！", "💀 杠杆爆仓！强平线告急..."];
        const timerId = setInterval(() => {
            if (activeJob !== 'crypto') { clearInterval(timerId); return; }
            tLeft--; timer.innerText = tLeft;
            div.innerHTML += `[TRADE] ${trades[Math.floor(Math.random()*trades.length)]}<br>`; div.scrollTop = div.scrollHeight;
            if (tLeft <= 0) { clearInterval(timerId); quitJob(true); }
        }, 1000);
    }
    document.getElementById('player-status').innerText = `正在打工：${job}`;
}

function quitJob(com = false) {
    if (!activeJob) return;
    document.getElementById('job-burger-screen').classList.add('hidden');
    document.getElementById('job-juice-screen').classList.add('hidden');
    document.getElementById('job-crypto-screen').classList.add('hidden');

    if (com) {
        const pay = activeJob==='burger'?50 : (activeJob==='juice'?80 : 300);
        playerCash += pay; playSoundEffect('cash'); updateCashHUD();
        showCenterPrompt(`打工完成！获得酬劳 $${pay}`);
    } else showCenterPrompt("打工被放弃，无报酬！");
    activeJob = null; document.getElementById('player-status').innerText = "自由探索中";
}

function setupBurgerJobEvents() {
    const st = document.getElementById('rubber-stick-1');
    st.addEventListener('mousedown', (e) => {
        let startX = e.clientX, sLeft = st.offsetLeft;
        const drag = (ev) => {
            let dx = ev.clientX - startX, max = st.parentElement.offsetWidth - st.offsetWidth;
            let target = Math.max(0, Math.min(max, sLeft + dx)); st.style.left = target + 'px';
            jobProgress += Math.abs(ev.clientX - startX)*0.22;
            document.getElementById('burger-progress').style.width = Math.min(100, jobProgress) + '%';
            if (jobProgress >= 100) {
                playSoundEffect('squirt'); jobProgress = 0; jobCount++;
                document.getElementById('burger-count').innerText = jobCount;
                document.getElementById('sauce-layer').style.height = '14px';
                setTimeout(() => { document.getElementById('sauce-layer').style.height='0px'; document.getElementById('burger-progress').style.width='0%'; }, 350);
                if (jobCount >= 5) { setTimeout(() => quitJob(true), 500); window.removeEventListener('mousemove', drag); }
            }
            startX = ev.clientX; sLeft = target;
        };
        window.addEventListener('mousemove', drag);
        window.addEventListener('mouseup', () => window.removeEventListener('mousemove', drag), { once: true });
    });
    document.getElementById('quit-burger-btn').addEventListener('click', () => quitJob());
}

function setupJuiceJobEvents() {
    const ds = document.getElementById('sausage-drag');
    let hasSausageInCup = false, waterFillLevel = 0;
    ds.addEventListener('click', () => {
        if (activeJob !== 'juice' || hasSausageInCup) return;
        hasSausageInCup = true; ds.classList.add('hidden');
        document.getElementById('cup-sausage').classList.remove('hidden'); playSoundEffect('click');
    });
    document.getElementById('tap-btn').addEventListener('click', () => {
        if (!hasSausageInCup || waterFillLevel >= 100) return;
        waterFillLevel = 100; document.getElementById('cup-water').style.height = '100%'; playSoundEffect('squirt');
        setTimeout(() => {
            jobCount++; document.getElementById('juice-count').innerText = jobCount;
            if (jobCount >= 10) quitJob(true); else {
                hasSausageInCup = false; waterFillLevel = 0;
                ds.classList.remove('hidden');
                document.getElementById('cup-sausage').classList.add('hidden');
                document.getElementById('cup-water').style.height = '0%';
            }
        }, 1000);
    });
    document.getElementById('quit-juice-btn').addEventListener('click', () => quitJob());
}

// Camera controls
function updateCamera() {
    if (!player) return;
    if (currentRide === 'coaster') {
        const ct = rides.coaster.cart, p = new THREE.Vector3(); ct.getWorldPosition(p);
        const rot = new THREE.Matrix4().extractRotation(ct.matrixWorld);
        const dir = new THREE.Vector3(0,0,1).applyMatrix4(rot).normalize();
        const up = new THREE.Vector3(0,1,0).applyMatrix4(rot).normalize();

        if (coasterCameraMode === 'first') { camera.position.copy(p).addScaledVector(up,1.4).addScaledVector(dir,0.4); camera.lookAt(p.clone().addScaledVector(dir,10)); camera.up.copy(up); }
        else if (coasterCameraMode === 'third') { camera.position.lerp(p.clone().addScaledVector(dir,-10).addScaledVector(up,4), 0.2); camera.lookAt(p.clone().addScaledVector(dir,4)); camera.up.set(0,1,0); }
        else { camera.position.set(60, 45, 0); camera.lookAt(p); camera.up.set(0,1,0); }
    } else if (currentRide === 'droptower') {
        const p = new THREE.Vector3(); rides.droptower.cabin.getWorldPosition(p);
        camera.position.set(0, 25, -28).add(new THREE.Vector3((Math.random()-0.5)*rides.droptower.shakeTime, 0, 0));
        camera.lookAt(p);
    } else if (currentRide === 'ferris') {
        const p = new THREE.Vector3(); rides.ferris.wheel.getWorldPosition(p);
        camera.position.set(-60, 48, 25); camera.lookAt(p);
    } else if (currentRide === 'pendulum') {
        const p = new THREE.Vector3(); rides.pendulum.ring.getWorldPosition(p);
        camera.position.set(30, 20, 25); camera.lookAt(p);
    } else if (currentRide === 'jetski') {
        const p = new THREE.Vector3(); rides.jetski.ski.getWorldPosition(p);
        camera.position.copy(p).add(new THREE.Vector3(-10, 6, -10).applyAxisAngle(new THREE.Vector3(0,1,0), rides.jetski.angle));
        camera.lookAt(p);
    } else if (currentRide === 'catapult') {
        const p = new THREE.Vector3(); rides.catapult.capsule.getWorldPosition(p);
        camera.position.set(-25, 20, 30); camera.lookAt(p);
    } else if (currentRide === 'spinner') {
        const p = new THREE.Vector3(); rides.spinner.wheel.getWorldPosition(p);
        camera.position.set(-60, 22, 60); camera.lookAt(p);
    } else if (currentRide === 'bumper') {
        const p = new THREE.Vector3(); rides.bumper.car.getWorldPosition(p);
        camera.position.copy(p).add(new THREE.Vector3(0, 5, -11).applyAxisAngle(new THREE.Vector3(0,1,0), rides.bumper.angle));
        camera.lookAt(p);
    } else {
        const dx = 12 * Math.sin(cameraYaw) * Math.cos(cameraPitch);
        const dz = 12 * Math.cos(cameraYaw) * Math.cos(cameraPitch);
        const dy = 12 * Math.sin(cameraPitch);
        camera.position.lerp(new THREE.Vector3(player.position.x+dx, player.position.y+dy+2, player.position.z+dz), 0.15);
        camera.lookAt(player.position.x, player.position.y+1.8, player.position.z);
        camera.up.set(0, 1, 0);
    }
}

// Minimap Radar
function drawMinimap() {
    const canvas = document.getElementById('minimap-canvas'); if (!canvas || !player) return;
    const ctx = canvas.getContext('2d'), cx = canvas.width/2, cy = canvas.height/2, rad = canvas.width/2, scale = rad/150;
    ctx.clearRect(0,0,rad*2,rad*2);
    ctx.strokeStyle = 'rgba(0,210,255,0.15)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(cx,cy,rad*0.4,0,Math.PI*2); ctx.arc(cx,cy,rad*0.7,0,Math.PI*2); ctx.stroke();

    const drawPt = (wx, wz, col, size, lbl="") => {
        const rx = wx - player.position.x, rz = wz - player.position.z, px = cx+rx*scale, py = cy+rz*scale;
        if (Math.sqrt((px-cx)**2 + (py-cy)**2) < rad-6) {
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px,py,size,0,Math.PI*2); ctx.fill();
            if (lbl) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '7px sans-serif'; ctx.fillText(lbl, px+size+2, py+2); }
        }
    };
    npcs.forEach(n => drawPt(n.mesh.position.x, n.mesh.position.z, 'rgba(150,150,160,0.65)', 2));
    for (let key in rides) drawPt(rides[key].pos.x, rides[key].pos.z, '#ff0080', 4, rides[key].name[0]);
    drawPt(shopBurgerPos.x, shopBurgerPos.z, '#ffd200', 4.5, "🍔");
    drawPt(shopJuicePos.x, shopJuicePos.z, '#00d2ff', 4.5, "🥤");
    drawPt(shopCryptoPos.x, shopCryptoPos.z, '#33ff33', 5, "💻");
    drawPt(entranceGatePos.x, entranceGatePos.z, '#ffffff', 5, "🚪");

    ctx.fillStyle = '#00ffd2'; ctx.beginPath(); const pa = player.rotation.y+Math.PI;
    ctx.moveTo(cx+Math.sin(pa)*7, cy+Math.cos(pa)*7); ctx.lineTo(cx+Math.sin(pa+2.5)*5, cy+Math.cos(pa+2.5)*5); ctx.lineTo(cx+Math.sin(pa-2.5)*5, cy+Math.cos(pa-2.5)*5);
    ctx.closePath(); ctx.fill();
}

// Particle updates
function spawnFirework() {
    if (!isGameStarted || activeJob) return;
    const x = (Math.random()-0.5)*160, z = (Math.random()-0.5)*160-20, h = 30+Math.random()*25;
    playSoundEffect('cash');
    const cols = [0xff0080, 0x00d2ff, 0xffd200, 0xbd00ff, 0x00ff88], cnt = 30, pos = [], vel = [];
    for(let i=0;i<cnt;i++) {
        pos.push(x,h,z); const t = Math.random()*Math.PI*2, p = Math.acos(Math.random()*2-1), s = 10+Math.random()*10;
        vel.push(Math.sin(p)*Math.cos(t)*s, Math.sin(p)*Math.sin(t)*s, Math.cos(p)*s);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({color:cols[Math.floor(Math.random()*cols.length)], size:0.8, transparent:true, blending:THREE.AdditiveBlending}));
    scene.add(pts); fireworks.push({ points:pts, velocities:vel, age:0, maxAge:1.3 });
}
function createSpark(p) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([p.x,p.y,p.z], 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({color:0xffd200, size:0.5, transparent:true, blending:THREE.AdditiveBlending}));
    scene.add(pts); sparks.push({ points:pts, velocity:[(Math.random()-0.5)*8, (Math.random()+0.5)*7, (Math.random()-0.5)*8], age:0, maxAge:0.4 });
}
function updateVFX(delta) {
    for(let i=fireworks.length-1;i>=0;i--) {
        const fw = fireworks[i]; fw.age += delta;
        if (fw.age >= fw.maxAge) { scene.remove(fw.points); fireworks.splice(i,1); continue; }
        const p = fw.points.geometry.attributes.position.array;
        for(let j=0;j<p.length;j+=3) { fw.velocities[j+1] -= 9.8*delta; p[j]+=fw.velocities[j]*delta; p[j+1]+=fw.velocities[j+1]*delta; p[j+2]+=fw.velocities[j+2]*delta; }
        fw.points.geometry.attributes.position.needsUpdate=true; fw.points.material.opacity = 1.0 - (fw.age/fw.maxAge);
    }
    for(let i=sparks.length-1;i>=0;i--) {
        const sp = sparks[i]; sp.age += delta;
        if (sp.age >= sp.maxAge) { scene.remove(sp.points); sparks.splice(i,1); continue; }
        const p = sp.points.geometry.attributes.position.array; sp.velocity[1] -= 15*delta;
        p[0]+=sp.velocity[0]*delta; p[1]+=sp.velocity[1]*delta; p[2]+=sp.velocity[2]*delta;
        sp.points.geometry.attributes.position.needsUpdate=true; sp.points.material.opacity = 1.0 - (sp.age/sp.maxAge);
    }
}

// Check loader
if (document.readyState === 'complete' || document.readyState === 'interactive') initUI();
else document.addEventListener('DOMContentLoaded', initUI);
