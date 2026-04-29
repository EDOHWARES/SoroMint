'use strict';

/**
 * @title WASM Security Scanner
 * @author SoroMint Team
 * @notice Pure-JavaScript static analysis engine for Soroban/WebAssembly smart
 *         contract binaries.  Requires zero additional npm packages — all
 *         analysis is performed using Node.js built-ins (Buffer, crypto).
 *
 * @dev Architecture:
 *   BufferReader      — LEB128-aware binary reader
 *   parseWasmSections — Structural WASM decoder (magic, version, sections)
 *   RULES             — Registry of 20 named security rules
 *   runRules          — Evaluates every rule against parsed section data
 *   scanWasm          — Public API: Buffer → ScanReport
 *
 * Supported Soroban SDK: v22 (imports from module "_")
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current version of the scanner engine. Bump when rules change. */
const SCANNER_VERSION = '1.0.0';

/** WASM binary magic number: "\0asm" */
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

/** Only WASM binary format version 1 is supported. */
const WASM_VERSION = 1;

/** Default maximum WASM blob size (5 MB). Overrideable via opts.maxWasmSize. */
const DEFAULT_MAX_WASM_SIZE = 5 * 1024 * 1024;

/**
 * Soroban SDK v22 imports all host functions from the module named "_".
 * Any import NOT from "_" (or the companion "__" allocator module) is unusual.
 */
const SOROBAN_HOST_MODULE = '_';

/** Known-legitimate auxiliary modules used by the Soroban Rust toolchain. */
const ALLOWED_IMPORT_MODULES = new Set(['_', '__', 'soroban_env']);

/** Suspicious import module names that have no business in a Soroban contract. */
const SUSPICIOUS_IMPORT_MODULES = new Set([
  'wasi_snapshot_preview1',
  'wasi_unstable',
  'env',
  'js',
  'http',
  'fetch',
  'console',
  'net',
  'fs',
  'os',
]);

// ---------------------------------------------------------------------------
// Severity & Status enumerations
// ---------------------------------------------------------------------------

/**
 * @enum {string} SEVERITY
 * Ordered from most to least severe.  critical + high → deploymentBlocked.
 */
const SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
});

/**
 * @enum {string} SCAN_STATUS
 * Top-level outcome label for a completed scan.
 */
const SCAN_STATUS = Object.freeze({
  CLEAN: 'clean', // zero findings
  PASSED: 'passed', // no critical/high findings
  WARNING: 'warning', // medium/low findings only
  FAILED: 'failed', // critical or high findings present
  ERROR: 'error', // WASM could not be parsed at all
});

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Rule
 * @property {string} id           — Stable identifier (e.g. "SM-001")
 * @property {string} severity     — One of SEVERITY values
 * @property {string} title        — Short human-readable label
 * @property {string} description  — Explanation of the risk
 * @property {string} recommendation — Guidance for the developer
 */

/**
 * All 20 scanner rules.  IDs are stable across versions; update the
 * description/recommendation text freely but never reuse an ID for a
 * different rule.
 *
 * @type {Record<string, Rule>}
 */
const RULES = Object.freeze({
  'SM-001': {
    id: 'SM-001',
    severity: SEVERITY.CRITICAL,
    title: 'Invalid WASM magic number',
    description:
      'The supplied binary does not begin with the WebAssembly magic bytes ' +
      '(0x00 0x61 0x73 0x6D).  This is not a valid WASM file and cannot be ' +
      'deployed to the Soroban runtime.',
    recommendation:
      'Ensure you are uploading the compiled .wasm output produced by ' +
      '`cargo build --target wasm32-unknown-unknown --release`.  Do not ' +
      'upload source files, JSON, or other binary formats.',
  },

  'SM-002': {
    id: 'SM-002',
    severity: SEVERITY.CRITICAL,
    title: 'Unsupported WASM binary version',
    description:
      'The WASM binary declares a version other than 1 (0x01 0x00 0x00 0x00). ' +
      'Only WebAssembly MVP binary format version 1 is supported by the ' +
      'Soroban runtime.',
    recommendation:
      'Recompile the contract with a supported Rust/wasm toolchain.  ' +
      'Run `rustup target add wasm32-unknown-unknown` and rebuild.',
  },

  'SM-003': {
    id: 'SM-003',
    severity: SEVERITY.HIGH,
    title: 'Malformed WASM section detected',
    description:
      'One or more WASM sections could not be parsed.  This indicates a ' +
      'corrupt or deliberately obfuscated binary.  Malformed sections can ' +
      'trigger undefined behaviour in the runtime or hide malicious payloads.',
    recommendation:
      'Re-export the WASM from a clean build.  Run `wasm-validate` to ' +
      'verify the binary before uploading.',
  },

  'SM-004': {
    id: 'SM-004',
    severity: SEVERITY.HIGH,
    title: 'No Soroban host-function imports found',
    description:
      'A legitimate Soroban contract built with the Soroban SDK v22 must ' +
      'import host functions from the "_" module.  This contract has zero ' +
      'such imports, which suggests it was not compiled with the Soroban SDK ' +
      'or that the import section was stripped/obfuscated.',
    recommendation:
      'Ensure the contract uses `soroban-sdk = "22.0.0"` and is compiled ' +
      'with `cargo build --target wasm32-unknown-unknown --release`.  ' +
      'Verify the import section is intact.',
  },

  'SM-005': {
    id: 'SM-005',
    severity: SEVERITY.HIGH,
    title: 'Suspicious non-Soroban imports detected',
    description:
      'The contract imports from modules associated with WASI, browser APIs, ' +
      'or other non-Soroban environments (e.g. "wasi_snapshot_preview1", ' +
      '"env", "js", "http").  Such imports indicate the contract was compiled ' +
      'for the wrong target or contains deliberate backdoors.',
    recommendation:
      'Remove all WASI/browser dependencies and recompile strictly for the ' +
      'wasm32-unknown-unknown target.  Audit every dependency in Cargo.toml.',
  },

  'SM-006': {
    id: 'SM-006',
    severity: SEVERITY.MEDIUM,
    title: 'Suspiciously few Soroban host-function calls',
    description:
      'The contract imports fewer than 3 functions from the Soroban "_" ' +
      'module.  A typical Soroban token contract uses 15–40 host functions.  ' +
      'An unusually thin import list may indicate stripped metadata, a stub ' +
      'contract, or a contract that bypasses standard SDK patterns.',
    recommendation:
      'Review the contract source to ensure all necessary SDK interactions ' +
      '(storage, events, auth) are present.  A trivially small import set ' +
      'may mean the contract has no real functionality.',
  },

  'SM-007': {
    id: 'SM-007',
    severity: SEVERITY.MEDIUM,
    title: 'Missing callable contract export',
    description:
      'The contract does not export any functions.  Soroban contracts must ' +
      'expose at least one callable function (traditionally starting with ' +
      '"__invoke" or the individual function names) for the runtime to ' +
      'dispatch calls to.',
    recommendation:
      'Verify that `#[contractimpl]` blocks are present and that the ' +
      'compiled WASM exports the expected entry points.  Check for linker ' +
      'flags that might strip exports.',
  },

  'SM-008': {
    id: 'SM-008',
    severity: SEVERITY.LOW,
    title: 'Duplicate export names detected',
    description:
      'Two or more exports share the same name.  While the WASM spec permits ' +
      'this in some encodings, it is unusual and may indicate a malformed or ' +
      'hand-crafted binary intended to confuse analysis tools.',
    recommendation:
      'Recompile from source and do not hand-patch WASM exports.  Use ' +
      '`wasm-objdump -x` to inspect the export section.',
  },

  'SM-009': {
    id: 'SM-009',
    severity: SEVERITY.HIGH,
    title: 'Linear memory declared without an upper limit',
    description:
      'The contract declares a memory section with a minimum size of 2 or ' +
      'more pages (≥128 KB) and no maximum.  Unbounded memory growth can ' +
      'exhaust host resources and may be exploited to perform denial-of-' +
      'service attacks against other contracts or the host node.',
    recommendation:
      'Declare an explicit memory maximum in the WASM memory section, or ' +
      "ensure the Soroban runtime's memory limits are enforced.  For most " +
      'token contracts a maximum of 16–32 pages is sufficient.',
  },

  'SM-010': {
    id: 'SM-010',
    severity: SEVERITY.MEDIUM,
    title: 'Excessive initial memory allocation',
    description:
      'The contract requests more than 512 WASM pages (32 MB) of initial ' +
      'linear memory.  This is far beyond what a standard Soroban token ' +
      'contract requires and may indicate bloat, embedded payloads, or an ' +
      'attempt to fingerprint the deployment environment.',
    recommendation:
      "Review the contract's memory requirements.  Standard token contracts " +
      'rarely need more than 16–32 pages.  Identify the source of the large ' +
      'allocation (embedded data, runtime, allocator configuration).',
  },

  'SM-011': {
    id: 'SM-011',
    severity: SEVERITY.HIGH,
    title: 'Auto-execution start function detected',
    description:
      'The WASM binary contains a "start" section, which causes a designated ' +
      'function to execute automatically during contract instantiation — ' +
      'before any explicit call is made.  Legitimate Soroban contracts do not ' +
      'require a start function.  This is a common technique used by malware ' +
      'to run initialisation code without detection.',
    recommendation:
      'Remove the start section from the WASM binary.  Recompile without ' +
      'any `#[start]` annotation or runtime that injects a start function.  ' +
      'Verify the output with `wasm-objdump -x | grep -i start`.',
  },

  'SM-012': {
    id: 'SM-012',
    severity: SEVERITY.MEDIUM,
    title: 'Excessive mutable globals',
    description:
      'The contract defines more than 20 mutable global variables.  ' +
      'While mutable globals are valid in WASM, a large number of them can ' +
      'indicate a port from unsafe C/C++ code, hidden persistent state, or ' +
      'obfuscated control flow.  Soroban contracts should prefer ledger ' +
      'storage over mutable globals.',
    recommendation:
      'Audit each mutable global.  Prefer Soroban ledger storage for ' +
      'persistent state.  If the globals originate from a Rust runtime or ' +
      'allocator, consider a more minimal no_std setup.',
  },

  'SM-013': {
    id: 'SM-013',
    severity: SEVERITY.MEDIUM,
    title: 'High-entropy data section detected',
    description:
      'One or more data segments have a Shannon entropy above 7.2 bits/byte ' +
      'and are larger than 256 bytes.  This entropy level is consistent with ' +
      'encrypted, compressed, or otherwise obfuscated payloads embedded in ' +
      'the binary.  Legitimate string constants and lookup tables rarely ' +
      'exceed 6.5 bits/byte.',
    recommendation:
      'Identify the source of the high-entropy segments.  If they are ' +
      'compressed assets, ensure they are necessary.  If their origin is ' +
      'unknown, treat the contract as potentially malicious.  Tools such as ' +
      '`binwalk` can help identify embedded payloads.',
  },

  'SM-014': {
    id: 'SM-014',
    severity: SEVERITY.HIGH,
    title: 'Suspicious byte patterns in data section',
    description:
      'A data segment contains patterns associated with malicious payloads: ' +
      'null-byte floods (over 50% of a 64-byte sample is 0x00, indicating ' +
      'padding around hidden data) or ASCII-encoded Stellar G-address strings ' +
      '(hardcoded account keys are a red flag in trustless contracts).',
    recommendation:
      'Review all embedded string constants in the contract source.  ' +
      'Never hardcode private keys, admin addresses, or privileged account ' +
      'IDs in the binary.  Use on-chain storage and the authorization ' +
      'framework instead.',
  },

  'SM-015': {
    id: 'SM-015',
    severity: SEVERITY.MEDIUM,
    title: 'Oversized data sections',
    description:
      'The total size of all data segments exceeds 512 KB.  Legitimate ' +
      'Soroban token contracts do not require large data sections.  Bloated ' +
      'data may indicate embedded binaries, payload stagers, or obfuscated ' +
      'bytecode that is decoded and executed at runtime.',
    recommendation:
      'Audit the source of all embedded data.  Large constant tables and ' +
      'fonts should not be embedded in on-chain contracts.  Consider moving ' +
      'large assets to IPFS and referencing them by hash.',
  },

  'SM-016': {
    id: 'SM-016',
    severity: SEVERITY.MEDIUM,
    title: 'Excessive function count',
    description:
      'The function section declares more than 2 000 functions.  This is ' +
      'unusual for a Soroban token contract and may indicate obfuscation via ' +
      'code inflation, a monolithic runtime bundled into the contract, or an ' +
      'attempt to slow down analysis tools.',
    recommendation:
      'Profile the compiled binary to identify where the function count ' +
      'originates.  Consider using `wasm-opt` to strip dead code.  A well-' +
      'optimised Soroban token contract typically has fewer than 200 functions.',
  },

  'SM-017': {
    id: 'SM-017',
    severity: SEVERITY.LOW,
    title: 'Oversized code section',
    description:
      'The code section is larger than 1 MB.  While not necessarily ' +
      'malicious, this is significantly larger than expected for a Soroban ' +
      'token contract.  Large code sections increase deployment cost and ' +
      'reduce auditability.',
    recommendation:
      'Run `wasm-opt -Oz` to strip dead code and optimise for size.  ' +
      'If the size is due to third-party crates, audit each dependency and ' +
      'consider lighter alternatives.',
  },

  'SM-018': {
    id: 'SM-018',
    severity: SEVERITY.CRITICAL,
    title: 'WASM file exceeds maximum allowed size',
    description:
      'The uploaded WASM binary is larger than the configured maximum size ' +
      'limit.  Oversized WASM files are rejected to prevent resource ' +
      'exhaustion on the scanner and to enforce reasonable contract size ' +
      'limits before on-chain deployment.',
    recommendation:
      'Reduce the binary size with `wasm-opt -Oz --strip-debug`.  If the ' +
      'contract genuinely requires this size, contact the platform ' +
      'administrators to request a limit increase.',
  },

  'SM-019': {
    id: 'SM-019',
    severity: SEVERITY.MEDIUM,
    title: 'WASM file is suspiciously small',
    description:
      'The uploaded binary is 8 bytes or fewer — just the magic number and ' +
      'version header with no sections.  This is an empty WASM module that ' +
      'cannot perform any useful work on-chain.',
    recommendation:
      'Upload the complete compiled .wasm file, not a partial or truncated ' +
      'binary.',
  },

  'SM-020': {
    id: 'SM-020',
    severity: SEVERITY.LOW,
    title: 'Large WASM file — review recommended',
    description:
      'The WASM binary is between 500 KB and the maximum allowed size.  ' +
      'This is larger than typical for a Soroban token contract and warrants ' +
      'a size audit to confirm there is no unnecessary bloat.',
    recommendation:
      'Run `wasm-opt -Oz --strip-debug --strip-producers` to reduce size.  ' +
      'Use `twiggy` or `wasm-objdump` to identify large contributors.',
  },
});

// ---------------------------------------------------------------------------
// BufferReader — low-level binary reader
// ---------------------------------------------------------------------------

/**
 * @class BufferReader
 * @notice Stateful reader over a Node.js Buffer with LEB128 and WASM string
 *         helpers.  Throws a descriptive Error on any out-of-bounds access so
 *         callers can catch and record parse errors gracefully.
 */
class BufferReader {
  /**
   * @param {Buffer} buf  The buffer to read from.
   */
  constructor(buf) {
    /** @type {Buffer} */
    this._buf = buf;
    /** @type {number} Current read position. */
    this._pos = 0;
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /** Current read position (byte offset). */
  get pos() {
    return this._pos;
  }

  /** Overwrite the read position.  Used to hard-jump to section boundaries. */
  set pos(n) {
    if (n < 0 || n > this._buf.length) {
      throw new RangeError(
        `BufferReader: attempted to set pos to ${n} (buf length ${this._buf.length})`
      );
    }
    this._pos = n;
  }

  /** True when all bytes have been consumed. */
  get done() {
    return this._pos >= this._buf.length;
  }

  /** Number of bytes remaining. */
  get remaining() {
    return this._buf.length - this._pos;
  }

  // ── Primitive reads ───────────────────────────────────────────────────────

  /**
   * Read and return a single byte, advancing the position by 1.
   * @returns {number} Unsigned byte value (0–255).
   */
  readByte() {
    if (this._pos >= this._buf.length) {
      throw new RangeError(
        `BufferReader.readByte: unexpected end of buffer at pos ${this._pos}`
      );
    }
    return this._buf[this._pos++];
  }

  /**
   * Read a 4-byte little-endian unsigned 32-bit integer.
   * @returns {number}
   */
  readUint32LE() {
    if (this._pos + 4 > this._buf.length) {
      throw new RangeError(
        `BufferReader.readUint32LE: need 4 bytes at pos ${this._pos}, only ${this.remaining} remain`
      );
    }
    const val = this._buf.readUInt32LE(this._pos);
    this._pos += 4;
    return val;
  }

  /**
   * Decode an unsigned LEB128-encoded variable-length integer.
   * Maximum decoded value: 2^32 − 1 (u32 range).
   * @returns {number} Decoded value as a JS number (always non-negative).
   */
  readLEB128U() {
    let result = 0;
    let shift = 0;

    for (let i = 0; i < 5; i++) {
      // u32 fits in at most 5 LEB128 bytes
      const byte = this.readByte();
      result |= (byte & 0x7f) << shift; // accumulate 7 bits
      if ((byte & 0x80) === 0) {
        // high bit clear → last byte
        return result >>> 0; // convert signed int to unsigned u32
      }
      shift += 7;
    }

    throw new RangeError(
      'BufferReader.readLEB128U: LEB128 integer exceeds 5 bytes (u32 overflow)'
    );
  }

  /**
   * Read a WASM length-prefixed UTF-8 string (LEB128 length + bytes).
   * @returns {string}
   */
  readString() {
    const len = this.readLEB128U();
    if (this._pos + len > this._buf.length) {
      throw new RangeError(
        `BufferReader.readString: string of length ${len} exceeds buffer at pos ${this._pos}`
      );
    }
    const str = this._buf.slice(this._pos, this._pos + len).toString('utf8');
    this._pos += len;
    return str;
  }

  /**
   * Read a WASM byte-vector: LEB128 length followed by that many bytes.
   * @returns {Buffer} Slice of the underlying buffer.
   */
  readByteVec() {
    const len = this.readLEB128U();
    if (this._pos + len > this._buf.length) {
      throw new RangeError(
        `BufferReader.readByteVec: vector of length ${len} exceeds buffer at pos ${this._pos}`
      );
    }
    const slice = this._buf.slice(this._pos, this._pos + len);
    this._pos += len;
    return slice;
  }

  /**
   * Skip exactly n bytes.
   * @param {number} n
   */
  skip(n) {
    if (n < 0 || this._pos + n > this._buf.length) {
      throw new RangeError(
        `BufferReader.skip: cannot skip ${n} bytes at pos ${this._pos} (remaining ${this.remaining})`
      );
    }
    this._pos += n;
  }

  /**
   * Skip a WASM init_expression — a sequence of instructions terminated by
   * the `end` opcode (0x0B).  Only the subset of opcodes legal in a constant
   * expression is handled; anything else is skipped by the terminal scan.
   *
   * @dev WASM MVP constant expressions may contain:
   *   0x41 i32.const  + LEB128 i32
   *   0x42 i64.const  + LEB128 i64
   *   0x43 f32.const  + 4 bytes
   *   0x44 f64.const  + 8 bytes
   *   0x23 global.get + LEB128 index
   *   0xD0 ref.null   + 1 byte  (ref type)
   *   0xD2 ref.func   + LEB128 index
   *   0x0B end
   */
  skipInitExpr() {
    let safety = 0;
    while (!this.done && safety++ < 64) {
      const op = this.readByte();
      switch (op) {
        case 0x0b: // end
          return;
        case 0x41: // i32.const
        case 0x42: // i64.const
        case 0x23: // global.get
        case 0xd2: // ref.func
          this.readLEB128U();
          break;
        case 0x43: // f32.const
          this.skip(4);
          break;
        case 0x44: // f64.const
          this.skip(8);
          break;
        case 0xd0: // ref.null
          this.readByte(); // reftype byte
          break;
        case 0xfc: {
          // extended opcodes
          this.readLEB128U(); // secondary opcode
          break;
        }
        default:
          // Unknown opcode inside init_expr — skip silently, terminal scan
          // will find the 0x0B end opcode eventually.
          break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shannon entropy helper
// ---------------------------------------------------------------------------

/**
 * @notice Computes the Shannon entropy (in bits/byte) of a Buffer.
 * @param {Buffer} buf
 * @returns {number} Entropy value in [0, 8].
 */
function shannonEntropy(buf) {
  if (!buf || buf.length === 0) return 0;

  const freq = new Array(256).fill(0);
  for (const b of buf) freq[b]++;

  let H = 0;
  for (const f of freq) {
    if (f > 0) {
      const p = f / buf.length;
      H -= p * Math.log2(p);
    }
  }
  return H;
}

// ---------------------------------------------------------------------------
// WASM section parser
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ParsedSections
 * @property {Array<{module:string, name:string, kind:number}>} imports
 * @property {Array<{name:string, kind:number, index:number}>}  exports
 * @property {Array<{hasMax:boolean, min:number, max:number|null}>} memories
 * @property {Array<{valueType:number, mutable:boolean}>}        globals
 * @property {Array<{size:number, entropy:number, rawSample:Buffer}>} dataSegments
 * @property {boolean}         hasStartSection
 * @property {number|null}     startFunctionIndex
 * @property {number}          functionCount
 * @property {{size:number, offset:number}|null} codeSection
 * @property {Array<{name:string, size:number}>} customSections
 * @property {string[]}        parseErrors
 */

/**
 * @notice Parses all interesting WASM sections from a validated binary buffer.
 *         The first 8 bytes (magic + version) must already have been checked
 *         by the caller.  This function begins reading at byte 8.
 *
 * @param {Buffer} buf  The full WASM binary buffer.
 * @returns {ParsedSections}
 */
function parseWasmSections(buf) {
  /** @type {ParsedSections} */
  const sections = {
    imports: [],
    exports: [],
    memories: [],
    globals: [],
    dataSegments: [],
    hasStartSection: false,
    startFunctionIndex: null,
    functionCount: 0,
    codeSection: null,
    customSections: [],
    parseErrors: [],
  };

  const reader = new BufferReader(buf);
  reader.pos = 8; // skip magic + version

  while (!reader.done) {
    let sectionId, sectionSize;

    // ── Read section header ──────────────────────────────────────────────────
    try {
      sectionId = reader.readByte();
      sectionSize = reader.readLEB128U();
    } catch (err) {
      sections.parseErrors.push(
        `Truncated section header at offset ${reader.pos}: ${err.message}`
      );
      break;
    }

    const sectionStart = reader.pos;
    const sectionEnd = sectionStart + sectionSize;

    // Guard against malformed size field that would push us past the buffer
    if (sectionEnd > buf.length) {
      sections.parseErrors.push(
        `Section ${sectionId} at offset ${sectionStart} claims size ${sectionSize} ` +
          `but only ${buf.length - sectionStart} bytes remain`
      );
      break; // cannot safely continue
    }

    // ── Parse section body ───────────────────────────────────────────────────
    try {
      switch (sectionId) {
        case 0: // Custom
          parseCustomSection(reader, sections, sectionEnd);
          break;
        case 2: // Import
          parseImportSection(reader, sections, sectionEnd);
          break;
        case 3: // Function (type-index list — just count)
          sections.functionCount = reader.readLEB128U();
          // remaining type indices skipped below
          break;
        case 5: // Memory
          parseMemorySection(reader, sections);
          break;
        case 6: // Global
          parseGlobalSection(reader, sections, sectionEnd);
          break;
        case 7: // Export
          parseExportSection(reader, sections, sectionEnd);
          break;
        case 8: // Start
          sections.hasStartSection = true;
          sections.startFunctionIndex = reader.readLEB128U();
          break;
        case 10: // Code
          sections.codeSection = { size: sectionSize, offset: sectionStart };
          // body not disassembled — skip below
          break;
        case 11: // Data
          parseDataSection(reader, sections, sectionEnd);
          break;
        default:
          // Type(1), Table(4), Element(9), DataCount(12), etc. — skip
          break;
      }
    } catch (err) {
      sections.parseErrors.push(
        `Error parsing section id=${sectionId} at offset ${sectionStart}: ${err.message}`
      );
    }

    // Always advance to the section boundary to stay aligned regardless of
    // partial parse errors.
    reader.pos = sectionEnd;
  }

  return sections;
}

// ── Section-specific parsers ─────────────────────────────────────────────────

/**
 * Parse the import section (section id 2).
 * @param {BufferReader}  reader
 * @param {ParsedSections} sections
 * @param {number}         sectionEnd  — absolute end offset for safety guard
 */
function parseImportSection(reader, sections, sectionEnd) {
  const count = reader.readLEB128U();

  for (let i = 0; i < count && reader.pos < sectionEnd; i++) {
    const module = reader.readString();
    const name = reader.readString();
    const kind = reader.readByte();

    // Skip the type descriptor for each import kind
    switch (kind) {
      case 0: // function — one LEB128 type index
        reader.readLEB128U();
        break;
      case 1: // table — reftype byte + limits (flags byte + min LEB128 + optional max LEB128)
        reader.readByte(); // ref type
        skipMemLimits(reader);
        break;
      case 2: // memory — limits
        skipMemLimits(reader);
        break;
      case 3: // global — value type byte + mutability byte
        reader.readByte();
        reader.readByte();
        break;
      default:
        // Unknown import kind — cannot safely skip, abort section
        sections.parseErrors.push(
          `Unknown import kind ${kind} for ${module}.${name}`
        );
        return;
    }

    sections.imports.push({ module, name, kind });
  }
}

/**
 * Parse the export section (section id 7).
 * @param {BufferReader}  reader
 * @param {ParsedSections} sections
 * @param {number}         sectionEnd
 */
function parseExportSection(reader, sections, sectionEnd) {
  const count = reader.readLEB128U();

  for (let i = 0; i < count && reader.pos < sectionEnd; i++) {
    const name = reader.readString();
    const kind = reader.readByte();
    const index = reader.readLEB128U();

    sections.exports.push({ name, kind, index });
  }
}

/**
 * Parse the memory section (section id 5).
 * @param {BufferReader}  reader
 * @param {ParsedSections} sections
 */
function parseMemorySection(reader, sections) {
  const count = reader.readLEB128U();

  for (let i = 0; i < count; i++) {
    const flags = reader.readByte();
    const hasMax = (flags & 0x01) !== 0;
    const min = reader.readLEB128U();
    const max = hasMax ? reader.readLEB128U() : null;

    sections.memories.push({ hasMax, min, max });
  }
}

/**
 * Parse the global section (section id 6).
 * @param {BufferReader}  reader
 * @param {ParsedSections} sections
 * @param {number}         sectionEnd
 */
function parseGlobalSection(reader, sections, sectionEnd) {
  const count = reader.readLEB128U();

  for (let i = 0; i < count && reader.pos < sectionEnd; i++) {
    const valueType = reader.readByte(); // e.g. 0x7f=i32, 0x7e=i64
    const mutByte = reader.readByte(); // 0x00=const, 0x01=var
    reader.skipInitExpr();

    sections.globals.push({ valueType, mutable: mutByte === 0x01 });
  }
}

/**
 * Parse the data section (section id 11).
 * @param {BufferReader}  reader
 * @param {ParsedSections} sections
 * @param {number}         sectionEnd
 */
function parseDataSection(reader, sections, sectionEnd) {
  const count = reader.readLEB128U();

  for (let i = 0; i < count && reader.pos < sectionEnd; i++) {
    const flags = reader.readLEB128U(); // 0=active-mem0, 1=passive, 2=active-memN

    if (flags === 0) {
      // Active segment in memory 0: skip offset init_expr
      reader.skipInitExpr();
    } else if (flags === 2) {
      // Active segment in named memory: skip memory index + init_expr
      reader.readLEB128U();
      reader.skipInitExpr();
    }
    // flags === 1 → passive segment, no init_expr

    const data = reader.readByteVec();
    const entropy = shannonEntropy(data);
    const rawSample = data.slice(0, 64); // first 64 bytes for pattern analysis

    sections.dataSegments.push({ size: data.length, entropy, rawSample });
  }
}

/**
 * Parse a custom section (section id 0) — record name and size only.
 * @param {BufferReader}  reader
 * @param {ParsedSections} sections
 * @param {number}         sectionEnd
 */
function parseCustomSection(reader, sections, sectionEnd) {
  const name = reader.readString();
  sections.customSections.push({ name, size: sectionEnd - reader.pos });
  // body skipped at the call site via reader.pos = sectionEnd
}

/**
 * Skip a WASM memory limits struct.
 * @param {BufferReader} reader
 */
function skipMemLimits(reader) {
  const flags = reader.readByte();
  reader.readLEB128U(); // min
  if (flags & 0x01) reader.readLEB128U(); // max (if present)
}

// ---------------------------------------------------------------------------
// Rule evaluators
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Finding
 * @property {string}  ruleId
 * @property {string}  severity
 * @property {string}  title
 * @property {string}  description
 * @property {string}  recommendation
 * @property {object|null} location
 */

/**
 * @notice Evaluates all 20 rules against the scan inputs and returns the full
 *         findings array.  Rules that do not fire produce no output.
 *
 * @param {Buffer}         wasmBuf    Raw WASM binary
 * @param {ParsedSections} sections   Result of parseWasmSections
 * @param {number}         maxWasmSize
 * @returns {Finding[]}
 */
function runRules(wasmBuf, sections, maxWasmSize) {
  /** @type {Finding[]} */
  const findings = [];

  /**
   * Append a finding for a given rule.
   * @param {string}      ruleId
   * @param {object|null} [location]
   * @param {string}      [descriptionSuffix]  — appended to the rule's default description
   */
  const fire = (ruleId, location = null, descriptionSuffix = '') => {
    const rule = RULES[ruleId];
    if (!rule) return;

    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.title,
      description:
        rule.description + (descriptionSuffix ? '  ' + descriptionSuffix : ''),
      recommendation: rule.recommendation,
      location,
    });
  };

  // ── SM-018 / SM-019  WASM size checks (run before parse) ──────────────────

  if (wasmBuf.length > maxWasmSize) {
    fire(
      'SM-018',
      null,
      `Uploaded size: ${(wasmBuf.length / 1024 / 1024).toFixed(2)} MB, ` +
        `limit: ${(maxWasmSize / 1024 / 1024).toFixed(2)} MB.`
    );
    // When the file is too large we still run all other rules; however
    // if the scanner aborted due to parse errors the section data may be
    // incomplete — that is fine.
  }

  if (wasmBuf.length <= 8) {
    fire('SM-019', null, `File size: ${wasmBuf.length} byte(s).`);
    // Nothing more to check — no real sections exist.
    return findings;
  }

  // ── SM-020  Large-file advisory (between 500 KB and maxWasmSize) ──────────

  if (wasmBuf.length > 500_000 && wasmBuf.length <= maxWasmSize) {
    fire(
      'SM-020',
      null,
      `File size: ${(wasmBuf.length / 1024).toFixed(1)} KB.`
    );
  }

  // ── SM-003  Malformed sections ─────────────────────────────────────────────

  if (sections.parseErrors.length > 0) {
    fire(
      'SM-003',
      { section: 'multiple', detail: sections.parseErrors.join('; ') },
      `Parser errors: ${sections.parseErrors.join('; ')}`
    );
  }

  // ── SM-004 / SM-005 / SM-006  Import analysis ──────────────────────────────

  const sorobanImports = sections.imports.filter(
    (i) => i.module === SOROBAN_HOST_MODULE
  );
  const suspiciousImports = sections.imports.filter((i) =>
    SUSPICIOUS_IMPORT_MODULES.has(i.module.toLowerCase())
  );
  const unknownImports = sections.imports.filter(
    (i) =>
      !ALLOWED_IMPORT_MODULES.has(i.module) &&
      !SUSPICIOUS_IMPORT_MODULES.has(i.module.toLowerCase())
  );

  if (sorobanImports.length === 0 && sections.imports.length > 0) {
    fire(
      'SM-004',
      { section: 'import' },
      `Total imports: ${sections.imports.length}, none from module "_".`
    );
  } else if (sections.imports.length === 0) {
    fire('SM-004', { section: 'import' }, 'No import section found.');
  }

  if (suspiciousImports.length > 0) {
    const names = [...new Set(suspiciousImports.map((i) => `"${i.module}"`))]
      .slice(0, 5)
      .join(', ');
    fire('SM-005', { section: 'import' }, `Suspicious modules: ${names}.`);
  }

  if (sorobanImports.length > 0 && sorobanImports.length < 3) {
    fire(
      'SM-006',
      { section: 'import' },
      `Only ${sorobanImports.length} Soroban host function(s) imported.`
    );
  }

  // ── SM-007 / SM-008  Export analysis ──────────────────────────────────────

  const funcExports = sections.exports.filter((e) => e.kind === 0);

  if (funcExports.length === 0) {
    fire(
      'SM-007',
      { section: 'export' },
      'No function exports found in the export section.'
    );
  }

  const exportNames = sections.exports.map((e) => e.name);
  const duplicates = exportNames.filter(
    (name, idx) => exportNames.indexOf(name) !== idx
  );
  if (duplicates.length > 0) {
    const shown = [...new Set(duplicates)].slice(0, 5).join(', ');
    fire('SM-008', { section: 'export' }, `Duplicate export names: ${shown}.`);
  }

  // ── SM-009 / SM-010  Memory analysis ──────────────────────────────────────

  for (let idx = 0; idx < sections.memories.length; idx++) {
    const mem = sections.memories[idx];

    if (!mem.hasMax && mem.min >= 2) {
      fire(
        'SM-009',
        { section: 'memory', detail: `memory[${idx}]` },
        `Memory[${idx}]: min=${mem.min} pages (${mem.min * 64} KB), no maximum declared.`
      );
    }

    if (mem.min > 512) {
      fire(
        'SM-010',
        { section: 'memory', detail: `memory[${idx}]` },
        `Memory[${idx}]: min=${mem.min} pages (${((mem.min * 64) / 1024).toFixed(0)} MB initial).`
      );
    }
  }

  // ── SM-011  Start function (auto-execution) ────────────────────────────────

  if (sections.hasStartSection) {
    fire('SM-011', {
      section: 'start',
      detail: `function index ${sections.startFunctionIndex}`,
    });
  }

  // ── SM-012  Mutable globals ────────────────────────────────────────────────

  const mutableGlobals = sections.globals.filter((g) => g.mutable);
  if (mutableGlobals.length > 20) {
    fire(
      'SM-012',
      { section: 'global' },
      `${mutableGlobals.length} mutable globals declared (threshold: 20).`
    );
  }

  // ── SM-013 / SM-014 / SM-015  Data section analysis ───────────────────────

  let totalDataSize = 0;

  // Regex to detect Stellar G-address ASCII strings embedded in data
  // A Stellar public key is 56 chars: G + 55 chars from [A-Z2-7]
  const stellarAddrBytes = /G[A-Z2-7]{10}/; // detect at least a 11-char prefix

  for (let idx = 0; idx < sections.dataSegments.length; idx++) {
    const seg = sections.dataSegments[idx];
    totalDataSize += seg.size;

    // SM-013  High entropy
    if (seg.entropy > 7.2 && seg.size > 256) {
      fire(
        'SM-013',
        { section: 'data', detail: `segment[${idx}]` },
        `Segment[${idx}]: size=${seg.size}B, entropy=${seg.entropy.toFixed(3)} bits/byte.`
      );
    }

    // SM-014  Suspicious byte patterns
    if (seg.rawSample.length > 0) {
      const nullCount = [...seg.rawSample].filter((b) => b === 0x00).length;
      const nullRatio = nullCount / seg.rawSample.length;

      if (nullRatio > 0.5) {
        fire(
          'SM-014',
          { section: 'data', detail: `segment[${idx}] null-byte flood` },
          `Segment[${idx}]: ${(nullRatio * 100).toFixed(0)}% null bytes in the first 64 bytes.`
        );
      } else {
        // Check for ASCII Stellar G-address patterns
        const sample = seg.rawSample.toString('ascii');
        if (stellarAddrBytes.test(sample)) {
          fire(
            'SM-014',
            {
              section: 'data',
              detail: `segment[${idx}] embedded Stellar address`,
            },
            `Segment[${idx}]: possible hardcoded Stellar G-address detected in data.`
          );
        }
      }
    }
  }

  // SM-015  Total data section size
  if (totalDataSize > 512 * 1024) {
    fire(
      'SM-015',
      { section: 'data' },
      `Total data segment size: ${(totalDataSize / 1024).toFixed(1)} KB (threshold: 512 KB).`
    );
  }

  // ── SM-016  Excessive functions ────────────────────────────────────────────

  if (sections.functionCount > 2000) {
    fire(
      'SM-016',
      { section: 'function' },
      `Function count: ${sections.functionCount} (threshold: 2000).`
    );
  }

  // ── SM-017  Oversized code section ────────────────────────────────────────

  if (sections.codeSection && sections.codeSection.size > 1_000_000) {
    fire(
      'SM-017',
      { section: 'code', offset: sections.codeSection.offset },
      `Code section size: ${(sections.codeSection.size / 1024).toFixed(1)} KB (threshold: 1000 KB).`
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ScanReport
 * @property {string}        wasmHash          — SHA-256 hex of the raw input
 * @property {number}        wasmSize          — byte length of the input
 * @property {string}        status            — One of SCAN_STATUS values
 * @property {Finding[]}     findings          — All findings, ordered by severity
 * @property {object}        summary           — Per-severity counts + pass/total
 * @property {boolean}       deploymentBlocked — true when status is failed/error
 * @property {string}        scannerVersion    — '1.0.0'
 * @property {ParsedSections} parsedSections   — Raw parse result (debugging)
 * @property {number}        duration          — Wall-clock ms for the scan
 */

/**
 * @notice Run a complete security scan on a WASM binary buffer.
 *
 * @param {Buffer} wasmBuffer   Raw WASM binary (any length, validated internally).
 * @param {object} [opts]
 * @param {number} [opts.maxWasmSize=5_242_880]  Maximum allowed WASM size in bytes.
 *
 * @returns {ScanReport}
 *
 * @example
 *   const fs   = require('fs');
 *   const buf  = fs.readFileSync('my_token.wasm');
 *   const report = scanWasm(buf);
 *   console.log(report.status, report.summary);
 */
function scanWasm(wasmBuffer, opts = {}) {
  const startTime = Date.now();
  const maxWasmSize = opts.maxWasmSize || DEFAULT_MAX_WASM_SIZE;

  // ── Compute the WASM hash (always, even on malformed input) ───────────────
  const wasmHash = crypto.createHash('sha256').update(wasmBuffer).digest('hex');
  const wasmSize = wasmBuffer.length;

  const TOTAL_RULES = Object.keys(RULES).length; // 20

  // ── Structural validation (SM-001, SM-002) ─────────────────────────────────
  let structuralFindings = [];

  const tooShort = wasmBuffer.length < 8;
  const badMagic =
    tooShort ||
    wasmBuffer[0] !== WASM_MAGIC[0] ||
    wasmBuffer[1] !== WASM_MAGIC[1] ||
    wasmBuffer[2] !== WASM_MAGIC[2] ||
    wasmBuffer[3] !== WASM_MAGIC[3];

  if (badMagic) {
    structuralFindings.push({
      ruleId: RULES['SM-001'].id,
      severity: RULES['SM-001'].severity,
      title: RULES['SM-001'].title,
      description:
        RULES['SM-001'].description +
        (tooShort
          ? `  Buffer is only ${wasmBuffer.length} byte(s) long.`
          : `  Got bytes: 0x${wasmBuffer.slice(0, 4).toString('hex')}.`),
      recommendation: RULES['SM-001'].recommendation,
      location: { section: 'header', offset: 0 },
    });

    // Cannot parse sections — return immediately with an error status
    return buildReport(
      wasmHash,
      wasmSize,
      structuralFindings,
      TOTAL_RULES,
      {},
      Date.now() - startTime,
      true /* forceError */
    );
  }

  const version = wasmBuffer.readUInt32LE(4);
  if (version !== WASM_VERSION) {
    structuralFindings.push({
      ruleId: RULES['SM-002'].id,
      severity: RULES['SM-002'].severity,
      title: RULES['SM-002'].title,
      description:
        RULES['SM-002'].description + `  Declared version: ${version}.`,
      recommendation: RULES['SM-002'].recommendation,
      location: { section: 'header', offset: 4 },
    });

    return buildReport(
      wasmHash,
      wasmSize,
      structuralFindings,
      TOTAL_RULES,
      {},
      Date.now() - startTime,
      true /* forceError */
    );
  }

  // ── Section parsing ────────────────────────────────────────────────────────
  let sections;
  try {
    sections = parseWasmSections(wasmBuffer);
  } catch (err) {
    // Catastrophic parse failure — treat as malformed
    const findings = [
      {
        ruleId: RULES['SM-003'].id,
        severity: RULES['SM-003'].severity,
        title: RULES['SM-003'].title,
        description:
          RULES['SM-003'].description + `  Parser threw: ${err.message}`,
        recommendation: RULES['SM-003'].recommendation,
        location: null,
      },
    ];

    return buildReport(
      wasmHash,
      wasmSize,
      findings,
      TOTAL_RULES,
      {},
      Date.now() - startTime,
      true /* forceError */
    );
  }

  // ── Run all rules ──────────────────────────────────────────────────────────
  const findings = runRules(wasmBuffer, sections, maxWasmSize);

  return buildReport(
    wasmHash,
    wasmSize,
    findings,
    TOTAL_RULES,
    sections,
    Date.now() - startTime,
    false
  );
}

// ---------------------------------------------------------------------------
// Report builder (internal)
// ---------------------------------------------------------------------------

/**
 * @notice Assembles the final ScanReport from findings and metadata.
 * @param {string}         wasmHash
 * @param {number}         wasmSize
 * @param {Finding[]}      findings
 * @param {number}         totalChecks
 * @param {ParsedSections|{}} parsedSections
 * @param {number}         duration
 * @param {boolean}        forceError  — true when the WASM could not be parsed
 * @returns {ScanReport}
 */
function buildReport(
  wasmHash,
  wasmSize,
  findings,
  totalChecks,
  parsedSections,
  duration,
  forceError
) {
  // Sort by severity: critical → high → medium → low → info
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
  );

  // Build summary
  const summary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    passedChecks: 0,
    totalChecks,
  };

  for (const f of findings) {
    if (summary[f.severity] !== undefined) summary[f.severity]++;
  }

  summary.passedChecks = Math.max(0, totalChecks - findings.length);

  // Derive status
  let status;
  if (forceError) {
    status = SCAN_STATUS.ERROR;
  } else if (summary.critical > 0 || summary.high > 0) {
    status = SCAN_STATUS.FAILED;
  } else if (summary.medium > 0 || summary.low > 0) {
    status = SCAN_STATUS.WARNING;
  } else {
    status = SCAN_STATUS.CLEAN;
  }

  const deploymentBlocked =
    status === SCAN_STATUS.FAILED || status === SCAN_STATUS.ERROR;

  return {
    wasmHash,
    wasmSize,
    status,
    findings,
    summary,
    deploymentBlocked,
    scannerVersion: SCANNER_VERSION,
    parsedSections,
    duration,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  scanWasm,
  RULES,
  SEVERITY,
  SCAN_STATUS,
  SCANNER_VERSION,
  // Exported for tests
  _internals: {
    BufferReader,
    parseWasmSections,
    shannonEntropy,
    runRules,
    buildReport,
  },
};
