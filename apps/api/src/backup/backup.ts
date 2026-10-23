/** Au-delà, l'absence de sauvegarde réussie est signalée (une nuit manquée passe, deux non). */
export const BACKUP_SILENCE_HOURS = 36;

export interface BackupAttemptRow {
  finishedAt: Date;
  succeeded: boolean;
  message: string;
}

/**
 * Ce que Réglages › Sauvegarde signale : dernière tentative en échec, ou
 * aucune réussite depuis 36 h. Sans aucune réussite, on mesure depuis la
 * dernière tentative ; table vide (service jamais lancé) : rien.
 */
export function backupWarnings(last: BackupAttemptRow | null, lastSuccessAt: Date | null, now: Date): string[] {
  const warnings: string[] = [];
  if (last && !last.succeeded) warnings.push(`La dernière sauvegarde a échoué : ${last.message}.`);
  const since = lastSuccessAt ?? last?.finishedAt ?? null;
  if (since && now.getTime() - since.getTime() > BACKUP_SILENCE_HOURS * 3600_000) {
    warnings.push(`Aucune sauvegarde réussie depuis ${BACKUP_SILENCE_HOURS} h.`);
  }
  return warnings;
}
