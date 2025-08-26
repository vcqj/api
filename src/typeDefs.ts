export const typeDefs = `
  type Todo { id: ID!, text: String!, done: Boolean!, createdAt: String!, createdBy: String! }
  type User { username: String!, role: String! }
  type AuthPayload { token: String!, user: User! }

  type Query {
    me: User
    todos: [Todo!]!
  }

  type Mutation {
    login(username: String!, password: String!): AuthPayload!
    addTodo(text: String!): Todo!
    toggleTodo(id: ID!, done: Boolean!): Todo!
    deleteTodo(id: ID!): Boolean!
  }
`;
