import './style.css';

// ═══════════════════════════════════════
//  DOM
// ═══════════════════════════════════════
const video = document.getElementById('video') as HTMLVideoElement;
const offscreen = document.getElementById('offscreen') as HTMLCanvasElement;
const offCtx = offscreen.getContext('2d', { willReadFrequently: true })!;
const mainCanvas = document.getElementById('ascii-canvas') as HTMLCanvasElement;
const mainCtx = mainCanvas.getContext('2d', { alpha: false })!;

const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const startScreen = document.getElementById('start-screen') as HTMLDivElement;
const controlsPanel = document.getElementById('controls-panel') as HTMLDivElement;
const closeControlsBtn = document.getElementById('closeControls') as HTMLButtonElement;
const resolutionSlider = document.getElementById('resolutionSlider') as HTMLInputElement;
const errorMsg = document.getElementById('error-msg') as HTMLDivElement;
const customTextGroup = document.getElementById('customTextGroup') as HTMLDivElement;
const customTextInput = document.getElementById('customTextInput') as HTMLInputElement;
const screenshotBtn = document.getElementById('screenshotBtn') as HTMLButtonElement;
const trailsToggle = document.getElementById('trailsToggle') as HTMLInputElement;
const audioToggle = document.getElementById('audioToggle') as HTMLInputElement;
const invertToggle = document.getElementById('invertToggle') as HTMLInputElement;
const audioBar = document.getElementById('audio-bar') as HTMLDivElement;

// HUD
const hudMode = document.getElementById('hud-mode')!;
const hudTheme = document.getElementById('hud-theme')!;
const hudFps = document.getElementById('hud-fps')!;
const hudRes = document.getElementById('hud-resolution')!;

const modeButtons = document.getElementById('modeButtons')!;
const themeButtons = document.getElementById('themeButtons')!;
const toastContainer = document.getElementById('toast-container')!;

// ═══════════════════════════════════════
//  TYPES & CONSTANTS
// ═══════════════════════════════════════
type RenderMode = 'classic' | 'matrix' | 'edge' | 'emoji' | 'braille' | 'custom' | 'thermal';
type ColorTheme = 'matrix' | 'cyberpunk' | 'vaporwave' | 'fire' | 'mono';

// ASCII density strings
const DENSITY_STANDARD = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const DENSITY_BLOCKS = ' ░▒▓█';

// Braille patterns for ultra-HD
const BRAILLE_BASE = 0x2800;

// Emoji sets mapped by brightness bands
const EMOJI_SET = ['💀', '🌑', '😈', '👾', '🔮', '💜', '🌀', '💎', '✨', '⚡', '🔥', '💥', '⭐', '🌟', '💫', '🌞'];

// Color palettes
const THEMES: Record<ColorTheme, { bg: string; colorFn: (r: number, g: number, b: number, brightness: number) => string }> = {
  matrix: {
    bg: '#050810',
    colorFn: (_r, _g, _b, brightness) => {
      const g = Math.floor(100 + brightness * 0.6);
      return `rgb(0, ${g}, ${Math.floor(brightness * 0.15)})`;
    }
  },
  cyberpunk: {
    bg: '#0a0012',
    colorFn: (r, _g, b, brightness) => {
      // Shift between magenta and cyan based on position  
      const mag = Math.floor(brightness * 0.5 + r * 0.4);
      const cyan = Math.floor(brightness * 0.3 + b * 0.5);
      return `rgb(${mag}, ${Math.floor(brightness * 0.15)}, ${Math.max(mag, cyan)})`;
    }
  },
  vaporwave: {
    bg: '#1a0a2e',
    colorFn: (_r, _g, _b, brightness) => {
      const pink = Math.floor(150 + brightness * 0.4);
      const purple = Math.floor(80 + brightness * 0.5);
      const blue = Math.floor(180 + brightness * 0.3);
      return `rgb(${pink}, ${purple}, ${blue})`;
    }
  },
  fire: {
    bg: '#0f0500',
    colorFn: (_r, _g, _b, brightness) => {
      // Dark = deep red, mid = orange, bright = yellow
      const r = Math.floor(Math.min(255, 80 + brightness * 1.2));
      const g = Math.floor(Math.max(0, brightness * 0.8 - 30));
      const b = Math.floor(Math.max(0, brightness * 0.1 - 20));
      return `rgb(${r}, ${g}, ${b})`;
    }
  },
  mono: {
    bg: '#0a0a0a',
    colorFn: (_r, _g, _b, brightness) => {
      const v = Math.floor(brightness);
      return `rgb(${v}, ${v}, ${v})`;
    }
  }
};

const MODES: RenderMode[] = ['classic', 'matrix', 'edge', 'emoji', 'braille', 'custom', 'thermal'];
const THEME_KEYS: ColorTheme[] = ['matrix', 'cyberpunk', 'vaporwave', 'fire', 'mono'];

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
let isPlaying = false;
let rafId = 0;
let stream: MediaStream | null = null;
let currentMode: RenderMode = 'classic';
let currentTheme: ColorTheme = 'matrix';
let enableTrails = false;
let enableAudio = false;
let enableInvert = false;
let customText = 'HELLO';

// Audio state
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let audioData: Uint8Array | null = null;
let audioLevel = 0;

// FPS tracking
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;

// Matrix rain state
let rainDrops: number[] = [];
let rainInitialized = false;

// Previous frame for edge detection / trails
let prevPixels: Uint8ClampedArray | null = null;

// ═══════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════
function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function showError(msg: string) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
}

function getBrightness(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ═══════════════════════════════════════
//  CAMERA
// ═══════════════════════════════════════
async function startCamera() {
  try {
    errorMsg.style.display = 'none';
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false
    });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      isPlaying = true;
      startScreen.style.display = 'none';
      renderLoop();
    };
  } catch (err) {
    console.error(err);
    showError('Camera access denied. Please grant permissions and reload.');
  }
}

function stopCamera() {
  isPlaying = false;
  cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  mainCtx.fillStyle = '#000';
  mainCtx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
  startScreen.style.display = 'flex';
  prevPixels = null;
  rainInitialized = false;
  stopAudio();
}

// ═══════════════════════════════════════
//  AUDIO
// ═══════════════════════════════════════
async function startAudio() {
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(audioStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioData = new Uint8Array(analyser.frequencyBinCount);
    toast('🎤 Audio reactive ON');
  } catch {
    toast('⚠ Mic access denied');
    enableAudio = false;
    audioToggle.checked = false;
  }
}

function stopAudio() {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
    analyser = null;
    audioData = null;
  }
  audioLevel = 0;
  audioBar.style.height = '3px';
  audioBar.style.background = 'transparent';
}

function updateAudioLevel() {
  if (!analyser || !audioData) return;
  analyser.getByteFrequencyData(audioData);
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) sum += audioData[i];
  audioLevel = sum / audioData.length / 255; // 0-1
  // Visual feedback on the bar
  const h = 3 + audioLevel * 30;
  audioBar.style.height = `${h}px`;
  const themeConfig = THEMES[currentTheme];
  audioBar.style.background = themeConfig.colorFn(255, 255, 255, audioLevel * 255);
}

// ═══════════════════════════════════════
//  SCREENSHOT
// ═══════════════════════════════════════
function takeScreenshot() {
  const link = document.createElement('a');
  link.download = `ascii-cam-${Date.now()}.png`;
  link.href = mainCanvas.toDataURL('image/png');
  link.click();
  toast('📸 Screenshot saved!');
}

// ═══════════════════════════════════════
//  RENDER MODES
// ═══════════════════════════════════════
function charFromBrightness(brightness: number): string {
  if (enableInvert) brightness = 255 - brightness;
  const idx = Math.floor((brightness / 255) * (DENSITY_STANDARD.length - 1));
  return DENSITY_STANDARD[idx];
}

function thermalChar(brightness: number): string {
  if (enableInvert) brightness = 255 - brightness;
  const idx = Math.floor((brightness / 255) * (DENSITY_BLOCKS.length - 1));
  return DENSITY_BLOCKS[idx];
}

function thermalColor(brightness: number): string {
  // Ultra-cold = deep blue, cold = cyan, warm = yellow, hot = red, white-hot
  if (brightness < 50) return `rgb(0, 0, ${Math.floor(brightness * 3)})`;
  if (brightness < 100) return `rgb(0, ${Math.floor((brightness - 50) * 5)}, ${Math.floor(150 + brightness)})`;
  if (brightness < 170) return `rgb(${Math.floor((brightness - 100) * 3.5)}, ${Math.floor(255 - (brightness - 100))}, 0)`;
  return `rgb(255, ${Math.floor((brightness - 170) * 3)}, ${Math.floor((brightness - 170) * 2)})`;
}

// Edge detection using Sobel-like approach on brightness
function edgeDetect(
  pixels: Uint8ClampedArray,
  x: number, y: number,
  cols: number, rows: number
): number {
  if (x === 0 || y === 0 || x >= cols - 1 || y >= rows - 1) return 0;
  const idx = (i: number, j: number) => {
    const off = (j * cols + i) * 4;
    return getBrightness(pixels[off], pixels[off + 1], pixels[off + 2]);
  };
  const gx = -idx(x-1,y-1) + idx(x+1,y-1) - 2*idx(x-1,y) + 2*idx(x+1,y) - idx(x-1,y+1) + idx(x+1,y+1);
  const gy = -idx(x-1,y-1) - 2*idx(x,y-1) - idx(x+1,y-1) + idx(x-1,y+1) + 2*idx(x,y+1) + idx(x+1,y+1);
  return Math.min(255, Math.sqrt(gx * gx + gy * gy));
}

// Braille sub-block rendering (2x4 dot pattern)
function brailleChar(
  pixels: Uint8ClampedArray,
  bx: number, by: number,
  cols: number, _rows: number,
  threshold: number
): string {
  // Braille cell is 2 wide, 4 tall
  // Dot positions:  (0,0) (1,0)
  //                 (0,1) (1,1)
  //                 (0,2) (1,2)
  //                 (0,3) (1,3)
  const dotMap = [
    [0, 0, 0x01], [1, 0, 0x08],
    [0, 1, 0x02], [1, 1, 0x10],
    [0, 2, 0x04], [1, 2, 0x20],
    [0, 3, 0x40], [1, 3, 0x80]
  ];
  let code = 0;
  for (const [dx, dy, bit] of dotMap) {
    const px = bx + dx;
    const py = by + dy;
    if (px < cols && py < _rows) {
      const off = (py * cols + px) * 4;
      let br = getBrightness(pixels[off], pixels[off + 1], pixels[off + 2]);
      if (enableInvert) br = 255 - br;
      if (br > threshold) code |= bit;
    }
  }
  return String.fromCharCode(BRAILLE_BASE + code);
}

// ═══════════════════════════════════════
//  MAIN RENDER LOOP
// ═══════════════════════════════════════
function renderLoop() {
  if (!isPlaying) return;
  rafId = requestAnimationFrame(renderLoop);

  // FPS counting
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    currentFps = frameCount;
    frameCount = 0;
    lastFpsTime = now;
    hudFps.textContent = `${currentFps} FPS`;
  }

  // Audio
  if (enableAudio) updateAudioLevel();

  // Ensure canvas dimensions
  if (mainCanvas.width !== window.innerWidth || mainCanvas.height !== window.innerHeight) {
    mainCanvas.width = window.innerWidth;
    mainCanvas.height = window.innerHeight;
  }

  const vW = video.videoWidth;
  const vH = video.videoHeight;
  if (!vW || !vH) return;

  const cW = mainCanvas.width;
  const cH = mainCanvas.height;

  const resValue = parseInt(resolutionSlider.value);
  const themeConfig = THEMES[currentTheme];

  // Calculate font size from slider
  let fontSize: number;
  if (currentMode === 'emoji') {
    fontSize = Math.max(8, 36 - Math.floor(resValue / 4));
  } else if (currentMode === 'braille') {
    fontSize = Math.max(6, 20 - Math.floor(resValue / 8));
  } else {
    fontSize = Math.max(4, 24 - Math.floor(resValue / 5));
  }

  // Audio reactivity: pulse font size
  if (enableAudio && audioLevel > 0.05) {
    fontSize += Math.floor(audioLevel * 6);
  }

  const charW = currentMode === 'emoji' ? fontSize : fontSize * 0.6;
  const charH = currentMode === 'braille' ? fontSize * 2 : fontSize;

  // Grid dimensions
  let numCols = Math.ceil(cW / charW);
  let numRows = Math.ceil(cH / charH);

  // For braille, we need 2x columns and 4x rows of pixel data
  let sampleCols = currentMode === 'braille' ? numCols * 2 : numCols;
  let sampleRows = currentMode === 'braille' ? numRows * 4 : numRows;

  offscreen.width = sampleCols;
  offscreen.height = sampleRows;

  // Object-fit: cover calculation
  const canvasRatio = cW / cH;
  const videoRatio = vW / vH;
  let sx = 0, sy = 0, sWidth = vW, sHeight = vH;
  if (canvasRatio > videoRatio) {
    sHeight = vW / canvasRatio;
    sy = (vH - sHeight) / 2;
  } else {
    sWidth = vH * canvasRatio;
    sx = (vW - sWidth) / 2;
  }

  // Mirror the video horizontally so the face acts as a mirror,
  // but since we draw characters on the main canvas without CSS flip,
  // the text characters render in the correct (non-reversed) direction.
  offCtx.save();
  offCtx.translate(sampleCols, 0);
  offCtx.scale(-1, 1);
  offCtx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sampleCols, sampleRows);
  offCtx.restore();
  const imageData = offCtx.getImageData(0, 0, sampleCols, sampleRows);
  const pixels = imageData.data;

  hudRes.textContent = `${numCols}×${numRows}`;

  // ── Background ──
  if (enableTrails) {
    // Semi-transparent overlay for ghosting
    mainCtx.fillStyle = themeConfig.bg + 'aa'; // ~66% opacity creates trails
    mainCtx.fillRect(0, 0, cW, cH);
  } else {
    mainCtx.fillStyle = themeConfig.bg;
    mainCtx.fillRect(0, 0, cW, cH);
  }

  mainCtx.textBaseline = 'top';

  // ── Mode-specific rendering ──
  switch (currentMode) {
    case 'classic':
    case 'custom':
      renderClassic(pixels, numCols, numRows, charW, charH, fontSize, themeConfig);
      break;
    case 'matrix':
      renderMatrix(pixels, numCols, numRows, charW, charH, fontSize, themeConfig);
      break;
    case 'edge':
      renderEdge(pixels, numCols, numRows, charW, charH, fontSize, themeConfig);
      break;
    case 'emoji':
      renderEmoji(pixels, numCols, numRows, charW, charH, fontSize);
      break;
    case 'braille':
      renderBraille(pixels, sampleCols, sampleRows, numCols, numRows, charW, charH, fontSize, themeConfig);
      break;
    case 'thermal':
      renderThermal(pixels, numCols, numRows, charW, charH, fontSize);
      break;
  }

  prevPixels = new Uint8ClampedArray(pixels);
}

// ── Classic / Custom Text Mode ──
function renderClassic(
  pixels: Uint8ClampedArray, cols: number, rows: number,
  charW: number, charH: number, fontSize: number,
  theme: typeof THEMES[ColorTheme]
) {
  mainCtx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  let textIdx = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const off = (y * cols + x) * 4;
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      let brightness = getBrightness(r, g, b);
      if (enableInvert) brightness = 255 - brightness;

      let char: string;
      if (currentMode === 'custom') {
        const customStr = customText || 'X';
        char = customStr[textIdx % customStr.length];
        textIdx++;
        // Skip dark areas
        if (brightness < 20) continue;
      } else {
        char = charFromBrightness(brightness);
        if (char === ' ') continue;
      }

      // Color with theme, but also blend in the original color slightly
      if (currentTheme === 'mono') {
        mainCtx.fillStyle = theme.colorFn(r, g, b, brightness);
      } else {
        // Blend: 60% theme color, 40% original
        mainCtx.fillStyle = theme.colorFn(r, g, b, brightness);
      }
      mainCtx.fillText(char, x * charW, y * charH);
    }
  }
}

// ── Matrix Rain Mode ──
function renderMatrix(
  pixels: Uint8ClampedArray, cols: number, rows: number,
  charW: number, charH: number, fontSize: number,
  theme: typeof THEMES[ColorTheme]
) {
  // Initialize rain drops
  if (!rainInitialized || rainDrops.length !== cols) {
    rainDrops = new Array(cols).fill(0).map(() => Math.floor(Math.random() * rows));
    rainInitialized = true;
  }

  mainCtx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const off = (y * cols + x) * 4;
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      let brightness = getBrightness(r, g, b);
      if (enableInvert) brightness = 255 - brightness;

      // Determine if this cell is near the rain drop head
      const dropY = rainDrops[x];
      const dist = Math.abs(y - dropY);

      let alpha = 1;
      if (dist < 5) {
        alpha = 1;
      } else if (dist < 15) {
        alpha = 0.5;
      } else {
        alpha = 0.2;
      }

      if (brightness < 15) continue;

      // Mix: use video brightness to weight visibility, and rain position for character selection
      const charIdx = (y + dropY + Math.floor(Math.random() * 2)) % chars.length;
      const char = brightness > 30 ? chars[charIdx] : '.';

      const greenVal = Math.floor(Math.min(255, brightness * alpha + 80));
      if (dist < 2) {
        mainCtx.fillStyle = `rgba(180, 255, 180, ${alpha})`;
      } else {
        mainCtx.fillStyle = theme.colorFn(r, g, b, brightness * alpha);
      }

      mainCtx.fillText(char, x * charW, y * charH);
    }

    // Advance rain
    rainDrops[x] += Math.random() > 0.85 ? 2 : 1;
    if (rainDrops[x] > rows + 10) {
      rainDrops[x] = -Math.floor(Math.random() * rows * 0.5);
    }
  }
}

// ── Edge Detection Mode ──
function renderEdge(
  pixels: Uint8ClampedArray, cols: number, rows: number,
  charW: number, charH: number, fontSize: number,
  theme: typeof THEMES[ColorTheme]
) {
  mainCtx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const edgeVal = edgeDetect(pixels, x, y, cols, rows);
      if (edgeVal < 30) continue; // Skip non-edges

      const char = charFromBrightness(255 - edgeVal); // Stronger edges = denser chars
      if (char === ' ') {
        // Use a visible char for strong edges
        const off = (y * cols + x) * 4;
        const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
        mainCtx.fillStyle = theme.colorFn(r, g, b, edgeVal);
        mainCtx.fillText('█', x * charW, y * charH);
      } else {
        const off = (y * cols + x) * 4;
        const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
        mainCtx.fillStyle = theme.colorFn(r, g, b, edgeVal);
        mainCtx.fillText(char, x * charW, y * charH);
      }
    }
  }
}

// ── Emoji Mode ──
function renderEmoji(
  pixels: Uint8ClampedArray, cols: number, rows: number,
  charW: number, charH: number, fontSize: number
) {
  mainCtx.font = `${fontSize}px sans-serif`;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const off = (y * cols + x) * 4;
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      let brightness = getBrightness(r, g, b);
      if (enableInvert) brightness = 255 - brightness;

      if (brightness < 10) continue;

      const idx = Math.floor((brightness / 255) * (EMOJI_SET.length - 1));
      mainCtx.fillText(EMOJI_SET[idx], x * charW, y * charH);
    }
  }
}

// ── Braille Ultra-HD Mode ──
function renderBraille(
  pixels: Uint8ClampedArray,
  sampleCols: number, sampleRows: number,
  dispCols: number, dispRows: number,
  charW: number, charH: number, fontSize: number,
  theme: typeof THEMES[ColorTheme]
) {
  mainCtx.font = `${fontSize}px "JetBrains Mono", monospace`;
  const threshold = enableInvert ? 80 : 80;

  for (let by = 0; by < dispRows; by++) {
    for (let bx = 0; bx < dispCols; bx++) {
      const px = bx * 2;
      const py = by * 4;
      const char = brailleChar(pixels, px, py, sampleCols, sampleRows, threshold);

      if (char === String.fromCharCode(BRAILLE_BASE)) continue; // Empty braille

      // Average color of the 2x4 block
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const cx = px + dx, cy = py + dy;
          if (cx < sampleCols && cy < sampleRows) {
            const off = (cy * sampleCols + cx) * 4;
            rSum += pixels[off]; gSum += pixels[off + 1]; bSum += pixels[off + 2];
            count++;
          }
        }
      }
      const avgR = rSum / count, avgG = gSum / count, avgB = bSum / count;
      const avgBr = getBrightness(avgR, avgG, avgB);

      mainCtx.fillStyle = theme.colorFn(avgR, avgG, avgB, avgBr);
      mainCtx.fillText(char, bx * charW, by * charH);
    }
  }
}

// ── Thermal / Heatmap Mode ──
function renderThermal(
  pixels: Uint8ClampedArray, cols: number, rows: number,
  charW: number, charH: number, fontSize: number
) {
  mainCtx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const off = (y * cols + x) * 4;
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      let brightness = getBrightness(r, g, b);
      if (enableInvert) brightness = 255 - brightness;

      const char = thermalChar(brightness);
      if (char === ' ') continue;

      mainCtx.fillStyle = thermalColor(brightness);
      mainCtx.fillText(char, x * charW, y * charH);
    }
  }
}

// ═══════════════════════════════════════
//  UI LOGIC
// ═══════════════════════════════════════
function setMode(mode: RenderMode) {
  currentMode = mode;
  rainInitialized = false;
  prevPixels = null;
  hudMode.textContent = `MODE: ${mode.toUpperCase()}`;
  customTextGroup.style.display = mode === 'custom' ? 'flex' : 'none';
  // Update button active states
  modeButtons.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  toast(`Mode: ${mode.toUpperCase()}`);
}

function setTheme(theme: ColorTheme) {
  currentTheme = theme;
  hudTheme.textContent = `THEME: ${theme.toUpperCase()}`;
  themeButtons.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  // Update CSS accent color based on theme
  const accentMap: Record<ColorTheme, string> = {
    matrix: '#00ff41',
    cyberpunk: '#ff00ff',
    vaporwave: '#ff6ec7',
    fire: '#ff6a00',
    mono: '#ffffff'
  };
  document.documentElement.style.setProperty('--accent', accentMap[theme]);
  document.documentElement.style.setProperty('--accent-dim', accentMap[theme] + '4d');
  document.documentElement.style.setProperty('--glass-border', accentMap[theme] + '33');
  toast(`Theme: ${theme.toUpperCase()}`);
}

function cycleMode() {
  const idx = MODES.indexOf(currentMode);
  setMode(MODES[(idx + 1) % MODES.length]);
}

function cycleTheme() {
  const idx = THEME_KEYS.indexOf(currentTheme);
  setTheme(THEME_KEYS[(idx + 1) % THEME_KEYS.length]);
}

function togglePanel() {
  controlsPanel.classList.toggle('hidden');
}

// ═══════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
closeControlsBtn.addEventListener('click', togglePanel);
screenshotBtn.addEventListener('click', takeScreenshot);

customTextInput.addEventListener('input', () => {
  customText = customTextInput.value || 'X';
});

trailsToggle.addEventListener('change', () => {
  enableTrails = trailsToggle.checked;
  toast(enableTrails ? '👻 Trails ON' : 'Trails OFF');
});

audioToggle.addEventListener('change', async () => {
  enableAudio = audioToggle.checked;
  if (enableAudio) {
    await startAudio();
  } else {
    stopAudio();
    toast('🎤 Audio OFF');
  }
});

invertToggle.addEventListener('change', () => {
  enableInvert = invertToggle.checked;
  toast(enableInvert ? '🔄 Inverted' : 'Normal');
});

// Mode buttons
modeButtons.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn?.dataset.mode) setMode(btn.dataset.mode as RenderMode);
});

// Theme buttons
themeButtons.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn?.dataset.theme) setTheme(btn.dataset.theme as ColorTheme);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Don't capture while typing in an input
  if (e.target instanceof HTMLInputElement) return;

  switch (e.key.toLowerCase()) {
    case 'm': cycleMode(); break;
    case 't': cycleTheme(); break;
    case 'h': togglePanel(); break;
    case 'g':
      trailsToggle.checked = !trailsToggle.checked;
      trailsToggle.dispatchEvent(new Event('change'));
      break;
    case 'a':
      audioToggle.checked = !audioToggle.checked;
      audioToggle.dispatchEvent(new Event('change'));
      break;
    case 'i':
      invertToggle.checked = !invertToggle.checked;
      invertToggle.dispatchEvent(new Event('change'));
      break;
    case 's':
      if (!e.ctrlKey && !e.metaKey) takeScreenshot();
      break;
    case 'f':
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
      break;
    case 'arrowup':
      resolutionSlider.value = String(Math.min(100, parseInt(resolutionSlider.value) + 5));
      break;
    case 'arrowdown':
      resolutionSlider.value = String(Math.max(1, parseInt(resolutionSlider.value) - 5));
      break;
  }
});
