import { recolorMaskedPixels, detectMaskedColor, type MaskVerificationReport, type DetectedMaskColor } from './maskIntegrity';
import { BoundingBox, PixelVerificationReport, SamMask, StoryboardShot } from '../types/framelock';

export interface SceneRenderSpec {
  shotNumber: number;
  cameraAngle: 'wide' | 'medium' | 'closeup' | 'over_shoulder';
  settingTitle: string;
  targetObject: string; // e.g., "cup", "jacket", "umbrella", "lantern"
  objectColorName: string; // e.g., "blue", "red", "amber", "emerald", "crimson", "cobalt"
  weatherOrMood: 'rain_noir' | 'neon_dusk' | 'studio_warm' | 'fog_pier';
  characterPose: 'seated_detective' | 'reaching_hand' | 'window_gaze' | 'walking_away';
  seed: number;
}

const COLOR_HEX_MAP: Record<string, { primary: string; highlight: string; shadow: string; rgb: [number, number, number] }> = {
  blue: { primary: '#2563EB', highlight: '#60A5FA', shadow: '#1E3A8A', rgb: [37, 99, 235] },
  cobalt: { primary: '#1D4ED8', highlight: '#38BDF8', shadow: '#172554', rgb: [29, 78, 216] },
  cyan: { primary: '#0891B2', highlight: '#67E8F9', shadow: '#164E63', rgb: [8, 145, 178] },
  red: { primary: '#DC2626', highlight: '#F87171', shadow: '#7F1D1D', rgb: [220, 38, 38] },
  crimson: { primary: '#E11D48', highlight: '#FDA4AF', shadow: '#881337', rgb: [225, 29, 72] },
  amber: { primary: '#D97706', highlight: '#FBBF24', shadow: '#78350F', rgb: [217, 119, 6] },
  yellow: { primary: '#EAB308', highlight: '#FDE047', shadow: '#713F12', rgb: [234, 179, 8] },
  gold: { primary: '#CA8A04', highlight: '#FEF08A', shadow: '#713F12', rgb: [202, 138, 4] },
  green: { primary: '#059669', highlight: '#34D399', shadow: '#064E3B', rgb: [5, 150, 105] },
  emerald: { primary: '#10B981', highlight: '#6EE7B7', shadow: '#065F46', rgb: [16, 185, 129] },
  white: { primary: '#E2E8F0', highlight: '#FFFFFF', shadow: '#64748B', rgb: [226, 232, 240] },
  purple: { primary: '#7C3AED', highlight: '#C4B5FD', shadow: '#4C1D95', rgb: [124, 58, 237] },
};

export function resolveColorPalette(colorName: string) {
  const normalized = colorName.toLowerCase().trim();
  for (const [key, val] of Object.entries(COLOR_HEX_MAP)) {
    if (normalized.includes(key)) return val;
  }
  return COLOR_HEX_MAP.blue;
}

/**
 * Computes deterministic bounding box (in normalized 0..100 percentages of 800x450 canvas)
 * for the primary continuity object based on camera framing.
 */
export function getTargetObjectBox(cameraAngle: SceneRenderSpec['cameraAngle'], targetObject: string): BoundingBox {
  const obj = targetObject.toLowerCase();
  if (obj.includes('car') || obj.includes('vehicle') || obj.includes('automobile')) {
    if (cameraAngle === 'closeup') return { x: 18, y: 38, width: 64, height: 44 };
    if (cameraAngle === 'medium') return { x: 25, y: 45, width: 50, height: 38 };
    return { x: 30, y: 52, width: 40, height: 32 };
  }
  if (obj.includes('altar') || obj.includes('church')) {
    if (cameraAngle === 'closeup') return { x: 25, y: 22, width: 50, height: 68 };
    if (cameraAngle === 'medium') return { x: 30, y: 28, width: 40, height: 58 };
    return { x: 35, y: 34, width: 30, height: 48 };
  }
  if (obj.includes('umbrella') || obj.includes('coat') || obj.includes('jacket') || obj.includes('dress') || obj.includes('gown')) {
    if (cameraAngle === 'closeup') return { x: 28, y: 42, width: 44, height: 48 };
    if (cameraAngle === 'medium') return { x: 32, y: 36, width: 34, height: 50 };
    return { x: 42, y: 38, width: 22, height: 44 };
  }
  // Default prop (cup, mug, lantern, notebook, briefcase)
  switch (cameraAngle) {
    case 'closeup':
      return { x: 38, y: 38, width: 24, height: 38 };
    case 'over_shoulder':
      return { x: 54, y: 52, width: 16, height: 26 };
    case 'medium':
      return { x: 58, y: 55, width: 14, height: 24 };
    case 'wide':
    default:
      return { x: 46, y: 60, width: 11, height: 20 };
  }
}

/**
 * Renders a high-contrast cinematic storyboard frame onto an 800x450 HTML5 Canvas
 * representing the output of `muse-image-1.0`.
 */
export function renderMuseStoryboardFrame(spec: SceneRenderSpec): {
  imageUrl: string;
  box: BoundingBox;
} {
  const width = 800;
  const height = 450;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 1. Background Atmosphere
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  if (spec.weatherOrMood === 'rain_noir') {
    bgGrad.addColorStop(0, '#090D16');
    bgGrad.addColorStop(0.65, '#131C2E');
    bgGrad.addColorStop(1, '#0F141C');
  } else if (spec.weatherOrMood === 'neon_dusk') {
    bgGrad.addColorStop(0, '#0F1026');
    bgGrad.addColorStop(0.6, '#1E1B3A');
    bgGrad.addColorStop(1, '#12131F');
  } else {
    bgGrad.addColorStop(0, '#141820');
    bgGrad.addColorStop(0.65, '#222936');
    bgGrad.addColorStop(1, '#12151C');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Architectural Diner / Studio Window Grid & Rain Streaks
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 2;
  // Window panes
  ctx.strokeRect(48, 36, width - 96, height * 0.56);
  ctx.beginPath();
  ctx.moveTo(width * 0.35, 36);
  ctx.lineTo(width * 0.35, 36 + height * 0.56);
  ctx.moveTo(width * 0.68, 36);
  ctx.lineTo(width * 0.68, 36 + height * 0.56);
  ctx.stroke();

  // Exterior city bokeh glow
  const bokehColors = ['rgba(56, 189, 248, 0.16)', 'rgba(245, 158, 11, 0.14)', 'rgba(99, 102, 241, 0.14)'];
  for (let i = 0; i < 9; i++) {
    const bx = 90 + ((i * 83 + spec.seed * 29) % 620);
    const by = 70 + ((i * 47 + spec.seed * 13) % 160);
    const br = 18 + (i % 3) * 12;
    const rad = ctx.createRadialGradient(bx, by, 2, bx, by, br);
    rad.addColorStop(0, bokehColors[i % bokehColors.length]);
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  // Diagonal rain streaks outside window
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.18)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 42; i++) {
    const rx = 60 + ((i * 37 + spec.shotNumber * 53) % (width - 120));
    const ry = 44 + ((i * 29 + spec.seed * 19) % 210);
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx - 10, ry + 26);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Foreground Counter / Table Surface (Perspective Plane)
  const tableTopY = spec.cameraAngle === 'closeup' ? height * 0.58 : height * 0.64;
  const tableGrad = ctx.createLinearGradient(0, tableTopY, 0, height);
  tableGrad.addColorStop(0, '#1E2530');
  tableGrad.addColorStop(0.15, '#262F3D');
  tableGrad.addColorStop(1, '#12161F');
  ctx.fillStyle = tableGrad;
  ctx.fillRect(0, tableTopY, width, height - tableTopY);

  // Crisp counter rim line
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, tableTopY);
  ctx.lineTo(width, tableTopY);
  ctx.stroke();

  // 4. Character Silhouette / Framing Composition
  ctx.save();
  if (spec.cameraAngle === 'wide' || spec.cameraAngle === 'medium') {
    const charX = spec.cameraAngle === 'wide' ? width * 0.28 : width * 0.26;
    const charY = tableTopY;
    // Detective shoulders & fedora/collar silhouette
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 2.5;

    // Torso/shoulders
    ctx.beginPath();
    ctx.moveTo(charX - 110, charY);
    ctx.quadraticCurveTo(charX - 95, charY - 125, charX, charY - 130);
    ctx.quadraticCurveTo(charX + 95, charY - 125, charX + 115, charY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Head & Collar
    ctx.beginPath();
    ctx.arc(charX, charY - 178, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Rim light on character shoulder
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(charX + 35, charY - 126);
    ctx.quadraticCurveTo(charX + 92, charY - 115, charX + 112, charY - 8);
    ctx.stroke();
  } else if (spec.cameraAngle === 'over_shoulder') {
    // Out-of-focus dark foreground shoulder on left
    ctx.fillStyle = '#0B0F17';
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height * 0.22);
    ctx.quadraticCurveTo(width * 0.28, height * 0.28, width * 0.34, height);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (spec.cameraAngle === 'closeup') {
    // Dramatic hand silhouette reaching near the object
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(width * 0.1, tableTopY + 18, width * 0.22, 46, 22);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // 5. Render Target Continuity Object inside its exact BoundingBox
  const box = getTargetObjectBox(spec.cameraAngle, spec.targetObject);
  const pxBox = {
    x: (box.x / 100) * width,
    y: (box.y / 100) * height,
    w: (box.width / 100) * width,
    h: (box.height / 100) * height,
  };

  drawTargetObjectInBox(ctx, pxBox, spec.targetObject, spec.objectColorName);

  // 6. Cinematic Storyboard Frame HUD Stamp (Top-Left Slate & Camera Framing Guides)
  ctx.save();
  // Rule-of-thirds subtle crosshair ticks
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 3, 20);
  ctx.lineTo(width / 3, height - 20);
  ctx.moveTo((width * 2) / 3, 20);
  ctx.lineTo((width * 2) / 3, height - 20);
  ctx.stroke();

  // Slate header strip burned into top-left for low-vision clarity
  ctx.fillStyle = 'rgba(11, 14, 20, 0.86)';
  ctx.fillRect(16, 16, 250, 34);
  ctx.strokeStyle = '#323A46';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 16, 250, 34);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 13px "JetBrains Mono", monospace';
  ctx.fillText(
    `SHOT 0${spec.shotNumber} · ${spec.cameraAngle.toUpperCase().replace('_', ' ')}`,
    28,
    38
  );
  ctx.restore();

  return {
    imageUrl: canvas.toDataURL('image/png'),
    box,
  };
}

function drawTargetObjectInBox(
  ctx: CanvasRenderingContext2D,
  pxBox: { x: number; y: number; w: number; h: number },
  targetObject: string,
  colorName: string
) {
  const palette = resolveColorPalette(colorName);
  const obj = targetObject.toLowerCase();

  ctx.save();

  // Contact shadow on surface
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.ellipse(
    pxBox.x + pxBox.w * 0.5,
    pxBox.y + pxBox.h * 0.94,
    pxBox.w * 0.46,
    pxBox.h * 0.08,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  if (obj.includes('umbrella')) {
    // Draw Sleek Folded or Open Umbrella Prop
    const cx = pxBox.x + pxBox.w * 0.5;
    const topY = pxBox.y + pxBox.h * 0.1;
    const botY = pxBox.y + pxBox.h * 0.9;

    const grad = ctx.createLinearGradient(pxBox.x, topY, pxBox.x + pxBox.w, botY);
    grad.addColorStop(0, palette.highlight);
    grad.addColorStop(0.5, palette.primary);
    grad.addColorStop(1, palette.shadow);

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.quadraticCurveTo(pxBox.x + pxBox.w * 0.95, topY + pxBox.h * 0.35, pxBox.x + pxBox.w * 0.85, botY - 12);
    ctx.lineTo(pxBox.x + pxBox.w * 0.15, botY - 12);
    ctx.quadraticCurveTo(pxBox.x + pxBox.w * 0.05, topY + pxBox.h * 0.35, cx, topY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (obj.includes('jacket') || obj.includes('coat')) {
    // Draw Trench Coat / Jacket lapel prop
    const grad = ctx.createLinearGradient(pxBox.x, pxBox.y, pxBox.x + pxBox.w, pxBox.y + pxBox.h);
    grad.addColorStop(0, palette.highlight);
    grad.addColorStop(0.5, palette.primary);
    grad.addColorStop(1, palette.shadow);

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(pxBox.x + pxBox.w * 0.12, pxBox.y + pxBox.h * 0.08, pxBox.w * 0.76, pxBox.h * 0.84, 12);
    ctx.fill();
    ctx.stroke();
  } else if (obj.includes('car') || obj.includes('vehicle') || obj.includes('automobile')) {
    // Draw classic wedding car
    const carX = pxBox.x + pxBox.w * 0.05;
    const carY = pxBox.y + pxBox.h * 0.2;
    const carW = pxBox.w * 0.9;
    const carH = pxBox.h * 0.65;

    // Car Wheels & Chrome Hubcaps
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 2;
    const wheelRadius = carH * 0.24;
    // Left wheel
    ctx.beginPath();
    ctx.arc(carX + carW * 0.22, carY + carH * 0.82, wheelRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Right wheel
    ctx.beginPath();
    ctx.arc(carX + carW * 0.78, carY + carH * 0.82, wheelRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Wheel Hubs
    ctx.fillStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.arc(carX + carW * 0.22, carY + carH * 0.82, wheelRadius * 0.45, 0, Math.PI * 2);
    ctx.arc(carX + carW * 0.78, carY + carH * 0.82, wheelRadius * 0.45, 0, Math.PI * 2);
    ctx.fill();

    // Car Body with high-contrast gradient
    const carGrad = ctx.createLinearGradient(carX, carY, carX, carY + carH);
    carGrad.addColorStop(0, palette.highlight);
    carGrad.addColorStop(0.4, palette.primary);
    carGrad.addColorStop(1, palette.shadow);

    ctx.fillStyle = carGrad;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;

    // Sleek vintage car silhouette (hood, cabin, trunk)
    ctx.beginPath();
    ctx.moveTo(carX, carY + carH * 0.65);
    ctx.lineTo(carX + carW * 0.2, carY + carH * 0.65);
    ctx.lineTo(carX + carW * 0.32, carY + carH * 0.22);
    ctx.lineTo(carX + carW * 0.7, carY + carH * 0.22);
    ctx.lineTo(carX + carW * 0.82, carY + carH * 0.65);
    ctx.lineTo(carX + carW, carY + carH * 0.65);
    ctx.lineTo(carX + carW, carY + carH * 0.82);
    ctx.lineTo(carX, carY + carH * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Windshield & Windows
    ctx.fillStyle = 'rgba(186, 230, 253, 0.75)';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(carX + carW * 0.35, carY + carH * 0.28);
    ctx.lineTo(carX + carW * 0.48, carY + carH * 0.28);
    ctx.lineTo(carX + carW * 0.48, carY + carH * 0.58);
    ctx.lineTo(carX + carW * 0.26, carY + carH * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(carX + carW * 0.52, carY + carH * 0.28);
    ctx.lineTo(carX + carW * 0.66, carY + carH * 0.28);
    ctx.lineTo(carX + carW * 0.75, carY + carH * 0.58);
    ctx.lineTo(carX + carW * 0.52, carY + carH * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Headlights (glow)
    ctx.fillStyle = '#FEF08A';
    ctx.beginPath();
    ctx.arc(carX + carW * 0.98, carY + carH * 0.7, carH * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else if (obj.includes('altar') || obj.includes('church')) {
    // Draw Wedding Altar Arch with Flowers & Fabric Drape
    const cx = pxBox.x + pxBox.w * 0.5;
    const topY = pxBox.y + pxBox.h * 0.08;
    const botY = pxBox.y + pxBox.h * 0.92;

    // Altar Arch Pillars
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pxBox.x + pxBox.w * 0.2, botY);
    ctx.lineTo(pxBox.x + pxBox.w * 0.2, topY + pxBox.h * 0.3);
    ctx.quadraticCurveTo(cx, topY, pxBox.x + pxBox.w * 0.8, topY + pxBox.h * 0.3);
    ctx.lineTo(pxBox.x + pxBox.w * 0.8, botY);
    ctx.stroke();

    // Arch Floral Canopy
    ctx.fillStyle = palette.highlight;
    ctx.beginPath();
    ctx.arc(cx, topY + 8, pxBox.w * 0.25, 0, Math.PI);
    ctx.fill();

    // Altar Pedestal
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(cx - pxBox.w * 0.18, botY - pxBox.h * 0.35, pxBox.w * 0.36, pxBox.h * 0.35);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - pxBox.w * 0.18, botY - pxBox.h * 0.35, pxBox.w * 0.36, pxBox.h * 0.35);
  } else {
    // Default iconic prop: Heavy Ceramic Diner Coffee Cup + Saucer + Steam
    const cupX = pxBox.x + pxBox.w * 0.12;
    const cupY = pxBox.y + pxBox.h * 0.18;
    const cupW = pxBox.w * 0.64;
    const cupH = pxBox.h * 0.68;

    // Saucer plate underneath
    ctx.fillStyle = palette.shadow;
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      cupX + cupW * 0.5,
      cupY + cupH * 0.98,
      cupW * 0.68,
      cupH * 0.13,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();

    // Cup Handle (right side)
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = Math.max(5, cupW * 0.11);
    ctx.beginPath();
    ctx.arc(
      cupX + cupW * 0.95,
      cupY + cupH * 0.48,
      cupH * 0.24,
      -Math.PI * 0.45,
      Math.PI * 0.45
    );
    ctx.stroke();

    // Cup Body Cylinder with high-contrast shading
    const cupGrad = ctx.createLinearGradient(cupX, cupY, cupX + cupW, cupY);
    cupGrad.addColorStop(0, palette.highlight);
    cupGrad.addColorStop(0.35, palette.primary);
    cupGrad.addColorStop(0.85, palette.shadow);
    cupGrad.addColorStop(1, palette.primary);

    ctx.fillStyle = cupGrad;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(cupX, cupY);
    ctx.lineTo(cupX + cupW * 0.08, cupY + cupH * 0.88);
    ctx.quadraticCurveTo(cupX + cupW * 0.5, cupY + cupH * 1.02, cupX + cupW * 0.92, cupY + cupH * 0.88);
    ctx.lineTo(cupX + cupW, cupY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Top Rim & Dark Coffee Interior
    ctx.fillStyle = '#1E130C';
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cupX + cupW * 0.5, cupY, cupW * 0.5, cupH * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Specular highlight strip on ceramic body
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.beginPath();
    ctx.roundRect(cupX + cupW * 0.16, cupY + cupH * 0.18, cupW * 0.1, cupH * 0.54, 4);
    ctx.fill();

    // Rising Steam wisps above cup
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 2;
    for (let s = 0; s < 2; s++) {
      const sx = cupX + cupW * (0.35 + s * 0.3);
      ctx.beginPath();
      ctx.moveTo(sx, cupY - 6);
      ctx.quadraticCurveTo(sx - 6, cupY - 18, sx + 4, cupY - 30);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Generates an offline fixture alpha mask. This is not a live SAM inference result.
 */
export function generateSam3MaskData(
  objectId: string,
  box: BoundingBox,
  confidence: number = 0.984,
  revision: number = 1
): SamMask {
  const width = 800;
  const height = 450;
  let maskBase64 = '';

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const pxBox = {
      x: (box.x / 100) * width,
      y: (box.y / 100) * height,
      w: (box.width / 100) * width,
      h: (box.height / 100) * height,
    };

    // Draw crisp high-contrast cyan/sky segmentation silhouette inside the bounding box
    ctx.fillStyle = 'rgba(56, 189, 248, 0.42)';
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 3;

    const cupX = pxBox.x + pxBox.w * 0.08;
    const cupY = pxBox.y + pxBox.h * 0.14;
    const cupW = pxBox.w * 0.84;
    const cupH = pxBox.h * 0.78;

    ctx.beginPath();
    ctx.roundRect(cupX, cupY, cupW, cupH, 10);
    ctx.fill();
    ctx.stroke();

    maskBase64 = canvas.toDataURL('image/png');
  }

  const maskRef = `sam-3.1:${objectId}:v${revision}`;

  return {
    id: `sam-mask-${objectId}-${Date.now()}`,
    maskRef,
    objectId,
    maskBase64,
    box,
    confidence,
  };
}

/**
 * Pure pixel-level verification proving 0 outside-mask pixel drift (Role 3 Deliverable).
 * Compares full-frame RGBA buffers before and after a masked continuity repair.
 */
export function verifyMaskedPixelDiff(
  beforeData: Uint8ClampedArray,
  afterData: Uint8ClampedArray,
  width: number,
  height: number,
  box: BoundingBox,
  maskRef: string,
  ruleRevision: number = 1
): PixelVerificationReport {
  const pxBox = {
    left: Math.floor((box.x / 100) * width),
    top: Math.floor((box.y / 100) * height),
    right: Math.floor((box.x / 100) * width) + Math.floor((box.width / 100) * width),
    bottom: Math.floor((box.y / 100) * height) + Math.floor((box.height / 100) * height),
  };

  const totalPixels = width * height;
  let selectedMaskPixels = 0;
  let changedInsideMask = 0;
  let changedOutsideMask = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const inside =
        x >= pxBox.left && x < pxBox.right && y >= pxBox.top && y < pxBox.bottom;

      if (inside) {
        selectedMaskPixels++;
      }

      const changed =
        beforeData[idx] !== afterData[idx] ||
        beforeData[idx + 1] !== afterData[idx + 1] ||
        beforeData[idx + 2] !== afterData[idx + 2] ||
        beforeData[idx + 3] !== afterData[idx + 3];

      if (changed) {
        if (inside) {
          changedInsideMask++;
        } else {
          changedOutsideMask++;
        }
      }
    }
  }

  const outsidePixels = Math.max(1, totalPixels - selectedMaskPixels);
  const outsideDriftPercent = Number(((changedOutsideMask / outsidePixels) * 100).toFixed(4));

  return {
    selectedPixels: selectedMaskPixels,
    changedInside: changedInsideMask,
    changedOutside: changedOutsideMask,
    passed: selectedMaskPixels > 0 && changedOutsideMask === 0,
    maskRef,
    ruleRevision,
    totalPixels,
    selectedMaskPixels,
    changedInsideMask,
    changedOutsideMask,
    outsideDriftPercent,
    verifiedAt: Date.now(),
  };
}

async function decodeFrame(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error('Could not decode the frame or mask. No correction was applied.');
  }
  return image;
}

export async function applySamPixelFixWithVerification(
  sourceImageUrl: string,
  mask: SamMask,
  targetColorName: string,
  ruleRevision: number = 1
): Promise<{
  imageUrl: string;
  verification: PixelVerificationReport;
  pixelVerification: PixelVerificationReport;
}> {
  const [image, maskImage] = await Promise.all([
    decodeFrame(sourceImageUrl),
    decodeFrame(mask.maskBase64),
  ]);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (
    !width ||
    !height ||
    width * height > 24000000 ||
    maskImage.naturalWidth !== width ||
    maskImage.naturalHeight !== height
  ) {
    throw new Error('Frame and mask dimensions must match. No correction was applied.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas pixel access is unavailable.');
  context.drawImage(image, 0, 0);
  const source = context.getImageData(0, 0, width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(maskImage, 0, 0);
  const maskRgba = context.getImageData(0, 0, width, height).data;
  // The current mask format uses a transparent background and nonzero alpha for selection.
  const binaryMask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < binaryMask.length; pixel++) {
    binaryMask[pixel] = maskRgba[pixel * 4 + 3] > 0 ? 1 : 0;
  }
  const { pixels, verification } = recolorMaskedPixels(
    source.data,
    binaryMask,
    resolveColorPalette(targetColorName).rgb
  );
  source.data.set(pixels);
  context.putImageData(source, 0, 0);

  const totalPixels = width * height;
  const outsidePixels = Math.max(1, totalPixels - verification.selectedPixels);
  const outsideDriftPercent = Number(
    ((verification.changedOutside / outsidePixels) * 100).toFixed(4)
  );
  const pixelVerification: PixelVerificationReport = {
    ...verification,
    maskRef: mask.maskRef || mask.id,
    ruleRevision,
    totalPixels,
    selectedMaskPixels: verification.selectedPixels,
    changedInsideMask: verification.changedInside,
    changedOutsideMask: verification.changedOutside,
    outsideDriftPercent,
    verifiedAt: Date.now(),
  };

  return {
    imageUrl: canvas.toDataURL('image/png'),
    verification: pixelVerification,
    pixelVerification,
  };
}

export async function applySamPixelFixToImage(
  sourceImageUrl: string,
  box: BoundingBox,
  targetObject: string,
  targetColorName: string
): Promise<string> {
  const mask = generateSam3MaskData(targetObject, box);
  return (await applySamPixelFixWithVerification(sourceImageUrl, mask, targetColorName)).imageUrl;
}

/**
 * Loads an image frame and evaluates the dominant pigment inside the provided SAM mask.
 * Used for dynamic color continuity verification across model-generated frames.
 */
export async function sampleImageColorInMask(
  imageUrl: string,
  mask: SamMask
): Promise<DetectedMaskColor> {
  const image = await decodeFrame(imageUrl);
  const width = image.naturalWidth || 800;
  const height = image.naturalHeight || 450;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas pixel access is unavailable.');
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height);

  let binaryMask: Uint8Array;
  if (mask.maskBase64 && mask.maskBase64.startsWith('data:image')) {
    const maskImage = await decodeFrame(mask.maskBase64);
    context.clearRect(0, 0, width, height);
    context.drawImage(maskImage, 0, 0, width, height);
    const maskRgba = context.getImageData(0, 0, width, height).data;
    binaryMask = new Uint8Array(width * height);
    for (let pixel = 0; pixel < binaryMask.length; pixel++) {
      binaryMask[pixel] = maskRgba[pixel * 4 + 3] > 0 ? 1 : 0;
    }
  } else {
    binaryMask = new Uint8Array(width * height);
    const box = mask.box;
    const xStart = Math.max(0, Math.floor((box.x / 100) * width));
    const yStart = Math.max(0, Math.floor((box.y / 100) * height));
    const xEnd = Math.min(width, Math.ceil(((box.x + box.width) / 100) * width));
    const yEnd = Math.min(height, Math.ceil(((box.y + box.height) / 100) * height));
    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        binaryMask[y * width + x] = 1;
      }
    }
  }

  return detectMaskedColor(source.data, binaryMask);
}

export async function exportStoryboardAnimaticVideo(
  shots: StoryboardShot[],
  projectTitle: string
): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    return null;
  }

  const width = 800;
  const height = 450;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.captureStream !== 'function') {
    return null;
  }

  const loadedImages: HTMLImageElement[] = await Promise.all(
    shots.map(
      (shot) =>
        new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(img);
          img.src = shot.currentImageUrl;
        })
    )
  );

  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  return new Promise((resolve) => {
    // 45s watchdog timer to prevent indefinite hangs if MediaRecorder stalls
    const watchdogTimer = setTimeout(() => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {}
      const blob = chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;
      resolve(blob);
    }, 45000);

    recorder.onerror = () => {
      clearTimeout(watchdogTimer);
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {}
      resolve(null);
    };

    recorder.onstop = () => {
      clearTimeout(watchdogTimer);
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };

    recorder.start();

    let shotIdx = 0;
    const renderNextShot = () => {
      if (shotIdx >= shots.length) {
        recorder.stop();
        return;
      }

      const shot = shots[shotIdx];
      const img = loadedImages[shotIdx];

      ctx.fillStyle = '#121417';
      ctx.fillRect(0, 0, width, height);
      if (img && img.width > 0) {
        ctx.drawImage(img, 0, 0, width, height);
      }

      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.fillRect(0, height - 68, width, 68);
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, height - 68);
      ctx.lineTo(width, height - 68);
      ctx.stroke();

      ctx.fillStyle = '#38BDF8';
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.fillText(
        `ANCHORSHOT · ${projectTitle.toUpperCase()} · SHOT 0${shot.shotNumber} (${shot.status.toUpperCase()})`,
        20,
        height - 42
      );

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '500 13px "Inter", sans-serif';
      const caption =
        shot.promptDescription.length > 86
          ? `${shot.promptDescription.slice(0, 86)}...`
          : shot.promptDescription;
      ctx.fillText(caption, 20, height - 18);

      const shotDurationMs = Math.max(500, Math.round((shot.durationSeconds || 3.5) * 1000));
      shotIdx++;
      setTimeout(renderNextShot, shotDurationMs);
    };

    renderNextShot();
  });
}
