class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // Pour distinguer les erreurs prévues (vs bugs)
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
