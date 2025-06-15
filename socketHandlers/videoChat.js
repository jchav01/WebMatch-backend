// socketHandlers/videoChat.js
const { prisma } = require('../config/shared');

const setupVideoChatHandlers = (io, socket, activeRooms) => {
  console.log(`[VideoChat] Setting up video chat handlers for ${socket.id}`);

  // Message dans une session vidéo
  socket.on('video-chat-message', async ({ roomId, message, messageType = 'TEXT' }) => {
    console.log(`[VideoChat] Message in room ${roomId}: ${message}`);
    
    const room = activeRooms.get(roomId);
    if (!room || !room.users.some(user => user.id === socket.id)) {
      socket.emit('error', { message: 'Not authorized for this room' });
      return;
    }
    
    // Enregistrer le message si les utilisateurs sont authentifiés
    if (socket.userId) {
      try {
        const videoSession = await prisma.videoSession.findUnique({
          where: { roomId }
        });
        
        if (videoSession) {
          const savedMessage = await prisma.videoSessionMessage.create({
            data: {
              videoSessionId: videoSession.id,
              senderId: socket.userId,
              content: message,
              messageType
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
          
          // Émettre le message avec les infos complètes
          socket.to(roomId).emit('video-chat-message', {
            id: savedMessage.id,
            message: savedMessage.content,
            messageType: savedMessage.messageType,
            sender: savedMessage.sender,
            timestamp: savedMessage.createdAt,
            roomId
          });
          
          // Confirmer à l'expéditeur
          socket.emit('video-chat-message-sent', {
            id: savedMessage.id,
            timestamp: savedMessage.createdAt
          });
        }
      } catch (error) {
        console.error('[VideoChat] Error saving message:', error);
      }
    } else {
      // Si non authentifié, juste transmettre le message
      socket.to(roomId).emit('video-chat-message', {
        message,
        messageType,
        sender: socket.id,
        timestamp: new Date(),
        roomId
      });
    }
  });

  // Typing indicator dans la session vidéo
  socket.on('video-chat-typing', ({ roomId, isTyping }) => {
    const room = activeRooms.get(roomId);
    if (!room || !room.users.some(user => user.id === socket.id)) {
      return;
    }
    
    socket.to(roomId).emit('video-chat-typing', {
      isTyping,
      sender: socket.id,
      userId: socket.userId
    });
  });

  // Récupérer l'historique des messages d'une session vidéo
  socket.on('get-video-chat-history', async ({ roomId }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }
    
    try {
      const videoSession = await prisma.videoSession.findUnique({
        where: { roomId },
        include: {
          messages: {
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
            },
            orderBy: {
              createdAt: 'asc'
            }
          }
        }
      });
      
      if (!videoSession) {
        socket.emit('video-chat-history', { messages: [] });
        return;
      }
      
      // Vérifier que l'utilisateur était dans cette session
      if (videoSession.user1Id !== socket.userId && videoSession.user2Id !== socket.userId) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }
      
      socket.emit('video-chat-history', {
        messages: videoSession.messages,
        sessionInfo: {
          startedAt: videoSession.startedAt,
          endedAt: videoSession.endedAt,
          duration: videoSession.duration
        }
      });
    } catch (error) {
      console.error('[VideoChat] Error fetching chat history:', error);
      socket.emit('error', { message: 'Failed to fetch chat history' });
    }
  });

  // Demande d'ajout en ami pendant la session vidéo
  socket.on('video-friend-request', async ({ roomId, message = '' }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const room = activeRooms.get(roomId);
    if (!room || !room.users.some(user => user.id === socket.id)) {
      socket.emit('error', { message: 'Not authorized for this room' });
      return;
    }
    
    try {
      // Trouver la session vidéo pour obtenir l'ID du partenaire
      const videoSession = await prisma.videoSession.findUnique({
        where: { roomId },
        include: {
          user1: true,
          user2: true
        }
      });
      
      if (!videoSession) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }
      
      const partnerId = videoSession.user1Id === socket.userId 
        ? videoSession.user2Id 
        : videoSession.user1Id;
      
      // Vérifier si déjà amis
      const existingFriendship = await prisma.user.findFirst({
        where: {
          id: socket.userId,
          OR: [
            { friends: { some: { id: partnerId } } },
            { friendsOf: { some: { id: partnerId } } }
          ]
        }
      });
      
      if (existingFriendship) {
        socket.emit('video-friend-request-error', {
          message: 'Vous êtes déjà amis'
        });
        return;
      }
      
      // Vérifier si une demande existe déjà
      const existingRequest = await prisma.friendRequest.findFirst({
        where: {
          OR: [
            { senderId: socket.userId, receiverId: partnerId, status: 'PENDING' },
            { senderId: partnerId, receiverId: socket.userId, status: 'PENDING' }
          ]
        }
      });
      
      if (existingRequest) {
        if (existingRequest.senderId === partnerId) {
          // L'autre a déjà envoyé une demande, l'accepter automatiquement
          await prisma.$transaction(async (tx) => {
            // Mettre à jour la demande
            await tx.friendRequest.update({
              where: { id: existingRequest.id },
              data: {
                status: 'ACCEPTED',
                respondedAt: new Date()
              }
            });
            
            // Créer l'amitié
            await tx.user.update({
              where: { id: existingRequest.senderId },
              data: {
                friends: {
                  connect: { id: existingRequest.receiverId }
                }
              }
            });
            
            // Notifier les deux utilisateurs
            io.to(roomId).emit('video-friend-request-accepted', {
              message: 'Vous êtes maintenant amis!',
              friendshipCreated: true
            });
            
            // Mettre à jour la session vidéo
            await tx.videoSession.update({
              where: { id: videoSession.id },
              data: {
                friendshipCreated: true
              }
            });
          });
          
          return;
        } else {
          socket.emit('video-friend-request-error', {
            message: 'Demande déjà envoyée'
          });
          return;
        }
      }
      
      // Créer la nouvelle demande d'ami
      const newRequest = await prisma.friendRequest.create({
        data: {
          senderId: socket.userId,
          receiverId: partnerId,
          message: message || `Demande d'ami suite à notre rencontre vidéo`
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
      
      // Créer une notification
      await prisma.notification.create({
        data: {
          userId: partnerId,
          type: 'FRIEND_REQUEST',
          title: 'Nouvelle demande d\'ami',
          message: `${newRequest.sender.nickname || newRequest.sender.firstName} souhaite vous ajouter comme ami`,
          data: {
            requestId: newRequest.id,
            senderId: socket.userId,
            fromVideoSession: true,
            roomId
          }
        }
      });
      
      // Notifier le partenaire dans la session
      socket.to(roomId).emit('video-friend-request-received', {
        request: newRequest,
        message: `${newRequest.sender.nickname || newRequest.sender.firstName} souhaite vous ajouter comme ami`
      });
      
      // Confirmer l'envoi
      socket.emit('video-friend-request-sent', {
        success: true,
        request: newRequest
      });
      
    } catch (error) {
      console.error('[VideoChat] Error sending friend request:', error);
      socket.emit('error', { message: 'Failed to send friend request' });
    }
  });

  // Accepter une demande d'ami pendant la session vidéo
  socket.on('video-friend-request-accept', async ({ roomId, requestId }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }
    
    try {
      const request = await prisma.friendRequest.findUnique({
        where: { id: requestId },
        include: {
          sender: true,
          receiver: true
        }
      });
      
      if (!request || request.receiverId !== socket.userId) {
        socket.emit('error', { message: 'Request not found or not authorized' });
        return;
      }
      
      // Accepter la demande
      await prisma.$transaction(async (tx) => {
        await tx.friendRequest.update({
          where: { id: requestId },
          data: {
            status: 'ACCEPTED',
            respondedAt: new Date()
          }
        });
        
        await tx.user.update({
          where: { id: request.senderId },
          data: {
            friends: {
              connect: { id: request.receiverId }
            }
          }
        });
        
        // Notification pour l'expéditeur
        await tx.notification.create({
          data: {
            userId: request.senderId,
            type: 'FRIEND_REQUEST',
            title: 'Demande acceptée',
            message: `${request.receiver.nickname || request.receiver.firstName} a accepté votre demande d'ami`,
            data: {
              friendId: request.receiverId
            }
          }
        });
      });
      
      // Notifier les deux utilisateurs dans la session
      io.to(roomId).emit('video-friend-request-accepted', {
        message: 'Vous êtes maintenant amis!',
        friendshipCreated: true
      });
      
      // Mettre à jour la session vidéo
      const videoSession = await prisma.videoSession.findUnique({
        where: { roomId }
      });
      
      if (videoSession) {
        await prisma.videoSession.update({
          where: { id: videoSession.id },
          data: {
            friendshipCreated: true
          }
        });
      }
      
    } catch (error) {
      console.error('[VideoChat] Error accepting friend request:', error);
      socket.emit('error', { message: 'Failed to accept friend request' });
    }
  });

  // Refuser une demande d'ami pendant la session vidéo
  socket.on('video-friend-request-reject', async ({ roomId, requestId }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }
    
    try {
      const request = await prisma.friendRequest.findUnique({
        where: { id: requestId }
      });
      
      if (!request || request.receiverId !== socket.userId) {
        socket.emit('error', { message: 'Request not found or not authorized' });
        return;
      }
      
      await prisma.friendRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          respondedAt: new Date()
        }
      });
      
      // Notifier l'expéditeur dans la session
      socket.to(roomId).emit('video-friend-request-rejected', {
        message: 'La demande d\'ami a été refusée'
      });
      
    } catch (error) {
      console.error('[VideoChat] Error rejecting friend request:', error);
      socket.emit('error', { message: 'Failed to reject friend request' });
    }
  });

  // Signaler un comportement inapproprié
  socket.on('report-user', async ({ roomId, reason, details }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }
    
    try {
      const videoSession = await prisma.videoSession.findUnique({
        where: { roomId }
      });
      
      if (!videoSession) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }
      
      const reportedUserId = videoSession.user1Id === socket.userId 
        ? videoSession.user2Id 
        : videoSession.user1Id;
      
      // Créer le signalement
      const report = await prisma.report.create({
        data: {
          reporterId: socket.userId,
          reportedId: reportedUserId,
          reason,
          details,
          context: 'VIDEO_CHAT',
          metadata: {
            roomId,
            videoSessionId: videoSession.id
          }
        }
      });
      
      console.log(`[VideoChat] User ${socket.userId} reported user ${reportedUserId} for ${reason}`);
      
      // Terminer la session
      socket.emit('report-submitted', {
        success: true,
        message: 'Signalement enregistré. La session va se terminer.'
      });
      
      // Déconnecter les deux utilisateurs
      const room = activeRooms.get(roomId);
      if (room) {
        room.users.forEach(user => {
          user.emit('session-terminated', {
            reason: 'report_submitted',
            message: 'La session a été terminée suite à un signalement'
          });
          user.leave(roomId);
        });
        
        activeRooms.delete(roomId);
      }
      
      // Mettre à jour la session
      await prisma.videoSession.update({
        where: { id: videoSession.id },
        data: {
          endedAt: new Date(),
          endReason: 'reported'
        }
      });
      
    } catch (error) {
      console.error('[VideoChat] Error reporting user:', error);
      socket.emit('error', { message: 'Failed to submit report' });
    }
  });

  // Envoyer un emoji/réaction
  socket.on('send-reaction', ({ roomId, reaction }) => {
    const room = activeRooms.get(roomId);
    if (!room || !room.users.some(user => user.id === socket.id)) {
      return;
    }
    
    socket.to(roomId).emit('reaction-received', {
      reaction,
      senderId: socket.id,
      senderUserId: socket.userId,
      timestamp: new Date()
    });
  });

  // Partage d'écran
  socket.on('screen-share-started', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (!room || !room.users.some(user => user.id === socket.id)) {
      return;
    }
    
    socket.to(roomId).emit('peer-screen-share-started', {
      peerId: socket.id
    });
  });

  socket.on('screen-share-stopped', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (!room || !room.users.some(user => user.id === socket.id)) {
      return;
    }
    
    socket.to(roomId).emit('peer-screen-share-stopped', {
      peerId: socket.id
    });
  });

  // Statistiques de qualité de connexion
  socket.on('connection-quality', async ({ roomId, quality }) => {
    if (!socket.userId) return;
    
    try {
      const videoSession = await prisma.videoSession.findUnique({
        where: { roomId }
      });
      
      if (videoSession) {
        // Enregistrer les métriques de qualité
        await prisma.videoSessionMetric.create({
          data: {
            videoSessionId: videoSession.id,
            userId: socket.userId,
            metricType: 'CONNECTION_QUALITY',
            value: quality,
            metadata: {
              timestamp: new Date()
            }
          }
        });
      }
    } catch (error) {
      console.error('[VideoChat] Error saving connection quality:', error);
    }
  });
};

module.exports = { setupVideoChatHandlers };