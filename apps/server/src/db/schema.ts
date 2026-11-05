import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  discordId: text('discord_id').unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  rulesVersion: text('rules_version', { enum: ['2014', '2024'] }).notNull(),
  allowMixedVersions: boolean('allow_mixed_versions').notNull().default(false),
  defaultMapId: uuid('default_map_id'),
  playersCanMove: boolean('players_can_move').notNull().default(true),
  createdAt: createdAt(),
});

export const campaignMembers = pgTable(
  'campaign_members',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    currentMapId: uuid('current_map_id'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

export const invites = pgTable('invites', {
  token: text('token').primaryKey(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: createdAt(),
});

export const uploads = pgTable('uploads', {
  key: text('key').primaryKey(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: createdAt(),
});

export const maps = pgTable('maps', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  name: text('name').notNull(),
  imageKey: text('image_key'),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  gridSize: integer('grid_size').notNull().default(70),
  gridOffsetX: integer('grid_offset_x').notNull().default(0),
  gridOffsetY: integer('grid_offset_y').notNull().default(0),
  createdAt: createdAt(),
});

export const tokens = pgTable('tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  mapId: uuid('map_id')
    .notNull()
    .references(() => maps.id),
  name: text('name').notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  size: integer('size').notNull(),
  color: text('color').notNull(),
  imageKey: text('image_key'),
  layer: text('layer').notNull(),
  ownerIds: jsonb('owner_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').notNull(),
  text: text('text').notNull(),
  label: text('label'),
  rolls: jsonb('rolls').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  secret: boolean('secret').notNull().default(false),
  recipients: jsonb('recipients').$type<string[] | null>(),
  undone: boolean('undone').notNull().default(false),
  createdAt: createdAt(),
});

export const actionLog = pgTable(
  'action_log',
  {
    id: serial('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    via: text('via').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    inverse: jsonb('inverse').$type<unknown>(),
    undone: boolean('undone').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('action_log_campaign_id_idx').on(t.campaignId, t.id)],
);
