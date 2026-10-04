import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Caméra simulée (section 19, tâche 2) : fabrique une vidéo `.y4m` figée sur
 * un code-barres EAN-13 rendu en pixels purs, que Chromium rejoue en boucle
 * via `--use-file-for-fake-video-capture`. Aucune dépendance de rendu
 * d'image : seul `ffmpeg` (présent sur le runner et sur cette machine) encode
 * les pixels générés ici en vidéo.
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

/** Image PPM (P6, brute) blanche avec les barres noires du code centrées. */
function renderPpm(bits: string): Buffer {
  const quietWidth = QUIET_ZONE_MODULES * MODULE_WIDTH;
  const barsWidth = bits.length * MODULE_WIDTH;
  const contentWidth = barsWidth + quietWidth * 2;
  const offsetX = Math.round((CANVAS_WIDTH - contentWidth) / 2) + quietWidth;
  const offsetY = Math.round((CANVAS_HEIGHT - BAR_HEIGHT) / 2);

  const header = `P6\n${CANVAS_WIDTH} ${CANVAS_HEIGHT}\n255\n`;
  const pixels = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT * 3, 255);

  for (let column = 0; column < bits.length; column += 1) {
    if (bits[column] !== '1') continue;
    const xStart = offsetX + column * MODULE_WIDTH;
    for (let x = xStart; x < xStart + MODULE_WIDTH; x += 1) {
      for (let y = offsetY; y < offsetY + BAR_HEIGHT; y += 1) {
        const index = (y * CANVAS_WIDTH + x) * 3;
        pixels[index] = 0;
        pixels[index + 1] = 0;
        pixels[index + 2] = 0;
      }
    }
  }
  return Buffer.concat([Buffer.from(header, 'ascii'), pixels]);
}

function runFfmpeg(args: readonly string[]): Promise<void> {
  return execFileAsync('ffmpeg', [...args]).then(
    () => undefined,
    (error: unknown) => {
      throw new Error(`ffmpeg a échoué (${args.join(' ')}) : ${error instanceof Error ? error.message : String(error)}`);
    },
  );
}

/**
 * Génère la vidéo figée du code-barres `barcode` et retourne son chemin
 * (fichier temporaire, jamais nettoyé explicitement : le runner CI comme
 * cette machine recyclent leur répertoire temporaire entre exécutions).
 * La vidéo boucle automatiquement côté Chromium une fois sa fin atteinte :
 * quelques secondes à image fixe suffisent.
 */
export async function generateBarcodeVideo(barcode: string): Promise<string> {
  const bits = encodeEan13(barcode);
  const dir = await mkdtemp(join(tmpdir(), 'kitchen-e2e-barcode-'));
  const ppmPath = join(dir, 'barcode.ppm');
  const videoPath = join(dir, 'barcode.y4m');
  await writeFile(ppmPath, renderPpm(bits));
  await runFfmpeg(['-y', '-loop', '1', '-i', ppmPath, '-t', '5', '-r', '15', '-pix_fmt', 'yuv420p', videoPath]);
  return videoPath;
}
