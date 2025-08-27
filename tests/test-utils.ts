import { ApolloServer } from "@apollo/server";
import jwt, { JwtPayload } from "jsonwebtoken";
import pino from "pino";
import { typeDefs } from "../src/typeDefs";
import { createResolvers } from "../src/resolvers";

type Role = "USER" | "ADMIN";
export type SafeUser = { username: string; role: Role };
export type User = SafeUser & { password: string };
export type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  createdBy: string;
};

const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

export function createToken(user: User) {
  return jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function decodeToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as JwtPayload & SafeUser;
}

export function makeLogger() {
  // quiet/fast logger for tests
  return pino({ enabled: false });
}

export function seedUsers(): User[] {
  return [
    { username: "user", password: "password", role: "USER" },
    { username: "admin", password: "admin", role: "ADMIN" },
  ];
}

export function seedTodos(): Todo[] {
  return [
    {
      id: "t1",
      text: "Seeded task",
      done: false,
      createdAt: new Date().toISOString(),
      createdBy: "system",
    },
  ];
}

export async function makeTestServer(opts?: {
  users?: User[];
  todos?: Todo[];
}) {
  const users = opts?.users ?? seedUsers();
  const todos = opts?.todos ?? seedTodos();
  const logger = makeLogger();

  const resolvers = createResolvers({
    users,
    todos,
    logger,
    createToken,
  });

  const server = new ApolloServer<{ user: SafeUser | null }>({
    typeDefs,
    resolvers,
  });

  await server.start();

  return { server, deps: { users, todos } };
}

export function assertSingle<T extends { body: unknown }>(
  res: T
): asserts res is T & { body: { kind: "single"; singleResult: any } } {
  const body: any = res.body;
  if (!(body && body.kind === "single" && "singleResult" in body)) {
    throw new Error("Expected a single GraphQL result (got incremental)");
  }
}

