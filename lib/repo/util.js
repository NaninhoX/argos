// Auxiliares dos repositórios: conversões que se comportam igual no Neon e no PGlite.

/**
 * Serializa para parâmetro jsonb (use com cast `$n::jsonb`). Recusa NaN/Infinity, que o JSON.stringify
 * trocaria por null em silêncio e que alterariam o hash do conteúdo.
 * @param {unknown} value
 * @returns {string|null}
 */
export function jsonParam(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (key, x) => {
    if (typeof x === 'number' && !Number.isFinite(x)) {
      throw new TypeError(`jsonb: número não finito em "${key}"`);
    }
    return x;
  });
}

/**
 * Instante como texto ISO-8601 em UTC (parâmetro timestamptz). Aceita Date ou string de data; null/undefined viram null.
 * @param {Date|string|null|undefined} value
 * @param {string} name nome do campo, para a mensagem de erro
 * @returns {string|null}
 */
export function isoParam(value, name = 'data') {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) && typeof value !== 'string') {
    throw new TypeError(`${name}: esperava Date ou string ISO`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new TypeError(`${name}: data inválida`);
  return d.toISOString();
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
