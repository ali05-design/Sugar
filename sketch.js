// GLOBALS
// =========================================================
let cnv;
let sugarLayer;
let video; 
let prevFramePixels = []; 

// Image Switching
let img1, img2;
let images = [];
let currentImageIndex = 0;
let lastSwitchTime = 0;
const SWITCH_INTERVAL = 60000; // 30 seconds in milliseconds

// Logic Maps (Pre-allocated for memory safety)
let targetMap;
let visitedMap;
let crawlers = [];
let spawnQueue; 
let spawnQueueLength = 0; 

// Memory-Safe Buffers & Caches
let cropBuffer; 
let cachedSugarColors = [];
let cachedDisplaceColors = [];

// Dimensions
let imgWidth, imgHeight;
let videoScale = 15; 
let totalPixels; 

// State
let isProcessing = false;
let totalTargetPixels = 0;
let visitedPixelsCount = 0;

// UI Controls
let bgColorPicker;

// --- CONFIGURATION ---
const CRAWLER_COUNT = 60;   
const MOTION_THRESHOLD = 50; 
const PILE_DENSITY = 9;

// =========================================================
// PRELOAD LOCAL IMAGES
// =========================================================
function preload() {
  img1 = loadImage('resources/LetteringFINAL1.png');
  img2 = loadImage('resources/LetteringFINAL2.png');
}

function setup() {
  frameRate(60);  
  
  // FIXED RESOLUTION: 1080x1920 portrait mode
  cnv = createCanvas(2160, 3840);
  pixelDensity(1);  
  
  imgWidth = width;
  imgHeight = height;
  totalPixels = imgWidth * imgHeight;
  
  // OPTIMIZATION 1: Pre-allocate memory blocks
  targetMap = new Uint8Array(totalPixels);
  visitedMap = new Uint8Array(totalPixels);
  spawnQueue = new Uint32Array(totalPixels); 
  
  // OPTIMIZATION 2: Pre-allocate a single image buffer for resizing
  // This prevents the p5.js "hidden canvas" memory leak during image switches
  cropBuffer = createImage(imgWidth, imgHeight);
  
  // OPTIMIZATION 3: Pre-cache RGB strings to prevent GC thrashing in drawing loops
  for (let i = 200; i <= 255; i++) {
    cachedSugarColors[i] = `rgb(${i}, ${i}, 255)`;
    cachedDisplaceColors[i] = `rgb(${i}, ${i}, ${i})`;
  }

  // OPTIMIZATION 4: Pre-allocate the crawler pool (No more 'new' or 'splice' in draw loop)
  for (let i = 0; i < CRAWLER_COUNT; i++) {
    crawlers.push(new Crawler());
  }
  
  // 1. SETUP WEBCAM 
  video = createCapture(VIDEO, () => {
      console.log("Camera active");
  });
  video.size(width / videoScale, height / videoScale);
  video.hide();
  
  // 2. SETUP DRAWING LAYER 
  sugarLayer = createGraphics(imgWidth, imgHeight);
  sugarLayer.noStroke();
  
  bgColorPicker = createColorPicker('#141419'); 
  bgColorPicker.hide(); 
  
  // 3. INITIALIZE IMAGES
  images = [img1, img2];
  
  processImage(images[currentImageIndex]);
  lastSwitchTime = millis();
}

function draw() {
  background(bgColorPicker.color()); 
  
  image(sugarLayer, 0, 0);
  
  // =========================================================
  // AUTO-SWITCH LOGIC
  // =========================================================
  if (millis() - lastSwitchTime > SWITCH_INTERVAL) {
      currentImageIndex = (currentImageIndex + 1) % images.length;
      processImage(images[currentImageIndex]);
      lastSwitchTime = millis();
  }
  
  if (isProcessing) {
    processMotion();
    
    let deficit = totalTargetPixels - visitedPixelsCount;
    if (deficit > 0) {
       maintainCrawlers();
       let loops = deficit > 3000 ? 6 : 2; 
       for (let i = 0; i < CRAWLER_COUNT; i++) {
         if (crawlers[i].alive) {
           for (let n = 0; n < loops; n++) {
              crawlers[i].step();
           }
         }
       }
    }
  }
}

// =========================================================
// MOTION DETECTION & NATURAL DISPLACEMENT
// =========================================================

function processMotion() {
  if (!video.width) return;
  video.loadPixels();
  
  let w = video.width;
  let h = video.height;
  
  if (prevFramePixels.length !== video.pixels.length) {
      prevFramePixels = new Uint8Array(video.pixels);
      return;
  }
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let idx = (x + y * w) * 4;
      let r1 = video.pixels[idx];
      let r2 = prevFramePixels[idx];
      
      if (Math.abs(r1 - r2) > MOTION_THRESHOLD) {
          let screenX = map(w - x - 1, 0, w, 0, width);
          let screenY = map(y, 0, h, 0, height);
          
          screenX += random(-10, 10);
          screenY += random(-10, 10);

          displaceSugar(screenX, screenY);
      }
      prevFramePixels[idx] = r1;
    }
  }
}

function displaceSugar(x, y) {
    let radius = 50;        
    let pushDist = 55;   

    let sugarHitCount = updateMapLogic(x, y, radius);
    
    if (sugarHitCount === 0) {
        return; 
    }

    let ctx = sugarLayer.drawingContext;

    // A. ERASE
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // B. DISPLACE
    let angle = random(TWO_PI);
    let pileX = x + cos(angle) * pushDist;
    let pileY = y + sin(angle) * pushDist;
    
    for(let i = 0; i < 15; i++) {
        let r = random(5, 30);
        let a = random(TWO_PI);
        let sx = pileX + cos(a) * r;
        let sy = pileY + sin(a) * r;
        let size = random(1, 3);
        
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.fillRect(sx + 1, sy + 1, size, size);
        
        // Use cached color string to save memory
        let br = Math.floor(random(200, 255));
        ctx.fillStyle = cachedDisplaceColors[br];
        ctx.fillRect(sx, sy, size, size);
    }
}

function updateMapLogic(x, y, radius) {
    let startX = Math.floor(constrain(x - radius, 0, imgWidth));
    let endX = Math.floor(constrain(x + radius, 0, imgWidth));
    let startY = Math.floor(constrain(y - radius, 0, imgHeight));
    let endY = Math.floor(constrain(y + radius, 0, imgHeight));

    let removedPixels = 0; 

    for (let cy = startY; cy < endY; cy++) {
        for (let cx = startX; cx < endX; cx++) {
            let idx = cx + cy * imgWidth;
            if (targetMap[idx] && visitedMap[idx]) {
                if (Math.abs(x - cx) + Math.abs(y - cy) < radius * 1.2) {
                    visitedMap[idx] = 0; 
                    visitedPixelsCount--;
                    removedPixels++; 
                }
            }
        }
    }
    
    // Deactivate crawlers instead of destroying objects
    for (let i = 0; i < CRAWLER_COUNT; i++) {
        if (crawlers[i].alive && dist(crawlers[i].x, crawlers[i].y, x, y) < radius + 20) {
            crawlers[i].alive = false;
        }
    }

    return removedPixels; 
}

// =========================================================
// CRAWLERS & IMAGE PROCESSING
// =========================================================

class Crawler {
  constructor() {
    this.x = 0; 
    this.y = 0; 
    this.alive = false;
    this.life = 0;
  }
  
  // New method: Re-initializes the existing object rather than creating a new one
  spawn(x, y) {
    this.x = x; 
    this.y = y; 
    this.alive = true;
    this.life = 0;
  }

  step() {
    if (!this.alive) return;
    this.life++;
    
    addSugarPile(this.x, this.y);
    
    let idx = this.x + this.y * imgWidth;
    if (!visitedMap[idx]) { 
        visitedMap[idx] = 1; 
        visitedPixelsCount++; 
    }
    
    let found = this.scanNeighbors(2);
    if (!found) found = this.scanNeighbors(6);
    if (!found || this.life > 180) this.alive = false;
  }
  
  scanNeighbors(radius) {
    for(let i=0; i<8; i++) {
        let dx = floor(random(-radius, radius));
        let dy = floor(random(-radius, radius));
        let nx = this.x + dx; 
        let ny = this.y + dy;
        
        if (nx >= 0 && nx < imgWidth && ny >= 0 && ny < imgHeight) {
          let nIdx = nx + ny * imgWidth;
          if (targetMap[nIdx] && !visitedMap[nIdx]) {
            this.x = nx; this.y = ny; return true;
          }
        }
    }
    return false;
  }
}

function addSugarPile(x, y) {
  let ctx = sugarLayer.drawingContext;
  for (let i = 0; i < PILE_DENSITY; i++) {
    let r = Math.random();
    let spread = (r < 0.85) ? 2.5 : (r < 0.97 ? 8 : 20);
    
    let angle = Math.random() * Math.PI * 2;
    let distance = Math.random() * spread;
    let ox = x + Math.cos(angle) * distance;
    let oy = y + Math.sin(angle) * distance;
    let size = Math.random() * 2.0 + 0.5; 
    
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.fillRect(ox + 1, oy + 1, size, size);
    
    // Use cached color string to save memory
    let br = Math.floor(220 + Math.random() * 35); 
    ctx.fillStyle = cachedSugarColors[br];
    ctx.fillRect(ox, oy, size, size);
  }
}

function maintainCrawlers() {
  let attempts = 0;
  
  // Object Pooling: Search for inactive crawlers to revive
  for (let i = 0; i < CRAWLER_COUNT; i++) {
    if (!crawlers[i].alive) {
      attempts++;
      if (spawnQueueLength === 0 || attempts > 20) break;
      
      let r = floor(random(spawnQueueLength));
      let idx = spawnQueue[r];
      let px = idx % imgWidth;
      let py = Math.floor(idx / imgWidth);
      
      if (!visitedMap[idx]) {
          crawlers[i].spawn(px, py); // Revive instead of 'new Crawler()'
      }
    }
  }
}

function processImage(img) {
  let imgRatio = img.width / img.height;
  let winRatio = width / height;
  let cropW, cropH, cropX, cropY;
  
  if (imgRatio > winRatio) {
    cropH = img.height; cropW = img.height * winRatio;
    cropY = 0; cropX = (img.width - cropW) / 2;
  } else {
    cropW = img.width; cropH = img.width / winRatio;
    cropX = 0; cropY = (img.height - cropH) / 2;
  }
  
  // CRITICAL FIX: Use the persistent buffer instead of img.get() and resize()
  // This prevents the browser from generating thousands of orphaned canvas contexts over a weekend.
  cropBuffer.copy(img, cropX, cropY, cropW, cropH, 0, 0, width, height);
  cropBuffer.loadPixels();
  
  sugarLayer.clear();
  
  targetMap.fill(0);
  visitedMap.fill(0);
  
  totalTargetPixels = 0; 
  visitedPixelsCount = 0;
  spawnQueueLength = 0;
  
  let totalBright = 0;
  for(let i=0; i<1000; i+=4) totalBright += cropBuffer.pixels[i];
  let isWhiteBg = (totalBright / 250) > 128;
  
  for (let i = 0; i < cropBuffer.pixels.length; i += 4) {
    let b = (cropBuffer.pixels[i] + cropBuffer.pixels[i+1] + cropBuffer.pixels[i+2]) / 3;
    let idx = i / 4;
    let isTarget = false;
    
    if (isWhiteBg) { if (b < 180) isTarget = true; } 
    else { if (b > 80) isTarget = true; }
    
    if (isTarget) { 
        targetMap[idx] = 1; 
        totalTargetPixels++; 
        
        spawnQueue[spawnQueueLength] = idx;
        spawnQueueLength++;
    }
  }
  
  // Soft reset all crawlers in the pool
  for(let i = 0; i < CRAWLER_COUNT; i++) {
     crawlers[i].alive = false;
  }
  isProcessing = true;
}

// =========================================================
// KEYBOARD CONTROLS
// =========================================================
function keyPressed() {
  if (key === 'f' || key === 'F') {
    let fs = fullscreen();
    fullscreen(!fs); 
  }
}
