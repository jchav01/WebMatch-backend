const corsOptions = {
  origin: '*',
  credentials: true,
  optionsSuccessStatus: 200
};

const uploadsCorsOptions = {
  origin: 'http://localhost:3000',
  optionsSuccessStatus: 200
};

module.exports = { corsOptions, uploadsCorsOptions };
