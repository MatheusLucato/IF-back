const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler');
const bible = require('../services/bibleService');

const router = express.Router();

// ============================================================================
// BÍBLIA ONLINE (F9.5) — leitura para engajamento.
// Tradução de domínio público (Almeida) via proxy/cache. Qualquer usuário
// autenticado acessa (sem permissão de módulo: é conteúdo público de leitura).
// ============================================================================

router.get('/bible/books', asyncHandler(async (_req, res) => {
  res.json({ books: bible.listBooks() });
}));

router.get('/bible/:bookId/:chapter', asyncHandler(async (req, res) => {
  const chapter = await bible.getChapter(req.params.bookId, req.params.chapter);
  res.json(chapter);
}));

module.exports = router;
