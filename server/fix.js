const fs = require('fs');
let content = fs.readFileSync('tests/utils/logger.test.js', 'utf8');

// Use regex with \r?\n for cross-platform matching
content = content.replace(
  / {8}\}\),\r?\n {6}\}\),\r?\n {4}process\.env\.NODE_ENV = originalEnv;/g,
  '        }),\n      }),\n    });\n    process.env.NODE_ENV = originalEnv;'
);

content = content.replace(
  / {2}generateCorrelationId,\r?\n {2}correlationIdMiddleware,/g,
  '  logger,\n  generateCorrelationId,\n  correlationIdMiddleware,'
);

// We already successfully replaced the malformed blocks if they were matched, but wait, those were strings too, so they might have failed because of \r\n!
// Let's use `\r?\n` in our regexes for everything if it failed.
// Wait, the previous script might have failed entirely. Let's just output if replacements worked.
fs.writeFileSync('tests/utils/logger.test.js', content);
console.log("Done");
