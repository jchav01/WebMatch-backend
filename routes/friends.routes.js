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
  try {
    const { receiverId, message } = req.body;
    const senderId = req.user.id;
    
    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: 'ID du destinataire requis'
      });
    }
    
    if (senderId === receiverId) {
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas vous ajouter vous-même'
      });
    }
    
    // Vérifier si l'utilisateur n'est pas bloqué
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId }
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
          { friends: { some: { id: receiverId } } },
          { friendsOf: { some: { id: receiverId } } }
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
          { senderId, receiverId, status: 'PENDING' },
          { senderId: receiverId, receiverId: senderId, status: 'PENDING' }
        ]
      }
    });
    
    if (existingRequest) {
      // Si c'est une demande inverse, l'accepter automatiquement
      if (existingRequest.senderId === receiverId) {
        return router.handle(req, res, () => {
          req.params.requestId = existingRequest.id;
          return acceptFriendRequest(req, res);
        });
      }
      
      return res.status(400).json({
        success: false,
        message: 'Une demande est déjà en cours'
      });
    }
    
    // Créer la demande et la notification
    const [newRequest] = await prisma.$transaction([
      prisma.friendRequest.create({
        data: {
          senderId,
          receiverId,
          message
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
      }),
      prisma.notification.create({
        data: {
          userId: receiverId,
          type: 'FRIEND_REQUEST',
          title: 'Nouvelle demande d\'ami',
          message: `${newRequest.sender.nickname || newRequest.sender.firstName} vous a envoyé une demande d'ami`,
          data: {
            requestId: newRequest.id,
            senderId: senderId
          }
        }
      })
    ]);
    
    // Notifier via Socket.IO
    getIo().to(`user_${receiverId}`).emit('friendRequestReceived', {
      request: newRequest,
      notification: {
        type: 'friend_request',
        message: `${newRequest.sender.nickname || newRequest.sender.firstName} vous a envoyé une demande d'ami`
      }
    });
    
    res.json({
      success: true,
      message: 'Demande envoyée avec succès',
      data: newRequest
    });
  } catch (error) {
    console.error('Error sending friend request:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi de la demande'
    });
  }
});

// Accepter une demande d'ami
const acceptFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
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
    const [updatedRequest] = await prisma.$transaction([
      // Mettre à jour le statut de la demande
      prisma.friendRequest.update({
        where: { id: requestId },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date()
        }
      }),
      // Créer la relation d'amitié
      prisma.user.update({
        where: { id: request.senderId },
        data: {
          friends: {
            connect: { id: request.receiverId }
          }
        }
      }),
      // Créer une notification pour l'expéditeur
      prisma.notification.create({
        data: {
          userId: request.senderId,
          type: 'FRIEND_REQUEST',
          title: 'Demande acceptée',
          message: `${request.receiver.nickname || request.receiver.firstName} a accepté votre demande d'ami`,
          data: {
            friendId: request.receiverId
          }
        }
      })
    ]);
    
    // Notifier l'expéditeur
    getIo().to(`user_${request.senderId}`).emit('friendRequestAccepted', {
      friend: request.receiver,
      notification: {
        type: 'friend_request_accepted',
        message: `${request.receiver.nickname || request.receiver.firstName} a accepté votre demande d'ami`
      }
    });
    
    res.json({
      success: true,
      message: 'Demande acceptée',
      data: updatedRequest
    });
  } catch (error) {
    console.error('Error accepting friend request:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'acceptation de la demande'
    });
  }
};

router.post('/accept-request/:requestId', authenticateToken, acceptFriendRequest);

// Rejeter une demande d'ami
router.post('/reject-request/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;
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
    const { friendId } = req.params;
    const userId = req.user.id;
    
    await prisma.$transaction(async (tx) => {
      // Supprimer la relation dans les deux sens
      await tx.user.update({
        where: { id: userId },
        data: {
          friends: {
            disconnect: { id: parseInt(friendId) }
          },
          friendsOf: {
            disconnect: { id: parseInt(friendId) }
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
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user.id;
    
    const friendship = await prisma.user.findFirst({
      where: {
        id: currentUserId,
        OR: [
          { friends: { some: { id: parseInt(targetUserId) } } },
          { friendsOf: { some: { id: parseInt(targetUserId) } } }
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
    const { userId: blockedId } = req.params;
    const { reason } = req.body;
    const blockerId = req.user.id;
    
    // Créer le blocage et supprimer l'amitié si elle existe
    await prisma.$transaction([
      // Créer le blocage
      prisma.block.create({
        data: {
          blockerId,
          blockedId: parseInt(blockedId),
          reason
        }
      }),
      // Supprimer l'amitié si elle existe
      prisma.user.update({
        where: { id: blockerId },
        data: {
          friends: {
            disconnect: { id: parseInt(blockedId) }
          },
          friendsOf: {
            disconnect: { id: parseInt(blockedId) }
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