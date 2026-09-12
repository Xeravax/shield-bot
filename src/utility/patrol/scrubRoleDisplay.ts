/** Strip to only A-z and . so role names can't inject formatting. */
export function scrubRoleDisplay(name: string): string {
  return name.replace(/[^a-zA-Z.]/g, "") || name;
}
