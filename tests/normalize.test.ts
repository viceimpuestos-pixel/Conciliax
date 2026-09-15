import { describe, it, expect } from 'vitest';
import { parseMoney, round2, formatMoney } from '../src/core/normalize/money';
import { parseDate, daysBetween, monthKey } from '../src/core/normalize/dates';
import { normalizeNit, nitEquals, calcDV, formatNit } from '../src/core/normalize/nit';
import { normalizeText, textSimilarity, nameSimilarity, refMatches, normalizeRef } from '../src/core/normalize/text';

describe('parseMoney', () => {
  it('lee formato colombiano', () => {
    expect(parseMoney('1.234.567,89')).toBe(1234567.89);
    expect(parseMoney('$ 1.234.567')).toBe(1234567);
    expect(parseMoney('$1.500')).toBe(1500);
    expect(parseMoney('12.345.678,00')).toBe(12345678);
  });

  it('lee formato anglosajón', () => {
    expect(parseMoney('1,234,567.89')).toBe(1234567.89);
    expect(parseMoney('1,234.50')).toBe(1234.5);
  });

  it('maneja negativos', () => {
    expect(parseMoney('-1.234.567')).toBe(-1234567);
    expect(parseMoney('(1.234.567)')).toBe(-1234567);
    expect(parseMoney('1.234.567-')).toBe(-1234567);
  });

  it('maneja decimales cortos', () => {
    expect(parseMoney('1234,5')).toBe(1234.5);
    expect(parseMoney('1234.56')).toBe(1234.56);
  });

  it('trata separador único de 3 dígitos como miles', () => {
    expect(parseMoney('1.234')).toBe(1234);
    expect(parseMoney('45.000')).toBe(45000);
  });

  it('acepta números, vacíos y ruido', () => {
    expect(parseMoney(45000)).toBe(45000);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney('COP 980.000,00')).toBe(980000);
    expect(parseMoney('  ')).toBe(0);
  });

  it('respeta la pista de separador decimal', () => {
    expect(parseMoney('1.234', 'punto')).toBe(1.234);
    expect(parseMoney('1,234', 'coma')).toBe(1.234);
  });

  it('formatea en pesos', () => {
    expect(formatMoney(1234567)).toContain('1.234.567');
    expect(formatMoney(null)).toBe('—');
  });

  it('redondea a dos decimales', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('parseDate', () => {
  it('lee día primero (Colombia)', () => {
    const d = parseDate('15/03/2024');
    expect(d?.getFullYear()).toBe(2024);
    expect(d?.getMonth()).toBe(2);
    expect(d?.getDate()).toBe(15);
  });

  it('lee ISO y compactos', () => {
    expect(parseDate('2024-03-15')?.getDate()).toBe(15);
    expect(parseDate('20240315')?.getMonth()).toBe(2);
    expect(parseDate('15-03-24')?.getFullYear()).toBe(2024);
  });

  it('resuelve ambigüedad cuando el día supera 12', () => {
    expect(parseDate('25/03/2024')?.getDate()).toBe(25);
    expect(parseDate('03/25/2024')?.getDate()).toBe(25); // sólo puede ser mdy
  });

  it('lee meses con nombre', () => {
    expect(parseDate('15 mar 2024')?.getMonth()).toBe(2);
    expect(parseDate('15 de marzo de 2024')?.getMonth()).toBe(2);
  });

  it('lee objetos Date y seriales de Excel', () => {
    expect(parseDate(new Date(2024, 2, 15))?.getDate()).toBe(15);
    expect(parseDate(45366)?.getFullYear()).toBe(2024);
  });

  it('rechaza basura', () => {
    expect(parseDate('sin fecha')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('32/13/2024')).toBeNull();
  });

  it('calcula diferencias en días', () => {
    expect(daysBetween(parseDate('15/03/2024'), parseDate('12/03/2024'))).toBe(3);
    expect(monthKey(parseDate('15/03/2024'))).toBe('2024-03');
  });
});

describe('NIT', () => {
  it('normaliza formatos', () => {
    expect(normalizeNit('900.123.456-7')).toBe('900123456');
    expect(normalizeNit('900123456')).toBe('900123456');
    expect(normalizeNit('  0900123456 ')).toBe('900123456');
  });

  it('calcula el dígito de verificación', () => {
    expect(calcDV('890903938')).toBe(8);
    expect(formatNit('890903938-8')).toBe('890.903.938-8');
  });

  it('compara tolerando el DV pegado', () => {
    const dv = calcDV('901455201');
    expect(nitEquals('901455201', '901455201-' + dv)).toBe(true);
    expect(nitEquals('901455201' + dv, '901455201')).toBe(true);
    expect(nitEquals('901455201', '900000000')).toBe(false);
    expect(nitEquals('', '901455201')).toBe(false);
  });
});

describe('texto', () => {
  it('normaliza', () => {
    expect(normalizeText('  Pago  Prov. Álvarez & Cía  ')).toBe('PAGO PROV ALVAREZ CIA');
  });

  it('mide similitud de descripciones', () => {
    expect(textSimilarity('PAGO PROVEEDOR ANDINA', 'PAGO PROVEEDOR ANDINA')).toBe(1);
    expect(textSimilarity('PAGO PROVEEDOR ANDINA', 'PAGO A PROVEEDORES ANDINA SAS')).toBeGreaterThan(0.5);
    expect(textSimilarity('CONSIGNACION CLIENTE', 'IMPUESTO 4X1000')).toBeLessThan(0.3);
  });

  it('compara nombres ignorando tipo societario', () => {
    expect(nameSimilarity('DISTRIBUIDORA EL PORVENIR S.A.S.', 'DISTRIBUIDORA EL PORVENIR')).toBeGreaterThan(0.9);
    expect(nameSimilarity('ALPHA LTDA', 'OMEGA SAS')).toBeLessThan(0.4);
  });

  it('encuentra referencias dentro de un texto', () => {
    expect(normalizeRef('0000123456')).toBe('123456');
    expect(refMatches('123456', 'PAGO SUC VIRTUAL 000123456 NIT 901')).toBe(true);
    expect(refMatches('999999', 'PAGO SUC VIRTUAL 000123456')).toBe(false);
  });
});
