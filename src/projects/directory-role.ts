export function isBoardRole(role: string) {
  return /^(?:board(?: of directors)?|board (?:chair(?:person)?|vice[ -]chair|director|member)|(?:chair(?:person)?|vice[ -]chair|director|member) of the board)$/i.test(role.trim());
}
