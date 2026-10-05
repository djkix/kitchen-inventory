import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Caméra simulée (section 19, tâche 2 puis 9) : fabrique une vidéo `.y4m` qui
 * alterne deux codes-barres EAN-13 rendus en pixels purs, par blocs d'images
 * successifs, que Chromium rejoue en boucle via
 * `--use-file-for-fake-video-capture`. Le fichier Y4M est écrit directement
 * en TypeScript (aucun binaire externe) : chaque image porte son plan de
 * luminance (le bitmap du code-barres de son bloc), les deux plans de
 * chrominance restent constants. Déterministe et portable, y compris sur un
 * runner CI dépourvu de `ffmpeg`.
 *
 * L'alternance par blocs (plutôt qu'un seul code figé) est ce qui rend
 * testable la rafale — le geste central de l'application : le filtre
 * anti-répétition (`createScanGate`, apps/web/src/lib/scan-debounce.ts) ne
 * réaccepte un code déjà traité qu'une fois qu'il a quitté le champ de la
 * caméra ET qu'un délai de garde de deux secondes s'est écoulé. Avec un seul
 * code répété sur chaque image, aucune de ces deux conditions ne pouvait
 * jamais se produire.
 */

// Tables de codage EAN-13 (GS1 General Specifications) : 7 modules par
// chiffre, « 1 » = barre noire, « 0 » = barre blanche.
const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_CODES = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R_CODES = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

// Parité (L/G) des six chiffres de gauche, déterminée par le premier chiffre
// (lui-même non encodé en barres, implicite dans ce motif de parité).
const FIRST_DIGIT_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function checkDigit(twelveDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(twelveDigits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** Suite de 95 modules (barres) encodant un EAN-13 complet, gardes comprises. */
function encodeEan13(barcode: string): string {
  const twelve = barcode.length === 13 ? barcode.slice(0, 12) : barcode;
  if (twelve.length !== 12 || !/^\d{12}$/.test(twelve)) {
    throw new Error(`Code-barres EAN-13 invalide : « ${barcode} »`);
  }
  const digits = `${twelve}${checkDigit(twelve)}`;
  const parity = FIRST_DIGIT_PARITY[Number(digits[0])];
  // digits[0] est un chiffre 0-9 garanti par le test de forme ci-dessus : cette
  // garde ne sert qu'à satisfaire `noUncheckedIndexedAccess`, jamais levée en pratique.
  if (parity === undefined) throw new Error(`Parité introuvable pour le premier chiffre « ${digits[0]} »`);
  const left = digits.slice(1, 7);
  const right = digits.slice(7, 13);

  let bits = '101'; // garde de départ
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(left[i]);
    bits += parity[i] === 'L' ? L_CODES[digit] : G_CODES[digit];
  }
  bits += '01010'; // garde centrale
  for (let i = 0; i < 6; i += 1) {
    bits += R_CODES[Number(right[i])];
  }
  bits += '101'; // garde de fin
  return bits;
}

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const MODULE_WIDTH = 6;
const QUIET_ZONE_MODULES = 11; // marge minimale GS1 de chaque côté
const BAR_HEIGHT = 480;

// Cadence conservée à l'identique de l'ancienne commande ffmpeg (`-r 15`) :
// le décodeur lit un flux, pas une image isolée — il lui faut plusieurs
// images identiques pour accrocher une lecture.
const FRAME_RATE = 15;

/**
 * Durée d'un bloc (un seul des deux codes affiché sans interruption) : 3 s,
 * soit 45 images à 15 im/s. Choisie contre la règle réelle du filtre
 * anti-répétition (`createScanGate`, cooldownMs = 2000) : dans une vidéo qui
 * alterne deux blocs en boucle (A, B, A, B, …), le délai entre deux
 * apparitions du MÊME code est la durée du bloc de L'AUTRE code — celui qui
 * s'intercale, pendant lequel le premier a quitté le champ (il n'apparaît
 * plus dans les codes détectés sur l'image). 3 s au-dessus d'un délai de
 * garde de 2 s laisse une marge de 1 s (50 %) : confortable face à la
 * latence du pipeline caméra → décodeur → tiroir de validation, sans
 * allonger inutilement les parcours Playwright qui attendent chaque scan.
 */
const BLOCK_SECONDS = 3;
const BLOCK_FRAME_COUNT = BLOCK_SECONDS * FRAME_RATE;

/**
 * Nombre de cycles (bloc A puis bloc B) écrits dans le fichier. La vidéo
 * boucle déjà côté Chromium une fois sa fin atteinte, mais écrire plusieurs
 * cycles à l'intérieur évite de dépendre de ce bouclage pour qu'un second
 * scan ait lieu pendant la fenêtre d'un test : le second code est déjà
 * disponible bien avant la fin du fichier.
 */
const CYCLE_COUNT = 3;

// Plage « studio » (ITU-R BT.601/BT.709) attendue par un flux yuv420p
// conforme : 16 = noir, 235 = blanc. Un décodeur strict qui applique la
// désaturation limited-range restitue bien 0/255 en RVB ; des valeurs
// pleine échelle (0/255) risqueraient l'écrêtage inverse chez un décodeur
// qui, lui, suppose cette même plage studio en entrée.
const LUMA_BLACK = 16;
const LUMA_WHITE = 235;
// Chrominance neutre (ni rouge/vert, ni bleu/jaune) sur les deux plans U et
// V, à la résolution quart (4:2:0) : une image en niveaux de gris n'a pas de
// couleur à porter.
const CHROMA_NEUTRAL = 128;

/** Plan de luminance (un octet par pixel) : blanc avec les barres noires du code centrées. */
function renderLumaPlane(bits: string): Buffer {
  const quietWidth = QUIET_ZONE_MODULES * MODULE_WIDTH;
  const barsWidth = bits.length * MODULE_WIDTH;
  const contentWidth = barsWidth + quietWidth * 2;
  const offsetX = Math.round((CANVAS_WIDTH - contentWidth) / 2) + quietWidth;
  const offsetY = Math.round((CANVAS_HEIGHT - BAR_HEIGHT) / 2);

  const plane = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT, LUMA_WHITE);

  for (let column = 0; column < bits.length; column += 1) {
    if (bits[column] !== '1') continue;
    const xStart = offsetX + column * MODULE_WIDTH;
    for (let x = xStart; x < xStart + MODULE_WIDTH; x += 1) {
      for (let y = offsetY; y < offsetY + BAR_HEIGHT; y += 1) {
        plane[y * CANVAS_WIDTH + x] = LUMA_BLACK;
      }
    }
  }
  return plane;
}

/**
 * Assemble un fichier Y4M (YUV4MPEG2) complet : un en-tête ASCII puis, pour
 * chaque image, un marqueur `FRAME` suivi des plans Y (pleine résolution)
 * puis U et V (résolution quart, 4:2:0). La séquence d'images alterne les
 * deux plans de luminance par blocs de `BLOCK_FRAME_COUNT`, répétés
 * `CYCLE_COUNT` fois (A, B, A, B, …) : chaque bloc n'a qu'une seule image
 * calculée, dupliquée en mémoire pour sa durée.
 *
 * Coupure franche entre deux blocs, sans images vierges intercalaires : ces
 * images sont composées pixel par pixel (pas une capture d'une caméra
 * physique), donc le passage d'un bloc à l'autre est instantané et sans flou
 * de mouvement — à l'image qui suit le changement de bloc, l'ancien code
 * n'est déjà plus présent du tout. Une poignée d'images vierges entre les
 * blocs n'apporterait donc rien de plus pour la condition « a quitté le
 * champ » du filtre anti-répétition, seulement de la durée en plus.
 */
function buildY4m(lumaPlanes: readonly Buffer[]): Buffer {
  const chromaWidth = CANVAS_WIDTH / 2;
  const chromaHeight = CANVAS_HEIGHT / 2;
  const chromaPlane = Buffer.alloc(chromaWidth * chromaHeight, CHROMA_NEUTRAL);

  const header = Buffer.from(`YUV4MPEG2 W${CANVAS_WIDTH} H${CANVAS_HEIGHT} F${FRAME_RATE}:1 Ip A1:1 C420jpeg\n`, 'ascii');
  const frameMarker = Buffer.from('FRAME\n', 'ascii');
  const blockFrames = lumaPlanes.map((lumaPlane) => {
    const frame = Buffer.concat([frameMarker, lumaPlane, chromaPlane, chromaPlane]);
    return new Array<Buffer>(BLOCK_FRAME_COUNT).fill(frame);
  });

  const cycle = blockFrames.flat();
  const frames = new Array<Buffer[]>(CYCLE_COUNT).fill(cycle).flat();
  return Buffer.concat([header, ...frames]);
}

/**
 * Génère la vidéo de la caméra simulée qui alterne les deux codes-barres
 * `barcodes` (dans cet ordre, en blocs successifs répétés) et retourne son
 * chemin (fichier temporaire, jamais nettoyé explicitement : le runner CI
 * comme cette machine recyclent leur répertoire temporaire entre
 * exécutions). La vidéo boucle automatiquement côté Chromium une fois sa fin
 * atteinte, mais contient déjà plusieurs cycles complets (voir
 * `CYCLE_COUNT`) : un test n'a pas à attendre ce bouclage pour voir le
 * second code.
 */
export async function generateBarcodeVideo(barcodes: readonly [string, string]): Promise<string> {
  const lumaPlanes = barcodes.map((barcode) => renderLumaPlane(encodeEan13(barcode)));
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-e2e-barcode-'));
  const videoPath = join(dir, 'barcode.y4m');
  await writeFile(videoPath, buildY4m(lumaPlanes));
  return videoPath;
}
