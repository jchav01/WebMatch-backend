// scripts/resetFriends.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetAllFriendships() {
  try {
    console.log('🗑️  Suppression de toutes les amitiés...');
    
    // Supprimer toutes les relations d'amitié
    await prisma.$executeRaw`
      DELETE FROM "_UserFriends"
    `;
    
    console.log('✅ Toutes les amitiés ont été supprimées');
    
    // Optionnel : Supprimer aussi toutes les demandes d'amis
    const deletedRequests = await prisma.friendRequest.deleteMany({});
    console.log(`✅ ${deletedRequests.count} demandes d'amis supprimées`);
    
    // Optionnel : Supprimer les conversations existantes
    // const deletedConversations = await prisma.conversation.deleteMany({});
    // console.log(`✅ ${deletedConversations.count} conversations supprimées`);
    
  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Exécuter le script
resetAllFriendships();