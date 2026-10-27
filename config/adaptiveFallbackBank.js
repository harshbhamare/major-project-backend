/**
 * Adaptive Fallback Question Bank
 *
 * Provides rich, domain-aware, non-repeating assessment questions across all 6 formats:
 * - mcq
 * - code_tracing
 * - debugging
 * - code_completion
 * - scenario_based
 * - short_answer
 *
 * Each question is tailored to real computer science and engineering curriculum concepts
 * (Node.js, Asynchronous JavaScript, CommonJS Modules, npm, Kotlin, Java, MongoDB, etc.)
 * with authentic code snippets, realistic developer bugs, and clear pedagogical explanations.
 */

function detectDomain(topic = '', topicSummary = '') {
  const s = `${topic} ${topicSummary}`.toLowerCase();
  if (s.includes('kotlin') || s.includes('null safety') || s.includes('elvis')) return 'kotlin';
  if (s.includes('java ') || s.includes('jvm') || s.includes('object-oriented') || s.includes('constructor') || s.includes('classes and objects') || s.includes('methods for code')) return 'java';
  if (s.includes('mongo') || s.includes('nosql') || s.includes('document') || s.includes('collection') || s.includes('bson')) return 'mongodb';
  if (s.includes('async') || s.includes('promise') || s.includes('event loop') || s.includes('callback') || s.includes('await') || s.includes('microtask')) return 'nodejs_async';
  if (s.includes('npm') || s.includes('package.json') || s.includes('package-lock') || s.includes('dependencies') || s.includes('devdependencies')) return 'nodejs_npm';
  if (s.includes('module') || s.includes('commonjs') || s.includes('require(') || s.includes('exports') || s.includes('structuring code')) return 'nodejs_modules';
  if (s.includes('file system') || s.includes('fs.') || s.includes('node.js') || s.includes('runtime') || s.includes('stream')) return 'nodejs_runtime';
  if (s.includes('adaptive') || s.includes('pedagog') || s.includes('learner') || s.includes('mastery') || s.includes('bloom')) return 'adaptive_learning';
  return 'general_cs';
}

// ─── Domain-Specific Question Matrix ──────────────────────────────────────────

const DOMAIN_BANKS = {
  // ── 1. Node.js Asynchronous Operations, Promises & Event Loop ──────────────
  nodejs_async: {
    mcq: [
      {
        questionText: 'What is the console output order for this asynchronous Node.js execution?',
        codeSnippet: `console.log('1: Start');\nsetTimeout(() => console.log('2: Timeout'), 0);\nPromise.resolve().then(() => console.log('3: Promise'));\nconsole.log('4: End');`,
        options: [
          '1: Start -> 4: End -> 3: Promise -> 2: Timeout',
          '1: Start -> 2: Timeout -> 3: Promise -> 4: End',
          '1: Start -> 3: Promise -> 4: End -> 2: Timeout',
          '1: Start -> 4: End -> 2: Timeout -> 3: Promise',
        ],
        correctAnswer: '1: Start -> 4: End -> 3: Promise -> 2: Timeout',
        explanation: 'Synchronous statements execute immediately on the call stack (1, 4). The microtask queue (Promise.then) drains next (3). Finally, the macrotask/timer queue callback fires (2).',
      },
      {
        questionText: 'How does Promise.all() behave when one of the passed Promises rejects?',
        options: [
          'It rejects immediately with the error of the first rejected Promise, ignoring unresolved promises',
          'It waits for all promises to settle regardless of errors and returns an array of errors',
          'It automatically retries the rejected Promise 3 times before failing',
          'It replaces the rejected promise value with null and resolves successfully',
        ],
        correctAnswer: 'It rejects immediately with the error of the first rejected Promise, ignoring unresolved promises',
        explanation: 'Promise.all uses fast-fail behavior: as soon as any single promise rejects, the entire Promise.all immediately rejects with that error.',
      },
      {
        questionText: 'What occurs if an async function does not contain an explicit "return" statement?',
        options: [
          'It implicitly resolves to a Promise resolving to undefined',
          'It throws an unhandled runtime ReferenceError',
          'It pauses execution indefinitely awaiting a return statement',
          'It returns null synchronously without creating a Promise',
        ],
        correctAnswer: 'It implicitly resolves to a Promise resolving to undefined',
        explanation: 'Async functions always return a Promise. If no return statement is specified, the returned Promise resolves to undefined upon function completion.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace this async/await execution and determine the final logged value:',
        codeSnippet: `async function calculateTotal() {\n  let base = 20;\n  const bonus = await Promise.resolve(15);\n  base += bonus;\n  return base;\n}\n\ncalculateTotal().then(res => console.log(res));`,
        options: ['35', '20', '15', 'Promise { <pending> }'],
        expectedOutput: '35',
        explanation: 'The function pauses at await until Promise.resolve(15) settles. base becomes 20 + 15 = 35. The async function returns a Promise resolving to 35.',
      },
      {
        questionText: 'Trace the error recovery execution in this try/catch async block:',
        codeSnippet: `async function fetchData() {\n  let status = 200;\n  try {\n    await Promise.reject(new Error('Network error'));\n    status = 201;\n  } catch (err) {\n    status = 500;\n  }\n  return status;\n}\n\nfetchData().then(s => console.log(s));`,
        options: ['500', '200', '201', 'Error: Network error'],
        expectedOutput: '500',
        explanation: 'The rejected Promise throws an exception at the await statement. Execution jumps directly to the catch block, setting status = 500.',
      },
      {
        questionText: 'Trace the execution of sequential vs parallel Promise resolution:',
        codeSnippet: `async function run() {\n  const p1 = Promise.resolve(10);\n  const p2 = Promise.resolve(20);\n  const [a, b] = await Promise.all([p1, p2]);\n  console.log(a + b);\n}\nrun();`,
        options: ['30', '[10, 20]', '1020', 'undefined'],
        expectedOutput: '30',
        explanation: 'Promise.all resolves when both p1 and p2 complete, returning [10, 20]. Array destructuring assigns a=10 and b=20. Their sum is 30.',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the asynchronous bug causing "Cannot read properties of undefined":',
        buggyCode: `async function getUserProfile(userId) {\n  // Missing await on the database query\n  const user = fetchUserFromDb(userId);\n  return user.name.toUpperCase();\n}`,
        errorDescription: 'Calling getUserProfile(42) fails with TypeError: Cannot read properties of undefined (reading "toUpperCase").',
        identifiedBug: 'Line 3: fetchUserFromDb returns a Promise, not the user object. Missing "await".',
        fixedCode: 'const user = await fetchUserFromDb(userId);',
        explanation: 'Because fetchUserFromDb is asynchronous, it returns a Promise. Without "await", user is a Promise object which has no "name" property, causing undefined.toUpperCase() to throw.',
      },
      {
        questionText: 'Identify the unhandled Promise rejection bug in this async handler:',
        buggyCode: `function loadConfig() {\n  return Promise.reject(new Error("Config missing"));\n}\n\nasync function init() {\n  const cfg = loadConfig();\n  console.log("Ready");\n}`,
        errorDescription: 'Node.js emits [UnhandledPromiseRejection: Config missing].',
        identifiedBug: 'Line 6: loadConfig() returns a rejected Promise that is neither awaited nor caught with .catch().',
        fixedCode: 'try { const cfg = await loadConfig(); } catch (e) { ... }',
        explanation: 'Unhandled Promise rejections cause application instability or termination in modern Node.js runtimes. Unhandled rejections must be awaited inside a try/catch or handled with .catch().',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the statement to pause execution until the asynchronous operation resolves:',
        codeSnippet: `async function fetchInventory() {\n  // Complete keyword to pause until fetchItems settles\n  const items = ___ fetchItems();\n  return items.length;\n}`,
        placeholder: 'await',
        correctCompletion: 'await',
        acceptedSolutions: ['await', 'await '],
        explanation: 'The "await" operator pauses execution of the enclosing async function until the Promise is fulfilled or rejected.',
      },
      {
        questionText: 'Complete the Promise method to wait for all asynchronous requests to finish:',
        codeSnippet: `const tasks = [fetchUser(), fetchPosts(), fetchComments()];\n// Settle all tasks concurrently\nconst results = await Promise.___ (tasks);`,
        placeholder: 'all',
        correctCompletion: 'all',
        acceptedSolutions: ['all', 'all(tasks)'],
        explanation: 'Promise.all accepts an iterable of Promises and returns a single Promise that resolves when all input promises have resolved.',
      },
    ],
    scenario_based: [
      {
        questionText: 'Which strategy best optimizes multiple independent API calls in a Node.js route?',
        scenario: 'A user profile endpoint needs to query an authentication service (150ms), a billing database (200ms), and an activity log (180ms). These operations do not depend on each other.',
        options: [
          'Run all three calls concurrently using Promise.all() to complete in ~200ms total',
          'Await each call sequentially one after another, taking ~530ms total',
          'Execute them inside synchronous while-loops on the main thread',
          'Create a separate Node.js child process for each single database query',
        ],
        bestChoice: 'Run all three calls concurrently using Promise.all() to complete in ~200ms total',
        explanation: 'When I/O operations are independent, running them in parallel via Promise.all() allows Node.js to leverage non-blocking I/O, reducing response latency to the duration of the slowest request.',
      },
    ],
    short_answer: [
      {
        questionText: 'Why is blocking code (e.g. while(true) or fs.readFileSync) harmful to Node.js servers?',
        placeholder: 'Explain the impact on Node.js single-threaded event loop...',
        modelAnswer: 'Because Node.js runs JavaScript on a single thread, blocking synchronous code monopolizes the call stack and prevents the event loop from servicing any other concurrent user requests.',
        keywords: ['single thread', 'event loop', 'block', 'requests', 'concurrency', 'call stack'],
        explanation: 'Node.js relies on a single-threaded event loop. If code blocks the call stack, the server freezes for all other active users until the blocking operation completes.',
      },
    ],
  },

  // ── 2. Node.js CommonJS Modules & Code Organization ─────────────────────────
  nodejs_modules: {
    mcq: [
      {
        questionText: 'In Node.js CommonJS, how do you expose an object containing multiple utility functions?',
        options: [
          'module.exports = { calculateTax, formatCurrency };',
          'export default class Utilities { ... }',
          'exports = { calculateTax, formatCurrency };',
          'global.publish({ calculateTax, formatCurrency });',
        ],
        correctAnswer: 'module.exports = { calculateTax, formatCurrency };',
        explanation: 'Assigning to module.exports correctly exports the object. Note that reassigning exports directly (exports = ...) breaks the internal reference to module.exports.',
      },
      {
        questionText: 'What is the key difference between requiring a local file vs an npm package in CommonJS?',
        options: [
          'Local files require a relative path prefix like "./" or "../", whereas packages are required by bare package name',
          'Local files must use import while npm packages must use require()',
          'npm packages require file extensions like ".js" while local files strictly forbid them',
          'There is no difference; all files must start with the absolute path',
        ],
        correctAnswer: 'Local files require a relative path prefix like "./" or "../", whereas packages are required by bare package name',
        explanation: 'Node.js distinguishes npm packages in node_modules from local files by checking for "./" or "../" prefixes. Bare specifiers search node_modules.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace what value is received when requiring this CommonJS module:',
        codeSnippet: `// mathService.js\nconst multiplier = 3;\nmodule.exports = {\n  multiply: (val) => val * multiplier,\n};\n\n// app.js\nconst math = require('./mathService');\nconsole.log(math.multiply(6));`,
        options: ['18', '3', 'undefined', 'TypeError: math.multiply is not a function'],
        expectedOutput: '18',
        explanation: 'mathService exports an object with multiply method. The closure retains multiplier=3, so 6 * 3 = 18.',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the common CommonJS export defect that leaves exported functions unavailable:',
        buggyCode: `// logger.js\n// Developer intended to export a log function:\nexports = function log(msg) {\n  console.log("[LOG]: " + msg);\n};`,
        errorDescription: 'In consumer file: const logger = require("./logger"); logger("Hi"); fails with TypeError: logger is not a function (logger is an empty object {}).',
        identifiedBug: 'Line 3: Reassigning "exports" directly overwrites the local variable and severs the link to module.exports.',
        fixedCode: 'module.exports = function log(msg) { ... };',
        explanation: 'Node.js returns module.exports from require(). In module scope, exports is merely an alias variable pointing to module.exports. Reassigning exports = fn breaks the reference.',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the built-in CommonJS statement to import the local database module:',
        codeSnippet: `// Import local database connection from ./database\nconst db = ___('./database');`,
        placeholder: 'require',
        correctCompletion: 'require',
        acceptedSolutions: ['require', "require('./database')"],
        explanation: 'CommonJS uses require() to synchronously load and evaluate modules, caching their module.exports.',
      },
    ],
    scenario_based: [
      {
        questionText: 'When refactoring a large Node.js application, why is modularization into focused files recommended?',
        scenario: 'A monolithic 3,000-line server.js file handles authentication, database connections, user routes, and payment processing.',
        options: [
          'Separating into distinct modules (routes, controllers, models) improves maintainability, unit testability, and code reusability',
          'Separating files makes JavaScript run twice as fast on the CPU',
          'Node.js cannot compile files longer than 1,000 lines',
          'It allows variables declared with var to become global across all files',
        ],
        bestChoice: 'Separating into distinct modules (routes, controllers, models) improves maintainability, unit testability, and code reusability',
        explanation: 'Modular design isolates concerns, enables independent unit testing, prevents merge conflicts, and allows individual components to be reused across the application.',
      },
    ],
    short_answer: [
      {
        questionText: 'What is the role of the module cache in Node.js when a file is required multiple times?',
        placeholder: 'Explain how Node.js caches required modules...',
        modelAnswer: 'Node.js caches modules in require.cache upon first load. Subsequent calls to require() return the cached export object without re-executing the module file.',
        keywords: ['cache', 'singleton', 'first load', 're-executing', 'performance', 'instance'],
        explanation: 'Caching ensures modules behave as singletons across the app and avoids repeated disk reads and execution.',
      },
    ],
  },

  // ── 3. Node.js npm & Package Management ─────────────────────────────────────
  nodejs_npm: {
    mcq: [
      {
        questionText: 'Which command installs a package strictly as a development dependency in package.json?',
        options: [
          'npm install --save-dev <package-name>',
          'npm install --production <package-name>',
          'npm add --global-only <package-name>',
          'npm test --install <package-name>',
        ],
        correctAnswer: 'npm install --save-dev <package-name>',
        explanation: 'The --save-dev flag (or -D) adds the package under "devDependencies" in package.json, meaning it will not be installed in production deployments.',
      },
      {
        questionText: 'What is the primary purpose of the package-lock.json file in a Node.js project?',
        options: [
          'To lock down exact resolved dependency versions and hashes for deterministic, reproducible installs across machines',
          'To encrypt proprietary source code so other developers cannot read it',
          'To specify the Node.js runtime memory limits for the virtual machine',
          'To automatically start the npm test suite on system boot',
        ],
        correctAnswer: 'To lock down exact resolved dependency versions and hashes for deterministic, reproducible installs across machines',
        explanation: 'package-lock.json ensures that any teammate or CI/CD server running npm install gets the exact same dependency tree and version resolution.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace which script is executed when running "npm start" for this package.json:',
        codeSnippet: `{\n  "name": "portal-api",\n  "scripts": {\n    "build": "tsc",\n    "start": "node dist/server.js",\n    "dev": "nodemon src/server.js"\n  }\n}`,
        options: ['node dist/server.js', 'nodemon src/server.js', 'tsc', 'npm run start'],
        expectedOutput: 'node dist/server.js',
        explanation: 'Running "npm start" directly invokes the command specified in the "start" key under the scripts object.',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the JSON syntax error in package.json that breaks "npm install":',
        buggyCode: `{\n  "name": "my-service",\n  "version": "1.0.0",\n  "dependencies": {\n    "express": "^4.18.2",\n    "cors": "^2.8.5",\n  }\n}`,
        errorDescription: 'npm fails with "npm ERR! JSON.parse Failed to parse package.json: Trailing comma at line 6".',
        identifiedBug: 'Line 6: Trailing comma after "cors": "^2.8.5". Standard JSON forbids trailing commas.',
        fixedCode: 'Remove the trailing comma after "^2.8.5"',
        explanation: 'Standard JSON specification (RFC 8259) does not permit trailing commas in objects or arrays. Trailing commas cause parser failures in npm and JSON.parse.',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the package.json scripts property to define the test runner command:',
        codeSnippet: `{\n  "scripts": {\n    "___": "jest --runInBand"\n  }\n}`,
        placeholder: 'test',
        correctCompletion: 'test',
        acceptedSolutions: ['test'],
        explanation: '"test" is the standard lifecycle script invoked with "npm test".',
      },
    ],
    scenario_based: [
      {
        questionText: 'Why should tools like nodemon and ESLint be placed in devDependencies rather than dependencies?',
        scenario: 'Deploying a production Node.js microservice to a container with limited disk space and bandwidth.',
        options: [
          'Because dev tools are only needed during development; omitting them in production shrinks container size and attack surface',
          'Because devDependencies run faster in production than regular dependencies',
          'Because Node.js crashes if devDependencies are installed on a Linux server',
          'Because npm will not compile TypeScript without them',
        ],
        bestChoice: 'Because dev tools are only needed during development; omitting them in production shrinks container size and attack surface',
        explanation: 'Production builds (npm install --production) skip devDependencies, significantly reducing image size, speeding up deployments, and avoiding development vulnerabilities in production.',
      },
    ],
    short_answer: [
      {
        questionText: 'What does the caret symbol (^) mean in a package version like "^1.4.2"?',
        placeholder: 'Explain semver caret behavior...',
        modelAnswer: 'The caret (^) allows npm to update to minor and patch releases (compatible updates that do not break the API), but locks the major version (e.g. >= 1.4.2 < 2.0.0).',
        keywords: ['minor', 'patch', 'major', 'compatible', 'semver', 'update'],
        explanation: 'Under SemVer, ^1.4.2 permits compatible non-breaking changes up to, but not including, version 2.0.0.',
      },
    ],
  },

  // ── 4. Node.js Runtime Environment, File System & Streams ───────────────────
  nodejs_runtime: {
    mcq: [
      {
        questionText: 'Which method reads a file asynchronously in Node.js using standard Promises?',
        options: [
          'const data = await fs.promises.readFile("file.txt", "utf8");',
          'const data = fs.readStreamSync("file.txt");',
          'const data = fs.loadText("file.txt");',
          'const data = File.read("file.txt");',
        ],
        correctAnswer: 'const data = await fs.promises.readFile("file.txt", "utf8");',
        explanation: 'fs.promises.readFile (or importing from "node:fs/promises") returns a Promise that fulfills with file content without blocking the main event loop.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace the output when checking file existence with fs.existsSync:',
        codeSnippet: `const path = require('path');\nconst filename = path.join('src', 'index.js');\nconsole.log(typeof filename === 'string' && filename.includes('index.js'));`,
        options: ['true', 'false', 'undefined', 'TypeError'],
        expectedOutput: 'true',
        explanation: 'path.join constructs a normalized path string. The expression checks that filename is a string and contains "index.js", evaluating to true.',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the error-first callback bug in this asynchronous file reader:',
        buggyCode: `fs.readFile('config.json', 'utf8', (data, err) => {\n  if (err) throw err;\n  console.log(data);\n});`,
        errorDescription: 'The handler prints undefined or crashes because parameter order is reversed.',
        identifiedBug: 'Line 1: Node.js callback conventions mandate error as the FIRST argument: (err, data).',
        fixedCode: 'fs.readFile("config.json", "utf8", (err, data) => { ... });',
        explanation: 'Node.js strictly follows error-first callback convention where the first argument is reserved for any Error object and subsequent arguments contain successful results.',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the code to import Node\'s built-in file system module:',
        codeSnippet: `const fs = require('___');`,
        placeholder: 'fs',
        correctCompletion: 'fs',
        acceptedSolutions: ['fs', 'node:fs'],
        explanation: 'The built-in file system module is accessed via require("fs") or require("node:fs").',
      },
    ],
    scenario_based: [
      {
        questionText: 'When reading a 5GB log file in Node.js, why should you use Streams instead of fs.readFile?',
        scenario: 'A log processing script needs to inspect a huge 5GB server access log on a system with 1GB RAM.',
        options: [
          'Streams process data chunk-by-chunk in memory buffers, avoiding out-of-memory crashes',
          'Streams automatically compress files using gzip on the fly',
          'fs.readFile requires an active internet connection to read files',
          'Streams bypass the operating system permissions check',
        ],
        bestChoice: 'Streams process data chunk-by-chunk in memory buffers, avoiding out-of-memory crashes',
        explanation: 'fs.readFile buffers the entire file into RAM, crashing Node.js with heap out of memory for large files. Streams process data in small chunks (e.g. 64KB) with constant memory footprint.',
      },
    ],
    short_answer: [
      {
        questionText: 'What is the role of process.env in a Node.js runtime application?',
        placeholder: 'Explain what process.env provides...',
        modelAnswer: 'process.env is a global object providing access to system environment variables (like PORT, DATABASE_URL, and NODE_ENV) for runtime configuration.',
        keywords: ['environment', 'configuration', 'port', 'variables', 'runtime', 'secrets'],
        explanation: 'It decouples sensitive configuration and dynamic ports from source code, enabling cloud twelve-factor deployments.',
      },
    ],
  },

  // ── 5. Kotlin Programming Fundamentals & Null Safety ───────────────────────
  kotlin: {
    mcq: [
      {
        questionText: 'In Kotlin, what is the key difference between declarations using "val" and "var"?',
        options: [
          '"val" creates read-only (immutable) references, while "var" creates mutable variables that can be reassigned',
          '"val" variables can only store numbers while "var" stores strings',
          '"val" is evaluated on every access while "var" is evaluated only once',
          '"val" variables are global and "var" variables are local',
        ],
        correctAnswer: '"val" creates read-only (immutable) references, while "var" creates mutable variables that can be reassigned',
        explanation: 'In Kotlin, "val" corresponds to an immutable reference (like final in Java or const in JS). "var" allows reassignment.',
      },
      {
        questionText: 'What does the Elvis operator (?:) do in Kotlin?',
        options: [
          'It provides a fallback default value if the expression on its left evaluates to null',
          'It forces a non-null assertion and throws NullPointerException if null',
          'It checks if two objects are structurally equal',
          'It casts an object to a superclass type safely',
        ],
        correctAnswer: 'It provides a fallback default value if the expression on its left evaluates to null',
        explanation: 'The Elvis operator (?:) checks the left operand: if it is not null, it returns it; if it is null, it evaluates and returns the right operand.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace this Kotlin null safety code and determine the output:',
        codeSnippet: `fun main() {\n  val username: String? = null\n  val displayName = username ?: "Guest"\n  println(displayName)\n}`,
        options: ['Guest', 'null', 'NullPointerException', 'username'],
        expectedOutput: 'Guest',
        explanation: 'username is null, so the Elvis operator ?: falls back to the default string "Guest".',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the Kotlin compilation error in this variable assignment:',
        buggyCode: `fun main() {\n  val score: Int = 100\n  score = 150\n  println(score)\n}`,
        errorDescription: 'Kotlin compiler fails: "Val cannot be reassigned".',
        identifiedBug: 'Line 3: Attempting to reassign a variable declared with "val".',
        fixedCode: 'Change "val score" to "var score" on line 2.',
        explanation: '"val" declares a read-only variable. If a variable needs to be reassigned later in the program, declare it with "var".',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the safe call operator to access string length without null pointer exceptions:',
        codeSnippet: `val email: String? = getUserEmail()\n// Use safe call operator\nval length = email___length`,
        placeholder: '?.',
        correctCompletion: '?.',
        acceptedSolutions: ['?.', '?.length'],
        explanation: 'The safe call operator (?.) accesses properties safely: if email is null, it evaluates to null rather than throwing NullPointerException.',
      },
    ],
    scenario_based: [
      {
        questionText: 'Why is Kotlin\'s null safety type system considered a significant advantage over Java?',
        scenario: 'Building a mobile Android application where unexpected crashes from null references ruin user retention.',
        options: [
          'It catches nullability errors at compile time rather than crashing at runtime with NullPointerExceptions',
          'It eliminates the need for unit testing entirely',
          'It makes Android apps automatically work without internet access',
          'It reduces the compiled APK binary size by 90%',
        ],
        bestChoice: 'It catches nullability errors at compile time rather than crashing at runtime with NullPointerExceptions',
        explanation: 'Kotlin differentiates nullable types (String?) from non-nullable types (String) in the type system at compile time, virtually eliminating unexpected runtime NullPointerExceptions.',
      },
    ],
    short_answer: [
      {
        questionText: 'In Kotlin, what does String templating ($) allow developers to do?',
        placeholder: 'Explain string templating in Kotlin...',
        modelAnswer: 'String templating allows embedding variables and expressions directly inside strings using $variable or ${expression} without manual concatenation.',
        keywords: ['embedding', 'variables', 'concatenation', 'expression', 'strings'],
        explanation: 'It simplifies string construction and enhances readability compared to repetitive + operator concatenation.',
      },
    ],
  },

  // ── 6. Java Programming Fundamentals & Object-Oriented Principles ───────────
  java: {
    mcq: [
      {
        questionText: 'In Java, how should you compare two String objects for content equality?',
        options: [
          'str1.equals(str2)',
          'str1 == str2',
          'str1 === str2',
          'str1.compareTo(str2) == -1',
        ],
        correctAnswer: 'str1.equals(str2)',
        explanation: 'In Java, .equals() compares the actual text content of two strings, whereas == checks whether both variables reference the exact same memory location.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace the output of this Java loop:',
        codeSnippet: `public class Main {\n  public static void main(String[] args) {\n    int count = 0;\n    for (int i = 0; i < 3; i++) {\n      count += i;\n    }\n    System.out.println(count);\n  }\n}`,
        options: ['3', '6', '0', '4'],
        expectedOutput: '3',
        explanation: 'i=0: count=0. i=1: count=1. i=2: count=1+2=3. Loop terminates when i=3. Output is 3.',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the common Array out-of-bounds error in this Java loop:',
        buggyCode: `int[] numbers = {10, 20, 30};\nfor (int i = 0; i <= numbers.length; i++) {\n  System.out.println(numbers[i]);\n}`,
        errorDescription: 'Runtime throws ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 3.',
        identifiedBug: 'Line 2: Condition "i <= numbers.length" accesses index 3, which is out of bounds for a length-3 array.',
        fixedCode: 'Change condition to "i < numbers.length"',
        explanation: 'Java arrays are 0-indexed. A 3-element array has valid indices 0, 1, 2. The loop condition must strictly be i < numbers.length.',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the constructor declaration for this Java Student class:',
        codeSnippet: `public class Student {\n  private String name;\n  // Complete constructor declaration\n  public ___(String name) {\n    this.name = name;\n  }\n}`,
        placeholder: 'Student',
        correctCompletion: 'Student',
        acceptedSolutions: ['Student'],
        explanation: 'In Java, constructors must have the exact same name as the enclosing class and have no return type.',
      },
    ],
    scenario_based: [
      {
        questionText: 'Why should class fields generally be marked "private" with public getters and setters in Java?',
        scenario: 'Designing a BankAccount class with a balance attribute.',
        options: [
          'Encapsulation: It hides internal state and enforces business validation rules before updating data',
          'Private fields use less memory in the Java Virtual Machine',
          'Private fields allow any other class to directly modify values',
          'Java forbids methods from accessing public fields',
        ],
        bestChoice: 'Encapsulation: It hides internal state and enforces business validation rules before updating data',
        explanation: 'Encapsulation protects object integrity by ensuring values can only be modified through controlled setter methods with validation (e.g. preventing negative balances).',
      },
    ],
    short_answer: [
      {
        questionText: 'What does the "static" keyword signify when applied to a method in Java?',
        placeholder: 'Explain static methods in Java...',
        modelAnswer: 'A static method belongs to the class itself rather than to any specific instance of the class, allowing it to be invoked without creating an object with new.',
        keywords: ['class', 'instance', 'object', 'invoke', 'new', 'belongs'],
        explanation: 'Static methods can be called directly via ClassName.methodName() without instantiating an object.',
      },
    ],
  },

  // ── 7. MongoDB & NoSQL Database Operations ──────────────────────────────────
  mongodb: {
    mcq: [
      {
        questionText: 'In MongoDB, which method retrieves a single document matching a query filter?',
        options: [
          'db.collection.findOne({ email: "user@test.com" })',
          'db.collection.selectOne({ email: "user@test.com" })',
          'db.collection.getRecord({ email: "user@test.com" })',
          'db.collection.findSingle({ email: "user@test.com" })',
        ],
        correctAnswer: 'db.collection.findOne({ email: "user@test.com" })',
        explanation: 'findOne() returns the first document matching the query criteria or null if no document matches.',
      },
      {
        questionText: 'How is data fundamentally structured and stored inside MongoDB collections?',
        options: [
          'As flexible, schema-free BSON (Binary JSON) documents containing key-value pairs and arrays',
          'As rigid tables with fixed pre-allocated columns and relational foreign keys',
          'As flat plaintext CSV files with comma-separated values',
          'As compiled binary machine instructions on raw disk blocks',
        ],
        correctAnswer: 'As flexible, schema-free BSON (Binary JSON) documents containing key-value pairs and arrays',
        explanation: 'MongoDB is a document database that stores records as BSON documents, allowing rich embedded objects and flexible evolving schemas.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace which MongoDB operator correctly increments a score counter:',
        codeSnippet: `// Updating a student record in MongoDB:\nawait User.updateOne(\n  { _id: userId },\n  { $inc: { xp: 50 } }\n);`,
        options: [
          'Increases the existing xp value by 50',
          'Overwrites the xp field to strictly equal 50',
          'Multiplies the xp field by 50',
          'Deletes the xp field from the document',
        ],
        expectedOutput: 'Increases the existing xp value by 50',
        explanation: 'The $inc update operator increments a field by the specified value in an atomic database operation.',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the MongoDB update defect that accidentally overwrites the whole document:',
        buggyCode: `// Attempting to update a user email:\nawait User.updateOne(\n  { _id: id },\n  { email: "new@mail.com" } // Missing update operator\n);`,
        errorDescription: 'Mongoose or MongoDB driver throws MongoError: The update operation document must contain atomic operators.',
        identifiedBug: 'Line 4: Direct assignment without $set operator. In MongoDB updates, field updates require the $set operator.',
        fixedCode: '{ $set: { email: "new@mail.com" } }',
        explanation: 'In MongoDB, updating individual fields requires atomic operators like $set: { field: value }. Passing raw fields without operators is invalid in modern drivers.',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the MongoDB update operator to set a specific field value:',
        codeSnippet: `await db.collection('students').updateOne(\n  { name: 'Alex' },\n  { ___: { active: true } }\n);`,
        placeholder: '$set',
        correctCompletion: '$set',
        acceptedSolutions: ['$set'],
        explanation: 'The $set operator replaces the value of a field with the specified value.',
      },
    ],
    scenario_based: [
      {
        questionText: 'Why would an application choose MongoDB embedded documents over relational tables for user addresses?',
        scenario: 'An e-commerce user profile stores 1 to 3 shipping addresses that are always retrieved together with the user profile.',
        options: [
          'Embedding addresses directly inside the user document eliminates expensive JOIN operations and ensures single-read retrieval',
          'MongoDB forbids having more than one collection in a database',
          'Embedded documents bypass database authentication completely',
          'Relational databases cannot store street names',
        ],
        bestChoice: 'Embedding addresses directly inside the user document eliminates expensive JOIN operations and ensures single-read retrieval',
        explanation: 'In document databases, embedding data that is accessed together provides high read performance and atomic updates without multi-table joins.',
      },
    ],
    short_answer: [
      {
        questionText: 'What is the purpose of the default _id field automatically generated for every MongoDB document?',
        placeholder: 'Explain the role of MongoDB _id...',
        modelAnswer: 'The _id field serves as the unique primary key identifier (usually a 12-byte ObjectId) ensuring every document can be uniquely addressed and indexed in the collection.',
        keywords: ['primary key', 'unique', 'identifier', 'objectid', 'index', 'document'],
        explanation: '_id guarantees uniqueness and fast indexed lookups across MongoDB collections.',
      },
    ],
  },

  // ── 8. Adaptive Learning Systems & Educational Personalization ──────────────
  adaptive_learning: {
    mcq: [
      {
        questionText: 'How does an adaptive learning system decide when a student has mastered a topic?',
        options: [
          'By continuously tracking performance using Bayesian or exponential moving averages (EMA) until confidence exceeds a mastery threshold (e.g. >= 80%)',
          'By forcing all students to wait 24 hours between questions regardless of score',
          'By randomly picking topics from a shuffled list',
          'By checking how fast the user types on their keyboard',
        ],
        correctAnswer: 'By continuously tracking performance using Bayesian or exponential moving averages (EMA) until confidence exceeds a mastery threshold (e.g. >= 80%)',
        explanation: 'Adaptive platforms model learner knowledge mathematically (such as EMA or Knowledge Tracing) to ensure scaffolding adapts dynamically to evidence of mastery.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace the EMA mastery calculation after a correct answer (alpha = 0.3):',
        codeSnippet: `// Prior mastery = 0.50 (50%). Student scores 1.0 (correct).\n// New Mastery = (0.3 * 1.0) + (0.7 * 0.50)\nconst newMastery = (0.3 * 1.0) + (0.7 * 0.50);\nconsole.log(Math.round(newMastery * 100));`,
        options: ['65', '50', '80', '100'],
        expectedOutput: '65',
        explanation: '0.3 * 1.0 = 0.3. 0.7 * 0.5 = 0.35. Total is 0.65 (65% mastery).',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the pedagogical flaw in this static quiz feedback:',
        buggyCode: `function provideFeedback(isCorrect) {\n  return isCorrect ? "OK" : "WRONG. Try again.";\n}`,
        errorDescription: 'Students show high dropout rates because the feedback provides zero explanation or corrective hints.',
        identifiedBug: 'Line 2: Uninformative feedback lacks formative explanations, distractor analysis, and actionable guidance.',
        fixedCode: 'Return detailed explanations addressing the misconception and providing next steps.',
        explanation: 'Formative assessment research demonstrates that constructive, explanatory feedback significantly improves learning gains compared to blunt binary correct/incorrect notifications.',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the Bloom cognitive level associated with finding and fixing code defects:',
        codeSnippet: `// Bloom taxonomy level for code debugging and defect isolation:\nconst bloomLevel = "___"; // analyze or apply`,
        placeholder: 'analyze',
        correctCompletion: 'analyze',
        acceptedSolutions: ['analyze', 'evaluate'],
        explanation: 'Debugging requires analyzing code behavior, decomposing component interactions, and identifying root causes.',
      },
    ],
    scenario_based: [
      {
        questionText: 'What should an intelligent tutoring system do when a student fails 3 consecutive practice questions?',
        scenario: 'A student struggles with asynchronous recursion and scores 0% across 3 attempts.',
        options: [
          'Remediate: step back to foundational prerequisite concepts with interactive worked examples and guided analogies',
          'Lock the student out of the platform for 7 days',
          'Increase question difficulty to advanced evaluation challenge',
          'Silently mark the topic as 100% completed to make the student feel good',
        ],
        bestChoice: 'Remediate: step back to foundational prerequisite concepts with interactive worked examples and guided analogies',
        explanation: 'Pedagogical scaffolding principles dictate that repeated failure indicates a prerequisite knowledge gap that requires stepping back to guided worked examples before re-testing.',
      },
    ],
    short_answer: [
      {
        questionText: 'Why is formative feedback more effective than simply showing the correct answer?',
        placeholder: 'Explain the benefits of formative feedback...',
        modelAnswer: 'Formative feedback explains the underlying reasoning and clarifies why misconceptions are incorrect, helping learners build durable mental models rather than merely memorizing answers.',
        keywords: ['reasoning', 'misconception', 'mental model', 'understanding', 'memorization', 'learning'],
        explanation: 'It transforms mistakes into learning opportunities by targeting the cognitive root cause.',
      },
    ],
  },

  // ── 9. General CS, Clean Code, Data Structures & Logic ──────────────────────
  general_cs: {
    mcq: [
      {
        questionText: 'Which array method in modern JavaScript creates a new array containing only elements that satisfy a condition?',
        options: [
          'array.filter(item => item.isActive)',
          'array.map(item => item.isActive)',
          'array.forEach(item => item.isActive)',
          'array.reduce(item => item.isActive)',
        ],
        correctAnswer: 'array.filter(item => item.isActive)',
        explanation: 'filter() returns a new array with all elements that pass the test implemented by the provided predicate function.',
      },
      {
        questionText: 'What is the main benefit of writing pure functions with no side effects?',
        options: [
          'They are deterministic, easier to unit test, and safe from unexpected state mutations',
          'They bypass compiler optimization checks',
          'They execute without allocating memory in the computer',
          'They can only be called from inside HTML templates',
        ],
        correctAnswer: 'They are deterministic, easier to unit test, and safe from unexpected state mutations',
        explanation: 'Pure functions always produce the same output for identical inputs and do not modify external state, simplifying debugging and testing.',
      },
    ],
    code_tracing: [
      {
        questionText: 'Trace the output of this array reduction and summation:',
        codeSnippet: `const scores = [10, 20, 30];\nconst sum = scores.reduce((total, score) => total + score, 0);\nconsole.log(sum);`,
        options: ['60', '0', '30', '102030'],
        expectedOutput: '60',
        explanation: 'reduce accumulates values: 0 + 10 = 10 -> 10 + 20 = 30 -> 30 + 30 = 60.',
      },
    ],
    debugging: [
      {
        questionText: 'Identify the mutation bug that unintentionally modifies the original items array:',
        buggyCode: `function getSortedItems(items) {\n  // Intended to return sorted copy without modifying original\n  return items.sort();\n}`,
        errorDescription: 'The caller finds that their original items array order was permanently altered.',
        identifiedBug: 'Line 3: Array.prototype.sort() mutates the array in-place.',
        fixedCode: 'return [...items].sort();',
        explanation: 'In JavaScript, .sort() mutates the original array in place. Spreading [...items] creates a shallow copy first, protecting the original data.',
      },
    ],
    code_completion: [
      {
        questionText: 'Complete the statement to transform each array element by doubling its value:',
        codeSnippet: `const numbers = [1, 2, 3];\nconst doubled = numbers.___(x => x * 2);`,
        placeholder: 'map',
        correctCompletion: 'map',
        acceptedSolutions: ['map'],
        explanation: 'map() creates a new array populated with the results of calling a provided function on every element in the calling array.',
      },
    ],
    scenario_based: [
      {
        questionText: 'How should an application handle unexpected user inputs and edge cases?',
        scenario: 'A user registration form receives negative ages, empty strings, and script tags in user fields.',
        options: [
          'Validate and sanitize inputs at application boundaries and return clear, descriptive validation errors',
          'Ignore the inputs and let database queries fail with unhandled exceptions',
          'Restart the application server on any invalid input',
          'Store all inputs as raw unescaped HTML strings',
        ],
        bestChoice: 'Validate and sanitize inputs at application boundaries and return clear, descriptive validation errors',
        explanation: 'Defensive programming requires validating and sanitizing all external input at application boundaries to prevent crashes and injection vulnerabilities.',
      },
    ],
    short_answer: [
      {
        questionText: 'What is the difference between synchronous and asynchronous execution?',
        placeholder: 'Explain the difference between synchronous and asynchronous...',
        modelAnswer: 'Synchronous execution runs code sequentially, blocking subsequent lines until the current line completes. Asynchronous execution initiates an operation and allows other code to continue running before the operation finishes.',
        keywords: ['sequential', 'blocking', 'non-blocking', 'concurrency', 'completes', 'continues'],
        explanation: 'Synchronous code blocks progress; asynchronous code enables responsiveness while waiting for I/O.',
      },
    ],
  },
};

// ─── Selector with Anti-Repetition ─────────────────────────────────────────────

function selectFreshQuestion(candidates, previousQuestions = [], attemptNumber = 1) {
  if (!candidates || candidates.length === 0) return null;

  const normalize = (str) =>
    String(str || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 35);

  const prevNorms = previousQuestions.map(normalize).filter(Boolean);

  // Filter out any candidate whose text is present in previous questions
  const fresh = candidates.filter((cand) => {
    const qNorm = normalize(cand.questionText);
    return !prevNorms.some((pn) => pn.includes(qNorm) || qNorm.includes(pn));
  });

  if (fresh.length > 0) {
    const idx = (attemptNumber - 1) % fresh.length;
    return fresh[idx];
  }

  // If all candidates have been exhausted, rotate through candidates
  const idx = (attemptNumber - 1) % candidates.length;
  return candidates[idx];
}

// ─── Main Generator ───────────────────────────────────────────────────────────

function getAdaptiveFallbackQuestion(spec) {
  const {
    topic = '',
    topicSummary = '',
    assessmentFormat = 'mcq',
    difficulty = 'normal',
    bloomLevel = 'understand',
    learningObjective,
    previousQuestions = [],
    attemptNumber = 1,
  } = spec;

  const cleanTopic = (topic || 'this concept').trim();
  const domain = detectDomain(cleanTopic, topicSummary);
  const domainBank = DOMAIN_BANKS[domain] || DOMAIN_BANKS.general_cs;

  // Attempt to fetch candidates for the requested format, fallback to mcq/general if needed
  let candidates = domainBank[assessmentFormat] || DOMAIN_BANKS.general_cs[assessmentFormat];
  if (!candidates || candidates.length === 0) {
    candidates = domainBank.mcq || DOMAIN_BANKS.general_cs.mcq;
  }

  const selected = selectFreshQuestion(candidates, previousQuestions, attemptNumber);

  // Format into standard assessment question structure expected by the validator
  const format = selected.assessmentFormat || assessmentFormat;
  let payload = {};
  let evaluationData = {};

  if (format === 'mcq') {
    payload = {
      options: selected.options || ['Option A', 'Option B', 'Option C', 'Option D'],
      hint: `Carefully consider the core principles of ${cleanTopic}.`,
    };
    evaluationData = {
      correctAnswer: selected.correctAnswer || selected.options?.[0],
    };
  } else if (format === 'code_tracing') {
    payload = {
      codeSnippet: selected.codeSnippet || `// Trace execution for ${cleanTopic}\nconsole.log(42);`,
      language: 'javascript',
      options: selected.options || ['35', '20', '15', '0'],
      hint: 'Follow the execution line-by-line, tracking variable updates.',
    };
    evaluationData = {
      expectedOutput: selected.expectedOutput || selected.options?.[0] || '35',
    };
  } else if (format === 'debugging') {
    payload = {
      buggyCode: selected.buggyCode || `// Defect in ${cleanTopic}\nfunction run() { return undefined.value; }`,
      language: 'javascript',
      errorDescription: selected.errorDescription || 'Runtime error encountered.',
      hint: 'Look for missing await, incorrect variable scoping, or off-by-one errors.',
    };
    evaluationData = {
      identifiedBug: selected.identifiedBug || 'Defect in code logic.',
      fixedCode: selected.fixedCode || 'Corrected implementation.',
    };
  } else if (format === 'code_completion') {
    payload = {
      codeSnippet: selected.codeSnippet || `// Complete code for ${cleanTopic}\nconst result = ___();`,
      language: 'javascript',
      placeholder: selected.placeholder || 'await',
      hint: 'Identify the required keyword or function name to complete the statement.',
    };
    evaluationData = {
      correctCompletion: selected.correctCompletion || selected.placeholder || 'await',
      acceptedSolutions: selected.acceptedSolutions || [selected.correctCompletion || 'await'],
    };
  } else if (format === 'scenario_based') {
    payload = {
      scenario: selected.scenario || `Implementing a production feature with ${cleanTopic}.`,
      options: selected.options || ['Approach A', 'Approach B', 'Approach C', 'Approach D'],
      hint: 'Consider long-term maintainability, concurrency, and performance.',
    };
    evaluationData = {
      bestChoice: selected.bestChoice || selected.options?.[0],
      tradeoffs: 'Balances performance, maintainability, and error resilience.',
    };
  } else if (format === 'short_answer') {
    payload = {
      placeholder: selected.placeholder || `Explain ${cleanTopic} in 1-2 sentences...`,
      suggestedLength: '1-2 sentences',
      context: `Topic: ${cleanTopic}`,
      hint: 'Focus on practical application and benefits.',
    };
    evaluationData = {
      modelAnswer: selected.modelAnswer || `${cleanTopic} helps organize and execute programming logic safely.`,
      keywords: selected.keywords || [cleanTopic.toLowerCase()],
    };
  }

  return {
    questionText: selected.questionText,
    marks: 1,
    difficulty: difficulty || 'normal',
    bloomLevel: bloomLevel || 'understand',
    assessmentFormat: format,
    learningObjective: learningObjective || `Demonstrate practical understanding of ${cleanTopic}`,
    explanation: selected.explanation || `Core Reasoning: Focuses on key behaviors of ${cleanTopic}.`,
    payload,
    evaluationData,
    options: payload.options || null,
    correctAnswer: evaluationData.correctAnswer || evaluationData.bestChoice || evaluationData.expectedOutput || evaluationData.correctCompletion || '',
  };
}

module.exports = {
  detectDomain,
  getAdaptiveFallbackQuestion,
};
