// Parser OFX (extrato bancário) — F5.6. Suporta os dois dialetos comuns:
//   · SGML (OFX 1.x): tags sem fechamento, ex.: <TRNAMT>-50.00
//   · XML  (OFX 2.x): tags com fechamento, ex.: <TRNAMT>-50.00</TRNAMT>
//
// Sem dependências externas (bancos brasileiros variam muito o formato; um
// parser tolerante por regex é mais robusto aqui que uma lib estrita). Devolve
// valores em CENTAVOS (inteiro) e datas 'YYYY-MM-DD'.

// Extrai o conteúdo de uma tag, tolerando SGML (valor até o fim da linha / próxima
// tag) e XML (até a tag de fechamento).
function tagValue(block, tag) {
  // XML: <TAG>valor</TAG>
  const xml = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(block);
  if (xml) return xml[1].trim();
  // SGML: <TAG>valor (até nova tag ou fim de linha)
  const sgml = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  return sgml ? sgml[1].trim() : null;
}

// OFX usa data no formato YYYYMMDD[HHMMSS][.xxx][TZ]. Pegamos só os 8 primeiros.
function parseOfxDate(value) {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// "-50.00" / "1.234,56" / "1234.56" → centavos (inteiro, sinalizado).
function parseAmountToCents(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  const negative = s.startsWith('-');
  s = s.replace(/[^0-9.,]/g, '');
  // Se tem vírgula E ponto, o último separador é o decimal.
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(Math.abs(num) * 100);
  return negative ? -cents : cents;
}

// Parseia o conteúdo do arquivo OFX. Retorna { bankId, transactions: [...] }.
function parseOfx(content) {
  const text = String(content || '');
  const bankId = tagValue(text, 'BANKID') || tagValue(text, 'ORG') || null;

  const transactions = [];
  // Cada lançamento vive entre <STMTTRN> e </STMTTRN> (ou o próximo <STMTTRN>).
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const amountCents = parseAmountToCents(tagValue(block, 'TRNAMT'));
    const postedAt = parseOfxDate(tagValue(block, 'DTPOSTED'));
    if (amountCents == null || !postedAt) continue;
    const memo = tagValue(block, 'MEMO') || tagValue(block, 'NAME') || null;
    const fitid = tagValue(block, 'FITID') || null;
    transactions.push({
      fitid,
      postedAt,
      amountCents,
      type: amountCents >= 0 ? 'income' : 'expense',
      memo,
    });
  }

  return { bankId, transactions };
}

module.exports = { parseOfx, parseAmountToCents, parseOfxDate };
