// socketHandlers/messages.js
const { prisma } = require('../config/shared');

const setupMessageHandlers = (io, socket) => {
  console.log(`[Messages] Setting up message handlers for ${socket.id}`);

  // Typage en temps réel
  socket.on('private-typing', async ({ to, isTyping }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }
    
    // Vérifier que les utilisateurs sont amis
    const friendship = await prisma.user.findFirst({
      where: {
        id: socket.userId,
        OR: [
          { friends: { some: { id: to } } },
          { friendsOf: { some: { id: to } } }
        ]
      }
    });
    
    if (!friendship) {
      return;
    }
    
    // Notifier le destinataire
    io.to(`user_${to}`).emit('userTyping', {
      userId: socket.userId,
      isTyping
    });
  });

  // Message privé en temps réel (optionnel - les messages passent normalement par l'API REST)
  socket.on('private-message', async ({ receiverId, content, messageType = 'TEXT', replyToId }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }
    
    try {
      const receiverIdInt = parseInt(receiverId);
      
      // Vérifier l'amitié
      const friendship = await prisma.user.findFirst({
        where: {
          id: socket.userId,
          OR: [
            { friends: { some: { id: receiverIdInt } } },
            { friendsOf: { some: { id: receiverIdInt } } }
          ]
        }
      });
      
      if (!friendship) {
        socket.emit('error', { message: 'You must be friends to send messages' });
        return;
      }
      
      // Vérifier les blocages
      const block = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: socket.userId, blockedId: receiverIdInt },
            { blockerId: receiverIdInt, blockedId: socket.userId }
          ]
        }
      });
      
      if (block) {
        socket.emit('error', { message: 'Cannot send message to this user' });
        return;
      }
      
      // Trouver ou créer la conversation
      let conversation = await prisma.conversation.findFirst({
        where: {
          OR: [
            { user1Id: socket.userId, user2Id: receiverIdInt },
            { user1Id: receiverIdInt, user2Id: socket.userId }
          ]
        }
      });
      
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            user1Id: Math.min(socket.userId, receiverIdInt),
            user2Id: Math.max(socket.userId, receiverIdInt)
          }
        });
      }
      
      // Créer le message
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: socket.userId,
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
          replyTo: true
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
      
      // Créer notification
      const isMuted = (conversation.user1Id === receiverIdInt && conversation.isMuted1) ||
                      (conversation.user2Id === receiverIdInt && conversation.isMuted2);
      
      if (!isMuted) {
        await prisma.notification.create({
          data: {
            userId: receiverIdInt,
            type: 'MESSAGE',
            title: 'Nouveau message',
            message: `${message.sender.nickname || message.sender.firstName} vous a envoyé un message`,
            data: {
              conversationId: conversation.id,
              messageId: message.id,
              senderId: socket.userId
            }
          }
        });
      }
      
      // Confirmer l'envoi à l'expéditeur
      socket.emit('messageSent', {
        message,
        conversationId: conversation.id
      });
      
      // Envoyer au destinataire
      io.to(`user_${receiverIdInt}`).emit('newMessage', {
        conversationId: conversation.id,
        message,
        senderId: socket.userId,
        receiverId: receiverIdInt
      });
      
    } catch (error) {
      console.error('Error sending private message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Marquer les messages comme lus
  socket.on('mark-messages-read', async ({ conversationId }) => {
    if (!socket.userId) return;
    
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      });
      
      if (!conversation) return;
      
      if (conversation.user1Id !== socket.userId && conversation.user2Id !== socket.userId) {
        return;
      }
      
      const updateField = conversation.user1Id === socket.userId ? 'unreadCount1' : 'unreadCount2';
      const partnerId = conversation.user1Id === socket.userId ? conversation.user2Id : conversation.user1Id;
      
      // Transaction pour marquer comme lu
      const [updatedMessages] = await prisma.$transaction([
        prisma.message.updateMany({
          where: {
            conversationId,
            receiverId: socket.userId,
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
      io.to(`user_${partnerId}`).emit('messagesRead', {
        conversationId,
        readBy: socket.userId,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // Modifier un message
  socket.on('edit-message', async ({ messageId, newContent }) => {
    if (!socket.userId) return;
    
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId }
      });
      
      if (!message || message.senderId !== socket.userId) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }
      
      // Vérifier que le message n'est pas trop vieux
      const messageAge = Date.now() - new Date(message.createdAt).getTime();
      const maxEditTime = 24 * 60 * 60 * 1000; // 24 heures
      
      if (messageAge > maxEditTime) {
        socket.emit('error', { message: 'Message too old to edit' });
        return;
      }
      
      const updatedMessage = await prisma.message.update({
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
      
      // Notifier tous les participants
      io.to(`user_${message.receiverId}`).emit('messageEdited', {
        conversationId: message.conversationId,
        message: updatedMessage
      });
      
      socket.emit('messageEditSuccess', {
        message: updatedMessage
      });
      
    } catch (error) {
      console.error('Error editing message:', error);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  });

  // Supprimer un message
  socket.on('delete-message', async ({ messageId }) => {
    if (!socket.userId) return;
    
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId }
      });
      
      if (!message || message.senderId !== socket.userId) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }
      
      await prisma.message.update({
        where: { id: messageId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          content: '[Message supprimé]'
        }
      });
      
      // Notifier le destinataire
      io.to(`user_${message.receiverId}`).emit('messageDeleted', {
        conversationId: message.conversationId,
        messageId
      });
      
      socket.emit('messageDeleteSuccess', {
        messageId
      });
      
    } catch (error) {
      console.error('Error deleting message:', error);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });

  // Réaction à un message
  socket.on('react-to-message', async ({ messageId, emoji }) => {
    if (!socket.userId) return;
    
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          conversation: true
        }
      });
      
      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }
      
      // Vérifier que l'utilisateur fait partie de la conversation
      if (message.conversation.user1Id !== socket.userId && 
          message.conversation.user2Id !== socket.userId) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }
      
      // Créer ou mettre à jour la réaction
      const reaction = await prisma.messageReaction.upsert({
        where: {
          messageId_userId_emoji: {
            messageId,
            userId: socket.userId,
            emoji
          }
        },
        create: {
          messageId,
          userId: socket.userId,
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
      
      // Notifier tous les participants
      const partnerId = message.senderId === socket.userId 
        ? message.receiverId 
        : message.senderId;
        
      io.to(`user_${partnerId}`).emit('messageReaction', {
        conversationId: message.conversationId,
        messageId,
        reaction
      });
      
      socket.emit('reactionSuccess', {
        reaction
      });
      
    } catch (error) {
      console.error('Error reacting to message:', error);
      socket.emit('error', { message: 'Failed to add reaction' });
    }
  });

  // Supprimer une réaction
  socket.on('remove-reaction', async ({ messageId, emoji }) => {
    if (!socket.userId) return;
    
    try {
      await prisma.messageReaction.delete({
        where: {
          messageId_userId_emoji: {
            messageId,
            userId: socket.userId,
            emoji
          }
        }
      });
      
      const message = await prisma.message.findUnique({
        where: { id: messageId }
      });
      
      if (message) {
        const partnerId = message.senderId === socket.userId 
          ? message.receiverId 
          : message.senderId;
          
        io.to(`user_${partnerId}`).emit('messageReactionRemoved', {
          conversationId: message.conversationId,
          messageId,
          userId: socket.userId,
          emoji
        });
      }
      
      socket.emit('reactionRemoved', {
        messageId,
        emoji
      });
      
    } catch (error) {
      console.error('Error removing reaction:', error);
      socket.emit('error', { message: 'Failed to remove reaction' });
    }
  });

  // Obtenir le statut en ligne des amis
  socket.on('get-friends-status', async () => {
    if (!socket.userId) return;
    
    try {
      const user = await prisma.user.findUnique({
        where: { id: socket.userId },
        include: {
          friends: {
            select: {
              id: true,
              isOnline: true,
              lastSeen: true
            }
          },
          friendsOf: {
            select: {
              id: true,
              isOnline: true,
              lastSeen: true
            }
          }
        }
      });
      
      if (user) {
        const allFriends = [...user.friends, ...user.friendsOf];
        const uniqueFriends = Array.from(
          new Map(allFriends.map(f => [f.id, f])).values()
        );
        
        socket.emit('friendsStatus', {
          friends: uniqueFriends
        });
      }
    } catch (error) {
      console.error('Error getting friends status:', error);
    }
  });

  // Notifier l'ouverture d'une conversation (pour les indicateurs de lecture)
  socket.on('conversation-opened', async ({ conversationId }) => {
    if (!socket.userId || !conversationId) return;
    
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      });
      
      if (!conversation) return;
      
      const partnerId = conversation.user1Id === socket.userId 
        ? conversation.user2Id 
        : conversation.user1Id;
      
      // Notifier le partenaire que la conversation est ouverte
      io.to(`user_${partnerId}`).emit('conversationOpened', {
        conversationId,
        userId: socket.userId
      });
    } catch (error) {
      console.error('Error notifying conversation opened:', error);
    }
  });

  // Notifier la fermeture d'une conversation
  socket.on('conversation-closed', async ({ conversationId }) => {
    if (!socket.userId || !conversationId) return;
    
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
      });
      
      if (!conversation) return;
      
      const partnerId = conversation.user1Id === socket.userId 
        ? conversation.user2Id 
        : conversation.user1Id;
      
      // Notifier le partenaire
      io.to(`user_${partnerId}`).emit('conversationClosed', {
        conversationId,
        userId: socket.userId
      });
    } catch (error) {
      console.error('Error notifying conversation closed:', error);
    }
  });
};

module.exports = { setupMessageHandlers };