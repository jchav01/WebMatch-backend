const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger?.warn('Token manquant');
    return res.status(401).json({ success: false, message: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.userId) {
      logger?.warn('Token invalide : userId manquant');
      return res.status(401).json({ success: false, message: 'Token invalide (userId absent)' });
    }

    if (typeof decoded.userId !== 'number') {
      logger?.error('userId du token invalide : doit être un nombre', { decoded });
      return res.status(401).json({ success: false, message: 'userId invalide' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true }
    });

    if (!user) {
      logger?.warn(`Utilisateur introuvable pour userId : ${decoded.userId}`);
      return res.status(401).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    req.user = user;
    next();
  } catch (err) {
    logger?.error('Erreur de vérification du token', {
      message: err.message,
      stack: err.stack
    });
    return res.status(403).json({ success: false, message: 'Token invalide' });
  }
};

module.exports = authenticateToken;
