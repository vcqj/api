import { makeTestServer, decodeToken, seedTodos, assertSingle } from "./test-utils";

const queries = {
  ME: /* GraphQL */ `
    query Me {
      me { username role }
    }
  `,
  TODOS: /* GraphQL */ `
    query Todos {
      todos { id text done createdBy createdAt }
    }
  `,
};

const mutations = {
  LOGIN: /* GraphQL */ `
    mutation Login($u: String!, $p: String!) {
      login(username: $u, password: $p) {
        token
        user { username role }
      }
    }
  `,
  ADD_TODO: /* GraphQL */ `
    mutation Add($text: String!) {
      addTodo(text: $text) { id text done createdBy }
    }
  `,
  TOGGLE_TODO: /* GraphQL */ `
    mutation Toggle($id: ID!, $done: Boolean!) {
      toggleTodo(id: $id, done: $done) { id done }
    }
  `,
  DELETE_TODO: /* GraphQL */ `
    mutation Delete($id: ID!) {
      deleteTodo(id: $id)
    }
  `,
};

describe("GraphQL API", () => {
  test("me returns null when unauthenticated", async () => {
    const { server } = await makeTestServer();
    const res = await server.executeOperation({ query: queries.ME }, { contextValue: { user: null } });
    assertSingle(res);
    expect(res.body.kind).toBe("single");
    expect(res.body.singleResult.errors).toBeUndefined();
    expect(res.body.singleResult.data?.me).toBeNull();
    await server.stop();
  });

  test("login succeeds with valid creds and returns a decodable JWT", async () => {
    const { server } = await makeTestServer();
    const res = await server.executeOperation(
      { query: mutations.LOGIN, variables: { u: "user", p: "password" } },
      { contextValue: { user: null } }
    );
    assertSingle(res);

    expect(res.body.kind).toBe("single");
    const payload = res.body.singleResult.data?.login;
    expect(payload.user).toEqual({ username: "user", role: "USER" });
    expect(typeof payload.token).toBe("string");
    const decoded = decodeToken(payload.token);
    expect(decoded).toMatchObject({ username: "user", role: "USER" });

    await server.stop();
  });

  test("login fails with invalid creds", async () => {
    const { server } = await makeTestServer();
    const res = await server.executeOperation(
      { query: mutations.LOGIN, variables: { u: "user", p: "WRONG" } },
      { contextValue: { user: null } }
    );

    assertSingle(res);

    expect(res.body.kind).toBe("single");
    expect(res.body.singleResult.errors?.[0].message).toMatch(/invalid credentials/i);
    await server.stop();
  });

  test("todos returns seeded data", async () => {
    const seeded = seedTodos();
    const { server } = await makeTestServer({ todos: seeded });
    const res = await server.executeOperation({ query: queries.TODOS }, { contextValue: { user: null } });
    assertSingle(res);
    expect(res.body.kind).toBe("single");
    const list = res.body.singleResult.data?.todos;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("t1");
    await server.stop();
  });

  test("addTodo requires auth", async () => {
    const { server } = await makeTestServer();
    const res = await server.executeOperation(
      { query: mutations.ADD_TODO, variables: { text: "New task" } },
      { contextValue: { user: null } }
    );
    assertSingle(res);
    expect(res.body.kind).toBe("single");
    expect(res.body.singleResult.errors?.[0].message).toMatch(/not authenticated/i);
    await server.stop();
  });

  test("addTodo creates a todo with current user as creator", async () => {
    const { server, deps } = await makeTestServer({ todos: [] });
    const ctx = { user: { username: "user", role: "USER" as const } };

    const res = await server.executeOperation(
      { query: mutations.ADD_TODO, variables: { text: "Ship it" } },
      { contextValue: ctx }
    );
    assertSingle(res);

    expect(res.body.kind).toBe("single");
    const todo = res.body.singleResult.data?.addTodo;
    expect(todo.text).toBe("Ship it");
    expect(todo.done).toBe(false);
    expect(todo.createdBy).toBe("user");
    expect(deps.todos.length).toBe(1); // actually stored
    await server.stop();
  });

  test("toggleTodo flips done state", async () => {
    const { server, deps } = await makeTestServer({
      todos: [{ id: "abc", text: "Flip me", done: false, createdAt: new Date().toISOString(), createdBy: "user" }],
    });

    const ctx = { user: { username: "user", role: "USER" as const } };
    const res = await server.executeOperation(
      { query: mutations.TOGGLE_TODO, variables: { id: "abc", done: true } },
      { contextValue: ctx }
    );
    assertSingle(res);

    expect(res.body.kind).toBe("single");
    expect(res.body.singleResult.data?.toggleTodo).toEqual({ id: "abc", done: true });
    expect(deps.todos.find(t => t.id === "abc")?.done).toBe(true);
    await server.stop();
  });

  test("toggleTodo errors if not found", async () => {
    const { server } = await makeTestServer({ todos: [] });
    const ctx = { user: { username: "user", role: "USER" as const } };
    const res = await server.executeOperation(
      { query: mutations.TOGGLE_TODO, variables: { id: "nope", done: true } },
      { contextValue: ctx }
    );
    assertSingle(res);
    expect(res.body.kind).toBe("single");
    expect(res.body.singleResult.errors?.[0].message).toMatch(/not found/i);
    await server.stop();
  });

  test("deleteTodo requires ADMIN", async () => {
    const { server } = await makeTestServer({
      todos: [{ id: "rip", text: "Remove me", done: false, createdAt: new Date().toISOString(), createdBy: "user" }],
    });

    // Non-admin attempt -> should fail
    const userCtx = { user: { username: "user", role: "USER" as const } };
    const fail = await server.executeOperation(
      { query: mutations.DELETE_TODO, variables: { id: "rip" } },
      { contextValue: userCtx }
    );
    assertSingle(fail);
    expect(fail.body.kind).toBe("single");
    expect(fail.body.singleResult.errors?.[0].message).toMatch(/admin only/i);

    // Admin attempt -> should succeed
    const adminCtx = { user: { username: "admin", role: "ADMIN" as const } };
    const ok = await server.executeOperation(
      { query: mutations.DELETE_TODO, variables: { id: "rip" } },
      { contextValue: adminCtx }
    );
    assertSingle(ok);
    expect(ok.body.kind).toBe("single");
    expect(ok.body.singleResult.data?.deleteTodo).toBe(true);

    await server.stop();
  });
});
