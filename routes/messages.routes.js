// routes/messages.routes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authenticateToken');
const { prisma, getIo } = require('../config/shared');

// Obtenir les conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Récupérer d'abord la liste des amis
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        friends: { select: { id: true } },
        friendsOf: { select: { id: true } }
      }
    });
    
    const friendIds = [
      ...user.friends.map(f => f.id),
      ...user.friendsOf.map(f => f.id)
    ];
    
    // Récupérer uniquement les conversations avec des amis
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { 
            user1Id: userId,
            user2Id: { in: friendIds }
          },
          { 
            user2Id: userId,
            user1Id: { in: friendIds }
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
      }
    });
    
    // Formater les conversations
    const formattedConversations = conversations.map(conv => {
      const otherUser = conv.user1Id === userId ? conv.user2 : conv.user1;
      const unreadCount = conv.user1Id === userId ? conv.unreadCount1 : conv.unreadCount2;
      
      return {
        id: conv.id,
        otherUser: {
          ...otherUser,
          displayName: otherUser.nickname || `${otherUser.firstName} ${otherUser.lastName}`
        },
        lastMessage: conv.messages[0] || null,
        unreadCount,
        lastMessageAt: conv.lastMessageAt,
        createdAt: conv.createdAt
      };
    });
    
    res.json({
      success: true,
      data: formattedConversations
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des conversations'
    });
  }
});

// Obtenir les messages d'une conversation
router.get('/conversation/:conversationId', authenticateToken, async (req, res) => {
  try {
    const conversationId = parseInt(req.params.conversationId);
    const userId = req.user.id;
    
    // Vérifier que l'utilisateur fait partie de la conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        user1: true,
        user2: true
      }
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
    
    // Vérifier que les utilisateurs sont toujours amis
    const otherUserId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
    const friendship = await prisma.user.findFirst({
      where: {
        id: userId,
        OR: [
          { friends: { some: { id: otherUserId } } },
          { friendsOf: { some: { id: otherUserId } } }
        ]
      }
    });
    
    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: 'Vous devez être amis pour voir cette conversation'
      });
    }
    
    // Récupérer les messages
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
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
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    
    // Marquer les messages comme lus
    const updateField = conversation.user1Id === userId ? 'unreadCount1' : 'unreadCount2';
    
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
    
    // Notifier l'expéditeur via Socket
    const io = getIo();
    if (io) {
      io.to(`user_${otherUserId}`).emit('messagesRead', {
        conversationId,
        readBy: userId,
        timestamp: new Date()
      });
    }
    
    res.json({
      success: true,
      data: {
        conversation: {
          ...conversation,
          otherUser: conversation.user1Id === userId ? conversation.user2 : conversation.user1
        },
        messages
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
    const { receiverId, content, messageType = 'TEXT', replyToId } = req.body;
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
    
    // Créer le message
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        receiverId: receiverIdInt,
        content,
        messageType,
        replyToId: replyToId ? parseInt(replyToId) : null
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
    
    // Créer une notification
    await prisma.notification.create({
      data: {
        userId: receiverIdInt,
        type: 'MESSAGE',
        title: 'Nouveau message',
        message: `${message.sender.nickname || message.sender.firstName} vous a envoyé un message`,
        data: {
          conversationId: conversation.id,
          senderId
        }
      }
    });
    
    // Envoyer via Socket.IO
    const io = getIo();
    if (io) {
      io.to(`user_${receiverIdInt}`).emit('newMessage', {
        conversationId: conversation.id,
        message
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

// Modifier un message
router.put('/message/:messageId', authenticateToken, async (req, res) => {
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
router.delete('/message/:messageId', authenticateToken, async (req, res) => {
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
        deletedAt: new Date()
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

module.exports = router;