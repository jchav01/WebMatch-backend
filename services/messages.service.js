// services/messages.service.backend.js
const { prisma } = require('../config/shared');
const AppError = require('../utils/AppError');

class MessagesService {
  // Créer ou récupérer une conversation
  async getOrCreateConversation(user1Id, user2Id) {
    // S'assurer que user1Id < user2Id pour l'unicité
    const [minId, maxId] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];
    
    let conversation = await prisma.conversation.findFirst({
      where: {
        OR: [
          { user1Id: minId, user2Id: maxId },
          { user1Id: maxId, user2Id: minId }
        ]
      }
    });
    
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          user1Id: minId,
          user2Id: maxId
        }
      });
    }
    
    return conversation;
  }

  // Vérifier si deux utilisateurs peuvent communiquer
  async canCommunicate(userId1, userId2) {
    // Vérifier l'amitié
    const friendship = await prisma.user.findFirst({
      where: {
        id: userId1,
        OR: [
          { friends: { some: { id: userId2 } } },
          { friendsOf: { some: { id: userId2 } } }
        ]
      }
    });
    
    if (!friendship) {
      return { allowed: false, reason: 'not_friends' };
    }
    
    // Vérifier les blocages
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId1, blockedId: userId2 },
          { blockerId: userId2, blockedId: userId1 }
        ]
      }
    });
    
    if (block) {
      return { allowed: false, reason: 'blocked' };
    }
    
    return { allowed: true };
  }

  // Envoyer un message
  async sendMessage(senderId, receiverId, content, options = {}) {
    const { messageType = 'TEXT', attachments = null, replyToId = null, metadata = null } = options;
    
    // Vérifications
    const canCommunicate = await this.canCommunicate(senderId, receiverId);
    if (!canCommunicate.allowed) {
      throw new AppError(
        canCommunicate.reason === 'not_friends' 
          ? 'Vous devez être amis pour envoyer des messages'
          : 'Communication bloquée',
        403
      );
    }
    
    // Obtenir ou créer la conversation
    const conversation = await this.getOrCreateConversation(senderId, receiverId);
    
    // Créer le message
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        receiverId,
        content,
        messageType,
        attachments,
        replyToId,
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
          include: {
            sender: {
              select: {
                id: true,
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
      }
    });
    
    // Mettre à jour la conversation
    const unreadField = conversation.user1Id === receiverId ? 'unreadCount1' : 'unreadCount2';
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: content,
        lastMessageAt: new Date(),
        [unreadField]: { increment: 1 }
      }
    });
    
    // Créer une notification si non muté
    const isMuted = (conversation.user1Id === receiverId && conversation.isMuted1) ||
                    (conversation.user2Id === receiverId && conversation.isMuted2);
    
    if (!isMuted) {
      await this.createMessageNotification(message);
    }
    
    return { message, conversation };
  }

  // Créer une notification pour un message
  async createMessageNotification(message) {
    try {
      await prisma.notification.create({
        data: {
          userId: message.receiverId,
          type: 'MESSAGE',
          title: 'Nouveau message',
          message: `${message.sender.nickname || message.sender.firstName} vous a envoyé un message`,
          data: {
            conversationId: message.conversationId,
            messageId: message.id,
            senderId: message.senderId
          }
        }
      });
    } catch (error) {
      console.error('Error creating message notification:', error);
    }
  }

  // Marquer les messages comme lus
  async markMessagesAsRead(conversationId, userId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });
    
    if (!conversation) {
      throw new AppError('Conversation non trouvée', 404);
    }
    
    if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
      throw new AppError('Non autorisé', 403);
    }
    
    const updateField = conversation.user1Id === userId ? 'unreadCount1' : 'unreadCount2';
    
    const [updatedMessages] = await prisma.$transaction([
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
    
    return updatedMessages;
  }

  // Obtenir les conversations avec pagination et filtres
  async getConversations(userId, options = {}) {
    const { 
      page = 1, 
      limit = 20, 
      archived = false,
      search = null 
    } = options;
    
    const skip = (page - 1) * limit;
    
    const whereClause = {
      OR: [
        { 
          user1Id: userId,
          isArchived1: archived
        },
        { 
          user2Id: userId,
          isArchived2: archived
        }
      ]
    };
    
    // Ajouter la recherche si fournie
    if (search) {
      whereClause.AND = {
        OR: [
          {
            user1: {
              OR: [
                { nickname: { contains: search, mode: 'insensitive' } },
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } }
              ]
            }
          },
          {
            user2: {
              OR: [
                { nickname: { contains: search, mode: 'insensitive' } },
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } }
              ]
            }
          }
        ]
      };
    }
    
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: whereClause,
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
        take: limit
      }),
      prisma.conversation.count({ where: whereClause })
    ]);
    
    return {
      conversations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Obtenir les messages d'une conversation
  async getMessages(conversationId, userId, options = {}) {
    const { page = 1, limit = 50 } = options;
    const skip = (page - 1) * limit;
    
    // Vérifier l'accès à la conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });
    
    if (!conversation) {
      throw new AppError('Conversation non trouvée', 404);
    }
    
    if (conversation.user1Id !== userId && conversation.user2Id !== userId) {
      throw new AppError('Non autorisé', 403);
    }
    
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
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
            include: {
              sender: {
                select: {
                  id: true,
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
        take: limit
      }),
      prisma.message.count({
        where: {
          conversationId,
          isDeleted: false
        }
      })
    ]);
    
    return {
      messages: messages.reverse(), // Remettre dans l'ordre chronologique
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  // Supprimer un message
  async deleteMessage(messageId, userId) {
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });
    
    if (!message) {
      throw new AppError('Message non trouvé', 404);
    }
    
    if (message.senderId !== userId) {
      throw new AppError('Non autorisé', 403);
    }
    
    return await prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: '[Message supprimé]'
      }
    });
  }

  // Modifier un message
  async editMessage(messageId, userId, newContent) {
    const message = await prisma.message.findUnique({
      where: { id: messageId }
    });
    
    if (!message) {
      throw new AppError('Message non trouvé', 404);
    }
    
    if (message.senderId !== userId) {
      throw new AppError('Non autorisé', 403);
    }
    
    // Vérifier que le message n'est pas trop vieux (24h)
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    const maxEditTime = 24 * 60 * 60 * 1000;
    
    if (messageAge > maxEditTime) {
      throw new AppError('Le message est trop ancien pour être modifié', 400);
    }
    
    return await prisma.message.update({
      where: { id: messageId },
      data: {
        content: newContent,
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
  }

  // Ajouter une réaction
  async addReaction(messageId, userId, emoji) {
    // Vérifier l'accès au message
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: true
      }
    });
    
    if (!message) {
      throw new AppError('Message non trouvé', 404);
    }
    
    if (message.conversation.user1Id !== userId && message.conversation.user2Id !== userId) {
      throw new AppError('Non autorisé', 403);
    }
    
    return await prisma.messageReaction.upsert({
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
  }

  // Supprimer une réaction
  async removeReaction(messageId, userId, emoji) {
    return await prisma.messageReaction.delete({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji
        }
      }
    });
  }

  // Rechercher dans les messages
  async searchMessages(userId, query, options = {}) {
    const { conversationId = null, limit = 20 } = options;
    
    const whereClause = {
      OR: [
        { senderId: userId },
        { receiverId: userId }
      ],
      content: {
        contains: query,
        mode: 'insensitive'
      },
      isDeleted: false
    };
    
    if (conversationId) {
      whereClause.conversationId = conversationId;
    }
    
    return await prisma.message.findMany({
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
      take: limit
    });
  }
}

module.exports = new MessagesService();