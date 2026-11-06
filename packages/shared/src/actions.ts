import { z } from 'zod';

const role = z.enum(['gm', 'player']);
const layer = z.enum(['tokens', 'gm']);
const uuid = z.string().uuid();
const name80 = z.string().trim().min(1).max(80);
const tokenName = z.string().trim().min(1).max(60);
const size = z.number().int().min(1).max(10);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const ownerIds = z.array(uuid).max(20);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('campaign.update'), name: name80.optional(), playersCanMove: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('member.setRole'), userId: uuid, role }).strict(),
  z.object({ type: z.literal('member.remove'), userId: uuid }).strict(),
  z.object({ type: z.literal('member.setMap'), userId: uuid, mapId: uuid.nullable() }).strict(),
  z.object({ type: z.literal('map.create'), name: name80, imageKey: z.string().min(1).max(200) }).strict(),
  z.object({
    type: z.literal('map.update'),
    mapId: uuid,
    name: name80.optional(),
    gridSize: z.number().int().min(10).max(500).optional(),
    gridOffsetX: z.number().int().min(0).max(499).optional(),
    gridOffsetY: z.number().int().min(0).max(499).optional(),
  }).strict(),
  z.object({ type: z.literal('map.delete'), mapId: uuid }).strict(),
  z.object({ type: z.literal('map.setDefault'), mapId: uuid }).strict(),
  z.object({
    type: z.literal('token.create'),
    mapId: uuid,
    name: tokenName,
    x: z.number().int(),
    y: z.number().int(),
    size: size.default(1),
    color: color.default('#5b8fd9'),
    imageKey: z.string().optional(),
    layer: layer.default('tokens'),
    ownerIds: ownerIds.default([]),
  }).strict(),
  z.object({
    type: z.literal('token.update'),
    tokenId: uuid,
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    name: tokenName.optional(),
    size: size.optional(),
    color: color.optional(),
    layer: layer.optional(),
    ownerIds: ownerIds.optional(),
  }).strict(),
  z.object({ type: z.literal('token.delete'), tokenId: uuid }).strict(),
  z.object({ type: z.literal('chat.send'), text: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('undo') }).strict(),
]);

export type Action = z.infer<typeof ActionSchema>;
