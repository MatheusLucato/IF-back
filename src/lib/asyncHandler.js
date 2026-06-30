// Envolve um handler assincrono e encaminha qualquer rejeicao ao errorHandler.
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
