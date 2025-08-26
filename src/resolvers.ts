import type pino from "pino";
import type { GraphQLContext } from "./index.js";

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

type Deps = {
  users: User[];
  todos: Todo[];
  logger: pino.Logger;
  createToken: (user: User) => string;
};

export function createResolvers({ users, todos, logger, createToken }: Deps) {
  function authGuard(ctx: GraphQLContext): asserts ctx is { user: SafeUser } {
    if (!ctx.user) throw new Error("Not authenticated");
  }
  function adminGuard(ctx: GraphQLContext): asserts ctx is { user: SafeUser } {
    authGuard(ctx);
    if (ctx.user.role !== "ADMIN") throw new Error("Admin only");
  }

  return {
    Query: {
      me: (_: unknown, __: unknown, ctx: GraphQLContext) => ctx.user || null,
      todos: () => todos,
    },
    Mutation: {
      login: (
        _: unknown,
        { username, password }: { username: string; password: string }
      ) => {
        logger.info({ hasUser: Boolean(username) }, "login_attempt");
        const user = users.find(
          (u) => u.username === username && u.password === password
        );
        if (!user) {
          logger.warn({ failed: true }, "login_failed");
          throw new Error("Invalid credentials");
        }
        const token = createToken(user);
        logger.info({ role: user.role }, "login_success"); // no username/PII
        const safeUser: SafeUser = { username: user.username, role: user.role };
        return { token, user: safeUser };
      },

      addTodo: (
        _: unknown,
        { text }: { text: string },
        ctx: GraphQLContext
      ) => {
        authGuard(ctx);
        const todo: Todo = {
          id: crypto.randomUUID
            ? crypto.randomUUID()
            : // fallback: keep parity with index.ts where data is seeded
              // (if needed, you can replace with uuidv4 and pass via deps)
              (Math.random().toString(36).slice(2) +
                Math.random().toString(36).slice(2)) as string,
          text,
          done: false,
          createdAt: new Date().toISOString(),
          createdBy: ctx.user.username,
        };
        todos.unshift(todo);
        logger.info({ id: todo.id }, "todo_added"); // no text/PII
        return todo;
      },

      toggleTodo: (
        _: unknown,
        { id, done }: { id: string; done: boolean },
        ctx: GraphQLContext
      ) => {
        authGuard(ctx);
        const t = todos.find((t) => t.id === id);
        if (!t) throw new Error("Not found");
        t.done = !!done;
        logger.info({ id, done: t.done }, "todo_toggled");
        return t;
      },

      deleteTodo: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
        adminGuard(ctx);
        const idx = todos.findIndex((t) => t.id === id);
        if (idx === -1) throw new Error("Not found");
        todos.splice(idx, 1);
        logger.warn({ id }, "todo_deleted");
        return true;
      },
    },
  };
}
