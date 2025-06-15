// routes/friends.routes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middlewares/authenticateToken');
const { prisma, getIo } = require('../config/shared');

// Obtenir la liste d'amis
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        friends: {
          select: {
            id: true,
            username: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            isOnline: true,
            lastSeen: true,
            bio: true,
            city: true,
            country: true
          }
        },
        friendsOf: {
          select: {
            id: true,
            username: true,
            nickname: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            isOnline: true,
            lastSeen: true,
            bio: true,
            city: true,
            country: true
          }
        }
      }
    });
    
    // Combiner les deux listes d'amis
    const allFriends = [...user.friends, ...user.friendsOf];
    const uniqueFriends = Array.from(new Map(allFriends.map(f => [f.id, f])).values());
    
    res.json({
      success: true,
      data: uniqueFriends.map(friend => ({
        ...friend,
        displayName: friend.nickname || `${friend.firstName} ${friend.lastName}`
      }))
    });
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des amis'
    });
  }
});

// Obtenir les demandes d'amis
router.get('/requests', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [received, sent] = await Promise.all([
      prisma.friendRequest.findMany({
        where: {
          receiverId: userId,
          status: 'PENDING'
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              nickname: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
              bio: true,
              city: true,
              country: true,
              isOnline: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.friendRequest.findMany({
        where: {
          senderId: userId,
          status: 'PENDING'
        },
        include: {
          receiver: {
            select: {
              id: true,
              username: true,
              nickname: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
              bio: true,
              city: true,
              country: true,
              isOnline: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
    ]);
    
    res.json({
      success: true,
      data: { 
        received: received.map(req => ({
          ...req,
          sender: {
            ...req.sender,
            displayName: req.sender.nickname || `${req.sender.firstName} ${req.sender.lastName}`
          }
        })),
        sent: sent.map(req => ({
          ...req,
          receiver: {
            ...req.receiver,
            displayName: req.receiver.nickname || `${req.receiver.firstName} ${req.receiver.lastName}`
          }
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching friend requests:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des demandes'
    });
  }
});

// Envoyer une demande d'ami
router.post('/send-request', authenticateToken, async (req, res) => {
  console.log('Request body:', req.body);
  console.log('User ID:', req.user.id);
  try {
    const { receiverId, receiverUsername, message } = req.body;
    const senderId = req.user.id;
    
    // Accepter soit l'ID soit le username
    let receiverIdInt;
    
    if (receiverId) {
      // Si on a un ID, l'utiliser
      receiverIdInt = parseInt(receiverId);
    } else if (receiverUsername) {
      // Si on a un username, chercher l'utilisateur
      const receiver = await prisma.user.findUnique({
        where: { username: receiverUsername },
        select: { id: true }
      });
      
      if (!receiver) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé'
        });
      }
      
      receiverIdInt = receiver.id;
    } else {
      return res.status(400).json({
        success: false,
        message: 'ID ou username du destinataire requis'
      });
    }
    
    if (senderId === receiverIdInt) {
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas vous ajouter vous-même'
      });
    }
    
    // Vérifier si l'utilisateur n'est pas bloqué
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
        message: 'Impossible d\'envoyer une demande à cet utilisateur'
      });
    }
    
    // Vérifier si déjà amis
    const existingFriendship = await prisma.user.findFirst({
      where: {
        id: senderId,
        OR: [
          { friends: { some: { id: receiverIdInt } } },
          { friendsOf: { some: { id: receiverIdInt } } }
        ]
      }
    });
    
    if (existingFriendship) {
      return res.status(400).json({
        success: false,
        message: 'Vous êtes déjà amis'
      });
    }
    
    // Vérifier si une demande existe déjà
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId: receiverIdInt, status: 'PENDING' },
          { senderId: receiverIdInt, receiverId: senderId, status: 'PENDING' }
        ]
      }
    });
    
    if (existingRequest) {
      // Si c'est une demande inverse, l'accepter automatiquement
      if (existingRequest.senderId === receiverIdInt) {
        req.params.requestId = existingRequest.id;
        return acceptFriendRequest(req, res);
      }
      
      return res.status(400).json({
        success: false,
        message: 'Une demande est déjà en cours'
      });
    }
    
    // Créer la demande d'ami
    const newRequest = await prisma.friendRequest.create({
      data: {
        senderId,
        receiverId: receiverIdInt,
        message: message || null
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
    
    // Créer la notification
    try {
      await prisma.notification.create({
        data: {
          userId: receiverIdInt,
          type: 'FRIEND_REQUEST',
          title: 'Nouvelle demande d\'ami',
          message: `${newRequest.sender.nickname || newRequest.sender.firstName} vous a envoyé une demande d'ami`,
          data: {
            requestId: newRequest.id,
            senderId: senderId
          }
        }
      });
    } catch (notifError) {
      console.error('Error creating notification:', notifError);
    }
    
    // Notifier via Socket.IO
    if (getIo()) {
      getIo().to(`user_${receiverIdInt}`).emit('friendRequestReceived', {
        request: newRequest,
        notification: {
          type: 'friend_request',
          message: `${newRequest.sender.nickname || newRequest.sender.firstName} vous a envoyé une demande d'ami`
        }
      });
    }
    
    res.json({
      success: true,
      message: 'Demande envoyée avec succès',
      data: newRequest
    });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi de la demande',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Fonction acceptFriendRequest
const acceptFriendRequest = async (req, res) => {
  try {
    const requestId = parseInt(req.params.requestId);
    const userId = req.user.id;
    
    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
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
        receiver: {
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
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Demande non trouvée'
      });
    }
    
    if (request.receiverId !== userId && request.senderId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    if (request.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: 'Cette demande a déjà été traitée'
      });
    }
    
    // Transaction pour accepter la demande et créer l'amitié
    const updatedRequest = await prisma.$transaction(async (tx) => {
      // Mettre à jour le statut de la demande
      const updated = await tx.friendRequest.update({
        where: { id: requestId },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date()
        }
      });
      
      // Créer la relation d'amitié
      await tx.user.update({
        where: { id: request.senderId },
        data: {
          friends: {
            connect: { id: request.receiverId }
          }
        }
      });
      
      // Créer une notification pour l'expéditeur
      try {
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
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
      }
      
      return updated;
    });
    
    // Notifier l'expéditeur via Socket.IO
    if (getIo()) {
      getIo().to(`user_${request.senderId}`).emit('friendRequestAccepted', {
        friend: request.receiver,
        notification: {
          type: 'friend_request_accepted',
          message: `${request.receiver.nickname || request.receiver.firstName} a accepté votre demande d'ami`
        }
      });
    }
    
    res.json({
      success: true,
      message: 'Demande acceptée',
      data: updatedRequest
    });
  } catch (error) {
    console.error('Error accepting friend request:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'acceptation de la demande',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

router.post('/accept-request/:requestId', authenticateToken, acceptFriendRequest);

// Rejeter une demande d'ami
router.post('/reject-request/:requestId', authenticateToken, async (req, res) => {
  try {
    const requestId = parseInt(req.params.requestId);
    const userId = req.user.id;
    
    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId }
    });
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Demande non trouvée'
      });
    }
    
    if (request.receiverId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Non autorisé'
      });
    }
    
    const updatedRequest = await prisma.friendRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        respondedAt: new Date()
      }
    });
    
    res.json({
      success: true,
      message: 'Demande rejetée',
      data: updatedRequest
    });
  } catch (error) {
    console.error('Error rejecting friend request:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du rejet de la demande'
    });
  }
});

// Supprimer un ami
router.delete('/remove/:friendId', authenticateToken, async (req, res) => {
  try {
    const friendId = parseInt(req.params.friendId);
    const userId = req.user.id;
    
    await prisma.$transaction(async (tx) => {
      // Supprimer la relation dans les deux sens
      await tx.user.update({
        where: { id: userId },
        data: {
          friends: {
            disconnect: { id: friendId }
          },
          friendsOf: {
            disconnect: { id: friendId }
          }
        }
      });
    });
    
    res.json({
      success: true,
      message: 'Ami supprimé'
    });
  } catch (error) {
    console.error('Error removing friend:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'ami'
    });
  }
});

// Vérifier si deux utilisateurs sont amis
router.get('/check/:userId', authenticateToken, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    const currentUserId = req.user.id;
    
    const friendship = await prisma.user.findFirst({
      where: {
        id: currentUserId,
        OR: [
          { friends: { some: { id: targetUserId } } },
          { friendsOf: { some: { id: targetUserId } } }
        ]
      }
    });
    
    res.json({
      success: true,
      data: {
        isFriend: !!friendship
      }
    });
  } catch (error) {
    console.error('Error checking friendship:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification'
    });
  }
});

// Bloquer un utilisateur
router.post('/block/:userId', authenticateToken, async (req, res) => {
  try {
    const blockedId = parseInt(req.params.userId);
    const { reason } = req.body;
    const blockerId = req.user.id;
    
    // Créer le blocage et supprimer l'amitié si elle existe
    await prisma.$transaction([
      // Créer le blocage
      prisma.block.create({
        data: {
          blockerId,
          blockedId,
          reason
        }
      }),
      // Supprimer l'amitié si elle existe
      prisma.user.update({
        where: { id: blockerId },
        data: {
          friends: {
            disconnect: { id: blockedId }
          },
          friendsOf: {
            disconnect: { id: blockedId }
          }
        }
      })
    ]);
    
    res.json({
      success: true,
      message: 'Utilisateur bloqué'
    });
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du blocage'
    });
  }
});

module.exports = router;