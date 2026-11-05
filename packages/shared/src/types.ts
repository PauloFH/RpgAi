import type { Action } from './actions';
import type { RollResult } from './dice';

export type Role = 'gm' | 'player';
export type Layer = 'tokens' | 'gm';
export type RulesVersion = '2014' | '2024';
export interface CampaignInfo { id: string; name: string; rulesVersion: RulesVersion; allowMixedVersions: boolean; defaultMapId: string | null; playersCanMove: boolean }
export interface Member { userId: string; displayName: string; avatarUrl: string | null; role: Role; currentMapId: string | null }
export interface MapInfo { id: string; name: string; imageUrl: string | null; width: number; height: number; gridSize: number; gridOffsetX: number; gridOffsetY: number }
export interface Token { id: string; mapId: string; name: string; x: number; y: number; size: number; color: string; imageUrl: string | null; layer: Layer; ownerIds: string[] }
export interface ChatMessage { id: string; authorId: string; kind: 'text' | 'roll' | 'whisper'; text: string; label: string | null; rolls: RollResult[]; secret: boolean; recipients: string[] | null; undone: boolean; createdAt: string }
export interface ClientState { campaign: CampaignInfo; me: { userId: string; role: Role }; members: Member[]; maps: MapInfo[]; tokens: Token[]; chat: ChatMessage[]; canUndo: boolean }
export interface Viewer { userId: string; role: Role; mapId: string | null } // mapId = mapa efetivo
export type ErrorCode = 'forbidden' | 'invalid' | 'not_found' | 'nothing_to_undo' | 'dice' | 'internal';
export type StateEvent =
  | { type: 'campaign.updated'; campaign: CampaignInfo }
  | { type: 'member.upserted'; member: Member } | { type: 'member.removed'; userId: string }
  | { type: 'map.upserted'; map: MapInfo } | { type: 'map.removed'; mapId: string }
  | { type: 'token.upserted'; token: Token } | { type: 'token.removed'; tokenId: string }
  | { type: 'chat.added'; message: ChatMessage } | { type: 'chat.updated'; message: ChatMessage }
  | { type: 'undo.available'; canUndo: boolean };
export type ClientMessage = { t: 'cmd'; id: string; action: Action };
export type ServerMessage =
  | { t: 'snapshot'; state: ClientState }
  | { t: 'ack'; id: string }
  | { t: 'error'; id: string | null; code: ErrorCode; message: string }
  | { t: 'event'; event: StateEvent };
