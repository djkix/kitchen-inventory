/**
 * Version affichée dans l'interface. Deux sources : celle figée dans la coque
 * à la construction de l'image, et celle que renvoie l'API. Un écart signifie
 * que le service worker sert une interface plus ancienne que le serveur.
 */
export const WEB_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

function isReleased(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export interface VersionState {
  /** Ce qu'il faut afficher, par exemple « 0.4.1 ». */
  label: string;
  /** Vrai quand l'interface en cache est plus ancienne que le serveur. */
  stale: boolean;
}

export function versionState(apiVersion: string | undefined, webVersion: string = WEB_VERSION): VersionState {
  if (!apiVersion) return { label: webVersion, stale: false };
  // En développement, les deux valeurs ne sont pas des numéros de version
  // publiés : l'écart n'a pas de sens, on ne le signale pas.
  const comparable = isReleased(apiVersion) && isReleased(webVersion);
  return { label: apiVersion, stale: comparable && apiVersion !== webVersion };
}
