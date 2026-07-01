// Normalização, validação e formatação de documentos/contatos brasileiros.
// Espelha IF-front/src/lib/masks.ts — o front é conveniência; a garantia de
// dados canônicos (formato único gravado no banco) mora aqui. Guardamos SEMPRE
// a forma formatada (mask canônica) para que a exibição não precise reformatar,
// e a unicidade de CNPJ é comparada por dígitos (índice funcional na migration).

function onlyDigits(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function isValidCpf(value) {
  const d = onlyDigits(value);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digit = (sliceLen) => {
    let sum = 0;
    for (let i = 0; i < sliceLen; i += 1) sum += Number(d[i]) * (sliceLen + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

function isValidCnpj(value) {
  const d = onlyDigits(value);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const digit = (len) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i -= 1) {
      sum += Number(d[len - i]) * pos;
      pos -= 1;
      if (pos < 2) pos = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}

// Telefone válido = 10 (fixo) ou 11 (celular) dígitos.
function isValidPhone(value) {
  const len = onlyDigits(value).length;
  return len === 10 || len === 11;
}

// --- Formatação canônica (o que é gravado no banco) -------------------------

function formatCpf(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatCnpj(value) {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length < 10) return d;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

module.exports = {
  onlyDigits,
  isValidCpf,
  isValidCnpj,
  isValidPhone,
  formatCpf,
  formatCnpj,
  formatPhone,
};
