// routes/notifications.routes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authenticateToken');
const { prisma, getIo } = require('../config/shared');

// Obtenir toutes les notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (page - 1) * limit;
    
    const whereClause = {
      userId
    };
    
    if (unreadOnly === 'true') {
      whereClause.isRead = false;
    }
    
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: parseInt(limit)
      }),
      prisma.notification.count({
        where: whereClause
      })
    ]);
    
    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des notifications'
    });
  }
});

// Compter les notifications non lues
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const unreadCount = await prisma.notification.count({
      where: {
        userId,
        isRead: false
      }
    });
    
    res.json({
      success: true,
      data: {
        unreadCount
      }
    });
  } catch (error) {
    console.error('Error counting unread notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du comptage des notifications'
    });
  }
});

// Marquer une notification comme lue
router.put('/read/:notificationId', authenticateToken, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.notificationId);
    const userId = req.user.id;
    
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId }
    });
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification non trouvée'
      });
    }
    
    if (notification.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    const updatedNotification = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });
    
    res.json({
      success: true,
      data: updatedNotification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du marquage de la notification'
    });
  }
});

// Marquer toutes les notifications comme lues
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });
    
    res.json({
      success: true,
      message: `${result.count} notifications marquées comme lues`
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du marquage des notifications'
    });
  }
});

// Supprimer une notification
router.delete('/:notificationId', authenticateToken, async (req, res) => {
  try {
    const notificationId = parseInt(req.params.notificationId);
    const userId = req.user.id;
    
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId }
    });
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification non trouvée'
      });
    }
    
    if (notification.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    await prisma.notification.delete({
      where: { id: notificationId }
    });
    
    res.json({
      success: true,
      message: 'Notification supprimée'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de la notification'
    });
  }
});

// Supprimer toutes les notifications lues
router.delete('/clear-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await prisma.notification.deleteMany({
      where: {
        userId,
        isRead: true
      }
    });
    
    res.json({
      success: true,
      message: `${result.count} notifications supprimées`
    });
  } catch (error) {
    console.error('Error clearing read notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression des notifications'
    });
  }
});

// Préférences de notifications
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        preferences: true
      }
    });
    
    const notificationPrefs = user?.preferences?.notifications || {
      messages: true,
      friendRequests: true,
      matches: true,
      profileViews: true,
      system: true,
      email: false,
      push: true
    };
    
    res.json({
      success: true,
      data: notificationPrefs
    });
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des préférences'
    });
  }
});

// Mettre à jour les préférences de notifications
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { preferences } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true }
    });
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        preferences: {
          ...user.preferences,
          notifications: {
            ...user.preferences?.notifications,
            ...preferences
          }
        }
      }
    });
    
    res.json({
      success: true,
      data: updatedUser.preferences.notifications
    });
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour des préférences'
    });
  }
});

// Obtenir les notifications par type
router.get('/by-type/:type', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const type = req.params.type.toUpperCase();
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    
    // Vérifier que le type est valide
    const validTypes = ['MESSAGE', 'FRIEND_REQUEST', 'MATCH', 'PROFILE_VIEW', 'SYSTEM'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Type de notification invalide'
      });
    }
    
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId,
          type
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: parseInt(limit)
      }),
      prisma.notification.count({
        where: {
          userId,
          type
        }
      })
    ]);
    
    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching notifications by type:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des notifications'
    });
  }
});

// Créer une notification de test (dev only)
if (process.env.NODE_ENV === 'development') {
  router.post('/test', authenticateToken, async (req, res) => {
    try {
      const { type = 'SYSTEM', title = 'Test', message = 'Notification de test' } = req.body;
      const userId = req.user.id;
      
      const notification = await prisma.notification.create({
        data: {
          userId,
          type,
          title,
          message,
          data: {
            test: true,
            timestamp: new Date()
          }
        }
      });
      
      // Envoyer via Socket.IO
      const io = getIo();
      if (io) {
        io.to(`user_${userId}`).emit('notification', notification);
      }
      
      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      console.error('Error creating test notification:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la création de la notification'
      });
    }
  });
}

// Statistiques des notifications
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const stats = await prisma.notification.groupBy({
      by: ['type'],
      where: {
        userId
      },
      _count: {
        id: true
      }
    });
    
    const unreadByType = await prisma.notification.groupBy({
      by: ['type'],
      where: {
        userId,
        isRead: false
      },
      _count: {
        id: true
      }
    });
    
    const formattedStats = stats.reduce((acc, stat) => {
      const unread = unreadByType.find(u => u.type === stat.type)?._count.id || 0;
      acc[stat.type] = {
        total: stat._count.id,
        unread
      };
      return acc;
    }, {});
    
    res.json({
      success: true,
      data: formattedStats
    });
  } catch (error) {
    console.error('Error fetching notification stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques'
    });
  }
});

module.exports = router;