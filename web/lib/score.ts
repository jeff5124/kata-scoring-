/** Saisie d'une note au pavé numérique : « 7 », « 6 » → 7,6 ; « 1 », « 0 », « 0 » → 10,0. Notes de 5,0 à 10,0 (art. 5.4). */

export const MIN_TENTHS = 50;
export const MAX_TENTHS = 100;

/** Chiffres que l'on peut encore ajouter sans sortir de 5,0–10,0. */
export function allowedNext(digits: string): string[] {
  if (digits === '') return ['1', '5', '6', '7', '8', '9'];
  if (digits === '1' || digits === '10') return ['0']; // seule note possible : 10,0
  if (digits.length === 1) return ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']; // 5 à 9 : le dixième est libre
  return [];
}

export function isComplete(digits: string): boolean {
  const n = Number(digits);
  return digits.length >= 2 && n >= MIN_TENTHS && n <= MAX_TENTHS;
}

export function tenths(digits: string): number | null {
  return isComplete(digits) ? Number(digits) : null;
}

/** Affichage avec virgule décimale : « 7,6 », « 10,0 ». */
export function format(t: number): string {
  return `${Math.floor(t / 10)},${t % 10}`;
}

/** Affichage pendant la saisie. */
export function preview(digits: string): string {
  if (digits === '') return '–,–';
  if (isComplete(digits)) return format(Number(digits));
  if (digits.length === 1 && digits !== '1') return `${digits},–`;
  return digits; // « 1 » ou « 10 » : en attente du dernier chiffre
}
