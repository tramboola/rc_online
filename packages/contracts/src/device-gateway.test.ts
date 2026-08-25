import { describe, expect, it } from "vitest";

import {
  DeviceHealthSchema,
  GatewayClientMessageSchema,
  GatewayServerMessageSchema,
} from "./device-gateway.js";

const deviceId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const carId = "33333333-3333-4333-8333-333333333333";
const updateId = "44444444-4444-4444-8444-444444444444";
const digest = "a".repeat(64);
const signature = "b".repeat(86);

describe("device gateway contracts", () => {
  it("accepts a bounded 720p60 device health report", () => {
    expect(DeviceHealthSchema.parse({
      cameraReady: true,
      gpioReady: true,
      watchdogReady: true,
      width: 1280,
      height: 720,
      fps: 60,
      cpuTemperatureC: 47.5,
      wifiSignalDbm: -51,
    })).toMatchObject({ fps: 60, cameraReady: true });
  });

  it("keeps legacy heartbeats valid and accepts nullable battery telemetry", () => {
    const legacyHeartbeat = {
      v: 1,
      type: "device.heartbeat",
      health: {
        cameraReady: true,
        gpioReady: true,
        watchdogReady: true,
        width: 1280,
        height: 720,
        fps: 60,
        cpuTemperatureC: 47.5,
        wifiSignalDbm: -51,
      },
    } as const;

    expect(GatewayClientMessageSchema.safeParse(legacyHeartbeat).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({
      ...legacyHeartbeat,
      health: { ...legacyHeartbeat.health, batteryVoltage: 8.279, batteryPercent: 94 },
    }).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({
      ...legacyHeartbeat,
      health: { ...legacyHeartbeat.health, batteryVoltage: 6.6, batteryPercent: 0 },
    }).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({
      ...legacyHeartbeat,
      health: { ...legacyHeartbeat.health, batteryVoltage: null, batteryPercent: null },
    }).success).toBe(true);
  });

  it("rejects battery telemetry outside its physical bounds", () => {
    const health = {
      cameraReady: true,
      gpioReady: true,
      watchdogReady: true,
      width: 1280,
      height: 720,
      fps: 60,
      cpuTemperatureC: 47.5,
      wifiSignalDbm: -51,
    } as const;

    expect(DeviceHealthSchema.safeParse({ ...health, batteryVoltage: -0.001 }).success).toBe(false);
    expect(DeviceHealthSchema.safeParse({ ...health, batteryVoltage: 16.001 }).success).toBe(false);
    expect(DeviceHealthSchema.safeParse({ ...health, batteryPercent: 94.5 }).success).toBe(false);
    expect(DeviceHealthSchema.safeParse({ ...health, batteryPercent: 101 }).success).toBe(false);
  });

  it("rejects impossible health values and additional fields", () => {
    expect(DeviceHealthSchema.safeParse({
      cameraReady: true,
      gpioReady: true,
      watchdogReady: true,
      width: 1280,
      height: 720,
      fps: 121,
      cpuTemperatureC: 47,
      wifiSignalDbm: -51,
    }).success).toBe(false);
    expect(DeviceHealthSchema.safeParse({
      cameraReady: true,
      gpioReady: true,
      watchdogReady: true,
      width: 1280,
      height: 720,
      fps: 60,
      cpuTemperatureC: null,
      wifiSignalDbm: null,
      plaintextSecret: "must-not-pass",
    }).success).toBe(false);
  });

  it("requires a known versioned client message", () => {
    expect(GatewayClientMessageSchema.safeParse({
      v: 1,
      type: "device.authenticate",
      deviceId,
      secret: "a".repeat(43),
      agentVersion: "0.1.0",
    }).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({
      v: 1,
      type: "device.execute-shell",
      command: "whoami",
    }).success).toBe(false);
  });

  it("keeps legacy authentication valid and accepts bounded OTA capabilities", () => {
    const legacyAuthenticate = {
      v: 1,
      type: "device.authenticate",
      deviceId,
      secret: "a".repeat(43),
      agentVersion: "0.2.0",
    } as const;

    expect(GatewayClientMessageSchema.safeParse(legacyAuthenticate).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({
      ...legacyAuthenticate,
      capabilities: { controlProtocolVersion: 4, otaRuntimeGeneration: 1 },
    }).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({
      ...legacyAuthenticate,
      capabilities: { controlProtocolVersion: 5, otaRuntimeGeneration: 1 },
    }).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({
      ...legacyAuthenticate,
      capabilities: { otaRuntimeGeneration: 1, shell: true },
    }).success).toBe(false);
  });

  it("accepts only strict signed HTTPS update offers", () => {
    const offer = {
      v: 1,
      type: "device.update.available",
      updateId,
      version: "0.4.0",
      runtimeGeneration: 1,
      artifactUrl: "https://rcmania.live/agent-releases/rc-pi-agent-0.4.0.pyz",
      artifactSizeBytes: 1024,
      digestSha256: digest,
      signature,
    } as const;
    expect(GatewayServerMessageSchema.safeParse(offer).success).toBe(true);
    expect(GatewayServerMessageSchema.safeParse({ ...offer, artifactUrl: "http://bad.test/a.pyz" }).success).toBe(false);
    expect(GatewayServerMessageSchema.safeParse({ ...offer, updateId: "not-a-uuid" }).success).toBe(false);
    expect(GatewayServerMessageSchema.safeParse({ ...offer, digestSha256: "A".repeat(64) }).success).toBe(false);
    expect(GatewayServerMessageSchema.safeParse({ ...offer, artifactSizeBytes: 8 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(GatewayServerMessageSchema.safeParse({ ...offer, extra: true }).success).toBe(false);
  });

  it("accepts bounded device update progress and rejects forged status", () => {
    const status = {
      v: 1,
      type: "device.update.status",
      updateId,
      status: "failed",
      reason: "digest mismatch",
    } as const;
    expect(GatewayClientMessageSchema.safeParse(status).success).toBe(true);
    expect(GatewayClientMessageSchema.safeParse({ ...status, status: "succeeded" }).success).toBe(false);
    expect(GatewayClientMessageSchema.safeParse({ ...status, reason: "x".repeat(257) }).success).toBe(false);
  });

  it("binds session start messages to a car and drive session", () => {
    expect(GatewayServerMessageSchema.safeParse({
      v: 1,
      type: "session.start",
      sessionId,
      carId,
      expiresAt: "2026-08-13T20:00:00.000Z",
      iceServers: [{ urls: ["stun:stun.example.test:3478"] }],
    }).success).toBe(true);
    expect(GatewayServerMessageSchema.safeParse({
      v: 1,
      type: "session.start",
      carId,
    }).success).toBe(false);
  });

  it("accepts server telemetry with a valid session and nullable battery values", () => {
    expect(GatewayServerMessageSchema.safeParse({
      v: 1,
      type: "device.telemetry",
      sessionId,
      batteryVoltage: null,
      batteryPercent: null,
    }).success).toBe(true);
  });
});
