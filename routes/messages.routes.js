// routes/messages.routes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authenticateToken');
const { prisma, getIo } = require('../config/shared');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration multer pour les pièces jointes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/messages'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mp3|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé'));
    }
  }
});

// ===== CONVERSATIONS =====

// Obtenir toutes les conversations avec les derniers messages
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, archived = false } = req.query;
    const skip = (page - 1) * limit;
    
    // Récupérer les conversations où l'utilisateur est participant
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { 
            user1Id: userId,
            isArchived1: archived === 'true'
          },
          { 
            user2Id: userId,
            isArchived2: archived === 'true'
          }
        ]
      },
      include: {
        user1: {
          select: {
            id: true,
            username: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            isOnline: true,
            lastSeen: true
          }
        },
        user2: {
          select: {
            id: true,
            username: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            isOnline: true,
            lastSeen: true
          }
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          where: { isDeleted: false },
          select: {
            id: true,
            content: true,
            messageType: true,
            createdAt: true,
            senderId: true,
            isRead: true
          }
        }
      },
      orderBy: {
        lastMessageAt: 'desc'
      },
      skip,
      take: parseInt(limit)
    });
    
    // Vérifier que les participants sont toujours amis
    const formattedConversations = await Promise.all(conversations.map(async (conv) => {
      const partnerId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
      const partner = conv.user1Id === userId ? conv.user2 : conv.user1;
      
      // Vérifier l'amitié
      const friendship = await prisma.user.findFirst({
        where: {
          id: userId,
          OR: [
            { friends: { some: { id: partnerId } } },
            { friendsOf: { some: { id: partnerId } } }
          ]
        }
      });
      
      const unreadCount = conv.user1Id === userId ? conv.unreadCount1 : conv.unreadCount2;
      const isMuted = conv.user1Id === userId ? conv.isMuted1 : conv.isMuted2;
      
      return {
        id: conv.id,
        partner: {
          ...partner,
          displayName: partner.nickname || `${partner.firstName} ${partner.lastName}`
        },
        lastMessage: conv.messages[0] || null,
        unreadCount,
        isMuted,
        isFriend: !!friendship,
        lastMessageAt: conv.lastMessageAt,
        createdAt: conv.createdAt
      };
    }));
    
    // Compter le total pour la pagination
    const total = await prisma.conversation.count({
      where: {
        OR: [
          { 
            user1Id: userId,
            isArchived1: archived === 'true'
          },
          { 
            user2Id: userId,
            isArchived2: archived === 'true'
          }
        ]
      }
    });
    
    res.json({
      success: true,
      data: formattedConversations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des conversations'
    });
  }
});

// ===== MESSAGES =====

// Obtenir les messages d'une conversation avec un utilisateur spécifique
router.get('/conversation/:partnerId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const partnerId = parseInt(req.params.partnerId);
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;
    
    // Vérifier que les utilisateurs sont amis
    const friendship = await prisma.user.findFirst({
      where: {
        id: userId,
        OR: [
          { friends: { some: { id: partnerId } } },
          { friendsOf: { some: { id: partnerId } } }
        ]
      }
    });
    
    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: 'Vous devez être amis pour voir cette conversation'
      });
    }
    
    // Trouver ou créer la conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: partnerId },
          { user1Id: partnerId, user2Id: userId }
        ]
      }
    });
    
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          user1Id: Math.min(userId, partnerId),
          user2Id: Math.max(userId, partnerId)
        }
      });
    }
    
    // Récupérer les messages
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        isDeleted: false
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true
          }
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            senderId: true,
            sender: {
              select: {
                nickname: true,
                firstName: true
              }
            }
          }
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                firstName: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: parseInt(limit)
    });
    
    // Marquer les messages comme lus
    const updateField = conversation.user1Id === userId ? 'unreadCount1' : 'unreadCount2';
    
    await prisma.$transaction([
      prisma.message.updateMany({
        where: {
          conversationId: conversation.id,
          receiverId: userId,
          isRead: false
        },
        data: {
          isRead: true,
          readAt: new Date()
        }
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          [updateField]: 0
        }
      })
    ]);
    
    // Notifier l'expéditeur via Socket
    const io = getIo();
    if (io) {
      io.to(`user_${partnerId}`).emit('messagesRead', {
        conversationId: conversation.id,
        readBy: userId,
        timestamp: new Date()
      });
    }
    
    // Compter le total pour la pagination
    const total = await prisma.message.count({
      where: {
        conversationId: conversation.id,
        isDeleted: false
      }
    });
    
    res.json({
      success: true,
      data: {
        conversationId: conversation.id,
        messages: messages.reverse(), // Remettre dans l'ordre chronologique
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des messages'
    });
  }
});

// Envoyer un message
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiverId, content, messageType = 'TEXT', replyToId, metadata } = req.body;
    const senderId = req.user.id;
    
    if (!receiverId || !content) {
      return res.status(400).json({
        success: false,
        message: 'Destinataire et contenu requis'
      });
    }
    
    const receiverIdInt = parseInt(receiverId);
    
    // Vérifier que les utilisateurs sont amis
    const friendship = await prisma.user.findFirst({
      where: {
        id: senderId,
        OR: [
          { friends: { some: { id: receiverIdInt } } },
          { friendsOf: { some: { id: receiverIdInt } } }
        ]
      }
    });
    
    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: 'Vous devez être amis pour envoyer des messages'
      });
    }
    
    // Vérifier les blocages
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverIdInt },
          { blockerId: receiverIdInt, blockedId: senderId }
        ]
      }
    });
    
    if (block) {
      return res.status(403).json({
        success: false,
        message: 'Impossible d\'envoyer un message à cet utilisateur'
      });
    }
    
    // Trouver ou créer la conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        OR: [
          { user1Id: senderId, user2Id: receiverIdInt },
          { user1Id: receiverIdInt, user2Id: senderId }
        ]
      }
    });
    
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          user1Id: Math.min(senderId, receiverIdInt),
          user2Id: Math.max(senderId, receiverIdInt)
        }
      });
    }
    
    // Vérifier que la conversation n'est pas mutée par le destinataire
    const isMutedByReceiver = (conversation.user1Id === receiverIdInt && conversation.isMuted1) ||
                              (conversation.user2Id === receiverIdInt && conversation.isMuted2);
    
    // Créer le message
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        receiverId: receiverIdInt,
        content,
        messageType,
        replyToId: replyToId ? parseInt(replyToId) : null,
        metadata
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true
          }
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            senderId: true,
            sender: {
              select: {
                nickname: true,
                firstName: true
              }
            }
          }
        }
      }
    });
    
    // Mettre à jour la conversation
    const unreadField = conversation.user1Id === receiverIdInt ? 'unreadCount1' : 'unreadCount2';
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: content,
        lastMessageAt: new Date(),
        [unreadField]: { increment: 1 }
      }
    });
    
    // Créer une notification si pas muté
    if (!isMutedByReceiver) {
      await prisma.notification.create({
        data: {
          userId: receiverIdInt,
          type: 'MESSAGE',
          title: 'Nouveau message',
          message: `${message.sender.nickname || message.sender.firstName} vous a envoyé un message`,
          data: {
            conversationId: conversation.id,
            messageId: message.id,
            senderId
          }
        }
      });
    }
    
    // Envoyer via Socket.IO
    const io = getIo();
    if (io) {
      io.to(`user_${receiverIdInt}`).emit('newMessage', {
        conversationId: conversation.id,
        message,
        senderId,
        receiverId: receiverIdInt
      });
    }
    
    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du message'
    });
  }
});

// Upload de fichier
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier fourni'
      });
    }
    
    const fileUrl = `${process.env.BASE_URL}/uploads/messages/${req.file.filename}`;
    
    res.json({
      success: true,
      data: {
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'upload du fichier'
    });
  }
});

// Modifier un message
router.put('/:messageId', authenticateToken, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId);
    const { content } = req.body;
    const userId = req.user.id;
    
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message non trouvé'
      });
    }
    
    if (message.senderId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    // Vérifier que le message n'est pas trop vieux (24h)
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    const maxEditTime = 24 * 60 * 60 * 1000; // 24 heures
    
    if (messageAge > maxEditTime) {
      return res.status(400).json({
        success: false,
        message: 'Le message est trop ancien pour être modifié'
      });
    }
    
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        isEdited: true,
        editedAt: new Date()
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true
          }
        }
      }
    });
    
    // Notifier via Socket
    const io = getIo();
    if (io) {
      io.to(`user_${message.receiverId}`).emit('messageEdited', {
        conversationId: message.conversationId,
        message: updatedMessage
      });
    }
    
    res.json({
      success: true,
      data: updatedMessage
    });
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la modification du message'
    });
  }
});

// Supprimer un message (soft delete)
router.delete('/:messageId', authenticateToken, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId);
    const userId = req.user.id;
    
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message non trouvé'
      });
    }
    
    if (message.senderId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    await prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: '[Message supprimé]' // Optionnel: garder une trace
      }
    });
    
    // Notifier via Socket
    const io = getIo();
    if (io) {
      io.to(`user_${message.receiverId}`).emit('messageDeleted', {
        conversationId: message.conversationId,
        messageId
      });
    }
    
    res.json({
      success: true,
      message: 'Message supprimé'
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du message'
    });
  }
});

// ===== REACTIONS =====

// Ajouter une réaction à un message
router.post('/:messageId/react', authenticateToken, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId);
    const { emoji } = req.body;
    const userId = req.user.id;
    
    if (!emoji) {
      return res.status(400).json({
        success: false,
        message: 'Emoji requis'
      });
    }
    
    // Vérifier que le message existe et que l'utilisateur y a accès
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: true
      }
    });
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message non trouvé'
      });
    }
    
    // Vérifier que l'utilisateur fait partie de la conversation
    if (message.conversation.user1Id !== userId && message.conversation.user2Id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    // Créer ou mettre à jour la réaction
    const reaction = await prisma.messageReaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji
        }
      },
      create: {
        messageId,
        userId,
        emoji
      },
      update: {
        // Mis à jour de createdAt pour avoir l'ordre
        createdAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            firstName: true
          }
        }
      }
    });
    
    // Notifier via Socket
    const io = getIo();
    if (io) {
      const receiverId = message.senderId === userId ? message.receiverId : message.senderId;
      io.to(`user_${receiverId}`).emit('messageReaction', {
        conversationId: message.conversationId,
        messageId,
        reaction
      });
    }
    
    res.json({
      success: true,
      data: reaction
    });
  } catch (error) {
    console.error('Error adding reaction:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'ajout de la réaction'
    });
  }
});

// Supprimer une réaction
router.delete('/:messageId/react/:emoji', authenticateToken, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId);
    const emoji = req.params.emoji;
    const userId = req.user.id;
    
    await prisma.messageReaction.delete({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji
        }
      }
    });
    
    // Récupérer le message pour notifier
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });
    
    // Notifier via Socket
    const io = getIo();
    if (io && message) {
      const receiverId = message.senderId === userId ? message.receiverId : message.senderId;
      io.to(`user_${receiverId}`).emit('messageReactionRemoved', {
        conversationId: message.conversationId,
        messageId,
        userId,
        emoji
      });
    }
    
    res.json({
      success: true,
      message: 'Réaction supprimée'
    });
  } catch (error) {
    console.error('Error removing reaction:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de la réaction'
    });
  }
});

// ===== GESTION DES CONVERSATIONS =====

// Marquer une conversation comme lue
router.put('/read/:conversationId', authenticateToken, async (req, res) => {
  try {
    const conversationId = parseInt(req.params.conversationId);
    const userId = req.user.id;
    
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation non trouvée'
      });
    }
    
    if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    const updateField = conversation.user1Id === userId ? 'unreadCount1' : 'unreadCount2';
    const partnerId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
    
    await prisma.$transaction([
      prisma.message.updateMany({
        where: {
          conversationId,
          receiverId: userId,
          isRead: false
        },
        data: {
          isRead: true,
          readAt: new Date()
        }
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: {
          [updateField]: 0
        }
      })
    ]);
    
    // Notifier l'expéditeur
    const io = getIo();
    if (io) {
      io.to(`user_${partnerId}`).emit('messagesRead', {
        conversationId,
        readBy: userId,
        timestamp: new Date()
      });
    }
    
    res.json({
      success: true,
      message: 'Messages marqués comme lus'
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du marquage des messages'
    });
  }
});

// Archiver/désarchiver une conversation
router.put('/archive/:conversationId', authenticateToken, async (req, res) => {
  try {
    const conversationId = parseInt(req.params.conversationId);
    const userId = req.user.id;
    const { archive = true } = req.body;
    
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation non trouvée'
      });
    }
    
    if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    const updateField = conversation.user1Id === userId ? 'isArchived1' : 'isArchived2';
    
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        [updateField]: archive
      }
    });
    
    res.json({
      success: true,
      message: archive ? 'Conversation archivée' : 'Conversation désarchivée'
    });
  } catch (error) {
    console.error('Error archiving conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'archivage'
    });
  }
});

// Activer/désactiver les notifications d'une conversation
router.put('/mute/:conversationId', authenticateToken, async (req, res) => {
  try {
    const conversationId = parseInt(req.params.conversationId);
    const userId = req.user.id;
    const { mute = true } = req.body;
    
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation non trouvée'
      });
    }
    
    if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    const updateField = conversation.user1Id === userId ? 'isMuted1' : 'isMuted2';
    
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        [updateField]: mute
      }
    });
    
    res.json({
      success: true,
      message: mute ? 'Notifications désactivées' : 'Notifications activées'
    });
  } catch (error) {
    console.error('Error muting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la modification des notifications'
    });
  }
});

// Rechercher dans les messages
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { q, conversationId, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Requête de recherche trop courte (minimum 2 caractères)'
      });
    }
    
    const whereClause = {
      OR: [
        { senderId: userId },
        { receiverId: userId }
      ],
      content: {
        contains: q,
        mode: 'insensitive'
      },
      isDeleted: false
    };
    
    if (conversationId) {
      whereClause.conversationId = parseInt(conversationId);
    }
    
    const messages = await prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true
          }
        },
        conversation: {
          include: {
            user1: {
              select: {
                id: true,
                nickname: true,
                firstName: true,
                lastName: true
              }
            },
            user2: {
              select: {
                id: true,
                nickname: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });
    
    res.json({
      success: true,
      data: messages,
      count: messages.length
    });
  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la recherche'
    });
  }
});

// Obtenir les statistiques de messages
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [
      totalSent,
      totalReceived,
      unreadCount,
      activeConversations
    ] = await Promise.all([
      prisma.message.count({
        where: { senderId: userId, isDeleted: false }
      }),
      prisma.message.count({
        where: { receiverId: userId, isDeleted: false }
      }),
      prisma.message.count({
        where: { receiverId: userId, isRead: false, isDeleted: false }
      }),
      prisma.conversation.count({
        where: {
          OR: [
            { user1Id: userId },
            { user2Id: userId }
          ],
          lastMessageAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Actif dans les 30 derniers jours
          }
        }
      })
    ]);
    
    res.json({
      success: true,
      data: {
        totalSent,
        totalReceived,
        unreadCount,
        activeConversations
      }
    });
  } catch (error) {
    console.error('Error fetching message stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques'
    });
  }
});

module.exports = router;