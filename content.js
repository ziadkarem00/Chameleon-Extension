/**
 * Chameleon DOM — Content Script (`content.js`)
 * Renders realistic top-down (bird's-eye view) geckos crawling across active webpages
 * using 2-bone analytical inverse kinematics, 18-segment articulated spine,
 * live webpage CSS color camouflage, and DOM-element ledge awareness.
 */
(() => {
  if (window.__CHAMELEON_DOM_INITIALIZED__) return;
  window.__CHAMELEON_DOM_INITIALIZED__ = true;

  const HOST_ID = 'chameleon-dom-shadow-host';

  const DEFAULT_SETTINGS = {
    enabled: true,
    pausedDomains: {},
    skinMode: 'auto', // 'auto' | 'emerald' | 'leopard' | 'tokay'
    geckoCount: 2,
    size: 1.0,        // 0.6 to 1.6
    speed: 1.0,       // 0.5 to 2.0
    ledgeClimbing: true,
    cursorReaction: 'curious' // 'curious' | 'shy' | 'ignore'
  };

  let settings = { ...DEFAULT_SETTINGS };
  const currentHostname = (window.location && window.location.hostname) || 'local';

  // Skin Palettes
  const SKIN_PRESETS = {
    emerald: {
      primary: [44, 198, 72],
      secondary: [28, 142, 52],
      spots: [242, 76, 42],
      belly: [148, 238, 142],
      toePads: [130, 225, 138],
      stripe: [120, 245, 118]
    },
    leopard: {
      primary: [240, 184, 72],
      secondary: [204, 144, 46],
      spots: [44, 28, 20],
      belly: [248, 226, 172],
      toePads: [222, 186, 138],
      stripe: [252, 214, 116]
    },
    tokay: {
      primary: [94, 138, 172],
      secondary: [68, 104, 136],
      spots: [255, 88, 42],
      belly: [156, 192, 216],
      toePads: [144, 182, 206],
      stripe: [132, 178, 210]
    }
  };

  // Base 18-segment spine half-widths (dorsal silhouette from snout [0] to whip tail tip [17])
  const BASE_RADII = [
    3.6,  // 0: Snout tip
    8.2,  // 1: Head mid (cheek/eye bulge)
    9.1,  // 2: Head rear (temporal)
    5.4,  // 3: Neck constriction
    8.6,  // 4: Shoulder girdle (front legs attach here)
    10.4, // 5: Anterior ribcage
    11.2, // 6: Mid ribcage / belly
    9.8,  // 7: Posterior torso
    7.8,  // 8: Pelvic girdle (rear legs attach here)
    6.4,  // 9: Tail base
    5.2,  // 10: Tail proximal
    4.2,  // 11: Tail mid-1
    3.3,  // 12: Tail mid-2
    2.5,  // 13: Tail mid-3
    1.8,  // 14: Tail distal-1
    1.3,  // 15: Tail distal-2
    0.85, // 16: Tail distal-3
    0.45  // 17: Whip tail tip
  ];

  const BASE_SEG_DIST = [
    0,   // 0
    6.5, // 0->1
    7.0, // 1->2
    6.5, // 2->3
    7.0, // 3->4
    8.5, // 4->5
    9.0, // 5->6
    8.5, // 6->7
    8.0, // 7->8
    7.8, // 8->9
    7.8, // 9->10
    7.6, // 10->11
    7.4, // 11->12
    7.2, // 12->13
    7.0, // 13->14
    6.6, // 14->15
    6.2, // 15->16
    5.8  // 16->17
  ];

  // Utility helpers
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function lerpAngle(a, b, t) {
    return a + normalizeAngle(b - a) * t;
  }

  function rgbToCss(rgb, alpha = 1) {
    const r = Math.round(clamp(rgb[0], 0, 255));
    const g = Math.round(clamp(rgb[1], 0, 255));
    const b = Math.round(clamp(rgb[2], 0, 255));
    return alpha >= 0.999 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  function parseCssColor(str) {
    if (!str || str === 'transparent') return null;
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.06) return null;
    return [r, g, b];
  }

  /**
   * 2-Bone Analytical Inverse Kinematics Solver (shoulder/hip -> elbow/knee -> foot)
   * Returns { jointX, jointY, footX, footY }
   */
  function solveTwoBoneIK(rootX, rootY, targetX, targetY, L1, L2, bendDir) {
    const dx = targetX - rootX;
    const dy = targetY - rootY;
    const rawDist = Math.hypot(dx, dy) || 0.0001;
    const maxReach = L1 + L2 - 0.05;
    const minReach = Math.abs(L1 - L2) + 0.05;
    const d = clamp(rawDist, minReach, maxReach);

    const baseAngle = Math.atan2(dy, dx);
    const cosElbow = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const jointAngle = baseAngle + bendDir * Math.acos(cosElbow);

    const jointX = rootX + Math.cos(jointAngle) * L1;
    const jointY = rootY + Math.sin(jointAngle) * L1;

    const footX = rawDist > maxReach
      ? rootX + (dx / rawDist) * maxReach
      : targetX;
    const footY = rawDist > maxReach
      ? rootY + (dy / rawDist) * maxReach
      : targetY;

    return { jointX, jointY, footX, footY };
  }

  // DOM & Canvas State
  let hostEl = null;
  let shadowRoot = null;
  let canvas = null;
  let ctx = null;
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Cursor state
  const cursor = {
    x: vw * 0.5,
    y: vh * 0.5,
    vx: 0,
    vy: 0,
    speed: 0,
    active: false,
    lastMoveTime: 0
  };

  // Throttled DOM Ledges list
  let domLedges = [];
  let lastLedgeScan = 0;

  function scanDomLedges() {
    if (!settings.ledgeClimbing) {
      domLedges = [];
      return;
    }
    const candidates = document.querySelectorAll('img, button, article, [role="button"], h1, h2');
    const results = [];
    const maxCheck = Math.min(candidates.length, 90);

    for (let i = 0; i < maxCheck; i++) {
      const el = candidates[i];
      if (!el || el.id === HOST_ID) continue;
      const rect = el.getBoundingClientRect();
      if (
        rect.width < 52 ||
        rect.height < 24 ||
        rect.bottom < 16 ||
        rect.top > vh - 16 ||
        rect.right < 16 ||
        rect.left > vw - 16
      ) {
        continue;
      }
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.15) {
        continue;
      }
      results.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        cx: rect.left + rect.width * 0.5,
        cy: rect.top + rect.height * 0.5,
        isImage: el.tagName === 'IMG'
      });
      if (results.length >= 28) break;
    }
    domLedges = results;
  }

  /**
   * Samples live webpage background color directly beneath (x, y) while ignoring our Shadow DOM host.
   */
  function sampleWebpageColor(x, y) {
    const sx = clamp(Math.round(x), 2, vw - 3);
    const sy = clamp(Math.round(y), 2, vh - 3);
    let elements = [];
    try {
      elements = document.elementsFromPoint(sx, sy);
    } catch (_) {
      return [244, 246, 248];
    }

    for (let i = 0; i < elements.length; i++) {
      let node = elements[i];
      if (!node || node.id === HOST_ID || (hostEl && hostEl.contains(node))) continue;
      while (node && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const rgb = parseCssColor(style.backgroundColor);
        if (rgb) return rgb;
        node = node.parentElement;
      }
    }

    // Fallback to body or documentElement background
    for (const root of [document.body, document.documentElement]) {
      if (!root) continue;
      const rgb = parseCssColor(window.getComputedStyle(root).backgroundColor);
      if (rgb) return rgb;
    }
    return [245, 247, 250];
  }

  /**
   * Gecko Entity Class
   */
  class Gecko {
    constructor(index) {
      this.index = index;
      const margin = 90;
      this.x = margin + Math.random() * Math.max(120, vw - margin * 2);
      this.y = margin + Math.random() * Math.max(120, vh - margin * 2);
      this.heading = Math.random() * Math.PI * 2 - Math.PI;
      this.currentSpeed = 0;
      this.gaitPhase = Math.random() * Math.PI * 2;
      this.breathPhase = Math.random() * Math.PI * 2;

      // Waypoint & behavior state
      this.state = 'wander'; // 'wander' | 'pause' | 'ledge_trace' | 'bask' | 'inspect_cursor' | 'flee'
      this.stateTimer = 2 + Math.random() * 4;
      this.targetX = this.x + Math.cos(this.heading) * 180;
      this.targetY = this.y + Math.sin(this.heading) * 180;
      this.activeLedge = null;
      this.ledgeCornerIdx = 0;
      this.ledgeElevation = 0; // 0 (page level) -> 1 (perched on DOM element)

      // Idle tongue flick animation state
      this.tongueTimer = 1.8 + Math.random() * 3.5;
      this.tongueProgress = 0; // 0 when retracted, 0..1 over ~160ms

      // Eye tracking offset
      this.eyeLookAngle = this.heading;

      // Dynamic camouflage skin colors
      this.skinPrimary = [52, 188, 92];
      this.skinSecondary = [36, 138, 64];
      this.skinSpots = [32, 92, 44];
      this.skinBelly = [148, 224, 152];
      this.skinToePads = [132, 212, 144];
      this.skinStripe = [110, 220, 126];
      this.lastColorSampleTime = 0;
      this.targetSampledRgb = [52, 188, 92];

      // 18-segment kinematic spine
      this.spine = [];
      for (let i = 0; i < 18; i++) {
        const distBack = i * 7.5 * settings.size;
        this.spine.push({
          x: this.x - Math.cos(this.heading) * distBack,
          y: this.y - Math.sin(this.heading) * distBack,
          angle: this.heading
        });
      }

      // 4 IK Legs:
      // 0: Front-Left (FL), 1: Front-Right (FR), 2: Back-Left (BL), 3: Back-Right (BR)
      // Diagonal trotting pairs: Pair 0 = (FL=0, BR=3), Pair 1 = (FR=1, BL=2)
      this.legs = [
        this.createLeg(0, 4, -1, -1, 0), // FL: spine[4], left (-1), elbow bends backward (-1)
        this.createLeg(1, 4,  1,  1, 1), // FR: spine[4], right (+1), elbow bends backward (+1)
        this.createLeg(2, 8, -1,  1, 1), // BL: spine[8], left (-1), knee bends forward (+1)
        this.createLeg(3, 8,  1, -1, 0)  // BR: spine[8], right (+1), knee bends forward (-1)
      ];

      this.initFootPositions();
      this.generateDorsalPattern();
    }

    createLeg(id, spineIdx, side, bendDir, diagPair) {
      return {
        id,
        spineIdx,
        side,        // -1 = left, +1 = right
        bendDir,     // controls sprawling elbow/knee direction in 2-bone IK
        diagPair,    // 0 or 1 for diagonal trotting synchronization
        footX: 0,
        footY: 0,
        footAngle: 0,
        stepStartX: 0,
        stepStartY: 0,
        stepTargetX: 0,
        stepTargetY: 0,
        stepProgress: 1, // 1 = planted, 0..1 = stepping
        lift: 0,
        jointX: 0,
        jointY: 0,
        rootX: 0,
        rootY: 0
      };
    }

    generateDorsalPattern() {
      // Pre-compute organic dorsal spots along head, torso, and tail base
      this.spots = [];
      const spotSegments = [1, 2, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10, 11];
      for (let i = 0; i < spotSegments.length; i++) {
        const segIdx = spotSegments[i];
        const sideOffset = (i % 2 === 0 ? -1 : 1) * (0.22 + (Math.sin(i * 3.7) * 0.5 + 0.5) * 0.36);
        const radiusFactor = 0.22 + (Math.cos(i * 2.3) * 0.5 + 0.5) * 0.16;
        this.spots.push({
          segIdx,
          sideOffset,
          longOffset: (Math.sin(i * 5.1) - 0.5) * 2.2,
          radiusFactor
        });
      }
    }

    getIdealFootPos(leg, scale, predictDist = 0) {
      const seg = this.spine[leg.spineIdx];
      const nextSeg = this.spine[Math.max(0, leg.spineIdx - 1)];
      const segAngle = Math.atan2(nextSeg.y - seg.y, nextSeg.x - seg.x);
      const perpAngle = segAngle + leg.side * (Math.PI * 0.5);

      // Shoulder/hip girdle rotation sway coupled to gaitPhase
      const girdleSway = Math.sin(this.gaitPhase + (leg.spineIdx === 4 ? 0 : Math.PI)) * 0.14;
      const reachOut = (leg.spineIdx === 4 ? 23 : 25) * scale;
      const forwardBias = (leg.spineIdx === 4 ? 9 : -4) * scale + predictDist;

      const angleWithSway = perpAngle + girdleSway * leg.side;
      const fx = seg.x + Math.cos(angleWithSway) * reachOut + Math.cos(segAngle) * forwardBias;
      const fy = seg.y + Math.sin(angleWithSway) * reachOut + Math.sin(segAngle) * forwardBias;
      const footOrientation = segAngle + leg.side * (leg.spineIdx === 4 ? 0.35 : 0.65);

      return { x: fx, y: fy, angle: footOrientation };
    }

    initFootPositions() {
      const s = settings.size;
      for (const leg of this.legs) {
        const ideal = this.getIdealFootPos(leg, s, 0);
        leg.footX = ideal.x;
        leg.footY = ideal.y;
        leg.stepStartX = ideal.x;
        leg.stepStartY = ideal.y;
        leg.stepTargetX = ideal.x;
        leg.stepTargetY = ideal.y;
        leg.footAngle = ideal.angle;
        leg.stepProgress = 1;
        leg.lift = 0;
      }
    }

    pickNewWanderTarget() {
      const pad = 75;
      // If DOM ledge climbing is enabled, 45% chance to pick a visible DOM element ledge
      if (settings.ledgeClimbing && domLedges.length > 0 && Math.random() < 0.45) {
        let bestLedge = null;
        let bestDist = 420;
        for (const ledge of domLedges) {
          const d = dist(this.x, this.y, ledge.cx, ledge.cy);
          if (d < bestDist && d > 35) {
            bestDist = d;
            bestLedge = ledge;
          }
        }
        if (bestLedge) {
          this.activeLedge = bestLedge;
          if (bestLedge.isImage && Math.random() < 0.5) {
            // Crawl onto the image to bask
            this.state = 'bask';
            this.targetX = clamp(bestLedge.cx + (Math.random() - 0.5) * bestLedge.width * 0.4, pad, vw - pad);
            this.targetY = clamp(bestLedge.cy + (Math.random() - 0.5) * bestLedge.height * 0.4, pad, vh - pad);
            this.stateTimer = 4.5 + Math.random() * 3.5;
            return;
          } else {
            // Trace along the rectangular border of the DOM element
            this.state = 'ledge_trace';
            const corners = [
              { x: bestLedge.left, y: bestLedge.top },
              { x: bestLedge.right, y: bestLedge.top },
              { x: bestLedge.right, y: bestLedge.bottom },
              { x: bestLedge.left, y: bestLedge.bottom }
            ];
            let nearestIdx = 0;
            let minCornerDist = Infinity;
            corners.forEach((c, idx) => {
              const cd = dist(this.x, this.y, c.x, c.y);
              if (cd < minCornerDist) {
                minCornerDist = cd;
                nearestIdx = idx;
              }
            });
            this.ledgeCornerIdx = nearestIdx;
            this.targetX = clamp(corners[nearestIdx].x, pad, vw - pad);
            this.targetY = clamp(corners[nearestIdx].y, pad, vh - pad);
            this.stateTimer = 6.0 + Math.random() * 4.0;
            return;
          }
        }
      }

      this.activeLedge = null;
      this.state = 'wander';
      const turn = (Math.random() - 0.5) * Math.PI * 1.15;
      const candAngle = this.heading + turn;
      const stepDist = 140 + Math.random() * 240;
      let tx = this.x + Math.cos(candAngle) * stepDist;
      let ty = this.y + Math.sin(candAngle) * stepDist;

      if (tx < pad || tx > vw - pad || ty < pad || ty > vh - pad) {
        tx = pad + Math.random() * Math.max(100, vw - pad * 2);
        ty = pad + Math.random() * Math.max(100, vh - pad * 2);
      }
      this.targetX = tx;
      this.targetY = ty;
      this.stateTimer = 3.2 + Math.random() * 4.2;
    }

    updateSkinColors(dt, now) {
      const mode = settings.skinMode;
      let targetPrimary, targetSecondary, targetSpots, targetBelly, targetToePads, targetStripe;

      if (mode === 'auto') {
        if (now - this.lastColorSampleTime > 180) {
          this.lastColorSampleTime = now;
          const torsoSeg = this.spine[6] || this.spine[0];
          this.targetSampledRgb = sampleWebpageColor(torsoSeg.x, torsoSeg.y);
        }
        const [r, g, b] = this.targetSampledRgb;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // Shift primary slightly toward organic reptilian hue while matching surface luminance & tint
        const isDarkSurface = lum < 115;
        const shift = isDarkSurface ? 18 : -16;
        const spotShift = isDarkSurface ? 44 : -46;

        targetPrimary = [
          clamp(r + shift * 0.7, 18, 242),
          clamp(g + shift * 0.95 + 6, 22, 245),
          clamp(b + shift * 0.7, 18, 242)
        ];
        targetSecondary = [
          clamp(r + shift * 1.4, 12, 235),
          clamp(g + shift * 1.3 + 4, 16, 238),
          clamp(b + shift * 1.4, 12, 235)
        ];
        targetSpots = [
          clamp(r + spotShift, 10, 248),
          clamp(g + spotShift + 4, 12, 250),
          clamp(b + spotShift, 10, 248)
        ];
        targetBelly = [
          clamp(r + (isDarkSurface ? 32 : 14), 30, 252),
          clamp(g + (isDarkSurface ? 36 : 18), 34, 252),
          clamp(b + (isDarkSurface ? 30 : 12), 30, 252)
        ];
        targetToePads = [
          clamp(r + (isDarkSurface ? 38 : -22), 28, 245),
          clamp(g + (isDarkSurface ? 42 : -18), 32, 248),
          clamp(b + (isDarkSurface ? 36 : -22), 28, 245)
        ];
        targetStripe = [
          clamp(r + (isDarkSurface ? 30 : -26), 20, 248),
          clamp(g + (isDarkSurface ? 36 : -20), 24, 250),
          clamp(b + (isDarkSurface ? 28 : -26), 20, 248)
        ];
      } else {
        const preset = SKIN_PRESETS[mode] || SKIN_PRESETS.emerald;
        targetPrimary = preset.primary;
        targetSecondary = preset.secondary;
        targetSpots = preset.spots;
        targetBelly = preset.belly;
        targetToePads = preset.toePads;
        targetStripe = preset.stripe;
      }

      const rate = clamp(dt * 3.2, 0.01, 0.25);
      for (let c = 0; c < 3; c++) {
        this.skinPrimary[c] = lerp(this.skinPrimary[c], targetPrimary[c], rate);
        this.skinSecondary[c] = lerp(this.skinSecondary[c], targetSecondary[c], rate);
        this.skinSpots[c] = lerp(this.skinSpots[c], targetSpots[c], rate);
        this.skinBelly[c] = lerp(this.skinBelly[c], targetBelly[c], rate);
        this.skinToePads[c] = lerp(this.skinToePads[c], targetToePads[c], rate);
        this.skinStripe[c] = lerp(this.skinStripe[c], targetStripe[c], rate);
      }
    }

    update(dt, now) {
      const scale = settings.size;
      const baseCrawlSpeed = 68 * settings.speed * (0.85 + 0.3 * Math.sqrt(scale));
      this.breathPhase += dt * 2.8;

      // 1. Update live skin camouflage
      this.updateSkinColors(dt, now);

      // 2. Cursor reaction logic
      const distToCursor = cursor.active ? dist(this.x, this.y, cursor.x, cursor.y) : Infinity;
      const reaction = settings.cursorReaction;

      if (reaction === 'shy' && distToCursor < 165 * scale) {
        this.state = 'flee';
        const fleeAngle = Math.atan2(this.y - cursor.y, this.x - cursor.x) + (Math.random() - 0.5) * 0.35;
        this.targetX = clamp(this.x + Math.cos(fleeAngle) * 240, 50, vw - 50);
        this.targetY = clamp(this.y + Math.sin(fleeAngle) * 240, 50, vh - 50);
        this.stateTimer = 1.4;
      } else if (reaction === 'curious' && distToCursor < 280 * scale && cursor.speed < 420) {
        this.state = 'inspect_cursor';
        this.targetX = cursor.x;
        this.targetY = cursor.y;
        this.stateTimer = 1.5;
      } else if (this.state === 'inspect_cursor' || this.state === 'flee') {
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.pickNewWanderTarget();
        }
      }

      // 3. State machine movement speed & steering
      const dTarget = dist(this.x, this.y, this.targetX, this.targetY);
      let desiredSpeed = baseCrawlSpeed;
      let desiredHeading = Math.atan2(this.targetY - this.y, this.targetX - this.x);

      if (this.state === 'pause') {
        desiredSpeed = 0;
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.pickNewWanderTarget();
        }
      } else if (this.state === 'inspect_cursor') {
        if (dTarget < 62 * scale) {
          // Stop politely near the cursor, tilt head toward cursor, and flick tongue
          desiredSpeed = 0;
          this.heading = lerpAngle(this.heading, desiredHeading, clamp(dt * 5.0, 0, 1));
        } else {
          desiredSpeed = baseCrawlSpeed * 0.85;
        }
      } else if (this.state === 'flee') {
        desiredSpeed = baseCrawlSpeed * 2.25;
        if (dTarget < 35) {
          this.pickNewWanderTarget();
        }
      } else if (this.state === 'bask') {
        if (dTarget < 18) {
          desiredSpeed = 0;
          this.stateTimer -= dt;
          if (this.stateTimer <= 0) {
            this.activeLedge = null;
            this.pickNewWanderTarget();
          }
        } else {
          desiredSpeed = baseCrawlSpeed * 0.9;
        }
      } else if (this.state === 'ledge_trace' && this.activeLedge) {
        const L = this.activeLedge;
        const corners = [
          { x: L.left, y: L.top },
          { x: L.right, y: L.top },
          { x: L.right, y: L.bottom },
          { x: L.left, y: L.bottom }
        ];
        if (dTarget < 18) {
          this.ledgeCornerIdx = (this.ledgeCornerIdx + 1) % 4;
          this.targetX = clamp(corners[this.ledgeCornerIdx].x, 40, vw - 40);
          this.targetY = clamp(corners[this.ledgeCornerIdx].y, 40, vh - 40);
        }
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.activeLedge = null;
          this.state = 'pause';
          this.stateTimer = 1.2 + Math.random() * 1.8;
        }
      } else {
        // 'wander'
        if (dTarget < 24) {
          if (Math.random() < 0.45) {
            this.state = 'pause';
            this.stateTimer = 1.1 + Math.random() * 2.2;
            desiredSpeed = 0;
          } else {
            this.pickNewWanderTarget();
          }
        }
      }

      // Smoothly accelerate/decelerate
      this.currentSpeed = lerp(this.currentSpeed, desiredSpeed, clamp(dt * 7.5, 0, 1));

      // Update DOM Ledge elevation (briefly increases body shadow when climbing onto a DOM element)
      let onDomElement = false;
      if (settings.ledgeClimbing && domLedges.length > 0) {
        const torso = this.spine[5] || this;
        for (let i = 0; i < domLedges.length; i++) {
          const r = domLedges[i];
          if (torso.x >= r.left - 8 && torso.x <= r.right + 8 && torso.y >= r.top - 8 && torso.y <= r.bottom + 8) {
            onDomElement = true;
            break;
          }
        }
      }
      this.ledgeElevation = lerp(this.ledgeElevation, onDomElement ? 1.0 : 0.0, clamp(dt * 4.5, 0, 1));

      // Advance gait phase & coupled lateral spine S-wave
      const speedNorm = this.currentSpeed / Math.max(1, baseCrawlSpeed);
      this.gaitPhase += dt * (this.currentSpeed * 0.145) / Math.max(0.55, scale);

      if (this.currentSpeed > 1.5) {
        const turnRate = (this.state === 'flee' ? 7.5 : 4.2) * dt;
        this.heading = lerpAngle(this.heading, desiredHeading, clamp(turnRate, 0, 1));
        const swayAngle = Math.sin(this.gaitPhase) * 0.09 * clamp(speedNorm, 0, 1.5);
        const moveAngle = this.heading + swayAngle;

        this.x += Math.cos(moveAngle) * this.currentSpeed * dt;
        this.y += Math.sin(moveAngle) * this.currentSpeed * dt;

        // Keep comfortably inside viewport
        const edgePad = 36;
        if (this.x < edgePad || this.x > vw - edgePad || this.y < edgePad || this.y > vh - edgePad) {
          this.x = clamp(this.x, edgePad, vw - edgePad);
          this.y = clamp(this.y, edgePad, vh - edgePad);
          this.heading = Math.atan2(vh * 0.5 - this.y, vw * 0.5 - this.x);
          this.pickNewWanderTarget();
        }
      }

      // Eye tracking toward cursor (when curious/nearby) or target waypoint
      const lookX = (cursor.active && distToCursor < 320 * scale && reaction !== 'ignore')
        ? cursor.x
        : this.targetX;
      const lookY = (cursor.active && distToCursor < 320 * scale && reaction !== 'ignore')
        ? cursor.y
        : this.targetY;
      const targetLookAngle = Math.atan2(lookY - this.y, lookX - this.x);
      this.eyeLookAngle = lerpAngle(this.eyeLookAngle, targetLookAngle, clamp(dt * 8, 0, 1));

      // Idle forked tongue-flick micro-animation (~160ms)
      if (this.tongueProgress > 0) {
        this.tongueProgress += dt / 0.16; // 160ms total flick duration
        if (this.tongueProgress >= 1) {
          this.tongueProgress = 0;
        }
      } else {
        this.tongueTimer -= dt * (this.currentSpeed < 6 ? 1.35 : 0.45);
        if (this.tongueTimer <= 0) {
          this.tongueProgress = 0.001;
          this.tongueTimer = 2.4 + Math.random() * 4.2;
        }
      }

      // 4. Solve 18-Segment Articulated Kinematic Spine with lateral S-wave undulation
      this.spine[0].x = this.x;
      this.spine[0].y = this.y;

      // Subtle head tilt when inspecting cursor
      let headTilt = 0;
      if (this.state === 'inspect_cursor' && distToCursor < 180 * scale) {
        headTilt = clamp(normalizeAngle(targetLookAngle - this.heading), -0.42, 0.42);
      }
      this.spine[0].angle = this.heading + headTilt * 0.65;

      for (let i = 1; i < 18; i++) {
        const prev = this.spine[i - 1];
        const curr = this.spine[i];
        const segLen = BASE_SEG_DIST[i] * scale;

        const dx = prev.x - curr.x;
        const dy = prev.y - curr.y;
        let segAngle = Math.atan2(dy, dx);

        // Couple lateral S-wave undulation to walking gait
        const waveAmp = i >= 9
          ? (0.045 + (i - 8) * 0.012) // graceful whip tail wave
          : (i >= 4 && i <= 8 ? 0.032 : 0.012);
        const moveWave = Math.sin(this.gaitPhase - i * 0.52) * waveAmp * clamp(speedNorm, 0.08, 1.4);
        segAngle += moveWave;

        // Soft angular constraint relative to parent segment so spine never kinks sharply
        const maxBend = i <= 3 ? 0.32 : (i <= 8 ? 0.38 : 0.46);
        const diff = clamp(normalizeAngle(segAngle - prev.angle), -maxBend, maxBend);
        curr.angle = prev.angle + diff;

        curr.x = prev.x - Math.cos(curr.angle) * segLen;
        curr.y = prev.y - Math.sin(curr.angle) * segLen;
      }

      // 5. Update 4 Legs with Diagonal Trotting Gait + 2-Bone Analytical IK
      this.updateLegsIK(dt, scale, speedNorm);
    }

    updateLegsIK(dt, scale, speedNorm) {
      const L1 = 14.5 * scale; // Upper limb (stylopod: humerus / femur)
      const L2 = 15.5 * scale; // Lower limb (zeugopod: radius-ulna / tibia-fibula)
      const strideThreshold = 14.0 * scale;
      const stepDuration = clamp(0.16 / Math.max(0.45, settings.speed * Math.max(0.7, speedNorm)), 0.075, 0.22);

      // Check which diagonal pair is currently stepping so the opposite diagonal pair stays planted
      const pair0Stepping = this.legs[0].stepProgress < 1 || this.legs[3].stepProgress < 1;
      const pair1Stepping = this.legs[1].stepProgress < 1 || this.legs[2].stepProgress < 1;

      // Trigger diagonal pair step when stretched past stride threshold
      if (!pair0Stepping && !pair1Stepping) {
        let maxStretch0 = 0;
        let maxStretch1 = 0;
        for (const leg of this.legs) {
          const ideal = this.getIdealFootPos(leg, scale, 0);
          const stretch = dist(leg.footX, leg.footY, ideal.x, ideal.y);
          if (leg.diagPair === 0) maxStretch0 = Math.max(maxStretch0, stretch);
          else maxStretch1 = Math.max(maxStretch1, stretch);
        }

        const activePair = maxStretch0 >= maxStretch1 ? 0 : 1;
        const maxStretch = Math.max(maxStretch0, maxStretch1);

        if (maxStretch > strideThreshold || (this.currentSpeed < 2 && maxStretch > strideThreshold * 0.65)) {
          const predictAhead = clamp(this.currentSpeed * stepDuration * 0.85, 4 * scale, 16 * scale);
          for (const leg of this.legs) {
            if (leg.diagPair === activePair) {
              const target = this.getIdealFootPos(leg, scale, predictAhead);
              if (dist(leg.footX, leg.footY, target.x, target.y) > 3.5 * scale) {
                leg.stepStartX = leg.footX;
                leg.stepStartY = leg.footY;
                leg.stepTargetX = target.x;
                leg.stepTargetY = target.y;
                leg.footAngle = target.angle;
                leg.stepProgress = 0;
              }
            }
          }
        }
      }

      // Advance active foot steps along a parabolic lift arc and solve 2-bone analytical IK
      for (const leg of this.legs) {
        const attachSeg = this.spine[leg.spineIdx];
        const prevSeg = this.spine[leg.spineIdx - 1];
        const bodyAngle = Math.atan2(prevSeg.y - attachSeg.y, prevSeg.x - attachSeg.x);
        const perp = bodyAngle + leg.side * (Math.PI * 0.5);
        const hipOffset = BASE_RADII[leg.spineIdx] * 0.68 * scale;

        leg.rootX = attachSeg.x + Math.cos(perp) * hipOffset;
        leg.rootY = attachSeg.y + Math.sin(perp) * hipOffset;

        if (leg.stepProgress < 1) {
          leg.stepProgress = Math.min(1, leg.stepProgress + dt / stepDuration);
          // Smoothstep horizontal interpolation + parabolic vertical lift arc
          const t = leg.stepProgress;
          const smoothT = t * t * (3 - 2 * t);
          leg.lift = Math.sin(t * Math.PI); // 0 -> 1 -> 0 parabolic arc

          // Slight outward swing arc during lift
          const swingOut = leg.lift * 3.2 * scale;
          leg.footX = lerp(leg.stepStartX, leg.stepTargetX, smoothT) + Math.cos(perp) * swingOut;
          leg.footY = lerp(leg.stepStartY, leg.stepTargetY, smoothT) + Math.sin(perp) * swingOut;
        } else {
          leg.lift = 0;
        }

        // Solve 2-bone analytical IK for shoulder/hip -> elbow/knee -> foot
        const ik = solveTwoBoneIK(
          leg.rootX,
          leg.rootY,
          leg.footX,
          leg.footY,
          L1,
          L2,
          leg.bendDir
        );
        leg.jointX = ik.jointX;
        leg.jointY = ik.jointY;
        leg.footX = ik.footX;
        leg.footY = ik.footY;
      }
    }

    /**
     * Computes segment half-width including subtle ribcage breathing expansion on torso segments [5..7].
     */
    getSegmentRadius(i, scale) {
      let r = BASE_RADII[i] * scale;
      if (i >= 5 && i <= 7) {
        const breath = Math.sin(this.breathPhase) * 0.045 * scale;
        r *= (1 + breath);
      }
      return r;
    }

    /**
     * Renders a single limb + 5 splayed gecko toe pads (rounded teardrop pads).
     */
    drawLimb(ctx, leg, scale, isShadowPass) {
      const lift = leg.lift;
      const liftScale = 1 + lift * 0.08;

      if (isShadowPass) {
        ctx.save();
        // Increase limb shadow offset and blur when foot lifts off the page during a step
        const extraOffX = lift * 4.5 + this.ledgeElevation * 3.0;
        const extraOffY = lift * 6.5 + this.ledgeElevation * 4.5;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
        ctx.shadowBlur = (10 + lift * 6 + this.ledgeElevation * 5) * dpr;
        ctx.shadowOffsetX = (4 + extraOffX) * dpr;
        ctx.shadowOffsetY = (7 + extraOffY) * dpr;
      }

      const limbColor = rgbToCss(this.skinSecondary);
      const upperColor = rgbToCss(this.skinPrimary);
      const padColor = rgbToCss(this.skinToePads);

      // 1. Draw 5 distinct splayed gecko toes with rounded teardrop lamellar pads
      const splaySpread = 1.0 + (1 - lift) * 0.16; // fan out subtly when planted
      const toeAngles = [-0.86, -0.43, 0, 0.43, 0.86];
      const toeLengths = [6.2, 7.8, 8.6, 7.8, 6.2];

      for (let t = 0; t < 5; t++) {
        const ang = leg.footAngle + toeAngles[t] * splaySpread;
        const tLen = toeLengths[t] * scale * liftScale;
        const tipX = leg.footX + Math.cos(ang) * tLen;
        const tipY = leg.footY + Math.sin(ang) * tLen;

        // Toe phalange stalk
        ctx.beginPath();
        ctx.moveTo(leg.footX, leg.footY);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = limbColor;
        ctx.lineWidth = 1.85 * scale * liftScale;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Rounded teardrop gecko toe pad at tip
        ctx.save();
        ctx.translate(tipX, tipY);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.ellipse(0.6 * scale, 0, 2.35 * scale * liftScale, 1.55 * scale * liftScale, 0, 0, Math.PI * 2);
        ctx.fillStyle = padColor;
        ctx.fill();
        ctx.restore();
      }

      // 2. Lower limb (elbow/knee -> foot)
      ctx.beginPath();
      ctx.moveTo(leg.jointX, leg.jointY);
      ctx.lineTo(leg.footX, leg.footY);
      ctx.strokeStyle = limbColor;
      ctx.lineWidth = 4.6 * scale * liftScale;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 3. Upper limb (shoulder/hip -> elbow/knee)
      ctx.beginPath();
      ctx.moveTo(leg.rootX, leg.rootY);
      ctx.lineTo(leg.jointX, leg.jointY);
      ctx.strokeStyle = upperColor;
      ctx.lineWidth = 6.2 * scale * liftScale;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Knee/elbow joint highlight dot
      ctx.beginPath();
      ctx.arc(leg.jointX, leg.jointY, 2.2 * scale * liftScale, 0, Math.PI * 2);
      ctx.fillStyle = upperColor;
      ctx.fill();

      if (isShadowPass) {
        ctx.restore();
      }
    }

    /**
     * Renders the complete top-down gecko onto the canvas.
     */
    draw(ctx) {
      const scale = settings.size;
      ctx.save();

      // 1. Forked pink tongue flick micro-animation (drawn beneath snout tip)
      if (this.tongueProgress > 0) {
        const snout = this.spine[0];
        const headAngle = snout.angle;
        const ext = Math.sin(this.tongueProgress * Math.PI); // smooth out and back
        const tongueLen = ext * 15.5 * scale;
        const forkLen = ext * 5.2 * scale;

        const baseTx = snout.x + Math.cos(headAngle) * (2.5 * scale);
        const baseTy = snout.y + Math.sin(headAngle) * (2.5 * scale);
        const midTx = baseTx + Math.cos(headAngle) * tongueLen;
        const midTy = baseTy + Math.sin(headAngle) * tongueLen;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 105, 148, 0.94)';
        ctx.lineWidth = 1.9 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(baseTx, baseTy);
        ctx.lineTo(midTx, midTy);
        ctx.stroke();

        // Forked tips
        for (const forkSign of [-1, 1]) {
          const fAng = headAngle + forkSign * 0.42;
          ctx.beginPath();
          ctx.moveTo(midTx, midTy);
          ctx.lineTo(midTx + Math.cos(fAng) * forkLen, midTy + Math.sin(fAng) * forkLen);
          ctx.lineWidth = 1.35 * scale;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 2. Render all 4 IK limbs with step-lift shadows
      for (const leg of this.legs) {
        this.drawLimb(ctx, leg, scale, true);
      }

      // 3. Construct smooth left/right dorsal body & whip-tail contour from 18 spine segments
      const leftPts = [];
      const rightPts = [];

      for (let i = 0; i < 18; i++) {
        const seg = this.spine[i];
        let tangentAngle;
        if (i === 0) {
          tangentAngle = Math.atan2(this.spine[0].y - this.spine[1].y, this.spine[0].x - this.spine[1].x);
        } else if (i === 17) {
          tangentAngle = Math.atan2(this.spine[16].y - this.spine[17].y, this.spine[16].x - this.spine[17].x);
        } else {
          tangentAngle = Math.atan2(this.spine[i - 1].y - this.spine[i + 1].y, this.spine[i - 1].x - this.spine[i + 1].x);
        }

        const r = this.getSegmentRadius(i, scale);
        const perp = tangentAngle + Math.PI * 0.5;
        leftPts.push({
          x: seg.x - Math.cos(perp) * r,
          y: seg.y - Math.sin(perp) * r
        });
        rightPts.push({
          x: seg.x + Math.cos(perp) * r,
          y: seg.y + Math.sin(perp) * r
        });
      }

      const snout = this.spine[0];
      const snoutAngle = Math.atan2(this.spine[0].y - this.spine[1].y, this.spine[0].x - this.spine[1].x);
      const snoutTipX = snout.x + Math.cos(snoutAngle) * (4.8 * scale);
      const snoutTipY = snout.y + Math.sin(snoutAngle) * (4.8 * scale);

      const tail = this.spine[17];
      const tailAngle = Math.atan2(this.spine[16].y - this.spine[17].y, this.spine[16].x - this.spine[17].x);
      const tailTipX = tail.x - Math.cos(tailAngle) * (2.5 * scale);
      const tailTipY = tail.y - Math.sin(tailAngle) * (2.5 * scale);

      // Draw body polygon with contact drop shadow onto the webpage
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
      ctx.shadowBlur = (10 + this.ledgeElevation * 6) * dpr;
      ctx.shadowOffsetX = (4 + this.ledgeElevation * 3) * dpr;
      ctx.shadowOffsetY = (7 + this.ledgeElevation * 4.5) * dpr;

      ctx.beginPath();
      ctx.moveTo(snoutTipX, snoutTipY);

      // Right contour from snout to tail tip
      for (let i = 0; i < 17; i++) {
        const xc = (rightPts[i].x + rightPts[i + 1].x) * 0.5;
        const yc = (rightPts[i].y + rightPts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(rightPts[i].x, rightPts[i].y, xc, yc);
      }
      ctx.quadraticCurveTo(rightPts[17].x, rightPts[17].y, tailTipX, tailTipY);

      // Left contour from tail tip back to snout
      for (let i = 17; i > 0; i--) {
        const xc = (leftPts[i].x + leftPts[i - 1].x) * 0.5;
        const yc = (leftPts[i].y + leftPts[i - 1].y) * 0.5;
        ctx.quadraticCurveTo(leftPts[i].x, leftPts[i].y, xc, yc);
      }
      ctx.quadraticCurveTo(leftPts[0].x, leftPts[0].y, snoutTipX, snoutTipY);
      ctx.closePath();

      // Dorsal gradient from head to tail
      const grad = ctx.createLinearGradient(snoutTipX, snoutTipY, tailTipX, tailTipY);
      grad.addColorStop(0, rgbToCss(this.skinPrimary));
      grad.addColorStop(0.58, rgbToCss(this.skinPrimary));
      grad.addColorStop(1, rgbToCss(this.skinSecondary));
      ctx.fillStyle = grad;
      ctx.fill();

      // Subtle outline for crisp definition on any background
      ctx.strokeStyle = rgbToCss(this.skinSecondary, 0.55);
      ctx.lineWidth = 1.0 * scale;
      ctx.stroke();
      ctx.restore(); // End shadow pass for body

      // 4. Clip inside body path to render tail bands, dorsal ridge shading, and organic spots
      ctx.save();
      ctx.clip();

      // Tail bands (segments 9..16)
      for (let i = 9; i <= 16; i += 2) {
        const seg = this.spine[i];
        const r = this.getSegmentRadius(i, scale) * 1.18;
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbToCss(this.skinSpots, 0.42);
        ctx.fill();
      }

      // Dorsal spots/flecks along head and torso
      for (let i = 0; i < this.spots.length; i++) {
        const sp = this.spots[i];
        const seg = this.spine[sp.segIdx];
        const prev = this.spine[Math.max(0, sp.segIdx - 1)];
        const ang = Math.atan2(prev.y - seg.y, prev.x - seg.x);
        const perp = ang + Math.PI * 0.5;
        const segR = this.getSegmentRadius(sp.segIdx, scale);

        const sx = seg.x + Math.cos(perp) * (segR * sp.sideOffset) + Math.cos(ang) * (sp.longOffset * scale);
        const sy = seg.y + Math.sin(perp) * (segR * sp.sideOffset) + Math.sin(ang) * (sp.longOffset * scale);
        const sr = segR * sp.radiusFactor;

        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = rgbToCss(this.skinSpots, 0.72);
        ctx.fill();
      }

      // Subtle dorsal vertebral ridge highlight from neck [2] to tail [14]
      ctx.beginPath();
      ctx.moveTo(this.spine[2].x, this.spine[2].y);
      for (let i = 3; i <= 14; i++) {
        const xc = (this.spine[i - 1].x + this.spine[i].x) * 0.5;
        const yc = (this.spine[i - 1].y + this.spine[i].y) * 0.5;
        ctx.quadraticCurveTo(this.spine[i - 1].x, this.spine[i - 1].y, xc, yc);
      }
      ctx.strokeStyle = rgbToCss(this.skinStripe, 0.42);
      ctx.lineWidth = 2.4 * scale;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.restore(); // Remove body clip

      // 5. Sculpted head details: nostrils + glossy dark eyes with specular tracking highlights
      const headSeg = this.spine[1];
      const headAngle = Math.atan2(this.spine[0].y - this.spine[2].y, this.spine[0].x - this.spine[2].x);
      const headPerp = headAngle + Math.PI * 0.5;
      const headR = this.getSegmentRadius(1, scale);

      // Tiny nostrils near snout
      for (const side of [-1, 1]) {
        const nx = snout.x + Math.cos(snoutAngle) * (1.5 * scale) + Math.cos(headPerp) * (side * 2.1 * scale);
        const ny = snout.y + Math.sin(snoutAngle) * (1.5 * scale) + Math.sin(headPerp) * (side * 2.1 * scale);
        ctx.beginPath();
        ctx.arc(nx, ny, 0.75 * scale, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20, 26, 22, 0.55)';
        ctx.fill();
      }

      // Glossy dark gecko eyes on the lateral ridges of the head
      const eyeOffsetOut = headR * 0.76;
      const eyeOffsetFwd = 1.2 * scale;
      const eyeRadius = 2.65 * scale;
      const trackDx = Math.cos(this.eyeLookAngle) * (0.55 * scale);
      const trackDy = Math.sin(this.eyeLookAngle) * (0.55 * scale);

      for (const side of [-1, 1]) {
        const ex = headSeg.x + Math.cos(headPerp) * (side * eyeOffsetOut) + Math.cos(headAngle) * eyeOffsetFwd;
        const ey = headSeg.y + Math.sin(headPerp) * (side * eyeOffsetOut) + Math.sin(headAngle) * eyeOffsetFwd;

        // Subtle supraorbital ridge socket
        ctx.beginPath();
        ctx.arc(ex, ey, eyeRadius * 1.24, 0, Math.PI * 2);
        ctx.fillStyle = rgbToCss(this.skinSecondary, 0.85);
        ctx.fill();

        // Glossy dark eyeball shifted slightly toward tracking direction
        ctx.beginPath();
        ctx.arc(ex + trackDx * 0.4, ey + trackDy * 0.4, eyeRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#0e1418';
        ctx.fill();

        // Tiny crisp specular highlight
        ctx.beginPath();
        ctx.arc(
          ex + trackDx * 0.75 - 0.65 * scale,
          ey + trackDy * 0.75 - 0.65 * scale,
          0.85 * scale,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fill();
      }

      ctx.restore();
    }
  }

  let geckos = [];
  let rafId = null;
  let lastFrameTime = performance.now();

  function syncGeckoCount() {
    const desired = clamp(parseInt(settings.geckoCount, 10) || 2, 1, 4);
    while (geckos.length < desired) {
      geckos.push(new Gecko(geckos.length));
    }
    if (geckos.length > desired) {
      geckos.length = desired;
    }
  }

  function isActiveOnCurrentPage() {
    if (!settings.enabled) return false;
    if (settings.pausedDomains && settings.pausedDomains[currentHostname]) return false;
    return true;
  }

  function resizeCanvas() {
    if (!canvas) return;
    vw = window.innerWidth;
    vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
  }

  function ensureShadowCanvas() {
    if (hostEl && document.documentElement.contains(hostEl)) return;

    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.setAttribute('aria-hidden', 'true');
    Object.assign(hostEl.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '2147483647',
      overflow: 'hidden',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent'
    });

    shadowRoot = hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        overflow: hidden !important;
      }
      canvas {
        display: block !important;
        width: 100vw !important;
        height: 100vh !important;
        pointer-events: none !important;
      }
    `;
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(canvas);

    (document.documentElement || document.body).appendChild(hostEl);
    resizeCanvas();
  }

  function tick(now) {
    if (document.hidden || !isActiveOnCurrentPage()) {
      rafId = null;
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const dt = clamp((now - lastFrameTime) / 1000, 0.001, 0.05);
    lastFrameTime = now;

    // Decay cursor speed if mouse stopped
    if (now - cursor.lastMoveTime > 120) {
      cursor.speed *= 0.85;
    }

    // Throttled DOM ledge scan every ~1.5s
    if (now - lastLedgeScan > 1500) {
      lastLedgeScan = now;
      scanDomLedges();
    }

    ensureShadowCanvas();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    for (let i = 0; i < geckos.length; i++) {
      geckos[i].update(dt, now);
      geckos[i].draw(ctx);
    }

    ctx.restore();
    rafId = window.requestAnimationFrame(tick);
  }

  function updateLoopState() {
    syncGeckoCount();
    if (!document.hidden && isActiveOnCurrentPage()) {
      ensureShadowCanvas();
      if (hostEl) hostEl.style.display = 'block';
      if (!rafId) {
        lastFrameTime = performance.now();
        rafId = window.requestAnimationFrame(tick);
      }
    } else {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      if (hostEl) hostEl.style.display = 'none';
    }
  }

  // Event Listeners (passive, zero interference with page scrolling or clicking)
  window.addEventListener('mousemove', (e) => {
    const now = performance.now();
    const dt = Math.max(8, now - (cursor.lastMoveTime || now - 16));
    const dx = e.clientX - cursor.x;
    const dy = e.clientY - cursor.y;
    cursor.vx = (dx / dt) * 1000;
    cursor.vy = (dy / dt) * 1000;
    cursor.speed = Math.hypot(cursor.vx, cursor.vy);
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    cursor.active = true;
    cursor.lastMoveTime = now;
  }, { passive: true });

  let scrollScanTimeout = null;
  const triggerThrottledScan = () => {
    if (scrollScanTimeout) return;
    scrollScanTimeout = setTimeout(() => {
      scrollScanTimeout = null;
      lastLedgeScan = performance.now();
      scanDomLedges();
    }, 220);
  };

  window.addEventListener('resize', () => {
    resizeCanvas();
    triggerThrottledScan();
  }, { passive: true });

  window.addEventListener('scroll', triggerThrottledScan, { passive: true });

  document.addEventListener('visibilitychange', () => {
    updateLoopState();
  });

  // Load & sync settings from chrome.storage.local
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (res) => {
        settings = { ...DEFAULT_SETTINGS, ...res };
        scanDomLedges();
        updateLoopState();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const key of Object.keys(changes)) {
          settings[key] = changes[key].newValue;
        }
        scanDomLedges();
        updateLoopState();
      });
    } else {
      scanDomLedges();
      updateLoopState();
    }
  }

  loadSettings();
})();
