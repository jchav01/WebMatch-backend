// routes/messages.routes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authenticateToken');
const { prisma, getIo } = require('../config/shared');


// Obtenir ou créer une conversation
const getOrCreateConversation = async (user1Id, user2Id) => {
  // Toujours ordonner les IDs de la même façon
  const [smallerId, largerId] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];
  
  let conversation = await prisma.conversation.findUnique({
    where: {
      user1Id_user2Id: {
        user1Id: smallerId,
        user2Id: largerId
      }
    }
  });
  
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        user1Id: smallerId,
        user2Id: largerId
      }
    });
  }
  
  return conversation;
};

// Obtenir toutes les conversations
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { user1Id: userId },
          { user2Id: userId }
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
          orderBy: {
            createdAt: 'desc'
          },
          take: 1,
          where: {
            isDeleted: false
          }
        }
      },
      orderBy: {
        lastMessageAt: 'desc'
      }
    });
    
    // Formatter les conversations
    const formattedConversations = conversations.map(conv => {
      const partner = conv.user1Id === userId ? conv.user2 : conv.user1;
      const unreadCount = conv.user1Id === userId ? conv.unreadCount1 : conv.unreadCount2;
      
      return {
        id: conv.id,
        partner: {
          ...partner,
          displayName: partner.nickname || `${partner.firstName} ${partner.lastName}`
        },
        lastMessage: conv.messages[0] || null,
        lastMessageAt: conv.lastMessageAt,
        unreadCount
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
router.get('/conversation/:partnerId', authenticateToken, async (req, res) => {
  try {
    const { partnerId } = req.params;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;
    
    // Vérifier si les utilisateurs sont amis ou ont un match
    const [friendship, match] = await Promise.all([
      prisma.user.findFirst({
        where: {
          id: userId,
          OR: [
            { friends: { some: { id: parseInt(partnerId) } } },
            { friendsOf: { some: { id: parseInt(partnerId) } } }
          ]
        }
      }),
      prisma.match.findFirst({
        where: {
          OR: [
            { user1Id: userId, user2Id: parseInt(partnerId), isActive: true },
            { user1Id: parseInt(partnerId), user2Id: userId, isActive: true }
          ]
        }
      })
    ]);
    
    if (!friendship && !match) {
      return res.status(403).json({
        success: false,
        message: 'Vous devez être amis ou avoir un match pour voir les messages'
      });
    }
    
    // Obtenir la conversation
    const conversation = await getOrCreateConversation(userId, parseInt(partnerId));
    
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
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit),
      skip: (parseInt(page) - 1) * parseInt(limit)
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
    
    // Notifier l'expéditeur que les messages ont été lus
    getIo().to(`user_${partnerId}`).emit('messagesRead', {
      readBy: userId,
      conversationId: conversation.id,
      timestamp: new Date()
    });
    
    res.json({
      success: true,
      data: messages.reverse(), // Remettre dans l'ordre chronologique
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: messages.length === parseInt(limit)
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
    const { receiverId, content, messageType = 'TEXT', attachments, replyToId } = req.body;
    const senderId = req.user.id;
    
    if (!receiverId || !content) {
      return res.status(400).json({
        success: false,
        message: 'Destinataire et contenu requis'
      });
    }
    
    // Vérifier si l'utilisateur n'est pas bloqué
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: parseInt(receiverId) },
          { blockerId: parseInt(receiverId), blockedId: senderId }
        ]
      }
    });
    
    if (block) {
      return res.status(403).json({
        success: false,
        message: 'Impossible d\'envoyer un message à cet utilisateur'
      });
    }
    
    // Vérifier si les utilisateurs sont amis ou ont un match
    const [friendship, match] = await Promise.all([
      prisma.user.findFirst({
        where: {
          id: senderId,
          OR: [
            { friends: { some: { id: parseInt(receiverId) } } },
            { friendsOf: { some: { id: parseInt(receiverId) } } }
          ]
        }
      }),
      prisma.match.findFirst({
        where: {
          OR: [
            { user1Id: senderId, user2Id: parseInt(receiverId), isActive: true },
            { user1Id: parseInt(receiverId), user2Id: senderId, isActive: true }
          ]
        }
      })
    ]);
    
    if (!friendship && !match) {
      return res.status(403).json({
        success: false,
        message: 'Vous devez être amis ou avoir un match pour envoyer des messages'
      });
    }
    
    // Obtenir ou créer la conversation
    const conversation = await getOrCreateConversation(senderId, parseInt(receiverId));
    
    // Créer le message et mettre à jour la conversation
    const [message] = await prisma.$transaction(async (tx) => {
      // Créer le message
      const newMessage = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId,
          receiverId: parseInt(receiverId),
          content,
          messageType,
          attachments,
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
              senderId: true
            }
          }
        }
      });
      
      // Mettre à jour la conversation
      const unreadField = conversation.user1Id === parseInt(receiverId) 
        ? 'unreadCount1' 
        : 'unreadCount2';
      
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          lastMessage: content.substring(0, 100), // Limiter à 100 caractères
          [unreadField]: { increment: 1 }
        }
      });
      
      // Créer une notification
      await tx.notification.create({
        data: {
          userId: parseInt(receiverId),
          type: 'MESSAGE',
          title: 'Nouveau message',
          message: `${newMessage.sender.nickname || newMessage.sender.firstName} vous a envoyé un message`,
          data: {
            senderId,
            conversationId: conversation.id,
            messageId: newMessage.id
          }
        }
      });
      
      return newMessage;
    });
    
    // Émettre le message via Socket.IO
    getIo().to(`user_${receiverId}`).emit('newMessage', {
      message: {
        ...message,
        sender: {
          ...message.sender,
          displayName: message.sender.nickname || `${message.sender.firstName} ${message.sender.lastName}`
        }
      },
      conversationId: conversation.id,
      notification: {
        type: 'new_message',
        message: `Nouveau message de ${message.sender.nickname || message.sender.firstName}`
      }
    });
    
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
router.put('/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    
    const message = await prisma.message.findUnique({
      where: { id: parseInt(messageId) }
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
      where: { id: parseInt(messageId) },
      data: {
        content,
        isEdited: true,
        editedAt: new Date()
      }
    });
    
    // Notifier le destinataire
    getIo().to(`user_${message.receiverId}`).emit('messageEdited', {
      messageId: message.id,
      conversationId: message.conversationId,
      newContent: content
    });
    
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
    const { messageId } = req.params;
    const userId = req.user.id;
    
    const message = await prisma.message.findUnique({
      where: { id: parseInt(messageId) }
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
    
    const deletedMessage = await prisma.message.update({
      where: { id: parseInt(messageId) },
      data: {
        isDeleted: true,
        deletedAt: new Date()
      }
    });
    
    // Notifier le destinataire
    getIo().to(`user_${message.receiverId}`).emit('messageDeleted', {
      messageId: message.id,
      conversationId: message.conversationId
    });
    
    res.json({
      success: true,
      message: 'Message supprimé',
      data: deletedMessage
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du message'
    });
  }
});

// Obtenir le nombre de messages non lus
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { user1Id: userId, unreadCount1: { gt: 0 } },
          { user2Id: userId, unreadCount2: { gt: 0 } }
        ]
      }
    });
    
    const totalUnread = conversations.reduce((sum, conv) => {
      return sum + (conv.user1Id === userId ? conv.unreadCount1 : conv.unreadCount2);
    }, 0);
    
    res.json({
      success: true,
      data: { unreadCount: totalUnread }
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du comptage des messages non lus'
    });
  }
});

module.exports = router;