const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const logger = require('./config/logger');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const { corsOptions, uploadsCorsOptions } = require('./middlewares/corsConfig');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const photosRoutes = require('./routes/photos.routes');
const preferencesRoutes = require('./routes/preferences.routes');
const exploreRoutes = require('./routes/exploreRoutes');
const friendsRoutes = require('./routes/friends.routes');
const messagesRoutes = require('./routes/messages.routes');

const app = express();
const { prisma, setIo } = require('./config/shared');
let roomCounter = 0;


const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use('/uploads', cors(uploadsCorsOptions), express.static(uploadDir));
app.use(helmet());
app.use(cors({
  origin: '*',
  credentials: true
}));app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/user/preferences', preferencesRoutes);
app.use('/api/explore', exploreRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user', photosRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/messages', messagesRoutes);

// Logger dev
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route non trouvée'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Erreur serveur interne';

  // Log de l'erreur
  if (statusCode >= 500) {
    logger.error('Erreur serveur', { error: err });
  } else {
    logger.warn('Erreur applicative', { error: err });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// → IMPORTANT : maintenant on crée le http.Server ici :
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// → On branche Socket.IO sur ce server :
const io = new Server(server, {
  cors: {
    origin: '*', // TEMP pour dev → on pourra restreindre ensuite
    methods: ['GET', 'POST'],
  },
});

setIo(io);

// État global pour la gestion des rooms et utilisateurs
const waitingUsers = new Set(); // Utilisateurs en attente
const activeRooms = new Map();  // Room ID -> { users: [socket1, socket2], info: {} }
const userRooms = new Map();    // Socket ID -> Room ID
const authenticatedUsers = new Map();

// Utilitaires
const generateRoomId = () => `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Modifier la fonction cleanupUser pour gérer VideoSession au lieu de VideoCall :
const cleanupUser = async (socket) => {
  waitingUsers.delete(socket.id);
  
  const roomId = userRooms.get(socket.id);
  if (roomId && activeRooms.has(roomId)) {
    const room = activeRooms.get(roomId);
    
    const otherUser = room.users.find(user => user.id !== socket.id);
    if (otherUser) {
      otherUser.emit('peer-disconnected', { peerId: socket.id });
    }
    
    // Enregistrer la fin de la session vidéo si authentifié
    if (socket.userId) {
      try {
        const videoSession = await prisma.videoSession.findUnique({
          where: { roomId }
        });
        
        if (videoSession && !videoSession.endedAt) {
          const duration = videoSession.startedAt 
            ? Math.floor((new Date() - videoSession.startedAt) / 1000)
            : 0;
            
          await prisma.videoSession.update({
            where: { id: videoSession.id },
            data: {
              endedAt: new Date(),
              duration,
              endReason: 'user_disconnect'
            }
          });
        }
      } catch (error) {
        console.error('Error updating video session:', error);
      }
    }
    
    activeRooms.delete(roomId);
    userRooms.delete(socket.id);
    
    if (otherUser) {
      userRooms.delete(otherUser.id);
    }
  }
  
  // Mettre à jour le statut hors ligne si authentifié
  if (socket.userId) {
    authenticatedUsers.delete(socket.id);
    
    try {
      await prisma.user.update({
        where: { id: socket.userId },
        data: {
          isOnline: false,
          lastSeen: new Date()
        }
      });
      
      // Notifier les amis du statut hors ligne
      const user = await prisma.user.findUnique({
        where: { id: socket.userId },
        include: {
          friends: true,
          friendsOf: true
        }
      });
      
      if (user) {
        const allFriends = [...user.friends, ...user.friendsOf];
        const uniqueFriendIds = [...new Set(allFriends.map(f => f.id))];
        
        uniqueFriendIds.forEach(friendId => {
          io.to(`user_${friendId}`).emit('friendOffline', socket.userId);
        });
      }
    } catch (error) {
      console.error('Error updating offline status:', error);
    }
  }
};

const createRoom = async (user1, user2) => {
  const roomId = generateRoomId();
  const isUser1Initiator = Math.random() < 0.5;
  
  activeRooms.set(roomId, {
    users: [user1, user2],
    created: Date.now(),
  });
  
  userRooms.set(user1.id, roomId);
  userRooms.set(user2.id, roomId);
  
  user1.join(roomId);
  user2.join(roomId);
  
  // Créer un enregistrement VideoSession si les utilisateurs sont authentifiés
  if (user1.userId || user2.userId) {
    try {
      await prisma.videoSession.create({
        data: {
          roomId,
          user1Id: user1.userId || null,
          user2Id: user2.userId || null,
          sessionType: 'RANDOM'
        }
      });
    } catch (error) {
      console.error('Error creating video session:', error);
    }
  }
  
  user1.emit('match-found', { 
    roomId, 
    isInitiator: isUser1Initiator 
  });
  user2.emit('match-found', { 
    roomId, 
    isInitiator: !isUser1Initiator 
  });
  
  console.log(`Room created: ${roomId} with users ${user1.id} and ${user2.id}`);
  return roomId;
};

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { 
          id: true, 
          username: true,
          nickname: true,
          firstName: true,
          lastName: true,
          photoUrl: true 
        }
      });
      
      if (user) {
        socket.userId = user.id;
        socket.userInfo = user;
        authenticatedUsers.set(socket.id, user.id);
        
        // Mettre à jour le statut en ligne
        await prisma.user.update({
          where: { id: user.id },
          data: { 
            isOnline: true,
            lastSeen: new Date()
          }
        });
      }
    }
    next();
  } catch (err) {
    console.log('Socket auth error:', err.message);
    next(); // On laisse passer même sans auth pour le chat anonyme
  }
});

// Gestionnaires Socket.IO
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id} (${socket.userId || 'anonymous'})`);
  
  // Si authentifié, rejoindre la room personnelle et notifier les amis
  if (socket.userId) {
    socket.join(`user_${socket.userId}`);
    
    // Notifier les amis du statut en ligne
    prisma.user.findUnique({
      where: { id: socket.userId },
      include: {
        friends: true,
        friendsOf: true
      }
    }).then(user => {
      if (user) {
        const allFriends = [...user.friends, ...user.friendsOf];
        const uniqueFriendIds = [...new Set(allFriends.map(f => f.id))];
        
        uniqueFriendIds.forEach(friendId => {
          io.to(`user_${friendId}`).emit('friendOnline', socket.userId);
        });
      }
    }).catch(console.error);
  }

  // Chercher un partenaire
  socket.on('find-partner', () => {
    console.log(`User ${socket.id} looking for partner`);
    
    // Nettoyer d'abord l'utilisateur actuel
    cleanupUser(socket);
    
    // Vérifier s'il y a quelqu'un en attente
    if (waitingUsers.size > 0) {
      // Prendre le premier utilisateur en attente
      const waitingUserId = waitingUsers.values().next().value;
      const waitingUser = io.sockets.sockets.get(waitingUserId);
      
      if (waitingUser && waitingUser.connected) {
        // Retirer de la liste d'attente
        waitingUsers.delete(waitingUserId);
        
        // Créer une room
        createRoom(waitingUser, socket);
      } else {
        // L'utilisateur en attente n'est plus connecté
        waitingUsers.delete(waitingUserId);
        waitingUsers.add(socket.id);
      }
    } else {
      // Ajouter à la liste d'attente
      waitingUsers.add(socket.id);
      console.log(`User ${socket.id} added to waiting list`);
    }
  });

  // Rejoindre une room
  socket.on('join-room', (roomId) => {
    console.log(`User ${socket.id} joining room ${roomId}`);
    
    const room = activeRooms.get(roomId);
    if (room && room.users.some(user => user.id === socket.id)) {
      socket.join(roomId);
      
      // Vérifier si les deux utilisateurs sont dans la room
      const roomSockets = io.sockets.adapter.rooms.get(roomId);
      if (roomSockets && roomSockets.size === 2) {
        // Notifier que la room est prête
        io.to(roomId).emit('ready');
        console.log(`Room ${roomId} is ready`);
      }
    }
  });

  // Quitter une room
  socket.on('leave-room', ({ roomId }) => {
    console.log(`User ${socket.id} leaving room ${roomId}`);
    
    socket.leave(roomId);
    
    // Notifier l'autre utilisateur
    socket.to(roomId).emit('peer-disconnected', { peerId: socket.id });
    
    // Nettoyer
    cleanupUser(socket);
  });

  // Partager les informations utilisateur
  socket.on('user-info', ({ roomId, userProfile }) => {
    console.log(`User ${socket.id} sharing profile in room ${roomId}`);
    
    // Transmettre à l'autre utilisateur de la room
    socket.to(roomId).emit('user-info', {
      userProfile,
      sender: socket.id
    });
  });

  // Signaling WebRTC - Offer
  socket.on('offer', ({ roomId, offer }) => {
    console.log(`Offer from ${socket.id} in room ${roomId}`);
    
    socket.to(roomId).emit('offer', {
      offer,
      sender: socket.id
    });
  });

  // Signaling WebRTC - Answer
  socket.on('answer', ({ roomId, answer }) => {
    console.log(`Answer from ${socket.id} in room ${roomId}`);
    
    socket.to(roomId).emit('answer', {
      answer,
      sender: socket.id
    });
  });

  // Signaling WebRTC - ICE Candidate
  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', {
      candidate,
      sender: socket.id
    });
  });

  // Modifier l'événement chat-message pour sauvegarder dans VideoSessionMessage :
  socket.on('chat-message', async ({ roomId, message, sender, timestamp }) => {
    console.log(`Message in room ${roomId}: ${message}`);
    
    // Enregistrer le message dans l'historique de la session vidéo
    if (socket.userId) {
      try {
        const videoSession = await prisma.videoSession.findUnique({
          where: { roomId }
        });
        
        if (videoSession) {
          await prisma.videoSessionMessage.create({
            data: {
              videoSessionId: videoSession.id,
              senderId: socket.userId,
              content: message
            }
          });
        }
      } catch (error) {
        console.error('Error saving video chat message:', error);
      }
    }
    
    socket.to(roomId).emit('chat-message', {
      message,
      sender,
      timestamp
    });
  });

  // Chat - Typing indicator
  socket.on('typing', ({ roomId, isTyping }) => {
    socket.to(roomId).emit('typing', {
      isTyping,
      sender: socket.id
    });
  });

  // Déconnexion
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    cleanupUser(socket);
  });

    // Typage pour messagerie privée
  socket.on('private-typing', ({ to, isTyping }) => {
    if (socket.userId) {
      io.to(`user_${to}`).emit('userTyping', {
        userId: socket.userId,
        isTyping
      });
    }
  });

  // Message privé via Socket (optionnel, les messages passent plutôt par l'API REST)
  socket.on('private-message', async ({ receiverId, content, messageType = 'TEXT' }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }
    
    try {
      // Vérifier si les utilisateurs sont amis ou ont un match
      const [friendship, match] = await Promise.all([
        prisma.user.findFirst({
          where: {
            id: socket.userId,
            OR: [
              { friends: { some: { id: receiverId } } },
              { friendsOf: { some: { id: receiverId } } }
            ]
          }
        }),
        prisma.match.findFirst({
          where: {
            OR: [
              { user1Id: socket.userId, user2Id: receiverId, isActive: true },
              { user1Id: receiverId, user2Id: socket.userId, isActive: true }
            ]
          }
        })
      ]);
      
      if (!friendship && !match) {
        socket.emit('error', { message: 'You must be friends or have a match to send messages' });
        return;
      }
      
      // Utiliser la logique de l'API messages pour créer le message
      // ... (voir routes/messages.routes.js)
      
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
      
      const updateField = conversation.user1Id === socket.userId ? 'unreadCount1' : 'unreadCount2';
      const partnerId = conversation.user1Id === socket.userId ? conversation.user2Id : conversation.user1Id;
      
      await prisma.$transaction([
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
        readBy: socket.userId,
        conversationId,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });
});


// Routes API (optionnel)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    stats: {
      connectedUsers: io.engine.clientsCount,
      waitingUsers: waitingUsers.size,
      activeRooms: activeRooms.size
    }
  });
});


// Nettoyage périodique des rooms abandonnées
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  
  for (const [roomId, room] of activeRooms.entries()) {
    if (now - room.created > maxAge) {
      console.log(`Cleaning up old room: ${roomId}`);
      
      // Déconnecter les utilisateurs
      room.users.forEach(user => {
        if (user.connected) {
          user.emit('peer-disconnected', { reason: 'cleanup' });
        }
        userRooms.delete(user.id);
      });
      
      activeRooms.delete(roomId);
    }
  }
}, 5 * 60 * 1000); // Vérifier toutes les 5 minutes

// → On démarre le server http + WS ensemble :
server.listen(PORT, () => {
  console.log(`✅ Serveur + WebSocket démarré sur http://localhost:${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
});



// Modifier la route /stats pour inclure les nouvelles métriques :
app.get('/stats', async (req, res) => {
  try {
    const [
      totalUsers, 
      onlineUsers, 
      totalMessages, 
      activeVideoSessions,
      totalFriendships,
      pendingFriendRequests
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isOnline: true } }),
      prisma.message.count({ where: { isDeleted: false } }),
      prisma.videoSession.count({ where: { endedAt: null } }),
      prisma.user.findMany({
        select: {
          _count: {
            select: { friends: true }
          }
        }
      }).then(users => users.reduce((sum, user) => sum + user._count.friends, 0) / 2),
      prisma.friendRequest.count({ where: { status: 'PENDING' } })
    ]);
    
    res.json({
      connectedSockets: io.engine.clientsCount,
      waitingUsers: waitingUsers.size,
      activeRooms: activeRooms.size,
      authenticatedUsers: authenticatedUsers.size,
      database: {
        totalUsers,
        onlineUsers,
        totalMessages,
        activeVideoSessions,
        totalFriendships,
        pendingFriendRequests
      },
      rooms: Array.from(activeRooms.entries()).map(([id, room]) => ({
        id,
        userCount: room.users.length,
        created: room.created
      }))
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Dans le clean shutdown, mettre tous les utilisateurs hors ligne :
process.on('SIGTERM', async () => {
  console.log('SIGTERM reçu, fermeture du serveur...');
  
  // Mettre tous les utilisateurs hors ligne
  await prisma.user.updateMany({
    where: { isOnline: true },
    data: { isOnline: false, lastSeen: new Date() }
  });
  
  // Terminer toutes les sessions vidéo actives
  await prisma.videoSession.updateMany({
    where: { endedAt: null },
    data: { 
      endedAt: new Date(),
      endReason: 'server_shutdown'
    }
  });
  
  await prisma.$disconnect();
  server.close(() => {
    console.log('Serveur fermé');
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT reçu, fermeture du serveur...');
  
  // Mettre tous les utilisateurs hors ligne
  await prisma.user.updateMany({
    where: { isOnline: true },
    data: { isOnline: false, lastSeen: new Date() }
  });
  
  // Terminer toutes les sessions vidéo actives
  await prisma.videoSession.updateMany({
    where: { endedAt: null },
    data: { 
      endedAt: new Date(),
      endReason: 'server_shutdown'
    }
  });
  
  await prisma.$disconnect();
  server.close(() => {
    console.log('Serveur fermé');
  });
});

module.exports.prisma = prisma;
module.exports.io = io;