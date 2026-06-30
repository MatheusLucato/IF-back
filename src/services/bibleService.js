// =============================================================================
// Bíblia online (F9.5) — engajamento.
// -----------------------------------------------------------------------------
// Estratégia: usar uma tradução de DOMÍNIO PÚBLICO (João Ferreira de Almeida,
// "almeida") servida pela API gratuita e SEM CHAVE bible-api.com. O backend atua
// como proxy + cache em memória para: (a) não expor o cliente a CORS/instabilidade
// do provedor; (b) evitar buscas repetidas do mesmo capítulo.
//
// Sem dependências novas: usa o `fetch` global (Node >= 18). Se o provedor estiver
// indisponível, o service lança um erro claro (não derruba nada do resto do app).
// O catálogo de livros é estático (não há endpoint de catálogo no provedor).
// =============================================================================

const { AppError } = require('../lib/errors');

const PROVIDER_BASE = 'https://bible-api.com';
const TRANSLATION = 'almeida'; // João Ferreira de Almeida — domínio público (PT-BR).

// Catálogo dos 66 livros. `apiName` é o nome em inglês que o bible-api aceita na
// query (ele não entende os nomes em português). `chapters` = total de capítulos.
const BOOKS = [
  // --- Antigo Testamento ---
  { id: 'gn', name: 'Gênesis', testament: 'AT', chapters: 50, apiName: 'genesis' },
  { id: 'ex', name: 'Êxodo', testament: 'AT', chapters: 40, apiName: 'exodus' },
  { id: 'lv', name: 'Levítico', testament: 'AT', chapters: 27, apiName: 'leviticus' },
  { id: 'nm', name: 'Números', testament: 'AT', chapters: 36, apiName: 'numbers' },
  { id: 'dt', name: 'Deuteronômio', testament: 'AT', chapters: 34, apiName: 'deuteronomy' },
  { id: 'js', name: 'Josué', testament: 'AT', chapters: 24, apiName: 'joshua' },
  { id: 'jz', name: 'Juízes', testament: 'AT', chapters: 21, apiName: 'judges' },
  { id: 'rt', name: 'Rute', testament: 'AT', chapters: 4, apiName: 'ruth' },
  { id: '1sm', name: '1 Samuel', testament: 'AT', chapters: 31, apiName: '1 samuel' },
  { id: '2sm', name: '2 Samuel', testament: 'AT', chapters: 24, apiName: '2 samuel' },
  { id: '1rs', name: '1 Reis', testament: 'AT', chapters: 22, apiName: '1 kings' },
  { id: '2rs', name: '2 Reis', testament: 'AT', chapters: 25, apiName: '2 kings' },
  { id: '1cr', name: '1 Crônicas', testament: 'AT', chapters: 29, apiName: '1 chronicles' },
  { id: '2cr', name: '2 Crônicas', testament: 'AT', chapters: 36, apiName: '2 chronicles' },
  { id: 'ed', name: 'Esdras', testament: 'AT', chapters: 10, apiName: 'ezra' },
  { id: 'ne', name: 'Neemias', testament: 'AT', chapters: 13, apiName: 'nehemiah' },
  { id: 'et', name: 'Ester', testament: 'AT', chapters: 10, apiName: 'esther' },
  { id: 'jó', name: 'Jó', testament: 'AT', chapters: 42, apiName: 'job' },
  { id: 'sl', name: 'Salmos', testament: 'AT', chapters: 150, apiName: 'psalms' },
  { id: 'pv', name: 'Provérbios', testament: 'AT', chapters: 31, apiName: 'proverbs' },
  { id: 'ec', name: 'Eclesiastes', testament: 'AT', chapters: 12, apiName: 'ecclesiastes' },
  { id: 'ct', name: 'Cânticos', testament: 'AT', chapters: 8, apiName: 'song of solomon' },
  { id: 'is', name: 'Isaías', testament: 'AT', chapters: 66, apiName: 'isaiah' },
  { id: 'jr', name: 'Jeremias', testament: 'AT', chapters: 52, apiName: 'jeremiah' },
  { id: 'lm', name: 'Lamentações', testament: 'AT', chapters: 5, apiName: 'lamentations' },
  { id: 'ez', name: 'Ezequiel', testament: 'AT', chapters: 48, apiName: 'ezekiel' },
  { id: 'dn', name: 'Daniel', testament: 'AT', chapters: 12, apiName: 'daniel' },
  { id: 'os', name: 'Oséias', testament: 'AT', chapters: 14, apiName: 'hosea' },
  { id: 'jl', name: 'Joel', testament: 'AT', chapters: 3, apiName: 'joel' },
  { id: 'am', name: 'Amós', testament: 'AT', chapters: 9, apiName: 'amos' },
  { id: 'ob', name: 'Obadias', testament: 'AT', chapters: 1, apiName: 'obadiah' },
  { id: 'jn', name: 'Jonas', testament: 'AT', chapters: 4, apiName: 'jonah' },
  { id: 'mq', name: 'Miquéias', testament: 'AT', chapters: 7, apiName: 'micah' },
  { id: 'na', name: 'Naum', testament: 'AT', chapters: 3, apiName: 'nahum' },
  { id: 'hc', name: 'Habacuque', testament: 'AT', chapters: 3, apiName: 'habakkuk' },
  { id: 'sf', name: 'Sofonias', testament: 'AT', chapters: 3, apiName: 'zephaniah' },
  { id: 'ag', name: 'Ageu', testament: 'AT', chapters: 2, apiName: 'haggai' },
  { id: 'zc', name: 'Zacarias', testament: 'AT', chapters: 14, apiName: 'zechariah' },
  { id: 'ml', name: 'Malaquias', testament: 'AT', chapters: 4, apiName: 'malachi' },
  // --- Novo Testamento ---
  { id: 'mt', name: 'Mateus', testament: 'NT', chapters: 28, apiName: 'matthew' },
  { id: 'mc', name: 'Marcos', testament: 'NT', chapters: 16, apiName: 'mark' },
  { id: 'lc', name: 'Lucas', testament: 'NT', chapters: 24, apiName: 'luke' },
  { id: 'jo', name: 'João', testament: 'NT', chapters: 21, apiName: 'john' },
  { id: 'at', name: 'Atos', testament: 'NT', chapters: 28, apiName: 'acts' },
  { id: 'rm', name: 'Romanos', testament: 'NT', chapters: 16, apiName: 'romans' },
  { id: '1co', name: '1 Coríntios', testament: 'NT', chapters: 16, apiName: '1 corinthians' },
  { id: '2co', name: '2 Coríntios', testament: 'NT', chapters: 13, apiName: '2 corinthians' },
  { id: 'gl', name: 'Gálatas', testament: 'NT', chapters: 6, apiName: 'galatians' },
  { id: 'ef', name: 'Efésios', testament: 'NT', chapters: 6, apiName: 'ephesians' },
  { id: 'fp', name: 'Filipenses', testament: 'NT', chapters: 4, apiName: 'philippians' },
  { id: 'cl', name: 'Colossenses', testament: 'NT', chapters: 4, apiName: 'colossians' },
  { id: '1ts', name: '1 Tessalonicenses', testament: 'NT', chapters: 5, apiName: '1 thessalonians' },
  { id: '2ts', name: '2 Tessalonicenses', testament: 'NT', chapters: 3, apiName: '2 thessalonians' },
  { id: '1tm', name: '1 Timóteo', testament: 'NT', chapters: 6, apiName: '1 timothy' },
  { id: '2tm', name: '2 Timóteo', testament: 'NT', chapters: 4, apiName: '2 timothy' },
  { id: 'tt', name: 'Tito', testament: 'NT', chapters: 3, apiName: 'titus' },
  { id: 'fm', name: 'Filemom', testament: 'NT', chapters: 1, apiName: 'philemon' },
  { id: 'hb', name: 'Hebreus', testament: 'NT', chapters: 13, apiName: 'hebrews' },
  { id: 'tg', name: 'Tiago', testament: 'NT', chapters: 5, apiName: 'james' },
  { id: '1pe', name: '1 Pedro', testament: 'NT', chapters: 5, apiName: '1 peter' },
  { id: '2pe', name: '2 Pedro', testament: 'NT', chapters: 3, apiName: '2 peter' },
  { id: '1jo', name: '1 João', testament: 'NT', chapters: 5, apiName: '1 john' },
  { id: '2jo', name: '2 João', testament: 'NT', chapters: 1, apiName: '2 john' },
  { id: '3jo', name: '3 João', testament: 'NT', chapters: 1, apiName: '3 john' },
  { id: 'jd', name: 'Judas', testament: 'NT', chapters: 1, apiName: 'jude' },
  { id: 'ap', name: 'Apocalipse', testament: 'NT', chapters: 22, apiName: 'revelation' },
];

const BOOK_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));

// Cache simples em memória: chave "bookId:chapter" → { verses, reference, fetchedAt }.
// A Bíblia é imutável, então não há TTL — o cache vive enquanto o processo estiver
// de pé. Limite defensivo de tamanho para não crescer sem fim.
const cache = new Map();
const CACHE_LIMIT = 500;

function listBooks() {
  return BOOKS.map(({ apiName, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

function getBook(bookId) {
  const book = BOOK_BY_ID.get(String(bookId || '').toLowerCase());
  if (!book) throw AppError.notFound('Livro não encontrado.');
  return book;
}

async function getChapter(bookId, chapter) {
  const book = getBook(bookId);
  const ch = Number(chapter);
  if (!Number.isInteger(ch) || ch < 1 || ch > book.chapters) {
    throw AppError.badRequest(`Capítulo inválido para ${book.name} (1–${book.chapters}).`);
  }

  const cacheKey = `${book.id}:${ch}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const ref = encodeURIComponent(`${book.apiName} ${ch}`);
  const url = `${PROVIDER_BASE}/${ref}?translation=${TRANSLATION}`;

  let payload;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    payload = await resp.json();
  } catch {
    throw AppError.preconditionFailed(
      'Não foi possível carregar o texto bíblico no momento. Tente novamente em instantes.',
    );
  }

  const verses = Array.isArray(payload.verses)
    ? payload.verses.map((v) => ({ verse: Number(v.verse), text: String(v.text || '').trim() }))
    : [];

  const result = {
    book: { id: book.id, name: book.name, chapters: book.chapters },
    chapter: ch,
    reference: `${book.name} ${ch}`,
    translation: 'Almeida (domínio público)',
    verses,
  };

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, result);
  return result;
}

module.exports = { BOOKS, listBooks, getBook, getChapter };
