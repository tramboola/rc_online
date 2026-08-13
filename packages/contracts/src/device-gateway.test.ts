import { describe, expect, it } from "vitest";

import {
  DeviceHealthSchema,
  GatewayClientMessageSchema,
  GatewayServerMessageSchema,
} from "./device-gateway.js";

const deviceId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const carId = "33333333-3333-4333-8333-333333333333";

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
});
