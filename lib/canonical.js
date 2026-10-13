// JSON canônico e hash. É a base da prova de previsão: o mesmo objeto gera sempre o mesmo texto e o mesmo hash.
//
// Regras do formato:
//  - chaves de objeto em ordem lexicográfica (por unidade de código UTF-16, como Array.prototype.sort);
//  - sem espaços; strings e números no formato de JSON.stringify (número: representação mais curta do ECMAScript);
//  - undefined e funções são omitidos em objetos e viram null em arrays (como em JSON.stringify);
//  - typed arrays viram arrays; Date vira string ISO;
//  - número não finito (NaN, ±Infinity): depende de `nonFinite`:
//      'throw' (padrão) recusa, porque uma previsão registrada não pode conter NaN;
//      'null' grava null; 'tag' grava a string "NaN"/"Infinity"/"-Infinity" (usado só em testes de paridade).
import { createHash } from 'node:crypto';

/**
 * @param {unknown} value
 * @param {{ nonFinite?: 'throw' | 'null' | 'tag' }} [opts]
 * @returns {string}
 */
export function canonicalize(value, opts = {}) {
  const mode = opts.nonFinite || 'throw';
  const parts = [];
  const write = (v, inArray) => {
    if (v === null) return parts.push('null');
    const t = typeof v;
    if (t === 'number') {
      if (Number.isFinite(v)) return parts.push(JSON.stringify(v));
      if (mode === 'null') return parts.push('null');
      if (mode === 'tag') return parts.push(JSON.stringify(String(v)));
      throw new TypeError('número não finito em objeto canônico: ' + v);
    }
    if (t === 'string' || t === 'boolean') return parts.push(JSON.stringify(v));
    if (t === 'undefined' || t === 'function' || t === 'symbol') {
      if (inArray) return parts.push('null');
      throw new TypeError('valor não serializável na raiz: ' + t);
    }
    if (t === 'bigint') throw new TypeError('bigint não é suportado em objeto canônico');
    if (v instanceof Date) return parts.push(JSON.stringify(v.toISOString()));
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      parts.push('[');
      for (let i = 0; i < v.length; i++) { if (i) parts.push(','); write(v[i], true); }
      return parts.push(']');
    }
    if (v instanceof Map || v instanceof Set) throw new TypeError('Map e Set não são suportados em objeto canônico');
    parts.push('{');
    let first = true;
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      const tx = typeof x;
      if (tx === 'undefined' || tx === 'function' || tx === 'symbol') continue;
      if (!first) parts.push(',');
      first = false;
      parts.push(JSON.stringify(k), ':');
      write(x, false);
    }
    parts.push('}');
  };
  write(value, false);
  return parts.join('');
}

/** SHA-256 em hexadecimal minúsculo de uma string (UTF-8) ou de bytes. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Hash do JSON canônico de um objeto. */
export function hashCanonical(value, opts) {
  return sha256Hex(canonicalize(value, opts));
}
