/** Utilidades de calendario America/Guayaquil para rachas, misiones y ranking. */

/** Ecuador continental usa UTC−5 fijo, sin horario de verano desde 1993. */
const GUAYAQUIL_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * Fecha cuyos campos locales (getDate, getHours…) son la hora de Guayaquil.
 * Antes se hacía `new Date(new Date().toLocaleString('en-US', { timeZone }))`, pero Hermes (el motor de
 * la app en Android) no interpreta ese texto y devolvía una fecha inválida: rachas, misiones y ranking
 * quedaban con claves NaN. Aquí se calcula con aritmética, sin interpretar texto.
 */
export function nowGuayaquil(now: number = Date.now()): Date {
  const g = new Date(now + GUAYAQUIL_OFFSET_MS);
  return new Date(
    g.getUTCFullYear(),
    g.getUTCMonth(),
    g.getUTCDate(),
    g.getUTCHours(),
    g.getUTCMinutes(),
    g.getUTCSeconds()
  );
}

/** YYYY-MM-DD en Guayaquil */
export function dateKeyGuayaquil(d = nowGuayaquil()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Clave de semana: inicia lunes 00:00 y cierra domingo 23:59 (Guayaquil).
 * Formato: YYYY-Www (ISO-like with Monday start).
 */
export function weekKeyGuayaquil(d = nowGuayaquil()): string {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const y = monday.getFullYear();
  const oneJan = new Date(y, 0, 1);
  const week = Math.ceil(
    ((monday.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7
  );
  return `${y}-W${String(week).padStart(2, '0')}`;
}

/** Próximo domingo 23:59:59 Guayaquil (fin de semana de ranking). */
export function nextSundayResetLabel(d = nowGuayaquil()): string {
  const day = d.getDay();
  const add = day === 0 ? 0 : 7 - day;
  const sunday = new Date(d);
  sunday.setDate(d.getDate() + add);
  const dd = String(sunday.getDate()).padStart(2, '0');
  const mm = String(sunday.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm} 23:59`;
}

export function isPastSundayReset(lastWeekKey: string, now = nowGuayaquil()): boolean {
  return weekKeyGuayaquil(now) !== lastWeekKey;
}
