// middleware/authenticate.js
const jwt = require('jsonwebtoken');
const config = require('../config'); // Adjust the path to your config file

const authenticateMiddleware = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1]; // Get the token from the Authorization header
  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret); // Verify the token using your secret
    req.user = decoded; // Attach the user information to req.user
    next(); // Call the next middleware or route handler
  } catch (error) {
    res.status(400).json({ message: 'Invalid token.' });
  }
};

module.exports = authenticateMiddleware;