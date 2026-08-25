import { z } from "zod";

const uuid = z.string().uuid();
const shortText = z.string().min(1).max(256);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/u);
const digestSha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const ed25519Signature = z.string().regex(/^[A-Za-z0-9_-]{80,128}$/u);
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:");

export const DeviceCapabilitiesSchema = z.object({
  controlProtocolVersion: z.union([z.literal(4), z.literal(5)]).optional(),
  otaRuntimeGeneration: z.number().int().min(1).max(32767).optional(),
}).strict();
export type DeviceCapabilities = z.infer<typeof DeviceCapabilitiesSchema>;

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
    capabilities: DeviceCapabilitiesSchema.optional(),
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
  z.object({
    v: z.literal(1),
    type: z.literal("device.update.status"),
    updateId: uuid,
    status: z.enum(["downloading", "applying", "failed"]),
    reason: z.string().min(1).max(256).optional(),
  }).strict(),
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
    type: z.literal("device.update.available"),
    updateId: uuid,
    version: semver,
    runtimeGeneration: z.number().int().min(1).max(32767),
    artifactUrl: httpsUrl,
    artifactSizeBytes: z.number().int().min(1).max(8 * 1024 * 1024),
    digestSha256,
    signature: ed25519Signature,
  }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("error"),
    code: z.string().min(1).max(64),
    message: shortText,
  }).strict(),
]);
export type GatewayServerMessage = z.infer<typeof GatewayServerMessageSchema>;
