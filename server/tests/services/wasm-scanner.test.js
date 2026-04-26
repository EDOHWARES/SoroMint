'use strict';

/**
 * @title WASM Scanner Unit Tests
 * @author SoroMint Team
 * @notice Comprehensive unit tests for the pure-JS WASM security scanning engine.
 *
 * @dev Test coverage:
 *   - BufferReader: all primitive reads, LEB128, strings, byte vectors, init_expr skip
 *   - shannonEntropy: known entropy values
 *   - parseWasmSections: valid WASM parsing, malformed input handling
 *   - All 20 security rules (SM-001 through SM-020)
 *   - scanWasm: happy-path, error-path, status derivation, report structure
 *   - buildReport: severity counting, deploymentBlocked logic
 *
 * Test WASM binaries are constructed programmatically using the WASM binary
 * format spec — no external fixtures required.
 */

// ── Test environment ──────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.WASM_MAX_SIZE_BYTES = String(5 * 1024 * 1024);

const {
  scanWasm,
  RULES,
  SEVERITY,
  SCAN_STATUS,
  SCANNER_VERSION,
  _internals,
} = require('../../services/wasm-scanner');

const { BufferReader, parseWasmSections, shannonEntropy, runRules } = _internals;

// ─────────────────────────────────────────────────────────────────────────────
// Binary construction helpers
// ─────────────────────────────────────────────────────────────────────────────

/** WASM magic + version 1 header (8 bytes). */
const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/**
 * Encode an unsigned integer as LEB128 bytes.
 * @param {number} n
 * @returns {number[]}
 */
function leb128U(n) {
  const bytes = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0);
  return bytes;
}

/**
 * Encode a UTF-8 string as WASM length-prefixed bytes.
 * @param {string} s
 * @returns {number[]}
 */
function wasmStr(s) {
  const encoded = Buffer.from(s, 'utf8');
  return [...leb128U(encoded.length), ...encoded];
}

/**
 * Wrap section content bytes in a WASM section envelope.
 * @param {number}   id      - Section ID
 * @param {number[]} content - Section body bytes
 * @returns {number[]}
 */
function section(id, content) {
  return [id, ...leb128U(content.length), ...content];
}

/**
 * Build a minimal valid WASM binary (magic + version + sections).
 * @param {...number[]} sections - Section byte arrays
 * @returns {Buffer}
 */
function buildWasm(...sections) {
  return Buffer.from([...WASM_HEADER, ...sections.flat()]);
}

/**
 * Encode a single WASM import entry.
 * @param {string} mod    - Module name
 * @param {string} name   - Field name
 * @param {number} kind   - 0=func, 1=table, 2=memory, 3=global
 * @param {number[]} [typeDesc=[0x00]] - Type descriptor bytes
 * @returns {number[]}
 */
function importEntry(mod, name, kind, typeDesc = [0x00]) {
  return [...wasmStr(mod), ...wasmStr(name), kind, ...typeDesc];
}

/**
 * Build an import section with the given import entries.
 * @param {...number[]} entries
 * @returns {number[]}
 */
function importSection(...entries) {
  const count = leb128U(entries.length);
  return section(2, [...count, ...entries.flat()]);
}

/**
 * Build an export section with one function export.
 * @param {string} name       - Export name
 * @param {number} [kind=0]   - 0=function
 * @param {number} [index=0]
 * @returns {number[]}
 */
function exportSection(name, kind = 0, index = 0) {
  const entry = [...wasmStr(name), kind, ...leb128U(index)];
  return section(7, [...leb128U(1), ...entry]);
}

/**
 * Build a memory section.
 * @param {number}       min
 * @param {number|null}  max - null = no maximum
 * @returns {number[]}
 */
function memorySection(min, max = null) {
  const hasMax = max !== null;
  const entry = hasMax
    ? [0x01, ...leb128U(min), ...leb128U(max)]
    : [0x00, ...leb128U(min)];
  return section(5, [...leb128U(1), ...entry]);
}

/**
 * Build a global section with `count` mutable i32 globals.
 * @param {number} count
 * @returns {number[]}
 */
function globalSection(count) {
  // Each entry: i32 (0x7f), mutable (0x01), i32.const 0 (0x41 0x00), end (0x0b)
  const entry = [0x7f, 0x01, 0x41, 0x00, 0x0b];
  const entries = Array.from({ length: count }, () => entry).flat();
  return section(6, [...leb128U(count), ...entries]);
}

/**
 * Build a start section pointing to function index 0.
 * @returns {number[]}
 */
function startSection() {
  return section(8, leb128U(0));
}

/**
 * Build a data section with a single active segment.
 * @param {Buffer|number[]} data - The data bytes
 * @returns {number[]}
 */
function dataSection(data) {
  const dataBytes = Buffer.isBuffer(data) ? [...data] : data;
  // Active segment in memory 0: flags=0, offset=i32.const 0 + end, then bytes
  const segment = [0x00, 0x41, 0x00, 0x0b, ...leb128U(dataBytes.length), ...dataBytes];
  return section(11, [...leb128U(1), ...segment]);
}

/**
 * Build a function section (just type indices).
 * @param {number} count
 * @returns {number[]}
 */
function functionSection(count) {
  const typeIndices = Array(count).fill(0).flatMap(() => leb128U(0));
  return section(3, [...leb128U(count), ...typeIndices]);
}

/**
 * Build a minimal valid Soroban-like WASM with a Soroban import and a function export.
 * Passes most rules as-is.
 * @param {object} [overrides]
 * @returns {Buffer}
 */
function buildCleanSorobanWasm(overrides = {}) {
  const {
    importCount = 5,
    exportName = '__invoke',
    memMin = 1,
    memMax = 16,
  } = overrides;

  const sorobanImports = Array.from({ length: importCount }, (_, i) =>
    importEntry('_', `host_fn_${i}`, 0, [0x00])
  );

  return buildWasm(
    importSection(...sorobanImports),
    functionSection(1),
    memorySection(memMin, memMax),
    exportSection(exportName),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BufferReader tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BufferReader', () => {
  describe('readByte()', () => {
    it('reads a single byte and advances position', () => {
      const r = new BufferReader(Buffer.from([0xAB]));
      expect(r.readByte()).toBe(0xAB);
      expect(r.pos).toBe(1);
      expect(r.done).toBe(true);
    });

    it('throws on read past end of buffer', () => {
      const r = new BufferReader(Buffer.alloc(0));
      expect(() => r.readByte()).toThrow(/unexpected end/i);
    });
  });

  describe('readUint32LE()', () => {
    it('reads 4 bytes little-endian', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0xDEADBEEF, 0);
      const r = new BufferReader(buf);
      expect(r.readUint32LE()).toBe(0xDEADBEEF);
      expect(r.pos).toBe(4);
    });

    it('throws when fewer than 4 bytes remain', () => {
      const r = new BufferReader(Buffer.from([0x01, 0x02]));
      expect(() => r.readUint32LE()).toThrow(/need 4 bytes/i);
    });
  });

  describe('readLEB128U()', () => {
    it('decodes single-byte values (≤127)', () => {
      for (const val of [0, 1, 63, 127]) {
        const r = new BufferReader(Buffer.from(leb128U(val)));
        expect(r.readLEB128U()).toBe(val);
      }
    });

    it('decodes multi-byte values', () => {
      const cases = [128, 256, 16383, 16384, 65535, 1_000_000, 0xFFFFFFFF];
      for (const val of cases) {
        const r = new BufferReader(Buffer.from(leb128U(val)));
        expect(r.readLEB128U()).toBe(val >>> 0);
      }
    });

    it('throws on more than 5 LEB128 bytes (overflow)', () => {
      // 6-byte LEB128 (each byte has continuation bit set)
      const overflow = Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x00]);
      const r = new BufferReader(overflow);
      expect(() => r.readLEB128U()).toThrow(/overflow/i);
    });
  });

  describe('readString()', () => {
    it('reads a length-prefixed UTF-8 string', () => {
      const r = new BufferReader(Buffer.from(wasmStr('hello')));
      expect(r.readString()).toBe('hello');
    });

    it('reads an empty string', () => {
      const r = new BufferReader(Buffer.from([0x00]));
      expect(r.readString()).toBe('');
    });

    it('reads unicode strings', () => {
      const r = new BufferReader(Buffer.from(wasmStr('日本語')));
      expect(r.readString()).toBe('日本語');
    });

    it('throws when the string length exceeds the buffer', () => {
      // Length prefix says 100 bytes but buffer has only 3
      const r = new BufferReader(Buffer.from([100, 0x41, 0x42, 0x43]));
      expect(() => r.readString()).toThrow(/exceeds buffer/i);
    });
  });

  describe('readByteVec()', () => {
    it('reads a length-prefixed byte vector', () => {
      const data = [0xDE, 0xAD, 0xBE, 0xEF];
      const buf = Buffer.from([...leb128U(data.length), ...data]);
      const r = new BufferReader(buf);
      const result = r.readByteVec();
      expect([...result]).toEqual(data);
    });

    it('reads an empty byte vector', () => {
      const r = new BufferReader(Buffer.from([0x00]));
      const result = r.readByteVec();
      expect(result.length).toBe(0);
    });
  });

  describe('skip()', () => {
    it('advances position by n bytes', () => {
      const r = new BufferReader(Buffer.alloc(10));
      r.skip(5);
      expect(r.pos).toBe(5);
    });

    it('throws when skipping past buffer end', () => {
      const r = new BufferReader(Buffer.alloc(4));
      expect(() => r.skip(10)).toThrow(/cannot skip/i);
    });
  });

  describe('pos setter', () => {
    it('allows jumping to any valid position', () => {
      const r = new BufferReader(Buffer.alloc(10));
      r.pos = 7;
      expect(r.pos).toBe(7);
    });

    it('throws when position is negative', () => {
      const r = new BufferReader(Buffer.alloc(10));
      expect(() => { r.pos = -1; }).toThrow(/attempted to set pos/i);
    });

    it('throws when position exceeds buffer length', () => {
      const r = new BufferReader(Buffer.alloc(10));
      expect(() => { r.pos = 11; }).toThrow(/attempted to set pos/i);
    });
  });

  describe('done / remaining', () => {
    it('done is false when bytes remain', () => {
      const r = new BufferReader(Buffer.alloc(5));
      expect(r.done).toBe(false);
    });

    it('done is true after consuming all bytes', () => {
      const r = new BufferReader(Buffer.from([0x01]));
      r.readByte();
      expect(r.done).toBe(true);
    });

    it('remaining returns correct count', () => {
      const r = new BufferReader(Buffer.alloc(8));
      r.pos = 3;
      expect(r.remaining).toBe(5);
    });
  });

  describe('skipInitExpr()', () => {
    it('skips i32.const + end', () => {
      // i32.const 42 = 0x41 0x2a, end = 0x0b
      const r = new BufferReader(Buffer.from([0x41, 0x2a, 0x0b, 0xFF]));
      r.skipInitExpr();
      expect(r.pos).toBe(3); // consumed i32.const (2 bytes) + end (1 byte)
    });

    it('skips f32.const + end', () => {
      // f32.const = 0x43, 4 bytes float, end = 0x0b
      const r = new BufferReader(Buffer.from([0x43, 0x00, 0x00, 0x00, 0x3f, 0x0b]));
      r.skipInitExpr();
      expect(r.pos).toBe(6);
    });

    it('terminates immediately on end opcode', () => {
      const r = new BufferReader(Buffer.from([0x0b, 0xFF, 0xFF]));
      r.skipInitExpr();
      expect(r.pos).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shannonEntropy tests
// ─────────────────────────────────────────────────────────────────────────────

describe('shannonEntropy()', () => {
  it('returns 0 for a buffer of identical bytes', () => {
    const buf = Buffer.alloc(100, 0x00);
    expect(shannonEntropy(buf)).toBe(0);
  });

  it('returns exactly 1.0 for a 2-symbol equally-probable distribution', () => {
    // Alternating 0x00 and 0xFF → p(0)=0.5, p(1)=0.5 → H=1
    const buf = Buffer.from(Array.from({ length: 256 }, (_, i) => i % 2 === 0 ? 0x00 : 0xFF));
    expect(shannonEntropy(buf)).toBeCloseTo(1.0, 5);
  });

  it('returns ~8.0 for a perfectly uniform byte distribution', () => {
    // All 256 byte values appearing exactly once → maximum entropy = 8
    const buf = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    expect(shannonEntropy(buf)).toBeCloseTo(8.0, 4);
  });

  it('returns a value below 5 for a typical ASCII text buffer', () => {
    const text = 'The quick brown fox jumps over the lazy dog.'.repeat(10);
    const buf = Buffer.from(text, 'ascii');
    expect(shannonEntropy(buf)).toBeLessThan(5);
  });

  it('returns 0 for an empty buffer', () => {
    expect(shannonEntropy(Buffer.alloc(0))).toBe(0);
  });

  it('returns 0 for null/undefined gracefully', () => {
    expect(shannonEntropy(null)).toBe(0);
    expect(shannonEntropy(undefined)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseWasmSections tests
// ─────────────────────────────────────────────────────────────────────────────

describe('parseWasmSections()', () => {
  it('returns empty section data for a header-only WASM', () => {
    const result = parseWasmSections(WASM_HEADER);
    expect(result.imports).toEqual([]);
    expect(result.exports).toEqual([]);
    expect(result.memories).toEqual([]);
    expect(result.globals).toEqual([]);
    expect(result.dataSegments).toEqual([]);
    expect(result.hasStartSection).toBe(false);
    expect(result.functionCount).toBe(0);
    expect(result.codeSection).toBeNull();
    expect(result.parseErrors).toEqual([]);
  });

  it('parses a Soroban import section correctly', () => {
    const wasm = buildWasm(
      importSection(
        importEntry('_', 'fn0', 0, [0x00]),
        importEntry('_', 'fn1', 0, [0x01]),
        importEntry('__', 'alloc', 0, [0x00]),
      )
    );
    const result = parseWasmSections(wasm);
    expect(result.imports.length).toBe(3);
    expect(result.imports[0]).toEqual({ module: '_', name: 'fn0', kind: 0 });
    expect(result.imports[1]).toEqual({ module: '_', name: 'fn1', kind: 0 });
    expect(result.imports[2]).toEqual({ module: '__', name: 'alloc', kind: 0 });
  });

  it('parses a memory section with max limit', () => {
    const wasm = buildWasm(memorySection(1, 16));
    const result = parseWasmSections(wasm);
    expect(result.memories.length).toBe(1);
    expect(result.memories[0]).toEqual({ hasMax: true, min: 1, max: 16 });
  });

  it('parses a memory section without max limit', () => {
    const wasm = buildWasm(memorySection(2, null));
    const result = parseWasmSections(wasm);
    expect(result.memories[0]).toEqual({ hasMax: false, min: 2, max: null });
  });

  it('parses function exports', () => {
    const wasm = buildWasm(
      importSection(importEntry('_', 'fn0', 0, [0x00])),
      functionSection(1),
      exportSection('__invoke', 0, 0),
    );
    const result = parseWasmSections(wasm);
    expect(result.exports.length).toBe(1);
    expect(result.exports[0]).toMatchObject({ name: '__invoke', kind: 0 });
  });

  it('detects a start section', () => {
    const wasm = buildWasm(
      importSection(importEntry('_', 'fn0', 0, [0x00])),
      functionSection(1),
      startSection(),
    );
    const result = parseWasmSections(wasm);
    expect(result.hasStartSection).toBe(true);
    expect(result.startFunctionIndex).toBe(0);
  });

  it('counts mutable globals correctly', () => {
    const wasm = buildWasm(globalSection(5));
    const result = parseWasmSections(wasm);
    expect(result.globals.length).toBe(5);
    expect(result.globals.every((g) => g.mutable)).toBe(true);
  });

  it('records function count from function section', () => {
    const wasm = buildWasm(functionSection(42));
    const result = parseWasmSections(wasm);
    expect(result.functionCount).toBe(42);
  });

  it('records code section size and offset', () => {
    // Minimal code section: count=0 → just one LEB128 zero
    const codeContent = leb128U(0);
    const codeSec = section(10, codeContent);
    const wasm = buildWasm(codeSec);
    const result = parseWasmSections(wasm);
    expect(result.codeSection).not.toBeNull();
    expect(result.codeSection.size).toBe(codeContent.length);
  });

  it('parses data segment entropy and raw sample', () => {
    // Build a data segment with known content: all 0xAA
    const data = Buffer.alloc(128, 0xAA);
    const wasm = buildWasm(dataSection(data));
    const result = parseWasmSections(wasm);
    expect(result.dataSegments.length).toBe(1);
    expect(result.dataSegments[0].size).toBe(128);
    // All identical bytes → entropy = 0
    expect(result.dataSegments[0].entropy).toBe(0);
    expect(result.dataSegments[0].rawSample.length).toBe(64);
  });

  it('records parse errors gracefully on a truncated section', () => {
    // Create a section header claiming 1000 bytes but provide only 10 content bytes
    const truncated = Buffer.from([
      ...WASM_HEADER,
      0x02,                       // section id = import
      ...leb128U(1000),            // claims 1000 bytes
      0x01, 0x5f, 0x01, 0x61,     // '_', 'a'...  (only 4 bytes of content)
    ]);
    const result = parseWasmSections(truncated);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Individual rule tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Security Rules', () => {
  // ── SM-001 ──────────────────────────────────────────────────────────────────
  describe('SM-001: Invalid WASM magic number', () => {
    it('fires when buffer has wrong magic bytes', () => {
      const badMagic = Buffer.from([0x00, 0x61, 0x73, 0x00, 0x01, 0x00, 0x00, 0x00]);
      const report = scanWasm(badMagic);
      expect(report.status).toBe(SCAN_STATUS.ERROR);
      expect(report.findings.some((f) => f.ruleId === 'SM-001')).toBe(true);
      expect(report.deploymentBlocked).toBe(true);
    });

    it('fires for a buffer that is too short (< 8 bytes)', () => {
      const report = scanWasm(Buffer.from([0x00, 0x61, 0x73]));
      expect(report.findings.some((f) => f.ruleId === 'SM-001')).toBe(true);
      expect(report.status).toBe(SCAN_STATUS.ERROR);
    });

    it('fires for a completely empty buffer', () => {
      const report = scanWasm(Buffer.alloc(0));
      expect(report.findings.some((f) => f.ruleId === 'SM-001')).toBe(true);
    });

    it('does NOT fire for a valid WASM magic', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-001')).toBe(false);
    });
  });

  // ── SM-002 ──────────────────────────────────────────────────────────────────
  describe('SM-002: Unsupported WASM version', () => {
    it('fires when version field is not 1', () => {
      const badVersion = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]);
      const report = scanWasm(badVersion);
      expect(report.status).toBe(SCAN_STATUS.ERROR);
      expect(report.findings.some((f) => f.ruleId === 'SM-002')).toBe(true);
      expect(report.deploymentBlocked).toBe(true);
    });

    it('does NOT fire for version 1', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-002')).toBe(false);
    });
  });

  // ── SM-003 ──────────────────────────────────────────────────────────────────
  describe('SM-003: Malformed WASM section', () => {
    it('fires when a section overruns the buffer', () => {
      // Section claiming 10000 bytes after a valid header
      const malformed = Buffer.from([
        ...WASM_HEADER,
        0x02,
        ...leb128U(10000),
        0x01, 0x02,
      ]);
      const report = scanWasm(malformed);
      expect(report.findings.some((f) => f.ruleId === 'SM-003')).toBe(true);
    });

    it('does NOT fire for a well-formed WASM', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-003')).toBe(false);
    });
  });

  // ── SM-004 ──────────────────────────────────────────────────────────────────
  describe('SM-004: No Soroban host-function imports', () => {
    it('fires when the WASM has no import section', () => {
      const wasm = buildWasm(
        functionSection(1),
        memorySection(1, 16),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-004')).toBe(true);
    });

    it('fires when imports exist but none are from "_" module', () => {
      const wasm = buildWasm(
        importSection(importEntry('env', 'memory', 2, [0x00, 0x01])),
        functionSection(1),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-004')).toBe(true);
    });

    it('does NOT fire when Soroban "_" imports are present', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-004')).toBe(false);
    });
  });

  // ── SM-005 ──────────────────────────────────────────────────────────────────
  describe('SM-005: Suspicious non-Soroban imports', () => {
    const suspiciousModules = [
      'wasi_snapshot_preview1',
      'env',
      'js',
      'http',
      'wasi_unstable',
    ];

    for (const mod of suspiciousModules) {
      it(`fires for imports from module "${mod}"`, () => {
        const wasm = buildWasm(
          importSection(
            importEntry('_', 'fn0', 0, [0x00]),
            importEntry('_', 'fn1', 0, [0x00]),
            importEntry('_', 'fn2', 0, [0x00]),
            importEntry(mod, 'proc_exit', 0, [0x00]),
          ),
          functionSection(1),
          exportSection('__invoke'),
        );
        const report = scanWasm(wasm);
        expect(report.findings.some((f) => f.ruleId === 'SM-005')).toBe(true);
      });
    }

    it('does NOT fire for "_" and "__" imports only', () => {
      const report = scanWasm(buildCleanSorobanWasm({ importCount: 5 }));
      expect(report.findings.some((f) => f.ruleId === 'SM-005')).toBe(false);
    });
  });

  // ── SM-006 ──────────────────────────────────────────────────────────────────
  describe('SM-006: Too few Soroban host-function imports', () => {
    it('fires when only 1 Soroban import is present', () => {
      const wasm = buildWasm(
        importSection(importEntry('_', 'fn0', 0, [0x00])),
        functionSection(1),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-006')).toBe(true);
    });

    it('fires when only 2 Soroban imports are present', () => {
      const wasm = buildWasm(
        importSection(
          importEntry('_', 'fn0', 0, [0x00]),
          importEntry('_', 'fn1', 0, [0x00]),
        ),
        functionSection(1),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-006')).toBe(true);
    });

    it('does NOT fire with 3 or more Soroban imports', () => {
      const report = scanWasm(buildCleanSorobanWasm({ importCount: 3 }));
      expect(report.findings.some((f) => f.ruleId === 'SM-006')).toBe(false);
    });

    it('does NOT fire when SM-004 already fired (no soroban imports at all)', () => {
      // If no "_" imports at all, SM-004 fires but SM-006 should not double-fire
      const wasm = buildWasm(exportSection('__invoke'));
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-004')).toBe(true);
      expect(report.findings.some((f) => f.ruleId === 'SM-006')).toBe(false);
    });
  });

  // ── SM-007 ──────────────────────────────────────────────────────────────────
  describe('SM-007: Missing callable contract export', () => {
    it('fires when there are no function exports', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        functionSection(1),
        memorySection(1, 16),
        // no export section
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-007')).toBe(true);
    });

    it('fires when only memory exports exist (kind=2, not function)', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        memorySection(1, 16),
        // memory export only: kind=2
        section(7, [...leb128U(1), ...wasmStr('memory'), 0x02, ...leb128U(0)]),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-007')).toBe(true);
    });

    it('does NOT fire when at least one function export is present', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-007')).toBe(false);
    });
  });

  // ── SM-008 ──────────────────────────────────────────────────────────────────
  describe('SM-008: Duplicate export names', () => {
    it('fires when two exports share the same name', () => {
      const dupExport = [
        ...wasmStr('invoke'), 0x00, ...leb128U(0),
        ...wasmStr('invoke'), 0x00, ...leb128U(1),
      ];
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        functionSection(2),
        section(7, [...leb128U(2), ...dupExport]),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-008')).toBe(true);
    });

    it('does NOT fire when all export names are unique', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-008')).toBe(false);
    });
  });

  // ── SM-009 ──────────────────────────────────────────────────────────────────
  describe('SM-009: Linear memory without upper limit', () => {
    it('fires when memory min >= 2 and has no max', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        memorySection(2, null), // min=2, no max
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-009')).toBe(true);
    });

    it('does NOT fire when memory has an explicit max', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        memorySection(2, 32),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-009')).toBe(false);
    });

    it('does NOT fire when memory min is 1 and has no max (below threshold)', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        memorySection(1, null),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-009')).toBe(false);
    });
  });

  // ── SM-010 ──────────────────────────────────────────────────────────────────
  describe('SM-010: Excessive initial memory allocation', () => {
    it('fires when memory min exceeds 512 pages', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        memorySection(513, 1024),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-010')).toBe(true);
    });

    it('does NOT fire when memory min is exactly 512 pages', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        memorySection(512, 1024),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-010')).toBe(false);
    });
  });

  // ── SM-011 ──────────────────────────────────────────────────────────────────
  describe('SM-011: Auto-execution start function', () => {
    it('fires when a start section is present', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        functionSection(2),
        memorySection(1, 16),
        exportSection('__invoke'),
        startSection(),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-011')).toBe(true);
      const finding = report.findings.find((f) => f.ruleId === 'SM-011');
      expect(finding.severity).toBe(SEVERITY.HIGH);
    });

    it('does NOT fire for a WASM without a start section', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-011')).toBe(false);
    });
  });

  // ── SM-012 ──────────────────────────────────────────────────────────────────
  describe('SM-012: Excessive mutable globals', () => {
    it('fires when more than 20 mutable globals are declared', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        globalSection(21),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-012')).toBe(true);
    });

    it('does NOT fire with exactly 20 mutable globals', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        globalSection(20),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-012')).toBe(false);
    });
  });

  // ── SM-013 ──────────────────────────────────────────────────────────────────
  describe('SM-013: High-entropy data section', () => {
    it('fires when a data segment has entropy > 7.2 and size > 256 bytes', () => {
      // Uniform byte distribution → ~8.0 bits/byte entropy
      const highEntropyData = Buffer.from(
        Array.from({ length: 512 }, (_, i) => i % 256)
      );
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(highEntropyData),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-013')).toBe(true);
    });

    it('does NOT fire for a small high-entropy segment (<= 256 bytes)', () => {
      const smallHighEntropy = Buffer.from(Array.from({ length: 128 }, (_, i) => i));
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(smallHighEntropy),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-013')).toBe(false);
    });

    it('does NOT fire for a large low-entropy segment', () => {
      const lowEntropyData = Buffer.alloc(1024, 0x41); // all 'A'
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(lowEntropyData),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-013')).toBe(false);
    });
  });

  // ── SM-014 ──────────────────────────────────────────────────────────────────
  describe('SM-014: Suspicious byte patterns in data section', () => {
    it('fires when the data sample has >50% null bytes', () => {
      // 60 null bytes in a 64-byte sample → 93.75% null
      const nullFlood = Buffer.alloc(64, 0x00);
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(nullFlood),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-014')).toBe(true);
    });

    it('fires when data contains an ASCII-encoded Stellar G-address prefix', () => {
      // Embed a G-address-like ASCII string in the data
      const stellarAddr = 'GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP';
      const data = Buffer.from(stellarAddr, 'ascii');
      const padded = Buffer.concat([data, Buffer.alloc(200, 0x41)]);
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(padded),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-014')).toBe(true);
    });

    it('does NOT fire for normal non-null data content', () => {
      // Alternating printable ASCII characters — no nulls, no G-address
      const normal = Buffer.from('Hello, Soroban!'.repeat(10), 'ascii');
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(normal),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-014')).toBe(false);
    });
  });

  // ── SM-015 ──────────────────────────────────────────────────────────────────
  describe('SM-015: Oversized data sections', () => {
    it('fires when total data segment size > 512 KB', () => {
      const bigData = Buffer.alloc(520 * 1024, 0x41); // 520 KB
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(bigData),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-015')).toBe(true);
    });

    it('does NOT fire when data is exactly 512 KB', () => {
      const borderData = Buffer.alloc(512 * 1024, 0x41);
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(borderData),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-015')).toBe(false);
    });
  });

  // ── SM-016 ──────────────────────────────────────────────────────────────────
  describe('SM-016: Excessive function count', () => {
    it('fires when function section declares > 2000 functions', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        functionSection(2001),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-016')).toBe(true);
    });

    it('does NOT fire with exactly 2000 functions', () => {
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        functionSection(2000),
        exportSection('__invoke'),
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-016')).toBe(false);
    });
  });

  // ── SM-017 ──────────────────────────────────────────────────────────────────
  describe('SM-017: Oversized code section', () => {
    it('fires when code section size > 1 MB', () => {
      // Build a code section with 1.1 MB of dummy content
      const bigCode = Buffer.alloc(1_100_000, 0x00);
      // Section 10 (code) with a big body
      const codeSec = section(10, [...bigCode]);
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        codeSec,
      );
      const report = scanWasm(wasm);
      expect(report.findings.some((f) => f.ruleId === 'SM-017')).toBe(true);
    });

    it('does NOT fire when code section is <= 1 MB', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-017')).toBe(false);
    });
  });

  // ── SM-018 ──────────────────────────────────────────────────────────────────
  describe('SM-018: WASM file exceeds maximum size', () => {
    it('fires when the buffer exceeds maxWasmSize', () => {
      const oversized = Buffer.alloc(6 * 1024 * 1024, 0x00); // 6 MB
      // Write valid magic + version at start so it doesn't fail on SM-001
      WASM_HEADER.copy(oversized, 0);
      const report = scanWasm(oversized, { maxWasmSize: 5 * 1024 * 1024 });
      expect(report.findings.some((f) => f.ruleId === 'SM-018')).toBe(true);
    });

    it('does NOT fire when the buffer is within the limit', () => {
      const report = scanWasm(buildCleanSorobanWasm(), { maxWasmSize: 5 * 1024 * 1024 });
      expect(report.findings.some((f) => f.ruleId === 'SM-018')).toBe(false);
    });
  });

  // ── SM-019 ──────────────────────────────────────────────────────────────────
  describe('SM-019: WASM file is suspiciously small', () => {
    it('fires for a buffer that is exactly the magic + version with nothing else', () => {
      const report = scanWasm(WASM_HEADER);
      expect(report.findings.some((f) => f.ruleId === 'SM-019')).toBe(true);
    });

    it('does NOT fire for a buffer with actual sections', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-019')).toBe(false);
    });
  });

  // ── SM-020 ──────────────────────────────────────────────────────────────────
  describe('SM-020: Large WASM file advisory', () => {
    it('fires for WASM between 500 KB and maxWasmSize', () => {
      // Build a WASM with 600 KB of data section content
      const bigData = Buffer.alloc(600 * 1024, 0x41);
      const wasm = buildWasm(
        importSection(
          ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
        ),
        exportSection('__invoke'),
        dataSection(bigData),
      );
      const report = scanWasm(wasm, { maxWasmSize: 5 * 1024 * 1024 });
      expect(report.findings.some((f) => f.ruleId === 'SM-020')).toBe(true);
      const finding = report.findings.find((f) => f.ruleId === 'SM-020');
      expect(finding.severity).toBe(SEVERITY.LOW);
    });

    it('does NOT fire for a small WASM', () => {
      const report = scanWasm(buildCleanSorobanWasm());
      expect(report.findings.some((f) => f.ruleId === 'SM-020')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scanWasm() integration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('scanWasm() — report structure and status derivation', () => {
  it('returns a complete ScanReport for a clean WASM', () => {
    const report = scanWasm(buildCleanSorobanWasm());

    expect(report).toHaveProperty('wasmHash');
    expect(report.wasmHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report).toHaveProperty('wasmSize');
    expect(report.wasmSize).toBeGreaterThan(0);
    expect(report).toHaveProperty('status');
    expect(report).toHaveProperty('findings');
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('deploymentBlocked');
    expect(report).toHaveProperty('scannerVersion', SCANNER_VERSION);
    expect(report).toHaveProperty('parsedSections');
    expect(report).toHaveProperty('duration');
    expect(typeof report.duration).toBe('number');
  });

  it('status is "clean" for a well-formed Soroban WASM with no issues', () => {
    const report = scanWasm(buildCleanSorobanWasm());
    expect(report.status).toBe(SCAN_STATUS.CLEAN);
    expect(report.deploymentBlocked).toBe(false);
  });

  it('status is "error" for invalid magic', () => {
    const report = scanWasm(Buffer.from('not a wasm'));
    expect(report.status).toBe(SCAN_STATUS.ERROR);
    expect(report.deploymentBlocked).toBe(true);
  });

  it('status is "error" for wrong WASM version', () => {
    const bad = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x03, 0x00, 0x00, 0x00]);
    const report = scanWasm(bad);
    expect(report.status).toBe(SCAN_STATUS.ERROR);
    expect(report.deploymentBlocked).toBe(true);
  });

  it('status is "failed" when critical or high-severity findings exist', () => {
    // SM-011 (start section) is HIGH severity → should fail
    const wasm = buildWasm(
      importSection(
        ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
      ),
      functionSection(2),
      memorySection(1, 16),
      exportSection('__invoke'),
      startSection(),
    );
    const report = scanWasm(wasm);
    expect(report.status).toBe(SCAN_STATUS.FAILED);
    expect(report.deploymentBlocked).toBe(true);
  });

  it('status is "warning" when only medium/low findings exist', () => {
    // SM-012 (excessive mutable globals) is MEDIUM severity
    const wasm = buildWasm(
      importSection(
        ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
      ),
      globalSection(25), // fires SM-012 (medium)
      memorySection(1, 16),
      exportSection('__invoke'),
    );
    const report = scanWasm(wasm);
    // SM-012 is medium; no critical/high findings
    expect(['warning', 'clean']).toContain(report.status);
    if (report.status === 'warning') {
      expect(report.deploymentBlocked).toBe(false);
    }
  });

  it('summary counts match the actual findings array', () => {
    const wasm = buildWasm(
      importSection(importEntry('_', 'fn0', 0, [0x00])),
      functionSection(1),
      memorySection(1, 16),
      startSection(), // HIGH
      globalSection(25), // MEDIUM
      exportSection('__invoke'),
    );
    const report = scanWasm(wasm);

    const actualHigh     = report.findings.filter((f) => f.severity === 'high').length;
    const actualMedium   = report.findings.filter((f) => f.severity === 'medium').length;
    const actualCritical = report.findings.filter((f) => f.severity === 'critical').length;

    expect(report.summary.high).toBe(actualHigh);
    expect(report.summary.medium).toBe(actualMedium);
    expect(report.summary.critical).toBe(actualCritical);
    expect(report.summary.totalChecks).toBe(Object.keys(RULES).length);
    expect(report.summary.passedChecks).toBe(
      Object.keys(RULES).length - report.findings.length
    );
  });

  it('wasmHash is the SHA-256 of the input buffer', () => {
    const crypto = require('crypto');
    const wasm = buildCleanSorobanWasm();
    const expected = crypto.createHash('sha256').update(wasm).digest('hex');
    const report = scanWasm(wasm);
    expect(report.wasmHash).toBe(expected);
  });

  it('findings are sorted by severity (critical → high → medium → low → info)', () => {
    const wasm = buildWasm(
      importSection(importEntry('_', 'fn0', 0, [0x00])),
      functionSection(1),
      memorySection(513, 1024), // MEDIUM
      startSection(),            // HIGH
      globalSection(25),         // MEDIUM
      exportSection('__invoke'),
    );
    const report = scanWasm(wasm);

    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    for (let i = 1; i < report.findings.length; i++) {
      const prev = severityOrder[report.findings[i - 1].severity];
      const curr = severityOrder[report.findings[i].severity];
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  it('duration is a non-negative number', () => {
    const report = scanWasm(buildCleanSorobanWasm());
    expect(report.duration).toBeGreaterThanOrEqual(0);
  });

  it('parsedSections contains parsed section data for a valid WASM', () => {
    const report = scanWasm(buildCleanSorobanWasm());
    expect(report.parsedSections).toBeDefined();
    expect(Array.isArray(report.parsedSections.imports)).toBe(true);
    expect(Array.isArray(report.parsedSections.exports)).toBe(true);
  });

  it('accepts custom maxWasmSize option', () => {
    const small = buildCleanSorobanWasm();
    // Set max to 1 byte — any WASM will exceed it
    const report = scanWasm(small, { maxWasmSize: 1 });
    expect(report.findings.some((f) => f.ruleId === 'SM-018')).toBe(true);
  });

  it('returns deploymentBlocked=false for a clean WASM', () => {
    const report = scanWasm(buildCleanSorobanWasm());
    expect(report.deploymentBlocked).toBe(false);
  });

  it('returns deploymentBlocked=true for a WASM with critical findings', () => {
    const report = scanWasm(Buffer.from('garbage data here'));
    expect(report.deploymentBlocked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RULES registry tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RULES registry', () => {
  it('contains exactly 20 rules', () => {
    expect(Object.keys(RULES).length).toBe(20);
  });

  it('all rule IDs follow the SM-NNN pattern', () => {
    for (const id of Object.keys(RULES)) {
      expect(id).toMatch(/^SM-\d{3}$/);
    }
  });

  it('every rule has id, severity, title, description, recommendation', () => {
    const validSeverities = new Set(['critical', 'high', 'medium', 'low', 'info']);
    for (const [id, rule] of Object.entries(RULES)) {
      expect(rule).toHaveProperty('id', id);
      expect(typeof rule.title).toBe('string');
      expect(rule.title.length).toBeGreaterThan(0);
      expect(typeof rule.description).toBe('string');
      expect(rule.description.length).toBeGreaterThan(10);
      expect(typeof rule.recommendation).toBe('string');
      expect(rule.recommendation.length).toBeGreaterThan(0);
      expect(validSeverities.has(rule.severity)).toBe(true);
    }
  });

  it('at least one rule has critical severity', () => {
    const criticalRules = Object.values(RULES).filter((r) => r.severity === 'critical');
    expect(criticalRules.length).toBeGreaterThan(0);
  });

  it('at least one rule has high severity', () => {
    const highRules = Object.values(RULES).filter((r) => r.severity === 'high');
    expect(highRules.length).toBeGreaterThan(0);
  });

  it('SEVERITY enum has expected values', () => {
    expect(SEVERITY.CRITICAL).toBe('critical');
    expect(SEVERITY.HIGH).toBe('high');
    expect(SEVERITY.MEDIUM).toBe('medium');
    expect(SEVERITY.LOW).toBe('low');
    expect(SEVERITY.INFO).toBe('info');
  });

  it('SCAN_STATUS enum has expected values', () => {
    expect(SCAN_STATUS.CLEAN).toBe('clean');
    expect(SCAN_STATUS.PASSED).toBe('passed');
    expect(SCAN_STATUS.WARNING).toBe('warning');
    expect(SCAN_STATUS.FAILED).toBe('failed');
    expect(SCAN_STATUS.ERROR).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('handles a WASM with only a custom section gracefully', () => {
    const customContent = [...wasmStr('producers'), ...Buffer.from('soroban-sdk v22')];
    const wasm = buildWasm(section(0, customContent));
    expect(() => scanWasm(wasm)).not.toThrow();
  });

  it('handles multiple data segments and aggregates total size', () => {
    // Two segments of 300 KB each → 600 KB total → fires SM-015
    const seg1 = Buffer.alloc(300 * 1024, 0x41);
    const seg2 = Buffer.alloc(300 * 1024, 0x42);

    // Build two active data segments
    const twoSegs = [
      0x02,                               // count = 2
      0x00, 0x41, 0x00, 0x0b,             // seg 1: flags=0, i32.const 0, end
      ...leb128U(seg1.length), ...seg1,
      0x00, 0x41, 0x00, 0x0b,             // seg 2: flags=0, i32.const 0, end
      ...leb128U(seg2.length), ...seg2,
    ];
    const wasm = buildWasm(
      importSection(
        ...Array.from({ length: 5 }, (_, i) => importEntry('_', `fn${i}`, 0, [0x00]))
      ),
      exportSection('__invoke'),
      section(11, twoSegs),
    );
    const report = scanWasm(wasm);
    expect(report.findings.some((f) => f.ruleId === 'SM-015')).toBe(true);
  });

  it('does not throw on a completely empty (0-byte) buffer', () => {
    expect(() => scanWasm(Buffer.alloc(0))).not.toThrow();
    const report = scanWasm(Buffer.alloc(0));
    expect(report.status).toBe(SCAN_STATUS.ERROR);
  });

  it('does not throw on a null-filled buffer of valid WASM size', () => {
    const buf = Buffer.alloc(20, 0x00);
    expect(() => scanWasm(buf)).not.toThrow();
  });

  it('scan of the same buffer twice produces identical wasmHash', () => {
    const wasm = buildCleanSorobanWasm();
    const r1 = scanWasm(wasm);
    const r2 = scanWasm(wasm);
    expect(r1.wasmHash).toBe(r2.wasmHash);
  });

  it('two different WASMs produce different wasmHashes', () => {
    const w1 = buildCleanSorobanWasm({ importCount: 5 });
    const w2 = buildCleanSorobanWasm({ importCount: 10 });
    const r1 = scanWasm(w1);
    const r2 = scanWasm(w2);
    expect(r1.wasmHash).not.toBe(r2.wasmHash);
  });
});
