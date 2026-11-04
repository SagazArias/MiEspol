/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dateKeyGuayaquil, nextSundayResetLabel, nowGuayaquil, weekKeyGuayaquil } from '../time';

// Miércoles 4 de noviembre de 2026, 16:30 UTC = 11:30 en Guayaquil.
const MIE_1630_UTC = Date.UTC(2026, 10, 4, 16, 30);

describe('nowGuayaquil', () => {
  it('es UTC−5', () => {
    const g = nowGuayaquil(MIE_1630_UTC);
    assert.equal(g.getHours(), 11);
    assert.equal(g.getMinutes(), 30);
    assert.equal(g.getDate(), 4);
  });

  it('cerca de la medianoche UTC sigue en el día anterior de Guayaquil', () => {
    const g = nowGuayaquil(Date.UTC(2026, 10, 5, 3, 0)); // 5 nov 03:00 UTC = 4 nov 22:00 Guayaquil
    assert.equal(g.getDate(), 4);
    assert.equal(g.getHours(), 22);
  });

  it('siempre es una fecha válida', () => {
    assert.ok(Number.isFinite(nowGuayaquil().getTime()));
  });

  it('no interpreta texto de toLocaleString (Hermes, el motor de la app, no lo soporta y da NaN)', () => {
    const src = readFileSync(new URL('../time.ts', import.meta.url), 'utf8');
    assert.ok(!/new Date\([^)]*toLocale/s.test(src));
  });
});

describe('claves y etiquetas', () => {
  const g = nowGuayaquil(MIE_1630_UTC);

  it('dateKey es YYYY-MM-DD', () => assert.equal(dateKeyGuayaquil(g), '2026-11-04'));

  it('weekKey tiene el formato YYYY-Www, sin NaN', () => assert.match(weekKeyGuayaquil(g), /^2026-W\d{2}$/));

  it('el reinicio del ranking es el domingo siguiente', () => assert.equal(nextSundayResetLabel(g), '08/11 23:59'));

  it('un domingo, el reinicio es ese mismo día', () => {
    const domingo = nowGuayaquil(Date.UTC(2026, 10, 8, 15, 0));
    assert.equal(nextSundayResetLabel(domingo), '08/11 23:59');
  });
});
