import { z } from "zod";

const uuid = z.string().uuid();
const shortText = z.string().min(1).max(256);

export const DeviceHealthSchema = z.object({
  cameraReady: z.boolean(),
  gpioReady: z.boolean(),
  watchdogReady: z.boolean(),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(2160),
  fps: z.number().int().min(1).max(120),
  cpuTemperatureC: z.number().min(-20).max(120).nullable(),
  wifiSignalDbm: z.number().int().min(-120).max(0).nullable(),
}).strict();
export type DeviceHealth = z.infer<typeof DeviceHealthSchema>;

export const IceServerSchema = z.object({
  urls: z.union([z.string().min(1).max(512), z.array(z.string().min(1).max(512)).min(1).max(8)]),
  username: z.string().min(1).max(256).optional(),
  credential: z.string().min(1).max(512).optional(),
}).strict();
export type IceServer = z.infer<typeof IceServerSchema>;

const signalOfferSchema = z.object({
  v: z.literal(1),
  type: z.literal("signal.offer"),
  sessionId: uuid,
  sdp: z.string().min(1).max(1_000_000),
}).strict();

const signalAnswerSchema = z.object({
  v: z.literal(1),
  type: z.literal("signal.answer"),
  sessionId: uuid,
  sdp: z.string().min(1).max(1_000_000),
}).strict();

const signalIceSchema = z.object({
  v: z.literal(1),
  type: z.literal("signal.ice"),
  sessionId: uuid,
  candidate: z.string().max(4096).nullable(),
  sdpMid: z.string().max(256).nullable(),
  sdpMLineIndex: z.number().int().min(0).max(128).nullable(),
}).strict();

const sessionEndSchema = z.object({
  v: z.literal(1),
  type: z.literal("session.end"),
  sessionId: uuid,
  reason: shortText,
}).strict();

export const GatewayClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(1),
    type: z.literal("device.authenticate"),
    deviceId: uuid,
    secret: z.string().min(32).max(256),
    agentVersion: z.string().min(1).max(64),
  }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("device.heartbeat"),
    health: DeviceHealthSchema,
  }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("browser.authenticate"),
    ticket: z.string().min(32).max(4096),
  }).strict(),
  signalOfferSchema,
  signalAnswerSchema,
  signalIceSchema,
  sessionEndSchema,
]);
export type GatewayClientMessage = z.infer<typeof GatewayClientMessageSchema>;

export const GatewayServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(1),
    type: z.literal("auth.accepted"),
    peer: z.enum(["device", "browser"]),
  }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("auth.rejected"),
    reason: shortText,
  }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("session.start"),
    sessionId: uuid,
    carId: uuid,
    expiresAt: z.string().datetime(),
    iceServers: z.array(IceServerSchema).max(8),
  }).strict(),
  signalOfferSchema,
  signalAnswerSchema,
  signalIceSchema,
  sessionEndSchema,
  z.object({
    v: z.literal(1),
    type: z.literal("error"),
    code: z.string().min(1).max(64),
    message: shortText,
  }).strict(),
]);
export type GatewayServerMessage = z.infer<typeof GatewayServerMessageSchema>;
