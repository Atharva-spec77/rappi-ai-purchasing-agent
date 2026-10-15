function notFoundHandler(req, res) {
  res.status(404).json({ error: "not_found", path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // eslint-disable-next-line no-console
  console.error("[rappi-agent] error:", err.message);
  const status = err.status || 500;
  res
    .status(status)
    .json({
      error: err.code || "internal_error",
      message: err.message || "Unexpected error",
    });
}

module.exports = { notFoundHandler, errorHandler };
