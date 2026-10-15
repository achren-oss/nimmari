/** NIMMARI_* settings take precedence; PUUMERKKI_* are deprecated aliases.
 * An explicitly empty new setting disables the legacy setting.
 */
export function nimmariEnv(name: string): string | undefined {
  return process.env[`NIMMARI_${name}`] ?? process.env[`PUUMERKKI_${name}`];
}
