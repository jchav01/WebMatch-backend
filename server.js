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

const { corsOptions, uploadsCorsOptions } = require('./middlewares/corsConfig');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const photosRoutes = require('./routes/photos.routes');
const preferencesRoutes = require('./routes/preferences.routes');
const exploreRoutes = require('./routes/exploreRoutes');

const app = express();
const prisma = new PrismaClient();
let roomCounter = 0;


const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use('/uploads', cors(uploadsCorsOptions), express.static(uploadDir));
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/user/preferences', preferencesRoutes);
app.use('/api/explore', exploreRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user', photosRoutes);

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

// État global pour la gestion des rooms et utilisateurs
const waitingUsers = new Set(); // Utilisateurs en attente
const activeRooms = new Map();  // Room ID -> { users: [socket1, socket2], info: {} }
const userRooms = new Map();    // Socket ID -> Room ID

// Utilitaires
const generateRoomId = () => `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const cleanupUser = (socket) => {
  // Retirer de la liste d'attente
  waitingUsers.delete(socket.id);
  
  // Nettoyer les rooms
  const roomId = userRooms.get(socket.id);
  if (roomId && activeRooms.has(roomId)) {
    const room = activeRooms.get(roomId);
    
    // Notifier l'autre utilisateur
    const otherUser = room.users.find(user => user.id !== socket.id);
    if (otherUser) {
      otherUser.emit('peer-disconnected', { peerId: socket.id });
    }
    
    // Supprimer la room
    activeRooms.delete(roomId);
    userRooms.delete(socket.id);
    
    // Nettoyer l'autre utilisateur aussi
    if (otherUser) {
      userRooms.delete(otherUser.id);
    }
  }
};

const createRoom = (user1, user2) => {
  const roomId = generateRoomId();
  
  // Déterminer qui est l'initiateur (aléatoirement)
  const isUser1Initiator = Math.random() < 0.5;
  
  // Créer la room
  activeRooms.set(roomId, {
    users: [user1, user2],
    created: Date.now(),
  });
  
  // Associer les utilisateurs à la room
  userRooms.set(user1.id, roomId);
  userRooms.set(user2.id, roomId);
  
  // Faire rejoindre les rooms Socket.IO
  user1.join(roomId);
  user2.join(roomId);
  
  // Notifier les utilisateurs
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

// Gestionnaires Socket.IO
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

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

  // Chat - Message
  socket.on('chat-message', ({ roomId, message, sender, timestamp }) => {
    console.log(`Message in room ${roomId}: ${message}`);
    
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

app.get('/stats', (req, res) => {
  res.json({
    connectedUsers: io.engine.clientsCount,
    waitingUsers: waitingUsers.size,
    activeRooms: activeRooms.size,
    rooms: Array.from(activeRooms.entries()).map(([id, room]) => ({
      id,
      userCount: room.users.length,
      created: room.created
    }))
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

// Clean shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM reçu, fermeture du serveur...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Serveur fermé');
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT reçu, fermeture du serveur...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('Serveur fermé');
  });
});