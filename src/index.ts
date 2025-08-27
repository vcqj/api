import "dotenv/config";
import express from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import pino from "pino";
import pinoHttp from "pino-http";

import { typeDefs } from "./typeDefs.js";
import { createResolvers } from "./resolvers.js";

const JWT_SECRET = process.env.JWT_SECRET || "devsecret-change-me";

// --- Logging to shared volume for Fluent Bit ---
const logDir = process.env.LOG_DIR || "/var/log/app";
const logPath = `${logDir}/app.log`;
try {
  fs.mkdirSync(logDir, { recursive: true });
} catch {}
const logger = pino.default(
  {
    base: { app: "todo-server" },
    redact: {
      paths: ["password", "*.password", "token", "*.token"],
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: "message",
  },
  fs.createWriteStream(logPath, { flags: "a" })
);

// --- In-memory users and data ---
type Role = "USER" | "ADMIN";
type User = { username: string; password: string; role: Role };
type SafeUser = { username: string; role: Role };
type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  createdBy: string;
};
export type GraphQLContext = { user: SafeUser | null };

const users: User[] = [
  { username: "user", password: "password", role: "USER" },
  { username: "admin", password: "admin", role: "ADMIN" },
];

const todos: Todo[] = [
  {
    id: uuidv4(),
    text: "Try the demo",
    done: false,
    createdAt: new Date().toISOString(),
    createdBy: "system",
  },
];

// --- Helpers ---
function createToken(user: User) {
  return jwt.sign(
    { username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// --- Resolvers (with dependencies injected) ---
const resolvers = createResolvers({ users, todos, logger, createToken, makeID: uuidv4 });

// --- Server bootstrap ---
const app = express();
app.use(cors());

// HTTP access logs (no headers/body)
app.use(
  pinoHttp.default({
    logger,
    autoLogging: true,
    customLogLevel(res, err) {
      if (err || (res && typeof res.statusCode === "number" && res.statusCode >= 500)) return "error";
      if (res && typeof res.statusCode === "number" && res.statusCode >= 400) return "warn";
      return "info";
    },
    customReceivedMessage: () => "request_received",
    customSuccessMessage: () => "request_completed",
    customErrorMessage: () => "request_error",
    serializers: {
      req(req) {
        return { method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

const apollo = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
await apollo.start();

app.use(
  "/graphql",
  bodyParser.json(),
  expressMiddleware(apollo, {
    context: async ({ req }): Promise<GraphQLContext> => {
      const auth = req.headers.authorization || "";
      if (auth.startsWith("Bearer ")) {
        const token = auth.slice(7);
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as SafeUser;
          return { user: decoded };
        } catch {
          // invalid/expired token -> unauthenticated
        }
      }
      return { user: null };
    },
  })
);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  logger.info({ port }, "server_started");
  console.log(`GraphQL server ready at http://localhost:${port}/graphql`);
});
