// Whether a CLI's command line asks for its usage: --help or -h where an option goes, not as the
// value an option takes (add-doodad-note X --use -h adds the use "-h").

/** Whether `args` hold --help or -h as an option, skipping the value after each of `valued`. */
export function helpAsked(args: readonly string[], valued: ReadonlySet<string>): boolean {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") return true;
    if (valued.has(args[i]!)) i++;
  }
  return false;
}

/** The value after option `name` at `i`; throws when there is none, or the next is another option. */
export function optionValue(args: readonly string[], i: number, name: string): string {
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}
