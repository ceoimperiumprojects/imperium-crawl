import { describe, it, expect, beforeEach } from "vitest";
import {
  circuits,
  getCircuit,
  recordSuccess,
  recordFailure,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_DURATION_MS,
  CIRCUIT_PROBE_SUCCESSES,
  CIRCUIT_STALE_MS,
} from "../src/utils/fetcher.js";

describe("Circuit Breaker", () => {
  beforeEach(() => {
    circuits.clear();
  });

  it("starts in closed state with zero failures", () => {
    const circuit = getCircuit("example.com");
    expect(circuit.state).toBe("closed");
    expect(circuit.failures).toBe(0);
  });

  it("remains closed after fewer than threshold failures", () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD - 1; i++) {
      recordFailure("example.com");
    }
    const circuit = getCircuit("example.com");
    expect(circuit.state).toBe("closed");
    expect(circuit.failures).toBe(CIRCUIT_FAILURE_THRESHOLD - 1);
  });

  it("opens after reaching failure threshold", () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      recordFailure("example.com");
    }
    const circuit = getCircuit("example.com");
    expect(circuit.state).toBe("open");
    expect(circuit.openedAt).toBeGreaterThan(0);
  });

  it("transitions from open to half-open after cooldown", () => {
    // Open the circuit
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      recordFailure("example.com");
    }
    const circuit = circuits.get("example.com")!;
    expect(circuit.state).toBe("open");

    // Simulate cooldown elapsed
    circuit.openedAt = Date.now() - CIRCUIT_OPEN_DURATION_MS - 1;

    // getCircuit should transition to half-open
    const updated = getCircuit("example.com");
    expect(updated.state).toBe("half-open");
    expect(updated.probeSuccesses).toBe(0);
  });

  it("half-open probe failure immediately reopens circuit (bug fix)", () => {
    // Open the circuit
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      recordFailure("halfopen.com");
    }
    const circuit = circuits.get("halfopen.com")!;
    // Simulate cooldown elapsed
    circuit.openedAt = Date.now() - CIRCUIT_OPEN_DURATION_MS - 1;

    // Trigger half-open transition
    getCircuit("halfopen.com");
    expect(circuit.state).toBe("half-open");

    // A single failure during half-open should reopen
    recordFailure("halfopen.com");
    const updated = getCircuit("halfopen.com");
    expect(updated.state).toBe("open");
    expect(updated.failures).toBe(CIRCUIT_FAILURE_THRESHOLD);
    expect(updated.openedAt).toBeGreaterThan(0);
  });

  it("half-open closes after enough probe successes", () => {
    // Open the circuit
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      recordFailure("recover.com");
    }
    const circuit = circuits.get("recover.com")!;
    circuit.openedAt = Date.now() - CIRCUIT_OPEN_DURATION_MS - 1;

    // Trigger half-open
    getCircuit("recover.com");
    expect(circuit.state).toBe("half-open");

    // Probe successes
    for (let i = 0; i < CIRCUIT_PROBE_SUCCESSES; i++) {
      recordSuccess("recover.com");
    }
    const updated = getCircuit("recover.com");
    expect(updated.state).toBe("closed");
    expect(updated.failures).toBe(0);
  });

  it("success resets failures in closed state", () => {
    recordFailure("reset.com");
    recordFailure("reset.com");
    expect(getCircuit("reset.com").failures).toBe(2);

    recordSuccess("reset.com");
    expect(getCircuit("reset.com").failures).toBe(0);
  });

  it("stale cleanup removes idle closed circuits", () => {
    const circuit = getCircuit("stale.com");
    expect(circuit.state).toBe("closed");

    // Simulate idle for longer than stale threshold
    circuit.lastAccessed = Date.now() - CIRCUIT_STALE_MS - 1;

    // The cleanup interval runs periodically — we manually check the logic
    const now = Date.now();
    for (const [domain, c] of circuits) {
      if (c.state === "closed" && now - c.lastAccessed > CIRCUIT_STALE_MS) {
        circuits.delete(domain);
      }
    }
    expect(circuits.has("stale.com")).toBe(false);
  });

  it("does not remove open circuits during cleanup", () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      recordFailure("open-stale.com");
    }
    const circuit = circuits.get("open-stale.com")!;
    circuit.lastAccessed = Date.now() - CIRCUIT_STALE_MS - 1;

    // Cleanup only removes closed circuits
    const now = Date.now();
    for (const [domain, c] of circuits) {
      if (c.state === "closed" && now - c.lastAccessed > CIRCUIT_STALE_MS) {
        circuits.delete(domain);
      }
    }
    expect(circuits.has("open-stale.com")).toBe(true);
  });
});
