
function errorHandler(err, req, res, next) {
    console.error("Error:", err.message);
    console.error("Stacktrace:", err.stack);
    const status = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    res.status(status).json({ error: message });
}

module.exports = errorHandler;
