'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');

const config = require('./config');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const postsRouter = require('./routes/posts');
const adminRouter = require('./routes/admin');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const prisma = new PrismaClient();
const app = express();

app.disable('x-powered-by');
app.locals.prisma = prisma;

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: config.security.bodyLimit }));
app.use(cookieParser());

if (config.env !== 'test') {
  app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'kt04 — REST API блог-платформы с аутентификацией',
    endpoints: {
      auth: '/auth',
      users: '/api/users',
      posts: '/api/posts',
      admin: '/admin',
      health: '/health',
    },
  });
});

app.use('/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use('/admin', adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
