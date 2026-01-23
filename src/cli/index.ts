#!/usr/bin/env node

import { dev, build } from './commands';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (!command) {
    console.log('Usage: satset <command>');
    console.log('');
    console.log('Commands:');
    console.log('  dev            Start development server');
    console.log('  build          Build for production');
    process.exit(0);
  }

  switch (command) {
    case 'dev':
      await dev();
      break;

    case 'build':
      await build();
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});