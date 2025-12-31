const crypto = require('crypto');

module.exports = function requestId() {
  return function (req, res, next) {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
};