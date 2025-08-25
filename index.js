import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import pino from 'pino';
import pinoHttp from 'pino-http';

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret-change-me';

// --- Logging to shared volume for Fluent Bit ---
const logDir = process.env.LOG_DIR || '/var/log/app';
const logPath = `${logDir}/app.log`;
try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
const logger = pino({
  base: { app: 'todo-server' },
  // Redact secrets if they ever appear in custom logs
  redact: {
    paths: ['password', '*.password', 'token', '*.token'],
    censor: '[REDACTED]'
  },
  // Make timestamps easy for Fluent Bit to parse
  timestamp: pino.stdTimeFunctions.isoTime, // produces "time":"2025-08-25T12:00:00.000Z"
  // Align with Dashboards saved search
  messageKey: 'message'
}, fs.createWriteStream(logPath, { flags: 'a' }));

// --- In-memory users and data ---
const users = [
  { username: 'user', password: 'password', role: 'USER' },
  { username: 'admin', password: 'admin', role: 'ADMIN' },
];

const todos = [
  { id: uuidv4(), text: 'Try the demo', done: false, createdAt: new Date().toISOString(), createdBy: 'system' }
];

// --- GraphQL schema ---
const typeDefs = `#graphql
  type Todo { id: ID!, text: String!, done: Boolean!, createdAt: String!, createdBy: String! }
  type User { username: String!, role: String! }
  type AuthPayload { token: String!, user: User! }
  type Query { me: User, todos: [Todo!]! }
  type Mutation {
    login(username: String!, password: String!): AuthPayload!
    addTodo(text: String!): Todo!
    toggleTodo(id: ID!, done: Boolean!): Todo!
    deleteTodo(id: ID!): Boolean!
  }
`;

// --- Helpers ---
function createToken(user) {
  return jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function authGuard(context) {
  if (!context.user) throw new Error('Not authenticated');
}
function adminGuard(context) {
  authGuard(context);
  if (context.user.role !== 'ADMIN') throw new Error('Admin only');
}

// --- Resolvers ---
const resolvers = {
  Query: {
    me: (_, __, ctx) => ctx.user || null,
    todos: () => todos,
  },
  Mutation: {
    login: (_, { username, password }) => {
      logger.info({ hasUser: Boolean(username) }, 'login_attempt');
      const user = users.find(u => u.username === username && u.password === password);
      if (!user) { logger.warn({ failed: true }, 'login_failed'); throw new Error('Invalid credentials'); }
      const token = createToken(user);
      logger.info({ role: user.role }, 'login_success'); // no username/PII
      return { token, user: { username: user.username, role: user.role } };
    },
    addTodo: (_, { text }, ctx) => {
      authGuard(ctx);
      const todo = { id: uuidv4(), text, done: false, createdAt: new Date().toISOString(), createdBy: ctx.user.username };
      todos.unshift(todo);
      logger.info({ id: todo.id }, 'todo_added'); // no text/PII
      return todo;
    },
    toggleTodo: (_, { id, done }, ctx) => {
      authGuard(ctx);
      const t = todos.find(t => t.id === id);
      if (!t) throw new Error('Not found');
      t.done = !!done;
      logger.info({ id, done: t.done }, 'todo_toggled');
      return t;
    },
    deleteTodo: (_, { id }, ctx) => {
      adminGuard(ctx);
      const idx = todos.findIndex(t => t.id === id);
      if (idx === -1) throw new Error('Not found');
      todos.splice(idx, 1);
      logger.warn({ id }, 'todo_deleted');
      return true;
    },
  },
};

// --- Server bootstrap ---
const app = express();
app.use(cors());

// HTTP access logs (no headers/body)
app.use(pinoHttp({
  logger,
  autoLogging: true,
  customLogLevel: function (res, err) {
    if (err || (res && res.statusCode >= 500)) return 'error';
    if (res && res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customReceivedMessage: () => 'request_received',
  customSuccessMessage: () => 'request_completed',
  customErrorMessage: () => 'request_error',
  serializers: {
    req (req) { return { method: req.method, url: req.url } },
    res (res) { return { statusCode: res.statusCode } }
  }
}));

const apollo = new ApolloServer({ typeDefs, resolvers });
await apollo.start();

app.use('/graphql', bodyParser.json(), expressMiddleware(apollo, {
  context: async ({ req }) => {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7);
      try { const decoded = jwt.verify(token, JWT_SECRET); return { user: decoded }; }
      catch (e) { /* invalid token: unauthenticated */ }
    }
    return { user: null };
  },
}));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  logger.info({ port }, 'server_started');
  console.log(`GraphQL server ready at http://localhost:${port}/graphql`);
});

