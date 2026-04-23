(function () {
 "use strict";


 const STORAGE_PINS = "inspo-cloud-pins-v1";
 const STORAGE_FOLDERS = "inspo-cloud-folders-v1";
 const STORAGE_CAMERA = "inspo-cloud-camera-v1";


 const PIN_DISPLAY_MAX_EDGE = 268;
 const PIN_DISPLAY_MIN_EDGE = 64;


 function pinDisplaySizeFromNatural(nw, nh) {
   if (!nw || !nh) return null;
   const s = PIN_DISPLAY_MAX_EDGE / Math.max(nw, nh);
   return {
     w: Math.max(PIN_DISPLAY_MIN_EDGE, Math.round(nw * s)),
     h: Math.max(PIN_DISPLAY_MIN_EDGE, Math.round(nh * s)),
   };
 }


 const FOLDER_PALETTE = [
   "#e879a9",
   "#9b7fd8",
   "#3dd672",
   "#7fd99a",
   "#7ec8e8",
   "#5b8fd8",
   "#4a6fa5",
   "#f5b942",
 ];


 const TIER1_POOL = [
   "color",
   "form",
   "function",
   "texture",
   "mood",
   "typography",
   "composition",
   "light",
   "material",
 ];


 const TIER2_BY_CATEGORY = {
   color: [
     "funky colors",
     "retro colors",
     "warm colors",
     "cool tones",
     "muted palette",
     "neon accents",
     "monochrome",
   ],
   form: [
     "organic shapes",
     "hard geometry",
     "playful layout",
     "dense collage",
     "negative space",
     "layered depth",
   ],
   function: [
     "editorial",
     "wayfinding",
     "packaging",
     "poster",
     "social post",
     "album art",
   ],
   texture: [
     "grain",
     "paper feel",
     "noise",
     "smooth gloss",
     "woven",
     "crisp vector",
   ],
   mood: [
     "calm",
     "energetic",
     "nostalgic",
     "cute",
     "serious",
     "dreamy",
   ],
   typography: [
     "bold type",
     "quirky lettering",
     "micro type",
     "handwritten",
     "grotesk",
     "serif editorial",
   ],
   composition: [
     "centered hero",
     "asymmetric",
     "grid structure",
     "full bleed",
     "framed",
   ],
   light: [
     "flat studio",
     "natural window",
     "hard flash",
     "soft gradient",
     "silhouette",
   ],
   material: [
     "metal",
     "fabric",
     "plastic",
     "paper craft",
     "glass",
   ],
 };


 const el = (id) => document.getElementById(id);


 const viewport = el("viewport");
 const world = el("world");
 const pinsLayer = el("pins-layer");
 const searchInput = el("search-input");
 const fileInput = el("file-input");
 const tagging = el("tagging");
 const taggingPreview = el("tagging-preview");
 const tier1Chips = el("tier1-chips");
 const tier2Block = el("tier2-block");
 const tier2Title = el("tier2-title");
 const tier2Chips = el("tier2-chips");
 const notesBody = el("notes-body");
 const notesToggle = el("notes-toggle");
 const notesInput = el("notes-input");
 const analyzeCanvas = el("analyze-canvas");
 const analyzeCtx = analyzeCanvas.getContext("2d", { willReadFrequently: true });


 let pins = [];
 let folders = [];
 let camera = { x: 0, y: 0, z: 1 };
 let camTarget = { x: 0, y: 0, z: 1 };
 let camAnimRaf = null;
 let selectedIds = new Set();
 let selectMode = false;
 let panning = null;
 let searchQuery = "";
 let focusedPinId = null;
 let activeFolderId = null;


 const focusPanel = el("focus-panel");
 const foldersScreen = el("folders-screen");
 const foldersViewport = el("folders-viewport");
 const foldersWorld = el("folders-world");
 const foldersCanvas = el("folders-canvas");
 let foldersCamera = { x: 0, y: 0 };
 let foldersPan = null;
 const focusTagGroups = el("focus-tag-groups");
 const focusNotes = el("focus-notes");
 const focusNotesBlock = el("focus-notes-block");
 const btnDeleteSelected = el("btn-delete-selected");


 let taggingState = {
   objectUrl: null,
   tier1: [],
   tier2: [],
   tier1Pick: null,
   tier2Pick: null,
   notes: "",
   imageHints: {},
   editingId: null,
 };


 function uid() {
   return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
 }


 function hashStr(s) {
   let h = 2166136261;
   for (let i = 0; i < s.length; i++) {
     h ^= s.charCodeAt(i);
     h = Math.imul(h, 16777619);
   }
   return h >>> 0;
 }


 function folderColorFor(name, id) {
   const h = hashStr(String(name || "folder") + String(id || ""));
   return FOLDER_PALETTE[h % FOLDER_PALETTE.length];
 }


 function formatTimeAgo(ts) {
   const t = typeof ts === "number" ? ts : Date.now();
   const s = Math.floor((Date.now() - t) / 1000);
   if (s < 45) return "just now";
   const m = Math.floor(s / 60);
   if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
   const h = Math.floor(m / 60);
   if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
   const d = Math.floor(h / 24);
   if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
   const w = Math.floor(d / 7);
   return `${w} week${w === 1 ? "" : "s"} ago`;
 }


 function migrateFolders() {
   let dirty = false;
   for (const f of folders) {
     if (!Array.isArray(f.pinIds)) {
       f.pinIds = [];
       dirty = true;
     }
     if (!f.color) {
       f.color = folderColorFor(f.name || "folder", f.id);
       dirty = true;
     }
     if (f.updatedAt == null) {
       f.updatedAt = Date.now();
       dirty = true;
     }
   }
   if (dirty) persistFolders();
 }


 function pinsForView() {
   if (!activeFolderId) return pins;
   const f = folders.find((x) => x.id === activeFolderId);
   if (!f) return pins;
   return pins.filter((p) => f.pinIds.includes(p.id));
 }


 function getPinBaseXY(pin, indexInView) {
   if (activeFolderId) {
     const pos = cloudPositionForIndex(indexInView, pin.id);
     return { x: pos.x, y: pos.y };
   }
   return { x: pin.x, y: pin.y };
 }


 function load() {
   try {
     pins = JSON.parse(localStorage.getItem(STORAGE_PINS) || "[]");
     folders = JSON.parse(localStorage.getItem(STORAGE_FOLDERS) || "[]");
     camera = JSON.parse(localStorage.getItem(STORAGE_CAMERA) || "null") || { x: 0, y: 0, z: 0.9 };
   } catch {
     pins = [];
     folders = [];
     camera = { x: 0, y: 0, z: 0.9 };
   }
   if (!Array.isArray(folders)) folders = [];
   migrateFolders();
   migratePinsMeta();
   syncCamTarget();
 }


 function persistPins() {
   localStorage.setItem(STORAGE_PINS, JSON.stringify(pins));
 }


 function persistFolders() {
   localStorage.setItem(STORAGE_FOLDERS, JSON.stringify(folders));
 }


 function persistCamera() {
   localStorage.setItem(STORAGE_CAMERA, JSON.stringify(camera));
 }


 function cloudPositionForIndex(i, id) {
   const golden = Math.PI * (3 - Math.sqrt(5));
   const ring = 108 + (hashStr(id) % 36);
   const spread = 1.36 + ((hashStr(id + "spr") % 40) / 100);
   const r = ring * Math.pow(i + 1, 0.56) * spread;
   const theta = i * golden * 1.02 + (hashStr(id + "a") % 120) * 0.008;
   const jitterX = ((hashStr(id + "x") % 56) - 28) * 0.55;
   const jitterY = ((hashStr(id + "y") % 56) - 28) * 0.55;
   return { x: r * Math.cos(theta) + jitterX, y: r * Math.sin(theta) * 0.86 + jitterY };
 }


 function ensurePinDepth(pin) {
   if (pin.depth == null) pin.depth = (hashStr(pin.id) % 100) / 100 * 0.72 + 0.14;
   return pin.depth;
 }


 function applyPinParallax() {
   const list = pinsForView();
   const zf = camera.z;
   const swim = 1 + Math.min(0.5, Math.abs(zf - 0.9)) * 0.55;
   let par = 0.14 * swim;
   if (focusedPinId) par *= 0.38;
   list.forEach((pin) => {
     const node = pinsLayer.querySelector(`[data-id="${pin.id}"]`);
     if (!node) return;
     const d = ensurePinDepth(pin);
     const z = (d - 0.52) * 360;
     const ox = (d - 0.55) * camera.x * par;
     const oy = (d - 0.55) * camera.y * par;
     node.style.transform = `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,${z.toFixed(1)}px)`;
   });
 }


 function syncCamTarget() {
   camTarget.x = camera.x;
   camTarget.y = camera.y;
   camTarget.z = camera.z;
 }


 function stepCameraAnim() {
   const k = 0.28;
   camera.x += (camTarget.x - camera.x) * k;
   camera.y += (camTarget.y - camera.y) * k;
   camera.z += (camTarget.z - camera.z) * k;
   applyWorldTransform();
   applyPinParallax();
   const settled =
     Math.hypot(camTarget.x - camera.x, camTarget.y - camera.y) < 0.45 && Math.abs(camTarget.z - camera.z) < 0.005;
   if (settled) {
     camera.x = camTarget.x;
     camera.y = camTarget.y;
     camera.z = camTarget.z;
     applyWorldTransform();
     applyPinParallax();
     camAnimRaf = null;
     viewport.classList.remove("viewport--driving-camera");
     persistCamera();
     return;
   }
   camAnimRaf = requestAnimationFrame(stepCameraAnim);
 }


 function bumpCameraAnim() {
   viewport.classList.add("viewport--driving-camera");
   if (!camAnimRaf) camAnimRaf = requestAnimationFrame(stepCameraAnim);
 }


 function applyWorldTransform() {
   world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.z})`;
 }


 function tagBucketKey(tag) {
   const t = tag.toLowerCase();
   if (
     /color|tone|palette|light|gradient|warm|cool|neon|mono|contrast|hue|airy|silhouette|flash/.test(t)
   )
     return "visual";
   if (
     /typography|type|form|function|composition|layout|grid|editorial|poster|packaging|letter|serif|grotesk|geometry|space|hero|bleed|wayfinding|micro/.test(
       t,
     )
   )
     return "structure";
   const mk = mapTier1ToKey(tag);
   if (mk === "color" || mk === "light") return "visual";
   if (["form", "function", "composition", "typography"].includes(mk)) return "structure";
   return "atmosphere";
 }


 function chipCategoryClass(label) {
   const b = tagBucketKey(label);
   if (b === "visual") return " chip--visual";
   if (b === "structure") return " chip--structure";
   return " chip--atmosphere";
 }


 function migratePinsMeta() {
   let dirty = false;
   for (const p of pins) {
     if (p.depth == null) {
       p.depth = (hashStr(p.id) % 100) / 100 * 0.72 + 0.14;
       dirty = true;
     }
     if (p.savedAt == null) {
       p.savedAt = Date.now();
       dirty = true;
     }
   }
   if (dirty) persistPins();
 }


 function analyzeImageEl(img) {
   try {
     analyzeCtx.clearRect(0, 0, 32, 32);
     analyzeCtx.drawImage(img, 0, 0, 32, 32);
     const data = analyzeCtx.getImageData(0, 0, 32, 32).data;
     let r = 0,
       g = 0,
       b = 0,
       n = 0;
     let lumMin = 255,
       lumMax = 0;
     for (let i = 0; i < data.length; i += 4) {
       r += data[i];
       g += data[i + 1];
       b += data[i + 2];
       n++;
       const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
       lumMin = Math.min(lumMin, lum);
       lumMax = Math.max(lumMax, lum);
     }
     r /= n;
     g /= n;
     b /= n;
     const contrast = (lumMax - lumMin) / 255;
     const warm = r + g > b * 1.9;
     const cool = b > r * 1.05 && b > g;
     const bright = (r + g + b) / 3 > 165;
     const muted = (lumMax - lumMin) < 70;
     return { warm, cool, bright, muted, contrast, avgR: r, avgG: g, avgB: b };
   } catch {
     return {};
   }
 }


 function hintTerms(h) {
   const out = [];
   if (!h || !Object.keys(h).length) return out;
   if (h.warm) out.push("warm tones");
   if (h.cool) out.push("cool tones");
   if (h.bright) out.push("airy light");
   if (h.muted) out.push("muted palette");
   if (h.contrast > 0.55) out.push("high contrast");
   return out;
 }


 function pickThree(pool, hints, avoid) {
   const set = new Set(avoid || []);
   const scored = [];
   for (const p of pool) {
     if (set.has(p)) continue;
     let score = Math.random();
     if (hints.some((h) => p.includes(h.split(" ")[0]) || h.includes(p))) score += 2;
     scored.push([p, score]);
   }
   scored.sort((a, b) => b[1] - a[1]);
   const res = [];
   for (const [p] of scored) {
     res.push(p);
     if (res.length === 3) break;
   }
   while (res.length < 3 && pool.length) {
     const c = pool[res.length % pool.length];
     if (!res.includes(c)) res.push(c);
     else break;
   }
   return res;
 }


 function mapTier1ToKey(label) {
   const l = label.toLowerCase();
   for (const k of Object.keys(TIER2_BY_CATEGORY)) {
     if (l.includes(k)) return k;
   }
   if (l.includes("color") || l.includes("tone") || l.includes("palette")) return "color";
   return "mood";
 }


 function tier2Suggestions(parentLabel) {
   const key = mapTier1ToKey(parentLabel);
   const pool = TIER2_BY_CATEGORY[key] || TIER2_BY_CATEGORY.mood;
   const hints = hintTerms(taggingState.imageHints);
   const avoid = new Set(taggingState.tier1);
   return pickThree(pool.concat(hints), hints, [...avoid]);
 }


 function renderChips(container, items, selected, onSelect) {
   container.replaceChildren();
   items.forEach((label) => {
     const b = document.createElement("button");
     b.type = "button";
     b.className = "chip" + chipCategoryClass(label) + (selected === label ? " is-on" : "");
     b.textContent = label;
     b.addEventListener("click", () => onSelect(label));
     container.appendChild(b);
   });
 }


 function openTagging({ src, editingPin, objectUrl } = {}) {
   if (!editingPin) {
     focusedPinId = null;
     activeFolderId = null;
     updateFolderContextStrip();
     focusPanel.hidden = true;
     viewport.classList.remove("has-focus");
     document.body.classList.remove("has-pin-focus");
   }
   const t1c = el("tier1-custom");
   const t2c = el("tier2-custom");
   t1c.value = "";
   t2c.value = "";
   t1c.hidden = true;
   t2c.hidden = true;
   tagging.hidden = false;
   notesInput.value = "";
   taggingState = {
     objectUrl: editingPin ? null : objectUrl || null,
     tier1: [],
     tier2: [],
     tier1Pick: null,
     tier2Pick: null,
     manualTags: new Set(),
     notes: "",
     imageHints: {},
     editingId: editingPin ? editingPin.id : null,
   };
   tier2Block.hidden = true;
   const onPreviewReady = () => {
     taggingSyncFromImage(editingPin);
   };
   taggingPreview.onload = onPreviewReady;
   if (editingPin) {
     taggingPreview.src = editingPin.src;
   } else if (src) {
     taggingPreview.src = src;
   }
   if (taggingPreview.complete && taggingPreview.naturalWidth) {
     onPreviewReady();
   }
 }


 function taggingSyncFromImage(editingPin) {
   taggingState.imageHints = analyzeImageEl(taggingPreview);
   const hints = hintTerms(taggingState.imageHints);
   const merged = [...new Set([...TIER1_POOL, ...hints])];
   taggingState.tier1 = pickThree(merged, hints, []);
   taggingState.tier1Pick = null;
   taggingState.tier2Pick = null;
   tier2Block.hidden = true;
   if (editingPin) {
     const t0 = editingPin.tags[0];
     const t1 = editingPin.tags[1];
     if (t0 && !taggingState.tier1.includes(t0)) {
       taggingState.tier1.unshift(t0);
       taggingState.tier1 = taggingState.tier1.slice(0, 5);
     }
     taggingState.tier1Pick = t0 || taggingState.tier1[0];
     taggingState.tier2Pick = t1 || null;
     notesInput.value = editingPin.notes || "";
     if (taggingState.tier1Pick) {
       taggingState.tier2 = tier2Suggestions(taggingState.tier1Pick);
       if (t1 && !taggingState.tier2.includes(t1) && !taggingState.tier1.includes(t1)) {
         taggingState.tier2.unshift(t1);
         taggingState.tier2 = taggingState.tier2.slice(0, 6);
       }
       tier2Title.textContent = headingForParent(taggingState.tier1Pick);
       tier2Block.hidden = false;
       renderChips(tier2Chips, taggingState.tier2, taggingState.tier2Pick, onTier2);
     }
   }
   renderChips(tier1Chips, taggingState.tier1, taggingState.tier1Pick, onTier1);
   if (!editingPin && taggingState.tier1.length && !taggingState.tier1Pick) {
     onTier1(taggingState.tier1[0]);
   }
 }


 function headingForParent(label) {
   const l = label.toLowerCase();
   if (l.includes("color") || l === "color" || mapTier1ToKey(label) === "color") return "What about the colors?";
   if (mapTier1ToKey(label) === "form") return "What about the form?";
   if (mapTier1ToKey(label) === "typography") return "What about the type?";
   return `What about the ${label}?`;
 }


 function onTier1(label) {
   taggingState.tier1Pick = label;
   renderChips(tier1Chips, taggingState.tier1, taggingState.tier1Pick, onTier1);
   taggingState.tier2 = tier2Suggestions(label);
   taggingState.tier2Pick = taggingState.tier2[0] || null;
   tier2Title.textContent = headingForParent(label);
   tier2Block.hidden = false;
   renderChips(tier2Chips, taggingState.tier2, taggingState.tier2Pick, onTier2);
 }


 function onTier2(label) {
   taggingState.tier2Pick = label;
   renderChips(tier2Chips, taggingState.tier2, taggingState.tier2Pick, onTier2);
 }


 function refreshTier1() {
   const avoid = new Set(taggingState.tier1);
   const hints = hintTerms(taggingState.imageHints);
   const merged = [...new Set([...TIER1_POOL, ...hints])];
   taggingState.tier1 = pickThree(merged, hints, [...avoid]);
   taggingState.tier1Pick = taggingState.tier1[0] || null;
   renderChips(tier1Chips, taggingState.tier1, taggingState.tier1Pick, onTier1);
   if (taggingState.tier1Pick) onTier1(taggingState.tier1Pick);
   else {
     tier2Block.hidden = true;
   }
 }


 function refreshTier2() {
   if (!taggingState.tier1Pick) return;
   const avoid = new Set([...taggingState.tier2, ...taggingState.tier1]);
   const key = mapTier1ToKey(taggingState.tier1Pick);
   const pool = TIER2_BY_CATEGORY[key] || TIER2_BY_CATEGORY.mood;
   const hints = hintTerms(taggingState.imageHints);
   taggingState.tier2 = pickThree([...pool, ...hints], hints, [...avoid]);
   taggingState.tier2Pick = taggingState.tier2[0] || null;
   renderChips(tier2Chips, taggingState.tier2, taggingState.tier2Pick, onTier2);
 }


 function closeTagging() {
   tagging.hidden = true;
   if (taggingState.objectUrl) {
     URL.revokeObjectURL(taggingState.objectUrl);
     taggingState.objectUrl = null;
   }
   taggingPreview.removeAttribute("src");
 }


 function collectTagsFromTagging() {
   const tags = [];
   if (taggingState.tier1Pick) tags.push(taggingState.tier1Pick);
   if (taggingState.tier2Pick) tags.push(taggingState.tier2Pick);
   for (const t of taggingState.manualTags || []) {
     if (!tags.includes(t)) tags.push(t);
   }
   return tags;
 }


 function snapshotPreviewDataUrl() {
   const img = taggingPreview;
   if (!img.naturalWidth) return taggingPreview.src;
   const c = document.createElement("canvas");
   const maxSide = 1600;
   let w = img.naturalWidth;
   let h = img.naturalHeight;
   if (w > maxSide || h > maxSide) {
     const s = maxSide / Math.max(w, h);
     w = Math.round(w * s);
     h = Math.round(h * s);
   }
   c.width = w;
   c.height = h;
   const ctx = c.getContext("2d");
   ctx.drawImage(img, 0, 0, w, h);
   try {
     return c.toDataURL("image/jpeg", 0.88);
   } catch {
     return taggingPreview.src;
   }
 }


 function ensureImageLoaded(img) {
   if (img.complete && img.naturalWidth) return Promise.resolve();
   return new Promise((resolve, reject) => {
     const onLoad = () => {
       cleanup();
       resolve();
     };
     const onError = () => {
       cleanup();
       reject(new Error("Image failed to load"));
     };
     const cleanup = () => {
       img.removeEventListener("load", onLoad);
       img.removeEventListener("error", onError);
     };
     img.addEventListener("load", onLoad);
     img.addEventListener("error", onError);
   });
 }


 async function saveTagging() {
   let src = taggingPreview.src;
   if (!src) return;
   const tags = collectTagsFromTagging();
   const notes = notesInput.value.trim();


   if (!taggingState.editingId && taggingState.objectUrl) {
     await ensureImageLoaded(taggingPreview);
     src = snapshotPreviewDataUrl();
   }


   if (taggingState.editingId) {
     const pin = pins.find((p) => p.id === taggingState.editingId);
     if (pin) {
       pin.tags = tags;
       pin.notes = notes;
       if (taggingState.objectUrl) {
         await ensureImageLoaded(taggingPreview);
         pin.src = snapshotPreviewDataUrl();
       } else pin.src = src;
       if (taggingState.objectUrl && taggingPreview.naturalWidth) {
         const sz = pinDisplaySizeFromNatural(taggingPreview.naturalWidth, taggingPreview.naturalHeight);
         if (sz) {
           pin.w = sz.w;
           pin.h = sz.h;
         }
       }
       pin.savedAt = Date.now();
       persistPins();
       renderPins();
     }
     closeTagging();
     return;
   }


   const id = uid();
   const pos = cloudPositionForIndex(pins.length, id);
   let w = 200;
   let h = 160;
   const imgEl = taggingPreview;
   const initSz = pinDisplaySizeFromNatural(imgEl.naturalWidth, imgEl.naturalHeight);
   if (initSz) {
     w = initSz.w;
     h = initSz.h;
   }
   pins.push({
     id,
     src,
     tags,
     notes,
     x: pos.x,
     y: pos.y,
     w,
     h,
     depth: (hashStr(id) % 100) / 100 * 0.72 + 0.14,
     savedAt: Date.now(),
     folderIds: [],
   });
   persistPins();
   renderPins();
   closeTagging();
   focusedPinId = null;
   searchInput.value = "";
   searchQuery = "";
   applyPinLayout();
 }


 function scorePin(pin, q) {
   if (!q) return 0;
   const hay = [...pin.tags, pin.notes || ""].join(" ").toLowerCase();
   const parts = q
     .toLowerCase()
     .split(/\s+/)
     .filter(Boolean);
   let s = 0;
   for (const p of parts) {
     if (hay.includes(p)) s += 3;
     pin.tags.forEach((t) => {
       if (t.includes(p) || p.includes(t)) s += 2;
     });
   }
   return s;
 }


 function clearFocus() {
   focusedPinId = null;
   applyPinLayout();
 }


 function deleteSelectedPins() {
   if (!selectedIds.size) return;
   // When inside a folder, ask the user what they want to do
   if (activeFolderId) {
     openDeleteChoiceModal();
     return;
   }
   executePermanentDelete(new Set(selectedIds));
 }


 function openDeleteChoiceModal() {
   const count = selectedIds.size;
   const hint = el("delete-choice-hint");
   hint.textContent = count === 1
     ? "What would you like to do with this pin?"
     : `What would you like to do with these ${count} pins?`;
   el("delete-choice-modal").hidden = false;
 }


 function closeDeleteChoiceModal() {
   el("delete-choice-modal").hidden = true;
 }


 function executeRemoveFromFolder(toRemove) {
   const folder = folders.find((f) => f.id === activeFolderId);
   if (folder) {
     folder.pinIds = folder.pinIds.filter((id) => !toRemove.has(id));
     persistFolders();
   }
   selectedIds.clear();
   renderPins();
   updateSelectBar();
 }


 function executePermanentDelete(toDelete) {
   const removeNodes = Array.from(pinsLayer.querySelectorAll('.pin')).filter((node) =>
     toDelete.has(node.dataset.id),
   );
   if (removeNodes.length) {
     removeNodes.forEach((node) => node.classList.add('is-removing'));
     btnDeleteSelected.disabled = true;
     setTimeout(() => {
       pins = pins.filter((pin) => !toDelete.has(pin.id));
       folders.forEach((folder) => {
         folder.pinIds = folder.pinIds.filter((id) => !toDelete.has(id));
       });
       selectedIds.clear();
       persistPins();
       persistFolders();
       renderPins();
       updateSelectBar();
       btnDeleteSelected.disabled = false;
     }, 300);
     return;
   }
   pins = pins.filter((pin) => !toDelete.has(pin.id));
   folders.forEach((folder) => {
     folder.pinIds = folder.pinIds.filter((id) => !toDelete.has(id));
   });
   selectedIds.clear();
   persistPins();
   persistFolders();
   renderPins();
   updateSelectBar();
 }


 function setFocus(pinId) {
   focusedPinId = pinId;
   searchQuery = "";
   searchInput.value = "";
   camera = { x: 0, y: 0, z: 1.05 };
   camTarget = { ...camera };
   applyWorldTransform();
   applyPinParallax();
   persistCamera();
   applyPinLayout();
 }


 function updateFocusPanel() {
   if (!focusedPinId) {
     focusPanel.hidden = true;
     return;
   }
   const pin = pins.find((p) => p.id === focusedPinId);
   if (!pin) {
     focusedPinId = null;
     focusPanel.hidden = true;
     applyPinLayout();
     return;
   }
   focusPanel.hidden = false;
   focusTagGroups.replaceChildren();
   const buckets = { visual: [], structure: [], atmosphere: [] };
   const seen = { visual: new Set(), structure: new Set(), atmosphere: new Set() };
   pin.tags.forEach((t) => {
     const k = tagBucketKey(t);
     if (!seen[k].has(t)) {
       seen[k].add(t);
       buckets[k].push(t);
     }
   });
   const sections = [
     { key: "visual", title: "color & light", cls: "focus-panel__tag--visual" },
     { key: "structure", title: "type & form", cls: "focus-panel__tag--structure" },
     { key: "atmosphere", title: "texture & mood", cls: "focus-panel__tag--atmosphere" },
   ];
   sections.forEach(({ key, title, cls }) => {
     if (!buckets[key].length) return;
     const wrap = document.createElement("div");
     wrap.className = "focus-group";
     const h = document.createElement("p");
     h.className = "focus-group__title";
     h.textContent = title;
     const row = document.createElement("div");
     row.className = "focus-group__tags";
     buckets[key].forEach((t) => {
       const span = document.createElement("span");
       span.className = "focus-panel__tag " + cls;
       span.textContent = t;
       row.appendChild(span);
     });
     wrap.appendChild(h);
     wrap.appendChild(row);
     focusTagGroups.appendChild(wrap);
   });
   const notes = (pin.notes || "").trim();
   if (notes) {
     focusNotesBlock.hidden = false;
     focusNotes.textContent = notes;
   } else {
     focusNotesBlock.hidden = true;
   }
 }


 function applyCloudLayout() {
   const list = pinsForView();
   list.forEach((pin, i) => {
     const node = pinsLayer.querySelector(`[data-id="${pin.id}"]`);
     if (!node) return;
     const { x, y } = getPinBaseXY(pin, i);
     node.style.left = `${x - pin.w / 2}px`;
     node.style.top = `${y - pin.h / 2}px`;
     node.style.width = `${pin.w}px`;
     node.style.height = `${pin.h}px`;
     node.style.opacity = "";
     node.style.zIndex = String(10 + (hashStr(pin.id) % 40));
     node.classList.remove("pin--ghost", "pin--focused");
   });
   applyPinParallax();
 }


 function applyFocusLayout(focusId) {
   const list = pinsForView();
   const hero = list.find((p) => p.id === focusId);
   if (!hero) {
     clearFocus();
     return;
   }
   const ring = list.filter((p) => p.id !== focusId);
   const cx = 0;
   const cy = -48;
   const scale = 2.85;
   const w = hero.w * scale;
   const h = hero.h * scale;
   const heroNode = pinsLayer.querySelector(`[data-id="${hero.id}"]`);
   if (heroNode) {
     heroNode.style.left = `${cx - w / 2}px`;
     heroNode.style.top = `${cy - h / 2}px`;
     heroNode.style.width = `${w}px`;
     heroNode.style.height = `${h}px`;
     heroNode.style.opacity = "1";
     heroNode.style.zIndex = "95";
     heroNode.classList.add("pin--focused");
     heroNode.classList.remove("pin--ghost");
   }
   const outerR = 520 + ring.length * 3;
   ring.forEach((pin, i) => {
     const node = pinsLayer.querySelector(`[data-id="${pin.id}"]`);
     if (!node) return;
     node.classList.remove("pin--focused");
     const golden = Math.PI * (3 - Math.sqrt(5));
     const r = outerR + (i % 7) * 28;
     const theta = i * golden * 1.08 + 0.5;
     const x = r * Math.cos(theta) * 1.15;
     const y = r * Math.sin(theta) * 1.04;
     const s = 0.26;
     const ww = pin.w * s;
     const hh = pin.h * s;
     node.style.left = `${x - ww / 2}px`;
     node.style.top = `${y - hh / 2}px`;
     node.style.width = `${ww}px`;
     node.style.height = `${hh}px`;
     node.style.opacity = "0.26";
     node.style.zIndex = String(4 + (hashStr(pin.id) % 8));
     node.classList.add("pin--ghost");
   });
   applyPinParallax();
 }


 function applySearchLayout() {
   const q = searchQuery.trim();
   if (!q) {
     applyCloudLayout();
     return;
   }


   const list = pinsForView();
   const scored = list
     .map((p) => ({ p, s: scorePin(p, q) }))
     .sort((a, b) => b.s - a.s);
   const matches = scored.filter((x) => x.s > 0).map((x) => x.p);
   const others = scored.filter((x) => x.s <= 0).map((x) => x.p);


   if (matches.length === 0) {
     list.forEach((pin, i) => {
       const node = pinsLayer.querySelector(`[data-id="${pin.id}"]`);
       if (!node) return;
       const { x, y } = getPinBaseXY(pin, i);
       node.style.left = `${x - pin.w / 2}px`;
       node.style.top = `${y - pin.h / 2}px`;
       node.style.width = `${pin.w}px`;
       node.style.height = `${pin.h}px`;
       node.style.opacity = "0.2";
       node.style.zIndex = String(10 + (hashStr(pin.id) % 40));
       node.classList.add("pin--ghost");
     });
     applyPinParallax();
     return;
   }


   const focusN = Math.max(1, Math.min(matches.length, 6));
   const focus = matches.slice(0, focusN);
   const ring = others.concat(matches.slice(focusN));


   const cx = 0;
   const cy = -20;
   const centerR = 140;


   focus.forEach((pin, i) => {
     const node = pinsLayer.querySelector(`[data-id="${pin.id}"]`);
     if (!node) return;
     const ang = (i / Math.max(focus.length, 1)) * Math.PI * 2 + 0.2;
     const rr = centerR * 0.35 + (i % 3) * 28;
     const x = cx + rr * Math.cos(ang);
     const y = cy + rr * Math.sin(ang);
     const scale = 1.35;
     const w = pin.w * scale;
     const h = pin.h * scale;
     node.style.left = `${x - w / 2}px`;
     node.style.top = `${y - h / 2}px`;
     node.style.width = `${w}px`;
     node.style.height = `${h}px`;
     node.style.opacity = "1";
     node.style.zIndex = "80";
     node.classList.remove("pin--ghost");
   });


   const outerR = 420;
   ring.forEach((pin, i) => {
     const node = pinsLayer.querySelector(`[data-id="${pin.id}"]`);
     if (!node) return;
     const golden = Math.PI * (3 - Math.sqrt(5));
     const r = outerR + (i % 5) * 18;
     const theta = i * golden;
     const x = r * Math.cos(theta) * 1.1;
     const y = r * Math.sin(theta) * 1.05;
     const scale = 0.38;
     const w = pin.w * scale;
     const h = pin.h * scale;
     node.style.left = `${x - w / 2}px`;
     node.style.top = `${y - h / 2}px`;
     node.style.width = `${w}px`;
     node.style.height = `${h}px`;
     node.style.opacity = ring.length ? "0.22" : "1";
     node.style.zIndex = "5";
     if (scorePin(pin, q) === 0 && q) node.classList.add("pin--ghost");
     else node.classList.remove("pin--ghost");
   });
   applyPinParallax();
 }


 function applyPinLayout() {
   if (focusedPinId) {
     viewport.classList.add("has-focus");
     document.body.classList.add("has-pin-focus");
     applyFocusLayout(focusedPinId);
     updateFocusPanel();
     return;
   }
   viewport.classList.remove("has-focus");
   document.body.classList.remove("has-pin-focus");
   focusPanel.hidden = true;
   const q = searchQuery.trim();
   if (q) applySearchLayout();
   else applyCloudLayout();
 }


 /* ── Pin drag-to-reposition ──────────────────────────────── */
 let pinDrag = null;
 let lastPinDragMoved = false; // persists through the click event that fires after pointerup

 function onPinPointerDown(e, pin, div) {
   if (e.button !== 0) return;
   if (selectMode) return;
   if (activeFolderId) return; // folder view uses auto layout
   e.stopPropagation();
   div.setPointerCapture(e.pointerId);
   lastPinDragMoved = false;
   pinDrag = {
     pin, node: div,
     pointerId: e.pointerId,
     x0: e.clientX, y0: e.clientY,
     pinX0: pin.x, pinY0: pin.y,
     didMove: false,
   };
 }

 function onPinPointerMove(e) {
   if (!pinDrag || e.pointerId !== pinDrag.pointerId) return;
   const dx = e.clientX - pinDrag.x0;
   const dy = e.clientY - pinDrag.y0;
   if (!pinDrag.didMove && dx * dx + dy * dy < 36) return; // 6px threshold
   pinDrag.didMove = true;
   lastPinDragMoved = true;
   pinDrag.node.classList.add("pin--dragging");
   pinDrag.pin.x = pinDrag.pinX0 + dx / camera.z;
   pinDrag.pin.y = pinDrag.pinY0 + dy / camera.z;
   pinDrag.node.style.left = `${pinDrag.pin.x - pinDrag.pin.w / 2}px`;
   pinDrag.node.style.top  = `${pinDrag.pin.y - pinDrag.pin.h / 2}px`;
   pinDrag.node.style.zIndex = "200";
 }

 function onPinPointerUp(e, div) {
   if (!pinDrag || e.pointerId !== pinDrag.pointerId) return;
   div.classList.remove("pin--dragging");
   div.style.zIndex = "";
   if (pinDrag.didMove) {
     persistPins();
     applyPinLayout();
   }
   pinDrag = null;
   // Reset lastPinDragMoved after the click event has had a chance to fire
   setTimeout(() => { lastPinDragMoved = false; }, 0);
 }

 function renderPins() {
   pinsLayer.replaceChildren();
   const list = pinsForView();
   list.forEach((pin) => {
     const div = document.createElement("div");
     div.className = "pin";
     div.dataset.id = pin.id;
     if (selectedIds.has(pin.id)) div.classList.add("is-selected");
     const img = document.createElement("img");
     img.src = pin.src;
     img.alt = pin.tags.join(", ");
     img.addEventListener("load", () => {
       const sz = pinDisplaySizeFromNatural(img.naturalWidth, img.naturalHeight);
       if (!sz || (pin.w === sz.w && pin.h === sz.h)) return;
       pin.w = sz.w;
       pin.h = sz.h;
       persistPins();
       applyPinLayout();
     });
     img.addEventListener("error", () => {
       console.warn("Pin image failed to load:", pin.id, pin.src);
       div.classList.add("pin--broken");
     });
     const sel = document.createElement("div");
     sel.className = "pin__select";
     const bubble = document.createElement("button");
     bubble.type = "button";
     bubble.className = "pin__bubble";
     bubble.tabIndex = selectMode ? 0 : -1;
     bubble.addEventListener("click", (e) => {
       e.stopPropagation();
       if (!selectMode) return;
       if (selectedIds.has(pin.id)) selectedIds.delete(pin.id);
       else selectedIds.add(pin.id);
       div.classList.toggle("is-selected", selectedIds.has(pin.id));
       updateSelectBar();
     });
     sel.appendChild(bubble);
     div.appendChild(img);
     div.appendChild(sel);

     div.addEventListener("pointerdown", (e) => onPinPointerDown(e, pin, div));
     div.addEventListener("pointermove", (e) => onPinPointerMove(e));
     div.addEventListener("pointerup",   (e) => onPinPointerUp(e, div));
     div.addEventListener("pointercancel", () => {
       div.classList.remove("pin--dragging");
       div.style.zIndex = "";
       pinDrag = null;
     });

     div.addEventListener("click", (e) => {
       if (selectMode) return;
       if (lastPinDragMoved) return; // was a drag, swallow the click
       e.stopPropagation();
       setFocus(pin.id);
     });

     div.addEventListener("dblclick", (e) => {
       e.stopPropagation();
       openTagging({ editingPin: pin });
     });

     pinsLayer.appendChild(div);
   });
   applyPinLayout();
   updateFolderContextStrip();
 }


 function updateSelectBar() {
   const bar = el("select-bar");
   const count = el("select-count");
   if (!selectMode) {
     bar.hidden = true;
     return;
   }
   bar.hidden = false;
   count.textContent = `${selectedIds.size} selected`;
   el("btn-save-folder").disabled = selectedIds.size === 0;
   btnDeleteSelected.disabled = selectedIds.size === 0;
 }


 function setSelectMode(on) {
   selectMode = on;
   if (on) {
     focusedPinId = null;
     focusPanel.hidden = true;
     viewport.classList.remove("has-focus");
     document.body.classList.remove("has-pin-focus");
   }
   document.body.classList.toggle("select-mode", on);
   el("btn-select").textContent = on ? "Done" : "Select";
   if (!on) {
     selectedIds.clear();
     pinsLayer.querySelectorAll(".pin.is-selected").forEach((n) => n.classList.remove("is-selected"));
   }
   updateSelectBar();
   applyPinLayout();
 }


 function populateFolderSelect() {
   const sel = el("folder-select");
   sel.replaceChildren();
   const opt0 = document.createElement("option");
   opt0.value = "";
   opt0.textContent = folders.length ? "Pick a folder…" : "No folders yet";
   sel.appendChild(opt0);
   folders.forEach((f) => {
     const o = document.createElement("option");
     o.value = f.id;
     o.textContent = f.name;
     sel.appendChild(o);
   });
 }


 function openFolderModal() {
   populateFolderSelect();
   el("folder-new").value = "";
   el("folder-modal").hidden = false;
 }


 function closeFolderModal() {
   el("folder-modal").hidden = true;
 }


 function confirmFolder() {
   const selId = el("folder-select").value;
   let nameNew = el("folder-new").value.trim();
   let folderId = selId;
   if (nameNew) {
     const id = uid();
     const folder = {
       id,
       name: nameNew,
       pinIds: [],
       color: folderColorFor(nameNew, id),
       updatedAt: Date.now(),
     };
     folders.push(folder);
     folderId = folder.id;
     persistFolders();
   }
   const f = folders.find((x) => x.id === folderId);
   if (!f) {
     closeFolderModal();
     return;
   }
   f.updatedAt = Date.now();
   selectedIds.forEach((id) => {
     if (!f.pinIds.includes(id)) f.pinIds.push(id);
     const pin = pins.find((p) => p.id === id);
     if (pin && !pin.folderIds.includes(f.id)) pin.folderIds.push(f.id);
   });
   persistFolders();
   persistPins();
   closeFolderModal();
   setSelectMode(false);
   if (!foldersScreen.hidden) renderFoldersCanvas();
 }


 function updateFolderContextStrip() {
   const strip = el("folder-context");
   if (!activeFolderId) {
     strip.hidden = true;
     return;
   }
   const f = folders.find((x) => x.id === activeFolderId);
   if (!f) {
     activeFolderId = null;
     strip.hidden = true;
     return;
   }
   strip.hidden = false;
   el("folder-context-label").textContent = f.name;
   el("folder-context-swatch").style.background = f.color || folderColorFor(f.name, f.id);
 }


 const FOLDER_CARD_W = 280;
 const FOLDER_VISUAL_H = (FOLDER_CARD_W * 4) / 3;
 const FOLDER_CELL_H = FOLDER_VISUAL_H + 12 + 40;
 const FOLDER_GAP_X = 44;
 const FOLDER_GAP_Y = 52;


 function folderGridColumnCount(n) {
   if (n <= 0) return 1;
   const minColW = FOLDER_CARD_W + FOLDER_GAP_X;
   const maxCols = Math.max(1, Math.floor((window.innerWidth - 48) / minColW));
   const sqrtCols = Math.ceil(Math.sqrt(n));
   return Math.max(1, Math.min(n, sqrtCols, maxCols));
 }


 /** Top-left of each card; grid centered on the folders-world origin (viewport center). */
 function folderCardGridTopLeft(i, n) {
   const cols = folderGridColumnCount(n);
   const rows = Math.ceil(n / cols);
   const col = i % cols;
   const row = Math.floor(i / cols);
   const gridW = cols * FOLDER_CARD_W + (cols - 1) * FOLDER_GAP_X;
   const gridH = rows * FOLDER_CELL_H + (rows - 1) * FOLDER_GAP_Y;
   const startX = -gridW / 2;
   const startY = -gridH / 2;
   return {
     left: startX + col * (FOLDER_CARD_W + FOLDER_GAP_X),
     top: startY + row * (FOLDER_CELL_H + FOLDER_GAP_Y),
   };
 }


 function applyFoldersTransform() {
   foldersWorld.style.transform = `translate(${foldersCamera.x}px, ${foldersCamera.y}px)`;
 }


 function buildFolderCard(folder) {
   const btn = document.createElement("button");
   btn.type = "button";
   btn.className = "folder-card";
   btn.dataset.folderId = folder.id;
   const col = folder.color || folderColorFor(folder.name, folder.id);
   btn.style.setProperty("--folder-accent-label", col);

   const visual = document.createElement("div");
   visual.className = "folder-card__visual";

   // Collect up to 4 most recent pin srcs (pinIds are stored oldest-first, reverse for recency)
   const recentPinIds = [...(folder.pinIds || [])].reverse().slice(0, 4);
   const coverSrcs = recentPinIds
     .map((pid) => pins.find((x) => x.id === pid))
     .filter(Boolean)
     .map((p) => p.src);

   if (coverSrcs.length >= 2) {
     // 2x2 grid
     const grid = document.createElement("div");
     grid.className = "folder-card__grid";
     for (let i = 0; i < 4; i++) {
       const cell = document.createElement("div");
       cell.className = "folder-card__grid-cell";
       if (coverSrcs[i]) {
         const img = document.createElement("img");
         img.className = "folder-card__grid-img";
         img.src = coverSrcs[i];
         img.alt = "";
         cell.appendChild(img);
       } else {
         cell.style.background = `${col}33`;
       }
       grid.appendChild(cell);
     }
     visual.appendChild(grid);
   } else if (coverSrcs.length === 1) {
     const img = document.createElement("img");
     img.className = "folder-card__img";
     img.src = coverSrcs[0];
     img.alt = "";
     visual.appendChild(img);
   } else {
     const ph = document.createElement("div");
     ph.className = "folder-card__placeholder";
     ph.style.background = `linear-gradient(145deg, ${col}33, ${col}aa)`;
     visual.appendChild(ph);
   }

   const glass = document.createElement("div");
   glass.className = "folder-card__glass";
   visual.appendChild(glass);

   const meta = document.createElement("div");
   meta.className = "folder-card__meta";

   const sw = document.createElement("span");
   sw.className = "folder-card__swatch";
   sw.style.background = col;

   const nameEl = document.createElement("span");
   nameEl.className = "folder-card__name";
   nameEl.textContent = (folder.name || "untitled").toLowerCase();

   const time = document.createElement("time");
   time.className = "folder-card__time";
   time.textContent = formatTimeAgo(folder.updatedAt);
   time.dateTime = new Date(folder.updatedAt || Date.now()).toISOString();

   meta.appendChild(sw);
   meta.appendChild(nameEl);
   meta.appendChild(time);

   btn.appendChild(visual);
   btn.appendChild(meta);

   btn.addEventListener("click", () => openFolderFromLibrary(folder.id));
   return btn;
 }


 function renderFoldersCanvas() {
   foldersCanvas.replaceChildren();
   if (!folders.length) {
     const empty = document.createElement("p");
     empty.className = "folders-empty";
     empty.textContent = "No folders yet — Select pins, then Save to folder…";
     empty.style.position = "absolute";
     empty.style.left = "-140px";
     empty.style.top = "-24px";
     empty.style.width = "280px";
     foldersCanvas.appendChild(empty);
     return;
   }
   const sorted = [...folders].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
   const n = sorted.length;
   sorted.forEach((folder, i) => {
     const card = buildFolderCard(folder);
     const pos = folderCardGridTopLeft(i, n);
     card.style.left = `${pos.left}px`;
     card.style.top = `${pos.top}px`;
     foldersCanvas.appendChild(card);
   });
 }


 function openFoldersLibrary() {
   focusedPinId = null;
   focusPanel.hidden = true;
   viewport.classList.remove("has-focus");
   document.body.classList.remove("has-pin-focus");
   selectedIds.clear();
   selectMode = false;
   document.body.classList.remove("select-mode");
   el("btn-select").textContent = "Select";
   updateSelectBar();
   foldersCamera = { x: 0, y: 0 };
   applyFoldersTransform();
   foldersScreen.hidden = false;
   renderFoldersCanvas();
 }


 function closeFoldersLibrary() {
   foldersScreen.hidden = true;
   foldersPan = null;
   foldersViewport.classList.remove("is-dragging");
 }


 function toggleFoldersScreen() {
   if (foldersScreen.hidden) openFoldersLibrary();
   else closeFoldersLibrary();
 }


 function openFolderFromLibrary(folderId) {
   activeFolderId = folderId;
   focusedPinId = null;
   searchQuery = "";
   searchInput.value = "";
   camera = { x: 0, y: 0, z: 0.92 };
   camTarget = { ...camera };
   applyWorldTransform();
   applyPinParallax();
   persistCamera();
   closeFoldersLibrary();
   updateFolderContextStrip();
   renderPins();
 }


 /* Camera */
 function onWheel(e) {
   if (!foldersScreen.hidden) return;
   e.preventDefault();
   const delta = -e.deltaY * 0.0038;
   const nz = Math.min(9, Math.max(0.06, camTarget.z + delta));
   const rect = viewport.getBoundingClientRect();
   const mx = e.clientX - rect.left - rect.width / 2;
   const my = e.clientY - rect.top - rect.height / 2;
   const worldX = (mx - camTarget.x) / camTarget.z;
   const worldY = (my - camTarget.y) / camTarget.z;
   camTarget.x = mx - worldX * nz;
   camTarget.y = my - worldY * nz;
   camTarget.z = nz;
   bumpCameraAnim();
 }


 function onFoldersPointerDown(e) {
   if (foldersScreen.hidden) return;
   if (e.target.closest(".folder-card")) return;
   if (e.button !== 0) return;
   foldersPan = {
     x: e.clientX,
     y: e.clientY,
     cx: foldersCamera.x,
     cy: foldersCamera.y,
     pid: e.pointerId,
   };
   foldersViewport.classList.add("is-dragging");
   foldersViewport.setPointerCapture(e.pointerId);
 }


 function onFoldersPointerMove(e) {
   if (!foldersPan || e.pointerId !== foldersPan.pid) return;
   foldersCamera.x = foldersPan.cx + (e.clientX - foldersPan.x);
   foldersCamera.y = foldersPan.cy + (e.clientY - foldersPan.y);
   applyFoldersTransform();
 }


 function onFoldersPointerUp(e) {
   if (!foldersPan || e.pointerId !== foldersPan.pid) return;
   try {
     foldersViewport.releasePointerCapture(e.pointerId);
   } catch (_) {}
   foldersPan = null;
   foldersViewport.classList.remove("is-dragging");
 }


 function onPointerDown(e) {
   if (!foldersScreen.hidden) return;
   if (
     e.target.closest(".dock") ||
     e.target.closest(".folder-corner-btn") ||
     e.target.closest(".select-bar") ||
     e.target.closest(".focus-panel") ||
     e.target.closest(".folder-context")
   )
     return;
   if (e.button !== 0) return;
   if (e.target.closest(".pin")) return;
   viewport.setPointerCapture(e.pointerId);
   if (focusedPinId) {
     panning = {
       kind: "maybe",
       x0: e.clientX,
       y0: e.clientY,
       pointerId: e.pointerId,
     };
   } else {
     panning = {
       kind: "pan",
       x: e.clientX,
       y: e.clientY,
       cx: camera.x,
       cy: camera.y,
       pointerId: e.pointerId,
     };
   }
   viewport.classList.add("is-dragging");
 }


 function onPointerMove(e) {
   if (!panning || e.pointerId !== panning.pointerId) return;
   if (panning.kind === "maybe") {
     const dx = e.clientX - panning.x0;
     const dy = e.clientY - panning.y0;
     if (dx * dx + dy * dy > 25) {
       panning = {
         kind: "pan",
         x: e.clientX,
         y: e.clientY,
         cx: camera.x,
         cy: camera.y,
         pointerId: panning.pointerId,
       };
     }
     return;
   }
   camera.x = panning.cx + (e.clientX - panning.x);
   camera.y = panning.cy + (e.clientY - panning.y);
   camTarget.x = camera.x;
   camTarget.y = camera.y;
   applyWorldTransform();
   applyPinParallax();
 }


 function onPointerUp(e) {
   if (!panning || e.pointerId !== panning.pointerId) return;
   if (panning.kind === "maybe") {
     const dx = e.clientX - panning.x0;
     const dy = e.clientY - panning.y0;
     if (dx * dx + dy * dy <= 25) clearFocus();
   }
   try {
     viewport.releasePointerCapture(e.pointerId);
   } catch (_) {}
   panning = null;
   viewport.classList.remove("is-dragging");
   persistCamera();
 }


 /* init */
 load();
 camTarget = { ...camera };
 applyWorldTransform();
 applyPinParallax();
 renderPins();
 updateSelectBar();


 let searchTimer = null;
 searchInput.addEventListener("input", () => {
   clearTimeout(searchTimer);
   searchTimer = setTimeout(() => {
     searchQuery = searchInput.value;
     focusedPinId = null;
     applyPinLayout();
   }, 160);
 });


 el("focus-close").addEventListener("click", () => clearFocus());


 document.addEventListener("keydown", (e) => {
   if (e.key !== "Escape") return;
   if (!foldersScreen.hidden) {
     closeFoldersLibrary();
     return;
   }
   if (!tagging.hidden) return;
   if (focusedPinId) clearFocus();
 });


 foldersViewport.addEventListener("pointerdown", onFoldersPointerDown);
 foldersViewport.addEventListener("pointermove", onFoldersPointerMove);
 foldersViewport.addEventListener("pointerup", onFoldersPointerUp);
 foldersViewport.addEventListener("pointercancel", onFoldersPointerUp);


 let foldersLayoutTimer = null;
 window.addEventListener("resize", () => {
   clearTimeout(foldersLayoutTimer);
   foldersLayoutTimer = setTimeout(() => {
     if (!foldersScreen.hidden) renderFoldersCanvas();
   }, 120);
 });


 el("btn-folder-library").addEventListener("click", () => toggleFoldersScreen());
 el("folder-context-clear").addEventListener("click", () => {
   activeFolderId = null;
   updateFolderContextStrip();
   renderPins();
 });


 /* ── Upload picker ─────────────────────────────────────── */
 const uploadPicker = el("upload-picker");
 const dropOverlay = el("drop-overlay");

 function openUploadPicker() { uploadPicker.hidden = false; }
 function closeUploadPicker() { uploadPicker.hidden = true; }

 el("btn-add").addEventListener("click", (e) => {
   e.stopPropagation();
   uploadPicker.hidden ? openUploadPicker() : closeUploadPicker();
 });

 el("upload-picker-computer").addEventListener("click", () => {
   closeUploadPicker();
   fileInput.click();
 });

 el("upload-picker-drop").addEventListener("click", () => {
   closeUploadPicker();
   dropOverlay.hidden = false;
   dropOverlay.classList.add("drop-overlay--waiting");
 });

 document.addEventListener("click", (e) => {
   if (!uploadPicker.hidden && !uploadPicker.contains(e.target) && e.target !== el("btn-add")) {
     closeUploadPicker();
   }
 });

 fileInput.addEventListener("change", () => {
   const f = fileInput.files && fileInput.files[0];
   fileInput.value = "";
   if (!f || !f.type.startsWith("image/")) return;
   const url = URL.createObjectURL(f);
   openTagging({ src: url, objectUrl: url });
 });

 /* ── Drag-and-drop upload ──────────────────────────────── */
 let dragCounter = 0;

 function hasDragImage(e) {
   return e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
 }

 document.addEventListener("dragenter", (e) => {
   if (!hasDragImage(e)) return;
   e.preventDefault();
   dragCounter++;
   if (dragCounter === 1) {
     dropOverlay.hidden = false;
     dropOverlay.classList.add("drop-overlay--waiting");
   }
 });

 document.addEventListener("dragleave", () => {
   dragCounter--;
   if (dragCounter <= 0) {
     dragCounter = 0;
     dropOverlay.hidden = true;
     dropOverlay.classList.remove("drop-overlay--waiting");
   }
 });

 document.addEventListener("dragover", (e) => {
   if (!hasDragImage(e)) return;
   e.preventDefault();
   e.dataTransfer.dropEffect = "copy";
 });

 document.addEventListener("drop", (e) => {
   e.preventDefault();
   dragCounter = 0;
   dropOverlay.hidden = true;
   dropOverlay.classList.remove("drop-overlay--waiting");
   const file = e.dataTransfer.files && e.dataTransfer.files[0];
   if (!file || !file.type.startsWith("image/")) return;
   const url = URL.createObjectURL(file);
   openTagging({ src: url, objectUrl: url });
 });

 dropOverlay.addEventListener("click", () => {
   dropOverlay.hidden = true;
   dropOverlay.classList.remove("drop-overlay--waiting");
 });


 el("tier1-refresh").addEventListener("click", refreshTier1);
 el("tier2-refresh").addEventListener("click", refreshTier2);
 el("tier1-add").addEventListener("click", () => {
   const inp = el("tier1-custom");
   inp.hidden = false;
   inp.focus();
 });
 el("tier2-add").addEventListener("click", () => {
   const inp = el("tier2-custom");
   inp.hidden = false;
   inp.focus();
 });
 el("tier1-custom").addEventListener("keydown", (e) => {
   if (e.key !== "Enter") return;
   const label = e.target.value.trim().toLowerCase();
   if (!label) return;
   e.target.value = "";
   e.target.hidden = true;
   taggingState.manualTags.add(label);
   if (!taggingState.tier1.includes(label)) taggingState.tier1.unshift(label);
   onTier1(label);
 });
 el("tier1-custom").addEventListener("blur", () => {
   const inp = el("tier1-custom");
   if (!inp.value.trim()) inp.hidden = true;
 });
 el("tier2-custom").addEventListener("keydown", (e) => {
   if (e.key !== "Enter") return;
   const label = e.target.value.trim().toLowerCase();
   if (!label) return;
   e.target.value = "";
   e.target.hidden = true;
   taggingState.manualTags.add(label);
   if (!taggingState.tier2.includes(label)) taggingState.tier2.unshift(label);
   onTier2(label);
 });
 el("tier2-custom").addEventListener("blur", () => {
   const inp = el("tier2-custom");
   if (!inp.value.trim()) inp.hidden = true;
 });
 el("tier2-close").addEventListener("click", () => {
   tier2Block.hidden = true;
   taggingState.tier2Pick = null;
 });


 notesToggle.addEventListener("click", () => {
   const collapsed = notesBody.hidden;
   notesBody.hidden = !collapsed;
   notesToggle.setAttribute("aria-expanded", String(!notesBody.hidden));
   notesToggle.closest(".tagging__notes").classList.toggle("is-collapsed", notesBody.hidden);
 });


 el("tagging-save").addEventListener("click", () => {
   saveTagging().catch((err) => {
     console.error(err);
   });
 });


 el("btn-select").addEventListener("click", () => setSelectMode(!selectMode));


 el("btn-tag").addEventListener("click", (e) => {
   e.stopPropagation();
   toggleTagBrowser();
 });


 el("btn-save-folder").addEventListener("click", () => {
   if (!selectedIds.size) return;
   openFolderModal();
 });
 btnDeleteSelected.addEventListener("click", deleteSelectedPins);
 el("btn-clear-select").addEventListener("click", () => {
   selectedIds.clear();
   pinsLayer.querySelectorAll(".pin.is-selected").forEach((n) => n.classList.remove("is-selected"));
   updateSelectBar();
 });
 el("folder-cancel").addEventListener("click", closeFolderModal);
 el("folder-confirm").addEventListener("click", confirmFolder);

 el("delete-choice-cancel").addEventListener("click", closeDeleteChoiceModal);
 el("delete-choice-remove").addEventListener("click", () => {
   const toRemove = new Set(selectedIds);
   closeDeleteChoiceModal();
   executeRemoveFromFolder(toRemove);
 });
 el("delete-choice-permanent").addEventListener("click", () => {
   const toDelete = new Set(selectedIds);
   closeDeleteChoiceModal();
   executePermanentDelete(toDelete);
 });


 viewport.addEventListener("wheel", onWheel, { passive: false });
 viewport.addEventListener("pointerdown", onPointerDown);
 viewport.addEventListener("pointermove", onPointerMove);
 viewport.addEventListener("pointerup", onPointerUp);
 viewport.addEventListener("pointercancel", onPointerUp);


 /* first paint chips */
 tier1Chips.replaceChildren();
 tier2Chips.replaceChildren();

 /* ── Cmd+\ toolbar hide/show ───────────────────────────── */
 let uiHidden = false;
 document.addEventListener("keydown", (e) => {
   if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
     e.preventDefault();
     uiHidden = !uiHidden;
     document.body.classList.toggle("ui-hidden", uiHidden);
   }
 });

 /* ── Tag browser ────────────────────────────────────────── */
 const tagBrowser = el("tag-browser");
 const tagBrowserSearch = el("tag-browser-search");
 const tagBrowserList = el("tag-browser-list");

 function getAllTags() {
   const freq = new Map();
   for (const pin of pins) {
     for (const t of (pin.tags || [])) {
       freq.set(t, (freq.get(t) || 0) + 1);
     }
   }
   // Sort by most recent pin that has this tag, then frequency
   const tagRecency = new Map();
   for (const pin of [...pins].sort((a,b) => (b.savedAt||0)-(a.savedAt||0))) {
     for (const t of (pin.tags||[])) {
       if (!tagRecency.has(t)) tagRecency.set(t, pin.savedAt||0);
     }
   }
   return [...freq.entries()]
     .sort((a, b) => (tagRecency.get(b[0])||0) - (tagRecency.get(a[0])||0))
     .map(([tag, count]) => ({ tag, count }));
 }

 function renderTagBrowserList(query) {
   const all = getAllTags();
   const q = (query || "").toLowerCase().trim();
   const filtered = q ? all.filter(({tag}) => tag.includes(q)) : all;
   tagBrowserList.replaceChildren();
   if (!filtered.length) {
     const empty = document.createElement("p");
     empty.className = "tag-browser__empty";
     empty.textContent = q ? "no tags match" : "no tags yet";
     tagBrowserList.appendChild(empty);
     return;
   }
   for (const {tag, count} of filtered) {
     const btn = document.createElement("button");
     btn.type = "button";
     btn.className = "tag-browser__tag" + chipCategoryClass(tag);
     const nameEl = document.createElement("span");
     nameEl.className = "tag-browser__tag-name";
     nameEl.textContent = tag;
     const countEl = document.createElement("span");
     countEl.className = "tag-browser__tag-count";
     countEl.textContent = count;
     btn.appendChild(nameEl);
     btn.appendChild(countEl);
     btn.addEventListener("click", () => {
       closeTagBrowser();
       searchInput.value = tag;
       searchQuery = tag;
       focusedPinId = null;
       applyPinLayout();
     });
     tagBrowserList.appendChild(btn);
   }
 }

 function openTagBrowser() {
   tagBrowserSearch.value = "";
   renderTagBrowserList("");
   tagBrowser.hidden = false;
   tagBrowserSearch.focus();
 }

 function closeTagBrowser() {
   tagBrowser.hidden = true;
 }

 function toggleTagBrowser() {
   tagBrowser.hidden ? openTagBrowser() : closeTagBrowser();
 }

 el("tag-browser-close").addEventListener("click", closeTagBrowser);
 tagBrowserSearch.addEventListener("input", () => {
   renderTagBrowserList(tagBrowserSearch.value);
 });
 tagBrowser.addEventListener("click", (e) => {
   if (e.target === tagBrowser) closeTagBrowser();
 });
 document.addEventListener("keydown", (e) => {
   if (e.key === "Escape" && !tagBrowser.hidden) {
     closeTagBrowser();
   }
 });

 /* ── Radial blur from cursor ──────────────────────────────── */
 // We use a CSS SVG filter on the pins layer with a mask that grows
 // blur with distance from cursor. We use a canvas-based approach
 // drawing multiple concentric blur zones using CSS + JS.
 let cursorX = window.innerWidth / 2;
 let cursorY = window.innerHeight / 2;
 let radialBlurRaf = null;

 function updateRadialBlur() {
   // We apply variable blur to each pin based on distance from cursor
   const viewRect = viewport.getBoundingClientRect();
   const cx = cursorX - viewRect.left;
   const cy = cursorY - viewRect.top;
   const maxDist = Math.hypot(viewRect.width, viewRect.height) * 0.72;

   const pins2 = pinsLayer.querySelectorAll(".pin");
   pins2.forEach((node) => {
     const r = node.getBoundingClientRect();
     const px = r.left + r.width / 2 - viewRect.left;
     const py = r.top + r.height / 2 - viewRect.top;
     const dist = Math.hypot(px - cx, py - cy);
     const t = Math.min(dist / maxDist, 1); // 0 = at cursor, 1 = far away
     // gentle: max blur ~2.8px at the far edge
     const blur = t * t * 2.8;
     if (blur < 0.08) {
       node.style.filter = "";
     } else {
       node.style.filter = `blur(${blur.toFixed(2)}px)`;
     }
   });
   radialBlurRaf = null;
 }

 document.addEventListener("mousemove", (e) => {
   cursorX = e.clientX;
   cursorY = e.clientY;
   if (!radialBlurRaf) {
     radialBlurRaf = requestAnimationFrame(updateRadialBlur);
   }
 });

 // Init blur
 requestAnimationFrame(updateRadialBlur);

})();