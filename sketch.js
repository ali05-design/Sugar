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

// Logic Maps
let targetMap = [];
let visitedMap = [];
let crawlers = [];

// Dimensions
let imgWidth, imgHeight;
let videoScale = 15; 

// State
let isProcessing = false;
let totalTargetPixels = 0;
let visitedPixelsCount = 0;

// UI Controls
let bgColorPicker;

// Crawler Arrays
let spawnQueue = [];        

// --- CONFIGURATION ---
const CRAWLER_COUNT = 60;   
const MOTION_THRESHOLD = 50; 
const PILE_DENSITY = 9;

// =========================================================
// PRELOAD LOCAL IMAGES
// =========================================================
function preload() {
  // Make sure these match the exact names in your resources folder
  img1 = loadImage('resources/LetteringFINAL1.png');
  img2 = loadImage('resources/LetteringFINAL2.png');
}

function setup() {
  frameRate(60);  
  
  // FIXED RESOLUTION: 1080x1920 portrait mode
  cnv = createCanvas(2160, 3840);
  pixelDensity(1);  
  
  // 1. SETUP WEBCAM 
  video = createCapture(VIDEO, () => {
      console.log("Camera active");
  });
  video.size(width / videoScale, height / videoScale);
  video.hide();
  
  // 2. SETUP DRAWING LAYER (Matching canvas size)
  sugarLayer = createGraphics(1080, 1920);
  sugarLayer.noStroke();
  
  // COLOR PICKER CONTROL (Fallback for background color)
  bgColorPicker = createColorPicker('#141419'); 
  bgColorPicker.hide(); // Hidden since we removed the HTML UI container
  
  // 3. INITIALIZE IMAGES
  images = [img1, img2];
  
  // Start processing the first image immediately
  processImage(images[currentImageIndex]);
  lastSwitchTime = millis();
}

function draw() {
  // Use the color picker value or hardcode a color like background(20, 20, 25);
  background(bgColorPicker.color()); 
  
  // Draw the sugar layer
  image(sugarLayer, 0, 0);
  
  // =========================================================
  // AUTO-SWITCH LOGIC
  // =========================================================
  if (millis() - lastSwitchTime > SWITCH_INTERVAL) {
      // Move to the next image in the array
      currentImageIndex = (currentImageIndex + 1) % images.length;
      
      // Retrace the new image
      processImage(images[currentImageIndex]);
      
      // Reset the timer
      lastSwitchTime = millis();
  }
  
  if (isProcessing) {
    // 1. MOTION DETECTION
    processMotion();
    
    // 2. HEALING LOGIC
    let deficit = totalTargetPixels - visitedPixelsCount;
    if (deficit > 0) {
       maintainCrawlers();
       let loops = deficit > 3000 ? 6 : 2; 
       for (let i = 0; i < crawlers.length; i++) {
         for (let n = 0; n < loops; n++) {
            crawlers[i].step();
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
  
  if (prevFramePixels.length === 0) {
      prevFramePixels = new Uint8Array(video.pixels);
      return;
  }
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let idx = (x + y * w) * 4;
      let r1 = video.pixels[idx];
      let r2 = prevFramePixels[idx];
      
      if (Math.abs(r1 - r2) > MOTION_THRESHOLD) {
          // Flip x-axis so interaction mirrors the user
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

    // 1. Check the data map FIRST to see if we actually hit any sugar
    let sugarHitCount = updateMapLogic(x, y, radius);
    
    // 2. If no sugar was hit in this area, STOP! Do not erase or draw new piles.
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
        
        let br = random(200, 255);
        ctx.fillStyle = `rgb(${br},${br},${br})`;
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
                    visitedMap[idx] = false;
                    visitedPixelsCount--;
                    removedPixels++; // We found and removed a sugar pixel
                }
            }
        }
    }
    
    for (let i = crawlers.length - 1; i >= 0; i--) {
        if (dist(crawlers[i].x, crawlers[i].y, x, y) < radius + 20) {
            crawlers[i].alive = false;
        }
    }

    // Report back how much sugar was actually affected
    return removedPixels; 
}

// =========================================================
// CRAWLERS & IMAGE PROCESSING
// =========================================================

class Crawler {
  constructor(x, y) {
    this.x = x; this.y = y; this.alive = true;
    this.life = 0;
  }
  step() {
    if (!this.alive) return;
    this.life++;
    
    addSugarPile(this.x, this.y);
    
    let idx = this.x + this.y * imgWidth;
    if (!visitedMap[idx]) { 
        visitedMap[idx] = true; 
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
    
    let br = 220 + Math.random() * 35; 
    ctx.fillStyle = `rgb(${br}, ${br}, 255)`;
    ctx.fillRect(ox, oy, size, size);
  }
}

function maintainCrawlers() {
  for (let i = crawlers.length - 1; i >= 0; i--) {
    if (!crawlers[i].alive) crawlers.splice(i, 1);
  }
  
  let attempts = 0;
  while(crawlers.length < CRAWLER_COUNT && attempts < 20) {
      attempts++;
      if (spawnQueue.length === 0) break;
      let r = floor(random(spawnQueue.length));
      let p = spawnQueue[r];
      let idx = p.x + p.y * imgWidth;
      
      if (!visitedMap[idx]) {
          crawlers.push(new Crawler(p.x, p.y));
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
  
  // .get() returns a new p5.Image, protecting the original preload
  let croppedImg = img.get(cropX, cropY, cropW, cropH);
  croppedImg.resize(width, height);
  croppedImg.loadPixels();
  
  imgWidth = croppedImg.width; 
  imgHeight = croppedImg.height;
  
  sugarLayer = createGraphics(imgWidth, imgHeight);
  sugarLayer.noStroke();
  
  targetMap = new Uint8Array(imgWidth * imgHeight); 
  visitedMap = new Uint8Array(imgWidth * imgHeight);
  
  totalTargetPixels = 0; visitedPixelsCount = 0;
  spawnQueue = [];
  
  let totalBright = 0;
  for(let i=0; i<1000; i+=4) totalBright += croppedImg.pixels[i];
  let isWhiteBg = (totalBright / 250) > 128;
  
  for (let i = 0; i < croppedImg.pixels.length; i += 4) {
    let b = (croppedImg.pixels[i] + croppedImg.pixels[i+1] + croppedImg.pixels[i+2]) / 3;
    let idx = i / 4;
    let isTarget = false;
    
    if (isWhiteBg) { if (b < 180) isTarget = true; } 
    else { if (b > 80) isTarget = true; }
    
    if (isTarget) { 
        targetMap[idx] = 1; 
        totalTargetPixels++; 
        spawnQueue.push({x: idx % imgWidth, y: floor(idx / imgWidth)});
    }
  }
  
  crawlers = [];
  isProcessing = true;
}

// =========================================================
// KEYBOARD CONTROLS
// =========================================================
function keyPressed() {
  // Check if the pressed key is 'f' or 'F'
  if (key === 'f' || key === 'F') {
    // Toggle fullscreen mode on and off
    let fs = fullscreen();
    fullscreen(!fs); 
  }
}