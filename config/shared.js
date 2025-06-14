const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
let io = null;

module.exports = {
  prisma,
  getIo: () => io,
  setIo: (socketIo) => { io = socketIo; }
};