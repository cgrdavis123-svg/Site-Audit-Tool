const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function colorize(text, color) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

export function createLogger({ quiet = false, verbose = false } = {}) {
  return {
    info: (msg) => !quiet && console.error(colorize('ℹ', 'blue') + '  ' + msg),
    success: (msg) => !quiet && console.error(colorize('✔', 'green') + '  ' + msg),
    warn: (msg) => !quiet && console.error(colorize('⚠', 'yellow') + '  ' + msg),
    error: (msg) => console.error(colorize('✘', 'red') + '  ' + msg),
    debug: (msg) => verbose && !quiet && console.error(colorize('•', 'gray') + '  ' + msg),
    progress: (msg) => {
      if (quiet || !process.stdout.isTTY) return;
      process.stderr.write(`\r${colorize('→', 'cyan')}  ${msg}`.padEnd(120));
    },
    endProgress: () => {
      if (quiet || !process.stdout.isTTY) return;
      process.stderr.write('\n');
    }
  };
}

export { colorize };
